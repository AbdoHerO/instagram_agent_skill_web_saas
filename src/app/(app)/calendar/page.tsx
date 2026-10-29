import Link from 'next/link';

import { buttonClass, Card, EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { formatInZone, inputValuesInZone } from '@/lib/time';
import { requireUser } from '@/server/auth/session';
import { getBrand } from '@/server/brand';
import { listDrafts } from '@/server/content/service';
import { getDb } from '@/server/db';

export const metadata = { title: 'Content Calendar' };

const STATUSES = ['scheduled', 'publishing', 'published', 'failed'] as const;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; month?: string }> }) {
  const user = await requireUser();
  const db = getDb();
  const query = await searchParams;
  const [posts, brand] = await Promise.all([listDrafts(db, user.id, [...STATUSES]), getBrand(db, user.id)]);
  const tz = brand.timezone;
  const view = query.view === 'list' ? 'list' : 'month';
  const today = inputValuesInZone(new Date(), tz).date;
  const month = /^\d{4}-\d{2}$/.test(query.month ?? '') ? query.month! : today.slice(0, 7);
  const [year, monthIndex] = month.split('-').map(Number) as [number, number];
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };

  // Each post on the local date it is (or was) published, in the business time zone.
  const dated = posts
    .map((p) => ({ post: p, at: p.publishedAt ?? p.scheduledAt }))
    .filter((x): x is { post: typeof posts[number]; at: Date } => Boolean(x.at))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const byDay = new Map<string, typeof dated>();
  for (const item of dated) {
    const day = inputValuesInZone(item.at, tz).date;
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7; // weeks start on Monday
  const cells = Array.from({ length: Math.ceil((leading + daysInMonth) / 7) * 7 }, (_, i) => {
    const day = i - leading + 1;
    return day >= 1 && day <= daysInMonth ? `${month}-${String(day).padStart(2, '0')}` : null;
  });

  return (
    <>
      <PageHeader
        title="Content Calendar"
        description={`Scheduled, published and failed posts, shown in ${tz}. Drafts and approvals are in the Approval Center.`}
        action={
          <div className="flex gap-2">
            <Link href={`/calendar?view=month&month=${month}`} className={buttonClass(view === 'month' ? 'primary' : 'secondary')}>Month</Link>
            <Link href="/calendar?view=list" className={buttonClass(view === 'list' ? 'primary' : 'secondary')}>List</Link>
          </div>
        }
      />
      {view === 'month' ? (
        <Card title={new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)}
          action={<div className="flex gap-2 text-sm"><Link className="text-accent hover:underline" href={`/calendar?view=month&month=${shift(-1)}`}>← Previous</Link><Link className="text-accent hover:underline" href={`/calendar?view=month&month=${shift(1)}`}>Next →</Link></div>}>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-line bg-line text-xs">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="bg-slate-50 px-2 py-1 font-medium text-muted">{d}</div>)}
            {cells.map((day, i) => (
              <div key={i} className={`min-h-24 bg-paper p-1.5 ${day === today ? 'ring-2 ring-inset ring-accent' : ''}`}>
                {day ? <p className="mb-1 text-muted">{Number(day.slice(8))}</p> : null}
                {day ? (byDay.get(day) ?? []).map(({ post, at }) => (
                  <Link key={post.id} href={`/drafts/${post.id}`} className="mb-1 block truncate rounded bg-slate-50 px-1 py-0.5 hover:bg-slate-100" title={post.title}>
                    <span className="tabular-nums">{inputValuesInZone(at, tz).time}</span> {post.title}
                    <span className="block"><StatusBadge status={post.status} /></span>
                  </Link>
                )) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card>
          {dated.length ? (
            <ul className="divide-y divide-line">
              {dated.map(({ post, at }) => (
                <li key={post.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <Link href={`/drafts/${post.id}`} className="font-medium hover:underline">{post.title}</Link>
                    <p className="text-xs text-muted">{post.kind.replace('_', ' ')} · {formatInZone(at, tz)}{post.lastError ? ` · ${post.lastError}` : ''}</p>
                  </div>
                  <StatusBadge status={post.status} />
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Nothing scheduled or published yet" />}
        </Card>
      )}
    </>
  );
}
