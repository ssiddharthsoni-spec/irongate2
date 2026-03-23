/**
 * Iron Gate — Reusable Circuit Breaker
 *
 * Rolling-window circuit breaker that tracks error rate over a configurable
 * time window.  When the error rate exceeds the threshold (and a minimum
 * number of requests have been observed), the circuit opens and all calls
 * are rejected.  After a configurable reset timeout the circuit moves to
 * half-open: one probe request is allowed through.  A success closes the
 * circuit; a failure re-opens it.
 *
 * Three independent instances are used in Iron Gate:
 *   1. Extension → API  (managed in-extension)
 *   2. API → Redis       (managed server-side, state echoed to extension)
 *   3. API → PostgreSQL  (managed server-side, state echoed to extension)
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Human-readable name for logging */
  name: string;
  /** Rolling window duration in ms (default: 30000) */
  windowMs?: number;
  /** Error rate threshold to trip the circuit (0–1, default: 0.2 = 20%) */
  errorThreshold?: number;
  /** Minimum requests in window before threshold applies (default: 5) */
  minRequests?: number;
  /** Time in ms to wait before trying half-open (default: 60000) */
  resetTimeoutMs?: number;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  errorRate: number;
  totalRequests: number;
  windowMs: number;
  name: string;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private errors: number[] = [];
  private successes: number[] = [];
  private lastStateChange: number = Date.now();

  private readonly windowMs: number;
  private readonly errorThreshold: number;
  private readonly minRequests: number;
  private readonly resetTimeoutMs: number;
  readonly name: string;

  constructor(config: CircuitBreakerConfig) {
    this.name = config.name;
    this.windowMs = config.windowMs ?? 30_000;
    this.errorThreshold = config.errorThreshold ?? 0.2;
    this.minRequests = config.minRequests ?? 5;
    this.resetTimeoutMs = config.resetTimeoutMs ?? 60_000;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns true if a request is allowed through the circuit. */
  canAttempt(): boolean {
    switch (this.state) {
      case 'closed':
        return true;

      case 'open': {
        // Check if enough time has passed to try a probe request
        const elapsed = Date.now() - this.lastStateChange;
        if (elapsed >= this.resetTimeoutMs) {
          this.transition('half-open');
          return true;
        }
        return false;
      }

      case 'half-open':
        // In half-open we allow exactly one probe — the caller that got
        // `true` is responsible for calling onSuccess / onFailure.
        return true;
    }
  }

  /** Record a successful request. */
  onSuccess(): void {
    const now = Date.now();
    this.successes.push(now);
    this.pruneWindow(now);

    if (this.state === 'half-open' || this.state === 'open') {
      // Probe succeeded — close the circuit.
      this.transition('closed');
    }
  }

  /** Record a failed request. */
  onFailure(): void {
    const now = Date.now();
    this.errors.push(now);
    this.pruneWindow(now);

    if (this.state === 'half-open') {
      // Probe failed — re-open immediately.
      this.transition('open');
      return;
    }

    if (this.state === 'closed') {
      this.evaluateThreshold(now);
    }
  }

  /** Current circuit state. */
  getState(): CircuitState {
    // Lazily transition from open → half-open when the reset timeout elapses.
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastStateChange;
      if (elapsed >= this.resetTimeoutMs) {
        this.transition('half-open');
      }
    }
    return this.state;
  }

  /** Snapshot of circuit health for the sidepanel / diagnostics. */
  getStats(): CircuitBreakerStats {
    const now = Date.now();
    this.pruneWindow(now);
    const total = this.errorsInWindow(now) + this.successesInWindow(now);
    const errorRate = total > 0 ? this.errorsInWindow(now) / total : 0;

    return {
      state: this.getState(),
      errorRate: Math.round(errorRate * 1000) / 1000, // 3 decimal places
      totalRequests: total,
      windowMs: this.windowMs,
      name: this.name,
    };
  }

  /** Force the circuit to a specific state (useful for testing / admin). */
  forceState(newState: CircuitState): void {
    this.transition(newState);
    if (newState === 'closed') {
      this.errors = [];
      this.successes = [];
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private transition(newState: CircuitState): void {
    if (this.state !== newState) {
      console.log(
        `[IronGate CircuitBreaker:${this.name}] ${this.state} → ${newState}`,
      );
      this.state = newState;
      this.lastStateChange = Date.now();
    }
  }

  private evaluateThreshold(now: number): void {
    const errorCount = this.errorsInWindow(now);
    const successCount = this.successesInWindow(now);
    const total = errorCount + successCount;

    if (total < this.minRequests) return;

    const errorRate = errorCount / total;
    if (errorRate >= this.errorThreshold) {
      console.warn(
        `[IronGate CircuitBreaker:${this.name}] Error rate ${(errorRate * 100).toFixed(1)}% ` +
        `exceeds threshold ${(this.errorThreshold * 100).toFixed(1)}% — opening circuit`,
      );
      this.transition('open');
    }
  }

  private errorsInWindow(now: number): number {
    const cutoff = now - this.windowMs;
    return this.errors.filter((t) => t > cutoff).length;
  }

  private successesInWindow(now: number): number {
    const cutoff = now - this.windowMs;
    return this.successes.filter((t) => t > cutoff).length;
  }

  /** Evict timestamps older than the window to prevent memory growth. */
  private pruneWindow(now: number): void {
    const cutoff = now - this.windowMs;
    // Keep only the last two windows' worth of data as a small buffer
    const pruneCutoff = cutoff - this.windowMs;
    if (this.errors.length > 0 && this.errors[0] < pruneCutoff) {
      this.errors = this.errors.filter((t) => t > cutoff);
    }
    if (this.successes.length > 0 && this.successes[0] < pruneCutoff) {
      this.successes = this.successes.filter((t) => t > cutoff);
    }
  }
}
