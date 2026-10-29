// Background publishing worker: `npm run worker` (keep it running next to the web app).
// Runs independently of the browser and of web requests; jobs live in PostgreSQL,
// so a restart loses nothing. Logs never contain tokens or secrets.
import { hostname } from 'node:os';

import { loadLocalEnv } from '../scripts/load-env';

loadLocalEnv();

const { closeDb, getDb } = await import('../src/server/db');
const { env } = await import('../src/server/env');
const { claimDueJobs } = await import('../src/server/jobs/queue');
const { processPublishJob } = await import('../src/server/jobs/publish');
const { localStorage, s3Storage } = await import('../src/server/media/storage');

const config = env();
const workerId = `${hostname()}:${process.pid}`;
const storage = config.MEDIA_STORAGE === 's3'
  ? s3Storage({ bucket: config.S3_BUCKET ?? '', region: config.S3_REGION ?? '', endpoint: config.S3_ENDPOINT, accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY })
  : localStorage(config.MEDIA_LOCAL_DIR, config.MEDIA_PUBLIC_BASE_URL);
const deps = {
  db: getDb(),
  meta: { appId: config.META_APP_ID, appSecret: config.META_APP_SECRET, configId: config.META_LOGIN_CONFIG_ID, redirectUri: config.META_REDIRECT_URI, graphVersion: config.META_GRAPH_VERSION },
  storage,
  encryptionKey: config.TOKEN_ENCRYPTION_KEY,
  publishingMode: config.PUBLISHING_MODE,
};

let stopping = false;
const stop = () => {
  stopping = true;
  console.log(`[worker] stopping after the current job`);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

console.log(`[worker] ${workerId} started; publishing mode: ${config.PUBLISHING_MODE}; polling every ${config.WORKER_POLL_SECONDS}s`);
if (config.PUBLISHING_MODE !== 'live') console.log('[worker] PUBLISHING_MODE is not "live": due jobs will be marked failed without contacting Instagram.');

while (!stopping) {
  try {
    const jobs = await claimDueJobs(deps.db, workerId, 5);
    for (const job of jobs) {
      if (stopping) break;
      const outcome = await processPublishJob(deps, job.id);
      console.log(`[worker] job ${job.id} (draft ${job.draftId}): ${outcome}`);
    }
  } catch (error) {
    console.error(`[worker] cycle failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_SECONDS * 1000));
}
await closeDb();
console.log('[worker] stopped');
