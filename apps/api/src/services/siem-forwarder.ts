// ============================================================================
// Iron Gate — SIEM Forwarder Service
// ============================================================================
// Forwards events to configured SIEM endpoints in standard formats.
// Supports Splunk HEC and generic JSON-over-HTTPS.
// ============================================================================

import { db } from '../db/client';
import { firms } from '../db/schema';
import { eq } from 'drizzle-orm';

interface SIEMConfig {
  enabled: boolean;
  provider: 'splunk' | 'datadog' | 'generic';
  url: string;
  token: string;
  format: 'json' | 'cef';
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

/**
 * Forward an event to the firm's configured SIEM endpoint.
 * Fire-and-forget — errors are logged but don't block the caller.
 */
export async function forward(firmId: string, event: SIEMEvent): Promise<void> {
  try {
    const config = await getSIEMConfig(firmId);
    if (!config || !config.enabled) return;

    const payload = formatPayload(event, config);

    await fetch(config.url, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    console.warn('[SIEM Forwarder] Failed to forward event:', error);
  }
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
  } else {
    headers['Authorization'] = `Bearer ${config.token}`;
  }

  return headers;
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
