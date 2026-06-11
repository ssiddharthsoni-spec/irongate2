/**
 * Turn Coordinator — Gate that controls what reaches the sidepanel.
 *
 * Pure relocation from main-world.ts (June 2026) so unit tests can exercise
 * the SHIPPED minting/dedup logic instead of mirror copies. The _emit body
 * stays in main-world (it calls notifyContentScript + igPostMessage, which
 * are main-world module state) and is injected via the factory context.
 *
 * ARCHITECTURE (production-grade, replaces buffer/window/sequence approach):
 *
 *   The sidepanel shows the LAST SIGNIFICANT SCAN result. Non-significant
 *   results (0-entity, low-score AUDITs from metadata/preflight/polling
 *   fetches) are DROPPED HERE and never reach the sidepanel at all.
 *
 *   "All Clear" is handled by PROMPT_CLEARED (fires when user's input field
 *   is cleared after submission, already debounced) and tab navigation.
 *
 *   This eliminates the entire class of "0-entity overwrites real detection"
 *   bugs because the noise never enters the pipeline. No buffer windows,
 *   no sequence numbers, no suppression rules in the sidepanel.
 *
 * What passes through:
 *   - INTERCEPTED (any score) — pseudonymized prompt, always significant
 *   - AUDIT with entities > 0 — found something, always significant
 *   - AUDIT with score > 25 — contextual/semantic detection, no entities but meaningful
 *
 * What gets dropped:
 *   - 0-entity AUDIT with score ≤ 25 — metadata fetch, preflight, polling noise
 *
 * IMPORTANT: This module runs in MAIN world (page context). No chrome.* APIs.
 */

export type QueuedResult = {
  type: 'IRON_GATE_INTERCEPTED' | 'IRON_GATE_AUDIT';
  promptText: string;
  allEntities: Array<{ type: string; text: string; start: number; end: number; confidence: number; source: string }>;
  maskedText: string;
  mappings: Array<{ pseudonym: string; type: string; length: number }>;
  level: string;
  score: number;
  extra?: Record<string, unknown>;
  /** WP2: URL matched adapter.primaryEndpointPatterns — a real user
   *  submit even without a recorded gesture (voice, paste-send). */
  isPrimaryEndpoint?: boolean;
};

export interface TurnCoordinatorContext {
  /** main-world's _emit body (notifyContentScript + IRON_GATE_RECORD_AUDIT) */
  emit: (r: QueuedResult, turn: { epoch: number; seq: number }) => void;
  /** main-world's igLog (debug-gated) */
  log: (...args: any[]) => void;
  /** Clock — defaults to Date.now; injectable for tests */
  now?: () => number;
}

export function createTurnCoordinator(ctx: TurnCoordinatorContext): {
  noteUserAction(): void;
  submit(r: QueuedResult): void;
} {
  const { emit: _emit, log: igLog } = ctx;
  const _now = ctx.now ?? Date.now;

  // ── Turn identity (WP1) ───────────────────────────────────────────────────
  // The coordinator is the ONE place that knows a user turn began, so it
  // mints TurnId here and stamps every emission. Downstream (worker
  // updateTabState via shouldReplaceDisplay) arbitrates display purely on
  // (turn, phase) — the old 10s suppression window is gone.
  //
  //   epoch  per-pageload (Date.now at init) — reload beats everything older
  //   seq    monotonic per pageload; mint = seq++ on a genuine user turn
  //
  // Minting rules:
  //   INTERCEPTED                 → always a turn (pseudonymization happened)
  //   0-entity low-score AUDIT    → a turn ONLY when correlated with a real
  //     user action (Enter/click within USER_ACTION_WINDOW_MS — recorded by
  //     the DOM handlers) or when it's the first prompt of the pageload.
  //     Otherwise it's a secondary platform fetch (title generation,
  //     metadata) and is dropped: the wire alone cannot distinguish the two,
  //     which is exactly why the old emission-history window misfired —
  //     a clean prompt within 10s of a previous turn was swallowed and the
  //     panel went stale. Keyboard/click submits (the overwhelming case)
  //     are now exact; WP2's adapter URL classification closes the rest.
  //   AUDIT with entities/score   → stamped with the CURRENT turn (echo of it)
  const _TURN_EPOCH = _now();
  let _turnSeq = 0;
  let _lastUserActionAt = 0;
  const USER_ACTION_WINDOW_MS = 3000;

  function _currentTurn(): { epoch: number; seq: number } {
    return { epoch: _TURN_EPOCH, seq: _turnSeq };
  }
  function _mintTurn(): { epoch: number; seq: number } {
    _turnSeq++;
    return _currentTurn();
  }

  // Dedup: prevent the same prompt from emitting twice within a short window.
  // ChatGPT (and some adapters) can trigger two fetch interceptions for one
  // user submit, producing near-identical results (e.g., 373ch vs 372ch).
  // This is PRODUCER noise control (one user action → two wire calls must
  // not mint two turns); display arbitration no longer depends on it.
  let _lastEmitHash = '';
  let _lastEmitAt = 0;
  const DEDUP_WINDOW_MS = 3000;

  function _promptHash(text: string): string {
    // Fast 53-bit hash of the first 300 chars — enough to identify the same prompt
    let h = 0;
    const s = text.substring(0, 300);
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return String(h);
  }

  return {
    /** DOM Enter/click handlers call this on every user submit gesture. */
    noteUserAction(): void {
      _lastUserActionAt = _now();
    },

    submit(r: QueuedResult): void {
      // INTERCEPTED: always significant — pseudonymization occurred.
      // The hash dedup keeps one user action that triggers two near-identical
      // wire calls from minting two turns.
      if (r.type === 'IRON_GATE_INTERCEPTED') {
        const hash = _promptHash(r.promptText);
        const now = _now();
        if (hash === _lastEmitHash && now - _lastEmitAt < DEDUP_WINDOW_MS) {
          igLog(`Turn coordinator: DEDUP skip (same prompt within ${DEDUP_WINDOW_MS}ms)`);
          return;
        }
        _lastEmitHash = hash;
        _lastEmitAt = now;
        _emit(r, _mintTurn());
        return;
      }

      // AUDIT with entities: found something — significant echo of the
      // current turn (it must never displace the turn's INTERCEPTED, which
      // shouldReplaceDisplay guarantees via phase rank).
      if (r.allEntities.length > 0) {
        _emit(r, _currentTurn());
        return;
      }

      // AUDIT with meaningful score (contextual/semantic detection)
      if (r.score > 25) {
        _emit(r, _currentTurn());
        return;
      }

      // ── 0-entity, low-score AUDIT: clean user prompt OR platform noise ──
      // The wire alone cannot tell a clean user submit from a secondary
      // platform fetch (title generation, metadata) — both arrive here.
      // Discriminator: a real submit is correlated with a user gesture the
      // DOM handlers just recorded. First prompt of the pageload also mints
      // (covers entry paths with no keystroke, e.g. voice on a fresh page).
      if (r.promptText && r.promptText.length > 20) {
        const now = _now();
        const userActed = now - _lastUserActionAt < USER_ACTION_WINDOW_MS;
        if (userActed || _turnSeq === 0 || r.isPrimaryEndpoint === true) {
          _lastEmitHash = _promptHash(r.promptText);
          _lastEmitAt = now;
          _emit(r, _mintTurn());
          igLog(`Turn coordinator: EMIT clean prompt (${r.promptText.length}ch, score=${r.score}, userActed=${userActed}, primary=${r.isPrimaryEndpoint === true})`);
          return;
        }
        igLog('Turn coordinator: DROP 0-entity AUDIT (no user gesture — secondary platform fetch)');
        return;
      }
      igLog(`Turn coordinator: DROP 0-entity AUDIT (short/empty, score=${r.score})`);
    },
  };
}
