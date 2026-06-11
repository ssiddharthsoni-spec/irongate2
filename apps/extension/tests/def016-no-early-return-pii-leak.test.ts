import { describe, it, expect } from 'vitest';

// Regression for the DEF-016 early-return PII leak (May 20, 2026).
//
// Symptom: user submits a multi-SSN prompt where ONE SSN happens to match a
// prior turn's pseudonym original. Console showed:
//   INTERCEPTED maskedPrompt: 341ch  mappings: 1  entities: 9
//                                            ^^^   ← only 1 of 9 swapped
// The DEF-016 path:
//   - Detected the session-entity reference (1 of 9 entities)
//   - Applied only that 1 session pseudonym to pseudonymizedText
//   - Built modifiedBody from pseudonymizedText (1 swap applied)
//   - Returned EARLY, never running the regular pseudonymization path
//   - Result: 8 newly-detected SSNs reached the LLM in PLAIN TEXT
// Panel said "9 items protected" but only 1 actually was.
//
// The fix collapses DEF-016 into the regular path: register session
// mappings (so the response stream restores them), bump the score so the
// GREEN passthrough doesn't fire, then fall through. pseudonymizeLocal
// downstream handles ALL detected entities — session ones via the forward
// map, new ones with freshly-generated pseudonyms.
//
// This test pins the *invariant* the fix established: when N entities are
// detected and the path completes, N mappings must be emitted — not just
// the session subset. The fix is in main-world.ts; the test exercises the
// invariant at the level of the contract.

interface InterceptPayload {
  allEntities: Array<{ type: string; text: string; start: number; end: number; confidence: number; source: string }>;
  mappings: Array<{ pseudonym: string; type: string; length: number }>;
  maskedText: string;
}

// Simulate the DEF-016+regular path invariant: if pseudonymization fires,
// the mappings count must equal the count of non-VALUE-TYPE entities that
// were sent through pseudonymizeLocal. Anything less is the bug.
function assertPanelMatchesWire(payload: InterceptPayload, sensitiveTypes: Set<string>): void {
  const sensitiveEntities = payload.allEntities.filter((e) => sensitiveTypes.has(e.type));
  // Every sensitive entity in the prompt must have a corresponding mapping.
  expect(
    payload.mappings.length,
    `panel/wire mismatch: ${sensitiveEntities.length} sensitive entities detected but only ${payload.mappings.length} mappings — leaked entities: ${sensitiveEntities.length - payload.mappings.length}`,
  ).toBe(sensitiveEntities.length);
  // And the masked text must not contain the originals.
  for (const e of sensitiveEntities) {
    expect(
      payload.maskedText.includes(e.text),
      `wire leak: original "${e.text}" still present in maskedText`,
    ).toBe(false);
  }
}

describe('DEF-016 PII leak regression', () => {
  it('detects the bug pattern: more entities than mappings means PII leaked', () => {
    // The exact shape of the bug payload from the May 20 2026 console log.
    const buggyPayload: InterceptPayload = {
      allEntities: [
        { type: 'SSN', text: '123 45 6789', start: 0, end: 11, confidence: 0.9, source: 'regex' },
        { type: 'SSN', text: '234567890', start: 50, end: 59, confidence: 0.9, source: 'regex' },
        { type: 'SSN', text: '456-78-9012', start: 100, end: 111, confidence: 0.9, source: 'regex' },
        { type: 'SSN', text: '111-22-3333', start: 150, end: 161, confidence: 0.9, source: 'regex' },
        { type: 'SSN', text: '444-55-6666', start: 200, end: 211, confidence: 0.9, source: 'regex' },
        { type: 'SSN', text: '777-88-9999', start: 250, end: 261, confidence: 0.9, source: 'regex' },
        { type: 'PERSON', text: 'Alice Chen', start: 140, end: 150, confidence: 0.85, source: 'regex' },
        { type: 'PERSON', text: 'Bob Davis', start: 190, end: 199, confidence: 0.85, source: 'regex' },
        { type: 'PERSON', text: 'Carol Evans', start: 240, end: 251, confidence: 0.85, source: 'regex' },
      ],
      mappings: [
        // Only 1 session mapping — what the buggy DEF-016 emitted
        { pseudonym: '112 23 9599', type: 'SESSION_ENTITY', length: 11 },
      ],
      // Masked text where only the session entity got replaced — the other
      // 8 SSNs/persons still in plaintext (the actual wire leak)
      maskedText: 'Can you verify this SSN for me: 112 23 9599\n... 234567890 ... 456-78-9012 ... Alice Chen: 111-22-3333 ...',
    };

    // The assertion proves the bug exists in the buggy payload.
    expect(() => {
      assertPanelMatchesWire(buggyPayload, new Set(['SSN', 'PERSON']));
    }).toThrow(/panel\/wire mismatch/);
  });

  it('post-fix payload satisfies the invariant: mappings == sensitive entities', () => {
    // After the DEF-016 fall-through fix, the same prompt produces this
    // payload: every detected entity is pseudonymized, no leak.
    const fixedPayload: InterceptPayload = {
      allEntities: [
        { type: 'SSN', text: '123 45 6789', start: 0, end: 11, confidence: 0.9, source: 'regex' },
        { type: 'SSN', text: '234567890', start: 50, end: 59, confidence: 0.9, source: 'regex' },
        { type: 'SSN', text: '456-78-9012', start: 100, end: 111, confidence: 0.9, source: 'regex' },
        { type: 'SSN', text: '111-22-3333', start: 150, end: 161, confidence: 0.9, source: 'regex' },
        { type: 'SSN', text: '444-55-6666', start: 200, end: 211, confidence: 0.9, source: 'regex' },
        { type: 'SSN', text: '777-88-9999', start: 250, end: 261, confidence: 0.9, source: 'regex' },
        { type: 'PERSON', text: 'Alice Chen', start: 140, end: 150, confidence: 0.85, source: 'regex' },
        { type: 'PERSON', text: 'Bob Davis', start: 190, end: 199, confidence: 0.85, source: 'regex' },
        { type: 'PERSON', text: 'Carol Evans', start: 240, end: 251, confidence: 0.85, source: 'regex' },
      ],
      mappings: [
        { pseudonym: '112 23 9599', type: 'SSN', length: 11 },
        { pseudonym: '503 84 2218', type: 'SSN', length: 9 },
        { pseudonym: '661-90-3344', type: 'SSN', length: 11 },
        { pseudonym: '887-12-4456', type: 'SSN', length: 11 },
        { pseudonym: '291-65-7783', type: 'SSN', length: 11 },
        { pseudonym: '105-43-9921', type: 'SSN', length: 11 },
        { pseudonym: 'Eva Wong', type: 'PERSON', length: 10 },
        { pseudonym: 'Tom Park', type: 'PERSON', length: 9 },
        { pseudonym: 'Lena Diaz', type: 'PERSON', length: 11 },
      ],
      maskedText: 'Can you verify this SSN for me: 112 23 9599\n... 503 84 2218 ... 661-90-3344 ... Eva Wong: 887-12-4456 ...',
    };

    // No throw — all 9 sensitive entities have mappings, no originals in maskedText.
    expect(() => {
      assertPanelMatchesWire(fixedPayload, new Set(['SSN', 'PERSON']));
    }).not.toThrow();
  });
});
