# Production receiver SMS window release

The 60-minute submission match policy was applied to production by
`supabase-production-release.yml` run `40609982714`. The first application
deployment stopped before transfer because the guarded workflow still expected
release `bc6905f906850a61230837ef5b7ed2303fb3f001`. The live production
release and routine-deposit marker are both
`08248f9865af52a4887d61e24b4540987b246f4e`. The installed restricted
helper and sudoers grant have digest
`4041da029ce206492d8de5da3cb08add6e1ec85683705a21f8fc8fdc464c9888`.

The reviewed successor pins the live release as its exact predecessor and has
digest `b2ca13921de2e66d079bb97439397127068782018fabf89fceb4aad9d7831a45`.
It changes no payment switch or credit logic. The one-use rotation script is
`infra/operations/fetanagent-production-v2-receiver-sms-window-helper-rotation-v1.sh`.

1. Require successful PR and exact-main CI. Check the current release, routine
   marker, release mode, absent execution-v2 marker, installed helper digest,
   sudoers pin, and helper `status` against the exact values above. Confirm the
   `cbe-live-v1` payment profile and zero active or unresolved deposit execution
   work. Stop if a value differs.
2. Stage the successor helper from the passing main commit in the root-owned
   mode-`0700` directory
   `/root/fetanagent-production-v2-receiver-sms-window-guard-helper-rotation-v1-input`
   as `fetanagent-production-deploy-helper-v2.next`, an ordinary root-owned
   mode-`0600` file. Stage the rotation script separately as a root-owned
   mode-`0700` file. Verify both against the merged Git blobs and run `bash -n`.
3. Run the rotation script as root with `inspect` and require
   `predecessor-exact; no production runtime changed`. Run `rotate` with the
   exact phrase `ROTATE EXACT PRODUCTION V2 RECEIVER SMS WINDOW GUARD HELPER V1`.
   Run `inspect` again and require
   `successor-exact; rotation complete; no production runtime changed`.
4. Dispatch `production-runtime.yml` from the same passing main commit with
   `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet `593344964`,
   operation `DEPLOY SCREENSHOT READER WITH CBE LIVE`, both TeleBirr pilot
   inputs `not-applicable`, routine transport `enabled`, financial profile
   `cbe-live-v1`, and database route `pooler`. Require exact predecessor,
   payment-switch fingerprint, activation, health, and routine-marker checks.
5. Verify the public Owner and Telegram endpoints and read back the new release
   and routine marker. No real payment is needed for this check.

Stop on any failed guard and inspect the reason. Do not change financial
settings to force a deployment.
