# Production trusted TeleBirr verifier

This runbook covers disabled staging, one manually confirmed verification-only activation, status,
and emergency control for the isolated database-ingress verifier. Merely merging or applying the
checked-in artifacts does not install a host helper, create a GitHub secret or variable, stage an
image, invoke activation, enable a database login, start a container, change a feature switch,
complete a payment, enqueue an execution, or move money.

Production runtime activation is available only through `activate-verification`. That manual mode
requires the exact reviewed `main` commit, production project and droplet, pin-manifest digest,
active Owner UUID, fresh companion-verified pilot UUID, new UUIDv4 idempotency key, and the exact
action-time phrase. The workflow creates a one-use random password locally, sends only the derived
4096-iteration SCRAM verifier to the postgres-only atomic database function, then asks the
digest-pinned root helper to start the exact staged release. Any failed, unhealthy, or ambiguous
result invokes both the independent database emergency transaction and the host emergency stop.
There is no renewal route, no executor start, and no final-action route.

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

The activation transaction inserts one bounded epoch tied to the exact armed pilot, advances
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

The production verifier remains separate from `compose.production.yaml`. Its service has no
host port, contains no KemerBet/executor/final-action authority, uses the exact production direct
database host with `sslmode=verify-full`, and carries only public signer/device pins. Even a direct
attempt to render or start the checked-in production Compose service outside the root helper fails
closed because all three process gates are required substitutions with no defaults. The helper
supplies fixed `live`/`true`/`true` values only in its guarded `start-activated` command.

## Required reviewed inputs

Configure these only in the protected `production` GitHub environment after the device has been
physically enrolled and its public key has been independently checked:

| Name                                                                               | Kind                 | Contract                                                                   |
| ---------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------- |
| `TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_V1_BASE64`                                 | variable             | Base64 of the exact canonical JSON pin manifest; public keys only          |
| `SUPABASE_DB_PASSWORD`                                                             | secret               | Existing production administrator credential, used only for status/disable |
| `SUPABASE_ACCESS_TOKEN`                                                            | secret               | Protected Management API token for activation and independent emergency    |
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

| Mode                    | Exact confirmation phrase                   | Effect                                                                                        |
| ----------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `plan`                  | `PLAN PRODUCTION VERIFIER`                  | Static verification and an ingress-free image build; no protected inputs                      |
| `stage-disabled`        | `STAGE DISABLED PRODUCTION VERIFIER`        | Stages an immutable stopped release with a deliberately unprovisioned placeholder             |
| `activate-verification` | `ACTIVATE PRODUCTION TELEBIRR VERIFICATION` | Atomically enables one fresh bounded verification pilot and starts only its sealed verifier   |
| `status`                | `STATUS PRODUCTION VERIFIER`                | Requires no labeled container, runtime credential, login, or verifier session                 |
| `emergency-disable`     | `EMERGENCY DISABLE PRODUCTION VERIFIER`     | Independently fences/stops the host and revokes login, password, sessions, and live authority |

For `stage-disabled` and `activate-verification`, supply the independently reviewed pin-manifest
digest. Activation additionally requires the three UUID inputs described above. For other modes,
the digest and all activation UUID inputs must be `not-applicable`, preventing an inspection or
emergency action from being confused with activation.

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

There is no same-release renewal. A bounded login found by the ordinary `status` mode is unsafe and
causes status to fail; the activation job uses the helper's exact `status-active` proof instead.
Use `emergency-disable` to force `NOLOGIN`, clear the password, terminate sessions, revoke the
current epoch, stop its pilot, disable its switches, remove every exact labeled container, and
remove the host credential. Reactivation requires a newly staged reviewed commit, fresh pilot, new
credential and request key, and another explicit confirmation.

## Guarded activation and automatic rollback

The activation job first requires the installed helper digest, exact immutable release and pin
digest, an empty host runtime boundary, and no labeled container. It copies one root-claimed
credential file to a request-keyed `0400` runtime directory, while the clear password remains
absent from command lines, logs, GitHub outputs, SQL text, and database receipts. Only the SCRAM
verifier appears in the protected Management API request.

The database transaction validates the one exact active Owner, fresh armed twelve-hour pilot,
companion assignment, receiver lineage, complete readiness cohort, role graph, current authority,
and switch state. It then creates the append-only receipt, bounded runtime login, epoch, pointer,
and complete verification switch set atomically. The executor roles and processes and both
withdrawal switches remain disabled.

Only after that commit does `start-activated` render Compose with its three fixed helper-only gates.
It checks the exact image ID and revision, secret/config metadata, label inventory, one-container
invariant, loopback readiness, and Docker health under bounded timeouts. A root-owned record binds
the container to the exact commit, request, epoch, and pilot. A final independent database query
requires exactly one verifier session, no unexpected verifier or executor session, the same current
authority, and the exact verification-only switch set.

The workflow arms its rollback handler before activation. Any later nonzero exit, signal, HTTP
ambiguity, malformed response, SSH failure, container failure, unhealthy readiness, or final-state
drift submits the VM-independent emergency SQL and calls the host emergency stop. The helper also
rolls back a failed local start. Emergency stop persists a fence before repeated label scans, so a
concurrent guarded start detects the fence before or after container creation and removes itself.
Credential and active-record cleanup follows container removal. If either independent rollback path
cannot be proven, the job fails loudly and requires immediate operator follow-up.

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

The helper's only service-creation primitive is `start-activated`, which requires an exact prepared
credential, release, pin digest, request, epoch and pilot under both production locks. Emergency
stop does not wait for those locks: it first persists the fence and repeatedly removes every exact
labeled container. The start path checks that fence before and after service creation, so an
operation racing with emergency intent cannot remain healthy. Direct root Docker access is outside
the delegated workflow/helper authority and remains an administrator incident boundary.

The host and tunnel jobs deliberately do not rewrite global financial switches. The independent
database job invokes the separate Owner emergency boundary only for the exact current live epoch;
that boundary atomically records append-only intent, revokes the epoch, stops its pilot, and
disables all five provider/pilot/payment/execution switches. None of the emergency routes can
activate an epoch, enable a runtime login, start a verifier, or authorize a final action.

Never use direct Docker or PostgreSQL administration to bypass these controls, reuse a staging
credential/key, add a public route, mount the Docker socket, add executor material, or reintroduce a
start/provision command without the shared atomic database interlock.

## Preconditions before invoking activation

The device pairing, epoch/execution foundation, production activation migrations, postgres-only
activation writer, bounded-login transaction, guarded host start, automatic rollback, and
VM-independent emergency SQL exist. Code readiness still is not authority to activate. Before an
operator selects `activate-verification`, all of these are required:

1. Merge this change only after the disposable SQL, Linux quality, static verifier, and verifier
   image-smoke checks pass on the exact commit.
2. Separately review and install that commit's root helper and matching digest-pinned sudoers file,
   then stage the exact stopped release with the independently reviewed pin-manifest digest.
3. Reconfirm production remains at an inert authority/login/session boundary before preparing the
   pilot.
4. Prepare and companion-verify a fresh exact-five, exact-receiver, twelve-hour pilot for that action;
   expired or previously stopped pilots cannot be reused.
5. Keep the deposit executor process and roles, both withdrawals, and every KemerBet final-action
   gate disabled throughout verification.
6. Obtain another separate financial confirmation immediately before invoking the live
   verification transaction, and a later distinct confirmation before enabling execution or
   attempting any actual deposit. Merging, migration deployment, helper installation, verifier
   staging, and pilot preparation do not authorize either action.

Local/static verification is non-mutating:

```powershell
pnpm --filter "@fetanagent/trusted-telebirr-verifier..." run build
pnpm --filter @fetanagent/trusted-telebirr-verifier run test
node infra/verify-trusted-telebirr-verifier-deployment.mjs
```
