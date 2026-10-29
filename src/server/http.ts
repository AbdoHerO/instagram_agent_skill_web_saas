/**
 * Same-origin check for route handlers that change data (Server Actions get
 * Next.js's own check). The request's Origin must be this app's address
 * (APP_URL), the host the request was sent to, or the local address a VS Code
 * tunnel rewrites the Origin to. The session cookie is SameSite=Lax as well, so a
 * cross-site POST carries no session.
 */
const TUNNEL_LOCAL_ORIGIN = 'localhost:3100';

export function isSameOrigin(request: Request, appUrl: string): boolean {
  const origin = request.headers.get('origin');
  if (!origin || !URL.canParse(origin)) return false;
  const host = new URL(origin).host;
  const requestHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  return host === new URL(appUrl).host || host === requestHost || host === TUNNEL_LOCAL_ORIGIN;
}
