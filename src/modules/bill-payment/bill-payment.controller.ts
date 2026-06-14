import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { BillerType } from '@prisma/client';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { idempotency } from '@shared/utils/idempotency';
import { prisma } from '@config/prisma';
import { BadRequest } from '@shared/utils/errors';
import { payBill } from './bill-payment.service';

/**
 * Bill-payment surface for the mobile app.
 *
 * The hard work (atomic wallet debit, advisory-lock serialisation,
 * idempotent rail dispatch, append-only refund flow on adapter
 * failure) lives in `bill-payment.service.ts`. This controller is a
 * thin Zod-validated boundary:
 *
 *   POST /bills/pay              — submit a new payment
 *   GET  /bills                  — list recent BillPayment rows
 *
 * Idempotency-Key is REQUIRED on POST /bills/pay. The middleware
 * caches the response so a retry resolves to the original outcome
 * without any service-layer work; the service itself also enforces
 * SQL-unique idempotency on the BillPayment row as a second line.
 */

const PAGE_SIZE = 20;

const payBillSchema = z.object({
  billerType: z.nativeEnum(BillerType),
  billerAccountRef: z
    .string()
    .min(3, 'Account reference is too short')
    .max(64, 'Account reference is too long')
    // CBUAE UAE-utility refs are alphanumeric + dash + dot. Reject
    // anything else at the boundary so a malformed mobile input
    // never reaches the rail.
    .regex(/^[A-Za-z0-9\-.]+$/, 'Account reference contains invalid characters'),
  amount: z
    .number()
    .positive('Amount must be positive')
    .max(100_000, 'Amount exceeds the per-bill ceiling (AED 100,000)'),
  // Client-generated UUID. Re-used across retries by the mobile
  // hook's submit-lock so a double-tap resolves to the same row.
  idempotencyKey: z.string().min(8).max(128),
  metadata: z.record(z.unknown()).optional(),
});

export class BillPaymentController {
  public readonly router = Router();

  constructor() {
    this.router.use(authenticate('employee'));

    this.router.get('/', asyncHandler(this.list));
    this.router.get('/:id', asyncHandler(this.getOne));
    this.router.post(
      '/pay',
      idempotency,
      validate(payBillSchema),
      asyncHandler(this.pay),
    );
  }

  private list = async (req: AuthRequest, res: Response): Promise<void> => {
    const limit = Math.min(Number(req.query.limit) || PAGE_SIZE, 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const [bills, total] = await Promise.all([
      prisma.billPayment.findMany({
        where: { employeeId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          billerType: true,
          billerAccountRef: true,
          amount: true,
          fee: true,
          totalAmount: true,
          currency: true,
          status: true,
          failureReason: true,
          externalRef: true,
          createdAt: true,
          processedAt: true,
        },
      }),
      prisma.billPayment.count({ where: { employeeId: req.user!.id } }),
    ]);
    res.json({ bills, pagination: { limit, offset, total } });
  };

  private getOne = async (req: AuthRequest, res: Response): Promise<void> => {
    const bill = await prisma.billPayment.findFirst({
      where: { id: req.params.id, employeeId: req.user!.id },
    });
    if (!bill) throw BadRequest('Bill payment not found');
    res.json({ bill });
  };

  private pay = async (req: AuthRequest, res: Response): Promise<void> => {
    const { billerType, billerAccountRef, amount, idempotencyKey, metadata } =
      req.body as z.infer<typeof payBillSchema>;
    const bill = await payBill({
      employeeId: req.user!.id,
      billerType,
      billerAccountRef,
      amount,
      idempotencyKey,
      metadata,
    });
    res.status(201).json({ bill });
  };
}

export const billPaymentController = new BillPaymentController();
export type { Request };
