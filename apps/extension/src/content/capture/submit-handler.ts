/**
 * Detects when the user submits a prompt.
 * In Audit Mode: captures the prompt and lets it through.
 * In Proxy Mode (Phase 2): intercepts and redirects to our backend.
 */

interface AIToolDetector {
  getPromptInput(): HTMLElement | null;
  getSubmitTrigger(): HTMLElement | null;
  extractPromptText(input: HTMLElement): string;
  injectResponse?(container: HTMLElement, text: string): void;
}

export type SubmitMode = 'audit' | 'proxy';

export interface SubmitHandlerConfig {
  mode: SubmitMode;
  onSubmit: (promptText: string) => Promise<'allow' | 'intercept'>;
}

export interface SubmitHandlerHandle {
  destroy(): void;
  updateMode(mode: SubmitMode): void;
}

export function installSubmitHandler(
  detector: AIToolDetector,
  config: SubmitHandlerConfig
): SubmitHandlerHandle {
  let currentMode = config.mode;
  const abortController = new AbortController();
  const { signal } = abortController;

  // Track if we're currently processing a submit
  let isProcessing = false;

  async function handleSubmit(event: Event, promptText: string) {
    if (!promptText.trim() || isProcessing) return;

    isProcessing = true;

    try {
      if (currentMode === 'audit') {
        // Audit mode: just capture and let through
        await config.onSubmit(promptText);
        // Don't interfere — event proceeds naturally
      } else {
        // Proxy mode (Phase 2): potentially intercept
        const action = await config.onSubmit(promptText);

        if (action === 'intercept') {
          // Stop the original submission
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          // Clear the prompt input
          const input = detector.getPromptInput();
          if (input) {
            if (input instanceof HTMLTextAreaElement) {
              input.value = '';
            } else {
              input.textContent = '';
            }
          }

          // Phase 2: proxy logic will be implemented here
          console.log('[Iron Gate] Prompt intercepted for proxying');
        }
        // If 'allow', let it through
      }
    } catch (error) {
      console.error('[Iron Gate] Submit handler error:', error);
      // On error, always let the submission through
    } finally {
      isProcessing = false;
    }
  }

  // Watch for Enter key (not Shift+Enter) in prompt input
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      const input = detector.getPromptInput();
      if (input && (input === event.target || input.contains(event.target as Node))) {
        const text = detector.extractPromptText(input);
        handleSubmit(event, text);
      }
    }
  }

  // Watch for click on submit button
  function onClickCapture(event: MouseEvent) {
    const submitButton = detector.getSubmitTrigger();
    if (submitButton && (submitButton === event.target || submitButton.contains(event.target as Node))) {
      const input = detector.getPromptInput();
      if (input) {
        const text = detector.extractPromptText(input);
        handleSubmit(event, text);
      }
    }
  }

  // Attach listeners using capture phase to intercept before the AI tool's own handlers
  document.addEventListener('keydown', onKeyDown, { capture: true, signal });
  document.addEventListener('click', onClickCapture, { capture: true, signal });

  return {
    destroy() {
      abortController.abort();
    },
    updateMode(mode: SubmitMode) {
      currentMode = mode;
    },
  };
}
