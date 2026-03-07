/**
 * Hardened Local Pseudonymizer
 *
 * Single source of truth for all pseudonymization in the extension.
 * Supports two modes:
 *   - 'realistic' (default): replaces PII with realistic fake values
 *   - 'bracket': replaces with [TYPE-N] tokens
 *
 * Deterministic: same original text always maps to the same pseudonym
 * within a session via the session-wide forward map. The forward map
 * persists across multiple prompts in a conversation.
 *
 * Code-fence aware: entities inside ``` code blocks ``` are skipped
 * unless they are secrets (API keys, credentials, SSNs, credit cards).
 *
 * SECURITY: This module has ZERO network imports. It must never import
 * fetch, XMLHttpRequest, WebSocket, or any module that does.
 */

import type { DetectedEntity } from './types';
import { generateFake, generateFakeSameLength, resetFakeCounters } from './fake-generator';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PseudonymMode = 'realistic' | 'bracket';

export interface PseudonymMapping {
  original: string;
  pseudonym: string;
  type: string;
}

export interface PseudonymResult {
  maskedText: string;
  mappings: PseudonymMapping[];
  /** Number of entities skipped because they were inside code fences */
  skippedInCode: number;
}

export interface PseudonymizerConfig {
  mode: PseudonymMode;
}

// ─── Session-Wide Forward Map ────────────────────────────────────────────────
// Persists across multiple pseudonymize() calls within a session.
// Same original text → same fake value, always.

const MAX_MAP_SIZE = 5000;

let forwardMap: Map<string, string> = new Map();
let reverseMap: Map<string, string> = new Map();
let config: PseudonymizerConfig = { mode: 'realistic' };

/** Get the current forward map (original → fake). Read-only copy. */
export function getForwardMap(): ReadonlyMap<string, string> {
  return forwardMap;
}

/** Get the current reverse map (fake → original). Read-only copy. */
export function getReverseMap(): ReadonlyMap<string, string> {
  return reverseMap;
}

/** Get the reverse map as a plain object (for serialization). */
export function getReverseMapObject(): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const [k, v] of reverseMap) {
    obj[k] = v;
  }
  return obj;
}

/** Restore maps from persisted state (e.g., from encrypted IndexedDB). */
export function restoreMaps(
  forward: Record<string, string>,
  reverse: Record<string, string>,
): void {
  forwardMap = new Map(Object.entries(forward));
  reverseMap = new Map(Object.entries(reverse));
}

/** Clear all maps. Called on session/conversation reset. */
export function resetMaps(): void {
  forwardMap.clear();
  reverseMap.clear();
  resetFakeCounters();
}

/** Set the pseudonymization mode. */
export function setPseudonymMode(newMode: PseudonymMode): void {
  config.mode = newMode;
}

/** Get the current pseudonymization mode. */
export function getPseudonymMode(): PseudonymMode {
  return config.mode;
}

// ─── Code Fence Detection ────────────────────────────────────────────────────

interface CodeRange {
  start: number;
  end: number;
}

function findCodeRanges(text: string): CodeRange[] {
  const ranges: CodeRange[] = [];
  const fencedRegex = /```[\s\S]*?```/g;
  let match: RegExpExecArray | null;
  while ((match = fencedRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  const inlineRegex = /`[^`\n]+`/g;
  while ((match = inlineRegex.exec(text)) !== null) {
    const pos = match.index;
    const end = pos + match[0].length;
    const insideFenced = ranges.some(r => pos >= r.start && end <= r.end);
    if (!insideFenced) {
      ranges.push({ start: pos, end });
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

function isInsideCode(position: number, codeRanges: CodeRange[]): boolean {
  for (const range of codeRanges) {
    if (position >= range.start && position < range.end) return true;
    if (range.start > position) break;
  }
  return false;
}

// Entity types that ALWAYS get pseudonymized, even inside code fences
const ALWAYS_PSEUDONYMIZE = new Set([
  'API_KEY', 'AWS_CREDENTIAL', 'GCP_CREDENTIAL', 'DATABASE_URI',
  'PRIVATE_KEY', 'AUTH_TOKEN', 'SSN', 'CREDIT_CARD',
]);

// ─── Map Eviction ────────────────────────────────────────────────────────────

function evictIfNeeded(): void {
  if (forwardMap.size <= MAX_MAP_SIZE) return;
  // Drop oldest 20% of entries
  const toDelete = Math.floor(forwardMap.size * 0.2);
  let count = 0;
  for (const [key, value] of forwardMap) {
    if (count >= toDelete) break;
    forwardMap.delete(key);
    reverseMap.delete(value);
    count++;
  }
}

// ─── Core Pseudonymizer ──────────────────────────────────────────────────────

/**
 * Pseudonymize detected entities in text.
 *
 * - Deterministic: same entity text → same pseudonym across calls
 * - Code-fence aware: skips entities in code blocks (except secrets)
 * - Session-persistent: forward/reverse maps survive across prompts
 */
export function pseudonymizeLocal(
  text: string,
  entities: DetectedEntity[],
  options?: { mode?: PseudonymMode },
): PseudonymResult {
  if (entities.length === 0) {
    return { maskedText: text, mappings: [], skippedInCode: 0 };
  }

  const activeMode = options?.mode ?? config.mode;
  const codeRanges = findCodeRanges(text);
  const bracketCounters: Record<string, number> = {};
  const mappings: PseudonymMapping[] = [];
  let skippedInCode = 0;

  evictIfNeeded();

  // Sort entities by start position descending (replacements don't shift earlier positions)
  const sorted = [...entities].sort((a, b) => b.start - a.start);
  let maskedText = text;

  for (const entity of sorted) {
    // Skip entities inside code fences (unless they're high-severity secrets)
    if (codeRanges.length > 0 && isInsideCode(entity.start, codeRanges) && !ALWAYS_PSEUDONYMIZE.has(entity.type)) {
      skippedInCode++;
      continue;
    }

    const normalizedText = entity.text.trim();

    // Check if we already have a mapping for this exact text
    let pseudonym = forwardMap.get(normalizedText);

    if (!pseudonym) {
      if (activeMode === 'realistic') {
        pseudonym = generateFake(entity.type, normalizedText);
      } else {
        bracketCounters[entity.type] = (bracketCounters[entity.type] || 0) + 1;
        pseudonym = `[${entity.type}-${bracketCounters[entity.type]}]`;
      }
      forwardMap.set(normalizedText, pseudonym);
      reverseMap.set(pseudonym, normalizedText);
    }

    // Record in this call's mappings (even if reused from prior call)
    if (!mappings.some(m => m.original === normalizedText)) {
      mappings.push({ original: normalizedText, pseudonym, type: entity.type });
    }

    maskedText = maskedText.substring(0, entity.start) + pseudonym + maskedText.substring(entity.end);
  }

  mappings.reverse();
  return { maskedText, mappings, skippedInCode };
}

/**
 * Pseudonymize with same-byte-length replacements.
 * For WebSocket/binary protocol interception where byte length must be preserved.
 */
export function pseudonymizeSameLength(
  text: string,
  entities: DetectedEntity[],
): PseudonymResult {
  if (entities.length === 0) {
    return { maskedText: text, mappings: [], skippedInCode: 0 };
  }

  const mappings: PseudonymMapping[] = [];

  evictIfNeeded();

  const sorted = [...entities].sort((a, b) => b.start - a.start);
  let maskedText = text;

  for (const entity of sorted) {
    const normalizedText = entity.text.trim();
    let pseudonym = forwardMap.get(normalizedText);

    if (!pseudonym) {
      pseudonym = generateFakeSameLength(entity.type, normalizedText);
      forwardMap.set(normalizedText, pseudonym);
      reverseMap.set(pseudonym, normalizedText);
    }

    if (!mappings.some(m => m.original === normalizedText)) {
      mappings.push({ original: normalizedText, pseudonym, type: entity.type });
    }

    maskedText = maskedText.substring(0, entity.start) + pseudonym + maskedText.substring(entity.end);
  }

  mappings.reverse();
  return { maskedText, mappings, skippedInCode: 0 };
}

/**
 * De-pseudonymize text by replacing fakes with originals.
 * Uses the session-wide reverse map.
 */
export function depseudonymize(text: string): string {
  let result = text;
  // Sort by pseudonym length descending to avoid partial replacements
  const entries = Array.from(reverseMap.entries()).sort((a, b) => b[0].length - a[0].length);
  for (const [pseudonym, original] of entries) {
    result = result.replaceAll(pseudonym, original);
  }
  return result;
}

/**
 * De-pseudonymize using an explicit mapping (not the global reverse map).
 * Accepts either an array of PseudonymMapping or a plain {pseudonym: original} map.
 */
export function depseudonymizeWithMap(
  text: string,
  map: PseudonymMapping[] | Record<string, string>,
): string {
  if (Array.isArray(map)) {
    let result = text;
    // Sort by pseudonym length descending
    const sorted = [...map].sort((a, b) => b.pseudonym.length - a.pseudonym.length);
    for (const mapping of sorted) {
      result = result.replaceAll(mapping.pseudonym, mapping.original);
    }
    return result;
  }

  let result = text;
  const entries = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
  for (const [pseudonym, original] of entries) {
    result = result.replaceAll(pseudonym, original);
  }
  return result;
}

/**
 * Strip raw PII (.original) from mappings for safe transit over postMessage.
 * Only pseudonym, type, and length are transmitted — never raw text.
 */
export function sanitizeMappingsForTransit(
  mappings: PseudonymMapping[],
): Array<{ pseudonym: string; type: string; length: number }> {
  return mappings.map(m => ({ pseudonym: m.pseudonym, type: m.type, length: m.original.length }));
}

/**
 * Sanitize text for Tier 3 server-side classification.
 *
 * Replaces all detected PII with type tokens ([PERSON], [SSN], etc.)
 * but preserves surrounding context, sentence structure, and document
 * layout. This lets the server classify sensitivity level without
 * ever seeing raw PII values.
 *
 * Example:
 *   Input:  "Patient Sarah Thompson, MRN-2024-44891, diagnosed with stage 3 cancer"
 *   Output: "Patient [PERSON], [MEDICAL_RECORD], diagnosed with stage 3 cancer"
 */
export function sanitizeForClassification(
  text: string,
  entities: DetectedEntity[],
): string {
  if (entities.length === 0) return text;

  // Sort entities by start position descending so replacements don't shift indices
  const sorted = [...entities].sort((a, b) => b.start - a.start);
  let result = text;

  for (const entity of sorted) {
    result = result.substring(0, entity.start) + `[${entity.type}]` + result.substring(entity.end);
  }

  return result;
}
