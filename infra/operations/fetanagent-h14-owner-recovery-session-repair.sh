#!/usr/bin/env bash
set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly OWNER_SERVICE='owner-control'
readonly CANONICAL_H14='06459511d9330a0e1d956c42529b81aa9970e7a2'
readonly REPAIR_BASE='8042279ea7dc72742e6bff7966ea07696469e6db'
readonly STAGING_DROPLET_ID='593344964'
readonly SECRET_ROOT='/srv/fetanagent/secrets/staging'
readonly COMPOSE_FILE="/srv/fetanagent/releases/$CANONICAL_H14/infra/compose.staging-beta.yaml"
readonly PATCH_PARENT='/srv/fetanagent/owner-patches'

export PATH="$SAFE_PATH"

die() {
  printf 'FetanAgent Owner recovery-session repair refused: %s\n' "$*" >&2
  exit 1
}

[[ "$(id -u)" == '0' ]] || die 'root is required'
[[ "$#" -eq 2 && "$1" =~ ^[0-9a-f]{40}$ &&
  "$2" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git$ ]] ||
  die 'pass exactly one full lowercase release SHA and one HTTPS GitHub repository URL'
readonly RELEASE_SHA="$1"
readonly SOURCE_URL="$2"
readonly RELEASE_TAG="${RELEASE_SHA:0:12}"
readonly RELEASE_ROOT="$PATCH_PARENT/$RELEASE_SHA"
readonly OWNER_IMAGE="fetanagent-owner-control:$RELEASE_TAG"
readonly CANONICAL_TAG="${CANONICAL_H14:0:12}"
readonly CANONICAL_IMAGE="fetanagent-owner-control:$CANONICAL_TAG"

[[ "$RELEASE_SHA" != "$CANONICAL_H14" ]] || die 'the repair release must differ from canonical H14'
[[ -f "$COMPOSE_FILE" && ! -L "$COMPOSE_FILE" ]] || die 'the canonical Compose contract is unavailable'
[[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 http://169.254.169.254/metadata/v1/id)" == "$STAGING_DROPLET_ID" ]] ||
  die 'the host is not the exact staging Droplet'

for file in owner-database-url publishable-key beta-database-url beta-transport-hmac \
  customer-web-database-url customer-web-publishable-key customer-web-rate-limit-hmac \
  bot-transport-hmac beta-payload-hmac bot-token player-action-database-url \
  api-action-transport-hmac api-action-payload-hmac api-action-capability-hmac \
  api-action-semantic-hmac cbe-deposit-reference-encryption-key \
  cbe-deposit-reference-fingerprint-key deposit-proof-reference-encryption-master \
  deposit-proof-reference-fingerprint-master bot-action-transport-hmac; do
  [[ -f "$SECRET_ROOT/$file" && ! -L "$SECRET_ROOT/$file" ]] || die "required secret file is unavailable: $file"
done
for file in supabase-ca.crt cbe-deposit-reference-key-profile.v1.json deposit-proof-reference-profile.v2.json; do
  [[ -f "$SECRET_ROOT/$file" && ! -L "$SECRET_ROOT/$file" ]] || die "required config file is unavailable: $file"
done

compose_environment_for() {
  local vcs_ref="$1" image_tag="$2"
  printf '%s\0' \
    "PATH=$SAFE_PATH" \
    'HOME=/root' \
    'DOCKER_HOST=unix:///var/run/docker.sock' \
    "FETANAGENT_VCS_REF=$vcs_ref" \
    "FETANAGENT_IMAGE_TAG=$image_tag" \
    "FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE=$SECRET_ROOT/owner-database-url" \
    "FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE=$SECRET_ROOT/publishable-key" \
    "FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE=$SECRET_ROOT/customer-web-database-url" \
    "FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE=$SECRET_ROOT/customer-web-publishable-key" \
    "FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE=$SECRET_ROOT/customer-web-rate-limit-hmac" \
    "FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE=$SECRET_ROOT/beta-database-url" \
    "FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE=$SECRET_ROOT/beta-transport-hmac" \
    "FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE=$SECRET_ROOT/beta-payload-hmac" \
    "FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE=$SECRET_ROOT/player-action-database-url" \
    "FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE=$SECRET_ROOT/api-action-transport-hmac" \
    "FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE=$SECRET_ROOT/api-action-payload-hmac" \
    "FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE=$SECRET_ROOT/api-action-capability-hmac" \
    "FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE=$SECRET_ROOT/api-action-semantic-hmac" \
    "FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE=$SECRET_ROOT/cbe-deposit-reference-encryption-key" \
    "FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE=$SECRET_ROOT/cbe-deposit-reference-fingerprint-key" \
    "FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE=$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json" \
    "FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE=$SECRET_ROOT/deposit-proof-reference-encryption-master" \
    "FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE=$SECRET_ROOT/deposit-proof-reference-fingerprint-master" \
    "FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE=$SECRET_ROOT/deposit-proof-reference-profile.v2.json" \
    "FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE=$SECRET_ROOT/supabase-ca.crt" \
    "FETANAGENT_STAGING_BOT_TOKEN_FILE=$SECRET_ROOT/bot-token" \
    "FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE=$SECRET_ROOT/bot-transport-hmac" \
    "FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE=$SECRET_ROOT/bot-action-transport-hmac"
}

compose_owner() {
  local vcs_ref="$1" image_tag="$2"
  shift 2
  local -a environment=()
  mapfile -d '' -t environment < <(compose_environment_for "$vcs_ref" "$image_tag")
  env -i "${environment[@]}" docker compose --env-file /dev/null \
    --project-name "$PROJECT_NAME" --profile staging-manual -f "$COMPOSE_FILE" "$@"
}

service_inventory() {
  docker container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" |
    while IFS= read -r container; do
      [[ -n "$container" ]] || continue
      docker container inspect "$container" --format '{{index .Config.Labels "com.docker.compose.service"}}={{.Id}}'
    done | LC_ALL=C sort
}

owner_id() {
  docker container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter "label=com.docker.compose.service=$OWNER_SERVICE"
}

non_owner_inventory() {
  service_inventory | grep -v '^owner-control='
}

require_owner_contract() {
  local container="$1" expected_release="$2"
  [[ "$container" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{index .Config.Labels "com.docker.compose.project"}}')" == "$PROJECT_NAME" ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{index .Config.Labels "com.docker.compose.service"}}')" == "$OWNER_SERVICE" ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$expected_release" ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{.Config.User}}')" == '10001:10001' ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{.HostConfig.ReadonlyRootfs}}')" == 'true' ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{json .HostConfig.CapDrop}}')" == '["ALL"]' ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{json .HostConfig.SecurityOpt}}')" == '["no-new-privileges:true"]' ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{json .Config.Cmd}}')" == '["node","apps/admin/dist/index.js"]' ]] || return 1
  local environment
  environment="$(docker container inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}')" || return 1
  grep -Fxq 'FINANCIAL_ACTIONS_MODE=dry_run' <<<"$environment" || return 1
  grep -Fxq 'KEMERBET_EXECUTOR_ENABLED=false' <<<"$environment" || return 1
  grep -Fxq 'KEMERBET_FINAL_ACTION_ENABLED=false' <<<"$environment" || return 1
  grep -Fxq 'TELEGRAM_BOT_ENABLED=false' <<<"$environment" || return 1
}

old_owner="$(owner_id)" || die 'the current Owner inventory could not be read'
[[ "$old_owner" =~ ^[0-9a-f]{64}$ ]] || die 'exactly one current Owner is required'
require_owner_contract "$old_owner" "$CANONICAL_H14" || die 'the current Owner is not exact canonical H14'
[[ "$(docker container inspect "$old_owner" --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}')" == 'running|healthy' ]] ||
  die 'the current Owner is not running and healthy'
readonly NON_OWNER_BEFORE="$(non_owner_inventory)"
[[ "$(printf '%s\n' "$NON_OWNER_BEFORE" | sed '/^$/d' | wc -l)" == '6' ]] || die 'the live non-Owner inventory is not exact'

install -d -o root -g root -m 0700 "$PATCH_PARENT"
if [[ ! -e "$RELEASE_ROOT" && ! -L "$RELEASE_ROOT" ]]; then
  git clone --filter=blob:none --no-checkout "$SOURCE_URL" "$RELEASE_ROOT"
  git -C "$RELEASE_ROOT" fetch --depth 1 origin "$CANONICAL_H14" "$REPAIR_BASE" "$RELEASE_SHA"
  git -C "$RELEASE_ROOT" checkout --detach "$RELEASE_SHA"
fi
[[ ! -L "$RELEASE_ROOT" && -d "$RELEASE_ROOT/.git" ]] || die 'the isolated release checkout is invalid'
[[ "$(git -C "$RELEASE_ROOT" rev-parse HEAD)" == "$RELEASE_SHA" ]] || die 'the isolated checkout is not the exact release'
git -C "$RELEASE_ROOT" cat-file -e "$CANONICAL_H14^{commit}" || die 'canonical H14 is unavailable in the isolated checkout'
git -C "$RELEASE_ROOT" cat-file -e "$REPAIR_BASE^{commit}" || die 'the reviewed Owner repair base is unavailable in the isolated checkout'
[[ -z "$(git -C "$RELEASE_ROOT" status --short)" ]] || die 'the isolated checkout is dirty'
readonly EXPECTED_REPAIR_FILES="apps/admin/src/app.test.ts
apps/admin/src/app.ts
apps/admin/src/owner-dashboard-browser.test.ts
apps/admin/src/owner-dashboard.ts
infra/operations/fetanagent-h14-owner-recovery-session-repair.sh"
[[ "$(git -C "$RELEASE_ROOT" diff --name-only "$REPAIR_BASE" "$RELEASE_SHA")" == "$EXPECTED_REPAIR_FILES" ]] ||
  die 'the release contains files outside the reviewed Owner recovery-session repair'
[[ -z "$(git -C "$RELEASE_ROOT" diff --name-only "$CANONICAL_H14" "$RELEASE_SHA" -- infra/compose.staging-beta.yaml Dockerfile)" ]] ||
  die 'the repair changes the image or Compose deployment contract'

docker build --pull=false --target admin \
  --build-arg "VCS_REF=$RELEASE_SHA" \
  --tag "$OWNER_IMAGE" "$RELEASE_ROOT"
[[ "$(docker image inspect "$OWNER_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$RELEASE_SHA" ]] ||
  die 'the built Owner image has the wrong revision'
[[ "$(docker image inspect "$OWNER_IMAGE" --format '{{.Config.User}}')" == '10001:10001' ]] || die 'the built Owner image has the wrong user'
[[ "$(docker image inspect "$OWNER_IMAGE" --format '{{json .Config.Cmd}}')" == '["node","apps/admin/dist/index.js"]' ]] ||
  die 'the built Owner image has the wrong command'
[[ "$(non_owner_inventory)" == "$NON_OWNER_BEFORE" ]] || die 'a non-Owner service changed during the image build'

mutation_started='false'
rollback() {
  local status="$?"
  trap - EXIT
  if [[ "$status" -ne 0 && "$mutation_started" == 'true' ]]; then
    compose_owner "$CANONICAL_H14" "$CANONICAL_TAG" up --detach --no-build --no-deps --wait "$OWNER_SERVICE" >&2 || true
  fi
  exit "$status"
}
trap rollback EXIT

mutation_started='true'
compose_owner "$RELEASE_SHA" "$RELEASE_TAG" up --detach --no-build --no-deps --wait "$OWNER_SERVICE"
new_owner="$(owner_id)" || die 'the replacement Owner inventory could not be read'
[[ "$new_owner" =~ ^[0-9a-f]{64}$ && "$new_owner" != "$old_owner" ]] || die 'the replacement Owner identity is invalid'
require_owner_contract "$new_owner" "$RELEASE_SHA" || die 'the replacement Owner contract is invalid'
[[ "$(docker container inspect "$new_owner" --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}')" == 'running|healthy' ]] ||
  die 'the replacement Owner is not running and healthy'
[[ "$(non_owner_inventory)" == "$NON_OWNER_BEFORE" ]] || die 'a non-Owner service changed during the Owner-only replacement'
curl --fail --silent --show-error --noproxy '*' --max-time 5 http://127.0.0.1:3002/readyz >/dev/null ||
  die 'the replacement Owner readiness endpoint failed'

mutation_started='false'
trap - EXIT
printf '%s\n' "FetanAgent Owner recovery-session repair deployed: $RELEASE_SHA; Owner only; financial actions remain dry-run and no money moved."
