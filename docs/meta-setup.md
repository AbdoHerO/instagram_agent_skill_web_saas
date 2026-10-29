# Meta setup — Instagram API with Unified Login

Checked against Meta's documentation on 29/10/2026 (Graph API v26.0). If Meta's dashboard differs from what is
written here, Meta is right. Statements marked *(not documented)* are the app's choices where Meta's pages are silent.

## Which product this app uses

Your app uses **API setup with Unified login** (use case *Manage messaging & content on Instagram*). That is the
**Instagram API with Unified Login**:

| | |
|---|---|
| Login | Facebook Login for Business with a **configuration** (`config_id`); the person can sign in with Facebook or Instagram |
| Token | **Business Integration System User access token** ("System-user access token (SUAT)" in the dashboard). It belongs to the client's business portfolio, not to the person who logged in, and needs the authorization-code grant (`response_type=code`, `override_default_response_type=true`). It is *not* a user access token |
| Host | `graph.facebook.com` |
| Facebook Page | not required |
| Business portfolio | required: the app must be owned by one (otherwise the *API setup with Unified login* tab does not appear) |
| Instagram account | professional (Business or Creator), in the business portfolio chosen in the login dialog |

The links in some guides point to "Instagram API with Instagram Login" (`graph.instagram.com`, `instagram_business_*`
permissions). That is a different product with a different token; this app does **not** use it and does not switch to it.

Sources: [Unified Login overview](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login) ·
[Get started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started) ·
[Authentication](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication) ·
[Permissions](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions) ·
[Eligibility and troubleshooting](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/eligibility-and-troubleshooting) ·
[Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/) ·
[Manual login flow](https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow) ·
[Content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md)

## Steps in the Meta App Dashboard

Path: **App Dashboard → Use cases → Manage messaging & content on Instagram → Customize → API setup with Unified login**.

1. **Configuration** — under **Configure your app**, select **Create new configuration** (or reuse one labelled
   **Instagram Login Compatible**). Meta's default configuration requests an Instagram account and an ad account (the
   client can skip the ad account) with:
   - `instagram_basic` and `instagram_manage_messages` — **required by Meta** in this configuration;
   - `instagram_manage_comments`, `instagram_content_publish`, `ads_management`, `ads_read`.

   Open the configuration preview → **Edit permissions**: keep `instagram_basic`, `instagram_content_publish` and
   `instagram_manage_messages`; add `instagram_manage_insights` (for Analytics). This app does not use
   `instagram_manage_comments`, `ads_management` or `ads_read`: remove them if the dashboard allows it, because every
   permission in the configuration needs Advanced Access before clients without a role on the app can connect.
   The preview shows the token type (must be **System-user access token**) and its expiry (Meta's default: never).
   Select **Use this configuration**.
2. **Redirect URL** — under **Redirect URL**, enter the app's callback (HTTPS) and select **Save**. It must be exactly the
   value of `META_REDIRECT_URI`, which must be `APP_URL` + `/api/meta/oauth/callback`. The Accounts page shows the exact
   value to copy. If the dashboard also lists **Facebook Login for Business → Settings → Valid OAuth Redirect URIs**, add
   the same URL there.
3. **Login URL / configuration ID** — copy the **Login URL** Meta shows; the value of its `config_id` parameter goes in
   `META_LOGIN_CONFIG_ID` (not a secret). The app builds the same login URL itself.
4. **App ID and secret** — **App settings → Basic**: the **Meta app** ID and secret (not an Instagram app ID/secret) go
   in `META_APP_ID` and `META_APP_SECRET`. The secret goes only in `.env.local` (or `.env`) / the host's secret settings.
5. **Who can connect (development)** — saving the configuration gives **Standard Access**: people with a role on the app
   can connect. To sign in with the Instagram account itself: **Generate access tokens → Add account** invites it as an
   **Instagram Tester**; accept on instagram.com under **Settings → Website permissions → Apps and websites → Tester
   Invites**. Test users are not supported.
6. **Production** — Euro Digital connecting its own account through people who have a role on the app works with
   Standard Access. Connecting accounts of people without a role needs **Advanced Access** for each permission of the
   configuration (**Complete App Review → Go to app review**) and the app in **Live** mode.

### Local HTTPS

Meta requires an HTTPS Redirect URL. Locally: `npm run dev:https` (Next.js creates a local certificate; the first time,
Windows asks you to trust a local development certificate authority), then set `APP_URL=https://localhost:3100` and
`META_REDIRECT_URI=https://localhost:3100/api/meta/oauth/callback`. Whether the dashboard accepts a `localhost` Redirect
URL is *(not documented)*; if it refuses, use an HTTPS tunnel or the production domain.

## What the app does

1. **Connect an account** → `GET /api/meta/oauth/start`. It refuses first (with a message on the Accounts page) when
   Meta settings are missing, `TOKEN_ENCRYPTION_KEY` is missing or invalid, or `META_REDIRECT_URI` does not match
   `APP_URL` + the callback path. Otherwise it stores a single-use `state` (SHA-256 hash, bound to the signed-in user,
   10 minutes) and redirects to
   `https://www.facebook.com/v26.0/dialog/oauth?client_id&redirect_uri&config_id&response_type=code&override_default_response_type=true&state`.
   No `scope` is sent: the configuration decides the permissions.
2. Meta redirects to **`/api/meta/oauth/callback`** with `code` and `state` (or `error=access_denied`). The state is
   consumed once; then the server calls
   `GET https://graph.facebook.com/v26.0/oauth/access_token?client_id&client_secret&redirect_uri&code`.
3. `GET /debug_token` (app token `APP_ID|APP_SECRET`) → validity, granted permissions, expiry;
   `GET /me?fields=client_business_id`; `GET /me/assigned_instagram_accounts?fields=id,username`; each account's profile.
   One row per account: the token encrypted (AES-256-GCM), the client business ID, the configuration ID, the permissions.
4. **Check connection** repeats the token check: missing `instagram_content_publish` or invalid access is a problem;
   missing `instagram_manage_insights` and granted-but-unused permissions are notes. A token past its expiry date shows
   *needs reauth* at once, and the worker re-checks the token before every publication.
5. **Disconnect** deletes the stored token. Meta has no revocation endpoint for these tokens: the business removes the
   app in **Business Settings → Integrations → Connected apps**. Moving the Instagram account to another portfolio also
   invalidates the token; the app then shows *needs reauth* and stops retrying.

Codes shown after a failed connection: `denied`, `invalid_state`, `exchange_failed`, `not_configured`, `encryption_key`,
`redirect_uri`, `invalid_token`, `unsupported_token` (the configuration does not issue a system-user token),
`no_account` (no professional account shared), `failed` (logged on the server without secrets).

## Publishing, comments and messaging

- **Publishing** (implemented, off): `instagram_content_publish`; media on a public HTTPS URL (JPEG images, MP4 Reels);
  100 API posts per account per 24 hours. Stays off until `PUBLISHING_MODE=live` **and** Settings → publishing is on.
- **Comments** (not implemented): would need `instagram_manage_comments` and webhooks.
- **Messaging** (not implemented, although Meta's configuration requires `instagram_manage_messages`): would need an
  HTTPS webhook endpoint (**Configure webhooks**: callback URL, verify token, subscribed fields), the client's Instagram
  setting **Allow access to messages**, and Advanced Access for clients without a role on the app.

## Troubleshooting (from Meta's page)

- No *API setup with Unified login* tab → the app is not owned by a business portfolio.
- No Instagram login option → the configuration is not *Instagram Login Compatible*, or the browser is already signed in
  to Facebook (choose *Add another account*; adding `prompt=login` to the login URL also forces the choice).
- Instagram account not listed → it is personal, or belongs to another portfolio.
- `(#10) … account type is not business or creator` → switch to Business/Creator and reconnect.
