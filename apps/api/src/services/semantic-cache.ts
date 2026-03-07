/**
 * Semantic Cache — Phase 2.4
 *
 * Caches Tier 3 classification results using structural fingerprints
 * derived from entity type vectors — NOT raw text. This means:
 *
 * 1. Cache keys are computed from entity type/count distributions
 * 2. Two inputs with the same entity profile get the same classification
 * 3. No PII is stored in the cache — only type vectors and scores
 * 4. TTL-based expiration (default 1 hour)
 * 5. LRU eviction when cache exceeds max size
 *
 * Example fingerprint:
 *   { PERSON: 2, SSN: 1, EMAIL: 1 } + documentLength bucket + contextBucket
 *   → hash → cache key
 */

import { logger } from '../lib/logger';

// ── Types ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  score: number;
  level: string;
  confidence: number;
  reasoning: string;
  source: string;
  createdAt: number;
}

interface Fingerprint {
  entityTypeCounts: Record<string, number>;
  lengthBucket: string;
  tier1ScoreBucket: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_MAX_SIZE = 1000;

// ── Semantic Cache ───────────────────────────────────────────────────────────

export class SemanticCache {
  private cache = new Map<string, CacheEntry>();
  private accessOrder: string[] = [];
  private readonly ttlMs: number;
  private readonly maxSize: number;
  private hits = 0;
  private misses = 0;

  constructor(ttlMs = DEFAULT_TTL_MS, maxSize = DEFAULT_MAX_SIZE) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  /**
   * Build a structural fingerprint from entity metadata.
   * No raw text is used — only type distributions and size buckets.
   */
  buildFingerprint(
    entityTypeCounts: Record<string, number>,
    textLength: number,
    tier1Score: number,
  ): string {
    const fp: Fingerprint = {
      entityTypeCounts: sortedCounts(entityTypeCounts),
      lengthBucket: lengthToBucket(textLength),
      tier1ScoreBucket: scoreToBucket(tier1Score),
    };

    return hashFingerprint(fp);
  }

  /**
   * Look up a cached classification by fingerprint.
   * Returns null on miss or expired entry.
   */
  get(fingerprint: string): CacheEntry | null {
    const entry = this.cache.get(fingerprint);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(fingerprint);
      this.removeFromAccessOrder(fingerprint);
      this.misses++;
      return null;
    }

    // Move to end of access order (LRU)
    this.removeFromAccessOrder(fingerprint);
    this.accessOrder.push(fingerprint);
    this.hits++;

    return entry;
  }

  /**
   * Store a classification result by fingerprint.
   */
  set(fingerprint: string, result: {
    score: number;
    level: string;
    confidence: number;
    reasoning: string;
    source: string;
  }): void {
    // Evict if at capacity
    while (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift()!;
      this.cache.delete(oldest);
    }

    this.cache.set(fingerprint, {
      ...result,
      createdAt: Date.now(),
    });
    this.accessOrder.push(fingerprint);
  }

  /**
   * Get cache statistics.
   */
  stats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * Sweep expired entries.
   */
  sweep(): number {
    const now = Date.now();
    let swept = 0;

    for (const [key, entry] of this.cache) {
      if (now - entry.createdAt > this.ttlMs) {
        this.cache.delete(key);
        this.removeFromAccessOrder(key);
        swept++;
      }
    }

    return swept;
  }

  private removeFromAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) this.accessOrder.splice(idx, 1);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sortedCounts(counts: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(counts).sort()) {
    sorted[key] = counts[key];
  }
  return sorted;
}

function lengthToBucket(length: number): string {
  if (length < 100) return 'tiny';
  if (length < 500) return 'short';
  if (length < 2000) return 'medium';
  if (length < 5000) return 'long';
  return 'very_long';
}

function scoreToBucket(score: number): string {
  if (score <= 25) return 'low';
  if (score <= 60) return 'medium';
  if (score <= 85) return 'high';
  return 'critical';
}

/**
 * Simple deterministic hash of a fingerprint object.
 * Uses djb2 algorithm on the JSON string.
 */
function hashFingerprint(fp: Fingerprint): string {
  const str = JSON.stringify(fp);
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return `sc_${(hash >>> 0).toString(36)}`;
}

// ── Singleton ────────────────────────────────────────────────────────────────

let instance: SemanticCache | null = null;

export function getSemanticCache(): SemanticCache {
  if (!instance) {
    instance = new SemanticCache();
  }
  return instance;
}

export function resetSemanticCache(): void {
  instance?.clear();
  instance = null;
}
