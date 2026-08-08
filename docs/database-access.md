# Private database access boundary

PayReplayy keeps all operational and financial tables in the private `app` PostgreSQL schema.
It is deliberately not exposed through Supabase's Data API. A Telegram bot, browser executor,
dashboard, and customer device must call the PayReplayy API; none may query `app` tables.

## Planned server access

The API and worker will use direct PostgreSQL connections from the DigitalOcean VM. Before they
are enabled, a separate reviewed deployment migration must create least-privilege database roles
for those services and grant only the operations each service needs. That migration must include
the applicable RLS policies. Until then, the core schema intentionally has no runtime database
role with access.

The direct connection URL is a server secret. It belongs only in the runtime secret store for the
API and worker containers. It must never be committed, placed in a shared package, given to the
bot or executor, or displayed in logs.

The Supabase service-role key is not an application-database credential. If used later, it is
limited to server-side Supabase Auth or private Storage administration. It must not be used to
query or mutate the `app` schema.

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
- Customer submissions and provider results will be stored in dedicated later tables with a
  documented retention policy. Receipt uploads stay in the private `payment-evidence` bucket;
  the API authorizes any signed download URL.
- Receiver account references are stored as encrypted values plus a masked display value. A
  replacement creates a new version; existing deposit intents will snapshot the selected version.

## Current safety state

The core migration creates no deposit request, verification, provider evidence, KemerBet
execution, or payout table. All live feature switches are rejected by the database procedure, and
the executor is physically incapable of a final KemerBet transfer in this release.
