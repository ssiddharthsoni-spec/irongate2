// ============================================================================
// @contracts/detection-result — The single SSOT envelope.
//
// This is the ONE object that crosses every boundary:
//   Service Worker → Side Panel
//   Service Worker → Storage
//   Service Worker → Audit Trail
//
// One shape. One writer. One subscriber. The sidepanel never reads
// lastScore, entities, or recentActivity as separate keys. It reads
// DetectionResult[] and derives everything from that.
// ============================================================================

import type { Judgment } from './judgment';
import type { EvidenceBundle } from './evidence';

/**
 * The detection result envelope — the SSOT for a single detection pass.
 *
 * recentActivity is not a storage key; it is derive(detectionResults[]).
 * totalEntitiesDetected is not a counter; it is sum(results.map(r => r.judgment.entities.length)).
 */
export interface DetectionResult {
  /** Unique ID for this detection pass */
  id: string;
  /** The judgment that drives all downstream behavior */
  judgment: Judgment;
  /** Raw evidence from Stage 1 (for debugging, eval, and audit) */
  evidence: EvidenceBundle;
  /** Tab that produced this result */
  tabId: number | null;
  /** Whether the prompt was actually pseudonymized */
  wasIntercepted: boolean;
  /** Monotonic sequence number for ordering */
  seq: number;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Derive activity feed items from DetectionResult[].
 * This replaces the separate recentActivity storage key.
 */
export interface ActivityItem {
  id: string;
  aiTool: string;
  score: number;
  level: string;
  entityCount: number;
  verdict: string;
  wasIntercepted: boolean;
  degraded: boolean;
  timestamp: string;
}

/** Derive an ActivityItem from a DetectionResult. */
export function toActivityItem(result: DetectionResult): ActivityItem {
  return {
    id: result.id,
    aiTool: result.judgment.entities.length > 0
      ? result.evidence.aiToolId
      : 'generic',
    score: result.judgment.score,
    level: result.judgment.level,
    entityCount: result.judgment.entities.length,
    verdict: result.judgment.verdict,
    wasIntercepted: result.wasIntercepted,
    degraded: result.judgment.degraded,
    timestamp: result.timestamp,
  };
}

/** Derive entity counts by type from DetectionResult[]. */
export function entityCountsByType(results: DetectionResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of results) {
    for (const e of r.judgment.entities) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
    }
  }
  return counts;
}

/** Derive total entities detected from DetectionResult[]. */
export function totalEntitiesDetected(results: DetectionResult[]): number {
  return results.reduce((sum, r) => sum + r.judgment.entities.length, 0);
}
