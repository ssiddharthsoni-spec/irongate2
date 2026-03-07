// ============================================================================
// Iron Gate — SIEM Forwarder Service
// ============================================================================
// Forwards events to configured SIEM endpoints in standard formats.
// Supports Splunk HEC and generic JSON-over-HTTPS.
// ============================================================================

import { db } from '../db/client';
import { firms } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../lib/logger';

interface SIEMConfig {
  enabled: boolean;
  provider: 'splunk' | 'datadog' | 'generic' | 'sentinel';
  url: string;
  token: string;
  format: 'json' | 'cef' | 'asim';
}

interface SIEMEvent {
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

const MAX_SIEM_RETRIES = 3;
const SIEM_BASE_DELAY_MS = 500;

const _siemRateLimits = new Map<string, { count: number; resetAt: number }>();
const SIEM_RATE_LIMIT = 100;
const SIEM_RATE_WINDOW_MS = 60_000;

function checkSIEMRateLimit(firmId: string): boolean {
  const now = Date.now();
  const entry = _siemRateLimits.get(firmId);
  if (!entry || now >= entry.resetAt) {
    _siemRateLimits.set(firmId, { count: 1, resetAt: now + SIEM_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= SIEM_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

/**
 * Forward an event to the firm's configured SIEM endpoint.
 * Retries up to 3 times with exponential backoff on transient failures.
 */
export async function forward(firmId: string, event: SIEMEvent): Promise<void> {
  if (!checkSIEMRateLimit(firmId)) {
    logger.warn('SIEM rate limit exceeded, dropping event', { firmId, eventId: event.eventId });
    return;
  }

  let config: SIEMConfig | null;
  try {
    config = await getSIEMConfig(firmId);
  } catch (err) {
    logger.warn('Failed to load SIEM config', { firmId, error: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (!config || !config.enabled) return;

  const payload = formatPayload(event, config);
  const body = JSON.stringify(payload);
  const headers = buildHeaders(config);

  for (let attempt = 0; attempt < MAX_SIEM_RETRIES; attempt++) {
    try {
      const res = await fetch(config.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) return;

      // Non-retryable client errors (4xx except 429)
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        logger.warn('SIEM rejected event (non-retryable)', { firmId, status: res.status, eventId: event.eventId });
        return;
      }

      logger.warn('SIEM transient error, retrying', { firmId, status: res.status, attempt: attempt + 1 });
    } catch (error) {
      logger.warn('SIEM request failed, retrying', {
        firmId, attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (attempt < MAX_SIEM_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, SIEM_BASE_DELAY_MS * Math.pow(2, attempt)));
    }
  }

  logger.error('SIEM forwarding failed after retries', { firmId, eventId: event.eventId, attempts: MAX_SIEM_RETRIES });
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

async function getSIEMConfig(firmId: string): Promise<SIEMConfig | null> {
  const [firm] = await db
    .select({ config: firms.config })
    .from(firms)
    .where(eq(firms.id, firmId))
    .limit(1);

  if (!firm?.config) return null;
  const config = firm.config as Record<string, unknown>;
  const siem = config.siem as SIEMConfig | undefined;

  return siem && siem.enabled ? siem : null;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatPayload(event: SIEMEvent, config: SIEMConfig): unknown {
  if (config.provider === 'splunk') {
    return {
      event: {
        source: 'iron-gate',
        sourcetype: 'iron-gate:ai-governance',
        ...event,
      },
      time: Math.floor(new Date(event.timestamp).getTime() / 1000),
    };
  }

  if (config.format === 'cef') {
    // Common Event Format
    return {
      cef: `CEF:0|IronGate|AIGovernance|1.0|${event.action}|AI Tool Activity|${mapSeverity(event.sensitivityLevel)}|` +
        `src=${event.aiToolId} sev=${event.sensitivityLevel} score=${event.sensitivityScore} entities=${event.entityCount}`,
      timestamp: event.timestamp,
    };
  }

  if (config.format === 'asim') {
    // Azure Sentinel Information Model (ASIM) — NetworkSession schema
    return {
      TimeGenerated: event.timestamp,
      EventType: 'NetworkSession',
      EventProduct: 'IronGate',
      EventVendor: 'IronGate',
      EventSchema: 'NetworkSession',
      EventSchemaVersion: '0.2.6',
      EventSeverity: mapASIMSeverity(event.sensitivityLevel),
      EventResult: event.action === 'blocked' ? 'Failure' : 'Success',
      DvcAction: event.action,
      SrcAppName: event.aiToolId,
      EventOriginalUid: event.eventId,
      AdditionalFields: JSON.stringify({
        sensitivityScore: event.sensitivityScore,
        sensitivityLevel: event.sensitivityLevel,
        entityCount: event.entityCount,
        captureMethod: event.captureMethod,
        firmId: event.firmId,
      }),
    };
  }

  // Default: JSON format
  return {
    source: 'iron-gate',
    ...event,
  };
}

function buildHeaders(config: SIEMConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.provider === 'splunk') {
    headers['Authorization'] = `Splunk ${config.token}`;
  } else if (config.provider === 'datadog') {
    headers['DD-API-KEY'] = config.token;
  } else if (config.provider === 'sentinel') {
    headers['Authorization'] = `SharedKey ${config.token}`;
    headers['Log-Type'] = 'IronGate_CL';
  } else {
    headers['Authorization'] = `Bearer ${config.token}`;
  }

  return headers;
}

function mapASIMSeverity(level: string): string {
  switch (level) {
    case 'critical': return 'High';
    case 'high': return 'Medium';
    case 'medium': return 'Low';
    case 'low': return 'Informational';
    default: return 'Informational';
  }
}

function mapSeverity(level: string): number {
  switch (level) {
    case 'critical': return 10;
    case 'high': return 7;
    case 'medium': return 4;
    case 'low': return 1;
    default: return 0;
  }
}
