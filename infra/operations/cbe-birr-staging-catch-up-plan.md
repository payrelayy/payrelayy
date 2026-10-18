# CBE Birr staging migration catch-up plan

This is a review plan, not an apply authorization. The staging bootstrap workflow remains restricted
to `main`, and its `apply` path remains blocked. No payment switch, receiver, customer deposit,
Player credit, or production state changes in this plan.

## Historical pre-stop snapshot, 18 October 2026

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

## Owner stop completed, 18 October 2026

The user approved the exact expired staging pilot stop. The reviewed
`app.stop_private_live_deposit_pilot` Owner emergency-stop function stopped revision
`c833aa88-b315-404b-b86d-ac40ec79c50a` with reason `owner_stop` and wrote one audit event.
All five deposit/provider switches and both withdrawal switches are now disabled with empty
settings. The post-stop check found no armed revision, reservation, job, execution attempt, or
active trusted TeleBirr epoch. The historical CBE Birr rows and legacy v1 receiver counts remained
unchanged. Run the read-only
[`staging-cbe-post-stop-preflight.sql`](../sql/staging-cbe-post-stop-preflight.sql) before the next
staging step; the pre-stop check above is now expected to fail.

The staging project currently has no scheduled backup or point-in-time recovery in its Supabase
dashboard. The old staging VM is unreachable, while the current DigitalOcean inventory shows the
former staging Droplet ID running the production stack. A fresh encrypted backup and a verified
isolated restore remain prerequisites for migration apply.

## Required sequence before a staging catch-up

1. Review an exact commit and its pending SQL, including data effects, lock timeouts, grants,
   and the four historical gaps. Preserve a recoverable staging backup and verify a restore path.
2. Recheck the staging ledger, seven switch states, pilot revision, reservations, unresolved
   transfers, and CBE Birr intent/job counts immediately before any write. If any observation
   differs from the reviewed plan, stop and revise it. Run the aggregate-only
   [`staging-cbe-catch-up-preflight.sql`](../sql/staging-cbe-catch-up-preflight.sql) against the
   exact staging project before the pilot stop. That check passed immediately before the approved
   Owner stop. For subsequent work, use the post-stop preflight above; neither query authorizes
   migration apply.
3. Completed: the Owner-controlled pilot stop disabled all five deposit/provider switches and
   left both withdrawal switches disabled. Do not simulate or replay it with a direct switch update.
4. Rehearse the **exact** reviewed migration set, in the linked preview's order, against a suitable
   privacy-controlled isolated staging copy that preserves relevant schema and data shapes. The
   disposable synthetic SQL suite is useful evidence but does not replace this check.
   The read-only [`staging-cbe-catalog-fingerprint.sql`](../sql/staging-cbe-catalog-fingerprint.sql)
   compares eight `app` catalog categories with the disposable 87-migration baseline without
   copying customer rows or function bodies. A matching fingerprint narrows schema drift; it is
   still not a staging data copy or a restore rehearsal.
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
