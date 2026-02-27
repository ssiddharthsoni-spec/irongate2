// Test setup — sets environment variables for test mode
// Load .env so integration tests can access SUPABASE_DB_URL, REDIS_URL, etc.
import { readFileSync } from 'fs';
import { resolve } from 'path';

try {
  const envPath = resolve(__dirname, '..', '.env');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Don't overwrite explicitly set env vars
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
} catch {
  // .env file missing — integration tests will skip gracefully
}

process.env.NODE_ENV = 'test';
process.env.DEFAULT_FIRM_ID = '00000000-0000-0000-0000-000000000001';
process.env.IRON_GATE_MASTER_SECRET = 'test-secret-key-for-unit-tests';
