# Receiver SMS deposits

This is a default-off replacement for receipt and provider-page checks. It is not active in production.

When the verifier foreground service is online, it receives direct payment SMS for both receiver
accounts. It identifies TeleBirr or CBE Birr from the message body and extracts only the transaction
reference, received amount, and payment time. The phone queues the message in encrypted app storage,
signs a structured event with its existing paired key, and retries upload until acknowledged. The
server checks the signature and pairing, stores protected payment fields, and never stores raw SMS.
While the verifier is running, it checks the encrypted phone queue about every three seconds when
idle; a recorded event is followed by the next queued event after about one second. If the phone is
offline or a payment SMS cannot be read, there is no automatic credit from that SMS.

A customer can nominate one reference by sending text, an SMS, a receipt link, a screenshot, or a
PDF. The bot extracts only the reference; customer-supplied amount and payment time are ignored.
For a bare CBE Birr reference with a saved Player ID, use `/cbe REFERENCE`. The existing
`/deposit cbe_birr PLAYER_ID REFERENCE` command remains available. When provider and reference
match a received phone event, the first eligible submission can enter the existing one-use claim
and fenced KemerBet deposit job. The credited amount comes from the signed receiving-phone SMS.

The database holds a match for review if its facts conflict, its amount is outside current limits,
or it arrives after the five-minute automatic window. A missing phone SMS after five minutes is
held for review, never called invalid. A payment older than one hour waits in the Owner page's
"SMS payments to review" inbox. An active Owner can approve or reject the exact matched event;
held items appear there without an approval button so support can investigate safely.
Approval reruns the current one-use, amount, Player, receiver, switch, and execution checks before
one job can be queued. The existing Companion execution and reconciliation boundaries still apply.
Masked customer messages are queued for an old payment, a review hold, an Owner rejection, and a
terminal credit result. They use the existing Telegram notification lease and retry path.

## Before production cutover

The current branch still needs production runtime credential and Compose wiring,
exact catalog grant activation, and a signed phone APK rollout. The Owner list and decision SQL
have no runtime grant at migration time so the currently deployed exact-catalog Owner service
remains healthy. Grant access only after the new Owner app is deployed and checked. Keep the SMS
route off until the phone, bot, bridge, broker, Owner app, database roles, and customer messaging
are reviewed and deployed together. The legacy receipt route and live financial switches are
unchanged by this code.

The cutover must first verify no unresolved Transfer, back up the current release and paired-phone
state, and take an exact production snapshot of switches, roles, claims, jobs, and receiver revision.
An operator must approve the financial stop, deployment, phone worker start, route switch, and any
financial activation separately. Do not use a real payment as a smoke test or credit a Player by
hand to prove this path.
