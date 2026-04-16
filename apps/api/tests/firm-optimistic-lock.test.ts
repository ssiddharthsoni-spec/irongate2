/**
 * REMEDIATION.md · Phase 4 deferred item — concurrent-edit protection
 * on the `firms` table.
 *
 * Architectural invariant tests: verify every piece of the optimistic-
 * lock story is present and wired up. Don't exercise a live DB (that's
 * integration work), but prevent a future refactor from silently
 * removing any one piece of the three-part contract:
 *
 *   1. Drizzle schema declares a non-null `version` column, default 1.
 *   2. Auto-migration includes idempotent ALTER TABLE for existing DBs.
 *   3. PUT /admin/firm:
 *      - accepts `version` in body (required)
 *      - uses it in WHERE clause (CAS)
 *      - increments on success
 *      - returns 409 on mismatch with `currentVersion` for the client
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schemaSrc = readFileSync(
  join(__dirname, '../src/db/schema.ts'),
  'utf8',
);
const autoMigrateSrc = readFileSync(
  join(__dirname, '../src/db/auto-migrate.ts'),
  'utf8',
);
const adminSrc = readFileSync(
  join(__dirname, '../src/routes/admin.ts'),
  'utf8',
);

describe('firms optimistic-lock invariants', () => {
  it('schema.ts declares a `version` integer column with default 1', () => {
    const block = schemaSrc.match(
      /export const firms = pgTable\('firms', \{([\s\S]*?)\}\);/,
    );
    expect(block, 'firms pgTable block not found').toBeTruthy();
    const body = block![1];
    expect(body).toMatch(/version:\s*integer\('version'\)/);
    expect(body).toMatch(/\.notNull\(\)/);
    expect(body).toMatch(/\.default\(1\)/);
  });

  it('auto-migrate.ts adds the column idempotently', () => {
    expect(autoMigrateSrc).toMatch(
      /ALTER TABLE firms ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1/,
    );
  });

  it('PUT /admin/firm schema requires version', () => {
    // Match the updateSchema block. adminSrc has multiple z.object calls;
    // the version-requiring one is the PUT /firm updateSchema.
    expect(adminSrc).toMatch(
      /updateSchema\s*=\s*z\.object\(\{[\s\S]*?version:\s*z\.number\(\)\.int\(\)\.nonnegative\(\)[\s\S]*?\}\)/,
    );
  });

  it('PUT /admin/firm uses version in WHERE and bumps on success', () => {
    expect(adminSrc).toMatch(
      /\.where\(and\(eq\(firms\.id,\s*firmId\),\s*eq\(firms\.version,\s*clientVersion\)\)\)/,
    );
    expect(adminSrc).toMatch(/version:\s*sql`\$\{firms\.version\}\s*\+\s*1`/);
  });

  it('PUT /admin/firm returns 409 with currentVersion on conflict', () => {
    expect(adminSrc).toMatch(/error:\s*'version_conflict'/);
    expect(adminSrc).toMatch(/currentVersion:\s*current\.version/);
    // 409 status code present in the conflict branch
    expect(adminSrc).toMatch(/\},\s*409,?\s*\)/);
  });

  it('PUT /admin/firm distinguishes 404 (missing) from 409 (conflict)', () => {
    // When the UPDATE returned no rows, we re-SELECT to disambiguate.
    expect(adminSrc).toMatch(
      /if\s*\(!current\)\s*return\s*c\.json\(\{\s*error:\s*'Firm not found'\s*\},\s*404\)/,
    );
  });
});
