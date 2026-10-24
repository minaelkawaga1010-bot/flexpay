/**
 * TASK-016 — sanctions screening fail-closed state machine (unit).
 *
 * Prisma and cron are mocked; these assert the decision logic directly:
 * missing / empty / stale data and un-representable (e.g. Arabic) names
 * never read as clear, a clearance requires fresh coverage of every
 * required source, and a name match is POSSIBLE unless the DOB corroborates
 * it (then CONFIRMED). Real-PostgreSQL behaviour + the KYC integration live
 * in tests/e2e/sanctions-screening.e2e.test.ts.
 */

jest.mock('@config/prisma', () => ({
  prisma: {
    sanctionsListSnapshot: { findFirst: jest.fn() },
    sanctionsListEntry: { findMany: jest.fn() },
  },
}));
jest.mock('@shared/utils/cron', () => ({ cron: { register: jest.fn() } }));

import { prisma } from '@config/prisma';
import {
  screenIdentityAgainstSanctions,
  classifyNameForScreening,
  isSanctionsClear,
  isSanctionsMatch,
  REQUIRED_SANCTIONS_SOURCES,
  SANCTIONS_MAX_AGE_MS,
} from '../src/modules/compliance/sanctions.service';

const mocked = prisma as unknown as {
  sanctionsListSnapshot: { findFirst: jest.Mock };
  sanctionsListEntry: { findMany: jest.Mock };
};

const freshSnap = (over: Record<string, unknown> = {}) => ({
  id: `snap-${Math.random().toString(16).slice(2)}`,
  source: 'UN_CONSOLIDATED',
  publishedAt: new Date(),
  ingestedAt: new Date(),
  entryCount: 10,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: every source has a fresh, non-empty snapshot and nothing matches.
  mocked.sanctionsListSnapshot.findFirst.mockImplementation(async () => freshSnap());
  mocked.sanctionsListEntry.findMany.mockResolvedValue([]);
});

// ═══════════════════════════════════════════════════════════════════
// Name evaluability (TASK-016 §8/§11)
// ═══════════════════════════════════════════════════════════════════

describe('classifyNameForScreening', () => {
  it('accepts a plain Latin name', () => {
    expect(classifyNameForScreening('John Smith')).toMatchObject({ evaluable: true, normalised: 'john smith' });
  });
  it('folds diacritics but stays evaluable', () => {
    expect(classifyNameForScreening('Álí Mohámmed')).toMatchObject({ evaluable: true });
  });
  it('treats a missing / whitespace name as NOT evaluable', () => {
    expect(classifyNameForScreening('')).toMatchObject({ evaluable: false, reason: 'name_missing' });
    expect(classifyNameForScreening('   ')).toMatchObject({ evaluable: false, reason: 'name_missing' });
  });
  it('treats an Arabic-script name as NOT evaluable (unsupported script, fails closed)', () => {
    expect(classifyNameForScreening('محمد علي')).toMatchObject({ evaluable: false, reason: 'unsupported_script' });
  });
  it('treats a mixed Latin+Arabic name as NOT evaluable', () => {
    expect(classifyNameForScreening('Mohammed محمد')).toMatchObject({ evaluable: false, reason: 'unsupported_script' });
  });
  it('treats a symbols-only name as NOT evaluable', () => {
    expect(classifyNameForScreening('!!!')).toMatchObject({ evaluable: false });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Screening states (TASK-016 §4-6)
// ═══════════════════════════════════════════════════════════════════

describe('screenIdentityAgainstSanctions — fail closed', () => {
  it('an un-representable name is SCREENING_UNAVAILABLE and never touches the data', async () => {
    const r = await screenIdentityAgainstSanctions({ fullName: 'محمد علي' });
    expect(r.status).toBe('SCREENING_UNAVAILABLE');
    expect(r.unavailableReason).toBe('unsupported_script');
    expect(mocked.sanctionsListSnapshot.findFirst).not.toHaveBeenCalled();
    expect(isSanctionsClear(r)).toBe(false);
  });

  it('a missing source list is SCREENING_UNAVAILABLE (never clear)', async () => {
    mocked.sanctionsListSnapshot.findFirst.mockResolvedValueOnce(null);
    const r = await screenIdentityAgainstSanctions({ fullName: 'John Smith' });
    expect(r).toMatchObject({ status: 'SCREENING_UNAVAILABLE', unavailableReason: 'list_missing' });
  });

  it('an empty source list is SCREENING_UNAVAILABLE', async () => {
    mocked.sanctionsListSnapshot.findFirst.mockResolvedValueOnce(freshSnap({ entryCount: 0 }));
    const r = await screenIdentityAgainstSanctions({ fullName: 'John Smith' });
    expect(r).toMatchObject({ status: 'SCREENING_UNAVAILABLE', unavailableReason: 'list_empty' });
  });

  it('a stale source list is SCREENING_UNAVAILABLE', async () => {
    const old = new Date(Date.now() - SANCTIONS_MAX_AGE_MS - 60_000);
    mocked.sanctionsListSnapshot.findFirst.mockResolvedValueOnce(freshSnap({ ingestedAt: old }));
    const r = await screenIdentityAgainstSanctions({ fullName: 'John Smith' });
    expect(r).toMatchObject({ status: 'SCREENING_UNAVAILABLE', unavailableReason: 'list_stale' });
  });

  it('a data-store error is SCREENING_UNAVAILABLE, never clear', async () => {
    mocked.sanctionsListSnapshot.findFirst.mockRejectedValueOnce(new Error('db down'));
    const r = await screenIdentityAgainstSanctions({ fullName: 'John Smith' });
    expect(r).toMatchObject({ status: 'SCREENING_UNAVAILABLE', unavailableReason: 'screening_error' });
  });
});

describe('screenIdentityAgainstSanctions — clearance requires full fresh coverage', () => {
  it('VERIFIED_CLEAR only when every required source is fresh and nothing matches', async () => {
    const r = await screenIdentityAgainstSanctions({ fullName: 'John Smith' });
    expect(r.status).toBe('VERIFIED_CLEAR');
    expect(isSanctionsClear(r)).toBe(true);
    // One freshness probe per required source.
    expect(mocked.sanctionsListSnapshot.findFirst).toHaveBeenCalledTimes(REQUIRED_SANCTIONS_SOURCES.length);
  });

  it('if ANY one source is missing, the overall result is UNAVAILABLE (not clear)', async () => {
    let call = 0;
    mocked.sanctionsListSnapshot.findFirst.mockImplementation(async () => (++call === 3 ? null : freshSnap()));
    const r = await screenIdentityAgainstSanctions({ fullName: 'John Smith' });
    expect(r.status).toBe('SCREENING_UNAVAILABLE');
  });
});

describe('screenIdentityAgainstSanctions — matches', () => {
  it('a normalised-name match without DOB corroboration is POSSIBLE_MATCH', async () => {
    mocked.sanctionsListEntry.findMany.mockResolvedValueOnce([
      { externalRef: 'x1', fullName: 'John Smith', dateOfBirth: new Date('1980-01-01'), nationality: 'USA' },
    ]);
    const r = await screenIdentityAgainstSanctions({ fullName: 'John Smith' });
    expect(r.status).toBe('POSSIBLE_MATCH');
    expect(isSanctionsMatch(r)).toBe(true);
    expect(isSanctionsClear(r)).toBe(false);
    expect((r.evidence as Record<string, unknown>).matchType).toBe('name_only');
  });

  it('a name + DOB match is CONFIRMED_MATCH', async () => {
    mocked.sanctionsListEntry.findMany.mockResolvedValueOnce([
      { externalRef: 'x1', fullName: 'John Smith', dateOfBirth: new Date('1980-01-01'), nationality: 'USA' },
    ]);
    const r = await screenIdentityAgainstSanctions({ fullName: 'John Smith', dateOfBirth: new Date('1980-01-01') });
    expect(r.status).toBe('CONFIRMED_MATCH');
    expect((r.evidence as Record<string, unknown>).matchType).toBe('name_and_dob');
  });

  it('a name match whose DOB differs stays POSSIBLE_MATCH (no false confirmation)', async () => {
    mocked.sanctionsListEntry.findMany.mockResolvedValueOnce([
      { externalRef: 'x1', fullName: 'John Smith', dateOfBirth: new Date('1980-01-01'), nationality: 'USA' },
    ]);
    const r = await screenIdentityAgainstSanctions({ fullName: 'John Smith', dateOfBirth: new Date('1999-09-09') });
    expect(r.status).toBe('POSSIBLE_MATCH');
  });
});
