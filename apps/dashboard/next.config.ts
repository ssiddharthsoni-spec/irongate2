import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@iron-gate/types'],
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
