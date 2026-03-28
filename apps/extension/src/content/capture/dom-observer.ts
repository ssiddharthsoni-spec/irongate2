/**
 * Attaches a MutationObserver to the AI tool's prompt input.
 * Debounces at 300ms and emits the current prompt text.
 * This is the PRIMARY capture method — tracks typing in real time.
 */

interface AIToolDetector {
  getPromptInput(): HTMLElement | null;
  extractPromptText(input: HTMLElement): string;
}

export interface DOMObserverHandle {
  disconnect(): void;
}

export function createDOMObserver(
  detector: AIToolDetector,
  onPromptChange: (text: string) => void,
  onPromptCleared?: () => void
): DOMObserverHandle {
  let observer: MutationObserver | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastText = '';
  let currentInput: HTMLElement | null = null;
  let isAttaching = false; // Guard against concurrent attachObserver calls

  function handleMutation() {
    try {
      if (!currentInput) return;

      // Debounce at 300ms
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          if (!currentInput) return;
          const text = detector.extractPromptText(currentInput);
          if (text !== lastText) {
            lastText = text;
            if (text.length > 0) {
              onPromptChange(text);
            } else {
              // Input was cleared — notify so sidepanel resets stale results
              onPromptCleared?.();
            }
          }
        } catch (err) {
          console.warn('[Iron Gate] Mutation debounce handler error:', err);
        }
      }, 300);
    } catch (err) {
      console.warn('[Iron Gate] MutationObserver callback error:', err);
    }
  }

  /** Remove listener from the current input element */
  function detachCurrentInput() {
    if (currentInput) {
      currentInput.removeEventListener('input', handleMutation);
      currentInput = null;
    }
  }

  function attachObserver(input: HTMLElement) {
    // Guard against concurrent calls from polling + navigation check
    if (isAttaching) return;
    isAttaching = true;

    try {
      // Disconnect existing observer
      if (observer) observer.disconnect();

      // Remove listener from PREVIOUS input before attaching to new one
      detachCurrentInput();

      // Verify the element is a valid DOM node before observing
      if (!(input instanceof Node) || !input.isConnected) {
        console.warn('[Iron Gate] Prompt input is not a valid connected DOM node, skipping');
        return;
      }

      currentInput = input;
      observer = new MutationObserver(handleMutation);
      try {
        observer.observe(input, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: false,
        });
      } catch (err) {
        console.warn('[Iron Gate] Failed to observe prompt input:', err);
        currentInput = null;
        return;
      }

      // Also listen for 'input' events as a backup
      input.addEventListener('input', handleMutation);

      // DOM observer attached — diagnostic info suppressed in production

      // ── CRITICAL: Read initial text immediately ──
      // If text was already in the input (e.g. pasted before observer attached),
      // the MutationObserver won't fire. Emit the existing text right away.
      try {
        const initialText = detector.extractPromptText(input);
        if (initialText && initialText !== lastText) {
          lastText = initialText;
          onPromptChange(initialText);
        }
      } catch (err) {
        console.warn('[Iron Gate] Initial text read failed:', err);
      }
    } finally {
      isAttaching = false;
    }
  }

  // ── Periodic text polling ──
  // Some editors (Gemini's Quill, contenteditable) may not fire mutations
  // on programmatic changes or paste. Poll every 800ms as a safety net.
  let textPollInterval: ReturnType<typeof setInterval> | null = null;

  function startTextPolling() {
    textPollInterval = setInterval(() => {
      try {
        if (!currentInput || !currentInput.isConnected) return;
        const text = detector.extractPromptText(currentInput);
        if (text !== lastText) {
          lastText = text;
          if (text.length > 0) {
            onPromptChange(text);
          } else {
            onPromptCleared?.();
          }
        }
      } catch (err) {
        console.warn('[Iron Gate] Text poll error:', err);
      }
    }, 800);
  }

  // Poll for the prompt input element (SPAs render async)
  function startPolling() {
    const tryAttach = () => {
      const input = detector.getPromptInput();
      if (input) {
        if (input !== currentInput) {
          attachObserver(input);
        }
      }
    };

    // Try immediately
    tryAttach();

    // Then poll every 500ms for SPA navigation
    pollInterval = setInterval(tryAttach, 500);
  }

  // Handle SPA navigation — re-attach when URL changes
  let lastUrl = window.location.href;
  const navigationCheck = setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      lastText = '';
      // Clean up old input listener before clearing reference
      detachCurrentInput();
      // Re-find the input on navigation
      const input = detector.getPromptInput();
      if (input) {
        attachObserver(input);
      }
    }
  }, 1000);

  startPolling();
  startTextPolling();

  return {
    disconnect() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (textPollInterval) {
        clearInterval(textPollInterval);
        textPollInterval = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      clearInterval(navigationCheck);
      // Clean up current input listener
      detachCurrentInput();
      currentInput = null;
      lastText = '';
    },
  };
}
