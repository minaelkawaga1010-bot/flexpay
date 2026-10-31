/**
 * TASK-011 — MoneyHash remittance settlement / refund integrity (unit).
 *
 * Exercises the remittance lifecycle (confirm / fail) and the send()
 * initiation flow at the service level, with Prisma and the advisory
 * lock mocked at the module boundary (the pattern in
 * tests/bill-payment.test.ts). The real-PostgreSQL concurrency and
 * lock-ordering proofs live in tests/e2e/remittance-integrity.e2e.test.ts.
 *
 * What we assert here — invariants, not just labels:
 *   • every status decision is taken on the row re-read by id under the
 *     WALLET_DEBIT advisory lock (not the caller's stale snapshot);
 *   • a COMPLETED remittance is NEVER refunded on a later failure /
 *     reversal — the event is audited as a conflict, no row or wallet
 *     changes;
 *   • a genuine failure on a PENDING remittance credits the full debit
 *     back exactly once (append-only REFUND row, unique key);
 *   • send() reserves (guarded debit) PENDING before anything leaves;
 *     a provider-refused submission is refunded, an ambiguous one is
 *     held PENDING and audited (never assumed failed);
 *   • the client idempotency key admits at most one remittance.
 */

jest.mock('@config/env', () => ({
  env: {
    NODE_ENV: 'production',
    REMITTANCE_FX_SPREAD: 0.005,
    REMITTANCE_FEE_PERCENT: 0.006,
    MONEYHASH_API_BASE: 'https://api.moneyhash.io/v1',
    MONEYHASH_API_KEY: '',
  },
  isProd: true,
  isTest: false,
}));

jest.mock('@shared/utils/advisory-lock', () => ({
  acquireWorkerLockScoped: jest.fn().mockResolvedValue(undefined),
  LockScope: { WALLET_DEBIT: 3 },
}));

jest.mock('@config/prisma', () => {
  const tx = {
    employee: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    employeeTransaction: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  return {
    prisma: {
      employeeTransaction: { update: jest.fn() },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  };
});

import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { prisma } from '@config/prisma';
import { acquireWorkerLockScoped, LockScope } from '@shared/utils/advisory-lock';
import { AppError } from '@shared/utils/errors';
import {
  confirmRemittance,
  failRemittance,
  refundIdempotencyKey,
} from '../src/modules/remittance/remittance-lifecycle';
import { moneyHashService } from '../src/modules/remittance/moneyhash.service';
import {
  remittanceService,
  classifySubmissionOutcome,
  submissionDefinitelyRejected,
} from '../src/modules/remittance/remittance.service';
// NOTE: send() calls classifySubmissionOutcome via its module-local binding,
// so the VERIFIED_REJECTION branch cannot be driven from a jest spy on the
// export. The empty DOCUMENTED_NON_EXECUTION table keeps it dormant by
// design; the authoritative-evidence refund path is the signed webhook
// (failRemittance), covered above. The classifier itself is unit-tested below.

const mocked = prisma as unknown as {
  employeeTransaction: { update: jest.Mock };
  auditLog: { create: jest.Mock };
  $transaction: jest.Mock;
  __tx: {
    employee: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    employeeTransaction: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    auditLog: { create: jest.Mock };
  };
};

const lock = acquireWorkerLockScoped as jest.Mock;

const BENEFICIARY = { name: 'Beneficiary One', bankAccount: '00012345', swiftCode: 'ABCDAEAA' };

function remittanceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rem-1',
    employeeId: 'emp-1',
    type: TransactionType.REMITTANCE,
    amount: 500,
    fee: 3,
    totalAmount: 503,
    currency: 'EGP',
    status: TransactionStatus.PENDING,
    reference: 'rem_abc',
    description: 'Remittance to Beneficiary One (EGP)',
    processedAt: null,
    idempotencyKey: null,
    ...overrides,
  };
}

/**
 * Drive the locked re-read: findUnique by `id` returns the current row,
 * findUnique by `idempotencyKey` returns the refund row (default none).
 */
function givenRow(row: Record<string, unknown>, refund: unknown = null): void {
  mocked.__tx.employeeTransaction.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
    where.id !== undefined ? row : refund,
  );
}

function lastAudit(): any {
  const calls = mocked.__tx.auditLog.create.mock.calls;
  return calls[calls.length - 1]?.[0]?.data;
}

beforeEach(() => {
  jest.clearAllMocks();
  lock.mockResolvedValue(undefined);
  mocked.__tx.employeeTransaction.findUnique.mockResolvedValue(null);
  mocked.__tx.employeeTransaction.update.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));
  mocked.__tx.employeeTransaction.create.mockImplementation(async ({ data }: any) => ({ id: 'refund-created', ...data }));
  mocked.__tx.employee.update.mockResolvedValue({});
  mocked.__tx.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
  mocked.__tx.employee.updateMany.mockResolvedValue({ count: 1 });
  mocked.__tx.auditLog.create.mockResolvedValue({});
});

// ═══════════════════════════════════════════════════════════════════
// refundIdempotencyKey (pure)
// ═══════════════════════════════════════════════════════════════════

describe('refundIdempotencyKey', () => {
  it('namespaces the refund by the original reference', () => {
    expect(refundIdempotencyKey('rem_abc')).toBe('moneyhash:refund:rem_abc');
  });
});

// ═══════════════════════════════════════════════════════════════════
// classifySubmissionOutcome (TASK-012) — nothing is definitive without
// an explicitly documented MoneyHash classification (table is empty)
// ═══════════════════════════════════════════════════════════════════

describe('classifySubmissionOutcome', () => {
  // TASK-012 §4: a 4xx never proves the transfer did not execute.
  it.each([400, 401, 403, 404, 422])('HTTP %d is AMBIGUOUS, not a rejection', (status) => {
    expect(classifySubmissionOutcome({ response: { status } })).toBe('AMBIGUOUS');
  });

  // TASK-012 §3: generic 5xx is ambiguous.
  it.each([408, 429, 500, 502, 503, 504])('HTTP %d is AMBIGUOUS', (status) => {
    expect(classifySubmissionOutcome({ response: { status } })).toBe('AMBIGUOUS');
  });

  // TASK-012 §3: connection refusals and DNS failures are NOW ambiguous
  // (they were treated as definitive before TASK-012).
  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT'])(
    'transport error %s is AMBIGUOUS',
    (code) => {
      expect(classifySubmissionOutcome({ code })).toBe('AMBIGUOUS');
    },
  );

  it('an unrecognised error is AMBIGUOUS', () => {
    expect(classifySubmissionOutcome(new Error('socket hang up'))).toBe('AMBIGUOUS');
    expect(classifySubmissionOutcome(undefined)).toBe('AMBIGUOUS');
    expect(classifySubmissionOutcome({})).toBe('AMBIGUOUS');
  });

  it('submissionDefinitelyRejected (deprecated) returns false for every non-documented outcome', () => {
    for (const err of [{ response: { status: 422 } }, { code: 'ECONNREFUSED' }, new Error('x')]) {
      expect(submissionDefinitelyRejected(err)).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// confirmRemittance
// ═══════════════════════════════════════════════════════════════════

describe('confirmRemittance', () => {
  it('PENDING → COMPLETED: locks, re-reads by id, writes the audit — no refund, no wallet move', async () => {
    const row = remittanceRow();
    givenRow(row);

    const result = await confirmRemittance('rem-1', 'emp-1', { transferId: 'mh-1', providerReference: 'p1', event: 'succeeded' }, 'webhook:moneyhash');

    expect(lock).toHaveBeenCalledWith(expect.anything(), 'emp-1', LockScope.WALLET_DEBIT);
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.__tx.employeeTransaction.findUnique.mock.invocationCallOrder[0],
    );
    expect(mocked.__tx.employeeTransaction.findUnique).toHaveBeenNthCalledWith(1, { where: { id: 'rem-1' } });
    expect(mocked.__tx.employeeTransaction.update).toHaveBeenCalledWith({
      where: { id: 'rem-1' },
      data: { status: TransactionStatus.COMPLETED, processedAt: expect.any(Date) },
    });
    expect(mocked.__tx.employee.update).not.toHaveBeenCalled();
    expect(mocked.__tx.employeeTransaction.create).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ action: 'REMITTANCE_COMPLETED', resourceId: 'rem-1' });
    expect(result.status).toBe(TransactionStatus.COMPLETED);
  });

  it('already COMPLETED: idempotent no-op, no second audit', async () => {
    givenRow(remittanceRow({ status: TransactionStatus.COMPLETED }));

    await confirmRemittance('rem-1', 'emp-1', { transferId: 'mh-1', event: 'succeeded' }, 'webhook:moneyhash');

    expect(mocked.__tx.employeeTransaction.update).not.toHaveBeenCalled();
    expect(mocked.__tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('success after FAILED+refund: conflict audited, never re-completed (no re-debit)', async () => {
    givenRow(remittanceRow({ status: TransactionStatus.FAILED }), { id: 'refund-1' });

    await confirmRemittance('rem-1', 'emp-1', { transferId: 'mh-1', event: 'succeeded' }, 'webhook:moneyhash');

    expect(mocked.__tx.employeeTransaction.update).not.toHaveBeenCalled();
    expect(mocked.__tx.employee.update).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({
      action: 'REMITTANCE_SUCCESS_AFTER_FAILURE_CONFLICT',
      metadata: expect.objectContaining({ currentStatus: TransactionStatus.FAILED, refundIssued: true, detectedUnderLock: true }),
    });
  });

  it('still PENDING but a refund row already exists: conflict, never completed (no completed-and-refunded)', async () => {
    // A partial earlier state — a refund was recorded while the row stayed
    // PENDING. A success must NOT complete it, or it would be both.
    givenRow(remittanceRow({ status: TransactionStatus.PENDING }), { id: 'refund-partial' });

    const result = await confirmRemittance('rem-1', 'emp-1', { transferId: 'mh-1', event: 'succeeded' }, 'webhook:moneyhash');

    expect(mocked.__tx.employeeTransaction.update).not.toHaveBeenCalled();
    expect(result.status).toBe(TransactionStatus.PENDING);
    expect(lastAudit()).toMatchObject({
      action: 'REMITTANCE_SUCCESS_AFTER_FAILURE_CONFLICT',
      metadata: expect.objectContaining({ refundIssued: true }),
    });
  });

  it('throws NotFound when the row is missing or is not a remittance', async () => {
    givenRow(remittanceRow({ type: TransactionType.CARD_PURCHASE }));
    await expect(
      confirmRemittance('rem-1', 'emp-1', { transferId: 'mh-1', event: 'succeeded' }, 'webhook:moneyhash'),
    ).rejects.toMatchObject({ status: 404 });

    mocked.__tx.employeeTransaction.findUnique.mockResolvedValue(null);
    await expect(
      confirmRemittance('rem-1', 'emp-1', { transferId: 'mh-1', event: 'succeeded' }, 'webhook:moneyhash'),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// failRemittance
// ═══════════════════════════════════════════════════════════════════

describe('failRemittance', () => {
  it.each(['failed', 'reversed'] as const)(
    'PENDING → FAILED (%s): one append-only REFUND row + exact credit-back under the lock',
    async (event) => {
      const row = remittanceRow({ totalAmount: 503, reference: 'rem_x' });
      givenRow(row);

      await failRemittance('rem-1', 'emp-1', { transferId: 'mh-9', event, failureReason: 'bank_rejected' }, 'webhook:moneyhash');

      expect(lock).toHaveBeenCalledWith(expect.anything(), 'emp-1', LockScope.WALLET_DEBIT);
      // Original FAILED, amounts untouched
      const upd = mocked.__tx.employeeTransaction.update.mock.calls[0][0];
      expect(upd).toMatchObject({ where: { id: 'rem-1' }, data: { status: TransactionStatus.FAILED } });
      expect(upd.data.amount).toBeUndefined();
      expect(upd.data.totalAmount).toBeUndefined();
      // Exactly one refund row, keyed by the original reference
      expect(mocked.__tx.employeeTransaction.create).toHaveBeenCalledTimes(1);
      const refund = mocked.__tx.employeeTransaction.create.mock.calls[0][0].data;
      expect(refund).toMatchObject({
        type: TransactionType.REFUND,
        amount: 503,
        totalAmount: 503,
        fee: 0,
        status: TransactionStatus.COMPLETED,
        idempotencyKey: 'moneyhash:refund:rem_x',
      });
      // Wallet credited the exact magnitude, once
      expect(mocked.__tx.employee.update).toHaveBeenCalledTimes(1);
      expect(mocked.__tx.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { walletBalance: { increment: 503 } },
      });
      expect(lastAudit()).toMatchObject({ action: 'REMITTANCE_FAILED_AND_REFUNDED' });
    },
  );

  it('CRITICAL: failure after COMPLETED never refunds — conflict audited, wallet untouched', async () => {
    givenRow(remittanceRow({ status: TransactionStatus.COMPLETED }));

    const result = await failRemittance('rem-1', 'emp-1', { transferId: 'mh-9', event: 'failed', failureReason: 'late_return' }, 'webhook:moneyhash');

    expect(mocked.__tx.employeeTransaction.create).not.toHaveBeenCalled();
    expect(mocked.__tx.employee.update).not.toHaveBeenCalled();
    expect(mocked.__tx.employeeTransaction.update).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({
      action: 'REMITTANCE_FAILURE_AFTER_COMPLETION_CONFLICT',
      metadata: expect.objectContaining({ currentStatus: TransactionStatus.COMPLETED, event: 'failed' }),
    });
    expect(result.status).toBe(TransactionStatus.COMPLETED);
  });

  it('already FAILED: duplicate failure is a no-op (no second credit)', async () => {
    givenRow(remittanceRow({ status: TransactionStatus.FAILED }));

    await failRemittance('rem-1', 'emp-1', { transferId: 'mh-9', event: 'failed' }, 'webhook:moneyhash');

    expect(mocked.__tx.employeeTransaction.create).not.toHaveBeenCalled();
    expect(mocked.__tx.employee.update).not.toHaveBeenCalled();
    expect(mocked.__tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('refund row already present (partial earlier state): finish FAILED, do not credit again', async () => {
    givenRow(remittanceRow({ status: TransactionStatus.PENDING, reference: 'rem_y' }), { id: 'refund-existing' });

    await failRemittance('rem-1', 'emp-1', { transferId: 'mh-9', event: 'failed' }, 'webhook:moneyhash');

    expect(mocked.__tx.employeeTransaction.update).toHaveBeenCalledWith({
      where: { id: 'rem-1' },
      data: { status: TransactionStatus.FAILED, processedAt: expect.any(Date) },
    });
    expect(mocked.__tx.employeeTransaction.create).not.toHaveBeenCalled();
    expect(mocked.__tx.employee.update).not.toHaveBeenCalled();
  });

  it('refund lookup uses the bound reference, falling back to the row id when unbound', async () => {
    givenRow(remittanceRow({ reference: null, id: 'rem-unbound' }));

    await failRemittance('rem-unbound', 'emp-1', { transferId: 'mh-9', event: 'failed' }, 'webhook:moneyhash');

    const byKey = mocked.__tx.employeeTransaction.findUnique.mock.calls.find((c) => c[0].where.idempotencyKey);
    expect(byKey[0].where.idempotencyKey).toBe('moneyhash:refund:rem-unbound');
    expect(mocked.__tx.employeeTransaction.create.mock.calls[0][0].data.idempotencyKey).toBe('moneyhash:refund:rem-unbound');
  });

  it('runs the failure path with an extended transaction timeout', async () => {
    givenRow(remittanceRow());
    await failRemittance('rem-1', 'emp-1', { transferId: 'mh-9', event: 'failed' }, 'webhook:moneyhash');
    expect(mocked.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ timeout: 30_000 }));
  });

  it('conflict audit metadata is sanitised: free-text failure reasons collapse to "unspecified"', async () => {
    givenRow(remittanceRow({ status: TransactionStatus.COMPLETED }));

    await failRemittance(
      'rem-1',
      'emp-1',
      { transferId: 'mh-9', event: 'reversed', failureReason: 'Beneficiary Ahmed, account 123, closed' },
      'webhook:moneyhash',
    );

    expect(lastAudit().metadata.failureCode).toBe('unspecified');
  });
});

// ═══════════════════════════════════════════════════════════════════
// remittanceService.send — initiation
// ═══════════════════════════════════════════════════════════════════

describe('remittanceService.send', () => {
  let createTransfer: jest.SpyInstance;

  beforeEach(() => {
    // Default: a PENDING remittance reserved by reserve(); send() binds
    // the transferId afterwards via the top-level update.
    mocked.__tx.employeeTransaction.create.mockImplementation(async ({ data }: any) => ({ id: 'rem-1', ...data }));
    mocked.employeeTransaction.update.mockResolvedValue({ id: 'rem-1' });
    createTransfer = jest.spyOn(moneyHashService, 'createTransfer');
  });

  afterEach(() => createTransfer.mockRestore());

  it('reserves PENDING with a guarded debit before anything leaves, then binds the transferId', async () => {
    createTransfer.mockResolvedValue('mh-transfer-1');

    const result = await remittanceService.send('emp-1', 500, 'EGP', BENEFICIARY, { idempotencyKey: 'quote:q1' });

    // Lock + guarded decrement happened inside the reserve transaction
    expect(lock).toHaveBeenCalledWith(expect.anything(), 'emp-1', LockScope.WALLET_DEBIT);
    const debit = mocked.__tx.employee.updateMany.mock.calls[0][0];
    expect(debit.where).toMatchObject({ id: 'emp-1', walletBalance: { gte: expect.any(Number) } });
    expect(debit.data).toEqual({ walletBalance: { decrement: expect.any(Number) } });
    // Row created PENDING, with the client key namespaced
    const created = mocked.__tx.employeeTransaction.create.mock.calls[0][0].data;
    expect(created.status).toBe(TransactionStatus.PENDING);
    expect(created.type).toBe(TransactionType.REMITTANCE);
    expect(created.idempotencyKey).toBe('moneyhash:remittance:emp-1:quote:q1');
    // TASK-018.0: the beneficiary name is NOT persisted in the description.
    expect(created.description).toBe('Remittance (EGP)');
    expect(created.description).not.toContain(BENEFICIARY.name);
    // Reserve precedes the provider call; the transferId is bound after
    expect(mocked.$transaction.mock.invocationCallOrder[0]).toBeLessThan(createTransfer.mock.invocationCallOrder[0]);
    expect(mocked.employeeTransaction.update).toHaveBeenCalledWith({ where: { id: 'rem-1' }, data: { reference: 'mh-transfer-1' } });
    expect(result.status).toBe('PENDING');
    expect(result.transferId).toBe('mh-transfer-1');
  });

  it('insufficient balance: guarded debit matches no row → no remittance, no provider call', async () => {
    mocked.__tx.employee.updateMany.mockResolvedValue({ count: 0 });

    await expect(remittanceService.send('emp-1', 500, 'EGP', BENEFICIARY)).rejects.toMatchObject({ status: 400 });
    expect(mocked.__tx.employeeTransaction.create).not.toHaveBeenCalled();
    expect(createTransfer).not.toHaveBeenCalled();
  });

  // TASK-012: no submission error is definitive today, so EVERY failed
  // submission is held PENDING — never refunded or marked FAILED.
  it.each([
    ['HTTP 422', { response: { status: 422 } }, '422'],
    ['HTTP 400', { response: { status: 400 } }, '400'],
    ['HTTP 500', { response: { status: 500 } }, '500'],
    ['HTTP 503', { response: { status: 503 } }, '503'],
    ['ECONNREFUSED', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }), 'ECONNREFUSED'],
    ['ENOTFOUND', Object.assign(new Error('dns'), { code: 'ENOTFOUND' }), 'ENOTFOUND'],
    ['EAI_AGAIN', Object.assign(new Error('dns'), { code: 'EAI_AGAIN' }), 'EAI_AGAIN'],
    ['ECONNRESET', Object.assign(new Error('reset'), { code: 'ECONNRESET' }), 'ECONNRESET'],
    ['timeout', Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }), 'ECONNABORTED'],
  ] as const)('ambiguous submission (%s): held PENDING, no refund, escalation audited', async (_label, err, errorClass) => {
    createTransfer.mockRejectedValue(err);

    const result = await remittanceService.send('emp-1', 500, 'EGP', BENEFICIARY);

    expect(result).toMatchObject({ status: 'PENDING_VERIFICATION' });
    // No failure transition, no refund, no wallet write beyond the reserve debit
    expect(mocked.__tx.employee.update).not.toHaveBeenCalled();
    expect(mocked.employeeTransaction.update).not.toHaveBeenCalled();
    expect(mocked.__tx.employeeTransaction.create.mock.calls.some((c) => c[0].data.type === TransactionType.REFUND)).toBe(false);
    const audit = mocked.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('REMITTANCE_SUBMISSION_OUTCOME_UNKNOWN');
    expect(audit.metadata).toMatchObject({ errorClass, classification: 'AMBIGUOUS', requiresReconciliation: true });
  });

  it('ambiguous submission audit carries only an error class — no payload, beneficiary, or amount', async () => {
    createTransfer.mockRejectedValue(new Error('socket hang up'));

    await remittanceService.send('emp-1', 500, 'EGP', BENEFICIARY);

    const audit = mocked.auditLog.create.mock.calls[0][0].data;
    expect(JSON.stringify(audit.metadata)).not.toContain('Beneficiary');
    expect(JSON.stringify(audit.metadata)).not.toContain('500');
    expect(audit.metadata.errorClass).toBe('unknown');
  });

  it('duplicate client key: the unique column rejects the second remittance with 409', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    mocked.__tx.employeeTransaction.create.mockRejectedValue(p2002);

    await expect(remittanceService.send('emp-1', 500, 'EGP', BENEFICIARY, { idempotencyKey: 'quote:dup' })).rejects.toMatchObject({
      status: 409,
      code: 'REMITTANCE_ALREADY_SUBMITTED',
    });
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it('a P2002 with no client key is not masked as a duplicate submission', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    mocked.__tx.employeeTransaction.create.mockRejectedValue(p2002);

    await expect(remittanceService.send('emp-1', 500, 'EGP', BENEFICIARY)).rejects.not.toMatchObject({ status: 409 });
  });
});
