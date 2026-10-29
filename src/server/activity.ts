import { and, desc, eq } from 'drizzle-orm';

import type { Db } from '@/server/db';
import { activity } from '@/server/db/schema';

export type ActivityLevel = 'info' | 'success' | 'warning' | 'error';

/** One line in the dashboard's recent activity (also the publish success / failure notices). */
export async function logActivity(db: Db, entry: { ownerId: string; draftId?: string | null; type: string; level?: ActivityLevel; message: string }) {
  await db.insert(activity).values({ ownerId: entry.ownerId, draftId: entry.draftId ?? null, type: entry.type, level: entry.level ?? 'info', message: entry.message });
}

export async function recentActivity(db: Db, ownerId: string, limit = 15) {
  return db.select().from(activity).where(eq(activity.ownerId, ownerId)).orderBy(desc(activity.createdAt)).limit(limit);
}

export async function unreadAlerts(db: Db, ownerId: string) {
  return db.select().from(activity).where(and(eq(activity.ownerId, ownerId), eq(activity.level, 'error'))).orderBy(desc(activity.createdAt)).limit(5);
}
