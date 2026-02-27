// BullMQ workers — process background jobs with controlled concurrency.
// Started on server boot. If Redis is unavailable, workers are not created
// and the system falls back to fire-and-forget via enqueue helpers.

import { Worker, type Job } from 'bullmq';
import { getRedisClient } from '../lib/redis';
import { recordCoOccurrences } from '../services/sensitivity-graph';
import { dispatch as webhookDispatch } from '../services/webhook-dispatcher';
import { forward as siemForward } from '../services/siem-forwarder';
import { analyzePatterns } from '../services/inference-engine';
import { logger } from '../lib/logger';
import type {
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
      await Promise.race([
        analyzePatterns(job.data.firmId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Inference timeout after ${INFERENCE_TIMEOUT_MS}ms`)), INFERENCE_TIMEOUT_MS),
        ),
      ]);
    },
    {
      connection,
      concurrency: 3,
    },
  );
  attachErrorHandlers(inferenceWorker, 'inference');
  workers.push(inferenceWorker);

  logger.info('BullMQ workers started', {
    queues: ['co-occurrences', 'webhooks', 'siem', 'inference'],
  });
}

/**
 * Gracefully close all workers. Waits for in-flight jobs to finish.
 */
export async function closeWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
}
