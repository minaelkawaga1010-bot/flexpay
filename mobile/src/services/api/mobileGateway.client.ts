import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import axios, {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from 'axios';
import { apiConfig } from '@config/api';
import { tokenManager } from '@services/auth/tokenManager';
import { authEmitter } from '@services/auth/authEvents';
import { deviceFingerprint } from './deviceFingerprint';
import { biometricContext } from './biometricContext';
import { useStepUpStore, type StepUpPurpose, StepUpError } from '@store/useStepUpStore';
import logger from '@services/utils/logger';

/**
 * Dedicated client for the mobile API gateway (/mobile/wallet/*).
 *
 * This is its own axios instance — not the generic apiClient — because
 * the gateway enforces a richer header contract:
 *
 *   Always:
 *     • Authorization        Bearer <access token>
 *     • X-Device-Fingerprint <≥16-char install-bound id>
 *     • X-Device-Platform    "ios" | "android"
 *     • X-App-Version        semver
 *
 *   On transactional routes (the per-call interceptor adds these only
 *   when the request config sets `meta.requiresBiometric = true`):
 *     • X-Biometric-Type        "faceid" | "touchid" | "fingerprint" | "passcode"
 *     • X-Biometric-Verified-At unix ms (within 55s of now, server window 60s)
 *
 *   On step-up routes (added by the response interceptor on retry):
 *     • X-Step-Up-OTP        6-digit purpose-partitioned code
 *
 *   On every mutation:
 *     • Idempotency-Key      uuid v4 — service-level dedupe on the
 *                            backend's EmployeeTransaction.idempotencyKey
 *                            unique index. Carried across retries so the
 *                            retry IS the same logical operation.
 */

declare module 'axios' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  export interface AxiosRequestConfig {
    meta?: {
      /** If true, attach biometric headers; fail-fast if assertion stale. */
      requiresBiometric?: boolean;
      /** Step-up purpose for this transactional request — drives the OTP modal scoping. */
      stepUpPurpose?: StepUpPurpose;
      /** Set by the response interceptor when a retry has already been issued. */
      _stepUpRetried?: boolean;
      _authRetried?: boolean;
    };
  }
}

export class BiometricStaleError extends Error {
  constructor() {
    super('BIOMETRIC_STALE');
    this.name = 'BiometricStaleError';
  }
}

export class ComplianceBlockError extends Error {
  constructor(
    public readonly code: string,
    public readonly serverMessage: string,
    public readonly details?: unknown,
  ) {
    super(`COMPLIANCE_BLOCK:${code}`);
    this.name = 'ComplianceBlockError';
  }
}

/**
 * Server error shape the backend's error-handler emits — see
 * src/shared/middleware/error-handler.ts.
 */
interface ServerError {
  error: string;
  message?: string;
  details?: unknown;
}

function isServerError(x: unknown): x is ServerError {
  return typeof x === 'object' && x !== null && 'error' in x;
}

/**
 * Detect a step-up-OTP-required 403. The backend's requireStepUpOtp
 * middleware emits Forbidden() (HTTP 403) with one of two messages —
 * we match on either to stay resilient to wording drift.
 */
function isStepUpRequired(err: AxiosError): boolean {
  if (err.response?.status !== 403) return false;
  const body = err.response.data;
  if (!isServerError(body)) return false;
  const msg = (body.message ?? '').toLowerCase();
  return (
    msg.includes('step-up otp required') ||
    msg.includes('invalid or expired step-up otp')
  );
}

function isBiometricStale(err: AxiosError): boolean {
  if (err.response?.status !== 403) return false;
  const body = err.response.data;
  if (!isServerError(body)) return false;
  const msg = (body.message ?? '').toLowerCase();
  return msg.includes('biometric');
}

function isComplianceBlock(err: AxiosError): boolean {
  return err.response?.status === 451;
}

// =====================================================================
// Axios instance
// =====================================================================

export const mobileGateway: AxiosInstance = axios.create({
  // The gateway endpoints live under /mobile/wallet/* of the same
  // /api/v1 prefix. We keep the full prefix here so callers write
  // service URLs without `/mobile/wallet/` repetition.
  baseURL: `${apiConfig.baseURL}/mobile/wallet`,
  timeout: apiConfig.timeout,
  headers: { 'Content-Type': 'application/json' },
});

// ───────────────────────────────────────────────────────────────────
// Request interceptor — header injection
// ───────────────────────────────────────────────────────────────────

mobileGateway.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const [accessToken, fingerprint] = await Promise.all([
      tokenManager.getAccessToken(),
      deviceFingerprint.get(),
    ]);

    if (accessToken) {
      config.headers.set('Authorization', `Bearer ${accessToken}`);
    }
    config.headers.set('X-Device-Fingerprint', fingerprint);
    config.headers.set('X-Device-Platform', deviceFingerprint.platform());
    config.headers.set('X-App-Version', apiConfig.appVersion);

    // Idempotency on mutations — carried across retries (the response
    // interceptor uses the SAME config object, so this key persists).
    const method = (config.method ?? 'get').toLowerCase();
    if (
      ['post', 'put', 'patch', 'delete'].includes(method) &&
      !config.headers.get('Idempotency-Key')
    ) {
      config.headers.set('Idempotency-Key', uuid());
    }

    // Biometric attestation — only when the route opts in via meta.
    // Fail-fast here saves a server round-trip on a known-stale claim.
    if (config.meta?.requiresBiometric) {
      const headers = biometricContext.freshHeaders();
      if (!headers) {
        throw new BiometricStaleError();
      }
      config.headers.set('X-Biometric-Type', headers['X-Biometric-Type']);
      config.headers.set('X-Biometric-Verified-At', headers['X-Biometric-Verified-At']);
    }

    return config;
  },
);

// ───────────────────────────────────────────────────────────────────
// Response interceptor — 401 refresh × step-up × compliance × biometric
// ───────────────────────────────────────────────────────────────────

mobileGateway.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const config = error.config as InternalAxiosRequestConfig | undefined;
    if (!config) return Promise.reject(error);
    config.meta = config.meta ?? {};

    // ── 401: refresh access token, retry ONCE.
    if (error.response?.status === 401 && !config.meta._authRetried) {
      config.meta._authRetried = true;
      const fresh = await tokenManager.refreshToken();
      if (!fresh) {
        await tokenManager.clearTokens();
        authEmitter.emit('FORCE_LOGOUT');
        return Promise.reject(error);
      }
      config.headers.set('Authorization', `Bearer ${fresh}`);
      return mobileGateway(config);
    }

    // ── 451: compliance block. NEVER retry — the user is freezed
    //    pending ops review. Surface a typed error so the UI can route
    //    to the "contact compliance" screen.
    if (isComplianceBlock(error)) {
      const body = isServerError(error.response?.data) ? error.response!.data : null;
      const e = new ComplianceBlockError(
        body?.error ?? 'COMPLIANCE_BLOCK',
        body?.message ?? 'Account flagged — money movement disabled.',
        body?.details,
      );
      logger.warn('compliance block', { code: e.code, message: e.serverMessage });
      return Promise.reject(e);
    }

    // ── 403 biometric stale: clear the cache and bubble — the caller
    //    layer re-prompts (it knows the user-facing copy) and retries.
    if (isBiometricStale(error)) {
      biometricContext.clear();
      return Promise.reject(new BiometricStaleError());
    }

    // ── 403 step-up required: open the OTP modal, await user code,
    //    inject the X-Step-Up-OTP header, retry ONCE.
    if (isStepUpRequired(error) && !config.meta._stepUpRetried) {
      config.meta._stepUpRetried = true;
      // The purpose is set by the calling service via config.meta. If
      // it's missing we fall back to ADVANCE, but the service-layer
      // helpers below always set it explicitly.
      const purpose: StepUpPurpose = config.meta.stepUpPurpose ?? 'ADVANCE';
      try {
        const code = await useStepUpStore.getState().enqueue({ purpose });
        config.headers.set('X-Step-Up-OTP', code);
        return mobileGateway(config);
      } catch (stepUpErr) {
        if (stepUpErr instanceof StepUpError) {
          logger.info('step-up rejected by user', { reason: stepUpErr.reason });
          return Promise.reject(stepUpErr);
        }
        return Promise.reject(stepUpErr);
      }
    }

    if (error.response) {
      logger.error('mobile-gateway API error', {
        status: error.response.status,
        data: error.response.data,
        url: config.url,
        method: config.method,
      });
    }
    return Promise.reject(error);
  },
);

export default mobileGateway;
