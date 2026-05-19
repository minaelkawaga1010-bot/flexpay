import { createHash } from 'crypto';
import {
  ComplianceIncidentStatus,
  ComplianceIncidentType,
  Prisma,
  SanctionsListSource,
} from '@prisma/client';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { cron } from '@shared/utils/cron';

/**
 * Sanctions screening — ingest UN / OFAC / UAE / EU / UK lists, store
 * each fetch as an immutable `SanctionsListSnapshot`, and screen
 * identities against the latest snapshot.
 *
 * Two trigger points:
 *   1. KYC-time (synchronous, called from kyc.service.ts at the moment
 *      we have a structurally-validated Emirates ID).
 *   2. Nightly batch (scheduled via CronManager at 03:00 Asia/Dubai —
 *      catches any account that became a hit *after* their KYC, e.g.
 *      a list update). The batch worker only flags; it does not auto-
 *      suspend — severity-5 confirmed hits go to ops review first.
 *
 * Matching strategy: normalised-name exact match + DOB tie-break.
 * Fuzzy matching (Levenshtein, Jaro-Winkler) is layered in later — the
 * compliance gain from fuzzy is real but it's a precision/recall
 * trade-off best calibrated against UAE-specific name variants, which
 * we will tune once the production hit data lands. For Phase 1, exact
 * normalised match with DOB tie-break is the conservative default.
 */

// ───────────────────────────────────────────────────────────────────
// Normalisation
// ───────────────────────────────────────────────────────────────────

/**
 * Canonicalise a name for matching: strip diacritics, lowercase, fold
 * whitespace runs to single spaces, trim. The same transform is applied
 * on both list ingest and screening — symmetry is the only thing that
 * matters; the exact form is not load-bearing.
 */
export function normaliseName(name: string): string {
  return name
    .normalize('NFKD')
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ───────────────────────────────────────────────────────────────────
// List ingestion
// ───────────────────────────────────────────────────────────────────

export interface RawSanctionsEntry {
  externalRef: string;
  fullName: string;
  aliases?: string[];
  dateOfBirth?: Date | null;
  nationality?: string | null;
  remarks?: string | null;
}

export interface SanctionsListFeed {
  source: SanctionsListSource;
  /** Source-side publication timestamp. */
  fetch(): Promise<{ publishedAt: Date; entries: RawSanctionsEntry[] }>;
}

/**
 * Ingest one list. Idempotent on `(source, publishedAt)` and on
 * `checksumSha256` — re-running the worker against an unchanged list
 * is a no-op rather than a duplicate snapshot row.
 */
export async function ingestSanctionsList(feed: SanctionsListFeed): Promise<{
  snapshotId: string;
  entryCount: number;
  reused: boolean;
}> {
  const { publishedAt, entries } = await feed.fetch();

  const canonical = canonicaliseList(entries);
  const checksum = createHash('sha256').update(canonical).digest('hex');

  const existing = await prisma.sanctionsListSnapshot.findUnique({
    where: { checksumSha256: checksum },
  });
  if (existing) {
    logger.info('sanctions list unchanged; reusing snapshot', {
      source: feed.source,
      snapshotId: existing.id,
      checksum,
    });
    return { snapshotId: existing.id, entryCount: existing.entryCount, reused: true };
  }

  const snapshot = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const snap = await tx.sanctionsListSnapshot.create({
      data: {
        source: feed.source,
        publishedAt,
        entryCount: entries.length,
        checksumSha256: checksum,
      },
    });

    if (entries.length > 0) {
      await tx.sanctionsListEntry.createMany({
        data: entries.map((e) => ({
          snapshotId: snap.id,
          externalRef: e.externalRef,
          fullName: e.fullName,
          aliases: e.aliases ?? [],
          dateOfBirth: e.dateOfBirth ?? null,
          nationality: e.nationality ?? null,
          remarks: e.remarks ?? null,
          normalisedName: normaliseName(e.fullName),
        })),
      });
    }

    return snap;
  }, { timeout: 120_000 });

  logger.info('sanctions list snapshot ingested', {
    source: feed.source,
    snapshotId: snapshot.id,
    entryCount: entries.length,
    checksum,
  });

  return { snapshotId: snapshot.id, entryCount: entries.length, reused: false };
}

/**
 * Canonical-order serialisation for checksum computation. Sort the
 * entries by external ref so two clients ingesting the same list
 * compute the same checksum regardless of source iteration order.
 */
function canonicaliseList(entries: RawSanctionsEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.externalRef.localeCompare(b.externalRef));
  return JSON.stringify(
    sorted.map((e) => ({
      ref: e.externalRef,
      name: normaliseName(e.fullName),
      aliases: (e.aliases ?? []).map(normaliseName).sort(),
      dob: e.dateOfBirth ? e.dateOfBirth.toISOString().slice(0, 10) : null,
      nat: e.nationality ?? null,
    })),
  );
}

// ───────────────────────────────────────────────────────────────────
// Screening
// ───────────────────────────────────────────────────────────────────

export interface ScreeningInput {
  fullName: string;
  dateOfBirth?: Date | null;
  nationality?: string | null;
}

export interface ScreeningResult {
  hit: boolean;
  snapshotId?: string;
  evidence?: Record<string, unknown>;
}

/**
 * Screen one identity against the latest snapshot of every enabled
 * source. Returns a hit on the FIRST matching source — for the
 * `evidence` payload we record which source, which entry, and the
 * snapshot id so the incident is fully reproducible.
 *
 * Tie-break: if multiple list entries share the normalised name and we
 * have a DOB on the subject, we prefer the entry whose DOB matches
 * exactly. If no DOB on the subject, name-only match is enough to
 * flag — false-positives drop into ops review rather than auto-block
 * irreversibly (the OPEN status on the incident triggers a freeze, not
 * a permanent rejection).
 */
export async function screenIdentityAgainstSanctions(
  input: ScreeningInput,
): Promise<ScreeningResult> {
  const normalised = normaliseName(input.fullName);
  if (!normalised) return { hit: false };

  const sources = Object.values(SanctionsListSource);
  for (const source of sources) {
    const latest = await prisma.sanctionsListSnapshot.findFirst({
      where: { source },
      orderBy: { ingestedAt: 'desc' },
    });
    if (!latest) continue;

    const candidates = await prisma.sanctionsListEntry.findMany({
      where: { snapshotId: latest.id, normalisedName: normalised },
    });
    if (candidates.length === 0) continue;

    // DOB tie-break.
    let match = candidates[0];
    if (input.dateOfBirth) {
      const dobMatch = candidates.find(
        (c) =>
          c.dateOfBirth && c.dateOfBirth.toISOString().slice(0, 10) ===
            input.dateOfBirth!.toISOString().slice(0, 10),
      );
      if (dobMatch) match = dobMatch;
    }

    return {
      hit: true,
      snapshotId: latest.id,
      evidence: {
        source,
        snapshotPublishedAt: latest.publishedAt.toISOString(),
        matchedExternalRef: match.externalRef,
        matchedFullName: match.fullName,
        matchedDateOfBirth: match.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        matchedNationality: match.nationality,
        subjectNormalisedName: normalised,
        candidateCount: candidates.length,
      },
    };
  }

  return { hit: false };
}

// ───────────────────────────────────────────────────────────────────
// Nightly batch screening
// ───────────────────────────────────────────────────────────────────

/**
 * Re-screen every ACTIVE employee against the latest snapshots. Run
 * nightly at 03:00 Asia/Dubai. New hits open a SANCTIONS_HIT incident
 * (severity 5) but do NOT auto-suspend — the worker's job is to
 * surface, not to act. Suspension belongs to ops, not the batch
 * scheduler, because a list-side false-positive should not silently
 * freeze a paying customer.
 */
export async function rescreenActiveEmployees(): Promise<{
  scanned: number;
  newHits: number;
}> {
  const activeEmployees = await prisma.employee.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, fullName: true },
  });

  let newHits = 0;
  for (const e of activeEmployees) {
    const screening = await screenIdentityAgainstSanctions({ fullName: e.fullName });
    if (!screening.hit) continue;

    // De-dupe: if an unresolved SANCTIONS_HIT already exists for this
    // employee, don't stack another one. The most recent screening
    // already covers the same condition.
    const open = await prisma.complianceIncident.findFirst({
      where: {
        employeeId: e.id,
        type: ComplianceIncidentType.SANCTIONS_HIT,
        status: {
          in: [
            ComplianceIncidentStatus.OPEN,
            ComplianceIncidentStatus.UNDER_REVIEW,
            ComplianceIncidentStatus.ESCALATED,
          ],
        },
      },
      select: { id: true },
    });
    if (open) continue;

    await prisma.complianceIncident.create({
      data: {
        employeeId: e.id,
        type: ComplianceIncidentType.SANCTIONS_HIT,
        status: ComplianceIncidentStatus.OPEN,
        severity: 5,
        evidence: (screening.evidence ?? {}) as Prisma.InputJsonValue,
        sanctionsListSnapshotId: screening.snapshotId,
      },
    });
    newHits += 1;
  }

  logger.info('nightly sanctions rescreen complete', {
    scanned: activeEmployees.length,
    newHits,
  });
  return { scanned: activeEmployees.length, newHits };
}

/**
 * Register the nightly worker on the centralised CronManager. The
 * sanctions list ingest itself runs on a separate schedule (02:30)
 * BEFORE the rescreen so the 03:00 pass uses the freshest snapshots —
 * see `registerComplianceCrons()`.
 */
export function registerComplianceCrons(feeds: SanctionsListFeed[]): void {
  cron.register({
    name: 'sanctions-list-ingest',
    expression: '30 2 * * *', // 02:30 Asia/Dubai
    handler: async () => {
      for (const feed of feeds) {
        try {
          await ingestSanctionsList(feed);
        } catch (err) {
          logger.error('sanctions list ingest failed', {
            source: feed.source,
            error: (err as Error).message,
          });
        }
      }
    },
  });

  cron.register({
    name: 'sanctions-rescreen-active',
    expression: '0 3 * * *', // 03:00 Asia/Dubai — after ingest
    handler: rescreenActiveEmployees,
  });
}
