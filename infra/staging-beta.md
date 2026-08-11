# Manual staging beta container contract

`compose.staging-beta.yaml` is a deployment artifact for private beta admission plus pending
Player-ID registration. It does not run under the default Compose profile and it does not include a
worker, executor, maintenance process, reverse proxy, public API host port, Docker socket,
production project reference, Player-ID validation, or a live financial/provider action path.
Owner control binds only VM loopback for access through an authenticated SSH tunnel.

The only services are:

- `owner-control`, the server-authenticated invite issuer/revoker on VM loopback port 3002;
- `api`, an internal action-only service on container port 3000 which records admitted menu/input
  events and creates pending Player-ID requests;
- `beta-admission`, an internal HTTP service on container port 3001 with a `/readyz` healthcheck;
  and
- `bot`, exactly one Telegram long-polling process which waits for `beta-admission` readiness.

All four images use the immutable Linux/amd64 Node base in the repository `Dockerfile`, run as numeric
UID/GID 10001, use a read-only root filesystem, drop every Linux capability, prevent privilege
escalation, and have PID, memory, and CPU limits. The private project-scoped bridge permits outbound
Internet access for staging Supabase TLS and Telegram HTTPS. The bot and admission service publish
no port; Owner control publishes only `127.0.0.1:3002`. Docker JSON logs are bounded to three 10 MiB
files per service.

## Locked feature boundary

Only beta admission and the isolated Player-ID action channel are enabled. The action API may issue
an "Add Player ID" capability and store a request with status `pending`; it cannot validate the ID,
call KemerBet, open a deposit, collect a withdrawal, or execute a payment. Generic Telegram ingress,
nonce maintenance, the generic API PostgreSQL runtime, KemerBet execution, and final KemerBet
actions remain explicitly false. `FINANCIAL_ACTIONS_MODE` is fixed to `dry_run`.

This is not an authorization to start the profile. A later, explicit staging activation must first
review the commit, runtime credentials, startup preflight, and resulting rendered Compose model.

## External secret files

No secret value belongs in this repository, an `.env` file, a Compose environment value, an image,
or a command line. The operator must provide thirteen service-separated input files and one verified
public CA file outside the checkout:

| Host-path selector                                               | Mounted only into | Container path                                        |
| ---------------------------------------------------------------- | ----------------- | ----------------------------------------------------- |
| `PAYREPLAYY_STAGING_OWNER_CONTROL_DATABASE_URL_FILE`             | owner-control     | `/run/secrets/owner_control_database_url`             |
| `PAYREPLAYY_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE` | owner-control     | `/run/secrets/owner_control_supabase_publishable_key` |
| `PAYREPLAYY_STAGING_BETA_ADMISSION_DATABASE_URL_FILE`            | beta-admission    | `/run/secrets/beta_admission_database_url`            |
| `PAYREPLAYY_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE`          | beta-admission    | `/run/secrets/beta_admission_bot_transport_hmac`      |
| `PAYREPLAYY_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE`            | beta-admission    | `/run/secrets/beta_admission_payload_hmac`            |
| `PAYREPLAYY_STAGING_PLAYER_ACTION_DATABASE_URL_FILE`             | api               | `/run/secrets/player_action_database_url`             |
| `PAYREPLAYY_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE`       | api               | `/run/secrets/api_player_action_transport_hmac`       |
| `PAYREPLAYY_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE`         | api               | `/run/secrets/api_player_action_payload_hmac`         |
| `PAYREPLAYY_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE`      | api               | `/run/secrets/api_player_action_capability_hmac`      |
| `PAYREPLAYY_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE`        | api               | `/run/secrets/api_player_action_semantic_hmac`        |
| `PAYREPLAYY_STAGING_SUPABASE_CA_CERTIFICATE_FILE`                | all DB clients    | `/run/configs/supabase_ca_certificate`                |
| `PAYREPLAYY_STAGING_BOT_TOKEN_FILE`                              | bot               | `/run/secrets/telegram_bot_token`                     |
| `PAYREPLAYY_STAGING_BOT_TRANSPORT_HMAC_FILE`                     | bot               | `/run/secrets/bot_beta_admission_transport_hmac`      |
| `PAYREPLAYY_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE`       | bot               | `/run/secrets/bot_player_action_transport_hmac`       |

The two transport-HMAC files must contain the same independently generated 32-byte lowercase-hex
value, but they are intentionally separate host files and separate mounts. The bot cannot read the
beta service's copy and the beta service cannot read the bot's copy. Each database URL is visible
only to its owning service; the payload HMAC is beta-service-only, and the Telegram token is
bot-only. Owner control is placed on a separate egress-capable bridge from the bot and admission
service.

Both database URLs must use the staging project's IPv4 session pooler exactly:
`aws-1-eu-west-1.pooler.supabase.com:5432`, database `postgres`, username
`payreplayy_beta_admission_runtime.spzpiyxheappsfyswewl` or
`payreplayy_owner_control_runtime.spzpiyxheappsfyswewl`, or
`payreplayy_player_actions_runtime.spzpiyxheappsfyswewl`, and only
`sslmode=verify-full`. The free project's direct database endpoint is IPv6-only and is deliberately
rejected by this staging service. Download the staging project's CA from Supabase, verify its
fingerprint through the reviewed Supabase dashboard path, and provide that public certificate as
the CA file. Compose mounts it read-only and sets `NODE_EXTRA_CA_CERTS`; certificate verification
remains enabled.

Each secret source file must be owned by UID/GID 10001 and have mode `0400` before any container is
created. The public CA must be immutable to the service account and mounted as `0444`. The long
Compose syntax repeats UID, GID, and mode on every mount. Some non-Swarm Compose
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
  `API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET_FILE`;
- bot additionally: `BOT_TO_API_ACTION_HMAC_SECRET_FILE`;
- owner-control: `OWNER_CONTROL_DATABASE_URL_FILE` and
  `OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE`; a Supabase service-role key is forbidden.

If any adapter is absent or accepts both a direct value and file value simultaneously, deployment is
blocked. Do not work around that condition by copying secret contents into ordinary environment
variables.

## Static validation

The repository verifier reads only the Dockerfile and Compose YAML; it does not contact Docker,
Supabase, GitHub, Telegram, or the VM:

```powershell
node infra/verify-staging-beta.mjs
```

It enforces the four-service topology, manual profile, pinned architecture and build targets,
hardening settings, isolated file-secret set, private egress-capable network, loopback-only Owner
access, disabled generic action/provider gates, and absence of public ingress or the production ref.

Before any separately approved build, set `PAYREPLAYY_VCS_REF` to the reviewed full commit SHA and
`PAYREPLAYY_IMAGE_TAG` to a commit-derived immutable local tag. Render only from a sealed checkout
that contains no `.env`/`.env.*` file and from a cleared process environment with no inherited
direct secret variable. Supply only the two non-secret image selectors, thirteen external
service-input selectors, and the verified public CA path selector explicitly. The future render must
disable Compose's implicit checkout `.env` loading:

```bash
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  PAYREPLAYY_VCS_REF=<reviewed-full-commit> \
  PAYREPLAYY_IMAGE_TAG=<commit-derived-tag> \
  PAYREPLAYY_STAGING_OWNER_CONTROL_DATABASE_URL_FILE=<external-path> \
  PAYREPLAYY_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE=<external-path> \
  PAYREPLAYY_STAGING_BETA_ADMISSION_DATABASE_URL_FILE=<external-path> \
  PAYREPLAYY_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE=<external-path> \
  PAYREPLAYY_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE=<external-path> \
  PAYREPLAYY_STAGING_PLAYER_ACTION_DATABASE_URL_FILE=<external-path> \
  PAYREPLAYY_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE=<external-path> \
  PAYREPLAYY_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE=<external-path> \
  PAYREPLAYY_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE=<external-path> \
  PAYREPLAYY_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE=<external-path> \
  PAYREPLAYY_STAGING_SUPABASE_CA_CERTIFICATE_FILE=<verified-external-path> \
  PAYREPLAYY_STAGING_BOT_TOKEN_FILE=<external-path> \
  PAYREPLAYY_STAGING_BOT_TRANSPORT_HMAC_FILE=<external-path> \
  PAYREPLAYY_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE=<external-path> \
  docker compose --env-file /dev/null --profile staging-manual \
    -f infra/compose.staging-beta.yaml config
```

This renders configuration only. Do not use `docker compose up` without a new staging activation
approval.

## Guarded deployment workflow

Before the workflow can deploy, an operator must install the reviewed helper from the exact main
commit as `/usr/local/sbin/payreplayy-staging-deploy-helper` with `root:root` ownership and mode
`0755`. The dedicated `payreplayy-admin` account must be non-root, key-only, and granted
noninteractive sudo for that helper only. It must not receive `sudo bash`, direct `sudo docker`,
Docker-group membership, or Docker-socket access. The helper validates its own installed path,
ownership, invoking sudo identity, exact argument shapes, incoming file allowlist, image revision
labels, sealed service-file metadata, local Docker socket, and fixed Compose project. The workflow
checks its SHA-256 before every privileged operation, so an absent, stale, writable, or broader
helper fails closed.

The protected `staging` environment must hold these deploy inputs before `deploy-and-smoke` or
`stop-and-disable` is selected. Never paste their values into a task, repository file, workflow
input, or VM command line.

| Environment secret                               | Required boundary                                    |
| ------------------------------------------------ | ---------------------------------------------------- |
| `SUPABASE_DB_PASSWORD`                           | staging database administrator password              |
| `SUPABASE_CA_CERTIFICATE_PEM`                    | verified staging database CA PEM                     |
| `BETA_ADMISSION_RUNTIME_PASSWORD`                | independent 32-byte lowercase hex                    |
| `OWNER_CONTROL_RUNTIME_PASSWORD`                 | different independent 32-byte lowercase hex          |
| `PLAYER_ACTION_RUNTIME_PASSWORD`                 | different independent 32-byte lowercase hex          |
| `BOT_TO_BETA_ADMISSION_HMAC_SECRET`              | independent 32-byte lowercase hex                    |
| `BETA_ADMISSION_PAYLOAD_HMAC_SECRET`             | different independent 32-byte lowercase hex          |
| `BOT_TO_API_ACTION_HMAC_SECRET`                  | distinct 32-byte lowercase hex; shared bot/API value |
| `API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET` | distinct 32-byte lowercase hex                       |
| `API_TELEGRAM_CAPABILITY_HMAC_SECRET`            | distinct 32-byte lowercase hex                       |
| `API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET`       | distinct 32-byte lowercase hex                       |
| `STAGING_TELEGRAM_BOT_TOKEN`                     | newly rotated staging-only BotFather token           |
| `STAGING_SUPABASE_PUBLISHABLE_KEY`               | staging publishable key; never `service_role`        |
| `STAGING_VM_HOST`                                | exact approved staging VM host                       |
| `STAGING_VM_KNOWN_HOSTS`                         | pinned OpenSSH known-hosts entry                     |
| `STAGING_VM_SSH_PRIVATE_KEY`                     | dedicated non-root deployment identity private key   |

The three runtime passwords and all independently purposed HMAC values must differ. The VM key must authenticate only
the non-root `payreplayy-admin` identity. The historical BotFather token shown in an earlier
screenshot is compromised and must never be reused.

`Staging beta deploy and smoke` is manual-only and dormant unless dispatched from the exact
reviewed `main` commit with the staging project ref and DigitalOcean droplet ID typed back. `plan`
only builds the four commit-labelled images. `deploy-and-smoke` additionally requires the
protected `staging` environment, a dedicated `payreplayy-admin` SSH identity with noninteractive
sudo access only to the root-owned `/usr/local/sbin/payreplayy-staging-deploy-helper`, pinned
`known_hosts`, a rotated staging bot token, the public Supabase client key, and three distinct narrow
database passwords. It rejects root SSH and fails if the installed helper checksum differs from the
reviewed repository helper.

Deployment gives the beta-admission, Owner-control, and Player-ID action roles 24-hour staging
LOGIN credentials,
waits once for 125 seconds before any release transfer or container activation so the shared
Supavisor credential cache can observe the rotated passwords, makes one read-only identity preflight
through each dedicated runtime login, installs service-separated `0400` files, starts the private
Compose project without building on the VM, and checks readiness without submitting a payment or
provider request. It does not make rapid runtime authentication retries during or after the
propagation interval. Failure disables all three logins. If the administrator cleanup connection is
temporarily refused after a failed activation, the workflow makes at most four cleanup attempts,
15 seconds apart, and then fails visibly rather than claiming cleanup. `stop-and-disable` is the explicit cleanup mode
and must be run before the 24-hour login expiry; credential expiry does not itself stop the
containers. A successful deployment is a beta demo, not financial launch approval; all payment,
provider, validation, deposit, withdrawal, and KemerBet execution gates remain off.

If activation fails, the root-owned helper reports only the Owner-control container state and at
most 80 startup-log lines for the exact reviewed image before rollback removes the container. The
Owner-control logger redacts request headers, bodies, tokens, invite URLs, and passwords; this
diagnostic must remain bounded to the loopback-only Owner-control service and must run before the
count-only database session diagnostic. Rollback clears PostgreSQL's statistics snapshot after
terminating sessions so its final zero-session assertion observes the current catalog state rather
than a transaction-local stale snapshot.

## Private Owner page and first-Owner gate

The Owner-control service serves `/owner` only on its existing VM-loopback binding. Use an approved
SSH local-forward to `127.0.0.1:3002`; never publish that port, add a reverse proxy, or browse via the
droplet's public address. The page has a fixed content-security policy, receives only the staging
publishable key as public configuration, signs in against the exact staging Auth origin, and keeps
the short-lived access token in memory only. Closing or refreshing the page discards the token and
the one-time invite receipt.

Before sign-in can authorize an invite, one confirmed staging Supabase Auth user must be converted
to the first active Owner by the manual `Staging first Owner bootstrap` workflow. Create that Auth
user privately in Supabase; only its UUID belongs in the workflow input. Run `inspect` before
`bootstrap`, confirm the exact staging ref and `main` commit, and use the required one-time phrase.
The workflow must not receive an email, password, display name, access token, or service-role key.

## Protected runtime preflight

The manual `Staging beta runtime preflight` GitHub workflow is the read-only inspection path for the
beta-admission database login. The guarded deployment workflow separately provisions three narrow
staging logins for at most 24 hours. Both workflows are restricted to `main`, the protected `staging`
environment, the exact staging project reference, and the approved IPv4 session pooler. The
preflight never starts a container, contacts Telegram, enables a payment/provider feature, or
targets production.

The protected `staging` environment must contain these additional values before
`provision-and-preflight` is selected:

| Environment secret                   | Required shape                                |
| ------------------------------------ | --------------------------------------------- |
| `SUPABASE_CA_CERTIFICATE_PEM`        | verified, unexpired staging project CA in PEM |
| `BETA_ADMISSION_RUNTIME_PASSWORD`    | independently generated 32-byte lowercase hex |
| `BOT_TO_BETA_ADMISSION_HMAC_SECRET`  | independently generated 32-byte lowercase hex |
| `BETA_ADMISSION_PAYLOAD_HMAC_SECRET` | distinct independently generated 32-byte hex  |

`SUPABASE_DB_PASSWORD` remains the existing staging administrator credential used only for the
guarded role alteration. The workflow does not read `SUPABASE_ACCESS_TOKEN` and never prints any
secret value.

Run `inspect` first. The provision mode gives the dedicated login a one-hour password validity and
runs the beta service's catalog-only read-only preflight through TLS `verify-full`. It waits once for
125 seconds after password rotation before making the single runtime authentication attempt. This
bounded interval accommodates the shared Supavisor credential cache and circuit-breaker window
without rapid authentication retries. After every provisioning attempt, whether the preflight
passes or fails, the workflow disables LOGIN, clears its password, terminates runtime sessions, and
clears PostgreSQL's cached statistics snapshot before asserting that no runtime session remains. An
abruptly terminated runner still leaves the provisional password expiring within one hour. A later
deployment workflow must provision the runtime credential atomically with the reviewed service
deployment rather than leave an unused LOGIN enabled. Both modes require the operator to confirm
the exact full `main` commit SHA. This workflow does not authorize starting the staging Compose
profile.
