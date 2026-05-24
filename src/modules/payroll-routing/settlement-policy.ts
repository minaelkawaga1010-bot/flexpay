/**
 * Settlement policy — the financial-protection layer that sits on top
 * of the per-intent recovery loop.
 *
 * Closes Bible §3.1 STEP 3 + STEP 4:
 *
 *   STEP 3: recoverable = MIN(totalOwed, gross × RECOVERY_CAP)
 *   STEP 4: if (gross − recoverable) < MIN_NET_FLOOR
 *             finalRecoverable = MAX(0, gross − MIN_NET_FLOOR)
 *
 * Why this lives in a dedicated module rather than inline in
 * `settleIntent`:
 *
 *   1. Pure function — exhaustively testable without Prisma.
 *   2. Single point of policy change — when CBUAE updates the
 *      mandatory minimum-net-floor or the recovery-cap percentage,
 *      one constant changes.
 *   3. Reusable from the pre-settlement preview API the corporate
 *      dashboard already exposes (and from the FlexScore engine when
 *      it projects the next-cycle take-home).
 */

/**
 * Maximum proportion of the gross WPS amount FlexPay may recover for
 * outstanding EWA advances in a single settlement. Bible §3.1: 0.70.
 *
 * The remaining 30% is the protected take-home floor in proportional
 * terms — independent of the absolute MIN_NET_FLOOR_AED below.
 */
export const RECOVERY_CAP_FRACTION = 0.70;

/**
 * Absolute minimum AED the worker must receive in their wallet after
 * a settlement. Bible §3.1 STEP 4: 300. Even when 0.70 × gross would
 * leave less than this, the recovery is further reduced so the worker
 * lands at AED 300 net minimum.
 *
 * The floor takes precedence over the cap when both bind — the worker
 * is more protected by the absolute floor than by the proportional
 * cap when gross is small.
 */
export const MIN_NET_FLOOR_AED = 300;

export interface SettlementApportionment {
  /** Gross WPS amount paid by the employer for this worker. */
  grossAED: number;
  /** Σ of (principal + fee) on all outstanding EWA advances. */
  totalOwedAED: number;
  /** The amount FlexPay should recover against EWA receivable this cycle. */
  recoverAED: number;
  /** What the worker actually receives in their wallet. */
  netAED: number;
  /** Σ of outstanding EWA still owed AFTER this settlement (rolls into next cycle). */
  remainingOwedAED: number;
  /** Which gate(s) bound the final apportionment — populated for audit log. */
  binding: ('NONE' | 'TOTAL_OWED' | 'RECOVERY_CAP' | 'MIN_NET_FLOOR')[];
}

/**
 * Pure function. Computes how much of `totalOwed` can be recovered
 * from `gross` while respecting both the 70% recovery cap and the
 * absolute AED 300 net floor.
 *
 * Returns the full apportionment + the binding gates for audit. The
 * caller (settleIntent) writes ledger entries for `recoverAED` and
 * `netAED` and updates the EWA advance rows according to FIFO order
 * up to `recoverAED` cumulative.
 */
export function apportionSettlement(
  grossAED: number,
  totalOwedAED: number,
): SettlementApportionment {
  if (grossAED < 0) {
    throw new RangeError(`gross must be non-negative; got ${grossAED}`);
  }
  if (totalOwedAED < 0) {
    throw new RangeError(`totalOwed must be non-negative; got ${totalOwedAED}`);
  }

  const binding: SettlementApportionment['binding'] = [];

  // Stage 1: clamp recoverable to the smaller of (what's owed, 70%
  // of gross). Bible STEP 3.
  const capAED = grossAED * RECOVERY_CAP_FRACTION;
  let recoverAED = Math.min(totalOwedAED, capAED);

  if (recoverAED === totalOwedAED && totalOwedAED <= capAED) {
    binding.push('TOTAL_OWED');
  }
  if (recoverAED === capAED && capAED < totalOwedAED) {
    binding.push('RECOVERY_CAP');
  }

  // Stage 2: enforce the absolute net floor. Bible STEP 4.
  const netAfterStage1 = grossAED - recoverAED;
  if (netAfterStage1 < MIN_NET_FLOOR_AED) {
    recoverAED = Math.max(0, grossAED - MIN_NET_FLOOR_AED);
    binding.push('MIN_NET_FLOOR');
  }

  const netAED = grossAED - recoverAED;
  const remainingOwedAED = Math.max(0, totalOwedAED - recoverAED);

  if (binding.length === 0) {
    binding.push('NONE');
  }

  // Round to 2 decimals using fixed-point fils arithmetic to avoid
  // IEEE-754 drift. The ledger column is DECIMAL(12,2) in the Bible's
  // schema; we mirror that precision here.
  return {
    grossAED: round2(grossAED),
    totalOwedAED: round2(totalOwedAED),
    recoverAED: round2(recoverAED),
    netAED: round2(netAED),
    remainingOwedAED: round2(remainingOwedAED),
    binding,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * FIFO advance-recovery iterator. Given the apportioned `recoverAED`
 * and the list of outstanding advances in FIFO order, returns the
 * per-advance recovery distribution.
 *
 * Each advance is recovered in full, in order, until `recoverAED` is
 * exhausted. The final advance may be partially recovered — in which
 * case the caller writes a partial-recovery ledger entry and leaves
 * the advance.status as 'outstanding' with the residual on its
 * principal column (managed by the caller, not this function).
 */
export function distributeRecoveryFifo(
  recoverAED: number,
  advances: Array<{ id: string; outstandingAED: number }>,
): Array<{ advanceId: string; recoverAED: number; fullyRecovered: boolean }> {
  const distribution: Array<{ advanceId: string; recoverAED: number; fullyRecovered: boolean }> = [];
  let budget = round2(recoverAED);
  for (const adv of advances) {
    if (budget <= 0) break;
    const take = Math.min(adv.outstandingAED, budget);
    distribution.push({
      advanceId: adv.id,
      recoverAED: round2(take),
      fullyRecovered: round2(take) >= round2(adv.outstandingAED),
    });
    budget = round2(budget - take);
  }
  return distribution;
}
