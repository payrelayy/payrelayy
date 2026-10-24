# Receiver SMS deposits

This receiver-SMS path replaced receipt and provider-page checks and is active in production.

When the verifier foreground service is online, it receives direct payment SMS for both receiver
accounts. Before queuing a message, the phone requires the exact SMS sender `127` for TeleBirr or
`CBEBirr` for CBE Birr, with the same sender on every multipart segment. Personal-number SMS are
ignored even if their text looks like a payment. It identifies the provider from the message body
and extracts only the transaction
reference, received amount, and payment time. The phone queues the message in encrypted app storage,
signs a structured event with its existing paired key, and retries upload until acknowledged. The
server checks the signature and pairing, stores protected payment fields, and never stores raw SMS.
The sender-gated release uses a new encrypted queue. Any pending entries from an older release lack
sender provenance; they remain sealed on the phone and are not uploaded by the new release.
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

Install the current signed receiver SMS APK on the paired receiver phone. Verify the release signer
matches the installed app before an in-place upgrade, then verify the existing pairing, SMS
permission, and reader status. A different phone needs a separate pairing. Approve the SMS route
cutover and any financial activation separately. No receiving-phone SMS collected before the
cutover timestamp can be matched for automatic credit.

The paired signing key belongs to the phone, not to each Owner receiver revision. An Owner edit
to the TeleBirr receiver name while keeping the same protected number inherits the current
phone proof. A new number does not require pairing the same phone again, but TeleBirr stays
unavailable for new deposits until that phone records a signed TeleBirr payment SMS after the
number change. The Owner confirms the phone now receives the new account's SMS and no longer
receives the previous account's SMS before saving the change. The incoming SMS does not contain
the receiving number, so this Owner confirmation is necessary. Earlier payments remain attached
to their original receiver revision for review. Replacing or revoking the phone still requires
the separate phone-pairing procedure.

The cutover must first verify no unresolved Transfer, back up the current release and paired-phone
state, and take an exact production snapshot of switches, roles, claims, jobs, and receiver revision.
An operator must approve the financial stop, deployment, phone worker start, route switch, and any
financial activation separately. Do not use a real payment as a smoke test or credit a Player by
hand to prove this path.
