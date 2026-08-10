# Manual staging beta container contract

`compose.staging-beta.yaml` is a deployment artifact for the private beta-admission slice only. It
does not run under the default Compose profile and it does not include the API, worker, executor,
maintenance process, reverse proxy, host port, Docker socket, production project reference, or a
live financial/provider action path.

The only services are:

- `beta-admission`, an internal HTTP service on container port 3001 with a `/readyz` healthcheck;
  and
- `bot`, exactly one Telegram long-polling process which waits for `beta-admission` readiness.

Both images use the immutable Linux/amd64 Node base in the repository `Dockerfile`, run as numeric
UID/GID 10001, use a read-only root filesystem, drop every Linux capability, prevent privilege
escalation, and have PID, memory, and CPU limits. The private project-scoped bridge permits outbound
Internet access for staging Supabase TLS and Telegram HTTPS, but neither image publishes or exposes
a host port. Docker JSON logs are bounded to three 10 MiB files per service.

## Locked feature boundary

Only the beta-admission service gate and the bot's beta-admission transport are enabled. Generic API
Telegram ingress, private ingress composition, action channels, action capabilities, nonce
maintenance, API PostgreSQL runtime, KemerBet execution, and final KemerBet actions remain explicitly
false in both services. `FINANCIAL_ACTIONS_MODE` is fixed to `dry_run`.

This is not an authorization to start the profile. A later, explicit staging activation must first
review the commit, runtime credentials, startup preflight, and resulting rendered Compose model.

## External secret files

No secret value belongs in this repository, an `.env` file, a Compose environment value, an image,
or a command line. The operator must provide five distinct secret files and one verified public CA
file outside the checkout:

| Host-path selector                                      | Mounted only into | Container path                                   |
| ------------------------------------------------------- | ----------------- | ------------------------------------------------ |
| `PAYREPLAYY_STAGING_BETA_ADMISSION_DATABASE_URL_FILE`   | beta-admission    | `/run/secrets/beta_admission_database_url`       |
| `PAYREPLAYY_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE` | beta-admission    | `/run/secrets/beta_admission_bot_transport_hmac` |
| `PAYREPLAYY_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE`   | beta-admission    | `/run/secrets/beta_admission_payload_hmac`       |
| `PAYREPLAYY_STAGING_SUPABASE_CA_CERTIFICATE_FILE`       | beta-admission    | `/run/configs/supabase_ca_certificate`           |
| `PAYREPLAYY_STAGING_BOT_TOKEN_FILE`                     | bot               | `/run/secrets/telegram_bot_token`                |
| `PAYREPLAYY_STAGING_BOT_TRANSPORT_HMAC_FILE`            | bot               | `/run/secrets/bot_beta_admission_transport_hmac` |

The two transport-HMAC files must contain the same independently generated 32-byte lowercase-hex
value, but they are intentionally separate host files and separate mounts. The bot cannot read the
beta service's copy and the beta service cannot read the bot's copy. The database URL and payload
HMAC are beta-service-only; the Telegram token is bot-only.

The database URL must use the staging project's IPv4 session pooler exactly:
`aws-0-eu-west-1.pooler.supabase.com:5432`, database `postgres`, username
`payreplayy_beta_admission_runtime.spzpiyxheappsfyswewl`, and only
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
- bot: `TELEGRAM_BOT_TOKEN_FILE` and `BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE`.

If any adapter is absent or accepts both a direct value and file value simultaneously, deployment is
blocked. Do not work around that condition by copying secret contents into ordinary environment
variables.

## Static validation

The repository verifier reads only the Dockerfile and Compose YAML; it does not contact Docker,
Supabase, GitHub, Telegram, or the VM:

```powershell
node infra/verify-staging-beta.mjs
```

It enforces the two-service topology, manual profile, pinned architecture and build targets,
hardening settings, isolated file-secret set, private egress-capable network, beta-only healthcheck,
disabled generic action/provider gates, and absence of host ingress or the production project ref.

Before any separately approved build, set `PAYREPLAYY_VCS_REF` to the reviewed full commit SHA and
`PAYREPLAYY_IMAGE_TAG` to a commit-derived immutable local tag. Render only from a sealed checkout
that contains no `.env`/`.env.*` file and from a cleared process environment with no inherited
direct secret variable. Supply only the two non-secret image selectors, five external secret-file
path selectors, and the verified public CA path selector explicitly. The future render must disable Compose's implicit checkout `.env`
loading:

```bash
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  PAYREPLAYY_VCS_REF=<reviewed-full-commit> \
  PAYREPLAYY_IMAGE_TAG=<commit-derived-tag> \
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

## Protected runtime preflight

The manual `Staging beta runtime preflight` GitHub workflow is the only reviewed provisioning path
for the dedicated staging database login. It is restricted to `main`, the protected `staging`
environment, the exact staging project reference, and the approved IPv4 session pooler. It never
starts a container, contacts Telegram, enables a payment/provider feature, or targets production.

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

Run `inspect` first. The provision mode gives the dedicated login a one-hour password validity,
runs the beta service's catalog-only read-only preflight through TLS `verify-full`, and changes the
validity to infinity only after every preflight check passes. A failed attempt disables LOGIN and
clears its password; an abruptly terminated runner still leaves the provisional password expiring
within one hour. Both modes require the operator to confirm the exact full `main` commit SHA. The
workflow does not authorize starting the staging Compose profile.
