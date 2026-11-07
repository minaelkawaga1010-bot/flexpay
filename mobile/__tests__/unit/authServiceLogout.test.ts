/**
 * TASK-AUTH-R7 / R7A (F-B) — authService.logout() delegation + interceptor bypass.
 *
 * Proves logout is routed through tokenManager.requestServerLogout() (the
 * interceptor-free, token-bearing path) and is NEVER sent through the
 * intercepted apiClient — whose response interceptor would, on a 401, rotate
 * the refresh token mid-logout and mint a fresh active session. This also
 * guards against a regression to the old empty-body
 * `apiClient.post('/auth/logout', {})`, which revoked nothing server-side.
 * The boolean it returns is a 2xx ACKNOWLEDGEMENT, not a proof of revocation.
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
  tokenManager: { requestServerLogout: jest.fn() },
}));

import apiClient from '@services/api/client';
import { tokenManager } from '@services/auth/tokenManager';
import { authService } from '@services/api/auth';

const apiClientPost = apiClient.post as jest.Mock;
const requestServerLogout = tokenManager.requestServerLogout as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TASK-AUTH-R7A — authService.logout (F-B)', () => {
  it('delegates to tokenManager.requestServerLogout and NEVER calls the intercepted apiClient', async () => {
    requestServerLogout.mockResolvedValueOnce(true);

    const result = await authService.logout();

    expect(result).toBe(true); // 2xx acknowledged (not verified revocation)
    expect(requestServerLogout).toHaveBeenCalledTimes(1);
    // No empty-body logout, and nothing through the 401→refresh→retry client.
    expect(apiClientPost).not.toHaveBeenCalled();
  });

  it('propagates a not-acknowledged (false) result without throwing', async () => {
    requestServerLogout.mockResolvedValueOnce(false);

    await expect(authService.logout()).resolves.toBe(false);
    expect(apiClientPost).not.toHaveBeenCalled();
  });
});
