import { Prisma, AdvanceStatus } from '@prisma/client';
import { AppError } from '@shared/utils/errors';
import logger from '@shared/utils/logger';

/**
 * Global liquidity gate — Day-Zero hardening (Advisory Board §P0 /
 * liquidity audit). Closes the hole where `reserveAdvance` would front
 * cash whenever per-worker invariants held, with no check on whether
 * the platform actually holds the deployable capital.
 *
 * The gate caps total outstanding (RESERVED) advance float against a
 * configured deployable-capital ceiling × a utilisation cap. It runs
 * INSIDE the advisory-locked `reserveAdvance` transaction, so the
 * committed-float read and the subsequent advance write share one MVCC
 * snapshot.
 *
 * Configuration (read from process.env at call time so it's runtime-
 * tunable without a redeploy, and so the gate is OFF by default — a
 * deploy that hasn't set a ceiling is not silently blocked):
 *
 *   LIQUIDITY_DEPLOYABLE_AED   — total facility + own cash we may front
 *   LIQUIDITY_UTILISATION_CAP  — fraction of deployable we'll commit
 *                                (default 0.85; refuse new advances above)
 *
 * When LIQUIDITY_DEPLOYABLE_AED is unset/invalid the gate is a no-op.
 */

export const DEFAULT_UTILISATION_CAP = 0.85;

/**
 * Pure decision: would committing `requestedAED` push total committed
 * float above the deployable ceiling × utilisation cap?
 */
export function exceedsLiquidityCeiling(args: {
  committedFloatAED: number;
  requestedAED: number;
  deployableAED: number;
  utilisationCap: number;
}): boolean {
  const ceiling = args.deployableAED * args.utilisationCap;
  return args.committedFloatAED + args.requestedAED > ceiling;
}

/** Resolve the deployable ceiling from env; null when the gate is off. */
export function getDeployableCeiling(): { deployableAED: number; utilisationCap: number } | null {
  const raw = process.env.LIQUIDITY_DEPLOYABLE_AED;
  if (raw === undefined || raw === '') return null;
  const deployableAED = Number(raw);
  if (!Number.isFinite(deployableAED) || deployableAED <= 0) return null;

  const capRaw = process.env.LIQUIDITY_UTILISATION_CAP;
  let utilisationCap = capRaw !== undefined && capRaw !== '' ? Number(capRaw) : DEFAULT_UTILISATION_CAP;
  if (!Number.isFinite(utilisationCap) || utilisationCap <= 0 || utilisationCap > 1) {
    utilisationCap = DEFAULT_UTILISATION_CAP;
  }
  return { deployableAED, utilisationCap };
}

/**
 * Enforce the global liquidity ceiling inside the reserveAdvance tx.
 * No-op when unconfigured. Throws a transient 503 LIQUIDITY_CEILING
 * when committing the advance would exceed the cap — the pool refills
 * at the next WPS settlement, so the worker can retry later.
 *
 * Committed float is Σ amount of RESERVED, AED advances — read on the
 * SAME transaction client so it is snapshot-consistent with the write
 * the caller is about to make.
 */
export async function enforceLiquidityCeiling(
  tx: Prisma.TransactionClient,
  requestedAED: number,
): Promise<void> {
  const config = getDeployableCeiling();
  if (!config) return; // gate disabled

  const agg = await tx.advance.aggregate({
    _sum: { amount: true },
    where: { status: AdvanceStatus.RESERVED, currency: 'AED' },
  });
  const committedFloatAED = agg._sum.amount ?? 0;

  if (
    exceedsLiquidityCeiling({
      committedFloatAED,
      requestedAED,
      deployableAED: config.deployableAED,
      utilisationCap: config.utilisationCap,
    })
  ) {
    const ceiling = config.deployableAED * config.utilisationCap;
    logger.warn('liquidity ceiling hit — advance deferred', {
      committedFloatAED,
      requestedAED,
      ceiling,
      deployableAED: config.deployableAED,
      utilisationCap: config.utilisationCap,
    });
    throw new AppError(
      503,
      'LIQUIDITY_CEILING',
      'Advances are temporarily at capacity. Please try again shortly.',
      // Opaque to the worker; the numbers are for ops dashboards/logs,
      // not the client — but safe to surface (no PII, no AML signal).
      { retryable: true },
    );
  }
}
