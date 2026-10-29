import Link from 'next/link';

import { ButtonLink, Card, EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { formatInZone } from '@/lib/time';
import { requireUser } from '@/server/auth/session';
import { listDrafts } from '@/server/content/service';
import { getDb } from '@/server/db';

export const metadata = { title: 'Approval Center' };

type Row = Awaited<ReturnType<typeof listDrafts>>[number];

function DraftList({ rows, empty }: { rows: Row[]; empty: string }) {
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <ul className="divide-y divide-line">
      {rows.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
          <div className="min-w-0">
            <Link href={`/drafts/${d.id}`} className="font-medium hover:underline">{d.title}</Link>
            <p className="text-xs text-muted">{d.kind.replace('_', ' ')} · updated {formatInZone(d.updatedAt, d.timezone)}</p>
          </div>
          <StatusBadge status={d.status} />
        </li>
      ))}
    </ul>
  );
}

export default async function ApprovalsPage() {
  const user = await requireUser();
  const db = getDb();
  const [awaiting, drafts, approved, rejected] = await Promise.all([
    listDrafts(db, user.id, ['awaiting_approval']), listDrafts(db, user.id, ['draft']), listDrafts(db, user.id, ['approved']), listDrafts(db, user.id, ['rejected']),
  ]);
  return (
    <>
      <PageHeader
        title="Approval Center"
        description="Nothing is scheduled or published without an explicit approval of the exact version. Editing an approved post removes its approval."
        action={<ButtonLink href="/studio">New draft</ButtonLink>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Awaiting approval (${awaiting.length})`}><DraftList rows={awaiting} empty="Nothing waiting" /></Card>
        <Card title={`Drafts (${drafts.length})`}><DraftList rows={drafts} empty="No drafts" /></Card>
        <Card title={`Approved, not scheduled (${approved.length})`}><DraftList rows={approved} empty="None" /></Card>
        <Card title={`Rejected (${rejected.length})`}><DraftList rows={rejected} empty="None" /></Card>
      </div>
    </>
  );
}
