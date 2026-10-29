import { inArray, sql } from 'drizzle-orm';

import { rowsOf, type Db } from '@/server/db';
import { publishingJobs } from '@/server/db/schema';

/**
 * A durable queue in PostgreSQL: jobs are rows, the worker claims due ones with
 * FOR UPDATE SKIP LOCKED (two workers never take the same job), a job left
 * "running" by a crashed worker is taken back after the lock timeout, and the
 * schedule survives restarts because nothing lives in memory.
 */
export const LOCK_TIMEOUT_MINUTES = 15;

export async function claimDueJobs(db: Db, workerId: string, limit = 5, now = new Date()) {
  const claimed = rowsOf<{ id: string }>(await db.execute(sql`
    UPDATE publishing_jobs
       SET status = 'running', locked_at = ${now}, locked_by = ${workerId}, attempts = attempts + 1, updated_at = ${now}
     WHERE id IN (
       SELECT id FROM publishing_jobs
        WHERE (status = 'queued' AND run_at <= ${now})
           OR (status = 'running' AND locked_at < ${new Date(now.getTime() - LOCK_TIMEOUT_MINUTES * 60_000)})
        ORDER BY run_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
     RETURNING id`));
  if (!claimed.length) return [];
  return db.select().from(publishingJobs).where(inArray(publishingJobs.id, claimed.map((row) => row.id)));
}

/** Bounded retries: 1 min, 5 min, 15 min, 1 h. */
export function backoffSeconds(attempt: number): number {
  return [60, 300, 900, 3600][Math.min(Math.max(attempt, 1), 4) - 1]!;
}
