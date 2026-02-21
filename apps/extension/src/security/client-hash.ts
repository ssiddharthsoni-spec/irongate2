/**
 * Iron Gate — Client-Side Entity Hashing
 *
 * Hashes detected entity values locally using Web Crypto API (SHA-256)
 * before anything is transmitted to the backend. Entity plaintext NEVER
 * leaves the browser; only the hash, position, and a redacted context
 * window are sent.
 *
 * Each browser session gets a unique salt that is used for all hashes
 * in that session but is NEVER sent to the server, making rainbow-table
 * attacks infeasible even if the hashes are intercepted.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DetectedPosition {
  start: number;
  end: number;
}

export interface HashedEntity {
  /** Character-offset position of the entity within the prompt */
  position: { start: number; end: number };
  /** SHA-256 hash of (sessionSalt + entityValue) — hex-encoded */
  valueHash: string;
  /** ~5 words of surrounding context with the entity replaced by [REDACTED] */
  contextWindow: string;
  /** The per-session salt used (kept client-side only — included for local bookkeeping) */
  sessionSalt: string;
}

// ─── Session Salt ────────────────────────────────────────────────────────────

/**
 * Per-session salt.  Generated once when the module first loads and held in
 * memory for the lifetime of the service-worker wake cycle.  It is NEVER
 * persisted to storage and NEVER transmitted to the server.
 */
let _sessionSalt: string | null = null;

function getSessionSalt(): string {
  if (!_sessionSalt) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    _sessionSalt = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return _sessionSalt;
}

/**
 * Reset the session salt. Useful for testing or when a new logical session
 * begins (e.g. user logs out).
 */
export function resetSessionSalt(): void {
  _sessionSalt = null;
}

// ─── Hashing Helpers ─────────────────────────────────────────────────────────

/**
 * SHA-256 hash a string via Web Crypto, returning a lowercase hex digest.
 */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Context Window ──────────────────────────────────────────────────────────

/**
 * Build a context window of roughly 5 words on each side of the entity,
 * with the entity text itself replaced by `[REDACTED]`.
 *
 * Word boundaries are determined by splitting on whitespace.  If the entity
 * spans multiple words those are all replaced by a single `[REDACTED]` token.
 */
function buildContextWindow(
  fullText: string,
  start: number,
  end: number,
  surroundingWordCount = 5,
): string {
  const before = fullText.slice(0, start);
  const after = fullText.slice(end);

  // Grab up to `surroundingWordCount` words before the entity
  const wordsBefore = before.trim().split(/\s+/).filter(Boolean);
  const contextBefore = wordsBefore.slice(-surroundingWordCount).join(' ');

  // Grab up to `surroundingWordCount` words after the entity
  const wordsAfter = after.trim().split(/\s+/).filter(Boolean);
  const contextAfter = wordsAfter.slice(0, surroundingWordCount).join(' ');

  const parts: string[] = [];
  if (contextBefore) parts.push(contextBefore);
  parts.push('[REDACTED]');
  if (contextAfter) parts.push(contextAfter);

  return parts.join(' ');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Hash all detected entity values locally so that raw PII is never sent to
 * the Iron Gate API.
 *
 * @param promptText         The full prompt/text that was scanned.
 * @param detectedPositions  Array of `{ start, end }` offsets for each entity
 *                           found by the detection layer.
 * @returns An array of `HashedEntity` objects safe for network transmission
 *          (minus the sessionSalt field, which the caller should strip).
 */
export async function hashEntitiesLocally(
  promptText: string,
  detectedPositions: DetectedPosition[],
): Promise<HashedEntity[]> {
  const salt = getSessionSalt();

  const results: HashedEntity[] = await Promise.all(
    detectedPositions.map(async (pos) => {
      const entityValue = promptText.slice(pos.start, pos.end);

      // Hash = SHA-256(salt + entityValue) — salt prefix prevents rainbow tables
      const valueHash = await sha256Hex(salt + entityValue);

      const contextWindow = buildContextWindow(
        promptText,
        pos.start,
        pos.end,
      );

      return {
        position: { start: pos.start, end: pos.end },
        valueHash,
        contextWindow,
        sessionSalt: salt,
      };
    }),
  );

  return results;
}
