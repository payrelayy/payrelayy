# Resume signed receiver SMS deposits after the CBE Companion incident

The paired Samsung receiver phone runs the SMS verifier build. It cannot run
the separate TeleBirr receipt lookup build at the same time. Production has
recent signed SMS events from both receiving accounts, and the existing SMS
route was enabled before the incident stop. This recovery returns to that SMS
path without inventing a TeleBirr receipt proof or replaying an old payment.

The 33 ETB CBE claim remains cancelled and in Owner review. The Owner confirmed
exactly one manual KemerBet credit. Never resubmit that reference or use it as
an activation test. Preserve all other held SMS candidates and payment history.

1. Check the exact current `main` release and required CI, seven switch states,
   SMS route, signed phone events from both providers and one current paired
   enrollment, Owner policy, and zero active jobs and unresolved attempts. The
   Companion must still be stopped. The phone's SMS reader should report
   `sms_inbox_idle` or another healthy running status.
2. Dispatch `production-receiver-sms-incident-recover.yml` with
   `recovery_step=stop_sms_route` and
   `STOP SMS ROUTE FOR INCIDENT RECOVERY`. It invokes the existing guarded
   database stop, leaves historical claims intact, and requires all seven
   financial switches and the SMS route to be disabled afterward.
3. Deploy the same reviewed server commit using `production-runtime.yml`
   `deploy-inert`, the exact `disabled` financial profile, `disabled` routine
   transport, pooler route, and `DEPLOY INERT PRODUCTION RUNTIME`. Verify the
   SMS broker is mounted and the no-money and paid receipt phone routes are
   absent. Keep the Companion stopped. The old cutover timestamp stays stored.
4. After the no-money service has closed its database connection, dispatch
   `recovery_step=retire_receipt_logins` with
   `RETIRE RECEIPT LOGINS FOR SMS RECOVERY`. This retires only the three
   obsolete TeleBirr receipt runtime logins; it checks the seven-switch
   stopped profile, old cutoff, empty execution ledger, no recent paid poll,
   and no live sessions. It does not erase any payment record.
5. Start the exact installed Companion v0.1.55 as an **idle** routine worker.
   Sign in to the dedicated KemerBet Chrome profile if needed. Confirm the
   Owner policy is current, the signed worker lease is fresh, the independent
   watchdog is running, and the execution ledger is still empty. Do not make
   a test payment or click Transfer.
6. Dispatch `recovery_step=activate_sms_deposits`, the current Owner auth-user
   UUID, and `ENABLE LIVE SMS DEPOSITS WITH CBE`. The existing database
   function checks signed SMS intake from both providers, a single enrolled
   phone, current Owner authority, three SMS/broker logins, three retired
   receipt logins, empty execution ledger, and the signed worker. Its switch
   trigger requires the independent watchdog. Activation sets a **new** SMS
   cutoff and enables only CBE verification plus the two shared payment
   gates. Earlier submissions and SMS events cannot automatically settle
   after this cutoff.
7. Re-read the exact switch and route state, fresh worker lease, and audit
   outcome. Observe the first naturally occurring deposit through protected
   status channels. If an execution becomes uncertain, use the existing
   guarded financial stop and preserve its evidence for Owner review.

Every workflow dispatch uses the exact passing `main` commit and production
project ref. A failed check leaves the shared gates disabled; no shortcut
should change a switch, receipt role, cutoff, claim, or job directly.
