import * as Keychain from 'react-native-keychain';
import { Platform } from 'react-native';
import axios from 'axios';
import { apiConfig } from '@config/api';
import logger from '@services/utils/logger';
import { AuthUser } from '@types/user';

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
 * Bare axios instance for the refresh call. We intentionally avoid
 * `apiClient` to break a refresh-on-refresh loop: the response interceptor
 * itself triggers refresh on 401, and using apiClient here would re-enter.
 */
const refreshClient = axios.create({
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
      const { data } = await refreshClient.post<{
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
