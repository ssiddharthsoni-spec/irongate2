import postgres from 'postgres';

const connStr = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || 'postgresql://localhost:5432/irongate';
const isRemote = connStr.includes('supabase') || connStr.includes('neon');
const isPooler = connStr.includes('pooler.supabase.com');

const sql = postgres(connStr, { ssl: isRemote ? 'require' : false, prepare: isPooler ? false : true });

async function main() {
  // Check current columns in api_keys
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys'
    ORDER BY ordinal_position
  `;
  console.log('Current api_keys columns:', cols.map(c => c.column_name).join(', '));

  const columnNames = cols.map(c => c.column_name);

  // Add missing columns
  if (!columnNames.includes('expires_at')) {
    console.log('Adding expires_at column...');
    await sql`ALTER TABLE api_keys ADD COLUMN expires_at TIMESTAMP`;
  }

  if (!columnNames.includes('revoked_at')) {
    console.log('Adding revoked_at column...');
    await sql`ALTER TABLE api_keys ADD COLUMN revoked_at TIMESTAMP`;
  }

  if (!columnNames.includes('last_used_at')) {
    console.log('Adding last_used_at column...');
    await sql`ALTER TABLE api_keys ADD COLUMN last_used_at TIMESTAMP`;
  }

  if (!columnNames.includes('scope')) {
    console.log('Adding scope column...');
    await sql`ALTER TABLE api_keys ADD COLUMN scope VARCHAR(20) NOT NULL DEFAULT 'read'`;
  }

  if (!columnNames.includes('key_prefix')) {
    console.log('Adding key_prefix column...');
    await sql`ALTER TABLE api_keys ADD COLUMN key_prefix VARCHAR(12) NOT NULL DEFAULT ''`;
  }

  // Verify
  const updatedCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys'
    ORDER BY ordinal_position
  `;
  console.log('\nUpdated api_keys columns:', updatedCols.map(c => c.column_name).join(', '));

  await sql.end();
  console.log('Done.');
}

main().catch(async (e) => {
  console.error('Error:', e.message);
  await sql.end();
  process.exit(1);
});
