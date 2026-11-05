# Receiver SMS pairing button hotfix

The Owner pairing button previously omitted `Content-Type: application/json`, so
the protected endpoint rejected its request with HTTP 400 before issuing a code.
This release changes that request header. It does not alter payment matching,
deposit switches, phone permissions, or database schema. Do not test it with a
payment.

| Guard                              | Exact value                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| Production Droplet                 | `593344964`                                                                                         |
| Current runtime and routine marker | `a2392c8a759fec75a3b55ea7c365dcf6741969b5`                                                          |
| Installed helper SHA-256           | `2e56b98730197379375cd96321ea48036611601f6512ad665c64b77f5f174fdf`                                  |
| Successor helper SHA-256           | `35917c3fa448c8598fa601746cfa0e16865b565fd4ed1bd19e2dd1b4b8fdf1c5`                                  |
| Rotation script                    | `infra/operations/fetanagent-production-v2-receiver-sms-pairing-content-type-helper-rotation-v1.sh` |

1. Require green PR and exact-main CI. Read the live runtime and routine marker,
   helper and sudoers digests, financial switches, active jobs, open review cases,
   and signed SMS phone status. Stop if a reviewed value differs.
2. Stage the exact merged-main helper as root-owned mode `0600` at
   `/root/fetanagent-production-v2-receiver-sms-pairing-content-type-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`.
   Stage the rotation script separately as root-owned mode `0700`; verify its
   SHA-256 and Bash syntax.
3. Run the script as root with `inspect`, then `rotate` and confirmation
   `ROTATE EXACT PRODUCTION V2 RECEIVER SMS PAIRING CONTENT TYPE HELPER V1`,
   then `inspect` again. Require the exact successor result and unchanged live
   runtime and financial state.
4. The pairing migration `20261105212827_receiver_sms_simple_permanent_pairing`
   is already applied. Do not reapply it. Deploy the same main commit with
   `production-runtime.yml`: `mode=deploy-inert`, project
   `xzztugbgtulptnbpoelr`, Droplet `593344964`, routine transport `enabled`,
   financial profile `cbe-live-v1`, and database route `pooler`.
5. Verify the live release, routine marker, helper status, unchanged switches,
   and fresh phone heartbeat. In Owner, create one 12-character code and enter
   it in the already updated 0.5.42 SMS Verifier on the connected phone. Verify
   the phone reports ready with the new authorization and no scheduled expiry.
