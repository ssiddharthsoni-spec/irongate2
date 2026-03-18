// Type-safe enqueue helpers with fire-and-forget fallback.
// When Redis/BullMQ is unavailable, falls back to the existing behavior
// so the system degrades gracefully instead of breaking.

import {
  getAuditQueue,
  getCoOccurrencesQueue,
  getWebhooksQueue,
  getSiemQueue,
  getInferenceQueue,
  type AuditJobData,
  type CoOccurrenceJobData,
  type WebhookJobData,
  type SIEMJobData,
  type InferenceJobData,
} from './queues';
import { recordCoOccurrences } from '../services/sensitivity-graph';
import { dispatch as webhookDispatch } from '../services/webhook-dispatcher';
import { forward as siemForward } from '../services/siem-forwarder';
import { analyzePatterns } from '../services/inference-engine';
import { logger } from '../lib/logger';

/**
 * Enqueue an audit trail write as a durable BullMQ job.
 * If Redis is unavailable, falls back to direct appendEvent (fire-and-forget).
 * The job processor handles: audit chain write → SIEM dispatch → conversation state update.
 */
export async function enqueueAudit(data: AuditJobData): Promise<void> {
  const queue = getAuditQueue();
  if (queue) {
    await queue.add('audit-write', data, {
      // Audit jobs should not be deduplicated — every event is unique
      removeOnComplete: 1000,
      removeOnFail: 5000, // Keep failed jobs for investigation
    });
  } else {
    // Fallback: direct write (fire-and-forget, same as old behavior)
    // This path only fires if Redis is completely down
    const { appendEvent } = await import('../services/audit-chain');
    appendEvent({
      firmId: data.firmId,
      userId: data.userId,
      aiToolId: data.aiToolId,
      sessionId: data.sessionId,
      promptHash: data.promptHash,
      promptLength: data.promptLength,
      sensitivityScore: data.sensitivityScore,
      sensitivityLevel: data.sensitivityLevel,
      action: data.action,
      captureMethod: data.captureMethod,
      metadata: data.metadata,
    }).catch((err) =>
      logger.error('AUDIT WRITE FAILED (no Redis, no fallback)', {
        firmId: data.firmId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

export async function enqueueCoOccurrences(data: CoOccurrenceJobData): Promise<void> {
  const queue = getCoOccurrencesQueue();
  if (queue) {
    await queue.add('record', data);
  } else {
    recordCoOccurrences(data.firmId, data.entities as any, data.sensitivityScore).catch((err) =>
      logger.warn('co-occurrence fallback failed', { error: err instanceof Error ? err.message : String(err) }),
    );
  }
}

export async function enqueueWebhook(data: WebhookJobData): Promise<void> {
  const queue = getWebhooksQueue();
  if (queue) {
    await queue.add('dispatch', data);
  } else {
    webhookDispatch(data.firmId, data.eventType, data.payload).catch((err) =>
      logger.warn('webhook fallback failed', { error: err instanceof Error ? err.message : String(err) }),
    );
  }
}

export async function enqueueSIEM(data: SIEMJobData): Promise<void> {
  const queue = getSiemQueue();
  if (queue) {
    await queue.add('forward', data);
  } else {
    siemForward(data.firmId, data.event).catch((err) =>
      logger.warn('siem fallback failed', { error: err instanceof Error ? err.message : String(err) }),
    );
  }
}

export async function enqueueInference(data: InferenceJobData): Promise<void> {
  const queue = getInferenceQueue();
  if (queue) {
    // Use firmId as jobId — BullMQ deduplicates so concurrent triggers don't stack
    await queue.add('analyze', data, { jobId: `inference:${data.firmId}` });
  } else {
    analyzePatterns(data.firmId).catch((err) =>
      logger.warn('inference fallback failed', { error: err instanceof Error ? err.message : String(err) }),
    );
  }
}
