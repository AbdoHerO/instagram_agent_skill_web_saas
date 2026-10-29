// Background worker as its own process: `npm run worker` (next to the web app), for hosts where the web server
// does not run it itself (WORKER_IN_PROCESS=true does, see src/instrumentation.ts). Writes AI drafts and handles
// publishing jobs; everything lives in the database, so a restart loses nothing. Logs never contain secrets.
import { hostname } from 'node:os';

import { loadLocalEnv } from '../scripts/load-env';

loadLocalEnv();

const { closeDb } = await import('../src/server/db');
const { env } = await import('../src/server/env');
const { generateDeps, publishDeps } = await import('../src/server/app');
const { startWorker } = await import('../src/server/jobs/worker');

const config = env();
const worker = startWorker({
  workerId: `${hostname()}:${process.pid}`,
  publishPollSeconds: config.WORKER_POLL_SECONDS,
  publishDeps: publishDeps(),
  generateDeps: generateDeps(),
});

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await worker.stop();
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
