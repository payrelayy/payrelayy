# Prompt Player ID validation release

This release lets repeated messages for one pending Player ID share a Find and releases a superseded assignment so the next ID does not wait for the old five minute lease. It changes no payment switch and requires no payment test.

| Guard                              | Exact value                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| Production Droplet                 | `593344964`                                                                         |
| Running release and routine marker | `8026a338741c6ff31651832a4aa3d36186d7fe3e`                                          |
| Installed helper SHA-256           | `f071ce28f9ed7ed4777a094082f4d71b29dd0b165301344adf51e0503f61c652`                  |
| Successor helper SHA-256           | `f50db8285c9e60c8d14ec6158356ff3a3a52879f267b3da3da1d1dfce1ad4b60`                  |
| Helper rotation                    | `infra/operations/fetanagent-production-v2-player-validation-helper-rotation-v1.sh` |
| Migration                          | `20261106005305_fast_player_validation_supersession.sql`                            |

1. Require passing PR and exact-main CI. Verify the current release, routine marker, helper and sudoers digest pin, unchanged payment switches, fresh Companion check-in, and no active or unresolved credit. If any guard differs, stop.
2. Publish the next attested Windows Companion release from that same main commit. Verify its archive checksum and source attestation. Install it beside the prior version and start the dedicated launcher only after the financial queue is idle. Require a fresh signed report before the server update.
3. Stage the exact merged-main Git blob of `fetanagent-production-deploy-helper-v2.sh` as root-owned mode `0600` at `/root/fetanagent-production-v2-player-validation-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`. Stage the rotation script separately as root-owned mode `0700`. Verify both digests and Bash syntax. Run `inspect`, then `rotate 'ROTATE EXACT PRODUCTION V2 PLAYER VALIDATION HELPER V1'`, then `inspect` again. Require the successor result and unchanged production runtime.
4. Apply the migration through `supabase-production-release.yml` from the same main commit. Verify the new function grant, private replay table, and unchanged payment switches. The old Companion bridge may briefly reject superseded results until the server deploy completes.
5. Dispatch `production-runtime.yml` from that same passing main commit with `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet `593344964`, operation `DEPLOY SCREENSHOT READER WITH CBE LIVE`, routine transport `enabled`, financial profile `cbe-live-v1`, database route `pooler`, and both TeleBirr pilot inputs `not-applicable`. Require the predecessor, idle drain, switch fingerprint, activation, and public health checks.
6. Verify the exact live release, fresh Companion signed-in report, current Player ID request and assignment state, unchanged Owner payment controls, and empty active or unresolved credit queue. Do not make a payment to test this change.
