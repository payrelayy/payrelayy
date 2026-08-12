# Transaction-reference protection

## Current scope

`app.capture_telegram_dry_run_deposit_reference` is the current database boundary for a
customer-entered CBE Birr transaction ID. It records an untrusted `received` submission only after
the exact intake was opened by the same admitted customer through the dry-run procedure. It
requires all financial switches to remain disabled and cannot contact CBE Birr, queue verification,
create provider evidence, approve or claim a payment, or start a KemerBet deposit.

The current capture path accepts a transaction reference only. Screenshot/PDF ingestion is
intentionally deferred until the bot-to-API-to-private-Storage path can validate file bytes, create
an opaque object key server-side, and prove the object exists before the database records metadata.

## API-only cryptographic contract

The Telegram bot must forward the raw reference only to the internal API. It never receives an
encryption key, blind-index key, direct PostgreSQL credential, or private Storage credential. The
API handles the bounded ASCII value in memory, then the current Node-only dry-run protection module
applies this versioned envelope before the database procedure:

1. Normalize only through a server-selected, provider-specific profile. There is no generic
   fallback: the profile may trim outer ASCII whitespace and uppercase ASCII only where that
   provider's documented identifier format is case-insensitive. It rejects internal whitespace,
   Unicode/confusables, URLs, labels, controls, and unsupported patterns rather than guessing.
2. Encrypt the normalized value with AES-256-GCM using a fresh 12-byte nonce. The encrypted
   envelope is v<encryption-key-version>.<nonce>.<tag>.<ciphertext> using base64url fields.
3. Produce a separate HMAC-SHA-256 blind index over a domain-separated value containing the fixed
   `cbe_birr` provider profile and normalized reference. The database sees only the 64-character
   hexadecimal fingerprint. Any later provider must receive a distinct reviewed profile before it
   can use this boundary.
4. Store only three asterisks plus the final four normalized characters for customer-safe display.

The encryption and fingerprint subkeys are independently domain-separated from one dedicated
32-byte runtime master secret. It belongs only to the API secret store, never Git, the database,
the bot, the dashboard, migrations, audit metadata, conversation state, or logs. A later
verification worker must receive separately reviewed key access rather than reusing a bot
credential. The current CBE Birr observations remain fixture research rather than authoritative
provider evidence; TeleBirr needs its own approved adapter and fixtures first.

The version 1 master secret and both derived subkeys stay stable together. Rotating that master
requires a separately reviewed ciphertext re-encryption and fingerprint reindex migration so that a
duplicate reference cannot evade an existing uniqueness index. The ciphertext envelope carries the
protection version needed for that future rotation.

## Database safeguards

The capture procedure:

- proves the Telegram-originated inbound event belongs to the active customer who owns the intent;
- locks the Telegram event/customer scope, proves all financial switches are disabled, then locks
  the exact intake;
- accepts only an intake_received intent before its immutable deadline and without an open
  verification review;
- is idempotent for a repeated Telegram event and refuses to silently replace an active proof;
- uses the existing active fingerprint uniqueness index to reject cross-intent duplicate claims
  without revealing another customer's record; and
- returns only a submission ID, intent ID, state, timestamp, and replay boolean; never an encrypted
  value, fingerprint, mask, provider detail, or object key.

The submitted transaction ID is not the provider's canonical transaction reference. A later
provider adapter must extract a canonical reference from authoritative provider evidence and apply
the separate payment-claim safeguards.
