# Production TeleBirr and CBE Birr recovery after the CBE Companion incident

The October 23 incident stop left both shared payment gates disabled while the
independent CBE Birr verifier remains configured live. Companion v0.1.55 passed
the guarded, no-money KemerBet Player lookup and amount-entry preflight. That
result does not prove a live credit. Keep automatic deposits stopped until the
separate financial activation succeeds with its own approval.

The 33 ETB CBE payment has one retained payment claim, a cancelled job, and an
attempt cancelled before Transfer. The Owner reported manually crediting it
once. Never resubmit, replay, automatically credit, or refund that claim as a
recovery test. Before changing Owner policy, check KemerBet history for exactly
one manual credit to the originally selected Player and retain the finding in
the protected operator incident record. Keep the database Owner review open
until a separately reviewed one-use disposition is available. Inspect the
other open execution reviews as well; a cancelled job prevents an automatic
retry but does not settle the customer obligation. If any review reveals an
uncertain Transfer or an unresolved attempt, stop here.

1. Review and merge the exact no-money proof refresh and CBE-stopped phone
   transport release, wait for required `main` push CI, and apply its database
   migration. Confirm the installed Windows release matches the intended code.
   Check that `payment_verification` and
   `deposit_execution` are `disabled`, CBE verification is `live`, and the
   remaining four legacy/withdrawal switches are `disabled`, all with empty
   settings. Require zero active execution jobs and zero prepared, fenced,
   reconciliation-required, or review-required attempts.
2. With separate approval, dispatch
   `production-routine-review-login-recovery.yml` at the exact passing `main`
   SHA with `confirm_financial_switch_profile=cbe-stopped-v1` and the phrase
   `RESTORE CBE STOPPED ROUTINE REVIEW LOGINS`. The workflow uses
   `production-cbe-stopped-runtime-preflight.sql` before and after restoring
   only the three scoped TeleBirr phone and settlement logins. Its SQL requires
   the exact CBE-live/shared-gates-off profile. It does not start the Windows
   worker, enable financial gates, or credit a Player.
3. With separate approval, rotate the production deploy helper using the
   checksum- and predecessor-pinned
   `fetanagent-production-v2-cbe-stopped-phone-proof-rotation-v3.sh`, then
   deploy the guarded `cbe-stopped-v1` phone transport overlay. It runs receiver
   SMS and no-money proof in the same private broker;
   it mounts no paid receipt poll or paid settlement credential. Confirm the
   deployed server matches the reviewed code and that the private broker and
   public no-money route pass their guarded checks. Recheck both shared gates
   are disabled before touching the paired phone.
4. Use the paired TeleBirr phone to produce a fresh signed V2 no-money receipt
   observation with `official_tls_origin`. Verify server policy accepted it and
   that the phone enrollment, signer, and all four broker/phone/settlement
   logins remain valid for more than one hour. In the CBE-live stopped profile,
   the reviewed no-money phone path may recheck a retained TeleBirr candidate
   that already had an accepted V2 official-origin observation more than 24
   hours ago. This refresh does not create a payment claim or Player credit;
   it stops issuing assignments once that enrolled phone has a fresh accepted
   proof. Start the enrolled phone's existing verification service only while
   the shared gates are disabled, then check the protected server observation
   status. If no retained candidate is eligible or the provider result goes to
   review, stop and investigate. Do not submit a new paid reference to
   manufacture this proof.
5. The current routine Owner policy event carries an `execution_uncertain`
   pause for the cancelled 33 ETB attempt. After the Owner has reviewed the
   manual credit and all open execution cases, use the existing authenticated
   Owner routine-policy action to create a fresh authorization event for the
   same reviewed KemerBet account. Recheck that the policy and transport are
   active. Never delete or edit the append-only pause to make the projection
   active. If the account, certificate, or transport has changed, use the
   guarded transport activation procedure instead of forcing an event.
6. Start the exact installed Companion as an idle routine worker only after
   its signed transport, paired certificate, KemerBet login, protected server
   marker, and stop control are verified. Recheck empty job and unresolved
   attempt counts, and require a fresh signed broker lease. Keep shared gates
   disabled throughout this step.
7. Obtain separate approval for `production-routine-financial-activate.yml`.
   Select the independently observed CBE mode `live` and use its exact
   `ENABLE LIVE ROUTINE DEPOSITS WITH CBE` phrase. The database operation must
   pass exact-main CI and its fresh proof, four-login, Owner, broker-lease,
   watchdog, empty-queue, and switch-profile checks. It changes only the two
   shared gates. Verify post-state and observe the first naturally occurring
   deposit through protected channels. Never create a synthetic payment or
   retry the incident claim.

If any check fails, keep both shared gates off and inspect the preserved
evidence. `production-routine-financial-stop.yml` remains the immediate stop
path after activation.
