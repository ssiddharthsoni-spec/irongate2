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
 * Queue data is ephemeral (flushed within seconds) so plain JSON storage
 * in chrome.storage.local is sufficient — no at-rest encryption needed.
 */

import { apiRequest } from './api-client';

interface QueuedEvent {
  id: string;
  data: any;
  timestamp: number;
  retryCount: number;
}

const BATCH_INTERVAL = 2000; // 2 seconds
const MAX_BATCH_SIZE = 100;
const MAX_QUEUE_SIZE = 1000;
const STORAGE_KEY = 'iron_gate_event_queue';

class EventQueue {
  private pendingEvents: QueuedEvent[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushing = false;
  private isOnline = true;

  constructor() {
    // Restore queued events from storage on startup
    this.restoreFromStorage();

    // Monitor online/offline status
    this.checkOnlineStatus();
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
      console.warn(`[Iron Gate Queue] Dropped ${dropped} oldest events (queue full)`);
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

    this.isFlushing = true;

    try {
      // Check if we're online
      if (!this.isOnline) {
        console.log('[Iron Gate Queue] Offline, events will be sent when connection is restored');
        return;
      }

      while (this.pendingEvents.length > 0) {
        // Take a batch
        const batch = this.pendingEvents.slice(0, MAX_BATCH_SIZE);
        const batchId = crypto.randomUUID();

        try {
          await apiRequest({
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

          console.log(`[Iron Gate Queue] Sent batch of ${batch.length} events`);
        } catch (error) {
          console.error('[Iron Gate Queue] Batch send failed:', error);

          // Increment retry counts
          for (const event of batch) {
            event.retryCount++;
          }

          // If we've retried too many times, the events will be dropped on next overflow
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
      console.warn('[Iron Gate Queue] Failed to persist to storage:', error);
    }
  }

  private async restoreFromStorage(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const stored = result[STORAGE_KEY];

      if (!stored || !Array.isArray(stored)) return;

      if (stored.length > 0) {
        this.pendingEvents = stored;
        console.log(`[Iron Gate Queue] Restored ${stored.length} events from storage`);
        this.scheduleBatch();
      }
    } catch (error) {
      console.warn('[Iron Gate Queue] Failed to restore from storage:', error);
    }
  }

  private async checkOnlineStatus(): Promise<void> {
    try {
      const response = await fetch('https://irongate-api.onrender.com/health', {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      this.isOnline = response.ok;
    } catch {
      this.isOnline = false;
    }

    // Re-check every 30 seconds
    setTimeout(() => this.checkOnlineStatus(), 30_000);

    // If we just came back online, flush
    if (this.isOnline && this.pendingEvents.length > 0) {
      this.scheduleBatch();
    }
  }
}

// Singleton instance
export const eventQueue = new EventQueue();
