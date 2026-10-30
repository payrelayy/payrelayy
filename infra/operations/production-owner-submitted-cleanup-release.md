# Owner Submitted payments cleanup — guarded production release

This application-only release removes the older masked Transactions list from
the Owner Submitted payments view, keeps the 60-minute automatic-to-manual
handoff, and accepts expired handoff rows in the Owner API. It makes no
database migration, KemerBet transfer, payment switch change, or payment retry.

The reviewed running release is
`6a1c7d646bd7577ff2aaeef3dcb31c0b50871e0b` on Droplet `593344964`.
The installed helper SHA-256 is
`0efa14c6f0cf5e73952e3cd6e66a5c3750b18931ec410a83b63042d90247efe6`;
the successor is
`415d6bc2a7565225bdb60e690f9655023ae7a0d73eb6a99c3660cc51f22a00d1`.
These are stop guards: recheck production immediately before rotation.

1. Require green PR checks and exact merged-main CI. Recheck the running
   release, routine-deposit marker, helper and sudoers digests, payment
   switches, SMS route, and active or unresolved deposit attempts. Stop if
   anything differs or a transfer is active or uncertain.
2. Stage the exact merged-main helper Git blob in the root-owned mode `0700`
   folder
   `/root/fetanagent-production-v2-owner-submitted-cleanup-helper-rotation-v1-input`
   as `fetanagent-production-deploy-helper-v2.next`, root-owned mode `0600`.
   Stage `fetanagent-production-v2-owner-submitted-cleanup-helper-rotation-v1.sh`
   separately, root-owned mode `0700`. Verify both blob digests and Bash
   syntax. Run `inspect` as root; require
   `predecessor-exact; no production runtime changed`. Run `rotate` with
   `ROTATE EXACT PRODUCTION V2 OWNER SUBMITTED CLEANUP HELPER V1`, then run
   `inspect` again; require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the exact passing merged-main SHA
   with `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet
   `593344964`, both TeleBirr pilot inputs `not-applicable`, routine transport
   `enabled`, database route `pooler`, financial profile `cbe-live-v1`, and
   confirmation `DEPLOY SCREENSHOT READER WITH CBE LIVE`. Require exact
   predecessor, idle cutover, healthy app and bot, carried routine marker,
   and unchanged payment switch fingerprint.
4. Verify the live Owner Submitted payments view has no older Transactions
   list, displays full stored references and receiving accounts, and loads
   pending expired handoffs with Approve, Reject, and Record outside credit.
   Inspect only; do not submit or replay a payment for release testing.

Stop on a failed guard. Do not change financial switches to satisfy a guard.
