# TeleBirr deposit product contract

This document records the approved TeleBirr deposit behavior for FetanAgent. It is the product
contract for the implementation that follows; it does not activate a verifier, create a payment
claim, credit KemerBet, change a database switch, or authorize a production rollout. CBE Birr is
governed by its separate approved contract in
[cbe-birr-deposit-product-contract.md](cbe-birr-deposit-product-contract.md).

## Product decisions

| Decision                      | Approved behavior                                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment participants          | The payer, submitting FetanAgent user, and KemerBet account holder may all be different people. No identity match among them is required.                                          |
| Sender and claimant identity  | Do not match or require the TeleBirr payer, Telegram identity, web identity, or KemerBet identity.                                                                                 |
| Destination                   | A customer may deposit to a saved eligible Player ID or choose **Deposit to another Player ID**.                                                                                   |
| Amount entry                  | The customer does not enter an amount. The credited principal comes only from the freshly retrieved official receipt's **Settled Amount**.                                         |
| Fees                          | Stamp duty, discount fields, service fee, service-fee VAT, and every other fee are never added to the KemerBet credit. **Total Paid Amount** is not the credited amount.           |
| Per-deposit limits            | 25 ETB minimum and 25,000 ETB maximum, inclusive. An out-of-range receipt goes to manual review.                                                                                   |
| Deposit count                 | There is no business limit on successful deposits. Abuse controls may still bound concurrent checks and invalid-reference probing.                                                 |
| Transaction type              | Automatic verification initially accepts only TeleBirr wallet transfers whose official payment reason is **Send Money to Registered Customer**. Other reasons go to manual review. |
| Age                           | A payment made before the FetanAgent flow may be verified automatically when submitted within one hour of the official payment time. Older receipts go to manual review.           |
| Multiple references           | If submitted material contains multiple candidate transaction IDs, the customer must select one. FetanAgent must not guess.                                                        |
| Customer confirmation         | No second confirmation is required after exact verification. The verified amount proceeds immediately to the selected Player ID through guarded settlement and execution.          |
| Duplicate customer response   | Say only **This transaction was already used.** Never reveal the other user or Player ID.                                                                                          |
| Internal duplicate visibility | The Owner and authorized payment-review admins may see the internal user, channel, Player ID, amount, timestamps, and audit history.                                               |
| Receiver configuration        | The Owner configures exactly one official full receiver name per immutable TeleBirr receiver revision. Personal or merchant receiver accounts are supported.                       |

## Facts established by the official receipt

The reviewed official TeleBirr receipt presents separate fields for the issuer, payer, masked payer
number, payer account type, credited-party full name, masked credited-party number, transaction
status, invoice number, payment time, settled amount, stamp duty, discount, service fee,
service-fee VAT, total paid amount, payment mode, payment reason, payment channel, QR code, and PDF
download.

Only the official receipt retrieved by FetanAgent can establish these facts. Screenshots and SMS
messages supplied during product discussion are evidence for designing the contract, not production
fixtures or proof of a later customer payment. They contain personal and financial information and
must never be committed.

## Trust boundary

Every customer submission is untrusted. This includes a transaction ID, complete URL, pasted SMS,
screenshot, photograph, PDF, QR code, OCR result, amount, sender, receiver, date, and status.
Customer material can supply candidate transaction IDs only; it can never prove payment or create a
claim by itself.

The authoritative candidate source for TeleBirr v1 is a new retrieval of the provider-owned HTTPS
receipt page. The product design does not depend on a private API, provider credential, customer
browser session, customer TeleBirr login, or customer-supplied receipt HTML. The official result
must be observed fresh and reduced to strict versioned facts before any database claim can exist.

## Intake and reference extraction

The supported customer inputs are:

- a transaction ID;
- a complete TeleBirr receipt URL;
- pasted TeleBirr SMS text;
- a screenshot or photograph; or
- a receipt PDF.

The customer never supplies a trusted amount. FetanAgent extracts candidate references under a
strict, versioned normalization profile. It must reject malformed or oversized input and must not
invent a candidate. Reference parsing must tolerate adjacent SMS prose only by stopping at reviewed
delimiters; punctuation or words after a URL path must not become part of the transaction ID. The
normalizer must not assume that every future valid ID begins with one particular letter sequence.

When there is exactly one candidate, the flow may continue. When there are several, the customer
chooses one, and the selected value must be one of the extracted candidates. When there is none, the
customer receives a safe retry message. For a submitted URL, FetanAgent uses only the extracted
transaction ID and ignores the submitted scheme, host, path, query, fragment, and redirects.

Image, PDF, QR, and OCR processing must enforce file-signature, byte, pixel, page, decompression,
runtime, and memory bounds in an isolated parser. QR and document links are candidate text only;
FetanAgent never follows a customer-supplied host.

## Official receipt retrieval

The verifier constructs the lookup itself using:

- HTTPS only;
- the compiled allowlisted host `transactioninfo.ethiotelecom.et`;
- the fixed `/receipt/` path;
- the strictly normalized candidate transaction ID; and
- no customer-selected host, query, redirect, or file location.

The transport must enforce certificate validation, DNS and IP safety, strict redirects, bounded
request and response sizes, short timeouts, bounded retries, content-type checks, and an incident
stop. A receipt that cannot be retrieved or parsed exactly goes to manual review; an outage must not
be interpreted as an invalid payment.

## Owner-configured receiver revisions

The Owner may replace the active TeleBirr receiver with another personal or merchant receiver
account. Each revision contains exactly one official full receiver name. Aliases, alternative
spellings, fuzzy matching, and silent in-place edits are not allowed. A masked receiver number may
be retained as a diagnostic fact, but it is not sufficiently complete to authorize a match.

A change creates a new immutable revision with its activation time, deactivation time, Owner actor,
reason, and audit record. Earlier revisions remain available for verification history and are never
rewritten or deleted. The official credited-party name must match the revision that was active at
the official payment time using the half-open interval
`active_from <= occurred_at < retired_at`; the exact rotation instant belongs to the new revision.
Gaps or overlaps fail closed to review. Therefore, a payment made immediately before a receiver
change may still match the previous revision when submitted within the remaining one-hour freshness
window; the new revision must never be applied retroactively.

Name comparison uses a versioned conservative normalization profile: Unicode normalization,
case-folding where defined, whitespace normalization, and narrowly reviewed harmless punctuation
normalization. It preserves word content and order, supports Ethiopic text, and does not perform
nickname, transliteration, token-reordering, similarity, or partial-name matching. Anything that is
not an exact normalized match goes to manual review.

If a configured masked-number suffix is available, it remains diagnostic. A conflict between that
suffix and the official receipt goes to manual review; the suffix cannot override or substitute for
the required full-name match.

## Exact automatic-verification rule

Automatic verification is permitted only when one freshly observed official receipt proves all of
the following without ambiguity:

1. The issuer and source profile are the supported official TeleBirr receipt.
2. The transaction status is exactly `Completed` after strict normalization. A missing or unknown
   status must never default to completed.
3. The payment mode is exactly `telebirr` after strict normalization.
4. The payment reason is exactly the supported `Send Money to Registered Customer` reason.
5. The canonical invoice number exactly matches the normalized requested transaction ID.
6. The official credited-party full name exactly matches the immutable configured receiver revision
   under the approved normalization profile.
7. The currency is ETB.
8. **Settled Amount** is present and converts exactly to integer ETB minor units.
9. Stamp duty, discount fields, service fee, service-fee VAT, **Total Paid Amount**, and every other
   fee or total are excluded from the credited amount.
10. The principal is between 25 ETB and 25,000 ETB inclusive.
11. The official payment time is present, unambiguous, and no more than one hour before the
    server-recorded submission time. The reviewed offset-free receipt format is parsed explicitly in
    `Africa/Addis_Ababa`, never through the server, browser, or device locale. A narrowly bounded
    provider-clock tolerance may accept a time no more than five minutes ahead; anything else goes
    to review.
12. The selected KemerBet Player ID exists, is active, and is currently deposit-eligible at the
    settlement and execution boundaries.
13. The canonical provider reference has not already funded or been conclusively claimed by another
    deposit.

The payer name, masked payer number, payer account type, masked credited-party number, QR code, and
payment channel are useful evidence and anomaly signals. They do not replace the required canonical
reference, credited-party full-name, completed-status, reason, time, and settled-principal checks.

## Ethiopian Android verifier boundary

The approved TeleBirr source-observation design uses a dedicated Android verifier phone kept
powered and connected to Ethiopian Internet. The phone is a constrained observation relay, not a
payment or database authority.

The device must:

- authenticate with its own revocable device identity and receive at most one opaque leased lookup
  job at a time;
- construct or receive only the normalized reference needed for the fixed official receipt route;
- enforce the same host, TLS, redirect, response-size, timeout, and content policy as the server;
- parse every required receipt fact explicitly and never infer `Completed` from a page loading;
- return a signed, versioned result with retrieval time, parser version, and evidence digest;
- redact logs and diagnostics so references, URLs, names, receipt bodies, and personal data do not
  appear; and
- heartbeat so an offline, stale, revoked, or incompatible device causes pending/manual review,
  never an automatic rejection or credit.

Every observation is bound to the exact lease, fresh nonce, opaque job, submitted-reference
fingerprint, device identity, source profile, and parser version. Invalid signatures, nonce replay,
wrong-job or wrong-reference results, expired leases, and results arriving after reassignment fail
closed to manual review. Re-delivery of the same valid result is idempotent.

The phone must not hold a Supabase `service_role` key, database password, KemerBet credentials,
financial command, customer session, or unrestricted queue access. It cannot create evidence,
claim a transaction, settle a deposit, or enqueue/execute KemerBet credit directly. A least-privilege
backend role validates the signed observation and invokes only an exact database boundary; the
database remains authoritative for evidence, uniqueness, eligibility, settlement, and audit.

## Player-ID selection

If a customer has exactly one saved eligible Player ID, FetanAgent selects it automatically and
still displays **Deposit to another Player ID**. With multiple saved eligible Player IDs, the
customer selects one. A different active and eligible Player ID may be entered through **Deposit to
another Player ID**.

FetanAgent deliberately does not prove that the submitting user owns the Player ID and does not
match the TeleBirr payer to the customer or KemerBet account. Different Telegram and web accounts
may deposit to the same Player ID, and one account may deposit to several Player IDs.

This decision makes an unused valid transaction ID a one-use bearer claim inside FetanAgent:
someone who obtains it may submit it first. That is an accepted product tradeoff, not a fact proven
by the receipt. The compensating controls are global one-time claiming, minimal customer disclosure,
invalid-reference throttling, concurrent-request bounds, and complete internal auditability.

## Uniqueness, settlement, and immediate execution

The database remains authoritative for uniqueness. A keyed fingerprint of the provider's canonical
reference must have one global claim boundary. Verification, evidence persistence, claim creation,
and execution enqueue must be serialized and idempotent so concurrent submissions cannot credit two
Player IDs.

The first conclusively verified and atomically claimed submission wins. Exact replays return the
same safe result. A later customer receives only **This transaction was already used.** The Owner and
authorized payment-review admins retain the private linkage needed for investigation.

The uniqueness domain is the TeleBirr provider identity plus its canonical-reference fingerprint;
reference text from another payment provider must not collide with or satisfy this claim.

After exact verification, no additional customer confirmation or intentional delay is required.
FetanAgent may continue immediately to the selected Player ID only through the existing guarded
settlement and KemerBet execution boundaries. A definite KemerBet success must be reconciled against
the exact success indication and matching account history. An uncertain final action is never
retried blindly and remains blocked for reconciliation or review.

## Outcome policy

| Observation                                                                                                                                                                                                             | Outcome                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Every automatic-verification fact is proven and the global claim succeeds                                                                                                                                               | Continue immediately to guarded settlement and execution |
| Definitive invalid reference, wrong receiver, failed transaction, unsupported definitive status, or already-used reference                                                                                              | Reject with safe customer copy                           |
| Receipt older than one hour, principal outside the supported range, or unsupported payment reason                                                                                                                       | Manual review                                            |
| Pending or unknown status, missing/conflicting field, ambiguous timezone, unreadable input, parser/layout drift, source outage, timeout, unsafe redirect, device offline/stale, or uncertain duplicate/execution result | Manual review and fail closed                            |

Manual review must not manufacture missing evidence. Any approval or rejection records the
reviewer, reason, time, evidence version, receiver revision, and resulting state. A correction after
a completed credit must be a separate audited Owner operation and must never reuse the original
transaction to create a second credit.

`manual_review` is an internal state name. Customer-facing copy follows
[language-policy.md](language-policy.md) and says **Being checked** rather than exposing internal
review terminology.

## Owner, admin, and customer visibility

The Owner can view and manage users, admins, receiver revisions, deposits, evidence summaries,
selected Player IDs, duplicate attempts, manual reviews, device health, execution, and
reconciliation history. The Owner may grant or revoke narrow admin capabilities. Admin accounts are
individually attributable; shared admin identities are forbidden.

An authorized payment-review admin may see only the information needed to investigate and decide a
case. Every action records the actor, reason, timestamp, and before/after state. Ordinary customers
cannot read another customer's deposit, receipt, review, Player ID, or ledger data.

Raw transaction IDs, complete receipt URLs, receiver identifiers, receipt bodies, screenshots,
PDFs, QR content, payer details, and provider payloads must not enter logs, analytics, customer
messages, or general audit metadata. Storage uses encryption, opaque object keys, keyed reference
fingerprints, retention limits, and authorized server-only access.

## Abuse controls without deposit limits

Unlimited successful deposits do not mean unlimited lookup attempts. The implementation may limit a
customer to three active verification requests, apply per-account and per-network throttles to
invalid or repeated references, bound OCR/file work, and open a circuit on source, device, or parser
anomalies. These are security and availability controls, not successful-deposit limits.

## Implementation consequences

The current intake requires a customer-entered amount and normally snapshots a payment window when
the intent opens. It cannot implement this contract unchanged. The implementation needs a two-stage
boundary:

1. create a proof submission containing the chosen Player ID and protected candidate reference, but
   no trusted amount; then
2. after authoritative receipt verification, atomically create or finalize the immutable amount,
   receiver revision, evidence, global claim, and settlement state from the server-authored facts.

The existing amount-at-intake boundary requires receipt occurrence at or after intent opening and
binds the amount and receiver revision to that earlier intent snapshot. It must not be backdated or
reused to simulate this contract. The new proof boundary must preserve the official occurrence time
and derive the applicable receiver revision and amount before the immutable claim is created.

The Telegram and web interfaces must therefore stop requiring an amount for this TeleBirr flow.
Existing ownership records may remain useful for saved destinations, but ownership must not be a
prerequisite for depositing to another Player ID. Current Player-ID validity and deposit eligibility
remain mandatory destination safety checks.

TeleBirr and CBE Birr require separate source profiles, normalizers, parsers, evidence schemas,
receiver-matching policies, fixture suites, and runtime gates. A successful CBE Birr verification
must not make a TeleBirr observation trustworthy, or vice versa.

## Required synthetic test matrix

Implementation and rollout require deterministic synthetic, redacted fixtures for:

- each accepted input form and transaction-ID extraction at reviewed punctuation boundaries;
- zero, one, and multiple candidate IDs, including explicit customer selection;
- exact `Completed` status and missing, pending, failed, reversed, or unfamiliar statuses;
- exact supported payment reason and unfamiliar or conflicting reasons;
- exact receiver-name match after conservative normalization, Ethiopic text, and rejected fuzzy,
  reordered, partial, transliterated, or alias matches;
- the current receiver revision, the immediately previous revision within its remaining one-hour
  window, the exact half-open rotation boundary, gaps/overlaps, and rejected retroactive matching;
- matching and conflicting diagnostic masked-number suffixes without letting the suffix authorize a
  receipt;
- settled principal distinct from service fee, VAT, stamp duty, discount, and total paid amount;
- 25 ETB and 25,000 ETB boundaries, below/above range, exact minor units, and malformed amounts;
- fresh, exactly one-hour-old, older, narrowly future-skewed, excessive future, explicit
  `Africa/Addis_Ababa` parsing, and ambiguous times independent of device clock;
- global duplicate claims, same-channel replay, cross-Telegram/web replay, and concurrent claims for
  different Player IDs;
- source outage, unsafe redirect, oversized response, HTML/PDF/layout drift, parser uncertainty,
  device offline/stale/revoked, invalid signature, nonce replay, wrong lease/job/reference, result
  after reassignment, and incompatible parser version;
- current Player-ID eligibility loss between evidence, settlement, and execution; and
- definite KemerBet success, definite failure before action, and uncertain final action requiring
  reconciliation without blind retry.

Real screenshots, SMS messages, URLs, transaction references, names, and account details supplied
during product discussion must not be copied into fixtures, source, tests, logs, or documentation.

Until the implementation and all gates pass, `FINANCIAL_ACTIONS_MODE=dry_run`,
`KEMERBET_EXECUTOR_ENABLED=false`, and `KEMERBET_FINAL_ACTION_ENABLED=false`; no TeleBirr receipt may
cause a real claim or credit.
