import { ActionForm, SubmitButton } from '@/components/forms';
import { ButtonLink, Card, EmptyState, Notice, PageHeader, StatusBadge } from '@/components/ui';
import { formatInZone } from '@/lib/time';
import { metaConfig } from '@/server/app';
import { requireUser } from '@/server/auth/session';
import { getDb } from '@/server/db';
import { configStatus } from '@/server/env';
import { listAccounts, REQUIRED_SCOPES } from '@/server/meta/accounts';
import { missingConfig } from '@/server/meta/graph';

import { checkAccountAction, disconnectAction } from '../actions';

export const metadata = { title: 'Instagram Accounts' };

const ERRORS: Record<string, string> = {
  denied: 'The connection was cancelled or permission was refused in the Meta dialog.',
  invalid_state: 'The login link was invalid or expired. Start the connection again.',
  exchange_failed: 'Meta did not accept the authorization code. Check the app ID, secret and redirect URI.',
  not_configured: 'Meta login is not configured on the server.',
  no_account: 'No Instagram professional account was shared with the app.',
  failed: 'The connection failed. See the server log for details (no secrets are logged).',
};

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const user = await requireUser();
  const query = await searchParams;
  const accounts = await listAccounts(getDb(), user.id);
  const missing = missingConfig(metaConfig());
  const config = configStatus();

  return (
    <>
      <PageHeader
        title="Instagram Accounts"
        description="Instagram API with Unified Login: you sign in with Facebook or Instagram in Meta's own dialog, choose your business portfolio's Instagram professional account, and the app receives a business integration (system-user) token. Your password never reaches this app."
        action={missing.length || !config.encryptionKey ? null : <ButtonLink href="/api/meta/oauth/start">Connect an account</ButtonLink>}
      />
      <div className="mb-4 space-y-2">
        {query.connected ? <Notice tone="success">{query.connected} account(s) connected.</Notice> : null}
        {query.error ? <Notice tone="error">{ERRORS[query.error] ?? ERRORS.failed}</Notice> : null}
        {missing.length ? <Notice tone="warning">Not configured on the server: {missing.join(', ')}. See docs/meta-setup.md.</Notice> : null}
        {!config.encryptionKey ? <Notice tone="warning">TOKEN_ENCRYPTION_KEY is not set: tokens cannot be stored, so connecting is disabled.</Notice> : null}
      </div>

      {accounts.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {accounts.map((account) => {
            const scopes = account.grantedScopes;
            return (
              <Card key={account.id} title={`@${account.username}`} action={<StatusBadge status={account.status} />}>
                <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
                  <dt className="text-muted">Name</dt><dd>{account.name ?? '—'}</dd>
                  <dt className="text-muted">Instagram ID</dt><dd className="font-mono text-xs">{account.igUserId}</dd>
                  <dt className="text-muted">Business ID</dt><dd className="font-mono text-xs">{account.clientBusinessId ?? '—'}</dd>
                  <dt className="text-muted">Token</dt><dd>{account.tokenCiphertext ? `${account.tokenType ?? 'system user'}, encrypted · ${account.tokenExpiresAt ? `expires ${formatInZone(account.tokenExpiresAt, 'Africa/Casablanca', false)}` : 'no expiry reported'}` : 'deleted'}</dd>
                  <dt className="text-muted">Last check</dt><dd>{formatInZone(account.lastCheckedAt, 'Africa/Casablanca')}</dd>
                </dl>
                <div className="mt-3 text-sm">
                  <p className="font-medium">Permissions</p>
                  <ul className="mt-1 space-y-0.5">
                    {Object.entries(REQUIRED_SCOPES).map(([use, scope]) => (
                      <li key={scope}><span className={scopes.includes(scope) ? 'text-success' : 'text-danger'}>{scopes.includes(scope) ? 'granted' : 'missing'}</span> {scope} <span className="text-muted">({use})</span></li>
                    ))}
                  </ul>
                </div>
                {account.lastError ? <p className="mt-2 text-sm text-danger">{account.lastError}</p> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {account.tokenCiphertext ? <ActionForm action={checkAccountAction}><input type="hidden" name="accountId" value={account.id} /><SubmitButton variant="secondary" pendingLabel="Checking…">Check connection</SubmitButton></ActionForm> : null}
                  {account.status !== 'connected' && !missing.length ? <ButtonLink href="/api/meta/oauth/start" variant="secondary">Reconnect</ButtonLink> : null}
                  {account.tokenCiphertext ? <ActionForm action={disconnectAction} confirm="Delete the stored access for this account?"><input type="hidden" name="accountId" value={account.id} /><SubmitButton variant="danger">Disconnect</SubmitButton></ActionForm> : null}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No Instagram account connected">
          The account must be an Instagram professional account (Business or Creator) in the business portfolio that owns the Meta app. With Standard Access, only people with a role on the app can connect.
        </EmptyState>
      )}
    </>
  );
}
