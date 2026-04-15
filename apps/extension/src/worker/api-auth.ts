/**
 * Auth header builder — the SINGLE source of truth for auth on every
 * outbound API call from the extension.
 *
 * Lives in its own file (no side-effect imports) so unit tests can
 * exercise it without needing chrome.* mocks. The audit's Item 3 is a
 * direct regression against this function's contract:
 *
 *   "Auth header must NEVER be dropped on retries."
 *
 * This function throws ApiError(401) on EVERY call when neither API key
 * nor JWT is available. Since ApiError(401) has status < 500, the retry
 * loop in api-client.ts bypasses retry. Unauthenticated retry is
 * structurally impossible.
 */

export interface AuthConfig {
  apiKey?: string;
  firmId?: string;
  getToken: () => Promise<string | null>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: any,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function buildAuthHeaders(cfg: AuthConfig): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Extension-Version': (typeof chrome !== 'undefined' ? chrome.runtime?.getManifest?.()?.version : undefined) || '0.0.0',
  };
  if (cfg.firmId) headers['X-Firm-ID'] = cfg.firmId;

  if (cfg.apiKey) {
    headers['X-API-Key'] = cfg.apiKey;
    return headers;
  }

  const token = await cfg.getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  throw new ApiError(
    401,
    'No API key configured. Open the Iron Gate side panel and enter your API key in Settings.',
  );
}
