import { and, asc, eq, lt, lte, or, sql } from 'drizzle-orm';

import type { Db } from '@/server/db';
import { publishingJobs } from '@/server/db/schema';

/**
 * A durable queue in MySQL: jobs are rows. A worker claims due jobs with one
 * atomic UPDATE that stamps them with its id and the claim time; InnoDB locks
 * each row it changes and re-checks the condition, so two workers never take
 * the same job. A job left "running" by a crashed worker is taken back after
 * the lock timeout, and the schedule survives restarts because nothing lives
 * in memory.
 */
export const LOCK_TIMEOUT_MINUTES = 15;

export async function claimDueJobs(db: Db, workerId: string, limit = 5, now = new Date()) {
  const staleBefore = new Date(now.getTime() - LOCK_TIMEOUT_MINUTES * 60_000);
  await db.update(publishingJobs)
    .set({ status: 'running', lockedAt: now, lockedBy: workerId, attempts: sql`${publishingJobs.attempts} + 1`, updatedAt: now })
    .where(or(
      and(eq(publishingJobs.status, 'queued'), lte(publishingJobs.runAt, now)),
      and(eq(publishingJobs.status, 'running'), lt(publishingJobs.lockedAt, staleBefore)),
    ))
    .orderBy(asc(publishingJobs.runAt))
    .limit(limit);
  // The claim: this worker's id and this exact time (millisecond precision).
  return db.select().from(publishingJobs).where(and(eq(publishingJobs.lockedBy, workerId), eq(publishingJobs.lockedAt, now), eq(publishingJobs.status, 'running')));
}

/** Bounded retries: 1 min, 5 min, 15 min, 1 h. */
export function backoffSeconds(attempt: number): number {
  return [60, 300, 900, 3600][Math.min(Math.max(attempt, 1), 4) - 1]!;
}
