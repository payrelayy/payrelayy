# Telegram deposit proof tracking

This is the first implemented slice of the
[Telegram-first deposit milestone](real-money-go-live-phases.md#next-delivery-milestone--telegram-deposit-from-submission-to-confirmed-result).
It makes the existing amount-free dry-run proof submission trackable. It does not verify a payment,
create a financial job, or activate the KemerBet companion.

## Customer flow

1. A customer submits the existing `/deposit telebirr PLAYER_ID TRANSACTION_ID` or
   `/deposit cbe_birr PLAYER_ID TRANSACTION_ID` command. The existing capture authorization and
   dry-run restrictions still apply. For TeleBirr, the final argument may also be a pasted receipt
   URL or the full SMS text, including line breaks; the bot extracts only a transaction-ID candidate.
2. The acknowledgement displays a `p1.<opaque token>` tracking reference and a **Check status**
   button. No amount, raw payment reference, or Player ID is encoded into that reference.
3. The customer can press the button or send `/deposit_status p1.<opaque token>` in their private
   chat. Repeated checks and a restarted bot use the same persisted proof request.
4. The response identifies the payment provider and says the proof was received in simulation.
   It explicitly states that no payment was verified or credited. `/help` and `/deposit` explain
   the current command format and simulation boundary.

An unknown request, a request belonging to another customer or Telegram identity, and an
unavailable request receive the same customer-facing status-unavailable response. A copied button
or tracking reference is not authorization to view a proof.

## TeleBirr receipt URL and SMS input

The bot uses the shared, versioned TeleBirr candidate extractor through its candidate-only export.
It scans both receipt paths and supported transaction/invoice labels, even when a pasted message
starts with a URL. Repeated occurrences of the same normalized ID produce one candidate. Distinct
candidates produce a fixed **More than one transaction ID was found. No proof was submitted.**
response; the customer must explicitly choose and resubmit one direct ID. The bot does not display
the candidate list, keep a draft in memory, or guess which payment the customer intended.

The complete command is bounded to 16 KiB of UTF-8 before parsing. Forbidden control characters,
malformed recognized reference contexts, short/overlong IDs, and non-ASCII or connected suffixes
fail closed instead of silently truncating or ignoring a conflicting reference. Ordinary sentence
punctuation and SMS line breaks remain supported. Unlabelled phone numbers, amounts, dates, and
words are not scanned as references. Direct-reference commands preserve their existing envelope
spelling so a repeated update remains byte-for-byte compatible with prior direct submissions.

Only the selected reference enters the existing signed `deposit_proof_command` envelope, where
the API encrypts and fingerprints it before database capture. The original SMS, URL, submitted
host, receiver name, claimed amount, and other receipt facts are not forwarded, echoed, or logged.
No customer URL is fetched. A receipt path on a customer-controlled host is only candidate text;
it is never provider authority. Extraction proves neither payment nor amount and cannot settle or
execute a deposit. CBE Birr remains direct-reference-only; photos, PDFs, OCR, and interactive
candidate-selection storage are not implemented by this slice.

This input extension adds no action kind, private database function, grant, migration, financial
switch, or live verifier connection. Accepted inputs receive the same persisted `p1.` proof and
customer-scoped status lookup as direct references.

## Request and identity boundary

The new `deposit_proof_status_command` carries only a canonical compact proof UUID token in addition
to the existing signed Telegram identity envelope. The API derives the actor from the recorded
private Telegram update; callers cannot supply a customer ID. The new private
`app.get_telegram_customer_deposit_proof(uuid,uuid)` function requires an active exact Telegram
identity, its private chat and conversation, and an original receipt binding that same identity to
the proof. It returns only the proof ID, provider code, fixed proof status, and submission time.

The function is read-only and executable only through the existing Player-actions role. It adds no
table access or financial write permission. The runtime catalog preflight now expects eleven exact
functions, including this getter. Invalid actor rejection and an empty owned-proof result map to
the same customer-facing unavailable outcome; malformed database results and transport errors
remain service failures without exposing database detail.

`p1.` tracking references and `dps1.` button callbacks identify proof requests. The existing
unprefixed `/deposit_status <token>` command continues to identify legacy deposit intents. The API
never retries a failed proof lookup against the deposit-intent getter, or treats the two IDs as
interchangeable. Both command and callback routes use the same authenticated proof lookup.

## Rollout and remaining work

The migration and updated API must be deployed together because the exact runtime function
allowlist changes from ten to eleven. An old database fails the new preflight, and an old API
preflight rejects the added function. Coordinate the normal API/bot rollout and readiness check;
do not broaden grants or disable the preflight to make mismatched versions start.

Existing `deposit_proof_requests` are immutable simulation records. A later change to a runtime
financial switch does not turn these records into live requests or change their tracking status.
The later live intake must define its own explicit proof-to-verification-to-deposit lineage and
customer projection. It must not promote or backfill historical simulation proofs.

The guided multi-step deposit conversation, saved Player-ID selection, receiver instructions, file
and OCR input, live verifier composition, companion execution integration, and durable completion
notifications remain separate implementation work. A guided flow must persist its draft and
exact-once step receipts in the backend; it must not reinterpret registration text through a
bot-local in-memory wizard. These input/tracking slices neither claim nor substitute for those
capabilities.
