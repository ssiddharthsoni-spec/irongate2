/**
 * NER Offscreen Worker
 *
 * Chrome MV3 service workers have limited support for ONNX Runtime Web
 * (no DOM APIs, WebAssembly restrictions). This offscreen document
 * provides a full browser context for running the GLiNER model.
 *
 * Communication:
 *   Service Worker → (chrome.runtime.sendMessage) → Offscreen Document
 *   Offscreen Document → (sendResponse) → Service Worker
 *
 * Lifecycle:
 *   - Created on first NER_CLASSIFY request
 *   - Kept alive during active use
 *   - Auto-destroyed after 5 minutes of idle
 */

import { loadModel, detectEntities, isModelLoaded, getModelStatus, unloadModel } from '../detection/model-loader';
import type { DetectedEntity } from '../detection/types';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log('[Iron Gate NER] Idle timeout — unloading model');
    unloadModel();
  }, IDLE_TIMEOUT_MS);
}

// ── Message Handler ──────────────────────────────────────────────────────────

interface NERRequest {
  type: 'NER_CLASSIFY' | 'NER_STATUS' | 'NER_PRELOAD';
  text?: string;
  entityTypes?: string[];
  confidenceThreshold?: number;
}

interface NERResponse {
  type: 'NER_RESULT' | 'NER_STATUS_RESULT' | 'NER_ERROR';
  entities?: DetectedEntity[];
  status?: ReturnType<typeof getModelStatus>;
  error?: string;
  latencyMs?: number;
}

chrome.runtime.onMessage.addListener(
  (message: NERRequest, _sender, sendResponse: (response: NERResponse) => void) => {
    if (!message?.type) return false;

    switch (message.type) {
      case 'NER_CLASSIFY': {
        resetIdleTimer();
        const start = performance.now();

        (async () => {
          try {
            if (!isModelLoaded()) {
              await loadModel();
            }

            const entities = await detectEntities(
              message.text || '',
              message.entityTypes,
              message.confidenceThreshold ?? 0.5,
            );

            sendResponse({
              type: 'NER_RESULT',
              entities,
              latencyMs: performance.now() - start,
            });
          } catch (err) {
            sendResponse({
              type: 'NER_ERROR',
              error: err instanceof Error ? err.message : String(err),
              latencyMs: performance.now() - start,
            });
          }
        })();

        return true; // Async response
      }

      case 'NER_STATUS': {
        sendResponse({
          type: 'NER_STATUS_RESULT',
          status: getModelStatus(),
        });
        return false;
      }

      case 'NER_PRELOAD': {
        resetIdleTimer();
        (async () => {
          try {
            await loadModel();
            sendResponse({
              type: 'NER_STATUS_RESULT',
              status: getModelStatus(),
            });
          } catch (err) {
            sendResponse({
              type: 'NER_ERROR',
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return true; // Async response
      }

      default:
        return false;
    }
  },
);

console.log('[Iron Gate NER] Offscreen worker initialized');
resetIdleTimer();
