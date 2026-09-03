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
- Ordinary `deploy-and-smoke` runs the guarded continuous-lifetime SQL and checks that neither old
  shutdown unit is loaded before service startup. Failure/cancellation cleanup and explicit
  `stop-and-disable` still work.
- Historical recovery modes remain exact, bounded recovery contracts. Do not use one as an ordinary
  continuously available deployment or change a financial runtime's expiry to keep the bot online.

## Convert an already-running release without downtime

1. Merge the reviewed code with passing Quality, SQL, and image-smoke checks.
2. Run `Staging continuous availability` in `inspect` mode on `main`, with staging project
   `spzpiyxheappsfyswewl`, Droplet `593344964`, and the exact deployed 40-character application SHA.
3. Run that workflow with `mode=enable-continuous` and
   `confirm_no_financial_activation=continuous-availability-no-money`. The workflow validates release
   ancestry and the installed release/helper before executing the transaction through the existing
   protected Supabase administrator connection. It prints only role lifetimes and switch counts.
4. From the existing trusted root SSH session, run the exact reviewed
   `infra/operations/fetanagent-staging-continuous-availability.sh` with arguments `inspect RELEASE_SHA`,
   then `disable-expiry RELEASE_SHA`. Verify the uploaded script checksum against the merged source
   before running it. No root credential or new sudo grant is installed in GitHub.
5. Run the workflow in `inspect` mode again and verify HTTPS and Telegram availability.

The root operation checks the exact Droplet and installed helper, acquires the existing deployment
mutation lock, requires the six healthy/non-financial services at the exact release, and opens a
fresh restricted API database connection to verify all four non-expiring application lifetimes and
both disabled financial logins. It then disables only
`fetanagent-staging-runtime-expiry-stop.timer`, including boot enablement. It refuses an already
running/failed shutdown service or an unexpected unit path, symlink, owner, or drop-in. It never
stops/restarts containers, reads administrator database credentials, clears Telegram updates, changes
the privileged helper, or alters financial authority.

The old unit files are retained, disabled, for audit. They have no next trigger. A subsequent ordinary
deployment's existing `stop` removes them before verifying the empty boundary. Do not manually
re-enable the old timer. If any check fails, resolve that precise condition; do not skip the database
verification or broaden sudo permissions.

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
