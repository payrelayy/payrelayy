# Staging TeleBirr shadow-verifier lifecycle

This runbook covers one isolated, database-ingress, no-money verifier in STAGING. The checked-in
artifacts do not deploy it, enable its PostgreSQL login, apply a migration, create staged evidence,
change a feature switch, call TeleBirr or KemerBet, settle a deposit, enqueue an executor job, or
move money. The workflow is manual-only and runs only from an exactly confirmed `main` commit.

The service processes only the shadow tables and functions already defined by the merged database
contract. It records advisory `would_verify`, `would_review`, or `would_reject` outcomes. Its
completion contract rejects any row with a deposit intent, payment claim, execution job, or
settlement. This lifecycle does not enable live verification and cannot provision the live verifier
role.

## Fixed boundary

- `FINANCIAL_ACTIONS_MODE=dry_run` is fixed in Compose.
- `TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED=false` and
  `KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false` are fixed in Compose.
- Only the two shadow-process gates are true. They cannot authorize the separate live verifier.
- The service publishes no port. Its loopback-only health listener is reachable only inside the
  container.
- The image has no exposed port, runs as `10001:10001`, is read-only, drops every capability, uses
  `no-new-privileges`, and mounts no Docker socket.
- The only network is a non-attachable project bridge with IPv6 egress to the exact staging direct
  database hostname. No ingress network or reverse-proxy route is present.
- The runtime identity is the migration-created
  `fetanagent_telebirr_shadow_verifier_runtime`: `NOINHERIT`, one connection, one exact inherited
  function-only group membership, no `SET`/admin option, and a random password valid for at most 24
  hours. The password is generated on the ephemeral workflow runner and is never a repository or
  GitHub secret.
- Every shadow database operation independently rechecks the role shape, expiry, and seven-row
  no-money feature boundary. Expiry or a switch transition therefore stops work fail closed.

The workflow refuses rolling replacement. Stop the active release before deploying another commit.
Every commit can be installed only once, preventing a release directory from silently retaining a
rotated credential.

## One-time host bootstrap

The host helper and sudoers policy must be installed separately from the authenticated DigitalOcean
root console. GitHub Actions cannot install or widen its own root capability.

1. Use only a merged `main` commit whose Quality workflow passed.
2. Copy `infra/operations/fetanagent-telebirr-shadow-verifier-helper.sh` to
   `/usr/local/sbin/fetanagent-telebirr-shadow-verifier-helper` as `root:root` mode `0755`.
3. Verify its SHA-256 against the reviewed commit.
4. Validate
   `infra/operations/fetanagent-telebirr-shadow-verifier-helper.sudoers` with `visudo -cf`, then
   install it under `/etc/sudoers.d` as `root:root` mode `0440`.
5. Run the helper's checksum-bound `verify` command as `fetanagent-admin`. Do not grant general
   Docker, shell, PostgreSQL, or filesystem sudo authority.

The helper accepts only `verify`, `preflight`, `prepare-incoming`, `discard`, `install`, `start`,
`status`, and `stop`. It has no SQL, migration, feature-switch, provider, executor, settlement, or
money-action primitive.

## Protected staging inputs

The existing `staging` GitHub environment supplies:

| Name                                              | Kind     | Purpose                                                                                   |
| ------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `SUPABASE_DB_PASSWORD`                            | secret   | Short administrator session used only by the checked-in role provision/status/disable SQL |
| `SUPABASE_CA_CERTIFICATE_PEM`                     | secret   | Reviewed CA for verify-full PostgreSQL TLS                                                |
| `STAGING_VM_HOST`                                 | secret   | Exact staging VM SSH hostname                                                             |
| `STAGING_VM_KNOWN_HOSTS`                          | secret   | Pinned SSH host key entry                                                                 |
| `STAGING_VM_SSH_PRIVATE_KEY`                      | secret   | Existing restricted deployment identity                                                   |
| `TELEBIRR_SHADOW_VERIFIER_PIN_MANIFEST_V1_BASE64` | variable | Canonical public-only assignment-signer/device pin manifest                               |

The pin manifest contains no private key. Before deployment, independently record its digest as
`sha256:<64 lowercase hex>` and compare it with the workflow input.

The merged shadow migration must already exist in staging. This lifecycle does not apply a
migration or repair missing roles, memberships, functions, tables, pilots, or feature switches.
Provisioning fails unless exactly one armed, unexpired dry-run pilot exists and all six financial
feature switches are disabled with empty settings.

## Manual modes

Run `Staging TeleBirr no-money shadow verifier` with the exact staging project ref, current main
workflow commit, and staging Droplet ID. Supply the release SHA as documented below.

| Mode     | Exact confirmation                        | Release input        | Effect                                                                                                                                        |
| -------- | ----------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan`   | `PLAN STAGING SHADOW VERIFIER`            | `not-applicable`     | Static verification plus ingress-free image build; no protected environment                                                                   |
| `deploy` | `DEPLOY STAGING SHADOW VERIFIER NO MONEY` | Current workflow SHA | Generates a one-run password, installs a 24-hour login, proves direct connectivity, installs and starts the immutable image ID                |
| `status` | `STATUS STAGING SHADOW VERIFIER`          | Exact deployed SHA   | Requires one exact healthy container, bounded login, exactly one runtime session, dry-run feature boundary, and disabled executor             |
| `stop`   | `STOP STAGING SHADOW VERIFIER`            | Exact deployed SHA   | Removes every exactly labeled service container, sets both shadow roles `NOLOGIN`/passwordless, terminates sessions, and verifies zero remain |

For `deploy`, provide the independently reviewed pin-manifest digest. For every other mode, provide
`not-applicable` as the digest input.

## Deployment and evidence

`deploy` builds from the exact workflow commit without protected inputs, records the full OCI
revision label, saves a one-use image archive, and transfers it only after the installed helper
passes its digest, Droplet identity, direct IPv6 database route, empty container inventory, and
inactive-receipt checks. The helper records the loaded Docker content ID (`sha256:...`); Compose uses
that ID with `pull_policy: never`.

The workflow then grants only the existing shadow runtime a random 64-hex password and a 24-hour
`VALID UNTIL`. It changes no feature switch. A direct verify-full runtime login through the VM must
pass before release transfer. Startup succeeds only when the application catalog preflight and
loopback readiness probe pass. Host status rechecks the image ID/commit, receipt, container count,
user, command, read-only filesystem, capabilities, port bindings, network, health, restart count,
and every safety environment value. Database status independently reports only bounded state and
counts.

Do not treat a successful deployment as permission to stage evidence or run a shadow observation.
That requires its own Owner approval and the existing authenticated intake path.

## Stop and failure recovery

`stop` launches two DAG-independent jobs after the same target validation. Host removal targets
only the exact Compose project/service labels, uses bounded SSH, and repeats its absence scan.
Database disablement has no SSH or VM dependency and uses the staging session pooler. It commits
`NOLOGIN` and password removal before terminating pooled sessions, then proves both roles are
unprivileged/passwordless and no session remains. It does not rewrite financial switches.

If deployment fails after login provisioning, two separate `always()` cleanup jobs attempt
exact-label host removal and database disablement; the database cleanup cannot be skipped by a hung
or unreachable host. A remaining installed release is inert once the login is disabled and cannot
be reused for another deployment. If either cleanup side cannot be
proved, treat it as an operator incident: run `stop` again, use the DigitalOcean root console for
the exact helper if SSH is unavailable, and use the existing staging database emergency route to
run only `infra/sql/staging-telebirr-shadow-verifier-disable.sql`. Never start the container directly,
extend the login beyond 24 hours, use a pooler URL in the runtime file, expose a port, enable either
live gate, or bypass the checksum-bound helper.

Local verification is non-mutating:

```powershell
pnpm --filter "@fetanagent/trusted-telebirr-verifier..." run build
pnpm --filter @fetanagent/trusted-telebirr-verifier run test
node infra/verify-telebirr-shadow-verifier-deployment.mjs
node infra/verify-telebirr-shadow-verifier-staging-lifecycle.mjs
```
