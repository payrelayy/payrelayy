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

## Production cutover order

The production inert overlay replaces the old receipt poll with the SMS broker, bridge, bot and
API modes. Its deployment workflow creates separate 29-day SMS ingest and settlement logins,
grants only the reviewed private API and Owner functions, and mounts the same protected reference
fingerprint master in the API and broker. The SMS database route and all seven financial switches
remain off during that deployment. A failed first deployment restores the previous disabled grants
and logins. The digest-pinned host deploy helper must be installed separately before using the
changed deployment workflow.

The signed Android `0.5.32-receiver-sms` APK is not yet installed on the receiver phone. The
connected receiver phone has no FetanAgent package, so installation needs a new pairing; an
in-place update cannot preserve an absent app key. Pair and verify the phone before approving a
separate SMS route cutover and any financial activation. No receiving-phone SMS collected before
the cutover timestamp can be matched for automatic credit.

The cutover must first verify no unresolved Transfer, back up the current release and paired-phone
state, and take an exact production snapshot of switches, roles, claims, jobs, and receiver revision.
An operator must approve the financial stop, deployment, phone worker start, route switch, and any
financial activation separately. Do not use a real payment as a smoke test or credit a Player by
hand to prove this path.
