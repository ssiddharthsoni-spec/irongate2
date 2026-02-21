// Iron Gate — Redis Security Configuration
//
// All Redis keys use the `ig:` prefix for namespace isolation.
// PII is NEVER stored in Redis keys — only hashed identifiers are used.

export const redisSecurityConfig = {
  /** Enable TLS for Redis connections in production */
  tls: process.env.NODE_ENV === 'production',

  /** Eviction policy — least-recently-used across all keys */
  maxmemoryPolicy: 'allkeys-lru' as const,

  // -------------------------------------------------------------------------
  // TTL defaults (in seconds)
  // -------------------------------------------------------------------------

  /** Detection result cache — 5 minutes */
  defaultTtl: 300,
  /** Authenticated session cache — 15 minutes */
  sessionTtl: 900,
  /** Rate-limit sliding window — 1 minute */
  rateLimitTtl: 60,
  /** Kill-switch flag cache — 30 seconds (must propagate quickly) */
  killSwitchTtl: 30,
  /** Revoked-token entry — kept until the JWT's own expiry */
  revokedTokenTtl: 3600,

  // -------------------------------------------------------------------------
  // Key namespace
  // -------------------------------------------------------------------------

  /** Global prefix for all Iron Gate keys */
  keyPrefix: 'ig:',

  /**
   * Key patterns.
   * Placeholders (e.g. `{promptHash}`) are replaced at runtime.
   * No plaintext PII ever appears in a key — only SHA-256 hashes.
   */
  keyPatterns: {
    /** Cached detection result keyed by prompt hash */
    detect: 'ig:detect:{promptHash}',
    /** Per-firm rate-limit counter scoped to a sliding window */
    rateLimit: 'ig:rate:{firmId}:{window}',
    /** Session cache keyed by JWT hash */
    session: 'ig:session:{jwtHash}',
    /** Kill-switch flag, scoped (global | firm | user) */
    killSwitch: 'ig:kill-switch:{scope}',
    /** Revoked JWT entry keyed by the token's JTI claim */
    revoked: 'ig:revoked:{jti}',
  },
} as const;

// -------------------------------------------------------------------------
// Helper — build a concrete key from a pattern
// -------------------------------------------------------------------------

type KeyPatternName = keyof typeof redisSecurityConfig.keyPatterns;

/**
 * Resolves a key pattern into a concrete Redis key.
 *
 * @example
 * buildKey('detect', { promptHash: 'abc123' })
 * // => "ig:detect:abc123"
 */
export function buildKey(
  pattern: KeyPatternName,
  params: Record<string, string>,
): string {
  let key: string = redisSecurityConfig.keyPatterns[pattern];
  for (const [placeholder, value] of Object.entries(params)) {
    key = key.replace(`{${placeholder}}`, value);
  }
  return key;
}

/**
 * Returns the appropriate TTL (in seconds) for a given key category.
 */
export function ttlForCategory(
  category: 'detect' | 'session' | 'rateLimit' | 'killSwitch' | 'revoked',
): number {
  switch (category) {
    case 'detect':
      return redisSecurityConfig.defaultTtl;
    case 'session':
      return redisSecurityConfig.sessionTtl;
    case 'rateLimit':
      return redisSecurityConfig.rateLimitTtl;
    case 'killSwitch':
      return redisSecurityConfig.killSwitchTtl;
    case 'revoked':
      return redisSecurityConfig.revokedTokenTtl;
  }
}
