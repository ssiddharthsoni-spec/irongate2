/**
 * Scan Indicator — shows a non-intrusive overlay while a document is being scanned.
 *
 * Positioned at bottom-right, above the sensitivity badge.
 * Uses shadow DOM for full CSS isolation from the host page.
 */

const SCAN_HOST_ID = 'iron-gate-scan-indicator-host';

export interface ScanIndicatorHandle {
  /** Update the displayed filename */
  update(fileName: string): void;
  /** Remove the indicator */
  remove(): void;
}

/**
 * Show a scanning indicator for the given file.
 * Returns a handle to update or remove it.
 */
export function showScanIndicator(fileName: string): ScanIndicatorHandle {
  // Remove any existing indicator
  hideScanIndicator();

  const host = document.createElement('div');
  host.id = SCAN_HOST_ID;
  host.style.cssText = 'position: fixed; bottom: 80px; right: 20px; z-index: 2147483646;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    @keyframes ironGateSpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @keyframes ironGateSlideIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  shadow.appendChild(style);

  const container = document.createElement('div');
  container.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-left: 4px solid #4f46e5;
    border-radius: 10px;
    padding: 12px 16px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    animation: ironGateSlideIn 0.2s ease-out;
    max-width: 320px;
  `;

  // Spinner
  const spinner = document.createElement('div');
  spinner.style.cssText = `
    width: 20px;
    height: 20px;
    border: 2.5px solid #e5e7eb;
    border-top-color: #4f46e5;
    border-radius: 50%;
    animation: ironGateSpin 0.8s linear infinite;
    flex-shrink: 0;
  `;

  // Text
  const textEl = document.createElement('div');
  textEl.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  `;

  const label = document.createElement('div');
  label.style.cssText = `
    font-size: 12px;
    font-weight: 600;
    color: #4f46e5;
    white-space: nowrap;
  `;
  label.textContent = 'Iron Gate — Scanning Document';

  const fileNameEl = document.createElement('div');
  fileNameEl.style.cssText = `
    font-size: 11px;
    color: #6b7280;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `;
  fileNameEl.textContent = truncateFileName(fileName);

  textEl.appendChild(label);
  textEl.appendChild(fileNameEl);
  container.appendChild(spinner);
  container.appendChild(textEl);
  shadow.appendChild(container);
  document.body.appendChild(host);

  return {
    update(newFileName: string) {
      fileNameEl.textContent = truncateFileName(newFileName);
    },
    remove() {
      host.remove();
    },
  };
}

/**
 * Remove the scan indicator if it's currently shown.
 */
export function hideScanIndicator(): void {
  const existing = document.getElementById(SCAN_HOST_ID);
  if (existing) existing.remove();
}

function truncateFileName(name: string): string {
  if (name.length <= 40) return name;
  const ext = name.split('.').pop() || '';
  const base = name.slice(0, 32);
  return `${base}...${ext ? `.${ext}` : ''}`;
}
