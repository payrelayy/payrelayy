# syntax=docker/dockerfile:1

# This build is intentionally API-only. It contains no runtime secret, database URL, or bot token.
# Reviewed 2026-08-08 for the London Linux/amd64 VM. Reverify this digest before a real deployment.
FROM --platform=linux/amd64 node:22-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066 AS build

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @payreplayy/api... run build

FROM --platform=linux/amd64 node:22-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066 AS api

RUN groupadd --gid 10001 payreplayy \
  && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin payreplayy

WORKDIR /workspace

ENV NODE_ENV=production

COPY --from=build --chown=payreplayy:payreplayy /workspace/node_modules ./node_modules
COPY --from=build --chown=payreplayy:payreplayy /workspace/apps/api ./apps/api
COPY --from=build --chown=payreplayy:payreplayy /workspace/packages ./packages

USER payreplayy:payreplayy

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/api/dist/index.js"]
