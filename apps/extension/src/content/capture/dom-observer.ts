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
  onPromptChange: (text: string) => void
): DOMObserverHandle {
  let observer: MutationObserver | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastText = '';
  let currentInput: HTMLElement | null = null;

  function handleMutation() {
    if (!currentInput) return;

    // Debounce at 300ms
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const text = detector.extractPromptText(currentInput!);
      if (text !== lastText) {
        lastText = text;
        if (text.length > 0) {
          onPromptChange(text);
        }
      }
    }, 300);
  }

  function attachObserver(input: HTMLElement) {
    // Disconnect existing observer
    if (observer) observer.disconnect();

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

    console.log('[Iron Gate] DOM observer attached to prompt input');
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
      currentInput = null;
      // Re-find the input on navigation
      const input = detector.getPromptInput();
      if (input) {
        attachObserver(input);
      }
    }
  }, 1000);

  startPolling();

  return {
    disconnect() {
      if (observer) observer.disconnect();
      if (pollInterval) clearInterval(pollInterval);
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(navigationCheck);
      if (currentInput) {
        currentInput.removeEventListener('input', handleMutation);
      }
    },
  };
}
