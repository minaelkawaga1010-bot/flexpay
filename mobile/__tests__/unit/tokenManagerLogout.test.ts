/**
 * TASK-AUTH-R7 / R7A — mobile server-side logout request (finding F-B) and its
 * ACKNOWLEDGEMENT contract.
 *
 * Proves tokenManager.requestServerLogout():
 *   • submits the CURRENT refresh token (read from secure storage) to
 *     POST /auth/logout, with the token ONLY in the request body,
 *   • uses the interceptor-free bare client (no Authorization header, no
 *     per-request config) so the request can never re-enter apiClient's
 *     401 → refresh → rotate loop,
 *   • returns true on a 2xx meaning REQUEST ACKNOWLEDGED (NOT independently
 *     verified revocation — the backend returns 200 even for unknown/invalid
 *     tokens; that end-to-end property is proven by the backend E2E suite),
 *   • FAILS SAFE on missing token / offline / server error / storage error:
 *     returns false, never throws, and never leaks the token (even one embedded
 *     in the error message) or any request detail to logs.
 *
 * Synthetic tokens only. The bare client's transport is mocked so no real
 * network call is attempted.
 */

// Mock axios so the bare client's transport is fully controlled. The single
// `instance` is shared across every axios.create() call; its `.post` is the
// jest.fn we drive. Everything lives INSIDE the factory to satisfy jest's
// out-of-scope-variable rule and to avoid the import/TDZ ordering trap.
jest.mock('axios', () => {
  const instance = {
    post: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return {
    __esModule: true,
    default: { create: jest.fn(() => instance) },
    isAxiosError: (e: unknown) => Boolean(e && (e as { isAxiosError?: boolean }).isAxiosError),
  };
});

import axios from 'axios';
import * as Keychain from 'react-native-keychain';
import { tokenManager } from '@services/auth/tokenManager';
import logger from '@services/utils/logger';

const REFRESH_SERVICE = 'flexpay.refreshToken';
const STORED_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.SYNTHETIC-R7-REFRESH-TOKEN.sig';

// The bare-client instance tokenManager created at module load.
const bareClient = (axios.create as unknown as jest.Mock).mock.results[0].value as {
  post: jest.Mock;
};
const mockPost = bareClient.post;
const getPwd = Keychain.getGenericPassword as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // Default: a refresh token IS present in secure storage under the REFRESH
  // service only (access/user services return nothing).
  getPwd.mockImplementation(async (opts?: { service?: string }) => {
    if (opts?.service === REFRESH_SERVICE) {
      return { username: 'refresh', password: STORED_TOKEN, service: REFRESH_SERVICE };
    }
    return false;
  });
});

describe('TASK-AUTH-R7A — tokenManager.requestServerLogout (F-B ack contract)', () => {
  it('submits the current refresh token to /auth/logout and returns true (ACKNOWLEDGED) on 2xx', async () => {
    mockPost.mockResolvedValueOnce({ status: 200, data: { message: 'Logged out successfully' } });

    const result = await tokenManager.requestServerLogout();

    // true == the server acknowledged the request (HTTP 2xx); NOT a proof of
    // revocation (see the backend E2E suite for the end-to-end revocation).
    expect(result).toBe(true);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/auth/logout', { refreshToken: STORED_TOKEN });
    // The token is read from the REFRESH keychain service specifically.
    expect(getPwd).toHaveBeenCalledWith({ service: REFRESH_SERVICE });
  });

  it('sends the token ONLY in the body — no Authorization header, no extra request config', async () => {
    mockPost.mockResolvedValueOnce({ status: 200, data: {} });

    await tokenManager.requestServerLogout();

    const callArgs = mockPost.mock.calls[0];
    // (url, body) exactly — a third per-request config arg (where an auth
    // header would live) must NOT be present.
    expect(callArgs).toHaveLength(2);
    expect(callArgs[0]).toBe('/auth/logout');
    expect(callArgs[1]).toEqual({ refreshToken: STORED_TOKEN });
    expect(JSON.stringify(callArgs)).not.toContain('Authorization');
  });

  it('returns false and makes NO network call when no refresh token is stored', async () => {
    getPwd.mockResolvedValue(false); // nothing in secure storage

    const result = await tokenManager.requestServerLogout();

    expect(result).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('fails SAFE (false) when offline, logging ONLY a coarse status — never the token, even if embedded in the error message', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    // Adversarial: embed the token in the error message. The sanitized logger
    // must still never write it, because it logs only a coarse status label.
    const netErr = Object.assign(new Error(`network boom ${STORED_TOKEN}`), {
      isAxiosError: true,
      code: 'ERR_NETWORK',
    });
    mockPost.mockRejectedValueOnce(netErr);

    const result = await tokenManager.requestServerLogout();

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Only a coarse status label is logged — no message, body, URL, or headers.
    expect(warnSpy).toHaveBeenCalledWith(expect.any(String), { status: 'ERR_NETWORK' });
    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).not.toContain(STORED_TOKEN);
    expect(logged).not.toContain('Authorization');
    expect(logged).not.toContain('refreshToken');

    warnSpy.mockRestore();
  });

  it('returns false on a server error (non-2xx rejects), logging only the numeric status', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const serverErr = Object.assign(new Error('Request failed with status code 500'), {
      isAxiosError: true,
      response: { status: 500, data: { error: 'INTERNAL' } },
    });
    mockPost.mockRejectedValueOnce(serverErr);

    await expect(tokenManager.requestServerLogout()).resolves.toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.any(String), { status: 500 });

    warnSpy.mockRestore();
  });

  it('fails SAFE (false, no network call) when secure storage itself throws', async () => {
    getPwd.mockRejectedValueOnce(new Error('keychain locked'));

    await expect(tokenManager.requestServerLogout()).resolves.toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
