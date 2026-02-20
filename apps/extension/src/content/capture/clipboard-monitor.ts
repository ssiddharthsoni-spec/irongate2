/**
 * Monitors paste events into AI tool prompt areas.
 * Pasting large content is a key risk signal — often indicates
 * copying sensitive documents into AI tools.
 */

interface AIToolDetector {
  getPromptInput(): HTMLElement | null;
  extractPromptText(input: HTMLElement): string;
}

export interface ClipboardEvent {
  pastedText: string;
  pastedLength: number;
  timestamp: number;
  sourceType: 'text' | 'html' | 'files';
}

export interface ClipboardMonitorHandle {
  destroy(): void;
}

export function createClipboardMonitor(
  detector: AIToolDetector,
  onPaste: (event: ClipboardEvent) => void
): ClipboardMonitorHandle {
  const abortController = new AbortController();

  function handlePaste(event: globalThis.ClipboardEvent) {
    const input = detector.getPromptInput();
    if (!input) return;

    // Only capture pastes into the AI tool's prompt input
    const target = event.target as HTMLElement;
    if (target !== input && !input.contains(target)) return;

    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    // Determine what was pasted
    const textData = clipboardData.getData('text/plain');
    const htmlData = clipboardData.getData('text/html');
    const files = clipboardData.files;

    let sourceType: 'text' | 'html' | 'files' = 'text';
    let pastedText = textData;

    if (files.length > 0) {
      sourceType = 'files';
      pastedText = `[${files.length} file(s) pasted]`;
    } else if (htmlData && !textData) {
      sourceType = 'html';
      // Extract text from HTML
      const temp = document.createElement('div');
      temp.innerHTML = htmlData;
      pastedText = temp.textContent || temp.innerText || '';
    }

    if (pastedText) {
      onPaste({
        pastedText,
        pastedLength: pastedText.length,
        timestamp: Date.now(),
        sourceType,
      });
    }
  }

  document.addEventListener('paste', handlePaste, {
    capture: true,
    signal: abortController.signal,
  });

  return {
    destroy() {
      abortController.abort();
    },
  };
}
