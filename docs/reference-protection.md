# Transaction-reference protection

## Current scope

The reviewed database boundaries accept a customer-entered CBE Birr transaction ID only after the
same authenticated customer opened the exact intake. The dry-run Telegram path records an untrusted
`received` submission while every financial switch remains disabled. The default-off live Telegram
and customer-web paths require all three locked live switches and atomically create one private
authoritative verification job. No path in this repository contacts CBE Birr, creates provider
evidence, approves or claims a payment, or starts a KemerBet deposit without the still-unprovisioned
authoritative worker and later settlement boundary.

The current capture path accepts a transaction reference only. Screenshot/PDF ingestion is
intentionally deferred until the bot-to-API-to-private-Storage path can validate file bytes, create
an opaque object key server-side, and prove the object exists before the database records metadata.

## Server-side cryptographic contract

The Telegram bot must forward the raw reference only to the internal API. It never receives an
encryption key, blind-index key, direct PostgreSQL credential, or private Storage credential. The
authenticated customer-web BFF applies the same rule and never gives either key to the browser.
The two server processes handle the bounded ASCII value in memory, then the shared Node-only
protection module applies this stored ciphertext format before the database procedure:

1. Normalize only through the fixed CBE Birr profile. There is no generic fallback: the current
   profile rejects outer or internal whitespace, Unicode/confusables, URLs, labels, controls, and
   unsupported patterns, then uppercases the accepted ASCII identifier for case-stable matching.
2. Encrypt the normalized value with AES-256-GCM using a fresh 12-byte nonce. The stored ciphertext
   is v<encryption-key-version>.<nonce>.<tag>.<ciphertext> using base64url fields.
3. Produce a separate HMAC-SHA-256 blind index over a domain-separated value containing the fixed
   `cbe_birr` provider profile and normalized reference. The database sees only the 64-character
   hexadecimal fingerprint. Any later provider must receive a distinct reviewed profile before it
   can use this boundary.
4. Store only three asterisks plus the final four normalized characters for customer-safe display.
   Every web, bot, API, and protection-module parser requires more than four characters, so this
   suffix can never equal the complete accepted reference.

Encryption and blind indexing use two distinct dedicated 32-byte roots. Both are independently
domain-separated and must be identical across the API, customer-web BFF, and future authoritative
CBE verification worker. They never enter Git, PostgreSQL, the bot, the browser, the dashboard,
migrations, audit metadata, conversation state, or logs. Each process loads the same immutable
version-1 nonsecret profile containing the approved SHA-256 identity of both keys and compares the
actual key bytes with timing-safe equality before readiness. A different key under version 1 is a
startup failure, so channel drift cannot silently bypass the global reference-fingerprint
uniqueness boundary. The two roots must also differ from each other and from every transport,
capability, or semantic HMAC key.

The version-1 encryption and fingerprint roots stay stable as one approved profile. Encryption-key
rotation requires a reviewed ciphertext migration. Fingerprint-key rotation additionally requires a
complete fingerprint reindex under a new version so a duplicate reference cannot evade the active
uniqueness index. The leading ciphertext value and stored smallint are selectors only; startup
profile verification supplies the machine-checked key identity, and authoritative worker readiness
must enforce the same profile before the source switch may become live.

## Authoritative-lookup prerequisite finding

The pure Stage 1F prerequisite contract classifies the current protected lookup-material shape as
blocked. Its public `cbe_birr_shadow_protected_lookup_material_legacy` label is not an envelope or
protection profile and does not bless the current `v1` value. The package accepts no raw value,
ciphertext, key, protected-material version, algorithm or KMS choice, URL, credential, lease value,
runtime or schema wiring, financial claim, or KemerBet operation; every capability is false.

Two protection lifecycles remain unresolved. First, the receiver verification ciphertext lacks
protection metadata and key provenance. Those facts must not be inferred or backfilled onto the
existing immutable receiver-account revision. A future lookup requires a fresh new immutable
revision with fresh, explicit protection provenance. Second, the submitted-reference encryption and
fingerprint keys now have distinct roots and one machine-checked cross-process profile, but no
authoritative worker credential or live CBE transport has been provisioned yet.

Normalization is also unresolved across three separate profiles: lookup-reference,
receiver-lookup, and canonical-reference normalization. The current capture normalization is not
evidence that the other two have matching semantics. Their transformations, ownership,
compatibility, and upgrades require one explicit review before any protected material is eligible.

The current shadow lease cannot close these gaps: it mutates durable state and returns protected
material before a prerequisite preflight. A future design needs a non-mutating metadata preflight
and an opaque handle, with any material access confined to a separately reviewed callback-scoped
boundary. These are P0 prerequisites only; they do not authorize decryption, transport, a provider
request, or financial action. See
[cbe-birr-authoritative-lookup-prerequisite.md](cbe-birr-authoritative-lookup-prerequisite.md).

## Database safeguards

Every capture procedure:

- derives the active customer from either an admitted private Telegram event or the server-verified
  Supabase Auth binding, then proves ownership of the exact intent;
- locks the channel receipt/customer scope and the required switch set before mutating the intake;
- accepts only an intake_received intent before its immutable deadline and without an open
  verification review;
- is idempotent only for an exact same-channel lost-response replay and refuses to replace an active
  proof or reopen payment instructions after the intent advances;
- uses the existing active fingerprint uniqueness index to reject cross-intent duplicate claims
  without revealing another customer's record; and
- returns only the owned intent/state/timestamp and replay fact; never an encrypted value,
  fingerprint, mask, verification-job ID, evidence ID, execution ID, or object key.

The submitted transaction ID is not the provider's canonical transaction reference. A later
provider adapter must extract a canonical reference from authoritative provider evidence and apply
the separate payment-claim safeguards.
