FROM node:20-slim

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy root workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy ALL workspace package manifests (pnpm --frozen-lockfile needs every
# member referenced in the lockfile, even if the API doesn't depend on them)
COPY packages/types/package.json packages/types/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/proto/package.json packages/proto/package.json
COPY packages/plugin-sdk/package.json packages/plugin-sdk/package.json
COPY apps/api/package.json apps/api/package.json

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source code (only packages the API actually imports)
COPY packages/types/ packages/types/
COPY packages/config/ packages/config/
COPY packages/crypto/ packages/crypto/
COPY apps/api/ apps/api/

# Force IPv4 DNS resolution (Railway can't reach Supabase over IPv6)
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

# Expose port
EXPOSE 3000

# Start API with tsx (resolves workspace packages from source)
CMD ["pnpm", "--filter=@iron-gate/api", "start"]
