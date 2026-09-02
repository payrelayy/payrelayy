# Player-ID request and ownership-association boundary

The [Telegram-first release scope](real-money-go-live-phases.md#telegram-first-release-scope--2026-09-03)
supersedes this document's earlier web-first delivery order. The bot is the initial customer entry;
web signup, web Player-ID proof, and web account linking are deferred. The historical boundaries
below describe their named components, not a current deployment inventory. The approved
provider-specific deposit contracts still determine which target and eligibility checks apply.

## Status: web request capture plus legacy staged ownership-association boundary

The private staging bot can record a Player-ID request through the reviewed conversation-action
boundary. The private staging operations service can list the bounded KemerBet review queue and
record an existence result. A distinct authenticated ownership-association action can then create
the legacy validated `customer_platform_players` binding. That association records ownership only;
it no longer grants deposit eligibility. This is existing Telegram staging behavior, not the
canonical standalone web/PWA customer experience. No path calls KemerBet automatically, promotes
financial eligibility, opens a deposit, displays payment instructions, or enables a payment switch.

## Deferred standalone customer flow

The responsive web/PWA uses `Add a Player ID`, not `Player-ID registration` or `pending validation`,
in customer copy:

1. A signed-in customer adds an existing KemerBet Player ID without providing a KemerBet password,
   OTP, recovery code, or browser session.
2. FetanAgent creates a non-claiming request and displays `Checking`.
3. An existence result remains insufficient; a separately reviewed control must prove the
   customer-to-player-account association.
4. A successful proof-bearing association remains non-financial. The separate reviewed Owner
   boundary must explicitly approve the player account for deposit eligibility; that command does
   not run automatically from proof success.
5. Only a player account with both proven ownership and current financial eligibility may display
   `Ready`; a negative or closed ownership result displays `Could not confirm`.
6. A customer may retain multiple `Ready` Player IDs and chooses one for each deposit or
   withdrawal. Each new deposit snapshots the exact eligibility decision used by its guard.
7. Removal or reassignment preserves history and must not reveal whether the same Player ID was
   submitted or associated by another customer.

The web/PWA account and non-claiming Player-ID submit/list boundaries now exist in source but remain
disabled and undeployed. Web ownership proof and association/deposit eligibility are not implemented
or enabled. A web-origin request cannot reach `Ready` until a later proof-bearing association
boundary is reviewed and implemented. The pure
`@fetanagent/customer-web-player-ownership-proof-prerequisite` package records why that phase is
blocked; it does not implement proof or change customer behavior. See
[customer-web-player-ownership-proof.md](customer-web-player-ownership-proof.md) and
[standalone-web-pwa.md](standalone-web-pwa.md).

## Standalone web implementation boundary

The customer web server verifies the Supabase Auth session, then passes only that Auth UUID through
the `CustomerWorkspacePort`. The dedicated `@fetanagent/customer-web-workspace-runtime` is a
direct-PostgreSQL BFF adapter with a one-connection pool and an exact catalog/privilege preflight. It
can execute only:

```text
app.ensure_customer_web_account(uuid)
app.submit_customer_web_player_registration(uuid, uuid, text)
app.list_customer_web_player_registrations(uuid, integer)
```

Those functions:

- create or replay one immutable Supabase Auth UUID-to-customer mapping without accepting email,
  Telegram identity, or a browser-supplied customer UUID;
- submit or naturally replay one bounded, non-claiming KemerBet Player-ID request using a
  server-generated UUIDv4 request key; and
- list only requests recorded through the caller's immutable web identity mapping.

The runtime has no direct table or sequence access and no unrelated function access. The public
projection has exactly three labels: `Checking`, `Ready`, and `Could not confirm`. Internal pending,
existence-found, and review-required states remain `Checking`; negative or closed states become
`Could not confirm`. `Ready` requires the request to remain in the positive existence state, an
aligned active/valid same-customer association and active platform, plus a contiguous latest
`eligible` decision whose time is not in the future and whose player-state snapshot still matches.
Missing, revoked, stale, or malformed eligibility remains `Checking`. `Ready` is still unreachable
for web-origin requests because their proof-bearing association boundary is absent; an Owner-only
eligibility command cannot substitute for ownership proof. The list is an advisory projection, not a financial authorization check; every new
intent independently rechecks and snapshots eligibility. This slice cannot validate ownership,
promote deposit eligibility, open a deposit, or perform any financial action. It is customer-only;
shared staff capability routing through the generic public entry remains a future boundary.

## Dormant web ownership-proof prerequisite

The repository has not selected an authoritative KemerBet control signal, challenge profile,
challenge delivery path, evidence profile, or evidence-verification protocol. Consequently no
positive web ownership result is representable. The pure
`@fetanagent/customer-web-player-ownership-proof-prerequisite` package returns only
`blocked / customer_web_player_ownership_proof_prerequisites_incomplete` for its exact metadata and
pins these nine ordered `remainingBlockers`:

1. `authoritative_platform_control_signal_unproven`
2. `challenge_profile_unselected`
3. `challenge_delivery_path_unselected`
4. `evidence_profile_unselected`
5. `evidence_freshness_replay_attempt_and_abuse_policy_unreviewed`
6. `verification_adapter_absent`
7. `neutral_staff_proof_review_capability_absent`
8. `ownership_conflict_recovery_and_reassignment_policy_unreviewed`
9. `owner_deposit_eligibility_decision_required`

The prerequisite package adds no proof input, customer route, UI, staff workflow, provider adapter,
database record, schema change, grant, role, runtime configuration, deployment wiring, association,
`Ready` projection, deposit eligibility, or financial action. Its contract version 3 keeps all 19
capability flags false. The existing web-origin association rejection and exact three-function
ownership/account surface remain unchanged. The customer-web role now has three additional
default-off deposit-intake/status functions, but they cannot create ownership or eligibility and
cannot accept a write unless the independent financial/source switches are locked live.

A later proof-bearing implementation must record non-financial ownership independently from deposit
eligibility. Only a separate financial review may promote a proven ownership fact to a
deposit-eligible binding. See
[customer-web-player-ownership-proof.md](customer-web-player-ownership-proof.md).

## Why the existing player table is not an intake table

`app.customer_platform_players` has a unique key on `(platform_id, player_id)`. It records a
validated ownership association, but it is no longer sufficient for new deposit intake. It remains
unsafe for ordinary customer input: the first person to submit a Player ID could permanently
prevent another person from submitting the same ID.

Player-ID existence does not prove that the requesting customer controls that KemerBet account.
The request flow must therefore record customer input, not an ownership claim.

## Applied private records

### `app.customer_auth_identities`

This append-only table binds one server-verified Supabase Auth UUID to exactly one FetanAgent
customer and its `supabase_auth` customer identity. The Auth UUID, customer, and identity binding is
immutable; neither email nor Telegram identity is accepted by the web procedures.

### `app.customer_web_player_registration_request_origins`

This append-only receipt binds one server-generated request key and one Player-ID request to the
caller's immutable Auth identity. Exact transport replay is idempotent, and a natural replay of the
same customer/platform/Player-ID does not grow the origin or audit ledgers. The origin record never
asserts ownership and is the database gate that keeps web-origin requests out of the current
association path.

### `app.player_registration_requests`

Each row means: "this customer asked FetanAgent to validate this Player ID for this platform."

The applied immutable identity fields are:

- `id` UUID primary key;
- `customer_id` and `platform_id` foreign keys;
- `player_id` as bounded, trimmed submitted text with no whitespace or control characters;
- `status` with `pending_validation`, `exists`, `not_found`, `review_required`, or `cancelled`;
- a `pending_validation` initial state enforced by the database; and
- creation/update timestamps.

The only uniqueness rule is:

```text
(customer_id, platform_id, player_id)
```

There must be **no** unique key on `(platform_id, player_id)`. Two different customers may submit
the same Player ID without learning about each other.

The customer, platform, and Player-ID binding is immutable. A later controlled validator can only
change validation-state fields; it must never turn an existence result into an ownership assertion.

### `app.player_registration_request_events`

This private event link makes the Telegram action idempotent:

- `origin_inbound_event_id` is a non-null primary key and references `app.inbound_events`;
- `player_registration_request_id` is non-null and references the request; and
- a timestamp records the link.

The link lets the system distinguish a retry of the same Telegram update from a different update
that repeats the same Player ID. It must not store raw message text.

### `app.player_registration_request_reviews`

This append-only table records a decision by the authenticated internal Owner role without copying
the raw Player ID:

- `exists` and `not_found` mean only that the Owner recorded a manual platform lookup;
- `review_required` means provider evidence is still required; and
- `cancelled` closes an invalid or abandoned request.

The database allows `pending_validation` to move to any of those four outcomes. A
`review_required` request may later move to `exists`, `not_found`, or `cancelled`. Existence,
not-found, and cancelled outcomes are terminal. Exact retries return the original review receipt
without writing a second review or audit event.

## Request helper and staging wrapper

The applied internal helper is shaped like:

```text
app.request_telegram_player_registration(
  origin_inbound_event_id uuid,
  platform_code text,
  player_id text
)
```

It derives the customer solely from the existing private Telegram inbound event. It must never
accept a caller-supplied customer ID, Telegram user ID, validation result, or KemerBet credential.

Its safe response should contain only:

- the opaque registration-request ID;
- the request status;
- whether the current inbound event was already handled; and
- whether an existing request for this customer/platform/Player-ID was reused.

The API already has the submitted Player ID, so the procedure does not need to return it. It looks
up the canonical platform internally from its code; callers must not select arbitrary platform UUIDs.

The internal helper remains ungranted. The staging runtime invokes only
`app.submit_telegram_player_registration_input`, which proves the customer selected a valid,
server-issued "Add Player ID" capability and that the inbound event is unconsumed. That composed
wrapper owns global event consumption and the final request-event link.

## Transaction and lock order

The applied helper uses one transaction and this stable order:

```text
inbound event -> Telegram identity/customer -> platform ->
per-customer/platform/Player-ID advisory lock -> request/event link
```

It must:

1. lock and validate the recorded Telegram inbound event, its Telegram identity, and active
   customer status;
2. require an active platform;
3. trim input, reject empty/control-character/overlong values, and preserve leading zeros and
   case until that platform has an explicit canonicalization contract;
4. take an advisory transaction lock scoped to the customer, platform, and submitted ID;
5. return an identical existing event link only when the semantic platform/Player-ID input matches;
6. reject a reused inbound event with different input;
7. reuse an existing request for the same customer/platform/ID, or create a new one; and
8. create the unique event link and an append-only customer audit event atomically.

The audit event contains request/platform IDs and controlled platform-code/status/reuse metadata
only. It must not include the raw Player ID, message text, KemerBet response, credentials, or a
claim that the customer owns the account.

## Access and privacy

- Keep both records in the private `app` schema with RLS enabled and forced.
- Grant no direct table or sequence access to browser clients, Telegram bot, worker, or API role.
- Use fixed-search-path `SECURITY DEFINER` functions and revoke their default `PUBLIC` execution.
  The registration helper remains ungranted. Staging grants only the conversation-aware wrapper to
  the dedicated `fetanagent_player_actions` group; the generic API role remains denied.
- Grant the dedicated `fetanagent_customer_web` group execute access only to the three standalone
  web functions. Its runtime identity uses direct PostgreSQL from the server-side BFF and has no
  base-table, sequence, schema-create, Data API, or unrelated procedure access.
- The bot never receives database credentials and never invokes KemerBet directly.
- Display English reason-code translations rather than database errors.

## Legacy Telegram staging flow

1. A private-chat user presses an "Add Player ID" button carrying a valid, expiring,
   server-issued capability.
2. The action boundary validates that capability and moves the private conversation to an
   expiring `awaiting_player_id` state.
3. A single transaction validates that state and the new inbound event, records a
   non-claiming request, consumes the event globally, and clears or advances the conversation.
4. The existing bot uses legacy `pending validation` copy. That wording must not be reused by the
   standalone customer product; the canonical web status is `Checking`.
5. The private staging operations page lists only pending or review-required KemerBet submissions
   and can record `exists`, `not_found`, `review_required`, or `cancelled` with fixed reason codes.
6. After separately proving that the Telegram customer controls the account, the authenticated
   internal Owner role must use the distinct ownership-confirmation action. That append-only action
   creates one validated customer/platform binding and an audit event. It does not create a deposit
   eligibility decision. Existence lookup alone remains insufficient.

## Explicit internal ownership association

`app.player_registration_request_associations` is an append-only link between the reviewed request,
the authenticated internal Owner role, the newly validated player account, and its immutable
validation attempt.
The association procedure accepts only the fixed `owner_verified_platform_ownership` reason. It is
idempotent for the same request, rejects an existing platform-wide Player-ID binding, and is
executable only through the narrow Owner-control role. Generic API, bot, worker, admission, and
browser roles have no table access or procedure execution.

This association records only the legacy ownership binding. It does not insert into
`app.player_deposit_eligibility_decisions`, make the Player ID eligible for a new intent, display
`Ready`, or bypass any payment safeguard.

The database rejects this association when the request has a web-origin receipt. A future reviewed
migration may introduce a proof-bearing web association path only after the prerequisite blockers
are resolved. That path must remain non-financial; a separate promotion boundary must create any
later eligibility decision before the player account can become financially usable. The current
request cannot become `Ready` or deposit-eligible.

## Private deposit-eligibility quarantine

`app.player_deposit_eligibility_decisions` is a separate append-only financial ledger. Each row
binds one player account to a caller-supplied exact next `decision_version`, an `eligible` or
`revoked` decision, its paired fixed reason code (`financial_eligibility_approved` or
`financial_eligibility_revoked`), an `admin`, `system`, or `worker` actor with the required
admin-ID shape, and decision/create timestamps. The insert trigger
`player_deposit_eligibility_decisions_enforce_insert` calls
`app.enforce_player_deposit_eligibility_decision_insert()`, locks the player row, and enforces
sequential versions. The immutable and no-truncate triggers reject updates, deletes, and truncation
through `app.reject_player_deposit_eligibility_decision_mutation()`.

Every new `app.deposit_intents` row is guarded by
`app.require_player_deposit_eligibility_for_intent()`. The
`deposit_intents_enforce_player_deposit_eligibility` trigger locks the selected player row, reads
its latest decision by version, requires `eligible`, and replaces any caller-supplied
`player_deposit_eligibility_decision_id` with that exact decision ID. A composite foreign key keeps
the snapshot attached to the same player account.
`app.enforce_deposit_intent_eligibility_snapshot_immutable()` keeps the snapshot immutable after
insert. Existing legacy intents may retain a null snapshot; they are not evidence that a current
eligibility decision exists. A later `revoked` decision blocks subsequent intents without
rewriting prior ones.

This ledger and guard are financial quarantine only. There is no seed, backfill, promotion
procedure, decision-writing role grant, runtime adapter, application route, staff button, provider
call, or feature-switch change. The fixed customer list projection may only reduce the private state
to the three public labels and cannot write or expose a decision. No ownership association
automatically creates an `eligible` row, so the repository still has no positive ownership proof,
no promotion path, no reachable customer `Ready`, and no enabled deposit capability. The private
table has enabled and forced RLS, no policy, and explicit revocations for public, Data API, service,
and application runtime roles.

Before any future existence lookup, add per-customer and platform-wide abuse limits. A Player-ID
validator must not become an account-enumeration or spam mechanism.

## Retention

Player IDs are private operational data, not payment evidence. Pending and accepted requests stay
private while the customer needs them for future support or a separately approved association flow.
Cancelled and negative requests require an explicit future retention/purge procedure; nothing in
this stage silently deletes, exports, or exposes Player IDs. That procedure must remove the event
link safely only after the related inbound-event retention policy has been designed.

## Explicit non-goals

This stage must not:

- automate a KemerBet lookup or treat an Owner-recorded existence result as ownership;
- launch a browser or bypass a CAPTCHA/session control;
- associate a web-origin request or report it as `Ready` without proof;
- open a deposit intent or display payment instructions;
- make a payment-provider call or transfer funds;
- infer account ownership from existence alone; or
- treat ownership association as deposit eligibility or add automatic promotion.
