import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';

import { randomToken, sha256 } from '@/server/crypto';

/**
 * Where media files live. Meta downloads the file from a public URL at publish
 * time, so the storage must give one:
 *  - local: files under MEDIA_LOCAL_DIR, served at MEDIA_PUBLIC_BASE_URL/media/<key>
 *    (needs a public https address, e.g. the production domain or a tunnel);
 *  - s3: an S3-compatible bucket; Meta gets a pre-signed GET URL valid for one hour.
 * Keys are random (not guessable); files are never listed.
 */
export type MediaStorage = {
  kind: 'local' | 's3';
  put(key: string, data: Buffer, mimeType: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  /** A URL Meta can fetch, or null when none is configured. */
  publicUrl(key: string): Promise<string | null>;
};

export const ACCEPTED_MEDIA = {
  'image/jpeg': { ext: 'jpg', label: 'JPEG image (feed posts)' },
  'video/mp4': { ext: 'mp4', label: 'MP4 video (Reels)' },
} as const;
export type AcceptedMime = keyof typeof ACCEPTED_MEDIA;

/** The real type from the file's first bytes (the browser's declared type is not trusted). */
export function sniffMime(data: Buffer): AcceptedMime | null {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length > 12 && data.subarray(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
  return null;
}

export function newMediaKey(ownerId: string, mime: AcceptedMime): string {
  return `${ownerId}/${randomToken(18)}.${ACCEPTED_MEDIA[mime].ext}`;
}

export function localStorage(rootDir: string, publicBaseUrl: string | undefined): MediaStorage {
  const root = resolve(rootDir);
  const pathFor = (key: string) => {
    const path = normalize(join(root, key));
    if (!path.startsWith(root + sep)) throw new Error('Invalid media key');
    return path;
  };
  return {
    kind: 'local',
    async put(key, data) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data, { flag: 'wx' });
    },
    async read(key) {
      return readFile(pathFor(key));
    },
    async remove(key) {
      await unlink(pathFor(key)).catch(() => undefined);
    },
    async publicUrl(key) {
      if (!publicBaseUrl) return null;
      await stat(pathFor(key));
      return `${publicBaseUrl.replace(/\/+$/, '')}/media/${key.split('/').map(encodeURIComponent).join('/')}`;
    },
  };
}

export function s3Storage(config: { bucket: string; region: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string }): MediaStorage {
  const client = (async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    return new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: Boolean(config.endpoint),
      credentials: config.accessKeyId && config.secretAccessKey ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } : undefined,
    });
  })();
  return {
    kind: 's3',
    async put(key, data, mimeType) {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      await (await client).send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: data, ContentType: mimeType }));
    },
    async read(key) {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const output = await (await client).send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      return Buffer.from(await output.Body!.transformToByteArray());
    },
    async remove(key) {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      await (await client).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
    async publicUrl(key) {
      const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([import('@aws-sdk/client-s3'), import('@aws-sdk/s3-request-presigner')]);
      return getSignedUrl(await client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), { expiresIn: 3600 });
    },
  };
}

export function fileHash(data: Buffer): string {
  return sha256(data);
}
