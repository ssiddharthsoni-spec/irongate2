/**
 * Weight Resolver — Adaptive Entity Weight System
 *
 * Fetches firm-specific adaptive weights from the API on startup,
 * caches them for 24 hours, and provides a getWeight(entityType)
 * function that the scorer calls instead of looking up static values.
 *
 * Weight sources (applied in priority order):
 * 1. API adaptive weights (feedback-driven, per-firm)
 * 2. Industry profile weights (legal, healthcare, finance, etc.)
 * 3. Static defaults (ENTITY_WEIGHTS in scorer.ts)
 *
 * The resolver merges all sources and returns a single weight map
 * that computeScore() uses via its customWeights parameter.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface WeightOverride {
  entityType: string;
  weight: number;
  source: 'adaptive' | 'industry' | 'admin' | 'suppression';
  confidence: number;
}

export interface WeightResolverState {
  /** Merged weight overrides (entityType -> weight) */
  weights: Record<string, number>;
  /** When the weights were last fetched from the API */
  lastFetchedAt: number;
  /** Whether the resolver has been initialized */
  initialized: boolean;
  /** Number of overrides applied */
  overrideCount: number;
  /** Source breakdown */
  sources: Record<string, number>;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_STORAGE_KEY = 'irongate_weight_overrides';
const MIN_FETCH_INTERVAL_MS = 5 * 60 * 1000; // Don't re-fetch more than once per 5 min

// Entity types whose weights can only be INCREASED, never decreased.
// These are too critical to allow feedback-driven reduction.
const PROTECTED_TYPES = new Set([
  'SSN', 'CREDIT_CARD', 'MEDICAL_RECORD', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE',
  'PRIVATE_KEY', 'AWS_CREDENTIAL', 'DATABASE_URI', 'CLASSIFICATION_MARKING',
]);

// ── Weight Resolver ──────────────────────────────────────────────────────────

class WeightResolver {
  private weights: Record<string, number> = {};
  private lastFetchedAt = 0;
  private initialized = false;
  private fetching = false;
  private industryProfile: Record<string, number> = {};
  private fetchFn: ((path: string) => Promise<any>) | null = null;

  /**
   * Configure the API fetch function. Called once during worker startup.
   * Uses a function reference to avoid circular dependency with api-client.
   */
  configure(fetchFn: (path: string) => Promise<any>): void {
    this.fetchFn = fetchFn;
  }

  /**
   * Set industry profile weights (from executive-lens or onboarding selection).
   * These serve as the baseline before adaptive weights are applied.
   */
  setIndustryProfile(profile: Record<string, number>): void {
    this.industryProfile = { ...profile };
    this.rebuildWeights();
  }

  /**
   * Get the current merged weight overrides for computeScore().
   * Returns empty object if no overrides are active (scorer uses defaults).
   */
  getWeights(): Record<string, number> {
    return { ...this.weights };
  }

  /**
   * Get the weight for a specific entity type.
   * Returns undefined if no override exists (scorer uses its default).
   */
  getWeight(entityType: string): number | undefined {
    return this.weights[entityType];
  }

  /**
   * Get the current resolver state for diagnostics.
   */
  getState(): WeightResolverState {
    const sources: Record<string, number> = {};
    for (const key of Object.keys(this.weights)) {
      // Count sources (simplified — all merged weights count as one)
      sources[key] = this.weights[key];
    }
    return {
      weights: { ...this.weights },
      lastFetchedAt: this.lastFetchedAt,
      initialized: this.initialized,
      overrideCount: Object.keys(this.weights).length,
      sources,
    };
  }

  /**
   * Initialize the resolver. Loads cached weights from storage,
   * then fetches fresh weights from the API if cache is stale.
   */
  async init(): Promise<void> {
    // Load from cache first (instant, no network)
    await this.loadFromCache();
    this.initialized = true;

    // Fetch fresh weights in the background if cache is stale
    if (this.isCacheStale()) {
      this.fetchFromApi().catch(() => {}); // Non-blocking
    }
  }

  /**
   * Force a refresh of adaptive weights from the API.
   */
  async refresh(): Promise<void> {
    await this.fetchFromApi();
  }

  /**
   * Check if cached weights are stale and need refreshing.
   */
  private isCacheStale(): boolean {
    return Date.now() - this.lastFetchedAt > CACHE_TTL_MS;
  }

  /**
   * Load cached weights from chrome.storage.local.
   */
  private async loadFromCache(): Promise<void> {
    try {
      const data = await new Promise<Record<string, any>>((resolve) => {
        chrome.storage.local.get([CACHE_STORAGE_KEY], resolve);
      });

      const cached = data[CACHE_STORAGE_KEY];
      if (cached?.weights && cached?.timestamp) {
        this.lastFetchedAt = cached.timestamp;
        this.applyAdaptiveWeights(cached.weights);
      }
    } catch {
      // Cache miss — will fetch from API
    }
  }

  /**
   * Save weights to chrome.storage.local for persistence across restarts.
   */
  private async saveToCache(weights: Record<string, number>): Promise<void> {
    try {
      await chrome.storage.local.set({
        [CACHE_STORAGE_KEY]: {
          weights,
          timestamp: Date.now(),
        },
      });
    } catch {
      // Storage write failure is non-fatal
    }
  }

  /**
   * Fetch adaptive weights from the API.
   */
  private async fetchFromApi(): Promise<void> {
    if (!this.fetchFn) return;
    if (this.fetching) return; // Prevent concurrent fetches
    if (Date.now() - this.lastFetchedAt < MIN_FETCH_INTERVAL_MS) return;

    this.fetching = true;
    try {
      const result = await this.fetchFn('/admin/adaptive-weights/overrides');
      if (result?.overrides && typeof result.overrides === 'object') {
        this.applyAdaptiveWeights(result.overrides);
        this.lastFetchedAt = Date.now();
        await this.saveToCache(result.overrides);
      }
    } catch {
      // API fetch failure — keep using cached/default weights
    } finally {
      this.fetching = false;
    }
  }

  /**
   * Apply adaptive weights from the API, respecting protected types.
   */
  private applyAdaptiveWeights(apiWeights: Record<string, number>): void {
    for (const [entityType, weight] of Object.entries(apiWeights)) {
      if (typeof weight !== 'number' || weight <= 0) continue;

      // Protected types can only have weights INCREASED
      if (PROTECTED_TYPES.has(entityType)) {
        const currentWeight = this.weights[entityType] || this.industryProfile[entityType];
        if (currentWeight && weight < currentWeight) continue;
      }

      this.weights[entityType] = Math.round(weight);
    }

    this.rebuildWeights();
  }

  /**
   * Rebuild the merged weight map from all sources.
   * Priority: adaptive > industry > (scorer defaults apply if no override)
   */
  private rebuildWeights(): void {
    const merged: Record<string, number> = {};

    // Layer 1: Industry profile (baseline)
    for (const [type, weight] of Object.entries(this.industryProfile)) {
      merged[type] = weight;
    }

    // Layer 2: Adaptive weights (override industry)
    for (const [type, weight] of Object.entries(this.weights)) {
      // Protected types: only allow increase
      if (PROTECTED_TYPES.has(type)) {
        merged[type] = Math.max(merged[type] || 0, weight);
      } else {
        merged[type] = weight;
      }
    }

    this.weights = merged;
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let instance: WeightResolver | null = null;

export function getWeightResolver(): WeightResolver {
  if (!instance) {
    instance = new WeightResolver();
  }
  return instance;
}
