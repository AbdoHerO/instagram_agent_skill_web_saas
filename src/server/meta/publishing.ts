import { graphRequest, type MetaConfig } from './graph';

/**
 * Official content publishing (Instagram API with Unified Login, graph.facebook.com):
 *   1. POST /{ig-user-id}/media            -> container (image_url, or media_type=REELS + video_url)
 *   2. GET  /{container-id}?fields=status_code   (once per minute, at most 5 minutes)
 *   3. POST /{ig-user-id}/media_publish creation_id -> Instagram media ID
 * Media must be on a public server when Meta fetches it; images must be JPEG.
 * Accounts are limited to 100 API-published posts per 24 hours.
 */
export type ContainerStatus = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';

export async function createContainer(config: MetaConfig, token: string, igUserId: string, input: { kind: 'feed_image' | 'reel'; mediaUrl: string; caption: string; altText?: string }): Promise<string> {
  const params: Record<string, string | undefined> = input.kind === 'reel'
    ? { media_type: 'REELS', video_url: input.mediaUrl, caption: input.caption }
    : { image_url: input.mediaUrl, caption: input.caption, alt_text: input.altText || undefined };
  const data = await graphRequest<{ id: string }>(config, 'POST', `${igUserId}/media`, params, token);
  return data.id;
}

export async function containerStatus(config: MetaConfig, token: string, containerId: string): Promise<{ status: ContainerStatus; detail: string | null }> {
  const data = await graphRequest<{ status_code?: ContainerStatus; status?: string }>(config, 'GET', containerId, { fields: 'status_code,status' }, token);
  return { status: data.status_code ?? 'IN_PROGRESS', detail: data.status ?? null };
}

export async function publishContainer(config: MetaConfig, token: string, igUserId: string, containerId: string): Promise<string> {
  const data = await graphRequest<{ id: string }>(config, 'POST', `${igUserId}/media_publish`, { creation_id: containerId }, token);
  return data.id;
}

export async function publishingQuota(config: MetaConfig, token: string, igUserId: string): Promise<{ used: number | null; total: number | null }> {
  const data = await graphRequest<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
    config, 'GET', `${igUserId}/content_publishing_limit`, { fields: 'quota_usage,config' }, token,
  );
  const row = data.data?.[0];
  return { used: row?.quota_usage ?? null, total: row?.config?.quota_total ?? null };
}

/** Caption as posted: the text, then the hashtags. */
export function postCaption(caption: string, hashtags: string[]): string {
  return [caption.trim(), hashtags.join(' ')].filter(Boolean).join('\n\n');
}
