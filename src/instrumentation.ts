/**
 * Runs once when the Next.js server starts. With DB_AUTO_MIGRATE=true (hosting
 * without a shell, such as CloudOps), pending migrations are applied before the
 * first request; if that fails, the server does not start, so a deployment's
 * health check fails before any traffic is switched to it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.DB_AUTO_MIGRATE !== 'true') return;
  const { runMigrations } = await import('./server/db/migrate');
  await runMigrations();
  console.log('[db] migrations applied');
}
