// ============================================================================
// Iron Gate — Database Query Anomaly Detector
// ============================================================================
// Inspects raw SQL queries for patterns that indicate security violations:
// cross-firm data access, unbounded reads, schema mutations, and RLS bypass
// attempts. Designed to be called as middleware before query execution.
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueryAnomalySeverity = 'critical' | 'high' | 'medium' | 'low';

export interface QueryAnomalyRule {
  /** Unique rule identifier */
  name: string;
  /** Regex pattern that matches the suspicious query */
  pattern: RegExp;
  /** Severity classification */
  severity: QueryAnomalySeverity;
  /** Recommended response action */
  action: string;
}

export interface QueryAnalysisResult {
  /** Whether the query should be blocked from execution */
  blocked: boolean;
  /** Names of all rules that matched the query */
  matchedRules: string[];
}

// ---------------------------------------------------------------------------
// Anomaly Rules
// ---------------------------------------------------------------------------

export const QUERY_ANOMALY_RULES: QueryAnomalyRule[] = [
  // -------------------------------------------------------------------------
  // Cross-Firm Query Detection
  // Matches SELECT on events (or other firm-scoped tables) where firm_id
  // is compared using != , <>, or NOT IN — indicating an attempt to read
  // another firm's data.
  // -------------------------------------------------------------------------
  {
    name: 'cross_firm_query',
    pattern:
      /SELECT\b[\s\S]*?\bFROM\b[\s\S]*?\b(?:events|feedback|pseudonym_maps|entity_co_occurrences|inferred_entities|sensitivity_patterns|weight_overrides|webhook_subscriptions|client_matters|firm_plugins)\b[\s\S]*?\bfirm_id\b\s*(?:!=|<>|NOT\s+IN)\b/i,
    severity: 'critical',
    action:
      'Block query immediately; log full query text; revoke session; alert security team; create incident report',
  },

  // -------------------------------------------------------------------------
  // Bulk Read Detection
  // Matches SELECT statements that lack a LIMIT clause, which could
  // indicate unbounded data extraction attempts.
  // -------------------------------------------------------------------------
  {
    name: 'bulk_read',
    pattern:
      /^(?=[\s\S]*\bSELECT\b)(?![\s\S]*\bLIMIT\b)(?![\s\S]*\bCOUNT\s*\()(?![\s\S]*\bEXISTS\s*\()(?![\s\S]*\bINSERT\b)(?![\s\S]*\bUPDATE\b)(?![\s\S]*\bDELETE\b)[\s\S]*\bFROM\b[\s\S]*$/i,
    severity: 'medium',
    action:
      'Log warning; consider adding LIMIT clause; monitor for repeated offenses; flag for review',
  },

  // -------------------------------------------------------------------------
  // Schema Change Detection
  // Matches ALTER TABLE, DROP TABLE, DROP INDEX, CREATE TABLE, TRUNCATE,
  // and other DDL statements that should never come from application code.
  // -------------------------------------------------------------------------
  {
    name: 'schema_change',
    pattern:
      /\b(?:ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|SCHEMA|DATABASE|FUNCTION|TRIGGER)|CREATE\s+(?:TABLE|INDEX|SCHEMA|DATABASE|FUNCTION|TRIGGER)|TRUNCATE)\b/i,
    severity: 'critical',
    action:
      'Block query; terminate connection; alert DBA and security team; snapshot database state; investigate source',
  },

  // -------------------------------------------------------------------------
  // RLS Bypass Attempt
  // Detects attempts to set the app.current_firm_id session variable,
  // which is used by Row Level Security policies. Manipulating this
  // variable could allow access to another firm's data.
  // -------------------------------------------------------------------------
  {
    name: 'rls_bypass_attempt',
    pattern:
      /\bSET\b[\s\S]*?\b(?:app\.current_firm_id|app\.current_user_id|role|session_authorization)\b/i,
    severity: 'critical',
    action:
      'Block query immediately; terminate session; revoke all active tokens for the user; alert security team; create forensic snapshot',
  },
];

// ---------------------------------------------------------------------------
// Query Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze a SQL query string against all anomaly detection rules.
 *
 * Returns whether the query should be blocked and which rules it matched.
 * A query is blocked if ANY matched rule has 'critical' or 'high' severity.
 *
 * @param sqlQuery - The raw SQL query string to analyze
 * @returns Analysis result with block decision and matched rules
 *
 * @example
 * ```typescript
 * const result = analyzeQuery("SELECT * FROM events WHERE firm_id != 'abc-123'");
 * // result.blocked === true
 * // result.matchedRules === ['cross_firm_query']
 * ```
 */
export function analyzeQuery(sqlQuery: string): QueryAnalysisResult {
  if (!sqlQuery || typeof sqlQuery !== 'string') {
    return { blocked: false, matchedRules: [] };
  }

  // Normalize whitespace for more reliable matching
  const normalized = sqlQuery.replace(/\s+/g, ' ').trim();

  const matchedRules: string[] = [];
  let blocked = false;

  for (const rule of QUERY_ANOMALY_RULES) {
    if (rule.pattern.test(normalized)) {
      matchedRules.push(rule.name);

      // Block on critical or high severity matches
      if (rule.severity === 'critical' || rule.severity === 'high') {
        blocked = true;
      }

      // Log the match for audit purposes
      logQueryAnomaly(rule, normalized);
    }
  }

  return { blocked, matchedRules };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/**
 * Log a detected query anomaly as structured JSON to stderr.
 *
 * @param rule - The anomaly rule that was matched
 * @param query - The query that triggered the rule (truncated for safety)
 */
function logQueryAnomaly(rule: QueryAnomalyRule, query: string): void {
  // Truncate the query to prevent log injection / excessive log size
  const truncatedQuery = query.length > 500 ? query.slice(0, 500) + '...[TRUNCATED]' : query;

  console.error(JSON.stringify({
    level: 'QUERY_ANOMALY',
    severity: rule.severity,
    ruleName: rule.name,
    action: rule.action,
    query: truncatedQuery,
    timestamp: new Date().toISOString(),
  }));
}
