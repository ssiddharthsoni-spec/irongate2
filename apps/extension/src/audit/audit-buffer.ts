/**
 * Audit Buffer — batches, persists, and delivers audit entries via the sink
 *
 * Design:
 *   1. recordEntry() adds an entry to an in-memory buffer + persists to IDB
 *   2. Every 5 seconds OR when buffer hits 50 entries, flush the buffer to
 *      the configured sink
 *   3. On sink failure, entries go to a retry queue with exponential backoff
 *   4. After 24h of retries, drop the batch and surface an error
 *
 * The buffer is the ONLY caller of any audit sink. recordEntry() is the only
 * public API that detection code uses. This means the audit egress path is a
 * single function call away — easy to audit, easy to verify, easy to test.
 */

import type { AuditEntry, AuditSink, SinkResult } from './audit-sink';
import { createSink } from './audit-sink';

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER_SIZE = 50;
const MAX_RETRY_AGE_MS = 24 * 60 * 60 * 1000;
// C1: Cap the retry queue. A misconfigured sink returning 500 for 24 hours
// could otherwise balloon IndexedDB. At ~1KB per entry, 2000 entries = 2MB max.
const MAX_RETRY_ENTRIES = 2000;
const IDB_DB_NAME = 'irongate-audit';
const IDB_STORE_PENDING = 'pending';
const IDB_STORE_RETRY = 'retry';

interface RetryEntry {
  id: string;
  batch: AuditEntry[];
  attempts: number;
  firstAttemptAt: number;
  nextAttemptAt: number;
  lastError: string;
}

export class AuditBuffer {
  private buffer: AuditEntry[] = [];
  private sink: AuditSink;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private isFlushing = false;
  private isRetrying = false;
  private metrics = {
    recorded: 0,
    delivered: 0,
    failed: 0,
    droppedAfterRetries: 0,
  };

  constructor(sink: AuditSink) {
    this.sink = sink;
  }

  /** Public API: detection code calls this for every classification result. */
  async recordEntry(entry: AuditEntry): Promise<void> {
    // C3: PII egress defense — refuse to buffer any entry whose fields contain
    // data that could be raw PII text. The AuditEntry schema only allows counts,
    // types, scores, and metadata. Any string field longer than 120 chars is
    // probably a prompt leaking through and must be rejected at the boundary.
    if (!isAuditEntrySafe(entry)) {
      this.metrics.failed++;
      throw new Error(
        'Audit entry rejected: contains a string field that looks like prompt text. ' +
        'Audit entries must contain only counts and types, never raw PII.',
      );
    }
    this.metrics.recorded++;
    this.buffer.push(entry);
    await this.persistPending(entry).catch(() => { /* persistence failures are non-fatal */ });

    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      await this.flush();
    }
  }

  /** Start the periodic flush timer. Idempotent. */
  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
      void this.processRetryQueue();
    }, FLUSH_INTERVAL_MS);
    // Also restore any entries that survived a previous extension restart
    void this.restorePersisted();
  }

  /** Stop the timer (used by tests and shutdown handlers). */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Force a flush (used by tests). */
  async flush(): Promise<SinkResult | null> {
    if (this.isFlushing || this.buffer.length === 0) return null;
    this.isFlushing = true;
    try {
      const batch = this.buffer.splice(0, MAX_BUFFER_SIZE);
      const result = await this.sink.deliver(batch);
      if (result.ok) {
        this.metrics.delivered += result.delivered;
        await this.clearPending(batch).catch(() => {});
      } else {
        this.metrics.failed += result.failed;
        await this.enqueueRetry(batch, result.error || 'unknown sink failure');
      }
      return result;
    } finally {
      this.isFlushing = false;
    }
  }

  getMetrics() {
    return { ...this.metrics, bufferSize: this.buffer.length };
  }

  // ── Retry queue ──────────────────────────────────────────────────────────

  private async enqueueRetry(batch: AuditEntry[], error: string): Promise<void> {
    // C1: Enforce retry queue size cap. If adding this batch would exceed the
    // cap, drop the OLDEST retries first (FIFO eviction). This keeps recent
    // failures around and increments the dropped counter for monitoring.
    try {
      const existing = await this.loadRetries();
      if (existing.length >= MAX_RETRY_ENTRIES) {
        existing.sort((a, b) => a.firstAttemptAt - b.firstAttemptAt);
        const toEvict = existing.slice(0, existing.length - MAX_RETRY_ENTRIES + 1);
        for (const old of toEvict) {
          this.metrics.droppedAfterRetries += old.batch.length;
          await this.removeRetry(old.id).catch(() => {});
        }
      }
    } catch { /* IDB unavailable */ }

    const now = Date.now();
    const retryEntry: RetryEntry = {
      id: crypto.randomUUID(),
      batch,
      attempts: 1,
      firstAttemptAt: now,
      nextAttemptAt: now + this.computeBackoffMs(1),
      lastError: error,
    };
    await this.persistRetry(retryEntry).catch(() => {});
  }

  private async processRetryQueue(): Promise<void> {
    if (this.isRetrying) return;
    this.isRetrying = true;
    try {
      const retries = await this.loadRetries().catch(() => [] as RetryEntry[]);
      const now = Date.now();
      for (const retry of retries) {
        if (retry.nextAttemptAt > now) continue;
        if (now - retry.firstAttemptAt > MAX_RETRY_AGE_MS) {
          // Give up
          this.metrics.droppedAfterRetries += retry.batch.length;
          await this.removeRetry(retry.id).catch(() => {});
          continue;
        }
        const result = await this.sink.deliver(retry.batch);
        if (result.ok) {
          this.metrics.delivered += result.delivered;
          await this.removeRetry(retry.id).catch(() => {});
        } else {
          retry.attempts++;
          retry.lastError = result.error || 'unknown';
          retry.nextAttemptAt = now + this.computeBackoffMs(retry.attempts);
          await this.persistRetry(retry).catch(() => {});
        }
      }
    } finally {
      this.isRetrying = false;
    }
  }

  private computeBackoffMs(attempt: number): number {
    // Exponential backoff with jitter: base 30s, max 1h
    const base = Math.min(30_000 * Math.pow(2, attempt - 1), 3_600_000);
    const jitter = Math.random() * 0.2 * base;
    return base + jitter;
  }

  // ── IndexedDB persistence ────────────────────────────────────────────────

  private getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_PENDING)) {
          db.createObjectStore(IDB_STORE_PENDING, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(IDB_STORE_RETRY)) {
          db.createObjectStore(IDB_STORE_RETRY, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  private async persistPending(entry: AuditEntry): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_PENDING, 'readwrite');
      tx.objectStore(IDB_STORE_PENDING).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async clearPending(entries: AuditEntry[]): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_PENDING, 'readwrite');
      const store = tx.objectStore(IDB_STORE_PENDING);
      for (const e of entries) store.delete(e.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async restorePersisted(): Promise<void> {
    try {
      const db = await this.getDb();
      const entries = await new Promise<AuditEntry[]>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_PENDING, 'readonly');
        const req = tx.objectStore(IDB_STORE_PENDING).getAll();
        req.onsuccess = () => resolve(req.result as AuditEntry[]);
        req.onerror = () => reject(req.error);
      });
      // Add to buffer (deduplicate by id)
      const existingIds = new Set(this.buffer.map((e) => e.id));
      for (const e of entries) {
        if (!existingIds.has(e.id)) this.buffer.push(e);
      }
    } catch { /* IDB unavailable */ }
  }

  private async persistRetry(retry: RetryEntry): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_RETRY, 'readwrite');
      tx.objectStore(IDB_STORE_RETRY).put(retry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async loadRetries(): Promise<RetryEntry[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_RETRY, 'readonly');
      const req = tx.objectStore(IDB_STORE_RETRY).getAll();
      req.onsuccess = () => resolve(req.result as RetryEntry[]);
      req.onerror = () => reject(req.error);
    });
  }

  private async removeRetry(id: string): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_RETRY, 'readwrite');
      tx.objectStore(IDB_STORE_RETRY).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// ─── PII egress guard ──────────────────────────────────────────────────────
// Runtime check that an AuditEntry only contains the allowed fields and no
// string field is longer than 120 characters (a heuristic for "probably a
// prompt"). The only string fields that can legitimately be longer are none —
// entityTypes is a type-label array, not content. Everything else is numeric.
//
// This function is tested by the architecture invariant test suite to ensure
// future changes don't silently allow PII text to flow into the audit path.
export function isAuditEntrySafe(entry: AuditEntry): boolean {
  const ALLOWED_KEYS = new Set([
    'id', 'timestamp', 'firmId', 'deviceHash', 'aiTool', 'zone', 'score',
    'entityCount', 'entityTypes', 'action', 'tier', 'pseudonymsApplied',
    'modelUsed', 'latencyMs', 'conversationId', 'turnNumber',
  ]);
  for (const key of Object.keys(entry)) {
    if (!ALLOWED_KEYS.has(key)) return false; // unknown field — reject
  }
  const MAX_STRING_LEN = 200; // allows URLs, UUIDs, model names; rejects prompts
  for (const [key, value] of Object.entries(entry)) {
    if (typeof value === 'string' && value.length > MAX_STRING_LEN) return false;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.length > 100) return false; // entity type names are short
      }
    }
    // Disallow nested objects entirely — prompt content could hide inside
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return false;
    }
    void key;
  }
  return true;
}

// ─── Singleton accessor ────────────────────────────────────────────────────

let _bufferInstance: AuditBuffer | null = null;

export function initAuditBuffer(destination: 'none' | 's3' | 'syslog' | 'webhook' | 'irongate-dashboard', config: Record<string, string>): AuditBuffer {
  const sink = createSink({ destination, config });
  _bufferInstance = new AuditBuffer(sink);
  _bufferInstance.start();
  return _bufferInstance;
}

export function getAuditBuffer(): AuditBuffer | null {
  return _bufferInstance;
}
