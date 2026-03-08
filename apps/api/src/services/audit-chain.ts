// ============================================================================
// Iron Gate — Cryptographic Audit Chain Service
// ============================================================================
// Maintains a tamper-evident hash chain of all events per firm.
// Each event's hash includes the previous event's hash,
// creating a verifiable chain similar to a blockchain.
//
// Uses optimistic concurrency control (OCC) instead of advisory locks.
// A UNIQUE constraint on (firmId, chainPosition) ensures exactly one
// writer wins each position. Losers retry with the updated chain head.
// ============================================================================

import { db } from '../db/client';
import { events } from '../db/schema';
import { eq, desc, asc } from 'drizzle-orm';
import { chainHash, hmacSign } from '@iron-gate/crypto';
import { getSigningKey } from './signing-key';
import { isUniqueViolation } from '../lib/pg-errors';
import { logger } from '../lib/logger';

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

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Append an event to the cryptographic audit chain.
 * Uses optimistic concurrency control — retries on chain position conflict.
 */
export async function appendEvent(eventData: EventData): Promise<{ id: string; eventHash: string; chainPosition: number; serverSignature: string }> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // 1. Read the latest chain head (outside any transaction)
    const [latest] = await db
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

    // 2. Compute hash + HMAC signature (CPU work, safe to redo on retry)
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

    const signingKey = await getSigningKey();
    const signedAt = new Date();
    const signatureMessage = `v1:${hash}:${signedAt.toISOString()}`;
    const serverSignature = await hmacSign(signatureMessage, signingKey);

    // 3. Attempt INSERT (UNIQUE constraint on firmId+chainPosition catches conflicts)
    try {
      const [inserted] = await db.insert(events).values({
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
        serverSignature,
        signedAt,
        signatureVersion: 1,
      }).returning({
        id: events.id,
        eventHash: events.eventHash,
        chainPosition: events.chainPosition,
        serverSignature: events.serverSignature,
      });

      if (!inserted || !inserted.eventHash || inserted.chainPosition == null || !inserted.serverSignature) {
        throw new Error(`Audit chain insert returned incomplete data for firm ${eventData.firmId}`);
      }

      return {
        id: inserted.id,
        eventHash: inserted.eventHash,
        chainPosition: inserted.chainPosition,
        serverSignature: inserted.serverSignature,
      };
    } catch (err) {
      if (isUniqueViolation(err) && attempt < MAX_RETRIES - 1) {
        // Another writer claimed this position — retry with fresh chain head
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * BASE_DELAY_MS;
        logger.warn('Chain position conflict, retrying', {
          firmId: eventData.firmId,
          chainPosition,
          attempt: attempt + 1,
          delayMs: Math.round(delay),
        });
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }

  const err = new Error(`Failed to append event after ${MAX_RETRIES} retries (firmId: ${eventData.firmId})`);
  (err as any).retryExhausted = true;
  throw err;
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
