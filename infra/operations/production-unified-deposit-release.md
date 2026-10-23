# Unified Deposit card production release

This release makes the bot show one Deposit card with the currently enabled
TeleBirr and CBE Birr receivers, each using the name and phone configured on
the Owner page. The bot still identifies the payment provider from the proof.
The release does not change receivers or payment switches, submit a payment,
or retry a credit.

| Boundary                                    | Exact value                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| Production Droplet                          | `593344964`                                                                |
| Required running release and routine marker | `aa5db75897ac63e29917836aa7d52843b4a69ef6`                                 |
| Installed helper SHA-256                    | `e00b5721a2b48cad8f5a7828081ebe9b05c239c6283a0123ac9f561e951ea1d2`         |
| Successor helper SHA-256                    | `255b545f55df67038bdc737eb3aeaade49ebafcee5edd054b25e1926cf391336`         |
| Rotation script                             | `infra/operations/fetanagent-production-v2-unified-deposit-rotation-v7.sh` |
| Required payment profile                    | `cbe-live-v1`, routine deposit transport `enabled`                         |

1. Require green PR checks and exact-main CI. Read production's active release,
   routine marker, helper digest, health, payment switches, receiver state, and
   unresolved credit work. Stop if the predecessor or payment state has changed.
2. Stage the exact merged-main helper Git blob as
   `/root/fetanagent-production-v2-unified-deposit-rotation-v7-input/fetanagent-production-deploy-helper-v2.next`
   in a root-owned `0700` directory, with file mode `0600`. Stage the exact
   merged-main rotation script separately. Verify their checksums and Bash
   syntax. Run `inspect` and require
   `predecessor-exact; no production runtime changed`. Run `rotate` with
   `ROTATE EXACT PRODUCTION V2 UNIFIED DEPOSIT HELPER V7`, then repeat `inspect`
   and require `successor-exact; rotation complete; no production runtime changed`.
   The rotation holds the production helper lock and replaces only the pinned
   helper and sudoers grant. Stop if any check fails.
3. Dispatch `.github/workflows/production-runtime.yml` from the exact main
   commit with `mode=deploy-inert`, the production project and Droplet IDs,
   `confirm_operation=DEPLOY SCREENSHOT READER WITH CBE LIVE`, both TeleBirr
   pilot inputs `not-applicable`, `confirm_routine_deposit_transport=enabled`,
   `confirm_financial_switch_profile=cbe-live-v1`, and
   `confirm_database_route=pooler`. Require the workflow's idle cutover,
   financial-state fingerprint, and post-activation checks to pass.
4. Check the exact running release, API and Owner health, both public payment
   methods, receiver values, and unresolved credit work. Do not change a
   payment switch or receiver to satisfy a release guard.

If the workflow stops, report the actual boundary. Do not replay a payment to
test this card.
