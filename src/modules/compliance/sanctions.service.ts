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

/**
 * Explicit screening outcome (TASK-016). The old boolean `hit` conflated
 * "screened clear" with "could not screen", so a missing/empty/stale list
 * or an un-representable name silently read as clear. These four states
 * are disjoint and a clearance is the ONLY one that may gate activation.
 *
 *   VERIFIED_CLEAR       — screened against fresh, sufficiently-current data
 *                          for the full required source set, no match.
 *   POSSIBLE_MATCH       — exact normalised-name match, no DOB corroboration
 *                          (a namesake may collide) → authorised review.
 *   CONFIRMED_MATCH      — normalised-name AND date-of-birth match.
 *   SCREENING_UNAVAILABLE — screening could not be performed reliably
 *                          (list missing / empty / stale, name not
 *                          representable by this matcher, or an error).
 */
export type ScreeningStatus =
  | 'VERIFIED_CLEAR'
  | 'POSSIBLE_MATCH'
  | 'CONFIRMED_MATCH'
  | 'SCREENING_UNAVAILABLE';

export interface ScreeningResult {
  status: ScreeningStatus;
  snapshotId?: string;
  /** Machine code for why screening was UNAVAILABLE — never PII. */
  unavailableReason?: string;
  evidence?: Record<string, unknown>;
}

export const isSanctionsClear = (r: ScreeningResult): boolean => r.status === 'VERIFIED_CLEAR';
export const isSanctionsMatch = (r: ScreeningResult): boolean =>
  r.status === 'POSSIBLE_MATCH' || r.status === 'CONFIRMED_MATCH';

/**
 * A screenable identity requires a name the ASCII-fold matcher can
 * actually evaluate. A missing name, or a name carrying non-Latin letters
 * (e.g. Arabic script) that the current normaliser cannot transliterate,
 * is NOT cleared — it is UNAVAILABLE. Full Arabic / transliteration
 * matching needs a dedicated provider (reported BLOCKED); until then such
 * names fail closed rather than silently bypass.
 */
export function classifyNameForScreening(name: string): {
  normalised: string;
  evaluable: boolean;
  reason?: string;
} {
  if (!name || !name.trim()) return { normalised: '', evaluable: false, reason: 'name_missing' };
  const stripped = name.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  // A letter (\p{L}) that is not a basic Latin a–z/A–Z letter → a script
  // this matcher cannot represent. Deterministic and explainable.
  if (/[^\P{L}a-zA-Z]/u.test(stripped)) {
    return { normalised: normaliseName(name), evaluable: false, reason: 'unsupported_script' };
  }
  const normalised = normaliseName(name);
  if (!normalised) return { normalised, evaluable: false, reason: 'name_unrepresentable' };
  return { normalised, evaluable: true };
}

/** Snapshot must have been ingested within this window to count as current. */
export const SANCTIONS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * VERIFIED_CLEAR requires fresh coverage of EVERY source in this set. It
 * is intentionally the full enumerated list: a clearance that silently
 * skips a source it has no data for is exactly the fail-open this task
 * removes. Tune only with compliance sign-off.
 */
export const REQUIRED_SANCTIONS_SOURCES: readonly SanctionsListSource[] =
  Object.values(SanctionsListSource);

/**
 * Screen one identity. Fails CLOSED: it returns VERIFIED_CLEAR ONLY when
 * every required source has a non-empty snapshot ingested inside
 * SANCTIONS_MAX_AGE_MS and none matches. Missing / empty / stale data, an
 * un-representable name, or any error yields SCREENING_UNAVAILABLE — never
 * a clearance. A normalised-name match is POSSIBLE_MATCH, upgraded to
 * CONFIRMED_MATCH when the subject's date of birth also matches.
 */
export async function screenIdentityAgainstSanctions(
  input: ScreeningInput,
): Promise<ScreeningResult> {
  const { normalised, evaluable, reason } = classifyNameForScreening(input.fullName);
  if (!evaluable) return { status: 'SCREENING_UNAVAILABLE', unavailableReason: reason };

  try {
    const now = Date.now();
    const freshSnapshots: Array<{ source: SanctionsListSource; id: string; publishedAt: Date }> = [];
    for (const source of REQUIRED_SANCTIONS_SOURCES) {
      const latest = await prisma.sanctionsListSnapshot.findFirst({
        where: { source },
        orderBy: { ingestedAt: 'desc' },
      });
      if (!latest) return { status: 'SCREENING_UNAVAILABLE', unavailableReason: 'list_missing' };
      if (latest.entryCount <= 0) return { status: 'SCREENING_UNAVAILABLE', unavailableReason: 'list_empty' };
      if (now - latest.ingestedAt.getTime() > SANCTIONS_MAX_AGE_MS) {
        return { status: 'SCREENING_UNAVAILABLE', unavailableReason: 'list_stale' };
      }
      freshSnapshots.push({ source, id: latest.id, publishedAt: latest.publishedAt });
    }

    for (const snap of freshSnapshots) {
      const candidates = await prisma.sanctionsListEntry.findMany({
        where: { snapshotId: snap.id, normalisedName: normalised },
      });
      if (candidates.length === 0) continue;

      let match = candidates[0];
      let dobCorroborated = false;
      if (input.dateOfBirth) {
        const dobMatch = candidates.find(
          (c) =>
            c.dateOfBirth &&
            c.dateOfBirth.toISOString().slice(0, 10) === input.dateOfBirth!.toISOString().slice(0, 10),
        );
        if (dobMatch) {
          match = dobMatch;
          dobCorroborated = true;
        }
      }

      return {
        status: dobCorroborated ? 'CONFIRMED_MATCH' : 'POSSIBLE_MATCH',
        snapshotId: snap.id,
        evidence: {
          source: snap.source,
          matchType: dobCorroborated ? 'name_and_dob' : 'name_only',
          snapshotPublishedAt: snap.publishedAt.toISOString(),
          matchedExternalRef: match.externalRef,
          matchedFullName: match.fullName,
          matchedDateOfBirth: match.dateOfBirth?.toISOString().slice(0, 10) ?? null,
          matchedNationality: match.nationality,
          subjectNormalisedName: normalised,
          candidateCount: candidates.length,
        },
      };
    }

    // Fresh coverage of every required source, no match: the only clearance.
    return { status: 'VERIFIED_CLEAR' };
  } catch (err) {
    // A screening failure must never read as clear. Reason only — no PII.
    logger.error('sanctions screening failed — treating as unavailable', {
      error: (err as Error).message,
    });
    return { status: 'SCREENING_UNAVAILABLE', unavailableReason: 'screening_error' };
  }
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
    // Only a POSSIBLE/CONFIRMED match opens an incident. SCREENING_UNAVAILABLE
    // (no fresh data, un-representable name) is a monitoring gap, not a
    // clearance and not a hit — it is surfaced via logs/metrics, never by
    // silently treating the employee as clear.
    if (!isSanctionsMatch(screening)) continue;

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
