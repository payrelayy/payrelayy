# Owner page clarity production release

This one-use release installs the Owner page from the reviewed main commit. It
preserves the live CBE Birr payment profile and signed routine deposit transport.
It does not replay payments or change financial switches.

| Boundary                                    | Exact value                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| Production Droplet                          | `593344964`                                                                   |
| Required running release and routine marker | `74f9591d9019a904f331c105bbe8167eef2148ff`                                    |
| Installed helper SHA-256                    | `af847321e9a8a31b5ba75bb42848b18d4462062762b87f5bdf57983219406345`            |
| Successor helper SHA-256                    | `563c2b05a3d15d474ad71bcf33ed7b68798aff65ee6700fa4ca49c65dac76e23`            |
| Rotation script                             | `infra/operations/fetanagent-production-v2-owner-page-clarity-rotation-v5.sh` |
| Payment profile                             | `cbe-live-v1` with routine deposit transport `enabled`                        |

1. Require successful PR and exact-main CI. Inspect public Owner health and
   read-only production database state: the seven payment switches, receiving
   SMS route, runtime logins, nonterminal jobs, and unresolved attempts. The
   three Owner page migrations `20261023162000`, `20261023163000`, and
   `20261023164000` were present in the production ledger before this release
   attempt; verify their presence and do not reapply them. A changed state is a
   stop condition.
2. Stage the exact merged-main Git blobs on the Droplet in the root-owned
   directory `/root/fetanagent-production-v2-owner-page-clarity-rotation-v5-input`
   (mode `0700`): the successor helper as
   `fetanagent-production-deploy-helper-v2.next` (root-owned, mode `0600`) and
   the rotation script separately. Verify both blobs against the merged commit
   and the helper SHA-256 above. Run the script as root with `inspect`; require
   `predecessor-exact; no production runtime changed`. Then run `rotate` with
   the exact phrase `ROTATE EXACT PRODUCTION V2 OWNER PAGE CLARITY HELPER V5`,
   and repeat `inspect`; require
   `successor-exact; rotation complete; no production runtime changed`.
   The script holds the production helper lock and rotates the checksum-pinned
   sudoers grant. Do not rotate if any current-release or marker check fails.
3. Dispatch `.github/workflows/production-runtime.yml` from that exact main
   commit with `mode=deploy-inert`, the production project and Droplet IDs,
   `confirm_operation=DEPLOY SCREENSHOT READER WITH CBE LIVE`, both TeleBirr
   pilot inputs `not-applicable`, `confirm_routine_deposit_transport=enabled`,
   `confirm_financial_switch_profile=cbe-live-v1`, and
   `confirm_database_route=pooler`. The workflow must confirm the old release,
   idle cutover, payment profile, and unchanged switch fingerprint before and
   after activation. Check public health and the three migration versions again.

Do not change payment switches to satisfy a release guard. Do not restart the
old application after the Owner page migrations; its database grant catalog is
from the earlier schema.
