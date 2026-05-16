// ============================================================
// Transfer Validation Tests  (12 cases)
// ============================================================
import {
  describe,
  test,
  expect,
} from "./run-tests.ts";
import {
  validateTransfer,
  calculateTransferFee,
  simulateAtomicTransfer,
  simulateConcurrentTransfers,
  FEE,
  type TransferRequest,
  type SubscriptionPlan,
} from "../lib/transfer-validator.ts";

// Helper to build a valid request with defaults
function validRequest(overrides: Partial<TransferRequest> = {}): TransferRequest {
  return {
    senderBalance: 5000,
    recipientPhone: "+971509876543",
    senderPhone: "+971501234567",
    amount: 500,
    currency: "AED",
    senderPlan: "GROWTH",
    dailySentAmount: 0,
    dailyLimit: FEE.DAILY_LIMIT,
    recipientExists: true,
    ...overrides,
  };
}

// ============================================================
describe("Transfer Validation", () => {
  // ----------------------------------------------------------
  // 1. Successful transfer
  // ----------------------------------------------------------
  test("valid transfer between two employees with sufficient balance", () => {
    const result = validateTransfer(validRequest());
    expect(result.valid).toBeTruthy("transfer should be valid");
    expect(result.error).toBeFalsy("no error message");
    expect(result.fee).toBeGreaterThan(0, "fee should be positive");
    expect(result.totalDeduction).toBeCloseTo(502.5, 2, "500 + 2.50 fee = 502.50");
  });

  // ----------------------------------------------------------
  // 2. Zero fee for LUXURY plan
  // ----------------------------------------------------------
  test("LUXURY plan users get zero transfer fees", () => {
    const result = validateTransfer(validRequest({ senderPlan: "LUXURY", amount: 1000 }));
    expect(result.valid).toBeTruthy();
    expect(result.fee).toBe(0, "fee should be 0 for LUXURY");
    expect(result.totalDeduction).toBe(1000, "total = amount only (no fee)");
  });

  // ----------------------------------------------------------
  // 3. Insufficient balance
  // ----------------------------------------------------------
  test("transfer fails when sender has insufficient balance", () => {
    const result = validateTransfer(validRequest({ senderBalance: 10, amount: 500 }));
    expect(result.valid).toBeFalsy();
    expect(result.error).toContain("Insufficient balance");
  });

  // ----------------------------------------------------------
  // 4. Recipient not found
  // ----------------------------------------------------------
  test("transfer fails when recipient phone not found", () => {
    const result = validateTransfer(validRequest({ recipientExists: false }));
    expect(result.valid).toBeFalsy();
    expect(result.error).toContain("not found");
  });

  // ----------------------------------------------------------
  // 5. Self-transfer protection
  // ----------------------------------------------------------
  test("cannot transfer to self", () => {
    const result = validateTransfer(
      validRequest({ recipientPhone: "+971501234567" }), // same as sender
    );
    expect(result.valid).toBeFalsy();
    expect(result.error).toContain("yourself");
  });

  // ----------------------------------------------------------
  // 6. Zero / negative amount
  // ----------------------------------------------------------
  test("transfer fails for zero amount", () => {
    const result = validateTransfer(validRequest({ amount: 0 }));
    expect(result.valid).toBeFalsy();
    expect(result.error).toContain("greater than zero");
  });

  test("transfer fails for negative amount", () => {
    const result = validateTransfer(validRequest({ amount: -100 }));
    expect(result.valid).toBeFalsy();
    expect(result.error).toContain("negative");
  });

  // ----------------------------------------------------------
  // 7. Max transfer (daily) limit
  // ----------------------------------------------------------
  test("transfer fails when exceeding daily limit", () => {
    const result = validateTransfer(
      validRequest({ dailySentAmount: 9500, amount: 1000, dailyLimit: 10_000 }),
    );
    expect(result.valid).toBeFalsy();
    expect(result.error).toContain("limit exceeded");
  });

  // ----------------------------------------------------------
  // 8. Fee calculation
  // ----------------------------------------------------------
  test("standard fee is 0.5% of amount", () => {
    expect(calculateTransferFee(1000, "GROWTH")).toBeCloseTo(5, 2);
    expect(calculateTransferFee(2000, "STARTER")).toBeCloseTo(10, 2);
    expect(calculateTransferFee(4000, "ENTERPRISE")).toBeCloseTo(20, 2);
  });

  test("minimum fee is 1 AED", () => {
    // 0.5% of 100 = 0.50, but min is 1
    expect(calculateTransferFee(100, "GROWTH")).toBe(1);
    // 0.5% of 50 = 0.25, still min 1
    expect(calculateTransferFee(50, "STARTER")).toBe(1);
  });

  test("maximum fee is 25 AED", () => {
    // 0.5% of 10000 = 50, but max is 25
    expect(calculateTransferFee(10_000, "GROWTH")).toBe(25);
    expect(calculateTransferFee(100_000, "ENTERPRISE")).toBe(25);
  });

  // ----------------------------------------------------------
  // 9. Currency validation
  // ----------------------------------------------------------
  test("only AED transfers supported for P2P", () => {
    const result = validateTransfer(validRequest({ currency: "USD" }));
    expect(result.valid).toBeFalsy();
    expect(result.error).toContain("Only AED");
  });

  test("INR transfers rejected for P2P", () => {
    const result = validateTransfer(validRequest({ currency: "INR" }));
    expect(result.valid).toBeFalsy();
    expect(result.error).toContain("AED");
  });

  // ----------------------------------------------------------
  // 10. Atomicity verification
  // ----------------------------------------------------------
  test("atomic transfer deducts from sender and credits recipient", () => {
    const result = simulateAtomicTransfer({
      senderBalance: 5000,
      recipientBalance: 1000,
      amount: 500,
      fee: 2.5,
    });
    expect(result).toBeNotNull();
    expect(result!.senderBalance).toBeCloseTo(4497.5, 2);
    expect(result!.recipientBalance).toBe(1500);
  });

  test("atomic transfer returns null when insufficient balance", () => {
    const result = simulateAtomicTransfer({
      senderBalance: 100,
      recipientBalance: 0,
      amount: 500,
      fee: 2.5,
    });
    expect(result).toBeNull();
  });

  test("simultaneous transfers dont cause race conditions — both succeed", () => {
    const result = simulateConcurrentTransfers({
      senderBalance: 10_000,
      recipientABalance: 500,
      recipientBBalance: 200,
      transferA: { amount: 2000, fee: 10 },
      transferB: { amount: 3000, fee: 15 },
    });
    expect(result.success).toBeTruthy();
    expect(result.senderBalance).toBeCloseTo(10_000 - 2010 - 3015, 2);
    expect(result.recipientABalance).toBe(2500);
    expect(result.recipientBBalance).toBe(3200);
  });

  test("simultaneous transfers — second fails on insufficient balance", () => {
    const result = simulateConcurrentTransfers({
      senderBalance: 3000,
      recipientABalance: 0,
      recipientBBalance: 0,
      transferA: { amount: 2000, fee: 10 },  // total 2010
      transferB: { amount: 2000, fee: 10 },  // total 2010 → can't afford both
    });
    // First transfer (A) should succeed (2010 <= 3000), second fails
    expect(result.success).toBeFalsy();
    expect(result.failedTransfer).toBe("B");
    expect(result.senderBalance).toBeCloseTo(990, 2); // 3000 - 2010
    expect(result.recipientABalance).toBe(2000);
    expect(result.recipientBBalance).toBe(0);
  });
});
