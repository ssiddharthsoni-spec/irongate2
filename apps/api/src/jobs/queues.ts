// BullMQ queue definitions — one per background concern.
// All queues share the singleton Redis connection from lib/redis.

import { Queue } from 'bullmq';
import { getRedisClient } from '../lib/redis';

const connection = getRedisClient() ?? undefined;

// --- Queue instances (null-safe: only created if Redis is available) ---

export const coOccurrencesQueue = connection
  ? new Queue('ig:co-occurrences', {
      connection,
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    })
  : null;

export const webhooksQueue = connection
  ? new Queue('ig:webhooks', {
      connection,
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    })
  : null;

export const siemQueue = connection
  ? new Queue('ig:siem', {
      connection,
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    })
  : null;

export const inferenceQueue = connection
  ? new Queue('ig:inference', {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
      },
    })
  : null;

// --- Type-safe job data interfaces ---

export interface CoOccurrenceJobData {
  firmId: string;
  entities: unknown[];
  sensitivityScore: number;
}

export interface WebhookJobData {
  firmId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface SIEMJobData {
  firmId: string;
  event: {
    eventId: string;
    firmId: string;
    aiToolId: string;
    sensitivityScore: number;
    sensitivityLevel: string;
    action: string;
    entityCount: number;
    captureMethod: string;
    timestamp: string;
  };
}

export interface InferenceJobData {
  firmId: string;
}
