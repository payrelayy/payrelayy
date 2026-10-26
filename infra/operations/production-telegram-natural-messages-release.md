# Telegram natural-message prompts — guarded production release

This release sends Player ID and payment destination prompts as ordinary Telegram
messages. Standalone eight-digit Player IDs, direct TeleBirr/CBE proof detection,
manually replied messages, and the existing crediting path remain intact. It
requires no database migration or payment switch change.

| Boundary                                    | Reviewed value                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Production Droplet                          | `593344964`                                                                                 |
| Production Supabase project                 | `xzztugbgtulptnbpoelr`                                                                      |
| Required running release and routine marker | `c1e9e91e209eb8d50563accafd7112bbbdafdc50`                                                  |
| Installed helper and sudoers pin            | `9a45d0e999335b923fcc2506e7e985b063bc7e5d124cc67d4def8b4e50a209df`                          |
| Successor helper and sudoers pin            | `6280df25be1900634a2fc50111fd1161105b73dc92b5ef187c931ae8580b2e43`                          |
| One-use rotation                            | `infra/operations/fetanagent-production-v2-telegram-natural-messages-helper-rotation-v1.sh` |
| Payment profile                             | `cbe-live-v1`, signed routine transport `enabled`, SMS route enabled                        |

1. Require a passing PR and exact-main push CI. Recheck the Droplet ID, running
   release and routine marker, installed helper and sudoers digests, Owner and
   customer health, payment switches, and SMS route. A changed predecessor or
   payment profile stops the release.
2. Stage the exact merged-main helper Git blob in the root-owned, mode-`0700`
   directory
   `/root/fetanagent-production-v2-telegram-natural-messages-helper-rotation-v1-input`
   as `fetanagent-production-deploy-helper-v2.next`, root-owned mode-`0600`.
   Stage the exact merged-main rotation script separately. Verify both blobs,
   their digests, and Bash syntax. Run the rotation script as root with `inspect`
   and require `predecessor-exact; no production runtime changed`. Then run
   `rotate` with
   `ROTATE EXACT PRODUCTION V2 TELEGRAM NATURAL MESSAGES HELPER V1` and repeat
   `inspect`; require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the exact passing merged-main SHA with
   `mode=deploy-inert`, the project and Droplet IDs above,
   `confirm_operation=DEPLOY SCREENSHOT READER WITH CBE LIVE`, both TeleBirr pilot
   inputs `not-applicable`, `confirm_routine_deposit_transport=enabled`,
   `confirm_financial_switch_profile=cbe-live-v1`, and
   `confirm_database_route=pooler`. Require healthy Owner, customer, and bot
   services, the carried routine marker, and unchanged switch fingerprint.
4. Verify the bot prompt path without making a real payment: a Player ID prompt
   and a deposit card have no ForceReply markup, while direct Player ID and
   payment-proof reducers still accept ordinary messages. Verify public health,
   notification queue, SMS route, and payment switches.

If a guard or deployment fails, stop and inspect the specific failure before
retrying. Do not change payment switches or receiver details to make a guard
pass.
