import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/irongate';
const isRemote = connectionString.includes('supabase') || connectionString.includes('neon');

// Create postgres client
const client = postgres(connectionString, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: isRemote ? 'require' : false,
});

// Create drizzle instance
export const db = drizzle(client, { schema });

export type Database = typeof db;
