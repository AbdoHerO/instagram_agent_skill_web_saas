# Meta setup — Instagram API with Unified Login

Checked against Meta's documentation on 29/10/2026 (Graph API v26.0). If Meta's dashboard differs from what is
written here, Meta is right.

## Which product this app uses

Your app shows **API setup with Unified login** with `instagram_basic` and `instagram_content_publish`. That is the
**Instagram API with Unified Login**, which Meta recommends for new integrations:

| | |
|---|---|
| Login | Facebook Login for Business, with a **configuration** (`config_id`) |
| Token | **Business Integration System User access token** ("System-user access token" in the dashboard), belongs to the business portfolio, not to the person who logged in. It is *not* a user access token and only supports the authorization-code grant |
| Host | `graph.facebook.com` |
| Facebook Page | not required |
| Business portfolio | required (the app must be owned by one; the "API setup with Unified login" tab only appears then) |
| Instagram account | professional (Business or Creator), shared by the business with the app |

The older "Instagram API with Instagram Login" (`graph.instagram.com`, `instagram_business_*` scopes) and
"Instagram API with Facebook Login" (Page tokens) flows are **not** used here.

Sources: [Overview](https://developers.facebook.com/docs/instagram-platform/overview/) ·
[Unified Login – authentication](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication) ·
[Unified Login – get started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started) ·
[Unified Login – permissions](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions) ·
[Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/) ·
[Content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md) ·
[Insights](https://developers.facebook.com/documentation/instagram-platform/insights.md)

## Steps in the Meta App Dashboard

1. **Use case**: *Manage messaging & content on Instagram* → *API setup with Unified login*.
2. **Configuration**: create (or pick one labelled *Instagram Login Compatible*) a Facebook Login for Business
   configuration with token type **System-user access token** and the permissions
   `instagram_basic`, `instagram_content_publish` and, for Analytics, `instagram_manage_insights`. Choose the token
   expiry you want (default: never; 60 days is possible). Copy the **Configuration ID** → `META_LOGIN_CONFIG_ID`.
3. **App ID and secret**: App settings → Basic. Use the **Meta app** ID and secret (not the Instagram app ID/secret)
   → `META_APP_ID`, `META_APP_SECRET` (secret only in `.env.local` / the host's secret settings).
4. **Redirect URI**: Facebook Login for Business → Settings → *Valid OAuth Redirect URIs*: add exactly
   `https://<your-domain>/api/meta/oauth/callback` → `META_REDIRECT_URI` (same string, character for character).
   Meta requires HTTPS for redirect URLs; for local testing use an HTTPS tunnel to port 3100 and register that URL.
5. **Roles**: with Standard Access only people with a role on the app can connect; invite the Instagram account as an
   **Instagram Tester** if needed (test users are not supported).
6. **Advanced Access** (connecting accounts of people without a role, Live mode): App Review for each permission +
   Business Verification. Not needed to manage Euro Digital's own account by people who have a role on the app.

## What the app does

1. *Connect an account* → `/api/meta/oauth/start`: creates a single-use `state` bound to the signed-in user, redirects to
   `https://www.facebook.com/v26.0/dialog/oauth?client_id&redirect_uri&config_id&response_type=code&override_default_response_type=true&state`.
2. Meta redirects to `/api/meta/oauth/callback?code&state`: the state is checked, then the server calls
   `GET https://graph.facebook.com/v26.0/oauth/access_token?client_id&client_secret&redirect_uri&code`.
3. `GET /debug_token` (app token) → validity, granted scopes, expiry; `GET /me?fields=client_business_id`;
   `GET /me/assigned_instagram_accounts?fields=id,username`; profile of each account. Each account is stored with the
   encrypted token, client business ID, configuration ID and scopes.
4. *Check connection* repeats the token check and reports missing permissions or invalid access.
5. *Disconnect* deletes the stored token. Meta has no revocation endpoint for these tokens: to revoke on Meta's side, the
   business removes the app in **Business Settings → Integrations → Connected apps**. Moving the Instagram account to
   another portfolio also invalidates the token; the app then shows *needs reauth* and stops retrying.

## Publishing limits to know

- Media must be on a public server when Meta fetches it; images **JPEG only**; Reels as MP4 (`media_type=REELS`).
- 100 API-published posts per account per rolling 24 hours (`GET /{ig-user-id}/content_publishing_limit`).
- A container expires if not published within 24 hours; the worker creates a new one if that happens.
- Publishing stays off until `PUBLISHING_MODE=live` **and** Settings → publishing is enabled.

## Diagnostics shown in the app

Missing server configuration (names only), denied consent, invalid/expired state, failed code exchange, no Instagram
account shared, missing permission, invalid or revoked access, account not professional (reported by Meta's error message).
