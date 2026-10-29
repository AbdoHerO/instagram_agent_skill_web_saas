import { randomBytes } from 'node:crypto';

import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createConnection } from 'mysql2/promise';

import { drizzleFor, openPool, type Db } from '@/server/db';

/**
 * A fresh MySQL database per test file, with the real migrations applied, dropped
 * afterwards. TEST_MYSQL_URL points at a server where the user may create
 * databases (default: a local MariaDB/MySQL with root and no password, as XAMPP
 * installs it). Only databases named agent_ai_intg_test_* are created or dropped.
 */
const SERVER = process.env.TEST_MYSQL_URL ?? 'mysql://root@127.0.0.1:3306';

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const name = `agent_ai_intg_test_${randomBytes(6).toString('hex')}`;
  const admin = await createConnection({ uri: SERVER });
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();

  const url = new URL(SERVER);
  url.pathname = `/${name}`;
  const pool = openPool({ uri: url.toString() }, 5);
  const db = drizzleFor(pool);
  await migrate(db, { migrationsFolder: 'drizzle' });
  return {
    db,
    close: async () => {
      await pool.end();
      const cleanup = await createConnection({ uri: SERVER });
      await cleanup.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await cleanup.end();
    },
  };
}
