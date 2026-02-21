/**
 * Capture Engine — orchestrates all capture methods.
 * Creates a unified interface for the content script to interact with.
 */

import { createDOMObserver, type DOMObserverHandle } from './dom-observer';
import { installFetchInterceptor, extractPromptFromPayload, type InterceptedRequest } from './fetch-interceptor';
import { installSubmitHandler, type SubmitHandlerHandle, type SubmitMode } from './submit-handler';
import { createClipboardMonitor, type ClipboardMonitorHandle, type ClipboardEvent as IronClipboardEvent } from './clipboard-monitor';
import { createFileUploadMonitor, type FileUploadMonitorHandle, type FileUploadEvent } from './file-upload-monitor';
import { showBlockOverlay } from '../ui/block-overlay';
import { injectProxyResponse } from '../ui/response-injector';

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

    // In proxy mode, send PROXY_ANALYZE to service worker and wait for result
    try {
      const sessionId = crypto.randomUUID();
      const analyzeResult = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'PROXY_ANALYZE',
            payload: { text: promptText, aiToolId: detector.id, sessionId },
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

      // If analysis returned an error, fall back to allow
      if (analyzeResult?.error) {
        console.warn('[Iron Gate] Proxy analysis failed, allowing prompt:', analyzeResult.error);
        return 'allow';
      }

      const { originalScore, maskedPrompt, recommendedRoute } = analyzeResult;

      // High sensitivity — block and show overlay
      if (originalScore.level === 'critical' || originalScore.level === 'high') {
        const entityCounts = new Map<string, number>();
        for (const e of originalScore.entities || []) {
          entityCounts.set(e.type, (entityCounts.get(e.type) || 0) + 1);
        }
        const overlayResult = await showBlockOverlay({
          score: originalScore.score,
          level: originalScore.level,
          entities: Array.from(entityCounts.entries()).map(([type, count]) => ({ type, count })),
          explanation: originalScore.explanation || 'High sensitivity content detected.',
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

      // Moderate sensitivity — silently proxy through masked route
      if (originalScore.level === 'medium') {
        const proxyResponse = await new Promise<any>((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: 'PROXY_SEND',
              payload: { maskedPrompt, route: recommendedRoute, sessionId },
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

        // Inject the proxy response into the AI tool's UI
        if (proxyResponse && !proxyResponse.error) {
          injectProxyResponse(detector, proxyResponse.response, {
            model: proxyResponse.model || 'unknown',
            provider: proxyResponse.provider || 'unknown',
            latencyMs: proxyResponse.latencyMs || 0,
          });
        }

        return 'intercept';
      }

      // Low sensitivity — allow passthrough
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
  function onFileInFormData(file: File) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['pdf', 'docx', 'xlsx'].includes(ext)) return;
    if (file.size > 10 * 1024 * 1024) return;

    // Read and send for analysis
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      onFileUpload({
        fileName: file.name,
        fileSize: file.size,
        fileType: ext,
        fileBase64: base64,
        timestamp: Date.now(),
      });
    };
    reader.readAsDataURL(file);
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

  return {
    start() {
      console.log(`[Iron Gate] Starting capture engine for ${detector.name}`);

      // 1. Install fetch interceptor FIRST (needs to be before page scripts)
      fetchCleanup = installFetchInterceptor(onFetchRequest, onFileInFormData);

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
      }
    },
  };
}
