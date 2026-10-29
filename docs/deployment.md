# Deployment

Production runs on the owner's **CloudOps** hosting panel as the Next.js website `agent-intg`, at
**https://agent-intg.abdocloud.com**, deployed from the `main` branch of this repository. Each production action
(creating the website, setting secrets, enabling publishing) is the owner's decision.

## What runs

| Part | On CloudOps | Notes |
|---|---|---|
| Web app | Website type **Next.js**, 1024 MB, health path `/api/health` | `npm ci` then `npm run build` from Git; `next start` on 127.0.0.1 behind Nginx and Cloudflare, two slots (zero-downtime switch, automatic rollback if the health check fails) |
| Database | **MySQL 8** created by CloudOps (`co_agent_intg`) | CloudOps writes `DB_SOCKET`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` into the website's `.env`; `DB_AUTO_MIGRATE=true` applies pending migrations when the app starts (a failed migration fails the deployment before any switch) |
| Media | `MEDIA_STORAGE=local` in the website's `shared/storage/media` (kept across deployments, in CloudOps backups) | Served publicly at `MEDIA_PUBLIC_BASE_URL/media/…` so Meta can download it. Uploads up to 60 MB (Server Action limit `60mb`, `MEDIA_MAX_BYTES=62914560`; Nginx on CloudOps accepts 64 MB) |
| Python 3 | `python3` on the server | The skills' tools; without it, drafts are created and the checks are marked "not run" |
| Worker | **inside the web server** (`WORKER_IN_PROCESS=true`) | CloudOps runs one process per Next.js website and its type cannot change later, so the worker loop starts from `src/instrumentation.ts`. It writes AI drafts in the background and handles publishing jobs (with `PUBLISHING_MODE=disabled`, due jobs are only marked as not sent). On SIGTERM it stops within 14 s (systemd kills at 20 s): the wait for Claude is aborted and the request goes back to the queue. During a deployment the old and new release run together for a few seconds; every claim is one atomic `UPDATE … LIMIT`, so a job is never taken twice |

## Configuration (the website's Environment page in CloudOps)

Secrets are entered on the server only (CloudOps keeps `.env` at mode 0600, outside the release, never in Git):

| Variable | Value |
|---|---|
| `APP_URL` | `https://agent-intg.abdocloud.com` |
| `META_REDIRECT_URI` | `https://agent-intg.abdocloud.com/api/meta/oauth/callback` (also saved in the Meta login configuration) |
| `TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64, generated for production (losing it means reconnecting Instagram) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID` | Claude Console |
| `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID` | Meta App Dashboard (see [meta-setup.md](meta-setup.md)) |
| `MEDIA_STORAGE`, `MEDIA_LOCAL_DIR`, `MEDIA_PUBLIC_BASE_URL` | `local`, the website's `shared/storage/media`, `https://agent-intg.abdocloud.com` |
| `DB_AUTO_MIGRATE` | `true` |
| `WORKER_IN_PROCESS` | `true` |
| `MEDIA_MAX_BYTES` | `62914560` |
| `PUBLISHING_MODE` | `disabled` until the owner approves a first live post |
| `DB_*` | written by CloudOps when it creates the database |

`ECOMMERCE_API_URL` stays empty while the e-commerce API is only on the local network.

## Deploying a change

1. Merge into `main` and push.
2. CloudOps → the website → **Deploy now** (or `cloudops:deploy agent-intg` on the server). The new release starts on the
   inactive slot, applies migrations, must answer `/api/health`, then takes the traffic.
3. A failed deployment leaves the previous release serving. **Revert** in CloudOps goes back to an older release (a
   migration is not undone: keep migrations backward compatible).

## Meta app settings for this address

- Unified login configuration → **Redirect URL**: `https://agent-intg.abdocloud.com/api/meta/oauth/callback`.
- App settings → Basic: **Privacy Policy URL** `https://agent-intg.abdocloud.com/privacy`, **Terms of Service URL**
  `https://agent-intg.abdocloud.com/terms`, **User data deletion** → *Data deletion instructions URL*
  `https://agent-intg.abdocloud.com/data-deletion`.

## Rollback and kill switch

`PUBLISHING_MODE=disabled` stops all publishing (and Settings → publishing must also be on for any post to go out).
Instagram access is revoked from Business Settings → Integrations → Connected apps.
