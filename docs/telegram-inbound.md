# Private Telegram inbox boundary

## Current scope

`app.record_telegram_private_inbound_event` is the database boundary for a Telegram update
that has already been authenticated and classified as a private chat by the PayReplayy API. It:

- creates or finds the immutable Telegram customer identity;
- creates an empty bot conversation without changing its state;
- writes one inbox record per Telegram update ID; and
- returns safe internal IDs, statuses, locale, and whether the update was already recorded.

It does not start polling, receive full Telegram JSON, save message text or callback data, accept
payment proof, validate a Player ID, open a deposit, contact a provider, invoke KemerBet, or pay
anyone. The bot and private-ingress runtime gates remain disabled by default; no runtime database
login is enabled or deployed.

## Trust boundary

The Telegram bot is transport only. Before the procedure can ever be invoked, the API must verify
that the update came from PayReplayy's bot transport, has a real sender, and belongs to a private
chat. The database cannot prove Telegram chat type by itself.

Only the API sends these allowlisted values to the procedure:

- Telegram update ID, user ID, and private-chat ID;
- bounded Telegram profile metadata and the fixed English (`en`) locale; and
- an API-generated value shaped as `hmac-sha256-v<version>:<64 lowercase hex>`.

The HMAC covers canonical, allowlisted update metadata. It is an integrity and idempotency check;
it is not raw Telegram JSON, a plain body hash, a transaction reference, or a secret stored in the
database. The API must retain each HMAC key version long enough to calculate the same value for a
delivery retry.

## Database safeguards

- The procedure serializes each update ID before creating any identity records.
- Telegram user and private-chat bindings are immutable and checked on every replay.
- A replay with a changed identity or HMAC is rejected rather than silently attached elsewhere.
- The API has procedure execution only: it cannot directly read or mutate customer, identity,
  inbox, conversation, or audit tables.
- RLS remains enabled and forced on those private tables.
- Customer display names are set only at first registration. Later Telegram profile refreshes
  update only Telegram-owned profile fields.

## Transport status and next gates

The signed private bot-to-API transport scaffold now exists. It forwards only the allowlisted
metadata above, authenticates exact request bytes before parsing, and is disabled by default. The
durable nonce-reservation schema and API-only inbox-recorder adapter are composed only when
`INTERNAL_POSTGRES_RUNTIME_ENABLED`, `INTERNAL_TELEGRAM_INGRESS_ENABLED`, and
`INTERNAL_TELEGRAM_PRIVATE_INGRESS_RUNTIME_ENABLED` are all true. The nonce layer retains only a
short-lived digest; the recorder can call only this procedure with allowlisted metadata and never
reads a base table. The transport cannot be enabled in production until a reviewed runtime
credential, private deployment boundary, and durable outbox exist. See
[telegram-transport.md](telegram-transport.md) for the precise boundary, secrets, retry behavior,
and key-rotation limitation.

The remaining gates are:

1. Configure a separate API runtime login and a separate bot runtime secret set; neither may
   receive the other service's credentials.
2. Wire the reviewed durable cross-replica nonce guard and recorder only together, with separate
   committed database operations in that order.
3. Add a shared, conversation-aware inbound-action/CAS boundary before interpreting customer
   actions. It must become the global exactly-once receipt, not restore generic table DML. See
   [telegram-conversation-actions.md](telegram-conversation-actions.md).
4. Keep the applied, non-claiming Player-ID request helper ungranted until that conversation-aware
   boundary can invoke it safely before any KemerBet validation.
5. Keep payment verification, receipt upload, provider lookup, KemerBet execution, and payouts
   disabled until their separate launch gates are satisfied.
