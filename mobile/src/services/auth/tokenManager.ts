import * as Keychain from 'react-native-keychain';
import { Platform } from 'react-native';
import axios from 'axios';
import { apiConfig } from '@config/api';
import logger from '@services/utils/logger';
import { AuthUser } from '@/types/user';

const SERVICES = {
  ACCESS: 'flexpay.accessToken',
  REFRESH: 'flexpay.refreshToken',
  USER: 'flexpay.user',
} as const;

const writeOptions: Keychain.Options = {
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  ...(Platform.OS === 'ios'
    ? { accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE }
    : {}),
};

/**
 * Bare axios instance for the interceptor-free auth calls — token refresh and
 * server-side logout. We intentionally avoid `apiClient` to stay out of its
 * response interceptor, which on a 401 triggers a token refresh (hence a
 * refresh-token ROTATION) and retries the request. Re-entering that loop from
 * here would either refresh-on-refresh or, during logout, rotate the very
 * token we are trying to revoke and mint a fresh active session — defeating
 * logout. This client carries no Authorization header and no Idempotency-Key;
 * neither call needs them.
 */
const bareAuthClient = axios.create({
  baseURL: apiConfig.baseURL,
  timeout: apiConfig.timeout,
  headers: { 'Content-Type': 'application/json' },
});

class TokenManager {
  async storeTokens(accessToken: string, refreshToken: string, user: AuthUser): Promise<void> {
    try {
      await Promise.all([
        Keychain.setGenericPassword('access', accessToken, {
          ...writeOptions,
          service: SERVICES.ACCESS,
        }),
        Keychain.setGenericPassword('refresh', refreshToken, {
          ...writeOptions,
          service: SERVICES.REFRESH,
        }),
        Keychain.setGenericPassword('user', JSON.stringify(user), {
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
          service: SERVICES.USER,
        }),
      ]);
    } catch (err) {
      logger.error('Failed to store tokens', { error: (err as Error).message });
      throw new Error('SECURE_STORAGE_FAILED');
    }
  }

  async getAccessToken(): Promise<string | null> {
    try {
      const creds = await Keychain.getGenericPassword({ service: SERVICES.ACCESS });
      return creds ? creds.password : null;
    } catch {
      return null;
    }
  }

  async getRefreshToken(): Promise<string | null> {
    try {
      const creds = await Keychain.getGenericPassword({ service: SERVICES.REFRESH });
      return creds ? creds.password : null;
    } catch {
      return null;
    }
  }

  async getUser(): Promise<AuthUser | null> {
    try {
      const creds = await Keychain.getGenericPassword({ service: SERVICES.USER });
      if (!creds) return null;
      return JSON.parse(creds.password) as AuthUser;
    } catch {
      return null;
    }
  }

  async refreshToken(): Promise<string | null> {
    const refreshToken = await this.getRefreshToken();
    if (!refreshToken) return null;

    try {
      const { data } = await bareAuthClient.post<{
        accessToken: string;
        refreshToken: string;
      }>('/auth/refresh', { refreshToken });

      // Persist both — the backend rotates the refresh token on every call.
      await Promise.all([
        Keychain.setGenericPassword('access', data.accessToken, {
          ...writeOptions,
          service: SERVICES.ACCESS,
        }),
        Keychain.setGenericPassword('refresh', data.refreshToken, {
          ...writeOptions,
          service: SERVICES.REFRESH,
        }),
      ]);
      return data.accessToken;
    } catch (err) {
      logger.error('Token refresh failed', { error: (err as Error).message });
      return null;
    }
  }

  /**
   * Server-side logout for THIS device: submit the CURRENT refresh token to
   * POST /auth/logout so the backend revokes this device's session family
   * (TASK-AUTH-R2/R5). MUST be called BEFORE clearTokens(), while the token is
   * still in secure storage.
   *
   * Uses the interceptor-free `bareAuthClient`, so the request can never
   * re-enter apiClient's 401 -> refresh -> retry loop (which would rotate the
   * refresh token and create a NEW active session, defeating logout). The
   * token is read from the Keychain and sent ONLY in the request body — never
   * in a URL, query string, header, or log line.
   *
   * Returns true ONLY when the server confirmed the logout (HTTP 2xx). A
   * missing token, offline/timeout, or a server error all return false: the
   * caller must still clear local credentials, but server-side revocation is
   * NOT reported as confirmed.
   */
  async revokeServerSession(): Promise<boolean> {
    const refreshToken = await this.getRefreshToken();
    if (!refreshToken) {
      // No stored token -> nothing to revoke server-side (benign, e.g. the
      // session was already cleared). Not a confirmed server revocation.
      return false;
    }
    try {
      await bareAuthClient.post('/auth/logout', { refreshToken });
      return true;
    } catch (err) {
      // Offline / timeout / server error. Never surface the token value.
      logger.warn('Server-side logout not confirmed', {
        error: (err as Error).message,
      });
      return false;
    }
  }

  async clearTokens(): Promise<void> {
    await Promise.all([
      Keychain.resetGenericPassword({ service: SERVICES.ACCESS }),
      Keychain.resetGenericPassword({ service: SERVICES.REFRESH }),
      Keychain.resetGenericPassword({ service: SERVICES.USER }),
    ]);
  }

  async isAuthenticated(): Promise<boolean> {
    const [access, user] = await Promise.all([this.getAccessToken(), this.getUser()]);
    return Boolean(access && user);
  }
}

export const tokenManager = new TokenManager();
