import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/** Small, reusable building blocks (server-safe: no client state). */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-line bg-paper p-5', className)}>
      {title || action ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title ? <h2 className="text-base font-semibold">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

const buttonStyles = {
  primary: 'bg-accent text-white hover:bg-blue-800 disabled:bg-slate-300',
  secondary: 'border border-line bg-paper text-ink hover:bg-slate-50 disabled:text-slate-400',
  danger: 'border border-red-200 bg-paper text-danger hover:bg-red-50',
  ghost: 'text-accent hover:underline',
} as const;

export function buttonClass(variant: keyof typeof buttonStyles = 'primary', extra?: string): string {
  return cn('inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed', buttonStyles[variant], extra);
}

export function ButtonLink({ variant = 'primary', className, ...props }: ComponentProps<typeof Link> & { variant?: keyof typeof buttonStyles }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

const STATUS_STYLES: Record<string, string> = {
  generating: 'bg-sky-50 text-sky-800',
  generation_failed: 'bg-red-100 text-red-800',
  draft: 'bg-slate-100 text-slate-700',
  awaiting_approval: 'bg-amber-50 text-amber-800',
  approved: 'bg-blue-50 text-blue-800',
  rejected: 'bg-red-50 text-red-700',
  scheduled: 'bg-indigo-50 text-indigo-800',
  publishing: 'bg-violet-50 text-violet-800',
  published: 'bg-green-50 text-green-800',
  failed: 'bg-red-100 text-red-800',
  archived: 'bg-slate-100 text-slate-500',
  connected: 'bg-green-50 text-green-800',
  needs_reauth: 'bg-amber-50 text-amber-800',
  error: 'bg-red-50 text-red-700',
  disconnected: 'bg-slate-100 text-slate-600',
  queued: 'bg-indigo-50 text-indigo-800',
  running: 'bg-violet-50 text-violet-800',
  succeeded: 'bg-green-50 text-green-800',
  cancelled: 'bg-slate-100 text-slate-600',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700')}>{status.replace(/_/g, ' ')}</span>;
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  const body = (
    <div className="rounded-lg border border-line bg-paper p-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'error' | 'success'; children: ReactNode }) {
  const styles = { info: 'border-blue-200 bg-accent-soft text-blue-900', warning: 'border-amber-200 bg-amber-50 text-amber-900', error: 'border-red-200 bg-red-50 text-red-900', success: 'border-green-200 bg-green-50 text-green-900' };
  return <div className={cn('rounded-md border px-4 py-3 text-sm', styles[tone])}>{children}</div>;
}

export const inputClass = 'block w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-accent';

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
      {children}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-paper px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-2 text-sm text-muted">{children}</div> : null}
    </div>
  );
}
