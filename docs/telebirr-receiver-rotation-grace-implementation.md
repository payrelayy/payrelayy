# TeleBirr one-hour receiver-rotation grace: implementation boundary

This is an implementation checklist, not an activation record. The existing paid path still binds
each candidate, signed phone lookup, and atomic payment claim to the **currently active** receiver.
Changing the payment-card lifetime alone does not permit an old-receiver Player credit. Until all
checks below are implemented and exercised together, a receipt for a retired receiver must not be
silently rebound to the new receiver or auto-credited.

## Reviewed receipt field

The official TeleBirr page visibly distinguishes `Payer telebirr no.` from
`Credited party account no`. The observed credited-party value has the shape
`[four digits]****[four visible digits]`. Only the latter field may supply the receiver suffix.
The current Android parser retains that suffix locally without adding it to the v2 signed receipt
facts or changing any financial decision. No full phone number, name, receipt, or reference belongs
in diagnostics or application logs.

The Owner chose automatic grace matching by the exact normalized official credited-party full name
**and** the visible four-digit suffix when that pair identifies exactly one configured immutable
receiver revision. This is an accepted heuristic, not proof of the hidden digits. A missing,
unrecognized, duplicated, or conflicting field; a same-name/suffix collision; or any other
uncertainty goes to review. A payer-number suffix must never be used as a fallback.

## Required end-to-end sequence

1. The issued Telegram instruction records its immutable receiver revision, Player ID, chat,
   issuance time, expiry, and bot message ID. It lasts exactly one hour. A reply to its exact bot
   message can bind a submitted reference to that instruction; an unrelated direct submission
   cannot claim an old-receiver grace instruction by guessing an ID.
2. Candidate intake verifies the instruction binding under the same identity and Player. The
   database chooses the instructed receiver revision before its insert trigger runs. If several
   instructions could match and the submission is not an exact reply, route to review. A late
   submission for a payment made within an expired instruction is retained for review, not
   discarded or auto-credited under the expired instruction.
3. The paired phone's next **versioned** signed observation carries the credited-party suffix,
   with the exact field label and mask grammar above. The signer and server verify the same
   canonical transcript. Existing v2 observations remain valid for their existing path but cannot
   authorize old-receiver grace.
4. Challenge issuance, enrollment, staging, and the atomic claim preserve the exact instructed
   old receiver revision during ordinary rotation, without treating it as the globally active
   revision. The database independently checks the signed receipt's full-name digest and suffix
   against all relevant immutable receiver revisions and requires a unique pair.
5. The database also checks completed status, exact reference, settled principal, occurrence and
   submission times, instruction window, Owner policy, one-use claim, current Player eligibility,
   and the unchanged sequential-credit boundary. Emergency revocation blocks new grace claims
   immediately. No phone or bot action itself moves money.

## Release gate

Tests must cover payment just before and just after rotation, the exact one-hour boundary, late
submission, newer instructions in the same chat, same-name/suffix collisions, missing or changed
mask, payer/receiver field confusion, duplicate reference, concurrent claims, emergency revocation,
phone offline, and a stale or wrong signed protocol version. The migration must be tested in a
disposable database and deployed with financial switches off. Live TeleBirr may be restored only
through the existing guarded workflow after the phone, Companion, ledger, and watchdog checks pass.
