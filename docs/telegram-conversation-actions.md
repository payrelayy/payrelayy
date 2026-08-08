# Telegram conversation actions

## Status: inert database foundation applied; not user-facing

The private Stage 7–11 schema is applied after the inert Player-ID request schema. Stage 11
aligns the inbox recorder with the shared lock order, makes the Telegram user/chat binding
immutable, and retires the old Player-ID event consumer in favor of an ungranted non-claiming
request primitive. It adds no customer-facing action procedure or runtime `EXECUTE` grant. It does
not enable the bot, add a database credential, call KemerBet, validate a Player ID, open a deposit,
or make a payment.

## Why a shared action boundary is required

One Telegram update must have one durable meaning. The inbox records that a private update arrived, but deliberately does not interpret it or change a conversation. The existing deposit procedures each have their own idempotency record. Without a shared receipt, a future buggy API could use one inbound event for more than one action.

The shared boundary must become the sole consumer of an inbound event before any customer-facing action is enabled. It must also stop a stale button from overwriting a newer conversation state. An inbound-event ID by itself is never proof that the customer selected a particular action.

## First action and state

The only proposed initial action is `begin_player_registration` for KemerBet:

```text
empty conversation, version N
  -> awaiting_player_id for KemerBet, version N + 1
```

The database creates the state, expiry, and opaque action ID. Callers must never provide arbitrary conversation JSON, customer IDs, platform UUIDs, validation results, or expiry timestamps. The current `{}` state is treated as a legacy idle projection; the action migration may convert only that shape to one canonical server-owned idle shape and must reject any unknown non-empty legacy state.

```json
{
  "v": 1,
  "kind": "awaiting_player_id",
  "platform_code": "kemerbet",
  "action_id": "opaque UUID",
  "expires_at": "UTC timestamp"
}
```

Only the future stateful procedure may write this object. Callers receive an opaque result, current version, and expiry; they never receive a general conversation-state read.

## Pre-issued action capability

Before the bot renders an actionable button, a future server-side menu operation must create a
private, one-time `app.bot_action_capabilities` record. It is bound to the customer identity,
conversation, controlled action kind, platform, expected conversation version, and a short server
expiry. It contains only a keyed fingerprint of an unpredictable HMAC-derived callback secret, never the secret or raw
callback payload. The capability key is separate from the Telegram transport secret and all
semantic-input keys. The menu operation itself must be a reviewed consumer of a prior inbound event;
the bot may only display an opaque value such as `prc1.<capability-id>.<hmac-derived-token>`.

For an exact root-menu retry, the API deterministically derives the canonical capability ID and
opaque callback token from the recorded inbound-event ID with its dedicated capability key. It
passes that ID, the token fingerprint, and the separate semantic-input HMAC to the future database
issuer in one transaction. PostgreSQL persists only the canonical ID and blinded values; it never
receives the raw callback token or either key.

When Telegram returns the callback, the API first validates that fixed format in trusted memory and
computes the capability-token fingerprint. It passes only the opaque capability ID and fingerprint
to PostgreSQL. The database must lock the capability, prove it belongs to the inbox-derived
customer/conversation/action/version, reject an expired, revoked, or already-consumed capability,
and consume it in the same transaction as the action outcome, including a durable
`active_action_exists` result. A UUID or an inbound-event ID alone is not a valid capability.

The initial start procedure therefore needs this narrow shape:

```text
app.start_telegram_player_registration_action(
  origin_inbound_event_id uuid,
  capability_id uuid,
  capability_token_fingerprint text,
  semantic_input_hmac text
)
```

It still does not accept a generic action code, platform, expected version, state object, or action
ID from Telegram or the API. An exact delivery retry must match the stored consumption receipt; a
new event that presents a consumed capability is rejected.

## Private receipt and action records

`app.inbound_event_consumptions` is an append-only global exactly-once receipt. Its primary key is `origin_inbound_event_id`, linked to `app.inbound_events`.

Each row contains only customer and conversation IDs proven from the inbox identity, controlled
consumer/action codes, expected/before/after versions, a versioned semantic-input HMAC, a terminal
outcome, and safe reason codes/timestamps. Capability, action, and request relationships live in
their own constrained tables rather than as arbitrary receipt payload. It cannot contain raw
callback data, a Player ID, message text, payment references, or an arbitrary JSON request. The
semantic-input HMAC uses a
dedicated versioned key, separate from the capability and transport keys; an old key version must
remain usable for exact-retry comparison throughout inbound-event retention.

`app.bot_conversation_actions` is the durable source of truth for a flow. It contains an action ID, conversation ID, controlled kind/status, platform ID, expected input kind, origin event, server-generated ten-minute expiry, and terminal timestamps. A partial unique index allows only one `awaiting_input` action per conversation. The conversation JSON is merely its safe projection.

Neither table may store raw callback data, message text, Player IDs, payment references, or arbitrary
state JSON. RLS stays enabled and forced, with no direct table access for the bot, API, worker, or
browser clients.

The V1 start procedure resolves KemerBet internally after it has validated the capability's
controlled platform binding. Future platforms require their own reviewed, allowlisted entry point.

Required lock order:

```text
Telegram user/private-chat advisory scope -> inbound event -> customer identity -> customer -> Telegram identity -> active platform -> bot conversation -> action capability -> active action and consumption receipt -> conversation CAS update
```

Stage 11 updates the Stage 5 inbox recorder to take the per-user/private-chat advisory scope before
its existing-event lookup and to use the sequential row-lock order above. Capability issue, revoke,
expiry, and consume paths must also pre-lock their target capability/action records in this order
before updating them; a trigger cannot rearrange PostgreSQL's implicit target-row lock.

After locking the inbound event and its identity, the procedure first looks up the global
consumption receipt. An exact retry returns its saved opaque result before capability or expiry
checks see the already-advanced state. A fresh start request while another flow is active becomes
the durable `active_action_exists` outcome; it must never overwrite the existing flow. A stale or
expired action is handled lazily under the conversation lock. Missing identity, an invalid
capability, or internal inconsistency rolls back without consuming the event. A stale capability is
durably rejected only when it is tied to its own revocation record; malformed Player-ID input is
durably rejected only while a matching active action remains unchanged.

If the active Player-ID action has expired, the next private interaction may only use the dedicated
`expire_player_registration_action` consumer to mark that old action expired and return the
conversation to idle. It must not also interpret that same update as a menu click, callback, or
Player-ID submission. The bot tells the user to start again with a new update.

The compare-and-set operation is inside the same transaction:

```text
UPDATE bot_conversations
WHERE id = resolved_conversation_id
  AND version = previous_server_version
```

On success it writes the consumption receipt, increments the version, marks the inbound event processed, and adds an ID-only audit event. No generic API update grant is allowed.

## Capability and text input

The future bot transport may pass a decoded, tightly allowlisted callback action only after the API
verifies the opaque server-issued capability described above. The capability is bound to the
Telegram customer, conversation, action, expiry, and expected version. It is not a database
credential or raw platform ID.

After the action succeeds, the text-input path uses a _new_ Telegram update and must be one
transaction. It locks that inbound event and the active action/conversation, proves
`awaiting_player_id`, expiry, and that the inbound event was received no earlier than the active
action's server-created timestamp. It also requires the persisted numeric Telegram update ID to be
strictly later than the action-start update ID. This prevents a delayed older message from being
accepted by a later reopened flow. It then sends the Player ID only to a narrow wrapper. That wrapper
must normalize and validate the Player ID again in PostgreSQL, not rely only on API memory. Its
global consumption receipt binds an HMAC of the controlled operation, action ID, capability/context,
expected conversation version, platform, and normalized Player ID. The HMAC is an opaque retry
discriminator; the database independently compares the normalized ID with the linked registration
request before returning an exact retry.

The API must never receive direct `EXECUTE` permission for
`app.request_telegram_player_registration`; Stage 11 retires that legacy consumer. The only
replacement is the ungranted `app.create_or_reuse_player_registration_request` primitive, which
does **not** consume an inbound event. The future conversation-aware wrapper will own global
consumption, the request event link, the audit event, action completion, and the conversation CAS
in one transaction before any activation.

## Terminal capability attempts

A new Telegram update can legitimately present a button whose capability was already consumed,
expired, or revoked. That new update must receive its own durable rejected result; it cannot reuse
or overwrite the terminal capability row. Before the start procedure is implemented, a private
append-only capability-rejection record must link that inbound event, the terminal capability, and
its global consumption receipt. This preserves one-update/one-action semantics without changing
the history of the original capability.

The API-side capability presentation is also deliberately compact: Telegram permits only 1–64 bytes
of inline callback data. The future opaque presentation is `prc1.<22-char-id>.<22-char-token>`
(50 ASCII bytes). The bot only renders this API-supplied value; it never derives IDs, tokens,
fingerprints, or semantic HMACs.

## Compatibility work before activation

Before any action procedure receives `EXECUTE`, every Telegram-originated procedure must join the
shared consumption rule. Stage 7 and Stage 11 revoke direct execution for
`open_telegram_deposit_intent` and `capture_telegram_deposit_reference`; both still require
conversation-aware replacements. The retired Player-ID consumer is also ungranted. All three
paths must be refactored and regression-tested before any replacement wrapper is granted
execution, even though payment verification remains disabled.

The first menu/root-navigation operation must itself become a reviewed receipt consumer that issues
an action capability. There is no free-text or static callback fallback while such an issuer is
missing.

Required tests include duplicate delivery, missing/mismatched/revoked/expired capability, changed
action/HMAC/version, two actions racing for one event, a stale button, an expired flow, arbitrary
events that never selected "Add Player ID", changed Player-ID input on a retried event, concurrent
Player-ID messages, and two customers submitting the same Player ID.

## Explicit non-goals

- No polling, webhooks, callbacks, or free-text parsing.
- No generic API access to inbox or conversation tables.
- No Player-ID validation, KemerBet action, payment verification, or deposit execution.
