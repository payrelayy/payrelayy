# Production trusted TeleBirr verifier

This runbook covers a disabled production staging and emergency-control boundary for the isolated
database-ingress verifier. The checked-in artifacts do not install a host helper, create a GitHub
secret or variable, stage an image, enable a database login, start a container, change a feature
switch, complete a payment, enqueue an execution, or move money.

Production activation is deliberately unavailable. The workflow has no activation, provisioning,
renewal, finalization, or rollback mode; the root helper has no command that can create or start a
container; the former production login-provisioning SQL is absent; and the production Compose file
fixes `FINANCIAL_ACTIONS_MODE=dry_run` and both verifier process gates to `false`. The runtime role
therefore remains the migration-created `NOLOGIN`, passwordless scaffold unless an independent
administrator operation outside this lifecycle has made the database unsafe.

This conservative boundary is required because checking financial switches and then starting a
poller are separate cross-system operations. The database foundation now defines one shared
database state machine or epoch, enforces it at the verifier loader, authority reader, completion
boundary, every relevant feature-switch write, and the private-live execution lease and final-action
fence, and provides an idempotent Owner emergency intent/revocation transaction. Immutable pilot
reservation/provider lineage dispatches the shared public executor API: CBE Birr retains its
existing pilot boundary and receives no TeleBirr epoch binding; each TeleBirr execution lease records
an immutable attempt-to-epoch binding, its complete lease window must fit inside that epoch, and the
same epoch must still be current with ten seconds remaining when final action is fenced. It seeds
only immutable epoch zero in `disabled` state and provides no live-activation writer. An additional
read before process start is not an atomic interlock and is not accepted here.

Any later activation proposal must insert one bounded epoch tied to the exact armed pilot, advance
the singleton pointer, and change the complete TeleBirr switch set in the same database
transaction. The deferred complete-set constraint rejects a transaction that leaves TeleBirr live
with a partial or mismatched switch set. Mutating control paths lock activation control, epoch, the
readiness serialization gate, feature switches, then pilot; read/completion paths that do not use
the readiness gate preserve the same control, epoch, switches, pilot subsequence. Execution paths
then acquire the job, intent, attempt, agent, and immutable binding rows. Owner arm/stop enters
activation authority before the existing readiness/switch/pilot sequence, and host orchestration
must never be treated as authority. Expiry, revocation, epoch advance, pilot drift, switch drift, or
the mere presence of emergency intent makes work loading empty and rejects verifier authority,
verification completion, and final-action fencing for leases obtained earlier. Cancellation and
reconciliation deliberately remain usable after disable so uncertainty can only tighten. The
executor lease entrypoint also retains one recovery-only path after stop/expiry: it may adopt an
expired `prepared` attempt and cancel it into review, but cannot issue a new lease or action fence.

The production verifier remains separate from `compose.production.yaml`. Its staged service has no
host port, contains no KemerBet/executor/final-action authority, uses the exact production direct
database host with `sslmode=verify-full`, and carries only public signer/device pins. Even a direct
attempt to start the checked-in production Compose service fails closed because its required
process gates are fixed off.

## Required reviewed inputs

Configure these only in the protected `production` GitHub environment after the device has been
physically enrolled and its public key has been independently checked:

| Name                                                                               | Kind                 | Contract                                                                   |
| ---------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------- |
| `TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_V1_BASE64`                                 | variable             | Base64 of the exact canonical JSON pin manifest; public keys only          |
| `SUPABASE_DB_PASSWORD`                                                             | secret               | Existing production administrator credential, used only for status/disable |
| `SUPABASE_CA_CERTIFICATE_PEM`                                                      | secret               | Existing reviewed Supabase CA                                              |
| `PRODUCTION_VM_HOST`, `PRODUCTION_VM_KNOWN_HOSTS`, `PRODUCTION_VM_SSH_PRIVATE_KEY` | protected connection | Existing production host boundary                                          |

The canonical pin manifest contains exactly `contractVersion`, `assignmentSigners`, and `devices`,
in that order. Each pin contains exactly `keyId` and `publicKeySpkiDerBase64`, in that order. Every
key must be a distinct canonical P-256 SPKI. Record the manifest as `sha256:<64 lowercase hex>` and
independently compare that digest before staging. Do not put a private key in this manifest.

The stage job generates a random, unprovisioned placeholder password only to preserve the
application's exact production URL shape inside the stopped artifact. The workflow never reads a
verifier runtime password secret and never installs that placeholder into PostgreSQL.

The host administrator must separately review and install
`fetanagent-production-trusted-telebirr-verifier-helper.sh` at the exact path embedded in the
script, owned by root and not writable by another user. Install its matching command-scoped
`.sudoers` entry only after `visudo -cf` succeeds. The sudoers digest and the staging workflow's
runtime digest check both pin the installed helper. This bootstrap is intentionally not automated.

## Workflow modes and confirmations

Run `Production trusted TeleBirr verifier` only from the exact reviewed commit on `main`, with the
exact production project reference and droplet ID. The workflow is manual-only.

| Mode                | Exact confirmation phrase               | Effect                                                                           |
| ------------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| `plan`              | `PLAN PRODUCTION VERIFIER`              | Static verification and an ingress-free image build; no protected inputs         |
| `stage-disabled`    | `STAGE DISABLED PRODUCTION VERIFIER`    | Stages an immutable stopped release with a deliberately unprovisioned credential |
| `status`            | `STATUS PRODUCTION VERIFIER`            | Requires no labeled container, a `NOLOGIN` verifier, and zero verifier sessions  |
| `emergency-disable` | `EMERGENCY DISABLE PRODUCTION VERIFIER` | Independently removes labeled containers and revokes login/password/sessions     |

There is intentionally no activation confirmation phrase. For `stage-disabled`, also supply the
independently reviewed pin-manifest digest. For every other mode the digest input must be
`not-applicable` so an inspection or emergency action cannot be confused with an install.

## Immutable disabled release

The stage job builds from the exact workflow commit, transfers a one-use image archive, records its
Docker content ID (`sha256:...`), and checks the full revision label, non-root user, canonical
production direct URL, CA, Compose digest, and independently confirmed pin-manifest digest. The
Compose file accepts only the recorded image ID and uses `pull_policy: never`.

Staging takes the shared production and verifier locks, refuses any exact project/service-labeled
container, and never invokes `docker compose up`, `docker container start`, or a database mutation.
All remote SSH/SCP commands are bounded. Its exit handler makes a bounded remote cleanup attempt;
the next staging attempt first removes the same exact safe incoming path before recreating it. A
runner cancellation or command timeout therefore cannot leave a login or process enabled, and any
inert incoming residue is neither ignored nor reusable as a release.

There is no same-release renewal path. A bounded login found by `status` is unsafe and causes status
to fail. Use `emergency-disable` to force `NOLOGIN`, clear the password, and terminate sessions. Any
future activation or renewal must arrive in a separate reviewed change with the shared database
interlock described above; disable/reactivate semantics alone are not implemented by this PR.

## Status and emergency disable

`status` is intentionally strict: the host helper requires the exact labeled verifier container to
be absent, while the serializable read-only database inspection requires the runtime role to be
`NOLOGIN`, its password cleared, and its active session count to be zero. It also reports the
executor and recognized financial-boundary state without changing either.

`emergency-disable` overrides this workflow's ordinary serialization by canceling an older run in
the same concurrency group. It then launches two DAG-independent protected jobs. They execute even
when the other job fails, but the current database route still tunnels through the production VM,
so both jobs share a VM/SSH failure domain until the database kill switch has a separately reachable
administrative route:

- The host job needs only the SSH host/key/known-hosts inputs. It calls the installed
  sudoers-digest-pinned `emergency-stop` command directly with bounded SSH. That command takes no
  nonblocking operation lock, reads no current link or release metadata, uses no verifier/database
  secret, enumerates every container with the exact Compose project and service labels, attempts to
  force-remove all of them together under an internal timeout, and performs repeated exact-label
  absence checks. Ordinary status and staging still reject a broken multiple-container invariant.
- In parallel, the database job always attempts the `NOLOGIN` kill switch through the exact
  verify-full direct tunnel. It clears both verifier-role passwords and terminates all verifier
  sessions. A failure result from one job cannot skip the other job, but loss of the shared VM/SSH
  route can prevent both operations and must be treated as an administrator incident.

The new helper contains no service-creation primitive, and the production Compose gates are fixed
off. Thus an operation racing with emergency intent cannot use this lifecycle to recreate a healthy
verifier. Direct root Docker access is outside the delegated workflow/helper authority and remains
an administrator incident boundary.

The host `emergency-disable` workflow deliberately does not rewrite global financial switches. The
database Owner emergency boundary is separate: once a future live epoch exists, it atomically
records append-only intent, revokes that exact expected epoch, stops its pilot, and disables all
five provider/pilot/payment/execution switches. Neither route can activate an epoch, enable a
runtime login, start a verifier, or authorize a final action.

Never use direct Docker or PostgreSQL administration to bypass these controls, reuse a staging
credential/key, add a public route, mount the Docker socket, add executor material, or reintroduce a
start/provision command without the shared atomic database interlock.

## Remaining activation blockers

Before a future production activation can even be proposed, all of these remain required:

1. Merge this disabled lifecycle and run its Linux quality/image-smoke checks on exact `main`.
2. Install and attest the exact stage/status/emergency-only helper and command-scoped sudoers digest.
3. Complete Android device pairing and independently review the public-key pin manifest.
4. Stage the exact disabled release and prove the container, login, password, and sessions absent.
5. Review and apply the disabled-only database epoch foundation, including its switch interlock,
   verifier lease-to-authority and authority-to-completion tests, execution lease-to-epoch and
   epoch-to-fence tests, immutable binding ACL/RLS checks, and independent emergency route.
6. Add any live-epoch creation and bounded-login provisioning only in a later separately confirmed
   change; the foundation intentionally contains neither.
7. Keep the deposit executor and every KemerBet final-action gate disabled throughout verification.
8. Obtain another separate financial confirmation before any live feature-switch operation or
   actual deposit. Verifier staging is not authorization to execute or move money.
9. Provide and test a database emergency-revocation route that does not depend on the production VM,
   its SSH key, its host key, or its network path.

Local/static verification is non-mutating:

```powershell
pnpm --filter "@fetanagent/trusted-telebirr-verifier..." run build
pnpm --filter @fetanagent/trusted-telebirr-verifier run test
node infra/verify-trusted-telebirr-verifier-deployment.mjs
```
