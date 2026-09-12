# H19 production-gateway transition for staging TeleBirr ingress

H19 is the narrow successor to the completed H18 shared-ingress bridge. It permits the reviewed
staging TeleBirr target-header route to reach the staging device pilot without upgrading or
recreating the production TeleBirr bridge. It is an ingress transition only. It does not authorize a
deposit, a transfer, an Amount entry, database mutation, provider execution, or any other financial
action.

Its exact source dependency is the reviewed staging-ingress change from pull request `#291`, head
`6dc6ed1274a099b8676ef0de2d713fcb23b71e87`. That head's product Caddyfile is LF-pinned at
`afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616`; the final H19 branch must
contain those same bytes. The helper installed during the historical H19 transition was
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

The H19 bridge release and candidate gateway revision had to be the same final 40-character H19 merge
SHA during that one-time gateway transition. After H19 reached its terminal receipt, later
device-pilot releases must not pretend to be gateway releases: the device-pilot helper pins the
terminal H19 gateway revision and its Caddyfile separately from each reviewed device-pilot `main`
revision. Do not use the device-route PR's pre-merge branch SHA or an H19 pre-merge SHA as the
installed gateway release identity.

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

## H20 canonical-capability correction

Docker Compose accepts `NET_BIND_SERVICE` in YAML but Docker reports the resulting runtime capability
as `CAP_NET_BIND_SERVICE` in container inspection. The original H19 guard compared the runtime value
to the Compose spelling and therefore rejected the otherwise exact protected production baseline. It
failed closed before any production mutation and left the staging deployment grant disabled, as
designed.

H20 corrects that comparison without rewriting or deleting H19 evidence and without authorizing a new
gateway candidate. The H19 candidate remains
`90b1f059577682b6bc458d239f6bdcb591077085`. H20 is a separate provenance release for the operational
correction only. Its installer requires the exact terminal H19 release, H19 intent SHA-256
`51e0f03017e8986d5bd76bbb97759437d86011ce448c34999ef1bb9836d056a3`, H19 completion SHA-256
`fdccf275bb43f95ea140411c0cee044a6c8e13d884dae640c64123936a8119d5`, and all four H19 artifact
digests. It also requires the production, shared-ingress, TLS, stopped-staging, and Caddyfile
fingerprints sealed by H19.

Stage these five files from the exact merged H20 correction commit in a root-owned mode-`0700`
directory named `/root/fetanagent-h19-canonical-cap-guard-bridge-v20-H20_MERGE_SHA/`:

```text
root:root 0700 fetanagent-h19-canonical-cap-guard-bridge-v20.sh
root:root 0600 fetanagent-staging-deploy-helper.next
root:root 0600 fetanagent-staging-continuous-availability.next
root:root 0600 fetanagent-staging-continuous-availability.sudoers.next
root:root 0600 fetanagent-production-ingress-h19.next
```

First run its read-only preflight directly as root. This validates the complete live boundary and
exits before acquiring the mutation lock or changing any state:

```text
fetanagent-h19-runtime-reattest-guard-bridge-v23.sh \
  H23_MERGE_SHA \
  SUCCESSOR_INGRESS_GUARD_SHA256 \
  I-UNDERSTAND-THIS-REATTESTS-THE-EXACT-NO-MONEY-PRODUCTION-RUNTIME-WITHOUT-MUTATING-IT \
  preflight
```

Only after that succeeds, run the identical staged installer without the `preflight` argument to
apply the guard-only evidence transition:

```text
fetanagent-h19-canonical-cap-guard-bridge-v20.sh \
  H20_MERGE_SHA \
  SUCCESSOR_HELPER_SHA256 \
  SUCCESSOR_CONTINUOUS_FINALIZER_SHA256 \
  SUCCESSOR_CONTINUOUS_SUDOERS_SHA256 \
  SUCCESSOR_INGRESS_GUARD_SHA256 \
  I-UNDERSTAND-THIS-CORRECTS-H19-CAPABILITY-CANONICALIZATION-WITH-NO-PRODUCTION-OR-MONEY-MUTATION
```

The H20 transaction archives the exact H19 helper, continuous finalizer, continuous sudoers, and
ingress guard; publishes a root-only record linked to the immutable H19 intent and completion;
atomically rotates the corrected four-file checksum chain; revalidates the unchanged H19 baseline;
and restores the disabled deployment grant only after the installed helper and guard attest the full
chain. Its only accepted runtime capability value is Docker's canonical
`["CAP_NET_BIND_SERVICE"]`; the non-canonical inspection value remains rejected. If interrupted, rerun
the identical H20 installer and arguments. Do not edit either provenance record or restore a sudo
grant manually.

## H21 stable immutable-nine recovery

The first authorized gateway transition published its exact intent and then failed closed before
Compose ran. No container changed. The failure came from hashing Docker's complete inspection object
for the nine non-gateway services: health-check log entries rotate continuously, and Docker can return
the same mount array in different orders. Those volatile representations made an unchanged runtime
produce different SHA-256 values.

H21 preserves that interrupted intent byte-for-byte. It archives the H20 ingress guard and the sealed
transition intent, then replaces only the guard with a version that removes
`.State.Health.Log`, sorts every `.Mounts` array by all mount identity fields, and sorts containers by
name before hashing. The H21 record binds the legacy raw digest
`6aa4f35860635609b54e0884810b16fdb10a39275b687a8f678e5af86ed00c42` to the independently repeated
canonical digest `a72b855a5b59e2169b9bbdca1dce03aa8dec17b16082fa83b0dc55b1910c90c9` only for the archived intent
whose SHA-256 is `b0dd0ff0f66d961448e6e214feea8806627bf9f5aac1995436b2105f3fce6537`.
No other recorded digest receives that translation.

Stage these two files from the exact merged H21 commit in a root-owned mode-`0700` directory named
`/root/fetanagent-h19-stable-nine-guard-bridge-v21-H21_MERGE_SHA/`:

```text
root:root 0700 fetanagent-h19-stable-nine-guard-bridge-v21.sh
root:root 0600 fetanagent-production-ingress-h19.next
```

Run the staged installer directly as root:

```text
fetanagent-h19-stable-nine-guard-bridge-v21.sh \
  H21_MERGE_SHA \
  SUCCESSOR_INGRESS_GUARD_SHA256 \
  b0dd0ff0f66d961448e6e214feea8806627bf9f5aac1995436b2105f3fce6537 \
  a72b855a5b59e2169b9bbdca1dce03aa8dec17b16082fa83b0dc55b1910c90c9 \
  sha256:443aac301bb8c26a51f7877a9cf016e8fd2101831c0cac6f59f7bd88a17189e8 \
  I-UNDERSTAND-THIS-CORRECTS-H19-STABLE-NINE-DIGEST-WITH-NO-PRODUCTION-OR-MONEY-MUTATION
```

The installer isolates the staging deployment grant, acquires the existing shared mutation lock,
requires the exact H19 and H20 evidence chain, and rechecks the protected baseline, shared ingress,
TLS leaf, stopped staging projects, canonical nine-service digest, and interrupted intent. It performs
no Compose or database operation. The grant is restored only after the installed successor guard's
`recovery-inspect` mode independently accepts the full state. If installation is interrupted, rerun
the identical staged installer and arguments; never edit the transition or provenance records.

## H22 terminal receipt ordering correction

The resumed H19 transition replaced only the production gateway and reached the exact healthy
candidate state. It published completion receipt
`d33d2e51852fabdfd8f750bfd16118fe987e8b4201483b1cc2f688063047d559`, whose post-transition
production and shared-ingress fingerprints are respectively
`72a619a6418030098a2ebb862d35d48f56118de886ae6ef88b09a782b29d2aac` and
`98e3464ba86981b592c678d65b58eb10e747f9cb18a7b25cd6e697a2f27f6d89`. The final attestation then
failed closed because the receipt parser sorted the directory entries but compared them with the
unsorted list `intent-v1, completed-v1`. The files and the candidate runtime were valid; only that
comparison order was invalid.

H22 archives the installed H21 guard and the completed transition receipt byte-for-byte, publishes a
root-only provenance record, and atomically replaces only the guard with a parser that compares both
sides in canonical sorted order. It requires the exact H21 intent and completion hashes, exact
terminal transition hashes, exact candidate gateway image and Caddyfile, exact post-transition
production/shared-ingress/TLS fingerprints, unchanged canonical nine-service digest, and absent
staging and pilot projects. It cannot invoke Compose and contains no database or financial action.
The H22 preflight canonicalizes that nine-service digest by excluding both health-log history and
Docker's transient `ExecIDs` list, which is populated briefly while an ordinary health check runs;
all durable container configuration, state, mounts, and network identity remain fingerprinted.

Stage these two files from the exact merged H22 commit in a root-owned mode-`0700` directory named
`/root/fetanagent-h19-terminal-receipt-order-guard-bridge-v22-H22_MERGE_SHA/`:

```text
root:root 0700 fetanagent-h19-terminal-receipt-order-guard-bridge-v22.sh
root:root 0600 fetanagent-production-ingress-h19.next
```

Run the staged installer directly as root:

```text
fetanagent-h19-terminal-receipt-order-guard-bridge-v22.sh \
  H22_MERGE_SHA \
  SUCCESSOR_INGRESS_GUARD_SHA256 \
  d33d2e51852fabdfd8f750bfd16118fe987e8b4201483b1cc2f688063047d559 \
  sha256:443aac301bb8c26a51f7877a9cf016e8fd2101831c0cac6f59f7bd88a17189e8 \
  I-UNDERSTAND-THIS-CORRECTS-H19-TERMINAL-RECEIPT-ORDER-WITH-NO-PRODUCTION-OR-MONEY-MUTATION
```

The installer temporarily isolates the staging deployment grant and holds the shared mutation lock
while it seals and installs the guard-only correction. It restores the grant only after the new
guard's `inspect 90b1f059577682b6bc458d239f6bdcb591077085` mode independently accepts the existing
candidate and completed receipt. If interrupted, rerun the identical staged installer and arguments;
do not rerun the terminal gateway transition and do not edit either receipt.

## H23 exact no-money runtime re-attestation

On 12 September 2026, the approved guided Telegram bot release
`bcc479be0f2e807203df5612d380002fd6df2ee5` was installed independently and seven protected
services were recreated without changing their protected `69be82ac3e49` images or financial
configuration. The exact ten-service runtime remained healthy and no-money, but H22 correctly
rejected the changed bot revision, container identities, timestamps, and shared-network endpoint
fingerprint. Rewriting H19's terminal receipt or rolling the bot back cannot recover the original
container identities and is forbidden.

H23 preserves every H19-H22 file byte-for-byte and records one reviewed successor state instead. It
admits only the existing H19 candidate gateway, the approved bot image
`sha256:2f9e1af37575172eae8f31b302aca11bb1b807ac48d007fa14f8467c90fd73e3`, the other eight exact
protected releases, the exact healthy/security configuration, and these observed fingerprints:

- production boundary: `fc65828179bb1ff86b64a53b3aaca208f60e62e12bf9ccdb5f8f81606199bef5`;
- stable immutable nine-service boundary (excluding transient Docker `ExecIDs` and health logs):
  `0b5c68c61794dadb0098470829ce581e6d8f9eec5ffc57429a5d438f72d846d6`;
- shared ingress: `770077ec0bea920eeb2bff9970df0dd30b566a21c2f9b6fb13b209be51b677eb`;
- TLS leaf: `2c6bbb0eea676963398ea39a76ed974c2863da72236de67be761d19197dd7fd8`.

The H23 installer cannot invoke Compose. It validates all ten containers, both shared-ingress
members, the protected compose source, public negative probes, stopped staging projects, and the
disabled financial/executor/final-action flags before and after acquiring the shared mutation lock.
It then temporarily isolates the staging deployment grant, archives the H22 guard, publishes a
root-only intent, atomically installs only the successor guard, publishes completion, and restores
the grant only after the successor independently accepts the re-attested state. It does not restart
or recreate a container, touch a database, activate a transfer, or move money.

Stage these two files from the exact merged H23 commit in a root-owned mode-`0700` directory named
`/root/fetanagent-h19-runtime-reattest-guard-bridge-v23-H23_MERGE_SHA/`:

```text
root:root 0700 fetanagent-h19-runtime-reattest-guard-bridge-v23.sh
root:root 0600 fetanagent-production-ingress-h19.next
```

Run the staged installer directly as root:

```text
fetanagent-h19-runtime-reattest-guard-bridge-v23.sh \
  H23_MERGE_SHA \
  SUCCESSOR_INGRESS_GUARD_SHA256 \
  I-UNDERSTAND-THIS-REATTESTS-THE-EXACT-NO-MONEY-PRODUCTION-RUNTIME-WITHOUT-MUTATING-IT
```

If the process is interrupted, rerun the identical files and arguments. The staging grant remains
disabled while a new guard lacks its completed provenance record; do not edit or remove the H23
namespace, any predecessor evidence, or the installed guard.

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
node infra/verify-h19-canonical-cap-guard-bridge-v20.mjs
node infra/verify-h19-stable-nine-guard-bridge-v21.mjs
node infra/verify-h19-terminal-receipt-order-guard-bridge-v22.mjs
node infra/verify-h19-runtime-reattest-guard-bridge-v23.mjs
pnpm test:infra
pnpm lint
```

The H19 verifier binds every successor digest to the actual LF repository bytes, exercises all allowed
and rejected installation topologies, checks exact provenance field order and length, verifies the
two-state revision logic and image-ID binding, and rejects production-wide compose, database, or money
operations. The gateway routing suite separately executes the Caddy matcher matrix, including
duplicate-header and malformed-target adversarial cases.

The H20 verifier additionally binds all four corrected successor digests to repository bytes, binds
their predecessors to the exact terminal H19 chain, tests every allowed and rejected recovery
topology, requires immutable H19 evidence, and checks that the correction contains no production
container, database, provider, or money mutation.

The H21 verifier pins the successor guard to repository bytes, verifies the one-record legacy-to-
canonical digest bridge, checks deterministic health-log removal and mount/container ordering,
requires byte-for-byte preservation of the interrupted transition intent, and confirms the installer
contains no Compose, Supabase, database, or money action.

The H22 verifier binds the new guard to repository bytes, pins the H21 predecessor and completed H19
receipt, checks the canonical terminal-entry comparison, validates the guard-only transactional
ordering and exact 24-field intent, excludes transient health-check `ExecIDs` from its otherwise exact
nine-service preflight, and confirms the installer contains no Compose, Supabase, database,
production-runtime, or money action.

The H23 verifier binds the successor guard and exact approved bot/runtime fingerprints to repository
bytes, proves that H19-H22 remain immutable, checks the 27-field resumable guard-only transaction,
requires exact no-money and security flags for every service, and rejects Compose, Supabase,
database, production-runtime, or money actions in the installer.
