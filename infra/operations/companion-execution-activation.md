# Paired Windows execution activation: current boundary

The production Windows companion has an opt-in one-use execution worker and a separate signed
execution transport. Both are deliberately dormant. The database execution control is disabled,
and the execution capability role has no runtime member. There is **no reviewed production arm
operation**. Setting a local environment flag, granting a role, or updating the control row by
hand is not an activation procedure.

Migration `companion_execution_emergency_stop` adds a passwordless, memberless `NOLOGIN`
execution-bridge runtime scaffold and a Postgres-only transport fence. It grants no execution
capability. The independent `production-companion-execution-emergency-disable.sql` operation is
designed to commit credential and membership revocation first, drain active sessions second,
stop any still-live trusted TeleBirr financial epoch third, and fence the companion control
last. Each phase commits independently so a later failure cannot roll an earlier stop back. It never
leases or executes a queue job. A provider action already past its one-use fence cannot be
undone by disabling a session; its outcome must be reconciled before any later activation.
This stop path is a prerequisite for review, **not** an authorization to arm or deploy execution.
The optional bridge overlay now requires a distinct guarded execution-database URL and connects
through a separate one-connection pool. The always-on pairing/Find pool is checked against only
its seven no-money procedures; the execution pool is checked against only its seven execution
procedures. The overlay is not loaded by the default deployment, and its dedicated login remains
`NOLOGIN`, passwordless, and memberless until a separately reviewed activation implements its
bounded lifecycle. This code boundary alone cannot arm execution or lease a job.

The Windows execution worker also requires a canonical local handoff signed by the pinned
production execution signer. The handoff binds the short-lived request, paired certificate,
agent account, release, claimed archive digest, and a non-sliding window of at most twelve hours.
An environment flag and account ID alone cannot start the worker. The handoff expires locally and
the worker stops polling then; the server's one-use database fences remain separately mandatory.
The portable package now includes a deterministic installation-tree digest. Before accepting a
signed handoff, the companion measures all installed package files, including its runtime and
release marker, and requires the measured digest to match both the package marker and the signed
handoff. The handoff's archive digest remains a signed claim: only an independent release
attestation can bind it to the published ZIP. The local handoff is **not yet issued by production**;
independent archive attestation, authorized issuance, and a reviewed local delivery path remain
prerequisites before activation.
For future tagged companion releases, the packaging workflow now generates a provenance
attestation for the immutable ZIP in a tag-only job. The publish job verifies that same archive
against the repository, signer workflow, exact tag, and source revision before uploading assets.
This does not retroactively attest an older release or attest a currently installed package;
an activation preflight must still verify the chosen published asset and measured installation
independently before signing a handoff.
`verify-windows-companion-release-installation.ps1` is the read-only, non-activating operator
preflight for a future attested tag. Given the reviewed exact tag and source revision, the
immutable ZIP and checksum downloaded from that release, and the local installation root, it
requires the four exact published assets, matching release hashes, the tag's current source
revision, and a GitHub build attestation from the pinned package workflow. It then verifies
the ZIP's own installation-tree marker and measures the local installation using the same
attested, bundled tree verifier. The expected archive and installation-tree digests are required
inputs from the exact immutable one-use request; a mismatch fails before any launch proof. The
caller must retrieve those inputs through an authenticated request read, not invent them from
the archive being checked. Its only successful result is a pass marker; it neither starts
the companion nor grants any execution authority. An old, unattested release cannot pass this
preflight, and a passing disk check does not attest the currently running process or authorize
an activation request. Those are separate prerequisites.
A PID or executable path alone cannot close that gap: it does not prove the bytes already loaded
into memory or the process's inherited execution settings. A future launch-and-handshake proof
must bind the live paired process to the independently verified installation before handoff
issuance; a disk-only pass must never be treated as that proof.
The new `observe-windows-companion-verified-launch.ps1` is a no-money operator diagnostic for a
future attested companion release. It first runs the independent archive/installation preflight,
refuses an already-running companion, launches only the verified Node and entrypoint, and waits
for a fresh challenge response through a random local named pipe. After the Owner signs in to
KemerBet manually, the paired process remeasures its installation tree and signs a transcript
binding the challenge, certificate, release, tree, process identity, and times. The operator
checks the OS child process, remeasures the tree again, and verifies the signature against the
locally validated paired certificate. The same request-bound archive and tree digests must be
passed through to the release preflight. The proof and signature never go to a command line, log,
chat, or remote endpoint. A failure stops only the new no-money child. This is useful process
evidence, **not** memory attestation, production handoff issuance, database activation, or
permission to execute a queued job. The current installed companion predates this contract, so
the operator diagnostic must not be run against it; a separately reviewed attested release and
the remaining activation operation are still necessary. This no-money process proof cannot be
reused after a restart into an execution-enabled process; that process needs its own fresh proof
before any server-side activation.
Its signature verifier now lives in the shared execution contracts so a future production issuer
can evaluate the same transcript against a database-trusted certificate. No production service
currently accepts this proof or turns it into financial authority.
The activation issuer now requires a distinct v2 guarded-execution transcript. The companion
constructs that transcript only after loading its signed handoff, binding the request, epoch,
agent account, and canonical handoff digest to its paired-device signature. The v1 no-money
diagnostic transcript is rejected by the activation consistency check. This is domain
separation, **not** independent proof that the OS child loaded the handoff or runs in execution
mode: a future protected process adapter must inspect that state and validate the handoff
against the production signer. The current no-money launch diagnostic cannot be reused as that
adapter, and no activation or deployment occurred from this change.
The shared contract now has a pure, key-bound handoff signer that emits the canonical form
accepted by the Windows verifier. It has no endpoint, production key access, database transition,
or delivery mechanism. A signature over claimed release digests is not independent release
attestation and does not itself arm execution.

## Current paid-proof state

The Owner stopped the last live TeleBirr pilot with `owner_stop`. A separately authorized,
one-use customer-resolution review then cancelled its untouched queued job and opened one
execution review case. The payment claim, evidence, reservation, and history remain preserved;
the job was never leased or executed. A stopped pilot cannot be re-armed or silently replaced for
that payment. Do not submit the receipt again or copy the reservation into a new pilot.

Migration `review_stopped_pilot_paid_execution_job` added a **Postgres-only** disposition
for this state. Merely installing it changed no production row. Its separately authorized,
completed invocation required an exact active Owner, stopped `owner_stop` pilot,
singular verified payment claim and reservation, untouched zero-attempt execution job, no
execution attempt, and every financial switch disabled. It atomically cancels only that job,
changes the deposit to `execution_review`, opens an execution review case, and records an immutable
one-use receipt. The claim, payment evidence, reservation, and deposit history remain retained.
This was **not a credit or a refund**: customer resolution remains a separate, explicit obligation.
The function has no application or runtime grant. Never invoke it as part of migration deployment,
and never invoke it again for the reviewed job.

Migration `owner_self_funded_stopped_pilot_resolution` provides a separate, private disposition
for an Owner-funded test only. Installation is inert. Its Postgres-only, one-use operation requires
an active Owner to attest that both TeleBirr wallets are theirs and that no KemerBet credit or
refund is owed. It rechecks the exact stopped-pilot review, the cancelled never-leased job,
retained verified payment claim and reservation, an unassigned open review case, no execution
attempt, and the disabled financial boundary. It then records an immutable resolution, closes
the review case, and marks the deposit rejected with the explicit self-funded-test reason. It
preserves the original payment and queue history and never sends a refund or credit. A mere
chat statement, migration deployment, or read-only status check is **not** invocation authority;
the Owner must separately authorize application to the specific production test after a fresh
preflight. Do not use this disposition for a customer-funded payment or an uncertain attempt.

Run `infra/sql/production-companion-execution-activation-status.sql` with a read-only production
administrator session to obtain one identifier-free status object. It reports bounded counts and
categorical states only. It performs no activation or queue mutation. The contract verifier is
`node infra/verify-production-companion-execution-activation-status.mjs`.
`cancelledUntouchedJobs` distinguishes the protected, never-leased paid job from a queued job;
`customerResolutionPending` requires the open case, immutable review receipt, retained payment
lineage, and no execution attempt. Neither field means the customer has been credited or refunded.

The **Inspect production companion execution readiness** workflow runs that same status query
against exact passing main with a read-only database session. Its output is a redacted snapshot,
not an activation authorization. `activationAvailable` deliberately stays `false` until a
separately reviewed activation operation exists. `nextAction` is one of these diagnostic classes:

- `safety_review`: a financial switch, execution control, capability role, or execution ledger
  is outside the dormant boundary; stop before any activation work.
- `paid_stopped_pilot_review`: one untouched queue item belongs to the stopped pilot and needs
  separate customer-resolution review. The workflow never invokes that disposition.
- `queue_reconciliation`: another queued or changed job requires independent review.
- `customer_resolution_pending`: the stopped-pilot paid job has one protected review receipt,
  its queue item is cancelled without an execution attempt, and one execution review case remains
  open. Do not infer a credit or refund.
- `pilot_review`: there is no armed pilot available for a future activation.
- `trusted_activation_review`: the trusted TeleBirr epoch is not active for the armed pilot.
- `release_and_owner_review`: the database snapshot alone is insufficient; release, Owner,
  credential, and local Windows checks still must pass before activation can be considered.

No `nextAction` value is permission to arm a switch, lease a queue item, or move money.

The Owner page's **Deposit execution readiness** panel is a smaller, authenticated projection of
this diagnosis. It shows bounded counts and a plain-language next step without job, Player,
receipt, or account identifiers. It has only a refresh control; `activationAvailable` is always
false. Its database function grants execute only to the Owner-control role and performs no
mutation. The current paid stopped-pilot case should display `customer_resolution_pending`,
not an executable job.

Roll out this additive preview in order: deploy the reviewed Owner image with its optional
function preflight first, then apply the reviewed append-only migration that grants the function.
The old Owner image's strict exact-grant preflight does not accept the new grant if it is applied
first. Confirm the Owner service remains healthy and the preview returns a redacted result after
the migration. Do not use a migration-only release before updating the Owner image, and do not
conflate either deployment with execution activation.

## Inert one-use request foundation

Migration `companion_execution_one_use_request` adds an immutable preparation record and an
administrator-only preparation routine. It binds one request to the current trusted epoch,
armed pilot, active Owner, Owner-paired Windows certificate, KemerBet agent account, pinned
execution signer, and claimed companion release, archive, and installation-tree digests. The
routine refuses preparation unless the financial epoch is already current and the companion
control is still disabled. At most one unexpired request can cover the same pilot/epoch; an exact replay changes
nothing. A later, separately authorized fresh request may replace an expired one without
requiring a new twelve-hour pilot.

This is **not** the activation transition. Release digests in a request are claims and must be
independently attested against the installed bundle and running runtime. The request expires in
at most ten minutes (separate from a twelve-hour pilot); expiry never slides on replay. There
is no application EXECUTE grant, no request consumer, no companion-control write, no runtime
credential, no local Windows opt-in, and no job lease in this migration. Do not invoke the
preparation routine in production until the remaining activation operation, transport, local
handoff, and emergency-stop pieces are reviewed together.

The shared execution-contracts package has a pure, non-activating evidence consistency check
and a non-activating attestation issuer core. The core generates a fresh challenge, requires
separate database, published-release, and OS-observed paired-process adapters, re-reads the
database identity, verifies the signed proof against the database key, and sends only digest
witness fields to a retention adapter. This does not make caller-provided inputs trusted: no
production workflow, authenticated proof transport, or entry point exists yet. A separate
operator-only package now provides one parameterized, read-only database snapshot adapter for
the request, current identity, and paired certificate. It requires an injected short-lived
`postgres` session; it does not provide a credential or connection and must never run inside
the always-on companion or an application role. That package now also adapts the existing
source-pinned Windows preflight for published archive and independently measured installed-tree
evidence, with a trusted operator-side observation time. It requires a protected Windows
operator workflow, an exact release archive, and a reviewed source checkout; none are supplied
by the package. The guarded-execution proof contract is now distinct from the no-money
diagnostic proof. A separate operator-only adapter can retain one verified digest witness
through a short-lived `postgres` session. Its append-only schema addition records the signed
handoff digest and deliberately refuses retrofit if an older witness already exists. A
read-only guarded-process observer now validates the canonical local signed handoff,
paired v2 proof, and an OS-reported PID/image/command line/start time through a
source-pinned Windows inspection. It cannot receive a proof or start a process:
the protected challenge-pipe launcher and production invocation are still absent.
Neither this adapter nor its migration is a production invocation or execution grant.
Neither package can arm the companion,
consume the request, or establish the complete financial preflight. A future production
consumer must supply the remaining authenticated sources and complete the atomic credential
lifecycle below.

The `companion_execution_atomic_activation` migration adds a Postgres-only, one-use consuming
transition and an append-only attestation digest record. In a disposable database the transition
locks and rechecks the current financial epoch, switches, pilot, certificate, and companion
control; it consumes the request, grants only the dedicated execution capability to a bounded
SCRAM runtime login, and arms only the matching companion control in one transaction. The
independent stop removes that login and control. No application role can insert an attestation
or execute the transition. The attestation is **not** a self-authenticating signature: trusted
production adapters must first independently verify the release measurement and paired-process
proof against the database certificate. The issuer core alone does not provide those adapters.
No production invocation workflow, signed local handoff, host stop/reconciliation rehearsal, or
deployment of this migration exists yet.
Do not apply or invoke it in production as a shortcut around those missing pieces.

## Missing activation implementation

Before any money-capable release, one separately reviewed change must provide all of the
following as one fail-closed operation, with disposable-PostgreSQL and end-to-end tests:

1. Connect the inert one-use request to an authenticated Owner action and independently attest
   the exact published archive and installed measured release tree. Recheck the pilot, epoch,
   certificate, and short
   non-sliding expiry at consumption; a stopped or expired pilot must be rejected.
2. A database-owned activation transition that locks the epoch, sorted switch rows, pilot,
   certificate, and execution control in the established order; rechecks every lineage and
   financial invariant; and atomically arms only the exact companion control. No direct table
   write, broad grant, or request-key replay may substitute for this transition.
3. Complete the lifecycle for the dedicated execution-bridge identity now isolated by the
   optional transport: membership and login must be created only inside the bounded activation,
   then revoked and sessions terminated at stop, expiry, failure, or uncertainty. The connection
   must have exactly the seven execution procedures and no base-table access.
4. A checksum-bound production transport release with the pinned execution signer and the
   reviewed overlay. The default release must remain no-money. The paired Windows process must
   receive its account-bound opt-in through a reviewed local handoff, not a manually set flag.
5. A rehearsed independent emergency stop and reconciliation path. The credential/transport
   stop is only a foundation; the host runtime stop and in-flight provider reconciliation still
   need an integrated rehearsal. The final-action fence must be one-use, and any ambiguous
   provider response must stop without an automatic retry. The queue item must never be leased
   for a test of the activation plumbing.

Until all five are implemented and reviewed together, the executable path stays disabled. The
status query and dormant disposition do not make the Telegram bot able to credit KemerBet or
automatically resolve the already-paid proof.
