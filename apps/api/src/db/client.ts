import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import dns from 'node:dns';
import * as schema from './schema';

// Force IPv4 resolution — some cloud hosts (incl. Render) can't reach
// Supabase reliably over IPv6 in their default network configuration.
dns.setDefaultResultOrder('ipv4first');

// --- Write connection (primary) ---
const writeUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || 'postgresql://localhost:5432/irongate';
const isRemote = writeUrl.includes('supabase') || writeUrl.includes('neon');
const isPooler = writeUrl.includes('pooler.supabase.com');

const writeClient = postgres(writeUrl, {
  max: parseInt(process.env.DB_POOL_SIZE || '25', 10),
  idle_timeout: parseInt(process.env.DB_IDLE_TIMEOUT || '20', 10),
  connect_timeout: 10,
  max_lifetime: 60 * 30, // Recycle connections every 30 minutes
  ssl: isRemote ? 'require' : false,
  prepare: isPooler ? false : true,
});

export const db = drizzle(writeClient, { schema });

// --- Read connection (replica or same primary) ---
const readUrl = process.env.DATABASE_READ_URL || writeUrl;
const isReadRemote = readUrl.includes('supabase') || readUrl.includes('neon');
const isReadPooler = readUrl.includes('pooler.supabase.com');

const readClient = postgres(readUrl, {
  max: parseInt(process.env.DB_READ_POOL_SIZE || '25', 10),
  idle_timeout: parseInt(process.env.DB_IDLE_TIMEOUT || '20', 10),
  connect_timeout: 10,
  max_lifetime: 60 * 30,
  ssl: isReadRemote ? 'require' : false,
  prepare: isReadPooler ? false : true,
});

export const dbRead = drizzle(readClient, { schema });

export type Database = typeof db;
