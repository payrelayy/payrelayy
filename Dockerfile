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

RUN pnpm --filter @fetanagent/beta-admission... run build

FROM build-base AS bot-build

RUN pnpm --filter @fetanagent/bot... run build

FROM build-base AS admin-build

RUN pnpm --filter @fetanagent/admin... run build

FROM build-base AS api-build

RUN pnpm --filter @fetanagent/api... run build

FROM build-base AS executor-build

RUN pnpm --filter @fetanagent/executor... run build

FROM --platform=linux/amd64 node:22-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066 AS runtime-base

RUN groupadd --gid 10001 fetanagent \
  && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin fetanagent

WORKDIR /workspace

ENV NODE_ENV=production

USER 10001:10001

FROM runtime-base AS beta-admission

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="fetanagent-beta-admission" \
      org.opencontainers.image.revision="${VCS_REF}"

COPY --from=beta-admission-build --chown=10001:10001 /workspace/node_modules ./node_modules
COPY --from=beta-admission-build --chown=10001:10001 /workspace/packages ./packages
COPY --from=beta-admission-build --chown=10001:10001 /workspace/apps/beta-admission ./apps/beta-admission

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3001/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/beta-admission/dist/index.js"]

FROM runtime-base AS bot

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="fetanagent-bot" \
      org.opencontainers.image.revision="${VCS_REF}"

COPY --from=bot-build --chown=10001:10001 /workspace/node_modules ./node_modules
COPY --from=bot-build --chown=10001:10001 /workspace/packages ./packages
COPY --from=bot-build --chown=10001:10001 /workspace/apps/bot ./apps/bot

CMD ["node", "apps/bot/dist/index.js"]

FROM runtime-base AS admin

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="fetanagent-owner-control" \
      org.opencontainers.image.revision="${VCS_REF}"

COPY --from=admin-build --chown=10001:10001 /workspace/node_modules ./node_modules
COPY --from=admin-build --chown=10001:10001 /workspace/packages ./packages
COPY --from=admin-build --chown=10001:10001 /workspace/apps/admin ./apps/admin

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3002/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/admin/dist/index.js"]

FROM runtime-base AS api

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="fetanagent-api" \
      org.opencontainers.image.revision="${VCS_REF}"

COPY --from=api-build --chown=10001:10001 /workspace/node_modules ./node_modules
COPY --from=api-build --chown=10001:10001 /workspace/packages ./packages
COPY --from=api-build --chown=10001:10001 /workspace/apps/api ./apps/api

# Preserve the established inactive-image identity contract while the dedicated beta targets use
# the equivalent numeric UID/GID form required by their Compose secret mounts.
USER fetanagent:fetanagent

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/api/dist/index.js"]

# The executor uses the distribution-provided Chromium at the production-pinned
# /usr/bin/chromium path. playwright-core does not download or bundle another browser.
FROM runtime-base AS executor-runtime-base

USER root

ARG FETANAGENT_CHROMIUM_PACKAGE_VERSION

RUN apt-get update \
  && test -n "${FETANAGENT_CHROMIUM_PACKAGE_VERSION}" \
  && apt-get install --yes --no-install-recommends ca-certificates "chromium=${FETANAGENT_CHROMIUM_PACKAGE_VERSION}" fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV HOME=/tmp

USER 10001:10001

FROM executor-runtime-base AS executor

ARG VCS_REF=unknown
ARG FETANAGENT_CHROMIUM_PACKAGE_VERSION
LABEL org.opencontainers.image.title="fetanagent-deposit-executor" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.chromium-package-version="${FETANAGENT_CHROMIUM_PACKAGE_VERSION}"

COPY --from=executor-build --chown=10001:10001 /workspace/node_modules ./node_modules
COPY --from=executor-build --chown=10001:10001 /workspace/packages ./packages
COPY --from=executor-build --chown=10001:10001 /workspace/apps/executor ./apps/executor

# playwright-core is exact-pinned in the executor manifest. Refuse an image whose externally
# selected Debian Chromium package has a different major from Playwright's own Chromium contract.
RUN node -e "const fs=require('node:fs');const cp=require('node:child_process');const spec=JSON.parse(fs.readFileSync('apps/executor/node_modules/playwright-core/browsers.json','utf8'));const expected=spec.browsers.find((entry)=>entry.name==='chromium')?.browserVersion?.split('.')[0];const actual=cp.execFileSync('/usr/bin/chromium',['--version'],{encoding:'utf8'}).trim();if(!expected||!actual.startsWith('Chromium '+expected+'.'))process.exit(1)"

HEALTHCHECK --interval=60s --timeout=45s --start-period=120s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8090/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/executor/dist/index.js"]

# Public HTTPS is a separately selected deployment profile. This image contains only the reviewed
# gateway configuration and static landing-page assets; it receives no application secret.
FROM --platform=linux/amd64 caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 AS gateway

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="fetanagent-gateway" \
      org.opencontainers.image.revision="${VCS_REF}"

COPY infra/gateway/Caddyfile /etc/caddy/Caddyfile
COPY infra/gateway/site /srv

USER 10001:10001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
