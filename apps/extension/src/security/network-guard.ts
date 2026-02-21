/**
 * Iron Gate — Network Guard
 *
 * Ensures the extension only communicates with approved hosts.  Every
 * outbound fetch request is validated against an allowlist before it
 * leaves the browser.  Any attempt to contact an unapproved host is
 * blocked and logged as a security anomaly.
 *
 * Usage:
 *   import { createGuardedFetch } from '../security/network-guard';
 *   const guardedFetch = createGuardedFetch(globalThis.fetch);
 *   // Use `guardedFetch` everywhere instead of raw `fetch`.
 */

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Hosts that the extension is permitted to communicate with.
 * Any request to a host NOT in this list will be rejected.
 */
export const ALLOWED_HOSTS: readonly string[] = [
  'api.irongate.ai',
  'localhost',
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type SecurityAnomalyType =
  | 'blocked_outbound_request'
  | 'invalid_url'
  | 'unexpected_redirect'
  | 'cert_pin_failure'
  | 'kill_switch_activated'
  | 'storage_policy_violation';

export interface SecurityAnomalyDetails {
  url?: string;
  host?: string;
  reason?: string;
  timestamp: number;
  [key: string]: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the hostname from a URL string.  Returns `null` for malformed URLs.
 */
function extractHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Check whether an outbound request URL targets an allowed host.
 *
 * @param url  Fully-qualified URL (e.g. `https://api.irongate.ai/v1/events`).
 * @returns `true` if the host is in ALLOWED_HOSTS, `false` otherwise.
 */
export function validateOutboundRequest(url: string): boolean {
  const host = extractHost(url);
  if (!host) {
    return false;
  }
  return ALLOWED_HOSTS.includes(host);
}

/**
 * Report a security anomaly.  All anomaly messages are prefixed with
 * `[SECURITY]` so they can be easily filtered in devtools / log aggregation.
 *
 * @param type     A machine-readable anomaly category.
 * @param details  Arbitrary context about the anomaly.
 */
export function reportSecurityAnomaly(
  type: SecurityAnomalyType,
  details: Omit<SecurityAnomalyDetails, 'timestamp'>,
): void {
  const entry: SecurityAnomalyDetails = {
    ...details,
    timestamp: Date.now(),
  };

  console.error(
    `[SECURITY] Anomaly detected — type=${type}`,
    JSON.stringify(entry),
  );
}

/**
 * Create a guarded wrapper around the native `fetch` function.
 *
 * The wrapper validates every outbound URL against ALLOWED_HOSTS before
 * the request is sent.  If the host is not allowed the request is rejected
 * with a descriptive error and a security anomaly is logged.
 *
 * @param originalFetch  The platform `fetch` (e.g. `globalThis.fetch`).
 * @returns A drop-in replacement for `fetch` that enforces the network guard.
 */
export function createGuardedFetch(
  originalFetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return async function guardedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Resolve the URL string from the various input shapes
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else {
      // Request object
      url = input.url;
    }

    if (!validateOutboundRequest(url)) {
      const host = extractHost(url);

      reportSecurityAnomaly('blocked_outbound_request', {
        url,
        host: host ?? 'unknown',
        reason: `Host "${host ?? url}" is not in the allowed hosts list`,
      });

      throw new Error(
        `[Iron Gate] Network guard blocked request to disallowed host: ${host ?? url}`,
      );
    }

    return originalFetch(input, init);
  };
}
