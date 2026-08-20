# CBE Birr deposit product contract

This document records the approved CBE Birr deposit behavior for FetanAgent. It is the product
contract for the implementation that follows; it does not activate a provider worker, create a
payment claim, credit KemerBet, change a database switch, or authorize a production rollout.
TeleBirr is governed by its separate approved contract in
[telebirr-deposit-product-contract.md](telebirr-deposit-product-contract.md).

## Product decisions

| Decision                      | Approved behavior                                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment participants          | The payer, submitting FetanAgent user, and KemerBet account holder may all be different people. No identity match among them is required.                                    |
| Sender and claimant identity  | Do not match or require the CBE sender, Telegram identity, web identity, or KemerBet identity.                                                                               |
| Destination                   | A customer may deposit to a saved eligible Player ID or choose **Deposit to another Player ID**.                                                                             |
| Amount entry                  | The customer does not enter an amount. The principal paid amount comes only from the freshly retrieved official receipt.                                                     |
| Per-deposit limits            | 25 ETB minimum and 25,000 ETB maximum. An out-of-range receipt goes to manual review.                                                                                        |
| Deposit count                 | There is no business limit on the number of successful deposits. Abuse controls may still bound concurrent checks and invalid-reference probing.                             |
| Transaction type              | Automatic verification initially accepts only CBE Birr **Send Money**. Other transaction types go to manual review.                                                          |
| Age                           | A payment made before the FetanAgent flow may be verified automatically when submitted within one hour of the official transaction time. Older receipts go to manual review. |
| Multiple references           | If submitted material contains multiple candidate transaction IDs, the customer must select one. FetanAgent must not guess.                                                  |
| Customer confirmation         | No second confirmation is required after exact verification. The verified amount proceeds automatically to the selected Player ID.                                           |
| Duplicate customer response   | Say only **This transaction was already used.** Never reveal the other user or Player ID.                                                                                    |
| Internal duplicate visibility | The Owner and authorized payment-review admins may see the internal user, channel, Player ID, amount, timestamps, and audit history.                                         |
| Receiver configuration        | The Owner configures one official full name and one wallet/account number per immutable CBE Birr receiver revision. Personal or merchant receiver accounts are supported.    |

## Trust boundary

Every customer submission is untrusted. This includes a transaction ID, complete URL, pasted SMS,
screenshot, photograph, PDF, QR code, OCR result, amount, sender, receiver, date, and status.
Customer material can supply candidate transaction IDs only; it can never prove payment or create a
claim by itself.

The authoritative candidate source for CBE Birr v1 is a new server retrieval of the official CBE
receipt. The product design does not depend on a private provider API, provider credential, customer
browser session, sender login, or customer-supplied receipt HTML. Runtime activation still requires
the fixed official route, response behavior, access rules, parser, and deployment controls to pass
the repository's separate source-policy and operational reviews.

## Intake and reference extraction

The supported customer inputs are:

- a transaction ID;
- a complete CBE receipt URL;
- pasted CBE SMS text;
- a screenshot or photograph; or
- a receipt PDF.

FetanAgent extracts candidate transaction IDs under a strict, versioned normalization profile. It
must reject malformed or oversized input and must not infer a candidate that is not present. When
there is exactly one candidate, the flow may continue. When there are several, the customer chooses
one. When there is none, the customer receives a safe retry message.

For a submitted URL, FetanAgent uses only the extracted transaction ID. It ignores the submitted
scheme, host, path, phone parameter, query parameters, fragment, and redirects.

## Official receipt retrieval

The server constructs the lookup itself using:

- HTTPS only;
- the compiled allowlisted official CBE receipt host;
- the fixed official receipt path;
- the normalized candidate transaction ID; and
- FetanAgent's protected, configured receiver-wallet number as the lookup phone.

The lookup phone is a selector, not evidence that the configured wallet received the payment. The
returned receipt must independently identify the credited receiver wallet or account.

The transport must enforce certificate validation, DNS and IP safety, strict redirect handling,
bounded request and response sizes, short timeouts, bounded retries, content-type checks, and an
incident stop. It must never fetch a customer-selected host, private network address, file URL, or
arbitrary redirect target.

## Owner-configured receiver revisions

The Owner may replace the active CBE Birr receiver with another personal or merchant receiver
account. Each revision contains exactly one official full receiver name and one protected wallet or
account number. Aliases, fuzzy name lists, and silent in-place edits are not allowed.

A change creates a new immutable revision with its activation time, deactivation time, Owner actor,
reason, and audit record. Earlier revisions remain available for verification history and are never
rewritten or deleted. The receipt must match the receiver revision that was active at the official
transaction time using the half-open interval `active_from <= occurred_at < retired_at`; the exact
rotation instant belongs to the new revision. Gaps or overlaps fail closed to review. Therefore, a
payment made immediately before a receiver change may still match the previous revision when it is
submitted within the remaining one-hour freshness window; the new revision must never be applied
retroactively.

For CBE Birr, the returned receiver wallet or account identity is authoritative. The single
configured full name is a display and diagnostic fact, not a substitute for that stronger identity.

## Exact automatic-verification rule

Automatic verification is permitted only when one fresh official receipt proves all of the
following without ambiguity:

1. The issuer and source profile are the supported CBE Birr official receipt.
2. The final status is exactly `Completed` after strict normalization.
3. The transaction type is the supported CBE Birr `Send Money` type.
4. The canonical reference exactly matches the normalized requested transaction ID.
5. The credited receiver wallet or account matches the immutable configured receiver revision.
6. The currency is ETB.
7. The principal paid or transferred amount is present as exact integer minor units.
8. Service charge, VAT, tip, and every other fee are excluded from the credited amount.
9. The principal amount is between 25 ETB and 25,000 ETB inclusive.
10. The provider occurrence time is present, unambiguous, and no more than one hour before the
    server-recorded submission time. A narrowly bounded provider-clock tolerance may accept a time
    no more than five minutes ahead; anything else goes to review.
11. The selected KemerBet Player ID exists, is active, and is currently deposit-eligible at the
    settlement and execution boundaries.
12. The canonical provider reference has not already funded or been conclusively claimed by another
    deposit.

Receiver display-name text is diagnostic only. Spelling, surname, language, spacing, or case
differences must not authorize or reject payment when the stronger receiver wallet/account identity
is available.

## Player-ID selection

If a customer has exactly one saved eligible Player ID, FetanAgent selects it automatically and
still displays **Deposit to another Player ID**. With multiple saved eligible Player IDs, the
customer selects one. A different active and eligible Player ID may be entered through **Deposit to
another Player ID**.

FetanAgent deliberately does not prove that the submitting user owns the Player ID and does not
match the CBE sender to the customer or KemerBet account. Different Telegram and web accounts may
deposit to the same Player ID.

This decision makes an unused valid transaction ID a one-use bearer claim inside FetanAgent:
someone who obtains it may submit it first. That is an accepted product tradeoff, not a fact proven
by the receipt. The compensating controls are global one-time claiming, minimal customer disclosure,
invalid-reference throttling, concurrent-request bounds, and complete internal auditability.

## Uniqueness, settlement, and execution

The database remains authoritative for uniqueness. A keyed fingerprint of the provider's canonical
reference must have one global claim boundary. Verification, evidence persistence, claim creation,
and execution enqueue must be serialized and idempotent so concurrent submissions cannot credit two
Player IDs.

The first conclusively verified and atomically claimed submission wins. Exact replays return the
same safe result. A later customer receives only **This transaction was already used.** The Owner and
authorized payment-review admins retain the private linkage needed for investigation.

After exact verification, no additional customer confirmation is required. FetanAgent may continue
to the selected Player ID only through the existing guarded settlement and KemerBet execution
boundaries. A definite KemerBet success must be reconciled against the exact success indication and
matching account history. An uncertain final action is never retried blindly and remains blocked for
reconciliation or review.

## Outcome policy

| Observation                                                                                                                                                                                                     | Outcome                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Every automatic-verification fact is proven and the global claim succeeds                                                                                                                                       | Continue automatically to guarded settlement and execution |
| Definitive invalid reference, wrong receiver, failed transaction, or already-used reference                                                                                                                     | Reject with safe customer copy                             |
| Receipt older than one hour or principal amount outside the supported range                                                                                                                                     | Manual review                                              |
| Unsupported transaction type, pending or unknown status, missing/conflicting field, ambiguous timezone, parser/layout drift, provider outage, timeout, unsafe redirect, or uncertain duplicate/execution result | Manual review and fail closed                              |

Manual review must not silently manufacture missing evidence. Any approval or rejection records the
reviewer, reason, time, evidence version, and resulting state. A correction after a completed credit
must be a separate audited Owner operation and must never reuse the original transaction to create a
second credit.

`manual_review` is an internal state name. Customer-facing copy follows
[language-policy.md](language-policy.md) and says **Being checked** rather than exposing internal
review terminology.

## Owner, admin, and customer visibility

The Owner can view and manage users, admins, deposits, evidence summaries, selected Player IDs,
duplicate attempts, manual reviews, execution, and reconciliation history. The Owner may grant or
revoke narrow admin capabilities. Admin accounts are individually attributable; shared admin
identities are forbidden.

An authorized payment-review admin may see only the information needed to investigate and decide a
case. Every action records the actor, reason, timestamp, and before/after state. Ordinary customers
cannot read another customer's deposit, receipt, review, Player ID, or ledger data.

Raw transaction IDs, complete receipt URLs, receiver identifiers, receipt bodies, screenshots,
PDFs, QR content, sender details, and provider payloads must not enter logs, analytics, customer
messages, or general audit metadata. Storage uses encryption, opaque object keys, keyed reference
fingerprints, retention limits, and authorized server-only access.

## Abuse controls without deposit limits

Unlimited successful deposits do not mean unlimited lookup attempts. The implementation may limit a
customer to three active verification requests, apply per-account and per-network throttles to
invalid or repeated references, bound OCR/file work, and open a circuit on provider or parser
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

The Telegram and web interfaces must therefore stop requiring an amount for this CBE flow. Existing
ownership records may remain useful for saved destinations, but ownership must not be a prerequisite
for depositing to another Player ID. Current Player-ID validity and deposit eligibility remain
mandatory destination safety checks.

Implementation and rollout must include deterministic redacted fixtures for every accepted input
form and every failure class; parser/source drift tests; concurrent duplicate-claim tests; exact
role/ACL tests; Owner/admin/customer disclosure tests; dry-run staging; and guarded production
activation. Real screenshots and SMS supplied during product discussion contain personal and
financial data and must not be committed as fixtures.

Until those changes and gates pass, `FINANCIAL_ACTIONS_MODE=dry_run`,
`KEMERBET_EXECUTOR_ENABLED=false`, and `KEMERBET_FINAL_ACTION_ENABLED=false`; no CBE receipt may
cause a real claim or credit.
