/**
 * Offline-resilient event queue.
 * Accumulates events, batches them, and handles offline scenarios.
 *
 * Features:
 * - Batches events (2-second window)
 * - Offline queue stored in chrome.storage.local
 * - Flushes when back online
 * - Max queue size: 1000 events (drops oldest if exceeded)
 *
 * Queue data is ephemeral (flushed within seconds). Events contain only
 * hashed entity values and metadata — no raw PII is stored in the queue.
 */

import { apiRequest } from './api-client';

// Debug logging — silent in production
let _IG_DEBUG = false;
try { chrome.storage.local.get('ironGateDebug', (r) => { _IG_DEBUG = !!r.ironGateDebug; }); } catch {}
function igLog(...args: any[]) { if (_IG_DEBUG) console.log('[Iron Gate Queue]', ...args); }

interface QueuedEvent {
  id: string;
  data: any;
  timestamp: number;
  retryCount: number;
}

const BATCH_INTERVAL = 2000; // 2 seconds
const MAX_BATCH_SIZE = 100;
const MAX_QUEUE_SIZE = 1000;
const MAX_RETRIES = 5;
const STORAGE_KEY = 'iron_gate_event_queue';

class EventQueue {
  private pendingEvents: QueuedEvent[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushing = false;
  private isOnline = true;
  private noApiKey = false; // true → stop retrying until key is configured

  constructor() {
    // Restore queued events from storage on startup
    this.restoreFromStorage();

    // Monitor online/offline status
    this.checkOnlineStatus();

    // Watch for API key being set — resume queue when it arrives
    try {
      chrome.storage.onChanged.addListener((changes) => {
        if (changes.ironGateApiKey_enc?.newValue || changes.ironGateApiKey?.newValue) {
          this.noApiKey = false;
          if (this.pendingEvents.length > 0) this.scheduleBatch();
        }
      });
    } catch {}
  }

  /**
   * Add an event to the queue.
   * Will be batched and sent after BATCH_INTERVAL.
   */
  async enqueue(eventData: any): Promise<void> {
    const event: QueuedEvent = {
      id: crypto.randomUUID(),
      data: eventData,
      timestamp: Date.now(),
      retryCount: 0,
    };

    this.pendingEvents.push(event);

    // Enforce max queue size
    if (this.pendingEvents.length > MAX_QUEUE_SIZE) {
      const dropped = this.pendingEvents.length - MAX_QUEUE_SIZE;
      this.pendingEvents = this.pendingEvents.slice(dropped);
      igLog(`Dropped ${dropped} oldest events (queue full)`);
    }

    // Persist to storage for offline resilience
    await this.persistToStorage();

    // Schedule batch send
    this.scheduleBatch();
  }

  /**
   * Immediately flush all pending events.
   */
  async flush(): Promise<void> {
    if (this.isFlushing || this.pendingEvents.length === 0) return;

    // Don't bother sending if no API key — events stay queued until one is configured
    if (this.noApiKey) return;

    this.isFlushing = true;

    try {
      // Check if we're online
      if (!this.isOnline) {
        igLog('Offline, events will be sent when connection is restored');
        return;
      }

      while (this.pendingEvents.length > 0) {
        // Take a batch
        const batch = this.pendingEvents.slice(0, MAX_BATCH_SIZE);
        const batchId = crypto.randomUUID();

        try {
          igLog('Sending batch of', batch.length, 'events, batchId:', batchId);
          const result = await apiRequest({
            method: 'POST',
            path: '/events/batch',
            body: {
              batchId,
              events: batch.map((e) => e.data),
            },
          });

          // Remove sent events
          this.pendingEvents = this.pendingEvents.slice(batch.length);
          await this.persistToStorage();

          igLog('Batch sent successfully —', batch.length, 'events, IDs:', (result as any)?.eventIds);
        } catch (error: any) {
          // No API key → log once quietly, pause queue until key is set
          if (error?.status === 401 || error?.message?.includes('No API key')) {
            if (!this.noApiKey) {
              igLog('No API key configured — events are queued locally');
              this.noApiKey = true;
            }
            break;
          }

          igLog('Batch send failed:', error);

          // Increment retry counts
          for (const event of batch) {
            event.retryCount++;
          }

          // Drop events that have exceeded max retries
          this.pendingEvents = this.pendingEvents.filter(e => e.retryCount <= MAX_RETRIES);

          break;
        }
      }
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Get the current queue size.
   */
  getSize(): number {
    return this.pendingEvents.length;
  }

  private scheduleBatch() {
    if (this.batchTimer) return; // Already scheduled

    this.batchTimer = setTimeout(async () => {
      this.batchTimer = null;
      await this.flush();
    }, BATCH_INTERVAL);
  }

  private async persistToStorage(): Promise<void> {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: this.pendingEvents });
    } catch (error) {
      igLog('Failed to persist to storage:', error);
    }
  }

  private async restoreFromStorage(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const stored = result[STORAGE_KEY];

      if (!stored || !Array.isArray(stored)) return;

      if (stored.length > 0) {
        this.pendingEvents = stored;
        igLog('Restored', stored.length, 'events from storage');
        this.scheduleBatch();
      }
    } catch (error) {
      igLog('Failed to restore from storage:', error);
    }
  }

  private async checkOnlineStatus(): Promise<void> {
    try {
      // Load configured API URL, strip /v1 suffix, append /health
      let healthUrl = 'https://irongate-api.onrender.com/health';
      try {
        const stored = await chrome.storage.local.get('ironGateApiUrl');
        if (stored.ironGateApiUrl) {
          healthUrl = stored.ironGateApiUrl.replace(/\/v1\/?$/, '') + '/health';
        }
      } catch {}
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      this.isOnline = response.ok;
    } catch {
      this.isOnline = false;
    }

    // If we just came back online, flush
    if (this.isOnline && this.pendingEvents.length > 0) {
      this.scheduleBatch();
    }

    // Only re-check if there are pending events (avoid keeping service worker alive)
    if (this.pendingEvents.length > 0) {
      setTimeout(() => this.checkOnlineStatus(), 30_000);
    }
  }
}

// Singleton instance
export const eventQueue = new EventQueue();
