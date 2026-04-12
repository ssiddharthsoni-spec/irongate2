import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@iron-gate/types'],
  env: {
    NEXT_PUBLIC_APP_VERSION: require('./package.json').version,
  },
  eslint: {
    // Linting is handled by the root eslint.config.js in CI;
    // skip during Next.js build to avoid plugin mismatch.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Type-checking is handled by CI — don't fail Vercel builds on type errors
    ignoreBuildErrors: true,
  },
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            // Clerk loads its JS from *.clerk.accounts.dev (dev) and from the
            // per-instance clerk.<subdomain>.com (prod). 'unsafe-eval' is
            // required by Clerk's internal runtime. Without these the SignUp
            // widget fails silently and only the page shell renders.
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://js.stripe.com https://*.clerk.com https://*.clerk.accounts.dev https://challenges.cloudflare.com",
            "worker-src 'self' blob:",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "img-src 'self' data: blob: https://img.clerk.com https://*.clerk.com https://*.clerk.accounts.dev",
            "font-src 'self' data: https://fonts.gstatic.com",
            "connect-src 'self' https://irongate-api.onrender.com https://*.clerk.com https://*.clerk.accounts.dev https://api.stripe.com https://us.i.posthog.com",
            "frame-src https://challenges.cloudflare.com https://js.stripe.com https://*.clerk.com https://*.clerk.accounts.dev",
            "object-src 'none'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
          ].join('; '),
        },
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=31536000; includeSubDomains; preload',
        },
      ],
    },
  ],
};

// Wrap with Sentry if the SDK is available
let exportedConfig: NextConfig = nextConfig;
try {
  const { withSentryConfig } = require('@sentry/nextjs');
  exportedConfig = withSentryConfig(nextConfig, {
    org: 'iron-gate',
    project: 'dashboard',
    silent: true,
  });
} catch {
  // @sentry/nextjs not installed — skip Sentry wrapping
}

export default exportedConfig;
