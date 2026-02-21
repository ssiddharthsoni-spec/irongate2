import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import dns from 'node:dns';
import * as schema from './schema';

// Force IPv4 resolution — Railway can't reach Supabase over IPv6
dns.setDefaultResultOrder('ipv4first');

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/irongate';
const isRemote = connectionString.includes('supabase') || connectionString.includes('neon');
const isPooler = connectionString.includes('pooler.supabase.com');

// Create postgres client
const client = postgres(connectionString, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: isRemote ? 'require' : false,
  prepare: isPooler ? false : true,
});

// Create drizzle instance
export const db = drizzle(client, { schema });

export type Database = typeof db;
