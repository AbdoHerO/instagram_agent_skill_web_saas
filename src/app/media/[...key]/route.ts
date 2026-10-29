import { readFile } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';

import { env } from '@/server/env';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = { jpg: 'image/jpeg', mp4: 'video/mp4' };

/**
 * Serves locally stored media so Meta can download it at publish time (it must
 * be reachable at MEDIA_PUBLIC_BASE_URL/media/...). Keys are random and never
 * listed; only .jpg and .mp4 files under MEDIA_LOCAL_DIR are served.
 */
export async function GET(_: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const config = env();
  if (config.MEDIA_STORAGE !== 'local') return new Response('Not found', { status: 404 });
  const { key } = await params;
  const root = resolve(config.MEDIA_LOCAL_DIR);
  const path = normalize(join(root, ...key));
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  if (!path.startsWith(root + sep) || !TYPES[extension] || key.length !== 2) return new Response('Not found', { status: 404 });
  try {
    const data = await readFile(path);
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': TYPES[extension]!, 'Content-Length': String(data.length), 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
