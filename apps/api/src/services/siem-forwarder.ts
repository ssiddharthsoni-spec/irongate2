// ============================================================================
// Iron Gate — SIEM Forwarder Service
// ============================================================================
// Forwards security events to enterprise SIEM systems (Splunk HEC,
// Microsoft Sentinel, QRadar) in CEF or JSON format.
// Includes SSRF protection, retry with exponential backoff, and structured
// logging of delivery status.
// ============================================================================

import { db } from '../db/client';
import { firms } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../lib/logger';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SIEMConfig {
  endpoint: string;
  token: string;
  format: 'cef' | 'json';
  enabled: boolean;
}

export interface SIEMEventPayload {
  eventType: string;
  userId?: string;
  aiToolId?: string;
  sensitivityLevel?: string;
  score?: number;
  entityCount?: number;
  action?: string;
  details?: Record<string, unknown>;
  timestamp?: string;
}

// ── SSRF Protection ──────────────────────────────────────────────────────────
// Mirrors the webhook-dispatcher pattern — block private/internal addresses.

const PRIVATE_URL_PATTERNS = [
  /^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./, /^169\.254\./, /^0\./, /^\[?::1\]?$/,
  /^\[?fe80:/i, /^\[?fc00:/i, /^\[?fd00:/i, /^\[?::ffff:/i,
  /\.internal$/i, /\.local$/i, /\.localhost$/i,
];

function validateEndpointUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('SIEM endpoint must use HTTPS');
  }
  for (const pattern of PRIVATE_URL_PATTERNS) {
    if (pattern.test(parsed.hostname)) {
      throw new Error(`SIEM endpoint cannot point to private/internal network: ${parsed.hostname}`);
    }
  }
}

// ── CEF Formatter ────────────────────────────────────────────────────────────
// Common Event Format (CEF) is the universal SIEM interchange format.
// Spec: CEF:Version|Device Vendor|Device Product|Device Version|Signature ID|Name|Severity|Extension

/** Map Iron Gate sensitivity levels to CEF severity (0–10). */
function cefSeverity(level?: string): number {
  switch (level) {
    case 'critical': return 10;
    case 'high':     return 7;
    case 'medium':   return 4;
    case 'low':      return 1;
    default:         return 3;
  }
}

/** Escape a value for CEF extension fields (pipes and backslashes). */
function cefEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/=/g, '\\=');
}

/**
 * Format a security event as a CEF string.
 *
 * Example output:
 *   CEF:0|IronGate|AIGovernance|1.0|PII_DETECTED|Sensitive data detected in AI prompt|7|
 *   src=user123 dst=chatgpt cs1=high cn1=82 cn2=5
 */
export function formatCEF(event: SIEMEventPayload): string {
  const severity = cefSeverity(event.sensitivityLevel);
  const signatureId = cefEscape(event.eventType);
  const name = cefEscape(eventDisplayName(event.eventType));

  // Build extension key-value pairs
  const ext: string[] = [];

  if (event.userId)              ext.push(`src=${cefEscape(event.userId)}`);
  if (event.aiToolId)            ext.push(`dst=${cefEscape(event.aiToolId)}`);
  if (event.sensitivityLevel)    ext.push(`cs1=${cefEscape(event.sensitivityLevel)}`);
  if (event.score != null)       ext.push(`cn1=${event.score}`);
  if (event.entityCount != null) ext.push(`cn2=${event.entityCount}`);
  if (event.action)              ext.push(`act=${cefEscape(event.action)}`);

  const ts = event.timestamp || new Date().toISOString();
  ext.push(`rt=${ts}`);

  const header = `CEF:0|IronGate|AIGovernance|1.0|${signatureId}|${name}|${severity}|`;
  return `${header}${ext.join(' ')}`;
}

/** Human-readable name for common event types. */
function eventDisplayName(eventType: string): string {
  const names: Record<string, string> = {
    PII_DETECTED: 'Sensitive data detected in AI prompt',
    PII_BLOCKED: 'AI prompt blocked due to sensitive data',
    PII_PROXIED: 'AI prompt proxied with pseudonymization',
    POLICY_VIOLATION: 'Policy violation detected',
    AUTH_FAILURE: 'Authentication failure',
    ADMIN_ACTION: 'Administrative action performed',
    DATA_EXPORT: 'Data export requested',
  };
  return names[eventType] || `Security event: ${eventType}`;
}

// ── Firm Config Loader ───────────────────────────────────────────────────────

/**
 * Read the SIEM configuration for a firm from the database.
 * Returns null if SIEM is not configured or not enabled.
 */
export async function initSIEMFromConfig(firmId: string): Promise<SIEMConfig | null> {
  try {
    const [firm] = await db
      .select({ config: firms.config })
      .from(firms)
      .where(eq(firms.id, firmId))
      .limit(1);

    if (!firm?.config) return null;

    const config = firm.config as Record<string, unknown>;
    const siem = config.siem as SIEMConfig | undefined;

    if (!siem || !siem.enabled || !siem.endpoint || !siem.token) {
      return null;
    }

    // Validate format — default to CEF if unrecognized
    if (siem.format !== 'json' && siem.format !== 'cef') {
      siem.format = 'cef';
    }

    return siem;
  } catch (error) {
    logger.error('Failed to load SIEM config', {
      firmId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ── Core Forwarder ───────────────────────────────────────────────────────────

/**
 * Forward a security event to the firm's configured SIEM endpoint.
 *
 * Fire-and-forget — errors are logged but never thrown to the caller.
 * Uses retry with exponential backoff (3 attempts: 1s, 5s, 25s).
 */
export async function forwardToSIEM(
  firmId: string,
  event: SIEMEventPayload,
): Promise<void> {
  let config: SIEMConfig | null;
  try {
    config = await initSIEMFromConfig(firmId);
  } catch {
    return; // Already logged inside initSIEMFromConfig
  }

  if (!config) return;

  try {
    validateEndpointUrl(config.endpoint);
  } catch (error) {
    logger.error('SIEM endpoint failed SSRF validation', {
      firmId,
      endpoint: config.endpoint,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  // Stamp the event timestamp if not already set
  if (!event.timestamp) {
    event.timestamp = new Date().toISOString();
  }

  await deliverWithRetry(firmId, config, event).catch((err) => {
    logger.error('SIEM delivery failed after all retries', {
      firmId,
      endpoint: config.endpoint,
      error: String(err),
    });
  });
}

// ── Delivery with Retry ──────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const BACKOFFS = [1_000, 5_000, 25_000]; // 1s, 5s, 25s

async function deliverWithRetry(
  firmId: string,
  config: SIEMConfig,
  event: SIEMEventPayload,
  attempt = 1,
): Promise<void> {
  const { endpoint, token, format } = config;

  // Build request body and headers based on format
  let body: string;
  let contentType: string;

  if (format === 'json') {
    // Splunk HEC JSON format — wrap in { event: ... }
    body = JSON.stringify({
      event: {
        ...event,
        source: 'irongate',
        sourcetype: 'irongate:security',
      },
      time: event.timestamp
        ? Math.floor(new Date(event.timestamp).getTime() / 1000)
        : undefined,
      source: 'irongate-api',
      sourcetype: 'irongate:security',
    });
    contentType = 'application/json';
  } else {
    // CEF — send as plain text
    body = formatCEF(event);
    contentType = 'text/plain';
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Authorization': `Bearer ${token}`,
        'X-IronGate-Source': 'siem-forwarder',
        'X-IronGate-Delivery': crypto.randomUUID(),
      },
      body,
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    if (response.ok) {
      logger.info('SIEM event delivered', {
        firmId,
        eventType: event.eventType,
        format,
        attempt,
        status: response.status,
      });
      return;
    }

    // Non-OK response — retry if attempts remain
    const statusText = `${response.status} ${response.statusText}`;
    if (attempt < MAX_ATTEMPTS) {
      logger.warn('SIEM delivery returned non-OK, retrying', {
        firmId,
        eventType: event.eventType,
        status: statusText,
        attempt,
        nextRetryMs: BACKOFFS[attempt - 1],
      });
      await sleep(BACKOFFS[attempt - 1]);
      return deliverWithRetry(firmId, config, event, attempt + 1);
    }

    logger.error('SIEM delivery failed after max retries', {
      firmId,
      eventType: event.eventType,
      status: statusText,
      attempts: MAX_ATTEMPTS,
    });
  } catch (error) {
    if (attempt < MAX_ATTEMPTS) {
      logger.warn('SIEM delivery error, retrying', {
        firmId,
        eventType: event.eventType,
        error: error instanceof Error ? error.message : String(error),
        attempt,
        nextRetryMs: BACKOFFS[attempt - 1],
      });
      await sleep(BACKOFFS[attempt - 1]);
      return deliverWithRetry(firmId, config, event, attempt + 1);
    }

    throw error; // Bubble up after exhausting retries — caught by forwardToSIEM
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Backward-Compatible Export ───────────────────────────────────────────────
// The old API exported `forward(firmId, event)` with a slightly different event
// shape. This adapter maps the legacy fields so existing callers (job workers,
// enqueue helpers) continue to work without changes.

interface LegacySIEMEvent {
  eventId: string;
  firmId: string;
  aiToolId: string;
  sensitivityScore: number;
  sensitivityLevel: string;
  action: string;
  entityCount: number;
  captureMethod: string;
  timestamp: string;
}

export async function forward(firmId: string, event: LegacySIEMEvent): Promise<void> {
  return forwardToSIEM(firmId, {
    eventType: event.action,
    userId: event.firmId,
    aiToolId: event.aiToolId,
    sensitivityLevel: event.sensitivityLevel,
    score: event.sensitivityScore,
    entityCount: event.entityCount,
    action: event.action,
    timestamp: event.timestamp,
    details: { eventId: event.eventId, captureMethod: event.captureMethod },
  });
}
