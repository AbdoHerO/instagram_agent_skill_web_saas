'use client';

import { ActionForm, SubmitButton } from '@/components/forms';
import { Field, inputClass } from '@/components/ui';

import { loginAction } from './actions';

export function LoginForm() {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      <Field label="Email" htmlFor="email">
        <input id="email" name="email" type="email" autoComplete="username" required className={inputClass} />
      </Field>
      <Field label="Password" htmlFor="password">
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </Field>
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </ActionForm>
  );
}
