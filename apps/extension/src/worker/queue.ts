/**
 * Offline-resilient event queue.
 * Accumulates events, batches them, and handles offline scenarios.
 *
 * Features:
 * - Batches events (2-second window)
 * - Offline queue stored in chrome.storage.local
 * - Flushes when back online
 * - Max queue size: 1000 events (drops oldest if exceeded)
 */

import { apiRequest } from './api-client';
import { encrypt, decrypt, deriveKey } from '@iron-gate/crypto';

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
  private encryptionKey: CryptoKey | null = null;

  constructor() {
    // Restore queued events from storage on startup
    this.initEncryption().then(() => this.restoreFromStorage());

    // Monitor online/offline status
    // In service worker, we check via fetch
    this.checkOnlineStatus();
  }

  /**
   * Initialize encryption key for queue storage.
   * Uses a device-local key derived from a fixed salt (queue data is ephemeral).
   */
  private async initEncryption(): Promise<void> {
    try {
      // Derive a local encryption key for the queue
      // This uses a static salt — the queue is ephemeral (events are deleted after sending)
      const salt = new TextEncoder().encode('iron-gate-queue0');
      this.encryptionKey = await deriveKey('iron-gate-queue-key', salt);
    } catch {
      console.warn('[Iron Gate Queue] Encryption init failed, queue will be unencrypted');
    }
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
      if (this.encryptionKey) {
        // Encrypt the entire event array as a single AES-256-GCM ciphertext
        const plaintext = JSON.stringify(this.pendingEvents);
        const ciphertext = await encrypt(plaintext, this.encryptionKey);
        await chrome.storage.local.set({ [STORAGE_KEY]: ciphertext });
      } else {
        await chrome.storage.local.set({ [STORAGE_KEY]: this.pendingEvents });
      }
    } catch (error) {
      console.warn('[Iron Gate Queue] Failed to persist to storage:', error);
    }
  }

  private async restoreFromStorage(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const stored = result[STORAGE_KEY];

      if (!stored) return;

      let events: QueuedEvent[];

      if (typeof stored === 'string' && this.encryptionKey) {
        // Encrypted data — decrypt first
        try {
          const decrypted = await decrypt(stored, this.encryptionKey);
          events = JSON.parse(decrypted);
        } catch {
          console.warn('[Iron Gate Queue] Decryption failed, discarding stored events');
          return;
        }
      } else if (Array.isArray(stored)) {
        // Legacy plaintext data
        events = stored;
      } else {
        return;
      }

      if (events.length > 0) {
        this.pendingEvents = events;
        console.log(`[Iron Gate Queue] Restored ${events.length} events from storage (encrypted: ${typeof stored === 'string'})`);
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
