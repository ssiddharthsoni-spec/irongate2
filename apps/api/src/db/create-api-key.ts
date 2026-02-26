/**
 * Create an API key for the default firm.
 * Run: npx tsx src/db/create-api-key.ts
 */

import { db } from './client';
import { apiKeys, firms, users } from './schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

async function createApiKey() {
  const firmId = process.env.DEFAULT_FIRM_ID;
  if (!firmId) {
    console.error('Set DEFAULT_FIRM_ID env variable');
    process.exit(1);
  }

  // Find the first admin user for this firm
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.firmId, firmId))
    .limit(1);

  if (!user) {
    console.error('No user found for firm', firmId);
    process.exit(1);
  }

  // Generate API key
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const key = `ig_${randomBytes}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = key.substring(0, 12);

  const [created] = await db
    .insert(apiKeys)
    .values({
      firmId,
      name: 'Chrome Extension Key',
      keyHash: hash,
      keyPrefix: prefix,
      scope: 'write',
      createdBy: user.id,
    })
    .returning();

  console.log('\n========================================');
  console.log('  API KEY CREATED');
  console.log('========================================');
  console.log(`  Key ID:     ${created.id}`);
  console.log(`  Key Prefix: ${prefix}`);
  console.log(`  Scope:      write`);
  console.log(`  Firm ID:    ${firmId}`);
  console.log('');
  console.log(`  Full API Key (save this — shown once):`);
  console.log(`  ${key}`);
  console.log('========================================\n');

  process.exit(0);
}

createApiKey().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
