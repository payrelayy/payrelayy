# Resume signed receiver SMS deposits after the CBE Companion incident

The paired Samsung phone runs the SMS verifier build for both TeleBirr and CBE
Birr. The CBE incident left the SMS route and independent CBE verification
live, but both shared payment gates disabled. The running server release
`0cf74de563b8e332cc84b57eea21d64b331e1f7c` mounts the SMS broker and
signed Windows Companion transport; it does not mount a paid TeleBirr receipt
poll. The separate TeleBirr receipt phone proof is irrelevant to this SMS
recovery. The current deploy helper has SHA-256
`040cf1ceb65e514e4812503d6010e2f0c3a86506e764076d63d904fd6428e429`.

The 33 ETB CBE claim remains cancelled and in Owner review. The Owner
confirmed exactly one manual KemerBet credit. Never resubmit that reference
or use it as an activation test. Preserve all held SMS candidates and payment
history.

1. Confirm the exact running server release and helper digest, signed SMS
   intake within 24 hours for **both** receiving accounts from one current
   paired phone, a healthy phone reader, active Owner policy, four scoped
   SMS/broker/no-money logins, both paid receipt logins already disabled and
   expired, no paid receipt sessions or recent paid poll,
   and zero active execution jobs and unresolved attempts. The installed
   Companion must be the checksum-verified v0.1.57 package; its guarded
   no-money Player lookup and deposit-form preflight must have passed.
2. Confirm the reviewed one-use recovery and pre-retired-role migrations are
   applied and this workflow is on the exact passing `main` commit. The
   migrations only install and narrow a dormant, postgres-only function. They
   do not change the route, switches, roles, claims, jobs, or Player balances.
3. Start the exact installed Companion's automatic-deposits launcher as an
   **idle** routine worker. Sign in to its dedicated KemerBet Chrome profile
   directly if needed. Confirm a fresh signed worker lease and a successful
   independent watchdog run. Do not click Deposit or Transfer and do not make
   a test payment.
4. Dispatch `production-receiver-sms-cbe-stopped-resume.yml` on the passing
   `main` commit with the current Owner auth-user UUID, production project
   ref, and `ENABLE LIVE RECEIVER SMS DEPOSITS WITH CBE`. The workflow checks
   the immutable running server release before calling the one-use database
   function over verify-full TLS. The function rechecks the exact CBE-live,
   SMS-route-on, shared-gates-off profile, current Owner authority, signed
   intake for both providers, active receiver accounts, all scoped logins,
   empty ledger, and signed worker. It requires the two unmounted paid receipt
   logins to remain retired, advances the SMS cutoff, then enables the **two shared**
   gates in one transaction. The switch trigger requires the independent
   watchdog. The CBE switch stays live and the no-money login stays available
   for the mounted bridge, which cannot issue an assignment while the shared
   gates are live.
5. Recheck the two shared gates, CBE switch, SMS route and new cutoff, signed
   worker lease, phone status, and execution ledger. Observe the first
   naturally occurring deposit through protected status channels. Earlier
   submissions and SMS events cannot settle across the new cutoff. If an
   execution becomes uncertain, use the guarded financial stop and retain
   its evidence for Owner review.

The function rejects a repeated call after activation because the two shared
gates are no longer disabled. Any failed transaction rolls back the cutoff and
switch changes together.
