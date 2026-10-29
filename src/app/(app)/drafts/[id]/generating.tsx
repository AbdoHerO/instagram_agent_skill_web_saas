import { AutoRefresh } from '@/components/auto-refresh';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Card, Notice, PageHeader, StatusBadge } from '@/components/ui';
import { formatInZone, secondsSince } from '@/lib/time';
import type { contentDrafts } from '@/server/db/schema';

import { archiveAction, retryGenerationAction } from '../../actions';

type Generation = { status: string; createdAt: Date; lockedAt: Date | null; attempts: number; error: string | null } | null;

/** No worker picked the request up after this long: say what is missing. */
const UNCLAIMED_WARNING_SECONDS = 60;

/** A draft that Claude is writing in the background (the page refreshes itself), or whose writing failed. */
export function GeneratingDraft({ draft, generation, timezone }: { draft: typeof contentDrafts.$inferSelect; generation: Generation; timezone: string }) {
  const failed = draft.status === 'generation_failed';
  const waited = generation ? secondsSince(generation.createdAt) : 0;
  const unclaimed = !failed && generation?.status === 'queued' && waited > UNCLAIMED_WARNING_SECONDS;

  return (
    <>
      <PageHeader
        title={draft.title}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={draft.status} /> {draft.kind.replace('_', ' ')}</span>}
      />
      {failed ? null : <AutoRefresh seconds={4} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card title={failed ? 'The draft could not be written' : 'Claude is writing this draft'}>
          {failed ? (
            <div className="space-y-3 text-sm">
              <Notice tone="error">{draft.lastError ?? 'The generation failed.'}</Notice>
              <p className="text-muted">Nothing was saved as content. Try again with the same brief, or archive this draft and write a new brief in the AI Content Studio.</p>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p>
                {generation?.status === 'running' ? 'Writing now' : 'Waiting for the worker'} · requested {formatInZone(generation?.createdAt ?? draft.createdAt, timezone)}
                {' '}({waited} s ago){generation && generation.attempts > 1 ? ` · attempt ${generation.attempts}` : ''}.
              </p>
              <p className="text-muted">It usually takes one to two minutes. This page updates by itself; you can also leave it and come back from the Dashboard.</p>
              {unclaimed ? (
                <Notice tone="warning">No worker has taken this request yet. The worker runs inside the web server when WORKER_IN_PROCESS=true, or as <code>npm run worker</code>.</Notice>
              ) : null}
            </div>
          )}
        </Card>
        <Card title="Actions">
          <div className="flex flex-col gap-2">
            {failed ? (
              <ActionForm action={retryGenerationAction}>
                <input type="hidden" name="draftId" value={draft.id} />
                <SubmitButton pendingLabel="Queuing…">Try again</SubmitButton>
              </ActionForm>
            ) : null}
            <ActionForm action={archiveAction} confirm={failed ? 'Archive this draft?' : 'Stop and archive this draft? The text being written will not be kept.'}>
              <input type="hidden" name="draftId" value={draft.id} />
              <SubmitButton variant="secondary">{failed ? 'Archive' : 'Stop and archive'}</SubmitButton>
            </ActionForm>
          </div>
        </Card>
      </div>
    </>
  );
}
