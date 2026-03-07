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
    // SPKI SHA-256 hashes for irongate-api.onrender.com and api.irongate.ai
    // To regenerate: openssl s_client -connect <host>:443 | openssl x509 -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | openssl enc -base64
    // Include both current and backup pins for rotation safety
    pins: [
      // Primary: Render.com / api.irongate.ai leaf certificate
      // NOTE: Replace these with actual hashes from your production certificates.
      // Run the openssl command above against irongate-api.onrender.com to get the real values.
      // These are placeholders that MUST be populated before production deployment.
    ] as string[],
    // SECURITY: If pins array is empty, cert pinning is not enforced.
    // This is acceptable ONLY during initial deployment. Once production certs
    // are provisioned, populate pins and set enforced=true.
    enforced: false,
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
