// ============================================================================
// Detector Interface — every detector implements this.
//
// A detector is a pure function: text in, detections out. No side effects.
// No storage writes. No message sends. No DOM access. No Chrome APIs.
// Detectors return candidates; the dedupe resolver and judgment layer
// decide what to do with them.
// ============================================================================

import type { Detection, DetectorSource } from '../../contracts/entities';

/** The interface every detector must implement. */
export interface Detector {
  /** Unique identifier for this detector (e.g., 'regex-ssn', 'dict-brands') */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Source category for attribution */
  readonly source: DetectorSource;
  /** Entity types this detector is authoritative for */
  readonly entityTypes: readonly string[];
  /** Run detection on the input text. Must be pure and side-effect-free. */
  detect(text: string): Detection[];
}

/** Registry of all active detectors. */
export class DetectorRegistry {
  private detectors: Detector[] = [];

  /** Register a detector. */
  register(detector: Detector): void {
    // Reject duplicate IDs
    if (this.detectors.some(d => d.id === detector.id)) {
      throw new Error(`Detector "${detector.id}" already registered`);
    }
    this.detectors.push(detector);
  }

  /** Run all detectors in parallel and return flattened results. */
  async detectAll(text: string): Promise<Detection[]> {
    const results = await Promise.all(
      this.detectors.map(async (d) => {
        try {
          return d.detect(text);
        } catch (err) {
          // Log but don't crash — one bad detector shouldn't kill the pipeline
          console.warn(`[DetectorRegistry] "${d.id}" threw:`, err);
          return [];
        }
      })
    );
    return results.flat();
  }

  /** Run all detectors synchronously (for environments where async is unnecessary). */
  detectAllSync(text: string): Detection[] {
    const results: Detection[] = [];
    for (const d of this.detectors) {
      try {
        results.push(...d.detect(text));
      } catch (err) {
        console.warn(`[DetectorRegistry] "${d.id}" threw:`, err);
      }
    }
    return results;
  }

  /** Get all registered detectors. */
  getAll(): readonly Detector[] {
    return this.detectors;
  }

  /** Get detector by ID. */
  get(id: string): Detector | undefined {
    return this.detectors.find(d => d.id === id);
  }
}
