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
anyone. The bot remains disabled by default and no runtime database login exists yet.

## Trust boundary

The Telegram bot is transport only. Before the procedure can ever be invoked, the API must verify
that the update came from PayReplayy's bot transport, has a real sender, and belongs to a private
chat. The database cannot prove Telegram chat type by itself.

Only the API sends these allowlisted values to the procedure:

- Telegram update ID, user ID, and private-chat ID;
- bounded Telegram profile metadata and normalized `en` or `am` locale; and
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

## Required next gates

1. Configure a separate API runtime login and a separate bot runtime secret set; neither may
   receive the other service's credentials.
2. Add a signed, private bot-to-API transport that validates timestamp, nonce, and exact request
   bytes before parsing an update.
3. Add narrow procedures for marking an inbound event processed or failed and for advancing a
   conversation with an expected version. Do not restore generic table DML.
4. Add a reviewed, non-claiming Player-ID registration request before any KemerBet validation.
5. Keep payment verification, receipt upload, provider lookup, KemerBet execution, and payouts
   disabled until their separate launch gates are satisfied.
