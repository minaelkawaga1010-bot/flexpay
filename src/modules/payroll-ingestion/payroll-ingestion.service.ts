import { Prisma, PayrollCycleStatus } from '@prisma/client';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { AppError, BadRequest } from '@shared/utils/errors';
import { hashEmiratesId } from '@shared/security/pii-crypto';
import {
  ParsedSif,
  WpsParserError,
  deriveCyclePeriod,
  parseSif,
} from './wps-parser.service';
import {
  runSifAnomalyPipeline,
  type SifDecision,
  type EmployerPayrollHistory,
} from './sif-anomaly.service';

/**
 * Ingestion orchestrator. Sits between the parser (pure) and the
 * Prisma persistence layer. The DB writes are inside a single
 * `$transaction` so a malformed row that slips past parsing — e.g. a
 * nationalId with no matching Employee row — fails the whole ingest
 * cleanly. There is never a half-loaded cycle.
 *
 * Two-stage idempotency:
 *
 *   1. PayrollCycle.fileFingerprint is `@unique` — a re-upload of the
 *      identical file is detected by the parser's sha256 and rejected
 *      at the SQL boundary with FILE_ALREADY_INGESTED.
 *
 *   2. PayrollCycle.(companyId, periodStart, periodEnd) is `@unique` —
 *      an attempt to ingest two DIFFERENT files for the same month is
 *      rejected with CYCLE_ALREADY_EXISTS. The operator must either
 *      delete the prior cycle (ops-tier action) or wait for the next
 *      payroll period.
 *
 * Employee resolution:
 *
 *   Each SRR's nationalId is matched to an Employee row via the
 *   `kycDocuments[].emiratesIdNumber` column populated by the
 *   compliance plane. Workers without a verified KYC document are
 *   surfaced in the result's `unknownNationalIds` list and DO NOT
 *   produce a PayrollIntent — those employees are paid through the
 *   bank rail directly, not routed through FlexPay.
 */

export type IngestionFailureCode =
  | 'CYCLE_ALREADY_EXISTS'
  | 'FILE_ALREADY_INGESTED'
  | 'COMPANY_NOT_FOUND'
  | 'EMPLOYER_ID_MISMATCH';

export interface IngestionResult {
  cycleId: string;
  companyId: string;
  fileFingerprint: string;
  parsedRowCount: number;
  intentsCreated: number;
  unmatchedRowCount: number;
  unknownNationalIds: string[];
  totalSalaryAED: number;
  /** SIF anomaly decision — present unless skipAnomalyCheck was set. */
  anomalyDecision?: SifDecision;
  /** Flags raised by the anomaly pipeline (empty on clean APPROVED). */
  anomalyFlagCount?: number;
}

export interface IngestSifArgs {
  companyId: string;
  /** Optional override for the employer ID expected to appear in the EDR. */
  expectedEmployerId?: string;
  file: Buffer | string;
  /**
   * Skip the SIF anomaly pipeline (Stages 2-6). Default false. Set
   * true only for trusted re-ingestion / replay where the anomaly
   * check already passed.
   */
  skipAnomalyCheck?: boolean;
}

/**
 * The wire-thin happy-path: parse → resolve company → resolve
 * employees → atomic write.
 */
export async function ingestSifFile(args: IngestSifArgs): Promise<IngestionResult> {
  const parsed = parseSif(args.file);

  // Pre-flight: company exists.
  const company = await prisma.company.findUnique({
    where: { id: args.companyId },
    select: { id: true },
  });
  if (!company) {
    throw new AppError(404, 'COMPANY_NOT_FOUND', `Company ${args.companyId} not found`);
  }

  if (args.expectedEmployerId && args.expectedEmployerId !== parsed.header.employerId) {
    throw new AppError(
      409,
      'EMPLOYER_ID_MISMATCH',
      `EDR employerId ${parsed.header.employerId} does not match expected ${args.expectedEmployerId}`,
      { edrEmployerId: parsed.header.employerId, expected: args.expectedEmployerId },
    );
  }

  // Pre-flight: duplicate file detection BEFORE entering the tx so the
  // failure path is a clean 409 rather than a tx-rollback noise.
  const existingByFile = await prisma.payrollCycle.findUnique({
    where: { fileFingerprint: parsed.fileFingerprint },
    select: { id: true, companyId: true },
  });
  if (existingByFile) {
    throw new AppError(
      409,
      'FILE_ALREADY_INGESTED',
      `This file has already been ingested as cycle ${existingByFile.id}`,
      { cycleId: existingByFile.id },
    );
  }

  // SIF Anomaly Interceptor (Bible §2.1 Stages 2-6). Runs BEFORE the
  // cycle is created so a HARD_BLOCK refuses ingestion with zero DB
  // writes. A FLAGGED result proceeds but is surfaced in the result
  // for the MLRO review queue.
  let anomalyDecision: SifDecision | undefined;
  let anomalyFlagCount: number | undefined;
  if (!args.skipAnomalyCheck) {
    const history = await loadEmployerPayrollHistory(args.companyId);
    const report = await runSifAnomalyPipeline({
      parsed,
      establishmentId: parsed.header.employerId,
      history,
    });
    anomalyDecision = report.decision;
    anomalyFlagCount = report.flags.length;
    if (report.decision === 'BLOCKED') {
      throw new AppError(
        422,
        'SIF_ANOMALY_HARD_BLOCK',
        'SIF blocked by anomaly interceptor — MLRO review required before resubmission',
        {
          ghostCandidates: report.ghostCandidates,
          flags: report.flags,
          temporalAnomaly: report.temporalAnomaly,
        },
      );
    }
  }

  const { periodStart, periodEnd } = deriveCyclePeriod(parsed.header.salaryYearMonth);

  const existingByPeriod = await prisma.payrollCycle.findUnique({
    where: {
      companyId_periodStart_periodEnd: {
        companyId: args.companyId,
        periodStart,
        periodEnd,
      },
    },
    select: { id: true, status: true },
  });
  if (existingByPeriod) {
    throw new AppError(
      409,
      'CYCLE_ALREADY_EXISTS',
      `Cycle for ${parsed.header.salaryYearMonth} already exists (${existingByPeriod.id}, ${existingByPeriod.status})`,
      { cycleId: existingByPeriod.id, status: existingByPeriod.status },
    );
  }

  // Resolve each SRR's nationalId to a FlexPay-onboarded Employee.
  // Post-A.7 the compliance plane stores only the one-way SHA-256 of
  // the EID (KycDocument.emiratesIdHash), never the plaintext. We hash
  // each SIF nationalId the same way and join on the hash — equality
  // matching with zero plaintext EID at rest (Bible §5.2).
  const hashToNationalId = new Map<string, string>();
  for (const r of parsed.rows) {
    hashToNationalId.set(hashEmiratesId(r.nationalId), r.nationalId);
  }
  const hashes = [...hashToNationalId.keys()];
  const kyc = await prisma.kycDocument.findMany({
    where: {
      emiratesIdHash: { in: hashes },
      status: 'VERIFIED',
      employee: { companyId: args.companyId },
    },
    select: { emiratesIdHash: true, employeeId: true },
  });
  const nationalIdToEmployeeId = new Map<string, string>();
  for (const k of kyc) {
    if (!k.emiratesIdHash) continue;
    const nationalId = hashToNationalId.get(k.emiratesIdHash);
    if (nationalId) nationalIdToEmployeeId.set(nationalId, k.employeeId);
  }

  const unknownNationalIds: string[] = [];
  const matched: Array<{ row: typeof parsed.rows[number]; employeeId: string }> = [];
  for (const row of parsed.rows) {
    const employeeId = nationalIdToEmployeeId.get(row.nationalId);
    if (!employeeId) {
      unknownNationalIds.push(row.nationalId);
      continue;
    }
    matched.push({ row, employeeId });
  }

  // Atomic write set: PayrollCycle + N PayrollIntent rows. Statement
  // timeout boosted because a thousand-employee createMany inside a tx
  // can exceed Postgres' default 5s.
  const writeResult = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const cycle = await tx.payrollCycle.create({
        data: {
          companyId: args.companyId,
          periodStart,
          periodEnd,
          fileFingerprint: parsed.fileFingerprint,
          fileFormat: 'UAE_SIF',
          status: PayrollCycleStatus.INTENTS_READY,
          ingestedAt: new Date(),
        },
      });

      if (matched.length > 0) {
        await tx.payrollIntent.createMany({
          data: matched.map(({ row, employeeId }) => ({
            cycleId: cycle.id,
            employeeId,
            grossAmount: row.totalSalary,
            // accruedAmount is set to gross at ingest time — the
            // HR-tech attendance feed will overwrite this on a per-day
            // basis between now and cycle settle. The model treats
            // "no attendance feed yet" as "full salary accrued for
            // payment", which is conservative — it lets the worker
            // see what they're owed without yet enabling EWA against
            // unconfirmed accrual.
            accruedAmount: row.totalSalary,
            currency: parsed.header.currency,
            fileLineHash: row.lineHash,
          })),
        });
      }

      return cycle;
    },
    {
      maxWait: 10_000,
      timeout: 120_000,
    },
  );

  logger.info('SIF ingest complete', {
    cycleId: writeResult.id,
    companyId: args.companyId,
    fileFingerprint: parsed.fileFingerprint,
    parsedRowCount: parsed.rows.length,
    intentsCreated: matched.length,
    unmatchedRowCount: unknownNationalIds.length,
  });

  return {
    cycleId: writeResult.id,
    companyId: args.companyId,
    fileFingerprint: parsed.fileFingerprint,
    parsedRowCount: parsed.rows.length,
    intentsCreated: matched.length,
    unmatchedRowCount: unknownNationalIds.length,
    unknownNationalIds,
    totalSalaryAED: parsed.trailer.totalSalary,
    anomalyDecision,
    anomalyFlagCount,
  };
}

/**
 * Load the employer's trailing payroll history for the temporal
 * anomaly stage. Uses the last 12 SETTLED/INTENTS_READY cycles, newest
 * last (chronological), so the statistical baseline reflects recent
 * behaviour. Returns empty arrays for a first-time employer (the
 * temporal model treats <2 cycles as "no baseline → not anomalous").
 */
async function loadEmployerPayrollHistory(
  companyId: string,
): Promise<EmployerPayrollHistory> {
  const cycles = await prisma.payrollCycle.findMany({
    where: { companyId },
    orderBy: { periodStart: 'desc' },
    take: 12,
    select: {
      id: true,
      intents: { select: { grossAmount: true } },
    },
  });
  // Reverse to chronological order (oldest → newest).
  const ordered = cycles.reverse();
  return {
    cycleTotals: ordered.map((c) => c.intents.reduce((s, i) => s + i.grossAmount, 0)),
    cycleHeadcounts: ordered.map((c) => c.intents.length),
  };
}

/**
 * Translate a WpsParserError into the canonical AppError shape so the
 * standard error-handler middleware produces a structured 400 response
 * without leaking the raw stack.
 */
export function wpsParserErrorToAppError(err: WpsParserError): AppError {
  return new AppError(400, err.code, err.message, err.context);
}

// Re-export for consumers that want to do their own catch + branch.
export { WpsParserError };
export type { ParsedSif };

// Internal sentry — referenced from tests so we can assert on the
// canonical error path without importing internals.
void BadRequest;
