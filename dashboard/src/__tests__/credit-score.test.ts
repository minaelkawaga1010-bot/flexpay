// ============================================================
// Credit Score Calculation Tests  (14+ cases)
// ============================================================
import {
  describe,
  test,
  expect,
} from "./run-tests.ts";
import {
  calculateCreditScore,
  calcTransactionFrequency,
  calcBalanceHealth,
  calcAccountAge,
  calcReferralBonus,
  calcPenalties,
  type CreditScoreInput,
} from "../lib/credit-score-calculator.ts";

// Helper — new-user defaults (base score only)
const newUserData: CreditScoreInput = {
  monthlyTxCount: 0,
  averageBalance: 0,
  accountAgeMonths: 0,
  successfulReferrals: 0,
  missedLoanPayments: 0,
  failedTransactions: 0,
  isInactiveFor30Days: false,
};

// ============================================================
describe("Credit Score Calculation", () => {
  // ----------------------------------------------------------
  // 1. Base score
  // ----------------------------------------------------------
  test("new user gets base score of 50", () => {
    const result = calculateCreditScore(newUserData);
    expect(result.score).toBe(50, "base score = 50");
    expect(result.breakdown.base).toBe(50);
  });

  // ----------------------------------------------------------
  // 2. Transaction frequency scoring
  // ----------------------------------------------------------
  test("1-5 monthly transactions: +5 points", () => {
    expect(calcTransactionFrequency(1)).toBe(5);
    expect(calcTransactionFrequency(3)).toBe(5);
    expect(calcTransactionFrequency(5)).toBe(5);
  });

  test("6-15 monthly transactions: +15 points", () => {
    expect(calcTransactionFrequency(6)).toBe(15);
    expect(calcTransactionFrequency(10)).toBe(15);
    expect(calcTransactionFrequency(15)).toBe(15);
  });

  test("16-30 monthly transactions: +25 points", () => {
    expect(calcTransactionFrequency(16)).toBe(25);
    expect(calcTransactionFrequency(20)).toBe(25);
    expect(calcTransactionFrequency(30)).toBe(25);
  });

  test("31+ monthly transactions: +30 points (max)", () => {
    expect(calcTransactionFrequency(31)).toBe(30);
    expect(calcTransactionFrequency(100)).toBe(30);
  });

  test("0 monthly transactions: +0 points", () => {
    expect(calcTransactionFrequency(0)).toBe(0);
  });

  // ----------------------------------------------------------
  // 3. Balance health scoring
  // ----------------------------------------------------------
  test("average balance < 100 AED: +2 points", () => {
    expect(calcBalanceHealth(1)).toBe(2);
    expect(calcBalanceHealth(50)).toBe(2);
    expect(calcBalanceHealth(99)).toBe(2);
  });

  test("average balance 100-999 AED: +10 points", () => {
    expect(calcBalanceHealth(100)).toBe(10);
    expect(calcBalanceHealth(500)).toBe(10);
  });

  test("average balance 1000-4999 AED: +15 points", () => {
    expect(calcBalanceHealth(1000)).toBe(15);
    expect(calcBalanceHealth(2500)).toBe(15);
  });

  test("average balance 5000+ AED: +20 points (max)", () => {
    expect(calcBalanceHealth(5000)).toBe(20);
    expect(calcBalanceHealth(50000)).toBe(20);
  });

  test("zero balance: +0 points", () => {
    expect(calcBalanceHealth(0)).toBe(0);
  });

  // ----------------------------------------------------------
  // 4. Account age scoring
  // ----------------------------------------------------------
  test("account < 3 months: +3 points", () => {
    expect(calcAccountAge(1)).toBe(3);
    expect(calcAccountAge(2)).toBe(3);
  });

  test("account 3-5 months: +7 points", () => {
    expect(calcAccountAge(3)).toBe(7);
    expect(calcAccountAge(5)).toBe(7);
  });

  test("account 6-11 months: +11 points", () => {
    expect(calcAccountAge(6)).toBe(11);
    expect(calcAccountAge(11)).toBe(11);
  });

  test("account 12+ months: +15 points (max)", () => {
    expect(calcAccountAge(12)).toBe(15);
    expect(calcAccountAge(24)).toBe(15);
  });

  test("account 0 months: +0 points", () => {
    expect(calcAccountAge(0)).toBe(0);
  });

  // ----------------------------------------------------------
  // 5. Referral bonus
  // ----------------------------------------------------------
  test("1-2 referrals: +5 points", () => {
    expect(calcReferralBonus(1)).toBe(5);
    expect(calcReferralBonus(2)).toBe(5);
  });

  test("3-5 referrals: +10 points", () => {
    expect(calcReferralBonus(3)).toBe(10);
    expect(calcReferralBonus(5)).toBe(10);
  });

  test("6+ referrals: +15 points (max)", () => {
    expect(calcReferralBonus(6)).toBe(15);
    expect(calcReferralBonus(20)).toBe(15);
  });

  test("0 referrals: +0 points", () => {
    expect(calcReferralBonus(0)).toBe(0);
  });

  // ----------------------------------------------------------
  // 6. Loan penalties
  // ----------------------------------------------------------
  test("each missed loan payment: -5 points", () => {
    const p1 = calcPenalties({ missedLoanPayments: 1, failedTransactions: 0, isInactiveFor30Days: false });
    expect(p1).toBe(-5);
    const p3 = calcPenalties({ missedLoanPayments: 3, failedTransactions: 0, isInactiveFor30Days: false });
    expect(p3).toBe(-15);
  });

  test("each failed transaction: -2 points", () => {
    const p = calcPenalties({ missedLoanPayments: 0, failedTransactions: 3, isInactiveFor30Days: false });
    expect(p).toBe(-6);
  });

  test("inactive for 30+ days: -10 points", () => {
    const p = calcPenalties({ missedLoanPayments: 0, failedTransactions: 0, isInactiveFor30Days: true });
    expect(p).toBe(-10);
  });

  test("combined penalties sum correctly", () => {
    const p = calcPenalties({ missedLoanPayments: 2, failedTransactions: 3, isInactiveFor30Days: true });
    // -10 + -6 + -10 = -26
    expect(p).toBe(-26);
  });

  test("score cannot go below 0 from penalties", () => {
    const result = calculateCreditScore({
      ...newUserData,
      missedLoanPayments: 20, // -100 alone
      failedTransactions: 10, // -20
      isInactiveFor30Days: true, // -10
    });
    expect(result.score).toBe(0, "score floored at 0");
    expect(result.rawTotal).toBeLessThan(0, "raw total can be negative");
  });

  // ----------------------------------------------------------
  // 7. Edge cases
  // ----------------------------------------------------------
  test("max score capped at 100", () => {
    const result = calculateCreditScore({
      monthlyTxCount: 100,
      averageBalance: 100000,
      accountAgeMonths: 60,
      successfulReferrals: 50,
      missedLoanPayments: 0,
      failedTransactions: 0,
      isInactiveFor30Days: false,
    });
    // 50 + 30 + 20 + 15 + 15 = 130 → capped at 100
    expect(result.rawTotal).toBeGreaterThan(100, "raw > 100");
    expect(result.score).toBe(100, "capped at 100");
  });

  test("min score floored at 0", () => {
    const result = calculateCreditScore({
      monthlyTxCount: 0,
      averageBalance: 0,
      accountAgeMonths: 0,
      successfulReferrals: 0,
      missedLoanPayments: 50,
      failedTransactions: 50,
      isInactiveFor30Days: true,
    });
    expect(result.score).toBe(0);
  });

  test("combined scenario: active user 12mo, 20tx, AED 2000, 3 referrals = 50+25+15+11+10 = 111 → 100", () => {
    const result = calculateCreditScore({
      monthlyTxCount: 20,   // +25
      averageBalance: 2000, // +15
      accountAgeMonths: 12, // +15
      successfulReferrals: 3, // +10
      missedLoanPayments: 0,
      failedTransactions: 0,
      isInactiveFor30Days: false,
    });
    expect(result.rawTotal).toBe(115, "raw = 50+25+15+15+10 = 115");
    expect(result.score).toBe(100, "capped at 100");
  });

  test("combined scenario: inactive user with missed payments = 50+5+2+3-10-10 = 40", () => {
    const result = calculateCreditScore({
      monthlyTxCount: 3,     // +5
      averageBalance: 50,    // +2
      accountAgeMonths: 1,   // +3
      successfulReferrals: 0, // +0
      missedLoanPayments: 0,
      failedTransactions: 0,
      isInactiveFor30Days: true, // -10
    });
    // 50 + 5 + 2 + 3 + 0 - 10 = 50
    expect(result.score).toBe(50);

    // Now add 2 missed payments: -10 more
    const result2 = calculateCreditScore({
      monthlyTxCount: 3,
      averageBalance: 50,
      accountAgeMonths: 1,
      successfulReferrals: 0,
      missedLoanPayments: 2,  // -10
      failedTransactions: 0,
      isInactiveFor30Days: true, // -10
    });
    expect(result2.score).toBe(40, "50+5+2+3-10-10 = 40");
  });
});
