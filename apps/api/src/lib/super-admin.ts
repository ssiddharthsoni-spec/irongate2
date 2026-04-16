/**
 * Super-admin allowlist.
 *
 * Some IronGate accounts need to be permanent admins on a paid tier without
 * going through Stripe — the product owner, internal staff, designated QA.
 * Rather than sprinkling conditionals across the codebase, we centralize the
 * policy here:
 *
 *   - Set `IRONGATE_SUPER_ADMIN_EMAILS` on the API server (comma-separated).
 *   - Anyone who registers with a matching email gets:
 *       * role = 'admin'
 *       * a subscription at SUPER_ADMIN_TIER (default 'team')
 *       * status = 'active', currentPeriodEnd 10 years out
 *       * stripeCustomerId = 'super_admin_<firmId>' (distinct from trial_*)
 *   - On API startup, a best-effort sweep upgrades any existing
 *     super-admin accounts in the DB to the same state (self-healing).
 *
 * The tier and period-length are configurable via env so production and
 * staging can differ. When the env var is unset, this module is a no-op.
 */

import { eq, inArray, sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { db } from '../db/client';
import { firms, subscriptions, users } from '../db/schema';
import { logger } from './logger';

// Tier uses the DB schema enum (free | pro | business | enterprise).
// 'business' is the server-side name the dashboard maps to "Team" in the UI.
type SubscriptionTier = 'free' | 'pro' | 'business' | 'enterprise';
const DEFAULT_TIER: SubscriptionTier = 'business';
const DEFAULT_YEARS = 10;

function envList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.includes('@'));
}

export function getSuperAdminEmails(): string[] {
  return envList('IRONGATE_SUPER_ADMIN_EMAILS');
}

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getSuperAdminEmails().includes(email.toLowerCase());
}

export function getSuperAdminTier(): SubscriptionTier {
  const raw = (process.env.IRONGATE_SUPER_ADMIN_TIER || DEFAULT_TIER).toLowerCase();
  const allowed: SubscriptionTier[] = ['free', 'pro', 'business', 'enterprise'];
  return (allowed as string[]).includes(raw) ? (raw as SubscriptionTier) : DEFAULT_TIER;
}

function farFutureEnd(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + DEFAULT_YEARS);
  return d;
}

/**
 * Upsert a super-admin subscription for a firm — premium tier, no expiration.
 * Idempotent: safe to call repeatedly. Used at registration time AND by the
 * startup sweep.
 *
 * The SELECT-then-INSERT-or-UPDATE pattern has a race window: two callers
 * simultaneously see no existing row, both INSERT, duplicate subscriptions
 * for the same firm. Possible callers:
 *   - Startup super-admin sweep
 *   - /billing GET ensureSuperAdminUpgrade
 *   - /auth/register-extension new-user path
 *   - POST /admin/firm new-firm path
 *
 * We resolve it atomically by doing the insert inside a transaction with
 * an advisory lock keyed on firmId, which serializes concurrent calls for
 * the SAME firm while leaving different firms parallel.
 */
export async function applySuperAdminSubscription(
  firmId: string,
  tx?: PgTransaction<any, any, any>,
): Promise<void> {
  // If a caller already has a transaction, reuse it. Otherwise wrap in
  // our own. Either way the SELECT-then-INSERT/UPDATE sequence runs
  // under an advisory lock keyed on firmId that serializes concurrent
  // calls for the SAME firm. Different firms still run in parallel.
  if (tx) {
    await upsertInsideTx(firmId, tx);
    return;
  }
  await db.transaction(async (innerTx) => {
    await upsertInsideTx(firmId, innerTx);
  });
}

async function upsertInsideTx(
  firmId: string,
  tx: PgTransaction<any, any, any>,
): Promise<void> {
  const tier = getSuperAdminTier();
  const end = farFutureEnd();

  // Advisory lock keyed on a stable hash of the firmId. Transaction-scoped
  // (auto-released on commit/rollback). Same firm → same lock → concurrent
  // callers serialize. md5 → 128 bits; we take the first 16 hex chars
  // (64 bits) and cast to bigint (pg_advisory_xact_lock's signature).
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(('x' || substr(md5(${firmId}), 1, 16))::bit(64)::bigint)`,
  );

  const [existing] = await tx
    .select({ id: subscriptions.id, tier: subscriptions.tier, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId))
    .limit(1);

  if (existing) {
    await tx
      .update(subscriptions)
      .set({
        tier,
        status: 'active',
        stripeCustomerId: `super_admin_${firmId}`,
        currentPeriodStart: new Date(),
        currentPeriodEnd: end,
        cancelAtPeriodEnd: false,
      })
      .where(eq(subscriptions.id, existing.id));
  } else {
    await tx.insert(subscriptions).values({
      firmId,
      stripeCustomerId: `super_admin_${firmId}`,
      tier,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: end,
    });
  }
}

/**
 * Promote user to admin role. Called at registration and by the startup
 * sweep; idempotent.
 */
export async function applySuperAdminRole(
  userId: string,
  tx?: PgTransaction<any, any, any>,
): Promise<void> {
  const dbOrTx = (tx ?? db) as typeof db;
  await dbOrTx
    .update(users)
    .set({ role: 'admin', updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/**
 * Startup sweep — ensures every super-admin email in the DB is on the
 * premium tier. Self-healing: if the allowlist grows, the next restart
 * applies it; if a previous trial expired, this restores access.
 *
 * Non-fatal on any failure — logged but does not crash the server.
 */
export async function ensureSuperAdminsOnStartup(): Promise<void> {
  const emails = getSuperAdminEmails();
  if (emails.length === 0) {
    logger.info('Super-admin sweep skipped (no IRONGATE_SUPER_ADMIN_EMAILS configured)');
    return;
  }

  try {
    const rows = await db
      .select({ userId: users.id, firmId: users.firmId, email: users.email })
      .from(users)
      .where(inArray(sql`lower(${users.email})`, emails));

    if (rows.length === 0) {
      logger.info('Super-admin sweep: no matching users yet', { allowlistSize: emails.length });
      return;
    }

    for (const row of rows) {
      try {
        await applySuperAdminRole(row.userId);
        if (row.firmId) await applySuperAdminSubscription(row.firmId);
        logger.info('Super-admin upgraded', { email: row.email, firmId: row.firmId });
      } catch (err) {
        logger.error('Super-admin upgrade failed for user', {
          email: row.email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('Super-admin sweep complete', { upgraded: rows.length });
  } catch (err) {
    logger.error('Super-admin sweep errored', { error: err instanceof Error ? err.message : String(err) });
  }
}

// Export for tests
export const _internal = { farFutureEnd, DEFAULT_TIER, DEFAULT_YEARS };

// Silence unused import warning when firms is only referenced via schema types
void firms;
