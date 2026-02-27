/**
 * Integration Test Helpers
 *
 * Provides DB connectivity checks, test data seeding, and cleanup
 * for integration tests that run against a real PostgreSQL database.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

const testDbUrl =
  process.env.TEST_DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL ||
  'postgresql://localhost:5432/irongate';

const isRemote = testDbUrl.includes('supabase') || testDbUrl.includes('neon');
const isPooler = testDbUrl.includes('pooler.supabase.com');

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Get a Drizzle DB instance for integration tests.
 * Creates the connection lazily and caches it.
 */
export function getTestDb() {
  if (_db) return _db;

  _client = postgres(testDbUrl, {
    max: 5,
    idle_timeout: 10,
    connect_timeout: 5,
    ssl: isRemote ? 'require' : false,
    prepare: isPooler ? false : true,
  });

  _db = drizzle(_client, { schema });
  return _db;
}

/**
 * Check if the database is reachable. Returns true/false.
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  try {
    getTestDb(); // Ensures _client is initialized
    const result = await _client!`SELECT 1 AS ok`;
    return result.length > 0;
  } catch {
    return false;
  }
}

/**
 * Pre-resolved DB availability check.
 * Resolves at module load time so it's available during test collection.
 */
export const DB_AVAILABLE: Promise<boolean> = isDatabaseAvailable().catch(() => false);

/**
 * Close the test database connection.
 */
export async function closeTestDb(): Promise<void> {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}

// ---------------------------------------------------------------------------
// Test Data Seeding
// ---------------------------------------------------------------------------

export interface TestContext {
  firmId: string;
  userId: string;
  firmName: string;
}

/**
 * Create an isolated test firm + user for integration tests.
 * Each test suite gets its own firm, so tests don't conflict.
 */
export async function seedTestData(label: string): Promise<TestContext> {
  const db = getTestDb();
  const firmId = randomUUID();
  const userId = randomUUID();
  const firmName = `test-firm-${label}-${Date.now()}`;

  // Create firm
  await db.insert(schema.firms).values({
    id: firmId,
    name: firmName,
    domain: `${label}.test.local`,
    mode: 'audit',
    config: {},
  });

  // Create user
  await db.insert(schema.users).values({
    id: userId,
    firmId,
    email: `test-${label}@irongate.test`,
    displayName: `Test User (${label})`,
    role: 'admin',
    clerkId: `clerk_test_${randomUUID().slice(0, 8)}`,
  });

  return { firmId, userId, firmName };
}

/**
 * Clean up all test data for a given firm.
 * Deletes in FK-safe order.
 */
export async function cleanupTestData(firmId: string): Promise<void> {
  const db = getTestDb();

  // Delete in reverse-FK order
  await db.delete(schema.feedback).where(eq(schema.feedback.firmId, firmId));
  await db.delete(schema.events).where(eq(schema.events.firmId, firmId));
  await db.delete(schema.entityCoOccurrences).where(eq(schema.entityCoOccurrences.firmId, firmId));
  await db.delete(schema.sensitivityPatterns).where(eq(schema.sensitivityPatterns.firmId, firmId));
  await db.delete(schema.inferredEntities).where(eq(schema.inferredEntities.firmId, firmId));
  await db.delete(schema.weightOverrides).where(eq(schema.weightOverrides.firmId, firmId));
  await db.delete(schema.pseudonymMaps).where(eq(schema.pseudonymMaps.firmId, firmId));
  await db.delete(schema.clientMatters).where(eq(schema.clientMatters.firmId, firmId));
  await db.delete(schema.firmPlugins).where(eq(schema.firmPlugins.firmId, firmId));
  await db.delete(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.firmId, firmId));
  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.firmId, firmId));
  await db.delete(schema.alerts).where(eq(schema.alerts.firmId, firmId));
  await db.delete(schema.auditLog).where(eq(schema.auditLog.firmId, firmId));
  await db.delete(schema.subscriptions).where(eq(schema.subscriptions.firmId, firmId));
  await db.delete(schema.invoices).where(eq(schema.invoices.firmId, firmId));
  await db.delete(schema.invites).where(eq(schema.invites.firmId, firmId));
  await db.delete(schema.users).where(eq(schema.users.firmId, firmId));
  await db.delete(schema.firms).where(eq(schema.firms.id, firmId));
}

// ---------------------------------------------------------------------------
// Test Event Factory
// ---------------------------------------------------------------------------

let _promptCounter = 0;

export function makeEventData(overrides: Record<string, unknown> = {}) {
  _promptCounter++;
  return {
    aiToolId: 'chatgpt',
    aiToolUrl: 'https://chat.openai.com',
    promptHash: `test_hash_${_promptCounter}_${Date.now().toString(36)}`.padEnd(64, '0').slice(0, 64),
    promptLength: 120 + _promptCounter,
    sensitivityScore: 45,
    sensitivityLevel: 'medium' as const,
    entities: [],
    action: 'pass' as const,
    captureMethod: 'fetch_intercept',
    metadata: { test: true },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test App Factory (Hono with mocked auth)
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import type { AppEnv } from '../../src/types';

/**
 * Create a Hono test app that injects auth context (firmId, userId, userRole)
 * without going through Clerk. Mounts the same routes as the real server.
 */
export function createTestApp(ctx: TestContext) {
  const app = new Hono<AppEnv>();

  // Inject auth context
  app.use('*', async (c, next) => {
    c.set('firmId', ctx.firmId);
    c.set('userId', ctx.userId);
    c.set('userRole', 'admin');
    c.set('clerkId', 'test-clerk-id');
    await next();
  });

  return app;
}
