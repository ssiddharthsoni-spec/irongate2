// ==========================================
// Iron Gate Phase 2 — Detection Service Client
// ==========================================
//
// REST-based client for the Python Detection Service.
// Interface is designed so gRPC transport can be swapped in later
// without changing the calling code.

import type { DetectedEntity, SensitivityLevel } from '@iron-gate/types';

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

export class DetectionClient {
  private config: DetectionClientConfig;

  constructor(config?: Partial<DetectionClientConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Detect PII and sensitive entities in text.
   * Falls back to empty results if the detection service is unreachable.
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
    const body: Record<string, unknown> = { text };
    if (options?.entityTypes) body.entity_types = options.entityTypes;
    if (options?.firmId) body.firm_id = options.firmId;
    if (options?.language) body.language = options.language;
    if (options?.scoreThreshold !== undefined) body.score_threshold = options.scoreThreshold;

    const fallback: DetectionResponse = {
      entities: [],
      processingTimeMs: 0,
      enginesUsed: [],
    };

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

      return {
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
    } catch (error) {
      console.error('[DetectionClient] detectEntities failed, returning empty results:', error);
      return fallback;
    }
  }

  /**
   * Score the sensitivity of text content.
   * Falls back to score 0 / "low" if the detection service is unreachable.
   */
  async scoreText(
    text: string,
    options?: {
      entities?: DetectedEntity[];
      firmId?: string;
    },
  ): Promise<ScoreResponse> {
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

    const fallback: ScoreResponse = {
      score: 0,
      level: 'low',
      explanation: 'Detection service unavailable; score defaulted to low.',
      entityCount: 0,
      processingTimeMs: 0,
    };

    try {
      const data = await this.post<{
        score: number;
        level: string;
        explanation: string;
        entity_count: number;
        processing_time_ms: number;
      }>('/v1/score', body);

      return {
        score: data.score,
        level: data.level as SensitivityLevel,
        explanation: data.explanation,
        entityCount: data.entity_count,
        processingTimeMs: data.processing_time_ms,
      };
    } catch (error) {
      console.error('[DetectionClient] scoreText failed, returning default score:', error);
      return fallback;
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
   */
  async pseudonymize(
    text: string,
    options?: {
      firmId?: string;
      sessionId?: string;
    },
  ): Promise<PseudonymizeResponse> {
    const body: Record<string, unknown> = { text };
    if (options?.firmId) body.firm_id = options.firmId;
    if (options?.sessionId) body.session_id = options.sessionId;

    const fallback: PseudonymizeResponse = {
      originalText: text,
      maskedText: text,
      entities: [],
      pseudonymMap: {},
      score: 0,
      level: 'low',
      processingTimeMs: 0,
    };

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
      console.error('[DetectionClient] pseudonymize failed, returning passthrough:', error);
      return fallback;
    }
  }

  /**
   * Check whether the detection service is healthy and reachable.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { status?: string };
      return data.status === 'ok';
    } catch {
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
          console.warn(
            `[DetectionClient] ${path} returned ${response.status}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
          );
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
        console.warn(
          `[DetectionClient] ${path} network error, retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES}):`,
          lastError.message,
        );
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
