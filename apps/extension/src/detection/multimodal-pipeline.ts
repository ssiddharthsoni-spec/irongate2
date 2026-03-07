/**
 * Multimodal Detection Pipeline — IG-021
 *
 * Orchestrates PII/sensitive-data detection across multiple modalities
 * (text, images, files, clipboard) and produces a unified result.
 *
 * Each input is processed in parallel. Text and clipboard inputs use the
 * regex detection + scoring pipeline. Image inputs are OCR'd via Tesseract.js.
 * File inputs have their text extracted based on MIME type before scanning.
 *
 * The aggregated score is the maximum across all per-input scores, and
 * entities are deduplicated by (text, type) across inputs.
 */

import type { DetectedEntity } from './types';
import { detectWithRegex } from './fallback-regex';
import { computeScore, scoreToLevel } from './scorer';
import { scanImage } from './ocr-worker';
import { scoreToZone, type Zone } from './confidence-router';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Modality = 'text' | 'image' | 'file' | 'clipboard';

export interface MultimodalInput {
  modality: Modality;
  content: string;        // text content or base64 for images
  mimeType?: string;      // e.g., 'image/png', 'text/csv'
  fileName?: string;      // original filename if from file upload
  source: string;         // where it came from: 'textarea', 'file-upload', 'paste', 'drag-drop'
}

export interface MultimodalDetectionResult {
  inputs: MultimodalInput[];
  aggregatedEntities: DetectedEntity[];
  aggregatedScore: number;
  aggregatedLevel: string;
  aggregatedZone: Zone;
  perInputResults: PerInputResult[];
  processingTimeMs: number;
}

export interface PerInputResult {
  input: MultimodalInput;
  entities: DetectedEntity[];
  score: number;
  level: string;
  processingTimeMs: number;
  ocrConfidence?: number;  // only for image modality
}

// ─── Image MIME helpers ──────────────────────────────────────────────────────

const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/gif',
  'image/svg+xml',
]);

/**
 * Returns true if the given MIME type is a recognised image type.
 */
export function isImageMimeType(mime: string): boolean {
  return IMAGE_MIME_TYPES.has(mime.toLowerCase().trim());
}

// ─── File text extraction ────────────────────────────────────────────────────

/**
 * Attempt to extract readable text from a file's content based on its MIME type.
 *
 * - `text/*` types (text/plain, text/csv, text/html, etc.) are returned as-is.
 * - `application/json` is returned as-is.
 * - All other types return `null` (unsupported).
 */
export function extractTextFromFile(content: string, mimeType: string): string | null {
  const mime = mimeType.toLowerCase().trim();

  if (mime.startsWith('text/')) {
    return content;
  }

  if (mime === 'application/json') {
    return content;
  }

  return null;
}

// ─── Per-input processors ────────────────────────────────────────────────────

async function processTextInput(input: MultimodalInput): Promise<PerInputResult> {
  const start = performance.now();

  const entities = detectWithRegex(input.content);
  const scoreResult = computeScore(input.content, entities);

  return {
    input,
    entities,
    score: scoreResult.score,
    level: scoreResult.level,
    processingTimeMs: performance.now() - start,
  };
}

async function processImageInput(input: MultimodalInput): Promise<PerInputResult> {
  const start = performance.now();

  const ocrDetection = await scanImage(input.content, input.mimeType ?? 'image/png');

  return {
    input,
    entities: ocrDetection.entities,
    score: ocrDetection.sensitivityScore,
    level: ocrDetection.sensitivityLevel,
    processingTimeMs: performance.now() - start,
    ocrConfidence: ocrDetection.ocrResult.confidence,
  };
}

async function processFileInput(input: MultimodalInput): Promise<PerInputResult> {
  const start = performance.now();
  const mime = input.mimeType ?? 'application/octet-stream';

  // If the file is actually an image, delegate to the image processor
  if (isImageMimeType(mime)) {
    return processImageInput({ ...input, modality: 'image' });
  }

  const extracted = extractTextFromFile(input.content, mime);

  if (extracted === null) {
    console.warn(
      `[Iron Gate Multimodal] Unsupported file type "${mime}"${input.fileName ? ` (${input.fileName})` : ''}. Skipping detection.`,
    );
    return {
      input,
      entities: [],
      score: 0,
      level: 'low',
      processingTimeMs: performance.now() - start,
    };
  }

  const entities = detectWithRegex(extracted);
  const scoreResult = computeScore(extracted, entities);

  return {
    input,
    entities,
    score: scoreResult.score,
    level: scoreResult.level,
    processingTimeMs: performance.now() - start,
  };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

function processInput(input: MultimodalInput): Promise<PerInputResult> {
  switch (input.modality) {
    case 'text':
    case 'clipboard':
      return processTextInput(input);
    case 'image':
      return processImageInput(input);
    case 'file':
      return processFileInput(input);
    default: {
      // Exhaustiveness guard — treat unknown modality as text
      const _exhaustive: never = input.modality;
      console.warn(`[Iron Gate Multimodal] Unknown modality "${_exhaustive}", falling back to text.`);
      return processTextInput(input);
    }
  }
}

// ─── Entity deduplication ────────────────────────────────────────────────────

function deduplicateEntities(allEntities: DetectedEntity[]): DetectedEntity[] {
  const seen = new Map<string, DetectedEntity>();

  for (const entity of allEntities) {
    const key = `${entity.type}::${entity.text}`;
    const existing = seen.get(key);

    if (!existing || entity.confidence > existing.confidence) {
      seen.set(key, entity);
    }
  }

  return Array.from(seen.values());
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Run the multimodal detection pipeline across one or more inputs.
 *
 * All inputs are processed in parallel via `Promise.allSettled`.
 * The aggregated score is the **maximum** across all per-input scores,
 * and entities are deduplicated by (type, text).
 */
export async function detectMultimodal(
  inputs: MultimodalInput[],
): Promise<MultimodalDetectionResult> {
  const overallStart = performance.now();

  if (inputs.length === 0) {
    return {
      inputs,
      aggregatedEntities: [],
      aggregatedScore: 0,
      aggregatedLevel: 'low',
      aggregatedZone: 'green',
      perInputResults: [],
      processingTimeMs: performance.now() - overallStart,
    };
  }

  const settled = await Promise.allSettled(inputs.map(processInput));

  const perInputResults: PerInputResult[] = [];

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    if (outcome.status === 'fulfilled') {
      perInputResults.push(outcome.value);
    } else {
      // Record a failed input as zero-score so we don't lose track of it
      console.error(
        `[Iron Gate Multimodal] Failed to process input #${i} (${inputs[i].modality}):`,
        outcome.reason,
      );
      perInputResults.push({
        input: inputs[i],
        entities: [],
        score: 0,
        level: 'low',
        processingTimeMs: 0,
      });
    }
  }

  // Aggregate: collect all entities and deduplicate
  const allEntities: DetectedEntity[] = [];
  for (const result of perInputResults) {
    allEntities.push(...result.entities);
  }
  const aggregatedEntities = deduplicateEntities(allEntities);

  // Aggregate: max score across inputs
  const aggregatedScore = perInputResults.reduce(
    (max, r) => Math.max(max, r.score),
    0,
  );

  const aggregatedLevel = scoreToLevel(aggregatedScore);
  const aggregatedZone = scoreToZone(aggregatedScore);
  const processingTimeMs = performance.now() - overallStart;

  return {
    inputs,
    aggregatedEntities,
    aggregatedScore,
    aggregatedLevel,
    aggregatedZone,
    perInputResults,
    processingTimeMs,
  };
}
