import Link from 'next/link';
import type { ReactNode } from 'react';

import { CONTACT_EMAIL, OPERATOR } from './legal';

/**
 * Public pages (no sign-in): the privacy policy, terms of service and data
 * deletion instructions that Meta asks for in the app settings. They describe
 * what this application actually does; keep them in step with the code.
 */

const LINKS = [
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/terms', label: 'Terms of service' },
  { href: '/data-deletion', label: 'Data deletion' },
];

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap items-baseline justify-between gap-2 px-4 py-4">
          <p className="font-semibold">Instagram Studio · Euro Digital</p>
          <nav className="flex gap-4 text-sm">
            {LINKS.map((link) => <Link key={link.href} href={link.href} className="text-muted hover:text-ink hover:underline">{link.label}</Link>)}
          </nav>
        </div>
      </header>
      <main className="legal mx-auto max-w-3xl px-4 py-8">{children}</main>
      <footer className="border-t border-line">
        <p className="mx-auto max-w-3xl px-4 py-4 text-sm text-muted">
          {OPERATOR} · <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </footer>
    </div>
  );
}
