# Owner SMS inbox — guarded production release

This release makes the Owner SMS view load the newest 50 signed payment messages
on opening, with provider and status filters that apply immediately. It also
allows a low-value SMS to appear in the inbox without offering an ineligible
manual-credit action. No database migration or payment switch change is needed.

| Boundary                                    | Reviewed value                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| Production Droplet                          | `593344964`                                                                       |
| Production Supabase project                 | `xzztugbgtulptnbpoelr`                                                            |
| Required running release and routine marker | `03c65fe835f952a7b5e6ef628a60893ff7229caf`                                        |
| Installed helper and sudoers pin            | `f9dff78b64bec9722e1170ac7e36fa084d6c01233dee15741f0cf5a5d2836027`                |
| Successor helper and sudoers pin            | `9a45d0e999335b923fcc2506e7e985b063bc7e5d124cc67d4def8b4e50a209df`                |
| One-use rotation                            | `infra/operations/fetanagent-production-v2-owner-sms-inbox-helper-rotation-v1.sh` |
| Payment profile                             | `cbe-live-v1`, signed routine transport `enabled`, SMS route enabled              |

1. Require a passing PR and exact-main push CI. Recheck the Droplet ID, running
   release and routine marker, installed helper and sudoers digests, Owner and
   customer health, payment switches, and SMS route. A changed predecessor or
   payment profile stops the release.
2. Stage the exact merged-main helper Git blob in the root-owned, mode-`0700`
   directory
   `/root/fetanagent-production-v2-owner-sms-inbox-helper-rotation-v1-input`
   as `fetanagent-production-deploy-helper-v2.next`, root-owned mode-`0600`.
   Stage the exact merged-main rotation script separately. Verify both blobs,
   their digests, and Bash syntax. Run the rotation script as root with
   `inspect` and require `predecessor-exact; no production runtime changed`.
   Then run `rotate` with
   `ROTATE EXACT PRODUCTION V2 OWNER SMS INBOX HELPER V1` and repeat `inspect`;
   require `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the exact passing merged-main SHA with
   `mode=deploy-inert`, the project and Droplet IDs above,
   `confirm_operation=DEPLOY SCREENSHOT READER WITH CBE LIVE`, both TeleBirr pilot
   inputs `not-applicable`, `confirm_routine_deposit_transport=enabled`,
   `confirm_financial_switch_profile=cbe-live-v1`, and
   `confirm_database_route=pooler`. Require healthy Owner, customer, and bot
   services, the carried routine marker, and unchanged switch fingerprint.
4. Verify the SMS view shows the latest 50 messages without filtering, can show
   older messages, and applies/clears provider and status filters. Confirm a
   low-value SMS is visible with no manual-credit action. Check public health,
   notification queue, SMS route, and payment switches. Do not submit or replay
   a real payment for this verification.

If a guard or deployment fails, stop and inspect the specific failure before
retrying. Do not change payment switches or receiver details to make a guard
pass.
