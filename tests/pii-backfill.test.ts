/**
 * PII backfill job — Day-Zero §1.2.
 *
 * Cursor-paginated, idempotent migration of plaintext employee PII into
 * the AES-256-GCM envelope columns + phone hash. Uses the real
 * pii-crypto (env key from tests/setup.ts) so we assert genuine
 * envelopes are written, and a mocked Prisma to drive pagination.
 */

jest.mock('@config/prisma', () => ({
  prisma: {
    employee: {
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
  },
}));

import { prisma } from '@config/prisma';
import { runPiiBackfill } from '../src/modules/compliance/pii-backfill';

const mocked = prisma as unknown as {
  employee: { findMany: jest.Mock; update: jest.Mock; count: jest.Mock };
};

beforeEach(() => jest.clearAllMocks());

describe('runPiiBackfill', () => {
  it('encrypts plaintext rows and skips already-enveloped ones (idempotent)', async () => {
    // Batch 1: one plaintext row + one already-encrypted row.
    mocked.employee.findMany
      .mockResolvedValueOnce([
        {
          id: 'e1',
          fullName: 'Mohammed Falasi',
          salary: 5000,
          phone: '+971500000001',
          fullNameEncrypted: null,
          salaryEncrypted: null,
          phoneHash: null,
        },
        {
          id: 'e2',
          fullName: 'Already Done',
          salary: 3000,
          phone: '+971500000002',
          fullNameEncrypted: 'v1:x:y:z',
          salaryEncrypted: 'v1:x:y:z',
          phoneHash: 'abc',
        },
      ])
      // Batch 2: empty → loop terminates.
      .mockResolvedValueOnce([]);
    mocked.employee.count.mockResolvedValue(0);

    const result = await runPiiBackfill({ batchSize: 500 });

    expect(result.scanned).toBe(2);
    expect(result.updated).toBe(1); // only e1
    expect(result.remainingUnencrypted).toBe(0);

    // e1 written with real envelopes + phone hash; e2 untouched.
    expect(mocked.employee.update).toHaveBeenCalledTimes(1);
    const call = mocked.employee.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'e1' });
    expect(call.data.fullNameEncrypted).toMatch(/^v1:/);
    expect(call.data.salaryEncrypted).toMatch(/^v1:/);
    expect(call.data.phoneHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cursor-paginates: second page uses the last id as cursor', async () => {
    mocked.employee.findMany
      .mockResolvedValueOnce([
        { id: 'a', fullName: 'A', salary: null, phone: null, fullNameEncrypted: null, salaryEncrypted: null, phoneHash: null },
      ])
      .mockResolvedValueOnce([
        { id: 'b', fullName: 'B', salary: null, phone: null, fullNameEncrypted: null, salaryEncrypted: null, phoneHash: null },
      ])
      .mockResolvedValueOnce([]);
    mocked.employee.count.mockResolvedValue(0);

    await runPiiBackfill({ batchSize: 1 });

    // 1st call: no cursor. 2nd: cursor {id:'a'} skip 1. 3rd: cursor {id:'b'}.
    const calls = mocked.employee.findMany.mock.calls.map((c) => c[0]);
    expect(calls[0].cursor).toBeUndefined();
    expect(calls[1].cursor).toEqual({ id: 'a' });
    expect(calls[1].skip).toBe(1);
    expect(calls[2].cursor).toEqual({ id: 'b' });
  });

  it('reports remaining unencrypted rows for the pre-drop reconciliation gate', async () => {
    mocked.employee.findMany.mockResolvedValueOnce([]);
    mocked.employee.count.mockResolvedValue(7);
    const result = await runPiiBackfill();
    expect(result.remainingUnencrypted).toBe(7);
  });

  it('honours maxBatches for a dry-run / canary slice', async () => {
    mocked.employee.findMany.mockResolvedValue([
      { id: 'x', fullName: 'X', salary: null, phone: null, fullNameEncrypted: null, salaryEncrypted: null, phoneHash: null },
    ]);
    mocked.employee.count.mockResolvedValue(100);
    const result = await runPiiBackfill({ batchSize: 1, maxBatches: 2 });
    expect(result.batches).toBe(2);
    expect(mocked.employee.findMany).toHaveBeenCalledTimes(2);
  });
});
