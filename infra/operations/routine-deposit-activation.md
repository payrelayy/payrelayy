# Production routine-deposit activation

This is a money-capable production procedure. It is intentionally not part of migration deployment
or the normal production composition. Use it only for a reviewed exact release, from protected
operator hosts, after the non-financial verification and disposable SQL suite pass.

The non-pilot path is now implemented: Telegram captures a fresh paid candidate. The paired phone
verifies a TeleBirr receipt over HTTPS or signs a CBE Birr receiving-phone SMS; the isolated
settlement worker creates one payment claim and queued job, and the Windows worker credits only
one verified job at a time. The disposable SQL suite tests the claim/job lineage and replays. A
production no-money TeleBirr phone rehearsal must still show a recent signed V2
`official_tls_origin` observation matching server policy before transport activation.

The activation SQL checks that observation, the dedicated phone/settlement logins and source
guard, no active or unisolated routine execution attempt, and both shared deposit switches
**disabled**. A durably isolated Owner-review case retains its one-use payment claim.
The independent CBE Birr switch must match the operator's explicit `disabled` or `live`
confirmation; the four legacy/withdrawal switches must be disabled.
It then provisions only the separate Windows transport login. It does not turn a switch live,
create a paid claim, start the companion, or perform a credit. Keep the shared deposit switches
off until the installed companion, protected server marker, and emergency stop have been verified
for the exact release. Do not treat a successful transport activation as permission to submit a
payment.

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
- confirmation that no routine attempt is prepared, fenced, or reconciliation-required,
  and that any reviewed attempt has a durable isolated Owner case;
- the independent CBE Birr switch's current mode, confirmed as `disabled` or `live`;
- passing build, unit, deployment-verifier, and Docker-backed SQL results for the exact SHA.
- a passing, reviewed non-pilot receipt-to-verified-job lineage and no-money end-to-end result;
  the existing five-Player pilot lineage does not satisfy this requirement.

The production deploy also requires the seven latest `push` CI workflows on `main` to pass for
that exact SHA. Passing pull-request checks, a manual package build, or a production build plan
does not satisfy this gate. If a merge produces no main-branch push runs, stop and resolve that
release event before attempting deployment; do not bypass the CI gate.

The current Owner policy must retain the fixed production scope: TeleBirr, KemerBet, ETB,
receipt-derived 25–25,000 ETB, all active deposit-eligible Players, one concurrent deposit, and no
daily or count quota. CBE Birr eligibility is independently gated by its switch; enabling the
shared gates never changes that switch.

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
export FETANAGENT_ROUTINE_CBE_EXPECTED_MODE='<disabled-or-live>'

psql --no-psqlrc --file infra/sql/production-routine-deposit-activate.sql
```

The SQL runs serializably as `postgres`, locks the routine runtime, rechecks the current Owner and
certificate, grants only the routine broker capability, sets the bounded SCRAM login, and records
the immutable activation. It prints one identifier-free JSON status with
`"livePaymentPerformed": false`.

If the administrator connection is available only inside the protected GitHub production
environment, the reviewed `production-routine-deposit-transport-activation.yml` manual workflow
can run this same SQL. First place **only the newly generated activation password** in the
`ROUTINE_DEPOSIT_RUNTIME_PASSWORD_ACTIVATION` production-environment secret, without putting it in
a command argument or workflow input. Dispatch for the exact passing `main` SHA and reviewed Owner
and certificate UUIDs, and choose the observed CBE switch mode in the workflow input. Verify that
the workflow reports the no-payment result and the same CBE mode, then delete that
temporary GitHub secret. Keep the separately generated URL on the protected operator host for
step 3; never put the URL or password in workflow inputs, chat, artifacts, or logs. A failed or
uncertain activation requires database-status inspection before retrying.

Unset the password environment variable immediately. Retain the activation-password file only
until bridge startup and status verification complete, then remove it through the protected
operator host's normal secret-destruction procedure. Do not copy it to the production VM.

## 3. Install the bridge credential and exact-release marker

On the production VM, the parent directory
`/etc/fetanagent/companion-execution-secrets` must be root:root mode 0700. Install the URL as
root at the exact path and metadata expected by the deploy helper:

```text
/etc/fetanagent/companion-execution-secrets/production-routine-deposit-database-url
owner 10001:10001, mode 0400, one ordinary file, one hard link
```

For a stopped production recovery when the session pooler cannot serve this isolated role, the
deploy helper also accepts the exact direct database host, the same role and password, port 5432,
and `sslmode=verify-full`. Rebind this protected URL only while production is stopped, after
checking the financial ledger and preserving a root-only rollback copy. Confirm the role connects
and passes its read-only catalog preflight on the direct route before changing the URL. Neither
route is a reason to loosen the Companion's one-use or transfer fences.

The bridge runs as UID 10001. Docker Compose bind-mounts file-backed secrets without applying the
`uid`/`gid`/`mode` hints in the overlay. In the same protected parent directory, install a
byte-for-byte copy of the existing root-owned
`production-execution-signer.pkcs8.der` at
`production-routine-execution-signer.pkcs8.der`, owner 10001:10001 and mode 0400. The deploy
helper verifies that the copy exactly matches the original root-only signer. The root-only parent
still prevents non-root host users from traversing to either container-specific source file.

Install an ordinary root-owned mode-0600 marker containing only the exact release SHA and a final
newline:

```text
/var/lib/fetanagent/production/routine-deposits.release
```

The marker must not coexist with
`/var/lib/fetanagent/production/companion-execution-v2.release`. The deploy helper refuses a
release if both modes are selected, if the credential or marker is a link, if metadata is broader,
if the account/host/TLS URL is not exact, or if the release SHA differs.

The marker is bound to one release. Before a later inert production deployment intended to retain
the signed Windows routine transport, stop the financial gates, check there is no active or
unisolated execution attempt, and replace the marker with that **new** reviewed main SHA using the same
root-owned mode-0600 contract. Select `confirm_routine_deposit_transport: enabled` for the
`deploy-inert` workflow. Its no-money public smoke requires the signed Windows routine endpoint
to reject a malformed unauthenticated request as an active route; a dormant route fails the
deployment and triggers rollback. Keep the marker at the prior SHA and select `disabled` when
the new release is intentionally dormant.

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

## 6. Enable the shared live deposit gates only after review

The migration `routine_telebirr_financial_activation_boundary` installs a dormant
postgres-only operator procedure. Applying or deploying it changes **no** financial switch.
After the exact release is deployed, the current phone has a fresh signed V2
`official_tls_origin` no-money proof, the paid settlement and poll roles are healthy,
the Windows worker is connected and idle, and the stop operation is ready, dispatch
`production-routine-financial-activate.yml` on `main`. Confirm the exact deployed SHA,
production project ref, authorizing Owner auth-user UUID, and the independently observed CBE
switch mode. Use `ENABLE LIVE ROUTINE TELEBIRR DEPOSITS` when CBE is disabled or
`ENABLE LIVE ROUTINE DEPOSITS WITH CBE` when it is live. The workflow requires passing
exact-main CI and then calls
`infra/sql/production-routine-financial-activate.sql` over verify-full TLS.

The database operation holds the Owner/TeleBirr/cohort/switch locks, rejects an
active legacy pilot or executor, checks the two shared switches and four legacy/withdrawal
switches disabled and the CBE switch in the explicitly confirmed mode, plus the
current routine transport and phone proof, and requires a signed Windows broker
lease from the last 45 seconds plus a recently successful database liveness
watchdog run. It then changes **only**
`payment_verification` and `deposit_execution` to `live`. The independent CBE Birr switch,
TeleBirr's retired pilot, and both withdrawal switches are unchanged. It performs no test
transfer, payment claim, or Player credit. Once it succeeds, new eligible Telegram
references for enabled providers become paid candidates; the phone and settlement service may
verify them, and the one-connection Windows worker may credit one verified job at
a time. Do not describe the service as live until this exact operation succeeds.

After `routine_telebirr_offline_verified_queue` is installed, the independent
15-second database job observes the signed credit-worker lease but does not stop
TeleBirr when the Companion goes offline. The paid phone can keep verifying
eligible references and atomically enqueue one-use jobs. Those verified jobs stay
queued without a worker; the signed broker serves them serially when it returns,
rechecking current policy and Player eligibility before each credit. A fenced or
uncertain Transfer remains ahead of new jobs for reconciliation, never an automatic
retry. An explicit Owner or incident stop still disables both financial gates.
If a reference cannot be verified while fresh, it must not later be treated as a
verified queued payment. A paused or changed Owner policy may require operator
resolution instead of silently crediting an old queue item.

Review any unfinished attempt before a manual restart of the automatic-deposit Companion.
The signed routine browser refreshes the same guarded KemerBet page after seven
idle minutes and re-verifies the bound account before new credit work. It stays open
beyond 24 hours while signed in; the separate non-routine enrollment/execution
windows retain their twelve-hour cap. If KemerBet itself returns to login, the
routine window stops claiming credit work while it signs in using the Owner-managed
credential stored in Supabase Vault. It resumes only after the same bound account
passes identity verification. A KemerBet challenge or invalid saved password still
needs Owner attention. The launcher restarts an unexpectedly closed routine browser;
an unresolved transfer remains held for reconciliation and is never replayed.
No provider token is exported from Chrome. Recheck any unfinished attempt before
manually crediting it.
For a sign-out investigation, inspect the local `diagnostics/kemerbet-session.jsonl`
and `.jsonl.1` files under the Companion data root. Correlate `login_required` with
the preceding fixed event names: provider `Logout`, refresh rejection/network failure,
Account/Info authentication failure, guarded reload, or local process stop. No provider
payloads or payment identifiers are written to these files.

The existing no-money reference is not a paid activation check. Observe the
first naturally occurring eligible live deposit through the Owner and protected
operator channels; never create a synthetic paid job or retry an uncertain
Transfer to prove the path.

If a routine execution becomes uncertain, the signed broker must first record the
one-use claim and Owner-review case. Once that handoff is acknowledged, the
Companion continues Player checks and credits for other Players. A later payment
to the same Player waits for resolution of the review. A failed review handoff,
binding mismatch, or other integrity failure still disarms the launch and keeps
the guarded Chrome window available for investigation. Closing the window does
not resolve the attempt.

## Emergency or planned stop

First dispatch `production-routine-financial-stop.yml` on `main` with the exact
project ref and `incident_stop` (or `operator_requested` for a planned stop). It
disables both shared financial gates transactionally and does not erase an
already-fenced attempt. If GitHub is unavailable, run
`infra/sql/production-routine-financial-stop.sql` through the protected
administrator connection with its documented environment inputs. Reconcile any
uncertain KemerBet Transfer before another activation.

Stopping Windows alone is not sufficient because the database login is
independently authorized. After the financial gates are off, run the transport
database disable with a fresh UUIDv4 and an allowed reason:

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
