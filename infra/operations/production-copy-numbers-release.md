# Copyable local receiver numbers — guarded production release

New Telegram Deposit cards display a 251-prefixed nine-digit mobile number as nine digits and
provide one tap-to-copy button per enabled receiver. Replies to previously issued cards remain
accepted. This bot-only change does not alter stored receiver references, payment switches,
payment verification, or automatic credit decisions. Do not submit or retry a payment to test it.

| Boundary                                    | Exact value                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Production Droplet                          | `593344964`                                                             |
| Required running release and routine marker | `05de2df452f844bcd49f022d52559eb7aff8ab78`                              |
| Installed helper SHA-256                    | `a345584d30466ef0d2265e1347f5ea5d8bece054e1e2d98ad9ee842fa101dd1b`      |
| Successor helper SHA-256                    | `4df544545234de40bdb0a4fbf3f624e5938abbdc06619dd4b688088e2fac4329`      |
| Rotation script                             | `infra/operations/fetanagent-production-v2-copy-numbers-rotation-v9.sh` |
| Required payment profile                    | `cbe-live-v1`, routine deposit transport `enabled`                      |

1. Require green PR checks and exact-main CI. Read production's active release, routine marker,
   helper digest, health, payment switches, receiver state, and unresolved credit work. Stop if
   the predecessor or payment state has changed.
2. Stage the exact merged-main helper Git blob as
   `/root/fetanagent-production-v2-copy-numbers-rotation-v9-input/fetanagent-production-deploy-helper-v2.next`
   in a root-owned mode-`0700` directory, with file mode `0600`. Stage the exact merged-main
   rotation script separately. Verify their checksums and Bash syntax. Run `inspect` and require
   `predecessor-exact; no production runtime changed`. Run `rotate` with
   `ROTATE EXACT PRODUCTION V2 COPY NUMBERS HELPER V9`, then repeat `inspect` and require
   `successor-exact; rotation complete; no production runtime changed`. The rotation holds the
   production helper lock and replaces only the pinned helper and sudoers grant.
3. Dispatch `.github/workflows/production-runtime.yml` from the exact main commit with
   `mode=deploy-inert`, the production project and Droplet IDs,
   `confirm_operation=DEPLOY SCREENSHOT READER WITH CBE LIVE`, both TeleBirr pilot inputs
   `not-applicable`, `confirm_routine_deposit_transport=enabled`,
   `confirm_financial_switch_profile=cbe-live-v1`, and `confirm_database_route=pooler`.
   Require the workflow's idle cutover, financial-state fingerprint, and post-activation checks.
4. Check the exact running release, API and Owner health, both public payment methods, receiver
   values, and unresolved credit work. Send a fresh Deposit card without paying; check its local
   numbers and copy buttons. Do not change a payment switch or receiver to satisfy a release guard.
