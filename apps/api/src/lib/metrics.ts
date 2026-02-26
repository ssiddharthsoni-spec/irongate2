/**
 * In-memory metrics collector for operational monitoring.
 * Tracks request counts, error rates, latency percentiles, and per-route stats.
 * Exposed via GET /health/metrics endpoint.
 */

const MAX_LATENCIES = 1000; // Keep last 1000 latencies for percentile calculation

class MetricsCollector {
  private requestCount = 0;
  private errorCount = 0;
  private latencies: number[] = [];
  private routeStats = new Map<string, { count: number; errors: number; totalLatency: number }>();
  private startTime = Date.now();

  /** Record a request's outcome. Called from request-logger middleware. */
  record(path: string, statusCode: number, latencyMs: number) {
    this.requestCount++;
    if (statusCode >= 500) this.errorCount++;

    // Rolling window of latencies
    this.latencies.push(latencyMs);
    if (this.latencies.length > MAX_LATENCIES) this.latencies.shift();

    // Per-route aggregation
    const route = this.normalizeRoute(path);
    const stat = this.routeStats.get(route) || { count: 0, errors: 0, totalLatency: 0 };
    stat.count++;
    if (statusCode >= 500) stat.errors++;
    stat.totalLatency += latencyMs;
    this.routeStats.set(route, stat);
  }

  /** Return a snapshot of current metrics. */
  snapshot() {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const routes: Record<string, { count: number; errors: number; avgLatencyMs: number }> = {};
    for (const [route, stat] of this.routeStats) {
      routes[route] = {
        count: stat.count,
        errors: stat.errors,
        avgLatencyMs: stat.count > 0 ? Math.round(stat.totalLatency / stat.count) : 0,
      };
    }

    return {
      uptimeMs: Date.now() - this.startTime,
      totalRequests: this.requestCount,
      totalErrors: this.errorCount,
      errorRate: this.requestCount > 0 ? +(this.errorCount / this.requestCount).toFixed(4) : 0,
      latency: {
        p50: this.percentile(sorted, 0.5),
        p95: this.percentile(sorted, 0.95),
        p99: this.percentile(sorted, 0.99),
      },
      routes,
    };
  }

  /** Normalize route paths by replacing UUIDs with :id */
  private normalizeRoute(path: string): string {
    return path.replace(/[a-f0-9-]{36}/g, ':id');
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, idx)];
  }
}

export const metrics = new MetricsCollector();
