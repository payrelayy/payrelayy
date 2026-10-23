# Owner manual-payment review production release

This one-use release preserves the live CBE Birr and receiving-SMS payment
profile while adding Owner review. It does not change financial switches,
replay a payment, or click KemerBet Transfer.

| Reviewed boundary                           | Exact value                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| Droplet                                     | `593344964`                                                                            |
| Expected running release and routine marker | `22f2ecfdb112d31b1807c148b021d9b7367e3134`                                             |
| Installed predecessor helper SHA-256        | `584ed859f06e22191b908dcd5b2c6ec451dc78acf789181eadd69720365f600f`                     |
| Successor helper SHA-256                    | `af847321e9a8a31b5ba75bb42848b18d4462062762b87f5bdf57983219406345`                     |
| Rotation script                             | `infra/operations/fetanagent-production-v2-owner-manual-payment-review-rotation-v4.sh` |

1. Merge the reviewed change, require passing PR and exact-main push CI, then
   inspect the live release, routine marker, helper digest, Owner/customer
   health, seven payment switches, SMS route, and unresolved execution work.
   A different predecessor or CBE-live profile is a stop condition. Never
   toggle payment switches to fit the workflow.
2. Stage the exact merged-main helper Git blob as
   `/root/fetanagent-production-v2-owner-manual-payment-review-rotation-v4-input/fetanagent-production-deploy-helper-v2.next`
   in a root-owned mode-`0700` directory, with the file root-owned
   mode-`0600`. Stage the exact merged-main rotation script separately.
   Verify both blobs and the helper SHA-256. Run the script as root with
   `inspect`; require `predecessor-exact; no production runtime changed`.
   Then run `rotate 'ROTATE EXACT PRODUCTION V2 OWNER MANUAL PAYMENT REVIEW HELPER V4'`
   and repeat `inspect`; require
   `successor-exact; rotation complete; no production runtime changed`.
   The script holds the deployment lock and rotates the checksum-pinned
   sudoers grant. Stop on any unexpected state.
3. Dispatch `production-runtime.yml` from the exact passing main commit
   with `mode=deploy-inert`,
   `confirm_production_project_ref=xzztugbgtulptnbpoelr`,
   `confirm_droplet_id=593344964`,
   `confirm_operation=DEPLOY SCREENSHOT READER WITH CBE LIVE`,
   `confirm_telebirr_pilot_revision_id=not-applicable`,
   `confirm_telebirr_activation_epoch=not-applicable`,
   `confirm_routine_deposit_transport=enabled`,
   `confirm_financial_switch_profile=cbe-live-v1`, and
   `confirm_database_route=pooler`. Set `confirm_main_commit_sha` to that
   full main SHA. This deployment accepts the previous Owner approval catalog
   only while all new manual-review functions are absent. The new Admin routes
   refuse the old auto-Approve action. Require the workflow's old-release,
   empty-job, CBE-live, public-health, signed-marker, and unchanged-switch
   checks to pass.
4. Once the new application is healthy, dispatch
   `supabase-production-release.yml` for the same main SHA with
   `confirm_production_project_ref=xzztugbgtulptnbpoelr` and
   `confirm_production_apply=APPLY PRODUCTION MIGRATIONS`. The atomic
   `20261023150000_owner_manual_payment_review.sql` migration installs the
   one-use manual guard and Owner functions, then withdraws the obsolete
   automatic Owner approval functions. Check the migration result and the
   Owner page. If migration fails, keep the new application running against
   the previous schema and investigate; the old auto-Approve endpoint remains
   disabled in the new application.

Do not restart the pre-migration application after the new migration. Its
Owner grant allowlist cannot serve the new schema. Do not use an old release
as an automatic rollback target after migration. Keep all payment evidence,
claims, and execution reviews intact.
