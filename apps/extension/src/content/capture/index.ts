/**
 * Capture Engine — orchestrates all capture methods.
 * Creates a unified interface for the content script to interact with.
 */

import { createDOMObserver, type DOMObserverHandle } from './dom-observer';
import { installFetchInterceptor, extractPromptFromPayload, replacePromptInPayload, type InterceptedRequest, type BodyTransformer } from './fetch-interceptor';
import { installSubmitHandler, type SubmitHandlerHandle, type SubmitMode } from './submit-handler';
import { createClipboardMonitor, type ClipboardMonitorHandle, type ClipboardEvent as IronClipboardEvent } from './clipboard-monitor';
import { createFileUploadMonitor, type FileUploadMonitorHandle, type FileUploadEvent } from './file-upload-monitor';
import { showBlockOverlay } from '../ui/block-overlay';
import { showScanIndicator, hideScanIndicator } from '../ui/scan-indicator';
import { injectProxyResponse } from '../ui/response-injector';
import { detectWithRegex } from '../../detection/fallback-regex';
import { computeScore } from '../../detection/scorer';
import { pseudonymizeLocal } from '../../detection/pseudonymizer';
import { scanForSecrets } from '../../worker/detectors/secret-scanner';

interface AIToolDetector {
  id: string;
  name: string;
  getPromptInput(): HTMLElement | null;
  getSubmitTrigger(): HTMLElement | null;
  extractPromptText(input: HTMLElement): string;
  injectResponse?(container: HTMLElement, text: string): void;
  isGenerating(): boolean;
}

interface CaptureEngineConfig {
  mode: SubmitMode;
}

export interface CaptureEngine {
  start(): void;
  stop(): void;
  updateConfig(config: Partial<CaptureEngineConfig>): void;
}

export function createCaptureEngine(detector: AIToolDetector): CaptureEngine {
  let domObserver: DOMObserverHandle | null = null;
  let fetchCleanup: (() => void) | null = null;
  let submitHandler: SubmitHandlerHandle | null = null;
  let clipboardMonitor: ClipboardMonitorHandle | null = null;
  let fileUploadMonitor: FileUploadMonitorHandle | null = null;
  let config: CaptureEngineConfig = { mode: 'audit' };

  // Send message to service worker
  function sendToWorker(type: string, payload: any) {
    try {
      chrome.runtime.sendMessage({ type, payload });
    } catch (error) {
      // Extension context may be invalidated on update
      console.warn('[Iron Gate] Failed to send message to worker:', error);
    }
  }

  // Handler: real-time typing detection
  function onPromptChange(text: string) {
    sendToWorker('PROMPT_DETECTED', {
      text,
      aiToolId: detector.id,
      captureMethod: 'dom',
    });
  }

  // Handler: fetch interception (ground truth)
  function onFetchRequest(request: InterceptedRequest) {
    const promptText = extractPromptFromPayload(request.body);
    if (promptText) {
      sendToWorker('PROMPT_DETECTED', {
        text: promptText,
        aiToolId: detector.id,
        captureMethod: 'fetch',
      });
    }
  }

  // Handler: submit detection
  async function onSubmit(promptText: string): Promise<'allow' | 'intercept'> {
    // In audit mode, send event and always allow
    if (config.mode === 'audit') {
      sendToWorker('PROMPT_SUBMITTED', {
        text: promptText,
        aiToolId: detector.id,
        captureMethod: 'submit',
      });
      return 'allow';
    }

    // In proxy mode, run LOCAL detection + pseudonymization
    // This works entirely client-side — no backend auth required
    try {
      // 1. Detect entities locally
      const regexEntities = detectWithRegex(promptText);
      const secrets = scanForSecrets(promptText);
      const allEntities = [
        ...regexEntities,
        ...secrets.map((s) => ({
          type: s.type,
          text: s.text,
          start: s.start,
          end: s.end,
          confidence: s.confidence,
          source: s.source as 'regex',
        })),
      ];

      // 2. Score sensitivity
      const scoreResult = computeScore(promptText, allEntities);
      console.log(`[Iron Gate] Proxy mode — local score: ${scoreResult.score} (${scoreResult.level}), entities: ${allEntities.length}`);

      // 3. High/Critical sensitivity — block and show overlay
      if (scoreResult.level === 'critical' || scoreResult.level === 'high') {
        const entityCounts = new Map<string, number>();
        for (const e of allEntities) {
          entityCounts.set(e.type, (entityCounts.get(e.type) || 0) + 1);
        }
        const overlayResult = await showBlockOverlay({
          score: scoreResult.score,
          level: scoreResult.level,
          entities: Array.from(entityCounts.entries()).map(([type, count]) => ({ type, count })),
          explanation: scoreResult.explanation || 'High sensitivity content detected.',
        });
        if (overlayResult.action === 'allow' && overlayResult.overrideReason) {
          sendToWorker('BLOCK_OVERRIDE', {
            eventId: crypto.randomUUID(),
            reason: overlayResult.overrideReason,
          });
          return 'allow';
        }
        return 'intercept';
      }

      // 4. Medium sensitivity — pseudonymize and let through
      if (scoreResult.level === 'medium' && allEntities.length > 0) {
        const pseudoResult = pseudonymizeLocal(promptText, allEntities);
        console.log(`[Iron Gate] Pseudonymized ${allEntities.length} entities in prompt`);

        // Replace the prompt text in the input field with pseudonymized version
        const input = detector.getPromptInput();
        if (input) {
          if (input instanceof HTMLTextAreaElement) {
            input.value = pseudoResult.maskedText;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            input.innerText = pseudoResult.maskedText;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }

        // Notify worker about the pseudonymized submit
        sendToWorker('PROMPT_SUBMITTED', {
          text: promptText,
          aiToolId: detector.id,
          captureMethod: 'submit',
          action: 'pseudonymized',
          entitiesReplaced: allEntities.length,
        });

        // Allow the submit to proceed with the pseudonymized text
        return 'allow';
      }

      // 5. Low sensitivity — allow passthrough unchanged
      sendToWorker('PROMPT_SUBMITTED', {
        text: promptText,
        aiToolId: detector.id,
        captureMethod: 'submit',
        action: 'pass',
      });
      return 'allow';
    } catch (error) {
      console.error('[Iron Gate] Proxy mode error, falling back to allow:', error);
      return 'allow';
    }
  }

  // Handler: file upload detected
  async function onFileUpload(event: FileUploadEvent) {
    console.log(`[Iron Gate] File upload detected: ${event.fileName} (${event.fileSize} bytes)`);

    // Send to service worker for analysis
    try {
      const result = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'FILE_UPLOAD_DETECTED',
            payload: {
              ...event,
              aiToolId: detector.id,
            },
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          }
        );
      });

      // If high/critical sensitivity, show block overlay
      if (result && !result.error && (result.level === 'high' || result.level === 'critical')) {
        const entityCounts = new Map<string, number>();
        for (const e of result.entities || []) {
          entityCounts.set(e.type, (entityCounts.get(e.type) || 0) + 1);
        }
        await showBlockOverlay({
          score: result.score,
          level: result.level,
          entities: Array.from(entityCounts.entries()).map(([type, count]) => ({ type, count })),
          explanation: result.explanation || `Document "${event.fileName}" contains sensitive information.`,
        });
      }
    } catch (err) {
      console.warn('[Iron Gate] File analysis failed:', err);
    }
  }

  // Handler: file detected in FormData during fetch interception
  // Returns 'allow' or 'block' — the fetch interceptor holds until this resolves
  async function onFileInFormData(file: File): Promise<'allow' | 'block'> {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['pdf', 'docx', 'xlsx', 'txt', 'csv'].includes(ext)) return 'allow';
    if (file.size > 10 * 1024 * 1024) return 'allow';

    // Show scanning indicator
    const indicator = showScanIndicator(file.name);

    try {
      // Read file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          resolve(dataUrl.split(',')[1] || '');
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      // Send to service worker for scanning and await result
      const result = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'FILE_UPLOAD_DETECTED',
            payload: {
              fileName: file.name,
              fileSize: file.size,
              fileType: ext,
              fileBase64: base64,
              aiToolId: detector.id,
              timestamp: Date.now(),
            },
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          }
        );
      });

      indicator.remove();

      // If scan failed or returned no result, allow through
      if (!result || result.error) {
        console.warn('[Iron Gate] File scan failed, allowing through:', result?.error);
        return 'allow';
      }

      // If high/critical sensitivity, show block overlay
      if (result.level === 'high' || result.level === 'critical') {
        const entityCounts = new Map<string, number>();
        for (const e of result.entities || []) {
          entityCounts.set(e.type, (entityCounts.get(e.type) || 0) + 1);
        }
        const overlayResult = await showBlockOverlay({
          score: result.score,
          level: result.level,
          entities: Array.from(entityCounts.entries()).map(([type, count]) => ({ type, count })),
          explanation: result.explanation || `Document "${file.name}" contains sensitive information.`,
        });

        if (overlayResult.action === 'allow' && overlayResult.overrideReason) {
          sendToWorker('BLOCK_OVERRIDE', {
            eventId: crypto.randomUUID(),
            reason: overlayResult.overrideReason,
            fileName: file.name,
          });
          return 'allow';
        }

        return 'block';
      }

      // Low/medium — allow through
      return 'allow';
    } catch (err) {
      indicator.remove();
      console.warn('[Iron Gate] File scan error, allowing through:', err);
      return 'allow';
    }
  }

  // Handler: clipboard paste
  function onPaste(event: IronClipboardEvent) {
    sendToWorker('CLIPBOARD_PASTE', {
      pastedLength: event.pastedLength,
      sourceType: event.sourceType,
      aiToolId: detector.id,
      timestamp: event.timestamp,
    });

    // If paste is large, it's a risk signal — capture the text for scoring
    if (event.pastedLength > 200) {
      sendToWorker('PROMPT_DETECTED', {
        text: event.pastedText,
        aiToolId: detector.id,
        captureMethod: 'clipboard',
      });
    }
  }

  // Body transformer for proxy mode — pseudonymizes prompt text in LLM API requests
  function createBodyTransformer(): BodyTransformer {
    return (url: string, body: any): { transformed: string; originalPrompt: string; maskedPrompt: string } | null => {
      if (config.mode !== 'proxy') return null;

      const promptText = extractPromptFromPayload(body);
      if (!promptText || promptText.length < 10) return null;

      // Run local detection
      const regexEntities = detectWithRegex(promptText);
      const secrets = scanForSecrets(promptText);
      const allEntities = [
        ...regexEntities,
        ...secrets.map((s) => ({
          type: s.type,
          text: s.text,
          start: s.start,
          end: s.end,
          confidence: s.confidence,
          source: s.source as 'regex',
        })),
      ];

      if (allEntities.length === 0) return null;

      // Score
      const scoreResult = computeScore(promptText, allEntities);

      // Only pseudonymize for medium+ sensitivity
      if (scoreResult.level === 'low') return null;

      // Pseudonymize
      const pseudoResult = pseudonymizeLocal(promptText, allEntities);

      // Replace the prompt in the request body
      const replacedBody = replacePromptInPayload(body, pseudoResult.maskedText);
      if (!replacedBody) return null;

      const transformedStr = JSON.stringify(replacedBody);
      console.log(`[Iron Gate] Proxy: pseudonymized ${allEntities.length} entities (score: ${scoreResult.score}, level: ${scoreResult.level})`);

      // Notify worker about the transformation
      sendToWorker('PROMPT_PSEUDONYMIZED', {
        aiToolId: detector.id,
        originalLength: promptText.length,
        maskedLength: pseudoResult.maskedText.length,
        entitiesReplaced: allEntities.length,
        score: scoreResult.score,
        level: scoreResult.level,
      });

      return {
        transformed: transformedStr,
        originalPrompt: promptText,
        maskedPrompt: pseudoResult.maskedText,
      };
    };
  }

  return {
    start() {
      console.log(`[Iron Gate] Starting capture engine for ${detector.name}`);

      // 1. Install fetch interceptor FIRST (needs to be before page scripts)
      fetchCleanup = installFetchInterceptor(onFetchRequest, onFileInFormData, createBodyTransformer());

      // 2. Start DOM observer for real-time typing
      domObserver = createDOMObserver(detector, onPromptChange);

      // 3. Install submit handler
      submitHandler = installSubmitHandler(detector, {
        mode: config.mode,
        onSubmit,
      });

      // 4. Start clipboard monitor
      clipboardMonitor = createClipboardMonitor(detector, onPaste);

      // 5. Start file upload monitor
      fileUploadMonitor = createFileUploadMonitor(onFileUpload);

      console.log(`[Iron Gate] Capture engine started for ${detector.name}`);
    },

    stop() {
      domObserver?.disconnect();
      fetchCleanup?.();
      submitHandler?.destroy();
      clipboardMonitor?.destroy();
      fileUploadMonitor?.destroy();

      domObserver = null;
      fetchCleanup = null;
      submitHandler = null;
      clipboardMonitor = null;
      fileUploadMonitor = null;

      console.log(`[Iron Gate] Capture engine stopped for ${detector.name}`);
    },

    updateConfig(newConfig: Partial<CaptureEngineConfig>) {
      if (newConfig.mode !== undefined) {
        config.mode = newConfig.mode;
        submitHandler?.updateMode(newConfig.mode);
        // Note: bodyTransformer reads config.mode dynamically, so no need to reinstall
        console.log(`[Iron Gate] Capture engine mode updated to: ${config.mode}`);
      }
    },
  };
}
