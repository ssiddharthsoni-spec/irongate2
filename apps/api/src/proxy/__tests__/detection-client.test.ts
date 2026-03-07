import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker } from '../detection-client';

describe('CircuitBreaker', () => {
  it('opens after N consecutive failures', () => {
    const onCircuitOpen = vi.fn();
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 10_000,
      onCircuitOpen,
    });

    expect(cb.getState()).toBe('closed');
    expect(cb.canAttempt()).toBe(true);

    // First two failures keep the circuit closed
    cb.onFailure();
    expect(cb.getState()).toBe('closed');
    cb.onFailure();
    expect(cb.getState()).toBe('closed');
    expect(onCircuitOpen).not.toHaveBeenCalled();

    // Third failure trips the circuit to open
    cb.onFailure();
    expect(cb.getState()).toBe('open');
    expect(onCircuitOpen).toHaveBeenCalledTimes(1);

    // While open, canAttempt returns false (before resetTimeout elapses)
    expect(cb.canAttempt()).toBe(false);
  });

  it('transitions to half-open after cooldown period', () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 100, // short cooldown for test
    });

    // Trip the circuit
    cb.onFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.canAttempt()).toBe(false);

    // Simulate time passing by manipulating the internal lastFailureTime.
    // We do this by waiting just over the resetTimeout.
    // Instead, we use a more reliable approach: create with a very short timeout
    // and verify after the timeout has elapsed.

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // After cooldown, canAttempt() should transition to half_open and return true
        expect(cb.canAttempt()).toBe(true);
        expect(cb.getState()).toBe('half_open');
        resolve();
      }, 150);
    });
  });

  it('closes on success after half-open', () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 50,
    });

    // Trip the circuit
    cb.onFailure();
    expect(cb.getState()).toBe('open');

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // Transition to half-open
        expect(cb.canAttempt()).toBe(true);
        expect(cb.getState()).toBe('half_open');

        // A success while half-open should close the circuit
        cb.onSuccess();
        expect(cb.getState()).toBe('closed');
        expect(cb.canAttempt()).toBe(true);
        resolve();
      }, 100);
    });
  });
});
