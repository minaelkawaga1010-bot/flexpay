/**
 * TASK-AUTH-R7 (F-B) — authService.logout() delegation + interceptor bypass.
 *
 * Proves logout is routed through tokenManager.revokeServerSession() (the
 * interceptor-free, token-bearing path) and is NEVER sent through the
 * intercepted apiClient — whose response interceptor would, on a 401, rotate
 * the refresh token mid-logout and mint a fresh active session. This also
 * guards against a regression to the old empty-body
 * `apiClient.post('/auth/logout', {})`, which revoked nothing server-side.
 */

jest.mock('@services/api/client', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('@services/auth/tokenManager', () => ({
  tokenManager: { revokeServerSession: jest.fn() },
}));

import apiClient from '@services/api/client';
import { tokenManager } from '@services/auth/tokenManager';
import { authService } from '@services/api/auth';

const apiClientPost = apiClient.post as jest.Mock;
const revokeServerSession = tokenManager.revokeServerSession as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TASK-AUTH-R7 — authService.logout (F-B)', () => {
  it('delegates to tokenManager.revokeServerSession and NEVER calls the intercepted apiClient', async () => {
    revokeServerSession.mockResolvedValueOnce(true);

    const result = await authService.logout();

    expect(result).toBe(true);
    expect(revokeServerSession).toHaveBeenCalledTimes(1);
    // No empty-body logout, and nothing through the 401→refresh→retry client.
    expect(apiClientPost).not.toHaveBeenCalled();
  });

  it('propagates an unconfirmed (false) server revocation without throwing', async () => {
    revokeServerSession.mockResolvedValueOnce(false);

    await expect(authService.logout()).resolves.toBe(false);
    expect(apiClientPost).not.toHaveBeenCalled();
  });
});
