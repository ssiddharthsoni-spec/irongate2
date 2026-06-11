/**
 * WP4: real-import tests for the SHIPPED turn coordinator — the module
 * main-world.ts actually wires (extracted in WP3 precisely so these tests
 * could exist; the old mirror tests passed even when production regressed).
 *
 * Time is injected (ctx.now), so every window/dedup behavior is tested
 * deterministically — no sleeps, no flake.
 */
import { describe, it, expect } from 'vitest';
import {
  createTurnCoordinator,
  type QueuedResult,
} from '../src/content/main-world/turn-coordinator';

type Emitted = { r: QueuedResult; turn: { epoch: number; seq: number } };

function harness(startTime = 1_000_000) {
  let t = startTime;
  const emitted: Emitted[] = [];
  const tc = createTurnCoordinator({
    emit: (r, turn) => emitted.push({ r, turn }),
    log: () => {},
    now: () => t,
  });
  return {
    tc,
    emitted,
    tick: (ms: number) => { t += ms; },
  };
}

const intercepted = (text: string, over: Partial<QueuedResult> = {}): QueuedResult => ({
  type: 'IRON_GATE_INTERCEPTED',
  promptText: text,
  allEntities: [{ type: 'PERSON', text: 'x', start: 0, end: 1, confidence: 0.9, source: 'regex' }],
  maskedText: 'masked',
  mappings: [{ pseudonym: 'p', type: 'PERSON', length: 1 }],
  level: 'high',
  score: 75,
  ...over,
});

const cleanAudit = (text: string, over: Partial<QueuedResult> = {}): QueuedResult => ({
  type: 'IRON_GATE_AUDIT',
  promptText: text,
  allEntities: [],
  maskedText: '',
  mappings: [],
  level: 'low',
  score: 10,
  ...over,
});

describe('turn coordinator (shipped module)', () => {
  it('INTERCEPTED mints monotonically increasing turn seqs', () => {
    const h = harness();
    h.tc.submit(intercepted('first prompt with sensitive data'));
    h.tick(5000);
    h.tc.submit(intercepted('second prompt, different text here'));
    expect(h.emitted).toHaveLength(2);
    expect(h.emitted[1].turn.seq).toBe(h.emitted[0].turn.seq + 1);
    expect(h.emitted[0].turn.epoch).toBe(h.emitted[1].turn.epoch);
  });

  it('duplicate INTERCEPTED within 3s (same prompt) does not mint a second turn', () => {
    const h = harness();
    h.tc.submit(intercepted('one user action, two wire calls'));
    h.tick(500);
    h.tc.submit(intercepted('one user action, two wire calls'));
    expect(h.emitted).toHaveLength(1);
    h.tick(3001);
    h.tc.submit(intercepted('one user action, two wire calls'));
    expect(h.emitted).toHaveLength(2);
  });

  it('AUDIT with entities is stamped with the CURRENT turn, never mints', () => {
    const h = harness();
    h.tc.submit(intercepted('the real user submit goes through'));
    const turnSeq = h.emitted[0].turn.seq;
    h.tick(2000);
    h.tc.submit(cleanAudit('secondary fetch echo with entities', {
      allEntities: [{ type: 'PERSON', text: 'y', start: 0, end: 1, confidence: 0.9, source: 'regex' }],
    }));
    expect(h.emitted).toHaveLength(2);
    expect(h.emitted[1].turn.seq).toBe(turnSeq);
  });

  it('BUG May-2026: clean prompt right after a turn is NOT swallowed when a gesture occurred', () => {
    // The old 10s emission-history window dropped this — the reported
    // stale-panel bug. Gesture correlation fixes it.
    const h = harness();
    h.tc.submit(intercepted('sensitive prompt forming turn one'));
    h.tick(2000); // well within the old 10s window
    h.tc.noteUserAction();
    h.tick(100);
    h.tc.submit(cleanAudit('a clean follow-up prompt, no entities at all'));
    expect(h.emitted).toHaveLength(2);
    expect(h.emitted[1].turn.seq).toBe(h.emitted[0].turn.seq + 1); // minted
  });

  it('0-entity audit with NO gesture and no primary-endpoint match is dropped (secondary fetch)', () => {
    const h = harness();
    h.tc.submit(intercepted('user submit that mints turn one here'));
    h.tick(2000);
    h.tc.submit(cleanAudit('title generation payload echo from platform'));
    expect(h.emitted).toHaveLength(1);
  });

  it('primary-endpoint match mints a clean turn without any gesture (voice submit)', () => {
    const h = harness();
    h.tc.submit(intercepted('keyboard turn one with entities present'));
    h.tick(2000);
    h.tc.submit(cleanAudit('voice-dictated clean prompt with no keystroke', { isPrimaryEndpoint: true }));
    expect(h.emitted).toHaveLength(2);
    expect(h.emitted[1].turn.seq).toBe(h.emitted[0].turn.seq + 1);
  });

  it('first prompt of the pageload mints even without gesture or primary match', () => {
    const h = harness();
    h.tc.submit(cleanAudit('very first prompt on a fresh page load'));
    expect(h.emitted).toHaveLength(1);
  });

  it('gesture window expires: clean audit 3.1s after the gesture is dropped', () => {
    const h = harness();
    h.tc.submit(intercepted('turn one establishing a prior emission'));
    h.tc.noteUserAction();
    h.tick(3100);
    h.tc.submit(cleanAudit('late clean audit beyond the gesture window'));
    expect(h.emitted).toHaveLength(1);
  });

  it('short/empty 0-entity audits are always dropped', () => {
    const h = harness();
    h.tc.submit(cleanAudit('short'));
    expect(h.emitted).toHaveLength(0);
  });

  it('AUDIT with score > 25 passes as a current-turn echo', () => {
    const h = harness();
    h.tc.submit(intercepted('turn one with the usual entities'));
    h.tc.submit(cleanAudit('contextual-only detection, meaningful score', { score: 40 }));
    expect(h.emitted).toHaveLength(2);
    expect(h.emitted[1].turn.seq).toBe(h.emitted[0].turn.seq);
  });
});
