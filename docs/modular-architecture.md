# Extending FetanAgent deposits

This map guides additions of payment methods and credit platforms without replacing the live deposit system. It describes a staged direction, not a new production route or a change to financial switches.

## Current path and ownership

| Step                   | Existing implementation                                                                                                                                                                        | Owner of the decision                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Customer proof         | `apps/bot` and `apps/api` extract a reference from text or an image. Screenshot correction uses signed SMS candidates.                                                                         | Candidate extraction only; no payment authority.                                                        |
| Incoming payment       | The paired phone and `apps/telebirr-device-bridge` send signed receiver-SMS observations to `apps/telebirr-assignment-broker`.                                                                 | The server checks the device signature and records protected source facts.                              |
| Verification and claim | The receiver-SMS settlement path matches the submission to the source event. `app.provider_payment_evidence` and `app.deposit_payment_claims` hold authoritative evidence and a one-use claim. | Database policy checks receiver, amount, time, duplicate use, and eligibility before enqueueing credit. |
| Platform credit        | `apps/windows-companion/src/routine-deposit-worker.ts` uses the KemerBet browser and the existing durable lease, fence, signed dispatch, and reconciliation protocol.                          | The one-shot execution store and platform-specific Companion route.                                     |
| Review and messages    | Owner controls show held or outside-credited payments; the existing notification path delivers customer outcomes.                                                                              | Owner actions and durable message delivery.                                                             |

Existing registry tables include `app.platforms`, `app.payment_providers`, and `app.receiver_accounts`. The current receiver constraint permits one active account per provider. The bot and Owner payment-method types still enumerate TeleBirr and CBE Birr, and the live Companion policy is KemerBet-specific. These are expansion points, not reasons to replace the ledger.

## Stable boundaries

1. **Payment source and evidence:** Push sources such as the paired phone produce a `PaymentSourceObservation` after their own source verification. Pull sources may use `PaymentEvidenceReader` to look up candidate references. Neither source owns the receiver, freshness, duplicate, or credit decision. A screenshot is never a source fact. The existing combined `PaymentProviderVerifier` export remains available during migration.
2. **One-use claim:** The database remains the authority that binds one incoming transfer to one deposit intent across platforms. A payment adapter cannot claim a payment, approve a deposit, or credit an account. Canonical reference rules must be proven for each source before the uniqueness key is relied upon.
3. **Platform credit adapter:** `PlatformCreditAdapter` describes a platform-specific one-shot submission and reconciliation. The database must issue and check the claim, lease, and final-action fence before an adapter can act. `confirmed` requires positive platform evidence; `stopped_before_final_action` means no final action occurred; every ambiguous post-action outcome is `uncertain` and held. The `orderReference` is for correlation and cannot substitute for external idempotency or justify a retry.
4. **Configuration:** Registry rows identify active methods and platforms. Availability also depends on source readiness, receiver binding, worker health, and Owner switches. A config value never activates an adapter that has not been implemented and validated.

The signed-SMS broker now projects its verified phone event into `PaymentSourceObservation` before passing the same facts to its existing SQL intake. This does not change the private database matcher, grant, payment claim, or credit route. `PaymentEvidenceReader` and `PlatformCreditAdapter` remain unwired design boundaries; their types do not provide credentials or action authority.

## Important current constraints

- The phone's signed SMS proves which paired device reported the message. The current SMS does not include the receiver number. More than one active account per method needs an exact account-binding design, source-specific routing, and database changes before it can be safe.
- The current amount model is ETB in minor units. Extend currencies when a real integration requires them, with explicit rounding and provider precision rules.
- Customer-facing labels may be configured per platform. Live database names such as `player_id` can remain behind adapters while the shared application boundary uses `customerAccountId`.
- A platform API needs its own account lookup, final-action authority, outcome evidence, and reconciliation. Moving KemerBet from the Companion to an API requires those capabilities; a config switch is only the final routing step.
- A manual Owner credit records a verified outside action. It must not claim that the platform credited a customer before the Owner has performed and checked that action.
- Verification retries and credit retries have different safety rules. A missing or delayed source event can be polled and then reviewed. A fenced external credit cannot be submitted again merely because its response was lost.

## Incremental migration

1. **Foundation (PR #1063):** document the current path and export payment-evidence and platform-credit ports. No schema, bot, Owner, Companion, or switch behavior changes.
2. **Signed-SMS source edge (this change):** project the verified phone event into the shared source-observation shape and prove that the broker passes the same protected fields to its existing private SQL intake for TeleBirr and CBE Birr. The database matcher, one-use claim, and five-minute policy remain unchanged. A future pull-based bank source can use `PaymentEvidenceReader` without forcing the phone path into a lookup API.
3. **Credit edge:** map the current KemerBet Companion lease and reconciliation to `PlatformCreditAdapter` without changing its signed protocol or final-action fence. Test definite pre-action stop, confirmed history, missing history, and uncertain outcomes. Route traffic only after parity is established.
4. **Method and platform lists:** make the bot and Owner read a validated registry response with safe defaults and per-method readiness. Preserve the existing TeleBirr and CBE Birr customer flow while adding a new method.
5. **First new integration:** add one method with a reliable incoming-payment source and exact receiver binding. Enable it independently, observe it in shadow mode, then activate it with a controlled switch. Add a new credit platform through a separately validated adapter and reconciliation path.

Each production route change needs its own compatibility checks, current-switch snapshot, rollback path, and confirmation that no unresolved final action would be retried. The structural work above does not itself require a production database migration or Companion update.
