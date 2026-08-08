# Transaction-reference protection

## Current scope

app.capture_telegram_deposit_reference is the database boundary for a customer-entered transaction
ID. It records an untrusted proof submission only. It does not contact TeleBirr or CBE Birr, queue
verification, create provider evidence, approve a payment, or start a KemerBet deposit. The
procedure is live-gated and therefore remains dormant while the Owner feature-switch procedure
refuses live.

The current capture path accepts a transaction reference only. Screenshot/PDF ingestion is
intentionally deferred until the bot-to-API-to-private-Storage path can validate file bytes, create
an opaque object key server-side, and prove the object exists before the database records metadata.

## API-only cryptographic contract

The Telegram bot must forward the raw reference only to the internal API. It never receives an
encryption key, blind-index key, direct PostgreSQL credential, or private Storage credential. The
API handles the value in memory, then a future Node-only reference-protection module applies an
approved provider profile before the database procedure:

1. Normalize only through a server-selected, provider-specific profile. There is no generic
   fallback: the profile may trim outer ASCII whitespace and uppercase ASCII only where that
   provider's documented identifier format is case-insensitive. It rejects internal whitespace,
   Unicode/confusables, URLs, labels, controls, and unsupported patterns rather than guessing.
2. Encrypt the normalized value with AES-256-GCM using a fresh 12-byte nonce. The encrypted
   envelope is v<encryption-key-version>.<nonce>.<tag>.<ciphertext> using base64url fields.
3. Produce a separate HMAC-SHA-256 blind index over a domain-separated value containing the
   provider UUID and normalized reference. The database sees only the 64-character hexadecimal
   fingerprint.
4. Store only three asterisks plus the final four normalized characters for customer-safe display.

The encryption key and fingerprint key are distinct 32-byte runtime secrets. They belong only to
the API and future verification worker's secret stores, never Git, a database migration, audit
metadata, bot conversation state, or log output. The current CBE Birr observations are useful
fixture research but are not yet a production provider profile; TeleBirr needs its own approved
authoritative path and fixtures first.

The HMAC blind-index key stays stable in version 1. Rotating it requires a separate alias/reindex
migration so that a duplicate reference cannot evade an existing uniqueness index. AES encryption
keys may rotate independently; the ciphertext envelope carries that key version.

## Database safeguards

The capture procedure:

- proves the Telegram-originated inbound event belongs to the active customer who owns the intent;
- locks customer/identity, then the payment-verification switch, then the intent;
- accepts only an intake_received intent before its immutable deadline and without an open
  verification review;
- is idempotent for a repeated Telegram event and refuses to silently replace an active proof;
- uses the existing active fingerprint uniqueness index to reject cross-intent duplicate claims
  without revealing another customer's record; and
- returns only a submission ID, state, timestamp, deadline, and booleans; never an encrypted value,
  fingerprint, mask, provider detail, or object key.

The submitted transaction ID is not the provider's canonical transaction reference. A later
provider adapter must extract a canonical reference from authoritative provider evidence and apply
the separate payment-claim safeguards.
