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
    billPayment: { create: jest.fn(), update: jest.fn() },
    employeeTransaction: { create: jest.fn(), update: jest.fn() },
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
    billPayment: { create: jest.Mock; update: jest.Mock };
    employeeTransaction: { create: jest.Mock; update: jest.Mock };
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

  it('marks the bill COMPLETED immediately if the adapter returns synchronous completion', async () => {
    stubAdapter({ externalRef: 'rail-ref-sync', status: 'completed' });

    mocked.billPayment.findUnique.mockResolvedValue(null);
    mocked.__tx.employee.findUnique.mockResolvedValue({ id: 'emp-1', walletBalance: 1_000 });
    mocked.__tx.billPayment.create.mockResolvedValue(buildBillRow({ walletTransactionId: null }));
    mocked.__tx.employeeTransaction.create.mockResolvedValue({ id: 'et-1' });
    mocked.__tx.employee.update.mockResolvedValue({});
    mocked.__tx.billPayment.update.mockResolvedValue(buildBillRow());
    mocked.__tx.auditLog.create.mockResolvedValue({});
    mocked.billPayment.update.mockResolvedValue(
      buildBillRow({ externalRef: 'rail-ref-sync', status: BillPaymentStatus.COMPLETED }),
    );

    const out = await payBill({
      employeeId: 'emp-1',
      billerType: BillerType.ETISALAT,
      billerAccountRef: '0501234567',
      amount: 150,
      idempotencyKey: 'idem-sync',
    });

    expect(out.status).toBe(BillPaymentStatus.COMPLETED);
    const updCall = mocked.billPayment.update.mock.calls[0][0];
    expect(updCall.data.status).toBe(BillPaymentStatus.COMPLETED);
    expect(updCall.data.processedAt).toBeInstanceOf(Date);
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
    mocked.employeeTransaction.findUnique.mockResolvedValue(null); // no prior refund

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
    mocked.employeeTransaction.findUnique.mockResolvedValue(null);

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

  it('heals a partial prior refund (refund row exists, bill row still PENDING)', async () => {
    const pending = buildBillRow({ status: BillPaymentStatus.PENDING });
    mocked.employeeTransaction.findUnique.mockResolvedValue({ id: 'et-prior-refund' });
    mocked.billPayment.update.mockResolvedValue(
      buildBillRow({ status: BillPaymentStatus.FAILED, refundTransactionId: 'et-prior-refund' }),
    );

    const out = await refundFailedBill(pending, 'replay');

    expect(out.status).toBe(BillPaymentStatus.FAILED);
    expect(out.refundTransactionId).toBe('et-prior-refund');
    // No new tx — we only patched the bill row.
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// settleBillPayment — webhook-side
// ═══════════════════════════════════════════════════════════════════

describe('settleBillPayment', () => {
  it('marks PENDING → COMPLETED + transitions the linked wallet txn', async () => {
    const pending = buildBillRow({ status: BillPaymentStatus.PENDING });
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
