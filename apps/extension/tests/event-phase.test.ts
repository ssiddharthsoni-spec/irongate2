/**
 * Turn identity + display acceptance (WP1, June 2026).
 *
 * One pure rule replaces the four stacked timing heuristics (3s/10s producer
 * windows, 2s fingerprint dedup, 5s protect window, 8s re-restore) that
 * patched the missing-turn-identity root cause. Each historical sidepanel
 * bug from the May 2026 transcripts is pinned here as a named scenario.
 */
import { describe, it, expect } from 'vitest';
import {
  compareTurn,
  shouldReplaceDisplay,
  phaseAllowsReplace,
  inferPhase,
  type TurnId,
  type DisplaySnapshot,
} from '../src/shared/event-phase';

const t = (epoch: number, seq: number): TurnId => ({ epoch, seq });
const snap = (
  phase: DisplaySnapshot['phase'],
  turn: TurnId | null,
  hasEntities = true,
): DisplaySnapshot => ({ phase, turn, hasEntities });

describe('compareTurn', () => {
  it('orders by seq within an epoch', () => {
    expect(compareTurn(t(1, 2), t(1, 1))).toBe(1);
    expect(compareTurn(t(1, 1), t(1, 2))).toBe(-1);
    expect(compareTurn(t(1, 2), t(1, 2))).toBe(0);
  });

  it('a page reload (new epoch, seq reset) is always newer', () => {
    expect(compareTurn(t(2000, 0), t(1000, 999))).toBe(1);
  });

  it('turnless events compare as equal (fall through to phase rules)', () => {
    expect(compareTurn(null, t(1, 5))).toBe(0);
    expect(compareTurn(t(1, 5), null)).toBe(0);
    expect(compareTurn(null, null)).toBe(0);
  });

  it('malformed turn objects compare as equal, never throw', () => {
    expect(compareTurn({ epoch: NaN as any, seq: 'x' as any }, t(1, 1))).toBe(0);
    expect(compareTurn({} as any, t(1, 1))).toBe(0);
  });
});

describe('shouldReplaceDisplay — historical bug scenarios', () => {
  it('BUG c3c119a-class: "All Clear" after a protected turn must display', () => {
    // May reports: a clean prompt after a sensitive one left the panel stuck
    // on the previous turn — the phase gate refused 0-entity replacements.
    const protectedTurn = snap('authoritative', t(1, 5), true);
    const allClearNextTurn = snap('authoritative', t(1, 6), false);
    expect(shouldReplaceDisplay(protectedTurn, allClearNextTurn)).toBe(true);
  });

  it('BUG May-9: second question in same chat shows previous swaps — new turn replaces even with identical content', () => {
    // turnKey was content-derived, so two prompts with equal/empty
    // maskedPrompt collided. Real turn ids cannot collide.
    const turn1 = { ...snap('authoritative', t(1, 1), true), turnKey: 'same' };
    const turn2 = { ...snap('authoritative', t(1, 2), true), turnKey: 'same' };
    expect(shouldReplaceDisplay(turn1, turn2)).toBe(true);
  });

  it('BUG c02ebbe-class: 0-entity AUDIT echo of the same turn never displaces the authoritative result', () => {
    // Secondary platform fetches (title generation etc.) fired audits that
    // overwrote the real result — previously patched with a 10s timer.
    const authoritative = snap('authoritative', t(1, 3), true);
    const auditEcho = snap('audit', t(1, 3), false);
    expect(shouldReplaceDisplay(authoritative, auditEcho)).toBe(false);
  });

  it('BUG resurrection-class: stale restore from an earlier turn never wins', () => {
    // The 8s periodic GET_TAB_STATE re-restore resurrected old results.
    const current = snap('authoritative', t(1, 7), false);
    const staleRestore = snap('authoritative', t(1, 4), true);
    expect(shouldReplaceDisplay(current, staleRestore)).toBe(false);
  });

  it('BUG May-3/6 flicker-class: turnless typing preview cannot displace an authoritative result', () => {
    const authoritative = snap('authoritative', t(1, 2), true);
    const preview = snap('preview', null, false);
    expect(shouldReplaceDisplay(authoritative, preview)).toBe(false);
  });

  it('page refresh mid-conversation: new epoch beats everything from the old one', () => {
    const beforeReload = snap('authoritative', t(1000, 42), true);
    const afterReload = snap('authoritative', t(2000, 1), false);
    expect(shouldReplaceDisplay(beforeReload, afterReload)).toBe(true);
  });

  it('enrichment of the same turn does not replace (it augments via merge)', () => {
    const authoritative = snap('authoritative', t(1, 2), true);
    const gemma = snap('enrichment', t(1, 2), true);
    expect(shouldReplaceDisplay(authoritative, gemma)).toBe(false);
  });

  it('enrichment from a NEWER turn replaces a stale authoritative', () => {
    // Newer turn wins regardless of phase — a Gemma verdict for turn 6
    // arriving after turn 5's display means turn 6 exists.
    const oldTurn = snap('authoritative', t(1, 5), true);
    const newerEnrichment = snap('enrichment', t(1, 6), true);
    expect(shouldReplaceDisplay(oldTurn, newerEnrichment)).toBe(true);
  });

  it('empty current state accepts anything', () => {
    expect(shouldReplaceDisplay(null, snap('audit', null, false))).toBe(true);
  });

  it('same turn, same rank: more entity data wins (refinement)', () => {
    const thin = snap('authoritative', t(1, 2), false);
    const rich = snap('authoritative', t(1, 2), true);
    expect(shouldReplaceDisplay(thin, rich)).toBe(true);
    expect(shouldReplaceDisplay(rich, thin)).toBe(false);
  });
});

describe('legacy phase compatibility (unchanged semantics)', () => {
  it('inferPhase recovers phase from legacy payload shapes', () => {
    expect(inferPhase({ isProxy: true })).toBe('authoritative');
    expect(inferPhase({ wireIntercept: true })).toBe('authoritative');
    expect(inferPhase({ realtime: true })).toBe('preview');
    expect(inferPhase({})).toBe('audit');
    expect(inferPhase(null)).toBe('audit');
  });

  it('phaseAllowsReplace still guards turnless flows', () => {
    expect(phaseAllowsReplace(
      { phase: 'authoritative', hasEntities: true },
      { phase: 'audit', hasEntities: false },
    )).toBe(false);
    expect(phaseAllowsReplace(
      { phase: 'preview', hasEntities: false },
      { phase: 'authoritative', hasEntities: true },
    )).toBe(true);
  });
});
