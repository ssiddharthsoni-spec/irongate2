/**
 * Downloads and caches the GLiNER PII Edge model.
 * Model is ~46MB, stored in IndexedDB for persistence.
 * Uses @xenova/transformers for ONNX Runtime Web.
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

export function getModelStatus(): ModelStatus {
  return { ...modelStatus };
}

export async function loadModel(): Promise<void> {
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
    modelInstance = await AutoModel.from_pretrained(
      'knowledgator/gliner-pii-edge-v1.0',
      { quantized: true }
    );

    tokenizerInstance = await AutoTokenizer.from_pretrained(
      'knowledgator/gliner-pii-edge-v1.0'
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

export async function detectEntities(
  text: string,
  entityTypes: readonly string[] = DEFAULT_ENTITY_TYPES
): Promise<DetectedEntity[]> {
  if (!modelInstance || !tokenizerInstance) {
    await loadModel();
  }

  if (!modelInstance || !tokenizerInstance) {
    throw new Error('Model failed to load');
  }

  try {
    const startTime = performance.now();

    // Tokenize the input
    const inputs = tokenizerInstance(text, {
      return_tensors: 'np',
      padding: true,
      truncation: true,
      max_length: 512,
    });

    // Run inference
    const output = await modelInstance(inputs);

    // Parse the model output into DetectedEntity objects
    const entities: DetectedEntity[] = [];

    if (output?.logits) {
      // Process model output - exact format depends on model architecture
      // GLiNER outputs entity spans with type classifications
      const predictions = output.logits;

      // Extract entities from predictions
      // This is a simplified extraction - real implementation needs
      // to handle the specific GLiNER output format
      for (let i = 0; i < predictions.length; i++) {
        const pred = predictions[i];
        if (pred && pred.confidence > 0.5) {
          entities.push({
            type: pred.entityType || entityTypes[pred.typeIndex] || 'UNKNOWN',
            text: text.substring(pred.start, pred.end),
            start: pred.start,
            end: pred.end,
            confidence: pred.confidence,
            source: 'gliner',
          });
        }
      }
    }

    const processingTime = performance.now() - startTime;
    console.log(`[Iron Gate] GLiNER detection: ${entities.length} entities in ${processingTime.toFixed(1)}ms`);

    return entities;
  } catch (error) {
    console.error('[Iron Gate] Detection error:', error);
    return [];
  }
}

export function isModelLoaded(): boolean {
  return modelStatus.loaded;
}
