import { BillerType } from '@prisma/client';
import logger from '@shared/utils/logger';

/**
 * Pluggable biller-adapter interface — the seam between FlexPay's
 * bill-payment service and the upstream rail (MoneyHash, NymCard
 * BillPay, or a direct biller integration).
 *
 * Why a free-function adapter (not a class hierarchy):
 *   • There is one adapter in production at a time (MoneyHash's UAE
 *     billers surface). The class hierarchy adds noise for a single
 *     concrete; a function-shaped seam composes with the service-layer
 *     free-function pattern used everywhere else in this codebase.
 *   • Tests can swap in a stub via `setBillerAdapter` without monkey-
 *     patching imports.
 *
 * Submission contract:
 *   • The adapter is called AFTER the wallet has been debited and the
 *     bill_payments / EmployeeTransaction rows have been written in
 *     PENDING. A synchronous adapter failure surfaces back to the
 *     service which then issues a refund (append-only) inside a fresh
 *     transaction. The rail never sees an unfunded request.
 *   • externalRef MUST be the rail-issued reference that the inbound
 *     webhook will carry — bill-payment lookup is `externalRef`-keyed.
 *   • status is the rail-reported terminal-or-pending verdict at the
 *     moment of dispatch. Most adapters return `pending` here; webhook
 *     drives the final state.
 */

export type BillerDispatchStatus = 'pending' | 'completed' | 'failed';

export interface BillerDispatchInput {
  billPaymentId: string;
  billerType: BillerType;
  billerAccountRef: string;
  amount: number;          // in AED, positive
  currency: string;        // 'AED'
  idempotencyKey: string;  // rail-side idempotency (bill_payments.idempotencyKey)
  customerRef: string;     // employeeId — surfaces in rail dashboards
}

export interface BillerDispatchResult {
  externalRef: string;
  status: BillerDispatchStatus;
  failureReason?: string;
  raw?: Record<string, unknown>;
}

export interface BillerAdapter {
  submit(input: BillerDispatchInput): Promise<BillerDispatchResult>;
}

// ───────────────────────────────────────────────────────────────────
// Default adapter — a deterministic stub. In production this is
// replaced at boot via setBillerAdapter() with the MoneyHash adapter.
// The stub is intentionally non-throwing so unit tests that don't care
// about the wire format still exercise the full service path.
// ───────────────────────────────────────────────────────────────────

let activeAdapter: BillerAdapter = {
  async submit(input: BillerDispatchInput): Promise<BillerDispatchResult> {
    logger.debug('biller adapter: default stub submit', {
      billerType: input.billerType,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      externalRef: `stub-${input.idempotencyKey}`,
      status: 'pending',
    };
  },
};

/** Replace the active adapter (production boot, or tests). */
export function setBillerAdapter(adapter: BillerAdapter): void {
  activeAdapter = adapter;
}

/** Read-only access for the service layer. */
export function getBillerAdapter(): BillerAdapter {
  return activeAdapter;
}
