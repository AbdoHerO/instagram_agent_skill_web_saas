import { graphRequest, MetaApiError, type MetaConfig } from './graph';

/**
 * Insights with instagram_manage_insights (Unified Login). Only metrics Meta
 * actually returns are shown; anything unavailable is reported as such, never
 * filled in. Metric names from the current reference (impressions is deprecated).
 */
export const ACCOUNT_METRICS = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'shares', 'saves', 'profile_links_taps'] as const;
export const MEDIA_METRICS = { feed_image: ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'total_interactions'], reel: ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'ig_reels_avg_watch_time'] } as const;

export type MetricValue = { name: string; title: string | null; value: number | null };
export type InsightsResult = { metrics: MetricValue[]; unavailable: { name: string; reason: string }[] };

type InsightsResponse = { data?: { name: string; title?: string; total_value?: { value?: number }; values?: { value?: number }[] }[] };

/** Account totals over [since, until] (UNIX seconds), one metric per call so one unsupported metric does not hide the rest. */
export async function accountInsights(config: MetaConfig, token: string, igUserId: string, since: Date, until: Date): Promise<InsightsResult> {
  const result: InsightsResult = { metrics: [], unavailable: [] };
  for (const metric of ACCOUNT_METRICS) {
    try {
      const data = await graphRequest<InsightsResponse>(config, 'GET', `${igUserId}/insights`, {
        metric, period: 'day', metric_type: 'total_value', since: Math.floor(since.getTime() / 1000), until: Math.floor(until.getTime() / 1000),
      }, token);
      const row = data.data?.[0];
      const value = row?.total_value?.value ?? row?.values?.reduce((sum, v) => sum + (v.value ?? 0), 0);
      if (row && typeof value === 'number') result.metrics.push({ name: metric, title: row.title ?? null, value });
      else result.unavailable.push({ name: metric, reason: 'Not returned by Meta' });
    } catch (error) {
      if (error instanceof MetaApiError && error.isAuth) throw error;
      result.unavailable.push({ name: metric, reason: error instanceof Error ? error.message : 'Unavailable' });
    }
  }
  return result;
}

export async function mediaInsights(config: MetaConfig, token: string, mediaId: string, kind: 'feed_image' | 'reel'): Promise<InsightsResult> {
  const result: InsightsResult = { metrics: [], unavailable: [] };
  for (const metric of MEDIA_METRICS[kind]) {
    try {
      const data = await graphRequest<InsightsResponse>(config, 'GET', `${mediaId}/insights`, { metric }, token);
      const row = data.data?.[0];
      const value = row?.total_value?.value ?? row?.values?.[0]?.value;
      if (row && typeof value === 'number') result.metrics.push({ name: metric, title: row.title ?? null, value });
      else result.unavailable.push({ name: metric, reason: 'Not returned by Meta' });
    } catch (error) {
      if (error instanceof MetaApiError && error.isAuth) throw error;
      result.unavailable.push({ name: metric, reason: error instanceof Error ? error.message : 'Unavailable' });
    }
  }
  return result;
}
