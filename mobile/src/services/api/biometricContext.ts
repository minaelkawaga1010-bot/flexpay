import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import logger from '@services/utils/logger';

/**
 * Biometric attestation cache — mirrors the backend's freshness window
 * exactly so we fail-fast on the client rather than burning a network
 * round-trip on a stale assertion.
 *
 * Backend contract (biometrics-verify.ts):
 *   FRESHNESS_WINDOW_MS = 60_000
 *   CLOCK_SKEW_MS       = 30_000
 *
 * We use a tighter 55s client-side window so a request that *just*
 * passes the freshness check on our clock can't get rejected as stale
 * on the server clock. The skew tolerance still lets us catch genuine
 * NTP drift between device and server.
 */

const CLIENT_FRESHNESS_MS = 55_000;

type BiometricType = 'faceid' | 'touchid' | 'passcode' | 'fingerprint';

interface Attestation {
  type: BiometricType;
  verifiedAt: number; // unix ms — set to Date.now() on success
}

let current: Attestation | null = null;
const rnBiometrics = new ReactNativeBiometrics();

function mapType(biometry: string | null | undefined): BiometricType {
  if (biometry === BiometryTypes.FaceID) return 'faceid';
  if (biometry === BiometryTypes.TouchID) return 'touchid';
  if (biometry === BiometryTypes.Biometrics) return 'fingerprint';
  return 'passcode';
}

export const biometricContext = {
  /**
   * Headers to attach to a transactional request. Returns null when the
   * cached assertion is missing or stale — caller is expected to prompt
   * a fresh biometric scan and retry.
   */
  freshHeaders(): { 'X-Biometric-Type': BiometricType; 'X-Biometric-Verified-At': string } | null {
    if (!current) return null;
    const age = Date.now() - current.verifiedAt;
    if (age < 0 || age > CLIENT_FRESHNESS_MS) {
      current = null;
      return null;
    }
    return {
      'X-Biometric-Type': current.type,
      'X-Biometric-Verified-At': String(current.verifiedAt),
    };
  },

  /**
   * Prompt the user for a fresh biometric scan and, on success, record
   * the attestation in the in-memory cache. Returns true iff the
   * assertion is now fresh and ready to attach to the next request.
   *
   * The reason string is surfaced to the OS prompt — keep it concrete
   * ("Authorize advance request" beats "Authorize action").
   */
  async authenticateFresh(reason: string): Promise<boolean> {
    try {
      const sensor = await rnBiometrics.isSensorAvailable();
      if (!sensor.available) {
        logger.warn('biometric sensor unavailable', { reason });
        return false;
      }
      const { success } = await rnBiometrics.simplePrompt({
        promptMessage: reason,
        cancelButtonText: 'Cancel',
      });
      if (!success) return false;
      current = { type: mapType(sensor.biometryType), verifiedAt: Date.now() };
      return true;
    } catch (err) {
      logger.warn('biometric prompt failed', { error: (err as Error).message });
      return false;
    }
  },

  /**
   * Forcibly clear the cached assertion. Called on logout + on every
   * detected stale-biometric server response so the next try re-prompts.
   */
  clear(): void {
    current = null;
  },

  /** Test-only injection point. */
  _testSet(att: Attestation | null): void {
    current = att;
  },
};
