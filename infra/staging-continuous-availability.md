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
  requires an inactive, boot-disabled timer with no next trigger. The finalizer and its exact sudo
  permission are checked before downtime. Failure/cancellation cleanup and `stop-and-disable` still work.
- After that finalization, isolated Telegram, private no-transfer KemerBet-session, and public-edge
  restart attestations accept the continuous posture instead of requiring the retired deadline to be
  re-armed. The helper requires the unchanged root-owned unit files, no systemd drop-ins, an inactive
  shutdown service, an inactive/disabled timer with no next trigger, the exact API release, and a fresh
  restricted-runtime catalog query proving all four non-financial roles remain safe and non-expiring.
- Historical recovery modes remain exact, bounded recovery contracts. Do not use one as an ordinary
  continuously available deployment or change a financial runtime's expiry to keep the bot online.

## Convert an already-running release without downtime

1. Merge the reviewed code with passing Quality, SQL, and image-smoke checks. From the existing root
   SSH session, stage the finalizer and its checked-in sudoers file as `finalizer.sh` and
   `finalizer.sudoers`, owned by root with mode 0600, in a new root-owned mode-0700 directory named
   `/run/fetanagent-continuity-install-MERGED_COMMIT_SHA`. Verify both against the merged source.
   Run the reviewed `install-staging-continuous-availability.sh` with that directory and the exact
   finalizer SHA-256. It installs only the root-owned finalizer and checksum-bound `preflight` and
   `disable-expiry` sudo commands for `fetanagent-admin`. It can upgrade only the exact initial
   finalizer/sudoers versions recorded by exact digest in the installer; any other differing file is refused.
2. Run `Staging continuous availability` in `inspect` mode on `main`, with staging project
   `spzpiyxheappsfyswewl`, Droplet `593344964`, and the exact deployed 40-character application SHA.
3. Run that workflow with `mode=enable-continuous` and
   `confirm_no_financial_activation=continuous-availability-no-money`. The workflow validates release
   ancestry, both installed helper digests, and the healthy deployed service set with the read-only
   `preflight` before executing the transaction through the existing
   protected Supabase administrator connection. It prints only role lifetimes and switch counts,
   then invokes the exact finalizer to disable the old timer automatically. No root SSH credential
   is added to GitHub, and no generic shell or `systemctl` sudo permission is granted.
4. Run the workflow in `inspect` mode again and verify HTTPS and Telegram availability. The installed
   finalizer also supports root-only `inspect RELEASE_SHA` for an independent no-write check.

`preflight` accepts both the private core and the already-published six-service deployment and does
not require database lifetimes to have been converted yet. It never changes the database or timer.
Do not use the legacy helper's `fresh-public-edge-ready` here: that is a pre-publication check that
requires exactly five services and unused HTTPS ports, not a check of an already-live gateway.

Keep sudo's default checksum-bound descriptor execution enabled. For a script, it changes `$0` to
an open descriptor path. The finalizer accepts that form only for the exact dedicated deployment
identity, exact sudo-reported original command, and the installed file's device/inode. Test the
read-only `preflight` through `fetanagent-admin`'s real sudo command, not just a direct root call.
See the [sudoers fdexec documentation](https://www.sudo.ws/docs/man/1.9.14/sudoers.man.pdf).

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
timer. Current-release component recovery uses the exact continuous attestation above; fresh core
bootstrap and historical migration recovery still require their bounded startup guard. If any check
fails, resolve that precise condition; do not skip database verification or broaden the
checksum-bound sudo permission.

### One-time H17 helper promotion

The H16 helper predates the component-level continuous attestation. Before deploying the first release
that contains it, run the reviewed
`infra/operations/fetanagent-kemerbet-continuous-availability-helper-bridge-v17.sh` once from the
DigitalOcean root console. Stage that script and the successor helper from the exact merged commit in
its required root-owned directory, verify both SHA-256 values, and pass the merged commit, the helper
digest, and the script's exact no-money confirmation. The bridge requires the currently deployed
`70d46b9642c7d1fd781fd7200289b7a2fff068ec` six-service release, the completed H16/H14 recovery chain, the exact installed H16 helper
and continuous finalizer, the inactive/disabled timer, a fresh restricted database catalog check, and
all financial gates disabled. Under the shared mutation lock it temporarily disables only the helper
sudo grant, appends an immutable H17 predecessor/successor record, replaces only the reviewed helper,
re-attests the unchanged runtime and historical chain, and restores the exact grant. It does not
restart a container, change a database role, contact KemerBet, enable Transfer, or move money.

If the bridge fails after disabling the grant, do not edit its evidence or restore sudoers manually.
Rerun the same merged script with the same three arguments; its interrupted-prefix checks resume only
the exact predecessor-to-successor promotion. After successful promotion, the normal deployment
upgrades the checksum-bound continuous finalizer and deploys the reviewed release.

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
