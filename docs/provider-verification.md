# Provider-verification specification

This is FetanAgent's independent verification contract. The implemented launch-preparation scope
now includes provider-separated protected references, private amount-free dry-run proof intake,
strictly local redacted CBE Birr fixtures, and a pure TeleBirr foundation for bounded candidate
extraction, synthetic official-receipt normalization, and advisory Android-observation planning.
It is still not a live integration: no official-source adapter or Android transport is enabled, no
provider credential is configured, and no proof can reach authoritative evidence, a payment claim,
settlement, or KemerBet execution. All advisory capabilities remain false.

The approved product behavior for the future CBE Birr and TeleBirr implementations is recorded in
[cbe-birr-deposit-product-contract.md](cbe-birr-deposit-product-contract.md) and
[telebirr-deposit-product-contract.md](telebirr-deposit-product-contract.md). Both contracts derive
the amount from a freshly retrieved official receipt, accept payments made up to one hour before
submission, allow **Deposit to another Player ID**, and use a global one-use claim. They supersede
the older amount-at-intake and post-intent-only assumptions for those providers, but they do not
enable any current runtime capability.

QHash is reference research only. FetanAgent does not use QHash code, databases, workers,
credentials, accounts, or runtime services. TeleBirr and CBE Birr require separate adapters;
neither may reuse the other's lookup, receiver-matching, or parsing assumptions.

## Trust boundary

Customer-entered transaction IDs, screenshots, PDFs, SMS text, QR codes, and OCR output are
untrusted intake material. They may help an adapter find or classify a payment, but they can
never create a payment claim on their own.

Only one of these independent sources can produce authoritative payment evidence:

- a permitted provider API;
- an official provider receipt lookup; or
- verified provider account activity.

These are categories of potentially authoritative sources, not proof that a particular adapter is
correct or enabled. A visible page, known endpoint, synthetic fixture, user upload, or code flag
does not establish a completed payment. Each adapter still needs an exact source profile, parser,
evidence contract, fixture suite, and guarded deployment boundary.

An adapter extracts the provider's canonical transaction reference from that source. It must not
use the customer-entered ID as the final duplicate-protection key. The raw canonical reference is
used only inside the worker to create encrypted storage and a keyed fingerprint. It never belongs
in logs, audit metadata, Telegram state, or customer messages.

## Immutable intent and evidence

For providers whose customer flow supplies an amount before payment, a deposit intent may snapshot
the provider, receiver-account revision, displayed receiver instructions, Player ID, exact ETB
minor-unit amount, and UTC payment deadline when it opens. CBE Birr and TeleBirr now have different
approved product contracts: the customer supplies no amount and may submit a payment made up to one
hour earlier. Their implementations must first persist an untrusted proof submission and chosen
Player ID, then derive and atomically snapshot the exact amount, receiver revision, evidence, and
claim from a fresh official receipt. A later configuration change cannot rewrite either boundary.

Every authoritative evidence record must include:

| Fact                | Requirement                                                              |
| ------------------- | ------------------------------------------------------------------------ |
| Source              | Provider API, official receipt lookup, or verified account activity      |
| Final status        | Explicitly `completed`                                                   |
| Canonical reference | Extracted from the provider result and fingerprinted for uniqueness      |
| Amount              | Exact ETB integer minor units; never floating point                      |
| Receiver            | Match the immutable receiver revision under the provider-specific policy |
| Time                | Provider occurrence time and retrieval time, both UTC                    |
| Provenance          | Adapter version, normalization version, and an official-evidence digest  |

The database, not the adapter, assigns the permanent evidence ID and enforces the one-to-one
payment claim. A canonical provider reference can fund only one deposit intent.

## Automatic-approval rule

The worker can request an automatic claim only when all provider-specific checks pass in one
database transaction. For CBE Birr, the future implementation must prove:

1. A fresh official receipt is authoritative and its final status is exactly `completed`.
2. The canonical reference, ETB currency, configured receiver revision, supported `Send Money`
   type, principal amount, and occurrence timestamp are unambiguous.
3. The principal amount, excluding fees, is between 25 ETB and 25,000 ETB inclusive.
4. Submission occurs no more than one hour after the provider occurrence time. A provider time no
   more than five minutes ahead may be tolerated only when every other fact is exact; older or more
   future-dated receipts require review.
5. The selected Player ID remains active and deposit-eligible at the settlement and execution
   boundaries. The CBE sender, FetanAgent customer, and KemerBet account holder need not match.
6. No open review or conflicting state exists, and the canonical-reference fingerprint has not
   funded or been conclusively claimed by another deposit.

The current database procedure is deliberately ungranted and dormant. It is the future final
enforcement point; a TypeScript adapter can only make an advisory assessment. A stale payment,
future timestamp, ambiguous result, or reviewed/expired intent must never be automatically
credited.

## Result handling

| Provider result                                                                                                                       | FetanAgent outcome |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Every automatic-approval condition is proven                                                                                          | `verified`         |
| Official source confirms an invalid reference, wrong receiver, or already-claimed canonical reference                                 | `rejected`         |
| Correct payment but out-of-range or missing/conflicting official amount, late/future timestamp, incomplete status, or an open review  | `manual_review`    |
| Network failure, provider outage, parser change, missing field, ambiguous timezone, unsupported receipt type, or conflicting evidence | `manual_review`    |

This is intentionally conservative. A missing or conflicting receipt amount, or an amount outside
the CBE Birr range, is not a silent credit and is not discarded: an authorized reviewer can resolve
it through a separately audited review workflow.

## TeleBirr adapter gate

The complete approved TeleBirr intake, official-receipt, receiver-revision, amount, time,
uniqueness, Android-verifier, disclosure, and rollout rules are in
[telebirr-deposit-product-contract.md](telebirr-deposit-product-contract.md). The fixed official
receipt route is provider-specific and must be retrieved fresh; user-submitted SMS, URLs, images,
PDFs, QR content, and OCR can supply candidate references only.

The approved source-observation design uses a dedicated Android phone kept powered and connected to
Ethiopian Internet. The phone is a constrained, revocable observation relay. It holds no Supabase
`service_role` key, database password, KemerBet credential, financial command, or authority to create
evidence, claims, settlement, or execution. It returns a signed and versioned observation to a
least-privilege backend boundary; PostgreSQL remains authoritative.

Automatic verification requires an exact official `Completed` receipt, canonical invoice number,
supported TeleBirr payment mode and reason, exact normalized configured credited-party name, ETB
settled principal, official payment time, current eligible Player ID, and unused global reference.
The credited amount is **Settled Amount**. Service fee, VAT, stamp duty, discount fields, and
**Total Paid Amount** do not increase the credit.

The adapter fails closed to `manual_review` when the official source or device is unavailable, the
page changes, a required field is missing or ambiguous, the receiver name is not an exact
conservatively normalized match, or any evidence conflicts. It must never treat a loaded page,
customer upload, OCR result, or missing status as proof of completion.

## CBE Birr adapter gate

The complete approved CBE Birr intake, lookup, Player-ID selection, amount, time, uniqueness, disclosure,
and rollout rules are in
[cbe-birr-deposit-product-contract.md](cbe-birr-deposit-product-contract.md). The product contract
does not require a private provider API, provider credential, sender identity match, claimant
identity match, or KemerBet ownership match. It does require fresh server retrieval of the fixed
official receipt route and exact independent receipt evidence before a claim can exist.

CBE Birr is a wallet provider, distinct from CBE bank. Existing genuine receipt research indicates
that an official lookup is scoped by the transaction ID together with the configured receiver
phone. That pair is lookup material only, not proof by itself.

Receiver lookup material must remain protected. The current receiver ciphertext is not worker-ready:
it lacks protection metadata and key provenance, and FetanAgent has no independently provisioned
worker decryption lifecycle. Those facts must not be inferred or backfilled. A fresh new immutable
receiver-account revision is required before a usable official result could independently prove all
of the following facts and become authoritative evidence:

- CBE Birr identity and a `Completed` transaction status;
- the provider canonical reference;
- exact amount in ETB minor units;
- occurrence timestamp within the intent window;
- configured receiver-account identity and revision; and
- a compatible Send Money payment type where applicable.

The configurable account-holder name is a display and diagnostic aid only. Name spelling,
language, and formatting can vary, so name text never authorizes a payment. The lookup contract
must be proven by FetanAgent regression tests for every supported receipt type; an unfamiliar
response goes to review rather than being parsed optimistically.

The implemented CBE Birr code consists of the redacted dry-run fixture package, the separate Stage
1A authoritative-shadow foundation, Stage 1B offline authoritative-adapter fixtures, a Stage 1C
pure attempt planner, and a Stage 1D pure settlement planner. The
Stage 1B fixture schema is a FetanAgent-owned synthetic test envelope, not a documented CBE Birr
wire format. It proves strict reduction into the existing safe-facts contract and fails closed on
layout drift, malformed input, or uncertainty. Stage 1C validates an immutable intent snapshot and
safe adapter result, forces duplicate-reference status to unavailable, and emits only an advisory
completion or retry candidate; it does not run either disposition. Stage 1D can map that result and
an exact safe lease receipt to a closed advisory-completion or fixed 300-second retry command, but
emits no SQL and performs no database, network, job-acquisition, scheduling, persistence, or
procedure-call work. PostgreSQL remains authoritative for lease ownership, bounded-delay
validation, idempotent replay, durable retry scheduling, and maximum-attempt exhaustion. A private
database queue/result ledger is present
for a future separately deployed shadow worker, but no runtime login or runner exists. None of
these paths has an HTTP client, provider URL, credential, filesystem evidence reader, Telegram
integration, payment-claim grant, or KemerBet integration; none logs or returns raw receipt,
canonical-reference, receiver, or provider-payload values. See
[cbe-birr-authoritative-shadow.md](cbe-birr-authoritative-shadow.md) and
[cbe-birr-authoritative-adapter-fixtures.md](cbe-birr-authoritative-adapter-fixtures.md).

Stage 1E is a pure offline official-source policy contract under the package name
`@fetanagent/cbe-birr-official-source-policy`. Contract version 2 defines the exact compiled `GET`
shape for `https://cbepay1.cbe.com.et:443/aureceipt`, ordered `TID` then `PH` query parameters, and a
zero-redirect policy. Its disposition is `offline_profile_defined` with reason
`live_transport_absent`. A parse5 8.0.1 parser is exercised only with an exact plain synthetic
response data record and clearly synthetic fixtures; no callback or executable transport is
accepted. There is no HTTP client, live response, credential,
protected lookup material, lease, database, evidence claim, KemerBet logic, or runtime wiring. All
financial switches remain off.

Stage 1F implements the separate pure package
`@fetanagent/cbe-birr-authoritative-lookup-prerequisite`. Its only valid-request disposition is
`blocked`, with 13 exact blockers. The former broad source-permission blocker is replaced by
`official_receipt_live_response_contract_unattested` and `official_receipt_live_transport_absent`.
The remaining areas cover receiver protection,
provenance, and fresh immutable provisioning without inference or backfill; a submitted-reference
key lifecycle independent from the API master; a joint review of the lookup-reference,
receiver-lookup, and canonical-reference normalization profiles; and a non-mutating prerequisite
preflight before any lease. The existing lease mutates durable state and returns protected material
before such a preflight, so a future boundary needs metadata-only preflight and opaque-handle
payloads.

Every Stage 1F capability is false. The package contains no raw lookup material, ciphertext, key or
protected-material version, algorithm or KMS selection, URL or credential, lease value, runtime or
schema wiring, provider evidence, financial claim, or KemerBet operation. Its legacy-shape label is
not an envelope or protection profile and does not bless the current `v1` stored value. See
[cbe-birr-authoritative-lookup-prerequisite.md](cbe-birr-authoritative-lookup-prerequisite.md).

Before any positive source capability can replace the offline package, controlled privacy-reviewed
samples must attest the exact live response contract and a separate transport must enforce the
compiled route, TLS, zero redirects, bounds, redacted telemetry, and incident stop. FetanAgent also
needs a key-split/KMS envelope design that does not share the API master or fingerprint key,
receiver key-version and purpose metadata, an isolated callback-scoped decryptor, a strict compiled
host/TLS/redirect policy, redacted telemetry with an incident stop, and deterministic
offline-response tests. See
[cbe-birr-official-source-policy.md](cbe-birr-official-source-policy.md). The Stage 1F blockers also
require a fresh immutable receiver revision, an independently provisioned worker decrypt lifecycle,
one reviewed normalization ownership model, and a metadata-preflight/opaque-handle lease redesign.
Completing those items would open another review; it would not itself enable financial action.

## Privacy, operations, and rollout

- Keep private receipt files in the `payment-evidence` bucket for exactly 90 days. Store opaque
  object keys in the ledger and issue any download URL only from an authorized server path.
- Do not log transaction IDs, receipt URLs, receiver identifiers, full provider payloads, file
  bodies, credentials, authorization headers, or payment links. Audit records use only IDs,
  versions, counts, and allowlisted reason codes.
- Use allowlisted provider hosts, TLS validation, bounded redirects, bounded response sizes, and
  bounded retries. A network or parsing uncertainty must stop automatic approval.
- Maintain versioned, redacted fixture tests for success, duplicate reference, wrong receiver,
  missing, conflicting, or out-of-range official amounts, stale and future times, pending or failed
  status, malformed HTML/JSON/PDF, changed layouts, and provider outage.
- Roll out each adapter in this order: fixture tests, dry-run/shadow verification with no claim,
  explicit feature enablement, then monitored production. Disable the adapter on parser or issuer
  anomalies rather than guessing.
- A database `dry_run` mode must not issue real Telegram payment instructions or create a verified
  claim. The current intake and claim procedures require `live`, and the current Owner setting
  procedure intentionally refuses `live` until a separate launch review proves the full adapter,
  worker, reconciliation, and execution boundaries.
