import postgres from 'postgres';
import crypto from 'crypto';

const connStr = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || 'postgresql://localhost:5432/irongate';
const isRemote = connStr.includes('supabase') || connStr.includes('neon');
const isPooler = connStr.includes('pooler.supabase.com');

const sql = postgres(connStr, { ssl: isRemote ? 'require' : false, prepare: isPooler ? false : true });

async function main() {
  // Find existing user and firm
  const users = await sql`SELECT id, firm_id FROM users LIMIT 1`;
  if (users.length === 0) {
    console.error('No users found');
    process.exit(1);
  }
  const userId = users[0].id;
  const firmId = users[0].firm_id;

  // Create a known test key
  const rawKey = 'ig_test_key_for_extension_dev';
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 12);

  // Upsert
  await sql`
    INSERT INTO api_keys (firm_id, name, key_hash, key_prefix, scope, created_by)
    VALUES (${firmId}, 'Test Dev Key', ${keyHash}, ${keyPrefix}, 'read', ${userId})
    ON CONFLICT (key_hash) DO NOTHING
  `;

  console.log('=== TEST API KEY ===');
  console.log('Key:', rawKey);
  console.log('Hash:', keyHash);
  console.log('Firm:', firmId);
  console.log('User:', userId);
  console.log('====================');

  await sql.end();
}

main().catch(async (e) => {
  console.error('Error:', e.message);
  await sql.end();
  process.exit(1);
});
