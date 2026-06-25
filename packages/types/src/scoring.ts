/**
 * Shared sensitivity-scoring core.
 *
 * These four primitives were verified (June 2026) to be BYTE-IDENTICAL in
 * logic across the API scorer (apps/api/src/detection/scorer.ts) and the
 * extension scorer (apps/extension/src/detection/scorer.ts) — same caps
 * (70/25/25), combo bonuses (1.3/1.15), count bonuses (1.4/1.2), volume
 * thresholds (5000/2000/500 → 20/10/5), ±200 context window, and identical
 * citation/matter regexes. They are parameterized by the caller's weight
 * table and keyword lists so each app keeps its EXACT current behavior — no
 * value is hard-coded here that differs between apps.
 *
 * Score bands (0-25 low / 26-60 medium / 61-85 high / 86-100 critical) are
 * also identical and live here as the single source of truth.
 *
 * NOTE: the extension wraps these primitives in additional layers (floors,
 * intent suppression, executive lens) and the API wraps them in firm-aware
 * features (weight overrides, graph boost, doc-type multiplier). Those outer
 * layers stay app-specific — only the shared core lives here.
 */

// SensitivityLevel is the canonical type already exported from ./index — reuse
// it (don't redefine) to avoid a duplicate-export clash through the barrel.
import type { SensitivityLevel } from './index';

/** Minimal entity shape the scorer needs; both apps' DetectedEntity satisfy it structurally. */
export interface ScorableEntity {
  type: string;
  start: number;
  end: number;
  confidence: number;
}

export const SCORE_BANDS = { lowMax: 25, mediumMax: 60, highMax: 85 } as const;

export function scoreToLevel(s: number): SensitivityLevel {
  if (s <= SCORE_BANDS.lowMax) return 'low';
  if (s <= SCORE_BANDS.mediumMax) return 'medium';
  if (s <= SCORE_BANDS.highMax) return 'high';
  return 'critical';
}

// Caps and bonuses — identical in both apps (verified).
const ENTITY_SCORE_CAP = 70;
const CONTEXT_SCORE_CAP = 25;
const LEGAL_BOOST_CAP = 25;
const TYPE_COMBO_BONUS_3PLUS = 1.3;
const TYPE_COMBO_BONUS_2 = 1.15;
const COUNT_BONUS_10PLUS = 1.4;
const COUNT_BONUS_5PLUS = 1.2;
const DEFAULT_ENTITY_CONTEXT_WINDOW = 200;
const DEFAULT_ENTITY_WEIGHT = 5;

/** Weighted sum of entities × confidence, with combination + count bonuses, capped at 70. */
export function computeEntityScore(entities: ScorableEntity[], weights: Record<string, number>): number {
  if (entities.length === 0) return 0;

  let s = 0;
  for (const entity of entities) {
    const weight = weights[entity.type] || DEFAULT_ENTITY_WEIGHT;
    const confidence = Number.isFinite(entity.confidence) ? entity.confidence : 0.5;
    s += weight * confidence;
  }

  const uniqueTypes = new Set(entities.map((e) => e.type));
  if (uniqueTypes.size >= 3) s *= TYPE_COMBO_BONUS_3PLUS;
  else if (uniqueTypes.size >= 2) s *= TYPE_COMBO_BONUS_2;

  if (entities.length >= 10) s *= COUNT_BONUS_10PLUS;
  else if (entities.length >= 5) s *= COUNT_BONUS_5PLUS;

  return Math.min(ENTITY_SCORE_CAP, s);
}

/** Text-length volume contribution: 5000→20, 2000→10, 500→5, else 0. */
export function computeVolumeScore(text: string): number {
  const len = text.length;
  if (len >= 5000) return 20;
  if (len >= 2000) return 10;
  if (len >= 500) return 5;
  return 0;
}

/** +5 per entity with a legal keyword within `window` chars, capped at 25. */
export function computeContextScore(
  text: string,
  entities: ScorableEntity[],
  legalKeywords: readonly string[],
  window: number = DEFAULT_ENTITY_CONTEXT_WINDOW,
): number {
  if (entities.length === 0) return 0;

  const lowerText = text.toLowerCase();
  let s = 0;
  for (const entity of entities) {
    const start = Math.max(0, entity.start - window);
    const end = Math.min(text.length, entity.end + window);
    const surrounding = lowerText.substring(start, end);
    for (const keyword of legalKeywords) {
      if (surrounding.includes(keyword)) {
        s += 5;
        break; // count once per entity
      }
    }
  }
  return Math.min(CONTEXT_SCORE_CAP, s);
}

/** Privilege markers (+15 each), case citations (+5 each), matter/case numbers (+10), capped at 25. */
export function computeLegalBoost(text: string, privilegeMarkers: readonly string[]): number {
  const lowerText = text.toLowerCase();
  let boost = 0;

  for (const marker of privilegeMarkers) {
    if (lowerText.includes(marker)) boost += 15;
  }

  const citations = text.match(/\b[A-Z][a-z]+\s+v\.?\s+[A-Z][a-z]+\b/g);
  if (citations) boost += citations.length * 5;

  if (/\b(?:matter|case|docket)\s*(?:#|no\.?|number)?\s*\d/gi.test(text)) {
    boost += 10;
  }

  return Math.min(LEGAL_BOOST_CAP, boost);
}
