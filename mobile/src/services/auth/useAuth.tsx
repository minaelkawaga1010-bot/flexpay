import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { tokenManager } from './tokenManager';
import { authEmitter } from './authEvents';
import { authService } from '@services/api/auth';
import { useUserStore } from '@store/useUserStore';
import { AuthUser } from '@/types/user';
import logger from '@services/utils/logger';

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isHydrating: boolean;
  login: (accessToken: string, refreshToken: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const setUser = useUserStore((s) => s.setUser);
  const clearUser = useUserStore((s) => s.clearUser);
  const user = useUserStore((s) => s.user);

  const [isHydrating, setIsHydrating] = useState(true);

  // Hydrate from secure storage on app launch.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stored = await tokenManager.getUser();
        if (mounted && stored) setUser(stored);
      } catch (err) {
        logger.warn('auth hydrate failed', { error: (err as Error).message });
      } finally {
        if (mounted) setIsHydrating(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [setUser]);

  // Listen for forced logout events from the API client.
  useEffect(() => {
    return authEmitter.on('FORCE_LOGOUT', () => {
      clearUser();
    });
  }, [clearUser]);

  const login = useCallback(
    async (accessToken: string, refreshToken: string, nextUser: AuthUser) => {
      await tokenManager.storeTokens(accessToken, refreshToken, nextUser);
      setUser(nextUser);
    },
    [setUser],
  );

  const logout = useCallback(async () => {
    // Revoke THIS device's session on the server FIRST: authService.logout()
    // reads the current refresh token from secure storage and submits it via
    // an interceptor-free request, so it MUST run before clearTokens() (which
    // erases that token). It is best-effort and never throws, but guard anyway
    // so local credentials are always cleared and the device is logged out
    // locally even if server revocation could not be confirmed (e.g. offline).
    try {
      await authService.logout();
    } catch {
      // Best-effort — local tokens still cleared.
    }
    await tokenManager.clearTokens();
    clearUser();
  }, [clearUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isHydrating,
      login,
      logout,
    }),
    [user, isHydrating, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
