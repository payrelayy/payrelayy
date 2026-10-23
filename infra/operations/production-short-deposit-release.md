# Short Deposit instructions production release

This release removes two lines from new bot Deposit cards: the method-choice
sentence and the one-hour/receiver-name sentence. The bot still shows enabled
receivers, the saved Player ID, and how to submit proof. Replies to previously
sent cards remain recognized. The one-hour validity behavior is unchanged.
This release does not change receivers or payment switches, submit a payment,
or retry a credit.

| Boundary                                    | Exact value                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| Production Droplet                          | `593344964`                                                              |
| Required running release and routine marker | `08420128eb114b33ef1b8fdaf8d41dc9fa3f4277`                               |
| Installed helper SHA-256                    | `255b545f55df67038bdc737eb3aeaade49ebafcee5edd054b25e1926cf391336`       |
| Successor helper SHA-256                    | `a345584d30466ef0d2265e1347f5ea5d8bece054e1e2d98ad9ee842fa101dd1b`       |
| Rotation script                             | `infra/operations/fetanagent-production-v2-short-deposit-rotation-v8.sh` |
| Required payment profile                    | `cbe-live-v1`, routine deposit transport `enabled`                       |

1. Require green PR checks and exact-main CI. Read production's active release,
   routine marker, helper digest, health, payment switches, receiver state, and
   unresolved credit work. Stop if the predecessor or payment state has changed.
2. Stage the exact merged-main helper Git blob as
   `/root/fetanagent-production-v2-short-deposit-rotation-v8-input/fetanagent-production-deploy-helper-v2.next`
   in a root-owned `0700` directory, with file mode `0600`. Stage the exact
   merged-main rotation script separately. Verify their checksums and Bash
   syntax. Run `inspect` and require
   `predecessor-exact; no production runtime changed`. Run `rotate` with
   `ROTATE EXACT PRODUCTION V2 SHORT DEPOSIT HELPER V8`, then repeat `inspect`
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
