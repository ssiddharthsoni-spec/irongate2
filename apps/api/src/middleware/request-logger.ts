import { createMiddleware } from 'hono/factory';
import { metrics } from '../lib/metrics';

/**
 * Security-focused request logger middleware.
 *
 * Emits a structured JSON log line for every request with security-relevant
 * fields. Designed for ingestion by SIEM systems, log aggregators, and the
 * Iron Gate audit pipeline.
 *
 * What IS logged:
 *   - HTTP method, path, status code, latency
 *   - Authenticated firmId and userId (after auth middleware runs)
 *   - User-Agent and client IP
 *   - Suspicious-pattern flags
 *
 * What is NEVER logged (to prevent data leakage):
 *   - Request body / payload
 *   - Authorization headers or tokens
 *   - Response body
 */

// ---------------------------------------------------------------------------
// Suspicious-pattern detection
// ---------------------------------------------------------------------------

interface SuspiciousFlag {
  code: string;
  detail: string;
}

// Track per-IP request timestamps for rapid-request detection (in-memory, per-process)
const recentRequests = new Map<string, number[]>();
const RAPID_WINDOW_MS = 5_000;   // 5 second window
const RAPID_THRESHOLD = 20;       // more than 20 requests in the window
const CLEANUP_INTERVAL = 60_000;  // prune map every 60 seconds
const MAX_IPS_TRACKED = 10_000;   // bound total entries to prevent memory exhaustion
const MAX_TIMESTAMPS_PER_IP = 50; // cap array size per IP
let lastCleanup = Date.now();

function pruneOldEntries() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  const cutoff = now - RAPID_WINDOW_MS * 2;
  for (const [key, timestamps] of recentRequests) {
    const recent = timestamps.filter((t) => t > cutoff);
    if (recent.length === 0) {
      recentRequests.delete(key);
    } else {
      recentRequests.set(key, recent);
    }
  }

  // Hard cap: if still too many IPs after expiry sweep, drop oldest entries
  if (recentRequests.size > MAX_IPS_TRACKED) {
    const keys = Array.from(recentRequests.keys());
    const toDelete = recentRequests.size - MAX_IPS_TRACKED;
    for (let i = 0; i < toDelete; i++) recentRequests.delete(keys[i]);
  }
}

function detectSuspiciousPatterns(params: {
  firmId: string | undefined;
  userId: string | undefined;
  ip: string;
  path: string;
  headerFirmId: string | undefined;
  authFirmId: string | undefined;
}): SuspiciousFlag[] {
  const flags: SuspiciousFlag[] = [];

  // 1. Missing authentication context on a protected route
  if (!params.userId && params.path.startsWith('/v1/')) {
    flags.push({
      code: 'MISSING_AUTH',
      detail: 'Request to protected route without authenticated user context',
    });
  }

  // 2. Cross-firm attempt — X-Firm-ID header does not match authenticated firm
  if (
    params.headerFirmId &&
    params.authFirmId &&
    params.headerFirmId !== params.authFirmId
  ) {
    flags.push({
      code: 'CROSS_FIRM_ATTEMPT',
      detail: `X-Firm-ID header (${params.headerFirmId}) does not match authenticated firm (${params.authFirmId})`,
    });
  }

  // 3. Rapid requests from same IP
  pruneOldEntries();
  const now = Date.now();
  let timestamps = recentRequests.get(params.ip) || [];
  timestamps.push(now);

  // Cap array size: keep only the most recent timestamps to prevent memory bloat
  if (timestamps.length > MAX_TIMESTAMPS_PER_IP) {
    timestamps = timestamps.slice(-MAX_TIMESTAMPS_PER_IP);
  }
  recentRequests.set(params.ip, timestamps);

  const windowStart = now - RAPID_WINDOW_MS;
  const recentCount = timestamps.filter((t) => t > windowStart).length;
  if (recentCount > RAPID_THRESHOLD) {
    flags.push({
      code: 'RAPID_REQUESTS',
      detail: `${recentCount} requests from IP ${params.ip} in ${RAPID_WINDOW_MS / 1000}s window (threshold: ${RAPID_THRESHOLD})`,
    });
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export const requestLoggerMiddleware = createMiddleware(async (c, next) => {
  const startTime = Date.now();

  // Capture request metadata before handler runs
  const method = c.req.method;
  const path = c.req.path;
  const userAgent = c.req.header('User-Agent') || '(none)';
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown';
  const headerFirmId = c.req.header('X-Firm-ID');

  // Run the downstream handler
  await next();

  // Capture post-auth context (set by auth middleware)
  const firmId = c.get('firmId') as string | undefined;
  const userId = c.get('userId') as string | undefined;
  const statusCode = c.res.status;
  const latencyMs = Date.now() - startTime;

  // Detect suspicious patterns
  const suspiciousFlags = detectSuspiciousPatterns({
    firmId,
    userId,
    ip,
    path,
    headerFirmId,
    authFirmId: firmId,
  });

  // Build structured log entry
  const requestId = (c.get as any)('requestId') || null;
  const logEntry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    type: 'http_request',
    requestId,
    method,
    path,
    statusCode,
    latencyMs,
    firmId: firmId || null,
    userId: userId || null,
    userAgent,
    ip,
  };

  if (suspiciousFlags.length > 0) {
    logEntry.suspicious = true;
    logEntry.flags = suspiciousFlags;
  }

  // Record metrics for /health/metrics endpoint
  metrics.record(path, statusCode, latencyMs);

  // Emit as single-line JSON for log aggregator consumption
  console.log(JSON.stringify(logEntry));
});
