// ============================================================
// FlexPay Credit Score Calculator — Pure Functions
// ============================================================
// Score range: 0–100
//
// Components:
//   Base score:                    50 points
//   Transaction frequency:         0–30 points  (based on monthly tx count)
//   Balance health:                0–20 points  (based on average balance in AED)
//   Account age:                   0–15 points  (months since registration)
//   Referral bonus:                0–15 points  (successful referrals)
//
// Penalties:
//   Missed loan payment:           –5  per occurrence
//   Failed transaction:            –2  per occurrence
//   Inactive for 30+ days:        –10
// ============================================================

/** All inputs needed to calculate a user's credit score. */
export interface CreditScoreInput {
  /** Number of transactions in the last 30 days */
  monthlyTxCount: number;
  /** Average wallet balance in AED */
  averageBalance: number;
  /** Number of full months since account registration */
  accountAgeMonths: number;
  /** Number of successful (COMPLETED / REWARDED) referrals */
  successfulReferrals: number;
  /** Number of missed loan payments */
  missedLoanPayments: number;
  /** Number of failed transactions */
  failedTransactions: number;
  /** Whether the user has been inactive for 30+ consecutive days */
  isInactiveFor30Days: boolean;
}

/** Detailed breakdown returned alongside the final score. */
export interface CreditScoreResult {
  /** Final score clamped to [0, 100] */
  score: number;
  /** Individual component values before clamping */
  breakdown: {
    base: number;
    transactionFrequency: number;
    balanceHealth: number;
    accountAge: number;
    referralBonus: number;
    penalties: number;
  };
  /** Raw total before clamping */
  rawTotal: number;
}

// ------------------------------------------------------------------
// Component calculators (each returns the points for that component)
// ------------------------------------------------------------------

/** Transaction frequency: 0–30 points based on monthly tx count. */
export function calcTransactionFrequency(monthlyTxCount: number): number {
  if (monthlyTxCount >= 31) return 30;
  if (monthlyTxCount >= 16) return 25;
  if (monthlyTxCount >= 6) return 15;
  if (monthlyTxCount >= 1) return 5;
  return 0;
}

/** Balance health: 0–20 points based on average balance in AED. */
export function calcBalanceHealth(averageBalance: number): number {
  if (averageBalance >= 5000) return 20;
  if (averageBalance >= 1000) return 15;
  if (averageBalance >= 100) return 10;
  if (averageBalance > 0) return 2;
  return 0;
}

/** Account age: 0–15 points based on months since registration. */
export function calcAccountAge(months: number): number {
  if (months >= 12) return 15;
  if (months >= 6) return 11;
  if (months >= 3) return 7;
  if (months > 0) return 3;
  return 0;
}

/** Referral bonus: 0–15 points based on successful referrals. */
export function calcReferralBonus(referrals: number): number {
  if (referrals >= 6) return 15;
  if (referrals >= 3) return 10;
  if (referrals >= 1) return 5;
  return 0;
}

/** Total penalties (negative number or 0). */
export function calcPenalties(input: {
  missedLoanPayments: number;
  failedTransactions: number;
  isInactiveFor30Days: boolean;
}): number {
  let penalty = 0;
  penalty += input.missedLoanPayments * -5;
  penalty += input.failedTransactions * -2;
  if (input.isInactiveFor30Days) penalty += -10;
  return penalty;
}

// ------------------------------------------------------------------
// Main entry point
// ------------------------------------------------------------------

/** Calculate the full credit score from the given input. */
export function calculateCreditScore(input: CreditScoreInput): CreditScoreResult {
  const base = 50;
  const transactionFrequency = calcTransactionFrequency(input.monthlyTxCount);
  const balanceHealth = calcBalanceHealth(input.averageBalance);
  const accountAge = calcAccountAge(input.accountAgeMonths);
  const referralBonus = calcReferralBonus(input.successfulReferrals);
  const penalties = calcPenalties({
    missedLoanPayments: input.missedLoanPayments,
    failedTransactions: input.failedTransactions,
    isInactiveFor30Days: input.isInactiveFor30Days,
  });

  const rawTotal =
    base + transactionFrequency + balanceHealth + accountAge + referralBonus + penalties;

  const score = Math.max(0, Math.min(100, rawTotal));

  return {
    score,
    breakdown: {
      base,
      transactionFrequency,
      balanceHealth,
      accountAge,
      referralBonus,
      penalties,
    },
    rawTotal,
  };
}
