/**
 * Entity Contextualizer — Contextual Intelligence Engine Layer 3
 *
 * Assigns semantic context to each detected entity based on HOW
 * it appears in the text. A name is not inherently sensitive —
 * it depends on whether it's the user's own name, a public figure,
 * or a third-party's private information.
 *
 * Context tags:
 *   credential       — API keys, passwords, secrets (always critical)
 *   public_reference — publicly known entities being discussed (suppress)
 *   self_reference   — user's own information ("my name is", "I work at")
 *   third_party_private — someone else's private data (protect)
 *   internal_business   — organizational data ("our client", "our deal")
 *
 * Each tag maps to a risk multiplier that modifies the entity's
 * contribution to the sensitivity score.
 */

import type { DetectedEntity } from './types';
import { ALWAYS_CRITICAL_TYPES } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export type EntityContext =
  | 'credential'
  | 'public_reference'
  | 'self_reference'
  | 'third_party_private'
  | 'internal_business';

export interface ContextualizedEntity extends DetectedEntity {
  context: EntityContext;
  contextConfidence: number;
}

// ── Risk multipliers per context ─────────────────────────────────────────────

export const CONTEXT_RISK_MULTIPLIERS: Record<EntityContext, number> = {
  credential: 2.0,         // Always critical — double the weight
  public_reference: 0.2,   // Public info — heavily suppress
  self_reference: 0.3,     // User's own info — mostly safe to share
  third_party_private: 1.5, // Someone else's data — high risk
  internal_business: 1.3,  // Org data — moderate-high risk
};

// ── Self-reference override for critical types (3.6) ─────────────────────────
// Even if "my SSN is 123-45-6789", the SSN is STILL critical.
// Self-reference suppression does NOT apply to these types.
const SELF_REF_OVERRIDE_TYPES: ReadonlySet<string> = ALWAYS_CRITICAL_TYPES;

// ── Pattern definitions ──────────────────────────────────────────────────────

// Self-reference: "my name is", "I work at", "my email is"
const SELF_REF_PATTERNS: RegExp[] = [
  /\b(?:my\s+(?:name|email|phone|number|address)\s+is)\b/i,
  /\b(?:I(?:'m|\s+am)\s+(?:called|named|known\s+as))\b/i,
  /\b(?:I\s+(?:work|worked|live|lived)\s+(?:at|in|for|with))\b/i,
  /\b(?:I(?:'m|\s+am)\s+(?:from|based\s+in|located\s+in))\b/i,
  /\b(?:I(?:'m|\s+am)\s+(?:a|an)\s+\w+\s+at)\b/i,
  /\b(?:my\s+(?:company|firm|organization|employer)\s+is)\b/i,
];

// Public reference: "tell me about", "who is", "what does X do"
const PUBLIC_REF_PATTERNS: RegExp[] = [
  /\b(?:tell\s+me\s+about|who\s+is|who\s+are|what\s+(?:is|does|do)|look\s*up|search\s+for)\b/i,
  /\b(?:(?:CEO|founder|president|author|actor|politician)\s+(?:of|at))\b/i,
  /\b(?:history|biography|career|achievements?)\s+(?:of|about)\b/i,
  /\b(?:(?:competitive|market|industry)\s+(?:research|analysis))\b/i,
];

// Internal business: "our client", "our company", "the firm's"
const INTERNAL_BIZ_PATTERNS: RegExp[] = [
  /\b(?:our\s+(?:client|company|firm|organization|team|deal|acquisition|merger|target|portfolio|fund|strategy|board|counsel))\b/i,
  /\b(?:(?:the|this)\s+(?:company|firm|client|patient|employee)(?:'s|s'))\b/i,
  /\b(?:internal(?:ly)?|proprietary|confidential(?:ly)?|(?:trade|business)\s+secret)\b/i,
];

// Third-party private: data about OTHERS (not self, not public)
// This is the default for entity types like PERSON when near possessive/record patterns
const THIRD_PARTY_PATTERNS: RegExp[] = [
  /\b(?:(?:his|her|their|the\s+patient(?:'s)?|the\s+client(?:'s)?|the\s+employee(?:'s)?)\s+(?:name|email|phone|ssn|dob|address|salary|record|data|information))\b/i,
  /\b(?:(?:patient|client|employee|applicant|candidate|user|customer)\s+(?:data|records?|information|details?|profile))\b/i,
];

// Credential patterns (should match types.ts ALWAYS_CRITICAL_TYPES entities)
const CREDENTIAL_PATTERNS: RegExp[] = [
  /(?:(?:api[_\s-]?key|password|secret|token|credential|private[_\s-]?key)\s*[:=])/i,
  /(?:BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY)/i,
  /(?:mongodb\+srv:\/\/|postgres(?:ql)?:\/\/|mysql:\/\/)/i,
];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Assign semantic context to each detected entity.
 *
 * For each entity, we check its surrounding text (±100 chars) against
 * context patterns to determine if it's a self-reference, public lookup,
 * internal business data, third-party private data, or a credential.
 */
export function contextualizeEntities(
  text: string,
  entities: DetectedEntity[],
): ContextualizedEntity[] {
  if (entities.length === 0) return [];

  // Pre-compute text-level signals (checked once, applied to all entities)
  const hasAnySelfRef = SELF_REF_PATTERNS.some(p => p.test(text.substring(0, 200)));
  const hasAnyPublicRef = PUBLIC_REF_PATTERNS.some(p => p.test(text.substring(0, 200)));
  const hasAnyInternalBiz = INTERNAL_BIZ_PATTERNS.some(p => p.test(text));

  return entities.map(entity => {
    const context = classifyEntityContext(
      text, entity, hasAnySelfRef, hasAnyPublicRef, hasAnyInternalBiz,
    );
    return {
      ...entity,
      context: context.tag,
      contextConfidence: context.confidence,
    };
  });
}

/**
 * Get the risk multiplier for a contextualized entity.
 */
export function getContextRiskMultiplier(entity: ContextualizedEntity): number {
  return CONTEXT_RISK_MULTIPLIERS[entity.context] ?? 1.0;
}

// ── Internal ─────────────────────────────────────────────────────────────────

function classifyEntityContext(
  text: string,
  entity: DetectedEntity,
  hasAnySelfRef: boolean,
  hasAnyPublicRef: boolean,
  hasAnyInternalBiz: boolean,
): { tag: EntityContext; confidence: number } {
  // 1. Credential types are always classified as credential
  if (ALWAYS_CRITICAL_TYPES.has(entity.type)) {
    return { tag: 'credential', confidence: 0.95 };
  }

  // Get surrounding context (±100 chars)
  const ctxStart = Math.max(0, entity.start - 100);
  const ctxEnd = Math.min(text.length, entity.end + 100);
  const surroundingText = text.substring(ctxStart, ctxEnd);

  // 2. Check for credential patterns near the entity
  if (CREDENTIAL_PATTERNS.some(p => p.test(surroundingText))) {
    return { tag: 'credential', confidence: 0.9 };
  }

  // 3. Check for third-party private patterns (near entity)
  if (THIRD_PARTY_PATTERNS.some(p => p.test(surroundingText))) {
    return { tag: 'third_party_private', confidence: 0.85 };
  }

  // 4. Check for internal business patterns
  if (hasAnyInternalBiz && INTERNAL_BIZ_PATTERNS.some(p => p.test(surroundingText))) {
    return { tag: 'internal_business', confidence: 0.8 };
  }

  // 5. Self-reference check — but NOT for critical entity types (3.6)
  if (hasAnySelfRef && !SELF_REF_OVERRIDE_TYPES.has(entity.type)) {
    // Only classify as self-reference if the self-ref pattern is near THIS entity
    if (SELF_REF_PATTERNS.some(p => p.test(surroundingText))) {
      return { tag: 'self_reference', confidence: 0.8 };
    }
  }

  // 6. Public reference check
  if (hasAnyPublicRef) {
    // Only for entity types that CAN be public (PERSON, ORGANIZATION, LOCATION)
    const publicEntityTypes = new Set(['PERSON', 'ORGANIZATION', 'LOCATION']);
    if (publicEntityTypes.has(entity.type)) {
      if (PUBLIC_REF_PATTERNS.some(p => p.test(surroundingText))) {
        return { tag: 'public_reference', confidence: 0.75 };
      }
    }
  }

  // 7. Default: depends on entity type
  // High-PII types default to third_party_private (protective)
  const highRiskDefaults = new Set([
    'SSN', 'CREDIT_CARD', 'MEDICAL_RECORD', 'PASSPORT_NUMBER',
    'DRIVERS_LICENSE', 'ACCOUNT_NUMBER', 'UK_NINO', 'CANADIAN_SIN',
    'INDIAN_AADHAAR', 'AUSTRALIAN_TFN', 'GERMAN_TAX_ID', 'FRENCH_INSEE',
  ]);
  if (highRiskDefaults.has(entity.type)) {
    return { tag: 'third_party_private', confidence: 0.6 };
  }

  // Low-risk types (PERSON, ORGANIZATION, LOCATION, DATE) default based on
  // whether any business context was detected
  if (hasAnyInternalBiz) {
    return { tag: 'internal_business', confidence: 0.5 };
  }

  // True default: third_party_private (fail-safe — protect by default)
  return { tag: 'third_party_private', confidence: 0.4 };
}
