// ============================================================================
// Dedupe Resolver — collapses overlapping detection spans.
//
// Pure function: Detection[] in, Detection[] out. No side effects.
//
// Strategy:
//   1. Sort by confidence descending (highest confidence first)
//   2. For same-confidence ties, prefer longer spans
//   3. Source priority tiebreak: firm-lexicon > llm > dictionary > regex > heuristic
//   4. Keep the winner; drop any detection that overlaps with a kept detection
//
// This replaces the ad-hoc Set-based dedup in the current scorer.
// ============================================================================

import type { Detection, DetectorSource } from '../../contracts/entities';

/** Source priority: higher number = higher trust. */
const SOURCE_PRIORITY: Record<DetectorSource, number> = {
  'heuristic': 1,
  'regex': 2,
  'dictionary': 3,
  'llm': 4,
  'firm-lexicon': 5,
};

function getSourcePriority(source: string): number {
  return SOURCE_PRIORITY[source as DetectorSource] ?? 0;
}

/**
 * Check if two spans overlap.
 * [s1, e1) and [s2, e2) overlap iff s1 < e2 && s2 < e1.
 */
function overlaps(a: Detection, b: Detection): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Collapse overlapping detections by confidence, span length, and source priority.
 *
 * @param detections - All candidate detections from all sources.
 * @returns Deduped detections with no overlapping spans.
 */
export function dedupeDetections(detections: Detection[]): Detection[] {
  if (detections.length <= 1) return [...detections];

  // Sort: highest confidence first, then longest span, then highest source priority
  const sorted = [...detections].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const aLen = a.end - a.start;
    const bLen = b.end - b.start;
    if (bLen !== aLen) return bLen - aLen;
    return getSourcePriority(b.source) - getSourcePriority(a.source);
  });

  const kept: Detection[] = [];

  for (const candidate of sorted) {
    const hasOverlap = kept.some(k => overlaps(k, candidate));
    if (!hasOverlap) {
      kept.push(candidate);
    }
  }

  // Return sorted by position for consistent output
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * Merge detections from multiple sources, keeping the best version
 * of each span. Same as dedupeDetections but with explicit source attribution.
 */
export function mergeDetections(...sources: Detection[][]): Detection[] {
  return dedupeDetections(sources.flat());
}
