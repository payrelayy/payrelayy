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

Before a service starts, an operator will create a separate login role for that service, grant it
membership in exactly one group role, and configure the process to assume that group role after
connecting. This is done outside Git and without sharing a password in chat. Application code
must never connect as `postgres`, `service_role`, `anon`, or `authenticated`.

The direct connection URL is a server secret. It belongs only in the runtime secret store for the
API and worker containers. It must never be committed, placed in a shared package, given to the
bot or executor, or displayed in logs.

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
