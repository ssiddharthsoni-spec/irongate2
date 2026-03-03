/**
 * Auto-migration script that runs on startup to ensure the production
 * database has all required columns and tables. Uses IF NOT EXISTS / IF NOT
 * to be idempotent — safe to run on every deploy.
 */
import { db } from './client';
import { sql } from 'drizzle-orm';

const migrations: string[] = [
  // --- firms table additions ---
  `ALTER TABLE firms ADD COLUMN IF NOT EXISTS encryption_salt VARCHAR(64)`,
  `ALTER TABLE firms ADD COLUMN IF NOT EXISTS enrollment_code VARCHAR(50) UNIQUE`,

  // --- api_keys table ---
  `CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id UUID NOT NULL REFERENCES firms(id),
    name VARCHAR(255) NOT NULL DEFAULT 'Default',
    key_hash VARCHAR(255) NOT NULL,
    key_prefix VARCHAR(20) NOT NULL DEFAULT '',
    scope VARCHAR(20) NOT NULL DEFAULT 'write',
    created_by UUID NOT NULL REFERENCES users(id),
    revoked_at TIMESTAMP,
    expires_at TIMESTAMP,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
  )`,

  // --- subscriptions table (ensure it exists) ---
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id UUID NOT NULL REFERENCES firms(id),
    stripe_customer_id VARCHAR(255) NOT NULL,
    stripe_subscription_id VARCHAR(255),
    tier VARCHAR(50) NOT NULL DEFAULT 'free',
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    current_period_start TIMESTAMP,
    current_period_end TIMESTAMP,
    cancel_at_period_end BOOLEAN DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
];

export async function runAutoMigrations(): Promise<void> {
  for (const migration of migrations) {
    try {
      await db.execute(sql.raw(migration));
    } catch (err) {
      // Log but don't fail — some migrations may be redundant
      const msg = err instanceof Error ? err.message : String(err);
      // Suppress "already exists" errors — they're expected on re-runs
      if (!msg.includes('already exists')) {
        console.warn(`[auto-migrate] Warning: ${msg}`);
      }
    }
  }
  console.log('[auto-migrate] Schema check complete');
}
