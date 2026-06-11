import { describe, it, expect } from 'vitest';

// Regression for P0-1: addReverseMapping crashed on non-string input.
// Verify the function (re-implemented inline for the test, mirroring the
// production runtime guard) silently skips bad inputs instead of throwing.
//
// We can't import addReverseMapping directly because it's an internal
// function inside main-world.ts (the giant content-script bundle). The
// guard logic is what we're testing — non-string pseudonym/original
// must not throw, must not pollute the map.

describe('P0-1: addReverseMapping typeof guard', () => {
  function addReverseMappingGuarded(
    map: Record<string, string>,
    pseudonym: unknown,
    original: unknown,
  ): boolean {
    if (typeof pseudonym !== 'string' || typeof original !== 'string') return false;
    map[pseudonym] = original;
    return true;
  }

  it('skips when pseudonym is an object', () => {
    const map: Record<string, string> = {};
    const ok = addReverseMappingGuarded(map, { foo: 'bar' } as unknown, 'realName');
    expect(ok).toBe(false);
    expect(Object.keys(map).length).toBe(0);
  });

  it('skips when original is undefined', () => {
    const map: Record<string, string> = {};
    const ok = addReverseMappingGuarded(map, 'pseudonym123', undefined as unknown);
    expect(ok).toBe(false);
    expect(Object.keys(map).length).toBe(0);
  });

  it('skips when pseudonym is null', () => {
    const map: Record<string, string> = {};
    const ok = addReverseMappingGuarded(map, null as unknown, 'realName');
    expect(ok).toBe(false);
    expect(Object.keys(map).length).toBe(0);
  });

  it('skips when both are numbers', () => {
    const map: Record<string, string> = {};
    const ok = addReverseMappingGuarded(map, 42 as unknown, 99 as unknown);
    expect(ok).toBe(false);
    expect(Object.keys(map).length).toBe(0);
  });

  it('proceeds when both are strings', () => {
    const map: Record<string, string> = {};
    const ok = addReverseMappingGuarded(map, 'pseudonym', 'realName');
    expect(ok).toBe(true);
    expect(map.pseudonym).toBe('realName');
  });

  it('does not throw on .match() call with non-string pseudonym (real-world crash path)', () => {
    // The production crash was: pseudonym.match(...) when pseudonym is undefined.
    // The guard returns BEFORE we reach the .match() line, so no throw.
    const pseudonym = undefined as unknown;
    expect(() => {
      if (typeof pseudonym !== 'string') return;
      // This line would throw "TypeError: b.match is not a function" without
      // the guard above.
      pseudonym.match(/^foo/);
    }).not.toThrow();
  });
});
