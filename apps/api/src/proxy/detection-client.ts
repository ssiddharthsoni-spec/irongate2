// ==========================================
// Iron Gate Phase 2 — Detection Service Client
// ==========================================
//
// REST-based client for the Python Detection Service.
// Interface is designed so gRPC transport can be swapped in later
// without changing the calling code.

import type { DetectedEntity, SensitivityLevel } from '@iron-gate/types';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DetectionClientConfig {
  baseUrl: string;
  timeout: number; // ms
}

const DEFAULT_CONFIG: DetectionClientConfig = {
  baseUrl: process.env.DETECTION_SERVICE_URL || 'http://localhost:8080',
  timeout: 30_000,
};

const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Circuit Breaker — prevents silent fail-open when detection service is down
// ---------------------------------------------------------------------------

type CircuitState = 'closed' | 'open' | 'half_open';

interface CircuitBreakerConfig {
  failureThreshold: number;   // consecutive failures before opening
  resetTimeoutMs: number;     // how long to stay open before trying half-open
  onCircuitOpen?: () => void; // optional callback when circuit transitions to open
}

const CIRCUIT_DEFAULTS: CircuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...CIRCUIT_DEFAULTS, ...config };
  }

  /** Whether requests should be attempted (closed or half-open) */
  canAttempt(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      // Check if enough time has passed to try half-open
      if (Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.state = 'half_open';
        logger.info('Detection service circuit breaker: HALF_OPEN — testing');
        return true;
      }
      return false;
    }
    // half_open — allow one attempt
    return true;
  }

  /** Record a successful request */
  onSuccess(): void {
    if (this.state !== 'closed') {
      logger.info('Detection service circuit breaker: CLOSED — service recovered');
    }
    this.consecutiveFailures = 0;
    this.state = 'closed';
  }

  /** Record a failed request */
  onFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half_open' || this.consecutiveFailures >= this.config.failureThreshold) {
      const wasAlreadyOpen = this.state === 'open';
      this.state = 'open';
      logger.error('Detection service circuit breaker: OPEN — service unavailable', {
        consecutiveFailures: this.consecutiveFailures,
        resetTimeoutMs: this.config.resetTimeoutMs,
      });

      // Fire the callback only on a fresh transition to open
      if (!wasAlreadyOpen && this.config.onCircuitOpen) {
        try {
          this.config.onCircuitOpen();
        } catch {
          // Never let callback errors affect circuit breaker logic
        }
      }
    }
  }

  /** Current circuit state for monitoring */
  getState(): CircuitState {
    return this.state;
  }

  isOpen(): boolean {
    return this.state === 'open' && Date.now() - this.lastFailureTime < this.config.resetTimeoutMs;
  }
}

/** Error thrown when detection service is unavailable and callers should use local fallback */
export class DetectionServiceUnavailableError extends Error {
  constructor(message = 'Detection service unavailable — use local regex fallback') {
    super(message);
    this.name = 'DetectionServiceUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface DetectionResponse {
  entities: DetectedEntity[];
  processingTimeMs: number;
  enginesUsed: string[];
}

export interface ScoreResponse {
  score: number;
  level: SensitivityLevel;
  explanation: string;
  entityCount: number;
  processingTimeMs: number;
}

export interface PseudonymizeResponse {
  originalText: string;
  maskedText: string;
  entities: DetectedEntity[];
  pseudonymMap: Record<string, string>;
  score: number;
  level: SensitivityLevel;
  processingTimeMs: number;
}

// ---------------------------------------------------------------------------
// Client implementation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Local detection cache — avoids redundant calls for identical/recent text
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class DetectionCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private maxEntries: number;
  private ttlMs: number;

  constructor(maxEntries = 200, ttlMs = 5 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  async key(text: string, suffix: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex}:${suffix}`;
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

export class DetectionClient {
  private config: DetectionClientConfig;
  private circuitBreaker: CircuitBreaker;
  private detectionCache: DetectionCache;

  constructor(config?: Partial<DetectionClientConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
    this.circuitBreaker = new CircuitBreaker({
      onCircuitOpen: () => {
        // Fire-and-forget alert
        import('../jobs/enqueue').then(({ enqueueWebhook }) => {
          enqueueWebhook({
            firmId: 'system',
            eventType: 'detection_degraded',
            payload: {
              message: 'Detection service circuit breaker opened — falling back to local regex',
              circuitState: 'open',
              timestamp: new Date().toISOString(),
            },
          }).catch((err) => logger.error('Failed to send detection_degraded webhook', { error: String(err) }));
        }).catch((err) => logger.error('Failed to import enqueue module for circuit breaker alert', { error: String(err) }));
      },
    });
    this.detectionCache = new DetectionCache();
  }

  /** Whether the detection service is available (circuit not open) */
  isServiceAvailable(): boolean {
    return !this.circuitBreaker.isOpen();
  }

  /** Current circuit breaker state for monitoring/dashboard */
  getCircuitState(): CircuitState {
    return this.circuitBreaker.getState();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Detect PII and sensitive entities in text.
   * FAIL-CLOSED: throws DetectionServiceUnavailableError when service is down.
   * Callers must catch this and fall back to local regex detection.
   */
  async detectEntities(
    text: string,
    options?: {
      entityTypes?: string[];
      firmId?: string;
      language?: string;
      scoreThreshold?: number;
    },
  ): Promise<DetectionResponse> {
    // Circuit breaker: fail fast if service is known to be down
    if (!this.circuitBreaker.canAttempt()) {
      throw new DetectionServiceUnavailableError();
    }

    // Check cache for identical text
    const cacheKey = await this.detectionCache.key(text, `detect:${options?.firmId || ''}`);
    const cached = this.detectionCache.get<DetectionResponse>(cacheKey);
    if (cached) return cached;

    const body: Record<string, unknown> = { text };
    if (options?.entityTypes) body.entity_types = options.entityTypes;
    if (options?.firmId) body.firm_id = options.firmId;
    if (options?.language) body.language = options.language;
    if (options?.scoreThreshold !== undefined) body.score_threshold = options.scoreThreshold;

    try {
      const data = await this.post<{
        entities: Array<{
          type: string;
          text: string;
          start: number;
          end: number;
          confidence: number;
          source: string;
        }>;
        processing_time_ms: number;
        engines_used: string[];
      }>('/v1/detect', body);

      this.circuitBreaker.onSuccess();

      const result: DetectionResponse = {
        entities: data.entities.map((e) => ({
          type: e.type as DetectedEntity['type'],
          text: e.text,
          start: e.start,
          end: e.end,
          confidence: e.confidence,
          source: e.source as DetectedEntity['source'],
        })),
        processingTimeMs: data.processing_time_ms,
        enginesUsed: data.engines_used,
      };

      // Cache successful results
      this.detectionCache.set(cacheKey, result);
      return result;
    } catch (error) {
      this.circuitBreaker.onFailure();
      logger.error('detectEntities failed — FAIL-CLOSED (use local regex fallback)', {
        error: error instanceof Error ? error.message : String(error),
        circuitState: this.circuitBreaker.getState(),
      });
      throw new DetectionServiceUnavailableError();
    }
  }

  /**
   * Score the sensitivity of text content.
   * FAIL-CLOSED: throws DetectionServiceUnavailableError when service is down.
   * Callers must catch this and fall back to local scoring.
   */
  async scoreText(
    text: string,
    options?: {
      entities?: DetectedEntity[];
      firmId?: string;
    },
  ): Promise<ScoreResponse> {
    if (!this.circuitBreaker.canAttempt()) {
      throw new DetectionServiceUnavailableError();
    }

    const body: Record<string, unknown> = { text };

    if (options?.entities) {
      body.entities = options.entities.map((e) => ({
        type: e.type,
        text: e.text,
        start: e.start,
        end: e.end,
        confidence: e.confidence,
        source: e.source,
      }));
    }
    if (options?.firmId) body.firm_id = options.firmId;

    try {
      const data = await this.post<{
        score: number;
        level: string;
        explanation: string;
        entity_count: number;
        processing_time_ms: number;
      }>('/v1/score', body);

      this.circuitBreaker.onSuccess();

      return {
        score: data.score,
        level: data.level as SensitivityLevel,
        explanation: data.explanation,
        entityCount: data.entity_count,
        processingTimeMs: data.processing_time_ms,
      };
    } catch (error) {
      this.circuitBreaker.onFailure();
      logger.error('scoreText failed — FAIL-CLOSED (use local scoring fallback)', {
        error: error instanceof Error ? error.message : String(error),
        circuitState: this.circuitBreaker.getState(),
      });
      throw new DetectionServiceUnavailableError();
    }
  }

  /**
   * Combined detect + score convenience method.
   * Runs detection first, then passes entities into scoring for efficiency.
   */
  async detectAndScore(
    text: string,
    firmId?: string,
  ): Promise<{
    detection: DetectionResponse;
    score: ScoreResponse;
  }> {
    const detection = await this.detectEntities(text, { firmId });

    const score = await this.scoreText(text, {
      entities: detection.entities,
      firmId,
    });

    return { detection, score };
  }

  /**
   * Combined detect + pseudonymize + score in a single round-trip.
   * Uses the /v1/pseudonymize endpoint on the detection service for
   * maximum efficiency (one network call instead of multiple).
   * FAIL-CLOSED: throws DetectionServiceUnavailableError when service is down.
   */
  async pseudonymize(
    text: string,
    options?: {
      firmId?: string;
      sessionId?: string;
    },
  ): Promise<PseudonymizeResponse> {
    if (!this.circuitBreaker.canAttempt()) {
      throw new DetectionServiceUnavailableError();
    }

    const body: Record<string, unknown> = { text };
    if (options?.firmId) body.firm_id = options.firmId;
    if (options?.sessionId) body.session_id = options.sessionId;

    try {
      const data = await this.post<{
        original_text: string;
        masked_text: string;
        entities: Array<{
          type: string;
          text: string;
          start: number;
          end: number;
          confidence: number;
          source: string;
        }>;
        pseudonym_map: Record<string, string>;
        score: number;
        level: string;
        processing_time_ms: number;
      }>('/v1/pseudonymize', body);

      this.circuitBreaker.onSuccess();

      return {
        originalText: data.original_text,
        maskedText: data.masked_text,
        entities: data.entities.map((e) => ({
          type: e.type as DetectedEntity['type'],
          text: e.text,
          start: e.start,
          end: e.end,
          confidence: e.confidence,
          source: e.source as DetectedEntity['source'],
        })),
        pseudonymMap: data.pseudonym_map,
        score: data.score,
        level: data.level as SensitivityLevel,
        processingTimeMs: data.processing_time_ms,
      };
    } catch (error) {
      this.circuitBreaker.onFailure();
      logger.error('pseudonymize failed — FAIL-CLOSED (use local pseudonymization)', {
        error: error instanceof Error ? error.message : String(error),
        circuitState: this.circuitBreaker.getState(),
      });
      throw new DetectionServiceUnavailableError();
    }
  }

  /**
   * Check whether the detection service is healthy and reachable.
   * Also updates circuit breaker state.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        this.circuitBreaker.onFailure();
        return false;
      }
      const data = (await response.json()) as { status?: string };
      if (data.status === 'ok') {
        this.circuitBreaker.onSuccess();
        return true;
      }
      return false;
    } catch {
      this.circuitBreaker.onFailure();
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Internal HTTP transport with retry
  // -----------------------------------------------------------------------

  /**
   * POST JSON to the detection service with automatic retries on 5xx and
   * network errors. Uses exponential backoff (500ms, 1000ms).
   */
  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const payload = JSON.stringify(body);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(this.config.timeout),
        });

        // Retry on 5xx server errors
        if (response.status >= 500 && attempt < MAX_RETRIES) {
          const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          logger.warn('Request returned server error, retrying', {
            path,
            status: response.status,
            delayMs,
            attempt: attempt + 1,
            maxRetries: MAX_RETRIES,
          });
          await this.sleep(delayMs);
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Detection service error ${response.status} on ${path}: ${errorText}`,
          );
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry client errors (4xx) or if we've exhausted retries
        if (
          lastError.message.includes('Detection service error 4') ||
          attempt >= MAX_RETRIES
        ) {
          throw lastError;
        }

        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        logger.warn('Network error, retrying', {
          path,
          delayMs,
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          error: lastError.message,
        });
        await this.sleep(delayMs);
      }
    }

    throw lastError ?? new Error(`Failed to reach detection service at ${url}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ---------------------------------------------------------------------------
// Singleton for convenience
// ---------------------------------------------------------------------------

let _defaultClient: DetectionClient | undefined;

/**
 * Returns a shared DetectionClient instance configured from environment
 * variables. Use this for most application code; create a new instance
 * directly only when you need custom configuration.
 */
export function getDetectionClient(): DetectionClient {
  if (!_defaultClient) {
    _defaultClient = new DetectionClient();
  }
  return _defaultClient;
}
