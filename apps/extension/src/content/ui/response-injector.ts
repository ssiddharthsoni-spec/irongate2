/**
 * Response Injector — Phase 2
 *
 * Injects the proxy LLM response back into the AI tool's page UI.
 *
 * Strategy:
 * 1. If the detector has an `injectResponse` method, use it (tool-specific injection)
 * 2. If the detector has `getResponseContainer`, inject into that container
 * 3. Fall back to creating a custom response container appended to the conversation area
 *
 * All injected responses include a small "Proxied by Iron Gate" badge.
 * A typing animation is used for natural-looking appearance.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface AIToolDetector {
  injectResponse?(container: HTMLElement, text: string): void;
  getResponseContainer?(): HTMLElement | null;
}

interface ResponseMetadata {
  model: string;
  provider: string;
  latencyMs: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const RESPONSE_CONTAINER_ID = 'iron-gate-proxy-response';
const TYPING_INTERVAL_MS = 12; // milliseconds between each character
const TYPING_CHUNK_SIZE = 3;   // characters revealed per tick for speed

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create the "Proxied by Iron Gate" badge element.
 */
function createProxyBadge(metadata?: ResponseMetadata): HTMLElement {
  const badge = document.createElement('div');
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    padding: 5px 12px;
    background: linear-gradient(135deg, #eef2ff, #e0e7ff);
    border: 1px solid #c7d2fe;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 11px;
    font-weight: 500;
    color: #4338ca;
    user-select: none;
  `;

  // Shield icon
  const icon = document.createElement('span');
  icon.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
  `;
  icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" fill="#6366f1" opacity="0.25"/>
    <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" stroke="#6366f1" stroke-width="1.5" fill="none"/>
  </svg>`;

  const text = document.createElement('span');
  text.textContent = 'Proxied by Iron Gate';

  badge.appendChild(icon);
  badge.appendChild(text);

  // Add metadata details if provided
  if (metadata) {
    const separator = document.createElement('span');
    separator.style.cssText = 'color: #a5b4fc; margin: 0 2px;';
    separator.textContent = '\u00B7';

    const details = document.createElement('span');
    details.style.cssText = 'color: #6366f1; opacity: 0.7; font-size: 10px;';
    details.textContent = `${metadata.model} \u00B7 ${metadata.latencyMs}ms`;

    badge.appendChild(separator);
    badge.appendChild(details);
  }

  return badge;
}

/**
 * Create a standalone response container when the detector doesn't provide one.
 * Styled to look reasonably neutral and not clash with most AI tool UIs.
 */
function createFallbackContainer(): HTMLElement {
  // Remove existing fallback container if present
  const existing = document.getElementById(RESPONSE_CONTAINER_ID);
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = RESPONSE_CONTAINER_ID;
  container.style.cssText = `
    margin: 16px 0;
    padding: 20px;
    background: #fafafa;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.7;
    color: #1f2937;
    white-space: pre-wrap;
    word-wrap: break-word;
    position: relative;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  `;

  return container;
}

/**
 * Find the best place in the page to insert a fallback response container.
 * Looks for common conversation/message list containers used by AI tools.
 */
function findInsertionPoint(): HTMLElement | null {
  // Common selectors for AI tool conversation areas
  const selectors = [
    // ChatGPT
    '[class*="react-scroll-to-bottom"]',
    'main div[class*="flex"][class*="flex-col"]',
    // Claude
    '[class*="conversation-content"]',
    // Gemini
    '[class*="conversation-container"]',
    // Generic patterns
    '[role="log"]',
    '[role="main"] > div',
    'main',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (el) return el;
  }

  return document.body;
}

/**
 * Animate text appearing character-by-character for a natural typing effect.
 * Resolves when the full text has been rendered.
 */
function animateTyping(
  element: HTMLElement,
  text: string,
  onComplete: () => void
): { cancel: () => void } {
  let index = 0;
  let cancelled = false;

  // Create a text node for the content
  const textNode = document.createTextNode('');
  element.appendChild(textNode);

  // Create a blinking cursor element
  const cursor = document.createElement('span');
  cursor.style.cssText = `
    display: inline-block;
    width: 2px;
    height: 1em;
    background: #6366f1;
    margin-left: 1px;
    vertical-align: text-bottom;
    animation: ironGateCursorBlink 0.8s step-end infinite;
  `;

  // Inject cursor blink animation if not already present
  let styleEl = element.querySelector('style[data-iron-gate-cursor]') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.setAttribute('data-iron-gate-cursor', 'true');
    styleEl.textContent = `
      @keyframes ironGateCursorBlink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0; }
      }
    `;
    element.appendChild(styleEl);
  }

  element.appendChild(cursor);

  function tick() {
    if (cancelled) return;

    if (index < text.length) {
      // Reveal the next chunk of characters
      const end = Math.min(index + TYPING_CHUNK_SIZE, text.length);
      textNode.textContent = text.substring(0, end);
      index = end;

      // Scroll to keep the typing visible
      element.scrollIntoView({ behavior: 'smooth', block: 'end' });

      setTimeout(tick, TYPING_INTERVAL_MS);
    } else {
      // Typing complete — remove cursor
      cursor.remove();
      if (styleEl && styleEl.parentNode === element) {
        styleEl.remove();
      }
      onComplete();
    }
  }

  // Start the animation
  requestAnimationFrame(tick);

  return {
    cancel() {
      cancelled = true;
      // Immediately show full text
      textNode.textContent = text;
      cursor.remove();
      if (styleEl && styleEl.parentNode === element) {
        styleEl.remove();
      }
      onComplete();
    },
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Inject a proxy LLM response into the AI tool's UI.
 *
 * Injection strategy (in order of preference):
 * 1. Detector's `injectResponse` method — tool-specific, most native appearance
 * 2. Detector's `getResponseContainer` — inject into the tool's response area
 * 3. Fallback — create a custom container and append to the conversation area
 *
 * In all cases, a "Proxied by Iron Gate" badge is appended after the response text.
 */
export function injectProxyResponse(
  detector: AIToolDetector,
  responseText: string,
  metadata?: ResponseMetadata
): void {
  // Strategy 1: Use the detector's custom injection method
  if (detector.injectResponse) {
    const container = detector.getResponseContainer?.() ?? createFallbackContainer();

    // If using fallback container, we need to insert it into the page
    if (container.id === RESPONSE_CONTAINER_ID) {
      const insertionPoint = findInsertionPoint();
      if (insertionPoint) {
        insertionPoint.appendChild(container);
      }
    }

    detector.injectResponse(container, responseText);

    // Append the proxy badge after injection
    const badge = createProxyBadge(metadata);
    container.appendChild(badge);
    return;
  }

  // Strategy 2: Use the detector's response container
  const existingContainer = detector.getResponseContainer?.();
  if (existingContainer) {
    injectIntoContainer(existingContainer, responseText, metadata);
    return;
  }

  // Strategy 3: Create a fallback container
  const fallbackContainer = createFallbackContainer();
  const insertionPoint = findInsertionPoint();
  if (insertionPoint) {
    insertionPoint.appendChild(fallbackContainer);
  }
  injectIntoContainer(fallbackContainer, responseText, metadata);
}

/**
 * Inject response text into a given container element with typing animation.
 * Clears the container first, then types out the response, then appends the badge.
 */
function injectIntoContainer(
  container: HTMLElement,
  responseText: string,
  metadata?: ResponseMetadata
): void {
  // Clear existing content
  container.innerHTML = '';

  // Create a wrapper for the text content
  const textWrapper = document.createElement('div');
  textWrapper.style.cssText = `
    white-space: pre-wrap;
    word-wrap: break-word;
    line-height: 1.7;
  `;
  container.appendChild(textWrapper);

  // Start typing animation
  animateTyping(textWrapper, responseText, () => {
    // After typing completes, append the proxy badge
    const badge = createProxyBadge(metadata);
    container.appendChild(badge);

    // Scroll to show the badge
    badge.scrollIntoView({ behavior: 'smooth', block: 'end' });
  });
}
