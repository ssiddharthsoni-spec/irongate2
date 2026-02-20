/**
 * API Client for communicating with the Iron Gate backend.
 * Handles authentication, retries, and error handling.
 */

let API_BASE_URL = 'http://localhost:3000/v1';

// Load configurable API base URL from chrome.storage
chrome.storage.local.get('apiBaseUrl', (result) => {
  if (result.apiBaseUrl) API_BASE_URL = result.apiBaseUrl;
});

interface ApiClientConfig {
  baseUrl: string;
  firmId: string;
  getToken: () => Promise<string>;
}

let config: ApiClientConfig = {
  baseUrl: API_BASE_URL,
  firmId: '',
  getToken: async () => '',
};

export function configureApiClient(newConfig: Partial<ApiClientConfig>) {
  config = { ...config, ...newConfig };
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
      const token = await config.getToken();

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Firm-ID': config.firmId,
        },
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
