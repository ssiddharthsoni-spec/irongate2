// ============================================================================
// Iron Gate — Inference Engine Service (★ MOAT)
// ============================================================================
// Auto-discovers new entity types from co-occurrence patterns.
// Runs periodically to find unknown strings that consistently appear
// alongside known sensitive entities in high-risk prompts.
// ============================================================================

import { db } from '../db/client';
import { entityCoOccurrences, inferredEntities } from '../db/schema';
import { eq, and, gte, desc, sql } from 'drizzle-orm';

interface InferenceResult {
  textHash: string;
  inferredType: string;
  confidence: number;
  evidenceCount: number;
}

/**
 * Analyze co-occurrence data to discover potential new entity types.
 * Returns inferred entities that meet confidence and evidence thresholds.
 */
export async function analyzePatterns(firmId: string): Promise<InferenceResult[]> {
  // Find entity hash pairs with high co-occurrence + high context score
  // that might indicate undiscovered sensitive patterns
  const candidates = await db
    .select({
      entityAHash: entityCoOccurrences.entityAHash,
      entityAType: entityCoOccurrences.entityAType,
      entityBHash: entityCoOccurrences.entityBHash,
      entityBType: entityCoOccurrences.entityBType,
      count: entityCoOccurrences.coOccurrenceCount,
      avgScore: entityCoOccurrences.avgContextScore,
    })
    .from(entityCoOccurrences)
    .where(
      and(
        eq(entityCoOccurrences.firmId, firmId),
        gte(entityCoOccurrences.coOccurrenceCount, 10),
        gte(entityCoOccurrences.avgContextScore, 50),
      ),
    )
    .orderBy(desc(entityCoOccurrences.coOccurrenceCount))
    .limit(100);

  const inferred: InferenceResult[] = [];

  for (const candidate of candidates) {
    const inference = inferTypeFromCoOccurrence(
      candidate.entityAType,
      candidate.entityBType,
      candidate.count,
      candidate.avgScore,
    );

    if (inference && inference.confidence >= 0.8) {
      inferred.push({
        textHash: candidate.entityAHash, // The entity being classified
        inferredType: inference.type,
        confidence: inference.confidence,
        evidenceCount: candidate.count,
      });
    }
  }

  // Store inferred entities
  for (const entity of inferred) {
    try {
      await db
        .insert(inferredEntities)
        .values({
          firmId,
          textHash: entity.textHash,
          inferredType: entity.inferredType,
          confidence: entity.confidence,
          evidenceCount: entity.evidenceCount,
          status: 'pending',
          firstSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [inferredEntities.firmId, inferredEntities.textHash],
          set: {
            confidence: entity.confidence,
            evidenceCount: entity.evidenceCount,
          },
        });
    } catch {
      // Ignore duplicates
    }
  }

  // Auto-promote high-confidence inferences
  await autoPromote(firmId);

  return inferred;
}

/**
 * Get pending proposals for admin review.
 */
export async function getProposals(firmId: string) {
  return db
    .select()
    .from(inferredEntities)
    .where(
      and(
        eq(inferredEntities.firmId, firmId),
        eq(inferredEntities.status, 'pending'),
      ),
    )
    .orderBy(desc(inferredEntities.confidence));
}

/**
 * Approve an inferred entity proposal.
 */
export async function approveProposal(id: string, confirmedBy: string) {
  return db
    .update(inferredEntities)
    .set({
      status: 'confirmed',
      confirmedBy,
      promotedAt: new Date(),
    })
    .where(eq(inferredEntities.id, id));
}

/**
 * Reject an inferred entity proposal.
 */
export async function rejectProposal(id: string, confirmedBy: string) {
  return db
    .update(inferredEntities)
    .set({
      status: 'rejected',
      confirmedBy,
    })
    .where(eq(inferredEntities.id, id));
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

function inferTypeFromCoOccurrence(
  typeA: string,
  typeB: string,
  count: number,
  avgScore: number,
): { type: string; confidence: number } | null {
  const pair = [typeA, typeB].sort().join('+');

  // Heuristic rules based on co-occurrence patterns
  const rules: Record<string, { type: string; baseConfidence: number }> = {
    'MONETARY_AMOUNT+PERSON': { type: 'DEAL_CODENAME', baseConfidence: 0.75 },
    'MATTER_NUMBER+ORGANIZATION': { type: 'CLIENT_MATTER_PAIR', baseConfidence: 0.85 },
    'PERSON+PRIVILEGE_MARKER': { type: 'OPPOSING_COUNSEL', baseConfidence: 0.7 },
    'ACCOUNT_NUMBER+PERSON': { type: 'CLIENT_MATTER_PAIR', baseConfidence: 0.7 },
    'MONETARY_AMOUNT+ORGANIZATION': { type: 'DEAL_CODENAME', baseConfidence: 0.7 },
  };

  const rule = rules[pair];
  if (!rule) return null;

  // Boost confidence based on evidence count and average score
  const countBoost = Math.min(0.15, (count - 10) * 0.01);
  const scoreBoost = avgScore > 70 ? 0.1 : 0;
  const confidence = Math.min(0.99, rule.baseConfidence + countBoost + scoreBoost);

  return { type: rule.type, confidence };
}

async function autoPromote(firmId: string): Promise<void> {
  // Auto-promote inferences with >= 0.95 confidence and >= 20 evidence
  await db
    .update(inferredEntities)
    .set({
      status: 'confirmed',
      promotedAt: new Date(),
    })
    .where(
      and(
        eq(inferredEntities.firmId, firmId),
        eq(inferredEntities.status, 'pending'),
        gte(inferredEntities.confidence, 0.95),
        gte(inferredEntities.evidenceCount, 20),
      ),
    );
}
