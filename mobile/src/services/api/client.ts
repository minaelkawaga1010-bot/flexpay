import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';
import { tokenManager } from '@services/auth/tokenManager';
import { authEmitter } from '@services/auth/authEvents';
import { apiConfig } from '@config/api';
import logger from '@services/utils/logger';

export const apiClient: AxiosInstance = axios.create({
  baseURL: apiConfig.baseURL,
  timeout: apiConfig.timeout,
  headers: {
    'Content-Type': 'application/json',
    'X-App-Version': apiConfig.appVersion,
    'X-Device-OS': apiConfig.deviceOS,
  },
});

// =====================================================================
// Request interceptor: attach access token + idempotency key
// =====================================================================

const SKIP_AUTH = [
  '/auth/employee/request-otp',
  '/auth/employee/verify-otp',
  '/auth/company/register',
  '/auth/company/login',
  '/auth/refresh',
];

apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const skip = SKIP_AUTH.some((path) => config.url?.includes(path));
    if (!skip) {
      const accessToken = await tokenManager.getAccessToken();
      if (accessToken) {
        config.headers.Authorization = `Bearer ${accessToken}`;
      }
    }

    // Stamp an Idempotency-Key on mutations so the backend's service-level
    // dedupe (Wallet/Remittance) can replay safely on retry. Header name
    // matches what the backend reads.
    const method = (config.method ?? 'get').toLowerCase();
    if (['post', 'put', 'patch'].includes(method) && !config.headers['Idempotency-Key']) {
      config.headers['Idempotency-Key'] = uuid();
    }
    return config;
  },
  (error) => {
    logger.error('Request interceptor error', { error: (error as Error).message });
    return Promise.reject(error);
  },
);

// =====================================================================
// Response interceptor: 401 → refresh → retry once
// =====================================================================

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const newAccessToken = await tokenManager.refreshToken();
        if (newAccessToken) {
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          return apiClient(originalRequest);
        }
      } catch (refreshError) {
        logger.warn('Token refresh failed, forcing logout', {
          error: (refreshError as Error).message,
        });
        await tokenManager.clearTokens();
        authEmitter.emit('FORCE_LOGOUT');
        return Promise.reject(refreshError);
      }
      // Refresh returned null → also force logout.
      await tokenManager.clearTokens();
      authEmitter.emit('FORCE_LOGOUT');
    }

    if (error.response) {
      logger.error('API Error', {
        status: error.response.status,
        data: error.response.data,
        url: originalRequest?.url,
        method: originalRequest?.method,
      });
    }
    return Promise.reject(error);
  },
);

// =====================================================================
// Helpers
// =====================================================================

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

export interface ApiErrorShape {
  error: string;
  message?: string;
  details?: Array<{ field: string; message: string }>;
  statusCode: number;
}

export function handleApiError(error: unknown): ApiErrorShape {
  if (axios.isAxiosError(error) && error.response?.data) {
    const data = error.response.data as Partial<ApiErrorShape>;
    return {
      error: data.error ?? 'UNKNOWN_ERROR',
      message: data.message,
      details: data.details,
      statusCode: error.response.status,
    };
  }
  return {
    error: 'NETWORK_ERROR',
    message: 'Please check your internet connection',
    statusCode: 0,
  };
}

export default apiClient;
