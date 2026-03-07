/**
 * Lightweight Circuit Breaker for external service calls.
 *
 * States:
 *   - closed:    normal operation, requests pass through
 *   - open:      too many failures, requests fail fast
 *   - half-open: after resetTimeout, one probe request is allowed through
 */

import { logger } from './logger';

export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures = 0;
  private lastFailure = 0;

  constructor(
    private readonly name: string,
    private readonly threshold: number = 5,
    private readonly resetTimeout: number = 30_000,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = 'half-open';
        logger.info(`Circuit breaker [${this.name}] entering half-open state`);
      } else {
        throw new CircuitBreakerOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  get currentState(): string {
    return this.state;
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      logger.info(`Circuit breaker [${this.name}] recovered — closing`);
    }
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.state = 'open';
      logger.warn(`Circuit breaker [${this.name}] opened after ${this.failures} failures`);
    }
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker [${name}] is open — failing fast`);
    this.name = 'CircuitBreakerOpenError';
  }
}
