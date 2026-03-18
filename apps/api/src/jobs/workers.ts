// BullMQ workers — process background jobs with controlled concurrency.
// Started on server boot. If Redis is unavailable, workers are not created
// and the system falls back to fire-and-forget via enqueue helpers.

import { Worker, type Job } from 'bullmq';
import { getRedisClient } from '../lib/redis';
import { appendEvent } from '../services/audit-chain';
import { forward as siemForward } from '../services/siem-forwarder';
import { recordCoOccurrences } from '../services/sensitivity-graph';
import { dispatch as webhookDispatch } from '../services/webhook-dispatcher';
import { analyzePatterns } from '../services/inference-engine';
import { logger } from '../lib/logger';
import { db } from '../db/client';
import { conversationState } from '../db/schema';
import { sql } from 'drizzle-orm';
import type {
  AuditJobData,
  CoOccurrenceJobData,
  WebhookJobData,
  SIEMJobData,
  InferenceJobData,
} from './queues';

const workers: Worker[] = [];

function attachErrorHandlers(worker: Worker, queueName: string): void {
  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error(`Worker job failed: ${queueName}`, {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      data: job?.data,
      error: err.message,
    });
  });

  worker.on('error', (err: Error) => {
    logger.error(`Worker error: ${queueName}`, { error: err.message });
  });
}

export function startWorkers(): void {
  const connection = getRedisClient() ?? undefined;

  if (!connection) {
    logger.warn('Redis not available — background jobs will use fire-and-forget fallback');
    return;
  }

  // ── Audit worker: guaranteed audit chain writes + SIEM + conversation state ──
  const auditWorker = new Worker<AuditJobData>(
    'ig:audit',
    async (job) => {
      const data = job.data;

      // 1. Write to cryptographic audit chain (retries on chain position conflict)
      await appendEvent({
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
      });

      // 2. SIEM dispatch (after audit write succeeds)
      if (data.siemEvent) {
        await siemForward(data.firmId, data.siemEvent).catch((err) =>
          logger.warn('SIEM forward failed in audit job', {
            firmId: data.firmId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }

      // 3. Conversation state update
      if (data.conversationUpdate?.sessionId) {
        const cu = data.conversationUpdate;
        await db.insert(conversationState).values({
          sessionId: cu.sessionId,
          firmId: data.firmId,
          turnCount: 1,
          cumulativeScore: data.sensitivityScore,
          peakScore: data.sensitivityScore,
          entityTypesSeen: cu.entityTypes,
          lastIntent: cu.intent,
          lastActivity: new Date(),
        }).onConflictDoUpdate({
          target: [conversationState.sessionId, conversationState.firmId],
          set: {
            turnCount: sql`${conversationState.turnCount} + 1`,
            cumulativeScore: sql`${conversationState.cumulativeScore} + ${data.sensitivityScore}`,
            peakScore: sql`GREATEST(${conversationState.peakScore}, ${data.sensitivityScore})`,
            entityTypesSeen: sql`(
              SELECT jsonb_agg(DISTINCT val)
              FROM jsonb_array_elements_text(
                COALESCE(${conversationState.entityTypesSeen}::jsonb, '[]'::jsonb) ||
                ${JSON.stringify(cu.entityTypes)}::jsonb
              ) AS val
            )`,
            lastIntent: cu.intent,
            lastActivity: new Date(),
          },
        }).catch((err) =>
          logger.warn('Conversation state update failed in audit job', {
            sessionId: cu.sessionId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    },
    { connection, concurrency: 10 },
  );
  attachErrorHandlers(auditWorker, 'audit');
  workers.push(auditWorker);

  const coOccurrenceWorker = new Worker<CoOccurrenceJobData>(
    'ig:co-occurrences',
    async (job) => {
      await recordCoOccurrences(job.data.firmId, job.data.entities as any, job.data.sensitivityScore);
    },
    { connection, concurrency: 5 },
  );
  attachErrorHandlers(coOccurrenceWorker, 'co-occurrences');
  workers.push(coOccurrenceWorker);

  const webhookWorker = new Worker<WebhookJobData>(
    'ig:webhooks',
    async (job) => {
      await webhookDispatch(job.data.firmId, job.data.eventType, job.data.payload);
    },
    { connection, concurrency: 10 },
  );
  attachErrorHandlers(webhookWorker, 'webhooks');
  workers.push(webhookWorker);

  const siemWorker = new Worker<SIEMJobData>(
    'ig:siem',
    async (job) => {
      await siemForward(job.data.firmId, job.data.event);
    },
    { connection, concurrency: 5 },
  );
  attachErrorHandlers(siemWorker, 'siem');
  workers.push(siemWorker);

  const INFERENCE_TIMEOUT_MS = 5 * 60_000; // 5 minute timeout
  const inferenceWorker = new Worker<InferenceJobData>(
    'ig:inference',
    async (job) => {
      // Enforce a timeout so one firm's heavy analysis can't block the queue
      try {
        await Promise.race([
          analyzePatterns(job.data.firmId),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Inference timeout after ${INFERENCE_TIMEOUT_MS}ms`)), INFERENCE_TIMEOUT_MS),
          ),
        ]);
      } catch (err) {
        if (err instanceof Error && err.message.includes('timeout')) {
          logger.warn('Inference job timed out', { firmId: job.data.firmId, timeoutMs: INFERENCE_TIMEOUT_MS });
        } else {
          throw err; // Re-throw non-timeout errors for BullMQ retry
        }
      }
    },
    {
      connection,
      concurrency: 3,
    },
  );
  attachErrorHandlers(inferenceWorker, 'inference');
  workers.push(inferenceWorker);

  logger.info('BullMQ workers started', {
    queues: ['audit', 'co-occurrences', 'webhooks', 'siem', 'inference'],
  });
}

/**
 * Gracefully close all workers. Waits for in-flight jobs to finish.
 */
export async function closeWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
}
