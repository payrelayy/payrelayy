# Private Telegram action transport

## Status: local-only contract; no action route exists

This document describes the Stage 15B private Player-ID action-envelope contract. It is an
English-only, local test boundary. It does **not** add a Fastify route, a database connection or
grant, a bot handler or polling update, a Telegram webhook, a container deployment, a Player-ID
registration, KemerBet access, a payment flow, or a customer-facing action.

The existing private inbox remains metadata-only. The action contract is deliberately a different
future channel so a metadata inbox nonce, HMAC, parser, or content type can never authenticate a
customer action by mistake.

## Strict envelope

Only three version-1 action kinds are structurally recognized:

| Kind                           | In-memory customer input                       | Current behavior                              |
| ------------------------------ | ---------------------------------------------- | --------------------------------------------- |
| `root_menu`                    | none                                           | Test-only intent to render a future root menu |
| `player_registration_callback` | one compact opaque callback                    | Test-only structural parse only               |
| `player_id_text`               | one bounded, control-character-free text value | Test-only structural parse only               |

Every envelope carries only an update ID, matching private-chat/user IDs, and the fixed locale
`en`. It does not include an original Telegram `Update`, profile fields, payment details,
attachments, database identifiers, customer records, or authority to perform an action.

`player_registration_callback` accepts only the existing 50-byte ASCII opaque presentation
`prc1.<22-char-capability>.<22-char-token>`, which remains below Telegram's 64-byte callback
limit. Raw callbacks and Player ID text are never diagnostic fields. The provided redacted log
projection records only the contract version, action kind, English locale, and whether customer
input was present.

The text parser is intentionally **not** platform validation. It requires nonblank text no longer
than 64 Unicode code points and rejects control characters. A future reviewed private database
wrapper must independently normalize and validate a Player ID, bind it to a durable conversation
action, and own all idempotency and authorization checks.

## Separate transport namespace

The future bot-to-API action envelope is reserved as:

- method and path: `POST /internal/v1/telegram/private-action`;
- MIME type: `application/vnd.payreplayy.telegram-private-action+json`;
- authentication headers: `x-payreplayy-action-*` only;
- signing domain: `payreplayy-bot-api-private-action-v1`; and
- nonce digest input domain: `payreplayy:telegram:private-action:nonce:v1`.

It uses a separately configured `BOT_TO_API_ACTION_HMAC_SECRET`; that key must differ from the
private inbox transport/payload keys and the capability/semantic keys. The verifier authenticates
the exact raw bytes before JSON parsing, rejects duplicate authentication headers, rejects stale
timestamps, and passes only a domain-separated SHA-256 nonce digest to its test-only nonce store.
A durable action nonce store retains the same digest domain and does not use the inbox table or
namespace.

## Default-off configuration and staging exception

All ordinary environments keep these values disabled:

```dotenv
INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED=false
BOT_TO_API_ACTION_BASE_URL=
BOT_TO_API_ACTION_HMAC_SECRET=
```

The bot and API load no action URL or HMAC while the gate is false. The reviewed staging beta
profile is the sole exception: it enables this channel with service-separated file mounts, an
invite-only admission boundary, the dedicated `payreplayy_player_actions_runtime` identity,
durable action-nonce storage, and the existing conversation-aware procedures. That profile can
create only a pending Player-ID request. It cannot validate an ID, contact KemerBet, open a deposit
or withdrawal, or perform a financial action.
