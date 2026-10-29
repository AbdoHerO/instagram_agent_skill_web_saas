import { and, eq } from 'drizzle-orm';

import { insertRow, type Db } from '@/server/db';
import { mediaAssets } from '@/server/db/schema';

import { fileHash, newMediaKey, sniffMime, type MediaStorage } from './storage';

export class MediaError extends Error {}

/** Stores an uploaded file after checking its real type and size. */
export async function saveUpload(db: Db, storage: MediaStorage, input: { ownerId: string; data: Buffer; originalName: string; maxBytes: number }) {
  if (input.data.length === 0) throw new MediaError('The file is empty.');
  if (input.data.length > input.maxBytes) throw new MediaError(`The file is larger than ${Math.round(input.maxBytes / 1024 / 1024)} MB.`);
  const mime = sniffMime(input.data);
  if (!mime) throw new MediaError('Only JPEG images (feed posts) and MP4 videos (Reels) are accepted: Instagram publishing needs these formats.');
  const key = newMediaKey(input.ownerId, mime);
  await storage.put(key, input.data, mime);
  return insertRow(db, mediaAssets, {
    ownerId: input.ownerId, storage: storage.kind, storageKey: key, mimeType: mime, sizeBytes: input.data.length,
    sha256: fileHash(input.data), originalName: input.originalName.slice(0, 200),
  });
}

export async function ownedAsset(db: Db, ownerId: string, id: string) {
  const [asset] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.ownerId, ownerId)));
  return asset ?? null;
}

/** Checks that Meta will be able to download the file: reachable over https/http, right type. */
export async function checkPublicMedia(url: string, expectedMime: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; reason: string | null; transient: boolean }> {
  try {
    const response = await fetchImpl(url, { method: 'GET', headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    if (!(response.ok || response.status === 206)) return { ok: false, reason: `The media URL answered ${response.status}.`, transient: response.status >= 500 };
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
    if (type && type !== expectedMime) return { ok: false, reason: `The media URL serves ${type}, expected ${expectedMime}.`, transient: false };
    await response.body?.cancel().catch(() => undefined);
    return { ok: true, reason: null, transient: false };
  } catch {
    return { ok: false, reason: 'The media URL could not be reached from the server.', transient: true };
  }
}
