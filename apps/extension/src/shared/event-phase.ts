/**
 * Event lifecycle phase — single source of truth for precedence rules.
 *
 * Every detection-related event flowing through the extension carries a
 * `phase` tag. The phase determines whether a new event may replace
 * existing displayed/stored state for the same turn.
 *
 *   preview        Live-typing detection from the worker. Cheap preview
 *                  while the user is composing. May be replaced by anything
 *                  that comes later.
 *   authoritative  The wire interceptor's pseudonymization result —
 *                  the definitive record of what happened to this turn's
 *                  prompt. Replaces preview. Only another authoritative
 *                  (re-broadcast / refinement) or `null` (turn reset)
 *                  may replace it.
 *   enrichment     Async additions (e.g. Stage-2 Gemma verdict arriving
 *                  after the wire result). May AUGMENT an authoritative
 *                  result but never REPLACES it.
 *   audit          Telemetry events emitted on secondary fetches
 *                  (preflight, follow-up requests). Logged for compliance,
 *                  never displayed as the turn's outcome, never replaces
 *                  authoritative state.
 *
 * Centralizing this here means the rule is enforced identically wherever
 * displayable state is updated (sidepanel React state, worker per-tab
 * state, storage backup). Any consumer that calls `phaseAllowsReplace`
 * before writing satisfies the invariant.
 */

export type EventPhase = 'preview' | 'authoritative' | 'enrichment' | 'audit';

/** Numeric rank — higher means "more authoritative". */
const PHASE_RANK: Record<EventPhase, number> = {
  audit: 0,
  enrichment: 1,
  preview: 2,
  authoritative: 3,
};

/**
 * Best-effort recovery of phase from legacy payload shapes that don't yet
 * carry an explicit `phase` field. Used during the rollout where some
 * producers stamp phase and others don't yet.
 *
 *   isProxy=true OR wireIntercept=true  → 'authoritative'
 *   realtime=true                        → 'preview'
 *   else                                 → 'audit' (conservative — phantom
 *                                          audits and 0-entity broadcasts
 *                                          land here so they can't displace
 *                                          authoritative state)
 */
export function inferPhase(payload: any): EventPhase {
  if (!payload) return 'audit';
  if (payload.phase === 'preview' || payload.phase === 'authoritative'
   || payload.phase === 'enrichment' || payload.phase === 'audit') {
    return payload.phase;
  }
  if (payload.isProxy === true || payload.wireIntercept === true) return 'authoritative';
  if (payload.realtime === true) return 'preview';
  return 'audit';
}

/**
 * Decide whether `incoming` may replace `current` as the displayed/stored
 * state.
 *
 * Rules:
 *   • A null current is always replaceable (no turn in progress).
 *   • An incoming `audit` or `enrichment` event NEVER replaces an
 *     `authoritative` current — they're additive/telemetry, not new truth.
 *   • A higher-ranked phase always wins (preview → authoritative is fine).
 *   • Two authoritative events from DIFFERENT turns: incoming wins (the
 *     user's new submit always replaces the previous turn's display).
 *   • Two authoritative events from the SAME turn: same-rank tiebreaker
 *     (keep the result with more entity data — handles re-broadcasts /
 *     refinements within a turn).
 *
 * `turnKey` is a content-derived turn identifier — typically the
 * maskedPrompt, or a hash of it. When current.turnKey differs from
 * incoming.turnKey, we treat them as separate turns and allow replacement.
 * When they match (or both are absent), it's the same turn and the
 * same-rank tiebreaker applies.
 *
 * `currentHasEntities` lets us treat "authoritative with 0 entities" as
 * weaker than "authoritative with entities" for the rare case where Gemma
 * judged 0 entities but the user actually had a sensitive prompt.
 */
export interface PhaseSnapshot {
  phase: EventPhase;
  hasEntities: boolean;
  /**
   * Content-derived turn identifier. When two authoritative snapshots have
   * DIFFERENT turnKey values, the incoming one is treated as a new turn
   * and is allowed to replace the current one regardless of entity counts.
   * Empty string = unknown (treated as same-turn for back-compat with
   * legacy paths that don't carry maskedPrompt).
   */
  turnKey?: string;
}

// ─── Turn Identity (WP1, June 2026) ─────────────────────────────────────────
//
// The recurring stale-sidepanel class (commits c3c119a, c02ebbe, e254c68,
// 8b9696f and ~10 user reports) had one root cause: no detection event
// carried a real turn identifier, so every consumer reconstructed "same turn
// or new turn?" from timestamps and content — and each guess got its own
// patch window (3s/10s producer dedup, 2s fingerprint, 5s protect window,
// 8s re-restore). TurnId replaces all of them.
//
//   epoch  Minted once per main-world page load (Date.now() at init).
//          Makes seq comparable across page reloads: a reload resets seq
//          to 0 but gets a strictly larger epoch.
//   seq    Per-tab monotonic counter, incremented by main-world at the
//          moment a user submit is intercepted — the ONE place that knows
//          a turn began. INTERCEPTED and CLEAN_SUBMIT mint; AUDIT and
//          enrichment events are stamped with the current value.
//
// Events without a turn (worker typing previews, legacy payloads) compare
// as EQUAL to anything — they fall through to phase-rank rules, so a
// turnless preview can never displace an authoritative result.

export interface TurnId {
  epoch: number;
  seq: number;
}

/** -1: a older than b · 0: same turn / not comparable · 1: a newer than b */
export function compareTurn(
  a: TurnId | null | undefined,
  b: TurnId | null | undefined,
): number {
  if (!a || !b) return 0;
  if (typeof a.epoch !== 'number' || typeof b.epoch !== 'number'
   || typeof a.seq !== 'number' || typeof b.seq !== 'number') return 0;
  if (a.epoch !== b.epoch) return a.epoch < b.epoch ? -1 : 1;
  if (a.seq !== b.seq) return a.seq < b.seq ? -1 : 1;
  return 0;
}

export interface DisplaySnapshot extends PhaseSnapshot {
  turn?: TurnId | null;
}

/**
 * THE single acceptance rule for displayable detection state, applied by
 * the worker before every per-tab state write (and therefore implicitly by
 * the sidepanel, which renders that state verbatim):
 *
 *   1. A newer turn always wins — the user's new submit replaces the
 *      previous turn's display, including "All Clear" after a protected
 *      turn (the c3c119a bug class: the old phase gate refused this).
 *   2. A stale turn never wins — a delayed broadcast, poll echo, or
 *      GET_TAB_STATE restore from an earlier turn cannot resurrect.
 *   3. Same turn (or turnless): existing phase precedence applies.
 */
export function shouldReplaceDisplay(
  current: DisplaySnapshot | null,
  incoming: DisplaySnapshot,
): boolean {
  if (!current) return true;
  const cmp = compareTurn(incoming.turn, current.turn);
  if (cmp > 0) return true;
  if (cmp < 0) return false;
  return phaseAllowsReplace(current, incoming);
}

export function phaseAllowsReplace(
  current: PhaseSnapshot | null,
  incoming: PhaseSnapshot,
): boolean {
  if (!current) return true;

  // Audit and enrichment can never displace authoritative — within a turn
  // they're additive metadata, and across turns the authoritative is always
  // the most informative thing about the previous turn until the new
  // turn's authoritative arrives.
  if (current.phase === 'authoritative'
      && (incoming.phase === 'audit' || incoming.phase === 'enrichment')) {
    return false;
  }

  // Higher-ranked incoming wins.
  if (PHASE_RANK[incoming.phase] > PHASE_RANK[current.phase]) return true;
  // Lower-ranked incoming loses.
  if (PHASE_RANK[incoming.phase] < PHASE_RANK[current.phase]) return false;

  // Same rank — distinguish same-turn refinement from new-turn arrival.
  // Different non-empty turnKey → new turn → accept incoming. Otherwise,
  // same-turn tiebreaker: prefer the result with more entity data.
  const curKey = current.turnKey || '';
  const inKey = incoming.turnKey || '';
  if (curKey && inKey && curKey !== inKey) return true;

  if (incoming.hasEntities && !current.hasEntities) return true;
  return false;
}
