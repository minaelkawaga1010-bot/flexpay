import { createHash } from 'crypto';
import { z } from 'zod';
import logger from '@shared/utils/logger';

/**
 * UAE MOHRE SIF (Salary Information File) parser.
 *
 * The SIF format used by the UAE WPS is a CSV-class fixed-schema text
 * file with three record types identified by a leading code field:
 *
 *   EDR — Employer Detail Record (exactly 1, first line)
 *   SRR — Salary Record           (1 per employee)
 *   TRR — Trailer Record          (exactly 1, last line, checksum)
 *
 * Field layout — comma-separated, no quoting, ASCII only.
 *
 *   EDR | employerId(14) | fileCreationDate(YYYY-MM-DD) | fileCreationTime(HHMM)
 *       | bankSponsorCode | salaryYearMonth(YYYYMM) | currency(3)
 *
 *   SRR | nationalId(15) | labourCardNumber | routingCode | accountNumber
 *       | salaryFrequency(M|W|D) | numberOfWorkingDays
 *       | fixedSalary | variableSalary | totalSalary
 *
 *   TRR | recordCount(N) | totalSalary(sum of SRR.totalSalary)
 *
 * The parser is intentionally pure: it never touches the database. It
 * returns a `ParsedSif` value object that the ingestion controller
 * persists inside a Prisma transaction. Keeping parsing pure means
 * (1) the parse can be exercised entirely from fast-check property
 * tests, (2) a malformed file is rejected BEFORE any DB write, so the
 * transaction is structurally never partially-committed.
 *
 * The parser is also streamable. Operate on a Buffer or string; the
 * line iteration is O(n) and the memory footprint is one line at a
 * time apart from the accumulating intent list — fine for files in the
 * thousands of rows (the Phase-1 ceiling).
 *
 * Strictness contract:
 *   • Any malformed field throws WpsParserError. We do NOT "skip" rows.
 *     The whole file is rejected. This is the right call for a
 *     financial-rail ingestion: a partial parse means a half-paid
 *     company, which is worse than a fully-rejected file.
 *   • Checksum integrity is non-negotiable. The TRR's recordCount and
 *     totalSalary MUST match the parsed sum of SRR rows, modulo a
 *     0.01 AED tolerance to absorb downstream float rounding.
 */

// ───────────────────────────────────────────────────────────────────
// Field validators (Zod) — used INSIDE the parser to give precise
// per-field error messages with location info.
// ───────────────────────────────────────────────────────────────────

const employerIdSchema = z.string().regex(/^\d{14}$/, '14 digits required');
const nationalIdSchema = z.string().regex(/^\d{15}$/, '15 digits required');
const fileDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required');
const fileTimeSchema = z
  .string()
  .regex(/^\d{4}$/, 'HHMM (24h) required')
  .refine(
    (s) => {
      const hh = parseInt(s.slice(0, 2), 10);
      const mm = parseInt(s.slice(2, 4), 10);
      return hh >= 0 && hh < 24 && mm >= 0 && mm < 60;
    },
    { message: 'invalid time' },
  );
const yearMonthSchema = z.string().regex(/^\d{6}$/, 'YYYYMM required');
const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'ISO-4217 required');
const frequencySchema = z.enum(['M', 'W', 'D']);
const bankCodeSchema = z.string().min(2).max(20);
const labourCardSchema = z.string().min(1).max(32);
const routingCodeSchema = z.string().min(2).max(20);
const accountSchema = z.string().min(4).max(34); // IBAN ceiling
const nonNegativeFloat = z.coerce.number().nonnegative().finite();
const nonNegativeInt = z.coerce.number().int().nonnegative().finite();

// ───────────────────────────────────────────────────────────────────
// Result types
// ───────────────────────────────────────────────────────────────────

export interface SifHeader {
  employerId: string;
  fileCreationDate: Date;
  fileCreationTime: string; // HHMM, kept as string for fidelity
  bankSponsorCode: string;
  salaryYearMonth: string; // YYYYMM
  currency: string; // ISO-4217 alpha
}

export interface SifSalaryRow {
  /** SRR index in source file, 1-based after EDR. Stable identifier for diagnostics. */
  rowNumber: number;
  nationalId: string; // 15 digits
  labourCardNumber: string;
  routingCode: string;
  accountNumber: string;
  salaryFrequency: 'M' | 'W' | 'D';
  numberOfWorkingDays: number;
  fixedSalary: number;
  variableSalary: number;
  totalSalary: number;
  /** sha256 of the raw SRR line — recorded on the resulting PayrollIntent for non-repudiation. */
  lineHash: string;
}

export interface SifTrailer {
  recordCount: number; // expected count of SRR rows
  totalSalary: number; // expected sum of SRR.totalSalary
}

export interface ParsedSif {
  header: SifHeader;
  rows: SifSalaryRow[];
  trailer: SifTrailer;
  /** sha256 of the whole file — keyed onto PayrollCycle.fileFingerprint (UNIQUE). */
  fileFingerprint: string;
  /** Source size in bytes — used by the controller for upload-size auditing. */
  byteLength: number;
}

// ───────────────────────────────────────────────────────────────────
// Error type
// ───────────────────────────────────────────────────────────────────

export type WpsParserErrorCode =
  | 'EMPTY_FILE'
  | 'MISSING_EDR'
  | 'MISSING_TRR'
  | 'MULTIPLE_EDR'
  | 'MULTIPLE_TRR'
  | 'UNKNOWN_RECORD_TYPE'
  | 'EDR_FIELD_COUNT'
  | 'SRR_FIELD_COUNT'
  | 'TRR_FIELD_COUNT'
  | 'EDR_FIELD_INVALID'
  | 'SRR_FIELD_INVALID'
  | 'TRR_FIELD_INVALID'
  | 'SRR_TOTAL_MISMATCH'
  | 'COUNT_MISMATCH'
  | 'CHECKSUM_MISMATCH'
  | 'DUPLICATE_NATIONAL_ID';

export class WpsParserError extends Error {
  constructor(
    public readonly code: WpsParserErrorCode,
    message: string,
    public readonly context: Record<string, unknown> = {},
  ) {
    super(`${code}: ${message}`);
    this.name = 'WpsParserError';
  }
}

// ───────────────────────────────────────────────────────────────────
// Tolerances
// ───────────────────────────────────────────────────────────────────

/**
 * The TRR totalSalary is the AED sum to two decimals. Floats accumulate
 * rounding error — a tenant with 5,000 employees can drift by a few
 * fils across the sum. 0.01 AED (one fils) is the right precision: we
 * insist on cent-correctness without rejecting files for IEEE-754 noise.
 */
const TRAILER_TOLERANCE_AED = 0.01;

/**
 * The SRR totalSalary should equal fixedSalary + variableSalary. Same
 * tolerance.
 */
const SRR_INTERNAL_TOLERANCE_AED = 0.01;

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

function splitLines(text: string): string[] {
  // Accept CRLF / LF / CR — UAE bank-side tooling has been seen
  // producing all three. Trim trailing whitespace on each line; drop
  // pure-whitespace lines so a trailing newline doesn't get treated as
  // an empty record.
  return text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function fieldFail(
  code: WpsParserErrorCode,
  ctx: Record<string, unknown>,
  err: z.ZodError,
): WpsParserError {
  const flat = err.errors.map((e) => ({
    field: e.path.join('.'),
    message: e.message,
  }));
  return new WpsParserError(code, flat.map((f) => `${f.field}: ${f.message}`).join('; '), {
    ...ctx,
    issues: flat,
  });
}

// ───────────────────────────────────────────────────────────────────
// Per-record parsers
// ───────────────────────────────────────────────────────────────────

function parseEdr(fields: string[], lineNo: number): SifHeader {
  // EDR | employerId | fileDate | fileTime | bankSponsorCode | salaryYearMonth | currency
  if (fields.length !== 7) {
    throw new WpsParserError('EDR_FIELD_COUNT', `expected 7 fields, got ${fields.length}`, {
      line: lineNo,
      fieldCount: fields.length,
    });
  }
  const schema = z.object({
    employerId: employerIdSchema,
    fileCreationDate: fileDateSchema,
    fileCreationTime: fileTimeSchema,
    bankSponsorCode: bankCodeSchema,
    salaryYearMonth: yearMonthSchema,
    currency: currencySchema,
  });
  const parsed = schema.safeParse({
    employerId: fields[1],
    fileCreationDate: fields[2],
    fileCreationTime: fields[3],
    bankSponsorCode: fields[4],
    salaryYearMonth: fields[5],
    currency: fields[6],
  });
  if (!parsed.success) {
    throw fieldFail('EDR_FIELD_INVALID', { line: lineNo }, parsed.error);
  }
  return {
    employerId: parsed.data.employerId,
    fileCreationDate: new Date(`${parsed.data.fileCreationDate}T00:00:00Z`),
    fileCreationTime: parsed.data.fileCreationTime,
    bankSponsorCode: parsed.data.bankSponsorCode,
    salaryYearMonth: parsed.data.salaryYearMonth,
    currency: parsed.data.currency,
  };
}

function parseSrr(rawLine: string, fields: string[], rowNumber: number, lineNo: number): SifSalaryRow {
  // SRR | nationalId | labourCard | routingCode | accountNo | freq | days | fixed | variable | total
  if (fields.length !== 10) {
    throw new WpsParserError('SRR_FIELD_COUNT', `expected 10 fields, got ${fields.length}`, {
      line: lineNo,
      rowNumber,
      fieldCount: fields.length,
    });
  }
  const schema = z.object({
    nationalId: nationalIdSchema,
    labourCardNumber: labourCardSchema,
    routingCode: routingCodeSchema,
    accountNumber: accountSchema,
    salaryFrequency: frequencySchema,
    numberOfWorkingDays: nonNegativeInt,
    fixedSalary: nonNegativeFloat,
    variableSalary: nonNegativeFloat,
    totalSalary: nonNegativeFloat,
  });
  const parsed = schema.safeParse({
    nationalId: fields[1],
    labourCardNumber: fields[2],
    routingCode: fields[3],
    accountNumber: fields[4],
    salaryFrequency: fields[5],
    numberOfWorkingDays: fields[6],
    fixedSalary: fields[7],
    variableSalary: fields[8],
    totalSalary: fields[9],
  });
  if (!parsed.success) {
    throw fieldFail('SRR_FIELD_INVALID', { line: lineNo, rowNumber }, parsed.error);
  }
  const { fixedSalary, variableSalary, totalSalary } = parsed.data;
  const reconstructed = fixedSalary + variableSalary;
  if (Math.abs(reconstructed - totalSalary) > SRR_INTERNAL_TOLERANCE_AED) {
    throw new WpsParserError(
      'SRR_TOTAL_MISMATCH',
      `fixed + variable (${reconstructed}) does not match total (${totalSalary})`,
      {
        line: lineNo,
        rowNumber,
        nationalId: parsed.data.nationalId,
        fixedSalary,
        variableSalary,
        totalSalary,
      },
    );
  }
  return {
    rowNumber,
    nationalId: parsed.data.nationalId,
    labourCardNumber: parsed.data.labourCardNumber,
    routingCode: parsed.data.routingCode,
    accountNumber: parsed.data.accountNumber,
    salaryFrequency: parsed.data.salaryFrequency,
    numberOfWorkingDays: parsed.data.numberOfWorkingDays,
    fixedSalary,
    variableSalary,
    totalSalary,
    lineHash: sha256(rawLine),
  };
}

function parseTrr(fields: string[], lineNo: number): SifTrailer {
  // TRR | recordCount | totalSalary
  if (fields.length !== 3) {
    throw new WpsParserError('TRR_FIELD_COUNT', `expected 3 fields, got ${fields.length}`, {
      line: lineNo,
      fieldCount: fields.length,
    });
  }
  const schema = z.object({
    recordCount: nonNegativeInt,
    totalSalary: nonNegativeFloat,
  });
  const parsed = schema.safeParse({
    recordCount: fields[1],
    totalSalary: fields[2],
  });
  if (!parsed.success) {
    throw fieldFail('TRR_FIELD_INVALID', { line: lineNo }, parsed.error);
  }
  return parsed.data;
}

// ───────────────────────────────────────────────────────────────────
// Public parser entry point
// ───────────────────────────────────────────────────────────────────

export function parseSif(input: string | Buffer): ParsedSif {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  const byteLength = Buffer.byteLength(text, 'utf8');
  const fileFingerprint = sha256(text);

  const lines = splitLines(text);
  if (lines.length === 0) {
    throw new WpsParserError('EMPTY_FILE', 'file contains no non-empty lines', { byteLength });
  }

  let header: SifHeader | null = null;
  let trailer: SifTrailer | null = null;
  const rows: SifSalaryRow[] = [];
  const seenNationalIds = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNo = i + 1;
    const fields = rawLine.split(',').map((f) => f.trim());
    const recordType = fields[0];

    switch (recordType) {
      case 'EDR': {
        if (header) {
          throw new WpsParserError('MULTIPLE_EDR', 'more than one EDR found', { line: lineNo });
        }
        header = parseEdr(fields, lineNo);
        break;
      }
      case 'SRR': {
        if (!header) {
          throw new WpsParserError('MISSING_EDR', 'SRR encountered before EDR', { line: lineNo });
        }
        if (trailer) {
          throw new WpsParserError('UNKNOWN_RECORD_TYPE', 'SRR after TRR is illegal', {
            line: lineNo,
          });
        }
        const row = parseSrr(rawLine, fields, rows.length + 1, lineNo);
        if (seenNationalIds.has(row.nationalId)) {
          throw new WpsParserError(
            'DUPLICATE_NATIONAL_ID',
            `nationalId ${row.nationalId} appears more than once`,
            { line: lineNo, nationalId: row.nationalId },
          );
        }
        seenNationalIds.add(row.nationalId);
        rows.push(row);
        break;
      }
      case 'TRR': {
        if (trailer) {
          throw new WpsParserError('MULTIPLE_TRR', 'more than one TRR found', { line: lineNo });
        }
        trailer = parseTrr(fields, lineNo);
        break;
      }
      default: {
        throw new WpsParserError(
          'UNKNOWN_RECORD_TYPE',
          `unknown record type ${JSON.stringify(recordType)}`,
          { line: lineNo, recordType },
        );
      }
    }
  }

  if (!header) {
    throw new WpsParserError('MISSING_EDR', 'no EDR record found in file', {});
  }
  if (!trailer) {
    throw new WpsParserError('MISSING_TRR', 'no TRR record found in file', {});
  }

  // ─────── Checksum gates — the integrity contract ───────
  if (trailer.recordCount !== rows.length) {
    throw new WpsParserError(
      'COUNT_MISMATCH',
      `TRR recordCount=${trailer.recordCount} but found ${rows.length} SRR rows`,
      { trailerCount: trailer.recordCount, parsedCount: rows.length },
    );
  }

  const sum = rows.reduce((acc, r) => acc + r.totalSalary, 0);
  const drift = Math.abs(sum - trailer.totalSalary);
  if (drift > TRAILER_TOLERANCE_AED) {
    throw new WpsParserError(
      'CHECKSUM_MISMATCH',
      `TRR totalSalary=${trailer.totalSalary} vs parsed sum ${sum} (drift ${drift})`,
      { trailerTotal: trailer.totalSalary, parsedSum: sum, drift },
    );
  }

  logger.info('SIF parse complete', {
    employerId: header.employerId,
    rowCount: rows.length,
    totalSalary: trailer.totalSalary,
    fileFingerprint,
  });

  return { header, rows, trailer, fileFingerprint, byteLength };
}

/**
 * Convenience: derive (periodStart, periodEnd) from the EDR's
 * salaryYearMonth (YYYYMM). Used by the controller to populate
 * PayrollCycle.periodStart/periodEnd. The period is the calendar month
 * the salary is paid FOR — not the date the file was uploaded.
 */
export function deriveCyclePeriod(salaryYearMonth: string): { periodStart: Date; periodEnd: Date } {
  const year = parseInt(salaryYearMonth.slice(0, 4), 10);
  const month = parseInt(salaryYearMonth.slice(4, 6), 10);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new WpsParserError('EDR_FIELD_INVALID', `invalid salaryYearMonth ${salaryYearMonth}`, {
      salaryYearMonth,
    });
  }
  // monthIndex is 0-based in Date.UTC
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  // Last instant of the month: Date.UTC(year, month, 1) is the first
  // of the NEXT month; subtract 1 ms.
  const periodEnd = new Date(Date.UTC(year, month, 1) - 1);
  return { periodStart, periodEnd };
}
