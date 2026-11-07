import apiClient from './client';
import { tokenManager } from '@services/auth/tokenManager';
import { AuthUser } from '@/types/user';

export interface VerifyOtpResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface CompanyAuthResponse {
  accessToken: string;
  refreshToken: string;
  company: { id: string; name: string; balance: number; adminEmail: string };
}

export const authService = {
  async requestOTP(payload: { phone: string }): Promise<{ message: string }> {
    const { data } = await apiClient.post<{ message: string }>(
      '/auth/employee/request-otp',
      payload,
    );
    return data;
  },

  async verifyOTP(payload: {
    phone: string;
    otp: string;
    fullName?: string;
    salary?: number;
    referralCode?: string;
  }): Promise<VerifyOtpResponse> {
    const { data } = await apiClient.post<VerifyOtpResponse>(
      '/auth/employee/verify-otp',
      payload,
    );
    return data;
  },

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const { data } = await apiClient.post<{ accessToken: string; refreshToken: string }>(
      '/auth/refresh',
      { refreshToken },
    );
    return data;
  },

  /**
   * Server-side logout. Delegates to tokenManager so the request carries the
   * CURRENT refresh token from secure storage via the interceptor-free client
   * (see tokenManager.requestServerLogout), which lets the backend revoke THIS
   * device's session family. Resolves to true when the server ACKNOWLEDGED the
   * request (HTTP 2xx) — NOT an independent proof of revocation, since the
   * backend returns 200 even for an unknown/invalid token. Never throws —
   * logout must not be blocked by the network. Deliberately NOT sent through
   * `apiClient`: that path would attach the access token and, on a 401, rotate
   * the refresh token mid-logout.
   */
  async logout(): Promise<boolean> {
    return tokenManager.requestServerLogout();
  },

  async loginCompany(email: string, password: string): Promise<CompanyAuthResponse> {
    const { data } = await apiClient.post<CompanyAuthResponse>('/auth/company/login', {
      email,
      password,
    });
    return data;
  },
};
