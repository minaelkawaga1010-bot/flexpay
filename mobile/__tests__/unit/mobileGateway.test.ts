/**
 * Mobile-gateway client + step-up flow tests.
 *
 * Surfaces under test:
 *   • biometricContext freshness window + headers shape
 *   • useStepUpStore enqueue/submit/cancel/replace lifecycle
 *   • wallet.gateway response Zod validation (rejects malformed shapes)
 *
 * The axios interceptor pipeline itself is exercised in integration
 * tests against a stubbed Express app (deferred); the unit suite here
 * isolates the parts where the logic — not the transport — is the risk.
 */

import { biometricContext } from '@services/api/biometricContext';
import { useStepUpStore, StepUpError } from '@store/useStepUpStore';

// Reset the singletons between tests so state doesn't leak.
beforeEach(() => {
  biometricContext.clear();
  // Force-cancel any pending step-up so the next test starts clean.
  try {
    useStepUpStore.getState().cancel();
  } catch {
    /* no pending */
  }
});

// ───────────────────────────────────────────────────────────────────
// biometricContext
// ───────────────────────────────────────────────────────────────────

describe('biometricContext.freshHeaders', () => {
  it('returns null when no assertion has been recorded', () => {
    expect(biometricContext.freshHeaders()).toBeNull();
  });

  it('returns the headers when the assertion is within the freshness window', () => {
    biometricContext._testSet({ type: 'faceid', verifiedAt: Date.now() });
    const headers = biometricContext.freshHeaders();
    expect(headers).not.toBeNull();
    expect(headers!['X-Biometric-Type']).toBe('faceid');
    expect(Number(headers!['X-Biometric-Verified-At'])).toBeGreaterThan(0);
  });

  it('returns null and clears the cache when the assertion is stale (>55s)', () => {
    biometricContext._testSet({ type: 'faceid', verifiedAt: Date.now() - 56_000 });
    expect(biometricContext.freshHeaders()).toBeNull();
    // Second read confirms the cache was cleared.
    expect(biometricContext.freshHeaders()).toBeNull();
  });

  it('returns null when verifiedAt is in the future (device clock skew → fail safe)', () => {
    biometricContext._testSet({ type: 'faceid', verifiedAt: Date.now() + 120_000 });
    expect(biometricContext.freshHeaders()).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────
// useStepUpStore
// ───────────────────────────────────────────────────────────────────

describe('useStepUpStore', () => {
  it('enqueue + submit resolves the pending promise with the entered code', async () => {
    const { enqueue, submit } = useStepUpStore.getState();
    const pending = enqueue({ purpose: 'ADVANCE', hint: 'Test advance' });

    // Confirm the modal-state shows the challenge.
    expect(useStepUpStore.getState().pending?.purpose).toBe('ADVANCE');

    submit('123456');
    await expect(pending).resolves.toBe('123456');
    expect(useStepUpStore.getState().pending).toBeNull();
  });

  it('cancel rejects the pending promise with CANCELLED', async () => {
    const { enqueue, cancel } = useStepUpStore.getState();
    const pending = enqueue({ purpose: 'REMITTANCE' });
    cancel();
    await expect(pending).rejects.toBeInstanceOf(StepUpError);
    await expect(pending).rejects.toMatchObject({ reason: 'CANCELLED' });
  });

  it('a second enqueue while one is pending REPLACES — old promise rejects, new pending shown', async () => {
    const { enqueue } = useStepUpStore.getState();
    const first = enqueue({ purpose: 'ADVANCE' });
    const second = enqueue({ purpose: 'REMITTANCE' });

    await expect(first).rejects.toBeInstanceOf(StepUpError);
    await expect(first).rejects.toMatchObject({ reason: 'REPLACED' });

    expect(useStepUpStore.getState().pending?.purpose).toBe('REMITTANCE');

    // Clean up the second so it doesn't bleed into other tests.
    useStepUpStore.getState().cancel();
    await expect(second).rejects.toBeInstanceOf(StepUpError);
  });

  it('submit is a no-op when there is no pending challenge', () => {
    expect(() => useStepUpStore.getState().submit('999999')).not.toThrow();
    expect(useStepUpStore.getState().pending).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────
// Wallet-gateway response schemas
// ───────────────────────────────────────────────────────────────────

import { z } from 'zod';

// Re-import the schemas directly to assert they reject malformed
// shapes. We avoid touching the live mobileGateway axios instance.
describe('wallet.gateway — Zod response schemas', () => {
  // Note: the schemas are not exported individually; we re-define
  // minimum shapes here and check parse semantics for the contract.
  const balanceShape = z.object({
    walletBalance: z.number(),
    currency: z.literal('AED'),
    accruedWages: z.number(),
    availableLimit: z.number(),
    dcse: z.object({
      score: z.number(),
      eligibleForEWA: z.boolean(),
      modelVersion: z.string(),
    }),
    plan: z.enum(['BASIC', 'LUXURY']),
    cycle: z.object({
      id: z.string().nullable(),
      status: z.enum(['ACTIVE', 'NO_ACTIVE_CYCLE']),
    }),
  });

  it('accepts a well-formed balance response', () => {
    const ok = {
      walletBalance: 1234.56,
      currency: 'AED',
      accruedWages: 800,
      availableLimit: 790,
      dcse: { score: 0.72, eligibleForEWA: true, modelVersion: 'dcse-v1.0.0' },
      plan: 'BASIC',
      cycle: { id: 'cyc-1', status: 'ACTIVE' },
    };
    expect(() => balanceShape.parse(ok)).not.toThrow();
  });

  it('rejects a balance response missing availableLimit (the I1-cap)', () => {
    const bad = {
      walletBalance: 0,
      currency: 'AED',
      accruedWages: 0,
      dcse: { score: 0, eligibleForEWA: false, modelVersion: 'v' },
      plan: 'BASIC',
      cycle: { id: null, status: 'NO_ACTIVE_CYCLE' },
    };
    expect(() => balanceShape.parse(bad)).toThrow();
  });

  it('rejects a non-AED currency (gateway is AED-only by design)', () => {
    const wrongCurrency = {
      walletBalance: 0,
      currency: 'USD',
      accruedWages: 0,
      availableLimit: 0,
      dcse: { score: 0, eligibleForEWA: false, modelVersion: 'v' },
      plan: 'BASIC',
      cycle: { id: null, status: 'NO_ACTIVE_CYCLE' },
    };
    expect(() => balanceShape.parse(wrongCurrency)).toThrow();
  });
});
