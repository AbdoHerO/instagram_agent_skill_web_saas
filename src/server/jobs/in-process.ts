import { hostname } from 'node:os';

import { generateDeps, publishDeps } from '@/server/app';
import { env } from '@/server/env';

import { startWorker, type RunningWorker } from './worker';

/** systemd (CloudOps) kills the process 20 s after SIGTERM: the worker gets 14 s, Next.js the rest. */
const STOP_DEADLINE_MS = 14_000;

const globalWorker = globalThis as typeof globalThis & { __agentWorker?: RunningWorker };

/**
 * The worker inside the Next.js server (WORKER_IN_PROCESS=true), for hosts that
 * run one process per website. Started once from instrumentation.ts.
 */
export function startInProcessWorker(): void {
  if (globalWorker.__agentWorker) return;
  const config = env();
  const worker = startWorker({
    workerId: `${hostname()}:${process.pid}:web`,
    publishPollSeconds: config.WORKER_POLL_SECONDS,
    publishDeps: publishDeps(),
    generateDeps: generateDeps(),
  });
  globalWorker.__agentWorker = worker;
  stopBeforeNextExits(() => worker.stop(STOP_DEADLINE_MS));
}

/**
 * `next start` installs its own SIGTERM/SIGINT handler, which closes the HTTP
 * server and then calls process.exit. That handler is kept, but runs only after
 * the worker has stopped (or the deadline has passed), so a job is never cut in
 * the middle of a step when the process can wait.
 */
function stopBeforeNextExits(stopWorker: () => Promise<void>): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    const nextHandlers = process.listeners(signal);
    process.removeAllListeners(signal);
    let handled = false;
    process.on(signal, () => {
      if (handled) return;
      handled = true;
      void stopWorker().finally(() => {
        if (!nextHandlers.length) process.exit(signal === 'SIGTERM' ? 143 : 130);
        for (const handler of nextHandlers) handler(signal);
      });
    });
  }
}
