# Windows companion pairing and signed read-only lookup deployment

This lane enrolls one Windows companion public key and delivers only an expiring, one-use,
server-signed command for exactly five sequential KemerBet Player-ID Find requests. It does not
enter Amount or Notes, click Transfer, settle a deposit, mutate a provider account or balance, or
move money. The bridge receives neither a KemerBet credential nor a Supabase
administrator/service-role credential.

## Trust boundaries

- The authenticated Owner page issues a one-use package that expires after ten minutes.
- The Windows companion creates its P-256 private key locally and stores only DPAPI-protected key
  material under the current Windows user.
- The public bridge receives a device-signed request, calls only three pairing and four read-only
  lookup functions through `fetanagent_companion_device_bridge_runtime`, signs the no-money
  enrollment certificate and exact-five assignment, and accepts only a fully bound device-signed
  redacted result.
- Raw Player IDs exist only in the sealed database member snapshot, the signed assignment in
  transit, and local companion memory. Results and Owner status expose only bounded outcome counts.
- The bridge has no host-published port. Caddy can reach it only through the fixed internal
  `fetanagent-companion-device-ingress` Docker network. The companion helper creates and attests
  that shared boundary; the staging gateway consumes it as an external network and must never ask
  Compose to replace or relabel it.
- The root helper, rather than unsupported standalone-Compose `uid`, `gid`, or `mode` fields,
  attests file-backed secret ownership and permissions before every start. The database URL is an
  exact no-line-ending byte sequence and is revalidated before it reaches the non-root container.
- The continuously running bridge uses the Supavisor session pooler on port `5432`, with the exact
  `<runtime-role>.<staging-project-ref>` login. The helper proves the IPv4 route, pooler DNS answer,
  and TCP reachability before replacing an active release. Transaction pooling on port `6543` and
  mismatched host/login combinations are rejected.
- The runtime login has no calendar expiry. It stays available until the explicit disable workflow
  is run. Pairing packages still expire after ten minutes and device certificates remain revocable.

## One-time DigitalOcean capability bootstrap

The bridge deployment helper is intentionally separate from the existing core deployment helper.
It must be installed once through the authenticated DigitalOcean root console; GitHub Actions
cannot grant itself root access. Use only a merged `main` commit whose Quality and SQL integration
checks passed.

1. Download these two files from the exact raw GitHub commit into `/root`:
   `infra/operations/fetanagent-companion-device-pairing-helper.sh` as
   `/root/fetanagent-companion-device-pairing-helper.sh`, and
   `infra/operations/install-fetanagent-companion-device-pairing-helper.sh` as
   `/root/install-fetanagent-companion-device-pairing-helper.sh`.
2. Verify both local SHA-256 values against the reviewed commit before execution. Set ownership to
   `root:root` and mode `0600` on both files.
3. Run the installer directly as root. It verifies the helper digest embedded in the installer,
   validates Bash syntax, installs the helper as root-owned mode `0755`, and creates a sudoers rule
   pinned to that exact SHA-256. It does not start a container or change a database.
   When the one reviewed predecessor is already installed, the installer accepts only that exact
   predecessor helper and sudoers digest, keeps attested rollback copies during the rotation, and
   restores them if the successor fails validation. Every other pre-existing state is rejected.
4. Delete the two `/root` staging files after the installed helper and full sudoers configuration
   pass inspection.

Never pipe a network response directly into a root shell. Never replace the embedded digest or use
an unmerged branch in the root console.

## Release sequence

1. Run `Supabase staging bootstrap` against the exact merged commit so the pairing and exact-five
   lookup migrations and SQL integration suites are applied.
2. Run `infra/operations/provision-companion-operational-secrets.ps1` once. It generates an
   independent P-256 server signer and scoped runtime password, then stores only encrypted secrets
   and public metadata in the GitHub `staging` environment. It refuses to rotate existing values.
3. Run `Staging Windows companion pairing trust` in `provision` mode with
   `provision-companion-read-only-lookup-no-money`. This activates the signer and the continuous,
   function-only database login under the exact v2 no-money runtime manifest.
4. Run `Staging companion pairing bridge deploy` in `deploy` mode with
   `deploy-companion-read-only-lookup-no-money`. The checksum-bound helper validates, installs,
   starts, and re-attests the bridge. An unhealthy replacement is removed and the prior bridge is
   restarted when one exists.
5. Deploy the same exact main commit through `Staging beta deploy and smoke`, then republish the
   public gateway. This publishes the updated Owner UI and only the pairing, lookup-poll, and
   lookup-result POST routes.
6. Preserve the existing Porkbun MX, SPF, and mail records. Add only the `device` A record pointing
   to `161.35.41.232`, then verify HTTPS before creating a real pairing package.
7. On the authenticated Owner page, create one Windows pairing package, paste it only into the
   local companion launcher, and confirm the redacted `paired` state.
8. With the paired companion and dedicated KemerBet Chrome window still open, explicitly approve
   one exact-five read-only lookup. Confirm that the Owner page receives only redacted counts and
   that companion evidence still reports `transferDisabled: true` and `moneyMoved: false`.

## Explicit stop and recovery

- `Staging companion pairing bridge deploy` in `stop` mode with
  `stop-companion-read-only-bridge-no-money` stops only the bridge.
- `Staging Windows companion pairing trust` in `disable` mode with
  `disable-companion-read-only-runtime-no-money` revokes the database login without a calendar
  timer.
- The core Owner, customer, Telegram, KemerBet session, and financial switches are outside this
  helper's command surface.
