/**
 * Entity Contextualizer — Server-side contextual intelligence.
 *
 * Assigns semantic context to each detected entity based on HOW
 * it appears in the text. Context tags determine risk multipliers.
 *
 * Tags:
 *   credential       → 2.0x (always critical)
 *   public_reference  → 0.1x (research, public figure lookup — suppress)
 *   self_reference    → 0.2x (user's own info — mostly safe)
 *   third_party_private → 1.5x (someone else's data — protect)
 *   internal_business   → 1.3x (org data — moderate-high risk)
 */

// Compatible with both @iron-gate/types and detector.ts local DetectedEntity
interface DetectedEntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: string;
}

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

export const CONTEXT_RISK_MULTIPLIERS: Record<EntityContext, number> = {
  credential: 2.0,
  public_reference: 0.1,
  self_reference: 0.2,
  third_party_private: 1.5,
  internal_business: 1.3,
};

// Types that NEVER get suppressed by self-reference
const SELF_REF_OVERRIDE_TYPES = new Set([
  'API_KEY', 'PRIVATE_KEY', 'AWS_CREDENTIAL', 'GCP_CREDENTIAL',
  'DATABASE_URI', 'SSN', 'CREDIT_CARD', 'ACCOUNT_NUMBER',
  'MEDICAL_RECORD', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE',
]);

const SELF_REF_PATTERNS: RegExp[] = [
  /\b(?:my\s+(?:name|email|phone|number|address)\s+is)\b/i,
  /\b(?:I(?:'m|\s+am)\s+(?:called|named|known\s+as))\b/i,
  /\b(?:I\s+(?:work|worked|live|lived)\s+(?:at|in|for|with))\b/i,
  /\b(?:I(?:'m|\s+am)\s+(?:from|based\s+in|located\s+in))\b/i,
  /\b(?:my\s+(?:company|firm|organization|employer)\s+is)\b/i,
];

const PUBLIC_REF_PATTERNS: RegExp[] = [
  /\b(?:tell\s+me\s+about|who\s+is|who\s+are|what\s+(?:is|does|do)|look\s*up|search\s+for)\b/i,
  /\b(?:(?:CEO|founder|president|author|actor|politician)\s+(?:of|at))\b/i,
  /\b(?:history|biography|career|achievements?)\s+(?:of|about)\b/i,
  /\b(?:(?:competitive|market|industry)\s+(?:research|analysis))\b/i,
];

const INTERNAL_BIZ_PATTERNS: RegExp[] = [
  /\b(?:our\s+(?:client|company|firm|organization|team|deal|acquisition|merger|target|portfolio|fund|strategy|board|counsel))\b/i,
  /\b(?:(?:the|this)\s+(?:company|firm|client|patient|employee)(?:'s|s'))\b/i,
  /\b(?:internal(?:ly)?|proprietary|confidential(?:ly)?|(?:trade|business)\s+secret)\b/i,
];

const THIRD_PARTY_PATTERNS: RegExp[] = [
  /\b(?:(?:his|her|their|the\s+patient(?:'s)?|the\s+client(?:'s)?|the\s+employee(?:'s)?)\s+(?:name|email|phone|ssn|dob|address|salary|record|data|information))\b/i,
  /\b(?:(?:patient|client|employee|applicant|candidate|user|customer)\s+(?:data|records?|information|details?|profile))\b/i,
];

const CREDENTIAL_PATTERNS: RegExp[] = [
  /(?:(?:api[_\s-]?key|password|secret|token|credential|private[_\s-]?key)\s*[:=])/i,
  /(?:BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY)/i,
  /(?:mongodb\+srv:\/\/|postgres(?:ql)?:\/\/|mysql:\/\/)/i,
];

/**
 * Assign semantic context to each detected entity.
 */
export function contextualizeEntities(
  text: string,
  entities: DetectedEntity[],
): ContextualizedEntity[] {
  if (entities.length === 0) return [];

  const opening = text.substring(0, 200);
  const hasAnySelfRef = SELF_REF_PATTERNS.some(p => p.test(opening));
  const hasAnyPublicRef = PUBLIC_REF_PATTERNS.some(p => p.test(opening));
  const hasAnyInternalBiz = INTERNAL_BIZ_PATTERNS.some(p => p.test(text));

  return entities.map(entity => {
    const ctx = classifyEntityContext(text, entity, hasAnySelfRef, hasAnyPublicRef, hasAnyInternalBiz);
    return { ...entity, context: ctx.tag, contextConfidence: ctx.confidence };
  });
}

export function getContextRiskMultiplier(entity: ContextualizedEntity): number {
  return CONTEXT_RISK_MULTIPLIERS[entity.context] ?? 1.0;
}

function classifyEntityContext(
  text: string,
  entity: DetectedEntity,
  hasAnySelfRef: boolean,
  hasAnyPublicRef: boolean,
  hasAnyInternalBiz: boolean,
): { tag: EntityContext; confidence: number } {
  // 1. Always-critical types
  if (SELF_REF_OVERRIDE_TYPES.has(entity.type)) {
    return { tag: 'credential', confidence: 0.95 };
  }

  const ctxStart = Math.max(0, entity.start - 100);
  const ctxEnd = Math.min(text.length, entity.end + 100);
  const surrounding = text.substring(ctxStart, ctxEnd);

  // 2. Credential patterns near entity
  if (CREDENTIAL_PATTERNS.some(p => p.test(surrounding))) {
    return { tag: 'credential', confidence: 0.9 };
  }

  // 3. Third-party private
  if (THIRD_PARTY_PATTERNS.some(p => p.test(surrounding))) {
    return { tag: 'third_party_private', confidence: 0.85 };
  }

  // 4. Internal business
  if (hasAnyInternalBiz && INTERNAL_BIZ_PATTERNS.some(p => p.test(surrounding))) {
    return { tag: 'internal_business', confidence: 0.8 };
  }

  // 5. Self-reference (not for critical types — already handled above)
  if (hasAnySelfRef && SELF_REF_PATTERNS.some(p => p.test(surrounding))) {
    return { tag: 'self_reference', confidence: 0.8 };
  }

  // 6. Public reference
  if (hasAnyPublicRef) {
    const publicTypes = new Set(['PERSON', 'ORGANIZATION', 'LOCATION']);
    if (publicTypes.has(entity.type) && PUBLIC_REF_PATTERNS.some(p => p.test(surrounding))) {
      return { tag: 'public_reference', confidence: 0.75 };
    }
  }

  // 7. Default: third_party_private (fail-safe)
  if (hasAnyInternalBiz) {
    return { tag: 'internal_business', confidence: 0.5 };
  }
  return { tag: 'third_party_private', confidence: 0.4 };
}
