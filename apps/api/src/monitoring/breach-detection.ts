// ============================================================================
// Iron Gate — Breach Detection Signals
// ============================================================================
// Defines the 7 breach detection signals from the PRD and provides
// evaluation and escalation functions. Each signal maps to a specific
// anomaly pattern that may indicate a data breach in progress.
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BreachSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface BreachSignal {
  /** Unique identifier for the breach signal */
  signal: string;
  /** How this signal is detected */
  detection: string;
  /** Recommended response action */
  action: string;
  /** Severity classification */
  severity: BreachSeverity;
}

export interface BreachMetrics {
  /** Prompt volume relative to baseline (e.g. 3.0 = 3x normal) */
  promptVolumeMultiplier?: number;
  /** Firm ID associated with the volume spike */
  volumeSpikeFirmId?: string;
  /** Number of unique users in the volume spike */
  volumeSpikeUserCount?: number;

  /** Whether sensitive data is being sent to a new/unsanctioned AI tool */
  newToolWithSensitiveData?: boolean;
  /** The unsanctioned tool identifier */
  newToolId?: string;
  /** Sensitivity score of the data being sent */
  newToolSensitivityScore?: number;

  /** Number of override requests in the evaluation window */
  overrideCount?: number;
  /** Time window (minutes) for override counting */
  overrideWindowMinutes?: number;
  /** Firm ID for override tracking */
  overrideFirmId?: string;

  /** Whether a cross-firm data access was detected */
  crossFirmAccess?: boolean;
  /** Source firm attempting the access */
  crossFirmSourceId?: string;
  /** Target firm whose data was accessed */
  crossFirmTargetId?: string;

  /** Whether the audit hash chain has been tampered with */
  auditChainTampered?: boolean;
  /** Position where tampering was detected */
  auditChainBrokenPosition?: number;
  /** Firm ID of the tampered chain */
  auditChainFirmId?: string;

  /** Whether bulk data extraction pattern was detected */
  bulkExtractionDetected?: boolean;
  /** Number of records in the extraction attempt */
  bulkExtractionRecordCount?: number;
  /** Source of the extraction (user, API key, etc.) */
  bulkExtractionSource?: string;

  /** Whether pseudonym map reversal was attempted */
  pseudonymReversalAttempt?: boolean;
  /** Number of reversal attempts */
  pseudonymReversalCount?: number;
  /** Source of the reversal attempts */
  pseudonymReversalSource?: string;
}

export interface TriggeredSignal {
  /** The breach signal that was triggered */
  signal: BreachSignal;
  /** Human-readable description of what triggered it */
  details: string;
  /** ISO 8601 timestamp of detection */
  detectedAt: string;
}

// ---------------------------------------------------------------------------
// Breach Signal Definitions (PRD Section: 7 Breach Detection Signals)
// ---------------------------------------------------------------------------

export const BREACH_SIGNALS: BreachSignal[] = [
  {
    signal: 'unusual_volume_spike',
    detection:
      'Prompt volume exceeds 3x the rolling 7-day baseline for a firm or user within a 1-hour window',
    action:
      'Throttle affected firm/user to baseline rate; alert firm admin and security team; preserve logs for forensic review',
    severity: 'high',
  },
  {
    signal: 'sensitive_data_to_new_tool',
    detection:
      'High-sensitivity data (score >= 70) is submitted to an AI tool not previously used by the firm',
    action:
      'Block the request; notify firm compliance officer; quarantine the session; require explicit admin approval to continue',
    severity: 'critical',
  },
  {
    signal: 'excessive_override_pattern',
    detection:
      'More than 10 block-override requests from a single user or firm within a 15-minute window',
    action:
      'Temporarily revoke override privilege; escalate to firm admin; flag user account for review',
    severity: 'high',
  },
  {
    signal: 'cross_firm_data_leak',
    detection:
      'Data belonging to one firm is accessed or referenced in the context of another firm',
    action:
      'Immediately terminate the offending session; lock both firm contexts; create a security incident; notify both firms',
    severity: 'critical',
  },
  {
    signal: 'audit_chain_tampering',
    detection:
      'Cryptographic hash chain verification fails, indicating deleted or modified audit entries',
    action:
      'Freeze all audit operations for the affected firm; trigger full chain reconstruction; notify compliance and legal; preserve database snapshot',
    severity: 'critical',
  },
  {
    signal: 'bulk_data_extraction',
    detection:
      'A single session or API key retrieves more than 1000 records in under 5 minutes, or exports data without LIMIT clauses',
    action:
      'Rate-limit the source; terminate active queries; revoke API key; alert security team; capture network forensics',
    severity: 'critical',
  },
  {
    signal: 'pseudonym_reversal_attempt',
    detection:
      'Repeated attempts to look up or reverse-engineer pseudonym mappings outside the normal de-pseudonymization flow',
    action:
      'Block pseudonym map access for the source; invalidate affected session tokens; alert security team; audit all recent pseudonym lookups',
    severity: 'high',
  },
];

// ---------------------------------------------------------------------------
// Signal Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate all breach detection signals against the provided metrics.
 *
 * @param metrics - Current breach-relevant metrics snapshot
 * @returns Array of triggered signals with contextual details
 */
export function evaluateBreachSignals(metrics: BreachMetrics): TriggeredSignal[] {
  const triggered: TriggeredSignal[] = [];
  const now = new Date().toISOString();

  // -------------------------------------------------------------------------
  // 1. Unusual Volume Spike — prompt volume > 3x baseline
  // -------------------------------------------------------------------------
  if (metrics.promptVolumeMultiplier != null && metrics.promptVolumeMultiplier > 3.0) {
    const signal = findSignal('unusual_volume_spike');
    if (signal) {
      triggered.push({
        signal,
        details:
          `Prompt volume is ${metrics.promptVolumeMultiplier.toFixed(1)}x the 7-day baseline` +
          (metrics.volumeSpikeFirmId ? ` for firm ${metrics.volumeSpikeFirmId}` : '') +
          (metrics.volumeSpikeUserCount ? ` across ${metrics.volumeSpikeUserCount} users` : ''),
        detectedAt: now,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. Sensitive Data to New Tool — high-sensitivity to unsanctioned tool
  // -------------------------------------------------------------------------
  if (metrics.newToolWithSensitiveData) {
    const signal = findSignal('sensitive_data_to_new_tool');
    if (signal) {
      triggered.push({
        signal,
        details:
          `High-sensitivity data (score: ${metrics.newToolSensitivityScore ?? 'unknown'}) ` +
          `sent to previously unseen AI tool: ${metrics.newToolId ?? 'unknown'}`,
        detectedAt: now,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 3. Excessive Override Pattern — >10 overrides in 15 min
  // -------------------------------------------------------------------------
  if (metrics.overrideCount != null && metrics.overrideCount > 10) {
    const window = metrics.overrideWindowMinutes ?? 15;
    const signal = findSignal('excessive_override_pattern');
    if (signal) {
      triggered.push({
        signal,
        details:
          `${metrics.overrideCount} block overrides in the last ${window} minutes` +
          (metrics.overrideFirmId ? ` from firm ${metrics.overrideFirmId}` : ''),
        detectedAt: now,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. Cross-Firm Data Leak
  // -------------------------------------------------------------------------
  if (metrics.crossFirmAccess) {
    const signal = findSignal('cross_firm_data_leak');
    if (signal) {
      triggered.push({
        signal,
        details:
          `Cross-firm data access detected` +
          (metrics.crossFirmSourceId && metrics.crossFirmTargetId
            ? `: firm ${metrics.crossFirmSourceId} accessed data belonging to firm ${metrics.crossFirmTargetId}`
            : ''),
        detectedAt: now,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 5. Audit Chain Tampering
  // -------------------------------------------------------------------------
  if (metrics.auditChainTampered) {
    const signal = findSignal('audit_chain_tampering');
    if (signal) {
      triggered.push({
        signal,
        details:
          `Audit hash chain integrity check failed` +
          (metrics.auditChainBrokenPosition != null
            ? ` at chain position ${metrics.auditChainBrokenPosition}`
            : '') +
          (metrics.auditChainFirmId ? ` for firm ${metrics.auditChainFirmId}` : ''),
        detectedAt: now,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 6. Bulk Data Extraction
  // -------------------------------------------------------------------------
  if (metrics.bulkExtractionDetected) {
    const signal = findSignal('bulk_data_extraction');
    if (signal) {
      triggered.push({
        signal,
        details:
          `Bulk data extraction pattern detected` +
          (metrics.bulkExtractionRecordCount
            ? `: ${metrics.bulkExtractionRecordCount} records retrieved`
            : '') +
          (metrics.bulkExtractionSource ? ` by ${metrics.bulkExtractionSource}` : ''),
        detectedAt: now,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 7. Pseudonym Reversal Attempt
  // -------------------------------------------------------------------------
  if (metrics.pseudonymReversalAttempt) {
    const signal = findSignal('pseudonym_reversal_attempt');
    if (signal) {
      triggered.push({
        signal,
        details:
          `Pseudonym map reversal attempt detected` +
          (metrics.pseudonymReversalCount
            ? `: ${metrics.pseudonymReversalCount} lookup attempts`
            : '') +
          (metrics.pseudonymReversalSource ? ` from ${metrics.pseudonymReversalSource}` : ''),
        detectedAt: now,
      });
    }
  }

  return triggered;
}

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------

/**
 * Escalate a triggered breach signal.
 *
 * Logs the incident as structured JSON to stderr for SIEM ingestion and
 * produces a formatted incident record. In a production deployment this
 * would also dispatch webhooks, page on-call, and create a formal incident.
 *
 * @param signal - The breach signal that was triggered
 * @param details - Contextual details about the triggering event
 */
export function escalateBreachSignal(signal: BreachSignal, details: string): void {
  const incident = {
    level: 'BREACH_SIGNAL',
    severity: signal.severity,
    signal: signal.signal,
    detection: signal.detection,
    recommendedAction: signal.action,
    details,
    escalatedAt: new Date().toISOString(),
  };

  // Log to stderr for SIEM / log aggregation pickup
  console.error(JSON.stringify(incident));

  // In production, this would also:
  // - Dispatch to webhook subscribers listening for 'anomaly_detected'
  // - Page the on-call security engineer for critical severity
  // - Create a formal incident ticket in the firm's ticketing system
  // - Forward to the configured SIEM endpoint
  if (signal.severity === 'critical') {
    console.error(
      `[BREACH DETECTION] CRITICAL: ${signal.signal} — immediate action required. ${details}`
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up a breach signal by its identifier.
 */
function findSignal(name: string): BreachSignal | undefined {
  return BREACH_SIGNALS.find((s) => s.signal === name);
}
