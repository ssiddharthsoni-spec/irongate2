/**
 * Collision-free fake selection (June 2026).
 *
 * ROOT CAUSE of the recurring "wrong name" corruption (e.g. the user's real
 * "Lisa Park" rendered as "Maria Park"): a fake generated for one entity was
 * allowed to REUSE a name the user actually typed for a DIFFERENT entity. The
 * fake for "Maria Mendez" came out as "Lisa Brown" — and "Lisa" is a real
 * first name in the same prompt ("Lisa Park"). The reverse map then contained
 * an ambiguous fragment ("Lisa" → "Maria") that rewrote the real "Lisa Park".
 *
 * This bug is ARCHITECTURE-INDEPENDENT: an ambiguous fake↔real mapping
 * corrupts the DOM de-pseudo path AND the wire de-pseudo path equally. The
 * only durable fix is to make the mapping a collision-free bijection at
 * generation time: a fake — and every one of its name-parts — must never
 * coincide with any real value or name-part anywhere in the prompt.
 *
 * Pure and importable so the SHIPPED logic is unit-tested directly (not a
 * mirror copy — mirror tests are why these regressions kept slipping through).
 */

const MIN_PART_LEN = 3;

/** Lowercased value + its whitespace-split parts (≥3 chars). */
function partsOf(value: string): string[] {
  const out: string[] = [];
  const v = value.trim().toLowerCase();
  if (v.length >= MIN_PART_LEN) out.push(v);
  for (const p of v.split(/\s+/)) {
    if (p.length >= MIN_PART_LEN) out.push(p);
  }
  return out;
}

/**
 * The set a fake must avoid: every real value AND every real name-part the
 * user typed anywhere in this prompt. Build once per pseudonymization call
 * from ALL detected entities (not just already-processed ones — order must
 * not matter, or the collision slips through when the colliding real name is
 * processed later).
 */
export function buildReservedParts(originals: Iterable<string>): Set<string> {
  const reserved = new Set<string>();
  for (const o of originals) {
    for (const p of partsOf(o)) reserved.add(p);
  }
  return reserved;
}

export interface CollisionContext {
  /** Fakes already assigned in this prompt (reverse-map values). */
  usedFakes: Set<string>;
  /** Originals already mapped in this prompt (reverse-map keys). */
  usedOriginals: Set<string>;
  /** Real values + parts the user typed anywhere in this prompt. */
  reservedParts: Set<string>;
  /** The original this candidate is a fake FOR (never equal it). */
  self: string;
}

/**
 * True if `candidate` cannot be used as a fake. Rejection reasons:
 *   1. equals/collides with another assigned fake (ambiguous reverse map)
 *   2. equals/collides with another mapped original
 *   3. equals the original it replaces (no-op / leak)
 *   4. short-token substring overlap ("$4M" inside "$4.2B")
 *   5. NEW — the fake, or any of its name-parts, reuses a real value/part the
 *      user typed (the "Lisa Park" → "Maria Park" class)
 */
export function fakeCollides(candidate: string, ctx: CollisionContext): boolean {
  const { usedFakes, usedOriginals, reservedParts, self } = ctx;
  if (usedFakes.has(candidate) || usedOriginals.has(candidate) || candidate === self) {
    return true;
  }
  // Short tokens: substring overlap in either direction (existing guard).
  if (candidate.length < 8) {
    for (const f of usedFakes) {
      if (f.includes(candidate) || candidate.includes(f)) return true;
    }
    for (const o of usedOriginals) {
      if (o.includes(candidate) || candidate.includes(o)) return true;
    }
  }
  // Name-part collision against real values/parts — the root-cause guard.
  for (const p of partsOf(candidate)) {
    if (reservedParts.has(p)) return true;
  }
  return false;
}
