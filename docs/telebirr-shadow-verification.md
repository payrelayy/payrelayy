# TeleBirr authenticated shadow verification (no money)

This slice lets an already armed `dry_run` private pilot authenticate one real, official TeleBirr
observation end to end. It is deliberately a third lineage: it is neither the fixture-backed
dry-run simulation lane nor the live payment-proof lane. It cannot verify or credit a payment,
reserve funds, settle a deposit, enqueue execution, invoke KemerBet, or move money.

Nothing in this repository change deploys or enables the process. Both runtime roles remain
`NOLOGIN`, the checked-in enable gates are false, the Compose service is profile-only, and all
financial/provider switches remain disabled.

## Exact intake boundary

The Telegram/API adapter may call only:

```text
app.capture_telegram_telebirr_shadow_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
)
```

The arguments, in order, are the recorded inbound-event UUID, selected Player ID, the literal
`telebirr`, v2 provider-bound reference ciphertext, the lowercase reference fingerprint, the
masked suffix, encryption-key version `2`, protection-profile version `2`, and the semantic HMAC.
The semantic consumer/domain is exactly `capture_telegram_telebirr_shadow_proof`; it must not be
shared with the legacy simulation or live-proof lane.

The function returns exactly one row with:

```text
shadow_proof_request_id uuid
shadow_verification_job_id uuid
provider_code text                  -- always telebirr
proof_status text                   -- always verification_queued
submitted_at timestamptz
request_replayed boolean
```

The identifiers are internal correlation values. They must not be returned to Telegram or exposed
as a customer tracking token. The adapter returns only the existing redacted
`deposit_proof_received` presentation; it must not claim that a payment was verified or credited.

`fetanagent_player_actions` is the only non-owner role that may execute this capture function. The
function is `SECURITY DEFINER` with the exact `search_path=pg_catalog` setting, consumes the already
recorded inbound event atomically, and writes only the shadow proof/receipt tables plus the normal
audit event. A replay of the same inbound event is accepted only when every immutable binding and
the semantic HMAC match; conflicting reuse fails closed.

## Seven database gates

Every state-creating transition calls the same database predicate. It accepts only one exact state:

1. `payment_verification` is `disabled` with `{}` settings;
2. `deposit_execution` is `disabled` with `{}` settings;
3. `withdrawal_validation` is `disabled` with `{}` settings;
4. `withdrawal_collection` is `disabled` with `{}` settings;
5. `cbe_birr_authoritative_verification` is `disabled` with `{}` settings;
6. `telebirr_authoritative_verification` is `disabled` with `{}` settings; and
7. `private_live_deposit_pilot` is exactly `dry_run`, its settings identify the current revision and
   configuration digest, and that revision is armed, current, and unexpired.

The predicate is re-evaluated during proof capture, assignment lease, first-signature persistence,
device-evidence staging, verifier work selection, authority loading, completion, and quarantine.
Before every state-creating transition, one shared assertion locks all seven feature rows in
deterministic key order and then locks the bound pilot revision. Those locks are held through commit,
so a concurrent live-switch activation cannot commit between the gate check and a shadow write.
Stopping/expiring the pilot, changing any digest/settings object, or changing any one of the six
disabled switches prevents further shadow transitions. The process configuration adds an independent
guard: `FINANCIAL_ACTIONS_MODE=dry_run`, both shadow enable gates explicitly true, and the live
verifier and KemerBet private-live gates explicitly false.

## Isolated append-only lineage

Shadow work is stored only in these forced-RLS, append-only tables:

- `private_telebirr_shadow_proof_requests`
- `telegram_telebirr_shadow_proof_receipts`
- `private_telebirr_shadow_verification_attempts`
- `private_telebirr_shadow_assignment_transcripts`
- `private_telebirr_shadow_device_evidence_staging`
- `private_telebirr_shadow_verification_outcomes`
- `private_telebirr_shadow_evidence_quarantine`

They contain no deposit-intent, payment-claim, reservation, settlement, execution-job,
platform-agent, or KemerBet-action foreign key. No application/runtime role has direct table or
column privileges. The shadow completion routine inserts only an advisory shadow outcome and
always returns `deposit_intent_id=null`, `deposit_payment_claim_id=null`, `execution_job_id=null`,
and `settlement_created=false`. Its returned outcome is only `would_verify`, `would_review`, or
`would_reject`; none is a payment decision and none carries financial authority.

The authority reader may read existing immutable pilot/device/signer/receiver/policy facts and the
provider-evidence ledger solely to determine whether the observed reference was already used. It
does not write any live proof, evidence, claim, reservation, settlement, execution, or KemerBet
table. The static deployment guard rejects any financial-ledger mutation added to this migration.

## Reused signed contracts, separate persistence

The already reviewed assignment and signed-observation wire formats are reused so the real Android
device and official observation can be authenticated. The existing public broker signatures remain
unchanged:

```text
app.lease_private_live_telebirr_assignment_broker(uuid,text,uuid,integer)
app.persist_private_live_telebirr_assignment_broker_signature(uuid,uuid,uuid,text,text,text,text)
app.stage_private_telebirr_device_evidence(uuid,text,text,text,jsonb,jsonb)
```

Each wrapper dispatches by exact immutable lineage. Ambiguous or missing bindings are rejected.
The original live implementations are renamed to private, ungranted functions and are invoked
unchanged only when the live pilot predicate is enforced. A shadow lease is possible only through
the seven-gate predicate. When neither exact live mode nor exact shadow mode is ready, a valid broker
poll returns the existing empty-queue result and creates no live or shadow attempt.

Lease request keys, proof fingerprints, attempts, observation digests, replay identities, and
completion keys are unique. Retrying an exact request returns the first immutable result; a
conflicting replay is rejected. Assignment persistence locks the attempt, stores the first proposed
signature once, and on an exact body/reference replay returns that first stored signature rather
than replacing it with a later proposal. Device staging and quarantine similarly serialize on the
attempt before deciding first-write versus replay.

## Dedicated verifier process

The shadow process uses only `fetanagent_telebirr_shadow_verifier_runtime`, a non-inheriting,
single-connection runtime that inherits the non-settable
`fetanagent_telebirr_shadow_verifier` group. Its catalog preflight requires exactly four executable
application functions: load staged shadow evidence, load shadow authority, complete a shadow
outcome, and quarantine invalid shadow evidence. It rejects any table/column/sequence access or
any additional reachable routine, including the live completion and financial finalizer.

The runtime uses a distinct database secret path, singleton keys, application name, entrypoint,
health service identity, and loopback port `8092`. The opt-in Compose profile publishes no port,
mounts no Docker socket, runs read-only as UID/GID `10001`, drops every capability, and joins only a
dedicated egress network. The process receives public signer/device pins, not a signer private key,
provider PIN/OTP, bot token, service-role key, executor credential, or KemerBet credential.

## Redacted operations surface

An active Owner may call `app.get_owner_telebirr_shadow_verification_status(uuid)`. Its fixed result
contains only the contract/mode/pilot/switch state, readiness Boolean, aggregate counts for queued,
active, staged, completed, `would_verify`, `would_review`, `would_reject`, and quarantined rows, plus
the check timestamp. It
contains no customer/Player/proof/assignment identifier, transaction reference, digest, signature,
key, evidence body, observed amount, or database detail.

The Owner-control service exposes that projection at authenticated, query-free
`GET /v1/owner/telebirr-shadow-verification/status`. The response is `no-store`; authentication,
adapter, and database failures collapse to the existing fixed Owner-control errors.

Process logs and `/healthz`/`/readyz` are likewise fixed redacted projections. The health listener is
loopback-only and exposes no observation, completion, or generic request endpoint. Shadow log
statuses are only `shadow_completed` or `shadow_not_completed`, and their dispositions remain
`would_verify`, `would_review`, or `would_reject`; live settlement terminology never leaves the
shared verifier's internal classifier.

## Verification and activation boundary

Repository-only checks:

```powershell
pnpm --filter "@fetanagent/trusted-telebirr-verifier..." run build
pnpm --filter @fetanagent/trusted-telebirr-verifier run test
pnpm --filter @fetanagent/sql-integration-tests run build
node infra/verify-telebirr-shadow-verifier-deployment.mjs
pnpm test:sql
```

`pnpm test:sql` requires the repository's disposable PostgreSQL/Docker harness and must pass in CI
before merge. A machine without that engine may run the static and TypeScript checks, but that is
not a substitute for the SQL suite.

Starting the profile, enabling a login, supplying credentials/pins, changing a database switch,
arming a pilot, or sending a Telegram message is a separate Owner-authorized operation. None of
those actions is performed by this change.
