import { NextResponse, type NextRequest } from 'next/server';

import { mediaStorage } from '@/server/app';
import { currentUser } from '@/server/auth/session';
import { NotFoundError } from '@/server/content/service';
import { WorkflowError } from '@/server/content/workflow';
import { getDb } from '@/server/db';
import { env } from '@/server/env';
import { isSameOrigin } from '@/server/http';
import { attachMedia } from '@/server/media/attach';
import { MediaError } from '@/server/media/service';

export const dynamic = 'force-dynamic';

/** Room for the multipart envelope around the file. */
const FORM_OVERHEAD_BYTES = 1024 * 1024;

/**
 * Uploads a JPEG or MP4 and attaches it to a draft (a new version).
 *
 * A route handler, not a Server Action: Cloudflare's firewall rules for Next.js
 * Server Actions (requests with a `Next-Action` header) inspect the body and can
 * block a photo of a few MB whose bytes happen to match a pattern (seen live on
 * agent-intg.abdocloud.com: 403 "Attention Required", the request never reached
 * the server). Without that header the same upload goes through.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const config = env();
  if (!isSameOrigin(request, config.APP_URL)) return NextResponse.json({ error: 'Cross-site request refused.' }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Draft not found.' }, { status: 404 });
  const limitMb = Math.floor(config.MEDIA_MAX_BYTES / 1024 / 1024);
  if (Number(request.headers.get('content-length') ?? 0) > config.MEDIA_MAX_BYTES + FORM_OVERHEAD_BYTES) {
    return NextResponse.json({ error: `The file is larger than ${limitMb} MB.` }, { status: 413 });
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    return NextResponse.json({ error: 'The upload could not be read. Try again.' }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Choose a JPEG image or an MP4 video.' }, { status: 400 });

  try {
    await attachMedia(getDb(), mediaStorage(), {
      ownerId: user.id, userId: user.id, draftId: id, data: Buffer.from(await file.arrayBuffer()), originalName: file.name, maxBytes: config.MEDIA_MAX_BYTES,
    });
    return NextResponse.json({ ok: true, message: 'Media attached in a new version. Approve it before scheduling.' });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: 'Draft not found.' }, { status: 404 });
    if (error instanceof MediaError || error instanceof WorkflowError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('[upload]', error instanceof Error ? error.name : 'error');
    return NextResponse.json({ error: 'The upload failed. Nothing was changed.' }, { status: 500 });
  }
}
