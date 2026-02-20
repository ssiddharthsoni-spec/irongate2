/**
 * Block Overlay — Phase 2
 *
 * A DOM-injected full-screen overlay that appears when the sensitivity score
 * exceeds the blocking threshold. Presents the user with:
 * - The sensitivity score and level prominently displayed
 * - A list of detected entity types
 * - An explanation of why the prompt was flagged
 * - Two actions: "Send Anyway" (requires override reason) and "Cancel"
 *
 * All styles are inline to avoid conflicts with the host page's CSS.
 * The overlay is injected into a shadow DOM to provide full isolation.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BlockOverlayOptions {
  score: number;
  level: string;
  entities: Array<{ type: string; count: number }>;
  explanation: string;
}

export interface BlockOverlayResult {
  action: 'allow' | 'block';
  overrideReason?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const OVERLAY_HOST_ID = 'iron-gate-block-overlay-host';

const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  low: { bg: '#dcfce7', text: '#166534', border: '#22c55e' },
  medium: { bg: '#fef9c3', text: '#854d0e', border: '#eab308' },
  high: { bg: '#fed7aa', text: '#9a3412', border: '#f97316' },
  critical: { bg: '#fecaca', text: '#991b1b', border: '#ef4444' },
};

const LEVEL_ICONS: Record<string, string> = {
  low: '\u2714',      // checkmark
  medium: '\u26A0',   // warning
  high: '\u26A0',     // warning
  critical: '\u26D4',  // no entry
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatEntityType(type: string): string {
  return type
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getLevelLabel(level: string): string {
  const labels: Record<string, string> = {
    low: 'Low Risk',
    medium: 'Medium Risk',
    high: 'High Risk',
    critical: 'Critical Risk',
  };
  return labels[level] || 'Unknown';
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Show the block overlay and return a promise that resolves when the user
 * makes a decision. The promise resolves to:
 * - { action: 'block' } if the user clicks Cancel
 * - { action: 'allow', overrideReason: '...' } if the user provides a reason and clicks Send Anyway
 */
export function showBlockOverlay(options: BlockOverlayOptions): Promise<BlockOverlayResult> {
  // Remove any existing overlay first
  hideBlockOverlay();

  return new Promise<BlockOverlayResult>((resolve) => {
    const { score, level, entities, explanation } = options;
    const colors = LEVEL_COLORS[level] || LEVEL_COLORS.high;
    const icon = LEVEL_ICONS[level] || '\u26A0';

    // Create host element with shadow DOM for full CSS isolation
    const host = document.createElement('div');
    host.id = OVERLAY_HOST_ID;
    host.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });

    // Build the overlay DOM
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.65);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      animation: ironGateFadeIn 0.2s ease-out;
    `;

    // Inject keyframes into shadow DOM
    const style = document.createElement('style');
    style.textContent = `
      @keyframes ironGateFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes ironGateSlideUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    shadow.appendChild(style);

    // Modal card
    const card = document.createElement('div');
    card.style.cssText = `
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);
      max-width: 520px;
      width: 90vw;
      max-height: 85vh;
      overflow-y: auto;
      animation: ironGateSlideUp 0.25s ease-out;
    `;

    // ── Header with score ──
    const header = document.createElement('div');
    header.style.cssText = `
      background: ${colors.bg};
      border-bottom: 2px solid ${colors.border};
      border-radius: 16px 16px 0 0;
      padding: 24px;
      text-align: center;
    `;

    const headerIcon = document.createElement('div');
    headerIcon.style.cssText = `
      font-size: 36px;
      margin-bottom: 8px;
    `;
    headerIcon.textContent = icon;

    const headerTitle = document.createElement('div');
    headerTitle.style.cssText = `
      font-size: 20px;
      font-weight: 700;
      color: ${colors.text};
      margin-bottom: 4px;
    `;
    headerTitle.textContent = 'Sensitive Content Detected';

    const scoreBadge = document.createElement('div');
    scoreBadge.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: ${colors.text};
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
      padding: 6px 16px;
      border-radius: 20px;
      margin-top: 8px;
    `;

    const scoreNumber = document.createElement('span');
    scoreNumber.style.cssText = 'font-size: 22px; font-weight: 800;';
    scoreNumber.textContent = String(score);

    const scoreLabel = document.createElement('span');
    scoreLabel.textContent = getLevelLabel(level);

    scoreBadge.appendChild(scoreNumber);
    scoreBadge.appendChild(scoreLabel);

    header.appendChild(headerIcon);
    header.appendChild(headerTitle);
    header.appendChild(scoreBadge);

    // ── Body ──
    const body = document.createElement('div');
    body.style.cssText = 'padding: 24px;';

    // Explanation
    const explanationEl = document.createElement('p');
    explanationEl.style.cssText = `
      font-size: 14px;
      line-height: 1.6;
      color: #374151;
      margin: 0 0 20px 0;
    `;
    explanationEl.textContent = explanation;

    body.appendChild(explanationEl);

    // Entities list
    if (entities.length > 0) {
      const entitiesHeader = document.createElement('div');
      entitiesHeader.style.cssText = `
        font-size: 12px;
        font-weight: 600;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 10px;
      `;
      entitiesHeader.textContent = 'Detected Entities';
      body.appendChild(entitiesHeader);

      const entitiesGrid = document.createElement('div');
      entitiesGrid.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 20px;
      `;

      for (const entity of entities) {
        const tag = document.createElement('span');
        tag.style.cssText = `
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: #f3f4f6;
          color: #374151;
          font-size: 13px;
          padding: 5px 12px;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
        `;

        const tagName = document.createElement('span');
        tagName.textContent = formatEntityType(entity.type);

        const tagCount = document.createElement('span');
        tagCount.style.cssText = `
          background: ${colors.border};
          color: #ffffff;
          font-size: 11px;
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 10px;
          min-width: 18px;
          text-align: center;
        `;
        tagCount.textContent = String(entity.count);

        tag.appendChild(tagName);
        tag.appendChild(tagCount);
        entitiesGrid.appendChild(tag);
      }

      body.appendChild(entitiesGrid);
    }

    // Divider
    const divider = document.createElement('div');
    divider.style.cssText = 'height: 1px; background: #e5e7eb; margin: 0 0 20px 0;';
    body.appendChild(divider);

    // Override reason section
    const overrideSection = document.createElement('div');
    overrideSection.style.cssText = 'margin-bottom: 20px;';

    const overrideLabel = document.createElement('label');
    overrideLabel.style.cssText = `
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 6px;
    `;
    overrideLabel.textContent = 'Override Reason (required to proceed)';

    const overrideInput = document.createElement('textarea');
    overrideInput.style.cssText = `
      width: 100%;
      min-height: 72px;
      padding: 10px 12px;
      font-size: 14px;
      font-family: inherit;
      color: #1f2937;
      background: #f9fafb;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      resize: vertical;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.15s ease;
    `;
    overrideInput.placeholder = 'Explain why this prompt should be sent despite the sensitivity score...';

    overrideInput.addEventListener('focus', () => {
      overrideInput.style.borderColor = '#6366f1';
      overrideInput.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.1)';
    });
    overrideInput.addEventListener('blur', () => {
      overrideInput.style.borderColor = '#d1d5db';
      overrideInput.style.boxShadow = 'none';
    });

    const overrideHint = document.createElement('div');
    overrideHint.style.cssText = `
      font-size: 12px;
      color: #9ca3af;
      margin-top: 4px;
    `;
    overrideHint.textContent = 'This will be logged for compliance review.';

    overrideSection.appendChild(overrideLabel);
    overrideSection.appendChild(overrideInput);
    overrideSection.appendChild(overrideHint);
    body.appendChild(overrideSection);

    // Error message (hidden by default)
    const errorMsg = document.createElement('div');
    errorMsg.style.cssText = `
      display: none;
      font-size: 13px;
      color: #dc2626;
      margin-bottom: 16px;
      padding: 8px 12px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 6px;
    `;
    errorMsg.textContent = 'Please provide an override reason before proceeding.';
    body.appendChild(errorMsg);

    // ── Footer with buttons ──
    const footer = document.createElement('div');
    footer.style.cssText = `
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    `;

    const cancelButton = document.createElement('button');
    cancelButton.style.cssText = `
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      color: #374151;
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s ease;
    `;
    cancelButton.textContent = 'Cancel';

    cancelButton.addEventListener('mouseenter', () => {
      cancelButton.style.background = '#f3f4f6';
      cancelButton.style.borderColor = '#9ca3af';
    });
    cancelButton.addEventListener('mouseleave', () => {
      cancelButton.style.background = '#ffffff';
      cancelButton.style.borderColor = '#d1d5db';
    });

    const sendButton = document.createElement('button');
    sendButton.style.cssText = `
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      color: #ffffff;
      background: #dc2626;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s ease;
    `;
    sendButton.textContent = 'Send Anyway';

    sendButton.addEventListener('mouseenter', () => {
      sendButton.style.background = '#b91c1c';
    });
    sendButton.addEventListener('mouseleave', () => {
      sendButton.style.background = '#dc2626';
    });

    footer.appendChild(cancelButton);
    footer.appendChild(sendButton);
    body.appendChild(footer);

    // ── Assemble ──
    card.appendChild(header);
    card.appendChild(body);
    overlay.appendChild(card);
    shadow.appendChild(overlay);
    document.body.appendChild(host);

    // ── Event handling ──

    // Cancel: resolve with block
    cancelButton.addEventListener('click', () => {
      cleanup();
      resolve({ action: 'block' });
    });

    // Send Anyway: validate reason, then resolve with allow
    sendButton.addEventListener('click', () => {
      const reason = overrideInput.value.trim();
      if (!reason) {
        errorMsg.style.display = 'block';
        overrideInput.style.borderColor = '#dc2626';
        overrideInput.style.boxShadow = '0 0 0 3px rgba(220, 38, 38, 0.1)';
        overrideInput.focus();
        return;
      }
      cleanup();
      resolve({ action: 'allow', overrideReason: reason });
    });

    // Clear error when typing in the textarea
    overrideInput.addEventListener('input', () => {
      if (overrideInput.value.trim()) {
        errorMsg.style.display = 'none';
        overrideInput.style.borderColor = '#d1d5db';
        overrideInput.style.boxShadow = 'none';
      }
    });

    // Escape key cancels
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        cleanup();
        resolve({ action: 'block' });
      }
    }
    document.addEventListener('keydown', onKeyDown, { capture: true });

    // Click on backdrop cancels
    overlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === overlay) {
        cleanup();
        resolve({ action: 'block' });
      }
    });

    function cleanup() {
      document.removeEventListener('keydown', onKeyDown, { capture: true });
      host.remove();
    }

    // Focus the textarea for immediate typing
    requestAnimationFrame(() => overrideInput.focus());
  });
}

/**
 * Programmatically remove the block overlay if it's currently shown.
 */
export function hideBlockOverlay(): void {
  const existing = document.getElementById(OVERLAY_HOST_ID);
  if (existing) {
    existing.remove();
  }
}
