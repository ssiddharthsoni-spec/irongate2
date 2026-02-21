// ============================================================================
// Iron Gate — Security Alert Rule Engine
// ============================================================================
// Defines security alert rules and provides functions to evaluate them
// against real-time metrics. Covers API error spikes, brute force attacks,
// cross-firm access attempts, extension anomalies, DB exhaustion,
// outbound network anomalies, and audit trail integrity.
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface SecurityAlertRule {
  /** Unique rule identifier */
  name: string;
  /** Human-readable description of the triggering condition */
  condition: string;
  /** Severity classification */
  severity: AlertSeverity;
  /** Recommended response action */
  action: string;
}

export interface SecurityMetrics {
  /** Total HTTP requests in the evaluation window */
  totalRequests?: number;
  /** Count of 5xx responses in the evaluation window */
  errorCount5xx?: number;
  /** Whether a cross-firm query was detected */
  crossFirmQueryDetected?: boolean;
  /** Details about the cross-firm access attempt */
  crossFirmDetails?: { sourceFirmId: string; targetFirmId: string; query: string };
  /** Count of failed authentication attempts in the last minute */
  failedAuthAttemptsLastMinute?: number;
  /** Source IP of the authentication attempts */
  authSourceIp?: string;
  /** Whether an unusual extension update pattern was detected */
  extensionUpdateAnomaly?: boolean;
  /** Details about the extension anomaly */
  extensionAnomalyDetails?: { version: string; affectedUsers: number };
  /** Current DB connection pool usage as a percentage (0-100) */
  dbConnectionUsagePercent?: number;
  /** Current active DB connections */
  dbActiveConnections?: number;
  /** Maximum DB connections in the pool */
  dbMaxConnections?: number;
  /** Whether outbound network traffic is anomalous */
  outboundNetworkAnomaly?: boolean;
  /** Details about the outbound anomaly */
  outboundAnomalyDetails?: { destinationIp: string; bytesTransferred: number };
  /** Whether the audit trail hash chain verification has failed */
  auditTrailGap?: boolean;
  /** Position where the chain broke */
  auditTrailBrokenAt?: number;
  /** Firm ID where the gap was detected */
  auditTrailFirmId?: string;
}

export interface AlertCheckResult {
  /** Whether the alert condition was triggered */
  triggered: boolean;
  /** Details about why the alert was triggered (empty string if not triggered) */
  details: string;
}

export interface SecurityEvent {
  /** Rule that was triggered */
  rule: SecurityAlertRule;
  /** Details about the triggering event */
  details: string;
  /** ISO 8601 timestamp of the event */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Security Alert Rules
// ---------------------------------------------------------------------------

export const SECURITY_ALERT_RULES: SecurityAlertRule[] = [
  {
    name: 'api_error_spike',
    condition: '5xx error rate exceeds 5% over a 5-minute window',
    severity: 'high',
    action: 'Page on-call engineer; activate circuit breaker; snapshot request logs',
  },
  {
    name: 'cross_firm_query_attempt',
    condition: 'A query attempts to access data belonging to a different firm',
    severity: 'critical',
    action: 'Block query immediately; lock originating API key; notify security team; create incident',
  },
  {
    name: 'auth_brute_force',
    condition: 'More than 50 failed authentication attempts from a single source in 1 minute',
    severity: 'high',
    action: 'Rate-limit source IP; temporarily lock targeted account; alert security team',
  },
  {
    name: 'extension_update_anomaly',
    condition: 'Extension update pushed outside normal release cycle or with unexpected signature',
    severity: 'medium',
    action: 'Halt update rollout; verify extension package integrity; notify engineering lead',
  },
  {
    name: 'db_connection_exhaustion',
    condition: 'Database connection pool usage exceeds 80% of maximum capacity',
    severity: 'high',
    action: 'Enable connection queuing; kill idle connections; scale read replicas; page DBA',
  },
  {
    name: 'outbound_network_anomaly',
    condition: 'Unexpected outbound network traffic to non-whitelisted destinations detected',
    severity: 'critical',
    action: 'Block outbound connection; isolate affected service; trigger forensic capture; notify CISO',
  },
  {
    name: 'audit_trail_gap',
    condition: 'Cryptographic hash chain verification fails — missing or tampered entries detected',
    severity: 'critical',
    action: 'Freeze affected firm audit data; trigger full chain rebuild verification; notify compliance team; create forensic snapshot',
  },
];

// ---------------------------------------------------------------------------
// Alert Evaluation
// ---------------------------------------------------------------------------

/**
 * Check whether a specific security alert rule is triggered given the
 * current metrics snapshot.
 *
 * @param rule - The security alert rule to evaluate
 * @param metrics - Current system metrics snapshot
 * @returns Result indicating whether the alert triggered and why
 */
export function checkAlert(rule: SecurityAlertRule, metrics: SecurityMetrics): AlertCheckResult {
  switch (rule.name) {
    // -----------------------------------------------------------------------
    // API Error Spike: 5xx > 5% over 5min window
    // -----------------------------------------------------------------------
    case 'api_error_spike': {
      const total = metrics.totalRequests ?? 0;
      const errors = metrics.errorCount5xx ?? 0;
      if (total === 0) {
        return { triggered: false, details: '' };
      }
      const errorRate = (errors / total) * 100;
      if (errorRate > 5) {
        return {
          triggered: true,
          details: `5xx error rate is ${errorRate.toFixed(2)}% (${errors}/${total} requests). Threshold: 5%`,
        };
      }
      return { triggered: false, details: '' };
    }

    // -----------------------------------------------------------------------
    // Cross-Firm Query Attempt
    // -----------------------------------------------------------------------
    case 'cross_firm_query_attempt': {
      if (metrics.crossFirmQueryDetected) {
        const d = metrics.crossFirmDetails;
        return {
          triggered: true,
          details: d
            ? `Cross-firm access detected: source firm ${d.sourceFirmId} attempted to query firm ${d.targetFirmId}. Query: ${d.query.slice(0, 200)}`
            : 'Cross-firm query attempt detected',
        };
      }
      return { triggered: false, details: '' };
    }

    // -----------------------------------------------------------------------
    // Auth Brute Force: >50 failed attempts in 1 minute
    // -----------------------------------------------------------------------
    case 'auth_brute_force': {
      const attempts = metrics.failedAuthAttemptsLastMinute ?? 0;
      if (attempts > 50) {
        return {
          triggered: true,
          details: `${attempts} failed auth attempts in the last minute from ${metrics.authSourceIp ?? 'unknown source'}. Threshold: 50`,
        };
      }
      return { triggered: false, details: '' };
    }

    // -----------------------------------------------------------------------
    // Extension Update Anomaly
    // -----------------------------------------------------------------------
    case 'extension_update_anomaly': {
      if (metrics.extensionUpdateAnomaly) {
        const d = metrics.extensionAnomalyDetails;
        return {
          triggered: true,
          details: d
            ? `Anomalous extension update detected: version ${d.version} affecting ${d.affectedUsers} users`
            : 'Extension update anomaly detected',
        };
      }
      return { triggered: false, details: '' };
    }

    // -----------------------------------------------------------------------
    // DB Connection Exhaustion: >80%
    // -----------------------------------------------------------------------
    case 'db_connection_exhaustion': {
      const usage = metrics.dbConnectionUsagePercent ?? 0;
      if (usage > 80) {
        return {
          triggered: true,
          details: `DB connection pool at ${usage.toFixed(1)}% capacity (${metrics.dbActiveConnections ?? '?'}/${metrics.dbMaxConnections ?? '?'} connections). Threshold: 80%`,
        };
      }
      return { triggered: false, details: '' };
    }

    // -----------------------------------------------------------------------
    // Outbound Network Anomaly
    // -----------------------------------------------------------------------
    case 'outbound_network_anomaly': {
      if (metrics.outboundNetworkAnomaly) {
        const d = metrics.outboundAnomalyDetails;
        return {
          triggered: true,
          details: d
            ? `Anomalous outbound traffic to ${d.destinationIp} (${d.bytesTransferred} bytes transferred)`
            : 'Outbound network anomaly detected',
        };
      }
      return { triggered: false, details: '' };
    }

    // -----------------------------------------------------------------------
    // Audit Trail Gap: hash chain verification failure
    // -----------------------------------------------------------------------
    case 'audit_trail_gap': {
      if (metrics.auditTrailGap) {
        return {
          triggered: true,
          details: metrics.auditTrailBrokenAt != null
            ? `Audit trail hash chain broken at position ${metrics.auditTrailBrokenAt} for firm ${metrics.auditTrailFirmId ?? 'unknown'}`
            : 'Audit trail hash chain verification failed',
        };
      }
      return { triggered: false, details: '' };
    }

    // -----------------------------------------------------------------------
    // Unknown rule
    // -----------------------------------------------------------------------
    default:
      return { triggered: false, details: `Unknown rule: ${rule.name}` };
  }
}

// ---------------------------------------------------------------------------
// Security Event Logging
// ---------------------------------------------------------------------------

/**
 * Log a triggered security event as structured JSON to stderr.
 *
 * Uses console.error so that it is captured by log aggregation systems
 * monitoring stderr (standard practice for security events).
 *
 * @param alert - The security alert rule that was triggered
 * @param details - Contextual details about the triggering event
 */
export function logSecurityEvent(alert: SecurityAlertRule, details: string): void {
  const event: SecurityEvent = {
    rule: alert,
    details,
    timestamp: new Date().toISOString(),
  };

  console.error(JSON.stringify({
    level: 'SECURITY_ALERT',
    severity: alert.severity,
    ruleName: alert.name,
    condition: alert.condition,
    action: alert.action,
    details,
    timestamp: event.timestamp,
  }));
}

// ---------------------------------------------------------------------------
// Convenience: Evaluate All Rules
// ---------------------------------------------------------------------------

/**
 * Evaluate all security alert rules against a metrics snapshot and
 * automatically log any triggered alerts.
 *
 * @param metrics - Current system metrics snapshot
 * @returns Array of triggered alert results with their associated rules
 */
export function evaluateAllAlerts(
  metrics: SecurityMetrics
): Array<{ rule: SecurityAlertRule; result: AlertCheckResult }> {
  const triggered: Array<{ rule: SecurityAlertRule; result: AlertCheckResult }> = [];

  for (const rule of SECURITY_ALERT_RULES) {
    const result = checkAlert(rule, metrics);
    if (result.triggered) {
      logSecurityEvent(rule, result.details);
      triggered.push({ rule, result });
    }
  }

  return triggered;
}
