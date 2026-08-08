# Private Telegram transport

## Status: scaffolded and disabled

The bot-to-API path is intentionally not a production service yet. Both of these settings default
to `false`:

- `TELEGRAM_BOT_ENABLED` controls long polling in the bot process.
- `INTERNAL_TELEGRAM_INGRESS_ENABLED` controls registration of the internal API route.

The current application has no direct PostgreSQL runtime login and no database-backed inbox
recorder. Stage 13B provides a private durable nonce-reservation schema and an unconnected API
adapter, but no server startup code constructs it. The API therefore refuses to start the ingress
route in production with its test-only in-memory nonce store, and refuses it in every environment
unless a recorder is explicitly supplied. Do not enable either setting in a deployed environment.

No payment, KemerBet, Player-ID validation, receipt, attachment, or withdrawal action is reachable
through this transport.

## Process boundary

The bot is a private-chat transport only. It reduces a grammY message to this exact allowlisted DTO:

- Telegram update ID;
- Telegram user ID and matching private-chat ID;
- first name, optional last name, optional username; and
- the fixed English (`en`) locale, regardless of Telegram's language code.

It never forwards a Telegram `Update`, message text, captions, callback data, media, file IDs,
payment references, or customer-entered financial data. The reducer rejects non-private chats,
bot senders, missing senders, mismatched user/chat IDs, and unsafe numeric identifiers.

The bot sends the reduced JSON bytes to the API's fixed internal route:

`POST /internal/v1/telegram/private-inbound`

Only a Docker-private origin is permitted for a production bot configuration:

`http://api:3000/`

The route is not a public browser endpoint and must not be proxied to the public internet.

## Authentication and replay resistance

The bot signs the exact raw request body using a dedicated 32-byte HMAC secret. The signature
covers a fixed protocol version, HTTP method, fixed path, key ID, timestamp, nonce, byte length,
and SHA-256 digest of the raw bytes. The API rejects requests with an unexpected method, URL,
content type, content encoding, duplicate authentication headers, stale/future timestamp, invalid
nonce/signature, changed bytes, or fields outside the DTO allowlist. It authenticates before JSON
parsing and does not log the body.

The API must reserve each accepted nonce atomically through its expiry in a durable shared store
before recording the event. Stage 13B reserves only a domain-separated SHA-256 digest of the nonce;
it stores no raw nonce, Telegram event, customer, payment, or credential data. The adapter is
present but deliberately unconnected. An in-memory implementation exists only for tests and local
scaffolding; it is rejected in production. The later recorder must call
`app.record_telegram_private_inbound_event(...)` with an API-generated, versioned payload HMAC.
The database update ID remains the durable idempotency key.

With the current 60-second timestamp skew limit, the adapter accepts a reservation window no
longer than 120 seconds. The database permits up to three minutes only to tolerate normal API and
database clock differences; it does not make a nonce valid for longer than the transport protocol.

The bot makes at most two attempts for a retryable transport failure (timeout, 408, 429, or 5xx),
using a new nonce for every attempt. If both attempts fail, it tells the customer that PayReplayy
could not receive the request. It does not show a success-style reply and has no durable bot outbox
yet.

## Secrets

| Process           | Allowed secrets                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Bot               | BotFather token, `BOT_TO_API_INGRESS_HMAC_SECRET`                                              |
| API               | `BOT_TO_API_INGRESS_HMAC_SECRET`, `API_TELEGRAM_PAYLOAD_HMAC_SECRET`, later API database login |
| Worker / executor | Neither Telegram secret nor BotFather token                                                    |

Each process needs a separate production secret mount. Do not use a shared `.env` file, place a
secret in Git, or use the Telegram token as an internal API secret.

## Key rotation

Version 1 deliberately supports one fixed transport key and one fixed payload-HMAC key. Do not
rotate either key while an inbox replay may occur. A future rotation design must retain prior
payload-HMAC versions long enough to reproduce database idempotency values, and must accept a
bounded active/previous transport key set. Until that design and its tests exist, key rotation is a
production launch blocker.

## Remaining launch gates

1. Provision the API runtime login and a narrow recorder implementation for the private inbox
   procedure.
2. Wire the reviewed durable, cross-replica atomic nonce reservation adapter only alongside that
   reviewed recorder and a private deployment boundary.
3. Add a durable bot outbox before relying on automatic delivery beyond the two immediate attempts.
4. Deploy bot and API on a private Docker network; use long polling in exactly one bot replica and
   do not mix it with Telegram webhooks.
5. Add reviewed conversation/inbound completion procedures before interpreting customer commands.
6. Keep Player-ID registration, payment verification, provider access, KemerBet execution, and all
   financial actions behind their separate reviewed launch gates.
