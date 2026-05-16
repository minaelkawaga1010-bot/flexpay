// ============================================================
// FlexPay Transfer Validator — Pure Functions
// ============================================================
// Validates P2P (peer-to-peer) transfers between employees.
// All functions are pure and require no database access.
// ============================================================

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export type SubscriptionPlan = "STARTER" | "GROWTH" | "ENTERPRISE" | "LUXURY";

export interface TransferRequest {
  /** Sender's current AED balance */
  senderBalance: number;
  /** Recipient's phone number (for lookup) */
  recipientPhone: string;
  /** Sender's own phone number (for self-transfer check) */
  senderPhone: string;
  /** Amount to send in AED */
  amount: number;
  /** Currency — only AED is supported for P2P */
  currency: string;
  /** Sender's subscription plan (affects fee) */
  senderPlan: SubscriptionPlan;
  /** Total amount already sent today in AED */
  dailySentAmount: number;
  /** Daily transfer limit in AED */
  dailyLimit: number;
  /** Whether the recipient exists in the system */
  recipientExists: boolean;
  /** Optional note */
  note?: string;
}

export interface TransferValidationResult {
  valid: boolean;
  /** If valid=false, a human-readable error reason */
  error?: string;
  /** Calculated transfer fee */
  fee?: number;
  /** Net amount that will be deducted from sender (amount + fee) */
  totalDeduction?: number;
}

// ------------------------------------------------------------------
// Fee calculation
// ------------------------------------------------------------------

/** Transfer fee constants. */
export const FEE = {
  /** Percentage of transfer amount (0.5 %) */
  RATE: 0.005,
  /** Minimum fee in AED */
  MIN: 1,
  /** Maximum fee in AED */
  MAX: 25,
  /** Daily transfer limit in AED */
  DAILY_LIMIT: 10_000,
} as const;

/**
 * Calculate the P2P transfer fee.
 * - Standard rate: 0.5 % of amount
 * - Minimum: 1 AED
 * - Maximum: 25 AED
 * - LUXURY plan: 0 AED (free)
 */
export function calculateTransferFee(
  amount: number,
  plan: SubscriptionPlan,
): number {
  if (plan === "LUXURY") return 0;
  const raw = amount * FEE.RATE;
  return Math.max(FEE.MIN, Math.min(FEE.MAX, raw));
}

// ------------------------------------------------------------------
// Validation rules
// ------------------------------------------------------------------

/**
 * Validate a P2P transfer request.
 * Returns { valid: true, fee, totalDeduction } on success,
 * or { valid: false, error } on failure.
 */
export function validateTransfer(request: TransferRequest): TransferValidationResult {
  // 1. Self-transfer protection
  if (
    request.recipientPhone.trim() === request.senderPhone.trim()
  ) {
    return { valid: false, error: "Cannot transfer to yourself" };
  }

  // 2. Recipient existence
  if (!request.recipientExists) {
    return { valid: false, error: "Recipient phone number not found" };
  }

  // 3. Currency check
  if (request.currency !== "AED") {
    return {
      valid: false,
      error: `Only AED transfers are supported for P2P, got ${request.currency}`,
    };
  }

  // 4. Zero / negative amount
  if (request.amount <= 0) {
    return {
      valid: false,
      error: request.amount === 0
        ? "Transfer amount must be greater than zero"
        : "Transfer amount cannot be negative",
    };
  }

  // 5. Fee & total
  const fee = calculateTransferFee(request.amount, request.senderPlan);
  const totalDeduction = request.amount + fee;

  // 6. Sufficient balance (including fee)
  if (request.senderBalance < totalDeduction) {
    return {
      valid: false,
      error: `Insufficient balance. Required: AED ${totalDeduction.toFixed(2)}, Available: AED ${request.senderBalance.toFixed(2)}`,
    };
  }

  // 7. Daily limit check
  const newDailyTotal = request.dailySentAmount + request.amount;
  if (newDailyTotal > request.dailyLimit) {
    return {
      valid: false,
      error: `Daily transfer limit exceeded. Limit: AED ${request.dailyLimit.toFixed(2)}, Already sent today: AED ${request.dailySentAmount.toFixed(2)}`,
    };
  }

  return { valid: true, fee, totalDeduction };
}

/**
 * Simulate an atomic transfer between two balances.
 * This is a pure-function simulation — it does NOT actually mutate
 * any external state. It returns the new balances if the transfer
 * were to succeed, or null if it fails.
 *
 * Useful for testing race-condition logic without a real DB.
 */
export function simulateAtomicTransfer(params: {
  senderBalance: number;
  recipientBalance: number;
  amount: number;
  fee: number;
}): { senderBalance: number; recipientBalance: number } | null {
  const totalDeduction = params.amount + params.fee;
  if (params.senderBalance < totalDeduction) return null;
  if (params.amount <= 0) return null;

  return {
    senderBalance: params.senderBalance - totalDeduction,
    recipientBalance: params.recipientBalance + params.amount,
  };
}

/**
 * Simulate two concurrent transfers and verify no double-spend.
 * Returns an object with the final state or an error description.
 */
export function simulateConcurrentTransfers(params: {
  senderBalance: number;
  recipientABalance: number;
  recipientBBalance: number;
  transferA: { amount: number; fee: number };
  transferB: { amount: number; fee: number };
}): {
  success: boolean;
  senderBalance: number;
  recipientABalance: number;
  recipientBBalance: number;
  failedTransfer?: string;
  error?: string;
} {
  const totalA = params.transferA.amount + params.transferA.fee;
  const totalB = params.transferB.amount + params.transferB.fee;

  // Check if sender can afford both
  if (params.senderBalance < totalA + totalB) {
    // Process whichever fits first (deterministic ordering)
    if (params.senderBalance >= totalA) {
      return {
        success: false,
        senderBalance: params.senderBalance - totalA,
        recipientABalance: params.recipientABalance + params.transferA.amount,
        recipientBBalance: params.recipientBBalance,
        failedTransfer: "B",
        error: "Insufficient balance for second transfer (race condition prevented)",
      };
    }
    if (params.senderBalance >= totalB) {
      return {
        success: false,
        senderBalance: params.senderBalance - totalB,
        recipientABalance: params.recipientABalance,
        recipientBBalance: params.recipientBBalance + params.transferB.amount,
        failedTransfer: "A",
        error: "Insufficient balance for first transfer (race condition prevented)",
      };
    }
    return {
      success: false,
      senderBalance: params.senderBalance,
      recipientABalance: params.recipientABalance,
      recipientBBalance: params.recipientBBalance,
      failedTransfer: "A",
      error: "Insufficient balance for any transfer",
    };
  }

  // Both succeed
  return {
    success: true,
    senderBalance: params.senderBalance - totalA - totalB,
    recipientABalance: params.recipientABalance + params.transferA.amount,
    recipientBBalance: params.recipientBBalance + params.transferB.amount,
  };
}
