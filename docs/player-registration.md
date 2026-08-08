# Non-claiming Player-ID registration

## Status: inert schema applied; not enabled

This document defines the next safe foundation for KemerBet Player IDs. Its private database schema
is applied, but no runtime role can invoke it. It does not call KemerBet and does not make an ID
usable for deposits. A separate reviewed inbound-action/conversation boundary is required before a
Telegram message can create a request.

## Why the existing player table is not an intake table

`app.customer_platform_players` has a unique key on `(platform_id, player_id)`. That is correct for
a future proven destination binding, but it is unsafe for ordinary customer input: the first person
to submit a Player ID could permanently prevent another person from submitting the same ID.

Player-ID existence does not prove that the Telegram customer controls that KemerBet account.
Registration must therefore record a customer request, not an ownership claim.

## Proposed private records

### `app.player_registration_requests`

Each row means: "this customer asked PayReplayy to validate this Player ID for this platform."

Suggested immutable identity fields:

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

## Future API-only procedure

The future procedure should be shaped like:

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

The initial migration deliberately grants this helper to no runtime role. It remains internal even
after the future conversation-action boundary exists. Only a later composed procedure that proves
the customer selected the "Add Player ID" flow and that the inbound event is unconsumed may call
the helper and receive a narrowly scoped API execution grant.

## Transaction and lock order

The procedure must use one transaction and this stable order:

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

The audit event contains request/platform IDs and a reason code only. It must not include the raw
Player ID, message text, KemerBet response, credentials, or a claim that the customer owns the
account.

## Access and privacy

- Keep both records in the private `app` schema with RLS enabled and forced.
- Grant no direct table or sequence access to browser clients, Telegram bot, worker, or API role.
- Use fixed-search-path `SECURITY DEFINER` functions and revoke their default `PUBLIC` execution.
  The registration helper remains ungranted; only the later conversation-aware wrapper may be
  granted execution to `payreplayy_api`.
- The bot never receives database credentials and never invokes KemerBet directly.
- Display reason-code translations in English and Amharic rather than database errors.

## Customer flow after the later transport/action work

1. A private-chat user selects "Add Player ID."
2. The future action boundary moves that private conversation to an expiring, server-issued
   `awaiting_player_id` state.
3. A later single transaction validates that state, records a non-claiming request, consumes the
   inbound event, and clears or advances the conversation.
4. The bot replies: "Player ID saved - pending validation. It cannot be used for a deposit yet."
5. A future controlled adapter reports only `exists`, `not_found`, or `review_required`.
6. Only a separately designed proof/association model may ever promote an ID into a deposit-usable
   binding. Existence lookup alone is insufficient.

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

- validate a Player ID against KemerBet;
- launch a browser or bypass a CAPTCHA/session control;
- open a deposit intent or display payment instructions;
- make a payment-provider call or transfer funds;
- establish account ownership; or
- replace the existing exclusive `customer_platform_players` design without a separate migration
  and review.
