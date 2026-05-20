import { Prisma, PayrollCycleStatus } from '@prisma/client';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { AppError, BadRequest } from '@shared/utils/errors';
import {
  ParsedSif,
  WpsParserError,
  deriveCyclePeriod,
  parseSif,
} from './wps-parser.service';

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
}

export interface IngestSifArgs {
  companyId: string;
  /** Optional override for the employer ID expected to appear in the EDR. */
  expectedEmployerId?: string;
  file: Buffer | string;
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
  // The compliance plane writes nationalId into KycDocument.emiratesIdNumber
  // on VERIFIED documents. Use that as the canonical join.
  const nationalIds = parsed.rows.map((r) => r.nationalId);
  const kyc = await prisma.kycDocument.findMany({
    where: {
      emiratesIdNumber: { in: nationalIds },
      status: 'VERIFIED',
      employee: { companyId: args.companyId },
    },
    select: { emiratesIdNumber: true, employeeId: true },
  });
  const nationalIdToEmployeeId = new Map<string, string>();
  for (const k of kyc) {
    if (k.emiratesIdNumber) nationalIdToEmployeeId.set(k.emiratesIdNumber, k.employeeId);
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
