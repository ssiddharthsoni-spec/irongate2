/**
 * Health Monitor — Stability Layer
 *
 * Periodic self-test that verifies core pipeline components are functional.
 * Reports health status to the side panel and logs anomalies.
 *
 * Checks:
 * 1. Regex detection produces results for known test input
 * 2. Scorer returns valid scores (not NaN, within 0-100)
 * 3. chrome.storage is accessible
 * 4. API connectivity (via health endpoint)
 *
 * Interval: every 5 minutes while service worker is alive.
 * Designed to be lightweight — each check completes in <50ms.
 */

export interface HealthStatus {
  healthy: boolean;
  checks: Record<string, CheckResult>;
  lastCheck: number;
}

interface CheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

let _lastStatus: HealthStatus | null = null;
let _checkTimer: ReturnType<typeof setTimeout> | null = null;

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Run all health checks and return status.
 */
export async function runHealthCheck(): Promise<HealthStatus> {
  const checks: Record<string, CheckResult> = {};

  // 1. Regex detection self-test
  checks.regex = await timeCheck(async () => {
    const { detectWithRegex } = await import('../detection/fallback-regex');
    const entities = detectWithRegex('Contact John Smith at john@example.com or 555-123-4567');
    if (entities.length < 2) {
      throw new Error(`Expected ≥2 entities, got ${entities.length}`);
    }
  });

  // 2. Scorer self-test
  checks.scorer = await timeCheck(async () => {
    const { computeScore } = await import('../detection/scorer');
    const result = computeScore('Test text with no PII', []);
    if (!Number.isFinite(result.score) || result.score < 0 || result.score > 100) {
      throw new Error(`Invalid score: ${result.score}`);
    }
  });

  // 3. Storage accessibility
  checks.storage = await timeCheck(async () => {
    const testKey = '__ig_health_check';
    await chrome.storage.local.set({ [testKey]: Date.now() });
    const result = await chrome.storage.local.get(testKey);
    if (!result[testKey]) {
      throw new Error('Storage write/read failed');
    }
    await chrome.storage.local.remove(testKey);
  });

  // 4. API connectivity
  checks.api = await timeCheck(async () => {
    let healthUrl = 'https://irongate-api.onrender.com/health';
    try {
      const stored = await chrome.storage.local.get('ironGateApiUrl');
      if (stored.ironGateApiUrl) {
        healthUrl = stored.ironGateApiUrl.replace(/\/v1\/?$/, '') + '/health';
      }
    } catch { /* use default */ }
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
  });

  const healthy = Object.values(checks).every(c => c.ok);
  _lastStatus = { healthy, checks, lastCheck: Date.now() };

  return _lastStatus;
}

/**
 * Get the most recent health status without running a new check.
 */
export function getLastHealthStatus(): HealthStatus | null {
  return _lastStatus;
}

/**
 * Start periodic health checks.
 */
export function startHealthMonitor(): void {
  if (_checkTimer) return;

  // Run initial check after a short delay (don't block startup)
  setTimeout(() => {
    runHealthCheck().catch(() => {});
  }, 10_000);

  _checkTimer = setInterval(() => {
    runHealthCheck().catch(() => {});
  }, CHECK_INTERVAL);
}

/**
 * Stop periodic health checks.
 */
export function stopHealthMonitor(): void {
  if (_checkTimer) {
    clearInterval(_checkTimer);
    _checkTimer = null;
  }
}

async function timeCheck(fn: () => Promise<void>): Promise<CheckResult> {
  const start = performance.now();
  try {
    await fn();
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
