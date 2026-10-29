'use client';

import { useState, useTransition } from 'react';

import type { InsightsResult } from '@/server/meta/insights';

import { mediaInsightsAction } from '../actions';

/** Loads one post's insights on demand (one Graph call per metric, only when asked). */
export function MediaInsightsButton({ draftId }: { draftId: string }) {
  const [result, setResult] = useState<InsightsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-1">
      {result ? (
        <p className="text-xs">
          {result.metrics.map((m) => `${m.title ?? m.name}: ${m.value}`).join(' · ') || 'Meta returned no metrics.'}
          {result.unavailable.length ? <span className="text-muted"> · unavailable: {result.unavailable.map((u) => u.name).join(', ')}</span> : null}
        </p>
      ) : (
        <button type="button" disabled={pending} className="text-xs text-accent hover:underline" onClick={() => start(async () => {
          const response = await mediaInsightsAction(draftId);
          setResult(response.result);
          setError(response.error);
        })}>{pending ? 'Loading…' : 'Load insights'}</button>
      )}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
