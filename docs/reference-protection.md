# Transaction-reference protection

## Current scope

Three reviewed protection contracts coexist and must not be confused:

- the legacy CBE Birr v1 boundary protects a reference for an already-opened amount-first deposit
  intent; and
- the provider-bound v2 proof boundary accepts only an amount-free direct transaction ID for
  `cbe_birr` or `telebirr` and records an untrusted `proof_received` candidate while every financial
  switch remains disabled; and
- the Owner receiver-account v1 boundary protects a digits-only TeleBirr wallet or CBE Birr account
  before an immutable receiver revision is written.

The default-off legacy live Telegram and customer-web paths require all three locked live switches
and atomically create one private authoritative verification job. The v2 proof boundary has no live
branch. No v2 proof path contacts either provider, creates authoritative evidence, approves or
claims a payment, creates a settlement or execution command, or starts a KemerBet financial action.

The current capture path accepts a transaction reference only. Screenshot/PDF ingestion is
intentionally deferred until the bot-to-API-to-private-Storage path can validate file bytes, create
an opaque object key server-side, and prove the object exists before the database records metadata.

## Server-side trust boundary

The Telegram bot must forward the raw reference only to the internal API. It never receives an
encryption key, blind-index key, direct PostgreSQL credential, or private Storage credential. The
authenticated customer-web BFF applies the same rule and never gives either key to the browser.
The two server processes handle the bounded ASCII value in trusted memory and call the shared
Node-only protection module before invoking a database procedure.

### Legacy CBE Birr v1 stored-reference contract

The legacy amount-first CBE Birr boundary applies this stored ciphertext contract:

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

### Owner receiver-account v1 contract

The authenticated Owner dashboard accepts exactly one provider (`telebirr` or `cbe_birr`), the
official receiver name, and 9–24 ASCII digits. It does not trim, guess, reformat, add a country
prefix, or accept punctuation. The Owner server derives separate encryption and fingerprint keys
from the approved provider-neutral master pair using receiver-account-specific v1 domains plus the
exact provider. AES-256-GCM binds the same provider/domain as additional authenticated data. The
stored envelope is
`receiver-v1.<provider>.<16-char nonce>.<22-char tag>.<12-to-32-char ciphertext>`, the blind index is
64 lowercase hex characters, and the only display value is `***` plus the last four digits.

Owner startup verifies the shared master pair against the immutable v2 master-key profile before
receiver operations become ready. Sharing the approved roots does not share derived keys or blind
indexes: proof v2 and receiver v1 have different derivation/input/AAD domains, and receiver keys are
additionally provider-separated. The browser, API response, audit event, PostgreSQL function
result, and logs receive no complete receiver number after the request crosses the in-process
protector.

Rotation is append-only. PostgreSQL locks and requires the exact provider/payment/pilot/execution
switch set to remain disabled, rejects a draft or armed pilot for that provider, retires the current
revision once, and inserts the new revision at the same timestamp. A UUID-v4 request key replays
only the same provider/name/fingerprint/mask/reason semantics. Historical legacy revisions remain
visible only as masked `legacy protection`; they are never relabelled as protected.

This boundary makes receiver entry and rotation safe; it does not supply authoritative provider
transport or decryption authority. TeleBirr still needs its reviewed receiver-name profile,
signer/device enrollment, and live official-observation runtime. CBE Birr still needs a separately
reviewed receiver decrypt/lookup lifecycle and authoritative source that independently exposes the
required receiver fact.

### Provider-bound proof v2 contract

The amount-free dry-run proof boundary is a separate versioned contract:

1. The provider must be exactly `cbe_birr` or `telebirr`. No alias, case folding, generic provider,
   or submitted URL host is accepted as a provider identity.
2. A direct transaction ID must contain exactly 8 to 32 ASCII alphanumeric characters. Whitespace,
   punctuation, labels, URLs, controls, Unicode, and confusable characters are rejected. The
   accepted value is uppercased inside the protection boundary for stable matching.
3. Encryption uses AES-256-GCM with a fresh 12-byte nonce and provider-separated key derivation. The
   encryption key is HMAC-SHA-256 derived from the encryption root with the v2 encryption domain and
   exact provider. The AES-GCM additional authenticated data contains the same v2 domain and exact
   provider.
4. The stored ciphertext has exactly five dot-separated segments:
   `v2.<provider>.<nonce>.<tag>.<payload>`. The provider segment must equal the separately supplied
   provider. The unpadded base64url nonce and tag are exactly 16 and 22 characters. Because the
   plaintext is 8 to 32 ASCII bytes, the unpadded base64url payload is exactly 11 to 43 characters.
5. The blind index is a lowercase 64-character HMAC-SHA-256 fingerprint. Its key is separately
   derived from the distinct fingerprint root with the v2 fingerprint-key domain and exact
   provider. Its input also contains a v2 fingerprint-input domain, the exact provider, and the
   normalized reference. The same transaction text under different providers therefore cannot
   share a fingerprint.
6. The protected value reports encryption-key version `2` and protection-profile version `2`. The
   database requires both values and independently rechecks the ciphertext provider segment.
7. Customer-safe masking stores only `***` plus the final four uppercase alphanumeric characters.
   The minimum input length ensures the mask can never equal the complete accepted transaction ID.

The raw value must not enter PostgreSQL, an audit event, Telegram conversation state, a customer
response, a dashboard, a capability token, or a log. Database rows contain only the ciphertext,
fingerprint, mask, provider, version selectors, eligible destination snapshot, channel binding, and
non-financial replay metadata. Customer and bot responses expose only a generic proof receipt and
the allowlisted provider; they do not return the ciphertext, fingerprint, mask, raw transaction ID,
amount, receiver, or destination.

Version `2` in the ciphertext and database is an envelope/protection selector; it does not by itself
prove root-key identity or authorize decryption. Before any authoritative adapter, worker, or live
deployment can consume v2 material, FetanAgent must define an explicit immutable v2 root-key profile
with approved nonsecret key identities, verify it in every producing and consuming process, bind it
to the deployment manifest and source profile, and fail readiness on any mismatch. The current
dry-run proof contract does not satisfy or bypass that activation gate.

## Authoritative-lookup prerequisite finding

The pure Stage 1F prerequisite contract classifies the current protected lookup-material shape as
blocked. Its public `cbe_birr_shadow_protected_lookup_material_legacy` label is not an envelope or
protection profile and does not bless the current `v1` value. The package accepts no raw value,
ciphertext, key, protected-material version, algorithm or KMS choice, URL, credential, lease value,
runtime or schema wiring, financial claim, or KemerBet operation; every capability is false.

Two protection lifecycles remain unresolved. First, legacy receiver revisions still lack protection
metadata and key provenance and must never be inferred or backfilled; only a fresh Owner-created
revision has the new explicit receiver protection provenance. The new envelope has no granted CBE
worker decrypt/lookup lifecycle yet. Second, submitted-reference encryption and fingerprint keys
have distinct roots and one machine-checked cross-process profile, but no authoritative CBE worker
credential or live CBE transport has been provisioned yet.

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

### Legacy intent-reference capture

Every legacy intent-reference capture procedure:

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

### Provider-bound dry-run proof capture

Every v2 proof capture procedure:

- derives an active customer from an admitted private Telegram event or the server-verified Supabase
  Auth binding;
- accepts only an active, valid KemerBet Player ID whose latest complete decision snapshot is exactly
  current and eligible; the proof may target another eligible Player ID and does not assert Player-ID
  ownership;
- locks and requires all four financial switches—CBE Birr authoritative verification, TeleBirr
  authoritative verification, payment verification, and deposit execution—to remain disabled;
- validates the exact provider-bound ciphertext, fingerprint, mask, encryption-key version, and
  protection-profile version before inserting an append-only untrusted candidate;
- binds a Telegram event to exactly one semantic result and marks that event processed atomically,
  or binds a customer-web request to one UUIDv4 replay receipt;
- replays only the exact same channel/customer/provider/destination/protected-reference semantics and
  rejects conflicting request-key, event, or destination reuse;
- keeps candidate reuse customer-scoped and provider-separated; it does not create or claim the later
  global authoritative provider-reference uniqueness boundary; and
- returns only an opaque proof ID internally, provider, `proof_received` status, timestamp, and replay
  fact. It creates no amount, receiver snapshot, deposit intent, verification job, evidence, claim,
  settlement, execution command, or KemerBet action.

The submitted transaction ID is not the provider's canonical transaction reference. A later
provider adapter must extract a canonical reference from authoritative provider evidence and apply
the separate payment-claim safeguards.
