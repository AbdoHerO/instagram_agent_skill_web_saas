/**
 * Runs once when the Next.js server starts (Node.js runtime only).
 *
 * - DB_AUTO_MIGRATE=true (hosting without a shell, such as CloudOps): pending
 *   migrations are applied before the first request; if that fails, the server
 *   does not start, so a deployment's health check fails before any traffic is
 *   switched to it.
 * - WORKER_IN_PROCESS=true: the background worker (AI drafts, publishing jobs)
 *   runs inside this server, and stops cleanly on SIGTERM.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.DB_AUTO_MIGRATE === 'true') {
    const { runMigrations } = await import('./server/db/migrate');
    await runMigrations();
    console.log('[db] migrations applied');
  }
  if (process.env.WORKER_IN_PROCESS === 'true') {
    const { startInProcessWorker } = await import('./server/jobs/in-process');
    startInProcessWorker();
  }
}
