# 25 ETB automatic deposit minimum release

This release changes the automatic deposit range to 25–25,000 ETB for both TeleBirr and CBE Birr. It preserves all historical payment and authorization records. It does not change deposit switches, receiver accounts, or the sequential credit queue. Do not make or replay a payment to test the release.

| Guard                                  | Exact value                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| Production Droplet                     | `593344964`                                                                          |
| Running predecessor and routine marker | `64d305189dc4814e78f5060b6906a81e6da9952f`                                           |
| Installed helper SHA-256               | `35917c3fa448c8598fa601746cfa0e16865b565fd4ed1bd19e2dd1b4b8fdf1c5`                   |
| Successor helper SHA-256               | `f071ce28f9ed7ed4777a094082f4d71b29dd0b165301344adf51e0503f61c652`                   |
| Helper rotation                        | `infra/operations/fetanagent-production-v2-deposit-minimum-25-helper-rotation-v1.sh` |
| Policy migration                       | `20261105232427_auto_deposit_minimum_25_etb.sql`                                     |

1. Require passing PR and exact-main CI. Check the running release, routine marker, helper and sudoers digests, payment-switch fingerprint, current 100–25,000 ETB policy, and active or unresolved deposits. Stop if any guard differs. Keep the Owner's deposit settings as they are.
2. Publish the next Windows Companion release from the passing merged-main commit. Verify its archive checksum and attestation. Install it beside the current version and restart its dedicated launcher after confirming no active or uncertain credit. The new Companion accepts both the old 100 ETB policy and the new 25 ETB policy. Require a fresh signed heartbeat before changing the database policy. Run only a no-money preflight.
3. Stage the exact merged-main Git blob of `fetanagent-production-deploy-helper-v2.sh` as root-owned mode `0600` at `/root/fetanagent-production-v2-deposit-minimum-25-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`. Stage the rotation script separately as root-owned mode `0700`. Verify both digests and Bash syntax. Run `inspect`, then `rotate 'ROTATE EXACT PRODUCTION V2 DEPOSIT MINIMUM 25 HELPER V1'`, then `inspect` again. Require the successor result and unchanged production runtime.
4. Apply the policy migration through `supabase-production-release.yml` from the same main commit. The migration waits for no active execution, creates a new 25–25,000 ETB Owner policy, and updates the automatic range checks. Confirm the active policy, latest authorization, and unchanged payment switches. If its guard fails, inspect the current work rather than overriding it.
5. Dispatch `production-runtime.yml` from the same passing main commit with `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet `593344964`, operation `DEPLOY SCREENSHOT READER WITH CBE LIVE`, routine transport `enabled`, financial profile `cbe-live-v1`, database route `pooler`, and both TeleBirr pilot inputs `not-applicable`. Require the predecessor, drain, switch fingerprint, activation, and public health checks.
6. Verify the live bot and web instructions say 25–25,000 ETB, the Owner page shows the new policy, the Companion heartbeat is fresh, and no active or unresolved deposit was stranded. Confirm the maximum remains 25,000 ETB. Do not submit a payment as a smoke test.
