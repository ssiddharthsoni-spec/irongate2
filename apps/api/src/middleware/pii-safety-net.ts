/**
 * PII Safety Net Middleware
 *
 * Last line of defense: scans incoming masked prompts for obvious
 * unmasked PII patterns. If the extension's pseudonymization failed
 * or was bypassed, this catches it and blocks the request.
 *
 * IMPORTANT: This middleware runs on the incoming request body.
 * It checks for PII patterns but NEVER stores, logs, or forwards
 * the matched values. Entity types and positions are logged — not values.
 */

import { createMiddleware } from 'hono/factory';
import { logger } from '../lib/logger';

// ─── PII Pattern Definitions ────────────────────────────────────────────────

interface PIIPattern {
  type: string;
  pattern: RegExp;
  description: string;
}

const PII_PATTERNS: PIIPattern[] = [
  {
    type: 'SSN',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    description: 'Social Security Number (XXX-XX-XXXX)',
  },
  {
    type: 'SSN',
    pattern: /\b\d{3}\s\d{2}\s\d{4}\b/g,
    description: 'Social Security Number (XXX XX XXXX)',
  },
  {
    type: 'CREDIT_CARD',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    description: 'Credit card number',
  },
  {
    type: 'CREDIT_CARD',
    pattern: /\b(?:\d{4}[-\s]){3}\d{4}\b/g,
    description: 'Credit card number (formatted)',
  },
  {
    type: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    description: 'Email address',
  },
  {
    type: 'PHONE',
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    description: 'Phone number',
  },
  {
    type: 'IP_ADDRESS',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    description: 'IPv4 address',
  },
  {
    type: 'API_KEY',
    pattern: /\b(?:sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|AIza[a-zA-Z0-9_-]{35})\b/g,
    description: 'API key / credential',
  },
  {
    type: 'DATABASE_URI',
    pattern: /\b(?:postgres|mysql|mongodb|redis):\/\/[^\s]+/g,
    description: 'Database connection string',
  },
];

// Known fake data that should NOT trigger the safety net.
// These are from our own fake data pools (extension + API pseudonymizer).
const KNOWN_FAKE_PATTERNS = new Set([
  'northwind.com', 'contoso.com', 'fabrikam.net', 'adatum.org', 'proseware.io',
  'woodgrove.com', 'tailspin.net', 'lucerne.org', 'alpine.io', 'meridian.com',
  'sk-test-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  'AKIAIOSFODNN7EXAMPLE',
  'postgres://user:pass@localhost:5432/testdb',
]);

function isKnownFake(matchText: string, firmWhitelist?: Set<string>): boolean {
  const lower = matchText.toLowerCase();
  for (const fake of KNOWN_FAKE_PATTERNS) {
    if (lower.includes(fake)) return true;
  }
  // Check firm-specific whitelist (admin-configured synthetic test data)
  if (firmWhitelist) {
    for (const pattern of firmWhitelist) {
      if (lower.includes(pattern.toLowerCase())) return true;
    }
  }
  return false;
}

// Cache for firm-specific PII whitelists (5 minute TTL)
const _firmWhitelistCache = new Map<string, { entries: Set<string>; expiresAt: number }>();

/**
 * Load firm-specific PII whitelist from firm config.
 * Admins can configure `piiWhitelist` array in firm config JSONB to add
 * synthetic test data patterns that should not trigger the safety net.
 */
export function loadFirmWhitelist(firmId: string, firmConfig: Record<string, any>): Set<string> | undefined {
  const cached = _firmWhitelistCache.get(firmId);
  if (cached && cached.expiresAt > Date.now()) return cached.entries;

  const whitelist = firmConfig?.piiWhitelist;
  if (!Array.isArray(whitelist) || whitelist.length === 0) return undefined;

  // Limit to 100 entries, each max 200 chars (prevent abuse)
  const entries = new Set(
    whitelist
      .filter((e: unknown) => typeof e === 'string' && e.length > 0 && e.length <= 200)
      .slice(0, 100) as string[]
  );

  if (entries.size === 0) return undefined;

  _firmWhitelistCache.set(firmId, { entries, expiresAt: Date.now() + 5 * 60 * 1000 });
  return entries;
}

// ─── Scanner ─────────────────────────────────────────────────────────────────

export interface PIIScanResult {
  clean: boolean;
  detectedTypes: string[];
  detectedCount: number;
}

/**
 * Scan text for unmasked PII patterns.
 * Returns types found, but NEVER the matched text values.
 */
export function scanForUnmaskedPII(text: string, firmWhitelist?: Set<string>): PIIScanResult {
  const detectedTypes = new Set<string>();
  let detectedCount = 0;

  for (const pattern of PII_PATTERNS) {
    // Reset regex state
    pattern.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.pattern.exec(text)) !== null) {
      // Skip known fakes from our pseudonymizer pools + firm whitelist
      if (isKnownFake(match[0], firmWhitelist)) continue;

      detectedTypes.add(pattern.type);
      detectedCount++;
    }
  }

  return {
    clean: detectedCount === 0,
    detectedTypes: Array.from(detectedTypes),
    detectedCount,
  };
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * PII Safety Net middleware for proxy relay routes.
 * Scans the maskedPrompt field for unmasked PII and blocks if found.
 */
export const piiSafetyNetMiddleware = createMiddleware(async (c, next) => {
  // Only scan POST requests with a body
  if (c.req.method !== 'POST') {
    await next();
    return;
  }

  try {
    // Clone the request body (reading it consumes the stream)
    const body = await c.req.json();
    const textToScan = body?.maskedPrompt || body?.text || '';

    if (!textToScan || textToScan.length < 10) {
      // Re-set body for downstream handlers
      c.req.raw = new Request(c.req.raw, {
        body: JSON.stringify(body),
        headers: c.req.raw.headers,
      });
      await next();
      return;
    }

    // Load firm-specific whitelist for synthetic test data
    let firmWhitelist: Set<string> | undefined;
    try {
      const firmId = c.get('firmId');
      const firmConfig = c.get('firmConfig') as Record<string, any> | undefined;
      if (firmId && firmConfig) {
        firmWhitelist = loadFirmWhitelist(firmId, firmConfig);
      }
    } catch { /* non-critical — proceed without whitelist */ }

    const scanResult = scanForUnmaskedPII(textToScan, firmWhitelist);

    if (!scanResult.clean) {
      // Log the detection (type + count only, NEVER the matched text)
      logger.warn('PII safety net triggered', {
        firmId: c.get('firmId'),
        detectedTypes: scanResult.detectedTypes,
        detectedCount: scanResult.detectedCount,
        endpoint: c.req.path,
      });

      return c.json({
        error: 'unmasked_pii_detected',
        message: 'Raw PII detected in prompt. Extension pseudonymization may have failed.',
        entityTypes: scanResult.detectedTypes,
        action: 'blocked',
      }, 422);
    }

    // Re-set body for downstream handlers
    c.req.raw = new Request(c.req.raw, {
      body: JSON.stringify(body),
      headers: c.req.raw.headers,
    });
  } catch {
    // If body parsing fails, let downstream handle it
  }

  await next();
});
