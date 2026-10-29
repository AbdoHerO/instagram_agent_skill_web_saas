# Architecture

One Next.js application (UI + server actions + route handlers) and one background worker, sharing a MySQL
database. The AI service, the approval workflow and the publishing service are separate modules under `src/server`.

```
 Browser ── Next.js pages (server components) ── server actions ──┐
                                                                    │
            src/server/ai          ─ Claude (Anthropic SDK)         │  (generate: never schedules or posts)
            src/server/skills      ─ .claude/skills SKILL.md + Python tools
            src/server/catalog     ─ e-commerce API (GET only)       ├── MySQL 8 (Drizzle)
            src/server/content     ─ drafts, versions, approvals, scheduling rules
            src/server/meta        ─ Unified Login, accounts, insights
            src/server/media       ─ local disk or S3                │
                                                                    │
 worker/index.ts ── src/server/jobs (queue + publish) ── Graph API ┘  (the only code that publishes)
```

## Content lifecycle

```
draft ──submit──> awaiting_approval ──approve──> approved ──schedule──> scheduled ──worker──> publishing ──> published
  ^                     │                          │                       │                     │
  └──── edit ───────────┴──────── edit ────────────┴─── edit (job cancelled)                      └──> failed (retry or reschedule)
```

- Every generated or manual post starts as **draft**. A version is **immutable**; an edit creates the next version.
- **Approve** records the version and its content hash. Editing an approved or scheduled post invalidates the approval
  (an `invalidated` record) and cancels its queued job.
- **Validation** (`src/server/content/validate.ts`) blocks approval on `{{…}}` placeholders, unresolved
  "needs verification" items, prices and discounts that are not in the product data snapshot, more than 5 hashtags,
  captions over 2,200 characters, and an empty caption on publishable posts. Warranty / delivery / stock / superlative /
  review wording is flagged for the reviewer.

## AI service (`src/server/ai/generate.ts`)

Generation runs in the background, so no web request waits for Claude (Nginx closes a request that sends nothing
for 60 s): the Studio queues the request (`ai_generations`, status `queued`) and creates the draft as `generating`,
then returns; the worker claims the request (one atomic UPDATE), runs the steps below and turns the draft into an
ordinary `draft` with version 1, or `generation_failed` with the reason (Try again / Archive). The draft page
refreshes itself until then. A worker that stops (deployment) hands the request back to the queue.

1. Validate the request (Zod). 2. Enforce the per-user daily limit. 3. Load the business context
(`docs/business-context.md`), the voice profile (Settings, default `.claude/instagram/voice.md`) and the relevant
`SKILL.md` instructions with an adaptation note (no files, no tools, no posting inside the app). 4. Fetch product facts
from the catalogue API (prices TTC computed from HT + tax rate). 5. `client.beta.messages.parse` with a Zod output schema,
the static prompt cached, server-side refusal fallback. 6. Run the skills' tools (`humanize.py`, `caption.py`,
`detect.py`, `hookscore.py`, `beats.py`) with fixed arguments, model text only on stdin. 7. Save a draft and an
`ai_generations` record (tokens, duration, status; never keys). Errors map to clear messages; refusals and invalid
outputs are recorded.

## Publishing (`src/server/jobs`)

- **Queue**: `publishing_jobs` rows. The worker claims due jobs with one atomic `UPDATE … ORDER BY run_at LIMIT n` that stamps them with its id and the claim time (InnoDB locks and re-checks each row: no double claim), takes
  back jobs left `running` for 15 minutes (crashed worker), polls every `WORKER_POLL_SECONDS`.
- **Checks at publish time**: draft still `scheduled`; approved version = current version = job version; last approval
  decision is `approved` with the same content hash; `PUBLISHING_MODE=live` **and** Settings → publishing on; account
  connected; token valid and `instagram_content_publish` granted (asked to Meta via `debug_token`); media of the right
  type and reachable at its public URL.
- **Steps**: create container (`POST /{ig-user-id}/media`, image_url or media_type=REELS + video_url) → save container ID →
  status (`GET /{container-id}?fields=status_code`, re-checked every minute while `IN_PROGRESS`, 15 minutes max) →
  `POST /{ig-user-id}/media_publish` → save the media ID.
- **No double publish**: one live job per version (MySQL has no partial index: a generated column holds the key only while the job is queued, running or succeeded, under a unique index; another does the same for one live job per draft), the container ID is
  stored before publishing, a container already `PUBLISHED` or a job with a media ID is never published again.
- **Retries**: transient errors (5xx, rate limits, network, Meta "transient") retry after 1 min, 5 min, 15 min, 1 h, up to
  5 attempts; auth errors mark the account `needs_reauth`; permission and validation errors fail at once. Each step is
  logged in `publish_logs`; success and failure appear in the dashboard's activity.

## Data model (`src/server/db/schema.ts`, migrations in `drizzle/`)

`users`, `sessions` (token hash), `brand_profiles` (voice, language, timezone, publishing switch), `instagram_accounts`
(encrypted token, business ID, configuration ID, granted scopes, status), `oauth_states` (hash, single use, 10 min),
`media_assets`, `content_drafts`, `content_versions` (immutable, content hash, validation), `approvals`,
`publishing_jobs`, `publish_logs`, `ai_generations`, `activity`. Foreign keys, `CHECK` constraints on every status,
indexes on the hot paths. Every query filters on `owner_id`.

## Security

- Sessions: random token in an httpOnly, SameSite=Lax cookie (Secure in production); only its SHA-256 is stored.
  Passwords: argon2id. Server actions are protected by Next.js origin checks; every action re-checks the session.
- Meta tokens: AES-256-GCM (`TOKEN_ENCRYPTION_KEY`), never sent to the browser or logged; Graph calls carry
  `appsecret_proof`; errors are redacted.
- OAuth: state bound to the signed-in user, single use, 10-minute expiry, exact redirect URI, server-side code exchange.
- The skills' tools run with a filtered environment (no secrets) and a timeout; no model output is executed.
- No scraping, no browser automation of Instagram, no password collection, no undocumented endpoints.
