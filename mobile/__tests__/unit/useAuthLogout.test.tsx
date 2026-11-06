/**
 * TASK-AUTH-R7 (F-B) — logout ORDER contract in useAuth.
 *
 * The task requires submitting the current refresh token to the server
 * BEFORE clearing local credentials (the token must still be in secure
 * storage when the revoke request reads it). This proves:
 *   • server-side revocation (authService.logout) runs BEFORE
 *     tokenManager.clearTokens(), and
 *   • local credentials are ALWAYS cleared afterwards — even when the server
 *     revocation throws (offline) — so the device is logged out locally
 *     regardless of network state.
 */
import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('@services/api/auth', () => ({
  authService: { logout: jest.fn() },
}));

jest.mock('@services/auth/tokenManager', () => ({
  tokenManager: { clearTokens: jest.fn(), getUser: jest.fn() },
}));

import { authService } from '@services/api/auth';
import { tokenManager } from '@services/auth/tokenManager';
import { AuthProvider, useAuth } from '@services/auth/useAuth';

const logoutFn = authService.logout as jest.Mock;
const clearTokens = tokenManager.clearTokens as jest.Mock;
const getUser = tokenManager.getUser as jest.Mock;

const order: string[] = [];

function LogoutProbe() {
  const { logout } = useAuth();
  useEffect(() => {
    void logout();
  }, [logout]);
  return <Text>probe</Text>;
}

beforeEach(() => {
  order.length = 0;
  jest.clearAllMocks();
  getUser.mockResolvedValue(null);
  logoutFn.mockImplementation(async () => {
    order.push('revoke');
    return true;
  });
  clearTokens.mockImplementation(async () => {
    order.push('clear');
  });
});

describe('TASK-AUTH-R7 — useAuth.logout order (F-B)', () => {
  it('revokes server-side FIRST, then clears local credentials', async () => {
    render(
      <AuthProvider>
        <LogoutProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(order).toEqual(['revoke', 'clear']));
  });

  it('still clears local credentials when server revocation throws (offline)', async () => {
    logoutFn.mockImplementationOnce(async () => {
      order.push('revoke');
      throw new Error('offline');
    });

    render(
      <AuthProvider>
        <LogoutProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(order).toEqual(['revoke', 'clear']));
  });
});
