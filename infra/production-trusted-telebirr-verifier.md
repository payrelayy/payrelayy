# Production trusted TeleBirr verifier

This runbook covers the isolated database-ingress verifier only. The checked-in artifacts are
dormant: they do not install a host helper, create a GitHub secret or variable, stage an image,
enable a database login, start a container, change a feature switch, complete a payment, enqueue an
execution, or move money.

The production verifier is deliberately separate from `compose.production.yaml`. Ordinary
production application deploys and `docker compose up` therefore cannot select it. Its one service
has no host port, accepts work only through four allowlisted PostgreSQL functions, uses the exact
production direct database host with `sslmode=verify-full`, and owns no KemerBet, executor, final
action, Telegram, provider-PIN, OTP, or private-signing-key authority.

## Required reviewed inputs

Configure these only in the protected `production` GitHub environment after the device has been
physically enrolled and its public key has been independently checked:

| Name                                                                               | Kind                 | Contract                                                                       |
| ---------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------ |
| `TRUSTED_TELEBIRR_VERIFIER_RUNTIME_PASSWORD`                                       | secret               | Unique 32 random bytes encoded as 64 lowercase hex characters                  |
| `TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_V1_BASE64`                                 | variable             | Base64 of the exact canonical JSON pin manifest; public keys only              |
| `SUPABASE_DB_PASSWORD`                                                             | secret               | Existing production administrator credential used only by the ephemeral runner |
| `SUPABASE_CA_CERTIFICATE_PEM`                                                      | secret               | Existing reviewed Supabase CA                                                  |
| `PRODUCTION_VM_HOST`, `PRODUCTION_VM_KNOWN_HOSTS`, `PRODUCTION_VM_SSH_PRIVATE_KEY` | protected connection | Existing production host boundary                                              |

The canonical pin manifest contains exactly `contractVersion`, `assignmentSigners`, and `devices`,
in that order. Each pin contains exactly `keyId` and `publicKeySpkiDerBase64`, in that order. Every
key must be a distinct canonical P-256 SPKI. Record the manifest as `sha256:<64 lowercase hex>` and
independently compare that digest before staging. Do not put a private key in this manifest.

The host administrator must separately review and install
`fetanagent-production-trusted-telebirr-verifier-helper.sh` at the exact path embedded in the
script, owned by root and not writable by any other user. Install the matching `.sudoers` entry
only after `visudo -cf` succeeds. The sudoers command digest and the workflow's runtime digest check
both pin the installed helper. This bootstrap is intentionally not automated by the workflow.

## Workflow modes and confirmations

Run `Production trusted TeleBirr verifier` only from the exact reviewed commit on `main`, with the
exact production project reference and droplet ID. The workflow is manual-only and serialized with
every other verifier operation.

| Mode                | Exact confirmation phrase                   | Effect                                                                                  |
| ------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `plan`              | `PLAN PRODUCTION VERIFIER`                  | Static verification and an ingress-free image build; no protected inputs                |
| `stage-disabled`    | `STAGE DISABLED PRODUCTION VERIFIER`        | Installs an immutable stopped release; database login and switches are unchanged        |
| `activate-verifier` | `ACTIVATE PRODUCTION PAYMENT VERIFIER ONLY` | Gives only the verifier role a 24-hour login, starts one verifier, and proves readiness |
| `status`            | `STATUS PRODUCTION VERIFIER`                | Reads the exact host and database status without changing either                        |
| `emergency-disable` | `EMERGENCY DISABLE PRODUCTION VERIFIER`     | Stops the verifier, revokes its password/login, and terminates its sessions             |

For `stage-disabled`, also supply the independently reviewed pin-manifest digest. For every other
mode the digest input must be `not-applicable`; this prevents a status or emergency operation from
being confused with a release install.

`activate-verifier` is an action-time activation boundary. Use it only after the Owner separately
confirms that exact operation. It never changes a database feature switch. Provisioning succeeds
only when the deposit executor login is disabled and the database is in one of three explicitly
recognized states: all financial switches disabled, the exact armed no-money dry run, or the exact
live verification pilot with withdrawals/CBE disabled and the executor still disabled. Any other
combination fails closed.

Starting the process sets only its three process-local gates. While the database switches remain
disabled or dry-run, the staged-evidence reader returns an empty queue. Payment verification can
begin only after a separate, action-time-confirmed Owner operation makes the exact four pilot
switches live. This workflow has no route that performs that operation.

## Immutable release and runtime boundary

The stage job builds from the exact workflow commit, transfers a one-use image archive, and records
the Docker content ID (`sha256:...`) after load. Every start rechecks that ID, the full revision
label, the non-root image user, the canonical production direct URL, the CA, and the independently
confirmed pin-manifest digest. Compose receives the recorded image ID rather than a mutable tag and
uses `pull_policy: never`.

The root helper also proves there is at most one service container, takes the shared production
host lock plus a verifier-specific lock, and checks the running container's exact revision, image,
user, read-only root filesystem, dropped capabilities, security options, restart policy, health,
single network, and zero published ports. Application readiness independently re-proves the
lifetime PostgreSQL singleton and the exact four-function catalog surface.

The runtime role has connection limit one and expires in 24 hours. Startup/readiness and every
database operation reject a role with five minutes or less remaining. Renewal is the same
separately confirmed `activate-verifier` operation; there is no continuous or infinite verifier
credential.

## Rollback and emergency disable

Activation writes a root-only predecessor receipt before replacing a running verifier. A failed
start automatically stops the candidate and restores the exact predecessor when one exists. The
workflow repeats that rollback idempotently if a later activation step fails. The receipt is
deleted only after the exact release passes status.

Emergency disable is fail-safe in two independent layers: the workflow attempts to stop the
container first, then changes only the verifier group/runtime roles to `NOLOGIN`, clears their
passwords, resets validity, and terminates every remaining verifier session. The workflow reports
failure if the host stop failed, even after the database kill switch succeeded. It deliberately
does not rewrite global financial switches; the unavailable verifier login and terminated session
are sufficient to stop this consumer, while the Owner's separate stop remains available for the
pilot itself.

Never use `docker compose` directly to bypass the helper, reuse a staging credential/key, extend
the role beyond 24 hours, add a public route, mount the Docker socket, or add executor material to
this release.

## Remaining activation gates

Before the first activation, all of these remain required:

1. Merge the reviewed production lifecycle and run all quality/image-smoke checks on `main`.
2. Install and attest the exact helper and sudoers digest on the production host.
3. Complete Android device pairing and independently derive/review the canonical public-key pin
   manifest from the production assignment signer and enrolled device.
4. Configure the new protected secret/variable and require production-environment approval.
5. Stage the exact release and inspect that the verifier remains stopped and `NOLOGIN`.
6. Obtain action-time Owner confirmation before `activate-verifier`.
7. Keep the deposit executor and KemerBet final-action gates disabled throughout verification.
8. Obtain a separate financial confirmation before any live feature-switch operation or actual
   deposit. Verifier readiness is not authorization to execute or move money.

Local/static verification is non-mutating:

```powershell
pnpm --filter "@fetanagent/trusted-telebirr-verifier..." run build
pnpm --filter @fetanagent/trusted-telebirr-verifier run test
node infra/verify-trusted-telebirr-verifier-deployment.mjs
```
