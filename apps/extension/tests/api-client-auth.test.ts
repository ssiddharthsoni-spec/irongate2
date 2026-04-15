/**
 * Sr. Engineer Audit — Week 1 · Item 3
 * Auth header must NEVER be dropped on retries.
 *
 * The old code had:
 *   } else if (attempt === 0) {
 *     throw new ApiError(401, 'No API key...');
 *   }
 *
 * This meant attempts 1..retries would silently continue with no
 * Authorization header when both apiKey and JWT were missing. The
 * backend would respond differently to auth'd vs unauth'd requests,
 * potentially leaking info.
 *
 * These tests fail against the old code and pass against the fix:
 * buildAuthHeaders() throws ApiError(401) on EVERY call with missing
 * auth, and since ApiError with status < 500 bypasses the retry loop,
 * unauthenticated retry is structurally impossible.
 */

import { describe, it, expect } from 'vitest';
import { buildAuthHeaders, ApiError } from '../src/worker/api-auth';

function baseCfg(overrides: Record<string, unknown> = {}): any {
  return {
    baseUrl: 'https://test.example.com',
    apiKey: '',
    firmId: '',
    getToken: async () => null,
    ...overrides,
  };
}

describe('buildAuthHeaders — Item 3 (auth on every attempt)', () => {
  it('attaches X-API-Key when apiKey is set', async () => {
    const headers = await buildAuthHeaders(baseCfg({ apiKey: 'ig_test_123' }));
    expect(headers['X-API-Key']).toBe('ig_test_123');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('attaches Authorization Bearer when only JWT is available', async () => {
    const headers = await buildAuthHeaders(
      baseCfg({ getToken: async () => 'jwt-token-xyz' }),
    );
    expect(headers['Authorization']).toBe('Bearer jwt-token-xyz');
    expect(headers['X-API-Key']).toBeUndefined();
  });

  it('prefers API key over JWT when BOTH are present', async () => {
    const headers = await buildAuthHeaders(
      baseCfg({ apiKey: 'ig_xxx', getToken: async () => 'jwt-yyy' }),
    );
    expect(headers['X-API-Key']).toBe('ig_xxx');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('THROWS when neither API key nor JWT are available (no silent unauth)', async () => {
    await expect(buildAuthHeaders(baseCfg())).rejects.toBeInstanceOf(ApiError);
  });

  it('throws ApiError with status 401 — NOT 5xx (so retry loop bypasses it)', async () => {
    try {
      await buildAuthHeaders(baseCfg());
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(401);
    }
  });

  it('throws on EVERY call — no "attempt === 0" special case', async () => {
    // Simulating the retry loop: 4 attempts, all with empty auth.
    // In the old code, only attempt 0 threw. All others silently
    // continued with no Authorization header. Regression check:
    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(buildAuthHeaders(baseCfg())).rejects.toBeInstanceOf(ApiError);
    }
  });

  it('always sets X-Extension-Version', async () => {
    const headers = await buildAuthHeaders(baseCfg({ apiKey: 'k' }));
    expect(headers['X-Extension-Version']).toBeDefined();
  });

  it('sets X-Firm-ID when firmId is configured', async () => {
    const headers = await buildAuthHeaders(baseCfg({ apiKey: 'k', firmId: 'firm-42' }));
    expect(headers['X-Firm-ID']).toBe('firm-42');
  });

  it('omits X-Firm-ID when firmId is empty', async () => {
    const headers = await buildAuthHeaders(baseCfg({ apiKey: 'k', firmId: '' }));
    expect(headers['X-Firm-ID']).toBeUndefined();
  });
});
