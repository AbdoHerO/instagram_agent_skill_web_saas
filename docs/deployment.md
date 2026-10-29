# Deployment

Nothing has been deployed. These are the steps for a first controlled release; each production action (creating
infrastructure, setting secrets, enabling publishing) is the owner's decision.

## What runs

| Process | Command | Notes |
|---|---|---|
| Web app | `npm run build` then `npm run start` (port 3100) | Behind HTTPS (reverse proxy or platform) |
| Worker | `npm run worker` | Exactly one or more instances; jobs are claimed with `SKIP LOCKED`, so several workers are safe |
| Database | PostgreSQL 14+ | `npm run db:migrate` on each release (idempotent) |
| Media | S3-compatible bucket (`MEDIA_STORAGE=s3`) | Meta downloads from a pre-signed URL; or local disk + public `MEDIA_PUBLIC_BASE_URL` |
| Python 3 | `python3` on the server | For the skills' tools; without it, drafts are created and the checks are marked "not run" |

Any Node 20+ host works (a VM with systemd/PM2, a container platform). A Docker image needs Node 20, Python 3 and the
project files including `.claude/skills` and `docs/business-context.md`.

## Configuration

Set every variable of `.env.example` in the host's **secret manager** (not in files committed to Git):
`APP_URL=https://<domain>`, `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64; losing it means reconnecting
Instagram), `ANTHROPIC_API_KEY`, `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`,
`META_REDIRECT_URI=https://<domain>/api/meta/oauth/callback` (registered in the Meta app), S3 settings,
`ECOMMERCE_API_URL` (production e-commerce API), `PUBLISHING_MODE=disabled` until the first live test is approved.

## First release checklist

1. Database created, `npm run db:migrate`, `npm run user:create` for each person.
2. HTTPS domain; redirect URI registered in Meta exactly as configured.
3. Connect the Instagram account; *Check connection* shows the three permissions granted.
4. Generate and approve a test post; schedule it with `PUBLISHING_MODE=disabled` and confirm the worker reports
   "Publishing is disabled… Nothing was sent".
5. With the owner's explicit approval: set `PUBLISHING_MODE=live`, enable publishing in Settings (type PUBLISH),
   schedule one real post, watch it in the post history (container, status, media ID).
6. Back up the database (daily) and keep `TOKEN_ENCRYPTION_KEY` in the secret manager.

## Rollback

`PUBLISHING_MODE=disabled` stops all publishing immediately (queued jobs fail with a clear message, nothing is sent).
Deploy the previous build; migrations are additive. Revoke Instagram access from Business Settings → Integrations →
Connected apps if needed.
