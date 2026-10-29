# agent_ai_intg — Instagram Studio for Euro Digital

A separate web application for Euro Digital's Instagram: Claude writes drafts with the 13
[Instagram agent skills](https://github.com/Jakeschincariol/instagram-agent-skill), a person reviews and
approves each exact version, and a background worker publishes approved, scheduled posts through Meta's
official Instagram API. Nothing is ever posted without an explicit approval.

It is independent of the e-commerce project: it only **reads** product data from that backend's public API.

| | |
|---|---|
| Stack | Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · MySQL 8 + Drizzle ORM · Anthropic SDK · durable job queue in MySQL · local or S3 media storage |
| AI | `claude-opus-5-5` by default (`CLAUDE_MODEL`), structured output validated with Zod, skill instructions from `.claude/skills`, the skills' Python tools run on every draft |
| Instagram | Instagram API with **Unified Login** (Facebook Login for Business, system-user token), `graph.facebook.com` |
| Docs | [architecture](docs/architecture.md) · [business context](docs/business-context.md) · [Meta setup](docs/meta-setup.md) · [Claude skills](docs/claude-skills.md) · [deployment](docs/deployment.md) |

## 1. Prerequisites (Windows, PowerShell)

- Node.js ≥ 20.19 (`node -v`)
- Python 3 on PATH as `python3` (the skills' tools; standard library only)
- MySQL 8 or MariaDB 10.4+ (this PC: XAMPP's MariaDB on port 3306; production: MySQL 8.0 on CloudOps)
- An Anthropic API key, and for Instagram: the Meta app (see [docs/meta-setup.md](docs/meta-setup.md))

## 2. Installation

```powershell
cd "E:\Euro Digital\agent_ai_intg"
npm install
npm run skills:check        # verifies the 13 installed skills against vendor/
```

## 3. Database

```powershell
# Creates the database (and a user), writes DATABASE_URL and a TOKEN_ENCRYPTION_KEY into .env.local.
# Asks for the MySQL root password in a hidden prompt (used once, never stored).
powershell -ExecutionPolicy Bypass -File scripts\setup-database.ps1
#   XAMPP (root without a password): add -NoRootPassword; add -UseRoot to connect as that local root account
npm run db:migrate
npm run user:create -- --email you@example.com --name "Your name"   # password asked in a hidden prompt
```

The schema is in `src/server/db/schema.ts`; `npm run db:generate` writes a new migration to `drizzle/` after a change.
On the server, `DB_AUTO_MIGRATE=true` applies pending migrations when the app starts.

## 4. Configuration

Copy `.env.example` to `.env.local` (the setup script already created it) and fill in what you have. Never commit
`.env.local`; never paste keys into chats or documents.

- **Claude**: `ANTHROPIC_API_KEY` (Claude Console). A key that is not scoped to a workspace also needs
  `ANTHROPIC_WORKSPACE_ID` (`wrkspc_…`, Console > Settings > Workspaces). `CLAUDE_MODEL` defaults to `claude-opus-5-5`,
  `CLAUDE_EFFORT` to `medium`, `AI_DAILY_GENERATION_LIMIT` to 50 per user per day. Test the key with one short request:
  `npm run ai:ping`.
- **Product data**: `ECOMMERCE_API_URL=http://192.168.1.7:8010/api/v1` (the local e-commerce API, read-only).
- **Meta**: `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, `META_REDIRECT_URI` — see [docs/meta-setup.md](docs/meta-setup.md).
- **Media**: Meta downloads media from a **public** URL. Locally that needs a public HTTPS address (`MEDIA_PUBLIC_BASE_URL`),
  or use S3 (`MEDIA_STORAGE=s3`).
- **Publishing**: `PUBLISHING_MODE=disabled` (default) — nothing is sent to Instagram. `live` + the Settings switch are both required.

## 5. Run

```powershell
npm run dev        # http://localhost:3100
npm run worker     # second terminal, unless WORKER_IN_PROCESS=true: writes AI drafts and publishes (keep it running)
```

From another device on the LAN: `$env:DEV_ALLOWED_ORIGINS="192.168.1.7"; npx next dev -H 0.0.0.0 -p 3100`.

## 6. Using it

1. **Connect Instagram**: Instagram Accounts → *Connect an account* → Meta's dialog → choose the business portfolio's
   Instagram professional account. The page shows the granted permissions and token status; *Check connection* re-verifies.
2. **Generate**: AI Content Studio → format, purpose, language (French/Arabic), brief, optional products from the
   catalogue (real prices) → *Generate draft*. The draft opens with the skill checks (humanizer, caption linter, hook
   scores, beat timing) and any blocking issue (`{{to confirm}}`, a price not in the product data, more than 5 hashtags).
   No API key? *Write a post manually* creates an empty draft with the same rules.
3. **Approve**: edit (each save is a new version), attach the JPEG or MP4, *Approve version N*. Editing again removes the approval.
4. **Schedule**: pick the account, date, time and time zone (default Africa/Casablanca). Cancel or reschedule any time
   before publishing. The worker publishes at that time **only if** `PUBLISHING_MODE=live` and Settings → publishing is on.
5. **Follow up**: Content Calendar (month and list), the post's history (versions, approvals, attempts, Meta media ID),
   Dashboard activity, Analytics (only metrics Meta returns).

## 7. Checks

```powershell
npm run verify     # typecheck + lint + tests (the real skill scripts, and a throwaway MySQL database per test file)
npm run build
```

Automated tests never call Meta or Claude (mocked) and never publish. They need a local MySQL/MariaDB where they may
create databases named `agent_ai_intg_test_*` (dropped afterwards): `TEST_MYSQL_URL`, default `mysql://root@127.0.0.1:3306`.

## 8. Deployment

See [docs/deployment.md](docs/deployment.md). Production runs on the owner's CloudOps server as the Next.js website
`agent-intg` at https://agent-intg.abdocloud.com (MySQL database created by CloudOps, deployed from `main`).
Public pages for Meta's app settings: `/privacy`, `/terms`, `/data-deletion`.

## 9. Known limitations and outstanding setup

- **Not tested live**: Meta login, publishing and insights have only been tested against mocked Meta responses. They
  need your Meta app configuration, an Instagram professional account and a real run with your approval.
- **Claude**: no live generation has been run (no API key configured here); generation is tested with a mocked client.
- Publishing covers **feed images (JPEG) and Reels (MP4)**. Carousels, stories, plans and ideas are drafted and approved
  but posted by hand.
- Media must be publicly reachable by Meta at publish time (HTTPS URL or S3).
- With Standard Access, only people with a role on the Meta app can connect accounts; others need Advanced Access
  (App Review + Business Verification).
- The interface is in English; content is generated in French, Arabic or English. The layout is ready for `dir="rtl"`.
- The voice profile (`.claude/instagram/voice.md`, Settings → Brand voice) still has `{{to confirm}}` fields for the owner.
