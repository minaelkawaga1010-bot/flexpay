/**
 * Free Bills — bill-payment service tests.
 *
 * Validates the atomic wallet-debit → BillPayment + EmployeeTransaction
 * (PENDING) → rail dispatch flow, plus the append-only refund path
 * the service runs when the rail adapter rejects synchronously.
 *
 * Prisma + advisory-lock are mocked at the module boundary, matching
 * the pattern in tests/webhooks.test.ts. The biller adapter is
 * swapped in per-test via setBillerAdapter so we exercise the full
 * service path without an HTTP rail.
 */

jest.mock('@config/env', () => ({
  env: {
    NODE_ENV: 'production',
    BILLER_WEBHOOK_SECRET: 'test-biller-secret',
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
    employee: { findUnique: jest.fn(), update: jest.fn() },
    billPayment: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    employeeTransaction: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  return {
    prisma: {
      billPayment: { findUnique: jest.fn(), update: jest.fn() },
      employeeTransaction: { findUnique: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  };
});

import { BillerType, BillPaymentStatus, TransactionStatus, TransactionType } from '@prisma/client';
import { prisma } from '@config/prisma';
import { acquireWorkerLockScoped } from '@shared/utils/advisory-lock';
import {
  payBill,
  refundFailedBill,
  settleBillPayment,
  walletTxnIdempotencyKey,
  refundIdempotencyKey,
} from '../src/modules/bill-payment/bill-payment.service';
import {
  BillerAdapter,
  setBillerAdapter,
} from '../src/modules/bill-payment/biller-adapter.service';
import { computeBillerFee } from '../src/modules/bill-payment/biller-fee';

const mocked = prisma as unknown as {
  billPayment: { findUnique: jest.Mock; update: jest.Mock };
  employeeTransaction: { findUnique: jest.Mock };
  $transaction: jest.Mock;
  __tx: {
    employee: { findUnique: jest.Mock; update: jest.Mock };
    billPayment: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
    employeeTransaction: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
    auditLog: { create: jest.Mock };
  };
};

function stubAdapter(result: Partial<Awaited<ReturnType<BillerAdapter['submit']>>> = {}): jest.Mock {
  const submit = jest.fn().mockResolvedValue({
    externalRef: 'rail-ref-1',
    status: 'pending',
    ...result,
  });
  setBillerAdapter({ submit });
  return submit;
}

function buildBillRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bp-1',
    employeeId: 'emp-1',
    billerType: BillerType.DEWA,
    billerAccountRef: 'DEWA-123',
    amount: 200,
    fee: 0,
    totalAmount: 200,
    currency: 'AED',
    status: BillPaymentStatus.PENDING,
    failureReason: null,
    externalRef: null,
    idempotencyKey: 'idem-1',
    walletTransactionId: 'et-1',
    refundTransactionId: null,
    metadata: null,
    createdAt: new Date(),
    processedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Lookups default to "nothing found" so every branch is driven
  // explicitly; clearAllMocks alone keeps stale resolved values.
  for (const lookup of [
    mocked.billPayment.findUnique,
    mocked.employeeTransaction.findUnique,
    mocked.__tx.billPayment.findUnique,
    mocked.__tx.employeeTransaction.findUnique,
  ]) {
    lookup.mockReset();
    lookup.mockResolvedValue(null);
  }
});

// ═══════════════════════════════════════════════════════════════════
// Pure fee module
// ═══════════════════════════════════════════════════════════════════

describe('computeBillerFee', () => {
  it('returns 0 for every currently-supported biller (Free Bills promise)', () => {
    for (const b of Object.values(BillerType)) {
      expect(computeBillerFee(b as BillerType, 200)).toBe(0);
    }
  });

  it('returns 0 for non-positive or non-finite amounts (defensive)', () => {
    expect(computeBillerFee(BillerType.DEWA, 0)).toBe(0);
    expect(computeBillerFee(BillerType.DEWA, -50)).toBe(0);
    expect(computeBillerFee(BillerType.DEWA, NaN)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Idempotency key namespacing
// ═══════════════════════════════════════════════════════════════════

describe('idempotency key namespacing', () => {
  it('walletTxnIdempotencyKey prefixes the bill key with bill:', () => {
    expect(walletTxnIdempotencyKey('abc')).toBe('bill:abc');
  });
  it('refundIdempotencyKey prefixes the bill key with bill:refund:', () => {
    expect(refundIdempotencyKey('abc')).toBe('bill:refund:abc');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Input validation
// ═══════════════════════════════════════════════════════════════════

describe('payBill — input validation', () => {
  it('rejects an empty billerAccountRef', async () => {
    await expect(
      payBill({
        employeeId: 'emp-1',
        billerType: BillerType.DEWA,
        billerAccountRef: '',
        amount: 100,
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a non-positive amount', async () => {
    await expect(
      payBill({
        employeeId: 'emp-1',
        billerType: BillerType.DEWA,
        billerAccountRef: 'DEWA-1',
        amount: 0,
        idempotencyKey: 'idem-2',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects above the per-bill ceiling', async () => {
    await expect(
      payBill({
        employeeId: 'emp-1',
        billerType: BillerType.DEWA,
        billerAccountRef: 'DEWA-1',
        amount: 1_000_000,
        idempotencyKey: 'idem-3',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a missing idempotency key', async () => {
    await expect(
      payBill({
        employeeId: 'emp-1',
        billerType: BillerType.DEWA,
        billerAccountRef: 'DEWA-1',
        amount: 100,
        idempotencyKey: '   ',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════════════

describe('payBill — happy path', () => {
  it('debits the wallet, creates a PENDING bill + wallet txn, dispatches to the adapter, and links the rail ref', async () => {
    const submit = stubAdapter({ externalRef: 'rail-ref-happy', status: 'pending' });

    mocked.billPayment.findUnique.mockResolvedValue(null); // no replay
    mocked.__tx.employee.findUnique.mockResolvedValue({ id: 'emp-1', walletBalance: 1_000 });
    mocked.__tx.billPayment.create.mockResolvedValue(buildBillRow({ walletTransactionId: null }));
    mocked.__tx.employeeTransaction.create.mockResolvedValue({ id: 'et-1' });
    mocked.__tx.employee.update.mockResolvedValue({});
    mocked.__tx.billPayment.update.mockResolvedValue(buildBillRow());
    mocked.__tx.auditLog.create.mockResolvedValue({});
    mocked.billPayment.update.mockResolvedValue(
      buildBillRow({ externalRef: 'rail-ref-happy' }),
    );

    const out = await payBill({
      employeeId: 'emp-1',
      billerType: BillerType.DEWA,
      billerAccountRef: 'DEWA-123',
      amount: 200,
      idempotencyKey: 'idem-happy',
    });

    expect(out.externalRef).toBe('rail-ref-happy');

    // One service tx (the second update is outside that tx).
    expect(mocked.$transaction).toHaveBeenCalledTimes(1);
    expect(acquireWorkerLockScoped).toHaveBeenCalled();

    // EmployeeTransaction recorded as a debit (negative magnitude).
    const etCreate = mocked.__tx.employeeTransaction.create.mock.calls[0][0].data;
    expect(etCreate.type).toBe(TransactionType.BILL_PAYMENT);
    expect(etCreate.amount).toBe(-200);
    expect(etCreate.totalAmount).toBe(-200);
    expect(etCreate.status).toBe(TransactionStatus.PENDING);
    expect(etCreate.idempotencyKey).toBe('bill:idem-happy');

    // Wallet decremented by totalAmount.
    expect(mocked.__tx.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { walletBalance: { increment: -200 } },
    });

    // Adapter called with the bill ref.
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        billPaymentId: 'bp-1',
        billerType: BillerType.DEWA,
        idempotencyKey: 'idem-1',
      }),
    );

    // Post-tx rail ref persisted on the bill row.
    expect(mocked.billPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'bp-1' },
        data: expect.objectContaining({ externalRef: 'rail-ref-happy' }),
      }),
    );
  });

  it('settles through the locked settlement path if the adapter returns synchronous completion', async () => {
    stubAdapter({ externalRef: 'rail-ref-sync', status: 'completed' });

    mocked.__tx.employee.findUnique.mockResolvedValue({ id: 'emp-1', walletBalance: 1_000 });
    mocked.__tx.billPayment.create.mockResolvedValue(buildBillRow({ walletTransactionId: null }));
    mocked.__tx.employeeTransaction.create.mockResolvedValue({ id: 'et-1' });
    mocked.__tx.employee.update.mockResolvedValue({});
    mocked.__tx.billPayment.update
      .mockResolvedValueOnce(buildBillRow()) // initial tx: link the wallet txn
      .mockResolvedValueOnce(buildBillRow({ externalRef: 'rail-ref-sync', status: BillPaymentStatus.COMPLETED }));
    mocked.__tx.auditLog.create.mockResolvedValue({});
    mocked.__tx.billPayment.findUnique.mockResolvedValue(buildBillRow()); // fresh PENDING under the lock
    mocked.__tx.employeeTransaction.update.mockResolvedValue({});

    const out = await payBill({
      employeeId: 'emp-1',
      billerType: BillerType.ETISALAT,
      billerAccountRef: '0501234567',
      amount: 150,
      idempotencyKey: 'idem-sync',
    });

    expect(out.status).toBe(BillPaymentStatus.COMPLETED);
    // TASK-010: settled under the lock — bill COMPLETED, wallet txn
    // COMPLETED, audited as the adapter; no status write outside it.
    expect(mocked.$transaction).toHaveBeenCalledTimes(2);
    const settleUpdate = mocked.__tx.billPayment.update.mock.calls[1][0];
    expect(settleUpdate.data).toMatchObject({ status: BillPaymentStatus.COMPLETED, externalRef: 'rail-ref-sync' });
    expect(settleUpdate.data.processedAt).toBeInstanceOf(Date);
    expect(mocked.__tx.employeeTransaction.update).toHaveBeenCalledWith({
      where: { id: 'et-1' },
      data: expect.objectContaining({ status: TransactionStatus.COMPLETED }),
    });
    expect(mocked.__tx.auditLog.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'BILL_PAYMENT_COMPLETED', actorId: 'bill-payment:adapter' }),
      }),
    );
    expect(mocked.billPayment.update).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Idempotent replay
// ═══════════════════════════════════════════════════════════════════

describe('payBill — idempotency', () => {
  it('replay of the same idempotencyKey returns the existing row WITHOUT opening a $transaction or hitting the adapter', async () => {
    const existing = buildBillRow({ status: BillPaymentStatus.PENDING });
    mocked.billPayment.findUnique.mockResolvedValue(existing);
    const submit = stubAdapter();

    const out = await payBill({
      employeeId: 'emp-1',
      billerType: BillerType.DEWA,
      billerAccountRef: 'DEWA-123',
      amount: 200,
      idempotencyKey: 'idem-1',
    });

    expect(out).toBe(existing);
    expect(mocked.$transaction).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Insufficient balance
// ═══════════════════════════════════════════════════════════════════

describe('payBill — insufficient balance', () => {
  it('refuses with 409 and does NOT call the adapter or create a bill row', async () => {
    const submit = stubAdapter();
    mocked.billPayment.findUnique.mockResolvedValue(null);
    mocked.__tx.employee.findUnique.mockResolvedValue({ id: 'emp-1', walletBalance: 10 });

    await expect(
      payBill({
        employeeId: 'emp-1',
        billerType: BillerType.DEWA,
        billerAccountRef: 'DEWA-123',
        amount: 200,
        idempotencyKey: 'idem-low',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'INSUFFICIENT_BALANCE' });

    expect(mocked.__tx.billPayment.create).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses when the employee is not found', async () => {
    stubAdapter();
    mocked.billPayment.findUnique.mockResolvedValue(null);
    mocked.__tx.employee.findUnique.mockResolvedValue(null);

    await expect(
      payBill({
        employeeId: 'emp-missing',
        billerType: BillerType.DEWA,
        billerAccountRef: 'DEWA-123',
        amount: 100,
        idempotencyKey: 'idem-missing',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Synchronous adapter failure → refund flow
// ═══════════════════════════════════════════════════════════════════

describe('payBill — adapter rejection triggers append-only refund', () => {
  it('on adapter status=failed: marks bill FAILED, appends REFUND wallet txn, credits wallet back', async () => {
    stubAdapter({ status: 'failed', failureReason: 'biller_rejected' });
    mocked.billPayment.findUnique.mockResolvedValue(null);
    mocked.__tx.employee.findUnique.mockResolvedValue({ id: 'emp-1', walletBalance: 1_000 });
    mocked.__tx.billPayment.create.mockResolvedValue(buildBillRow({ walletTransactionId: null }));
    mocked.__tx.employee.update.mockResolvedValue({});
    mocked.__tx.auditLog.create.mockResolvedValue({});
    mocked.__tx.employeeTransaction.update.mockResolvedValue({});

    // Initial tx: ET create is the wallet debit row, billPayment.update
    // returns a PENDING bill. Refund tx: ET create is the refund row,
    // billPayment.update returns the FAILED bill.
    mocked.__tx.employeeTransaction.create
      .mockResolvedValueOnce({ id: 'et-1' })
      .mockResolvedValueOnce({ id: 'et-refund' });
    mocked.__tx.billPayment.update
      .mockResolvedValueOnce(
        buildBillRow({ status: BillPaymentStatus.PENDING, idempotencyKey: 'idem-fail' }),
      )
      .mockResolvedValueOnce(
        buildBillRow({
          status: BillPaymentStatus.FAILED,
          failureReason: 'biller_rejected',
          refundTransactionId: 'et-refund',
          idempotencyKey: 'idem-fail',
        }),
      );
    // Refund tx re-reads the bill under the lock: still PENDING, no refund yet.
    mocked.__tx.billPayment.findUnique.mockResolvedValue(
      buildBillRow({ status: BillPaymentStatus.PENDING, idempotencyKey: 'idem-fail' }),
    );

    const out = await payBill({
      employeeId: 'emp-1',
      billerType: BillerType.DEWA,
      billerAccountRef: 'DEWA-123',
      amount: 200,
      idempotencyKey: 'idem-fail',
    });

    expect(out.status).toBe(BillPaymentStatus.FAILED);

    // Two $transaction calls: initial debit, then refund.
    expect(mocked.$transaction).toHaveBeenCalledTimes(2);

    // Refund row appended with idempotency-namespaced key.
    const refundCalls = mocked.__tx.employeeTransaction.create.mock.calls;
    const refundCreate = refundCalls[refundCalls.length - 1][0].data;
    expect(refundCreate.type).toBe(TransactionType.REFUND);
    expect(refundCreate.amount).toBe(200); // positive credit
    expect(refundCreate.idempotencyKey).toBe('bill:refund:idem-fail');

    // Wallet credited back.
    expect(mocked.__tx.employee.update).toHaveBeenLastCalledWith({
      where: { id: 'emp-1' },
      data: { walletBalance: { increment: 200 } },
    });
  });

  it('on adapter exception: same refund flow runs', async () => {
    setBillerAdapter({
      submit: jest.fn().mockRejectedValue(new Error('network exploded')),
    });
    mocked.billPayment.findUnique.mockResolvedValue(null);
    mocked.__tx.employee.findUnique.mockResolvedValue({ id: 'emp-1', walletBalance: 1_000 });
    mocked.__tx.billPayment.create.mockResolvedValue(buildBillRow({ walletTransactionId: null }));
    mocked.__tx.employee.update.mockResolvedValue({});
    mocked.__tx.auditLog.create.mockResolvedValue({});
    mocked.__tx.employeeTransaction.update.mockResolvedValue({});

    mocked.__tx.employeeTransaction.create
      .mockResolvedValueOnce({ id: 'et-1' })
      .mockResolvedValueOnce({ id: 'et-refund' });
    mocked.__tx.billPayment.update
      .mockResolvedValueOnce(buildBillRow({ status: BillPaymentStatus.PENDING }))
      .mockResolvedValueOnce(buildBillRow({ status: BillPaymentStatus.FAILED }));
    mocked.__tx.billPayment.findUnique.mockResolvedValue(buildBillRow({ status: BillPaymentStatus.PENDING }));

    const out = await payBill({
      employeeId: 'emp-1',
      billerType: BillerType.SEWA,
      billerAccountRef: 'SEWA-A1',
      amount: 75,
      idempotencyKey: 'idem-explode',
    });

    expect(out.status).toBe(BillPaymentStatus.FAILED);
  });
});

// ═══════════════════════════════════════════════════════════════════
// refundFailedBill — idempotency guard
// ═══════════════════════════════════════════════════════════════════

describe('refundFailedBill — idempotency', () => {
  it('returns early without writes when the bill is already FAILED', async () => {
    const failed = buildBillRow({ status: BillPaymentStatus.FAILED });
    const out = await refundFailedBill(failed, 'whatever');
    expect(out).toBe(failed);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it('heals a partial prior refund under the lock (refund row exists, bill row still PENDING) — no second credit', async () => {
    const pending = buildBillRow({ status: BillPaymentStatus.PENDING });
    mocked.__tx.billPayment.findUnique.mockResolvedValue(pending);
    mocked.__tx.employeeTransaction.findUnique.mockResolvedValue({ id: 'et-prior-refund' });
    mocked.__tx.billPayment.update.mockResolvedValue(
      buildBillRow({ status: BillPaymentStatus.FAILED, refundTransactionId: 'et-prior-refund' }),
    );

    const out = await refundFailedBill(pending, 'replay');

    expect(out.status).toBe(BillPaymentStatus.FAILED);
    expect(out.refundTransactionId).toBe('et-prior-refund');
    // TASK-010: decided under the lock; only the bill row is patched.
    expect(acquireWorkerLockScoped).toHaveBeenCalled();
    expect(mocked.__tx.employeeTransaction.create).not.toHaveBeenCalled();
    expect(mocked.__tx.employee.update).not.toHaveBeenCalled();
    expect(mocked.billPayment.update).not.toHaveBeenCalled();
  });

  it('TASK-003: a refund committed while awaiting the lock is seen on the fresh row — no duplicate create', async () => {
    const pending = buildBillRow({ status: BillPaymentStatus.PENDING });
    // Caller's snapshot is PENDING, but once inside the tx (after the
    // advisory lock) the competing refund — FAILED + its REFUND row — is
    // visible on the re-read.
    mocked.__tx.billPayment.findUnique.mockResolvedValue(
      buildBillRow({ status: BillPaymentStatus.FAILED, refundTransactionId: 'et-winner' }),
    );

    const out = await refundFailedBill(pending, 'race');

    expect(mocked.$transaction).toHaveBeenCalledTimes(1);
    expect(out.status).toBe(BillPaymentStatus.FAILED);
    expect(out.refundTransactionId).toBe('et-winner');
    // Critical: no second refund row was created (no double credit), and
    // a duplicate failure writes nothing at all.
    expect(mocked.__tx.employeeTransaction.create).not.toHaveBeenCalled();
    expect(mocked.__tx.employee.update).not.toHaveBeenCalled();
    expect(mocked.__tx.billPayment.update).not.toHaveBeenCalled();
  });

  it('TASK-003: P2002 backstop resolves a unique-violation race as an idempotent no-op (not a 500)', async () => {
    const { Prisma } = jest.requireActual('@prisma/client');
    const pending = buildBillRow({ status: BillPaymentStatus.PENDING });
    mocked.__tx.billPayment.findUnique
      .mockResolvedValueOnce(pending) // first pass: still PENDING
      .mockResolvedValueOnce(buildBillRow({ status: BillPaymentStatus.FAILED, refundTransactionId: 'et-winner' }));
    mocked.__tx.employeeTransaction.update.mockResolvedValue({});
    // The insert loses the race → unique violation on bill:refund:<key>.
    mocked.__tx.employeeTransaction.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const out = await refundFailedBill(pending, 'p2002-race');

    // No throw; decided again under the lock, which sees the winner's
    // refund — and nothing is written outside the lock.
    expect(out.status).toBe(BillPaymentStatus.FAILED);
    expect(out.refundTransactionId).toBe('et-winner');
    expect(mocked.$transaction).toHaveBeenCalledTimes(2);
    expect(mocked.__tx.employee.update).not.toHaveBeenCalled();
    expect(mocked.billPayment.update).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// settleBillPayment — webhook-side
// ═══════════════════════════════════════════════════════════════════

describe('settleBillPayment', () => {
  it('marks PENDING → COMPLETED + transitions the linked wallet txn', async () => {
    const pending = buildBillRow({ status: BillPaymentStatus.PENDING });
    // In-lock re-read returns the fresh (still PENDING) row.
    mocked.__tx.billPayment.findUnique.mockResolvedValue(pending);
    mocked.__tx.employeeTransaction.update.mockResolvedValue({});
    mocked.__tx.billPayment.update.mockResolvedValue(
      buildBillRow({ status: BillPaymentStatus.COMPLETED, externalRef: 'rail-ref-x' }),
    );
    mocked.__tx.auditLog.create.mockResolvedValue({});

    const out = await settleBillPayment(pending, 'rail-ref-x');
    expect(out.status).toBe(BillPaymentStatus.COMPLETED);
    expect(mocked.__tx.employeeTransaction.update).toHaveBeenCalledWith({
      where: { id: 'et-1' },
      data: expect.objectContaining({ status: TransactionStatus.COMPLETED }),
    });
  });

  it('TASK-004: concurrent refund wins — caller snapshot PENDING but in-lock re-read is FAILED → does NOT mark COMPLETED (no phantom credit)', async () => {
    // Caller's snapshot was PENDING (passes the fast-path), but a refund
    // committed FAILED while we waited on the lock.
    const pendingSnapshot = buildBillRow({ status: BillPaymentStatus.PENDING });
    mocked.__tx.billPayment.findUnique.mockResolvedValue(
      buildBillRow({ status: BillPaymentStatus.FAILED, refundTransactionId: 'et-refund' }),
    );
    mocked.__tx.auditLog.create.mockResolvedValue({});

    const out = await settleBillPayment(pendingSnapshot, 'rail-ref-late');

    // Settle refused: no COMPLETED write, no wallet-txn transition.
    expect(out.status).toBe(BillPaymentStatus.FAILED);
    expect(mocked.__tx.billPayment.update).not.toHaveBeenCalled();
    expect(mocked.__tx.employeeTransaction.update).not.toHaveBeenCalled();
    // Conflict surfaced under the lock.
    expect(mocked.__tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BILL_PAYMENT_SUCCESS_AFTER_FAILURE_CONFLICT',
          metadata: expect.objectContaining({ detectedUnderLock: true }),
        }),
      }),
    );
  });

  it('TASK-004: concurrent settle wins — in-lock re-read already COMPLETED → idempotent no-op', async () => {
    const pendingSnapshot = buildBillRow({ status: BillPaymentStatus.PENDING });
    mocked.__tx.billPayment.findUnique.mockResolvedValue(
      buildBillRow({ status: BillPaymentStatus.COMPLETED, externalRef: 'rail-ref-x' }),
    );

    const out = await settleBillPayment(pendingSnapshot, 'rail-ref-x');
    expect(out.status).toBe(BillPaymentStatus.COMPLETED);
    expect(mocked.__tx.billPayment.update).not.toHaveBeenCalled();
    expect(mocked.__tx.employeeTransaction.update).not.toHaveBeenCalled();
  });

  it('is a no-op on replay (already COMPLETED)', async () => {
    const completed = buildBillRow({ status: BillPaymentStatus.COMPLETED });
    const out = await settleBillPayment(completed, 'rail-ref-x');
    expect(out).toBe(completed);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to auto-reconcile a success-after-failure conflict (audit only)', async () => {
    const failed = buildBillRow({ status: BillPaymentStatus.FAILED });
    const auditCreate = jest.fn().mockResolvedValue({});
    (prisma as unknown as { auditLog: { create: jest.Mock } }).auditLog = { create: auditCreate };

    const out = await settleBillPayment(failed, 'rail-ref-late');
    expect(out).toBe(failed);
    expect(mocked.$transaction).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BILL_PAYMENT_SUCCESS_AFTER_FAILURE_CONFLICT',
        }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// TASK-010 — a settled bill is never refunded
// ═══════════════════════════════════════════════════════════════════

describe('TASK-010 — no refund after settlement', () => {
  const completed = () =>
    buildBillRow({ status: BillPaymentStatus.COMPLETED, externalRef: 'rail-settled', processedAt: new Date() });

  function expectNoRefundWrites() {
    expect(mocked.__tx.employeeTransaction.update).not.toHaveBeenCalled(); // wallet txn untouched
    expect(mocked.__tx.employeeTransaction.create).not.toHaveBeenCalled(); // no REFUND row
    expect(mocked.__tx.employee.update).not.toHaveBeenCalled(); // no wallet credit
    expect(mocked.__tx.billPayment.update).not.toHaveBeenCalled(); // stays COMPLETED
    expect(mocked.billPayment.update).not.toHaveBeenCalled();
  }

  it.each([
    ['a stale PENDING snapshot (adapter path racing the webhook)', BillPaymentStatus.PENDING],
    ['the COMPLETED row itself (late webhook failure)', BillPaymentStatus.COMPLETED],
  ])('refuses to refund when the fresh row is COMPLETED, given %s', async (_label, snapshotStatus) => {
    mocked.__tx.billPayment.findUnique.mockResolvedValue(completed());
    mocked.__tx.auditLog.create.mockResolvedValue({});

    const out = await refundFailedBill(buildBillRow({ status: snapshotStatus }), 'late_failure', 'rail-late');

    expect(out.status).toBe(BillPaymentStatus.COMPLETED);
    expectNoRefundWrites();
    expect(mocked.__tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'BILL_PAYMENT_FAILURE_AFTER_SETTLEMENT_CONFLICT',
        resourceId: 'bp-1',
        metadata: {
          currentStatus: BillPaymentStatus.COMPLETED,
          settledExternalRef: 'rail-settled',
          eventExternalRef: 'rail-late',
          failureCode: 'late_failure',
          detectedUnderLock: true,
        },
      }),
    });
  });

  it('a late reversal of a settled bill is also refused (no verified reversal workflow exists)', async () => {
    mocked.__tx.billPayment.findUnique.mockResolvedValue(completed());
    mocked.__tx.auditLog.create.mockResolvedValue({});

    const out = await refundFailedBill(completed(), 'rail_reported_reversed', 'rail-settled');

    expect(out.status).toBe(BillPaymentStatus.COMPLETED);
    expectNoRefundWrites();
  });

  it('conflict evidence never carries free-text reasons', async () => {
    mocked.__tx.billPayment.findUnique.mockResolvedValue(completed());
    mocked.__tx.auditLog.create.mockResolvedValue({});

    await refundFailedBill(completed(), 'connect ECONNREFUSED 10.0.0.5:443 account=DEWA-123 user alice');

    const metadata = mocked.__tx.auditLog.create.mock.calls[0][0].data.metadata;
    expect(metadata.failureCode).toBe('unspecified');
    expect(JSON.stringify(metadata)).not.toContain('alice');
  });

  it('takes the lock before reading the fresh row', async () => {
    mocked.__tx.billPayment.findUnique.mockResolvedValue(completed());
    mocked.__tx.auditLog.create.mockResolvedValue({});

    await refundFailedBill(buildBillRow(), 'late_failure');

    expect((acquireWorkerLockScoped as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      mocked.__tx.billPayment.findUnique.mock.invocationCallOrder[0],
    );
  });

  it('refunds a genuinely failed, unsettled bill from the FRESH row', async () => {
    // A stale snapshot must not decide the amount or the wallet txn.
    const snapshot = buildBillRow({ totalAmount: 999, walletTransactionId: 'et-stale' });
    mocked.__tx.billPayment.findUnique.mockResolvedValue(buildBillRow({ totalAmount: 200, walletTransactionId: 'et-1' }));
    mocked.__tx.employeeTransaction.update.mockResolvedValue({});
    mocked.__tx.employeeTransaction.create.mockResolvedValue({ id: 'et-refund' });
    mocked.__tx.employee.update.mockResolvedValue({});
    mocked.__tx.billPayment.update.mockResolvedValue(buildBillRow({ status: BillPaymentStatus.FAILED }));
    mocked.__tx.auditLog.create.mockResolvedValue({});

    const out = await refundFailedBill(snapshot, 'rail_failed');

    expect(out.status).toBe(BillPaymentStatus.FAILED);
    expect(mocked.__tx.employeeTransaction.update).toHaveBeenCalledWith({
      where: { id: 'et-1' },
      data: expect.objectContaining({ status: TransactionStatus.FAILED }),
    });
    expect(mocked.__tx.employeeTransaction.create.mock.calls[0][0].data).toMatchObject({
      type: TransactionType.REFUND,
      amount: 200,
      idempotencyKey: 'bill:refund:idem-1',
    });
    expect(mocked.__tx.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { walletBalance: { increment: 200 } },
    });
  });

  it('a duplicate failure on a FAILED bill writes nothing', async () => {
    mocked.__tx.billPayment.findUnique.mockResolvedValue(
      buildBillRow({ status: BillPaymentStatus.FAILED, refundTransactionId: 'et-refund' }),
    );

    const out = await refundFailedBill(buildBillRow(), 'duplicate_failure_event');

    expect(out.status).toBe(BillPaymentStatus.FAILED);
    expect(mocked.__tx.billPayment.update).not.toHaveBeenCalled();
    expect(mocked.__tx.auditLog.create).not.toHaveBeenCalled();
    expect(mocked.__tx.employeeTransaction.create).not.toHaveBeenCalled();
    expect(mocked.__tx.employee.update).not.toHaveBeenCalled();
  });

  it('settle refuses a PENDING bill that already has a refund row (would be completed-and-refunded)', async () => {
    mocked.__tx.billPayment.findUnique.mockResolvedValue(buildBillRow());
    mocked.__tx.employeeTransaction.findUnique.mockResolvedValue({ id: 'et-refund' });
    mocked.__tx.auditLog.create.mockResolvedValue({});

    const out = await settleBillPayment(buildBillRow(), 'rail-late-success');

    expect(out.status).toBe(BillPaymentStatus.PENDING);
    expect(mocked.__tx.employeeTransaction.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: 'bill:refund:idem-1' },
    });
    expect(mocked.__tx.billPayment.update).not.toHaveBeenCalled();
    expect(mocked.__tx.employeeTransaction.update).not.toHaveBeenCalled();
    expect(mocked.__tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BILL_PAYMENT_SUCCESS_AFTER_FAILURE_CONFLICT',
          metadata: expect.objectContaining({ detectedUnderLock: true, refundIssued: true }),
        }),
      }),
    );
  });

  it('settle records who confirmed it', async () => {
    mocked.__tx.billPayment.findUnique.mockResolvedValue(buildBillRow());
    mocked.__tx.employeeTransaction.update.mockResolvedValue({});
    mocked.__tx.billPayment.update.mockResolvedValue(buildBillRow({ status: BillPaymentStatus.COMPLETED }));
    mocked.__tx.auditLog.create.mockResolvedValue({});

    await settleBillPayment(buildBillRow(), 'rail-ok', 'bill-payment:adapter');

    expect(mocked.__tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'BILL_PAYMENT_COMPLETED', actorId: 'bill-payment:adapter' }) }),
    );
  });

  it('adapter timeout after the rail already settled the bill: payBill returns the settled bill, no refund', async () => {
    setBillerAdapter({ submit: jest.fn().mockRejectedValue(new Error('adapter timeout')) });
    mocked.__tx.employee.findUnique.mockResolvedValue({ id: 'emp-1', walletBalance: 1_000 });
    mocked.__tx.billPayment.create.mockResolvedValue(buildBillRow({ walletTransactionId: null }));
    mocked.__tx.employeeTransaction.create.mockResolvedValueOnce({ id: 'et-1' });
    mocked.__tx.employee.update.mockResolvedValue({});
    mocked.__tx.billPayment.update.mockResolvedValueOnce(buildBillRow());
    mocked.__tx.auditLog.create.mockResolvedValue({});
    // The success webhook committed while the adapter call was timing out.
    mocked.__tx.billPayment.findUnique.mockResolvedValue(completed());

    const out = await payBill({
      employeeId: 'emp-1',
      billerType: BillerType.DEWA,
      billerAccountRef: 'DEWA-123',
      amount: 200,
      idempotencyKey: 'idem-1',
    });

    expect(out.status).toBe(BillPaymentStatus.COMPLETED);
    // Only the initial debit wrote a wallet txn / balance change.
    expect(mocked.__tx.employeeTransaction.create).toHaveBeenCalledTimes(1);
    expect(mocked.__tx.employee.update).toHaveBeenCalledTimes(1);
    expect(mocked.__tx.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { walletBalance: { increment: -200 } },
    });
  });
});
