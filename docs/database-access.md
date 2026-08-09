# Private database access boundary

PayReplayy keeps all operational and financial tables in the private `app` PostgreSQL schema.
It is deliberately not exposed through Supabase's Data API. A Telegram bot, browser executor,
dashboard, and customer device must call the PayReplayy API; none may query `app` tables.

## Planned server access

The API and worker will use direct PostgreSQL connections from the DigitalOcean VM. Before they
are enabled, a reviewed migration creates two NOLOGIN group roles: `payreplayy_api` and
`payreplayy_worker`. Each gets only the current operations it needs and its own RLS policies. The
worker cannot change configuration, identity, conversations, or audit records. The current API
role also cannot bootstrap Owners, read the audit log, or change configuration; those capabilities
will require a separate, reviewed admin role and dashboard boundary.

The only planned direct-connection exception is a distinct nonce-retention maintenance identity.
It has its own non-shared credential boundary and can receive only the bounded expired-nonce purge
procedure after a separate deployment review. It must never be used by the API or worker, and it
has no direct table, sequence, inbox, audit, payment, configuration, or customer-data access.

The API role receives only safe receiver-account display columns. The worker alone can read the
encrypted receiver/verification references required for authoritative verification. Both roles use
column-level grants and purpose-specific RLS policies; neither can delete any current `app` table.

The API now has two narrow financial procedures. app.open_telegram_deposit_intent accepts only a
Telegram inbound-event ID, a previously validated Player-account ID, a provider ID, and an ETB
minor-unit amount. It returns the newly frozen receiver display snapshot and deadline so the API
never needs a ledger-table SELECT grant. app.capture_telegram_deposit_reference accepts only an
event ID, an owned intent ID, and pre-encrypted, HMAC-fingerprinted reference material. It records
untrusted input with no verification job, provider evidence, payment claim, or KemerBet action.
Both procedures run only when the payment-verification switch is explicitly live; the current Owner
configuration procedure still deliberately refuses live, so both remain dormant until a later
launch review.

The historic non-financial `app.record_telegram_private_inbound_event` procedure accepted
allowlisted private-update metadata and an API-generated, versioned payload HMAC, but it could
create an identity for an unknown Telegram user. It is incompatible with the invite-only beta.
The beta-admission migration revokes its API grant and makes the legacy entry point fail closed.
Only `app.redeem_telegram_beta_invite` may create an identity, and only
`app.record_admitted_telegram_private_inbound_event` may record a later update for an
already-admitted identity. Neither grants the API direct table access to customer identities,
inbound events, conversations, invite records, or audit events.

Invite admission has its own NOLOGIN `payreplayy_beta_admission` group and
`payreplayy_beta_admission_runtime` scaffold. The group retains only schema usage plus invite
redemption and beta-admission nonce-reservation execution. The admitted-inbox recorder is
intentionally ungranted to both beta roles, and the generic `payreplayy_api` group and its runtime
scaffold must not execute any beta-admission procedure. A future real login can inherit only the
dedicated admission group, cannot `SET ROLE`, and must have a separately mounted TLS database
credential. It is not provisioned or enabled by this repository.

Before a service starts, an operator will create a separate login role for that service, grant it
membership in exactly one group role, and let it inherit only that group role's approved
privileges. The runtime login must not be able to `SET ROLE`. This is done outside Git and without
sharing a password in chat. Application code must never connect as `postgres`, `service_role`,
`anon`, or `authenticated`.

The direct connection URL is a server secret. It belongs only in the runtime secret store for the
API and worker containers. It must never be committed, placed in a shared package, given to the
bot or executor, or displayed in logs.

## Stage 13A API connection preflight

`INTERNAL_POSTGRES_RUNTIME_ENABLED` is deliberately a manual, read-only preflight gate by itself.
It does not run a database pool when the API server starts and it does not change `/readyz`,
Telegram ingress, polling, Player-ID processing, payment verification, or financial actions. The
only exception is the separately default-false Stage 15A private-ingress runtime gate, which also
requires the Telegram transport gate and is described below.

The database migration creates `payreplayy_api_runtime` as a `NOLOGIN` role without a password.
It inherits only the existing `payreplayy_api` group privileges, cannot administer or switch roles,
and is unusable until a separate deployment procedure enables a generated login credential. That
credential belongs exclusively in the API container secret environment.

When a dedicated API runtime login has been provisioned, an operator may explicitly run:

```text
pnpm --filter @payreplayy/api db:preflight
```

only with `INTERNAL_POSTGRES_RUNTIME_ENABLED=true` and an API-only TLS database URL. The command
opens a short `READ ONLY` transaction, sets local timeouts and a `pg_catalog` search path, checks
only boolean capability facts, rolls the transaction back, and closes its pool. The existing generic
API preflight must verify that its connection resolved to the designated non-admin runtime login,
has exactly the expected non-switchable group membership, and **cannot** execute the retired generic
inbox recorder or either beta-admission procedure. It must prove nonce and admission procedures
remain inaccessible to broad database roles, has no direct privilege of any kind on identity, inbox,
conversation, invite, audit, or nonce tables, and still cannot execute any Player-ID action wrapper.
A separate, later beta-admission preflight must verify the dedicated role's redemption and nonce
reservation grants while proving both inbox recorders remain denied; neither command logs a
connection URL, database username, SQL text, or database error detail.

For the DigitalOcean VM, use the current direct PostgreSQL connection when its supported network
path is available; otherwise use the Supabase session pooler for the long-lived API process. The
API parser accepts only `db.xzztugbgtulptnbpoelr.supabase.co` with the bare
`payreplayy_api_runtime` login, or `aws-0-eu-west-1.pooler.supabase.com` with
`payreplayy_api_runtime.xzztugbgtulptnbpoelr`. Both forms require port `5432`, database
`postgres`, and exactly `sslmode=verify-full`. Take the exact dedicated-login URL from the project
Connect panel rather than constructing it by hand. The transaction pooler is not the default for
this persistent process.

## Stage 13B private Telegram nonce reservation

Stage 13B adds a private, forced-RLS table for short-lived one-way digests of authenticated
Telegram ingress nonces. The only operation granted to the API group is a fixed-search-path
procedure that atomically inserts a digest once; a duplicate returns `false` and never extends its
expiry. The table has no direct runtime privileges, and its unassigned cleanup helper has no
runtime grant.

This is replay protection only. It does not create an inbox event, customer, conversation, action,
audit event, payment, KemerBet request, or database credential. The TypeScript adapter has no
connection until all three Stage 15A configuration gates are explicitly enabled, the runtime login
has separately been provisioned, and an authenticated request reaches the private route. A later
reviewed activation stage must reserve the nonce in a committed operation before calling the inbox
recorder, so recorder failure cannot roll back replay protection.

## Stage 13C historical private Telegram inbox recorder

Stage 13C added an API-only adapter for the historic
`app.record_telegram_private_inbound_event(...)` routine. It must remain uncomposed and disabled.
The invite-only beta replaces its creation behavior with a dedicated invite-redemption procedure;
the generic recorder is unavailable to every runtime login. A later admitted-inbox adapter may
record only an already-admitted identity. Neither adapter may create a pool or load a credential
by itself, and neither is called by health, readiness, or preflight.

## Stage 15A historical private Telegram ingress runtime composition

The reviewed historical nonce and generic-recorder adapters are technically composed only when all
three API gates are true:

1. `INTERNAL_POSTGRES_RUNTIME_ENABLED=true` with the dedicated, TLS-verified API runtime URL;
2. `INTERNAL_TELEGRAM_INGRESS_ENABLED=true` with both API-side transport HMAC secrets; and
3. `INTERNAL_TELEGRAM_PRIVATE_INGRESS_RUNTIME_ENABLED=true`.

The third gate defaults to `false` and rejects configuration unless the first two prerequisites are
already valid. `INTERNAL_POSTGRES_RUNTIME_ENABLED` therefore remains preflight-only when the third
gate is false. Even when all three are true, this historical path is not approved for the
invite-only beta and must not be activated. The beta needs its own separate admission runtime
login, signed transport, replay guard, and database procedures. This does not enable bot polling,
public ingress, Player-ID handling, payment verification, or financial actions. The inactive
Compose contract sets all existing gates to `false`.

## Stage 14B nonce-retention maintenance scaffold

Stage 14B assigns the existing bounded purge helper only to a dedicated `payreplayy_nonce_retention`
group role and creates its separate `NOLOGIN` runtime scaffold. Neither role can access a base table,
identity, inbox, audit record, payment record, configuration object, or any other `app` function.
The future runtime can inherit only the group role's schema usage and one
`app.purge_expired_telegram_private_ingress_nonce_reservations(integer)` execution grant; it cannot
`SET ROLE` or administer membership.

The database owner also has no default `PUBLIC EXECUTE` grant for future functions anywhere in this
database. Each new routine must receive an explicit reviewed execution grant; an implicit callable
function is not an acceptable private-schema boundary.

This is not a running cleanup service. It creates no password, database connection, scheduler,
container, feature-switch change, API wiring, or Telegram activation. Stage 14C adds only a
standalone, manual, catalog-only preflight command. It always uses a read-only transaction, never
invokes the purge, and is not part of the API, worker, Docker, or Telegram processes. Before ingress
can be enabled, a separately reviewed maintenance-only deployment must provision a unique TLS
database credential outside Git, run that preflight, invoke the purge with a bounded limit of no
more than 1,000 rows per call, retain safe count-only telemetry, and have an explicit alert and stop
procedure. The API and worker must never receive this cleanup grant or credential.

Supabase service-role keys are not part of the PayReplayy runtime design and must never be stored
in this workspace, a bot, a browser profile, or application configuration. A future private
Storage ingestion/download boundary will be reviewed independently; it must not gain app-schema
access.

## Required authorization boundary

The API authenticates an Owner or Administrator before it invokes a configuration procedure. A
database procedure receives an audited actor ID only after that server-side check; browser and
bot clients never receive a database credential. The first Owner is provisioned once through a
separate deployment-only procedure after their Supabase Auth user has been verified.

## Sensitive-data rules

- `audit_events.metadata` contains only action-specific allowlisted fields such as IDs, versions,
  non-sensitive reason codes, and counts. It must never include raw receipts, transaction IDs,
  withdrawal codes, payout destinations, credentials, tokens, or full provider responses.
- A bot conversation stores only flow state, locale, expiration, and IDs. It must not store a raw
  transaction ID, withdrawal code, payout account, or attachment content.
- A Telegram inbound record stores an API-generated HMAC and safe update metadata only. It must
  never store raw message text, callback data, full Telegram JSON, transaction IDs, or file data.
- Customer submissions and provider results use dedicated private ledger tables with a documented
  retention policy. Receipt uploads remain deferred until a reviewed API-to-private-Storage
  ingestion boundary can validate the object and authorize a download without exposing it.
- Receiver account references are stored as encrypted values plus a masked display value. A
  replacement creates a new version; existing deposit intents will snapshot the selected version.

## Current safety state

The core and ledger migrations provide private deposit intake, untrusted receipt metadata,
authoritative provider-evidence records, exact one-to-one payment claims, expiry, review, and
queue foundations. They grant neither runtime role direct ledger-table access, create no KemerBet
execution record, and provide no wallet/bank payout capability. The API has only the narrow,
live-gated intake procedure described above; the payment-claim function remains ungranted to every
runtime role. The API can also record an encrypted, untrusted customer transaction reference
through the separate capture procedure, but it cannot enqueue verification or change the intent to
verified. All live feature switches are still rejected by the Owner configuration procedure, and
the executor is physically incapable of a final KemerBet transfer in this release.
