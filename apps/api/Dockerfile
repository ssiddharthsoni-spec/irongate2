# Pin to specific Node.js 20 LTS release for reproducible builds
FROM node:20.18-slim

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy root workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy ALL workspace package.json files — pnpm --frozen-lockfile validates
# every importer in the lockfile, even ones the API doesn't depend on
COPY packages/types/package.json packages/types/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/proto/package.json packages/proto/package.json
COPY packages/plugin-sdk/package.json packages/plugin-sdk/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/extension/package.json apps/extension/package.json
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/vscode-extension/package.json apps/vscode-extension/package.json
COPY apps/mcp-proxy/package.json apps/mcp-proxy/package.json

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source code (only packages the API actually imports)
COPY packages/types/ packages/types/
COPY packages/config/ packages/config/
COPY packages/crypto/ packages/crypto/
COPY apps/api/ apps/api/

# Force IPv4 DNS resolution (Railway can't reach Supabase over IPv6)
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

# Run as non-root for defense-in-depth
RUN groupadd --system irongate && useradd --system --gid irongate irongate
USER irongate

# Expose port
EXPOSE 3000

# Start API directly with npx tsx (bypasses pnpm workspace overhead)
# npx resolves tsx from node_modules reliably regardless of hoisting
CMD ["npx", "tsx", "apps/api/src/index.ts"]
