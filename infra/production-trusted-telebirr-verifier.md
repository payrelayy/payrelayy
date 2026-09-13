# Production trusted TeleBirr verifier

This runbook covers a disabled production staging and emergency-control boundary for the isolated
database-ingress verifier. Merely merging or applying the checked-in artifacts does not install a
host helper, create a GitHub secret or variable, stage an image, invoke activation, enable a
database login, start a container, change a feature switch, complete a payment, enqueue an
execution, or move money.

Production runtime activation is deliberately unavailable in this lifecycle. The workflow has no
activation, provisioning, renewal, finalization, or rollback mode; the root helper has no command
that can create or start a container; and the production Compose file fixes
`FINANCIAL_ACTIONS_MODE=dry_run` and both verifier process gates to `false`. A database migration
now defines one postgres-only activation transaction for the next host-orchestration phase. No
application role can execute it, it is not invoked by migration, and this workflow has no route to
supply its precomputed SCRAM verifier or call it. The runtime role therefore remains the migration-created
`NOLOGIN`, passwordless scaffold unless an independent administrator operation outside this
lifecycle has made the database unsafe.

This conservative boundary is required because checking financial switches and then starting a
poller are separate cross-system operations. The database foundation now defines one shared
database state machine or epoch, enforces it at the verifier loader, authority reader, completion
boundary, every relevant feature-switch write, and the private-live execution lease and final-action
fence, and provides an idempotent Owner emergency intent/revocation transaction. Immutable pilot
reservation/provider lineage dispatches the shared public executor API: CBE Birr retains its
existing pilot boundary and receives no TeleBirr epoch binding; each queued candidate must join its
own configured provider's exact live switch before priority ordering, so a disabled TeleBirr lane
cannot starve an independently live CBE lane. Each TeleBirr execution lease records an immutable
attempt-to-epoch binding, its complete lease window must fit inside that epoch, and the same epoch
must still be current with ten seconds remaining when final action is fenced. Owner aggregate status
uses the same any-configured-live-lane rule and never counts an unconfigured live switch. It seeds
only immutable epoch zero in `disabled` state. The later postgres-only writer can create exactly
one append-only activation receipt per already armed pilot, provisions a SCRAM verifier login only
until that pilot expires, and changes the epoch, pointer, and complete TeleBirr switch set in one
transaction. A forward-only adapter accepts only the exact precomputed 4096-iteration
`SCRAM-SHA-256` verifier; the clear random runtime password therefore stays outside Management API
SQL and PostgreSQL activity text. It leaves executor login and both withdrawal switches disabled.
An additional read before process start is not an atomic interlock and is not accepted here.

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
expired `prepared` attempt and cancel it into review, but cannot issue a new lease, epoch binding, or
action fence. Natural activation-epoch expiry has the same convergence path.

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
| `SUPABASE_ACCESS_TOKEN`                                                            | secret               | Protected Management API token for the VM-independent emergency route      |
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

There is no same-release renewal or host-start path. A bounded login found by `status` is unsafe and
causes status to fail. Use `emergency-disable` to force `NOLOGIN`, clear the password, terminate
sessions, and revoke any current epoch. Any future host activation or renewal must arrive in a
separate reviewed change that invokes the shared database interlock; disable/reactivate semantics
alone are not implemented by this lifecycle.

## Status and emergency disable

`status` is intentionally strict: the host helper requires the exact labeled verifier container to
be absent, while the serializable read-only database inspection requires the runtime role to be
`NOLOGIN`, its password cleared, and its active session count to be zero. It also reports the
executor and recognized financial-boundary state without changing either.

`emergency-disable` overrides this workflow's ordinary serialization by canceling an older run in
the same concurrency group. It then launches three DAG-independent protected jobs. They execute
even when either of the other jobs fails. Two retain the existing host/tunnel path, while the third
uses the Supabase Management API and therefore does not depend on the production VM, SSH key, host
key, database password, or VM network path:

- The host job needs only the SSH host/key/known-hosts inputs. It calls the installed
  sudoers-digest-pinned `emergency-stop` command directly with bounded SSH. That command takes no
  nonblocking operation lock, reads no current link or release metadata, uses no verifier/database
  secret, enumerates every container with the exact Compose project and service labels, attempts to
  force-remove all of them together under an internal timeout, and performs repeated exact-label
  absence checks. Ordinary status and staging still reject a broken multiple-container invariant.
- In parallel, the tunnel database job always attempts the `NOLOGIN` kill switch through the exact
  verify-full direct tunnel. It clears both verifier-role passwords and terminates all verifier
  sessions. It is retained as a defense-in-depth fallback.
- The independent database job submits the reviewed SQL file to
  `POST /v1/projects/{ref}/database/query` with the protected Supabase token. Its first transaction
  revokes both verifier credentials and sessions. A second transaction discovers the exact current
  epoch and, when it is active and unrevoked, calls the existing Owner emergency boundary to append
  intent, revoke authority, stop the pilot, and disable payment, execution, provider, and pilot
  switches. Committing credential revocation first means later financial-drift detection cannot
  roll the login kill switch back.

The new helper contains no service-creation primitive, and the production Compose gates are fixed
off. Thus an operation racing with emergency intent cannot use this lifecycle to recreate a healthy
verifier. Direct root Docker access is outside the delegated workflow/helper authority and remains
an administrator incident boundary.

The host and tunnel jobs deliberately do not rewrite global financial switches. The independent
database job invokes the separate Owner emergency boundary only for the exact current live epoch;
that boundary atomically records append-only intent, revokes the epoch, stops its pilot, and
disables all five provider/pilot/payment/execution switches. None of the emergency routes can
activate an epoch, enable a runtime login, start a verifier, or authorize a final action.

Never use direct Docker or PostgreSQL administration to bypass these controls, reuse a staging
credential/key, add a public route, mount the Docker socket, add executor material, or reintroduce a
start/provision command without the shared atomic database interlock.

## Remaining activation blockers

Before a future production activation can even be proposed, all of these remain required:

The disabled release, device pairing, epoch/execution foundation, postgres-only activation writer,
bounded-login transaction, and VM-independent emergency SQL now exist. Before production runtime
activation can be proposed, these still remain:

1. Merge this change only after the disposable SQL, Linux quality, and verifier image-smoke checks
   pass on the exact commit.
2. Apply the activation migrations to production while epoch zero, all financial switches, verifier
   login, executor login, and verifier/executor sessions remain inert; then run both advisors and a
   read-only catalog/state audit.
3. Add and adversarially test the root-helper and workflow activation/start/automatic-rollback
   route. It must generate and stage the one-use clear credential locally, send only its SCRAM
   verifier to the atomic database call, start only the exact sealed release, and invoke independent
   emergency disable on any ambiguous or unhealthy result.
4. Prepare and companion-verify a fresh exact-five, exact-receiver, two-hour pilot for that action;
   expired or previously stopped pilots cannot be reused.
5. Keep the deposit executor and every KemerBet final-action gate disabled throughout verification.
6. Obtain another separate financial confirmation before invoking the live feature-switch
   transaction, and a later distinct confirmation before enabling execution or attempting any
   actual deposit. Code readiness, migration deployment, and verifier staging are not authority to
   execute or move money.

Local/static verification is non-mutating:

```powershell
pnpm --filter "@fetanagent/trusted-telebirr-verifier..." run build
pnpm --filter @fetanagent/trusted-telebirr-verifier run test
node infra/verify-trusted-telebirr-verifier-deployment.mjs
```
