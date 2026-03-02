import postgres from 'postgres';
import crypto from 'crypto';

const connStr = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || 'postgresql://localhost:5432/irongate';
const isRemote = connStr.includes('supabase') || connStr.includes('neon');
const isPooler = connStr.includes('pooler.supabase.com');

const sql = postgres(connStr, { ssl: isRemote ? 'require' : false, prepare: isPooler ? false : true });

async function main() {
  const keys = await sql`SELECT id, name, key_prefix, key_hash, firm_id, created_by FROM api_keys LIMIT 5`;
  console.log('API keys:');
  for (const k of keys) {
    console.log(`  ${k.key_prefix}... (hash: ${k.key_hash.substring(0, 16)}...) firm=${k.firm_id} name=${k.name}`);
  }

  // Test: hash a known key and check
  const testKey = 'test';
  const testHash = crypto.createHash('sha256').update(testKey).digest('hex');
  console.log(`\nHash of "test": ${testHash}`);
  const match = keys.find((k: any) => k.key_hash === testHash);
  console.log(`Match for "test":`, match ? 'YES' : 'NO');

  await sql.end();
}

main().catch(async (e) => {
  console.error('Error:', e.message);
  await sql.end();
  process.exit(1);
});
