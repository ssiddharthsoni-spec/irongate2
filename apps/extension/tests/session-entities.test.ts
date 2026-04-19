/**
 * Session Entity Tracker Tests
 *
 * Extracted module: verifies cap/eviction, reference counting, and clear behavior.
 */

import { describe, it, expect } from 'vitest';
import { createSessionEntityTracker } from '../src/content/main-world/session-entities';

describe('Session Entity Tracker', () => {
  it('adds and counts references', () => {
    const tracker = createSessionEntityTracker(100);
    tracker.add('John Smith');
    tracker.add('Sarah Chen');
    expect(tracker.size).toBe(2);
    expect(tracker.countReferences('John Smith called Sarah Chen')).toBe(2);
  });

  it('ignores entities shorter than 4 chars', () => {
    const tracker = createSessionEntityTracker(100);
    tracker.add('Jo');
    tracker.add('Sam');
    expect(tracker.size).toBe(0);
  });

  it('caps at maxSize and evicts oldest', () => {
    const tracker = createSessionEntityTracker(3);
    tracker.add('Entity One');
    tracker.add('Entity Two');
    tracker.add('Entity Three');
    tracker.add('Entity Four'); // should evict "Entity One"
    expect(tracker.size).toBe(3);
    expect(tracker.countReferences('Entity One')).toBe(0);
    expect(tracker.countReferences('Entity Four')).toBe(1);
  });

  it('clears all entities', () => {
    const tracker = createSessionEntityTracker(100);
    tracker.add('John Smith');
    tracker.add('Sarah Chen');
    tracker.clear();
    expect(tracker.size).toBe(0);
    expect(tracker.countReferences('John Smith')).toBe(0);
  });

  it('matches individual words for multi-word entities', () => {
    const tracker = createSessionEntityTracker(100);
    tracker.add('Sarah Chen');
    // "sarah" and "chen" both appear → match
    expect(tracker.countReferences('I spoke with sarah about chen')).toBe(1);
  });

  it('does not match single words from multi-word entities alone', () => {
    const tracker = createSessionEntityTracker(100);
    tracker.add('Sarah Chen');
    // Only "sarah" appears, not "chen" → no match
    expect(tracker.countReferences('sarah went to the store')).toBe(0);
  });
});
