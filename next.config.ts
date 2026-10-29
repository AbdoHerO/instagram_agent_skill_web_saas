import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // Server-only packages (native argon2, pg, the S3 SDK) stay out of the client bundle.
  serverExternalPackages: ['@node-rs/argon2', 'pg'],
  poweredByHeader: false,
  // Development from another machine on the LAN (e.g. DEV_ALLOWED_ORIGINS=192.168.1.7).
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean),
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
