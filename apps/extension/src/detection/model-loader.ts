/**
 * GLiNER PII Edge Model Loader & Entity Detector
 *
 * Downloads and caches the GLiNER PII Edge model (~46MB).
 * Uses @xenova/transformers for ONNX Runtime Web.
 *
 * GLiNER is a token-classification model that outputs per-token logits
 * for entity types. This module handles:
 *   1. Model loading + IndexedDB caching
 *   2. Tokenization
 *   3. Inference
 *   4. Span extraction (grouping consecutive same-label tokens)
 *   5. Non-maximum suppression for overlapping spans
 *   6. Label mapping to Iron Gate entity types
 */

import type { DetectedEntity, ModelStatus } from './types';
import { DEFAULT_ENTITY_TYPES } from './types';

let modelInstance: any = null;
let tokenizerInstance: any = null;
let modelStatus: ModelStatus = {
  loaded: false,
  loading: false,
  error: null,
  modelSize: 0,
  backend: 'none',
};

// GLiNER label → Iron Gate entity type mapping
const GLINER_LABEL_MAP: Record<string, string> = {
  // Standard NER labels
  'person': 'PERSON',
  'PER': 'PERSON',
  'PERSON': 'PERSON',
  'organization': 'ORGANIZATION',
  'ORG': 'ORGANIZATION',
  'ORGANIZATION': 'ORGANIZATION',
  'location': 'LOCATION',
  'LOC': 'LOCATION',
  'LOCATION': 'LOCATION',
  'GPE': 'LOCATION',
  // PII-specific labels from GLiNER PII Edge
  'email': 'EMAIL',
  'EMAIL': 'EMAIL',
  'phone': 'PHONE_NUMBER',
  'PHONE': 'PHONE_NUMBER',
  'phone_number': 'PHONE_NUMBER',
  'ssn': 'SSN',
  'SSN': 'SSN',
  'social_security_number': 'SSN',
  'credit_card': 'CREDIT_CARD',
  'CREDIT_CARD': 'CREDIT_CARD',
  'date': 'DATE',
  'DATE': 'DATE',
  'date_of_birth': 'DATE',
  'ip_address': 'IP_ADDRESS',
  'IP_ADDRESS': 'IP_ADDRESS',
  'address': 'ADDRESS',
  'ADDRESS': 'ADDRESS',
  'passport': 'PASSPORT_NUMBER',
  'PASSPORT': 'PASSPORT_NUMBER',
  'driver_license': 'DRIVERS_LICENSE',
  'DRIVER_LICENSE': 'DRIVERS_LICENSE',
  'medical_record': 'MEDICAL_RECORD',
  'MEDICAL_RECORD': 'MEDICAL_RECORD',
  'account_number': 'ACCOUNT_NUMBER',
  'ACCOUNT_NUMBER': 'ACCOUNT_NUMBER',
  'money': 'MONETARY_AMOUNT',
  'MONEY': 'MONETARY_AMOUNT',
  'monetary_amount': 'MONETARY_AMOUNT',
};

export function getModelStatus(): ModelStatus {
  return { ...modelStatus };
}

export async function loadModel(
  onProgress?: (progress: { loaded: number; total: number; status: string }) => void,
): Promise<void> {
  if (modelInstance || modelStatus.loading) return;

  modelStatus = { ...modelStatus, loading: true, error: null };

  try {
    // Dynamic import to avoid loading the large library eagerly
    // @ts-ignore
    const { env, AutoModel, AutoTokenizer } = await import('@xenova/transformers');

    // Configure to use WebGPU when available, fallback to WASM
    env.backends.onnx.executionProviders = ['webgpu', 'wasm'];
    env.allowLocalModels = false;

    console.log('[Iron Gate] Loading GLiNER PII Edge model...');
    const startTime = performance.now();

    // This will download ~46MB on first load, then cache in IndexedDB
    const modelOpts: any = { quantized: true };
    if (onProgress) {
      modelOpts.progress_callback = (p: any) => {
        onProgress({
          loaded: p.loaded || 0,
          total: p.total || 46_000_000,
          status: p.status || 'downloading',
        });
      };
    }

    modelInstance = await AutoModel.from_pretrained(
      'knowledgator/gliner-pii-edge-v1.0',
      modelOpts,
    );

    tokenizerInstance = await AutoTokenizer.from_pretrained(
      'knowledgator/gliner-pii-edge-v1.0',
    );

    const loadTime = performance.now() - startTime;
    console.log(`[Iron Gate] Model loaded in ${loadTime.toFixed(0)}ms`);

    // Detect backend
    const backend = (typeof navigator !== 'undefined' && 'gpu' in navigator)
      ? 'webgpu'
      : 'wasm';

    modelStatus = {
      loaded: true,
      loading: false,
      error: null,
      modelSize: 46_000_000, // ~46MB
      backend,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error loading model';
    console.error('[Iron Gate] Failed to load model:', message);
    modelStatus = {
      loaded: false,
      loading: false,
      error: message,
      modelSize: 0,
      backend: 'none',
    };
    throw error;
  }
}

/**
 * Run GLiNER NER on input text.
 * Returns detected entities with character-level positions.
 */
export async function detectEntities(
  text: string,
  entityTypes: readonly string[] = DEFAULT_ENTITY_TYPES,
  confidenceThreshold = 0.5,
): Promise<DetectedEntity[]> {
  if (!modelInstance || !tokenizerInstance) {
    await loadModel();
  }

  if (!modelInstance || !tokenizerInstance) {
    throw new Error('Model failed to load');
  }

  try {
    const startTime = performance.now();

    // Truncate to model's max sequence length
    const truncatedText = text.substring(0, 512);

    // Tokenize the input
    const inputs = tokenizerInstance(truncatedText, {
      return_tensors: 'np',
      padding: true,
      truncation: true,
      max_length: 512,
      return_offsets_mapping: true,
    });

    // Run inference
    const output = await modelInstance(inputs);

    // Extract entities from model output
    const entities = extractSpans(
      output,
      inputs,
      truncatedText,
      entityTypes,
      confidenceThreshold,
    );

    // Apply NMS to remove overlapping predictions
    const finalEntities = nonMaxSuppression(entities, 0.5);

    const processingTime = performance.now() - startTime;
    console.log(`[Iron Gate] GLiNER detection: ${finalEntities.length} entities in ${processingTime.toFixed(1)}ms`);

    return finalEntities;
  } catch (error) {
    console.error('[Iron Gate] Detection error:', error);
    return [];
  }
}

/**
 * Extract entity spans from model output.
 *
 * GLiNER models output logits of shape [batch, seq_len, num_labels].
 * We use argmax to find the predicted label for each token, then
 * group consecutive tokens with the same label into spans.
 *
 * If offset_mapping is available from the tokenizer, we use it to
 * map token positions back to character positions in the original text.
 */
function extractSpans(
  output: any,
  inputs: any,
  text: string,
  entityTypes: readonly string[],
  threshold: number,
): DetectedEntity[] {
  const entities: DetectedEntity[] = [];

  if (!output?.logits) return entities;

  const logits = output.logits;

  // Handle different output formats
  // Format 1: logits as nested array [batch][seq_len][num_labels]
  if (Array.isArray(logits) || logits?.data) {
    const logitData = logits.data || logits;
    const shape = logits.dims || logits.shape;

    if (!shape || shape.length < 2) return entities;

    const seqLen = shape[shape.length - 2] || 0;
    const numLabels = shape[shape.length - 1] || 0;

    // Get offset mapping for character positions
    const offsets = inputs?.offset_mapping?.data || inputs?.offset_mapping;

    // Extract per-token predictions
    type TokenPred = { labelIdx: number; confidence: number; start: number; end: number };
    const predictions: TokenPred[] = [];

    for (let t = 0; t < seqLen; t++) {
      let maxIdx = 0;
      let maxVal = -Infinity;
      const base = t * numLabels;

      for (let l = 0; l < numLabels; l++) {
        const val = typeof logitData[base + l] === 'number'
          ? logitData[base + l]
          : (logitData as any).data?.[base + l] ?? 0;
        if (val > maxVal) {
          maxVal = val;
          maxIdx = l;
        }
      }

      // Apply softmax-like confidence (sigmoid for simplicity)
      const confidence = 1 / (1 + Math.exp(-maxVal));

      // Label 0 is typically "O" (Outside) — skip
      if (maxIdx === 0 || confidence < threshold) continue;

      // Get character offsets
      let charStart = t;
      let charEnd = t + 1;
      if (offsets && offsets.length >= (t + 1) * 2) {
        charStart = offsets[t * 2] ?? t;
        charEnd = offsets[t * 2 + 1] ?? (t + 1);
      }

      predictions.push({
        labelIdx: maxIdx,
        confidence,
        start: charStart,
        end: charEnd,
      });
    }

    // Group consecutive tokens with same label into spans
    let spanStart = -1;
    let spanEnd = -1;
    let spanLabel = -1;
    let spanConfSum = 0;
    let spanTokenCount = 0;

    const flushSpan = () => {
      if (spanLabel <= 0 || spanStart < 0) return;

      const spanText = text.substring(spanStart, spanEnd).trim();
      if (spanText.length < 2) return; // Skip single-char entities

      const avgConfidence = spanConfSum / spanTokenCount;
      const labelName = resolveLabelName(spanLabel, entityTypes, numLabels);

      entities.push({
        type: labelName,
        text: spanText,
        start: spanStart,
        end: spanEnd,
        confidence: avgConfidence,
        source: 'gliner',
      });
    };

    for (const pred of predictions) {
      if (pred.labelIdx === spanLabel && pred.start <= spanEnd + 1) {
        // Extend current span
        spanEnd = Math.max(spanEnd, pred.end);
        spanConfSum += pred.confidence;
        spanTokenCount++;
      } else {
        // Flush previous span, start new one
        flushSpan();
        spanStart = pred.start;
        spanEnd = pred.end;
        spanLabel = pred.labelIdx;
        spanConfSum = pred.confidence;
        spanTokenCount = 1;
      }
    }
    flushSpan(); // Flush last span
  }

  return entities;
}

/**
 * Map a label index to an Iron Gate entity type name.
 */
function resolveLabelName(
  labelIdx: number,
  entityTypes: readonly string[],
  numLabels: number,
): string {
  // If the model has a label list matching entityTypes, use direct mapping
  // Label 0 = "O" (outside), labels 1+ map to entity types
  // BIO scheme: odd indices = B-type, even indices = I-type
  const typeIdx = Math.floor((labelIdx - 1) / 2);
  if (typeIdx >= 0 && typeIdx < entityTypes.length) {
    const rawLabel = entityTypes[typeIdx];
    return GLINER_LABEL_MAP[rawLabel] || rawLabel;
  }

  // Fallback: map by label index directly
  if (labelIdx > 0 && labelIdx <= numLabels) {
    return `ENTITY_${labelIdx}`;
  }

  return 'UNKNOWN';
}

/**
 * Non-maximum suppression for overlapping entity spans.
 * Keeps the span with highest confidence when two spans overlap.
 */
function nonMaxSuppression(entities: DetectedEntity[], iouThreshold: number): DetectedEntity[] {
  if (entities.length <= 1) return entities;

  // Sort by confidence (highest first)
  const sorted = [...entities].sort((a, b) => b.confidence - a.confidence);
  const kept: DetectedEntity[] = [];
  const suppressed = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (suppressed.has(i)) continue;
    kept.push(sorted[i]);

    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed.has(j)) continue;

      const overlap = computeOverlap(sorted[i], sorted[j]);
      if (overlap > iouThreshold) {
        suppressed.add(j);
      }
    }
  }

  return kept;
}

/**
 * Compute overlap ratio (IoU-like) between two spans.
 */
function computeOverlap(a: DetectedEntity, b: DetectedEntity): number {
  const overlapStart = Math.max(a.start, b.start);
  const overlapEnd = Math.min(a.end, b.end);

  if (overlapStart >= overlapEnd) return 0;

  const overlapLen = overlapEnd - overlapStart;
  const unionLen = Math.max(a.end, b.end) - Math.min(a.start, b.start);

  return unionLen > 0 ? overlapLen / unionLen : 0;
}

export function isModelLoaded(): boolean {
  return modelStatus.loaded;
}

export function unloadModel(): void {
  modelInstance = null;
  tokenizerInstance = null;
  modelStatus = {
    loaded: false,
    loading: false,
    error: null,
    modelSize: 0,
    backend: 'none',
  };
}
