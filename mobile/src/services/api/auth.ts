import apiClient from './client';
import { AuthUser } from '@types/user';

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

  async logout(): Promise<void> {
    await apiClient.post('/auth/logout', {});
  },

  async loginCompany(email: string, password: string): Promise<CompanyAuthResponse> {
    const { data } = await apiClient.post<CompanyAuthResponse>('/auth/company/login', {
      email,
      password,
    });
    return data;
  },
};
