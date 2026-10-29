import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { currentUser } from '@/server/auth/session';
import { isDatabaseConfigured } from '@/server/db';
import { Notice } from '@/components/ui';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  const databaseReady = isDatabaseConfigured();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">Instagram Studio</h1>
      <p className="mt-1 text-sm text-muted">Euro Digital · drafts, approvals and publishing</p>
      <div className="mt-6 rounded-lg border border-line bg-paper p-5">
        {databaseReady ? (
          <LoginForm />
        ) : (
          <Notice tone="warning">The database is not configured yet. Run <code>scripts\setup-database.ps1</code>, then <code>npm run db:migrate</code> and <code>npm run user:create</code> (see README).</Notice>
        )}
      </div>
      <p className="mt-4 text-xs text-muted">Accounts are created on the server with <code>npm run user:create</code>.</p>
      <nav className="mt-6 flex gap-4 text-xs text-muted">
        <Link href="/privacy" className="hover:underline">Privacy policy</Link>
        <Link href="/terms" className="hover:underline">Terms of service</Link>
        <Link href="/data-deletion" className="hover:underline">Data deletion</Link>
      </nav>
    </main>
  );
}
