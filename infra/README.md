# Infrastructure contract

## Current state

The London VM is intentionally not a PayReplayy runtime server yet. It exposes only SSH and has no
running PayReplayy service or public HTTP(S) listener. It may hold a sealed source release and a
locally built inactive API image solely for build validation. Stage 14A does not run a container,
load a credential, or enable Telegram, database access, KemerBet, or financial behavior.

The repository provides:

- [`../Dockerfile`](../Dockerfile): locked dependency builds and distinct non-root API,
  beta-admission, and bot runtime targets with no secret copied into them. Their shared Linux/amd64
  base image is pinned to a reviewed immutable digest for the London VM and must be reverified before
  a real deployment;
- [`compose.inactive.yaml`](compose.inactive.yaml): an API-only, explicitly `inactive` Compose
  profile on an internal Docker network, with neither an image-exposed nor published host port; and
- [`.dockerignore`](../.dockerignore): excludes local configuration, Git metadata, credentials,
  runtime data, and generated output from the image context.

The later, still-manual beta-only staging artifact is documented separately in
[`staging-beta.md`](staging-beta.md). Its two services remain behind the `staging-manual` profile and
do not change the inactive Stage 14A contract described here.

The API container is deliberately read-only, has all Linux capabilities dropped, uses a small
temporary filesystem, and uses `/healthz` only. `/readyz` remains a deliberate `503` until database
readiness is separately implemented.

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

| Future process | May receive                                                                                                         | Must never receive                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Beta admission | dedicated staging PostgreSQL session-pooler URL, verified public Supabase CA, bot transport HMAC copy, payload HMAC | Telegram token, generic API/provider credentials, Supabase service-role key         |
| API            | dedicated non-admin PostgreSQL URL, API ingress/payload/capability HMAC keys                                        | Telegram bot token, KemerBet credentials, Supabase service-role key                 |
| Bot            | Telegram bot token and exactly one reviewed transport HMAC for its mutually exclusive mode                          | database URL, provider credentials, KemerBet credentials, Supabase service-role key |
| Maintenance    | a future narrowly scoped nonce-retention credential only; manual read-only preflight                                | bot token, API database credential, financial/provider credentials                  |
| Executor       | its separately reviewed browser profile and least-privilege platform credentials                                    | bot token, API database credential, Supabase service-role key                       |

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
5. For the manual beta profile, provision the dedicated beta-admission staging login outside Git
   through the exact staging IPv4 session pooler, mount the verified staging Supabase CA, and pass
   the beta service's read-only `db:preflight` before container creation. The generic API login and
   API runtime stay absent/disabled. Any later API deployment, nonce-retention maintenance, or
   durable bot outbox requires a separate review.

Staging remains `FINANCIAL_ACTIONS_MODE=dry_run`; no financial transaction may be enabled merely
because a container can start.
