/**
 * Collision-free fake selection — tests the SHIPPED logic (imported, not
 * mirrored). Anchored on the user-reported corruption: real "Lisa Park"
 * rendered as "Maria Park" because the fake for "Maria Mendez" reused the
 * real first name "Lisa".
 */
import { describe, it, expect } from 'vitest';
import { buildReservedParts, fakeCollides, type CollisionContext } from '../src/detection/fake-collision';

const ctx = (over: Partial<CollisionContext> = {}): CollisionContext => ({
  usedFakes: new Set(),
  usedOriginals: new Set(),
  reservedParts: new Set(),
  self: '',
  ...over,
});

describe('buildReservedParts', () => {
  it('includes full values and name-parts (≥3 chars), lowercased', () => {
    const r = buildReservedParts(['Lisa Park', 'Maria Mendez']);
    expect(r.has('lisa park')).toBe(true);
    expect(r.has('lisa')).toBe(true);
    expect(r.has('park')).toBe(true);
    expect(r.has('maria')).toBe(true);
    expect(r.has('mendez')).toBe(true);
  });

  it('drops sub-3-char parts to avoid over-blocking', () => {
    const r = buildReservedParts(['Al Fox']);
    expect(r.has('al')).toBe(false);
    expect(r.has('fox')).toBe(true);
  });
});

describe('fakeCollides — the "Lisa Park → Maria Park" root cause', () => {
  it('REJECTS a fake whose first name reuses a real first name elsewhere', () => {
    // Generating a fake for "Maria Mendez"; "Lisa Park" is a real name in the
    // same prompt. A fake of "Lisa Brown" must be rejected — its part "Lisa"
    // would create the ambiguous reverse-map fragment that caused corruption.
    const reservedParts = buildReservedParts(['Maria Mendez', 'Lisa Park']);
    expect(fakeCollides('Lisa Brown', ctx({ reservedParts, self: 'Maria Mendez' }))).toBe(true);
  });

  it('REJECTS a fake whose last name reuses a real last name', () => {
    const reservedParts = buildReservedParts(['Maria Mendez', 'Lisa Park']);
    expect(fakeCollides('Daniel Park', ctx({ reservedParts, self: 'Maria Mendez' }))).toBe(true);
  });

  it('ACCEPTS a fake that reuses no real value or part', () => {
    const reservedParts = buildReservedParts(['Maria Mendez', 'Lisa Park']);
    expect(fakeCollides('Daniel Brooks', ctx({ reservedParts, self: 'Maria Mendez' }))).toBe(false);
  });

  it('order-independent: collision caught even if the colliding real name appears later', () => {
    // The reserved set is built from ALL entities up front, so a fake for the
    // FIRST-processed entity is still checked against a LATER real name.
    const reservedParts = buildReservedParts(['Maria Mendez', 'Lisa Park', 'Jane Miller']);
    expect(fakeCollides('Jane Brooks', ctx({ reservedParts, self: 'Maria Mendez' }))).toBe(true);
  });
});

describe('fakeCollides — existing guards preserved', () => {
  it('rejects a fake equal to another assigned fake', () => {
    expect(fakeCollides('Andrew Watson', ctx({ usedFakes: new Set(['Andrew Watson']) }))).toBe(true);
  });

  it('rejects a fake equal to a mapped original', () => {
    expect(fakeCollides('Acme Corp', ctx({ usedOriginals: new Set(['Acme Corp']) }))).toBe(true);
  });

  it('rejects a fake equal to the original it replaces', () => {
    expect(fakeCollides('Lisa Park', ctx({ self: 'Lisa Park' }))).toBe(true);
  });

  it('rejects short-token substring overlap (one fake contained in another)', () => {
    // A short fake that is a substring of an existing fake (or vice versa)
    // would be ambiguous during reverse replacement.
    expect(fakeCollides('Ann', ctx({ usedFakes: new Set(['Annette']) }))).toBe(true);
    expect(fakeCollides('Annette', ctx({ usedFakes: new Set(['Ann']) }))).toBe(true);
  });

  it('accepts a clean unique fake', () => {
    expect(fakeCollides('Thomas Garcia', ctx())).toBe(false);
  });
});
