'use server';

import { redirect } from 'next/navigation';

import type { ActionState } from '@/components/forms';
import { verifyCredentials } from '@/server/auth/core';
import { endSession, startSession } from '@/server/auth/session';
import { getDb } from '@/server/db';
import { pruneAiGenerations } from '@/server/retention';

// Simple in-memory brake on repeated failures per email (per server process).
const failures = new Map<string, { count: number; until: number }>();

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get('email') ?? '').trim().toLowerCase().slice(0, 200);
  const password = String(fd.get('password') ?? '').slice(0, 500);
  const brake = failures.get(email);
  if (brake && brake.until > Date.now()) return { error: 'Too many attempts. Wait a minute and try again.' };

  const user = await verifyCredentials(getDb(), email, password);
  if (!user) {
    const count = (brake?.count ?? 0) + 1;
    failures.set(email, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
    return { error: 'Email or password is incorrect.' };
  }
  failures.delete(email);
  await startSession(user.id);
  await pruneAiGenerations(getDb(), user.id).catch(() => 0); // retention never blocks a sign-in
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect('/login');
}
