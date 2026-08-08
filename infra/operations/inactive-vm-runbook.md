# Inactive VM runbook

## Purpose and scope

This runbook governs the PayReplayy London VM while it is an **inactive build
environment only**. It is not a customer-facing service runbook.

At this stage, the VM may contain a sealed source release and a locally built
inactive API image. It must not run a PayReplayy container, publish a port,
load an application secret, connect to Supabase, receive Telegram updates, or
perform a KemerBet or payment action.

This document is intentionally English-only. It does not contain credentials,
personal data, payment evidence, or recovery material.

## Required inactive state

Before and after any build-only validation, the operator must be able to show:

- the source release is a detached, reviewed Git commit and has a clean worktree;
- the source release is root-owned and not writable by the repository deploy
  identity;
- the inactive image has no running container and no declared exposed port;
- no PayReplayy Docker Compose project, systemd unit, reverse proxy, or public
  HTTP(S) listener exists;
- all product switches remain disabled and financial actions remain `dry_run`;
- no application secret has been placed in the repository, image, Compose file,
  shell history, or chat transcript.

Read-only evidence commands may be run by an approved VM administrator. Adapt
the release path and image tag to the reviewed release; do not use these
commands to select an unreviewed branch.

```bash
set -euo pipefail

readonly RELEASE_DIR='/srv/payreplayy/releases/<reviewed-commit>'
readonly IMAGE='payreplayy-api:inactive-<short-commit>'

git -C "$RELEASE_DIR" rev-parse HEAD
git -C "$RELEASE_DIR" status --porcelain
stat --format='%U:%G:%a %n' "$RELEASE_DIR" "$RELEASE_DIR/Dockerfile"
test -z "$(runuser -u payreplayy-deploy -- env HOME=/srv/payreplayy/deploy \
  sh -c 'cd "$HOME"; find "$1" -xdev -writable -print -quit' sh "$RELEASE_DIR")"
docker image inspect "$IMAGE" --format 'image_id={{.Id}} size_bytes={{.Size}}'
docker image inspect "$IMAGE" --format '{{with index .Config "ExposedPorts"}}{{json .}}{{else}}null{{end}}'
docker container ls --filter "ancestor=$IMAGE" --quiet
docker compose --profile inactive -f "$RELEASE_DIR/infra/compose.inactive.yaml" config
! docker compose ls --all --format json | grep -Fq '"Name":"payreplayy-inactive"'
! systemctl list-unit-files --no-legend 'payreplayy*' | grep -q .
ss -ltn
```

An empty `git status --porcelain` and an empty PayReplayy image container list
are required. The image port command must print `null`; the recursive
`runuser` check must be empty. The rendered Compose output must retain
`FINANCIAL_ACTIONS_MODE: dry_run` and all three `INTERNAL_*` switches set to
`false`. Other approved, managed VM containers are outside this runbook and do
not make the PayReplayy image container list non-empty.

Review `ss -ltn` manually: SSH is the only allowed non-loopback TCP listener
at this stage. Loopback-only resolver listeners may appear, but no PayReplayy
or public HTTP(S) listener is allowed.

## Build-only validation boundary

An approved build-only validation may pull the reviewed, pinned base image and
the locked dependency graph. It may create a local Docker image. It must not:

- run `docker compose up`, `docker run`, or a systemd service;
- publish a port, attach a volume, add a proxy, or mount the Docker socket;
- attach an `env_file`, Compose secret, database URL, bot token, or provider
  credential;
- change a disabled runtime flag, create a database login, or contact a payment
  provider.

The repository deploy identity must remain outside the `docker` and `sudo`
groups. A separately approved administrator path performs a one-time image
build; it does not give the deploy identity Docker access.

## Backup acceptance

Enabling DigitalOcean backups is not sufficient for staging eligibility. Record
the following evidence only after DigitalOcean shows an automatically-created
backup image for the correct VM, with type `backup` and status `available`:

- the VM identifier and region;
- backup image identifier, type, creation timestamp, and available status;
- the active daily schedule and retention policy; and
- confirmation that the backup was created after backup enablement.

Do not restore, convert, delete, or snapshot an image as part of this check.
A restore test needs its own approved recovery plan because it changes cloud
state and can affect a running VM.

## Incident stop boundary

If an unexpected PayReplayy container, port, credential, or enabled feature is
found:

1. Do not restart, redeploy, pull a newer branch, or retry a payment action.
2. Record only safe metadata: timestamp, reviewed release identifier, container
   name or image identifier, and listening address. Never record a secret or
   customer/payment payload.
3. Keep the firewall closed and do not publish a replacement port.
4. Escalate to the PayReplayy Owner for a separately authorized stop or
   remediation action. The current inactive contract has no approved service to
   restart.

## Go/no-go checklist

All items below must be true before proposing a private staging deployment:

- [ ] A first DigitalOcean backup artifact has been verified and a restore-test
      plan has been approved.
- [ ] Monitoring alerts, log rotation, and an incident contact/stop procedure
      have been separately implemented and reviewed.
- [ ] A non-root VM administrator has been tested without weakening the current
      managed access path; the repository deploy identity remains noninteractive.
- [ ] The VM firewall remains SSH-only, with no public Docker or application
      port.
- [ ] A dedicated non-admin API database login has passed the read-only database
      preflight from the private VM boundary.
- [ ] A dedicated maintenance path for expired nonce cleanup, plus a durable
      bot outbox and private transport wiring, have been separately reviewed.
- [ ] A reviewed HTTPS/domain/proxy plan exists before any public endpoint.

Until every item is checked, the only allowed PayReplayy actions are source
inspection and build-only validation under the inactive contract.
