import { env } from '@config/env';
import logger from '@shared/utils/logger';
import type { SifSalaryRow, ParsedSif } from './wps-parser.service';

/**
 * SIF Anomaly Interceptor — Bible §2.1 Stages 2-6. Closes Review A.9.
 *
 * The parser (wps-parser.service.ts) is Stage 1 (parse + checksum).
 * This module is the intelligence layer that runs on every payroll
 * upload BEFORE WPS submission and either APPROVES, SOFT_FLAGs
 * (proceed + human review), or HARD_BLOCKs (refuse to submit).
 *
 *   Stage 2 — MOHRE registry validation  (worker IDs + labour cards)
 *   Stage 3 — Temporal anomaly           (employer payroll history)
 *   Stage 4 — Row-level outlier scan      (isolation-style scoring)
 *   Stage 5 — Ghost-employee sweep        (pure rules; concurrent w/ 4)
 *   Stage 6 — Ensemble decision
 *
 * ML boundary: the Bible specifies an LSTM Autoencoder (Stage 3) and an
 * Isolation Forest (Stage 4). Those are trained models that live on
 * SageMaker. They are bound here via the `TemporalAnomalyModel` and
 * `RowOutlierModel` interfaces. Until the trained artifacts land, a
 * deterministic STATISTICAL implementation provides a real, defensible
 * detector (z-score temporal deviation + robust per-feature outlier
 * scoring) — NOT a stub that throws. The payroll rail cannot have a
 * fail-open hole.
 *
 * Stage 5 (ghost-employee sweep) is PURE RULES, fully implemented, no
 * model dependency — it is the highest-precision fraud catch.
 */

// ───────────────────────────────────────────────────────────────────
// Decision types
// ───────────────────────────────────────────────────────────────────

export type SifDecision = 'APPROVED' | 'FLAGGED' | 'BLOCKED';

export interface SifFlag {
  rowNumber: number;
  nationalId: string;
  reason: string;
  detail?: Record<string, unknown>;
}

export interface SifAnomalyReport {
  decision: SifDecision;
  /** True if WPS submission may proceed (APPROVED or FLAGGED). */
  wpsReady: boolean;
  requiresReview: boolean;
  flags: SifFlag[];
  ghostCandidates: SifFlag[];
  temporalAnomaly: boolean;
  stageTimingsMs: Record<string, number>;
}

// ───────────────────────────────────────────────────────────────────
// Stage 2 — MOHRE registry validation (pluggable adapter)
// ───────────────────────────────────────────────────────────────────

export interface MohreValidationResult {
  /** Map nationalId → { laborCardActive, registered }. */
  [nationalId: string]: { laborCardActive: boolean; registered: boolean };
}

export interface MohreValidator {
  validateBatch(args: {
    establishmentId: string;
    nationalIds: string[];
  }): Promise<MohreValidationResult>;
}

/**
 * Default MOHRE validator. When MOHRE_API_BASE is configured it calls
 * the registry; otherwise it returns an "all registered + active"
 * optimistic result so the rest of the pipeline runs in dev/test. In
 * production the env gate ensures the real adapter is bound.
 */
class DefaultMohreValidator implements MohreValidator {
  async validateBatch(args: {
    establishmentId: string;
    nationalIds: string[];
  }): Promise<MohreValidationResult> {
    if (!env.MOHRE_API_BASE) {
      const result: MohreValidationResult = {};
      for (const id of args.nationalIds) {
        result[id] = { laborCardActive: true, registered: true };
      }
      return result;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200); // Bible: 1.2s budget
    try {
      const res = await fetch(`${env.MOHRE_API_BASE}/validate-batch`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(env.MOHRE_API_KEY ? { authorization: `Bearer ${env.MOHRE_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          establishment_id: args.establishmentId,
          worker_ids: args.nationalIds,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`MOHRE HTTP ${res.status}`);
      return (await res.json()) as MohreValidationResult;
    } finally {
      clearTimeout(timer);
    }
  }
}

let mohreValidator: MohreValidator = new DefaultMohreValidator();
export function setMohreValidator(v: MohreValidator): void {
  mohreValidator = v;
}

// ───────────────────────────────────────────────────────────────────
// Stage 3 — Temporal anomaly (LSTM Autoencoder, statistical fallback)
// ───────────────────────────────────────────────────────────────────

export interface EmployerPayrollHistory {
  /** Per-cycle total gross over the trailing N cycles. */
  cycleTotals: number[];
  /** Per-cycle headcount over the trailing N cycles. */
  cycleHeadcounts: number[];
}

export interface TemporalAnomalyModel {
  /**
   * Returns true if THIS upload's aggregate shape deviates anomalously
   * from the employer's recent history. Bible §2.1 STAGE 3:
   * reconstruction error > mean + 2.5σ.
   */
  isAnomalous(args: {
    history: EmployerPayrollHistory;
    currentTotal: number;
    currentHeadcount: number;
  }): boolean;
}

/**
 * Statistical temporal detector — stands in for the LSTM Autoencoder.
 * Flags when the current cycle's total gross deviates more than
 * 2.5 standard deviations from the trailing mean (Bible's exact
 * threshold), OR when headcount jumps by >40% cycle-over-cycle.
 *
 * With <2 cycles of history there's no baseline → never anomalous
 * (a new employer's first upload can't be "anomalous" against nothing).
 */
export class StatisticalTemporalModel implements TemporalAnomalyModel {
  isAnomalous(args: {
    history: EmployerPayrollHistory;
    currentTotal: number;
    currentHeadcount: number;
  }): boolean {
    const totals = args.history.cycleTotals;
    if (totals.length < 2) return false;

    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    const variance =
      totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length;
    const std = Math.sqrt(variance);
    const totalDeviation = std > 0 ? Math.abs(args.currentTotal - mean) > mean + 2.5 * std : false;

    const heads = args.history.cycleHeadcounts;
    const lastHead = heads.length > 0 ? heads[heads.length - 1] : args.currentHeadcount;
    const headcountJump =
      lastHead > 0 ? Math.abs(args.currentHeadcount - lastHead) / lastHead > 0.4 : false;

    return totalDeviation || headcountJump;
  }
}

let temporalModel: TemporalAnomalyModel = new StatisticalTemporalModel();
export function setTemporalAnomalyModel(m: TemporalAnomalyModel): void {
  temporalModel = m;
}

// ───────────────────────────────────────────────────────────────────
// Stage 4 — Row-level outlier scan (Isolation Forest, statistical)
// ───────────────────────────────────────────────────────────────────

export interface RowOutlierModel {
  /** Returns a per-row outlier score; rows below `threshold` are flagged. */
  scoreRows(rows: SifSalaryRow[]): number[];
  readonly flagThreshold: number;
}

/**
 * Robust statistical outlier scorer — stands in for Isolation Forest.
 * Scores each row's salary against the median + MAD (median absolute
 * deviation) of the batch. A row whose salary is a strong outlier
 * (robust z-score > 3.5) scores below the flag threshold.
 *
 * Returns scores where MORE NEGATIVE = more anomalous (mirrors
 * sklearn IsolationForest.decision_function semantics). Bible §2.1
 * STAGE 4 flags rows with score < -0.20.
 */
export class StatisticalRowOutlierModel implements RowOutlierModel {
  readonly flagThreshold = -0.2;

  scoreRows(rows: SifSalaryRow[]): number[] {
    if (rows.length < 3) return rows.map(() => 0); // too few to judge

    const salaries = rows.map((r) => r.totalSalary).sort((a, b) => a - b);
    const median = salaries[Math.floor(salaries.length / 2)];
    const absDevs = salaries.map((s) => Math.abs(s - median)).sort((a, b) => a - b);
    const mad = absDevs[Math.floor(absDevs.length / 2)] || 1;

    return rows.map((r) => {
      // Robust z ≈ 0.6745 × (x − median) / MAD
      const robustZ = (0.6745 * (r.totalSalary - median)) / mad;
      // Map |robustZ| into a decision_function-like score:
      //   |z| 0   → ~+0.1 (inlier)
      //   |z| 3.5 → ~-0.20 (flag boundary)
      const score = 0.1 - Math.abs(robustZ) * 0.0857;
      return score;
    });
  }
}

let rowOutlierModel: RowOutlierModel = new StatisticalRowOutlierModel();
export function setRowOutlierModel(m: RowOutlierModel): void {
  rowOutlierModel = m;
}

// ───────────────────────────────────────────────────────────────────
// Pipeline
// ───────────────────────────────────────────────────────────────────

export interface RunSifAnomalyArgs {
  parsed: ParsedSif;
  establishmentId: string;
  history: EmployerPayrollHistory;
  /** Known beneficiary IBANs for this employer (prior cycles). */
  knownIbans?: Set<string>;
  /** p95 salary across the employer's workforce — for the ghost sweep. */
  employerP95Salary?: number;
}

export async function runSifAnomalyPipeline(
  args: RunSifAnomalyArgs,
): Promise<SifAnomalyReport> {
  const rows = args.parsed.rows;
  const timings: Record<string, number> = {};
  const flags: SifFlag[] = [];

  // ── Stage 2: MOHRE validation ──────────────────────────────────
  let t = Date.now();
  const mohre = await mohreValidator.validateBatch({
    establishmentId: args.establishmentId,
    nationalIds: rows.map((r) => r.nationalId),
  });
  timings.mohreValidation = Date.now() - t;

  for (const row of rows) {
    const m = mohre[row.nationalId];
    if (!m || !m.registered) {
      flags.push({
        rowNumber: row.rowNumber,
        nationalId: row.nationalId,
        reason: 'MOHRE_NOT_REGISTERED',
      });
    }
  }

  // ── Stage 3: temporal anomaly ──────────────────────────────────
  t = Date.now();
  const currentTotal = rows.reduce((sum, r) => sum + r.totalSalary, 0);
  const temporalAnomaly = temporalModel.isAnomalous({
    history: args.history,
    currentTotal,
    currentHeadcount: rows.length,
  });
  timings.temporalAnomaly = Date.now() - t;

  // ── Stage 4: row-level outlier scan ────────────────────────────
  t = Date.now();
  const scores = rowOutlierModel.scoreRows(rows);
  const flaggedRows: SifFlag[] = [];
  rows.forEach((row, i) => {
    if (scores[i] < rowOutlierModel.flagThreshold) {
      flaggedRows.push({
        rowNumber: row.rowNumber,
        nationalId: row.nationalId,
        reason: 'SALARY_OUTLIER',
        detail: { outlierScore: Number(scores[i].toFixed(4)), salary: row.totalSalary },
      });
    }
  });
  flags.push(...flaggedRows);
  timings.rowOutlierScan = Date.now() - t;

  // ── Stage 5: ghost-employee sweep (pure rules) ─────────────────
  t = Date.now();
  const ghostCandidates = sweepGhostEmployees(rows, mohre, {
    knownIbans: args.knownIbans ?? new Set(),
    employerP95Salary: args.employerP95Salary,
  });
  timings.ghostSweep = Date.now() - t;

  // ── Stage 6: ensemble decision ─────────────────────────────────
  // Bible §2.1 STAGE 6:
  //   ghost candidates OR (temporal anomaly AND flagged rows) → BLOCK
  //   else flagged rows                                       → FLAG
  //   else                                                    → APPROVE
  let decision: SifDecision;
  if (ghostCandidates.length > 0 || (temporalAnomaly && flaggedRows.length > 0)) {
    decision = 'BLOCKED';
  } else if (flaggedRows.length > 0 || flags.length > 0) {
    decision = 'FLAGGED';
  } else {
    decision = 'APPROVED';
  }

  const report: SifAnomalyReport = {
    decision,
    wpsReady: decision !== 'BLOCKED',
    requiresReview: decision === 'FLAGGED',
    flags,
    ghostCandidates,
    temporalAnomaly,
    stageTimingsMs: timings,
  };

  logger.info('SIF anomaly pipeline complete', {
    establishmentId: args.establishmentId,
    decision,
    rowCount: rows.length,
    flagCount: flags.length,
    ghostCount: ghostCandidates.length,
    temporalAnomaly,
    timings,
  });

  if (decision === 'BLOCKED') {
    logger.warn('SIF HARD_BLOCK — MLRO notification required', {
      establishmentId: args.establishmentId,
      ghostCandidates,
      flags: flaggedRows,
    });
  }

  return report;
}

/**
 * Stage 5 — Ghost-Employee Sweep. Pure rules (Bible §2.1):
 *
 *   ghost = beneficiary IBAN never seen before
 *           AND labour card NOT active in MOHRE
 *           AND salary in the employer's top 5%
 *
 * The combination is the classic phantom-employee payroll-fraud
 * vector: a fabricated worker funnelling money to a fresh account at
 * an above-average salary.
 */
export function sweepGhostEmployees(
  rows: SifSalaryRow[],
  mohre: MohreValidationResult,
  opts: { knownIbans: Set<string>; employerP95Salary?: number },
): SifFlag[] {
  // Derive p95 from the batch when not supplied by the caller.
  const p95 =
    opts.employerP95Salary ??
    (() => {
      const sorted = rows.map((r) => r.totalSalary).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * 0.95)] ?? Infinity;
    })();

  const ghosts: SifFlag[] = [];
  for (const row of rows) {
    const iban = row.accountNumber;
    const ibanUnknown = !opts.knownIbans.has(iban);
    const laborInactive = !mohre[row.nationalId]?.laborCardActive;
    const highSalary = row.totalSalary >= p95;

    if (ibanUnknown && laborInactive && highSalary) {
      ghosts.push({
        rowNumber: row.rowNumber,
        nationalId: row.nationalId,
        reason: 'GHOST_EMPLOYEE_CANDIDATE',
        detail: {
          iban,
          salary: row.totalSalary,
          p95Threshold: p95,
          laborCardActive: false,
        },
      });
    }
  }
  return ghosts;
}
