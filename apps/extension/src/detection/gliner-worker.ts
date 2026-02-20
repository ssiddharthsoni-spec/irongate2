/**
 * Web Worker that runs GLiNER inference off the main thread.
 * Content script posts prompt text to this worker,
 * worker returns detection results.
 *
 * This ensures ML inference never blocks the UI.
 */

import { detectEntities, loadModel, isModelLoaded, getModelStatus } from './model-loader';
import { detectWithRegex } from './fallback-regex';
import type { DetectedEntity, DetectionResult } from './types';
import { DEFAULT_ENTITY_TYPES } from './types';

interface WorkerMessage {
  type: 'detect' | 'load_model' | 'get_status';
  requestId: string;
  text?: string;
  entityTypes?: string[];
}

interface WorkerResponse {
  requestId: string;
  type: 'detection_result' | 'model_loaded' | 'status' | 'error';
  result?: DetectionResult;
  status?: any;
  error?: string;
}

// Initialize model on worker start
loadModel().catch((err) => {
  console.warn('[Iron Gate Worker] Model pre-load failed, will use regex fallback:', err.message);
});

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, requestId, text, entityTypes } = event.data;
  const startTime = performance.now();

  try {
    switch (type) {
      case 'detect': {
        if (!text) {
          throw new Error('No text provided for detection');
        }

        let entities: DetectedEntity[];
        let modelUsed: 'gliner' | 'regex';

        if (isModelLoaded()) {
          // Use GLiNER model
          entities = await detectEntities(text, entityTypes || DEFAULT_ENTITY_TYPES);
          modelUsed = 'gliner';
        } else {
          // Fallback to regex
          entities = detectWithRegex(text);
          modelUsed = 'regex';
        }

        const processingTimeMs = performance.now() - startTime;

        const response: WorkerResponse = {
          requestId,
          type: 'detection_result',
          result: {
            entities,
            processingTimeMs,
            modelUsed,
          },
        };

        self.postMessage(response);
        break;
      }

      case 'load_model': {
        await loadModel();
        const response: WorkerResponse = {
          requestId,
          type: 'model_loaded',
          status: getModelStatus(),
        };
        self.postMessage(response);
        break;
      }

      case 'get_status': {
        const response: WorkerResponse = {
          requestId,
          type: 'status',
          status: getModelStatus(),
        };
        self.postMessage(response);
        break;
      }
    }
  } catch (error) {
    const response: WorkerResponse = {
      requestId,
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    self.postMessage(response);
  }
};
