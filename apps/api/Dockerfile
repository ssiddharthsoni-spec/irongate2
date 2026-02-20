FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
COPY apps/api/package.json apps/api/

RUN bun install --frozen-lockfile

# Copy source
COPY packages/ packages/
COPY apps/api/ apps/api/

# Build
WORKDIR /app/apps/api
RUN bun build src/index.ts --outdir dist

# Production
FROM oven/bun:1-slim
WORKDIR /app
COPY --from=base /app/apps/api/dist ./
EXPOSE 3000
CMD ["bun", "run", "index.js"]
