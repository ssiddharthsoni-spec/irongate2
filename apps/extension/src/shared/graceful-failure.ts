/**
 * Graceful Failure Modes — Priority 6.3
 *
 * Defines fail-open behavior: never block an employee's work
 * because IronGate has a bug. Log failures, allow prompts through.
 */

export type FailureMode = 'api_unreachable' | 'main_world_failed' | 'detection_error' | 'queue_full';

export interface FailureState {
  mode: FailureMode;
  since: number;
  message: string;
  retryCount: number;
}

const MAX_LOCAL_QUEUE = 1000;
const activeFailures = new Map<FailureMode, FailureState>();

/**
 * Record a failure event. The extension continues operating in degraded mode.
 */
export function recordFailure(mode: FailureMode, message?: string): void {
  const existing = activeFailures.get(mode);
  if (existing) {
    existing.retryCount++;
    existing.message = message || existing.message;
  } else {
    activeFailures.set(mode, {
      mode,
      since: Date.now(),
      message: message || getDefaultMessage(mode),
      retryCount: 0,
    });
  }
}

/**
 * Clear a failure (service recovered).
 */
export function clearFailure(mode: FailureMode): void {
  activeFailures.delete(mode);
}

/**
 * Get all active failures.
 */
export function getActiveFailures(): FailureState[] {
  return Array.from(activeFailures.values());
}

/**
 * Check if a specific failure mode is active.
 */
export function isFailureActive(mode: FailureMode): boolean {
  return activeFailures.has(mode);
}

/**
 * Get the user-facing status message for the side panel.
 */
export function getStatusMessage(): { status: 'online' | 'offline' | 'degraded'; message: string } {
  if (activeFailures.size === 0) {
    return { status: 'online', message: 'Iron Gate is active and protecting your prompts.' };
  }

  if (activeFailures.has('api_unreachable')) {
    return {
      status: 'offline',
      message: 'Offline — events are being queued locally and will sync when connection is restored.',
    };
  }

  if (activeFailures.has('main_world_failed')) {
    return {
      status: 'degraded',
      message: 'Degraded — network interception unavailable on this page. DOM scanning is active.',
    };
  }

  if (activeFailures.has('detection_error')) {
    return {
      status: 'degraded',
      message: 'Degraded — entity detection encountered an error. Prompts are being allowed through.',
    };
  }

  return { status: 'degraded', message: 'Some features may be temporarily unavailable.' };
}

/**
 * Safe wrapper for entity detection — never throws, returns empty on error.
 */
export function safeDetect<T>(
  detectFn: () => T,
  fallback: T
): T {
  try {
    return detectFn();
  } catch (err) {
    recordFailure('detection_error', err instanceof Error ? err.message : 'Unknown detection error');
    return fallback;
  }
}

/**
 * Check if local event queue has capacity.
 */
export function canQueueLocally(currentQueueSize: number): boolean {
  if (currentQueueSize >= MAX_LOCAL_QUEUE) {
    recordFailure('queue_full', `Local queue full (${currentQueueSize}/${MAX_LOCAL_QUEUE})`);
    return false;
  }
  return true;
}

function getDefaultMessage(mode: FailureMode): string {
  switch (mode) {
    case 'api_unreachable':
      return 'Backend API is unreachable. Events are being queued locally.';
    case 'main_world_failed':
      return 'MAIN world script injection failed. Falling back to DOM scanning.';
    case 'detection_error':
      return 'Entity detection encountered an error. Prompts allowed through unmodified.';
    case 'queue_full':
      return 'Local event queue is full. Oldest events may be dropped.';
  }
}
