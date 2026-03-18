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

/**
 * Replace text in an input element using React-compatible methods.
 * Uses execCommand for contenteditable (updates React's internal state).
 * Uses native value setter for textarea/input (bypasses React wrapper).
 */
function replaceInputText(input: HTMLElement, newText: string): void {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    // For textarea/input: use native setter to bypass React's synthetic handler
    const nativeSetter = Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(input, newText);
    } else {
      input.value = newText;
    }
    // Dispatch events that React listens to
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // ContentEditable div (ChatGPT, Gemini, Copilot, Claude)
    // Focus the element first
    input.focus();

    // Select all text in the contenteditable
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(input);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    // Use execCommand('insertText') — this updates React/framework internal state
    // because it fires the same events as real user typing
    const success = document.execCommand('insertText', false, newText);

    if (!success) {
      // Fallback: direct DOM manipulation + events
      console.log('[Iron Gate] execCommand failed, using direct DOM manipulation');
      input.textContent = newText;
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: newText,
      }));
    }

    // Fire additional events to ensure framework state updates
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
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
      chrome.runtime.sendMessage({ type, payload }).catch(() => {});
    } catch {
      // Extension context may be invalidated on update
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

  // Handler: input cleared — reset sidepanel score
  function onPromptCleared() {
    sendToWorker('PROMPT_CLEARED', {
      aiToolId: detector.id,
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

    // In proxy mode, the MAIN world DOM interceptor handles pseudonymization
    // with realistic fakes. Do NOT pseudonymize here (this uses bracket labels
    // like [PERSON-1] which would conflict and show in the sidepanel).
    // Just allow the submit — the main world intercepts the send button click
    // in capture phase and replaces the input text before the app reads it.
    sendToWorker('PROMPT_SUBMITTED', {
      text: promptText,
      aiToolId: detector.id,
      captureMethod: 'submit',
      action: 'proxy-deferred',
    });
    return 'allow';
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
    if (!['pdf', 'docx', 'xlsx', 'txt', 'csv', 'pptx', 'rtf', 'html', 'md', 'json'].includes(ext)) return 'allow';
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

      // Each installer is wrapped in try-catch to prevent partial initialization.
      // If one fails, the others still run — fail-open on capture, not fail-closed on the whole engine.
      try { fetchCleanup = installFetchInterceptor(onFetchRequest, onFileInFormData, createBodyTransformer()); }
      catch (e) { console.error('[Iron Gate] Fetch interceptor install failed:', e); }

      try { domObserver = createDOMObserver(detector, onPromptChange, onPromptCleared); }
      catch (e) { console.error('[Iron Gate] DOM observer install failed:', e); }

      try { submitHandler = installSubmitHandler(detector, { mode: config.mode, onSubmit }); }
      catch (e) { console.error('[Iron Gate] Submit handler install failed:', e); }

      try { clipboardMonitor = createClipboardMonitor(detector, onPaste); }
      catch (e) { console.error('[Iron Gate] Clipboard monitor install failed:', e); }

      try { fileUploadMonitor = createFileUploadMonitor(onFileUpload); }
      catch (e) { console.error('[Iron Gate] File upload monitor install failed:', e); }

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
