/**
 * Sensitivity scoring algorithm for the API server.
 * Supports both synchronous (basic) and firm-aware (async) scoring.
 *
 * Score ranges:
 *   0-25:  Low    — Generic queries, no PII
 *  26-60:  Medium — Some identifiable information
 *  61-85:  High   — Multiple entities or sensitive combinations
 *  86-100: Critical — Highly sensitive content (financial, legal, medical)
 */

import type { DetectedEntity } from '@iron-gate/types';
import { getBoostMultiplier } from '../services/sensitivity-graph';
import { db } from '../db/client';
import { weightOverrides } from '../db/schema';
import { eq } from 'drizzle-orm';

export type SensitivityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ScoreResult {
  score: number;
  level: SensitivityLevel;
  breakdown: Record<string, number>;
  explanation: string;
}

interface ScoreFirmAwareOptions {
  firmId: string;
  documentType?: string;
  conversationTurnCount?: number;
  previousTurnScore?: number;
}

const ENTITY_WEIGHTS: Record<string, number> = {
  PERSON: 10,
  ORGANIZATION: 8,
  LOCATION: 3,
  DATE: 2,
  PHONE_NUMBER: 15,
  EMAIL: 12,
  CREDIT_CARD: 30,
  SSN: 40,
  MONETARY_AMOUNT: 12,
  ACCOUNT_NUMBER: 25,
  IP_ADDRESS: 8,
  MEDICAL_RECORD: 35,
  PASSPORT_NUMBER: 35,
  DRIVERS_LICENSE: 30,
  MATTER_NUMBER: 20,
  CLIENT_MATTER_PAIR: 25,
  PRIVILEGE_MARKER: 30,
  DEAL_CODENAME: 20,
  OPPOSING_COUNSEL: 15,
  // Secrets / Credentials — always critical
  API_KEY: 50,
  DATABASE_URI: 50,
  AUTH_TOKEN: 45,
  PRIVATE_KEY: 50,
  AWS_CREDENTIAL: 50,
  GCP_CREDENTIAL: 50,
  AZURE_CREDENTIAL: 50,
};

// Document type multipliers — certain document types indicate higher risk
const DOCUMENT_TYPE_MULTIPLIERS: Record<string, number> = {
  contract_clause: 1.4,
  litigation_doc: 1.5,
  client_memo: 1.3,
  financial_data: 1.4,
  email_draft: 1.1,
  code_snippet: 1.0,
  meeting_notes: 1.1,
  casual_question: 0.8,
  personal: 0.7,
};

const LEGAL_KEYWORDS = [
  'privileged', 'attorney-client', 'work product', 'without prejudice',
  'confidential', 'under seal', 'protective order', 'settlement',
  'mediation', 'arbitration', 'deposition', 'subpoena',
  'motion to compel', 'discovery', 'litigation hold',
  'retainer', 'engagement letter',
];

const PRIVILEGE_MARKERS = [
  'attorney-client privilege', 'work product doctrine',
  'privileged and confidential', 'attorney work product',
  'protected communication', 'legal professional privilege',
];

// Weight override cache per firm
const weightOverrideCache = new Map<string, { data: Map<string, number>; loadedAt: number }>();
const WEIGHT_CACHE_TTL = 5 * 60_000; // 5 minutes

/**
 * Score text + entities and return a 0-100 sensitivity score (synchronous).
 * Backwards-compatible — used when no firm context is available.
 */
export function score(text: string, entities: DetectedEntity[]): ScoreResult {
  const entityScore = computeEntityScore(entities, ENTITY_WEIGHTS);
  const volumeScore = computeVolumeScore(text);
  const contextScore = computeContextScore(text, entities);
  const legalBoost = computeLegalBoost(text);

  const rawScore = entityScore + volumeScore + contextScore + legalBoost;
  const finalScore = Math.min(100, Math.max(0, Math.round(rawScore)));
  const level = scoreToLevel(finalScore);
  const explanation = generateExplanation(finalScore, level, entities, text);

  return {
    score: finalScore,
    level,
    breakdown: { entityScore, volumeScore, contextScore, legalBoost },
    explanation,
  };
}

/**
 * Full firm-aware scoring pipeline with sensitivity graph boost,
 * per-firm weight overrides, document type multiplier, and
 * conversation escalation tracking.
 */
export async function scoreFirmAware(
  text: string,
  entities: DetectedEntity[],
  options: ScoreFirmAwareOptions,
): Promise<ScoreResult> {
  // 1. Load firm weight overrides
  const overrides = await loadWeightOverrides(options.firmId);
  const effectiveWeights = { ...ENTITY_WEIGHTS };
  for (const [entityType, multiplier] of overrides) {
    if (effectiveWeights[entityType] !== undefined) {
      effectiveWeights[entityType] = Math.round(effectiveWeights[entityType] * multiplier);
    }
  }

  // 2. Compute base scores with firm-adjusted weights
  const entityScore = computeEntityScore(entities, effectiveWeights);
  const volumeScore = computeVolumeScore(text);
  const contextScore = computeContextScore(text, entities);
  const legalBoost = computeLegalBoost(text);

  // 3. Sensitivity graph boost (MOAT feature)
  let graphBoost = 0;
  let graphReasons: string[] = [];
  try {
    const boost = await getBoostMultiplier(options.firmId, entities);
    graphBoost = boost.boost;
    graphReasons = boost.reasons;
  } catch {
    // Non-critical — continue without boost
  }

  // 4. Document type multiplier
  let documentMultiplier = 1.0;
  if (options.documentType && DOCUMENT_TYPE_MULTIPLIERS[options.documentType]) {
    documentMultiplier = DOCUMENT_TYPE_MULTIPLIERS[options.documentType];
  }

  // 5. Conversation escalation
  let conversationBoost = 0;
  if (options.conversationTurnCount && options.conversationTurnCount > 1) {
    if (options.previousTurnScore && options.previousTurnScore > 30) {
      conversationBoost = Math.min(15, options.conversationTurnCount * 3);
    }
  }

  // 6. Combine all components
  const baseScore = entityScore + volumeScore + contextScore + legalBoost;
  const adjustedScore = (baseScore * documentMultiplier) + graphBoost + conversationBoost;
  const finalScore = Math.min(100, Math.max(0, Math.round(adjustedScore)));
  const level = scoreToLevel(finalScore);
  const explanation = generateExplanation(finalScore, level, entities, text, graphReasons);

  return {
    score: finalScore,
    level,
    breakdown: {
      entityScore,
      volumeScore,
      contextScore,
      legalBoost,
      firmKnowledgeBoost: graphBoost,
      documentTypeMultiplier: documentMultiplier,
      conversationEscalation: conversationBoost,
    },
    explanation,
  };
}

function computeEntityScore(entities: DetectedEntity[], weights: Record<string, number>): number {
  if (entities.length === 0) return 0;

  let s = 0;
  for (const entity of entities) {
    const weight = weights[entity.type] || 5;
    s += weight * entity.confidence;
  }

  // Combination bonus
  const uniqueTypes = new Set(entities.map((e) => e.type));
  if (uniqueTypes.size >= 3) s *= 1.3;
  else if (uniqueTypes.size >= 2) s *= 1.15;

  // Count bonus
  if (entities.length >= 10) s *= 1.4;
  else if (entities.length >= 5) s *= 1.2;

  return Math.min(70, s);
}

function computeVolumeScore(text: string): number {
  const len = text.length;
  if (len >= 5000) return 20;
  if (len >= 2000) return 10;
  if (len >= 500) return 5;
  return 0;
}

function computeContextScore(text: string, entities: DetectedEntity[]): number {
  if (entities.length === 0) return 0;

  const lowerText = text.toLowerCase();
  let s = 0;

  for (const entity of entities) {
    const start = Math.max(0, entity.start - 200);
    const end = Math.min(text.length, entity.end + 200);
    const surrounding = lowerText.substring(start, end);

    for (const keyword of LEGAL_KEYWORDS) {
      if (surrounding.includes(keyword)) {
        s += 5;
        break;
      }
    }
  }

  return Math.min(25, s);
}

function computeLegalBoost(text: string): number {
  const lowerText = text.toLowerCase();
  let boost = 0;

  for (const marker of PRIVILEGE_MARKERS) {
    if (lowerText.includes(marker)) boost += 15;
  }

  // Case citations (e.g., "Smith v. Jones")
  const citations = text.match(/\b[A-Z][a-z]+\s+v\.?\s+[A-Z][a-z]+\b/g);
  if (citations) boost += citations.length * 5;

  // Matter/case number patterns
  if (/\b(?:matter|case|docket)\s*(?:#|no\.?|number)?\s*\d/gi.test(text)) {
    boost += 10;
  }

  return Math.min(25, boost);
}

function scoreToLevel(s: number): SensitivityLevel {
  if (s <= 25) return 'low';
  if (s <= 60) return 'medium';
  if (s <= 85) return 'high';
  return 'critical';
}

function generateExplanation(
  _score: number,
  _level: SensitivityLevel,
  entities: DetectedEntity[],
  text: string,
  graphReasons?: string[],
): string {
  if (entities.length === 0) {
    if (text.length > 5000) return 'Large text volume detected but no specific entities identified.';
    return 'No sensitive information detected.';
  }

  const typeGroups = new Map<string, number>();
  for (const entity of entities) {
    typeGroups.set(entity.type, (typeGroups.get(entity.type) || 0) + 1);
  }

  const parts: string[] = [];

  const typeDescriptions = Array.from(typeGroups.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count} ${type.toLowerCase().replace(/_/g, ' ')}${count > 1 ? 's' : ''}`)
    .slice(0, 3);

  parts.push(`Detected ${typeDescriptions.join(', ')}`);

  const lowerText = text.toLowerCase();
  if (PRIVILEGE_MARKERS.some((m) => lowerText.includes(m))) {
    parts.push('Contains privilege markers');
  }

  if (text.length > 2000) {
    parts.push('Large text volume suggests pasted document');
  }

  if (graphReasons && graphReasons.length > 0) {
    parts.push(`Historical pattern: ${graphReasons[0]}`);
  }

  return parts.join('. ') + '.';
}

async function loadWeightOverrides(firmId: string): Promise<Map<string, number>> {
  const cached = weightOverrideCache.get(firmId);
  if (cached && Date.now() - cached.loadedAt < WEIGHT_CACHE_TTL) {
    return cached.data;
  }

  try {
    const rows = await db
      .select({
        entityType: weightOverrides.entityType,
        weightMultiplier: weightOverrides.weightMultiplier,
      })
      .from(weightOverrides)
      .where(eq(weightOverrides.firmId, firmId));

    const data = new Map<string, number>();
    for (const r of rows) {
      data.set(r.entityType, r.weightMultiplier);
    }

    weightOverrideCache.set(firmId, { data, loadedAt: Date.now() });
    return data;
  } catch {
    return new Map();
  }
}
