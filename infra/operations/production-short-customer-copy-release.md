# Short customer bot copy — guarded production release

This release shortens Player ID and payment messages, removes the extracted
reference ending from receipt acknowledgements, and leaves standalone Player ID
updates and payment proof detection intact. It requires no database migration
or payment switch change.

| Boundary                                    | Reviewed value                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Production Droplet                          | `593344964`                                                                           |
| Production Supabase project                 | `xzztugbgtulptnbpoelr`                                                                |
| Required running release and routine marker | `4e4faa65ae2b536424a857b5003fbc675343b4c8`                                            |
| Installed helper and sudoers pin            | `6280df25be1900634a2fc50111fd1161105b73dc92b5ef187c931ae8580b2e43`                    |
| Successor helper and sudoers pin            | `90778252cd69601243cb68e90b208cbac08e10eecd7ce95582c0686983516d1b`                    |
| One-use rotation                            | `infra/operations/fetanagent-production-v2-short-customer-copy-helper-rotation-v1.sh` |
| Payment profile                             | `cbe-live-v1`, signed routine transport `enabled`, SMS route enabled                  |

1. Require a passing PR and exact-main push CI. Recheck the Droplet ID, running
   release and routine marker, installed helper and sudoers digests, Owner and
   customer health, payment switches, and SMS route. A changed predecessor or
   payment profile stops the release.
2. Stage the exact merged-main helper Git blob in the root-owned, mode-`0700`
   directory
   `/root/fetanagent-production-v2-short-customer-copy-helper-rotation-v1-input`
   as `fetanagent-production-deploy-helper-v2.next`, root-owned mode-`0600`.
   Stage the exact merged-main rotation script separately. Verify both blobs,
   their digests, and Bash syntax. Run the rotation script as root with `inspect`
   and require `predecessor-exact; no production runtime changed`. Then run
   `rotate` with
   `ROTATE EXACT PRODUCTION V2 SHORT CUSTOMER COPY HELPER V1` and repeat
   `inspect`; require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the exact passing merged-main SHA with
   `mode=deploy-inert`, the project and Droplet IDs above,
   `confirm_operation=DEPLOY SCREENSHOT READER WITH CBE LIVE`, both TeleBirr pilot
   inputs `not-applicable`, `confirm_routine_deposit_transport=enabled`,
   `confirm_financial_switch_profile=cbe-live-v1`, and
   `confirm_database_route=pooler`. Require healthy Owner, customer, and bot
   services, the carried routine marker, and unchanged switch fingerprint.
4. Verify the bot prompt and payment card copy without making a real payment.
   Confirm that replies to previously issued cards and direct Player ID and
   payment-proof messages still work. Verify public health, notification queue,
   SMS route, and payment switches.

If a guard or deployment fails, stop and inspect the specific failure before
retrying. Do not change payment switches or receiver details to make a guard
pass.
