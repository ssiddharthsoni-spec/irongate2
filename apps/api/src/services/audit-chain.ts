// ============================================================================
// Iron Gate — Cryptographic Audit Chain Service
// ============================================================================
// Maintains a tamper-evident hash chain of all events per firm.
// Each event's hash includes the previous event's hash,
// creating a verifiable chain similar to a blockchain.
// ============================================================================

import { db } from '../db/client';
import { events } from '../db/schema';
import { eq, desc, asc, sql } from 'drizzle-orm';
import { sha256, chainHash } from '@iron-gate/crypto';

interface EventData {
  firmId: string;
  userId: string;
  aiToolId: string;
  aiToolUrl?: string;
  promptHash: string;
  promptLength: number;
  sensitivityScore: number;
  sensitivityLevel: 'low' | 'medium' | 'high' | 'critical';
  entities?: unknown[];
  action: 'pass' | 'warn' | 'block' | 'proxy' | 'override';
  overrideReason?: string;
  captureMethod: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChainVerification {
  valid: boolean;
  brokenAt?: number;
  totalEvents: number;
  lastHash?: string;
  verifiedAt: string;
}

/**
 * Append an event to the cryptographic audit chain.
 * Uses advisory lock to prevent race conditions on chain position.
 */
export async function appendEvent(eventData: EventData): Promise<{ id: string; eventHash: string; chainPosition: number }> {
  // Use a deterministic lock ID derived from firmId to serialize chain appends per firm
  const lockId = hashToLockId(eventData.firmId);

  // Execute within a transaction with advisory lock
  const result = await db.transaction(async (tx) => {
    // Acquire advisory lock for this firm's chain
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockId})`);

    // Get the latest chain entry for this firm
    const [latest] = await tx
      .select({
        eventHash: events.eventHash,
        chainPosition: events.chainPosition,
      })
      .from(events)
      .where(eq(events.firmId, eventData.firmId))
      .orderBy(desc(events.chainPosition))
      .limit(1);

    const previousHash = latest?.eventHash ?? null;
    const chainPosition = (latest?.chainPosition ?? 0) + 1;

    // Compute event hash
    const hashData: Record<string, unknown> = {
      firmId: eventData.firmId,
      userId: eventData.userId,
      aiToolId: eventData.aiToolId,
      promptHash: eventData.promptHash,
      promptLength: eventData.promptLength,
      sensitivityScore: eventData.sensitivityScore,
      sensitivityLevel: eventData.sensitivityLevel,
      action: eventData.action,
      captureMethod: eventData.captureMethod,
      chainPosition,
    };

    const hash = await chainHash(hashData, previousHash);

    // Insert event with chain metadata
    const [inserted] = await tx.insert(events).values({
      firmId: eventData.firmId,
      userId: eventData.userId,
      aiToolId: eventData.aiToolId,
      aiToolUrl: eventData.aiToolUrl,
      promptHash: eventData.promptHash,
      promptLength: eventData.promptLength,
      sensitivityScore: eventData.sensitivityScore,
      sensitivityLevel: eventData.sensitivityLevel,
      entities: eventData.entities || [],
      action: eventData.action,
      overrideReason: eventData.overrideReason,
      captureMethod: eventData.captureMethod,
      sessionId: eventData.sessionId,
      metadata: eventData.metadata || {},
      eventHash: hash,
      previousHash,
      chainPosition,
    }).returning({
      id: events.id,
      eventHash: events.eventHash,
      chainPosition: events.chainPosition,
    });

    return inserted;
  });

  return {
    id: result.id,
    eventHash: result.eventHash!,
    chainPosition: result.chainPosition!,
  };
}

/**
 * Verify the integrity of the entire audit chain for a firm.
 */
export async function verifyChain(firmId: string): Promise<ChainVerification> {
  const allEvents = await db
    .select({
      id: events.id,
      eventHash: events.eventHash,
      previousHash: events.previousHash,
      chainPosition: events.chainPosition,
      firmId: events.firmId,
      userId: events.userId,
      aiToolId: events.aiToolId,
      promptHash: events.promptHash,
      promptLength: events.promptLength,
      sensitivityScore: events.sensitivityScore,
      sensitivityLevel: events.sensitivityLevel,
      action: events.action,
      captureMethod: events.captureMethod,
    })
    .from(events)
    .where(eq(events.firmId, firmId))
    .orderBy(asc(events.chainPosition));

  // Skip events without chain data (pre-chain events)
  const chainedEvents = allEvents.filter((e) => e.eventHash != null && e.chainPosition != null);

  if (chainedEvents.length === 0) {
    return { valid: true, totalEvents: 0, verifiedAt: new Date().toISOString() };
  }

  let previousHash: string | null = null;

  for (const event of chainedEvents) {
    // Verify previousHash link
    if (event.previousHash !== previousHash) {
      return {
        valid: false,
        brokenAt: event.chainPosition!,
        totalEvents: chainedEvents.length,
        verifiedAt: new Date().toISOString(),
      };
    }

    // Recompute the hash
    const hashData: Record<string, unknown> = {
      firmId: event.firmId,
      userId: event.userId,
      aiToolId: event.aiToolId,
      promptHash: event.promptHash,
      promptLength: event.promptLength,
      sensitivityScore: event.sensitivityScore,
      sensitivityLevel: event.sensitivityLevel,
      action: event.action,
      captureMethod: event.captureMethod,
      chainPosition: event.chainPosition,
    };

    const expectedHash = await chainHash(hashData, previousHash);

    if (expectedHash !== event.eventHash) {
      return {
        valid: false,
        brokenAt: event.chainPosition!,
        totalEvents: chainedEvents.length,
        verifiedAt: new Date().toISOString(),
      };
    }

    previousHash = event.eventHash;
  }

  return {
    valid: true,
    totalEvents: chainedEvents.length,
    lastHash: previousHash ?? undefined,
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * Get the chain head (latest hash + position) for a firm.
 */
export async function getChainHead(firmId: string) {
  const [latest] = await db
    .select({
      eventHash: events.eventHash,
      chainPosition: events.chainPosition,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(eq(events.firmId, firmId))
    .orderBy(desc(events.chainPosition))
    .limit(1);

  return latest ?? null;
}

/**
 * Convert a firm UUID to a deterministic advisory lock ID (bigint).
 * Uses first 8 bytes of the UUID as a signed 64-bit integer.
 */
function hashToLockId(firmId: string): number {
  const hex = firmId.replace(/-/g, '').slice(0, 15);
  return parseInt(hex, 16);
}
