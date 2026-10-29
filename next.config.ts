import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

// The public address in APP_URL (e.g. an HTTPS tunnel to this machine). A tunnel may present the
// request to Next.js under another host, so Server Actions and dev resources must accept this one.
// VS Code tunnels also rewrite the browser's Origin header to the local address (localhost:3100) while
// sending the public host as x-forwarded-host, so that local origin must be accepted too.
const publicUrl = URL.canParse(process.env.APP_URL ?? '') ? new URL(process.env.APP_URL!) : null;
const isLocal = !publicUrl || ['localhost', '127.0.0.1'].includes(publicUrl.hostname);
const LOCAL_ORIGIN = 'localhost:3100'; // the port of `npm run dev` / `npm run start`

const nextConfig: NextConfig = {
  // Server-only packages (native argon2, pg, the S3 SDK) stay out of the client bundle.
  serverExternalPackages: ['@node-rs/argon2', 'pg'],
  poweredByHeader: false,
  // Development from another machine on the LAN (e.g. DEV_ALLOWED_ORIGINS=192.168.1.7), or through APP_URL.
  allowedDevOrigins: [
    ...(process.env.DEV_ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? []),
    ...(isLocal ? [] : [publicUrl!.hostname]),
  ],
  experimental: {
    serverActions: { allowedOrigins: isLocal ? [] : [publicUrl!.host, LOCAL_ORIGIN] },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
