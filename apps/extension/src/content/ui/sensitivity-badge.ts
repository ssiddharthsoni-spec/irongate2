/**
 * Sensitivity Badge — Phase 2
 *
 * A small floating badge fixed to the bottom-right corner of the page
 * that displays the real-time sensitivity level of the current prompt.
 *
 * Features:
 * - Color-coded indicator: Green (0-25), Yellow (26-60), Orange (61-85), Red (86-100)
 * - Displays numeric score
 * - Clicking opens the Iron Gate side panel
 * - Uses shadow DOM for complete CSS isolation from host page
 * - Smooth transitions when score updates
 * - Auto-hides when score is 0 (no content detected)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface SensitivityBadgeHandle {
  /** Update the badge with a new score and level */
  update(score: number, level: string): void;
  /** Show the badge */
  show(): void;
  /** Hide the badge */
  hide(): void;
  /** Remove the badge from the DOM entirely */
  destroy(): void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BADGE_HOST_ID = 'iron-gate-sensitivity-badge-host';

interface LevelStyle {
  bg: string;
  text: string;
  dot: string;
  border: string;
  glow: string;
}

const LEVEL_STYLES: Record<string, LevelStyle> = {
  low: {
    bg: '#f0fdf4',
    text: '#166534',
    dot: '#22c55e',
    border: '#bbf7d0',
    glow: 'rgba(34, 197, 94, 0.3)',
  },
  medium: {
    bg: '#fefce8',
    text: '#854d0e',
    dot: '#eab308',
    border: '#fef08a',
    glow: 'rgba(234, 179, 8, 0.3)',
  },
  high: {
    bg: '#fff7ed',
    text: '#9a3412',
    dot: '#f97316',
    border: '#fed7aa',
    glow: 'rgba(249, 115, 22, 0.3)',
  },
  critical: {
    bg: '#fef2f2',
    text: '#991b1b',
    dot: '#ef4444',
    border: '#fecaca',
    glow: 'rgba(239, 68, 68, 0.4)',
  },
};

function scoreToLevel(score: number): string {
  if (score <= 25) return 'low';
  if (score <= 60) return 'medium';
  if (score <= 85) return 'high';
  return 'critical';
}

function getLevelLabel(level: string): string {
  const labels: Record<string, string> = {
    low: 'Low',
    medium: 'Med',
    high: 'High',
    critical: 'Crit',
  };
  return labels[level] || '?';
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create and mount the sensitivity badge in the bottom-right corner.
 * Returns a handle with methods to update, show, hide, and destroy the badge.
 */
export function createSensitivityBadge(): SensitivityBadgeHandle {
  // Remove any previously existing badge
  const existing = document.getElementById(BADGE_HOST_ID);
  if (existing) existing.remove();

  // State
  let currentScore = 0;
  let currentLevel = 'low';
  let isVisible = false;

  // Create host element with shadow DOM
  const host = document.createElement('div');
  host.id = BADGE_HOST_ID;
  host.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 2147483646;
    pointer-events: auto;
  `;
  const shadow = host.attachShadow({ mode: 'closed' });

  // Inject keyframes and styles into shadow DOM
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    @keyframes ironGateBadgeFadeIn {
      from { opacity: 0; transform: scale(0.8) translateY(10px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes ironGateBadgeFadeOut {
      from { opacity: 1; transform: scale(1) translateY(0); }
      to { opacity: 0; transform: scale(0.8) translateY(10px); }
    }
    @keyframes ironGateDotPulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.3); }
    }
  `;
  shadow.appendChild(styleEl);

  // Badge container
  const badge = document.createElement('div');
  badge.style.cssText = `
    display: none;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    user-select: none;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  `;

  badge.addEventListener('mouseenter', () => {
    badge.style.transform = 'scale(1.05)';
    badge.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.18)';
  });
  badge.addEventListener('mouseleave', () => {
    badge.style.transform = 'scale(1)';
    badge.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.12)';
  });

  // Click opens the side panel
  badge.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
    } catch (error) {
      console.warn('[Iron Gate Badge] Failed to open side panel:', error);
    }
  });

  // Iron Gate shield icon (SVG)
  const iconEl = document.createElement('div');
  iconEl.style.cssText = `
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  iconEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" fill="currentColor" opacity="0.2"/>
    <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" stroke="currentColor" stroke-width="1.5" fill="none"/>
  </svg>`;

  // Status dot (color indicator)
  const dot = document.createElement('div');
  dot.style.cssText = `
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  `;

  // Score text
  const scoreEl = document.createElement('span');
  scoreEl.style.cssText = 'min-width: 16px; text-align: center;';

  // Level label
  const labelEl = document.createElement('span');
  labelEl.style.cssText = 'font-size: 11px; font-weight: 500; opacity: 0.8;';

  badge.appendChild(iconEl);
  badge.appendChild(dot);
  badge.appendChild(scoreEl);
  badge.appendChild(labelEl);
  shadow.appendChild(badge);
  document.body.appendChild(host);

  // ── Internal: apply styles for the current score/level ──
  function applyStyles() {
    const styles = LEVEL_STYLES[currentLevel] || LEVEL_STYLES.low;

    badge.style.background = styles.bg;
    badge.style.color = styles.text;
    badge.style.border = `1px solid ${styles.border}`;
    iconEl.style.color = styles.dot;
    dot.style.background = styles.dot;
    dot.style.boxShadow = `0 0 6px ${styles.glow}`;

    scoreEl.textContent = String(currentScore);
    labelEl.textContent = getLevelLabel(currentLevel);

    // Pulse the dot on update for visual feedback
    dot.style.animation = 'none';
    // Force reflow to restart animation
    void dot.offsetWidth;
    dot.style.animation = 'ironGateDotPulse 0.6s ease-in-out';
  }

  // ── Handle interface ──
  const handle: SensitivityBadgeHandle = {
    update(score: number, level: string) {
      const resolvedLevel = level || scoreToLevel(score);
      const changed = score !== currentScore || resolvedLevel !== currentLevel;

      currentScore = score;
      currentLevel = resolvedLevel;

      if (changed) {
        applyStyles();
      }

      // Auto-show when there's a score, auto-hide when zero
      if (score > 0 && !isVisible) {
        handle.show();
      } else if (score === 0 && isVisible) {
        handle.hide();
      }
    },

    show() {
      if (isVisible) return;
      isVisible = true;
      badge.style.display = 'flex';
      badge.style.animation = 'ironGateBadgeFadeIn 0.25s ease-out forwards';
      applyStyles();
    },

    hide() {
      if (!isVisible) return;
      isVisible = false;
      badge.style.animation = 'ironGateBadgeFadeOut 0.2s ease-in forwards';
      // Remove display after animation completes
      setTimeout(() => {
        if (!isVisible) {
          badge.style.display = 'none';
        }
      }, 200);
    },

    destroy() {
      isVisible = false;
      host.remove();
    },
  };

  return handle;
}
