import { randomUUID } from 'node:crypto';

import { eq, type InferInsertModel, type InferSelectModel, type SQL } from 'drizzle-orm';
import type { MySqlColumn, MySqlTable } from 'drizzle-orm/mysql-core';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { createPool, type Pool, type PoolOptions } from 'mysql2/promise';

import * as schema from './schema';

/**
 * One database type for the app and the tests (MySQL 8 in production, MariaDB
 * 10.4+ locally): every service takes a `Db` argument.
 */
export type Db = MySql2Database<typeof schema>;
export { schema };

/** MySQL 8's default modes, so a local MariaDB rejects what the server would reject. */
const SQL_MODE = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

/**
 * Where the database is: DATABASE_URL (`mysql://user:password@host:3306/name`), or
 * the DB_* settings that CloudOps writes into the website's .env (DB_SOCKET,
 * or DB_HOST and DB_PORT, with DB_DATABASE, DB_USERNAME and DB_PASSWORD).
 */
export function connectionOptions(env: NodeJS.ProcessEnv = process.env): PoolOptions | null {
  if (env.DATABASE_URL) return { uri: env.DATABASE_URL };
  if (env.DB_DATABASE && env.DB_USERNAME) {
    return {
      database: env.DB_DATABASE,
      user: env.DB_USERNAME,
      password: env.DB_PASSWORD || undefined,
      ...(env.DB_SOCKET ? { socketPath: env.DB_SOCKET } : { host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306) }),
    };
  }
  return null;
}

export function isDatabaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return connectionOptions(env) !== null;
}

/** A pool in UTC (dates are written and read as UTC), utf8mb4, strict SQL. */
export function openPool(options: PoolOptions, connectionLimit = 10): Pool {
  const pool = createPool({ ...options, connectionLimit, timezone: 'Z', charset: 'utf8mb4_unicode_ci', supportBigNumbers: true });
  // The core connection queues commands in order: this runs before any query on it.
  pool.pool.on('connection', (connection) => {
    connection.query(`SET SESSION sql_mode = '${SQL_MODE}', time_zone = '+00:00'`, (error) => {
      if (error) console.error('[db] could not set the session mode:', error.code);
    });
  });
  return pool;
}

export function drizzleFor(pool: Pool): Db {
  return drizzle(pool, { schema, mode: 'default' });
}

let pool: Pool | null = null;
let database: Db | null = null;

export function getDb(): Db {
  if (!database) {
    const options = connectionOptions();
    if (!options) throw new Error('The database is not configured: set DATABASE_URL or DB_DATABASE, DB_USERNAME and DB_PASSWORD (see README)');
    pool = openPool(options);
    database = drizzleFor(pool);
  }
  return database;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  database = null;
}

type TableWithId = MySqlTable & { id: MySqlColumn };

/**
 * MySQL has no RETURNING: the row is inserted with an id chosen here (or given),
 * then read back. Works inside a transaction (pass the transaction as `db`).
 */
export async function insertRow<T extends TableWithId>(db: Db, table: T, values: InferInsertModel<T>): Promise<InferSelectModel<T>> {
  const id = (values as { id?: string }).id ?? randomUUID();
  await db.insert(table).values({ ...values, id } as never);
  return rowById(db, table, id);
}

/** Update one row by id and read it back. */
export async function updateRow<T extends TableWithId>(db: Db, table: T, id: string, set: Partial<InferInsertModel<T>>): Promise<InferSelectModel<T>> {
  await db.update(table).set(set as never).where(eq(table.id, id));
  return rowById(db, table, id);
}

async function rowById<T extends TableWithId>(db: Db, table: T, id: string): Promise<InferSelectModel<T>> {
  const [row] = await db.select().from(table as MySqlTable).where(eq(table.id, id) as SQL);
  if (!row) throw new Error('The row was not found after writing it');
  return row as InferSelectModel<T>;
}

/** Rows changed by an UPDATE or DELETE (mysql2 result header). */
export function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}
