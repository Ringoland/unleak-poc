import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';
import * as schema from './schema';

// Create PostgreSQL connection pool
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  max: config.database.maxConnections,
});

// Handle pool errors
pool.on('error', (err: Error) => {
  logger.error('Unexpected error on idle PostgreSQL client', err);
});

// Initialize Drizzle ORM
export const db = drizzle(pool, { schema });

// Graceful shutdown
export async function closeDatabase(): Promise<void> {
  await pool.end();
  logger.info('Database connection pool closed');
}

// Re-export schema
export * from './schema';
export type DbType = typeof db;
