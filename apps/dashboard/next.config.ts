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
