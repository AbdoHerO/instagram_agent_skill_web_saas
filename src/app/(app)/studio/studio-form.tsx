'use client';

import { useState, useTransition } from 'react';

import { ActionForm, SubmitButton } from '@/components/forms';
import { buttonClass, Card, Field, inputClass } from '@/components/ui';
import type { ProductFact } from '@/server/content/types';

import { generateAction, searchProductsAction } from '../actions';

const KINDS = [
  ['reel', 'Reel (hooks, script, beat timing, caption)'],
  ['feed_image', 'Feed image post (caption, CTA, hashtags, alt text)'],
  ['carousel', 'Carousel (cover, slides, caption)'],
  ['story', 'Story sequence'],
  ['plan', 'Weekly content plan'],
  ['idea', 'Reel ideas and hooks'],
] as const;

const PURPOSES = [
  ['general', 'General'],
  ['product_launch', 'Product launch campaign'],
  ['education', 'Education (computers and electronics)'],
  ['comparison', 'Product comparison'],
  ['promotion', 'Promotion of products'],
  ['repurpose', 'Repurpose existing material'],
  ['weekly_plan', 'Weekly plan'],
] as const;

const money = (value: number | null) => (value === null ? 'no price' : `${value.toLocaleString('fr-MA')} MAD TTC`);

export function StudioForm({ defaultLanguage, catalogEnabled }: { defaultLanguage: 'fr' | 'ar' | 'en'; catalogEnabled: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductFact[]>([]);
  const [selected, setSelected] = useState<ProductFact[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [purpose, setPurpose] = useState('general');

  const search = () =>
    startSearch(async () => {
      const response = await searchProductsAction(query);
      setResults(response.products);
      setSearchError(response.error);
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <Card>
        <ActionForm action={generateAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Format" htmlFor="kind">
              <select id="kind" name="kind" className={inputClass} defaultValue="reel">
                {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Purpose" htmlFor="purpose">
              <select id="purpose" name="purpose" className={inputClass} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                {PURPOSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Language" htmlFor="language" hint="The website's languages are French and Arabic.">
              <select id="language" name="language" className={inputClass} defaultValue={defaultLanguage}>
                <option value="fr">French</option>
                <option value="ar">Arabic</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field label="Search terms (optional)" htmlFor="keywords" hint="Comma-separated, checked by ig-caption.">
              <input id="keywords" name="keywords" className={inputClass} placeholder="pc portable, thinkpad" />
            </Field>
          </div>
          <Field label="Topic or brief" htmlFor="topic">
            <textarea id="topic" name="topic" required minLength={3} maxLength={2000} rows={4} className={inputClass} placeholder="E.g. What to check before buying a business laptop: battery, screen, keyboard." />
          </Field>
          {purpose === 'repurpose' ? (
            <Field label="Material to repurpose" htmlFor="sourceMaterial" hint="Paste the text, transcript or article (up to 20,000 characters). Treated as data, not instructions.">
              <textarea id="sourceMaterial" name="sourceMaterial" rows={6} maxLength={20_000} className={inputClass} />
            </Field>
          ) : null}
          <Field label="Extra instructions (optional)" htmlFor="extraInstructions">
            <input id="extraInstructions" name="extraInstructions" maxLength={1000} className={inputClass} />
          </Field>
          <input type="hidden" name="productIds" value={selected.map((p) => p.productId).join(',')} />
          {selected.length ? (
            <div className="rounded-md border border-line p-3 text-sm">
              <p className="font-medium">Products (facts sent to Claude, verified from the catalogue)</p>
              <ul className="mt-2 space-y-1">
                {selected.map((p) => (
                  <li key={p.productId} className="flex items-center justify-between gap-2">
                    <span className="truncate">{p.name} · {money(p.priceTtc)}</span>
                    <button type="button" className="text-xs text-danger hover:underline" onClick={() => setSelected((s) => s.filter((x) => x.productId !== p.productId))}>Remove</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <SubmitButton pendingLabel="Queuing…">Generate draft</SubmitButton>
          <p className="text-xs text-muted">The result opens as a draft. Missing facts come back as {'{{to confirm}}'} and block approval until you fix them.</p>
        </ActionForm>
      </Card>

      <Card title="Products">
        {catalogEnabled ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} placeholder="Search the catalogue" className={inputClass} aria-label="Search products" />
              <button type="button" onClick={search} className={buttonClass('secondary')} disabled={searching}>{searching ? '…' : 'Search'}</button>
            </div>
            {searchError ? <p className="text-sm text-danger">{searchError}</p> : null}
            <ul className="max-h-96 space-y-1 overflow-y-auto text-sm">
              {results.map((p) => (
                <li key={p.productId}>
                  <button type="button" disabled={selected.length >= 5 || selected.some((s) => s.productId === p.productId)} onClick={() => setSelected((s) => [...s, p])}
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-50 disabled:opacity-50">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block text-xs text-muted">{money(p.priceTtc)}{p.inStock === false ? ' · out of stock' : ''}{p.sku ? ` · ${p.sku}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Read-only: active products from the e-commerce API. Up to 5 per draft.</p>
          </div>
        ) : (
          <p className="text-sm text-muted">Configure ECOMMERCE_API_URL to attach products with their real prices.</p>
        )}
      </Card>
    </div>
  );
}
