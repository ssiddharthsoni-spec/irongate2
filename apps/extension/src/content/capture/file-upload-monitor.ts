/**
 * File Upload Monitor — captures document uploads to AI tools.
 *
 * Monitors:
 * 1. <input type="file"> changes (when user selects a file)
 * 2. Drag-and-drop events on the chat area
 * 3. Shadow DOM traversal for platforms like Gemini/Copilot
 *
 * When a supported file is detected, reads it as base64 and sends to the
 * service worker for analysis via the Iron Gate pipeline.
 *
 * The `change` event on <input type="file"> has `composed: false`, meaning
 * it does NOT cross shadow DOM boundaries. To catch file inputs inside
 * shadow roots (Gemini, Copilot), we recursively walk open shadow roots,
 * attach listeners directly, and observe shadow roots for mutations.
 */

export interface FileUploadEvent {
  fileName: string;
  fileSize: number;
  fileType: string;       // extension: pdf, docx, xlsx
  fileBase64: string;      // base64-encoded file content
  timestamp: number;
}

export interface FileUploadMonitorHandle {
  destroy(): void;
}

export interface FileAnalysisResult {
  fileName: string;
  fileType: string;
  fileSize: number;
  textLength: number;
  score: number;
  level: string;
  entitiesFound: number;
  explanation: string;
  entities: Array<{
    type: string;
    start: number;
    end: number;
    confidence: number;
    source: string;
    length: number;
  }>;
  breakdown: Record<string, number>;
  redactedText: string;
  entitiesRedacted: number;
  eventId: string;
}

const SUPPORTED_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'txt', 'csv', 'pptx', 'rtf', 'html', 'md', 'json']);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function getExtension(fileName: string): string {
  return (fileName.split('.').pop() || '').toLowerCase();
}

function isSupportedFile(file: File): boolean {
  const ext = getExtension(file.name);
  return SUPPORTED_EXTENSIONS.has(ext) && file.size <= MAX_FILE_SIZE;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip the data:...;base64, prefix
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function createFileUploadMonitor(
  onFileDetected: (event: FileUploadEvent) => void
): FileUploadMonitorHandle {
  const processedFiles = new Set<string>(); // Prevent duplicate processing
  const shadowObservers: MutationObserver[] = [];
  const attachedInputs = new WeakSet<HTMLInputElement>();

  async function processFile(file: File) {
    if (!isSupportedFile(file)) return;

    // De-duplicate by name + size + lastModified
    const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
    if (processedFiles.has(fileKey)) return;
    processedFiles.add(fileKey);

    // Clear old entries after 30 seconds
    setTimeout(() => processedFiles.delete(fileKey), 30_000);

    try {
      const base64 = await fileToBase64(file);
      const ext = getExtension(file.name);

      onFileDetected({
        fileName: file.name,
        fileSize: file.size,
        fileType: ext,
        fileBase64: base64,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.warn('[Iron Gate] Failed to read uploaded file:', err);
    }
  }

  // --- Monitor <input type="file"> changes ---
  function onInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.type !== 'file' || !input.files) return;

    for (const file of Array.from(input.files)) {
      processFile(file);
    }
  }

  // --- Monitor drag-and-drop ---
  function onDrop(e: DragEvent) {
    if (!e.dataTransfer?.files) return;

    for (const file of Array.from(e.dataTransfer.files)) {
      processFile(file);
    }
  }

  // --- Attach change listener to a file input (with dedup) ---
  function attachToInput(input: HTMLInputElement) {
    if (attachedInputs.has(input)) return;
    attachedInputs.add(input);
    input.addEventListener('change', onInputChange);
  }

  // --- Recursively find file inputs in shadow DOM ---
  function findFileInputsDeep(root: Document | ShadowRoot | HTMLElement): HTMLInputElement[] {
    const inputs: HTMLInputElement[] = [];

    // Find inputs in this root
    try {
      const found = root.querySelectorAll('input[type="file"]');
      for (const input of Array.from(found)) {
        inputs.push(input as HTMLInputElement);
      }
    } catch { /* ignore */ }

    // Recursively walk into shadow roots
    const elements = root instanceof HTMLElement ? [root] : [];
    try {
      const all = root.querySelectorAll('*');
      for (const el of Array.from(all)) {
        elements.push(el as HTMLElement);
      }
    } catch { /* ignore */ }

    for (const el of elements) {
      if (el.shadowRoot) {
        inputs.push(...findFileInputsDeep(el.shadowRoot));
      }
    }

    return inputs;
  }

  // --- Track observed shadow roots to prevent unbounded observer accumulation ---
  const _observedShadowRoots = new WeakSet<ShadowRoot>();

  // --- Observe a shadow root for added file inputs ---
  function observeShadowRoot(shadowRoot: ShadowRoot) {
    // Dedup: don't attach multiple observers to the same shadow root
    if (_observedShadowRoots.has(shadowRoot)) return;
    _observedShadowRoots.add(shadowRoot);
    const shadowObs = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLInputElement && node.type === 'file') {
            attachToInput(node);
          }
          if (node instanceof HTMLElement) {
            // Check the node itself and its children
            for (const input of Array.from(node.querySelectorAll('input[type="file"]'))) {
              attachToInput(input as HTMLInputElement);
            }
            // If the added node has a shadow root, recursively observe it
            if (node.shadowRoot) {
              const deepInputs = findFileInputsDeep(node.shadowRoot);
              for (const input of deepInputs) attachToInput(input);
              observeShadowRoot(node.shadowRoot);
            }
          }
        }
      }
    });
    shadowObs.observe(shadowRoot, { childList: true, subtree: true });
    shadowObservers.push(shadowObs);
  }

  // --- Walk entire DOM tree to find and observe shadow roots ---
  function walkAndObserveShadowRoots(root: Document | ShadowRoot) {
    try {
      const allElements = root.querySelectorAll('*');
      for (const el of Array.from(allElements)) {
        if ((el as HTMLElement).shadowRoot) {
          const sr = (el as HTMLElement).shadowRoot!;
          // Find existing file inputs in this shadow root
          const inputs = findFileInputsDeep(sr);
          for (const input of inputs) attachToInput(input);
          // Observe for new ones
          observeShadowRoot(sr);
          // Recurse into nested shadow roots
          walkAndObserveShadowRoots(sr);
        }
      }
    } catch { /* ignore traversal errors */ }
  }

  // --- Monitor dynamically added file inputs (light DOM) ---
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof HTMLInputElement && node.type === 'file') {
          attachToInput(node);
        }
        if (node instanceof HTMLElement) {
          for (const input of Array.from(node.querySelectorAll('input[type="file"]'))) {
            attachToInput(input as HTMLInputElement);
          }
          // Check if added element has a shadow root — observe it
          if (node.shadowRoot) {
            const deepInputs = findFileInputsDeep(node.shadowRoot);
            for (const input of deepInputs) attachToInput(input);
            observeShadowRoot(node.shadowRoot);
          }
        }
      }
    }
  });

  // Start observing
  document.addEventListener('change', onInputChange, { capture: true });
  document.addEventListener('drop', onDrop, { capture: true });
  observer.observe(document.body, { childList: true, subtree: true });

  // Attach to existing file inputs (light DOM)
  for (const input of Array.from(document.querySelectorAll('input[type="file"]'))) {
    attachToInput(input as HTMLInputElement);
  }

  // Walk shadow roots on initialization
  walkAndObserveShadowRoots(document);

  // Re-scan shadow roots periodically (covers lazy-loaded web components)
  const shadowScanInterval = setInterval(() => {
    walkAndObserveShadowRoots(document);
  }, 5000);

  // File upload monitor started

  return {
    destroy() {
      document.removeEventListener('change', onInputChange, { capture: true });
      document.removeEventListener('drop', onDrop, { capture: true });
      observer.disconnect();
      for (const obs of shadowObservers) obs.disconnect();
      shadowObservers.length = 0;
      clearInterval(shadowScanInterval);
      processedFiles.clear();
      // File upload monitor stopped
    },
  };
}
