import { ActionForm, SubmitButton } from '@/components/forms';
import { Card, Field, inputClass, Notice, PageHeader } from '@/components/ui';
import { requireUser } from '@/server/auth/session';
import { getBrand } from '@/server/brand';
import { generationsToday } from '@/server/ai/generate';
import { getDb } from '@/server/db';
import { configStatus, env } from '@/server/env';

import { createBlankDraftAction } from '../actions';
import { StudioForm } from './studio-form';

export const metadata = { title: 'AI Content Studio' };

export default async function StudioPage() {
  const user = await requireUser();
  const db = getDb();
  const [brand, used] = await Promise.all([getBrand(db, user.id), generationsToday(db, user.id)]);
  const config = configStatus();
  return (
    <>
      <PageHeader
        title="AI Content Studio"
        description="Claude writes with the installed Instagram skills, your voice profile and verified product data. Every result is saved as a draft for review; nothing is posted."
      />
      <div className="mb-4 space-y-2">
        {!config.anthropic ? <Notice tone="warning">Set ANTHROPIC_API_KEY on the server to enable generation.</Notice> : null}
        {!config.ecommerceApi ? <Notice tone="info">The catalogue API (ECOMMERCE_API_URL) is not configured: posts can be written without products, and must not mention prices.</Notice> : null}
        <p className="text-xs text-muted">Generations today: {used} / {env().AI_DAILY_GENERATION_LIMIT} · model {config.model}</p>
      </div>
      <StudioForm defaultLanguage={brand.defaultLanguage as 'fr' | 'ar' | 'en'} catalogEnabled={config.ecommerceApi} />
      <Card title="Write a post manually" className="mt-4">
        <ActionForm action={createBlankDraftAction} className="grid gap-3 sm:grid-cols-[12rem_1fr_10rem_auto] sm:items-end">
          <Field label="Format" htmlFor="blank-kind">
            <select id="blank-kind" name="kind" className={inputClass} defaultValue="feed_image">
              <option value="feed_image">Feed image post</option><option value="reel">Reel</option><option value="carousel">Carousel</option>
              <option value="story">Story sequence</option><option value="plan">Weekly plan</option><option value="idea">Idea</option>
            </select>
          </Field>
          <Field label="Title" htmlFor="blank-title"><input id="blank-title" name="title" required minLength={2} maxLength={200} className={inputClass} /></Field>
          <Field label="Language" htmlFor="blank-language">
            <select id="blank-language" name="language" className={inputClass} defaultValue={brand.defaultLanguage}>
              <option value="fr">French</option><option value="ar">Arabic</option><option value="en">English</option>
            </select>
          </Field>
          <SubmitButton variant="secondary">Create draft</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
