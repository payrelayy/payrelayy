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

FROM build-base AS customer-web-build

RUN pnpm --filter @fetanagent/customer-web... run build

FROM build-base AS executor-build

RUN pnpm --filter @fetanagent/executor... run build

FROM --platform=linux/amd64 node:22-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066 AS runtime-base

RUN groupadd --gid 10001 fetanagent \
  && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin fetanagent \
  && groupadd --gid 10002 fetanagent-readiness-controller \
  && useradd --uid 10002 --gid 10002 --no-create-home --shell /usr/sbin/nologin fetanagent-readiness-controller \
  && groupadd --gid 10003 fetanagent-readiness-proxy \
  && useradd --uid 10003 --gid 10003 --no-create-home --shell /usr/sbin/nologin fetanagent-readiness-proxy \
  && groupadd --gid 10004 fetanagent-readiness-authorizer \
  && useradd --uid 10004 --gid 10004 --no-create-home --shell /usr/sbin/nologin fetanagent-readiness-authorizer

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

USER root

RUN install -d -o 10001 -g 10001 -m 0700 /run/fetanagent-kemerbet-session-control \
  && install -d -o root -g root -m 0755 /run/fetanagent-kemerbet-readiness-cohort-receipts

USER 10001:10001

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

FROM runtime-base AS customer-web

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="fetanagent-customer-web" \
      org.opencontainers.image.revision="${VCS_REF}"

COPY --from=customer-web-build --chown=10001:10001 /workspace/node_modules ./node_modules
COPY --from=customer-web-build --chown=10001:10001 /workspace/packages ./packages
COPY --from=customer-web-build --chown=10001:10001 /workspace/apps/customer-web ./apps/customer-web

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3003/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/customer-web/dist/index.js"]

# The executor uses the distribution-provided Chromium at the production-pinned
# /usr/bin/chromium path. playwright-core does not download or bundle another browser.
FROM runtime-base AS executor-runtime-base

USER root

ARG FETANAGENT_CHROMIUM_PACKAGE_VERSION
ARG FETANAGENT_DEBIAN_SECURITY_SNAPSHOT

RUN test -n "${FETANAGENT_CHROMIUM_PACKAGE_VERSION}" \
  && test -n "${FETANAGENT_DEBIAN_SECURITY_SNAPSHOT}" \
  && expr "${FETANAGENT_DEBIAN_SECURITY_SNAPSHOT}" : '[0-9]\{8\}T[0-9]\{6\}Z$' >/dev/null \
  && apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates \
  && printf '%s\n' \
    "deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/${FETANAGENT_DEBIAN_SECURITY_SNAPSHOT} bookworm-security main" \
    > /etc/apt/sources.list.d/fetanagent-chromium-snapshot.list \
  && apt-get -o Acquire::Check-Valid-Until=false update \
  && apt-get install --yes --no-install-recommends "chromium=${FETANAGENT_CHROMIUM_PACKAGE_VERSION}" fonts-liberation \
  && install -d -o 10001 -g 10001 -m 0700 /run/fetanagent-kemerbet-session-control /var/lib/fetanagent/kemerbet-sessions \
  && rm -f /etc/apt/sources.list.d/fetanagent-chromium-snapshot.list \
  && rm -rf /var/lib/apt/lists/*

# Docker Compose can otherwise inherit proxy authority from the Docker client's
# config.json. Keep an explicit no-proxy baseline in the executor image; the
# one-shot readiness service repeats these exact empty overrides so Compose
# cannot replace them with host-configured proxy values.
ENV HOME=/tmp \
    HTTP_PROXY= \
    http_proxy= \
    HTTPS_PROXY= \
    https_proxy= \
    NO_PROXY= \
    no_proxy= \
    FTP_PROXY= \
    ftp_proxy= \
    ALL_PROXY= \
    all_proxy=

USER 10001:10001

FROM executor-runtime-base AS executor

ARG VCS_REF=unknown
ARG FETANAGENT_CHROMIUM_PACKAGE_VERSION
ARG FETANAGENT_DEBIAN_SECURITY_SNAPSHOT
LABEL org.opencontainers.image.title="fetanagent-deposit-executor" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.chromium-package-version="${FETANAGENT_CHROMIUM_PACKAGE_VERSION}" \
      org.opencontainers.image.chromium-security-snapshot="${FETANAGENT_DEBIAN_SECURITY_SNAPSHOT}"

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
