# Owner payment-methods production release

This one-use release installs the Owner payment-method controls and receiver editor
while preserving the existing CBE-live financial profile, the signed routine
deposit transport, and both current receivers. It makes no payment, Player
credit, or receiver change.

| Boundary | Exact value |
| --- | --- |
| Production Droplet | `593344964` |
| Required running release and routine marker | `6b7fab30082f37f4d42ad8ed0958d77b75348929` |
| Installed helper SHA-256 | `563c2b05a3d15d474ad71bcf33ed7b68798aff65ee6700fa4ca49c65dac76e23` |
| Successor helper SHA-256 | `e00b5721a2b48cad8f5a7828081ebe9b05c239c6283a0123ac9f561e951ea1d2` |
| Rotation script | `infra/operations/fetanagent-production-v2-owner-payment-methods-rotation-v6.sh` |
| Payment profile | `cbe-live-v1`, routine deposit transport `enabled` |

1. Require successful PR and exact-main CI. Inspect public Owner and customer
   health and read-only production state: all seven payment switches, the SMS
   route, runtime logins, receivers, nonterminal jobs, and unresolved attempts.
   Check the production migration ledger for
   `20261023175816_owner_payment_methods_control` and
   `20261023181039_owner_live_receiver_rotation`. Both were observed in the
   production ledger before this release; verify their presence again and do
   not reapply them. Stop on a changed release, marker, helper, profile, or
   payment state.
2. Stage the exact merged-main Git blobs on the Droplet in the root-owned
   directory
   `/root/fetanagent-production-v2-owner-payment-methods-rotation-v6-input`
   (mode `0700`): the successor helper as
   `fetanagent-production-deploy-helper-v2.next` (root-owned, mode `0600`)
   and the rotation script separately. Verify both blobs against the merged
   commit and the helper SHA-256 above. Run the script as root with `inspect`;
   require `predecessor-exact; no production runtime changed`. Then run
   `rotate` with the exact phrase
   `ROTATE EXACT PRODUCTION V2 OWNER PAYMENT METHODS HELPER V6`, and repeat
   `inspect`; require
   `successor-exact; rotation complete; no production runtime changed`.
   The script holds the production helper lock and rotates the checksum-pinned
   sudoers grant. Do not rotate if any check fails.
3. Dispatch `.github/workflows/production-runtime.yml` from that exact main
   commit with `mode=deploy-inert`, the production project and Droplet IDs,
   `confirm_operation=DEPLOY SCREENSHOT READER WITH CBE LIVE`, both TeleBirr
   pilot inputs `not-applicable`, `confirm_routine_deposit_transport=enabled`,
   `confirm_financial_switch_profile=cbe-live-v1`, and
   `confirm_database_route=pooler`. The workflow must confirm the old release,
   idle cutover, payment profile, and unchanged switch fingerprint before and
   after activation.
4. Check the public Owner page, the exact running release, migration versions,
   switch profile, provider controls, receiver fingerprints, and absence of
   newly unresolved execution work. Do not toggle payment switches or rotate a
   receiver to satisfy any release guard.

The previous app's database grant catalog predates these migrations. Do not
restart it after the migrations or use it as an automatic rollback target.
