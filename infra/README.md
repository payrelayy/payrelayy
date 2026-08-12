# Infrastructure contract

## Current state

The Stage 14A contract remains inactive and exposes no public HTTP(S) listener. A separately
guarded staging-beta release may run on the London VM with Owner control bound only to loopback and
all other services on a private Docker bridge. It does not enable KemerBet or financial behavior.

The repository provides:

- [`../Dockerfile`](../Dockerfile): locked dependency builds and distinct non-root API,
  API, Owner-control, beta-admission, and bot runtime targets with no secret copied into them. Their shared Linux/amd64
  base image is pinned to a reviewed immutable digest for the London VM and must be reverified before
  a real deployment;
- [`compose.inactive.yaml`](compose.inactive.yaml): an API-only, explicitly `inactive` Compose
  profile on an internal Docker network, with neither an image-exposed nor published host port;
- [`.dockerignore`](../.dockerignore): excludes local configuration, Git metadata, credentials,
  runtime data, and generated output from the image context; and
- [`operations/payreplayy-staging-deploy-helper.sh`](operations/payreplayy-staging-deploy-helper.sh):
  the reviewed root-owned command boundary for the manual staging workflow. The SSH identity may
  sudo only this checksummed helper, never `bash`, Docker directly, or the Docker socket.

The later, still-manual beta-only staging artifact is documented separately in
[`staging-beta.md`](staging-beta.md). Its four services remain behind the `staging-manual` profile and
do not change the inactive Stage 14A contract described here.

The API container is deliberately read-only, has all Linux capabilities dropped, and uses a small
temporary filesystem. Its default inactive image uses `/healthz`; the staging Player-ID profile
overrides the healthcheck to `/readyz`, which passes only after the narrow database preflight.

[`operations/inactive-vm-runbook.md`](operations/inactive-vm-runbook.md) records the required
inactive-state evidence, backup acceptance criteria, incident-stop boundary, and the go/no-go
checklist for any later private staging proposal.

## Validation only

When Docker is available, these commands validate the artifact; they do not provision a VM or
enable a customer-facing service:

```powershell
docker build --target api --build-arg VCS_REF=<reviewed-commit> `
  --tag payreplayy-api:inactive-<short-commit> .
docker compose -f infra/compose.inactive.yaml config
```

Do not run `docker compose up`, publish a port, attach a secret file, add nginx/Caddy, or set an
enable switch from this stage. The `inactive` profile is an additional guard against an accidental
default `up`.

## Future VM-only secret separation

Production secrets must be supplied by the VM outside this repository, using distinct root-owned
or service-owned files with restrictive permissions. The current Compose file intentionally does
not reference any of them.

| Future process | May receive                                                                                                      | Must never receive                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Beta admission | dedicated staging PostgreSQL direct IPv6 URL, verified public Supabase CA, bot transport HMAC copy, payload HMAC | Telegram token, generic API/provider credentials, Supabase service-role key         |
| Owner control  | dedicated staging PostgreSQL direct IPv6 URL, public Auth client key, verified public Supabase CA                | bot token, beta HMACs, generic API/provider credentials, Supabase service-role key  |
| API            | dedicated Player-ID PostgreSQL URL and action transport/payload/capability/semantic HMAC keys                    | Telegram bot token, KemerBet credentials, Supabase service-role key                 |
| Bot            | Telegram bot token plus separately scoped beta-admission and Player-ID transport HMAC copies                     | database URL, provider credentials, KemerBet credentials, Supabase service-role key |
| Maintenance    | a future narrowly scoped nonce-retention credential only; manual read-only preflight                             | bot token, API database credential, financial/provider credentials                  |
| Executor       | its separately reviewed browser profile and least-privilege platform credentials                                 | bot token, API database credential, Supabase service-role key                       |

No container may mount the Docker socket. Do not use a shared production `.env` file, browser
profile, Git secret, or chat transcript as a secret store.

## Deployment gates

Before even a private staging deployment, complete and review all of the following:

1. Configure and test Droplet backups (or an equivalent tested external backup plan), monitoring
   alerts, structured log rotation, and an incident stop procedure.
2. Create and test a non-root VM administrator and deployment user before restricting direct root
   SSH; preserve the managed Codex access path while changing SSH forwarding settings.
3. Keep the firewall SSH-only and no public Docker port until a reviewed HTTPS/domain/proxy stage.
4. Give the browser executor either strict Docker resource limits or a small swap plan before it is
   introduced.
5. Before the manual beta profile, complete the separately approved IPv6 maintenance runbook and
   prove the VM has a global IPv6 address plus default route. Application runtimes must use only the
   exact staging direct database endpoint; the IPv4 pooler remains administrator-workflow-only.
   Require all three disposable VM-side database preflights before any service starts. The generic
   API login/runtime remains absent and disabled. Pending Player-ID registration does not authorize
   validation, nonce-retention maintenance, a durable bot outbox, or finance.

Staging remains `FINANCIAL_ACTIONS_MODE=dry_run`; no financial transaction may be enabled merely
because a container can start.
