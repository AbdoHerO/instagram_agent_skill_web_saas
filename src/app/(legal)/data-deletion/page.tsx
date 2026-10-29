import type { Metadata } from 'next';
import Link from 'next/link';

import { CONTACT_EMAIL, LAST_UPDATED, META_APP_NAME, OPERATOR } from '../legal';

export const metadata: Metadata = { title: 'Data deletion', robots: { index: true, follow: true } };

export default function DataDeletionPage() {
  return (
    <article>
      <h1>Data deletion instructions</h1>
      <p className="updated">Last updated: {LAST_UPDATED}</p>
      <p>
        Instagram Studio ({OPERATOR}) stores data about an Instagram account only when that account was connected to it through
        Meta&apos;s login. This page explains how to stop the access and have that data deleted.
      </p>

      <h2>1. Stop the app&apos;s access to the Instagram account</h2>
      <p>Either step ends the access at once; you can do both.</p>
      <ul>
        <li>
          In Meta Business Suite, open <strong>Business settings → Integrations → Connected apps</strong>, select
          &quot;{META_APP_NAME}&quot; and remove it. Meta then invalidates the access token the app holds.
        </li>
        <li>
          In Instagram, open <strong>Settings → Website permissions → Apps and websites</strong> and remove &quot;{META_APP_NAME}&quot;
          if it is listed.
        </li>
        <li>
          Team members can also use <strong>Instagram Accounts → Disconnect</strong> in the tool: the stored access token is
          deleted immediately.
        </li>
      </ul>

      <h2>2. Ask us to delete the data</h2>
      <ol>
        <li>
          Send an email to <a href={`mailto:${CONTACT_EMAIL}?subject=Data%20deletion%20request`}>{CONTACT_EMAIL}</a> with the
          subject &quot;Data deletion request&quot;.
        </li>
        <li>Give the Instagram username concerned, and write from an address we can use to confirm the request.</li>
        <li>We may ask you to confirm that you control the account before we delete anything.</li>
        <li>We reply by email once the deletion is done.</li>
      </ol>

      <h2>What we delete</h2>
      <ul>
        <li>The connected account&apos;s record: its Instagram ID, username, name, picture address, business ID and permissions.</li>
        <li>The encrypted access token.</li>
        <li>The drafts, media, approvals, schedules and publishing records linked to that account, unless the law requires us to keep them.</li>
      </ul>
      <p>
        Instagram insights are never stored, so there is nothing to delete for them. Deleted data can remain in our backups until
        they are replaced or deleted. Posts already published on Instagram stay on Instagram: delete them in the
        Instagram app.
      </p>

      <p>
        More detail in the <Link href="/privacy">privacy policy</Link>.
      </p>
    </article>
  );
}
