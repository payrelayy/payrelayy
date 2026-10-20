# Receiver SMS deposits

This is a default-off replacement for receipt and provider-page checks. It is not active in production.

When the verifier foreground service is online, it receives direct payment SMS for both receiver
accounts. It identifies TeleBirr or CBE Birr from the message body and extracts only the transaction
reference, received amount, and payment time. The phone queues the message in encrypted app storage,
signs a structured event with its existing paired key, and retries upload until acknowledged. The
server checks the signature and pairing, stores protected payment fields, and never stores raw SMS.

A customer can nominate one reference by sending text, an SMS, a receipt link, a screenshot, or a
PDF. The bot extracts only the reference; customer-supplied amount and payment time are ignored.
For a bare CBE Birr reference with a saved Player ID, use `/cbe REFERENCE`. The existing
`/deposit cbe_birr PLAYER_ID REFERENCE` command remains available. When provider and reference
match a received phone event, the first eligible submission can enter the existing one-use claim
and fenced KemerBet deposit job. The credited amount comes from the signed receiving-phone SMS.

The database holds a match for review if its facts conflict, its amount is outside current limits,
or it arrives after the five-minute automatic window. A payment older than one hour is classified
for Owner approval. No old payment may bypass the automatic age guard. A match cannot itself run a
Transfer; the existing Companion execution and reconciliation boundaries still apply.

## Before production cutover

The current branch still needs the Owner decision path for old SMS payments, final customer
notifications and Owner alerts, production runtime credential and
Compose wiring, exact catalog grants, and a signed phone APK rollout. Keep the SMS route off until
those are reviewed and deployed together. The legacy receipt route and live financial switches
are unchanged by this code.

The cutover must first verify no unresolved Transfer, back up the current release and paired-phone
state, and take an exact production snapshot of switches, roles, claims, jobs, and receiver revision.
An operator must approve the financial stop, deployment, phone worker start, route switch, and any
financial activation separately. Do not use a real payment as a smoke test or credit a Player by
hand to prove this path.
