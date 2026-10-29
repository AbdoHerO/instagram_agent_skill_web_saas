import { Card } from '@/components/ui';

type Check = { check: string; status: string; detail: string };

/** Results of the installed skills' own tools on this version (advisory; the reviewer decides). */
export function SkillChecks({ tools }: { tools: Record<string, unknown> | null }) {
  if (!tools) return null;
  const detect = tools.detect as { score?: number; verdict?: string } | { score?: number; verdict?: string }[] | null | undefined;
  const human = Array.isArray(detect) ? detect.at(-1) : detect;
  const caption = tools.caption as { checks?: Check[]; verdict?: string } | null | undefined;
  const hooks = tools.hooks as { hook: string; score: number; verdict: string; flags?: string[] }[] | null | undefined;
  const beats = tools.beats as { total_seconds?: number; notes?: string[]; beats?: { text: string; dur: number; label?: string; flags?: string[] }[] } | null | undefined;
  const unavailable = (tools.unavailable as string[] | undefined) ?? [];

  return (
    <Card title="Skill checks">
      <div className="space-y-4 text-sm">
        {human ? <p><strong>ig-human detect.py:</strong> human score {human.score ?? '—'} ({human.verdict ?? '—'})</p> : null}
        {caption?.checks?.length ? (
          <div>
            <p className="font-medium">ig-caption caption.py {caption.verdict ? `· ${caption.verdict}` : ''}</p>
            <ul className="mt-1 space-y-0.5">
              {caption.checks.map((c) => (
                <li key={c.check}><span className={c.status === 'PASS' ? 'text-success' : c.status === 'WARN' ? 'text-warning' : 'text-danger'}>{c.status}</span> {c.check}: {c.detail}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {Array.isArray(hooks) && hooks.length ? (
          <div>
            <p className="font-medium">ig-reel hookscore.py</p>
            <ul className="mt-1 space-y-0.5">{hooks.map((h, i) => <li key={i}><span className="tabular-nums">{h.score.toFixed(1)}</span> {h.verdict} · {h.hook}</li>)}</ul>
          </div>
        ) : null}
        {beats?.beats?.length ? (
          <div>
            <p className="font-medium">ig-reel beats.py · ~{beats.total_seconds}s</p>
            <ul className="mt-1 space-y-0.5">{beats.beats.map((b, i) => <li key={i}><span className="tabular-nums">{b.dur.toFixed(1)}s</span> {b.label ? `${b.label} · ` : ''}{b.text}{b.flags?.length ? <span className="text-warning"> ({b.flags.join('; ')})</span> : null}</li>)}</ul>
          </div>
        ) : null}
        {unavailable.length ? <p className="text-xs text-muted">Not run (Python unavailable on the server): {unavailable.join(', ')}.</p> : null}
        {!human && !caption && !hooks && !beats && !unavailable.length ? <p className="text-muted">No automatic checks for this version (manual edit).</p> : null}
      </div>
    </Card>
  );
}
