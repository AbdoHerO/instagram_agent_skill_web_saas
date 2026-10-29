// Applies the SQL migrations in ./drizzle to the configured MySQL database (idempotent).
// Usage: npm run db:migrate   (reads .env.local / .env / environment)
import { loadLocalEnv } from './load-env';

loadLocalEnv();

const { isDatabaseConfigured } = await import('../src/server/db');
const { runMigrations } = await import('../src/server/db/migrate');

if (!isDatabaseConfigured()) {
  console.error('The database is not configured: set DATABASE_URL (or DB_DATABASE, DB_USERNAME, DB_PASSWORD) in .env.local. See scripts/setup-database.ps1.');
  process.exit(1);
}
try {
  await runMigrations();
  console.log('Database is up to date.');
} catch (error) {
  console.error(`Migration failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
}
