'use client';

import { createContext, startTransition, useActionState, useContext, useState, type ReactNode } from 'react';

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
 *
 * `maxFileBytes`: a file above it is refused here, before it is sent. The server
 * refuses it too, but a request over Next.js's body limit gets no answer the
 * page could show.
 */
export function ActionForm({ action, children, className, confirm, maxFileBytes }: { action: ServerAction; children: ReactNode; className?: string; confirm?: string; maxFileBytes?: number }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [clientError, setClientError] = useState<string | null>(null);
  const error = clientError ?? state.error;
  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const tooLarge = maxFileBytes ? [...data.values()].find((value): value is File => value instanceof File && value.size > maxFileBytes) : undefined;
        if (tooLarge) {
          setClientError(`${tooLarge.name} is ${Math.round(tooLarge.size / 1024 / 1024)} MB: the limit is ${Math.floor(maxFileBytes! / 1024 / 1024)} MB.`);
          return;
        }
        setClientError(null);
        if (confirm && !window.confirm(confirm)) return;
        startTransition(() => formAction(data));
      }}
    >
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
      {state.message ? <p role="status" className="mt-2 text-sm text-success">{state.message}</p> : null}
    </form>
  );
}
