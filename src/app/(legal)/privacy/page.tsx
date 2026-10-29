import type { Metadata } from 'next';
import Link from 'next/link';

import { CONTACT_EMAIL, LAST_UPDATED, META_APP_NAME, OPERATOR } from '../legal';

export const metadata: Metadata = { title: 'Privacy policy', robots: { index: true, follow: true } };

export default function PrivacyPage() {
  return (
    <article>
      <h1>Privacy policy</h1>
      <p className="updated">Last updated: {LAST_UPDATED}</p>

      <h2>Who we are</h2>
      <p>
        Instagram Studio is an internal tool operated by <strong>{OPERATOR}</strong>. Euro Digital&apos;s team uses it to prepare,
        review, approve and schedule posts for Euro Digital&apos;s own Instagram professional account. It connects to Instagram
        through Meta&apos;s official Instagram API with Unified Login (the Meta app is named &quot;{META_APP_NAME}&quot;). It is not a
        public service: accounts are created by Euro Digital for its own team members.
      </p>
      <p>Contact for any privacy question or request: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>

      <h2>What we collect and why</h2>
      <ul>
        <li>
          <strong>Team accounts:</strong> name, email address and a password stored only as an argon2 hash; a session cookie
          whose value is stored only as a SHA-256 hash and expires after seven days. Used to sign team members in.
        </li>
        <li>
          <strong>The connected Instagram account:</strong> when a team member connects Euro Digital&apos;s Instagram professional
          account in Meta&apos;s login dialog, we store its Instagram account ID, username, display name, profile picture address,
          the business portfolio ID, the login configuration ID, the permissions granted, and the access token issued by
          Meta, encrypted (AES-256-GCM). We never receive or store an Instagram or Facebook password.
        </li>
        <li>
          <strong>Content:</strong> drafts, captions, hashtags, images and videos uploaded by the team, approvals, schedules, and
          publishing records (Meta&apos;s media and container identifiers, error codes).
        </li>
        <li>
          <strong>Instagram insights:</strong> if the insights permission is granted, account and post statistics are fetched
          from Meta when a team member opens Analytics. They are displayed, not stored.
        </li>
        <li>
          <strong>AI assistance:</strong> to draft a post, the brief written by a team member, product facts from Euro
          Digital&apos;s own catalogue and the brand voice are sent to Anthropic&apos;s Claude API. We keep a record of each
          request (the brief, the model, token counts, the result status) for the period set in the tool&apos;s Settings, 180 days
          by default; older records are deleted automatically.
        </li>
        <li>
          <strong>Technical logs:</strong> the web server and our network provider record requests (address, time, page) for
          security and troubleshooting. Our logs never contain passwords, access tokens or API keys.
        </li>
      </ul>

      <h2>What we do not do</h2>
      <ul>
        <li>We do not sell or rent personal data, and we do not use it for advertising.</li>
        <li>We use no advertising or tracking cookies: the only cookie is the sign-in session cookie.</li>
        <li>
          We do not read, store or send Instagram comments or direct messages, and we do not collect data about the
          followers of the Instagram account, even when the login configuration grants permissions for them.
        </li>
        <li>No access token or Instagram data is sent to Anthropic.</li>
      </ul>

      <h2>Service providers</h2>
      <ul>
        <li><strong>Meta Platforms:</strong> the Instagram API (login, publishing, insights).</li>
        <li><strong>Anthropic:</strong> the Claude API, which writes draft posts, under Anthropic&apos;s commercial terms.</li>
        <li><strong>Oracle Cloud Infrastructure:</strong> the server that runs the tool and its database.</li>
        <li><strong>Cloudflare:</strong> the network in front of the server (HTTPS and protection), and storage of encrypted off-server backups.</li>
      </ul>

      <h2>How long we keep data</h2>
      <ul>
        <li>Team accounts: until the account is removed.</li>
        <li>Sessions: seven days. Single-use login links to Meta: ten minutes.</li>
        <li>
          The Instagram connection: until it is disconnected in the tool (the access token is deleted at once) or a deletion
          request is completed.
        </li>
        <li>Content and publishing records: until the team or a deletion request removes them.</li>
        <li>AI request records: the period set in Settings (180 days by default).</li>
        <li>
          Backups of the database and uploaded files (the copies kept off the server are encrypted): data deleted from the tool
          can remain in a backup until that backup is replaced or deleted.
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        Access to the tool requires a team account. Traffic is encrypted with HTTPS. Access tokens are encrypted before they
        are stored, passwords and session tokens are stored only as hashes, and the server runs the tool under its own isolated
        system account.
      </p>

      <h2>Your rights</h2>
      <p>
        Under Moroccan law 09-08 on the protection of personal data, you can ask to access, correct or delete your personal
        data, or object to its processing. Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. To remove the data
        we hold about a connected Instagram account, follow the <Link href="/data-deletion">data deletion instructions</Link>.
      </p>

      <h2>Changes</h2>
      <p>If this policy changes, we update this page and the date above.</p>
    </article>
  );
}
