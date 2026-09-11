# H19 production-gateway transition for staging TeleBirr ingress

H19 is the narrow successor to the completed H18 shared-ingress bridge. It permits the reviewed
staging TeleBirr target-header route to reach the staging device pilot without upgrading or
recreating the production TeleBirr bridge. It is an ingress transition only. It does not authorize a
deposit, a transfer, an Amount entry, database mutation, provider execution, or any other financial
action.

Its exact source dependency is the reviewed staging-ingress change from pull request `#291`, head
`6dc6ed1274a099b8676ef0de2d713fcb23b71e87`. That head's product Caddyfile is LF-pinned at
`afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616`; the final H19 branch must
contain those same bytes. Its device-pilot helper is
`344462ff1cf9fd445440aca4808bb412dff8fef03bba38092ed05ea0e7db2985`, and its helper-v2 installer is
`9caffaf3e8c78ad623a741a76f6e5829f60975345eb5d7e90d614ddffd105950`. The PR head is provenance
for review, not the runtime release identity.

## Exact accepted states

The installed H19 helper and root-owned ingress guard accept only these two public-ingress states:

1. Baseline: all ten production containers, including the gateway and production TeleBirr bridge,
   remain at protected release `69be82ac3e49ff8c63c64c9aa7926e0046b48a10`; the gateway contains
   the baseline LF Caddyfile SHA-256
   `181992c8958397d63a7ae34137d51d4186ce0383c8cfd2bf8df137da11e12f24`.
2. Reviewed gateway only: the production gateway alone carries the final H19 merged-main revision
   and image tag, and contains LF Caddyfile SHA-256
   `afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616`.
   The other nine production containers, including `telebirr-device-bridge`, remain exactly at
   `69be82ac3e49ff8c63c64c9aa7926e0046b48a10`.

The H19 bridge release and candidate gateway revision must be the same final 40-character H19 merge
SHA. This is intentional: staging and device-pilot workflows require the gateway route revision to
match the workflow's reviewed current `main`. Do not use the device-route PR's pre-merge branch SHA or
an H19 pre-merge SHA as the installed release identity.

Both states retain the exact ten-service inventory, rootless `10001:10001` users, read-only filesystems,
capability drops, health and restart boundaries, gateway ports 80/443, the gateway's three networks,
the isolated two-endpoint TeleBirr ingress network, and all three no-money environment gates on every
non-gateway service. H19 also pins the complete production/container snapshot, stopped staging and
durable-volume snapshot, shared-network snapshot, public TLS leaf, gateway image ID, and Caddyfile
bytes at each terminal state. A missing, extra, restarted, retagged, re-networked, or otherwise
different object fails closed.

The candidate gateway additionally retains the production companion upstream, the two exact ACME
bind mounts, health command, CPU/memory/PID limits, and bounded JSON logging configuration. The
transition intent seals both the reviewed candidate image ID and the exact protected baseline gateway
image ID, so a rollback cannot follow a moved or retagged protected tag. The gateway-only compose
operation is also restricted to the protected release's root-owned, mode-`0444`
`compose.production.yaml` at SHA-256
`98d7e763754868ba978d5c042c722664a1c1aec6f85e9011410d74e5d5f1928c`.

## Reviewed artifacts and provenance

The H19 source bundle consists of:

- `infra/operations/fetanagent-staging-telebirr-route-helper-bridge-v19.sh`
- `infra/operations/fetanagent-staging-deploy-helper.sh`
- `infra/operations/fetanagent-staging-continuous-availability.sh`
- `infra/operations/fetanagent-staging-continuous-availability.sudoers`
- `infra/operations/fetanagent-production-ingress-h19.sh`

The root installer accepts only the exact source-pinned SHA-256 of all four installed artifacts. It
parses the completed H18 record, retains H18's intent and completion hashes, and archives the exact H18
helper, continuous finalizer, and continuous sudoers bytes. Its H19 intent records the stopped staging,
production, shared-ingress, TLS, baseline Caddy, candidate Caddy, and no-money boundaries. Completion
copies the intent canonically and appends its SHA-256.

The installer rotates the helper-dependent continuous finalizer and its checksum-bound sudoers pair in
one fail-closed transaction. It disables the deployment capability and old continuous capability,
publishes resumable root-only files, archives the predecessors, atomically replaces the ingress guard,
helper, and finalizer, publishes terminal provenance, installs the matching sudoers checksum, and only
then restores the unchanged deployment capability. Every intermediate file is prefix-validated and
every allowed crash topology is explicit. If installation stops with the deployment grant disabled,
rerun the identical staged installer and arguments; do not restore a grant or edit evidence manually.

## Installation order

The route PR must be merged first. Then merge H19 on top of that `main`, because H19's final merge SHA
is the candidate gateway OCI revision. Wait for all required checks. On the staging Droplet, use the
existing authenticated DigitalOcean root console and stage the five files from that exact H19 merge in:

```text
/root/fetanagent-staging-telebirr-route-helper-bridge-v19-H19_MERGE_SHA/
```

Use these exact staged names and permissions:

```text
root:root 0700 fetanagent-staging-telebirr-route-helper-bridge-v19.sh
root:root 0600 fetanagent-staging-deploy-helper.next
root:root 0600 fetanagent-staging-continuous-availability.next
root:root 0600 fetanagent-staging-continuous-availability.sudoers.next
root:root 0600 fetanagent-production-ingress-h19.next
```

Verify each SHA-256 against the final merged files. Keep staging and the TeleBirr device pilot stopped.
The production stack must still be the exact all-baseline H18 state, the expiry timer must remain
in a coherent stopped state, the two durable staging volumes must be holder-free, and the
gateway-transition namespace must not exist. H19 accepts either the exact root-owned, loaded,
inactive, disabled timer/service pair left by continuous-availability finalization or the exact fully
absent pair produced by the staging helper's `stop` command. A mixed pair or filesystem residue fails
closed. Run the staged installer directly as root with:

```text
fetanagent-staging-telebirr-route-helper-bridge-v19.sh \
  H19_MERGE_SHA \
  H19_MERGE_SHA \
  SUCCESSOR_HELPER_SHA256 \
  SUCCESSOR_CONTINUOUS_FINALIZER_SHA256 \
  SUCCESSOR_CONTINUOUS_SUDOERS_SHA256 \
  INGRESS_GUARD_SHA256 \
  I-UNDERSTAND-THIS-INSTALLS-H19-INGRESS-GUARDS-WITH-NO-PRODUCTION-OR-MONEY-MUTATION
```

The installer validates Droplet `593344964` and public IPv4 `161.35.41.232`, forbids sudo and Docker
environment overrides, acquires the shared mutation lock, performs no production Docker mutation, and
restores the deployment capability only after the new helper itself revalidates the full H19→H18→H17
→H16→H14 chain and baseline ingress state.

## Build and gateway-only transition

Build the production gateway image from the final H19 merged commit using the existing reviewed image
build contract. The local image must be named `fetanagent-gateway:H19_SHA_PREFIX`, carry OCI title
`fetanagent-gateway`, carry the exact full H19 SHA as `org.opencontainers.image.revision`, use
`10001:10001`, have a null entrypoint and the exact Caddy command, validate with a networkless read-only
container, and contain the reviewed Caddyfile digest. Record its immutable `sha256:` image ID; never
substitute a tag for that ID in the transition authorization.

Before cutover, use the installed guard's read-only baseline check:

```text
/usr/local/sbin/fetanagent-production-ingress-h19 inspect \
  69be82ac3e49ff8c63c64c9aa7926e0046b48a10
```

Then, from the direct root console, run the single authorized gateway transition:

```text
/usr/local/sbin/fetanagent-production-ingress-h19 transition \
  H19_MERGE_SHA \
  sha256:EXACT_64_HEX_IMAGE_ID \
  I-UNDERSTAND-THIS-REPLACES-ONLY-THE-PRODUCTION-GATEWAY-WITH-NO-MONEY
```

The guard revalidates the candidate image, records the baseline production, immutable-nine,
shared-ingress, TLS, and protected gateway-image fingerprints, and uses the protected production compose file with
`up --no-deps --no-build ... gateway`. It never changes the `current` production-release symlink and
never names another service. After replacement it requires the exact candidate image ID and Caddyfile,
the unchanged nine-container fingerprint and TLS leaf, the exact two shared-ingress endpoints, and
public route probes proving:

- header-absent legacy TeleBirr requests still reach production;
- exact `production` target requests reach production;
- exact `staging` target requests select the stopped staging upstream and therefore fail upstream,
  rather than silently falling back to production;
- case-confused and duplicate target headers return 404 without reaching either upstream.

Only after those checks does it publish an immutable completion receipt. Validate the terminal state:

```text
/usr/local/sbin/fetanagent-production-ingress-h19 inspect H19_MERGE_SHA
```

If the root process is interrupted before completion, rerun the exact transition with the same image
ID. Empty namespace creation, partial intent publication, a temporarily absent gateway, partial
completion publication, and a completed receipt awaiting its final directory rename are all explicit
resumable states. Every partial record must be an exact prefix of the same canonical record. If the
candidate cannot be completed, the direct root console may restore the protected gateway image ID
sealed before cutover from that same interrupted record only:

```text
/usr/local/sbin/fetanagent-production-ingress-h19 rollback \
  I-UNDERSTAND-THIS-REPLACES-ONLY-THE-PRODUCTION-GATEWAY-WITH-NO-MONEY
```

Rollback is intentionally unavailable after a completed transition. A completed candidate and a
completed rollback each have one terminal receipt and one exact post-state fingerprint; deleting or
rewriting a receipt is not a recovery procedure.

## Verification

Run before review and again after rebasing onto the final route merge:

```text
node infra/test-telebirr-gateway-routing.mjs fetanagent-gateway:ci
node infra/verify-telebirr-device-pilot-deployment.mjs
node infra/verify-shared-telebirr-ingress-helper-bridge-v18.mjs
node infra/verify-staging-telebirr-route-helper-bridge-v19.mjs
pnpm test:infra
pnpm lint
```

The H19 verifier binds every successor digest to the actual LF repository bytes, exercises all allowed
and rejected installation topologies, checks exact provenance field order and length, verifies the
two-state revision logic and image-ID binding, and rejects production-wide compose, database, or money
operations. The gateway routing suite separately executes the Caddy matcher matrix, including
duplicate-header and malformed-target adversarial cases.
