# Manual staging beta container contract

`compose.staging-beta.yaml` is a deployment artifact for the private beta-admission slice only. It
does not run under the default Compose profile and it does not include the API, worker, executor,
maintenance process, reverse proxy, public host port, Docker socket, production project reference,
or a live financial/provider action path. Owner control binds only VM loopback for access through
an authenticated SSH tunnel.

The only services are:

- `owner-control`, the server-authenticated invite issuer/revoker on VM loopback port 3002;
- `beta-admission`, an internal HTTP service on container port 3001 with a `/readyz` healthcheck;
  and
- `bot`, exactly one Telegram long-polling process which waits for `beta-admission` readiness.

All three images use the immutable Linux/amd64 Node base in the repository `Dockerfile`, run as numeric
UID/GID 10001, use a read-only root filesystem, drop every Linux capability, prevent privilege
escalation, and have PID, memory, and CPU limits. The private project-scoped bridge permits outbound
Internet access for staging Supabase TLS and Telegram HTTPS. The bot and admission service publish
no port; Owner control publishes only `127.0.0.1:3002`. Docker JSON logs are bounded to three 10 MiB
files per service.

## Locked feature boundary

Only the beta-admission service gate and the bot's beta-admission transport are enabled. Generic API
Telegram ingress, private ingress composition, action channels, action capabilities, nonce
maintenance, API PostgreSQL runtime, KemerBet execution, and final KemerBet actions remain explicitly
false in both services. `FINANCIAL_ACTIONS_MODE` is fixed to `dry_run`.

This is not an authorization to start the profile. A later, explicit staging activation must first
review the commit, runtime credentials, startup preflight, and resulting rendered Compose model.

## External secret files

No secret value belongs in this repository, an `.env` file, a Compose environment value, an image,
or a command line. The operator must provide seven service-separated input files and one verified
public CA file outside the checkout:

| Host-path selector                                               | Mounted only into | Container path                                        |
| ---------------------------------------------------------------- | ----------------- | ----------------------------------------------------- |
| `PAYREPLAYY_STAGING_OWNER_CONTROL_DATABASE_URL_FILE`             | owner-control     | `/run/secrets/owner_control_database_url`             |
| `PAYREPLAYY_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE` | owner-control     | `/run/secrets/owner_control_supabase_publishable_key` |
| `PAYREPLAYY_STAGING_BETA_ADMISSION_DATABASE_URL_FILE`            | beta-admission    | `/run/secrets/beta_admission_database_url`            |
| `PAYREPLAYY_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE`          | beta-admission    | `/run/secrets/beta_admission_bot_transport_hmac`      |
| `PAYREPLAYY_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE`            | beta-admission    | `/run/secrets/beta_admission_payload_hmac`            |
| `PAYREPLAYY_STAGING_SUPABASE_CA_CERTIFICATE_FILE`                | both DB clients   | `/run/configs/supabase_ca_certificate`                |
| `PAYREPLAYY_STAGING_BOT_TOKEN_FILE`                              | bot               | `/run/secrets/telegram_bot_token`                     |
| `PAYREPLAYY_STAGING_BOT_TRANSPORT_HMAC_FILE`                     | bot               | `/run/secrets/bot_beta_admission_transport_hmac`      |

The two transport-HMAC files must contain the same independently generated 32-byte lowercase-hex
value, but they are intentionally separate host files and separate mounts. The bot cannot read the
beta service's copy and the beta service cannot read the bot's copy. Each database URL is visible
only to its owning service; the payload HMAC is beta-service-only, and the Telegram token is
bot-only. Owner control is placed on a separate egress-capable bridge from the bot and admission
service.

Both database URLs must use the staging project's IPv4 session pooler exactly:
`aws-1-eu-west-1.pooler.supabase.com:5432`, database `postgres`, username
`payreplayy_beta_admission_runtime.spzpiyxheappsfyswewl` or
`payreplayy_owner_control_runtime.spzpiyxheappsfyswewl`, and only
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

It enforces the three-service topology, manual profile, pinned architecture and build targets,
hardening settings, isolated file-secret set, private egress-capable network, loopback-only Owner
access, disabled generic action/provider gates, and absence of public ingress or the production ref.

Before any separately approved build, set `PAYREPLAYY_VCS_REF` to the reviewed full commit SHA and
`PAYREPLAYY_IMAGE_TAG` to a commit-derived immutable local tag. Render only from a sealed checkout
that contains no `.env`/`.env.*` file and from a cleared process environment with no inherited
direct secret variable. Supply only the two non-secret image selectors, seven external
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
  PAYREPLAYY_STAGING_SUPABASE_CA_CERTIFICATE_FILE=<verified-external-path> \
  PAYREPLAYY_STAGING_BOT_TOKEN_FILE=<external-path> \
  PAYREPLAYY_STAGING_BOT_TRANSPORT_HMAC_FILE=<external-path> \
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

| Environment secret                   | Required boundary                                  |
| ------------------------------------ | -------------------------------------------------- |
| `SUPABASE_DB_PASSWORD`               | staging database administrator password            |
| `SUPABASE_CA_CERTIFICATE_PEM`        | verified staging database CA PEM                   |
| `BETA_ADMISSION_RUNTIME_PASSWORD`    | independent 32-byte lowercase hex                  |
| `OWNER_CONTROL_RUNTIME_PASSWORD`     | different independent 32-byte lowercase hex        |
| `BOT_TO_BETA_ADMISSION_HMAC_SECRET`  | independent 32-byte lowercase hex                  |
| `BETA_ADMISSION_PAYLOAD_HMAC_SECRET` | different independent 32-byte lowercase hex        |
| `STAGING_TELEGRAM_BOT_TOKEN`         | newly rotated staging-only BotFather token         |
| `STAGING_SUPABASE_PUBLISHABLE_KEY`   | staging publishable key; never `service_role`      |
| `STAGING_VM_HOST`                    | exact approved staging VM host                     |
| `STAGING_VM_KNOWN_HOSTS`             | pinned OpenSSH known-hosts entry                   |
| `STAGING_VM_SSH_PRIVATE_KEY`         | dedicated non-root deployment identity private key |

The two runtime passwords and two HMAC values must all differ. The VM key must authenticate only
the non-root `payreplayy-admin` identity. The historical BotFather token shown in an earlier
screenshot is compromised and must never be reused.

`Staging beta deploy and smoke` is manual-only and dormant unless dispatched from the exact
reviewed `main` commit with the staging project ref and DigitalOcean droplet ID typed back. `plan`
only builds the three commit-labelled images. `deploy-and-smoke` additionally requires the
protected `staging` environment, a dedicated `payreplayy-admin` SSH identity with noninteractive
sudo access only to the root-owned `/usr/local/sbin/payreplayy-staging-deploy-helper`, pinned
`known_hosts`, a rotated staging bot token, the public Supabase client key, and two distinct narrow
database passwords. It rejects root SSH and fails if the installed helper checksum differs from the
reviewed repository helper.

Deployment gives the beta-admission and Owner-control roles 24-hour staging LOGIN credentials,
installs service-separated `0400` files, starts the private Compose project without building on the
VM, and checks readiness without submitting a payment or provider request. Failure disables both
logins. `stop-and-disable` is the explicit cleanup mode and must be run before the 24-hour login
expiry; credential expiry does not itself stop the containers. A successful deployment is a beta
demo, not financial launch approval; all payment, provider, action, and KemerBet gates remain off.

## Protected runtime preflight

The manual `Staging beta runtime preflight` GitHub workflow is the read-only inspection path for the
beta-admission database login. The guarded deployment workflow separately provisions both narrow
staging logins for at most 24 hours. Both are restricted to `main`, the protected `staging`
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
runs the beta service's catalog-only read-only preflight through TLS `verify-full`. After every
provisioning attempt, whether the preflight passes or fails, the workflow disables LOGIN and clears
its password. An abruptly terminated runner still leaves the provisional password expiring within
one hour. A later deployment workflow must provision the runtime credential atomically with the
reviewed service deployment rather than leave an unused LOGIN enabled. Both modes require the
operator to confirm the exact full `main` commit SHA. This workflow does not authorize starting the
staging Compose profile.
