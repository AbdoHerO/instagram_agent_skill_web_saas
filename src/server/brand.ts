import { eq } from 'drizzle-orm';

import type { Db } from '@/server/db';
import { brandProfiles } from '@/server/db/schema';
import { loadVoiceFile } from '@/server/skills/registry';

/** The owner's brand profile (created with the account; recreated here if missing). The voice defaults to .claude/instagram/voice.md. */
export async function getBrand(db: Db, ownerId: string) {
  const [existing] = await db.select().from(brandProfiles).where(eq(brandProfiles.ownerId, ownerId));
  if (existing) return existing;
  // IGNORE: if another request created it in the meantime, keep that one (unique on owner_id).
  await db.insert(brandProfiles).ignore().values({ ownerId, name: 'Euro Digital', voiceMarkdown: loadVoiceFile() });
  const [created] = await db.select().from(brandProfiles).where(eq(brandProfiles.ownerId, ownerId));
  return created!;
}
