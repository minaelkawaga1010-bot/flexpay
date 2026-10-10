import { roundCurrency, formatAED } from '../src/shared/utils/currency';

/**
 * TASK-001 regression suite — exact decimal rounding.
 *
 * Policy under test: ROUND_HALF_UP away from zero (symmetric for
 * negatives), to 2 decimal places (fils). These pin the boundary
 * behaviour the old `Math.round(x*100)/100` got wrong.
 */
describe('roundCurrency — half-boundary (the old bug)', () => {
  it('rounds .xx5 boundaries up, positive', () => {
    expect(roundCurrency(1.005)).toBe(1.01);
    expect(roundCurrency(2.675)).toBe(2.68);
    expect(roundCurrency(0.615)).toBe(0.62);
  });

  it('rounds symmetrically away from zero, negative', () => {
    expect(roundCurrency(-1.005)).toBe(-1.01);
    expect(roundCurrency(-2.675)).toBe(-2.68);
    expect(roundCurrency(-0.615)).toBe(-0.62);
  });

  it('handles larger amounts', () => {
    expect(roundCurrency(12345.675)).toBe(12345.68);
    expect(roundCurrency(99999.005)).toBe(99999.01);
  });
});

describe('roundCurrency — non-boundary & identity', () => {
  it('rounds just-below-half down', () => {
    expect(roundCurrency(1.004)).toBe(1.0);
    expect(roundCurrency(-1.004)).toBe(-1.0);
  });

  it('leaves clean values unchanged', () => {
    expect(roundCurrency(0)).toBe(0);
    expect(roundCurrency(10)).toBe(10);
    expect(roundCurrency(10.5)).toBe(10.5);
    expect(roundCurrency(10.42)).toBe(10.42);
  });

  it('is idempotent (re-rounding a rounded value is a no-op)', () => {
    const r = roundCurrency(2.675);
    expect(roundCurrency(r)).toBe(r);
  });
});

describe('roundCurrency — non-finite passthrough (behaviour preserved)', () => {
  it('returns NaN / ±Infinity unchanged', () => {
    expect(roundCurrency(Number.NaN)).toBeNaN();
    expect(roundCurrency(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(roundCurrency(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('formatAED — uses the corrected rounding', () => {
  it('prefixes AED and renders 2dp', () => {
    expect(formatAED(1.005)).toBe('AED 1.01');
    expect(formatAED(1000)).toBe('AED 1000.00');
    expect(formatAED(2.675)).toBe('AED 2.68');
  });
});
