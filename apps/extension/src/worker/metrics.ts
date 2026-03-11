/**
 * Observability / Metrics — Lightweight telemetry for pipeline performance.
 *
 * Tracks:
 * - Detection latency (p50, p95, p99)
 * - Score distribution (low/medium/high/critical counts)
 * - Entity type frequency
 * - Error counts by stage
 * - Intent classification distribution
 *
 * All metrics are in-memory only (no persistence). Reset on SW restart.
 * Exposed via GET_STATUS for side panel display and diagnostic exports.
 */

export interface MetricsSummary {
  /** Total prompts processed since SW start */
  totalProcessed: number;
  /** Detection latency percentiles (ms) */
  latency: { p50: number; p95: number; p99: number };
  /** Score level distribution */
  scoreDistribution: Record<string, number>;
  /** Top entity types seen */
  topEntityTypes: Array<{ type: string; count: number }>;
  /** Errors by pipeline stage */
  errorCounts: Record<string, number>;
  /** Intent classification distribution */
  intentDistribution: Record<string, number>;
  /** Uptime since SW start (ms) */
  uptimeMs: number;
}

const SW_START_TIME = Date.now();
const MAX_LATENCY_SAMPLES = 500;

class PipelineMetrics {
  private latencies: number[] = [];
  private scoreDistribution: Record<string, number> = {
    low: 0, medium: 0, high: 0, critical: 0,
  };
  private entityTypeCounts = new Map<string, number>();
  private errorCounts = new Map<string, number>();
  private intentCounts = new Map<string, number>();
  private totalProcessed = 0;

  /**
   * Record a completed detection cycle.
   */
  recordDetection(params: {
    latencyMs: number;
    level: string;
    entityTypes: string[];
    intent?: string;
  }): void {
    this.totalProcessed++;

    // Latency (ring buffer)
    this.latencies.push(params.latencyMs);
    if (this.latencies.length > MAX_LATENCY_SAMPLES) {
      this.latencies.shift();
    }

    // Score distribution
    if (params.level in this.scoreDistribution) {
      this.scoreDistribution[params.level]++;
    }

    // Entity types
    for (const type of params.entityTypes) {
      this.entityTypeCounts.set(type, (this.entityTypeCounts.get(type) || 0) + 1);
    }

    // Intent
    if (params.intent) {
      this.intentCounts.set(params.intent, (this.intentCounts.get(params.intent) || 0) + 1);
    }
  }

  /**
   * Record a pipeline error.
   */
  recordError(stage: string): void {
    this.errorCounts.set(stage, (this.errorCounts.get(stage) || 0) + 1);
  }

  /**
   * Get a snapshot of current metrics.
   */
  getSummary(): MetricsSummary {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p = (pct: number) => sorted.length > 0
      ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct))]
      : 0;

    // Top 10 entity types by frequency
    const topEntityTypes = [...this.entityTypeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([type, count]) => ({ type, count }));

    const errorCounts: Record<string, number> = {};
    for (const [stage, count] of this.errorCounts) {
      errorCounts[stage] = count;
    }

    const intentDistribution: Record<string, number> = {};
    for (const [intent, count] of this.intentCounts) {
      intentDistribution[intent] = count;
    }

    return {
      totalProcessed: this.totalProcessed,
      latency: { p50: p(0.5), p95: p(0.95), p99: p(0.99) },
      scoreDistribution: { ...this.scoreDistribution },
      topEntityTypes,
      errorCounts,
      intentDistribution,
      uptimeMs: Date.now() - SW_START_TIME,
    };
  }

  /**
   * Reset all metrics (for testing or manual reset).
   */
  reset(): void {
    this.latencies = [];
    this.scoreDistribution = { low: 0, medium: 0, high: 0, critical: 0 };
    this.entityTypeCounts.clear();
    this.errorCounts.clear();
    this.intentCounts.clear();
    this.totalProcessed = 0;
  }
}

// Singleton
export const metrics = new PipelineMetrics();
