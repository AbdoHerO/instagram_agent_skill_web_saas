import { join } from 'node:path';

import { migrate } from 'drizzle-orm/mysql2/migrator';

import { connectionOptions, drizzleFor, openPool } from './index';

/**
 * Applies the SQL migrations in ./drizzle (idempotent: applied ones are recorded
 * in __drizzle_migrations). Used by `npm run db:migrate` and, with
 * DB_AUTO_MIGRATE=true, when the server starts.
 */
export async function runMigrations(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const options = connectionOptions(env);
  if (!options) throw new Error('The database is not configured: set DATABASE_URL or the DB_* settings');
  const pool = openPool(options, 1);
  try {
    await migrate(drizzleFor(pool), { migrationsFolder: join(process.cwd(), 'drizzle') });
  } finally {
    await pool.end();
  }
}
