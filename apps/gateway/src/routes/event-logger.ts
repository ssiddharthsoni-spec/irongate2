/**
 * Event logger for the gateway.
 * Logs all gateway requests to the events table (fire-and-forget).
 */

import { db } from '../../../api/src/db/client';
import { events, users } from '../../../api/src/db/schema';
import { eq } from 'drizzle-orm';
import type { DetectedEntity } from '@iron-gate/types';

interface LogEventParams {
  firmId: string;
  aiToolId: string;
  promptHash: string;
  promptLength: number;
  sensitivityScore: number;
  sensitivityLevel: 'low' | 'medium' | 'high' | 'critical';
  entities: DetectedEntity[];
  action: 'pass' | 'proxy' | 'block';
  captureMethod: string;
  sessionId: string;
  metadata?: Record<string, unknown>;
}

// Cache the first user ID for the firm to avoid repeated lookups
let cachedUserId: string | null = null;

async function resolveUserId(firmId: string): Promise<string> {
  if (cachedUserId) return cachedUserId;
  try {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.firmId, firmId)).limit(1);
    if (user) {
      cachedUserId = user.id;
      return user.id;
    }
  } catch {}
  return firmId; // Fallback: use firmId as userId placeholder
}

/**
 * Log a gateway event. Fire-and-forget — never blocks the request.
 */
export function logEvent(params: LogEventParams): void {
  resolveUserId(params.firmId).then((userId) => {
    db.insert(events)
      .values({
        firmId: params.firmId,
        userId,
      aiToolId: params.aiToolId,
      promptHash: params.promptHash,
      promptLength: params.promptLength,
      sensitivityScore: params.sensitivityScore,
      sensitivityLevel: params.sensitivityLevel,
      entities: params.entities.map((e) => ({
        type: e.type,
        text: '[redacted]',
        confidence: e.confidence,
        source: e.source,
      })),
      action: params.action,
      captureMethod: params.captureMethod,
      sessionId: params.sessionId,
      metadata: params.metadata || {},
    })
    .then(() => {
      console.log(`[Gateway] Event logged: ${params.aiToolId} action=${params.action} score=${params.sensitivityScore}`);
    })
    .catch((err) => {
      console.error('[Gateway] Failed to log event:', err);
    });
  });
}
