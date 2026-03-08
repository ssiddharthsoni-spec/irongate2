// Iron Gate — Secrets Manager Loader
//
// In production: loads secrets from AWS Secrets Manager (single JSON blob).
// In development: loads from environment variables with sensible local defaults.
//
// Guarantees:
//   - Secrets are cached in memory after the first load (singleton).
//   - Secrets are NEVER logged, NEVER serialized, NEVER included in error payloads.
//   - The returned object is frozen to prevent accidental mutation.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppSecrets {
  /** PostgreSQL connection string (sslmode=verify-full in production) */
  databaseUrl: string;
  /** Redis AUTH password */
  redisPassword: string;
  /** Clerk secret key for JWT verification */
  clerkSecretKey: string;
  /** HMAC key used to sign Iron Gate audit-chain hashes */
  jwtSigningKey: string;
  /** Optional: AWS KMS key ARN for envelope encryption */
  kmsKeyArn?: string;
  /** Optional: Webhook signing secret */
  webhookSigningSecret?: string;
}

// ---------------------------------------------------------------------------
// Internal state — singleton cache
// ---------------------------------------------------------------------------

let _cached: Readonly<AppSecrets> | null = null;

// ---------------------------------------------------------------------------
// AWS Secrets Manager loader
// ---------------------------------------------------------------------------

async function loadFromSecretsManager(): Promise<AppSecrets> {
  // Dynamic import so the AWS SDK is only pulled in when running in production
  // @ts-expect-error — @aws-sdk/client-secrets-manager is a production-only dependency
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager') as any;

  const region = process.env.AWS_REGION || 'us-east-1';
  const secretName = process.env.SECRETS_MANAGER_NAME || 'irongate/production';

  const client = new SecretsManagerClient({ region });
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error(
      `[Iron Gate Secrets] Empty response from Secrets Manager for "${secretName}"`,
    );
  }

  const raw = JSON.parse(response.SecretString) as Record<string, string>;

  return {
    databaseUrl: requireField(raw, 'DATABASE_URL'),
    redisPassword: requireField(raw, 'REDIS_PASSWORD'),
    clerkSecretKey: requireField(raw, 'CLERK_SECRET_KEY'),
    jwtSigningKey: requireField(raw, 'JWT_SIGNING_KEY'),
    kmsKeyArn: raw['KMS_KEY_ARN'] || undefined,
    webhookSigningSecret: raw['WEBHOOK_SIGNING_SECRET'] || undefined,
  };
}

// ---------------------------------------------------------------------------
// Environment variable loader (development / CI)
// ---------------------------------------------------------------------------

function loadFromEnv(): AppSecrets {
  const isTest = process.env.NODE_ENV === 'test';
  const isDev = process.env.NODE_ENV === 'development';

  // In non-dev/test environments, warn about missing secrets but don't crash.
  // Crashing at startup prevents the /health endpoint from responding,
  // which makes Render roll back to older deploys and hides the actual error.
  if (!isDev && !isTest) {
    const missing: string[] = [];
    if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) missing.push('DATABASE_URL');
    if (!process.env.CLERK_SECRET_KEY) missing.push('CLERK_SECRET_KEY');
    if (missing.length > 0) {
      console.error(
        `[CRITICAL] Required secrets missing: ${missing.join(', ')}. ` +
        'Routes depending on these will fail. Set them in your Render environment.',
      );
    }
  }

  return {
    databaseUrl:
      process.env.SUPABASE_DB_URL || process.env.DATABASE_URL ||
      (isDev || isTest ? 'postgresql://irongate:irongate_dev@localhost:5432/irongate' : ''),
    redisPassword: process.env.REDIS_PASSWORD || '',
    clerkSecretKey: process.env.CLERK_SECRET_KEY || (isDev || isTest ? `dev-clerk-${process.pid}` : ''),
    jwtSigningKey: process.env.JWT_SIGNING_KEY || process.env.IRON_GATE_SIGNING_SECRET || (isDev || isTest ? `dev-jwt-${process.pid}` : ''),
    kmsKeyArn: process.env.KMS_KEY_ARN || undefined,
    webhookSigningSecret: process.env.WEBHOOK_SIGNING_SECRET || undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load application secrets. Returns a frozen, cached singleton.
 *
 * - First call performs the actual load (AWS SM or env vars).
 * - Subsequent calls return the cached value instantly.
 */
export async function loadSecrets(): Promise<Readonly<AppSecrets>> {
  if (_cached) return _cached;

  // Use AWS Secrets Manager ONLY when explicitly configured.
  // Default to env vars for all deployments (Render, Railway, etc.).
  const useAwsSm = !!process.env.SECRETS_MANAGER_NAME;

  let secrets: AppSecrets;
  if (useAwsSm) {
    try {
      secrets = await loadFromSecretsManager();
    } catch (err) {
      console.error('[Secrets] AWS Secrets Manager failed, falling back to env vars:', (err as Error).message);
      secrets = loadFromEnv();
    }
  } else {
    secrets = loadFromEnv();
  }

  // Freeze to prevent accidental mutation
  _cached = Object.freeze(secrets);
  return _cached;
}

/**
 * Synchronously return already-loaded secrets.
 * Throws if `loadSecrets()` has not been awaited yet.
 */
export function getSecrets(): Readonly<AppSecrets> {
  if (!_cached) {
    throw new Error(
      '[Iron Gate Secrets] Secrets not loaded yet. Call and await loadSecrets() during startup.',
    );
  }
  return _cached;
}

/**
 * Clear the cached secrets. Intended for testing only.
 * @internal
 */
export function _resetSecretsCache(): void {
  _cached = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireField(obj: Record<string, string>, key: string): string {
  const value = obj[key];
  if (!value) {
    throw new Error(
      `[Iron Gate Secrets] Required secret "${key}" is missing from Secrets Manager payload.`,
    );
  }
  return value;
}
