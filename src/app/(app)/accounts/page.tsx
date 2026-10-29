import { ActionForm, SubmitButton } from '@/components/forms';
import { buttonClass, Card, EmptyState, Notice, PageHeader, StatusBadge } from '@/components/ui';
import { formatInZone } from '@/lib/time';
import { metaConfig } from '@/server/app';
import { requireUser } from '@/server/auth/session';
import { isValidEncryptionKey } from '@/server/crypto';
import { getDb } from '@/server/db';
import { env } from '@/server/env';
import { effectiveStatus, listAccounts, REQUIRED_SCOPES, unusedScopes } from '@/server/meta/accounts';
import { missingConfig } from '@/server/meta/graph';
import { expectedRedirectUri, redirectUriProblems } from '@/server/meta/oauth';

import { checkAccountAction, disconnectAction } from '../actions';

export const metadata = { title: 'Instagram Accounts' };

const ERRORS: Record<string, string> = {
  denied: 'The connection was cancelled or permission was refused in the Meta dialog.',
  invalid_state: 'The login link was invalid or expired. Start the connection again.',
  exchange_failed: 'Meta did not accept the authorization code. Check the app ID, secret and redirect URI.',
  not_configured: 'Meta login is not configured on the server.',
  encryption_key: 'TOKEN_ENCRYPTION_KEY is missing or invalid, so the access token could not be stored. Nothing was saved.',
  redirect_uri: 'META_REDIRECT_URI does not point to this app’s callback (see below).',
  invalid_token: 'Meta returned an access token that is not valid. Start the connection again.',
  unsupported_token: 'Meta did not list the shared Instagram accounts. The login configuration must use the token type “System-user access token”.',
  no_account: 'No Instagram professional account was shared with the app.',
  failed: 'The connection failed. See the server log for details (no secrets are logged).',
};

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const user = await requireUser();
  const query = await searchParams;
  const accounts = await listAccounts(getDb(), user.id);
  const missing = missingConfig(metaConfig());
  const config = env();
  const keyOk = isValidEncryptionKey(config.TOKEN_ENCRYPTION_KEY);
  const redirect = redirectUriProblems(config.APP_URL, config.META_REDIRECT_URI);
  const canConnect = !missing.length && keyOk && !redirect.errors.length;

  return (
    <>
      <PageHeader
        title="Instagram Accounts"
        description="Instagram API with Unified Login: you sign in with Facebook or Instagram in Meta's own dialog, choose your business portfolio's Instagram professional account, and the app receives a business integration (system-user) token. Your password never reaches this app."
        // A plain link, not next/link: the route redirects to Meta, so it must be neither prefetched nor fetched client-side.
        action={canConnect ? <a href="/api/meta/oauth/start" className={buttonClass('primary')}>Connect an account</a> : null}
      />
      <div className="mb-4 space-y-2">
        {query.connected ? <Notice tone="success">{query.connected} account(s) connected.</Notice> : null}
        {query.error ? <Notice tone="error">{ERRORS[query.error] ?? ERRORS.failed}</Notice> : null}
        {missing.length ? <Notice tone="warning">Not configured on the server: {missing.join(', ')}. See docs/meta-setup.md.</Notice> : null}
        {!keyOk ? <Notice tone="warning">TOKEN_ENCRYPTION_KEY is missing or not 32 bytes (base64): tokens cannot be stored, so connecting is disabled.</Notice> : null}
        {[...redirect.errors, ...redirect.warnings].map((problem) => <Notice key={problem} tone="warning">{problem}</Notice>)}
        <p className="text-sm text-muted">
          Redirect URL to save in Meta (Unified login configuration): <code className="font-mono text-xs text-ink">{expectedRedirectUri(config.APP_URL)}</code>
        </p>
      </div>

      {accounts.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {accounts.map((account) => {
            const scopes = account.grantedScopes;
            const status = effectiveStatus(account);
            const unused = unusedScopes(scopes);
            return (
              <Card key={account.id} title={`@${account.username}`} action={<StatusBadge status={status} />}>
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
                      <li key={scope}><span className={scopes.includes(scope) ? 'text-success' : 'text-danger'}>{scopes.includes(scope) ? 'granted' : 'missing'}</span> {scope} <span className="text-muted">({use === 'insights' ? 'analytics, optional' : use})</span></li>
                    ))}
                  </ul>
                  {unused.length ? <p className="mt-1 text-muted">Also granted, not used by this app: {unused.join(', ')}</p> : null}
                </div>
                {account.lastError ? <p className="mt-2 text-sm text-danger">{account.lastError}</p> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {account.tokenCiphertext ? <ActionForm action={checkAccountAction}><input type="hidden" name="accountId" value={account.id} /><SubmitButton variant="secondary" pendingLabel="Checking…">Check connection</SubmitButton></ActionForm> : null}
                  {status !== 'connected' && canConnect ? <a href="/api/meta/oauth/start" className={buttonClass('secondary')}>Reconnect</a> : null}
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
