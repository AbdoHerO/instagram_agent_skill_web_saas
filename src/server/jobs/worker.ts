import { claimGeneration, processGeneration, type GenerateDeps } from '@/server/ai/generate';

import { processPublishJob, type PublishDeps } from './publish';
import { claimDueJobs } from './queue';

/**
 * The background worker: two independent loops, so a long generation never
 * delays a due post.
 *
 * - generations: claims one queued AI request at a time (every 2 s);
 * - publishing: claims due jobs (every WORKER_POLL_SECONDS); with
 *   PUBLISHING_MODE=disabled they are marked failed without contacting Instagram.
 *
 * It runs inside the web server (WORKER_IN_PROCESS=true, started from
 * instrumentation.ts) or as `npm run worker`. Several workers may run at once,
 * for example the old and new release during a deployment: every claim is one
 * atomic UPDATE, so a job is never taken twice.
 */
export type WorkerOptions = {
  workerId: string;
  publishPollSeconds: number;
  generationPollMs?: number;
  publishDeps: PublishDeps;
  generateDeps: GenerateDeps;
  log?: (line: string) => void;
};

export type RunningWorker = {
  /** Stops claiming, aborts the wait for Claude (the request is queued again) and lets a publishing step finish; resolves within `deadlineMs`. */
  stop: (deadlineMs?: number) => Promise<void>;
};

export function startWorker(options: WorkerOptions): RunningWorker {
  const log = options.log ?? ((line: string) => console.log(line));
  const stopping = new AbortController();
  const sleep = (ms: number) => new Promise<void>((resolve) => {
    if (stopping.signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    stopping.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });

  const loop = async (name: string, intervalMs: number, cycle: () => Promise<void>) => {
    while (!stopping.signal.aborted) {
      try {
        await cycle();
      } catch (error) {
        log(`[worker] ${name} cycle failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
      await sleep(intervalMs);
    }
  };

  const generations = loop('generation', options.generationPollMs ?? 2000, async () => {
    // Drain the queue one request at a time, then wait for the next poll.
    while (!stopping.signal.aborted) {
      const claimed = await claimGeneration(options.generateDeps.db, options.workerId);
      if (!claimed) return;
      const outcome = await processGeneration(options.generateDeps, claimed.id, stopping.signal);
      log(`[worker] generation ${claimed.id} (draft ${claimed.draftId}): ${outcome.status}${outcome.status === 'failed' ? ` (${outcome.error.code})` : ''}`);
    }
  });

  const publishing = loop('publishing', options.publishPollSeconds * 1000, async () => {
    const jobs = await claimDueJobs(options.publishDeps.db, options.workerId, 5);
    for (const job of jobs) {
      if (stopping.signal.aborted) break; // claimed but not started: taken back after the lock timeout
      const outcome = await processPublishJob(options.publishDeps, job.id);
      log(`[worker] job ${job.id} (draft ${job.draftId}): ${outcome}`);
    }
  });

  log(`[worker] ${options.workerId} started; publishing mode: ${options.publishDeps.publishingMode}`);
  if (options.publishDeps.publishingMode !== 'live') log('[worker] PUBLISHING_MODE is not "live": due jobs are marked failed without contacting Instagram.');

  let stopped: Promise<void> | null = null;
  return {
    stop(deadlineMs = 14_000) {
      stopped ??= (async () => {
        stopping.abort();
        const done = Promise.allSettled([generations, publishing]).then(() => 'stopped' as const);
        const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), deadlineMs).unref());
        log(`[worker] ${await Promise.race([done, timeout]) === 'stopped' ? 'stopped' : `still busy after ${deadlineMs} ms: exiting anyway (an unfinished job is taken back later)`}`);
      })();
      return stopped;
    },
  };
}
