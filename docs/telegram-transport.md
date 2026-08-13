# Private Telegram transport and invite admission

## Status: legacy generic inbox scaffold is disabled

The historic generic bot-to-API inbox path is intentionally not a production service. It must stay
disabled for the invite-only beta because it can reach a database routine that historically
auto-created an identity for an unknown Telegram user. These settings all default to `false`:

- `TELEGRAM_BOT_ENABLED` controls long polling in the bot process.
- `INTERNAL_POSTGRES_RUNTIME_ENABLED` alone permits only the manual read-only API preflight.
- `INTERNAL_TELEGRAM_INGRESS_ENABLED` loads the API-side transport HMAC keys, but does not create
  a route or a pool by itself.
- `INTERNAL_TELEGRAM_PRIVATE_INGRESS_RUNTIME_ENABLED` is the final API composition gate. It is
  valid only when both preceding API gates are valid.

Stages 13B and 13C provide a historical private nonce-reservation and generic inbox-recorder
scaffold. Stage 15A can compose that scaffold only behind gates, but it is **not approved for the
invite-only beta** and must not be enabled. The invite-admission migration retires the generic
recorder; a later implementation will add a distinct signed admission transport for an exact
private `/start <invite>` command. The bounded TLS-verified pool opens no connection during
construction and does not enable bot polling. A test-only in-memory nonce store is rejected in
production. Do not enable any of these settings in a deployed environment without the separately
approved credential, private-network, reconciliation, and launch procedure.

No payment, KemerBet, Player-ID validation, receipt, attachment, withdrawal action, or generic
customer registration is reachable through beta admission.

## Process boundary

The current bot code remains an inactive private-chat scaffold. The future admission reducer must
accept only an exact private `/start <invite>` interaction from a non-bot sender and reduce it to
the reviewed admission DTO. It must ignore ordinary messages, callbacks, Player IDs, screenshots,
attachments, deposits, and withdrawals until separately approved. The historic generic reducer
used this allowlisted DTO:

- Telegram update ID;
- Telegram user ID and matching private-chat ID;
- first name, optional last name, optional username; and
- the fixed English (`en`) locale, regardless of Telegram's language code.

Those profile fields belong only to the historical generic DTO. The beta admission DTO excludes
all profile values and carries only the IDs, fixed `en` locale, and the raw invite token in the
bot-to-API request. The API derives a domain-separated SHA-256 digest before its database call; it
never sends the raw token to PostgreSQL.

It never forwards a Telegram `Update`, message text, captions, callback data, media, file IDs,
payment references, or customer-entered financial data. The reducer rejects non-private chats,
bot senders, missing senders, mismatched user/chat IDs, and unsafe numeric identifiers.

The historic generic reducer would send JSON bytes to this internal route:

`POST /internal/v1/telegram/private-inbound`

Only a Docker-private origin is permitted for a production bot configuration:

`http://api:3000/`

That route is not an admission route and must not be exposed or enabled. The future admission route
must be internal-only, use a distinct MIME type, HMAC secret/domain, nonce domain, and replay
contract, and must not be proxied to the public internet.

## Authentication and replay resistance

The historic generic transport signs the exact raw request body using a dedicated 32-byte HMAC
secret. The signature
covers a fixed protocol version, HTTP method, fixed path, key ID, timestamp, nonce, byte length,
and SHA-256 digest of the raw bytes. The API rejects requests with an unexpected method, URL,
content type, content encoding, duplicate authentication headers, stale/future timestamp, invalid
nonce/signature, changed bytes, or fields outside the DTO allowlist. It authenticates before JSON
parsing and does not log the body.

The beta admission implementation must reserve each accepted nonce atomically through its expiry
before redeeming the invite. It must use a new domain-separated digest and a distinct HMAC key from
the historic generic transport. Stage 13B reserves only a historical domain-separated SHA-256
digest of the nonce; it stores no raw nonce, Telegram event, customer, payment, or credential
data. The historic nonce and generic-recorder adapters must remain uncomposed. Their recorder
targets `app.record_telegram_private_inbound_event(...)`, which is retired and unavailable to
runtime roles after the invite-admission migration. An in-memory implementation exists only for
tests and local scaffolding; it is rejected in production. The new beta admission transport needs
its own durable replay guard; the database update ID remains the durable idempotency key once an
identity is admitted.

With the current 60-second timestamp skew limit, the adapter accepts a reservation window no
longer than 120 seconds. The database permits up to three minutes only to tolerate normal API and
database clock differences; it does not make a nonce valid for longer than the transport protocol.
Expired nonce digests require a separate maintenance-only cleanup identity. The inactive
`fetanagent_nonce_retention` scaffold has no credential or schedule yet. A standalone manual
preflight can inspect its least-privilege catalog boundary, but it has no purge command and does
not connect during normal application startup. The bounded purge helper can run only after a later
deployment review explicitly provisions that separate identity. The API and worker must never
receive the cleanup credential or execute permission.

The bot makes at most two attempts for a retryable transport failure (timeout, 408, 429, or 5xx),
using a new nonce for every attempt. If both attempts fail, it tells the customer that FetanAgent
could not receive the request. It does not show a success-style reply and has no durable bot outbox
yet.

## Secrets

| Process           | Allowed secrets                                                                 |
| ----------------- | ------------------------------------------------------------------------------- |
| Bot               | Rotated BotFather token and a future admission-transport HMAC secret only       |
| API               | Matching future admission HMAC secret, payload-HMAC secret, later DB login only |
| Worker / executor | Neither Telegram secret nor BotFather token                                     |

Each process needs a separate production secret mount. Do not use a shared `.env` file, place a
secret in Git, or use the Telegram token as an internal API secret. The admission API process must
use only a future login inheriting `fetanagent_beta_admission`; it must not reuse the generic API
database role or credential.

## Key rotation

Version 1 deliberately supports one fixed transport key and one fixed payload-HMAC key. Do not
rotate either key while an inbox replay may occur. A future rotation design must retain prior
payload-HMAC versions long enough to reproduce database idempotency values, and must accept a
bounded active/previous transport key set. Until that design and its tests exist, key rotation is a
production launch blocker.

## Remaining launch gates

1. Validate the invite-admission migration in the disposable SQL harness, then review it
   independently before any remote database change.
2. Provision a unique login inheriting only `fetanagent_beta_admission`; verify that it can execute
   only invite redemption and beta-nonce reservation, while both generic API roles and the
   admitted-inbox recorder remain denied.
3. Wire exact private `/start <invite>` handling to a separately signed, durable replay-protected
   admission route; ordinary messages, callbacks, Player IDs, attachments, and payments stay
   ignored.
4. Provision and test the dedicated bounded nonce-retention maintenance path before any ingress is
   enabled; it must remain separate from all API and worker credentials.
5. Add a durable bot outbox before relying on automatic delivery beyond the two immediate attempts.
6. Deploy bot and API on a private Docker network; use long polling in exactly one bot replica and
   do not mix it with Telegram webhooks.
7. Rotate the BotFather token before enabling polling or any Telegram runtime.
8. Add reviewed conversation/inbound completion procedures before interpreting customer commands.
9. Keep Player-ID registration, payment verification, provider access, KemerBet execution, and all
   financial actions behind their separate reviewed launch gates.
