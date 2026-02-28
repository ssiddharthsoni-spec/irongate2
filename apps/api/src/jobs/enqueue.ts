// Type-safe enqueue helpers with fire-and-forget fallback.
// When Redis/BullMQ is unavailable, falls back to the existing behavior
// so the system degrades gracefully instead of breaking.

import {
  getCoOccurrencesQueue,
  getWebhooksQueue,
  getSiemQueue,
  getInferenceQueue,
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
