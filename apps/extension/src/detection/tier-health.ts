/**
 * Tier Health Monitor — Phase 3.4
 *
 * Monitors the health and availability of each detection tier:
 *   - Tracks success/failure counts and latency percentiles
 *   - Auto-disables unhealthy tiers after threshold failures
 *   - Re-probes disabled tiers periodically to check recovery
 *   - Exposes health status for admin dashboard
 *
 * Health states:
 *   healthy:   < 10% error rate, p95 latency within budget
 *   degraded:  10-50% error rate or p95 exceeding budget
 *   unhealthy: > 50% error rate — tier is auto-skipped
 */

import type { Tier } from './confidence-router';

// ── Types ────────────────────────────────────────────────────────────────────

export type HealthState = 'healthy' | 'degraded' | 'unhealthy';

export interface TierHealthStatus {
  tier: Tier;
  state: HealthState;
  totalCalls: number;
  successCount: number;
  errorCount: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  disabledUntil: number | null;
}

export interface TierHealthConfig {
  /** Error rate threshold for degraded state (default: 0.1) */
  degradedThreshold?: number;
  /** Error rate threshold for unhealthy state (default: 0.5) */
  unhealthyThreshold?: number;
  /** P95 latency budget in ms (default: 2000) */
  latencyBudgetMs?: number;
  /** How long to disable unhealthy tiers in ms (default: 60000) */
  disableDurationMs?: number;
  /** Max latency samples to keep (default: 100) */
  maxSamples?: number;
}

// ── Tier Health Monitor ──────────────────────────────────────────────────────

export class TierHealthMonitor {
  private tiers = new Map<Tier, TierMetrics>();
  private readonly degradedThreshold: number;
  private readonly unhealthyThreshold: number;
  private readonly latencyBudgetMs: number;
  private readonly disableDurationMs: number;
  private readonly maxSamples: number;

  constructor(config: TierHealthConfig = {}) {
    this.degradedThreshold = config.degradedThreshold ?? 0.1;
    this.unhealthyThreshold = config.unhealthyThreshold ?? 0.5;
    this.latencyBudgetMs = config.latencyBudgetMs ?? 2000;
    this.disableDurationMs = config.disableDurationMs ?? 60000;
    this.maxSamples = config.maxSamples ?? 100;
  }

  /**
   * Record a successful tier call.
   */
  recordSuccess(tier: Tier, latencyMs: number): void {
    const metrics = this.getOrCreate(tier);
    metrics.totalCalls++;
    metrics.successCount++;
    metrics.lastSuccessAt = Date.now();
    this.addLatencySample(metrics, latencyMs);
  }

  /**
   * Record a failed tier call.
   */
  recordError(tier: Tier, error: string): void {
    const metrics = this.getOrCreate(tier);
    metrics.totalCalls++;
    metrics.errorCount++;
    metrics.lastErrorAt = Date.now();
    metrics.lastError = error;

    // Auto-disable if error rate exceeds threshold
    const errorRate = metrics.errorCount / metrics.totalCalls;
    if (errorRate >= this.unhealthyThreshold && metrics.totalCalls >= 5) {
      metrics.disabledUntil = Date.now() + this.disableDurationMs;
    }
  }

  /**
   * Check if a tier is currently available.
   */
  isAvailable(tier: Tier): boolean {
    const metrics = this.tiers.get(tier);
    if (!metrics) return true; // No data = assume available

    if (metrics.disabledUntil && Date.now() < metrics.disabledUntil) {
      return false;
    }

    // Clear expired disable
    if (metrics.disabledUntil && Date.now() >= metrics.disabledUntil) {
      metrics.disabledUntil = null;
      // Reset counters for fresh evaluation
      metrics.totalCalls = 0;
      metrics.successCount = 0;
      metrics.errorCount = 0;
    }

    return true;
  }

  /**
   * Get the health status of a specific tier.
   */
  getStatus(tier: Tier): TierHealthStatus {
    const metrics = this.getOrCreate(tier);
    const errorRate = metrics.totalCalls > 0 ? metrics.errorCount / metrics.totalCalls : 0;
    const p95 = this.computeP95(metrics);
    const avgLatency = metrics.latencySamples.length > 0
      ? metrics.latencySamples.reduce((a, b) => a + b, 0) / metrics.latencySamples.length
      : 0;

    let state: HealthState = 'healthy';
    if (errorRate >= this.unhealthyThreshold || metrics.disabledUntil) {
      state = 'unhealthy';
    } else if (errorRate >= this.degradedThreshold || p95 > this.latencyBudgetMs) {
      state = 'degraded';
    }

    return {
      tier,
      state,
      totalCalls: metrics.totalCalls,
      successCount: metrics.successCount,
      errorCount: metrics.errorCount,
      errorRate: Math.round(errorRate * 100) / 100,
      avgLatencyMs: Math.round(avgLatency),
      p95LatencyMs: Math.round(p95),
      lastSuccessAt: metrics.lastSuccessAt,
      lastErrorAt: metrics.lastErrorAt,
      lastError: metrics.lastError,
      disabledUntil: metrics.disabledUntil,
    };
  }

  /**
   * Get health status for all tracked tiers.
   */
  getAllStatus(): TierHealthStatus[] {
    const tiers: Tier[] = [1, 2, 2.5, 3];
    return tiers
      .filter(t => this.tiers.has(t))
      .map(t => this.getStatus(t));
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.tiers.clear();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private getOrCreate(tier: Tier): TierMetrics {
    let metrics = this.tiers.get(tier);
    if (!metrics) {
      metrics = {
        totalCalls: 0,
        successCount: 0,
        errorCount: 0,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: null,
        disabledUntil: null,
        latencySamples: [],
      };
      this.tiers.set(tier, metrics);
    }
    return metrics;
  }

  private addLatencySample(metrics: TierMetrics, latencyMs: number): void {
    metrics.latencySamples.push(latencyMs);
    if (metrics.latencySamples.length > this.maxSamples) {
      metrics.latencySamples.shift();
    }
  }

  private computeP95(metrics: TierMetrics): number {
    if (metrics.latencySamples.length === 0) return 0;
    const sorted = [...metrics.latencySamples].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * 0.95);
    return sorted[Math.min(idx, sorted.length - 1)];
  }
}

// ── Internal Types ───────────────────────────────────────────────────────────

interface TierMetrics {
  totalCalls: number;
  successCount: number;
  errorCount: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  disabledUntil: number | null;
  latencySamples: number[];
}

// ── Singleton ────────────────────────────────────────────────────────────────

let instance: TierHealthMonitor | null = null;

export function getTierHealthMonitor(): TierHealthMonitor {
  if (!instance) {
    instance = new TierHealthMonitor();
  }
  return instance;
}
