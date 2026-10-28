# Production Companion session diagnostics release

The Windows Companion session journal requires a new exact release SHA. The
currently reviewed production release and routine-deposit marker are both
`b8eb1d2280613a355bb81dc71579c3b236b61d85`. The installed restricted
deploy helper and sudoers grant have SHA-256
`b2ca13921de2e66d079bb97439397127068782018fabf89fceb4aad9d7831a45`.
The successor helper pins that release as its predecessor and has SHA-256
`843230c82f4a7fb1401e0a7e6277b041935b8ec3601867b2f083604845271d06`.
This handoff changes no payment switch or credit logic.

1. Require successful PR and exact-main CI. Check the current release, routine
   marker, release mode, absent execution-v2 marker, installed helper digest,
   sudoers pin, and helper `status` against the exact values above. Confirm the
   `cbe-live-v1` payment profile and zero active or unresolved deposit execution
   work. Stop if any value differs.
2. Stage the successor helper from the passing main commit in the root-owned
   mode-`0700` directory
   `/root/fetanagent-production-v2-companion-session-diagnostics-helper-rotation-v1-input`
   as `fetanagent-production-deploy-helper-v2.next`, an ordinary root-owned
   mode-`0600` file. Stage the one-use rotation script
   `infra/operations/fetanagent-production-v2-companion-session-diagnostics-helper-rotation-v1.sh`
   separately as a root-owned mode-`0700` file. Verify both against merged Git
   blobs and run `bash -n` before execution.
3. Run the rotation script as root with `inspect` and require
   `predecessor-exact; no production runtime changed`. Run `rotate` with the
   exact phrase
   `ROTATE EXACT PRODUCTION V2 COMPANION SESSION DIAGNOSTICS HELPER V1`.
   Run `inspect` again and require
   `successor-exact; rotation complete; no production runtime changed`.
4. Dispatch `production-runtime.yml` from the same passing main commit with
   `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet `593344964`,
   operation `DEPLOY SCREENSHOT READER WITH CBE LIVE`, both TeleBirr pilot inputs
   `not-applicable`, routine transport `enabled`, financial profile `cbe-live-v1`,
   and database route `pooler`. Require exact predecessor, payment-switch
   fingerprint, activation, health, and routine-marker checks.
5. Build the next immutable Windows Companion tag from the deployed main commit.
   Verify its archive and attestation before replacing the Kamatera release and
   exact-release launch document. Review any unfinished attempt before restarting
   the Companion. Read `diagnostics/kemerbet-session.jsonl` under the Companion
   data root after launch; do not use a real payment as a deployment test.

Stop on any failed guard and inspect the reason. Do not change financial
settings to force a deployment.
