#!/usr/bin/env bash
set -euo pipefail

# Run only after the separate Owner-only staging deployment approval.
readonly RELEASE_SHA='cefa719dbd8fcec534f9ccb248d18b1be101524e'
readonly IMAGE_TAG="${RELEASE_SHA:0:12}"
readonly EXPECTED_DROPLET_ID='593344964'
readonly PROJECT='fetanagent-staging-owner-preview'
readonly PREVIEW_ROOT="/root/fetanagent-owner-preview-$IMAGE_TAG"
readonly COMPOSE_FILE="$PREVIEW_ROOT/compose.staging-owner-preview.yaml"
readonly IMAGE_ARCHIVE="$PREVIEW_ROOT/fetanagent-owner-control-cefa719d.tar"
readonly IMAGE_SHA256='946fd5ca4b4a29c099f63453d1cb859f1bdafda27738cfe533f8fa34d39f7bdb'
readonly COMPOSE_SHA256='725aaca97529419cfc6343c6826ebc10b1cf98515bf8ab61ea746c2f0d82f267'
readonly SECRET_ROOT='/srv/fetanagent/secrets/staging'

die() { printf '%s\n' "$*" >&2; exit 1; }

[[ $# -eq 1 && "$1" =~ ^(plan|start|status|stop)$ ]] ||
  die 'usage: staging-owner-transactions-preview-host.sh plan|start|status|stop'
readonly MODE="$1"
[[ "$(id -u)" == '0' ]] || die 'the preview helper requires the root operator channel'
[[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
  http://169.254.169.254/metadata/v1/id)" == "$EXPECTED_DROPLET_ID" ]] ||
  die 'the staging droplet identity changed'
command -v ss >/dev/null || die 'the socket inspection command is unavailable'

# Stopping must remain possible if a preview input or sealed file is damaged.
if [[ "$MODE" == 'status' || "$MODE" == 'stop' ]]; then
  preview_list="$(docker ps -a \
    --filter "label=com.docker.compose.project=$PROJECT" --format '{{.ID}}')" ||
    die 'the Docker preview inventory is unavailable'
  preview_ids=()
  while IFS= read -r preview_id; do
    [[ -z "$preview_id" ]] || preview_ids+=("$preview_id")
  done <<<"$preview_list"
  [[ "${#preview_ids[@]}" -le 1 ]] ||
    die 'the Owner preview project has an unexpected container count'
  if [[ "${#preview_ids[@]}" -eq 1 ]]; then
    [[ "$(docker inspect "${preview_ids[0]}" \
      --format '{{ index .Config.Labels "com.docker.compose.service" }}')" == 'owner-control' ]] ||
      die 'the Owner preview project has an unexpected service'
  fi
  if [[ "$MODE" == 'status' ]]; then
    if [[ "${#preview_ids[@]}" -eq 0 ]]; then
      printf '%s\n' 'STAGING_OWNER_PREVIEW_ABSENT'
    else
      docker inspect "${preview_ids[0]}" \
        --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}'
    fi
  else
    if [[ "${#preview_ids[@]}" -eq 1 ]]; then
      if [[ "$(docker inspect "${preview_ids[0]}" --format '{{.State.Running}}')" == 'true' ]]; then
        docker stop --time 15 "${preview_ids[0]}" >/dev/null
      fi
      docker rm "${preview_ids[0]}" >/dev/null
    fi
    [[ -z "$(ss -H -ltn '( sport = :3002 )')" ]] ||
      die 'the staging Owner loopback port is still occupied'
    printf '%s\n' 'STAGING_OWNER_PREVIEW_STOPPED'
  fi
  exit 0
fi

[[ -d "$PREVIEW_ROOT" && ! -L "$PREVIEW_ROOT" ]] ||
  die 'the reviewed preview directory is absent or symbolic'
[[ "$(stat --format='%U:%G:%a' "$PREVIEW_ROOT")" == 'root:root:700' ]] ||
  die 'the preview directory has unsafe ownership or mode'
[[ -f "$COMPOSE_FILE" && ! -L "$COMPOSE_FILE" ]] ||
  die 'the reviewed Compose file is absent or symbolic'
[[ "$(stat --format='%U:%G:%a' "$COMPOSE_FILE")" == 'root:root:400' ]] ||
  die 'the Compose file has unsafe ownership or mode'
[[ "$(sha256sum "$COMPOSE_FILE" | cut -d ' ' -f 1)" == "$COMPOSE_SHA256" ]] ||
  die 'the Compose file digest changed'

for file in owner-database-url publishable-key \
  deposit-proof-reference-encryption-master \
  deposit-proof-reference-fingerprint-master; do
  [[ -f "$SECRET_ROOT/$file" && ! -L "$SECRET_ROOT/$file" ]] ||
    die 'a sealed staging Owner secret is absent or symbolic'
  [[ "$(stat --format='%u:%g:%a' "$SECRET_ROOT/$file")" == '10001:10001:400' ]] ||
    die 'a sealed staging Owner secret has unsafe ownership or mode'
done
for file in deposit-proof-reference-profile.v2.json supabase-ca.crt; do
  [[ -f "$SECRET_ROOT/$file" && ! -L "$SECRET_ROOT/$file" ]] ||
    die 'a sealed staging Owner config is absent or symbolic'
  [[ "$(stat --format='%u:%g:%a' "$SECRET_ROOT/$file")" == '0:0:444' ]] ||
    die 'a sealed staging Owner config has unsafe ownership or mode'
done
[[ -d /var/lib/fetanagent/kemerbet-readiness-cohort-receipts &&
  ! -L /var/lib/fetanagent/kemerbet-readiness-cohort-receipts ]] ||
  die 'the existing readiness receipt mount is absent or symbolic'

export FETANAGENT_IMAGE_TAG="$IMAGE_TAG"
export FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE="$SECRET_ROOT/owner-database-url"
export FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/publishable-key"
export FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-encryption-master"
export FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-fingerprint-master"
export FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE="$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
export FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE="$SECRET_ROOT/supabase-ca.crt"

compose=(docker compose --env-file /dev/null --project-name "$PROJECT" \
  --profile owner-preview --file "$COMPOSE_FILE")
[[ "$("${compose[@]}" config --services)" == 'owner-control' ]] ||
  die 'the preview Compose file includes an unexpected service'
"${compose[@]}" config --quiet

case "$MODE" in
  plan)
    [[ -f "$IMAGE_ARCHIVE" && ! -L "$IMAGE_ARCHIVE" ]] ||
      die 'the reviewed Owner image archive is absent or symbolic'
    [[ "$(stat --format='%U:%G:%a' "$IMAGE_ARCHIVE")" == 'root:root:400' ]] ||
      die 'the Owner image archive has unsafe ownership or mode'
    [[ "$(sha256sum "$IMAGE_ARCHIVE" | cut -d ' ' -f 1)" == "$IMAGE_SHA256" ]] ||
      die 'the Owner image archive digest changed'
    [[ "$(df -B1 --output=avail /var/lib/docker | tail -n 1)" -ge 1500000000 ]] ||
      die 'insufficient Docker disk for the isolated Owner preview'
    [[ -z "$(ss -H -ltn '( sport = :3002 )')" ]] ||
      die 'the staging Owner loopback port is occupied'
    [[ -z "$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.ID}}')" ]] ||
      die 'a prior Owner preview container still exists'
    printf '%s\n' 'STAGING_OWNER_PREVIEW_HOST_PLAN_READY'
    ;;
  start)
    [[ -f "$IMAGE_ARCHIVE" && ! -L "$IMAGE_ARCHIVE" ]] ||
      die 'the reviewed Owner image archive is absent or symbolic'
    [[ "$(sha256sum "$IMAGE_ARCHIVE" | cut -d ' ' -f 1)" == "$IMAGE_SHA256" ]] ||
      die 'the Owner image archive digest changed'
    [[ "$(df -B1 --output=avail /var/lib/docker | tail -n 1)" -ge 1500000000 ]] ||
      die 'insufficient Docker disk for the isolated Owner preview'
    [[ -z "$(ss -H -ltn '( sport = :3002 )')" ]] ||
      die 'the staging Owner loopback port is occupied'
    [[ -z "$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.ID}}')" ]] ||
      die 'a prior Owner preview container still exists'
    docker load --input "$IMAGE_ARCHIVE" >/dev/null
    [[ "$(docker image inspect "fetanagent-owner-control:$IMAGE_TAG" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$RELEASE_SHA" ]] ||
      die 'the loaded Owner image revision is wrong'
    [[ "$(docker image inspect "fetanagent-owner-control:$IMAGE_TAG" \
      --format '{{.Config.User}}')" == '10001:10001' ]] ||
      die 'the loaded Owner image user is wrong'
    if ! "${compose[@]}" up -d --no-build --wait --wait-timeout 90 owner-control; then
      "${compose[@]}" down || true
      die 'the Owner-only preview failed health checks and was stopped'
    fi
    printf '%s\n' 'STAGING_OWNER_PREVIEW_RUNNING'
    ;;
esac
