/**
 * Global liquidity gate — Day-Zero §P0.
 *
 * Caps total RESERVED advance float against the deployable-capital
 * ceiling so the platform can never front more than it holds. Off by
 * default (unconfigured); enforced when LIQUIDITY_DEPLOYABLE_AED is set.
 */

import {
  exceedsLiquidityCeiling,
  getDeployableCeiling,
  enforceLiquidityCeiling,
  DEFAULT_UTILISATION_CAP,
} from '../src/modules/payroll-routing/liquidity-gate';

const ENV_KEYS = ['LIQUIDITY_DEPLOYABLE_AED', 'LIQUIDITY_UTILISATION_CAP'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ───────────────────────────────────────────────────────────────────
// Pure decision
// ───────────────────────────────────────────────────────────────────

describe('exceedsLiquidityCeiling', () => {
  it('allows a commit below the ceiling', () => {
    expect(
      exceedsLiquidityCeiling({
        committedFloatAED: 800_000,
        requestedAED: 500,
        deployableAED: 1_000_000,
        utilisationCap: 0.85,
      }),
    ).toBe(false); // 800,500 < 850,000
  });

  it('rejects a commit that would cross the ceiling', () => {
    expect(
      exceedsLiquidityCeiling({
        committedFloatAED: 849_900,
        requestedAED: 500,
        deployableAED: 1_000_000,
        utilisationCap: 0.85,
      }),
    ).toBe(true); // 850,400 > 850,000
  });

  it('treats the exact ceiling as allowed (strict >)', () => {
    expect(
      exceedsLiquidityCeiling({
        committedFloatAED: 849_500,
        requestedAED: 500,
        deployableAED: 1_000_000,
        utilisationCap: 0.85,
      }),
    ).toBe(false); // 850,000 == ceiling → allowed
  });
});

// ───────────────────────────────────────────────────────────────────
// Env parsing
// ───────────────────────────────────────────────────────────────────

describe('getDeployableCeiling', () => {
  it('returns null (gate off) when unconfigured', () => {
    delete process.env.LIQUIDITY_DEPLOYABLE_AED;
    expect(getDeployableCeiling()).toBeNull();
  });

  it('parses the deployable amount + default cap', () => {
    process.env.LIQUIDITY_DEPLOYABLE_AED = '2000000';
    delete process.env.LIQUIDITY_UTILISATION_CAP;
    expect(getDeployableCeiling()).toEqual({
      deployableAED: 2_000_000,
      utilisationCap: DEFAULT_UTILISATION_CAP,
    });
  });

  it('honours a custom utilisation cap', () => {
    process.env.LIQUIDITY_DEPLOYABLE_AED = '2000000';
    process.env.LIQUIDITY_UTILISATION_CAP = '0.7';
    expect(getDeployableCeiling()?.utilisationCap).toBe(0.7);
  });

  it('falls back to default cap on an out-of-range value', () => {
    process.env.LIQUIDITY_DEPLOYABLE_AED = '2000000';
    process.env.LIQUIDITY_UTILISATION_CAP = '1.5';
    expect(getDeployableCeiling()?.utilisationCap).toBe(DEFAULT_UTILISATION_CAP);
  });

  it('returns null on a non-positive / invalid deployable', () => {
    process.env.LIQUIDITY_DEPLOYABLE_AED = '0';
    expect(getDeployableCeiling()).toBeNull();
    process.env.LIQUIDITY_DEPLOYABLE_AED = 'abc';
    expect(getDeployableCeiling()).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────
// enforceLiquidityCeiling (mocked tx)
// ───────────────────────────────────────────────────────────────────

function mockTx(reservedSum: number): any {
  return {
    advance: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: reservedSum } }),
    },
  };
}

describe('enforceLiquidityCeiling', () => {
  it('is a no-op when the gate is unconfigured (never queries committed float)', async () => {
    delete process.env.LIQUIDITY_DEPLOYABLE_AED;
    const tx = mockTx(999_999_999);
    await expect(enforceLiquidityCeiling(tx, 5000)).resolves.toBeUndefined();
    expect(tx.advance.aggregate).not.toHaveBeenCalled();
  });

  it('allows an advance within the ceiling', async () => {
    process.env.LIQUIDITY_DEPLOYABLE_AED = '1000000';
    process.env.LIQUIDITY_UTILISATION_CAP = '0.85';
    const tx = mockTx(800_000);
    await expect(enforceLiquidityCeiling(tx, 500)).resolves.toBeUndefined();
  });

  it('throws 503 LIQUIDITY_CEILING when the pool is at capacity', async () => {
    process.env.LIQUIDITY_DEPLOYABLE_AED = '1000000';
    process.env.LIQUIDITY_UTILISATION_CAP = '0.85';
    const tx = mockTx(849_900);
    await expect(enforceLiquidityCeiling(tx, 500)).rejects.toMatchObject({
      status: 503,
      code: 'LIQUIDITY_CEILING',
    });
  });

  it('treats a null aggregate (empty pool) as zero committed float', async () => {
    process.env.LIQUIDITY_DEPLOYABLE_AED = '1000000';
    const tx: any = {
      advance: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) },
    };
    await expect(enforceLiquidityCeiling(tx, 5000)).resolves.toBeUndefined();
  });
});
