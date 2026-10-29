// Applies the SQL migrations in ./drizzle to DATABASE_URL (idempotent).
// Usage: npm run db:migrate   (reads .env.local / environment)
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { loadLocalEnv } from './load-env';

loadLocalEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Run scripts/setup-database.ps1 first, or set it in .env.local.');
  process.exit(1);
}
const pool = new Pool({ connectionString: url });
try {
  await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  console.log('Database is up to date.');
} finally {
  await pool.end();
}
