import type { Metadata } from 'next';
import Link from 'next/link';

import { CONTACT_EMAIL, LAST_UPDATED, OPERATOR } from '../legal';

export const metadata: Metadata = { title: 'Terms of service', robots: { index: true, follow: true } };

export default function TermsPage() {
  return (
    <article>
      <h1>Terms of service</h1>
      <p className="updated">Last updated: {LAST_UPDATED}</p>

      <h2>The service</h2>
      <p>
        Instagram Studio is an internal tool operated by <strong>{OPERATOR}</strong> for Euro Digital&apos;s team. It helps prepare,
        approve and schedule posts for Euro Digital&apos;s own Instagram professional account, using Meta&apos;s official Instagram
        API. It is not offered to the public: access is limited to people Euro Digital gives an account.
      </p>

      <h2>Accounts</h2>
      <ul>
        <li>Each team member uses their own account and keeps their password confidential.</li>
        <li>Euro Digital can suspend or remove an account at any time, for example when someone leaves the team.</li>
      </ul>

      <h2>Acceptable use</h2>
      <ul>
        <li>
          Use the tool only for Euro Digital&apos;s own Instagram account, in line with Instagram&apos;s Terms of Use, Meta&apos;s
          Platform Terms and Developer Policies, and the law.
        </li>
        <li>Do not publish unlawful, misleading or infringing content, or content you do not have the rights to.</li>
        <li>Do not try to bypass the tool&apos;s security, its approval step or Meta&apos;s limits.</li>
      </ul>

      <h2>AI-assisted drafts</h2>
      <p>
        Drafts can be written with the help of an AI model. They are suggestions: every post must be reviewed and approved by a
        person before it can be scheduled, and the tool blocks approval while a draft contains placeholders or prices and
        claims it cannot verify. The person who approves a post is responsible for checking its facts, prices and claims.
      </p>

      <h2>Content</h2>
      <p>
        Euro Digital keeps the rights to its content. Posts published on Instagram are also subject to Instagram&apos;s terms.
        Publishing happens only for approved posts, at the scheduled time, and only when publishing is switched on.
      </p>

      <h2>Availability and liability</h2>
      <p>
        The tool is provided as is, as an internal tool. Instagram&apos;s API, Meta&apos;s login and the AI service are run by
        third parties and can be unavailable or change. To the extent the law allows, Euro Digital is not liable for losses
        caused by such interruptions or by content published through the tool.
      </p>

      <h2>Privacy</h2>
      <p>
        How data is handled is described in the <Link href="/privacy">privacy policy</Link>, and how to have it deleted in the{' '}
        <Link href="/data-deletion">data deletion instructions</Link>.
      </p>

      <h2>Changes and law</h2>
      <p>
        We may update these terms; the date above shows the latest version. These terms are governed by Moroccan law.
        Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </article>
  );
}
