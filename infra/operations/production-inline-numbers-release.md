# Inline receiver numbers — guarded production release

Telegram Deposit cards keep both Owner-configured receivers, show their local nine-digit numbers
as inline code, and no longer show separate Copy buttons. The proof instruction uses the shorter
Owner-approved wording. Replies to previously issued cards remain accepted. This bot-only change
does not alter stored receivers, payment switches, verification, or automatic credit. Do not submit
or retry a payment to test it.

| Boundary                                    | Exact value                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| Production Droplet                          | `593344964`                                                                |
| Required running release and routine marker | `e0a880a808477397c800986856de2fd2c94184f9`                                 |
| Installed helper SHA-256                    | `4df544545234de40bdb0a4fbf3f624e5938abbdc06619dd4b688088e2fac4329`         |
| Successor helper SHA-256                    | `7f775dee43c95aa9a044bacdcc10b2e8479c06165257e85c463545c5912c1c04`         |
| Rotation script                             | `infra/operations/fetanagent-production-v2-inline-numbers-rotation-v10.sh` |
| Required payment profile                    | `cbe-live-v1`, routine deposit transport `enabled`                         |

1. Require green PR checks and exact-main CI. Read production's active release, routine marker,
   helper digest, health, payment switches, receiver state, and unresolved credit work. Stop if
   the predecessor or payment state has changed.
2. Stage the exact merged-main helper Git blob as
   `/root/fetanagent-production-v2-inline-numbers-rotation-v10-input/fetanagent-production-deploy-helper-v2.next`
   in a root-owned mode-`0700` directory, with file mode `0600`. Stage the exact merged-main
   rotation script separately. Verify their checksums and Bash syntax. Run `inspect` and require
   `predecessor-exact; no production runtime changed`. Run `rotate` with
   `ROTATE EXACT PRODUCTION V2 INLINE NUMBERS HELPER V10`, then repeat `inspect` and require
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
   inline-code numbers, copy-on-tap behavior, and absence of Copy buttons. Do not change a payment
   switch or receiver to satisfy a release guard.
