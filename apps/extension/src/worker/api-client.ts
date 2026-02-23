/**
 * API Client for communicating with the Iron Gate backend.
 * Handles authentication, retries, and error handling.
 */

let API_BASE_URL = 'https://irongate-api.onrender.com/v1';

// Load configurable API base URL from chrome.storage
chrome.storage.local.get('apiBaseUrl', (result) => {
  if (result.apiBaseUrl) API_BASE_URL = result.apiBaseUrl;
});

interface ApiClientConfig {
  baseUrl: string;
  firmId: string;
  getToken: () => Promise<string>;
  apiKey: string; // API key for X-API-Key auth (alternative to JWT)
}

// Default API key for development — overridden by user-configured key in storage
const DEFAULT_API_KEY = 'ig_4ba4d382a65b1ff6acbfb7658fdde1b129917cfa1dbd6458d5c0077cd9b98788';
const DEFAULT_FIRM_ID = '6a3de5b8-2ad3-4d94-9171-c02951e09e4e';

let config: ApiClientConfig = {
  baseUrl: API_BASE_URL,
  firmId: DEFAULT_FIRM_ID,
  getToken: async () => '',
  apiKey: DEFAULT_API_KEY,
};

// Load user-configured API key from storage (overrides default)
chrome.storage.local.get('ironGateApiKey', (result) => {
  if (result.ironGateApiKey) config.apiKey = result.ironGateApiKey;
});

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
        'X-Firm-ID': config.firmId,
      };
      if (config.apiKey) {
        headers['X-API-Key'] = config.apiKey;
      } else {
        const token = await config.getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        if (response.status === 429) {
          // Rate limited — wait and retry
          const retryAfter = parseInt(response.headers.get('Retry-After') || '5');
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
  const headers: Record<string, string> = { 'X-Firm-ID': config.firmId };
  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  } else {
    const token = await config.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });

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
