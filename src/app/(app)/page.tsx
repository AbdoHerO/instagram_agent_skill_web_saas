import Link from 'next/link';

import { Card, EmptyState, Notice, PageHeader, Stat } from '@/components/ui';
import { formatInZone } from '@/lib/time';
import { recentActivity } from '@/server/activity';
import { requireUser } from '@/server/auth/session';
import { getBrand } from '@/server/brand';
import { draftCounts, failedJobCount, listDrafts } from '@/server/content/service';
import { getDb } from '@/server/db';
import { configStatus } from '@/server/env';
import { effectiveStatus, listAccounts } from '@/server/meta/accounts';

export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const user = await requireUser();
  const db = getDb();
  const [counts, failed, accounts, activity, upcoming, brand] = await Promise.all([
    draftCounts(db, user.id), failedJobCount(db, user.id), listAccounts(db, user.id), recentActivity(db, user.id, 12),
    listDrafts(db, user.id, ['scheduled']), getBrand(db, user.id),
  ]);
  const config = configStatus();
  const connected = accounts.filter((a) => a.status === 'connected');
  const tz = brand.timezone;

  return (
    <>
      <PageHeader title="Dashboard" description="Live data from this application's database. Instagram metrics appear under Analytics once an account is connected with the insights permission." />

      <div className="mb-6 space-y-2">
        {!config.anthropic ? <Notice tone="warning">Claude is not configured (ANTHROPIC_API_KEY): content generation is unavailable.</Notice> : null}
        {config.publishingMode !== 'live' || !brand.publishingEnabled ? (
          <Notice tone="info">Publishing is <strong>off</strong> ({config.publishingMode !== 'live' ? 'server: PUBLISHING_MODE is not "live"' : 'switched off in Settings'}). Drafts, approvals and scheduling work; nothing is sent to Instagram.</Notice>
        ) : null}
        {accounts.some((a) => effectiveStatus(a) === 'needs_reauth') ? <Notice tone="error">An Instagram account needs to be reconnected. <Link className="underline" href="/accounts">Open accounts</Link></Notice> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Instagram" value={connected.length ? `@${connected[0]!.username}` : 'Not connected'} hint={connected.length ? `${connected.length} connected` : 'Connect in Accounts'} href="/accounts" />
        <Stat label="Drafts" value={(counts.draft ?? 0) + (counts.rejected ?? 0)} href="/approvals" />
        <Stat label="Awaiting approval" value={counts.awaiting_approval ?? 0} href="/approvals" />
        <Stat label="Scheduled" value={counts.scheduled ?? 0} href="/calendar" />
        <Stat label="Published" value={counts.published ?? 0} href="/calendar?view=list" />
        <Stat label="Failed jobs" value={failed} hint={failed ? 'See the post for the error' : undefined} href="/calendar?view=list" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Next scheduled posts">
          {upcoming.length ? (
            <ul className="divide-y divide-line">
              {upcoming.slice(0, 6).map((draft) => (
                <li key={draft.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/drafts/${draft.id}`} className="truncate hover:underline">{draft.title}</Link>
                  <span className="shrink-0 text-muted">{formatInZone(draft.scheduledAt, draft.timezone || tz)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing scheduled">Approve a draft, then schedule it from its page.</EmptyState>
          )}
        </Card>
        <Card title="Recent activity">
          {activity.length ? (
            <ul className="space-y-2 text-sm">
              {activity.map((item) => (
                <li key={item.id} className="flex gap-3">
                  <span className="w-28 shrink-0 text-xs text-muted">{formatInZone(item.createdAt, tz)}</span>
                  <span className={item.level === 'error' ? 'text-danger' : item.level === 'success' ? 'text-success' : ''}>
                    {item.draftId ? <Link href={`/drafts/${item.draftId}`} className="hover:underline">{item.message}</Link> : item.message}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No activity yet">Generate your first draft in the AI Content Studio.</EmptyState>
          )}
        </Card>
      </div>

      <Card title="Configuration" className="mt-6">
        <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Database', config.database], ['Token encryption key', config.encryptionKey], ['Claude API', config.anthropic],
            ['Catalogue API (read-only)', config.ecommerceApi], ['Meta app', config.metaApp], ['Meta login configuration', config.metaLoginConfig],
            ['Meta redirect URI', config.metaRedirect], ['Public media URL', config.mediaPublicUrl],
          ].map(([label, ok]) => (
            <li key={String(label)} className="flex items-center justify-between rounded-md border border-line px-3 py-2">
              <span>{label}</span>
              <span className={ok ? 'text-xs font-medium text-success' : 'text-xs font-medium text-warning'}>{ok ? 'set' : 'missing'}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Model: {config.model}. Publishing mode: {config.publishingMode}. Secrets are never shown here.</p>
      </Card>
    </>
  );
}
