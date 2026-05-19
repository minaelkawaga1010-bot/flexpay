import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import { Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';
import logger from '@services/utils/logger';

/**
 * Per-install device fingerprint.
 *
 * Contract from the backend's deviceHeadersSchema (mobile-api.dto.ts):
 *   • min length 16 — UUID v4 (36) trivially clears this.
 *   • survives app launches (so TOFU registration succeeds once, then
 *     every subsequent request resolves to a known device).
 *   • does NOT survive uninstall (fresh install → new fingerprint → new
 *     TOFU registration, which is correct behaviour: a reinstall on a
 *     stolen device should be treated as a new device requiring auth).
 *
 * Storage:
 *   Keychain with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` so the value cannot
 *   migrate to a cloud restore on a different physical device. Bound to
 *   the secure enclave on iOS where supported.
 *
 * NOT a true "hardware-bound fingerprint" — that's the Phase-2
 * hardening (App Attest / Play Integrity) called out in STRATEGY.md
 * §15.4. The current install-bound value is what the backend
 * device-binding middleware expects today.
 */

const SERVICE = 'flexpay.deviceFingerprint';
const writeOpts: Keychain.Options = {
  service: SERVICE,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

let cached: string | null = null;

async function generate(): Promise<string> {
  const raw = uuid();
  await Keychain.setGenericPassword('device', raw, writeOpts);
  logger.info('device fingerprint generated', { service: SERVICE });
  return raw;
}

export const deviceFingerprint = {
  /**
   * Lazy-init: first call after install generates + persists; subsequent
   * calls hit the keychain (then the in-memory cache). The whole
   * function MUST be fast — it's called on every authenticated request.
   */
  async get(): Promise<string> {
    if (cached) return cached;
    try {
      const stored = await Keychain.getGenericPassword({ service: SERVICE });
      if (stored && stored.password.length >= 16) {
        cached = stored.password;
        return cached;
      }
    } catch (err) {
      logger.warn('device fingerprint read failed; regenerating', {
        error: (err as Error).message,
      });
    }
    cached = await generate();
    return cached;
  },

  /**
   * Used only on explicit "log out from this device" — the user
   * effectively asks for a fresh TOFU registration on next login.
   */
  async reset(): Promise<void> {
    await Keychain.resetGenericPassword({ service: SERVICE });
    cached = null;
  },

  /** Stable platform tag the backend's enum validator expects. */
  platform(): 'ios' | 'android' {
    return Platform.OS === 'android' ? 'android' : 'ios';
  },
};
