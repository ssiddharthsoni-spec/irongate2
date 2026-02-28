/**
 * AI Platform Allow/Block List — Priority 10.1
 *
 * Enforces firm policies on which AI platforms employees can use.
 * Supports: allow, block, and justify-before-use modes.
 */

export type PlatformAction = 'allow' | 'block' | 'justify';

export interface PlatformPolicy {
  /** Platform identifier (e.g., 'chatgpt', 'claude', 'gemini') */
  platformId: string;
  /** Human-readable name */
  name: string;
  /** What to do when this platform is accessed */
  action: PlatformAction;
  /** Reason shown to user when blocked */
  blockReason?: string;
}

export interface PlatformDecision {
  action: PlatformAction;
  platformId: string;
  platformName: string;
  blockReason?: string;
}

/**
 * Check a platform against the firm's policy.
 */
export function checkPlatformPolicy(
  url: string,
  policies: PlatformPolicy[],
  defaultAction: PlatformAction = 'allow'
): PlatformDecision {
  const platformId = identifyPlatform(url);
  const policy = policies.find((p) => p.platformId === platformId);

  if (!policy) {
    return {
      action: defaultAction,
      platformId: platformId || 'unknown',
      platformName: platformId || 'Unknown Platform',
    };
  }

  return {
    action: policy.action,
    platformId: policy.platformId,
    platformName: policy.name,
    blockReason: policy.blockReason,
  };
}

/** Escape HTML special characters to prevent XSS from admin-configurable values */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Identify which AI platform a URL belongs to.
 */
function identifyPlatform(url: string): string | null {
  try {
  const patterns: [string, string][] = [
    ['chatgpt', 'chat.openai.com'],
    ['chatgpt', 'chatgpt.com'],
    ['claude', 'claude.ai'],
    ['gemini', 'gemini.google.com'],
    ['copilot', 'copilot.microsoft.com'],
    ['deepseek', 'chat.deepseek.com'],
    ['perplexity', 'perplexity.ai'],
    ['poe', 'poe.com'],
    ['groq', 'groq.com'],
    ['huggingface', 'huggingface.co'],
    ['you', 'you.com'],
  ];

  const hostname = new URL(url).hostname.toLowerCase();
  for (const [id, domain] of patterns) {
    if (hostname.includes(domain)) return id;
  }
  return null;
  } catch {
    return null;
  }
}

/**
 * Generate the HTML for a block overlay.
 */
export function generateBlockOverlay(decision: PlatformDecision): string {
  return `
    <div id="ig-block-overlay" style="
      position: fixed; inset: 0; z-index: 999999;
      background: rgba(0,0,0,0.85); display: flex;
      align-items: center; justify-content: center;
      font-family: -apple-system, sans-serif;
    ">
      <div style="
        background: white; border-radius: 16px; padding: 40px;
        max-width: 480px; width: 90%; text-align: center;
      ">
        <div style="font-size: 48px; margin-bottom: 16px;">🚫</div>
        <h2 style="margin: 0 0 12px; color: #1a1a2e; font-size: 22px;">
          Platform Not Approved
        </h2>
        <p style="color: #555; line-height: 1.6; margin-bottom: 24px;">
          Your firm has not approved <strong>${escapeHtml(decision.platformName)}</strong> for AI usage.
          ${decision.blockReason ? `<br><br>${escapeHtml(decision.blockReason)}` : ''}
        </p>
        <p style="color: #888; font-size: 14px;">
          Contact your IT administrator to request access.
        </p>
      </div>
    </div>
  `;
}

/**
 * Generate the HTML for a justification modal.
 */
export function generateJustificationModal(decision: PlatformDecision): string {
  return `
    <div id="ig-justify-modal" style="
      position: fixed; inset: 0; z-index: 999999;
      background: rgba(0,0,0,0.6); display: flex;
      align-items: center; justify-content: center;
      font-family: -apple-system, sans-serif;
    ">
      <div style="
        background: white; border-radius: 16px; padding: 32px;
        max-width: 480px; width: 90%;
      ">
        <h3 style="margin: 0 0 12px; color: #1a1a2e;">
          Justification Required
        </h3>
        <p style="color: #555; margin-bottom: 16px;">
          Please provide a reason for using <strong>${escapeHtml(decision.platformName)}</strong>:
        </p>
        <textarea id="ig-justify-input" style="
          width: 100%; min-height: 80px; padding: 12px;
          border: 2px solid #e2e8f0; border-radius: 8px;
          font-family: inherit; resize: vertical;
        " placeholder="Enter your justification..."></textarea>
        <div style="display: flex; gap: 8px; margin-top: 16px;">
          <button id="ig-justify-cancel" style="
            flex: 1; padding: 10px; border: 2px solid #e2e8f0;
            border-radius: 8px; background: white; cursor: pointer;
          ">Cancel</button>
          <button id="ig-justify-submit" style="
            flex: 1; padding: 10px; border: none; border-radius: 8px;
            background: #667eea; color: white; cursor: pointer;
          ">Continue</button>
        </div>
      </div>
    </div>
  `;
}
