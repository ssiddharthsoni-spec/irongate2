/**
 * File Upload Monitor — captures document uploads to AI tools.
 *
 * Monitors:
 * 1. <input type="file"> changes (when user selects a file)
 * 2. Drag-and-drop events on the chat area
 *
 * When a supported file (PDF, DOCX, XLSX) is detected, reads it as base64
 * and sends to the service worker for analysis via the Iron Gate pipeline.
 *
 * In proxy mode, if the file contains high-sensitivity content, the block
 * overlay is shown before the user can submit.
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
  score: number;
  level: string;
  entitiesFound: number;
  explanation: string;
}

const SUPPORTED_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'txt', 'csv']);
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

  // --- Monitor dynamically added file inputs ---
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof HTMLInputElement && node.type === 'file') {
          node.addEventListener('change', onInputChange);
        }
        if (node instanceof HTMLElement) {
          for (const input of Array.from(node.querySelectorAll('input[type="file"]'))) {
            input.addEventListener('change', onInputChange);
          }
        }
      }
    }
  });

  // Start observing
  document.addEventListener('change', onInputChange, { capture: true });
  document.addEventListener('drop', onDrop, { capture: true });
  observer.observe(document.body, { childList: true, subtree: true });

  // Attach to existing file inputs
  for (const input of Array.from(document.querySelectorAll('input[type="file"]'))) {
    input.addEventListener('change', onInputChange);
  }

  console.log('[Iron Gate] File upload monitor started');

  return {
    destroy() {
      document.removeEventListener('change', onInputChange, { capture: true });
      document.removeEventListener('drop', onDrop, { capture: true });
      observer.disconnect();
      processedFiles.clear();
      console.log('[Iron Gate] File upload monitor stopped');
    },
  };
}
