# Non-claiming Player-ID registration

## Status: staged request capture and explicit Owner association boundary

The private staging bot can now record a Player-ID registration request through the reviewed
conversation-action boundary. The Owner-control service can list the bounded KemerBet review queue
and record an existence result. A separate Owner-confirmed association action can then create the
validated `customer_platform_players` binding required by deposit intake. No path calls KemerBet
automatically, opens a deposit, displays payment instructions, or enables a payment switch.

## Why the existing player table is not an intake table

`app.customer_platform_players` has a unique key on `(platform_id, player_id)`. That is correct for
a future proven destination binding, but it is unsafe for ordinary customer input: the first person
to submit a Player ID could permanently prevent another person from submitting the same ID.

Player-ID existence does not prove that the Telegram customer controls that KemerBet account.
Registration must therefore record a customer request, not an ownership claim.

## Applied private records

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

This append-only table records an authenticated Owner decision without copying the raw Player ID:

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
- The bot never receives database credentials and never invokes KemerBet directly.
- Display English reason-code translations rather than database errors.

## Staging customer flow

1. A private-chat user presses an "Add Player ID" button carrying a valid, expiring,
   server-issued capability.
2. The action boundary validates that capability and moves the private conversation to an
   expiring `awaiting_player_id` state.
3. A single transaction validates that state and the new inbound event, records a
   non-claiming request, consumes the event globally, and clears or advances the conversation.
4. The bot replies: "Player ID saved - pending validation. It cannot be used for a deposit yet."
5. The private Owner page lists only pending or review-required KemerBet submissions and can record
   `exists`, `not_found`, `review_required`, or `cancelled` with fixed reason codes.
6. After separately verifying that the Telegram customer controls the account, the Owner must use
   the distinct ownership-confirmation action. That append-only action creates one validated
   customer/platform binding and an audit event. Existence lookup alone remains insufficient.

## Explicit Owner association

`app.player_registration_request_associations` is an append-only link between the reviewed request,
the authenticated Owner, the newly validated player account, and its immutable validation attempt.
The association procedure accepts only the fixed `owner_verified_platform_ownership` reason. It is
idempotent for the same request, rejects an existing platform-wide Player-ID binding, and is
executable only through the narrow Owner-control role. Generic API, bot, worker, admission, and
browser roles have no table access or procedure execution.

This association makes the Player ID structurally eligible for deposit intake. It does not bypass
the still-disabled payment feature switches, missing receiver-account configuration, exact-amount
matching, evidence validation, or dry-run execution boundaries.

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
- open a deposit intent or display payment instructions;
- make a payment-provider call or transfer funds;
- infer account ownership from existence alone; or
- replace the explicit Owner-confirmed association with automatic promotion.
