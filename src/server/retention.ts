import { and, eq, lt } from 'drizzle-orm';

import { affectedRows, type Db } from '@/server/db';
import { aiGenerations, brandProfiles } from '@/server/db/schema';

const DEFAULT_AI_RETENTION_DAYS = 180;

/**
 * Applies Settings → "Keep AI generation logs (days)": generation records older
 * than that are deleted. Runs at sign-in and after each generation (indexed on
 * owner and date, cheap). Drafts themselves are kept until the team deletes them.
 */
export async function pruneAiGenerations(db: Db, ownerId: string, now = new Date()): Promise<number> {
  const [brand] = await db.select({ days: brandProfiles.aiRetentionDays }).from(brandProfiles).where(eq(brandProfiles.ownerId, ownerId));
  const cutoff = new Date(now.getTime() - (brand?.days ?? DEFAULT_AI_RETENTION_DAYS) * 86_400_000);
  return affectedRows(await db.delete(aiGenerations).where(and(eq(aiGenerations.ownerId, ownerId), lt(aiGenerations.createdAt, cutoff))));
}
