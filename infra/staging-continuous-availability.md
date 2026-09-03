# Continuous staging availability

The Owner requested removal of the arbitrary staging shutdown on 2026-09-03. Ordinary application
availability is now independent of financial authorization: the bot, API, admission, customer web,
Owner control, and HTTPS gateway can remain running without a fixed daily deadline. This is not
financial launch approval or a guarantee against infrastructure outages.

## Why the former release stopped

The staging provisioning contract originally gave four restricted application logins a 24-hour
password lifetime. A root-owned systemd timer stopped the deployment two hours before the earliest
expiry to prevent failing reconnect loops and database network bans. Simply disabling that timer
would leave an apparently live service with expired credentials.

## Current policy

- Only the four existing non-financial application logins use `VALID UNTIL 'infinity'`.
- Passwords remain protected and revocable; role memberships, RLS, connection limits, and grants
  are unchanged. Credential rotation still requires the reviewed stopped deployment procedure.
- Executor/verifier logins remain disabled and their lifetimes are not extended. Financial switches,
  customer sessions, signed capabilities, pairing leases, and supervised pilot limits are unchanged.
- Ordinary `deploy-and-smoke` preserves the legacy helper's bounded startup guard, then runs the
  continuous-lifetime SQL and checksum-bound timer finalizer after healthy core startup. Completion
  requires an inactive, boot-disabled timer with no next trigger. The finalizer and its single sudo
  permission are checked before downtime. Failure/cancellation cleanup and `stop-and-disable` still work.
- Historical recovery modes remain exact, bounded recovery contracts. Do not use one as an ordinary
  continuously available deployment or change a financial runtime's expiry to keep the bot online.

## Convert an already-running release without downtime

1. Merge the reviewed code with passing Quality, SQL, and image-smoke checks. From the existing root
   SSH session, stage the finalizer and its checked-in sudoers file as `finalizer.sh` and
   `finalizer.sudoers`, owned by root with mode 0600, in a new root-owned mode-0700 directory named
   `/run/fetanagent-continuity-install-MERGED_COMMIT_SHA`. Verify both against the merged source.
   Run the reviewed `install-staging-continuous-availability.sh` with that directory and the exact
   finalizer SHA-256. It installs only the root-owned finalizer and one checksum-bound `disable-expiry`
   sudo command for `fetanagent-admin`. Existing files with different contents are never overwritten.
2. Run `Staging continuous availability` in `inspect` mode on `main`, with staging project
   `spzpiyxheappsfyswewl`, Droplet `593344964`, and the exact deployed 40-character application SHA.
3. Run that workflow with `mode=enable-continuous` and
   `confirm_no_financial_activation=continuous-availability-no-money`. The workflow validates release
   ancestry and both installed helper digests before executing the transaction through the existing
   protected Supabase administrator connection. It prints only role lifetimes and switch counts,
   then invokes the exact finalizer to disable the old timer automatically. No root SSH credential
   is added to GitHub, and no generic shell or `systemctl` sudo permission is granted.
4. Run the workflow in `inspect` mode again and verify HTTPS and Telegram availability. The installed
   finalizer also supports root-only `inspect RELEASE_SHA` for an independent no-write check.

The root operation checks the exact Droplet and installed helper, acquires the existing deployment
mutation lock, requires either the four healthy private-core services or the complete six-service
non-financial release at the exact SHA, and opens a
fresh restricted API database connection to verify all four non-expiring application lifetimes and
both disabled financial logins. It then disables only
`fetanagent-staging-runtime-expiry-stop.timer`, including boot enablement. It refuses an already
running/failed shutdown service or an unexpected unit path, symlink, owner, or drop-in. It never
stops/restarts containers, reads administrator database credentials, clears Telegram updates, changes
the legacy privileged helper, or alters financial authority.

The old unit files are retained, disabled, for audit. They have no next trigger. A subsequent ordinary
deployment's existing `stop` removes them before verifying the empty boundary; startup uses a new
temporary guard and successful finalization disables it again. Do not manually re-enable the old
timer. If any check fails, resolve that precise condition; do not skip database verification or
broaden the checksum-bound sudo permission.

## Verification and security trade-off

The disposable PostgreSQL suite executes the actual operational SQL and checks that only four expiry
fields change, repeated runs are idempotent, and unsafe/expired/disabled roles, unexpected memberships,
active financial services, or missing/enabled switches fail without partial changes. The infrastructure
suite executes the actual embedded database-check program and systemd disarm function with synthetic
failure cases. Existing application/database smoke tests still apply.

Non-expiring machine credentials avoid a scheduled outage, but no longer self-revoke after 24 hours.
Keep secrets in their existing protected stores, rotate them through the reviewed deployment process
when needed, and use `stop-and-disable` immediately for suspected compromise. This operation does not
install automated credential rotation or uptime monitoring.
