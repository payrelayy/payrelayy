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
- Executor/verifier logins remain disabled and their lifetimes are not extended. All six real-money
  switches must be disabled with empty settings. The private pilot may be disabled or remain in its
  exact armed `dry_run` configuration; `live`, unbound, or malformed pilot settings are rejected.
  This availability conversion does not revive or extend the pilot window, so the exact bound
  `dry_run` posture remains acceptable after that separate pilot window has expired.
  Customer sessions, signed capabilities, pairing leases, and supervised pilot limits are unchanged.
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
   protected Supabase administrator connection. It prints only role lifetimes and a redacted
   no-money boundary summary (non-disabled real-money count and dry-run pilot count),
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

### One-time H18 shared-ingress helper promotion

The H17 helper assumed that a fully stopped staging project had no Compose-owned Docker networks.
That assumption is no longer true on the current host: staging created the internal
`fetanagent-telebirr-device-ingress` network, while the production gateway and production TeleBirr
device bridge legitimately remain attached to it. A normal staging stop must remove staging
containers and disposable staging networks without deleting or disconnecting this shared ingress.

Before restarting staging, run the reviewed
`infra/operations/fetanagent-shared-telebirr-ingress-helper-bridge-v18.sh` once from the DigitalOcean
root console. Stage that script and the successor helper from the exact merged commit in its required
root-owned directory, verify their SHA-256 values, and pass the merged commit, helper digest, and the
script's exact no-money confirmation. The bridge requires staging to remain stopped, the complete
H17/H16/H14 helper-evidence chain, the disabled expiry timer, the exact two durable staging volumes,
the exact H17 continuous-finalizer/sudoers pair, fresh-host IPv6 and database resolution, TCP port
3002 to be free, no namespaced network residue, the exact current production release, and the exact
shared-network identity and isolated endpoint set. The production TeleBirr bridge must have only the
shared internal network and no host-published port; the gateway must have exactly its three reviewed
networks and only the 80/443 host bindings. The
current network ID, Compose configuration hash, `172.23.0.0/16` subnet, and `172.23.0.1` gateway are
intentionally pinned because this is a one-use preservation operation for the existing host, not a
portable network-recreation contract.

Under the shared staging mutation lock, the bridge temporarily disables only the deployment-helper
sudo grant, appends an immutable H18 predecessor/successor record, replaces only the reviewed helper,
re-attests the unchanged production runtime and ingress network, and restores the exact grant. It
does not start, stop, reconnect, or remove a container or network; alter a database role; contact a
payment provider; enable Transfer or Amount entry; or move money. If it stops after disabling the
grant, rerun the exact same bridge with the same three arguments. Do not restore sudoers, edit the
evidence, or recreate the network manually.

The H18 helper has a new digest, so the checksum-bound continuous-availability finalizer and its two
sudo capabilities must be upgraded from their exact H17 digests before the next deployment. Stage
`fetanagent-staging-continuous-availability.sh` and
`fetanagent-staging-continuous-availability.sudoers` from the same merged commit in the existing
root-owned continuity-install directory shape, then run the reviewed
`install-staging-continuous-availability.sh`. The installer accepts only the recorded historical
finalizer/sudoers pairs or the exact new pair; mixed and unknown states fail before replacement. It
publishes same-directory resumable temporary copies with atomic renames and directory synchronization,
so interruption after either file can be recovered by rerunning the identical install. The
old finalizer safely rejects H18 rather than operating against an unrecognized helper during this
short, stopped-runtime transition.

After H18 is installed, stopped-state and cleanup checks preserve exactly this shared ingress, require
the two healthy production endpoints, reject every other endpoint or lookalike network, and remove
only individually classified empty staging networks by full Docker ID. The device pilot now has a
separate reviewed contract: its service and network alias are both `staging-device-pilot-bridge`,
while the production bridge remains `telebirr-device-bridge`. The production gateway selects staging
only for the exact code-owned staging target header. While the pilot is running, the shared ingress
therefore has exactly three endpoints: production gateway, production bridge, and staging pilot
bridge. An exited pilot bridge may retain Docker's inert network-key metadata after its endpoint has
already disappeared from the network. Only the exact blank/zero endpoint record with the pinned
network identity and expected unique aliases is equivalent to detachment; any partially populated
record rejects, and the shared network must then have exactly the two production endpoints. The
installed H18 continuous-availability helper intentionally requires the production
gateway and production TeleBirr bridge to carry one identical revision. A gateway-only route
promotion therefore does **not** become H18-compatible merely by stopping the pilot. Do not promote
the route or run this pilot until a separately reviewed H19 helper successor is installed while the
current all-baseline, two-endpoint boundary is intact. H19 must preserve every H18 network, endpoint,
container, volume, timer, provenance, and no-money invariant while accepting only two
production-ingress pairs: the current all-baseline pair, or the exact reviewed gateway revision and
Caddyfile digest with the protected baseline production bridge release. Its authenticated root
transition must rotate the checksum-bound continuous-availability finalizer at the same time. After
H19, follow the authenticated install and gateway-only transition in
[`production-gateway-staging-telebirr-route-h19.md`](./production-gateway-staging-telebirr-route-h19.md);
never use a full production deployment to hand the alias or network to staging. The H19 candidate
gateway revision is the final H19 merged-main SHA, not the earlier route-PR branch SHA. A changed,
missing, or extra endpoint still fails closed.

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
