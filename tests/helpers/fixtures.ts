import type { Db } from '@/server/db';
import { instagramAccounts, mediaAssets, users } from '@/server/db/schema';
import type { ContentPayload } from '@/server/content/types';

export async function createUser(db: Db, email = `owner${Math.random().toString(36).slice(2)}@example.test`) {
  const [user] = await db.insert(users).values({ email, name: 'Owner', passwordHash: 'not-a-real-hash' }).returning();
  return user!;
}

export async function createAccount(db: Db, ownerId: string, overrides: Partial<typeof instagramAccounts.$inferInsert> = {}) {
  const [account] = await db.insert(instagramAccounts).values({
    ownerId, igUserId: `17841${Math.floor(Math.random() * 1e9)}`, username: 'eurodigital.test', status: 'connected',
    grantedScopes: ['instagram_basic', 'instagram_content_publish'], tokenCiphertext: null, ...overrides,
  }).returning();
  return account!;
}

export async function createMedia(db: Db, ownerId: string, mimeType: 'image/jpeg' | 'video/mp4' = 'image/jpeg') {
  const [asset] = await db.insert(mediaAssets).values({ ownerId, storage: 'local', storageKey: `test/${Math.random()}.jpg`, mimeType, sizeBytes: 1000, sha256: 'x' }).returning();
  return asset!;
}

export function payload(overrides: Partial<ContentPayload> = {}): ContentPayload {
  return {
    language: 'fr', hooks: [{ text: 'Trois choses à vérifier avant d’acheter un portable', formula: 'Listicle' }],
    caption: 'Trois choses à vérifier avant d’acheter un portable : l’écran, la batterie, le clavier.', cta: 'Écrivez-nous en message privé.',
    hashtags: ['#ordinateur', '#maroc'], altText: '', script: [], slides: [], storyFrames: [], plan: [], notes: '', needsVerification: [], productFacts: [],
    ...overrides,
  };
}
