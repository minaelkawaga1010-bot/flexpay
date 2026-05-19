import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { cron } from '@shared/utils/cron';

/**
 * Fraud monitor — velocity spikes + anomalous attendance drops.
 *
 * Two-pronged surveillance, both running on a 15-minute cadence:
 *
 *   A. Velocity surveillance (per worker)
 *      A worker who suddenly accelerates advance-taking compared to
 *      their own recent baseline is either (a) facing a real liquidity
 *      shock — totally legitimate, but ops should know, or (b) a
 *      compromised account. We don't gate on this — we flag. The Step-
 *      up OTP + biometric stack in mobile-api/ already gates the
 *      transaction; this is the "after-the-fact" detective layer.
 *
 *      Threshold: today's advance count >= max(3, 4 × 30-day mean).
 *
 *   B. Company-cohort attendance drop
 *      A company whose aggregate accruedAmount (today vs trailing
 *      7-day mean of accruedAmount) drops sharply may be ghost-paying:
 *      employees registered on the WPS file are no longer turning up,
 *      yet payroll intent rows continue to materialise. This is the
 *      classic UAE attendance-fraud vector — phantom employees on the
 *      books. We threshold at a 35% drop and surface a
 *      CompanyAttendanceAnomaly row.
 *
 * Both raw-SQL: the per-worker baseline join is too verbose in Prisma
 * model API and the company aggregate needs a HAVING clause.
 */

const VELOCITY_MULTIPLIER = 4;
const VELOCITY_HARD_FLOOR = 3; // ignore workers below this absolute count
const VELOCITY_LOOKBACK_DAYS = 30;
const VELOCITY_WINDOW_HOURS = 24;

const COMPANY_DROP_THRESHOLD = 0.35;
const COMPANY_LOOKBACK_DAYS = 7;

export interface VelocityAlert {
  employeeId: string;
  windowCount: number;
  baselineMean: number;
  multiple: number;
  totalAEDInWindow: number;
}

export interface AttendanceDropAlert {
  companyId: string;
  companyName: string;
  todayAccruedAED: number;
  baselineMeanAED: number;
  dropFraction: number;
  affectedIntentCount: number;
}

export interface FraudScanResult {
  scannedAt: Date;
  velocityAlerts: VelocityAlert[];
  attendanceDropAlerts: AttendanceDropAlert[];
}

async function detectVelocitySpikes(): Promise<VelocityAlert[]> {
  /**
   * Per worker:
   *   windowCount   = #advances in last VELOCITY_WINDOW_HOURS h
   *   baselineMean  = avg #advances/day over the prior VELOCITY_LOOKBACK_DAYS d
   *   flag if windowCount ≥ max(HARD_FLOOR, MULTIPLIER × baselineMean)
   */
  const rows = await prisma.$queryRaw<
    {
      employeeId: string;
      windowCount: bigint;
      baselineMean: number;
      totalAEDInWindow: number;
    }[]
  >`
    WITH window_adv AS (
      SELECT "employeeId", COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total_aed
      FROM advances
      WHERE "requestedAt" >= NOW() - (${VELOCITY_WINDOW_HOURS} || ' hours')::interval
      GROUP BY "employeeId"
    ),
    baseline_adv AS (
      SELECT
        "employeeId",
        -- mean advances per day across the lookback period
        COUNT(*)::float8 / ${VELOCITY_LOOKBACK_DAYS}::float8 AS mean_per_day
      FROM advances
      WHERE "requestedAt" >= NOW() - (${VELOCITY_LOOKBACK_DAYS} || ' days')::interval
        AND "requestedAt" <  NOW() - (${VELOCITY_WINDOW_HOURS} || ' hours')::interval
      GROUP BY "employeeId"
    )
    SELECT
      w."employeeId"                                    AS "employeeId",
      w.cnt                                             AS "windowCount",
      COALESCE(b.mean_per_day, 0)::float8               AS "baselineMean",
      w.total_aed::float8                               AS "totalAEDInWindow"
    FROM window_adv w
    LEFT JOIN baseline_adv b USING ("employeeId")
    WHERE w.cnt >= GREATEST(
      ${VELOCITY_HARD_FLOOR}::bigint,
      (${VELOCITY_MULTIPLIER}::float8 * COALESCE(b.mean_per_day, 0))::bigint
    )
    ORDER BY w.cnt DESC
    LIMIT 200
  `;

  return rows.map((r) => {
    const windowCount = Number(r.windowCount);
    const baselineMean = Number(r.baselineMean);
    return {
      employeeId: r.employeeId,
      windowCount,
      baselineMean,
      multiple: baselineMean > 0 ? windowCount / baselineMean : Infinity,
      totalAEDInWindow: Number(r.totalAEDInWindow ?? 0),
    };
  });
}

async function detectAttendanceDrops(): Promise<AttendanceDropAlert[]> {
  /**
   * Per company:
   *   todayAccrued = Σ accruedAmount on intents created today
   *   baseline     = mean(Σ accruedAmount) over the prior 7 days
   *   flag if (baseline - today) / baseline ≥ COMPANY_DROP_THRESHOLD
   *
   * NULL-safe: companies with no intents today get a today=0, which
   * trivially passes the threshold if they have a non-zero baseline.
   * That's the right behaviour — a company that historically generated
   * intents and then went silent IS a flag.
   */
  const rows = await prisma.$queryRaw<
    {
      companyId: string;
      companyName: string;
      todayAccruedAED: number;
      baselineMeanAED: number;
      affectedIntentCount: bigint;
    }[]
  >`
    WITH today_company AS (
      SELECT c.id AS company_id,
             COALESCE(SUM(pi."accruedAmount"), 0) AS today_accrued,
             COUNT(pi.id)                         AS intent_count
      FROM companies c
      LEFT JOIN payroll_cycles pc ON pc."companyId" = c.id
      LEFT JOIN payroll_intents pi
        ON pi."cycleId" = pc.id
        AND pi."createdAt" >= date_trunc('day', NOW())
      WHERE c.status = 'ACTIVE'
      GROUP BY c.id
    ),
    baseline_company AS (
      SELECT c.id AS company_id,
             COALESCE(SUM(pi."accruedAmount"), 0) / ${COMPANY_LOOKBACK_DAYS}::float8 AS mean_accrued
      FROM companies c
      LEFT JOIN payroll_cycles pc ON pc."companyId" = c.id
      LEFT JOIN payroll_intents pi
        ON pi."cycleId" = pc.id
        AND pi."createdAt" >= NOW() - (${COMPANY_LOOKBACK_DAYS} || ' days')::interval
        AND pi."createdAt" <  date_trunc('day', NOW())
      WHERE c.status = 'ACTIVE'
      GROUP BY c.id
    )
    SELECT
      c.id                                          AS "companyId",
      c.name                                        AS "companyName",
      t.today_accrued::float8                       AS "todayAccruedAED",
      b.mean_accrued::float8                        AS "baselineMeanAED",
      t.intent_count                                AS "affectedIntentCount"
    FROM companies c
    INNER JOIN today_company    t ON t.company_id = c.id
    INNER JOIN baseline_company b ON b.company_id = c.id
    WHERE b.mean_accrued > 0
      AND (b.mean_accrued - t.today_accrued) / b.mean_accrued >= ${COMPANY_DROP_THRESHOLD}::float8
    ORDER BY (b.mean_accrued - t.today_accrued) / b.mean_accrued DESC
    LIMIT 100
  `;

  return rows.map((r) => ({
    companyId: r.companyId,
    companyName: r.companyName,
    todayAccruedAED: Number(r.todayAccruedAED ?? 0),
    baselineMeanAED: Number(r.baselineMeanAED ?? 0),
    dropFraction:
      r.baselineMeanAED > 0
        ? (Number(r.baselineMeanAED) - Number(r.todayAccruedAED)) / Number(r.baselineMeanAED)
        : 0,
    affectedIntentCount: Number(r.affectedIntentCount ?? 0),
  }));
}

export class FraudMonitorService {
  /** One-shot scan. Idempotent and side-effect-free; alerts are returned. */
  async scan(): Promise<FraudScanResult> {
    const startedAt = Date.now();
    const [velocityAlerts, attendanceDropAlerts] = await Promise.all([
      detectVelocitySpikes(),
      detectAttendanceDrops(),
    ]);
    const result: FraudScanResult = {
      scannedAt: new Date(),
      velocityAlerts,
      attendanceDropAlerts,
    };
    logger.info('fraud scan complete', {
      durationMs: Date.now() - startedAt,
      velocityAlertCount: velocityAlerts.length,
      attendanceDropAlertCount: attendanceDropAlerts.length,
    });
    if (velocityAlerts.length > 0 || attendanceDropAlerts.length > 0) {
      // Ops-tier log; production wiring routes to PagerDuty via the
      // logger's WARN sink. Severity here is "investigate", not "act".
      logger.warn('fraud signals detected', {
        velocityAlertCount: velocityAlerts.length,
        attendanceDropAlertCount: attendanceDropAlerts.length,
      });
    }
    return result;
  }
}

export const fraudMonitorService = new FraudMonitorService();

/**
 * Register the 15-minute scan on the centralised CronManager. The
 * fraud monitor intentionally runs MORE frequently than the
 * reconciliation worker (which is twice daily) because the signal
 * we're after is intra-day — a compromised account can be milked in a
 * single shift if we wait for the 14:00/22:00 recon pass.
 */
export function registerFraudMonitorCron(): void {
  cron.register({
    name: 'fraud-monitor-scan',
    expression: '*/15 * * * *',
    handler: () => fraudMonitorService.scan(),
  });
}
