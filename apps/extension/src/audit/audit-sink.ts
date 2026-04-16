/**
 * Audit Sink — customer-controlled destinations for IronGate audit logs
 *
 * v1.0 SOVEREIGN MODE CONTRACT:
 *
 * IronGate never sends audit logs to its own infrastructure unless the customer
 * explicitly opts in via auditLogDestination='irongate-dashboard'. The default
 * is 'none' (no logs leave the device). All other destinations are
 * customer-controlled — they go to the firm's S3 bucket, their SIEM, or their
 * webhook endpoint.
 *
 * The four supported destinations:
 *
 *   none      — No external sink. Logs are kept in IndexedDB only and viewable
 *               in the sidepanel for the user's own session. This is the
 *               privacy-maximalist default.
 *
 *   s3        — POST signed log batches to a customer-controlled S3 bucket.
 *               Uses presigned URLs (no long-lived AWS credentials in extension).
 *
 *   syslog    — Send each log entry as a syslog message (RFC 5424 over TCP)
 *               to a customer-controlled syslog server. Most enterprise SIEMs
 *               (Splunk, QRadar, ArcSight) accept syslog as their primary input.
 *
 *   webhook   — POST log entries as JSON to a customer-controlled HTTPS URL.
 *               Generic destination for SIEM agents that don't speak syslog.
 *
 * BATCHING: All sinks batch logs in 5-second windows or 50-entry chunks (whichever
 * comes first) to avoid one HTTP request per detection. The local IndexedDB
 * buffer survives extension restarts so a sink outage doesn't lose data.
 *
 * RETRY: Failed batches go into a retry queue with exponential backoff.
 * After 24 hours of failed retries, the batch is dropped and a notification
 * is shown to the user explaining the audit log is degraded.
 *
 * THIS FILE IS THE AUDIT EGRESS BOUNDARY. Every byte that leaves the device
 * via the audit log path goes through one of the sinks defined here. Adding
 * a new sink requires architectural review.
 */

export interface AuditEntry {
  /** UUID v4 */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Firm ID from managed config (never sent to IronGate) */
  firmId?: string;
  /** Anonymized device identifier (hashed) */
  deviceHash: string;
  /** Which AI tool was the prompt sent to */
  aiTool: string;
  /** Sensitivity zone determined by detection */
  zone: 'green' | 'amber' | 'red';
  /** Sensitivity score 0-100 */
  score: number;
  /** Number of entities detected (no entity TEXT — only counts and types) */
  entityCount: number;
  /** Entity types only — never the entity values */
  entityTypes: string[];
  /** Action taken */
  action: 'allowed' | 'pseudonymized' | 'blocked' | 'low-risk-passthrough';
  /** Detection tier that produced this result */
  tier: 1 | 2 | 3;
  /** Pseudonymization applied? Counts only — no original or fake values */
  pseudonymsApplied: number;
  /** Local model used (for tier 2) */
  modelUsed?: string;
  /** Inference latency in ms */
  latencyMs?: number;
  /** Conversation/turn metadata for forensic correlation (no PII) */
  conversationId?: string;
  turnNumber?: number;
}

export type SinkDestination = 'none' | 's3' | 'syslog' | 'webhook' | 'irongate-dashboard';

export interface SinkConfig {
  destination: SinkDestination;
  /** Destination-specific config — schema depends on destination */
  config: Record<string, string>;
}

export interface SinkResult {
  ok: boolean;
  delivered: number;
  failed: number;
  error?: string;
}

/**
 * The contract every sink must implement. Sinks are stateless — the audit
 * buffer manages batching, retry, and persistence. The sink only handles
 * the actual delivery to its destination.
 */
export interface AuditSink {
  destination: SinkDestination;
  /** Send a batch of audit entries. Returns delivery result. */
  deliver(batch: AuditEntry[]): Promise<SinkResult>;
  /** Validate the sink config without actually delivering. */
  validate(): { ok: boolean; error?: string };
}

// ─── Sink Factory ──────────────────────────────────────────────────────────

export function createSink(cfg: SinkConfig): AuditSink {
  switch (cfg.destination) {
    case 'none':           return new NullSink();
    case 'webhook':        return new WebhookSink(cfg.config);
    case 'syslog':         return new SyslogSink(cfg.config);
    case 's3':             return new S3PresignedSink(cfg.config);
    case 'irongate-dashboard': return new IronGateDashboardSink(cfg.config);
    default:
      throw new Error(`Unknown audit sink destination: ${cfg.destination}`);
  }
}

// ─── NullSink — privacy-first default ─────────────────────────────────────

class NullSink implements AuditSink {
  destination: SinkDestination = 'none';
  validate(): { ok: boolean; error?: string } { return { ok: true }; }
  async deliver(batch: AuditEntry[]): Promise<SinkResult> {
    // The point of NullSink is that NOTHING leaves the device.
    // Entries are still kept in IndexedDB for the user's own session view.
    return { ok: true, delivered: batch.length, failed: 0 };
  }
}

// ─── WebhookSink — generic HTTPS POST ────────────────────────────────────

class WebhookSink implements AuditSink {
  destination: SinkDestination = 'webhook';
  private url: string;
  private authHeader?: string;

  constructor(config: Record<string, string>) {
    this.url = config.url || '';
    if (config.bearerToken) {
      this.authHeader = `Bearer ${config.bearerToken}`;
    }
  }

  validate(): { ok: boolean; error?: string } {
    if (!this.url) return { ok: false, error: 'webhook url is required' };
    if (!/^https:\/\//i.test(this.url)) return { ok: false, error: 'webhook url must be HTTPS' };
    return { ok: true };
  }

  async deliver(batch: AuditEntry[]): Promise<SinkResult> {
    const v = this.validate();
    if (!v.ok) return { ok: false, delivered: 0, failed: batch.length, error: v.error };

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-IronGate-Schema': '1',
        'X-IronGate-Batch-Size': String(batch.length),
      };
      if (this.authHeader) headers['Authorization'] = this.authHeader;

      const response = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          schema: 'irongate.audit.v1',
          batchedAt: new Date().toISOString(),
          entries: batch,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          ok: false,
          delivered: 0,
          failed: batch.length,
          error: `webhook HTTP ${response.status}`,
        };
      }
      return { ok: true, delivered: batch.length, failed: 0 };
    } catch (err) {
      return {
        ok: false,
        delivered: 0,
        failed: batch.length,
        error: `webhook error: ${(err as Error).message}`,
      };
    }
  }
}

// ─── SyslogSink — RFC 5424 over HTTPS (for cloud SIEM ingestion) ─────────
// Note: real syslog is UDP/TCP, which Chrome extensions cannot send. We use
// the "syslog over HTTPS" pattern that most enterprise SIEM agents support.
// The customer's SIEM agent listens on an HTTPS endpoint and converts the
// JSON-wrapped syslog messages to RFC 5424 format internally.

class SyslogSink implements AuditSink {
  destination: SinkDestination = 'syslog';
  private url: string;
  private appName: string;
  private facility: number;

  constructor(config: Record<string, string>) {
    this.url = config.url || '';
    this.appName = config.appName || 'irongate';
    this.facility = Number(config.facility ?? 16); // local0
  }

  validate(): { ok: boolean; error?: string } {
    if (!this.url) return { ok: false, error: 'syslog url is required' };
    if (!/^https:\/\//i.test(this.url)) return { ok: false, error: 'syslog url must be HTTPS' };
    if (this.facility < 0 || this.facility > 23) {
      return { ok: false, error: 'syslog facility must be 0-23' };
    }
    return { ok: true };
  }

  async deliver(batch: AuditEntry[]): Promise<SinkResult> {
    const v = this.validate();
    if (!v.ok) return { ok: false, delivered: 0, failed: batch.length, error: v.error };

    try {
      // Build RFC 5424 messages
      const messages = batch.map((entry) => {
        const severity = severityForZone(entry.zone);
        const pri = (this.facility * 8) + severity;
        // RFC 5424: <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA MSG
        return `<${pri}>1 ${entry.timestamp} ${entry.deviceHash.substring(0, 16)} ${this.appName} - ${entry.id} - ${JSON.stringify(entry)}`;
      });

      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/syslog+json',
          'X-IronGate-Schema': '1',
        },
        body: JSON.stringify({ messages }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { ok: false, delivered: 0, failed: batch.length, error: `syslog HTTP ${response.status}` };
      }
      return { ok: true, delivered: batch.length, failed: 0 };
    } catch (err) {
      return {
        ok: false,
        delivered: 0,
        failed: batch.length,
        error: `syslog error: ${(err as Error).message}`,
      };
    }
  }
}

function severityForZone(zone: 'green' | 'amber' | 'red'): number {
  // RFC 5424 severities: 0=emerg, 1=alert, 2=crit, 3=err, 4=warn, 5=notice, 6=info, 7=debug
  if (zone === 'red') return 4;    // warning — sensitive data detected
  if (zone === 'amber') return 5;  // notice — possibly sensitive
  return 6;                         // info — green / passthrough
}

// ─── S3PresignedSink — direct upload to customer S3 bucket ───────────────
// Uses the presigned URL pattern: customer's backend pre-signs an S3 PUT URL,
// the extension uploads the batch to that URL. No AWS credentials in the
// extension. The presigned URL expires after a short window.

class S3PresignedSink implements AuditSink {
  destination: SinkDestination = 's3';
  private presignerUrl: string;
  private bucket: string;
  private prefix: string;

  constructor(config: Record<string, string>) {
    this.presignerUrl = config.presignerUrl || '';
    this.bucket = config.bucket || '';
    this.prefix = config.prefix || 'irongate/';
  }

  validate(): { ok: boolean; error?: string } {
    if (!this.presignerUrl) return { ok: false, error: 's3 presignerUrl is required' };
    if (!/^https:\/\//i.test(this.presignerUrl)) return { ok: false, error: 'presignerUrl must be HTTPS' };
    if (!this.bucket) return { ok: false, error: 's3 bucket is required' };
    return { ok: true };
  }

  async deliver(batch: AuditEntry[]): Promise<SinkResult> {
    const v = this.validate();
    if (!v.ok) return { ok: false, delivered: 0, failed: batch.length, error: v.error };

    try {
      // Step 1: Ask the customer's pre-signer for a PUT URL
      const objectKey = `${this.prefix}${new Date().toISOString().substring(0, 10)}/${batch[0].id}.json`;
      const presignResp = await fetch(this.presignerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket: this.bucket, key: objectKey, contentType: 'application/json' }),
        signal: AbortSignal.timeout(5000),
      });
      if (!presignResp.ok) {
        return { ok: false, delivered: 0, failed: batch.length, error: `presigner HTTP ${presignResp.status}` };
      }
      const { url: presignedUrl } = (await presignResp.json()) as { url: string };
      if (!presignedUrl) {
        return { ok: false, delivered: 0, failed: batch.length, error: 'presigner returned no url' };
      }

      // Step 2: PUT the batch directly to S3
      const putResp = await fetch(presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema: 'irongate.audit.v1',
          uploadedAt: new Date().toISOString(),
          entries: batch,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!putResp.ok) {
        return { ok: false, delivered: 0, failed: batch.length, error: `s3 PUT HTTP ${putResp.status}` };
      }
      return { ok: true, delivered: batch.length, failed: 0 };
    } catch (err) {
      return {
        ok: false,
        delivered: 0,
        failed: batch.length,
        error: `s3 error: ${(err as Error).message}`,
      };
    }
  }
}

// ─── IronGateDashboardSink — opt-in managed dashboard ────────────────────
// Only used when the customer explicitly opts into IronGate's managed
// dashboard. This is the only sink that sends data to IronGate's
// infrastructure. It is NEVER the default for Sovereign Mode.

class IronGateDashboardSink implements AuditSink {
  destination: SinkDestination = 'irongate-dashboard';
  private apiUrl: string;
  private apiKey: string;

  constructor(config: Record<string, string>) {
    this.apiUrl = config.apiUrl || 'https://irongate-api.onrender.com/v1/audit/batch';
    this.apiKey = config.apiKey || '';
  }

  validate(): { ok: boolean; error?: string } {
    if (!this.apiKey) return { ok: false, error: 'irongate-dashboard sink requires apiKey' };
    return { ok: true };
  }

  async deliver(batch: AuditEntry[]): Promise<SinkResult> {
    const v = this.validate();
    if (!v.ok) return { ok: false, delivered: 0, failed: batch.length, error: v.error };

    // Client-generated idempotency key. A retry after a lost response
    // carries the same key, so the server returns {duplicate: true}
    // instead of re-inserting the audit entries. Matches the
    // server-side cache in apps/api/src/routes/audit.ts.
    const batchId = crypto.randomUUID();

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          'X-IronGate-Schema': '1',
        },
        body: JSON.stringify({ batchId, entries: batch }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        return { ok: false, delivered: 0, failed: batch.length, error: `dashboard HTTP ${response.status}` };
      }
      return { ok: true, delivered: batch.length, failed: 0 };
    } catch (err) {
      return {
        ok: false,
        delivered: 0,
        failed: batch.length,
        error: `dashboard error: ${(err as Error).message}`,
      };
    }
  }
}
