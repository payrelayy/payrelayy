# Provider-verification specification

This is PayReplayy's independent verification contract for the first two payment methods:
TeleBirr and CBE Birr wallet. It is a design and test boundary, not a live integration. No
provider verifier is enabled, no provider credential is configured, and no payment can yet reach
KemerBet execution.

QHash is reference research only. PayReplayy does not use QHash code, databases, workers,
credentials, accounts, or runtime services. CBE bank is a later, separate adapter; it must not
reuse CBE Birr lookup or parsing assumptions.

## Trust boundary

Customer-entered transaction IDs, screenshots, PDFs, SMS text, QR codes, and OCR output are
untrusted intake material. They may help an adapter find or classify a payment, but they can
never create a payment claim on their own.

Only one of these independent sources can produce authoritative payment evidence:

- a permitted provider API;
- an official provider receipt lookup; or
- verified provider account activity.

An adapter extracts the provider's canonical transaction reference from that source. It must not
use the customer-entered ID as the final duplicate-protection key. The raw canonical reference is
used only inside the worker to create encrypted storage and a keyed fingerprint. It never belongs
in logs, audit metadata, Telegram state, or customer messages.

## Immutable intent and evidence

When a deposit opens, the ledger snapshots the payment provider, receiver-account revision,
displayed receiver instructions, Player ID, exact ETB minor-unit amount, and UTC payment deadline.
The default policy window is one hour. A later change to a holder name or receiver account cannot
change a pending intent.

Every authoritative evidence record must include:

| Fact                | Requirement                                                             |
| ------------------- | ----------------------------------------------------------------------- |
| Source              | Provider API, official receipt lookup, or verified account activity     |
| Final status        | Explicitly `completed`                                                  |
| Canonical reference | Extracted from the provider result and fingerprinted for uniqueness     |
| Amount              | Exact ETB integer minor units; never floating point                     |
| Receiver            | Match to the configured receiver-account ID and immutable version       |
| Time                | Provider occurrence time and retrieval time, both UTC                   |
| Provenance          | Adapter version, normalization version, and an official-evidence digest |

The database, not the adapter, assigns the permanent evidence ID and enforces the one-to-one
payment claim. A canonical provider reference can fund only one deposit intent.

## Automatic-approval rule

The worker can request an automatic claim only when all checks pass in one database transaction:

1. The source is authoritative and its final status is `completed`.
2. The canonical reference, exact amount, currency, receiver-account revision, and timestamp match
   the immutable deposit intent.
3. The provider occurrence time is between intent opening and deadline, and is no more than five
   minutes ahead of the verifier clock.
4. The claim itself occurs no later than the payment deadline.
5. The intent remains `verification_pending`, with no open verification review.
6. The canonical-reference fingerprint has not funded another intent.

The current database procedure is deliberately ungranted and dormant. It is the future final
enforcement point; a TypeScript adapter can only make an advisory assessment. A stale payment,
future timestamp, ambiguous result, or reviewed/expired intent must never be automatically
credited.

## Result handling

| Provider result                                                                                                                       | PayReplayy outcome |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Every automatic-approval condition is proven                                                                                          | `verified`         |
| Official source confirms an invalid reference, wrong receiver, or already-claimed canonical reference                                 | `rejected`         |
| Correct payment but wrong amount, late/future timestamp, incomplete status, or an open review                                         | `manual_review`    |
| Network failure, provider outage, parser change, missing field, ambiguous timezone, unsupported receipt type, or conflicting evidence | `manual_review`    |

This is intentionally conservative. An amount mismatch is not a silent credit and is not discarded:
an administrator can resolve it through a separately audited review workflow.

## TeleBirr adapter gate

TeleBirr automatic verification remains disabled until PayReplayy has its own permitted and
reliably reachable authoritative source, validated from the approved deployment infrastructure.
Reference research found a geo-blocked receipt route in an older system; that does not authorize
or prove a PayReplayy integration.

The adapter must fail closed to `manual_review` if the source is inaccessible, requires CAPTCHA,
is geo-blocked, changes format, or cannot prove every required fact. It must not bypass provider
restrictions, CAPTCHA, geofencing, or access controls. A user proof, bot message, OCR worker, or
device-held secret is never an approval authority.

## CBE Birr adapter gate

CBE Birr is a wallet provider, distinct from CBE bank. Existing genuine receipt research indicates
that an official lookup is scoped by the transaction ID together with the configured receiver
phone. That pair is lookup material only, not proof by itself.

The receiver phone stays encrypted in the worker-only configuration. A usable official result must
independently prove all of the following before it can become authoritative evidence:

- CBE Birr identity and a `Completed` transaction status;
- the provider canonical reference;
- exact amount in ETB minor units;
- occurrence timestamp within the intent window;
- configured receiver-account identity and revision; and
- a compatible Send Money payment type where applicable.

The configurable account-holder name is a display and diagnostic aid only. Name spelling,
language, and formatting can vary, so name text never authorizes a payment. The lookup contract
must be proven by PayReplayy regression tests for every supported receipt type; an unfamiliar
response goes to review rather than being parsed optimistically.

## Privacy, operations, and rollout

- Keep private receipt files in the `payment-evidence` bucket for exactly 90 days. Store opaque
  object keys in the ledger and issue any download URL only from an authorized server path.
- Do not log transaction IDs, receipt URLs, receiver identifiers, full provider payloads, file
  bodies, credentials, authorization headers, or payment links. Audit records use only IDs,
  versions, counts, and allowlisted reason codes.
- Use allowlisted provider hosts, TLS validation, bounded redirects, bounded response sizes, and
  bounded retries. A network or parsing uncertainty must stop automatic approval.
- Maintain versioned, redacted fixture tests for success, duplicate reference, wrong receiver,
  wrong amount, stale and future times, pending or failed status, malformed HTML/JSON/PDF,
  changed layouts, and provider outage.
- Roll out each adapter in this order: fixture tests, dry-run/shadow verification with no claim,
  explicit feature enablement, then monitored production. Disable the adapter on parser or issuer
  anomalies rather than guessing.
- A database `dry_run` mode must not issue real Telegram payment instructions or create a verified
  claim. The current intake and claim procedures require `live`, and the current Owner setting
  procedure intentionally refuses `live` until a separate launch review proves the full adapter,
  worker, reconciliation, and execution boundaries.
