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

/** Maximum time (ms) to wait for the kill-switch endpoint before treating as unreachable. */
const REQUEST_TIMEOUT = 10_000;

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
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
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
): Promise<KillSwitchState> {
  const url = `${apiBaseUrl.replace(/\/+$/, '')}/kill-switch`;

  try {
    const response = await fetchWithTimeout(url, REQUEST_TIMEOUT);

    if (!response.ok) {
      console.error(
        `[SECURITY] Kill-switch endpoint returned HTTP ${response.status}. Failing closed.`,
      );
      return { kill_switch: true, active: false, config_version: -1 };
    }

    const data: KillSwitchState = await response.json();
    return data;
  } catch (error) {
    // Network error, timeout, or JSON parse failure — fail closed
    console.error(
      '[SECURITY] Kill-switch check failed (server unreachable or error). Failing closed.',
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
): () => void {
  let lastKnownActive: boolean | null = null;

  async function poll(): Promise<void> {
    const state = await checkKillSwitch(apiBaseUrl);

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
