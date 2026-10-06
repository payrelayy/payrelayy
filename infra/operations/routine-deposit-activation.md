# Production routine-deposit activation

This is a money-capable production procedure. It is intentionally not part of migration deployment
or the normal production composition. Use it only for a reviewed exact release, from protected
operator hosts, after the non-financial verification and disposable SQL suite pass.

**Current stop gate:** The non-pilot customer proof-to-official-observation-to-one-use-claim-to-
verified-job path is not implemented end to end. The dormant table in
`20261005165930_routine_telebirr_untrusted_proof_foundation.sql` does not satisfy that path.
The `routine-signed-observation` library verifies a paired-device signature and receipt-policy
facts in isolation, but has no production caller, authenticated official-source adapter, durable
challenge/replay ledger, or atomic one-use payment claim. Its advisory result does not satisfy
this activation gate.
The `routine-signed-lookup-assignment` contract likewise verifies only a server signature and
routine device/receiver binding in isolation. It does not issue assignments, establish trusted
candidate database binding, authenticate TeleBirr, or activate the Android routine lookup. The
phone's routine receiver-name digest is domain-separated from the private pilot, but the routine
phone path is still dormant.
Do not run this activation procedure, install its runtime credential or release marker, or start
the Automatic Deposits launcher until a later reviewed release proves the whole path with
disposable SQL and no-money end-to-end tests.
The checked-in activation SQL now stops before reading activation inputs; a later release must
remove that stop only after the non-pilot lineage has passed those tests.

Do not use this procedure to test whether KemerBet Transfer works. Do not create a synthetic paid
job, reuse a payment claim, or submit a live payment as an activation check. A pre-existing fenced
or uncertain attempt must be reconciled before activation.

## Required evidence

Record these through the authenticated Owner and database operator channels, not chat or a command
line history:

- exact 40-character production release SHA;
- active Owner auth-user UUID that created the current routine authorization;
- current paired Windows certificate UUID;
- platform-agent account UUID from that authorization;
- installed Windows release tree and paired-device preflight result;
- confirmation that the execution-v2 release marker is absent;
- confirmation that no routine attempt is prepared, fenced, reconciliation-required, or under
  review;
- passing build, unit, deployment-verifier, and Docker-backed SQL results for the exact SHA.
- a passing, reviewed non-pilot receipt-to-verified-job lineage and no-money end-to-end result;
  the existing five-Player pilot lineage does not satisfy this requirement.

The production deploy also requires the seven latest `push` CI workflows on `main` to pass for
that exact SHA. Passing pull-request checks, a manual package build, or a production build plan
does not satisfy this gate. If a merge produces no main-branch push runs, stop and resolve that
release event before attempting deployment; do not bypass the CI gate.

The current Owner policy must retain the fixed production scope: TeleBirr, KemerBet, ETB,
receipt-derived 25–25,000 ETB, all active deposit-eligible Players, one concurrent deposit, and no
daily or count quota.

## 1. Create the isolated runtime credential

On a protected operator host, choose two new absolute paths in a mode-0700 temporary directory.
Neither path may already exist.

```bash
node infra/operations/create-production-routine-deposit-runtime-credential.mjs \
  --database-url-output /protected/operator/production-routine-deposit-database-url \
  --activation-password-output /protected/operator/production-routine-deposit-password
```

The command creates both files exclusively. The URL contains the dedicated one-connection pooler
login only; it is not an administrator URL. The password file is used once by the activation SQL
and must never be installed in the bridge container.

## 2. Activate the database identity

Set the following only in the protected `psql` process environment. Generate a fresh UUIDv4 for
the activation request key. Use the production administrator connection with verify-full TLS.

```bash
export PRODUCTION_PROJECT_REF=xzztugbgtulptnbpoelr
export FETANAGENT_ROUTINE_OWNER_AUTH_USER_ID='<reviewed-owner-auth-user-uuid>'
export FETANAGENT_ROUTINE_COMPANION_CERTIFICATE_ID='<reviewed-current-certificate-uuid>'
export FETANAGENT_ROUTINE_ACTIVATION_REQUEST_KEY='<fresh-uuidv4>'
export FETANAGENT_ROUTINE_RUNTIME_PASSWORD="$(</protected/operator/production-routine-deposit-password)"

psql --no-psqlrc --file infra/sql/production-routine-deposit-activate.sql
```

The SQL runs serializably as `postgres`, locks the routine runtime, rechecks the current Owner and
certificate, grants only the routine broker capability, sets the bounded SCRAM login, and records
the immutable activation. It prints one identifier-free JSON status with
`"livePaymentPerformed": false`.

Unset the password environment variable immediately. Retain the activation-password file only
until bridge startup and status verification complete, then remove it through the protected
operator host's normal secret-destruction procedure. Do not copy it to the production VM.

## 3. Install the bridge credential and exact-release marker

On the production VM, install the URL as root at the exact path and mode expected by the deploy
helper:

```text
/etc/fetanagent/companion-execution-secrets/production-routine-deposit-database-url
owner root:root, mode 0400, one ordinary file, one hard link
```

Install an ordinary root-owned mode-0600 marker containing only the exact release SHA and a final
newline:

```text
/var/lib/fetanagent/production/routine-deposits.release
```

The marker must not coexist with
`/var/lib/fetanagent/production/companion-execution-v2.release`. The deploy helper refuses a
release if both modes are selected, if the credential or marker is a link, if metadata is broader,
if the account/host/TLS URL is not exact, or if the release SHA differs.

Deploy that exact sealed release through the normal production workflow. The bundle always carries
the reviewed routine overlay, but the helper includes it only for this matching protected marker.
Its negative public smoke expects the routine endpoint to change from dormant 503 to authenticated
handler rejection; it does not lease work or perform a payment.

## 4. Prepare the paired Windows installation

First run the no-write plan, then create the one local account-binding document:

```powershell
pwsh -NoProfile -File infra/operations/prepare-windows-companion-routine-local.ps1 `
  -ReleaseDirectory '<reviewed release directory>' `
  -PlatformAgentAccountId '<exact platform-agent account UUID>' `
  -PlanOnly

pwsh -NoProfile -File infra/operations/prepare-windows-companion-routine-local.ps1 `
  -ReleaseDirectory '<reviewed release directory>' `
  -PlatformAgentAccountId '<exact platform-agent account UUID>'
```

The second command writes `operator\routine-deposit-launch.json` once, checks the paired enrollment
and exact installed release, and invokes only the package's `-CheckOnly` path. It does not connect,
open the browser, or start a deposit. A document from another device, account, or release must not
be copied or edited into place.

## 5. Start and observe

Start `Start FetanAgent Automatic Deposits.cmd` from the reviewed installed package. Sign in to the
dedicated KemerBet Chrome profile directly. The protected parent must verify and permit the exact
paired child before the routine worker starts.

Confirm all of the following without creating a test payment:

- bridge health remains healthy and its routine catalog preflight is exact;
- the Owner routine projection reports policy `authorized` and execution enabled;
- Windows reports an idle routine worker when no admitted paid job exists;
- no execution-v2 Windows process or production overlay is active;
- no raw Player, payment reference, credential, or certificate data appears in logs.

## Emergency or planned stop

Stopping Windows is not sufficient because the database login is independently authorized. First,
run the database disable with a fresh UUIDv4 and an allowed reason:

```bash
export PRODUCTION_PROJECT_REF=xzztugbgtulptnbpoelr
export FETANAGENT_ROUTINE_DISABLE_REQUEST_KEY='<fresh-uuidv4>'
export FETANAGENT_ROUTINE_DISABLE_REASON='operator_requested'

psql --no-psqlrc --file infra/sql/production-routine-deposit-disable.sql
```

Use `incident_stop` for an incident and `rotation` for credential/certificate rotation. The SQL
commits role `NOLOGIN`, password removal, and membership revocation before terminating remaining
runtime sessions. Its output deliberately states that provider outcomes still require
reconciliation.

Then stop the Windows launcher. Remove the exact-release routine marker before the next production
release activation so the default no-money composition is restored. Quarantine or remove the
dedicated URL only after database disable has committed. Expect the routine-enabled bridge health
to fail after credential revocation; restore the no-money composition through a reviewed sealed
release transition, not an ad-hoc container environment edit.

If any attempt crossed the final-action fence, preserve every ledger and reconcile it before a new
activation. Never clear a pause, rotate credentials, or restart Windows as a way to retry an
uncertain Transfer.
