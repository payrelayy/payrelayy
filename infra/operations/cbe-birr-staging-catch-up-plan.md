# CBE Birr staging migration catch-up plan

This is a review plan, not an apply authorization. The staging bootstrap workflow remains restricted
to `main`, and its `apply` path remains blocked. No payment switch, receiver, customer deposit,
Player credit, or production state changes in this plan.

## Read-only snapshot, 18 October 2026

- Staging project `spzpiyxheappsfyswewl`: 87 of 272 canonical migrations recorded; latest applied
  `20260915190000`; 185 pending. Four pending versions precede that latest applied version:
  `20260912233000`, `20260914030000`, `20260914123000`, `20260914165043`.
- Six financial switches are `disabled` with empty settings. The private pilot alone is `dry_run`
  with a nonempty manifest. Its armed revision's window has expired. It has no reservations in the
  targeted read-only check. The pending migration `20261011183500` requires all seven switches
  disabled with empty settings.
- Three historical CBE Birr intents remain `intake_received`; two have `received` submissions.
  The targeted check found no CBE Birr deposit job or execution attempt. Catch-up must preserve
  these rows and must not infer a successful payment from them.
- The active CBE Birr receiver has a legacy v1 protection profile. Catch-up does not upgrade that
  receiver or establish a live authoritative receipt source.

## Required sequence before a staging catch-up

1. Review an exact commit and its pending SQL, including data effects, lock timeouts, grants,
   and the four historical gaps. Preserve a recoverable staging backup and verify a restore path.
2. Recheck the staging ledger, seven switch states, pilot revision, reservations, unresolved
   transfers, and CBE Birr intent/job counts immediately before any write. If any observation
   differs from the reviewed plan, stop and revise it. Run the aggregate-only
   [`staging-cbe-catch-up-preflight.sql`](../sql/staging-cbe-catch-up-preflight.sql) against the
   exact staging project before the pilot stop. Its `matches_reviewed_pre_stop_snapshot` result
   must be `true`. It is intentionally expected to become `false` after the Owner stop and must
   not be treated as an apply gate.
3. Obtain the user's approval for the payment-switch change, then use the Owner-controlled pilot
   stop path for the exact armed revision. Verify it stopped the revision and disabled the five
   deposit/provider switches; verify the two withdrawal switches remain disabled. Do not simulate
   this with a direct switch update.
4. Rehearse the **exact** reviewed migration set, in the linked preview's order, against a suitable
   privacy-controlled isolated staging copy that preserves relevant schema and data shapes. The
   disposable synthetic SQL suite is useful evidence but does not replace this check.
5. Prepare a separately reviewed, fail-closed catch-up apply path for the four older versions.
   The current ordinary `db push --linked --yes` would skip them. Bind the apply to the exact
   commit, staging project, freshly checked ledger and preview, all-disabled switch state, and
   the approved backup/restore point. Run a fresh `plan` before requesting deployment approval.
6. After an approved apply, reconcile every expected migration version and verify all seven
   switches remain disabled, the historical CBE Birr rows did not become jobs or credits, and
   the CBE Birr receiver and authoritative source remain unchanged. Stop on any mismatch.

The CBE Birr enablement phase remains separate: it needs a new protected receiver revision,
verified official receipt contract and runtime, and explicit approval for the receiver and payment
switch changes. This catch-up plan does not schedule or perform those actions.
