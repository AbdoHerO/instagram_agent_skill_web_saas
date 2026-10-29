'use client';

import { createContext, startTransition, useActionState, useContext, type ReactNode } from 'react';

import { buttonClass } from './ui';

export type ActionState = { ok?: boolean; error?: string; message?: string; redirectTo?: string };
export type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

const PendingContext = createContext(false);

export function SubmitButton({ children, variant = 'primary', pendingLabel }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'danger'; pendingLabel?: string }) {
  const pending = useContext(PendingContext);
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant)} aria-busy={pending || undefined}>
      {pending ? pendingLabel ?? 'Working…' : children}
    </button>
  );
}

/**
 * A form bound to a server action, showing its error or success message.
 * Submitted through a transition rather than the `action` prop, so React does
 * not clear the fields afterwards: a failed save keeps what the person typed.
 */
export function ActionForm({ action, children, className, confirm }: { action: ServerAction; children: ReactNode; className?: string; confirm?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {state.error ? <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p> : null}
      {state.message ? <p role="status" className="mt-2 text-sm text-success">{state.message}</p> : null}
    </form>
  );
}
