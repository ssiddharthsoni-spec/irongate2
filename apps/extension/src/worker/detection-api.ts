/**
 * Iron Gate Extension — Detection API Client
 *
 * Thin client that sends prompts to the IronGate Detection Service
 * for NER classification, policy evaluation, and pseudonymization.
 *
 * The extension does NOT run NER locally (except regex for structured PII
 * as a fallback when the API is unreachable). All intelligence lives
 * server-side so it can be updated without shipping extension releases.
 *
 * Architecture:
 * 1. Extension captures prompt text
 * 2. Sends to POST /v1/pseudonymize (single round-trip)
 * 3. Gets back: masked_text, pseudonym_map, reverse_map, score, policy_decision
 * 4. Extension uses masked_text for the AI request
 * 5. Extension uses reverse_map for de-pseudonymization of responses
 */

import { getToken, getFirmId, getUserId } from './auth';
import { resolveConfig } from '../managed-config';
import { assertCloudCallsPermitted } from '../detection/tier2-adapter';
import { CircuitBreaker, type CircuitState, type CircuitBreakerStats } from './circuit-breaker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectionApiEntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: string;
}

export interface PseudonymizeResult {
  masked_text: string;
  entities: DetectionApiEntity[];
  pseudonym_map: Record<string, string>;
  reverse_map: Record<string, string>;
  score: number;
  level: string;
  context_category: string;
  policy_decision: string; // allow, pseudonymize, warn, block
  policy_explanation: string;
  processing_time_ms: number;
  session_id: string;
}


// ---------------------------------------------------------------------------
// Circuit Breaker — Extension → API
// ---------------------------------------------------------------------------
// Rolling-window circuit breaker.  Opens when error rate exceeds 20% over
// a 30-second window (minimum 5 requests).  After 60 seconds in open state
// it transitions to half-open and allows one probe request through.
//
// The other two breakers (API → Redis, API → PostgreSQL) live server-side.
// Their state is echoed back in API responses so the sidepanel can display
// all three.
// ---------------------------------------------------------------------------

const apiCircuitBreaker = new CircuitBreaker({
  name: 'extension-api',
  windowMs: 30_000,
  errorThreshold: 0.2,
  minRequests: 5,
  resetTimeoutMs: 60_000,
});

/** Server-reported circuit breaker states (updated from API response headers). */
let _serverCircuitStates: Record<string, CircuitBreakerStats> = {};

function canAttemptApiCall(): boolean {
  return apiCircuitBreaker.canAttempt();
}

function onApiSuccess(): void {
  apiCircuitBreaker.onSuccess();
}

function onApiFailure(): void {
  apiCircuitBreaker.onFailure();
}

export function isApiAvailable(): boolean {
  return canAttemptApiCall();
}

/** Get the Extension → API circuit breaker state for the sidepanel. */
export function getApiCircuitState(): CircuitBreakerStats {
  return apiCircuitBreaker.getStats();
}

/**
 * Get all circuit breaker states (extension + server-reported).
 * Useful for the sidepanel diagnostics view.
 */
export function getAllCircuitStates(): Record<string, CircuitBreakerStats> {
  return {
    'extension-api': apiCircuitBreaker.getStats(),
    ..._serverCircuitStates,
  };
}

/**
 * Update server-reported circuit states from API response headers.
 * The Detection Service sends X-Circuit-Redis and X-Circuit-Postgres headers.
 */
function updateServerCircuitStates(response: Response): void {
  try {
    const redisHeader = response.headers.get('X-Circuit-Redis');
    if (redisHeader) {
      const parsed = JSON.parse(redisHeader) as CircuitBreakerStats;
      _serverCircuitStates['api-redis'] = parsed;
    }
    const pgHeader = response.headers.get('X-Circuit-Postgres');
    if (pgHeader) {
      const parsed = JSON.parse(pgHeader) as CircuitBreakerStats;
      _serverCircuitStates['api-postgres'] = parsed;
    }
  } catch {
    // Ignore malformed headers
  }
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

/**
 * The primary function called by the extension for every prompt.
 *
 * Sends text to the Detection Service, which runs:
 * 1. Entity dictionary lookup (100% accuracy for known entities)
 * 2. Presidio + spaCy NER (PERSON, ORG, LOCATION classification)
 * 3. GLiNER transformer NER
 * 4. Secret scanner
 * 5. Context classification
 * 6. Policy evaluation
 * 7. Pseudonymization
 *
 * Returns everything the extension needs in ONE network call.
 */
export async function pseudonymizeViaApi(
  text: string,
  options: {
    sessionId?: string;
    aiTool?: string;
  } = {},
): Promise<PseudonymizeResult | null> {
  // Sovereign AI guard: local-only mode must never send raw text to the cloud.
  try { assertCloudCallsPermitted('detection-api.pseudonymizeViaApi'); }
  catch { return null; }

  if (!canAttemptApiCall()) {
    console.warn('[Iron Gate] Detection API circuit breaker open — using local fallback');
    return null;
  }

  const detectionUrl = await getDetectionServiceUrl();
  if (!detectionUrl) {
    return null;
  }

  const orgId = getFirmId() || '';
  const userId = getUserId() || '';
  let token = '';
  try { token = await getToken(); } catch { /* no auth */ }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(`${detectionUrl}/v1/pseudonymize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(orgId ? { 'X-Org-Id': orgId } : {}),
        ...(userId ? { 'X-User-Id': userId } : {}),
      },
      body: JSON.stringify({
        text,
        org_id: orgId,
        session_id: options.sessionId || undefined,
        ai_tool: options.aiTool || 'unknown',
        user_id: userId || undefined,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 403) {
        // Kill switch active
        const data = await response.json().catch(() => ({ detail: 'AI tools restricted' }));
        throw new KillSwitchError(data.detail || 'AI tools restricted by policy');
      }
      throw new Error(`Detection API error: ${response.status}`);
    }

    const result: PseudonymizeResult = await response.json();
    onApiSuccess();
    updateServerCircuitStates(response);

    console.log(
      `[IronGate API] Detection: ${result.entities.length} entities, ` +
      `score=${result.score}, level=${result.level}, ` +
      `policy=${result.policy_decision}, ` +
      `context=${result.context_category}, ` +
      `time=${result.processing_time_ms}ms`,
    );

    return result;
  } catch (error) {
    if (error instanceof KillSwitchError) {
      throw error; // Don't swallow kill switch — it must propagate
    }
    onApiFailure();
    console.error('[Iron Gate] Detection API call failed:', error);
    return null; // Caller falls back to local regex
  }
}

/**
 * De-pseudonymize AI response text using the server session.
 */
export async function depseudonymizeViaApi(
  text: string,
  sessionId: string,
): Promise<string | null> {
  try { assertCloudCallsPermitted('detection-api.depseudonymizeViaApi'); }
  catch { return null; }
  const apiUrl = await getDetectionServiceUrl();
  if (!apiUrl || !canAttemptApiCall()) return null;

  try {
    const response = await fetch(`${apiUrl}/v1/depseudonymize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, session_id: sessionId }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    const data: { text: string } = await response.json();
    onApiSuccess();
    updateServerCircuitStates(response);
    return data.text;
  } catch {
    onApiFailure();
    return null;
  }
}

/**
 * Check if the detection service is healthy.
 */
export async function checkDetectionHealth(): Promise<boolean> {
  try { assertCloudCallsPermitted('detection-api.checkDetectionHealth'); }
  catch { return false; }
  const apiUrl = await getDetectionServiceUrl();
  if (!apiUrl) return false;

  try {
    const response = await fetch(`${apiUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      const data = await response.json();
      onApiSuccess();
      return data.status === 'ok';
    }
    return false;
  } catch {
    onApiFailure();
    return false;
  }
}

// ---------------------------------------------------------------------------
// Kill Switch Error
// ---------------------------------------------------------------------------

export class KillSwitchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KillSwitchError';
  }
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

let _cachedDetectionUrl: string | null = null;

async function getDetectionServiceUrl(): Promise<string | null> {
  if (_cachedDetectionUrl) return _cachedDetectionUrl;

  // Check chrome.storage for configured detection URL
  try {
    const result = await chrome.storage.local.get('detectionServiceUrl');
    if (result.detectionServiceUrl) {
      _cachedDetectionUrl = result.detectionServiceUrl;
      return _cachedDetectionUrl;
    }
  } catch { /* ignore */ }

  // Check managed config
  try {
    const config = await resolveConfig();
    const configAny = config as unknown as Record<string, unknown>;
    if (configAny.detectionServiceUrl) {
      _cachedDetectionUrl = configAny.detectionServiceUrl as string;
      return _cachedDetectionUrl;
    }
    // Fall back to main API URL
    if (config.apiUrl) {
      _cachedDetectionUrl = config.apiUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
      return _cachedDetectionUrl;
    }
  } catch { /* ignore */ }

  // Last resort: localhost for development
  return 'http://localhost:8080';
}

// Clear cache when config changes
try {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.detectionServiceUrl) _cachedDetectionUrl = null;
  });
} catch { /* not in extension context */ }
