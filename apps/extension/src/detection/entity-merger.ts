/**
 * Entity Merger — Combines entities from multiple detection sources
 *
 * Merges results from:
 *   - Tier 1: Regex-based detection (fallback-regex.ts)
 *   - Tier 3: Entity dictionary (entity-dictionary.ts)
 *
 * Priority: Dictionary > Regex
 * Dictionary entries are ground truth (admin-configured).
 * Regex is the fallback for well-structured patterns (SSN, email, etc).
 *
 * Deduplication: overlapping spans are resolved by keeping the
 * highest-priority source. If two spans partially overlap, the
 * one with higher confidence wins.
 */

import type { DetectedEntity } from './types';

// Source priority (higher = preferred)
// 'keyword' is used by the LLM agent detector — it understands context
// better than regex for names, orgs, and contextual entities.
const SOURCE_PRIORITY: Record<string, number> = {
  dictionary: 4,  // Admin-curated = ground truth
  gliner: 3,      // On-device ML model
  keyword: 2,     // LLM agent detector (context-aware)
  presidio: 2,
  regex: 1,       // Pattern matching fallback
};

/**
 * Merge entities from multiple detection sources.
 * Deduplicates overlapping spans, preferring higher-priority sources.
 */
function isValidEntity(e: any): boolean {
  return (
    e &&
    typeof e.start === 'number' && Number.isFinite(e.start) && e.start >= 0 &&
    typeof e.end === 'number' && Number.isFinite(e.end) && e.end > e.start &&
    typeof e.type === 'string' && e.type.length > 0
  );
}

export function mergeEntities(...sources: DetectedEntity[][]): DetectedEntity[] {
  const all = sources.flat().filter(isValidEntity);
  if (all.length === 0) return [];

  // Sort by start position, then by priority (highest first), then by span length (longest first)
  all.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const pa = SOURCE_PRIORITY[a.source] || 0;
    const pb = SOURCE_PRIORITY[b.source] || 0;
    if (pa !== pb) return pb - pa;
    return (b.end - b.start) - (a.end - a.start);
  });

  // Greedy non-overlapping selection
  const result: DetectedEntity[] = [];
  let lastEnd = -1;

  for (const entity of all) {
    // No overlap with previously accepted entity
    if (entity.start >= lastEnd) {
      result.push(entity);
      lastEnd = entity.end;
      continue;
    }

    // Overlapping: check if this entity should replace the last accepted one
    const prev = result[result.length - 1];
    if (!prev) continue;

    const prevPriority = SOURCE_PRIORITY[prev.source] || 0;
    const currPriority = SOURCE_PRIORITY[entity.source] || 0;

    // Higher priority source replaces lower
    if (currPriority > prevPriority) {
      result[result.length - 1] = entity;
      lastEnd = entity.end;
    }
    // Same priority but longer span or higher confidence
    else if (currPriority === prevPriority) {
      const currLen = entity.end - entity.start;
      const prevLen = prev.end - prev.start;
      if (currLen > prevLen || (currLen === prevLen && entity.confidence > prev.confidence)) {
        result[result.length - 1] = entity;
        lastEnd = entity.end;
      }
    }
  }

  return result;
}

/**
 * Compute a score boost based on dictionary matches.
 * Used to escalate GREEN/AMBER zone when known entities are found.
 */
export function dictionaryScoreBoost(dictionaryMatches: DetectedEntity[]): number {
  if (dictionaryMatches.length === 0) return 0;

  // Each dictionary match adds a significant boost since these are
  // admin-confirmed sensitive entities
  let boost = 0;
  for (const match of dictionaryMatches) {
    switch (match.type) {
      case 'PERSON':
        boost += 15;
        break;
      case 'ORGANIZATION':
        boost += 12;
        break;
      case 'PROJECT_NAME':
        boost += 10;
        break;
      case 'LOCATION':
        boost += 8;
        break;
      default:
        boost += 10;
        break;
    }
  }

  // Cap at 40 to avoid over-escalation from dictionary alone
  return Math.min(40, boost);
}
