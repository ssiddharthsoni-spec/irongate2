FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/types/package.json packages/types/
COPY apps/dashboard/package.json apps/dashboard/

RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY apps/dashboard/ apps/dashboard/

WORKDIR /app/apps/dashboard
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
COPY --from=base /app/apps/dashboard/.next ./.next
COPY --from=base /app/apps/dashboard/public ./public
COPY --from=base /app/apps/dashboard/package.json .
COPY --from=base /app/node_modules ./node_modules

EXPOSE 3001
ENV PORT=3001
CMD ["npx", "next", "start"]
