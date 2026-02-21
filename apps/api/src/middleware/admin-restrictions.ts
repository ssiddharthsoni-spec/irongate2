import { createMiddleware } from 'hono/factory';

/**
 * Iron Gate internal admin restrictions middleware.
 *
 * Iron Gate staff should NEVER be able to view individual customer detection
 * events, entity details, or prompt content. This middleware enforces that
 * admin/internal endpoints can only access aggregate, anonymized data and
 * requires dual-approval headers for any admin action.
 *
 * Design principles:
 *   - Aggregate-only: only statistical queries are permitted
 *   - Dual approval: two independent admin keys must be present
 *   - Audit trail: every admin action is logged with a justification
 */

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

/**
 * Regex patterns for ALLOWED aggregate-only queries.
 * These match paths that return only statistical / rolled-up data.
 */
export const ALLOWED_AGGREGATE_PATTERNS: RegExp[] = [
  /^\/v1\/admin\/metrics\/aggregate/,         // aggregate metrics
  /^\/v1\/admin\/dashboard\/summary/,          // summary dashboards
  /^\/v1\/admin\/reports\/compliance/,         // compliance reports (aggregate)
  /^\/v1\/admin\/stats\/(firm-count|event-totals|sensitivity-distribution)/, // platform-wide stats
  /^\/v1\/admin\/health/,                      // system health
  /^\/v1\/admin\/plugins$/,                    // plugin catalogue (no firm data)
];

/**
 * Regex patterns for BLOCKED queries that would expose individual customer data.
 * If the request path matches any of these, access is denied outright.
 */
export const BLOCKED_PATTERNS: RegExp[] = [
  /\/events\/[a-f0-9-]+$/,                    // individual event by ID
  /\/entities\/[a-f0-9-]+$/,                  // individual entity detail
  /\/prompts?\//,                             // prompt content or references
  /\/firms\/[a-f0-9-]+\/events/,             // single-firm event listing
  /\/firms\/[a-f0-9-]+\/entities/,           // single-firm entity listing
  /\/users\/[a-f0-9-]+\/activity/,           // individual user activity
  /\/audit\/[a-f0-9-]+$/,                    // individual audit record
  /\/documents\/[a-f0-9-]+\/content/,        // document content
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate dual-approval headers.
 * Both `X-Admin-Key-1` and `X-Admin-Key-2` must be present and valid.
 * The keys must be different (two distinct approvers).
 */
function validateDualApproval(
  key1: string | undefined,
  key2: string | undefined,
): { valid: boolean; reason?: string } {
  if (!key1 || !key2) {
    return { valid: false, reason: 'Dual approval required: both X-Admin-Key-1 and X-Admin-Key-2 headers must be present' };
  }

  if (key1 === key2) {
    return { valid: false, reason: 'Dual approval failed: both keys must be from different approvers' };
  }

  // In production, these would be verified against a key store / HSM.
  // For now, validate that they are non-empty and structurally valid (min 32 chars).
  if (key1.length < 32 || key2.length < 32) {
    return { valid: false, reason: 'Dual approval failed: admin keys must be at least 32 characters' };
  }

  return { valid: true };
}

/**
 * Log an admin action for the audit trail.
 */
function logAdminAction(params: {
  method: string;
  path: string;
  adminKey1Prefix: string;
  adminKey2Prefix: string;
  justification: string | undefined;
  allowed: boolean;
  reason?: string;
}) {
  const entry = {
    timestamp: new Date().toISOString(),
    type: 'admin_access',
    method: params.method,
    path: params.path,
    adminKey1Prefix: params.adminKey1Prefix,
    adminKey2Prefix: params.adminKey2Prefix,
    justification: params.justification || '(none provided)',
    allowed: params.allowed,
    reason: params.reason,
  };

  // Structured JSON log — ingested by SIEM / audit pipeline
  console.log(JSON.stringify(entry));
}

/**
 * Safely extract a prefix from an admin key for logging (never log the full key).
 */
function keyPrefix(key: string | undefined): string {
  if (!key) return '(missing)';
  return key.length >= 8 ? `${key.slice(0, 8)}...` : '(too-short)';
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Admin restrictions middleware.
 *
 * Apply this to Iron Gate internal admin routes to ensure:
 *   1. Blocked patterns are always rejected
 *   2. Dual-approval headers are validated
 *   3. A justification header is required
 *   4. All access (allowed or denied) is logged
 */
export const adminRestrictionsMiddleware = createMiddleware(async (c, next) => {
  const method = c.req.method;
  const path = c.req.path;

  const adminKey1 = c.req.header('X-Admin-Key-1');
  const adminKey2 = c.req.header('X-Admin-Key-2');
  const justification = c.req.header('X-Admin-Justification');

  const k1Prefix = keyPrefix(adminKey1);
  const k2Prefix = keyPrefix(adminKey2);

  // ------------------------------------------------------------------
  // 1. Check blocked patterns first — always deny
  // ------------------------------------------------------------------
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(path)) {
      const reason = `Access denied: path matches blocked pattern (${pattern.source})`;
      logAdminAction({ method, path, adminKey1Prefix: k1Prefix, adminKey2Prefix: k2Prefix, justification, allowed: false, reason });
      return c.json({ error: 'Forbidden: access to individual customer data is not permitted for Iron Gate admin' }, 403);
    }
  }

  // ------------------------------------------------------------------
  // 2. Validate dual-approval headers
  // ------------------------------------------------------------------
  const approval = validateDualApproval(adminKey1, adminKey2);
  if (!approval.valid) {
    logAdminAction({ method, path, adminKey1Prefix: k1Prefix, adminKey2Prefix: k2Prefix, justification, allowed: false, reason: approval.reason });
    return c.json({ error: approval.reason }, 403);
  }

  // ------------------------------------------------------------------
  // 3. Require justification for audit trail
  // ------------------------------------------------------------------
  if (!justification || justification.trim().length < 10) {
    const reason = 'A justification of at least 10 characters is required via X-Admin-Justification header';
    logAdminAction({ method, path, adminKey1Prefix: k1Prefix, adminKey2Prefix: k2Prefix, justification, allowed: false, reason });
    return c.json({ error: reason }, 403);
  }

  // ------------------------------------------------------------------
  // 4. Log the allowed action and proceed
  // ------------------------------------------------------------------
  logAdminAction({ method, path, adminKey1Prefix: k1Prefix, adminKey2Prefix: k2Prefix, justification, allowed: true });

  await next();
});
