/**
 * Entity Tooltip — IG-008 Coaching Mode
 *
 * Shows inline tooltips on detected and pseudonymized entities.
 * "[Entity type] detected. IronGate replaced it. [See changes] [Not sensitive — dismiss]"
 *
 * Dismiss sends feedback to the API via the service worker.
 * Pseudonymized text gets a green shimmer animation for visual confirmation.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EntityTooltipOptions {
  entityType: string;
  pseudonym: string;
  original?: string; // Only shown to user if they click "See changes"
  onDismiss: (entityType: string, entityHash: string) => void;
  onSeeChanges?: () => void;
}

export interface EntityTooltipHandle {
  /** Attach tooltip to a DOM element containing pseudonymized text */
  attachToElement(el: HTMLElement, options: EntityTooltipOptions): void;
  /** Apply green shimmer effect to pseudonymized text */
  applyShimmer(el: HTMLElement): void;
  /** Remove all tooltips and shimmer effects */
  destroy(): void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TOOLTIP_HOST_ID = 'iron-gate-entity-tooltip-host';
const SHIMMER_CLASS = 'ig-shimmer-pseudo';

// ─── Public API ──────────────────────────────────────────────────────────────

export function createEntityTooltips(): EntityTooltipHandle {
  // Remove any existing host
  const existing = document.getElementById(TOOLTIP_HOST_ID);
  if (existing) existing.remove();

  const host = document.createElement('div');
  host.id = TOOLTIP_HOST_ID;
  host.style.cssText = 'position: fixed; top: 0; left: 0; z-index: 2147483646; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    @keyframes igShimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes igTooltipIn {
      from { opacity: 0; transform: translateY(4px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes igTooltipOut {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to { opacity: 0; transform: translateY(4px) scale(0.96); }
    }
    .ig-tooltip {
      position: fixed;
      background: #1f2937;
      color: #f9fafb;
      border-radius: 8px;
      padding: 10px 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 12px;
      line-height: 1.4;
      max-width: 320px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
      pointer-events: auto;
      animation: igTooltipIn 0.2s ease-out forwards;
      z-index: 2147483647;
    }
    .ig-tooltip.removing {
      animation: igTooltipOut 0.15s ease-in forwards;
    }
    .ig-tooltip-type {
      display: inline-block;
      background: rgba(79, 70, 229, 0.2);
      color: #a5b4fc;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 2px 6px;
      border-radius: 4px;
      margin-bottom: 6px;
    }
    .ig-tooltip-msg {
      margin-bottom: 8px;
      color: #d1d5db;
    }
    .ig-tooltip-actions {
      display: flex;
      gap: 8px;
    }
    .ig-tooltip-btn {
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 5px;
      border: none;
      cursor: pointer;
      transition: opacity 0.15s ease;
      white-space: nowrap;
    }
    .ig-tooltip-btn:hover {
      opacity: 0.85;
    }
    .ig-tooltip-btn-see {
      background: #4f46e5;
      color: #ffffff;
    }
    .ig-tooltip-btn-dismiss {
      background: transparent;
      color: #9ca3af;
      border: 1px solid #374151;
    }
    .ig-tooltip-changes {
      margin-top: 8px;
      padding: 6px 10px;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 5px;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 11px;
    }
    .ig-tooltip-original {
      color: #ef4444;
      text-decoration: line-through;
    }
    .ig-tooltip-replaced {
      color: #22c55e;
    }
    .ig-tooltip-arrow {
      position: absolute;
      bottom: -5px;
      left: 50%;
      transform: translateX(-50%);
      width: 10px;
      height: 5px;
      overflow: hidden;
    }
    .ig-tooltip-arrow::after {
      content: '';
      display: block;
      width: 8px;
      height: 8px;
      background: #1f2937;
      transform: rotate(45deg) translateY(-5px);
      margin: 0 auto;
    }
  `;
  shadow.appendChild(style);

  const container = document.createElement('div');
  shadow.appendChild(container);
  document.body.appendChild(host);

  let activeTooltip: HTMLElement | null = null;
  const shimmerStyle = document.createElement('style');
  shimmerStyle.textContent = `
    .${SHIMMER_CLASS} {
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(34, 197, 94, 0.15) 40%,
        rgba(34, 197, 94, 0.25) 50%,
        rgba(34, 197, 94, 0.15) 60%,
        transparent 100%
      );
      background-size: 200% 100%;
      animation: igShimmerPage 2s ease-in-out 1;
      border-radius: 2px;
      transition: background-color 0.3s ease;
    }
    @keyframes igShimmerPage {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
  `;

  // Inject shimmer styles into the page (not shadow DOM) since target elements are in the page
  let shimmerInjected = false;
  function ensureShimmerStyles() {
    if (shimmerInjected) return;
    document.head.appendChild(shimmerStyle);
    shimmerInjected = true;
  }

  function removeTooltip() {
    if (activeTooltip) {
      activeTooltip.classList.add('removing');
      const el = activeTooltip;
      setTimeout(() => el.remove(), 150);
      activeTooltip = null;
    }
  }

  // Close tooltip on click outside
  document.addEventListener('click', (e) => {
    if (activeTooltip && !(e.target as HTMLElement)?.closest?.(`#${TOOLTIP_HOST_ID}`)) {
      removeTooltip();
    }
  });

  const handle: EntityTooltipHandle = {
    attachToElement(el: HTMLElement, options: EntityTooltipOptions) {
      el.style.cursor = 'pointer';
      el.title = ''; // Remove default title

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        removeTooltip();

        const rect = el.getBoundingClientRect();
        const tooltip = document.createElement('div');
        tooltip.className = 'ig-tooltip';

        const entityLabel = options.entityType.replace(/_/g, ' ').toLowerCase();

        tooltip.innerHTML = `
          <div class="ig-tooltip-type">${escapeHtml(entityLabel)}</div>
          <div class="ig-tooltip-msg">
            Detected and replaced by Iron Gate to protect sensitive data.
          </div>
          <div class="ig-tooltip-actions">
            <button class="ig-tooltip-btn ig-tooltip-btn-see">See changes</button>
            <button class="ig-tooltip-btn ig-tooltip-btn-dismiss">Not sensitive</button>
          </div>
          <div class="ig-tooltip-arrow"></div>
        `;

        // Position above the element
        const tooltipLeft = Math.max(10, rect.left + rect.width / 2 - 160);
        const tooltipTop = rect.top - 10;
        tooltip.style.left = `${tooltipLeft}px`;
        tooltip.style.bottom = `${window.innerHeight - tooltipTop}px`;

        container.appendChild(tooltip);
        activeTooltip = tooltip;

        // Wire up buttons
        const seeBtn = tooltip.querySelector('.ig-tooltip-btn-see');
        const dismissBtn = tooltip.querySelector('.ig-tooltip-btn-dismiss');

        seeBtn?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          // Show original → replaced diff
          const changesDiv = document.createElement('div');
          changesDiv.className = 'ig-tooltip-changes';
          if (options.original) {
            changesDiv.innerHTML = `
              <span class="ig-tooltip-original">${escapeHtml(options.original)}</span>
              &nbsp;→&nbsp;
              <span class="ig-tooltip-replaced">${escapeHtml(options.pseudonym)}</span>
            `;
          } else {
            changesDiv.innerHTML = `
              <span class="ig-tooltip-replaced">${escapeHtml(options.pseudonym)}</span>
              <span style="color: #6b7280; margin-left: 6px;">(original redacted)</span>
            `;
          }
          tooltip.appendChild(changesDiv);
          (seeBtn as HTMLElement).style.display = 'none';
          options.onSeeChanges?.();
        });

        dismissBtn?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          // Send feedback: this entity was not sensitive (false positive)
          hashEntityText(options.pseudonym).then((entityHash) => {
            options.onDismiss(options.entityType, entityHash);
          });
          removeTooltip();
        });
      });
    },

    applyShimmer(el: HTMLElement) {
      ensureShimmerStyles();
      el.classList.add(SHIMMER_CLASS);
      // Remove shimmer after animation completes (2s)
      setTimeout(() => el.classList.remove(SHIMMER_CLASS), 2000);
    },

    destroy() {
      removeTooltip();
      host.remove();
      if (shimmerInjected) {
        shimmerStyle.remove();
        shimmerInjected = false;
      }
    },
  };

  return handle;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function hashEntityText(text: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return 'unknown';
  }
}
