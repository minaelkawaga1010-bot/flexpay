import { db } from '@/lib/db';

// ============================================================================
// Event Types
// ============================================================================

export type FlexPayEvent =
  | { type: 'TRANSACTION_CREATED'; data: { userId: string; amount: number; currency: string; txType: string; transactionId: string } }
  | { type: 'TRANSACTION_COMPLETED'; data: { userId: string; amount: number; currency: string; txType: string; transactionId: string } }
  | { type: 'TRANSACTION_FAILED'; data: { userId: string; amount: number; currency: string; reason: string; transactionId: string } }
  | { type: 'WALLET_TOPUP'; data: { userId: string; amount: number; currency: string } }
  | { type: 'P2P_TRANSFER'; data: { senderId: string; receiverId: string; amount: number; currency: string } }
  | { type: 'REMITTANCE_SENT'; data: { userId: string; amount: number; currency: string; targetCurrency: string; beneficiaryId: string } }
  | { type: 'CARD_ISSUED'; data: { userId: string; cardId: string; cardType: string } }
  | { type: 'CARD_FROZEN'; data: { userId: string; cardId: string; reason: string } }
  | { type: 'CARD_BLOCKED'; data: { userId: string; cardId: string; reason: string } }
  | { type: 'PAYROLL_PROCESSED'; data: { companyUserId: string; batchId: string; employeeCount: number; totalAmount: number } }
  | { type: 'PAYROLL_FAILED'; data: { companyUserId: string; batchId: string; employeeId: string; reason: string } }
  | { type: 'SALARY_CREDITED'; data: { userId: string; amount: number; batchId: string } }
  | { type: 'LOAN_APPROVED'; data: { userId: string; loanId: string; amount: number } }
  | { type: 'LOAN_REPAYMENT'; data: { userId: string; loanId: string; amount: number } }
  | { type: 'SAVINGS_GOAL_CREATED'; data: { userId: string; goalId: string; targetAmount: number } }
  | { type: 'SAVINGS_CONTRIBUTION'; data: { userId: string; goalId: string; amount: number } }
  | { type: 'KYC_COMPLETED'; data: { userId: string; kycLevel: number } }
  | { type: 'REFERRAL_COMPLETED'; data: { referrerId: string; referredId: string; rewardType: string } }
  | { type: 'AML_ALERT_TRIGGERED'; data: { userId: string; alertType: string; severity: string; description: string } }
  | { type: 'USER_REGISTERED'; data: { userId: string; phone: string; role: string } }
  | { type: 'OTP_REQUESTED'; data: { userId: string; purpose: string; phone: string } };

// ============================================================================
// EventBus Class
// ============================================================================

type EventHandler<T extends FlexPayEvent['type']> = (
  event: Extract<FlexPayEvent, { type: T }>
) => Promise<void>;

class EventBus {
  private handlers = new Map<FlexPayEvent['type'], Set<EventHandler<any>>>();
  private eventCounts: Record<string, number> = {};

  /**
   * Subscribe to a specific event type. Returns an unsubscribe function.
   */
  on<T extends FlexPayEvent['type']>(
    eventType: T,
    handler: EventHandler<T>
  ): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  /**
   * Emit an event to all registered subscribers for that event type.
   * Each handler is called with error isolation — one failure won't stop others.
   */
  async emit(event: FlexPayEvent): Promise<void> {
    // Increment metrics counter
    this.eventCounts[event.type] = (this.eventCounts[event.type] ?? 0) + 1;

    const typeHandlers = this.handlers.get(event.type);
    if (!typeHandlers || typeHandlers.size === 0) return;

    // Fire all handlers in parallel with error isolation
    const promises = Array.from(typeHandlers).map(async (handler) => {
      try {
        await handler(event);
      } catch (error) {
        console.error(
          `[EventBus] Error in handler for ${event.type}:`,
          error
        );
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Remove all listeners, or only those for a specific event type.
   */
  removeAllListeners(eventType?: FlexPayEvent['type']): void {
    if (eventType) {
      this.handlers.delete(eventType);
    } else {
      this.handlers.clear();
    }
  }

  /**
   * Returns a snapshot of event counts per type for monitoring.
   */
  getEventCounts(): Record<string, number> {
    return { ...this.eventCounts };
  }
}

// ============================================================================
// Built-in: Notification Subscriber
// ============================================================================

function createNotificationSubscriber(): () => void {
  const unsubscribers: (() => void)[] = [];

  // Helper to create a DB notification record, wrapped in try/catch
  const createNotification = async (params: {
    userId: string;
    type: string;
    title: string;
    body: string;
    channel: string;
    priority?: string;
    data?: string;
  }) => {
    try {
      await db.notification.create({
        data: {
          userId: params.userId,
          type: params.type,
          title: params.title,
          body: params.body,
          channel: params.channel,
          priority: params.priority ?? 'MEDIUM',
          data: params.data,
        },
      });
    } catch (error) {
      console.error('[EventBus:Notification] Failed to create notification:', error);
    }
  };

  // TRANSACTION_COMPLETED → IN_APP notification "Payment of AED X completed"
  unsubscribers.push(
    eventBus.on('TRANSACTION_COMPLETED', async (event) => {
      await createNotification({
        userId: event.data.userId,
        type: 'TRANSACTION',
        title: 'Payment Completed',
        body: `Payment of ${event.data.currency} ${event.data.amount.toFixed(2)} completed`,
        channel: 'IN_APP',
        priority: 'MEDIUM',
        data: JSON.stringify({ transactionId: event.data.transactionId, txType: event.data.txType }),
      });
    })
  );

  // SALARY_CREDITED → IN_APP + PUSH notification "Salary of AED X credited"
  unsubscribers.push(
    eventBus.on('SALARY_CREDITED', async (event) => {
      const base = {
        userId: event.data.userId,
        type: 'PAYROLL',
        title: 'Salary Credited',
        body: `Salary of AED ${event.data.amount.toFixed(2)} credited to your account`,
        priority: 'MEDIUM',
        data: JSON.stringify({ batchId: event.data.batchId }),
      };

      await createNotification({ ...base, channel: 'IN_APP' });
      await createNotification({ ...base, channel: 'PUSH' });
    })
  );

  // PAYROLL_PROCESSED → IN_APP notification for company admin
  unsubscribers.push(
    eventBus.on('PAYROLL_PROCESSED', async (event) => {
      await createNotification({
        userId: event.data.companyUserId,
        type: 'PAYROLL',
        title: 'Payroll Processed',
        body: `Payroll batch ${event.data.batchId} processed for ${event.data.employeeCount} employees. Total: AED ${event.data.totalAmount.toFixed(2)}`,
        channel: 'IN_APP',
        priority: 'HIGH',
        data: JSON.stringify({ batchId: event.data.batchId }),
      });
    })
  );

  // PAYROLL_FAILED → IN_APP URGENT notification
  unsubscribers.push(
    eventBus.on('PAYROLL_FAILED', async (event) => {
      await createNotification({
        userId: event.data.companyUserId,
        type: 'PAYROLL',
        title: 'Payroll Failed',
        body: `Payroll batch ${event.data.batchId} failed for employee ${event.data.employeeId}. Reason: ${event.data.reason}`,
        channel: 'IN_APP',
        priority: 'URGENT',
        data: JSON.stringify({ batchId: event.data.batchId, employeeId: event.data.employeeId }),
      });
    })
  );

  // LOAN_APPROVED → IN_APP notification
  unsubscribers.push(
    eventBus.on('LOAN_APPROVED', async (event) => {
      await createNotification({
        userId: event.data.userId,
        type: 'LOAN',
        title: 'Loan Approved',
        body: `Your loan of AED ${event.data.amount.toFixed(2)} has been approved`,
        channel: 'IN_APP',
        priority: 'HIGH',
        data: JSON.stringify({ loanId: event.data.loanId }),
      });
    })
  );

  // AML_ALERT_TRIGGERED → IN_APP HIGH notification
  unsubscribers.push(
    eventBus.on('AML_ALERT_TRIGGERED', async (event) => {
      await createNotification({
        userId: event.data.userId,
        type: 'SECURITY',
        title: 'AML Alert',
        body: `${event.data.alertType} alert (${event.data.severity}): ${event.data.description}`,
        channel: 'IN_APP',
        priority: 'HIGH',
        data: JSON.stringify({ alertType: event.data.alertType, severity: event.data.severity }),
      });
    })
  );

  // CARD_FROZEN → PUSH notification
  unsubscribers.push(
    eventBus.on('CARD_FROZEN', async (event) => {
      await createNotification({
        userId: event.data.userId,
        type: 'SECURITY',
        title: 'Card Frozen',
        body: `Your card has been frozen. Reason: ${event.data.reason}`,
        channel: 'PUSH',
        priority: 'HIGH',
        data: JSON.stringify({ cardId: event.data.cardId }),
      });
    })
  );

  // Return a single unsubscribe function that tears down all notification handlers
  return () => {
    unsubscribers.forEach((unsub) => unsub());
  };
}

// ============================================================================
// Built-in: Audit Log Subscriber
// ============================================================================

/** Maps event types to short audit action codes */
const EVENT_TO_AUDIT_ACTION: Record<FlexPayEvent['type'], string> = {
  TRANSACTION_CREATED: 'TX_CREATED',
  TRANSACTION_COMPLETED: 'TX_COMPLETE',
  TRANSACTION_FAILED: 'TX_FAILED',
  WALLET_TOPUP: 'WALLET_TOPUP',
  P2P_TRANSFER: 'P2P_TRANSFER',
  REMITTANCE_SENT: 'REMITTANCE_SENT',
  CARD_ISSUED: 'CARD_ISSUED',
  CARD_FROZEN: 'CARD_FROZEN',
  CARD_BLOCKED: 'CARD_BLOCKED',
  PAYROLL_PROCESSED: 'PAYROLL_PROCESSED',
  PAYROLL_FAILED: 'PAYROLL_FAILED',
  SALARY_CREDITED: 'SALARY_CREDITED',
  LOAN_APPROVED: 'LOAN_APPROVED',
  LOAN_REPAYMENT: 'LOAN_REPAYMENT',
  SAVINGS_GOAL_CREATED: 'SAVINGS_GOAL_CREATED',
  SAVINGS_CONTRIBUTION: 'SAVINGS_CONTRIBUTION',
  KYC_COMPLETED: 'KYC_COMPLETED',
  REFERRAL_COMPLETED: 'REFERRAL_COMPLETED',
  AML_ALERT_TRIGGERED: 'AML_ALERT',
  USER_REGISTERED: 'USER_REGISTERED',
  OTP_REQUESTED: 'OTP_REQUESTED',
};

/** Extracts userId from event data when available */
function extractUserId(event: FlexPayEvent): string | undefined {
  const data = event.data as Record<string, unknown>;
  if ('userId' in data && typeof data.userId === 'string') return data.userId;
  if ('senderId' in data && typeof data.senderId === 'string') return data.senderId;
  if ('companyUserId' in data && typeof data.companyUserId === 'string') return data.companyUserId;
  if ('referrerId' in data && typeof data.referrerId === 'string') return data.referrerId;
  return undefined;
}

function createAuditLogSubscriber(): () => void {
  const unsubscribers: (() => void)[] = [];

  const allEventTypes: FlexPayEvent['type'][] = [
    'TRANSACTION_CREATED',
    'TRANSACTION_COMPLETED',
    'TRANSACTION_FAILED',
    'WALLET_TOPUP',
    'P2P_TRANSFER',
    'REMITTANCE_SENT',
    'CARD_ISSUED',
    'CARD_FROZEN',
    'CARD_BLOCKED',
    'PAYROLL_PROCESSED',
    'PAYROLL_FAILED',
    'SALARY_CREDITED',
    'LOAN_APPROVED',
    'LOAN_REPAYMENT',
    'SAVINGS_GOAL_CREATED',
    'SAVINGS_CONTRIBUTION',
    'KYC_COMPLETED',
    'REFERRAL_COMPLETED',
    'AML_ALERT_TRIGGERED',
    'USER_REGISTERED',
    'OTP_REQUESTED',
  ];

  for (const eventType of allEventTypes) {
    const unsub = eventBus.on(eventType, async (event) => {
      try {
        await db.auditLog.create({
          data: {
            userId: extractUserId(event),
            action: EVENT_TO_AUDIT_ACTION[event.type],
            resource: event.type,
            details: JSON.stringify(event.data),
          },
        });
      } catch (error) {
        console.error(`[EventBus:AuditLog] Failed to log ${event.type}:`, error);
      }
    });
    unsubscribers.push(unsub);
  }

  return () => {
    unsubscribers.forEach((unsub) => unsub());
  };
}

// ============================================================================
// Singleton Export
// ============================================================================

export const eventBus = new EventBus();

// Auto-register built-in subscribers
createNotificationSubscriber();
createAuditLogSubscriber();
