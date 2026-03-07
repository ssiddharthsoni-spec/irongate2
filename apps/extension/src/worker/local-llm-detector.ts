/**
 * Local LLM PII Detector
 *
 * Connects to a firm's on-premise LLM (Ollama, vLLM, etc.) running on
 * localhost or the corporate network. Sends text for PII detection and
 * returns structured entity results that merge into the existing scorer.
 *
 * SECURITY: Text is sent to localhost or a corporate-network URL only.
 * No data leaves the machine/network. The extension validates the endpoint
 * URL to block public internet destinations.
 *
 * Supports Ollama-compatible API (POST /api/generate) out of the box.
 * Enterprise admins configure the endpoint via managed config or the
 * admin dashboard.
 */

import type { DetectedEntity } from '../detection/types';
import type { LocalLLMConfig } from '../managed-config';

// Debug logging
let _debug = false;
try { chrome.storage.local.get('ironGateDebug', (r) => { _debug = !!r.ironGateDebug; }); } catch {}
function llmLog(...args: any[]) { if (_debug) console.log('[Iron Gate LocalLLM]', ...args); }

// ── Safety: only allow local/private network endpoints ──────────────────────

const ALLOWED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^\[::1\]$/,
  /\.internal$/i,
  /\.corp$/i,
  /\.local$/i,
  /\.private$/i,
];

function isAllowedEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return ALLOWED_HOSTNAME_PATTERNS.some(p => p.test(url.hostname));
  } catch {
    return false;
  }
}

// ── Detection prompt ────────────────────────────────────────────────────────

const DETECTION_SYSTEM_PROMPT = `You are a PII (Personally Identifiable Information) detection system. Analyze the given text and identify ALL sensitive entities.

For each entity found, output a JSON array of objects with these fields:
- "type": entity type (PERSON, ORGANIZATION, EMAIL, PHONE_NUMBER, SSN, CREDIT_CARD, ACCOUNT_NUMBER, LOCATION, MEDICAL_RECORD, MONETARY_AMOUNT, DATE, IP_ADDRESS, PASSPORT_NUMBER, DRIVERS_LICENSE, API_KEY, POLICY_NUMBER, STUDENT_ID, CLASSIFICATION_MARKING, or other relevant type)
- "text": the exact text matched
- "start": character offset where the entity starts (0-indexed)
- "end": character offset where the entity ends
- "confidence": your confidence from 0.0 to 1.0

Output ONLY the JSON array, no other text. If no entities are found, output [].

Example output:
[{"type":"PERSON","text":"John Smith","start":15,"end":25,"confidence":0.95},{"type":"SSN","text":"123-45-6789","start":42,"end":53,"confidence":0.99}]`;

// ── Result parsing ──────────────────────────────────────────────────────────

interface RawLLMEntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
}

function parseEntities(response: string): DetectedEntity[] {
  // Extract JSON array from response (LLM may include markdown fences or preamble)
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const raw: RawLLMEntity[] = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(raw)) return [];

    return raw
      .filter(e =>
        typeof e.type === 'string' &&
        typeof e.text === 'string' &&
        typeof e.start === 'number' &&
        typeof e.end === 'number' &&
        e.text.length > 0
      )
      .map(e => ({
        type: e.type.toUpperCase().replace(/\s+/g, '_'),
        text: e.text,
        start: Math.max(0, e.start),
        end: Math.max(e.start + 1, e.end),
        confidence: Math.min(1, Math.max(0, e.confidence || 0.7)),
        source: 'regex' as const, // Treated as supplemental detection source
      }));
  } catch {
    llmLog('Failed to parse LLM response as JSON');
    return [];
  }
}

// ── Ollama API client ───────────────────────────────────────────────────────

async function callOllama(
  config: LocalLLMConfig,
  text: string,
): Promise<string> {
  const endpoint = config.endpoint.replace(/\/+$/, '');
  const url = `${endpoint}/generate`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      system: DETECTION_SYSTEM_PROMPT,
      prompt: text.slice(0, 8000), // Cap input to avoid overwhelming small models
      stream: false,
      options: {
        temperature: 0.1, // Low temperature for deterministic extraction
        num_predict: 2000,
      },
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Local LLM returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return data.response || '';
}

// ── Health check ────────────────────────────────────────────────────────────

let _lastHealthCheck = 0;
let _isHealthy = false;
const HEALTH_CHECK_INTERVAL = 60_000; // 1 minute

async function checkHealth(config: LocalLLMConfig): Promise<boolean> {
  const now = Date.now();
  if (now - _lastHealthCheck < HEALTH_CHECK_INTERVAL) return _isHealthy;

  try {
    const endpoint = config.endpoint.replace(/\/+$/, '');
    // Ollama tags endpoint — lightweight check
    const response = await fetch(`${endpoint.replace('/api', '')}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    _isHealthy = response.ok;
  } catch {
    _isHealthy = false;
  }

  _lastHealthCheck = now;
  llmLog(`Health check: ${_isHealthy ? 'healthy' : 'unhealthy'}`);
  return _isHealthy;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface LocalLLMDetectionResult {
  entities: DetectedEntity[];
  latencyMs: number;
  model: string;
  available: boolean;
}

/**
 * Detect PII using a local LLM. Returns entities that should be merged
 * with regex detection results in the scorer.
 *
 * Fails gracefully — if the local LLM is unavailable, returns empty results.
 * This is supplemental detection; the regex pipeline always runs.
 */
export async function detectWithLocalLLM(
  text: string,
  config: LocalLLMConfig,
): Promise<LocalLLMDetectionResult> {
  // Validate endpoint is local/private network
  if (!isAllowedEndpoint(config.endpoint)) {
    llmLog(`Blocked: endpoint ${config.endpoint} is not a local/private network address`);
    return { entities: [], latencyMs: 0, model: config.model, available: false };
  }

  // Skip if detection is disabled
  if (!config.enableDetection) {
    return { entities: [], latencyMs: 0, model: config.model, available: false };
  }

  // Skip short text (not worth the latency)
  if (text.length < 50) {
    return { entities: [], latencyMs: 0, model: config.model, available: true };
  }

  // Health check
  const healthy = await checkHealth(config);
  if (!healthy) {
    return { entities: [], latencyMs: 0, model: config.model, available: false };
  }

  const start = performance.now();
  try {
    const response = await callOllama(config, text);
    const entities = parseEntities(response);
    const latencyMs = Math.round(performance.now() - start);

    llmLog(`Detection complete: ${entities.length} entities in ${latencyMs}ms (model: ${config.model})`);

    return {
      entities,
      latencyMs,
      model: config.model,
      available: true,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    llmLog(`Detection failed after ${latencyMs}ms:`, err);

    // Mark unhealthy to avoid repeated failures
    _isHealthy = false;
    _lastHealthCheck = Date.now();

    return { entities: [], latencyMs, model: config.model, available: false };
  }
}

/**
 * Check if a local LLM is configured and reachable.
 */
export async function isLocalLLMAvailable(config: LocalLLMConfig | null): Promise<boolean> {
  if (!config || !config.enableDetection) return false;
  if (!isAllowedEndpoint(config.endpoint)) return false;
  return checkHealth(config);
}

/**
 * Reset the health check cache (e.g., when config changes).
 */
export function resetLocalLLMHealth(): void {
  _lastHealthCheck = 0;
  _isHealthy = false;
}
