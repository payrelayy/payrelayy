# Manual staging beta container contract

`compose.staging-beta.yaml` is a deployment artifact for private beta admission plus pending
Player-ID registration. It does not run under the default Compose profile and it does not include a
worker, long-lived executor, maintenance process, public API host port, Docker socket, production project
reference, Player-ID validation, or a live financial/provider action path. Owner control retains
its VM-loopback binding. A secret-free HTTPS gateway exists only in the separate
`public-domain` profile and is governed by [`public-domain.md`](public-domain.md).

The only services are:

- `owner-control`, the server-authenticated invite issuer/revoker on VM loopback port 3002;
- `customer-web`, the authenticated customer workspace and dry-run proof intake on container port
  3003;
- `api`, an internal action-only service on container port 3000 which records admitted menu/input
  events and creates pending Player-ID requests;
- `beta-admission`, an internal HTTP service on container port 3001 with a `/readyz` healthcheck;
  and
- `bot`, exactly one Telegram long-polling process which waits for `beta-admission` readiness.
- `gateway`, a separately selected Caddy edge which serves the static FetanAgent landing page and
  proxies only authenticated Owner control. It cannot reach the API or beta-admission bridge.
- `kemerbet-session-provision`, a normally absent, separately profile-gated private sign-in browser
  built from the reviewed executor image. Credential entry is limited to ten minutes; the exact
  locked, authenticated browser can remain for at most twelve hours. It has no database, manifest,
  amount, settlement, or execution authority. For its one-time readiness seal only, it receives one
  identity HMAC key, the exact-five one-use Player list, reviewed selector v2, and an isolated output
  directory. It shares a private Unix-socket volume with Owner and one isolated persistent browser
  profile. Its route guard always blocks the exact deposit endpoint, locks manual input after the
  signed-in `/agents` page appears, and permits the seal to issue read-only lookups in that same
  in-memory authenticated Chromium process.

The five application images use the immutable Linux/amd64 Node base in the repository `Dockerfile`;
the gateway uses a separately pinned official Caddy image. Every service runs as numeric UID/GID
10001, uses a read-only root filesystem, prevents privilege escalation, and has PID, memory, and
CPU limits. Application services drop every Linux capability; the gateway adds only
`NET_BIND_SERVICE` so its non-root process can bind standard HTTPS ports. The two project-scoped bridges are IPv6-enabled
and permit outbound Internet access for the exact staging Supabase direct database endpoint and
Telegram HTTPS. The bot and admission service publish
no port; Owner control publishes only `127.0.0.1:3002`. The gateway publishes TCP 80/443 only after
the separate domain/firewall workflow is approved. Docker JSON logs are bounded to three 10 MiB
files per service.

## Locked feature boundary

Beta admission, the isolated Player-ID action channel, and the dedicated customer-web dry-run proof
intake are enabled. The action API may issue an "Add Player ID" capability and store a request with
status `pending`; the proof intake may store unverified provider-neutral v2 evidence for the staging
simulation. Neither path can verify a provider receipt, credit a Player ID, call KemerBet, collect a
withdrawal, or execute a payment. The older live customer-web deposit runtime, generic Telegram
ingress, nonce maintenance, the generic API PostgreSQL runtime, KemerBet execution, and final
KemerBet actions remain explicitly false. `FINANCIAL_ACTIONS_MODE` is fixed to `dry_run`.

This is not an authorization to start the profile. A later, explicit staging activation must first
review the commit, runtime credentials, startup preflight, and resulting rendered Compose model.

### Owner exact-five cohort import and claim freeze

The Owner-side readiness export is a one-use, exact-five bridge into the root helper. It creates the
fixed Player stage plus a fixed claim sidecar containing only a lowercase claim UUID. The root
helper never prints, logs, hashes into a receipt, or returns a Player ID. Its only app-readable
receipts are fixed aggregate UUID markers named `kemerbet-readiness-cohort-imported-v1`,
`kemerbet-readiness-cohort-completed-v1`, and retryable
`kemerbet-readiness-cohort-failed-v1`. These markers do not authorize a deposit, withdrawal, or
provider action. The recheck remains the existing lookup-only, transfer-blocked contract and does
not compare KemerBet balances or transaction history, so unrelated manual agent activity is not an
import failure signal.

The exact crash-recovery topology is:

- Before import, `kemerbet-readiness-player-ids.stage-v1` and
  `kemerbet-readiness-cohort-claim.stage-v1` are each UID/GID `10001:10001`, mode `0400`, and
  link-count one. The sidecar is exactly one lowercase UUID plus LF.
- The root journal `/var/lib/fetanagent/kemerbet-readiness-recheck-promotion/pending-v1` binds that
  UUID, both source device/inode identities, and the exact Player-stage SHA-256 before either source
  changes. That digest stays inside the root-only journal and helper process; it is never printed,
  logged, returned to the app, copied into an aggregate marker or public receipt, placed in a child
  process argument/environment, or exposed through `/proc/*/cmdline`. Descriptor helpers receive it
  only through an inherited root-process file descriptor. Import freezes
  both sources at `root:root`, mode `0444`, link-count one, durably prepares the private Player input,
  then publishes `kemerbet-readiness-cohort-imported-v1` as `root:10001`, mode `0440`, link-count
  one. Every freeze, promotion, restore, consume, and recovery step revalidates the journaled Player
  digest through an exact `O_NOFOLLOW` descriptor. During committed consumption recovery, imported
  may coexist with either frozen source already absent; it never makes a financial action live.
- A retryable failure restores both exact source inodes first to `10001:10001`, mode `0400`, removes
  imported, and publishes matching `kemerbet-readiness-cohort-failed-v1` last. The database claim
  stays active/exported and all claim source writes stay frozen; failed is not terminal.
- Success keeps the canonical candidate, sealed binding source, internal Player file, and both
  frozen Owner stages intact while it re-proves the reviewed release and image, exact profile digest,
  fresh no-transfer bot runtime, zero profile-volume holders, exactly one Owner-control stage
  producer, and no transient recheck container or network. Only then does it seal the root-only
  no-transfer receipt at `/var/lib/fetanagent/kemerbet-readiness-recheck/ready-v1`; that receipt plus
  the canonical binding and digest-bound journal is the durable success authority. Committed cleanup
  validates each exact open descriptor, unlinks its fixed pathname, synchronizes the parent
  directory, proves the pathname absent, and only afterward may best-effort wipe the already-unlinked
  descriptor. It never overwrites a reachable source. The helper re-proves the complete current
  release/image/profile/runtime/no-holder/singleton/no-transient boundary before publishing matching
  `kemerbet-readiness-cohort-completed-v1`, re-proves it again after publication, and retires the
  journal last. Completed therefore has no stage-file residue. If the host stops after any unlink,
  the receipt, canonical binding, journaled digest, and durable pathname absence reconstruct this
  same completed topology rather than retrying the browser probe.

Every aggregate marker contains only the same UUID plus LF and uses a fixed hidden installer that
the root journal can resume safely. An installer conflict, foreign UUID, symlink, hard link,
unexpected owner/mode, or conflicting final marker fails closed. Operators must not print a stage
file, marker UUID, journal digest, or binding digest during recovery.

An active database cohort claim intentionally freezes writes to every table from which its cohort
was derived, including otherwise unrelated customer/platform writes. That freeze begins before
export and remains through `prepared`/`exported`, an interrupted import, and retryable `failed-v1`.
It never auto-expires. Only reconciliation of the root-owned `completed-v1` marker may advance the
claim to success; only a separately reviewed root-certified terminal cleanup may release the frozen
membership. Operators must treat any active claim whose aggregate age exceeds the current
readiness-maintenance window as a stale-claim alert: check the authenticated Owner status card and
the root promotion journal/aggregate markers, then resume recovery. Never delete a claim, marker,
journal, or source-table lock merely because it is old, and never query or copy Player identifiers
for diagnosis.

The two singleton proofs are intentionally separate. Exactly one `owner-control` container is the
only accepted producer of the staged pair. While the private session container is live, the helper
also proves that `/var/lib/fetanagent/kemerbet-sessions` is mounted from the exact
`fetanagent-staging-beta_kemerbet_sessions` volume and that this container is its sole holder; the
holder set must be empty before and after the isolated recheck. Chromium singleton artifacts are
checked only inside the exact account directory (`$profile_mountpoint/$account_id/Singleton*`),
never at the profile-volume root. These checks do not read balance or transaction history and do not
change any provider state.

## External secret files

No secret value belongs in this repository, an `.env` file, a Compose environment value, an image,
or a command line. The operator must provide twenty service-separated secret files, two
independently approved immutable nonsecret profile files, and one verified public CA file outside
the checkout:

| Host-path selector                                                   | Mounted only into                | Container path                                                                            |
| -------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| `FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE`                 | owner-control                    | `/run/secrets/owner_control_database_url`                                                 |
| `FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE`     | owner-control                    | `/run/secrets/owner_control_supabase_publishable_key`                                     |
| `FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE`                | beta-admission                   | `/run/secrets/beta_admission_database_url`                                                |
| `FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE`              | beta-admission                   | `/run/secrets/beta_admission_bot_transport_hmac`                                          |
| `FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE`                | beta-admission                   | `/run/secrets/beta_admission_payload_hmac`                                                |
| `FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE`                 | api                              | `/run/secrets/player_action_database_url`                                                 |
| `FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE`           | api                              | `/run/secrets/api_player_action_transport_hmac`                                           |
| `FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE`             | api                              | `/run/secrets/api_player_action_payload_hmac`                                             |
| `FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE`          | api                              | `/run/secrets/api_player_action_capability_hmac`                                          |
| `FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE`            | api                              | `/run/secrets/api_player_action_semantic_hmac`                                            |
| `FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE`       | api                              | `/run/secrets/cbe_deposit_reference_encryption_key`                                       |
| `FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE`      | api                              | `/run/secrets/cbe_deposit_reference_fingerprint_key`                                      |
| `FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE`          | api                              | `/etc/fetanagent/cbe-deposit-reference-key-profile.v1.json`                               |
| `FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE`  | api, customer-web, owner-control | proof-v2 path; Owner target is `/run/secrets/owner_receiver_reference_encryption_master`  |
| `FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE` | api, customer-web, owner-control | proof-v2 path; Owner target is `/run/secrets/owner_receiver_reference_fingerprint_master` |
| `FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE`            | api, customer-web, owner-control | `/etc/fetanagent/deposit-proof-reference-profile.v2.json`                                 |
| `FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE`                    | all DB clients                   | `/run/configs/supabase_ca_certificate`                                                    |
| `FETANAGENT_STAGING_BOT_TOKEN_FILE`                                  | bot                              | `/run/secrets/telegram_bot_token`                                                         |
| `FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE`                         | bot                              | `/run/secrets/bot_beta_admission_transport_hmac`                                          |
| `FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE`           | bot                              | `/run/secrets/bot_player_action_transport_hmac`                                           |

The separately started `kemerbet-session-provision` profile uses four fixed, non-substitutable host
paths for its one-time no-transfer proof: mode-`0400` UID/GID-`10001` identity-key and exact-five
Player files under `/etc/fetanagent/executor-secrets`, the root-owned mode-`0444` reviewed selector
at `/etc/fetanagent/executor-config/kemerbet-selector-contract.v2.json`, and the UID/GID-`10001`
mode-`0700` output directory `/var/lib/fetanagent/kemerbet-readiness-seal-output`. The first three are
read-only mounts. The output directory is the only added writable bind, may contain only the
atomically created mode-`0600` binding file, and is never mounted into Owner control.

The two transport-HMAC files must contain the same independently generated 32-byte lowercase-hex
value, but they are intentionally separate host files and separate mounts. The bot cannot read the
beta service's copy and the beta service cannot read the bot's copy. Each database URL is visible
only to its owning service; the payload HMAC is beta-service-only, and the Telegram token is
bot-only. The CBE encryption and fingerprint files contain two distinct independently provisioned
32-byte lowercase-hex keys. Their version-1 profile is a separately approved nonsecret artifact
containing only the two `sha256:` key identities; ordinary deployment must never derive or replace
that profile from the current keys. Only the API receives the two version-1 key mounts and profile.
The provider-neutral v2 encryption and fingerprint roots are another two distinct independently
provisioned 32-byte lowercase-hex values. They must also differ from every password, HMAC, and v1
key. Their separately approved profile contains exactly `encryptionMasterFingerprint`,
`fingerprintMasterFingerprint`, and `version: 2`; ordinary deployment validates but never derives
or self-approves it. API and customer-web use the roots for proof v2. Owner control verifies the
same immutable root identities, then derives separate provider-bound receiver-account v1 keys; it
does not receive or use the proof-v2 protection routine.
Owner control is placed on a separate egress-capable bridge from the bot and admission service.

All four database URLs must use the staging project's exact IPv6 direct endpoint:
`db.spzpiyxheappsfyswewl.supabase.co:5432`, database `postgres`, and the bare dedicated username
`fetanagent_beta_admission_runtime`, `fetanagent_owner_control_runtime`, or
`fetanagent_player_actions_runtime`, or `fetanagent_customer_web_runtime`, with only
`sslmode=verify-full`. Session-pooler runtime URLs are rejected. GitHub workflows may continue using the IPv4 session pooler only for short-lived
administrator SQL because GitHub-hosted runners do not provide the VM's direct IPv6 path. Download
the staging project's CA from Supabase, verify its
fingerprint through the reviewed Supabase dashboard path, and provide that public certificate as
the CA file. Compose mounts it read-only and sets `NODE_EXTRA_CA_CERTS`; certificate verification
remains enabled.

Each secret source file must be owned by UID/GID 10001 and have mode `0400` before any container is
created. The public CA and both reference profiles must be owned by root, mode `0444`, and immutable
to the service account. All three configs are mounted as `0444`. The long Compose syntax repeats UID, GID, and
mode on every mount. Some non-Swarm Compose
implementations use a bind mount and may not enforce those attributes, so staging activation must
verify the source metadata and the mounted metadata rather than assuming the YAML changed it.

The application must support these exact file-valued variables before activation:

- beta-admission: `BETA_ADMISSION_DATABASE_URL_FILE`,
  `BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE`, and `BETA_ADMISSION_PAYLOAD_HMAC_SECRET_FILE`, with
  `NODE_EXTRA_CA_CERTS` fixed to the mounted verified CA path;
- bot: `TELEGRAM_BOT_TOKEN_FILE` and `BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE`;
- api: `PLAYER_ACTION_DATABASE_URL_FILE`, `BOT_TO_API_ACTION_HMAC_SECRET_FILE`,
  `API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET_FILE`,
  `API_TELEGRAM_CAPABILITY_HMAC_SECRET_FILE`, and
  `API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET_FILE`,
  `CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET_FILE`,
  `CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET_FILE`, and
  `CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE`, plus
  `DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE`,
  `DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE`, and
  `DEPOSIT_PROOF_REFERENCE_PROFILE_FILE` at their fixed production paths;
- bot additionally: `BOT_TO_API_ACTION_HMAC_SECRET_FILE`;
- owner-control: `OWNER_CONTROL_DATABASE_URL_FILE`,
  `OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE`,
  `OWNER_RECEIVER_REFERENCE_ENCRYPTION_MASTER_FILE`,
  `OWNER_RECEIVER_REFERENCE_FINGERPRINT_MASTER_FILE`, and
  `OWNER_RECEIVER_REFERENCE_PROFILE_FILE` at their fixed production paths. The Owner-specific
  names separate receiver rotation from the provider-proof runtime contract even though both
  domains are pinned to the same independently approved root profile. A Supabase service-role key
  is forbidden.
- customer-web: `CUSTOMER_WEB_DATABASE_URL_FILE`,
  `CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE`, and
  `CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET_FILE`, plus the same three provider-proof v2 file variables.
  `INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED=true` enables only the new proof
  intake; `INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=false` keeps the older live deposit runtime
  disabled while Auth, workspace, and the durable limiter run against staging only.

If any adapter is absent or accepts both a direct value and file value simultaneously, deployment is
blocked. Do not work around that condition by copying secret contents into ordinary environment
variables.

## Static validation

The repository verifier reads only the Dockerfile and Compose YAML; it does not contact Docker,
Supabase, GitHub, Telegram, or the VM:

```powershell
node infra/verify-staging-beta.mjs
```

It enforces the five private-service topology, separately gated secret-free gateway, normally
absent no-transfer sign-in tool, pinned architecture and build targets, hardening settings,
isolated file-secret set and browser volumes, network separation, disabled generic action/provider
gates, and absence of the production ref.

Before any separately approved build, set `FETANAGENT_VCS_REF` to the reviewed full commit SHA and
`FETANAGENT_IMAGE_TAG` to a commit-derived immutable local tag. Render only from a sealed checkout
that contains no `.env`/`.env.*` file and from a cleared process environment with no inherited
direct secret variable. Supply only the two non-secret image selectors, twenty external secret-file
selectors, the two immutable profile selectors, and the verified public CA path selector explicitly.
The future render must disable Compose's implicit checkout `.env` loading:

```bash
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  FETANAGENT_VCS_REF=<reviewed-full-commit> \
  FETANAGENT_IMAGE_TAG=<commit-derived-tag> \
  FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE=<external-path> \
  FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE=<external-path> \
  FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE=<external-path> \
  FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE=<external-path> \
  FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE=<external-path> \
  FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE=<external-path> \
  FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE=<external-path> \
  FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE=<external-path> \
  FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE=<approved-immutable-profile-path> \
  FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE=<external-path> \
  FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE=<external-path> \
  FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE=<approved-immutable-v2-profile-path> \
  FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE=<verified-external-path> \
  FETANAGENT_STAGING_BOT_TOKEN_FILE=<external-path> \
  FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE=<external-path> \
  docker compose --env-file /dev/null --profile staging-manual \
    -f infra/compose.staging-beta.yaml config
```

This renders configuration only. Do not use `docker compose up` without a new staging activation
approval.

## Guarded deployment workflow

Before the workflow can deploy, a separately approved maintenance window must enable DigitalOcean
IPv6 on the existing Droplet and configure the guest with its assigned address and default route.
That change requires a power cycle and is intentionally outside the deployment workflow; follow
[`operations/ipv6-direct-database-maintenance.md`](operations/ipv6-direct-database-maintenance.md).
The deployment helper fails before provisioning any runtime login unless the host has a global IPv6
address, an IPv6 default route, and resolves the exact direct staging database hostname.

An operator must also install the reviewed helper from the exact main
commit as `/usr/local/sbin/fetanagent-staging-deploy-helper` with `root:root` ownership and mode
`0755`. The dedicated `fetanagent-admin` account must be non-root, key-only, and granted
noninteractive sudo for that helper only. It must not receive `sudo bash`, direct `sudo docker`,
Docker-group membership, or Docker-socket access. The helper validates its own installed path,
ownership, invoking sudo identity, exact argument shapes, incoming file allowlist, image revision
labels, sealed service-file metadata, local Docker socket, and fixed Compose project. The workflow
checks its SHA-256 before every privileged operation, so an absent, stale, writable, or broader
helper fails closed.

### Exact helper replacement on the current staging Droplet

The VM-transition controller is permanently pinned to retired Droplet `590666364`; never run it on
current staging Droplet `593344964`. The current Droplet uses a separate, bounded root-console helper
replacement. Before publishing a commit that changes the helper, run `stop-and-disable` from the
currently deployed reviewed commit so the containers are stopped and all four disposable database
logins are disabled. Keep the runtime offline throughout replacement.

The current Droplet follows only the fresh-host commands (`fresh-host-ready`, `fresh-start`, and
`start-fresh-public-edge`). Those commands do not consume the retired Droplet's
`helper-rotation-v1` receipt. Do not create, copy, or update VM-transition receipts on Droplet
`593344964`; helper replacement and rollback there operate only on the exact checksummed helper
file and its root-only backup.

For this replacement only, the accepted predecessor and successor LF SHA-256 values are:

```text
installed_predecessor=af823251e2374b77898c813f5f7fe74e78280b69ba89d0b1dd0901b8851c8833
reviewed_successor=7861082f90020462583db3550a178960385dd88fd2ff60ebf1f243a1b88cd077
```

Extract the successor from a clean checkout of the exact reviewed `main` commit, verify it before
transfer, and stage those public script bytes through the root-console channel as the regular
`root:root` mode-`0600` file
`/root/fetanagent-helper-rotation/fetanagent-staging-deploy-helper.next`. Do not accept another
predecessor digest, fetch a moving branch, or put any credential in that directory.

```bash
C1='<exact-40-lowercase-reviewed-main-commit>'
NEXT_SHA='7861082f90020462583db3550a178960385dd88fd2ff60ebf1f243a1b88cd077'
[[ "$C1" =~ ^[0-9a-f]{40}$ ]]
git show "$C1:infra/operations/fetanagent-staging-deploy-helper.sh" > fetanagent-staging-deploy-helper.next
test "$(sha256sum fetanagent-staging-deploy-helper.next | awk '{ print $1 }')" = "$NEXT_SHA"
bash -n fetanagent-staging-deploy-helper.next
```

At the DigitalOcean root console, use only the fixed paths and hashes below. The installed
predecessor and successor share the same root-owned mutation-lock contract. The block atomically
moves the exact sudoers grant to an ignored same-filesystem name, validates sudoers with the grant
absent, proves no process has the helper path as an argument, and acquires that mutation lock before
the checked temporary file is atomically renamed. The grant remains absent throughout replacement.
The exact grant is restored only after the installed successor is verified; the held successor lock
then excludes a new privileged invocation until this root-console block exits. A mismatch or an
in-flight helper aborts without replacing the helper, and the EXIT trap restores the exact grant.
The backup is accepted only after proving it is the exact predecessor. The same block is resumable
after `SIGKILL` or host restart: it accepts exactly one validated enabled/disabled grant, only the
predecessor or successor TARGET hash, and only an absent or exact predecessor backup; it then
re-establishes quiescence and either completes or verifies the successor before restoring sudo.

```bash
bash -euo pipefail <<'FETANAGENT_HELPER_REPLACE'
TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
STAGING_ROOT='/root/fetanagent-helper-rotation'
STAGED="$STAGING_ROOT/fetanagent-staging-deploy-helper.next"
BACKUP="$STAGING_ROOT/fetanagent-staging-deploy-helper.previous-af823251"
RETAINED_B466_BACKUP="$STAGING_ROOT/fetanagent-staging-deploy-helper.previous-b4664efd"
RETAINED_33F4_BACKUP="$STAGING_ROOT/fetanagent-staging-deploy-helper.previous-33f4a5a4"
SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.rotation-disabled'
MUTATION_LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
MUTATION_LOCK="$MUTATION_LOCK_ROOT/mutation.lock"
PREVIOUS_SHA='af823251e2374b77898c813f5f7fe74e78280b69ba89d0b1dd0901b8851c8833'
NEXT_SHA='7861082f90020462583db3550a178960385dd88fd2ff60ebf1f243a1b88cd077'
RETAINED_B466_BACKUP_SHA='b4664efdbe3297b7b0ddee8122bf431608571e84dd0987892f58c20f48bdb663'
RETAINED_33F4_BACKUP_SHA='33f4a5a4ba56fa86aa34cdc9a899117d327ed06a58b3cb5d7e9453c28afad5ba'
METADATA='http://169.254.169.254/metadata/v1'
INSTALL_TMP=''
BACKUP_TMP=''
INSTALL_TMP_PATH='/usr/local/sbin/.fetanagent-staging-deploy-helper.installing-7861082f'
BACKUP_TMP_PATH="$STAGING_ROOT/.fetanagent-staging-deploy-helper.previous-af823251.installing"
SUDOERS_STATE=''
TARGET_SHA=''
expected_sudoers() {
  printf '%s\n' \
    'fetanagent-admin ALL=(root) NOPASSWD: /usr/local/sbin/fetanagent-staging-deploy-helper *'
}
require_exact_sudoers_file() {
  local path="$1"
  test ! -L "$path" && test -f "$path" || return 1
  test "$(realpath -- "$path")" = "$path" || return 1
  test "$(stat --format='%U:%G:%a:%h' "$path")" = 'root:root:440:1' || return 1
  cmp -s -- "$path" <(expected_sudoers) || return 1
}
require_no_helper_processes() {
  local arg cmdline found
  for cmdline in /proc/[0-9]*/cmdline; do
    [[ -r "$cmdline" ]] || continue
    found='false'
    while IFS= read -r -d '' arg; do
      if [[ "$arg" == "$TARGET" ]]; then
        found='true'
        break
      fi
    done <"$cmdline" || true
    [[ "$found" == 'false' ]] || return 1
  done
}
require_allowed_helper_for_sudoers_restore() {
  local helper_sha
  test ! -L "$TARGET" && test -f "$TARGET" || return 1
  test "$(realpath -- "$TARGET")" = "$TARGET" || return 1
  test "$(stat --format='%U:%G:%a:%h' "$TARGET")" = 'root:root:755:1' || return 1
  helper_sha="$(sha256sum "$TARGET" | awk '{ print $1 }')" || return 1
  [[ "$helper_sha" == "$PREVIOUS_SHA" || "$helper_sha" == "$NEXT_SHA" ]] || return 1
  bash -n "$TARGET" || return 1
}
restore_sudoers_grant() {
  if [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]]; then
    require_allowed_helper_for_sudoers_restore || return 1
    sync -f /etc/sudoers.d || return 1
    require_exact_sudoers_file "$SUDOERS" || return 1
    visudo -cf /etc/sudoers >/dev/null || return 1
    return 0
  fi
  require_allowed_helper_for_sudoers_restore || return 1
  require_exact_sudoers_file "$SUDOERS_DISABLED" || return 1
  test ! -e "$SUDOERS" && test ! -L "$SUDOERS" || return 1
  mv -- "$SUDOERS_DISABLED" "$SUDOERS" || return 1
  sync -f /etc/sudoers.d || return 1
  require_exact_sudoers_file "$SUDOERS" || return 1
  visudo -cf /etc/sudoers >/dev/null || return 1
}
restore_sudoers_on_exit() {
  local status=$?
  trap - EXIT
  if [[ -n "$INSTALL_TMP" ]]; then
    rm -f -- "$INSTALL_TMP" || status=1
  fi
  if [[ -n "$BACKUP_TMP" ]]; then
    rm -f -- "$BACKUP_TMP" || status=1
  fi
  restore_sudoers_grant || status=1
  exit "$status"
}
test "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 "$METADATA/id")" = '593344964'
test "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
  "$METADATA/interfaces/public/0/ipv4/address")" = '161.35.41.232'
test ! -L /etc/sudoers.d && test -d /etc/sudoers.d
test "$(realpath -- /etc/sudoers.d)" = '/etc/sudoers.d'
test "$(stat --format='%U:%G:%a' /etc/sudoers.d)" = 'root:root:750'
if [[ -e "$SUDOERS" || -L "$SUDOERS" ]]; then
  require_exact_sudoers_file "$SUDOERS"
  test ! -e "$SUDOERS_DISABLED" && test ! -L "$SUDOERS_DISABLED"
  SUDOERS_STATE='enabled'
elif [[ -e "$SUDOERS_DISABLED" || -L "$SUDOERS_DISABLED" ]]; then
  test ! -e "$SUDOERS" && test ! -L "$SUDOERS"
  require_exact_sudoers_file "$SUDOERS_DISABLED"
  SUDOERS_STATE='disabled'
else
  false
fi
visudo -cf /etc/sudoers >/dev/null
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.timer)" = 'not-found'
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.service)" = 'not-found'
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service
test -z "$(docker --host unix:///var/run/docker.sock container ls --all --quiet \
  --filter 'label=com.docker.compose.project=fetanagent-staging-beta')"
test ! -L "$STAGING_ROOT" && test "$(stat --format='%U:%G:%a' "$STAGING_ROOT")" = 'root:root:700'
test ! -L "$RETAINED_B466_BACKUP" && test -f "$RETAINED_B466_BACKUP"
test "$(realpath -- "$RETAINED_B466_BACKUP")" = "$RETAINED_B466_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_B466_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_B466_BACKUP" | awk '{ print $1 }')" = "$RETAINED_B466_BACKUP_SHA"
test ! -L "$RETAINED_33F4_BACKUP" && test -f "$RETAINED_33F4_BACKUP"
test "$(realpath -- "$RETAINED_33F4_BACKUP")" = "$RETAINED_33F4_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_33F4_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_33F4_BACKUP" | awk '{ print $1 }')" = "$RETAINED_33F4_BACKUP_SHA"
test ! -L "$TARGET" && test "$(stat --format='%U:%G:%a' "$TARGET")" = 'root:root:755'
TARGET_SHA="$(sha256sum "$TARGET" | awk '{ print $1 }')"
[[ "$TARGET_SHA" == "$PREVIOUS_SHA" || "$TARGET_SHA" == "$NEXT_SHA" ]]
test ! -L "$STAGED" && test "$(stat --format='%U:%G:%a' "$STAGED")" = 'root:root:600'
test "$(sha256sum "$STAGED" | awk '{ print $1 }')" = "$NEXT_SHA"
bash -n "$STAGED"
if [[ -e "$BACKUP" || -L "$BACKUP" ]]; then
  test ! -L "$BACKUP" && test -f "$BACKUP"
  test "$(realpath -- "$BACKUP")" = "$BACKUP"
  test "$(stat --format='%U:%G:%a:%h' "$BACKUP")" = 'root:root:600:1'
  test "$(sha256sum "$BACKUP" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
else
  test "$TARGET_SHA" = "$PREVIOUS_SHA"
fi
trap restore_sudoers_on_exit EXIT
if [[ "$SUDOERS_STATE" == 'enabled' ]]; then
  mv -- "$SUDOERS" "$SUDOERS_DISABLED"
fi
sync -f /etc/sudoers.d
require_exact_sudoers_file "$SUDOERS_DISABLED"
test ! -e "$SUDOERS" && test ! -L "$SUDOERS"
visudo -cf /etc/sudoers >/dev/null
require_no_helper_processes
test ! -L /run && test -d /run && test "$(realpath -- /run)" = '/run'
test "$(stat --format='%U:%G:%a' /run)" = 'root:root:755'
if [[ ! -e "$MUTATION_LOCK_ROOT" && ! -L "$MUTATION_LOCK_ROOT" ]]; then
  (umask 077 && mkdir --mode=0700 -- "$MUTATION_LOCK_ROOT")
fi
test ! -L "$MUTATION_LOCK_ROOT" && test -d "$MUTATION_LOCK_ROOT"
test "$(realpath -- "$MUTATION_LOCK_ROOT")" = "$MUTATION_LOCK_ROOT"
test "$(stat --format='%U:%G:%a' "$MUTATION_LOCK_ROOT")" = 'root:root:700'
if [[ ! -e "$MUTATION_LOCK" && ! -L "$MUTATION_LOCK" ]]; then
  (set -o noclobber; umask 077; : >"$MUTATION_LOCK") 2>/dev/null || true
fi
test ! -L "$MUTATION_LOCK" && test -f "$MUTATION_LOCK"
test "$(realpath -- "$MUTATION_LOCK")" = "$MUTATION_LOCK"
test "$(stat --format='%U:%G:%a:%h' "$MUTATION_LOCK")" = 'root:root:600:1'
exec 9<>"$MUTATION_LOCK"
path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")"
fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)"
test "$fd_identity" = "$path_identity"
case "$fd_identity" in 0:0:600:1:*) ;; *) false ;; esac
flock --exclusive --nonblock 9
test "$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")" = "$fd_identity"
require_no_helper_processes
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.timer)" = 'not-found'
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.service)" = 'not-found'
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service
test -z "$(docker --host unix:///var/run/docker.sock container ls --all --quiet \
  --filter 'label=com.docker.compose.project=fetanagent-staging-beta')"
test ! -L "$TARGET" && test "$(stat --format='%U:%G:%a' "$TARGET")" = 'root:root:755'
TARGET_SHA="$(sha256sum "$TARGET" | awk '{ print $1 }')"
[[ "$TARGET_SHA" == "$PREVIOUS_SHA" || "$TARGET_SHA" == "$NEXT_SHA" ]]
test "$(sha256sum "$STAGED" | awk '{ print $1 }')" = "$NEXT_SHA"
bash -n "$STAGED"
if [[ "$TARGET_SHA" == "$PREVIOUS_SHA" ]]; then
  if [[ ! -e "$BACKUP" && ! -L "$BACKUP" ]]; then
    if [[ -e "$BACKUP_TMP_PATH" || -L "$BACKUP_TMP_PATH" ]]; then
      test ! -L "$BACKUP_TMP_PATH" && test -f "$BACKUP_TMP_PATH"
      test "$(realpath -- "$BACKUP_TMP_PATH")" = "$BACKUP_TMP_PATH"
      test "$(stat --format='%U:%G:%h' "$BACKUP_TMP_PATH")" = 'root:root:1'
      rm -- "$BACKUP_TMP_PATH"
      sync -f "$STAGING_ROOT"
    fi
    test ! -e "$BACKUP_TMP_PATH" && test ! -L "$BACKUP_TMP_PATH"
    BACKUP_TMP="$BACKUP_TMP_PATH"
    install -o root -g root -m 0600 "$TARGET" "$BACKUP_TMP"
    test "$(stat --format='%U:%G:%a:%h' "$BACKUP_TMP")" = 'root:root:600:1'
    test "$(sha256sum "$BACKUP_TMP" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
    sync -f "$BACKUP_TMP"
    test ! -e "$BACKUP" && test ! -L "$BACKUP"
    mv -- "$BACKUP_TMP" "$BACKUP"
    BACKUP_TMP=''
    sync -f "$BACKUP"
    sync -f "$STAGING_ROOT"
  fi
  test ! -L "$BACKUP" && test -f "$BACKUP"
  test "$(stat --format='%U:%G:%a:%h' "$BACKUP")" = 'root:root:600:1'
  test "$(sha256sum "$BACKUP" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
  if [[ -e "$INSTALL_TMP_PATH" || -L "$INSTALL_TMP_PATH" ]]; then
    test ! -L "$INSTALL_TMP_PATH" && test -f "$INSTALL_TMP_PATH"
    test "$(realpath -- "$INSTALL_TMP_PATH")" = "$INSTALL_TMP_PATH"
    test "$(stat --format='%U:%G:%h' "$INSTALL_TMP_PATH")" = 'root:root:1'
    rm -- "$INSTALL_TMP_PATH"
    sync -f "$(dirname -- "$TARGET")"
  fi
  test ! -e "$INSTALL_TMP_PATH" && test ! -L "$INSTALL_TMP_PATH"
  INSTALL_TMP="$INSTALL_TMP_PATH"
  install -o root -g root -m 0755 "$STAGED" "$INSTALL_TMP"
  test "$(stat --format='%U:%G:%a:%h' "$INSTALL_TMP")" = 'root:root:755:1'
  test "$(sha256sum "$INSTALL_TMP" | awk '{ print $1 }')" = "$NEXT_SHA"
  sync -f "$INSTALL_TMP"
  mv -- "$INSTALL_TMP" "$TARGET"
  INSTALL_TMP=''
  sync -f "$(dirname -- "$TARGET")"
else
  test ! -L "$BACKUP" && test -f "$BACKUP"
  test "$(stat --format='%U:%G:%a:%h' "$BACKUP")" = 'root:root:600:1'
  test "$(sha256sum "$BACKUP" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
fi
test "$(stat --format='%U:%G:%a' "$TARGET")" = 'root:root:755'
test "$(sha256sum "$TARGET" | awk '{ print $1 }')" = "$NEXT_SHA"
require_no_helper_processes
restore_sudoers_grant
trap - EXIT
FETANAGENT_HELPER_REPLACE
```

Then dispatch only `transition-ssh-verify` from the same exact reviewed `main` commit. It must pass
against successor SHA `7861082f…` before `deploy-and-smoke` is allowed. If it fails, keep staging
offline and use the root console to atomically restore only the checksum-proven `previous` file.
Rollback follows the same sudoers-revocation and exact process-quiescence boundary, verifies the
restored predecessor before re-enabling its grant, and makes no further mutation afterward. It is
also resumable with the exact disabled grant and either allowed TARGET hash, but only while the
strict rollback shape remains compatible with predecessor `af823251`: the complete promotion and
receipt roots, recheck candidate root, canonical binding, fixed Player-ID import candidate, every
Owner cohort stage/installer/aggregate marker, and every profile singleton must all be absent. The
identity key may be either the exact service-readable file or the exact root-frozen file left by the
bounded recheck. The predecessor requires the exact service-readable one-use Player-ID file and the
exact still-sealed readiness output/binding; absence is not a rollback-compatible pre-recheck state:

```bash
bash -euo pipefail <<'FETANAGENT_HELPER_RESTORE'
TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
BACKUP='/root/fetanagent-helper-rotation/fetanagent-staging-deploy-helper.previous-af823251'
RETAINED_B466_BACKUP='/root/fetanagent-helper-rotation/fetanagent-staging-deploy-helper.previous-b4664efd'
RETAINED_33F4_BACKUP='/root/fetanagent-helper-rotation/fetanagent-staging-deploy-helper.previous-33f4a5a4'
SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.rotation-disabled'
MUTATION_LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
MUTATION_LOCK="$MUTATION_LOCK_ROOT/mutation.lock"
RECHECK_PROMOTION_ROOT='/var/lib/fetanagent/kemerbet-readiness-recheck-promotion'
RECHECK_RECEIPT_ROOT='/var/lib/fetanagent/kemerbet-readiness-recheck'
RECHECK_CANDIDATE_ROOT='/etc/fetanagent/executor-secrets/.kemerbet-readiness-recheck-candidate'
CANONICAL_BINDING='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_bindings'
IMPORT_CANDIDATE='/etc/fetanagent/executor-secrets/.kemerbet-readiness-player-ids.promote-v1'
IDENTITY_KEY='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_hmac_key'
PLAYER_IDS='/etc/fetanagent/executor-secrets/kemerbet_no_transfer_readiness_player_ids'
READINESS_OUTPUT_ROOT='/var/lib/fetanagent/kemerbet-readiness-seal-output'
READINESS_BINDING="$READINESS_OUTPUT_ROOT/kemerbet_agent_identity_bindings"
SESSION_CONTROL_VOLUME='fetanagent-staging-beta_kemerbet_session_control'
PROFILE_VOLUME='fetanagent-staging-beta_kemerbet_sessions'
PREVIOUS_SHA='af823251e2374b77898c813f5f7fe74e78280b69ba89d0b1dd0901b8851c8833'
NEXT_SHA='7861082f90020462583db3550a178960385dd88fd2ff60ebf1f243a1b88cd077'
RETAINED_B466_BACKUP_SHA='b4664efdbe3297b7b0ddee8122bf431608571e84dd0987892f58c20f48bdb663'
RETAINED_33F4_BACKUP_SHA='33f4a5a4ba56fa86aa34cdc9a899117d327ed06a58b3cb5d7e9453c28afad5ba'
METADATA='http://169.254.169.254/metadata/v1'
RESTORE_TMP=''
RESTORE_TMP_PATH='/usr/local/sbin/.fetanagent-staging-deploy-helper.restoring-af823251'
SUDOERS_STATE=''
TARGET_SHA=''
require_pre_recheck_rollback_state() {
  local account_id absent_path binding_fingerprint binding_line binding_residue control_mountpoint
  local identity_key_metadata profile_mountpoint profile_path root_entries volume_name
  for absent_path in \
    "$RECHECK_PROMOTION_ROOT" \
    "$RECHECK_RECEIPT_ROOT" \
    "$RECHECK_CANDIDATE_ROOT" \
    "$CANONICAL_BINDING" \
    "$IMPORT_CANDIDATE"; do
    [[ ! -e "$absent_path" && ! -L "$absent_path" ]] || return 1
  done
  [[ ! -L "$IDENTITY_KEY" && -f "$IDENTITY_KEY" ]] || return 1
  [[ "$(realpath -- "$IDENTITY_KEY")" == "$IDENTITY_KEY" ]] || return 1
  identity_key_metadata="$(stat --format='%u:%g:%a:%h' "$IDENTITY_KEY")" || return 1
  [[ "$identity_key_metadata" == '10001:10001:400:1' ||
    "$identity_key_metadata" == '0:0:444:1' ]] || return 1
  [[ ! -L "$PLAYER_IDS" && -f "$PLAYER_IDS" && "$(realpath -- "$PLAYER_IDS")" == "$PLAYER_IDS" &&
    "$(stat --format='%u:%g:%a:%h' "$PLAYER_IDS")" == '10001:10001:400:1' ]] || return 1
  [[ ! -L "$READINESS_OUTPUT_ROOT" && -d "$READINESS_OUTPUT_ROOT" &&
    "$(realpath -- "$READINESS_OUTPUT_ROOT")" == "$READINESS_OUTPUT_ROOT" &&
    "$(stat --format='%u:%g:%a' "$READINESS_OUTPUT_ROOT")" == '10001:10001:700' ]] || return 1
  [[ "$(find -P "$READINESS_OUTPUT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" == \
    'kemerbet_agent_identity_bindings' ]] || return 1
  [[ ! -L "$READINESS_BINDING" && -f "$READINESS_BINDING" &&
    "$(realpath -- "$READINESS_BINDING")" == "$READINESS_BINDING" &&
    "$(stat --format='%u:%g:%a:%h' "$READINESS_BINDING")" == '10001:10001:600:1' ]] || return 1
  [[ "$(wc -l <"$READINESS_BINDING")" == '1' ]] || return 1
  LC_ALL=C grep -Eq \
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:[0-9a-f]{64}$' \
    "$READINESS_BINDING" || return 1
  binding_line="$(<"$READINESS_BINDING")"
  IFS=' ' read -r account_id binding_fingerprint binding_residue <<<"$binding_line"
  [[ -n "$account_id" && -n "$binding_fingerprint" && -z "$binding_residue" ]] || return 1
  volume_name="$(docker --host unix:///var/run/docker.sock volume ls --quiet \
    --filter 'label=com.docker.compose.project=fetanagent-staging-beta' \
    --filter 'label=com.docker.compose.volume=kemerbet_session_control')" || return 1
  [[ "$volume_name" == "$SESSION_CONTROL_VOLUME" ]] || return 1
  [[ "$(docker --host unix:///var/run/docker.sock volume inspect "$volume_name" \
    --format '{{.Name}}|{{.Driver}}|{{.Scope}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.volume" }}')" == \
    "$SESSION_CONTROL_VOLUME|local|local|fetanagent-staging-beta|kemerbet_session_control" ]] || return 1
  control_mountpoint="$(docker --host unix:///var/run/docker.sock volume inspect \
    "$volume_name" --format '{{.Mountpoint}}')" || return 1
  [[ "$control_mountpoint" == /* && ! -L "$control_mountpoint" && -d "$control_mountpoint" &&
    "$(realpath -- "$control_mountpoint")" == "$control_mountpoint" &&
    "$(stat --format='%u:%g:%a' "$control_mountpoint")" == '10001:10001:700' ]] || return 1
  for absent_path in \
    kemerbet-readiness-player-ids.stage-v1 \
    .kemerbet-readiness-player-ids.stage-v1.installing \
    kemerbet-readiness-cohort-claim.stage-v1 \
    .kemerbet-readiness-cohort-claim.stage-v1.installing \
    kemerbet-readiness-cohort-imported-v1 \
    .kemerbet-readiness-cohort-imported-v1.installing \
    kemerbet-readiness-cohort-completed-v1 \
    .kemerbet-readiness-cohort-completed-v1.installing \
    kemerbet-readiness-cohort-failed-v1 \
    .kemerbet-readiness-cohort-failed-v1.installing; do
    [[ ! -e "$control_mountpoint/$absent_path" && ! -L "$control_mountpoint/$absent_path" ]] || return 1
  done
  volume_name="$(docker --host unix:///var/run/docker.sock volume ls --quiet \
    --filter 'label=com.docker.compose.project=fetanagent-staging-beta' \
    --filter 'label=com.docker.compose.volume=kemerbet_sessions')" || return 1
  [[ "$volume_name" == "$PROFILE_VOLUME" ]] || return 1
  [[ "$(docker --host unix:///var/run/docker.sock volume inspect "$volume_name" \
    --format '{{.Name}}|{{.Driver}}|{{.Scope}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.volume" }}')" == \
    "$PROFILE_VOLUME|local|local|fetanagent-staging-beta|kemerbet_sessions" ]] || return 1
  profile_mountpoint="$(docker --host unix:///var/run/docker.sock volume inspect \
    "$volume_name" --format '{{.Mountpoint}}')" || return 1
  [[ "$profile_mountpoint" == /* && ! -L "$profile_mountpoint" && -d "$profile_mountpoint" &&
    "$(realpath -- "$profile_mountpoint")" == "$profile_mountpoint" &&
    "$(stat --format='%u:%g:%a' "$profile_mountpoint")" == '10001:10001:700' ]] || return 1
  root_entries="$(find -P "$profile_mountpoint" -mindepth 1 -maxdepth 1 -printf '%f\n')" || return 1
  [[ "$root_entries" == "$account_id" ]] || return 1
  profile_path="$profile_mountpoint/$account_id"
  [[ ! -L "$profile_path" && -d "$profile_path" && "$(realpath -- "$profile_path")" == "$profile_path" &&
    "$(stat --format='%u:%g:%a' "$profile_path")" == '10001:10001:700' ]] || return 1
  for absent_path in SingletonCookie SingletonLock SingletonSocket; do
    [[ ! -e "$profile_path/$absent_path" && ! -L "$profile_path/$absent_path" ]] || return 1
  done
}
expected_sudoers() {
  printf '%s\n' \
    'fetanagent-admin ALL=(root) NOPASSWD: /usr/local/sbin/fetanagent-staging-deploy-helper *'
}
require_exact_sudoers_file() {
  local path="$1"
  test ! -L "$path" && test -f "$path" || return 1
  test "$(realpath -- "$path")" = "$path" || return 1
  test "$(stat --format='%U:%G:%a:%h' "$path")" = 'root:root:440:1' || return 1
  cmp -s -- "$path" <(expected_sudoers) || return 1
}
require_no_helper_processes() {
  local arg cmdline found
  for cmdline in /proc/[0-9]*/cmdline; do
    [[ -r "$cmdline" ]] || continue
    found='false'
    while IFS= read -r -d '' arg; do
      if [[ "$arg" == "$TARGET" ]]; then
        found='true'
        break
      fi
    done <"$cmdline" || true
    [[ "$found" == 'false' ]] || return 1
  done
}
require_allowed_helper_for_sudoers_restore() {
  local helper_sha
  test ! -L "$TARGET" && test -f "$TARGET" || return 1
  test "$(realpath -- "$TARGET")" = "$TARGET" || return 1
  test "$(stat --format='%U:%G:%a:%h' "$TARGET")" = 'root:root:755:1' || return 1
  helper_sha="$(sha256sum "$TARGET" | awk '{ print $1 }')" || return 1
  [[ "$helper_sha" == "$PREVIOUS_SHA" || "$helper_sha" == "$NEXT_SHA" ]] || return 1
  bash -n "$TARGET" || return 1
}
restore_sudoers_grant() {
  if [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]]; then
    require_allowed_helper_for_sudoers_restore || return 1
    require_pre_recheck_rollback_state || return 1
    sync -f /etc/sudoers.d || return 1
    require_exact_sudoers_file "$SUDOERS" || return 1
    visudo -cf /etc/sudoers >/dev/null || return 1
    return 0
  fi
  require_allowed_helper_for_sudoers_restore || return 1
  require_pre_recheck_rollback_state || return 1
  require_exact_sudoers_file "$SUDOERS_DISABLED" || return 1
  test ! -e "$SUDOERS" && test ! -L "$SUDOERS" || return 1
  mv -- "$SUDOERS_DISABLED" "$SUDOERS" || return 1
  sync -f /etc/sudoers.d || return 1
  require_exact_sudoers_file "$SUDOERS" || return 1
  visudo -cf /etc/sudoers >/dev/null || return 1
}
restore_sudoers_on_exit() {
  local status=$?
  trap - EXIT
  if [[ -n "$RESTORE_TMP" ]]; then
    rm -f -- "$RESTORE_TMP" || status=1
  fi
  restore_sudoers_grant || status=1
  exit "$status"
}
test "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 "$METADATA/id")" = '593344964'
test "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
  "$METADATA/interfaces/public/0/ipv4/address")" = '161.35.41.232'
test ! -L /etc/sudoers.d && test -d /etc/sudoers.d
test "$(realpath -- /etc/sudoers.d)" = '/etc/sudoers.d'
test "$(stat --format='%U:%G:%a' /etc/sudoers.d)" = 'root:root:750'
if [[ -e "$SUDOERS" || -L "$SUDOERS" ]]; then
  require_exact_sudoers_file "$SUDOERS"
  test ! -e "$SUDOERS_DISABLED" && test ! -L "$SUDOERS_DISABLED"
  SUDOERS_STATE='enabled'
elif [[ -e "$SUDOERS_DISABLED" || -L "$SUDOERS_DISABLED" ]]; then
  test ! -e "$SUDOERS" && test ! -L "$SUDOERS"
  require_exact_sudoers_file "$SUDOERS_DISABLED"
  SUDOERS_STATE='disabled'
else
  false
fi
visudo -cf /etc/sudoers >/dev/null
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.timer)" = 'not-found'
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.service)" = 'not-found'
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service
test -z "$(docker --host unix:///var/run/docker.sock container ls --all --quiet \
  --filter 'label=com.docker.compose.project=fetanagent-staging-beta')"
test ! -L "$RETAINED_B466_BACKUP" && test -f "$RETAINED_B466_BACKUP"
test "$(realpath -- "$RETAINED_B466_BACKUP")" = "$RETAINED_B466_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_B466_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_B466_BACKUP" | awk '{ print $1 }')" = "$RETAINED_B466_BACKUP_SHA"
test ! -L "$RETAINED_33F4_BACKUP" && test -f "$RETAINED_33F4_BACKUP"
test "$(realpath -- "$RETAINED_33F4_BACKUP")" = "$RETAINED_33F4_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_33F4_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_33F4_BACKUP" | awk '{ print $1 }')" = "$RETAINED_33F4_BACKUP_SHA"
test ! -L "$TARGET" && test "$(stat --format='%U:%G:%a' "$TARGET")" = 'root:root:755'
TARGET_SHA="$(sha256sum "$TARGET" | awk '{ print $1 }')"
[[ "$TARGET_SHA" == "$PREVIOUS_SHA" || "$TARGET_SHA" == "$NEXT_SHA" ]]
test ! -L "$BACKUP" && test -f "$BACKUP"
test "$(realpath -- "$BACKUP")" = "$BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$BACKUP" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
require_pre_recheck_rollback_state
trap restore_sudoers_on_exit EXIT
if [[ "$SUDOERS_STATE" == 'enabled' ]]; then
  mv -- "$SUDOERS" "$SUDOERS_DISABLED"
fi
sync -f /etc/sudoers.d
require_exact_sudoers_file "$SUDOERS_DISABLED"
test ! -e "$SUDOERS" && test ! -L "$SUDOERS"
visudo -cf /etc/sudoers >/dev/null
require_no_helper_processes
test ! -L /run && test -d /run && test "$(realpath -- /run)" = '/run'
test "$(stat --format='%U:%G:%a' /run)" = 'root:root:755'
if [[ ! -e "$MUTATION_LOCK_ROOT" && ! -L "$MUTATION_LOCK_ROOT" ]]; then
  (umask 077 && mkdir --mode=0700 -- "$MUTATION_LOCK_ROOT")
fi
test ! -L "$MUTATION_LOCK_ROOT" && test -d "$MUTATION_LOCK_ROOT"
test "$(realpath -- "$MUTATION_LOCK_ROOT")" = "$MUTATION_LOCK_ROOT"
test "$(stat --format='%U:%G:%a' "$MUTATION_LOCK_ROOT")" = 'root:root:700'
if [[ ! -e "$MUTATION_LOCK" && ! -L "$MUTATION_LOCK" ]]; then
  (set -o noclobber; umask 077; : >"$MUTATION_LOCK") 2>/dev/null || true
fi
test ! -L "$MUTATION_LOCK" && test -f "$MUTATION_LOCK"
test "$(realpath -- "$MUTATION_LOCK")" = "$MUTATION_LOCK"
test "$(stat --format='%U:%G:%a:%h' "$MUTATION_LOCK")" = 'root:root:600:1'
exec 9<>"$MUTATION_LOCK"
path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")"
fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)"
test "$fd_identity" = "$path_identity"
case "$fd_identity" in 0:0:600:1:*) ;; *) false ;; esac
flock --exclusive --nonblock 9
test "$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")" = "$fd_identity"
require_no_helper_processes
require_pre_recheck_rollback_state
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.timer)" = 'not-found'
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.service)" = 'not-found'
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service
test -z "$(docker --host unix:///var/run/docker.sock container ls --all --quiet \
  --filter 'label=com.docker.compose.project=fetanagent-staging-beta')"
test ! -L "$TARGET" && test "$(stat --format='%U:%G:%a' "$TARGET")" = 'root:root:755'
TARGET_SHA="$(sha256sum "$TARGET" | awk '{ print $1 }')"
[[ "$TARGET_SHA" == "$PREVIOUS_SHA" || "$TARGET_SHA" == "$NEXT_SHA" ]]
test ! -L "$BACKUP" && test -f "$BACKUP"
test "$(realpath -- "$BACKUP")" = "$BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$BACKUP" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
if [[ "$TARGET_SHA" == "$NEXT_SHA" ]]; then
  if [[ -e "$RESTORE_TMP_PATH" || -L "$RESTORE_TMP_PATH" ]]; then
    test ! -L "$RESTORE_TMP_PATH" && test -f "$RESTORE_TMP_PATH"
    test "$(realpath -- "$RESTORE_TMP_PATH")" = "$RESTORE_TMP_PATH"
    test "$(stat --format='%U:%G:%h' "$RESTORE_TMP_PATH")" = 'root:root:1'
    rm -- "$RESTORE_TMP_PATH"
    sync -f "$(dirname -- "$TARGET")"
  fi
  test ! -e "$RESTORE_TMP_PATH" && test ! -L "$RESTORE_TMP_PATH"
  RESTORE_TMP="$RESTORE_TMP_PATH"
  install -o root -g root -m 0755 "$BACKUP" "$RESTORE_TMP"
  test "$(stat --format='%U:%G:%a:%h' "$RESTORE_TMP")" = 'root:root:755:1'
  test "$(sha256sum "$RESTORE_TMP" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
  sync -f "$RESTORE_TMP"
  mv -- "$RESTORE_TMP" "$TARGET"
  RESTORE_TMP=''
  sync -f "$(dirname -- "$TARGET")"
fi
test "$(stat --format='%U:%G:%a' "$TARGET")" = 'root:root:755'
test "$(sha256sum "$TARGET" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
require_no_helper_processes
restore_sudoers_grant
trap - EXIT
FETANAGENT_HELPER_RESTORE
```

Do not hand-edit the installed helper or bypass its checksum gate. After read-only verification
succeeds, remove only the staged `.next` file. Retain all three versioned predecessor backups: the
new `fetanagent-staging-deploy-helper.previous-af823251` backup and the independently verified
existing `fetanagent-staging-deploy-helper.previous-b4664efd` and
`fetanagent-staging-deploy-helper.previous-33f4a5a4` evidence. Never overwrite or delete either
older backup during this rotation. This is a one-successor replacement, not ongoing credential
rotation and not authority to enable financial actions.

The protected `staging` environment must hold these deploy inputs before `deploy-and-smoke` or
`stop-and-disable` is selected. The permanent read-only `transition-ssh-verify` mode and the guarded
`transition-stop-legacy` mode use only the three `STAGING_VM_*` SSH inputs. Never paste any
protected value into a task, repository file, workflow input, or VM command line.

| Protected environment input                         | Required boundary                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SUPABASE_ACCESS_TOKEN`                             | Supabase Management API token; ban-list reads in deploy, and exact-IP removal only in explicit unban mode                      |
| `SUPABASE_DB_PASSWORD`                              | staging database administrator password                                                                                        |
| `SUPABASE_CA_CERTIFICATE_PEM`                       | verified staging database CA PEM                                                                                               |
| `BETA_ADMISSION_RUNTIME_PASSWORD`                   | independent 32-byte lowercase hex                                                                                              |
| `OWNER_CONTROL_RUNTIME_PASSWORD`                    | different independent 32-byte lowercase hex                                                                                    |
| `PLAYER_ACTION_RUNTIME_PASSWORD`                    | different independent 32-byte lowercase hex                                                                                    |
| `BOT_TO_BETA_ADMISSION_HMAC_SECRET`                 | independent 32-byte lowercase hex                                                                                              |
| `BETA_ADMISSION_PAYLOAD_HMAC_SECRET`                | different independent 32-byte lowercase hex                                                                                    |
| `BOT_TO_API_ACTION_HMAC_SECRET`                     | distinct 32-byte lowercase hex; shared bot/API value                                                                           |
| `API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET`    | distinct 32-byte lowercase hex                                                                                                 |
| `API_TELEGRAM_CAPABILITY_HMAC_SECRET`               | distinct 32-byte lowercase hex                                                                                                 |
| `API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET`          | distinct 32-byte lowercase hex                                                                                                 |
| `CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET`           | distinct 32-byte lowercase hex; retain for decrypts                                                                            |
| `CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET`          | distinct 32-byte lowercase hex; stable blind index                                                                             |
| `CBE_DEPOSIT_REFERENCE_KEY_PROFILE_V1_JSON`         | protected nonsecret variable; independently approved exact v1 profile                                                          |
| `DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET`  | distinct 32-byte lowercase hex provider-neutral v2 root; retain for decrypts                                                   |
| `DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET` | distinct 32-byte lowercase hex provider-neutral v2 blind-index root                                                            |
| `DEPOSIT_PROOF_REFERENCE_PROFILE_V2_JSON`           | protected nonsecret variable; independently approved exact v2 profile                                                          |
| `STAGING_TELEGRAM_BOT_TOKEN`                        | reserved for the separate bot activation and smoke workflow; the fresh-host deploy writes an invalid disabled sentinel instead |
| `STAGING_TELEGRAM_BOT_TOKEN_SHA256`                 | protected nonsecret variable; SHA-256 fingerprint approved only after a fresh BotFather rotation                               |
| `STAGING_SUPABASE_PUBLISHABLE_KEY`                  | staging publishable key; never `service_role`                                                                                  |
| `STAGING_VM_HOST`                                   | exact approved staging VM host                                                                                                 |
| `STAGING_VM_KNOWN_HOSTS`                            | pinned OpenSSH known-hosts entry                                                                                               |
| `STAGING_VM_SSH_PRIVATE_KEY`                        | dedicated non-root deployment identity private key                                                                             |

The four runtime passwords, all independently purposed HMAC values, the two v1 keys, and the two v2
roots must differ. Keep each reference-protection pair and its separately approved profile stable
for records of that version; rotate only through a reviewed key-version migration. The workflow
validates and materializes both protected profile values without computing either from secret
material. API startup machine-checks both profiles, and customer-web startup machine-checks the v2
profile. The VM key must
authenticate only the non-root `fetanagent-admin` identity. The historical BotFather token shown in
an earlier screenshot is compromised and must never be reused.

`Staging beta deploy and smoke` starts only when manually dispatched from the exact reviewed `main`
commit with the staging project ref and DigitalOcean droplet ID typed back. `plan`
only builds the five commit-labelled images. `transition-ssh-verify` checks out that exact commit,
derives the reviewed helper SHA-256, and uses the protected private key and strict pinned
`known_hosts` entry to connect as non-root `fetanagent-admin`. It invokes only the helper's
checksum-verifying `verify` command: it does not stop a runtime, access the database, run Compose,
transfer a release, or alter VM state.

`transition-stop-legacy` is a one-way transition boundary. Freeze `main` at the final post-merge SHA
through this sequence: first the separate `transition-ssh-verify` run for that SHA must pass, then
the root-console transition `acknowledge` and `verify` commands for the same SHA must both pass.
Only then may the stop mode be dispatched.
The stop dispatch must repeat that full SHA, the staging project ref, and the staging Droplet ID, and
must type the exact irreversible confirmation `stop-legacy-staging-runtime`. In one strict,
pinned-host SSH session as the literal legacy non-root administrator named in the transition
runbook, it runs only the legacy helper's fixed-digest `verify` followed by `stop`. It does not access
the database, run Docker or Compose directly, transfer a release, impersonate root, use the
FetanAgent helper, or write the root-only transition receipt. A successful job means only that the
old helper reported a successful stop. Immediately return to the already-open root console and run
`mark-legacy-stopped` with the same SHA, then `verify`; keep staging offline until both pass. If the
workflow fails or the root-console checks do not pass, do not deploy, migrate, restore the old
runtime, or claim that the boundary is sealed.

`deploy-and-smoke` additionally requires the
protected `staging` environment, a dedicated `fetanagent-admin` SSH identity with noninteractive
sudo access only to the root-owned `/usr/local/sbin/fetanagent-staging-deploy-helper`, pinned
`known_hosts`, the public Supabase client key, and four distinct narrow database passwords. It does
not read the Telegram token; it always installs the invalid
`telegram-disabled-until-separate-smoke` sentinel and starts only Owner-control, customer-web, API,
and beta-admission. It rejects root SSH and fails if the installed helper checksum differs from the
reviewed repository helper.

`deploy-and-smoke` does not accept an operator-authored stop deadline. Immediately after provisioning,
it reads only the four exact staging roles' `rolvaliduntil` values through the protected administrator
connection. All four roles must exist, be login-enabled, have finite expiries within the expected
24-hour window, and differ by no more than ten seconds. The workflow derives one canonical UTC stop
time exactly two hours before the earliest expiry. It transfers no database password or administrator
credential to the VM for this control.

Before any long-lived container starts, the checksum-verified root helper installs and enables a
fixed, root-owned systemd service and persistent timer for that derived time. The timer survives a VM
reboot, stops only the exact `fetanagent-staging-beta` Compose project, removes its runtime secret
files, and retries once per minute without a start limit if the stop fails. The helper permits the
timer-only `expiry-stop` path only for a systemd service invocation with its fixed guard marker; the
deployment identity cannot invoke that path directly. Any ordinary helper `stop` also removes the
timer. If deriving or arming the timer fails, activation does not start and the workflow disables all
four logins. A cancellation after provisioning also runs the same bounded VM stop/disarm and database
login cleanup; cancellation before provisioning has no runtime login to remove. This is an automatic
stop-before-expiry boundary, not credential rotation or continuous availability: staging intentionally
goes offline about 22 hours after each successful deployment and must be redeployed with new
disposable credentials to resume.

DigitalOcean Droplet `593344964` has the exact current public IPv6 address
`2a03:b0c0:1:e0:0:1:a8b4:2001`. It is the only address this workflow may remove from Supabase's
temporary network-ban list. In deploy mode, the workflow first stops any prior staging project and
disables its old logins, proves the empty host and direct IPv6 route, and then reads the current ban
list without modifying it. An unavailable or malformed ban list fails closed. If the exact Droplet
address is listed, deployment stops before any new runtime password is provisioned; deploy mode does
not unban an address.

Use this stop/check/unban-before-redeploy process after that failure:

1. Keep staging stopped. Do not restore the old runtime, retry its database connection, or rerun
   `deploy-and-smoke` while the exact address remains banned.
2. Dispatch `unban-and-connectivity-check` from the same exact reviewed `main` commit, typing back the
   staging project ref and Droplet ID. That explicit mode validates the current list, removes only
   `2a03:b0c0:1:e0:0:1:a8b4:2001` when it is present, and performs one protected read-only
   administrator connectivity check. It never removes every ban or another address.
3. Only after that mode passes, dispatch `deploy-and-smoke` again. A successful unban check does not
   itself start staging or provision a runtime credential.

Deployment gives the beta-admission, customer-web, Owner-control, and Player-ID action roles 24-hour
staging LOGIN credentials, installs service-separated `0400` files, and then creates four disposable
`--no-deps` preflight containers. Each connects through the direct IPv6 endpoint and proves the
dedicated catalog and privilege contract before any long-lived container starts. The helper removes
each preflight container. A preflight may make at most three strict read-only attempts, 15 seconds
apart, to tolerate a transient direct-database connection failure; it never relaxes a catalog
assertion or starts another service during those attempts. Only after all four preflights pass does
it start the private Compose project without building on the VM. The post-start gate proves the
exact `dry_run`/false financial environment, the customer-web proof-only gate, fixed v2 file paths,
and the running API process's redacted in-memory v2 runtime contract through an exact-container,
loopback-only health request, plus health and readiness, without submitting a payment or provider
request. The gate does not depend on an aging startup-log tail. Missing, mismatched, or inline v2
material fails closed. Failure disables all four logins. If the administrator
cleanup connection is temporarily refused after a failed activation, the workflow makes at most
four cleanup attempts, 15 seconds apart, and then fails visibly rather than claiming cleanup.
`stop-and-disable` remains the explicit immediate cleanup mode. Independently, the host-local timer
stops the containers and deletes their runtime secret files two hours before the earliest 24-hour
login expiry, preventing expired-password reconnect loops from causing another temporary network
ban. The database roles remain unused until they expire naturally; an explicit stop disables them
immediately. The workflow does not support in-place runtime-password rotation. A successful
deployment is a time-bounded beta demo, not financial launch approval; all payment,
provider, validation, deposit, withdrawal, and KemerBet execution gates remain off.

`Staging Telegram bot activation and smoke` is the only supported fresh-host bot boundary. Run it
only after the private deployment passes on the same exact `main` commit. A fresh BotFather token
must replace the compromised historical token, and its independently recorded
`STAGING_TELEGRAM_BOT_TOKEN_SHA256` value must match before the workflow contacts Telegram. The
workflow accepts only the exact `fetanagentbot` identity, requires no webhook and zero pending
updates, and refuses to mutate or clear Telegram's queue. It then proves that exactly the four
reviewed private services are healthy and Telegram-disabled, transfers the token through the pinned
non-root SSH identity, installs it as a `10001:10001` mode-`0400` service file, and starts only the
bot container without dependencies or builds. Readiness requires the exact reviewed revision, zero
container restarts, genuine bot startup output, `FINANCIAL_ACTIONS_MODE=dry_run`, and both KemerBet
flags false. Successful immediate readiness atomically seals a root-owned receipt bound to the exact
reviewed commit, full bot container identity, start time, and zero restart count. Later public-edge
gates require that receipt to match the same running container, so they do not depend on an aging
startup-log tail and cannot accept a recreated or unverified bot. A failed activation removes the bot
and restores the invalid sentinel. The explicit
`stop-and-disable` mode performs the same fail-closed removal without stopping the four private
services.

If activation fails, the root-owned helper reports only the Owner-control container state and at
most 80 startup-log lines for the exact reviewed image before rollback removes the container. The
Owner-control logger redacts request headers, bodies, tokens, invite URLs, and passwords; this
diagnostic must remain bounded to the loopback-only Owner-control service and must run before the
count-only database session diagnostic. Rollback clears PostgreSQL's statistics snapshot after
terminating sessions so its final zero-session assertion observes the current catalog state rather
than a transaction-local stale snapshot.

## Private Owner page and first-Owner gate

The Owner-control service retains its existing VM-loopback binding. Before the public-domain stage,
use an approved SSH local-forward to `127.0.0.1:3002`. After the separately gated HTTPS workflow
passes, the only supported public route is `https://owner.fetanagent.com/owner` through the reviewed
gateway; port 3002 itself remains unpublished. The page has a fixed content-security policy, receives only the staging
publishable key as public configuration, signs in against the exact staging Auth origin, and keeps
the short-lived access token in memory only. A rotating refresh token and the fixed twelve-hour
deadline are kept only in tab-scoped session storage so a same-tab reload restores the session;
explicit sign-out or closing the tab removes that restorable session. The one-time invite receipt
is never persisted and is discarded by a reload.

Before sign-in can authorize an invite, one confirmed staging Supabase Auth user must be converted
to the first active Owner by the manual `Staging first Owner bootstrap` workflow. Create that Auth
user privately in Supabase; only its UUID belongs in the workflow input. Run `inspect` before
`bootstrap`, confirm the exact staging ref and `main` commit, and use the required one-time phrase.
The workflow must not receive an email, password, display name, access token, or service-role key.

## Synthetic deposit receiver

The manual `Staging synthetic receiver setup` workflow may configure only the fixed CBE Birr
simulation receiver `FETANAGENT STAGING SIMULATION - DO NOT PAY` with masked value `****TEST` and
the customer message `SIMULATION ONLY — DO NOT SEND MONEY.` Run `inspect` first, then use
`configure` only from the exact reviewed `main` commit with the staging ref, active Owner Auth UUID,
and confirmation phrase. The workflow rejects production, refuses to replace an unknown or real
active receiver, checks that all seven financial/provider/pilot feature switches remain disabled,
calls the ungranted legacy synthetic-only Owner procedure, and verifies the result afterward. It accepts no account
number, receiver name, transaction reference, provider credential, or payment secret.

This setup enables only the deposit-intake simulation and protected reference-storage demo. It does
not contact CBE Birr, verify a payment, submit anything to KemerBet, or authorize a tester to send
money.

## Protected runtime preflight

The manual `Staging beta runtime preflight` GitHub workflow is inspection-only. It uses the IPv4
session pooler as the PostgreSQL administrator solely to prove that the beta role remains disabled
and narrow; it cannot provision a password or invoke an application preflight. The guarded deploy
workflow is the only path that may provision the four time-limited staging logins, and their actual
read-only application preflights run on the IPv6-capable VM. Both workflows require the exact full
`main` commit and staging project reference and reject production. Neither inspection nor preflight
enables a payment/provider feature.
