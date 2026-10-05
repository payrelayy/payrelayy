# Routine production TeleBirr deposits

This repository contains the separately gated **execution path from an already verified, queued
job** for FetanAgent routine TeleBirr deposits into KemerBet. It does not yet contain the
non-pilot customer proof, Android verification, authoritative claim, and settlement path needed
to create that job. The dormant first proof-ledger slice is described in
[routine-telebirr-proof-foundation.md](routine-telebirr-proof-foundation.md). The execution path implements the approved rules in
[telebirr-deposit-product-contract.md](telebirr-deposit-product-contract.md), while keeping the
fixed 25 ETB execution-v2 pilot unchanged.

The implementation is dormant after deployment. Merging or applying its migration does not start
the Windows companion, create a database password, enable the production overlay, lease a job, or
move money. Production use requires all of the explicit activation inputs described below. No live
payment was performed while implementing or testing this path.

## Product rules

- TeleBirr receipts, ETB, and KemerBet deposits only.
- 25–25,000 ETB per deposit, inclusive, with valid cents. The credited amount is the verified
  official receipt's Settled Amount, not a customer-entered value or the amount plus fees.
- Any currently active, validated, deposit-eligible Player ID may be used. There is no five-Player
  allowlist and TeleBirr payer-to-Player ownership matching is not required.
- There is no daily, lifetime, frequency, or successful-deposit quota. Every payment claim remains
  globally one-use.
- At most one deposit may occupy the KemerBet account lane. A fenced or uncertain attempt blocks
  later work until exact durable reconciliation.
- Routine mode does not ask for per-deposit Owner confirmation. It still requires a current
  persistent Owner policy, an active paired certificate, an account-bound Windows launch, and the
  separately activated production transport.

## Implemented execution path

The routine protocol is domain-separated from execution-v2:

- protocol mode `windows_companion_routine_deposit_execution_v1`;
- capability `kemerbet.deposit.submit.verified_receipt_amount.routine.v1`;
- endpoint `/v3/companion/device/routine-deposits:command`;
- operations `lease`, `fence`, `record_dispatch`, `reconcile`, `complete`, and `pause`.

Every Windows request contains the current paired-device certificate and an exact signed HTTP
request. The bridge validates those with the no-money certificate signer, executes one reviewed
database function through a dedicated one-connection login, and signs the response with the
distinct production execution key. The Windows client pins that key, validates the exact response
digest and request binding, rejects stale responses, and never retries a command after transport
uncertainty.

The database migration `20261005090000_routine_telebirr_execution_broker.sql` adds immutable,
forced-RLS runtime, request, dispatch-evidence, and pause ledgers. Its runtime role starts as
`NOLOGIN`, passwordless, and without capability membership. Only a `postgres` session can activate
it, and activation binds one current Owner authorization, paired certificate, KemerBet agent
account, no-money signer, and production execution signer. The runtime receives schema usage and
EXECUTE on one security-definer broker function; it receives no table, sequence, or column access.

Lease and final-action state use the existing durable execution-attempt and KemerBet account-lane
ledgers. A process restart cannot turn a fenced attempt into new executable work. Exact request,
body, replay, and command digests are append-only and replay-safe. A provider response cannot
complete an attempt: completion re-reads one durable `confirmed_executed` reconciliation with
exact Player, amount, currency, history cardinality, and Player-credit evidence.

The Windows routine worker remains sequential. It validates the policy and immutable
job/intent/attempt/payment-claim/account/Player/amount binding, asks for the ten-second database
fence only after the page is prepared, and allows one Transfer request. After submission, it
requires both exact visible provider messages:

- `Transfer Successful!`
- `Player Balance +<exact two-decimal amount> ETB Success`

Those messages are dispatch evidence, not the durable completion decision. The worker records the
dispatch and enters reconciliation. Pending reconciliation retains the account lane; uncertain or
mismatched reconciliation pauses the worker. Local pause state is set before pause-notification
I/O, so a database outage cannot make the worker continue.

## Protected Windows launch

The standard companion launcher remains read-only. Routine execution is available only through
`Start FetanAgent Automatic Deposits.cmd` in a packaged release.

That launcher requires the ordinary, non-reparse-point local document
`operator\routine-deposit-launch.json` under the paired companion data root. The document contains
only version 1, the exact installed release SHA, and the production platform-agent account UUID.
`infra/operations/prepare-windows-companion-routine-local.ps1` creates it exclusively and runs the
packaged launcher's `-CheckOnly` path. It never connects to the server or opens KemerBet.

At execution time, the launcher independently verifies the complete installation tree, loads the
paired certificate, creates a random named pipe and challenge, and starts the exact packaged child
with an allowlisted environment and an IPC stop channel. The child remeasures the installation and
signs a launch proof. The parent verifies the certificate signature, challenge, release, tree,
exact child PID, and observed time before returning a permit bound to the SHA-256 digest of those
exact proof bytes. The child acknowledges that same digest before starting either the lookup or
routine worker. Parent termination or IPC disconnect stops the child and closes the protected
browser session.

The routine and execution-v2 Windows flags are mutually exclusive. Manually setting an internal
flag does not bypass the required parent IPC channel, named-pipe proof, installed-tree measurement,
paired key, account binding, server-signed commands, database activation, or final-action fence.

## Production deployment and activation

The normal production composition stays no-money. The sealed release includes
`compose.production.routine-deposits.yaml`, but the deploy helper loads it only when the protected
root-owned `routine-deposits.release` marker contains the exact release SHA. The routine marker and
the execution-v2 marker are mutually exclusive. Before using the overlay, the helper validates the
pinned execution key and v3 manifest plus the root-owned, mode-0400 routine database URL. The
public route returns a dormant 503 while the overlay is absent.

Activation is an ordered operator procedure, documented in
`infra/operations/routine-deposit-activation.md`. Its independent gates are:

1. deploy the reviewed migration and compatible bridge/Windows release;
2. save the exact routine policy from an authenticated active Owner;
3. pair the reviewed Windows release and obtain its current certificate ID and exact agent account;
4. generate a fresh dedicated SCRAM credential and database URL with
   `create-production-routine-deposit-runtime-credential.mjs`;
5. use a production `postgres` session and the exact activation SQL to bind that password to the
   current policy and certificate;
6. install the protected URL and exact-release overlay marker, then deploy the bridge;
7. create and check the local Windows account-binding document;
8. start the separate Automatic Deposits launcher and verify the Owner projection reports the
   bound runtime active.

Credential generation uses exclusive file creation and mode 0600. If either output collides or a
later write fails, it removes only files created by that invocation and preserves pre-existing
operator material.

The stop path is independent of the Windows process. Run
`production-routine-deposit-disable.sql` from `postgres` first; it revokes capability membership,
sets the runtime to `NOLOGIN`, clears its password, commits, and then terminates remaining runtime
sessions. Remove the exact-release overlay marker and stop the Windows launcher afterward. A
provider action already beyond its fence is not undone by stopping transport and must remain in
reconciliation.

## Safety invariants

- The fixed 25 ETB v2 protocol, worker, handoff, and Owner-approved one-job path retain their old
  capability and semantics.
- The bridge's no-money database login never receives the routine broker function. The routine
  login never receives pairing, lookup, v2 execution, table, sequence, or column privileges.
- The certificate signer and execution-response signer must have different key IDs and keys.
- Server-side feature switches, current policy, paired certificate, exact account, one-use payment
  claim, receiver revision, Player eligibility, and verified receipt amount are rechecked before a
  fresh lease or fence.
- A duplicate, redirect, timeout, crash, database failure, changed page, wrong modal, malformed
  response, or uncertain provider outcome never causes an automatic Transfer retry.
- A stop prevents new execution but cannot erase an already fenced action. Reconciliation remains
  mandatory.

## Verification

The non-financial verification set is:

```powershell
pnpm -r run build
pnpm --filter @fetanagent/agent-platform-companion-execution-contracts test
pnpm --filter @fetanagent/windows-companion test
pnpm --filter @fetanagent/companion-device-bridge test
pnpm --filter @fetanagent/sql-integration-tests build
pnpm verify:routine-deposits
node infra/verify-companion-execution-v2-deployment.mjs
pnpm test:sql
```

The routine verifier checks the dormant deployment boundary, domain separation, signed launch and
HTTP channels, exact modal evidence, one-function runtime role, explicit production overlay,
activation/disable ordering, packaged launcher, and collision-safe credential generator. Unit
tests use only local fixtures and cannot reach KemerBet or move money.

`pnpm test:sql` is the authoritative disposable-PostgreSQL test for migration syntax, runtime ACLs,
explicit activation, replay-safe idle commands, Owner execution projection, and immediate disable.
It must pass in an environment with the repository's Docker-backed SQL harness before production
deployment.
