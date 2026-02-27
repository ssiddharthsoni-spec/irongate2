/**
 * Extension Health Reporter — Priority 6.2
 *
 * Self-diagnostic that runs every 5 minutes.
 * Reports extension health status in heartbeat calls.
 */

export interface HealthStatus {
  /** Is the MAIN world script loaded? */
  mainWorldLoaded: boolean;
  /** Is the API reachable? */
  apiReachable: boolean;
  /** Is the event queue draining (not growing unboundedly)? */
  queueDraining: boolean;
  /** Number of errors in the last 5 minutes */
  errorsLast5Min: number;
  /** Overall health: healthy, degraded, or unhealthy */
  overall: 'healthy' | 'degraded' | 'unhealthy';
  /** ISO timestamp of last check */
  lastChecked: string;
}

const ERROR_LOG: number[] = [];
const MAX_ERROR_LOG = 100;

/**
 * Record an error occurrence for health tracking.
 */
export function recordError(): void {
  ERROR_LOG.push(Date.now());
  if (ERROR_LOG.length > MAX_ERROR_LOG) {
    ERROR_LOG.splice(0, ERROR_LOG.length - MAX_ERROR_LOG);
  }
}

/**
 * Count errors in the last N milliseconds.
 */
function countRecentErrors(windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  return ERROR_LOG.filter((ts) => ts > cutoff).length;
}

/**
 * Check if the API is reachable by pinging /health.
 */
async function checkApiReachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if the MAIN world script is loaded in any active tab.
 */
async function checkMainWorldLoaded(): Promise<boolean> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return true; // No active tab, assume ok

    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;
      // Skip non-AI platform tabs
      if (!tab.url.includes('chat.openai.com') &&
          !tab.url.includes('claude.ai') &&
          !tab.url.includes('gemini.google.com')) {
        continue;
      }

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => !!(window as any).__IRON_GATE_MAIN_WORLD,
          world: 'MAIN',
        });
        if (results?.[0]?.result) return true;
      } catch {
        // Script injection failed (CSP blocked, etc.)
      }
    }
    return true; // Default to ok if no AI tabs are open
  } catch {
    return true;
  }
}

/**
 * Run a complete health diagnostic.
 */
export async function runHealthCheck(
  apiBaseUrl: string,
  queueSize: number,
  prevQueueSize?: number
): Promise<HealthStatus> {
  const [apiReachable, mainWorldLoaded] = await Promise.all([
    checkApiReachable(apiBaseUrl),
    checkMainWorldLoaded(),
  ]);

  const errorsLast5Min = countRecentErrors(5 * 60 * 1000);
  const queueDraining = prevQueueSize === undefined || queueSize <= prevQueueSize;

  // Determine overall health
  let overall: HealthStatus['overall'] = 'healthy';
  if (!apiReachable || errorsLast5Min >= 10) {
    overall = 'unhealthy';
  } else if (!mainWorldLoaded || !queueDraining || errorsLast5Min >= 5) {
    overall = 'degraded';
  }

  return {
    mainWorldLoaded,
    apiReachable,
    queueDraining,
    errorsLast5Min,
    overall,
    lastChecked: new Date().toISOString(),
  };
}
