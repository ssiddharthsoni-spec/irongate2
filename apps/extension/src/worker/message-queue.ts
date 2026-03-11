/**
 * Message Queue — Stability Layer
 *
 * Ensures only one prompt is being processed per tab at a time.
 * Prevents race conditions when a user types fast and triggers
 * multiple PROMPT_DETECTED messages before the first completes.
 *
 * Design:
 * - Per-tab queue: each tab has its own queue
 * - Serial processing: messages for the same tab are processed in order
 * - Debounce: rapid messages within 200ms collapse to the latest
 * - Timeout: if processing takes >10s, unlock the queue and move on
 */

type MessageHandler = (message: QueuedMessage) => Promise<void>;

interface QueuedMessage {
  tabId: number;
  data: any;
  timestamp: number;
}

interface TabQueue {
  processing: boolean;
  pending: QueuedMessage | null;  // Only keep the latest pending message (debounce)
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

const MAX_TABS = 100;
const PROCESSING_TIMEOUT = 10_000; // 10 seconds

export class MessageQueue {
  private queues = new Map<number, TabQueue>();
  private handler: MessageHandler;

  constructor(handler: MessageHandler) {
    this.handler = handler;
  }

  /**
   * Enqueue a message for processing. If the tab is currently busy,
   * the message replaces any existing pending message (debounce —
   * only the latest matters).
   */
  enqueue(tabId: number, data: any): void {
    let queue = this.queues.get(tabId);

    if (!queue) {
      // Enforce max tabs to prevent memory leaks
      if (this.queues.size >= MAX_TABS) {
        this.evictOldest();
      }
      queue = { processing: false, pending: null, timeoutHandle: null };
      this.queues.set(tabId, queue);
    }

    const message: QueuedMessage = { tabId, data, timestamp: Date.now() };

    if (queue.processing) {
      // Tab is busy — replace any existing pending message (debounce)
      queue.pending = message;
      return;
    }

    // Tab is free — process immediately
    this.processMessage(tabId, queue, message);
  }

  /**
   * Remove a tab's queue (e.g., when tab is closed).
   */
  removeTab(tabId: number): void {
    const queue = this.queues.get(tabId);
    if (queue?.timeoutHandle) {
      clearTimeout(queue.timeoutHandle);
    }
    this.queues.delete(tabId);
  }

  /**
   * Get the number of tabs with active queues.
   */
  getActiveTabCount(): number {
    return this.queues.size;
  }

  private async processMessage(tabId: number, queue: TabQueue, message: QueuedMessage): Promise<void> {
    queue.processing = true;

    // Safety timeout — if handler hangs, unlock after 10s
    queue.timeoutHandle = setTimeout(() => {
      queue.processing = false;
      queue.timeoutHandle = null;
      // Process any pending message
      if (queue.pending) {
        const next = queue.pending;
        queue.pending = null;
        this.processMessage(tabId, queue, next);
      }
    }, PROCESSING_TIMEOUT);

    try {
      await this.handler(message);
    } catch {
      // Handler errors are logged by the handler itself
    } finally {
      if (queue.timeoutHandle) {
        clearTimeout(queue.timeoutHandle);
        queue.timeoutHandle = null;
      }
      queue.processing = false;

      // Process any pending message that arrived during processing
      if (queue.pending) {
        const next = queue.pending;
        queue.pending = null;
        this.processMessage(tabId, queue, next);
      }
    }
  }

  private evictOldest(): void {
    // Remove the tab queue that was least recently used
    let oldestTab: number | null = null;
    let oldestTime = Infinity;

    for (const [tabId, queue] of this.queues) {
      if (!queue.processing) {
        // Prefer evicting non-processing queues
        if (!oldestTab || (queue.pending?.timestamp ?? 0) < oldestTime) {
          oldestTab = tabId;
          oldestTime = queue.pending?.timestamp ?? 0;
        }
      }
    }

    if (oldestTab !== null) {
      this.removeTab(oldestTab);
    }
  }
}
