import Link from 'next/link';

import { Card, EmptyState, Notice, PageHeader } from '@/components/ui';
import { formatInZone } from '@/lib/time';
import { metaConfig } from '@/server/app';
import { requireUser } from '@/server/auth/session';
import { listDrafts } from '@/server/content/service';
import { getDb } from '@/server/db';
import { env } from '@/server/env';
import { accountToken, listAccounts, REQUIRED_SCOPES } from '@/server/meta/accounts';
import { MetaApiError } from '@/server/meta/graph';
import { accountInsights, type InsightsResult } from '@/server/meta/insights';

import { MediaInsightsButton } from './media-insights';

export const metadata = { title: 'Analytics' };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requireUser();
  const db = getDb();
  const days = (await searchParams).days === '28' ? 28 : 7;
  const [accounts, published] = await Promise.all([listAccounts(db, user.id), listDrafts(db, user.id, ['published'])]);
  const account = accounts.find((a) => a.status === 'connected');

  let insights: InsightsResult | null = null;
  let problem: string | null = null;
  if (!account) problem = 'Connect an Instagram account to see its insights.';
  else if (!account.grantedScopes.includes(REQUIRED_SCOPES.insights)) problem = 'The permission instagram_manage_insights is not granted to this app, so Meta returns no insights. Add it to the login configuration and reconnect.';
  else {
    try {
      const until = new Date();
      insights = await accountInsights(metaConfig(), accountToken(account, env().TOKEN_ENCRYPTION_KEY), account.igUserId, new Date(until.getTime() - days * 86_400_000), until);
    } catch (error) {
      problem = error instanceof MetaApiError ? error.message : 'Insights could not be loaded.';
    }
  }

  return (
    <>
      <PageHeader title="Analytics" description="Only metrics Meta actually returns for the connected account are shown. Nothing is estimated or filled in." />
      <div className="mb-4 flex gap-3 text-sm">
        <Link href="/analytics?days=7" className={days === 7 ? 'font-semibold' : 'text-accent hover:underline'}>Last 7 days</Link>
        <Link href="/analytics?days=28" className={days === 28 ? 'font-semibold' : 'text-accent hover:underline'}>Last 28 days</Link>
      </div>
      {problem ? <Notice tone="info">{problem}</Notice> : null}
      {insights ? (
        <Card title={`@${account!.username} · last ${days} days (source: Meta Graph API)`}>
          {insights.metrics.length ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {insights.metrics.map((m) => (
                <div key={m.name} className="rounded-md border border-line p-3">
                  <p className="text-xs text-muted">{m.title ?? m.name}</p>
                  <p className="text-xl font-semibold tabular-nums">{m.value?.toLocaleString('en')}</p>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Meta returned no metrics for this period" />}
          {insights.unavailable.length ? (
            <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer">Unavailable metrics ({insights.unavailable.length})</summary>
              <ul className="mt-1">{insights.unavailable.map((u) => <li key={u.name}>{u.name}: {u.reason}</li>)}</ul>
            </details>
          ) : null}
        </Card>
      ) : null}
      <Card title="Posts published through this app" className="mt-4">
        {published.length ? (
          <ul className="divide-y divide-line">
            {published.map((post) => (
              <li key={post.id} className="py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/drafts/${post.id}`} className="font-medium hover:underline">{post.title}</Link>
                  <span className="text-xs text-muted">{formatInZone(post.publishedAt, post.timezone)}</span>
                </div>
                <MediaInsightsButton draftId={post.id} />
              </li>
            ))}
          </ul>
        ) : <EmptyState title="Nothing published through the API yet" />}
      </Card>
    </>
  );
}
