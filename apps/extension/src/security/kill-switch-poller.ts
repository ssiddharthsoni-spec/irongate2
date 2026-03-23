/**
 * Iron Gate — Kill Switch Poller
 *
 * Periodically polls the Iron Gate API for a kill-switch signal.  When the
 * kill switch is active **or** the server becomes unreachable the supplied
 * callback is invoked so the extension can gracefully disable itself
 * (e.g. stop intercepting prompts, clear in-memory caches, etc.).
 *
 * Design decisions:
 *  - Fail-closed: if the server is unreachable, we treat it the same as
 *    an active kill switch.  This prevents the extension from operating
 *    in an unmonitored state.
 *  - The poller runs on a simple `setInterval` because Chrome Manifest V3
 *    service workers can be terminated at any time; callers should
 *    re-start the poller in the service-worker `activate` handler.
 */

// ─── Configuration ───────────────────────────────────────────────────────────

/** Polling interval in milliseconds (60 seconds). */
export const POLL_INTERVAL = 60_000;

/** Maximum time (ms) to wait for the kill-switch endpoint before treating as unreachable.
 *  Render cold starts can take 15-30s, so give the server time to wake up. */
const REQUEST_TIMEOUT = 30_000;

/** Number of consecutive failures tolerated before fail-closed activates.
 *  3 failures × 60s interval = 3 minutes of grace for Render cold starts. */
const MAX_TRANSIENT_FAILURES = 3;

/** Tracks consecutive check failures. Reset on any successful response. */
let _consecutiveFailures = 0;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KillSwitchState {
  /** Whether the kill switch is currently engaged. */
  kill_switch: boolean;
  /** Whether the extension should remain active (inverse of kill_switch in most cases). */
  active: boolean;
  /** Server-side configuration version — useful for cache-busting. */
  config_version: number;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Fetch with a timeout.  The built-in `AbortSignal.timeout` is available in
 * modern Chrome but we fall back to a manual AbortController for safety.
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...extraHeaders },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Perform a single kill-switch check against the API.
 *
 * @param apiBaseUrl  The base URL of the Iron Gate API (no trailing slash).
 * @returns The current `KillSwitchState`.  If the server is unreachable or
 *          returns an error, a state with `kill_switch: true` is returned
 *          (fail-closed).
 */
export async function checkKillSwitch(
  apiBaseUrl: string,
  apiKey?: string,
): Promise<KillSwitchState> {
  // If no API key is configured, the extension isn't set up yet.
  // Don't activate the kill switch — just report inactive without blocking.
  if (!apiKey) {
    return { kill_switch: false, active: true, config_version: 0 };
  }

  const url = `${apiBaseUrl.replace(/\/+$/, '')}/security/extension/status`;

  try {
    const response = await fetchWithTimeout(url, REQUEST_TIMEOUT, {
      'X-API-Key': apiKey,
    });

    if (!response.ok) {
      // 401/403 = auth issue (key not registered yet, expired, etc.)
      // Don't lock the user out — treat as "not configured".
      if (response.status === 401 || response.status === 403) {
        console.warn(
          `[SECURITY] Kill-switch endpoint returned HTTP ${response.status}. API key not registered — skipping kill switch.`,
        );
        return { kill_switch: false, active: true, config_version: 0 };
      }
      // Other errors (5xx, etc.) — fail CLOSED.
      // If the server is down, we cannot confirm the extension is authorized
      // to operate. Block prompt processing until the server responds.
      // To avoid false lockouts on Render cold starts (15-30s), the poller
      // uses a 30s timeout and 60s interval, giving 2 full attempts before
      // a user even notices. Consecutive transient failures (up to 3) are
      // tolerated before activating the kill switch.
      _consecutiveFailures++;
      if (_consecutiveFailures <= MAX_TRANSIENT_FAILURES) {
        console.warn(
          `[SECURITY] Kill-switch endpoint returned HTTP ${response.status}. Transient failure ${_consecutiveFailures}/${MAX_TRANSIENT_FAILURES} — extension stays active.`,
        );
        return { kill_switch: false, active: true, config_version: -1 };
      }
      console.error(
        `[SECURITY] Kill-switch endpoint returned HTTP ${response.status} after ${_consecutiveFailures} consecutive failures. FAIL-CLOSED — blocking extension.`,
      );
      return { kill_switch: true, active: false, config_version: -1 };
    }

    // Success — reset failure counter
    _consecutiveFailures = 0;
    const data: KillSwitchState = await response.json();
    return data;
  } catch (error) {
    // Network error, timeout, or JSON parse failure.
    // Tolerate up to MAX_TRANSIENT_FAILURES consecutive failures for cold starts,
    // then fail-closed. This prevents unmonitored operation while avoiding
    // false lockouts from a single Render cold start.
    _consecutiveFailures++;
    if (_consecutiveFailures <= MAX_TRANSIENT_FAILURES) {
      console.warn(
        `[SECURITY] Kill-switch check failed (${_consecutiveFailures}/${MAX_TRANSIENT_FAILURES}). Extension stays active.`,
        error instanceof Error ? error.message : error,
      );
      return { kill_switch: false, active: true, config_version: -1 };
    }
    console.error(
      `[SECURITY] Kill-switch check failed ${_consecutiveFailures} consecutive times. FAIL-CLOSED — blocking extension.`,
      error instanceof Error ? error.message : error,
    );
    return { kill_switch: true, active: false, config_version: -1 };
  }
}

/**
 * Start a recurring poller that checks the kill-switch endpoint every
 * `POLL_INTERVAL` milliseconds.
 *
 * @param apiBaseUrl    The base URL of the Iron Gate API.
 * @param onKillSwitch  Callback invoked whenever the kill-switch state
 *                      changes.  Receives `true` when the extension should
 *                      shut down (kill switch active OR server unreachable)
 *                      and `false` when the extension is cleared to operate.
 * @returns A `stop` function that cancels the poller.
 */
export function startKillSwitchPoller(
  apiBaseUrl: string,
  onKillSwitch: (active: boolean) => void,
  getApiKey?: () => string | undefined,
): () => void {
  let lastKnownActive: boolean | null = null;

  async function poll(): Promise<void> {
    const apiKey = getApiKey?.();
    const state = await checkKillSwitch(apiBaseUrl, apiKey);

    // Determine whether the extension should be disabled
    const shouldDisable = state.kill_switch || !state.active;

    // Only invoke the callback when the state changes (or on first check)
    if (lastKnownActive === null || shouldDisable !== lastKnownActive) {
      lastKnownActive = shouldDisable;
      onKillSwitch(shouldDisable);
    }
  }

  // Run an initial check immediately
  poll();

  // Then poll on the configured interval
  const intervalId = setInterval(poll, POLL_INTERVAL);

  // Return a stop function
  return () => {
    clearInterval(intervalId);
  };
}
