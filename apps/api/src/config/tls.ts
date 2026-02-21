// Iron Gate — TLS & Transport Security Configuration

/**
 * Minimum TLS version and HSTS settings for all external-facing endpoints.
 * TLSv1.3 is enforced; older versions are rejected at the load-balancer level.
 */
export const tlsConfig = {
  minVersion: 'TLSv1.3' as const,
  hsts: {
    /** 1 year in seconds */
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  pinning: {
    // Placeholder pins — replace with actual certificate SHA-256 hashes before
    // production deployment. The primary pin should be the leaf cert and the
    // backup pin should be an offline-generated key for disaster recovery.
    pins: [
      'sha256/PLACEHOLDER_PRIMARY_CERT_PIN_REPLACE_IN_PRODUCTION',
      'sha256/PLACEHOLDER_BACKUP_CERT_PIN_REPLACE_IN_PRODUCTION',
    ],
  },
};

/**
 * Returns the HSTS header value derived from the config above.
 * Attach this to every HTTPS response via middleware.
 */
export function hstsHeaderValue(): string {
  const { maxAge, includeSubDomains, preload } = tlsConfig.hsts;
  let value = `max-age=${maxAge}`;
  if (includeSubDomains) value += '; includeSubDomains';
  if (preload) value += '; preload';
  return value;
}

/**
 * Internal service-to-service TLS requirements.
 * Every inter-service link is encrypted in transit, even inside the VPC.
 */
export const internalTls = {
  /** API <-> Detection gRPC channel uses mTLS */
  apiToDetection: true,
  /** PostgreSQL connection uses sslmode=verify-full */
  apiToPostgres: true,
  /** Redis connection uses TLS when running outside localhost */
  apiToRedis: true,
};

/**
 * Cipher-suite allowlist applied at the reverse-proxy / ALB layer.
 * These map to TLS 1.3 cipher suites only.
 */
export const allowedCipherSuites = [
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'TLS_AES_128_GCM_SHA256',
] as const;
