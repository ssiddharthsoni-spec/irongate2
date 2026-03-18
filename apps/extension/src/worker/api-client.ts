/**
 * API Client for communicating with the Iron Gate backend.
 * Handles authentication, retries, and error handling.
 */

import { resolveConfig, onManagedConfigChanged } from '../managed-config';
import { loadApiKey } from '../api-key-store';
import { reportSecurityAnomaly } from '../security/network-guard';

let API_BASE_URL = 'https://irongate-api.onrender.com/v1';

interface ApiClientConfig {
  baseUrl: string;
  firmId: string;
  getToken: () => Promise<string>;
  apiKey: string; // API key for X-API-Key auth (alternative to JWT)
}

// No hardcoded credentials — user must configure API key in Iron Gate settings
const DEFAULT_API_KEY = '';
const DEFAULT_FIRM_ID = '';

let config: ApiClientConfig = {
  baseUrl: API_BASE_URL,
  firmId: DEFAULT_FIRM_ID,
  getToken: async () => '',
  apiKey: DEFAULT_API_KEY,
};

// Allowed API host patterns — reject anything outside this list
const ALLOWED_API_HOSTS = [
  'irongate-api.onrender.com',
  'irongate-api-staging.onrender.com',
  'localhost',
  '127.0.0.1',
];

function isAllowedApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_API_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

function applyApiUrl(url: string): void {
  if (isAllowedApiUrl(url)) {
    config.baseUrl = url;
    API_BASE_URL = url;
  }
}

// Load config with managed-first priority (replaces direct chrome.storage.local reads)
resolveConfig().then((resolved) => {
  if (resolved.apiKey) config.apiKey = resolved.apiKey;
  if (resolved.apiUrl) applyApiUrl(resolved.apiUrl);
  if (resolved.firmId) config.firmId = resolved.firmId;
}).catch(() => {
  // Fallback: load encrypted API key from local storage
  loadApiKey().then(key => { if (key) config.apiKey = key; }).catch(() => {});
});

// Update config when managed policy changes
onManagedConfigChanged((resolved) => {
  if (resolved.apiKey) config.apiKey = resolved.apiKey;
  if (resolved.apiUrl) applyApiUrl(resolved.apiUrl);
  if (resolved.firmId) config.firmId = resolved.firmId;
});

export function getConfiguredApiKey(): string | undefined {
  return config.apiKey || undefined;
}

export function getConfiguredBaseUrl(): string {
  return config.baseUrl;
}

export function configureApiClient(newConfig: Partial<ApiClientConfig>) {
  // Only override non-empty values — preserve defaults for unset fields
  for (const [key, value] of Object.entries(newConfig)) {
    if (value !== undefined && value !== null && value !== '') {
      (config as any)[key] = value;
    }
  }
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: any;
  retries?: number;
}

/**
 * Make an authenticated API request with exponential backoff retry.
 */
export async function apiRequest<T>(options: RequestOptions): Promise<T> {
  const { method, path, body, retries = 3 } = options;
  const url = `${config.baseUrl}${path}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Build auth headers: prefer API key, fall back to JWT
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Extension-Version': chrome.runtime?.getManifest?.()?.version || '0.0.0',
      };
      if (config.firmId) {
        headers['X-Firm-ID'] = config.firmId;
      }
      if (config.apiKey) {
        headers['X-API-Key'] = config.apiKey;
      } else {
        const token = await config.getToken();
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        } else if (attempt === 0) {
          // No API key and no JWT — fail fast with a helpful message
          throw new ApiError(401, 'No API key configured. Open the Iron Gate side panel and enter your API key in Settings.');
        }
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        throw fetchErr;
      }
      clearTimeout(timeoutId);

      // Verify expected security headers are present (defense in depth)
      if (attempt === 0) {
        validateResponseIntegrity(url, response);
      }

      if (!response.ok) {
        if (response.status === 429) {
          // Rate limited — wait and retry (cap at 60s to prevent server-controlled DoS)
          const retryAfter = Math.min(parseInt(response.headers.get('Retry-After') || '5'), 60);
          await sleep(retryAfter * 1000);
          continue;
        }

        if (response.status >= 500 && attempt < retries) {
          // Server error — retry with backoff
          await sleep(getBackoffDelay(attempt));
          continue;
        }

        const errorBody = await response.json().catch(() => ({}));
        throw new ApiError(response.status, errorBody.error || response.statusText, errorBody);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (error instanceof ApiError) {
        // Don't retry client errors (except 429 handled above)
        if (error.status < 500) throw error;
      }

      if (attempt < retries) {
        await sleep(getBackoffDelay(attempt));
      }
    }
  }

  throw lastError || new Error('Request failed after retries');
}

/**
 * Upload a file to the API as multipart/form-data.
 * Used for document scanning — converts base64 back to a Blob.
 */
export async function apiUploadFile<T>(
  path: string,
  fileName: string,
  fileBase64: string,
  fileType: string
): Promise<T> {
  const url = `${config.baseUrl}${path}`;

  // Convert base64 to Blob
  const binaryString = atob(fileBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };

  const blob = new Blob([bytes], { type: mimeTypes[fileType] || 'application/octet-stream' });
  const formData = new FormData();
  formData.append('file', blob, fileName);

  // Build auth headers: prefer API key, fall back to JWT
  const headers: Record<string, string> = {};
  if (config.firmId) headers['X-Firm-ID'] = config.firmId;
  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  } else {
    const token = await config.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      throw new ApiError(401, 'No API key configured. Open the Iron Gate side panel and enter your API key in Settings.');
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000); // 60s for uploads

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(408, 'Upload request timed out after 60 seconds');
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new ApiError(response.status, errorBody.error || response.statusText, errorBody);
  }

  return (await response.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getBackoffDelay(attempt: number): number {
  // Exponential backoff: 1s, 2s, 4s, 8s... with jitter
  const baseDelay = Math.pow(2, attempt) * 1000;
  const jitter = Math.random() * 1000;
  return baseDelay + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Verify that the API response includes expected security headers.
 * Missing headers may indicate a proxy interception or misconfigured server.
 * Reports anomalies but does not block — HSTS and CT enforcement are server-side.
 */
let _integrityWarningLogged = false;

function validateResponseIntegrity(url: string, response: Response): void {
  const hsts = response.headers.get('strict-transport-security');
  const host = new URL(url).hostname;

  // Note: Expect-CT header check removed — Expect-CT was deprecated in 2023
  // and removed from all browsers. Certificate Transparency is enforced by
  // default in Chrome/Firefox/Safari. No hosting provider sends this header.

  if (!hsts && !_integrityWarningLogged) {
    _integrityWarningLogged = true;
    // Log as debug, not a security anomaly — Render's free tier may not
    // always include HSTS on every response. The connection is still HTTPS.
    console.debug(`[Iron Gate] Note: Missing HSTS header from ${host} — connection is still HTTPS`);
  }
}
