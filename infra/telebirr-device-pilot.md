# TeleBirr Android device pilot deployment

This runbook deploys the evidence-only TeleBirr Android transport without enabling a claim,
settlement, wallet mutation, KemerBet execution, or any other financial action. The stack has no
calendar stop. It remains available across ordinary host restarts and stops only through an
explicit operator action, a failed safety gate, revoked/expired database or device authority, or a
service health failure.

The deployable source contract consists of:

- [`compose.telebirr-device-pilot.yaml`](compose.telebirr-device-pilot.yaml), which is inert unless
  the exact `telebirr-device-pilot` profile is selected;
- the `device.fetanagent.com` site in [`gateway/Caddyfile`](gateway/Caddyfile), which accepts only
  the four version-1 TeleBirr device POST routes;
- the existing public gateway in [`compose.staging-beta.yaml`](compose.staging-beta.yaml), which is
  the only public port owner and the only existing service attached to the internal device-ingress
  bridge; and
- [`verify-telebirr-device-pilot-deployment.mjs`](verify-telebirr-device-pilot-deployment.mjs), plus
  the Linux `docker compose config` gate in the quality workflow; and
- the standalone [`../android/telebirr-verifier`](../android/telebirr-verifier) application, whose
  inert source default contains the fixed bridge transport, signed protocol, encrypted queue, and
  bounded `specialUse` foreground lifecycle; and the signed 0.5.0 pairing-only prerelease at GitHub
  tag `android-telebirr-pairing-v0.5.0`, which remains unenrolled and cannot poll assignments or
  observe receipts.

This source contract is not proof that the stack is live. Until the credentials, manifests,
database roles, gateway replacement, containers, DNS, TLS, Android enrollment, and signed smoke
checks below are complete, `device.fetanagent.com` must be treated as unavailable.

## Authority and network layout

```text
Android TeleBirr verifier
        |
        | HTTPS: four exact POST routes
        v
Caddy gateway (public 80/443; no application secret)
        |
        | fetanagent-telebirr-device-ingress (Docker internal)
        v
database-free device bridge :8084 (no host port; no Internet egress)
        |                                      |
        | read-only mode-0600 Unix socket      | read-only mode-0600 Unix socket
        v                                      v
assignment broker                        device-state broker
        |                                      |
        | dedicated DB-egress bridge           | separate DB-egress bridge
        v                                      v
scoped assignment PostgreSQL role         scoped device-state PostgreSQL role
```

The public bridge receives neither database URL. The assignment broker alone receives the scoped
reference-opening child key and assignment-signing private key. The device-state broker receives
neither. No process receives a Supabase `service_role` key, reference-protection master, Telegram
token, KemerBet credential, wallet secret, or Docker socket.

All three containers run as `10001:10001`, use read-only root filesystems, drop every Linux
capability, prohibit privilege gain, have bounded memory/PIDs/logs, and require
`FINANCIAL_ACTIONS_MODE=dry_run`. Only Caddy publishes ports.

## Preconditions

Do not select the pilot profile until every item below is true:

1. The exact release commit is merged to `main`, all GitHub checks pass, and every image is built
   from that full commit SHA.
2. The applied Supabase migrations and redacted `Staging TeleBirr broker readiness` inspection
   match that commit and report the expected protected receiver, open pilot/profile, device state,
   catalog, and all financial switches disabled.
3. The two dedicated PostgreSQL roles have bounded `LOGIN` credentials, only their reviewed
   routines, the required creator-admin containment edge, and no base-table or settlement access.
4. The assignment signer, scoped reference-opening child key, bridge server signer, and both
   canonical manifests have been generated and cross-checked offline. The reference-protection
   master keys remain outside this stack.
5. The VM has the verified Supabase CA, working outbound database route, current backups,
   monitoring, log rotation, incident procedure, and enough disk/memory.
6. The existing Caddy certificate data and configuration directories are backed up and remain
   mounted from `/var/lib/fetanagent-gateway`.
7. `FINANCIAL_ACTIONS_MODE=dry_run` and every KemerBet/final-action/private-live-pilot switch remain
   disabled. Deployment of this stack is not permission to relax them.

## Operator-owned files

Use one release-specific directory outside Git, for example
`/var/lib/fetanagent/telebirr-device-pilot/<full-commit>/`. Do not use a shared `.env` as a secret
store. Do not paste any value into GitHub logs, workflow inputs, chat, screenshots, or shell
history.

| Compose variable                                                   | Source file contents                                    | Owner/mode before Compose starts |
| ------------------------------------------------------------------ | ------------------------------------------------------- | -------------------------------- |
| `FETANAGENT_TELEBIRR_SUPABASE_CA_CERTIFICATE_FILE`                 | verified Supabase CA PEM                                | `root:root`, `0444`              |
| `FETANAGENT_TELEBIRR_ASSIGNMENT_SIGNER_PUBLIC_KEY_FILE`            | assignment signer P-256 SPKI DER                        | `root:root`, `0444`              |
| `FETANAGENT_TELEBIRR_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE`          | canonical bridge manifest                               | `root:root`, `0444`              |
| `FETANAGENT_TELEBIRR_ASSIGNMENT_DATABASE_URL_FILE`                 | scoped assignment-role URL with `sslmode=verify-full`   | `10001:10001`, `0400`            |
| `FETANAGENT_TELEBIRR_REFERENCE_OPENING_KEY_FILE`                   | TeleBirr/purpose-scoped child key document              | `10001:10001`, `0400`            |
| `FETANAGENT_TELEBIRR_ASSIGNMENT_RUNTIME_MANIFEST_FILE`             | canonical assignment runtime manifest                   | `10001:10001`, `0400`            |
| `FETANAGENT_TELEBIRR_ASSIGNMENT_SIGNER_PRIVATE_KEY_FILE`           | assignment signer P-256 PKCS#8 DER                      | `10001:10001`, `0400`            |
| `FETANAGENT_TELEBIRR_DEVICE_STATE_DATABASE_URL_FILE`               | scoped device-state-role URL with `sslmode=verify-full` | `10001:10001`, `0400`            |
| `FETANAGENT_TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE` | bridge server signer P-256 PKCS#8 DER                   | `10001:10001`, `0400`            |

The parent directories must be `root:root` mode `0700`. File-backed Compose secrets/configs are
implemented as bind mounts on ordinary Docker Compose installations, so the source file's numeric
ownership and permissions remain authoritative; do not rely only on the `uid`, `gid`, and `mode`
fields in YAML. Check every source with `lstat`, `realpath`, owner, and mode immediately before the
deployment helper invokes Compose.

The database URL files must contain only the exact URL bytes, with no line terminator or surrounding
whitespace. Both brokers use the TLS-verified direct database endpoint on port `5432` with their
bare, dedicated runtime role. Their two isolated Compose networks have IPv6 enabled and no shared
network between them; the staging VM and each exact production network must prove direct IPv6 DNS
and TCP reachability before deployment. Never substitute a pooler URL, administrator URL, API role,
or `service_role`.

The ephemeral GitHub control plane reaches that same direct endpoint through a short-lived,
host-key-pinned SSH tunnel over the staging VM. `PGHOSTADDR` selects the loopback end of the tunnel
while `PGHOST` remains the exact direct hostname for `verify-full` certificate validation. The
database password remains only in the runner environment, the tunnel process is closed at step
exit, and no administrator connection is copied into a release artifact.

## Fail-closed publication sequence

The production helper/workflow must implement this order as one locked, exact-commit operation:

1. Inspect the current containers, image revision labels, network membership, gateway certificate
   directories, host ports, free disk/memory, database route, and guarded source files. Make no
   change when any check is ambiguous.
2. Build the three exact Docker targets and the gateway target from the reviewed full SHA. Reject
   an image whose revision label differs or whose target exposes an unexpected port.
3. Validate both Compose files with an empty environment plus the explicit file paths, and run
   `caddy validate` against the exact release Caddyfile.
4. Build the runtime manifest from the current armed dry-run pilot without modifying the database.
   If an active-release receipt exists, the locked helper must validate its exact receipt, sealed
   release, images, gateway, three healthy containers, HTTPS rejection behavior, and different
   commit; then stop only those three transport containers and remove only that receipt. This
   controlled quiescence occurs before opening the replacement brokers' single-connection login
   slots. A same-commit immutable redeployment is rejected without stopping anything.
5. Provision the two bounded no-money runtime logins and prove each exact identity can connect
   through its dedicated slot. If quiescence was attempted and any later step fails or is cancelled,
   set both roles to `NOLOGIN`, terminate their sessions, and leave the transport offline for
   reconciliation. Do not automatically restart the predecessor with uncertain credentials.
6. Install the sealed release under its full reviewed commit and reject an existing immutable
   release directory.
7. Recreate only the secret-free gateway from the reviewed release. This creates and joins the
   fixed `fetanagent-telebirr-device-ingress` internal network while preserving the existing Caddy
   data/config mounts and the public home/Owner routes. Do not change the private application
   containers.
8. Start the pilot composition with the exact `telebirr-device-pilot` profile. Compose must wait
   for both mode-`0600` Unix-socket brokers to be healthy before the bridge starts.
9. Prove all three containers use the exact image SHA, UID/GID `10001`, read-only root filesystem,
   no host port, expected networks only, no restart loop, and healthy status. Prove the bridge has
   no database/proxy environment and cannot reach the public Internet.
10. From the VM, exercise malformed, wrong-method, wrong-content-type, query-bearing, oversized,
    and unknown-path requests and require fixed rejection. No real assignment or device evidence is
    needed for this pre-DNS negative smoke.
11. Only now add the Porkbun `A` record `device` -> `161.35.41.232` with TTL `600`, preserving the
    nameservers, MX, SPF, and all unrelated records. Do not add an AAAA record in the first cutover.
12. Wait for public DNS, Caddy certificate issuance, and HTTPS readiness. Verify the certificate
    hostname/chain and require HTTP/1.1 or HTTP/2 only. Re-run the negative route matrix publicly.
13. Create a single-use Owner pairing challenge and copy its canonical short-lived package directly
    from the authenticated Owner page into the dedicated phone. The app generates the device
    identity inside Android Keystore, encrypts the exact signed request before sending it, enrolls
    only its public key, and clears the matching clipboard entry after success. Perform the signed
    no-money pairing/heartbeat/exact-request-replay smoke in a `pairing_only` APK. Keep assignment
    polling, official-provider observation, settlement, and execution disabled.
14. Install only the reviewed, signed operational APK on the dedicated Owner phone. Require
    automatic network-provided date/time and timezone, grant notification visibility, allow the app
    to run in the phone vendor's background/battery settings, press Start once, and require the
    persistent redacted health notification. Do not enter an endpoint, API key, reference, receiver
    name, or other secret into the phone.
15. With no assignment open, prove the idle backoff remains bounded; then reboot the phone and
    require opt-in recovery. Use the notification Stop action and require that a second reboot stays
    stopped. Re-enable only for the later controlled evidence test.

Do not publish DNS earlier merely to make certificate issuance convenient. A public hostname that
routes to a missing bridge is a failed deployment, not progress.

## Health and restart behavior

There is deliberately no date-based shutdown. `restart: unless-stopped` keeps the three pilot
services available after ordinary daemon or VM restarts. Availability is still subordinate to
safety: an invalid manifest, expired/revoked database role, replaced socket inode, wrong owner/mode,
catalog drift, revoked enrollment, or non-dry-run financial mode must fail closed.

The deployment smoke must record only the release SHA, image IDs, container IDs, health states,
network names, public certificate metadata, fixed response classes, and redacted database/device
states. It must not emit URLs containing passwords, account/receiver data, device keys, raw
observations, pairing material, or signed assignments.

## Rollback and emergency disable

If the new gateway or pilot smoke fails before DNS, remove only the three pilot containers and
restore the previous exact gateway image/Caddyfile. Preserve Caddy certificate state and the two
socket volumes until the incident is classified. Do not delete database evidence.

If a public smoke fails after DNS, first remove or park only the `device` A record, then stop the
pilot profile. Leave `fetanagent.com`, `owner.fetanagent.com`, email DNS, the private beta, and Caddy
certificate data untouched. If credential exposure or catalog drift is suspected, run the reviewed
`Staging TeleBirr broker emergency disable` workflow to remove both broker logins and terminate their
sessions; do not improvise SQL from a shell.

Rollback does not authorize replaying an uncertain request. Exact retries use the protocol's
persisted replay response; every other uncertain state remains stopped for reconciliation.

## Completion evidence

This deployment phase is complete only when all of the following are independently recorded:

- the reviewed main SHA and passing GitHub checks;
- the three healthy exact-revision containers and the exact gateway revision;
- no host-published bridge/broker port and no database authority in the bridge;
- `device.fetanagent.com` resolving only to `161.35.41.232` with valid HTTPS;
- four accepted route shapes and rejection of every other public route/method/content type;
- one Android Keystore public identity enrolled through a one-use challenge;
- signed pairing, heartbeat, and exact replay behavior in no-money mode; and
- the reviewed signed APK version, granted notification visibility, persistent foreground health,
  bounded idle/retry behavior, one successful opted-in reboot recovery, and one successful explicit
  Stop that remains stopped after reboot; and
- settlement, execution, claims, and all real-money switches still disabled.

Successful deployment is evidence that the Android evidence transport is reachable. It is not yet
evidence that an official TeleBirr observation is correct, that settlement is safe, or that the
product may accept real user money.
