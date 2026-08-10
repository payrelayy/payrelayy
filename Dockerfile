# syntax=docker/dockerfile:1

# This build contains no runtime secret, database URL, or bot token. Every runtime target remains
# Linux/amd64-only and uses the same reviewed immutable Node base image.
# Reviewed 2026-08-08 for the London Linux/amd64 VM. Reverify this digest before a real deployment.
FROM --platform=linux/amd64 node:22-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066 AS build-base

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile

FROM build-base AS beta-admission-build

RUN pnpm --filter @payreplayy/beta-admission... run build

FROM build-base AS bot-build

RUN pnpm --filter @payreplayy/bot... run build

FROM build-base AS api-build

RUN pnpm --filter @payreplayy/api... run build

FROM --platform=linux/amd64 node:22-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066 AS runtime-base

RUN groupadd --gid 10001 payreplayy \
  && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin payreplayy

WORKDIR /workspace

ENV NODE_ENV=production

USER 10001:10001

FROM runtime-base AS beta-admission

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="payreplayy-beta-admission" \
      org.opencontainers.image.revision="${VCS_REF}"

COPY --from=beta-admission-build --chown=10001:10001 /workspace/node_modules ./node_modules
COPY --from=beta-admission-build --chown=10001:10001 /workspace/packages ./packages
COPY --from=beta-admission-build --chown=10001:10001 /workspace/apps/beta-admission ./apps/beta-admission

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3001/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/beta-admission/dist/index.js"]

FROM runtime-base AS bot

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="payreplayy-bot" \
      org.opencontainers.image.revision="${VCS_REF}"

COPY --from=bot-build --chown=10001:10001 /workspace/node_modules ./node_modules
COPY --from=bot-build --chown=10001:10001 /workspace/packages ./packages
COPY --from=bot-build --chown=10001:10001 /workspace/apps/bot ./apps/bot

CMD ["node", "apps/bot/dist/index.js"]

FROM runtime-base AS api

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="payreplayy-api" \
      org.opencontainers.image.revision="${VCS_REF}"

COPY --from=api-build --chown=10001:10001 /workspace/node_modules ./node_modules
COPY --from=api-build --chown=10001:10001 /workspace/packages ./packages
COPY --from=api-build --chown=10001:10001 /workspace/apps/api ./apps/api

# Preserve the established inactive-image identity contract while the dedicated beta targets use
# the equivalent numeric UID/GID form required by their Compose secret mounts.
USER payreplayy:payreplayy

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/api/dist/index.js"]
