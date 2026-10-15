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
The Android parser retains that suffix locally. A domain-separated version-3 transcript can sign
it in a test-only, opt-in path. The operational collector still emits version 2 because the paid
staging table and atomic claim accept only version 2. This draft cannot be merged or deployed as
old-receiver auto-credit until those downstream guards are implemented. No full phone number, name,
receipt, or reference belongs in diagnostics or application logs.

The paid evidence adapter now projects the name digest and credited-party suffix from a
signature-verified version-3 observation. It projects `null` for the suffix on version 2 and
never grants money authority. The direct-instruction selector consumes these projected facts in a
cross-component test; production does not call that selector or emit version 3.

An additional review-only adapter can extract a completed receipt's name digest and credited-party
suffix when a valid signed v3 observation is rejected by the **current** receiver policy. It
requires the server assignment signature, device signature, matched challenge snapshot, phone's
official-origin attestation, reference match, completed status, ETB amount, and bounded times.
This accommodates an old wallet without treating a policy mismatch as a paid acceptance. It
does not authenticate the receipt independently of the paired phone, call the SQL preview, stage
an observation, or permit a claim. The operational paid path remains v2 and unchanged.
An unchanged receiver name is insufficient to distinguish a newly active wallet from the retired
wallet when both belong to the same person; the paid v3 path must compare the signed credited-party
suffix against the exact revision selected by the transactional instruction match before a claim.

A separate postgres-only database preview now reads the immutable candidate, same-private-chat
instruction message, one-hour receipt, all configured TeleBirr receiver revisions, and a private
emergency-revocation veto. It returns a possible unique instruction and
`financial_action_allowed = false` in every case. Its receipt digest, suffix, and occurrence-time
arguments are **not** authenticated by that function. It cannot update the candidate, issue a
challenge, create a claim, or credit a Player; no application role can invoke it. The operational
capture trigger still binds the active receiver, so the preview is not an old-receiver paid path.
Its SQL integration test must pass in a disposable database before this migration is deployable.

The Owner chose automatic grace matching by the exact normalized official credited-party full name
**and** the visible four-digit suffix when that pair identifies exactly one configured immutable
receiver revision. This is an accepted heuristic, not proof of the hidden digits. A missing,
unrecognized, duplicated, or conflicting field; a same-name/suffix collision; or any other
uncertainty goes to review. A payer-number suffix must never be used as a fallback.

## Required end-to-end sequence

1. The issued Telegram instruction records its immutable receiver revision, Player ID, identity,
   chat, issuance time, expiry, and bot message ID. It lasts exactly one hour. A direct reference
   submission does **not** need to reply to that message: after the signed receipt arrives, the
   database may associate it with exactly one unexpired instruction for that same Telegram
   identity, private chat, and Player, using the receipt's credited-party name and visible suffix.
   The user cannot select an old receiver by supplying an instruction ID or copying message text.
2. The current intake trigger always binds the active receiver before receipt verification; that
   must be replaced with a fail-closed two-stage binding. Intake preserves the submission and
   identity without assuming an old receiver. Only the signed-receipt decision can choose an
   instructed retired revision. More than one matching instruction (even for the same receiver)
   stays in review. A late submission for a payment made within an expired instruction is retained
   for review, not discarded or auto-credited under the expired instruction. The advisory selector
   in the foundation package expresses this rule but does not grant credit authority.
3. The paired phone's next **versioned** signed observation carries the credited-party suffix,
   with the exact field label and mask grammar above. The signer and server verify the same
   canonical transcript. Existing v2 observations remain valid for their existing path but cannot
   authorize old-receiver grace.
4. Challenge issuance, enrollment, staging, and the atomic claim preserve the exact instructed
   old receiver revision during ordinary rotation, without treating it as the globally active
   revision. The database independently checks the signed receipt's full-name digest and suffix
   against all relevant immutable receiver revisions and requires a unique pair **and** a unique
   matching instruction for this Telegram identity and Player. No bot-side or advisory match is
   accepted as the financial decision.
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
