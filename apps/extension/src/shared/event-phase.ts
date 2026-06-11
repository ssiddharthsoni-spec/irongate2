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
