import { createHash } from 'crypto';
import {
  ComplianceIncidentStatus,
  ComplianceIncidentType,
  EmployeeStatus,
  KycDocumentStatus,
  KycDocumentType,
  Prisma,
} from '@prisma/client';
import { prisma } from '@config/prisma';
import { BadRequest, NotFound } from '@shared/utils/errors';
import logger from '@shared/utils/logger';
import { screenIdentityAgainstSanctions } from './sanctions.service';

/**
 * KYC pipeline — Emirates ID extraction + structural validation +
 * sanctions screening on first verification.
 *
 * The extractor itself is pluggable: in production we will swap between
 * (a) a UAE-local OCR vendor (IDfy / Smile-ID equivalent with on-prem
 * deployment), and (b) an internal Vision model. Both must satisfy the
 * PDPL data-residency constraint (Llama-3 / Qwen tier — financial-core
 * data does not leave UAE infra). The interface is a single
 * `EmiratesIdExtractor` so we can A/B switch without rewiring callers.
 *
 * Trust ceiling:
 *   • extractorScore >= EXTRACTION_AUTO_VERIFY_THRESHOLD → status = VERIFIED
 *   • EXTRACTION_REVIEW_THRESHOLD <= score < auto-verify  → status = EXTRACTED (human review queue)
 *   • score < review threshold                            → status = REJECTED
 *
 * Pre-issuance check (structural):
 *   The Emirates ID number must match /^784-\d{4}-\d{7}-\d{1}$/ AND
 *   pass the Luhn-style check digit. The 784 prefix is the ISO 3166-1
 *   numeric for UAE — encoded into every Emirates ID issued by ICA.
 */

export const EMIRATES_ID_REGEX = /^784-\d{4}-\d{7}-\d{1}$/;
export const EXTRACTION_AUTO_VERIFY_THRESHOLD = 0.92;
export const EXTRACTION_REVIEW_THRESHOLD = 0.65;
export const EXTRACTOR_VERSION = 'eid-extractor-v0.1.0';

export interface EmiratesIdExtractionResult {
  emiratesIdNumber: string;
  fullName: string;
  dateOfBirth: Date;
  nationality: string; // ISO-3166-1 alpha-3
  documentExpiry: Date;
  score: number; // 0..1 — extractor confidence
  rawText?: string;
}

export interface EmiratesIdExtractor {
  extract(args: { imageBytes: Buffer; documentType: KycDocumentType }): Promise<EmiratesIdExtractionResult>;
}

/**
 * Stub extractor used in tests and local dev. Production wiring lives
 * in `kyc.providers.ts` (IDfy / internal vision) and is injected via
 * the env-driven factory.
 */
class StubExtractor implements EmiratesIdExtractor {
  async extract(): Promise<EmiratesIdExtractionResult> {
    throw new Error(
      'StubExtractor: production extractor not configured. Set KYC_EXTRACTOR=idfy|vision in env.',
    );
  }
}

let activeExtractor: EmiratesIdExtractor = new StubExtractor();
export function setKycExtractor(extractor: EmiratesIdExtractor): void {
  activeExtractor = extractor;
}

// ───────────────────────────────────────────────────────────────────
// Structural validation
// ───────────────────────────────────────────────────────────────────

/**
 * Validate the Emirates ID number's shape and check digit.
 *
 * Format: 784-YYYY-NNNNNNN-C where:
 *   • 784 = UAE country code (ISO 3166-1 numeric)
 *   • YYYY = year of registration
 *   • NNNNNNN = serial
 *   • C = single-digit checksum (Luhn algorithm on the preceding 14 digits)
 */
export function validateEmiratesId(eid: string): { ok: boolean; reason?: string } {
  if (!EMIRATES_ID_REGEX.test(eid)) {
    return { ok: false, reason: 'malformed_number' };
  }
  const digits = eid.replace(/-/g, '').split('').map((d) => parseInt(d, 10));
  const checksum = digits.pop()!;
  // Luhn from the right
  let sum = 0;
  for (let i = digits.length - 1, doubled = true; i >= 0; i--, doubled = !doubled) {
    let v = digits[i];
    if (doubled) {
      v *= 2;
      if (v > 9) v -= 9;
    }
    sum += v;
  }
  const expected = (10 - (sum % 10)) % 10;
  if (expected !== checksum) return { ok: false, reason: 'checksum_mismatch' };
  return { ok: true };
}

// ───────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────

export interface SubmitKycDocumentArgs {
  employeeId: string;
  documentType: KycDocumentType;
  storageUri: string;
  imageBytes: Buffer; // for hashing only; the bytes themselves live in object storage
}

/**
 * Submit a KYC document for processing.
 *
 * Steps:
 *   1. Hash the image bytes (non-repudiation; uniqueness gates re-uploads).
 *   2. Persist a KycDocument row in PENDING_OCR.
 *   3. Run the extractor.
 *   4. Validate the Emirates ID number structurally (where applicable).
 *   5. Sanctions-screen the extracted identity.
 *   6. Atomic commit: update KycDocument + Employee.status + (maybe)
 *      ComplianceIncident, all in one transaction so an extraction
 *      success never leaves the row in an in-between state.
 *
 * Idempotency: the unique index on (imageHash) means the same bytes
 * uploaded twice will fail at step (2) — we surface that as 409
 * Conflict to the client.
 */
export async function submitKycDocument(args: SubmitKycDocumentArgs) {
  const imageHash = createHash('sha256').update(args.imageBytes).digest('hex');

  const employee = await prisma.employee.findUnique({
    where: { id: args.employeeId },
    select: { id: true, status: true, fullName: true },
  });
  if (!employee) throw NotFound('Employee not found');

  // Step 1 + 2 — persist the document row.
  const existing = await prisma.kycDocument.findUnique({ where: { imageHash } });
  if (existing) {
    throw BadRequest('Document already submitted', {
      kycDocumentId: existing.id,
      status: existing.status,
    });
  }

  const doc = await prisma.kycDocument.create({
    data: {
      employeeId: args.employeeId,
      type: args.documentType,
      status: KycDocumentStatus.PENDING_OCR,
      storageUri: args.storageUri,
      imageHash,
    },
  });

  // Step 3 — extract.
  let extracted: EmiratesIdExtractionResult;
  try {
    extracted = await activeExtractor.extract({
      imageBytes: args.imageBytes,
      documentType: args.documentType,
    });
  } catch (err) {
    await prisma.kycDocument.update({
      where: { id: doc.id },
      data: {
        status: KycDocumentStatus.REJECTED,
        rejectionReason: `extractor_failed: ${(err as Error).message}`,
        extractorVersion: EXTRACTOR_VERSION,
      },
    });
    throw err;
  }

  // Step 4 — structural validation for ID-class documents.
  let structuralOk = true;
  let rejectionReason: string | undefined;
  if (
    args.documentType === KycDocumentType.EMIRATES_ID_FRONT ||
    args.documentType === KycDocumentType.EMIRATES_ID_BACK
  ) {
    const validation = validateEmiratesId(extracted.emiratesIdNumber);
    if (!validation.ok) {
      structuralOk = false;
      rejectionReason = `emirates_id_${validation.reason}`;
    }
  }

  // Step 5 — sanctions screening (runs against the latest snapshot).
  const screening = await screenIdentityAgainstSanctions({
    fullName: extracted.fullName,
    dateOfBirth: extracted.dateOfBirth,
    nationality: extracted.nationality,
  });

  // Step 6 — atomic commit. Either the doc gets its final status AND
  // (optional) the employee transitions to ACTIVE AND (optional) the
  // sanctions incident is opened, OR none of these. No half-state.
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    let finalStatus: KycDocumentStatus;
    if (!structuralOk) {
      finalStatus = KycDocumentStatus.REJECTED;
    } else if (extracted.score >= EXTRACTION_AUTO_VERIFY_THRESHOLD) {
      finalStatus = KycDocumentStatus.VERIFIED;
    } else if (extracted.score >= EXTRACTION_REVIEW_THRESHOLD) {
      finalStatus = KycDocumentStatus.EXTRACTED; // human review
    } else {
      finalStatus = KycDocumentStatus.REJECTED;
      rejectionReason = rejectionReason ?? 'extractor_score_below_threshold';
    }

    const updatedDoc = await tx.kycDocument.update({
      where: { id: doc.id },
      data: {
        status: finalStatus,
        emiratesIdNumber: extracted.emiratesIdNumber,
        fullName: extracted.fullName,
        dateOfBirth: extracted.dateOfBirth,
        nationality: extracted.nationality,
        documentExpiry: extracted.documentExpiry,
        extractorVersion: EXTRACTOR_VERSION,
        extractorScore: extracted.score,
        rejectionReason,
      },
    });

    // Promote employee on the *primary* identity document only — back
    // sides, selfies, etc. don't gate the status transition.
    if (
      finalStatus === KycDocumentStatus.VERIFIED &&
      args.documentType === KycDocumentType.EMIRATES_ID_FRONT &&
      employee.status === EmployeeStatus.PENDING_KYC &&
      !screening.hit
    ) {
      await tx.employee.update({
        where: { id: employee.id },
        data: {
          status: EmployeeStatus.ACTIVE,
          kycVerifiedAt: new Date(),
          fullName: extracted.fullName, // canonicalise to extracted name
        },
      });
    }

    // Sanctions hit at KYC time = open SANCTIONS_HIT incident
    // (severity 5) and force-suspend the account. The block on
    // reserveAdvance will then fire on every future request.
    if (screening.hit) {
      await tx.complianceIncident.create({
        data: {
          employeeId: employee.id,
          type: ComplianceIncidentType.SANCTIONS_HIT,
          status: ComplianceIncidentStatus.OPEN,
          severity: 5,
          evidence: screening.evidence as Prisma.InputJsonValue,
          sanctionsListSnapshotId: screening.snapshotId,
        },
      });
      await tx.employee.update({
        where: { id: employee.id },
        data: { status: EmployeeStatus.BLOCKED },
      });
      logger.warn('kyc sanctions hit', {
        employeeId: employee.id,
        kycDocumentId: updatedDoc.id,
        snapshotId: screening.snapshotId,
      });
    }

    return {
      kycDocument: updatedDoc,
      sanctionsHit: screening.hit,
    };
  });
}
