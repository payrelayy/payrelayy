# Windows companion pairing deployment

This lane enrolls only a Windows companion public key. It does not accept a Player ID, perform a
lookup, enter Amount or Notes, click Transfer, settle a deposit, or move money. The bridge receives
neither a KemerBet credential nor a Supabase administrator/service-role credential.

## Trust boundaries

- The authenticated Owner page issues a one-use package that expires after ten minutes.
- The Windows companion creates its P-256 private key locally and stores only DPAPI-protected key
  material under the current Windows user.
- The public bridge receives a device-signed request, calls only three pairing functions through
  `fetanagent_companion_device_bridge_runtime`, and signs a no-money enrollment certificate.
- The bridge has no host-published port. Caddy can reach it only through the fixed internal
  `fetanagent-companion-device-ingress` Docker network.
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
4. Delete the two `/root` staging files after the installed helper and full sudoers configuration
   pass inspection.

Never pipe a network response directly into a root shell. Never replace the embedded digest or use
an unmerged branch in the root console.

## Release sequence

1. Run `Supabase staging bootstrap` against the exact merged commit so the pairing migration and
   SQL integration suite are applied.
2. Run `infra/operations/provision-companion-operational-secrets.ps1` once. It generates an
   independent P-256 server signer and scoped runtime password, then stores only encrypted secrets
   and public metadata in the GitHub `staging` environment. It refuses to rotate existing values.
3. Run `Staging Windows companion pairing trust` in `provision` mode with
   `provision-companion-pairing-only-no-money`. This activates the signer and the continuous,
   function-only database login.
4. Run `Staging companion pairing bridge deploy` in `deploy` mode with
   `deploy-companion-pairing-only-no-money`. The checksum-bound helper validates, installs, starts,
   and re-attests the bridge. An unhealthy replacement is removed and the prior bridge is restarted
   when one exists.
5. Deploy the same exact main commit through `Staging beta deploy and smoke`, then republish the
   public gateway. This publishes the updated Owner UI and the exact companion POST route.
6. Preserve the existing Porkbun MX, SPF, and mail records. Add only the `device` A record pointing
   to `161.35.41.232`, then verify HTTPS before creating a real pairing package.
7. On the authenticated Owner page, create one Windows pairing package, paste it only into the
   local companion launcher, and confirm the redacted `paired` state. Do not enable lookup or money
   behavior in this phase.

## Explicit stop and recovery

- `Staging companion pairing bridge deploy` in `stop` mode stops only the bridge.
- `Staging Windows companion pairing trust` in `disable` mode revokes the database login without a
  calendar timer.
- The core Owner, customer, Telegram, KemerBet session, and financial switches are outside this
  helper's command surface.
