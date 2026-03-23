/**
 * Iron Gate — Pseudonym Map Contract
 *
 * THE authoritative type definitions for pseudonym maps.
 * Every component (extension, API, detection service) MUST use these types.
 * No ad-hoc additions. Changes require team sign-off.
 */

/** Single mapping entry: original <-> pseudonym */
export interface PseudonymEntry {
  /** The original sensitive text (e.g., "John Smith") */
  original: string;
  /** The replacement pseudonym (e.g., "James Wilson") */
  pseudonym: string;
  /** Entity type classification */
  entityType: string;
  /** Detection confidence score (0-1) */
  confidence: number;
  /** Which detection system found this entity */
  source: 'dictionary' | 'model' | 'regex' | 'server';
  /** Position in original text */
  startOffset: number;
  endOffset: number;
}

/** Forward map: original text -> pseudonym */
export type ForwardMap = Record<string, string>;

/** Reverse map: pseudonym -> original text */
export type ReverseMap = Record<string, string>;

/** Complete session pseudonym map with full metadata */
export interface SessionPseudonymMap {
  /** Unique session identifier (typically tab-${tabId} or server-assigned UUID) */
  sessionId: string;
  /** Organization ID for tenant isolation */
  orgId: string;
  /** All entity mappings in this session */
  entries: PseudonymEntry[];
  /** Fast lookup: original -> pseudonym */
  forwardMap: ForwardMap;
  /** Fast lookup: pseudonym -> original (for de-pseudonymization) */
  reverseMap: ReverseMap;
  /** When this session was created */
  createdAt: number;
  /** When this session expires (epoch ms) */
  expiresAt: number;
}

/** Result of a pseudonymization operation */
export interface PseudonymizeResult {
  /** Text with all entities replaced by pseudonyms */
  maskedText: string;
  /** Individual entity mappings applied */
  mappings: PseudonymEntry[];
  /** Count of entities that were in code blocks and skipped */
  skippedInCode: number;
}

/** Result of a de-pseudonymization operation */
export interface DepseudonymizeResult {
  /** Text with pseudonyms replaced by originals */
  restoredText: string;
  /** Number of pseudonyms that were successfully replaced */
  replacementCount: number;
  /** Pseudonyms that weren't found in the reverse map */
  unresolvedPseudonyms: string[];
}
