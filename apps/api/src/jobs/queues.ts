// BullMQ queue definitions — one per background concern.
// All queues share the singleton Redis connection from lib/redis.

import { Queue } from 'bullmq';
import { getRedisClient } from '../lib/redis';

// --- Lazy queue instances (created on first access, not at import time) ---
// This avoids the race condition where module-load-time getRedisClient()
// sets _attempted=true before REDIS_URL is available.

let _auditQueue: Queue | null | undefined;
let _coOccurrencesQueue: Queue | null | undefined;
let _webhooksQueue: Queue | null | undefined;
let _siemQueue: Queue | null | undefined;
let _inferenceQueue: Queue | null | undefined;

function getConnection() {
  return getRedisClient() ?? undefined;
}

function lazyQueue(
  cached: Queue | null | undefined,
  name: string,
  opts: object
): Queue | null {
  if (cached !== undefined) return cached;
  const connection = getConnection();
  return connection ? new Queue(name, { connection, ...opts }) : null;
}

export function getAuditQueue(): Queue | null {
  if (_auditQueue === undefined) {
    _auditQueue = lazyQueue(_auditQueue, 'ig:audit', {
      defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 1000 } },
    });
  }
  return _auditQueue;
}

export function getCoOccurrencesQueue(): Queue | null {
  if (_coOccurrencesQueue === undefined) {
    _coOccurrencesQueue = lazyQueue(_coOccurrencesQueue, 'ig:co-occurrences', {
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    });
  }
  return _coOccurrencesQueue;
}

export function getWebhooksQueue(): Queue | null {
  if (_webhooksQueue === undefined) {
    _webhooksQueue = lazyQueue(_webhooksQueue, 'ig:webhooks', {
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    });
  }
  return _webhooksQueue;
}

export function getSiemQueue(): Queue | null {
  if (_siemQueue === undefined) {
    _siemQueue = lazyQueue(_siemQueue, 'ig:siem', {
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    });
  }
  return _siemQueue;
}

export function getInferenceQueue(): Queue | null {
  if (_inferenceQueue === undefined) {
    _inferenceQueue = lazyQueue(_inferenceQueue, 'ig:inference', {
      defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 5000 } },
    });
  }
  return _inferenceQueue;
}


// --- Type-safe job data interfaces ---

export interface AuditJobData {
  firmId: string;
  userId: string;
  aiToolId: string;
  sessionId?: string;
  promptHash: string;
  promptLength: number;
  sensitivityScore: number;
  sensitivityLevel: 'low' | 'medium' | 'high' | 'critical';
  action: 'pass' | 'warn' | 'block' | 'proxy' | 'override';
  captureMethod: string;
  metadata?: Record<string, unknown>;
  // SIEM event data (dispatched after audit write succeeds)
  siemEvent?: {
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
  // Conversation state update
  conversationUpdate?: {
    sessionId: string;
    entityTypes: string[];
    intent: string;
  };
}

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
