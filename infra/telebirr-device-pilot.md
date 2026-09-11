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
  the four version-1 TeleBirr device POST routes and selects the staging backend only for the exact
  code-owned `X-FetanAgent-Deployment-Target: staging` header. Exact `production` and
  header-absent legacy requests retain the production backend; invalid, case-confused, comma-list,
  or repeated target values fail with `404` before either upstream;
- the existing public gateway and production bridge in [`compose.production.yaml`](compose.production.yaml).
  They retain public ports `80/443` and the production `telebirr-device-bridge` alias; the staging
  stack adds only the distinct `staging-device-pilot-bridge` endpoint; and
- [`verify-telebirr-device-pilot-deployment.mjs`](verify-telebirr-device-pilot-deployment.mjs), plus
  the Linux `docker compose config` gate in the quality workflow; and
- the standalone [`../android/telebirr-verifier`](../android/telebirr-verifier) application, whose
  inert source default contains the fixed bridge transport, signed protocol, encrypted queue, and
  bounded `specialUse` foreground lifecycle. The historical 0.5.0 pairing-only prerelease predates
  the code-owned routing target and must not be used for this topology; publish a new reviewed,
  target-bound pairing-only release after this change is merged.

This source contract is not proof that the stack is live. Until the credentials, manifests,
database roles, reviewed production-gateway route, containers, DNS, TLS, Android enrollment, and signed smoke
checks below are complete, `device.fetanagent.com` must be treated as unavailable.

## Authority and network layout

```text
Android TeleBirr verifier
        |
        | HTTPS: four exact POST routes + code-owned staging target header
        v
Caddy production gateway (public 80/443; no application secret)
        |
        | fetanagent-telebirr-device-ingress (Docker internal)
        v
database-free staging-device-pilot-bridge :8084 (no host port; no Internet egress)
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
`FINANCIAL_ACTIONS_MODE=dry_run`. The single `FETANAGENT_TELEBIRR_DEPLOYMENT_TARGET` composition
input selects `staging` by default or `production` explicitly for all three services; their runtime
configuration rejects a split or cross-target database/key binding. Only Caddy publishes ports.

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
6. The production gateway and production TeleBirr bridge are healthy on the reviewed shared
   internal ingress. The gateway already contains the exact staging-header route, while the
   production bridge retains only the `telebirr-device-bridge` alias. Promote only that gateway
   image through a separate reviewed gateway-only operation before running this staging workflow.
   Do not use the full production deployment as a handover: the staging workflow never replaces,
   reconnects, stops, or otherwise mutates either production container, and the gateway-only
   prerequisite must leave the production bridge container and its network attachment byte-for-byte
   unchanged.
   The existing H18 staging helper rejects that split revision even after the pilot is stopped.
   Before the gateway-only promotion, install a separately reviewed H19 successor from the intact
   all-baseline, two-endpoint state. H19 must pin the protected baseline bridge release and admit only
   the baseline gateway/Caddyfile pair or the exact reviewed gateway revision/Caddyfile pair; it must
   also rotate the continuous-availability finalizer's helper checksum. Until H19 is merged,
   installed, and verified, the gateway promotion and this pilot workflow are release-blocked.
7. `FINANCIAL_ACTIONS_MODE=dry_run` and every KemerBet/final-action/private-live-pilot switch remain
   disabled. Deployment of this stack is not permission to relax them.

### One-time helper-v3 installation

The workflow is checksum-bound to the installed root helper, so install the reviewed successor once
after this change is merged and before either `stop` or `deploy-and-smoke`. Helper v3 keeps the
device-pilot release identity independent from the already-installed terminal H19 gateway release;
it pins both identities and the reviewed Caddyfile bytes separately. In the authenticated
DigitalOcean root console, create the fixed directory
`/root/fetanagent-telebirr-device-pilot-helper-v3` as `root:root` mode `0700`. Stage the merged
`fetanagent-telebirr-device-pilot-helper.sh` there as `root:root` mode `0600`, and stage
`install-fetanagent-telebirr-device-pilot-helper-v3.sh` in that same directory as `root:root` mode
`0700`. Leave no other directory entry. Verify both files against the reviewed GitHub blobs, then run
the installer at that exact path directly as root. Do not invoke it through `sudo` or an SSH
deployment identity.

The installer accepts only the exact helper-v2 predecessor digest or an already-installed exact
successor, takes the same deployment mutation lock, preserves the unchanged sudoers fragment, and
atomically replaces only `/usr/local/sbin/fetanagent-telebirr-device-pilot-helper`. It does not call
Docker or PostgreSQL. If it reports an interrupted `.installing` or `.previous` file, preserve that
file and inspect it; do not delete or rename it manually.

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

The staging helper/workflow must implement this order as one locked, exact-commit operation:

1. Inspect the current containers, image revision labels, network membership, production-gateway
   host ports, free disk/memory, database route, and guarded source files. Require the exact two
   production ingress endpoints before staging starts. Make no change when any check is ambiguous.
2. Require the already-deployed production gateway configuration to contain both the exact
   staging-header route to `staging-device-pilot-bridge:8084` and the unchanged production route to
   `telebirr-device-bridge:8084`.
3. Build the three exact no-money Docker targets from the reviewed full SHA. Reject an image whose
   revision label differs or whose target exposes an unexpected port. Validate the pilot Compose
   file with an empty environment plus the explicit file paths.
4. Build the runtime manifest from the current armed dry-run pilot without modifying the database.
   If an active-release receipt exists, the locked helper must validate its exact receipt, sealed
   release and images, derive its legacy or current bridge service name from that sealed Compose
   file, and stop only those three transport containers before removing only that receipt. This
   controlled quiescence occurs before opening the replacement brokers' single-connection login
   slots. It also recovers the exact case where a production rollout already stopped the old pilot
   containers but left the receipt. A same-commit immutable redeployment is rejected without
   stopping anything; containers without a receipt fail closed.
5. Provision the two bounded no-money runtime logins and prove each exact identity can connect
   through its dedicated slot. If quiescence was attempted and any later step fails or is cancelled,
   set both roles to `NOLOGIN`, terminate their sessions, and leave the transport offline for
   reconciliation. Do not automatically restart the predecessor with uncertain credentials.
6. Install the sealed release under its full reviewed commit and reject an existing immutable
   release directory.
7. Re-attest the unchanged production gateway, production bridge, host bindings, shared internal
   network, both non-conflicting aliases, and the exact production-only endpoint set.
8. Start the pilot composition with the exact `telebirr-device-pilot` profile. Compose must wait
   for both mode-`0600` Unix-socket brokers to be healthy before the bridge starts.
9. Prove all three containers use the exact image SHA, UID/GID `10001`, read-only root filesystem,
   no host port, expected networks only, no restart loop, and healthy status. Prove the bridge has
   no database/proxy environment and cannot reach the public Internet.
10. From the VM, exercise malformed, wrong-method, wrong-content-type, query-bearing, oversized,
    and unknown-path requests and require fixed rejection. No real assignment or device evidence is
    needed for this pre-DNS negative smoke.
11. Verify the existing `device.fetanagent.com` DNS and certificate without changing them. Require
    HTTP/1.1 or HTTP/2 only and re-run the negative route matrix with the exact staging target header.
12. Create a single-use Owner pairing challenge and copy its canonical short-lived package directly
    from the authenticated Owner page into the dedicated phone. The app generates the device
    identity inside Android Keystore, encrypts the exact signed request before sending it, enrolls
    only its public key, and clears the matching clipboard entry after success. Perform the signed
    no-money pairing/heartbeat/exact-request-replay smoke in a `pairing_only` APK. Keep assignment
    polling, official-provider observation, settlement, and execution disabled.
13. Install only the reviewed, signed operational APK on the dedicated Owner phone. Require
    automatic network-provided date/time and timezone, grant notification visibility, allow the app
    to run in the phone vendor's background/battery settings, press Start once, and require the
    persistent redacted health notification. Do not enter an endpoint, API key, reference, receiver
    name, or other secret into the phone.
14. With no assignment open, prove the idle backoff remains bounded; then reboot the phone and
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

If the pilot smoke fails, remove only the three pilot containers and the two exact empty
Compose-owned database-egress networks. Network cleanup accepts no extra project network, no attached
endpoint, no lookalike name/label shape, and removes each validated network only by its full Docker
ID. The helper must prove the exact production gateway and bridge container identities survived and
that the shared ingress returned to its two production endpoints before removing the active receipt.
Docker can retain the shared-ingress key on an exited bridge after removing its network endpoint. The
helper treats that record as detached only when its network ID and unique alias set remain exact,
`IPAMConfig` is empty, link/driver options are null, gateway priority is zero, and every endpoint ID,
gateway, address, prefix, and MAC field is blank or zero. Any partial or inconsistent retained record
fails closed; the shared network must still contain only the two production endpoints.
Preserve Caddy state, the two named socket volumes, sealed historical releases, and database evidence;
do not roll back the production gateway from this staging workflow.

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
- the three healthy exact-revision staging containers and the independently reviewed production
  gateway containing both non-conflicting routes;
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
