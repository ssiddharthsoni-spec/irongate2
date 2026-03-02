import postgres from 'postgres';
import crypto from 'crypto';

const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || 'postgresql://localhost:5432/irongate';
const isRemote = connectionString.includes('supabase') || connectionString.includes('neon');
const isPooler = connectionString.includes('pooler.supabase.com');

const sql = postgres(connectionString, {
  ssl: isRemote ? 'require' : false,
  prepare: isPooler ? false : true,
});

async function main() {
  // Check existing tables
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
  console.log('Existing tables:', tables.map(t => t.table_name).join(', '));

  // Check if api_keys table exists
  const hasApiKeys = tables.some(t => t.table_name === 'api_keys');
  if (!hasApiKeys) {
    console.log('\nCreating api_keys table...');
    await sql`
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        firm_id UUID NOT NULL,
        name VARCHAR(255) NOT NULL,
        key_hash VARCHAR(64) UNIQUE NOT NULL,
        key_prefix VARCHAR(12) NOT NULL,
        scope VARCHAR(20) NOT NULL DEFAULT 'read',
        created_by UUID NOT NULL,
        last_used_at TIMESTAMP,
        revoked_at TIMESTAMP,
        expires_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;
    console.log('api_keys table created.');
  } else {
    console.log('\napi_keys table already exists.');
  }

  // Check if firms table exists
  const hasFirms = tables.some(t => t.table_name === 'firms');
  const hasUsers = tables.some(t => t.table_name === 'users');

  if (!hasFirms) {
    console.log('Creating firms table...');
    await sql`
      CREATE TABLE IF NOT EXISTS firms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE,
        domain VARCHAR(255),
        plan VARCHAR(50) NOT NULL DEFAULT 'trial',
        mode VARCHAR(20) NOT NULL DEFAULT 'proxy',
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        trial_ends_at TIMESTAMP,
        settings JSONB DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;
    console.log('firms table created.');
  }

  if (!hasUsers) {
    console.log('Creating users table...');
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clerk_id VARCHAR(255) UNIQUE NOT NULL,
        firm_id UUID NOT NULL,
        email VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;
    console.log('users table created.');
  }

  // Seed: ensure default firm exists
  const firmRows = await sql`SELECT id FROM firms LIMIT 1`;
  let firmId: string;
  if (firmRows.length === 0) {
    console.log('\nSeeding default firm...');
    const [firm] = await sql`
      INSERT INTO firms (name, slug, plan, mode)
      VALUES ('Default Firm', 'default', 'trial', 'proxy')
      RETURNING id
    `;
    firmId = firm.id;
    console.log('Default firm created:', firmId);
  } else {
    firmId = firmRows[0].id;
    console.log('\nUsing existing firm:', firmId);
  }

  // Ensure dev user exists
  const devUser = await sql`SELECT id FROM users WHERE clerk_id = 'dev-clerk-id' LIMIT 1`;
  let userId: string;
  if (devUser.length === 0) {
    console.log('Seeding dev user...');
    const [user] = await sql`
      INSERT INTO users (clerk_id, firm_id, email, display_name, role)
      VALUES ('dev-clerk-id', ${firmId}, 'dev@irongate.app', 'Dev User', 'admin')
      ON CONFLICT (clerk_id) DO UPDATE SET email = 'dev@irongate.app'
      RETURNING id
    `;
    userId = user.id;
    console.log('Dev user created:', userId);
  } else {
    userId = devUser[0].id;
    console.log('Using existing dev user:', userId);
  }

  // Create a dev API key if none exists
  const existingKeys = await sql`SELECT id FROM api_keys LIMIT 1`;
  if (existingKeys.length === 0) {
    const rawKey = 'ig_dev_' + crypto.randomBytes(24).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 12);

    await sql`
      INSERT INTO api_keys (firm_id, name, key_hash, key_prefix, scope, created_by)
      VALUES (${firmId}, 'Dev API Key', ${keyHash}, ${keyPrefix}, 'read', ${userId})
    `;
    console.log('\n=== DEV API KEY CREATED ===');
    console.log('Key:', rawKey);
    console.log('Prefix:', keyPrefix);
    console.log('Save this key — it will not be shown again!');
    console.log('===========================\n');
  } else {
    console.log('API keys already exist, skipping seed.');
  }

  console.log(`\nDEFAULT_FIRM_ID=${firmId}`);

  await sql.end();
  console.log('Done.');
}

main().catch(async (e) => {
  console.error('Error:', e.message);
  await sql.end();
  process.exit(1);
});
