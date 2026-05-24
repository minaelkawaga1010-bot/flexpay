/**
 * HR data-lag safety buffer — availability computation tests.
 *
 * The buffer is the structural haircut that absorbs HR-webhook sync
 * latency (a 09:00 termination that syncs at 14:00). Pure-function
 * coverage of computeAvailableLimit + normaliseBuffer.
 */

import {
  computeAvailableLimit,
  normaliseBuffer,
} from '../src/modules/payroll-routing/availability';

describe('computeAvailableLimit — HR-lag buffer', () => {
  it('a 10% buffer limits 1,000 AED accrued to 900 minus the fee', () => {
    // dcse high enough not to bind; MIN(5000,1000)=1000; ×0.9=900; −10 fee
    const limit = computeAvailableLimit({
      dcseLimit: 5000,
      accruedAmount: 1000,
      hrLagBufferPercent: 0.1,
      fee: 10,
    });
    expect(limit).toBe(890); // 900 − 10
  });

  it('a 10% buffer on 1,000 accrued with zero fee yields exactly 900', () => {
    const limit = computeAvailableLimit({
      dcseLimit: 5000,
      accruedAmount: 1000,
      hrLagBufferPercent: 0.1,
      fee: 0,
    });
    expect(limit).toBe(900);
  });

  it('a 0% buffer allows the full accrued amount (minus fee)', () => {
    const limit = computeAvailableLimit({
      dcseLimit: 5000,
      accruedAmount: 1000,
      hrLagBufferPercent: 0,
      fee: 10,
    });
    expect(limit).toBe(990);
  });

  it('the DCSE limit binds when it is below buffered accrued (I1 + buffer stack)', () => {
    // dcse 400 < accrued 1000 → base = 400; ×0.9 = 360; −10 = 350
    const limit = computeAvailableLimit({
      dcseLimit: 400,
      accruedAmount: 1000,
      hrLagBufferPercent: 0.1,
      fee: 10,
    });
    expect(limit).toBe(350);
  });

  it('never returns negative — a fee exceeding the buffered base floors at 0', () => {
    const limit = computeAvailableLimit({
      dcseLimit: 100,
      accruedAmount: 100,
      hrLagBufferPercent: 0.1,
      fee: 500,
    });
    expect(limit).toBe(0);
  });

  it('the buffered limit is always ≤ accrued — I1 holds tightly with the buffer', () => {
    for (const accrued of [50, 250, 1000, 7500]) {
      const limit = computeAvailableLimit({
        dcseLimit: 1_000_000, // non-binding
        accruedAmount: accrued,
        hrLagBufferPercent: 0.1,
        fee: 0,
      });
      expect(limit).toBeLessThanOrEqual(accrued);
    }
  });
});

describe('normaliseBuffer', () => {
  it('passes a valid fraction through', () => {
    expect(normaliseBuffer(0.1)).toBe(0.1);
  });
  it('treats null/undefined/NaN as 0 (no haircut — I1 still binds)', () => {
    expect(normaliseBuffer(null)).toBe(0);
    expect(normaliseBuffer(undefined)).toBe(0);
    expect(normaliseBuffer(NaN)).toBe(0);
  });
  it('clamps a negative buffer to 0', () => {
    expect(normaliseBuffer(-0.5)).toBe(0);
  });
  it('clamps a >=100% buffer to 0.99 (never fully zeroes from misconfig)', () => {
    expect(normaliseBuffer(1)).toBe(0.99);
    expect(normaliseBuffer(2)).toBe(0.99);
  });
});
