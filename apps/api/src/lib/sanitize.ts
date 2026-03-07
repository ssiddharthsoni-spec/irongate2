/**
 * Input sanitization utilities.
 *
 * Strips dangerous HTML/script content from user-provided strings before
 * they're stored in the database or rendered in the dashboard. Prevents
 * stored XSS attacks via firm names, department names, plugin descriptions,
 * webhook URL display values, etc.
 */

// Characters that can break HTML context
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#96;',
};

const HTML_ENTITY_RE = /[&<>"'`/]/g;

/**
 * Escape HTML special characters in a string.
 * Use when displaying user input in HTML contexts.
 */
export function escapeHtml(str: string): string {
  return str.replace(HTML_ENTITY_RE, (ch) => HTML_ENTITIES[ch] || ch);
}

/**
 * Strip all HTML tags from a string, leaving only text content.
 * More aggressive than escapeHtml — removes tags entirely.
 */
export function stripHtml(str: string): string {
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script blocks
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')   // Remove style blocks
    .replace(/<[^>]*>/g, '')  // Remove remaining tags
    .replace(/&#?\w+;/g, '') // Remove HTML entities left behind
    .trim();
}

/**
 * Sanitize a user-provided string for safe storage and display.
 * Strips HTML tags and trims whitespace. Does NOT escape — the output
 * is plain text that should be escaped at render time by the frontend.
 *
 * Use this on all user-provided strings that will be:
 * - Stored in the database
 * - Returned in API responses
 * - Rendered in the dashboard
 */
export function sanitizeInput(str: string): string {
  if (typeof str !== 'string') return '';
  return stripHtml(str).trim();
}

/**
 * Sanitize a URL string. Blocks javascript: and data: URIs that could
 * execute code. Allows http, https, and empty strings.
 */
export function sanitizeUrl(url: string): string {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  // Block dangerous protocols
  const lower = trimmed.toLowerCase().replace(/\s/g, '');
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return '';
  }

  return trimmed;
}

/**
 * Apply sanitization to all string values in an object (shallow).
 * Useful for sanitizing request body objects before DB insertion.
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    const val = result[key];
    if (typeof val === 'string') {
      (result as any)[key] = sanitizeInput(val);
    }
  }
  return result;
}
