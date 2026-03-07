/**
 * Coaching Toast System — Real-time in-page feedback and education.
 *
 * Shows non-intrusive toast notifications in the bottom-left corner that:
 * - Confirm when entities are detected and pseudonymized
 * - Provide educational tips about data security best practices
 * - Reinforce secure behavior with positive feedback
 * - Warn about specific risks (large pastes, file uploads, etc.)
 *
 * Uses shadow DOM for complete CSS isolation from host page.
 * Toasts auto-dismiss and stack vertically.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToastType = 'shield' | 'tip' | 'warning' | 'success';

export interface ToastOptions {
  type: ToastType;
  title: string;
  message: string;
  /** Auto-dismiss after this many ms (default: 4000, 0 = manual dismiss only) */
  duration?: number;
  /** Optional action button */
  action?: { label: string; callback: () => void };
}

export interface CoachingToastHandle {
  /** Show a toast notification */
  show(options: ToastOptions): void;
  /** Remove all toasts */
  clear(): void;
  /** Clean up and remove the host element */
  destroy(): void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const HOST_ID = 'iron-gate-coaching-toast-host';
const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 4000;

const TYPE_STYLES: Record<ToastType, { icon: string; accent: string; bg: string; border: string }> = {
  shield: {
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" fill="#4f46e5" opacity="0.2"/><path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" stroke="#4f46e5" stroke-width="1.5" fill="none"/><path d="M9 12l2 2 4-4" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    accent: '#4f46e5',
    bg: '#eef2ff',
    border: '#c7d2fe',
  },
  tip: {
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#0ea5e9" opacity="0.15"/><circle cx="12" cy="12" r="10" stroke="#0ea5e9" stroke-width="1.5"/><path d="M12 16v-4m0-4h.01" stroke="#0ea5e9" stroke-width="2" stroke-linecap="round"/></svg>`,
    accent: '#0ea5e9',
    bg: '#f0f9ff',
    border: '#bae6fd',
  },
  warning: {
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2L1 21h22L12 2z" fill="#f59e0b" opacity="0.15"/><path d="M12 2L1 21h22L12 2z" stroke="#f59e0b" stroke-width="1.5" fill="none"/><path d="M12 9v4m0 4h.01" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/></svg>`,
    accent: '#f59e0b',
    bg: '#fffbeb',
    border: '#fde68a',
  },
  success: {
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#22c55e" opacity="0.15"/><circle cx="12" cy="12" r="10" stroke="#22c55e" stroke-width="1.5"/><path d="M8 12l3 3 5-5" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    accent: '#22c55e',
    bg: '#f0fdf4',
    border: '#bbf7d0',
  },
};

// ─── Coaching Tips Pool ──────────────────────────────────────────────────────

const COACHING_TIPS: string[] = [
  'Pro move: use role descriptions like "the lead attorney" instead of real names.',
  'Quick win: summarize key clauses instead of pasting full contracts — AI works better with concise context anyway.',
  'Power tip: Iron Gate auto-swaps real names with realistic fakes, so the AI still gives great answers.',
  'You\'re covered: Iron Gate catches SSNs, credit cards, and credentials before they leave your browser.',
  'Smart pattern: describe the problem abstractly — you\'ll often get better AI responses too.',
  'Your data never left your device. Iron Gate keeps it local and sends pseudonymized versions instead.',
  'Did you know? Proxy mode auto-protects every prompt — zero effort, full coverage.',
  'Nice work using AI for productivity. Iron Gate makes sure your client data stays private.',
  'Heads up: AI tools may use your inputs for training. Iron Gate ensures nothing identifiable gets through.',
  'Fun fact: the fake names Iron Gate uses are so realistic, the AI doesn\'t even notice the difference.',
  'You\'re building great habits. Security-aware AI usage is a professional superpower.',
  'Iron Gate just protected your prompt in the background. You didn\'t have to do a thing.',
];

let tipIndex = 0;

export function getNextCoachingTip(): string {
  const tip = COACHING_TIPS[tipIndex % COACHING_TIPS.length];
  tipIndex++;
  return tip;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function createCoachingToasts(): CoachingToastHandle {
  // Remove any existing host
  const existing = document.getElementById(HOST_ID);
  if (existing) existing.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 20px;
    z-index: 2147483645;
    pointer-events: none;
    display: flex;
    flex-direction: column-reverse;
    gap: 8px;
    max-height: 60vh;
    overflow: hidden;
  `;
  const shadow = host.attachShadow({ mode: 'closed' });

  // Inject shared styles
  const style = document.createElement('style');
  style.textContent = `
    @keyframes igToastIn {
      from { opacity: 0; transform: translateX(-20px) scale(0.95); }
      to { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes igToastOut {
      from { opacity: 1; transform: translateX(0) scale(1); }
      to { opacity: 0; transform: translateX(-20px) scale(0.95); }
    }
    .ig-toast {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 10px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
      max-width: 340px;
      pointer-events: auto;
      animation: igToastIn 0.25s ease-out forwards;
      cursor: default;
      position: relative;
    }
    .ig-toast.removing {
      animation: igToastOut 0.2s ease-in forwards;
    }
    .ig-toast-icon {
      flex-shrink: 0;
      margin-top: 1px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ig-toast-body {
      flex: 1;
      min-width: 0;
    }
    .ig-toast-title {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.3;
      margin-bottom: 2px;
    }
    .ig-toast-msg {
      font-size: 12px;
      line-height: 1.4;
      opacity: 0.8;
    }
    .ig-toast-close {
      position: absolute;
      top: 6px;
      right: 8px;
      width: 16px;
      height: 16px;
      background: none;
      border: none;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      font-size: 14px;
      line-height: 1;
      color: inherit;
    }
    .ig-toast:hover .ig-toast-close {
      opacity: 0.5;
    }
    .ig-toast-close:hover {
      opacity: 1 !important;
    }
    .ig-toast-action {
      display: inline-block;
      margin-top: 6px;
      font-size: 12px;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 5px;
      border: none;
      cursor: pointer;
      transition: opacity 0.15s ease;
    }
    .ig-toast-action:hover {
      opacity: 0.85;
    }
  `;
  shadow.appendChild(style);

  // Container for toasts
  const container = document.createElement('div');
  container.style.cssText = `
    display: flex;
    flex-direction: column-reverse;
    gap: 8px;
  `;
  shadow.appendChild(container);
  document.body.appendChild(host);

  const activeToasts: HTMLElement[] = [];

  function removeToast(el: HTMLElement) {
    el.classList.add('removing');
    setTimeout(() => {
      el.remove();
      const idx = activeToasts.indexOf(el);
      if (idx >= 0) activeToasts.splice(idx, 1);
    }, 200);
  }

  const handle: CoachingToastHandle = {
    show(options: ToastOptions) {
      const { type, title, message, duration = DEFAULT_DURATION, action } = options;
      const styles = TYPE_STYLES[type];

      // Limit visible toasts
      while (activeToasts.length >= MAX_VISIBLE) {
        removeToast(activeToasts[0]);
      }

      const toast = document.createElement('div');
      toast.className = 'ig-toast';
      toast.style.cssText = `
        background: ${styles.bg};
        border: 1px solid ${styles.border};
        color: #1f2937;
      `;

      // Icon
      const iconEl = document.createElement('div');
      iconEl.className = 'ig-toast-icon';
      iconEl.innerHTML = styles.icon;

      // Body
      const bodyEl = document.createElement('div');
      bodyEl.className = 'ig-toast-body';

      const titleEl = document.createElement('div');
      titleEl.className = 'ig-toast-title';
      titleEl.style.color = styles.accent;
      titleEl.textContent = title;

      const msgEl = document.createElement('div');
      msgEl.className = 'ig-toast-msg';
      msgEl.textContent = message;

      bodyEl.appendChild(titleEl);
      bodyEl.appendChild(msgEl);

      // Action button
      if (action) {
        const actionBtn = document.createElement('button');
        actionBtn.className = 'ig-toast-action';
        actionBtn.style.cssText = `background: ${styles.accent}; color: #ffffff;`;
        actionBtn.textContent = action.label;
        actionBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          action.callback();
          removeToast(toast);
        });
        bodyEl.appendChild(actionBtn);
      }

      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.className = 'ig-toast-close';
      closeBtn.innerHTML = '\u00d7';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeToast(toast);
      });

      toast.appendChild(iconEl);
      toast.appendChild(bodyEl);
      toast.appendChild(closeBtn);
      container.appendChild(toast);
      activeToasts.push(toast);

      // Pause auto-dismiss on hover
      let dismissTimer: ReturnType<typeof setTimeout> | null = null;

      function startDismiss() {
        if (duration > 0) {
          dismissTimer = setTimeout(() => removeToast(toast), duration);
        }
      }

      toast.addEventListener('mouseenter', () => {
        if (dismissTimer) clearTimeout(dismissTimer);
      });
      toast.addEventListener('mouseleave', () => {
        startDismiss();
      });

      startDismiss();
    },

    clear() {
      for (const toast of [...activeToasts]) {
        removeToast(toast);
      }
    },

    destroy() {
      activeToasts.length = 0;
      host.remove();
    },
  };

  return handle;
}
