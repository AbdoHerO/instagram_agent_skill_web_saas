import { ActionForm, SubmitButton } from '@/components/forms';
import { Card, Field, inputClass, Notice, PageHeader } from '@/components/ui';
import { requireUser } from '@/server/auth/session';
import { getBrand } from '@/server/brand';
import { getDb } from '@/server/db';
import { configStatus } from '@/server/env';
import { loadVoiceFile } from '@/server/skills/registry';

import { settingsAction } from '../actions';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const user = await requireUser();
  const brand = await getBrand(getDb(), user.id);
  const config = configStatus();
  const voice = brand.voiceMarkdown?.trim() || loadVoiceFile();

  return (
    <>
      <PageHeader title="Settings" description="Brand voice, defaults, publishing switch and retention. API keys and secrets are set on the server only and never shown here." />
      <ActionForm action={settingsAction} className="space-y-4">
        <Card title="Brand voice">
          <Field label="Voice profile (Markdown)" hint="Starts from .claude/instagram/voice.md (the project's voice file, also read by the Claude Code skills). Fill in the {{to confirm}} parts.">
            <textarea name="voiceMarkdown" defaultValue={voice} rows={16} maxLength={20_000} className={`${inputClass} font-mono text-xs`} />
          </Field>
        </Card>
        <Card title="Defaults">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Content language">
              <select name="defaultLanguage" defaultValue={brand.defaultLanguage} className={inputClass}>
                <option value="fr">French</option><option value="ar">Arabic</option><option value="en">English</option>
              </select>
            </Field>
            <Field label="Time zone" hint="IANA name, e.g. Africa/Casablanca"><input name="timezone" defaultValue={brand.timezone} className={inputClass} /></Field>
            <Field label="Default posting time"><input type="time" name="defaultPostTime" defaultValue={brand.defaultPostTime} className={inputClass} /></Field>
          </div>
        </Card>
        <Card title="Approval and publishing">
          <div className="space-y-3 text-sm">
            <p>Approval is <strong>always required</strong>: a new draft is never scheduled or published without an explicit approval of its exact version, and an edit removes the approval.</p>
            <Notice tone={config.publishingMode === 'live' ? 'warning' : 'info'}>Server publishing mode: <strong>{config.publishingMode}</strong>. Both this switch and the server mode must allow publishing.</Notice>
            <label className="flex items-center gap-2"><input type="checkbox" name="publishingEnabled" defaultChecked={brand.publishingEnabled} /> Publish approved, scheduled posts automatically at their time</label>
            <Field label="To turn publishing on, type PUBLISH" hint="Leave empty when turning it off.">
              <input name="publishingConfirm" autoComplete="off" className={inputClass} />
            </Field>
          </div>
        </Card>
        <Card title="Retention and security">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Keep AI generation logs (days)" hint="Requests and token counts; never API keys."><input type="number" name="aiRetentionDays" min={30} max={730} defaultValue={brand.aiRetentionDays} className={inputClass} /></Field>
            <div className="text-sm text-muted">
              <p>Meta tokens are encrypted at rest (AES-256-GCM). Sessions and login states are stored as hashes. Model: {config.model}.</p>
            </div>
          </div>
        </Card>
        <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
      </ActionForm>
    </>
  );
}
