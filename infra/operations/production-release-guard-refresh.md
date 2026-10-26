# Production release guard refresh

The Telegram menu and verified Player ID reuse release requires a new exact
production predecessor pin. The current release and routine-deposit marker on
Droplet `593344964` were read back as
`09cf011cd8d0cc381763ac63a65e3056533f032f`; the installed production
helper and its restricted sudoers grant both have SHA-256
`90778252cd69601243cb68e90b208cbac08e10eecd7ce95582c0686983516d1b`.
The installed helper still pins an older release, so the guarded deployment
stops before transferring or activating a new release.

The reviewed successor helper pins the current release and has SHA-256
`cceaf528b16b7084eb751488bd931c6fd4c69cd5df9b505304e0cfc42f141211`.
It changes no payment switch or credit logic. Its one-use rotation script is
`infra/operations/fetanagent-production-v2-release-guard-refresh-helper-rotation-v1.sh`.

1. Require successful PR and exact-main CI. Check the current release and
   routine marker are still the exact SHA above, the release mode is
   `inert-maintenance`, the execution-v2 marker is absent, and the installed
   helper and sudoers grant retain the predecessor digest. Check the helper's
   `status` command succeeds for the current release. Stop if any identity
   or payment profile changed.
2. Stage the helper from the passing main commit in the root-owned mode-`0700`
   directory
   `/root/fetanagent-production-v2-release-guard-refresh-helper-rotation-v1-input`
   as `fetanagent-production-deploy-helper-v2.next`, an ordinary root-owned
   mode-`0600` file. Stage the rotation script separately as a root-owned
   mode-`0700` file. Verify both against the merged Git blobs and run
   `bash -n` on both.
3. Run the rotation script as root with `inspect` and require
   `predecessor-exact; no production runtime changed`. Then run it with
   `rotate 'ROTATE EXACT PRODUCTION V2 RELEASE GUARD REFRESH HELPER V1'`.
   Run `inspect` again and require
   `successor-exact; rotation complete; no production runtime changed`.
   The script shares the deployment lock, archives the predecessor, removes
   its sudoers grant before replacement, and binds the restricted account to
   the exact successor digest.
4. Dispatch `production-runtime.yml` from the same passing main commit with
   `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet `593344964`,
   `confirm_operation=DEPLOY SCREENSHOT READER WITH CBE LIVE`, both TeleBirr
   pilot inputs `not-applicable`,
   `confirm_routine_deposit_transport=enabled`,
   `confirm_financial_switch_profile=cbe-live-v1`, and
   `confirm_database_route=pooler`. Confirm the workflow's exact predecessor
   check, financial fingerprint, activation, service health, and carried
   routine marker.
5. Inspect the blue Telegram Menu for the saved account, the front buttons,
   public health, notification queue, SMS route, and payment profile without
   initiating a real payment.

Stop on any failed guard and inspect the reason. Do not weaken the release
checks or change financial settings to force a deployment.
