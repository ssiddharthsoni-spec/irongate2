/**
 * Detects when the user submits a prompt.
 * In Audit Mode: captures the prompt and lets it through.
 * In Proxy Mode: intercepts, pseudonymizes input, then re-submits.
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

  // Track if we're currently processing a submit (to avoid re-entry on re-trigger)
  let isProcessing = false;
  // Flag: set to true when WE trigger the submit after pseudonymization
  let isOurSubmit = false;

  function handleSubmitSync(event: Event, promptText: string) {
    if (!promptText.trim() || isProcessing) return;

    // If this is OUR re-triggered submit after pseudonymization, let it through
    if (isOurSubmit) {
      isOurSubmit = false;
      console.log('[Iron Gate] Allowing our re-triggered submit through');
      return;
    }

    if (currentMode === 'audit') {
      // Audit mode: just capture asynchronously and let through immediately
      config.onSubmit(promptText).catch(() => {});
      return;
    }

    // ── PROXY MODE ─────────────────────────────────────────────────
    // The MAIN world DOM pre-submit handler handles pseudonymization.
    // Do NOT call preventDefault/stopImmediatePropagation here — that
    // blocks the MAIN world's capture-phase listener from seeing the event.
    // Just log the submit and let the event propagate to the MAIN world.
    config.onSubmit(promptText).catch(() => {});
  }

  // Re-trigger the submit after pseudonymization
  async function retriggerSubmit(det: AIToolDetector) {
    // Small delay to let React process the input change
    await new Promise((r) => setTimeout(r, 50));

    isOurSubmit = true;

    const submitButton = det.getSubmitTrigger();
    if (submitButton) {
      console.log('[Iron Gate] Re-triggering submit via button click');
      submitButton.click();
    } else {
      // Fallback: simulate Enter key on the input
      const input = det.getPromptInput();
      if (input) {
        console.log('[Iron Gate] Re-triggering submit via Enter key');
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        }));
      }
    }

    // Reset the flag after a short timeout in case the click didn't trigger our handler
    setTimeout(() => { isOurSubmit = false; }, 200);
  }

  // Clear an input element
  function clearInput(input: HTMLElement) {
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      input.textContent = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // Watch for Enter key (not Shift+Enter) in prompt input
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      const input = detector.getPromptInput();
      if (input && (input === event.target || input.contains(event.target as Node))) {
        const text = detector.extractPromptText(input);
        if (text.trim()) {
          handleSubmitSync(event, text);
        }
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
        if (text.trim()) {
          handleSubmitSync(event, text);
        }
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
