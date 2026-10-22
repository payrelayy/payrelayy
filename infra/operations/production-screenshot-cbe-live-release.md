# Screenshot reader release while CBE Birr deposits are live

The screenshot reader from PR #914 is merged, but the original deploy-inert
path is blocked by the current production payment state. On 2026-10-22 the
cbe_birr_authoritative_verification, payment_verification, and
deposit_execution switches became live. The other four reviewed payment
switches remain disabled; the receiver SMS route and its dedicated runtime
logins are enabled. The existing inert preflight correctly rejects this state.
Do not turn off live switches merely to pass that preflight.

This one-use release profile preserves the current CBE Birr payment state. It
selects the same sealed inert-maintenance runtime overlay already in
production, skips SMS grant and login activation, and does not execute SQL that
updates a payment switch or receiver route. It requires the exact seven-switch
profile, enabled SMS route and grants, no trusted TeleBirr authority, and
disabled legacy financial runtime logins. It records a fingerprint of all
seven switch rows, rechecks it immediately before activation and after the
public service checks, and refuses to finalize if it changed.

The signed routine transport has a separate root-owned marker bound to the
release SHA. The reviewed helper's opt-in carry-routine-marker activation
holds the host deployment lock, accepts only the exact current predecessor,
checks the new release's routine materials, records a root-only rollback
receipt, and atomically rebinds the marker to the new SHA. Its rollback
restores the prior marker before restarting the prior release. The ordinary
deploy-inert path does not perform this handoff. Do not edit the marker by hand.

Immediately before activation, a read-only gate requires no open or leased
deposit job and no unresolved execution attempt. This is a snapshot: because
payments stay live, a new job could arrive after the check. The existing
runtime's lease and reconciliation rules must handle an interruption. Use a
quiet operating period and do not send a test payment.

## Release sequence

1. Require the exact merged main commit and passing main push CI. Confirm the
   current Droplet is 593344964, current release is
   906b5b6a6486a26450d302b9f911feb3e35d30e4, its routine-deposits
   marker is present, and the signed routine transport returns HTTP 400 for
   an empty request. Confirm the exact CBE-live database profile read-only.
2. Rotate the checksum-pinned v2 production helper using
   [production-v2-screenshot-helper-rotation-v1.md](production-v2-screenshot-helper-rotation-v1.md).
   Its inspect must report predecessor-exact first and successor-exact
   after rotation. Rotation changes no running service or payment gate.
3. Dispatch Production application runtime from the exact main commit with:

   | Input                              | Value                                  |
   | ---------------------------------- | -------------------------------------- |
   | mode                               | deploy-inert                           |
   | confirm_production_project_ref     | xzztugbgtulptnbpoelr                   |
   | confirm_main_commit_sha            | full merged main SHA                   |
   | confirm_droplet_id                 | 593344964                              |
   | confirm_operation                  | DEPLOY SCREENSHOT READER WITH CBE LIVE |
   | confirm_telebirr_pilot_revision_id | not-applicable                         |
   | confirm_telebirr_activation_epoch  | not-applicable                         |
   | confirm_routine_deposit_transport  | enabled                                |
   | confirm_financial_switch_profile   | cbe-live-v1                            |
   | confirm_database_route             | pooler                                 |

4. Require the workflow to pass its exact-main CI gate, CBE-live preflight,
   no-in-flight-operation gate, old-release status, public HTTPS smoke,
   signed transport check, unchanged payment-switch fingerprint, and final
   helper status. A failed activation must restore the predecessor marker and
   release. Check the DigitalOcean spend alert and model error rate
   during the pilot. Keep raw customer screenshots, references, and credentials
   out of issue, PR, and workflow logs.

Any different switch, route, release, helper digest, job, lease, or CI state is
a stop condition. Do not fall back to the disabled profile, direct database
route, or a financial switch update.
