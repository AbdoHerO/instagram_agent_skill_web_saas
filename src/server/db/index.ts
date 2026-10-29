import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

/**
 * One database type for the app (node-postgres) and the tests (PGlite, a real
 * Postgres compiled to WebAssembly): every service takes a `Db` argument.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

let pool: Pool | null = null;
let database: Db | null = null;

export function getDb(): Db {
  if (!database) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not configured (see README: initialise the database)');
    pool = new Pool({ connectionString: url, max: 10 });
    database = drizzle(pool, { schema }) as unknown as Db;
  }
  return database;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  database = null;
}

/** Rows of a raw `db.execute(sql…)` result (same shape on node-postgres and PGlite). */
export function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
