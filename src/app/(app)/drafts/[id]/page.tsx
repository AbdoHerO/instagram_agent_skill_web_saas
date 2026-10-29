import { notFound } from 'next/navigation';

import { ActionForm, SubmitButton } from '@/components/forms';
import { Card, Field, inputClass, Notice, PageHeader, StatusBadge } from '@/components/ui';
import { DEFAULT_TIMEZONE, formatInZone, hoursFromNow, inputValuesInZone } from '@/lib/time';
import { mediaStorage } from '@/server/app';
import { requireUser } from '@/server/auth/session';
import { latestGeneration } from '@/server/ai/generate';
import { getBrand } from '@/server/brand';
import { getDraftDetail, NotFoundError } from '@/server/content/service';
import { contentPayloadSchema, type VersionValidation } from '@/server/content/types';
import { canDo, PUBLISHABLE_KINDS, type DraftKind, type DraftStatus } from '@/server/content/workflow';
import { getDb } from '@/server/db';
import { mediaAssets } from '@/server/db/schema';
import { env } from '@/server/env';
import { listAccounts } from '@/server/meta/accounts';
import { eq } from 'drizzle-orm';

import {
  approveAction, archiveAction, cancelScheduleAction, rejectAction, rescheduleAction, saveVersionAction, scheduleAction, submitAction,
} from '../../actions';
import { GeneratingDraft } from './generating';
import { MediaUpload } from './media-upload';
import { SkillChecks } from './skill-checks';

export const metadata = { title: 'Draft' };

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = getDb();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await getDraftDetail(db, user.id, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const [accounts, brand] = await Promise.all([listAccounts(db, user.id), getBrand(db, user.id)]);
  const { draft, current, versions, approvals, jobs, logs } = detail;
  if (draft.status === 'generating' || draft.status === 'generation_failed') {
    return <GeneratingDraft draft={draft} generation={await latestGeneration(db, user.id, draft.id)} timezone={draft.timezone || brand.timezone || DEFAULT_TIMEZONE} />;
  }
  if (!current) {
    // An AI draft archived before its text was written: there is no version to show.
    return (
      <>
        <PageHeader title={draft.title} description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={draft.status} /> {draft.kind.replace('_', ' ')}</span>} />
        <Card><p className="text-sm text-muted">This draft was archived before its text was written. Nothing was saved as content.</p></Card>
      </>
    );
  }
  const payload = contentPayloadSchema.parse(current.payload);
  const validation = current.validation as VersionValidation;
  const blocking = (validation.issues ?? []).filter((i) => i.blocking);
  const warnings = (validation.issues ?? []).filter((i) => !i.blocking);
  const status = draft.status as DraftStatus;
  const tz = draft.timezone || brand.timezone || DEFAULT_TIMEZONE;
  const isApprovedCurrent = draft.approvedVersionId === current.id;
  const approvedVersion = versions.find((v) => v.id === draft.approvedVersionId);

  const [media] = current.mediaAssetId ? await db.select().from(mediaAssets).where(eq(mediaAssets.id, current.mediaAssetId)) : [];
  const storage = mediaStorage();
  const mediaUrl = media ? (storage.kind === 'local' ? `/media/${media.storageKey}` : await storage.publicUrl(media.storageKey)) : null;
  const fullCaption = [payload.caption, payload.hashtags.join(' ')].filter(Boolean).join('\n\n');
  const scheduleDefaults = inputValuesInZone(draft.scheduledAt ?? hoursFromNow(24), tz);
  const connected = accounts.filter((a) => a.status === 'connected');
  const publishable = PUBLISHABLE_KINDS.includes(draft.kind as DraftKind);
  // Sections the format uses (others stay as hidden values so nothing is lost on save).
  const kind = draft.kind as DraftKind;
  const show = {
    hooks: kind === 'reel' || kind === 'idea' || payload.hooks.length > 0,
    script: kind === 'reel' || payload.script.length > 0,
    slides: kind === 'carousel' || payload.slides.length > 0,
    story: kind === 'story' || payload.storyFrames.length > 0,
    plan: kind === 'plan' || payload.plan.length > 0,
  };

  return (
    <>
      <PageHeader
        title={draft.title}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={status} /> {draft.kind.replace('_', ' ')} · {payload.language.toUpperCase()} · version {current.version}{isApprovedCurrent ? ' · approved' : approvedVersion ? ` · approved version: ${approvedVersion.version}` : ''}</span>}
      />

      <div className="mb-4 space-y-2">
        {draft.lastError ? <Notice tone="error">{draft.lastError}</Notice> : null}
        {blocking.length ? (
          <Notice tone="error">
            <p className="font-medium">Fix before approval:</p>
            <ul className="mt-1 list-disc pl-5">{blocking.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>
          </Notice>
        ) : null}
        {warnings.length ? (
          <Notice tone="warning">
            <p className="font-medium">Check before approving:</p>
            <ul className="mt-1 list-disc pl-5">{warnings.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>
          </Notice>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card title="Preview">
            {mediaUrl ? (
              media!.mimeType === 'video/mp4'
                ? <video src={mediaUrl} controls preload="metadata" className="mb-3 max-h-96 rounded-md border border-line" />
                // eslint-disable-next-line @next/next/no-img-element -- uploaded media, any size
                : <img src={mediaUrl} alt={payload.altText || 'Post image'} className="mb-3 max-h-96 rounded-md border border-line" />
            ) : <p className="mb-3 text-sm text-muted">{publishable ? 'No media attached yet.' : 'This format is planned content (not published through the API).'}</p>}
            <p className="text-xs font-medium tracking-wide text-muted uppercase">What the feed shows before “… more”</p>
            <p className="mt-1 rounded-md bg-slate-50 p-3 text-sm whitespace-pre-line" dir={payload.language === 'ar' ? 'rtl' : 'ltr'}>
              {fullCaption.slice(0, 125)}{fullCaption.length > 125 ? <span className="text-muted">… more</span> : null}
            </p>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium">Full caption ({fullCaption.length} / 2200)</summary>
              <p className="mt-2 text-sm whitespace-pre-line" dir={payload.language === 'ar' ? 'rtl' : 'ltr'}>{fullCaption}</p>
            </details>
            {payload.hooks.length ? <Section title="Hooks"><ol className="list-decimal pl-5">{payload.hooks.map((h, i) => <li key={i}>{h.text} <span className="text-xs text-muted">({h.formula})</span></li>)}</ol></Section> : null}
            {payload.script.length ? <Section title="Script"><Table rows={payload.script.map((s) => [s.line, s.onScreen])} headers={['Spoken line', 'On screen']} /></Section> : null}
            {payload.slides.length ? <Section title="Slides"><Table rows={payload.slides.map((s, i) => [`${i + 1}. ${s.heading}`, s.body])} headers={['Slide', 'Text']} /></Section> : null}
            {payload.storyFrames.length ? <Section title="Story frames"><Table rows={payload.storyFrames.map((f) => [f.text, f.sticker])} headers={['Frame', 'Sticker']} /></Section> : null}
            {payload.plan.length ? <Section title="Plan"><Table rows={payload.plan.map((p) => [p.day, p.format, p.idea, p.time])} headers={['Day', 'Format', 'Idea', 'Time']} /></Section> : null}
            {payload.cta ? <Section title="Call to action"><p>{payload.cta}</p></Section> : null}
            {payload.notes ? <Section title="Notes for the reviewer"><p className="whitespace-pre-line">{payload.notes}</p></Section> : null}
            {payload.productFacts.length ? (
              <Section title="Product facts used (from the catalogue API)">
                <Table rows={payload.productFacts.map((f) => [f.name, f.priceTtc === null ? '—' : `${f.priceTtc} MAD TTC`, f.inStock === null ? '—' : f.inStock ? 'in stock' : 'out of stock', new Date(f.fetchedAt).toISOString().slice(0, 16).replace('T', ' ')])} headers={['Product', 'Price', 'Stock', 'Fetched (UTC)']} />
              </Section>
            ) : null}
          </Card>

          <SkillChecks tools={validation.tools ?? null} />

          <Card title="Edit (creates a new version)">
            {canDo(status, 'edit') ? (
              <ActionForm action={saveVersionAction} className="space-y-3">
                <input type="hidden" name="draftId" value={draft.id} />
                {isApprovedCurrent || status === 'scheduled' ? <Notice tone="warning">Saving removes the approval{status === 'scheduled' ? ' and cancels the scheduled publication' : ''}: the new version must be approved again.</Notice> : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Title (internal)"><input name="title" defaultValue={draft.title} className={inputClass} /></Field>
                  <Field label="Language"><select name="language" defaultValue={payload.language} className={inputClass}><option value="fr">French</option><option value="ar">Arabic</option><option value="en">English</option></select></Field>
                </div>
                <Field label="Caption"><textarea name="caption" defaultValue={payload.caption} rows={6} maxLength={2200} className={inputClass} dir="auto" /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Call to action"><input name="cta" defaultValue={payload.cta} className={inputClass} dir="auto" /></Field>
                  <Field label="Hashtags (max 5)"><input name="hashtags" defaultValue={payload.hashtags.join(' ')} className={inputClass} /></Field>
                </div>
                <Field label="Alt text"><input name="altText" defaultValue={payload.altText} className={inputClass} dir="auto" /></Field>
                {show.hooks ? <Field label="Hooks (one per line)"><textarea name="hooks" defaultValue={payload.hooks.map((h) => h.text).join('\n')} rows={3} className={inputClass} dir="auto" /></Field> : <input type="hidden" name="hooks" value={payload.hooks.map((h) => h.text).join('\n')} />}
                {show.script ? <Field label="Script (one beat per line: spoken line | on-screen text)"><textarea name="script" defaultValue={payload.script.map((s) => `${s.line} | ${s.onScreen}`).join('\n')} rows={4} className={inputClass} dir="auto" /></Field> : <input type="hidden" name="script" value={payload.script.map((s) => `${s.line} | ${s.onScreen}`).join('\n')} />}
                {show.slides ? <Field label="Slides (heading | text)"><textarea name="slides" defaultValue={payload.slides.map((s) => `${s.heading} | ${s.body}`).join('\n')} rows={4} className={inputClass} dir="auto" /></Field> : <input type="hidden" name="slides" value={payload.slides.map((s) => `${s.heading} | ${s.body}`).join('\n')} />}
                {show.story ? <Field label="Story frames (text | sticker)"><textarea name="storyFrames" defaultValue={payload.storyFrames.map((f) => `${f.text} | ${f.sticker}`).join('\n')} rows={4} className={inputClass} dir="auto" /></Field> : <input type="hidden" name="storyFrames" value={payload.storyFrames.map((f) => `${f.text} | ${f.sticker}`).join('\n')} />}
                {show.plan ? <Field label="Plan (day | format | idea | time)"><textarea name="plan" defaultValue={payload.plan.map((p) => `${p.day} | ${p.format} | ${p.idea} | ${p.time}`).join('\n')} rows={5} className={inputClass} dir="auto" /></Field> : <input type="hidden" name="plan" value={payload.plan.map((p) => `${p.day} | ${p.format} | ${p.idea} | ${p.time}`).join('\n')} />}
                <Field label="Notes"><textarea name="notes" defaultValue={payload.notes} rows={2} className={inputClass} /></Field>
                <Field label="Still to verify (field: reason, one per line; delete a line once confirmed)" hint="Any line here blocks approval.">
                  <textarea name="needsVerification" defaultValue={payload.needsVerification.map((n) => `${n.field}: ${n.reason}`).join('\n')} rows={2} className={inputClass} />
                </Field>
                <SubmitButton pendingLabel="Saving…">Save new version</SubmitButton>
              </ActionForm>
            ) : <p className="text-sm text-muted">A post that is {status.replace('_', ' ')} cannot be edited.</p>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Review">
            <div className="space-y-3">
              {canDo(status, 'submit') ? (
                <ActionForm action={submitAction}><input type="hidden" name="draftId" value={draft.id} /><SubmitButton variant="secondary">Send for approval</SubmitButton></ActionForm>
              ) : null}
              {canDo(status, 'approve') ? (
                <ActionForm action={approveAction} className="space-y-2">
                  <input type="hidden" name="draftId" value={draft.id} />
                  <input type="hidden" name="versionId" value={current.id} />
                  <input name="note" placeholder="Note (optional)" maxLength={500} className={inputClass} />
                  <SubmitButton>Approve version {current.version}</SubmitButton>
                  {blocking.length ? <p className="text-xs text-danger">Blocked until the issues above are fixed.</p> : null}
                </ActionForm>
              ) : null}
              {canDo(status, 'reject') ? (
                <ActionForm action={rejectAction} className="space-y-2">
                  <input type="hidden" name="draftId" value={draft.id} />
                  <input name="note" placeholder="Reason (optional)" maxLength={500} className={inputClass} />
                  <SubmitButton variant="danger">Reject</SubmitButton>
                </ActionForm>
              ) : null}
              {!canDo(status, 'submit') && !canDo(status, 'approve') && !canDo(status, 'reject') ? <p className="text-sm text-muted">No review action for a post that is {status.replace('_', ' ')}.</p> : null}
            </div>
          </Card>

          {publishable ? (
            <Card title="Media">
              {canDo(status, 'edit') ? (
                <MediaUpload draftId={draft.id} kind={draft.kind} maxBytes={env().MEDIA_MAX_BYTES} />
              ) : <p className="text-sm text-muted">{media ? media.originalName ?? 'Attached' : 'No media'}</p>}
            </Card>
          ) : null}

          <Card title="Schedule">
            {!publishable ? (
              <p className="text-sm text-muted">Only feed images and Reels are published through the API in this release. Copy this content and post it yourself.</p>
            ) : status === 'scheduled' ? (
              <div className="space-y-3">
                <p className="text-sm">Scheduled for <strong>{formatInZone(draft.scheduledAt, tz)}</strong> ({tz}).</p>
                <ActionForm action={rescheduleAction} className="space-y-2">
                  <input type="hidden" name="draftId" value={draft.id} />
                  <WhenInputs date={scheduleDefaults.date} time={scheduleDefaults.time} tz={tz} />
                  <SubmitButton variant="secondary">Reschedule</SubmitButton>
                </ActionForm>
                <ActionForm action={cancelScheduleAction} confirm="Cancel the scheduled publication?"><input type="hidden" name="draftId" value={draft.id} /><SubmitButton variant="danger">Cancel scheduling</SubmitButton></ActionForm>
              </div>
            ) : canDo(status, 'schedule') && isApprovedCurrent ? (
              connected.length ? (
                <ActionForm action={scheduleAction} className="space-y-2">
                  <input type="hidden" name="draftId" value={draft.id} />
                  <Field label="Account">
                    <select name="accountId" className={inputClass} defaultValue={draft.instagramAccountId ?? connected[0]!.id}>
                      {connected.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}
                    </select>
                  </Field>
                  <WhenInputs date={scheduleDefaults.date} time={brand.defaultPostTime} tz={tz} />
                  <SubmitButton>Schedule approved version</SubmitButton>
                </ActionForm>
              ) : <p className="text-sm text-muted">Connect an Instagram account first.</p>
            ) : <p className="text-sm text-muted">Approve the current version to schedule it.</p>}
          </Card>

          {canDo(status, 'archive') ? (
            <ActionForm action={archiveAction} confirm="Archive this post?"><input type="hidden" name="draftId" value={draft.id} /><SubmitButton variant="secondary">Archive</SubmitButton></ActionForm>
          ) : null}
        </div>
      </div>

      <Card title="History" className="mt-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Versions</h3>
            <ul className="space-y-1 text-sm">
              {versions.map((v) => (
                <li key={v.id}>
                  <details>
                    <summary className="cursor-pointer">v{v.version} · {formatInZone(v.createdAt, tz)}{v.id === draft.approvedVersionId ? ' · approved' : ''}{v.id === current.id ? ' · current' : ''}</summary>
                    <p className="mt-1 text-xs whitespace-pre-line text-muted">{v.caption.slice(0, 400)}</p>
                    <p className="text-[11px] text-muted">hash {v.contentHash.slice(0, 12)}</p>
                  </details>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Approvals</h3>
            {approvals.length ? (
              <ul className="space-y-1 text-sm">
                {approvals.map((a) => <li key={a.id}>{a.decision} · v{versions.find((v) => v.id === a.versionId)?.version ?? '?'} · {formatInZone(a.createdAt, tz)}{a.note ? ` · ${a.note}` : ''}</li>)}
              </ul>
            ) : <p className="text-sm text-muted">None yet.</p>}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Publishing</h3>
            {jobs.length ? (
              <ul className="space-y-2 text-sm">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <StatusBadge status={job.status} /> {formatInZone(job.runAt, tz)} · attempt {job.attempts}/{job.maxAttempts}
                    {job.igMediaId ? <span className="block text-xs text-muted">Media ID {job.igMediaId}</span> : null}
                    {job.lastError ? <span className="block text-xs text-danger">{job.lastError}</span> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Not scheduled yet.</p>}
            {logs.length ? (
              <details className="mt-2"><summary className="cursor-pointer text-xs">Log ({logs.length})</summary>
                <ul className="mt-1 space-y-1 text-xs text-muted">{logs.map((l) => <li key={l.id}>{formatInZone(l.createdAt, tz)} · {l.step} · {l.outcome}{l.message ? ` · ${l.message}` : ''}</li>)}</ul>
              </details>
            ) : null}
          </div>
        </div>
      </Card>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="mt-4 text-sm"><h3 className="mb-1 font-semibold">{title}</h3>{children}</div>;
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b border-line text-xs text-muted">{headers.map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i} className="border-b border-line last:border-0">{row.map((cell, j) => <td key={j} className="py-1.5 pr-3 align-top" dir="auto">{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function WhenInputs({ date, time, tz }: { date: string; time: string; tz: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Date"><input type="date" name="date" defaultValue={date} required className={inputClass} /></Field>
      <Field label="Time"><input type="time" name="time" defaultValue={time} required className={inputClass} /></Field>
      <div className="col-span-2"><Field label="Time zone"><input name="timezone" defaultValue={tz} required className={inputClass} /></Field></div>
    </div>
  );
}
