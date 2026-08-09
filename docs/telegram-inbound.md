# Private Telegram invite-admission and inbox boundary

## Current scope

PayReplayy beta admission is **invite-only**. An unknown Telegram user must not become a customer
merely by opening, messaging, or calling the bot. The historic generic
`app.record_telegram_private_inbound_event(...)` procedure therefore is not an admission path: the
invite-admission migration revokes its runtime grant and makes it fail closed.

The only customer-creation path is the reviewed
`app.redeem_telegram_beta_invite(...)` procedure, called after an exact private
`/start <single-use-invite>` interaction has passed the separately signed transport boundary. It
may create the immutable customer identity, Telegram identity, and empty conversation exactly
once. It stores a domain-separated SHA-256 invite-token digest only; raw invite links and tokens
are never persisted, logged, or returned.

`app.record_admitted_telegram_private_inbound_event(...)` remains a reserved procedure for a later
reviewed admitted-inbox boundary. It must never create a customer, identity, or conversation, and
is intentionally ungranted to both beta-admission roles in this stage. No bot polling, API route,
database login, or later inbox path is enabled by this documentation.

## Trust boundary

The Telegram bot is transport only. Before an admission or admitted-inbox procedure can ever be
invoked, the API must verify that an update came from PayReplayy's bot transport, has a real
non-bot sender, and belongs to a private chat. The database cannot prove Telegram chat type by
itself.

The proposed beta admission transport sends only these allowlisted values to the procedure:

- Telegram update ID, user ID, and private-chat ID;
- the fixed English (`en`) locale;
- a domain-separated SHA-256 invite-token digest shaped as
  `sha256-v<version>:<64 lowercase hex>`; and
- an API-generated payload HMAC shaped as `hmac-sha256-v<version>:<64 lowercase hex>`.

It deliberately excludes first name, last name, username, Telegram language metadata, raw invite
tokens, raw message text, callback data, attachments, and all payment or Player-ID material.

The HMAC covers canonical, allowlisted update metadata. It is an integrity and idempotency check;
it is not raw Telegram JSON, a plain body hash, a transaction reference, or a secret stored in the
database. Admission transport authentication uses a distinct key domain from later admitted-inbox
transport. The API must retain each HMAC key version long enough to calculate the same value for a
delivery retry.

## Database safeguards

- Invalid, expired, revoked, used, malformed, or cross-user invites make **zero** customer,
  identity, conversation, inbox, or audit writes.
- The migration refuses the cutover if historical Telegram identities, conversations, or inbound
  events already exist. It locks those tables for the check rather than silently converting a
  legacy generic-inbox population into invite admission.
- The accepted invite redemption is serialized by its token digest and Telegram private scope; an
  exact replay for the same user/chat is idempotent, but it cannot be redeemed by a different user
  or chat.
- Telegram user and private-chat bindings are immutable and checked on every replay.
- A replay with a changed identity, token binding, or HMAC is rejected rather than silently
  attached elsewhere.
- The API has procedure execution only: it cannot directly read or mutate customer, identity,
  inbox, conversation, invite, or audit tables.
- RLS remains enabled and forced on those private tables.
- No Telegram profile value crosses the admission database boundary, so redemption cannot create a
  customer profile from Telegram-supplied display data.

## Transport status and next gates

The historic generic private-inbox transport remains disabled and must not be enabled for the
invite-only beta. It is superseded by a separately signed admission transport and, after
admission, a separately signed admitted-inbox transport. Each requires an independently reviewed
runtime credential, private deployment boundary, nonce/idempotency design, durable outbox, and
BotFather-token rotation before activation. See [telegram-transport.md](telegram-transport.md) for
the transport separation and key-management requirements.

The remaining gates are:

1. Independently review the invite-admission migration in a disposable database before any remote
   database change.
2. Configure only the dedicated `payreplayy_beta_admission` group and its
   `payreplayy_beta_admission_runtime` login scaffold for admission; the generic API group and
   runtime must not execute either admission procedure. Keep its bot secret set separate.
3. Rotate the exposed BotFather token before polling is ever enabled.
4. Wire exact `/start <invite>` handling with durable cross-replica replay protection. Ordinary
   messages, callbacks, Player IDs, attachments, and payments must remain ignored at beta entry.
5. Keep the applied, non-claiming Player-ID request helper ungranted until a conversation-aware
   action boundary can invoke it safely after admission.
6. Keep payment verification, receipt upload, provider lookup, KemerBet execution, and payouts
   disabled until their separate launch gates are satisfied.
