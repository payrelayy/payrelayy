#!/usr/bin/env bash
# Root-owned, checksum-bound lifecycle for the staging no-money TeleBirr shadow verifier.

set -euo pipefail
IFS=$'\n\t'

readonly EXPECTED_SUDO_USER='fetanagent-admin'
readonly HELPER_PATH='/usr/local/sbin/fetanagent-telebirr-shadow-verifier-helper'
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly PROJECT_NAME='fetanagent-telebirr-shadow-verifier'
readonly SERVICE_NAME='telebirr-shadow-verifier'
readonly IMAGE_NAME='fetanagent-telebirr-shadow-verifier'
readonly RELEASE_ROOT='/srv/fetanagent/telebirr-shadow-verifier/releases'
readonly STATE_ROOT='/var/lib/fetanagent/telebirr-shadow-verifier'
readonly ACTIVE_RECEIPT="$STATE_ROOT/active-release"
readonly MUTATION_ROOT='/run/fetanagent-staging-deploy-helper'
readonly MUTATION_LOCK="$MUTATION_ROOT/mutation.lock"
readonly STAGING_DROPLET_ID='593344964'
readonly STAGING_PUBLIC_IPV4='161.35.41.232'
readonly STAGING_DIRECT_DATABASE_HOST='db.spzpiyxheappsfyswewl.supabase.co'
readonly EXPECTED_COMPOSE_SHA256='1b926c7972c4151de7316d84e44611fab5d30a84ed09b3e2cbc7913382386bf4'

export PATH="$SAFE_PATH"
umask 077

die() {
  printf 'TeleBirr shadow verifier helper failed: %s\n' "$1" >&2
  exit 1
}

docker_local() {
  env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$DOCKER_SOCKET" \
    docker --host "$DOCKER_SOCKET" "$@"
}

validate_release_identity() {
  local commit_sha="$1" image_tag="$2"
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || die 'the release commit is not canonical'
  [[ "$image_tag" =~ ^[0-9a-f]{12}$ && "$image_tag" == "${commit_sha:0:12}" ]] ||
    die 'the image tag does not match the release commit'
}

require_installed_helper() {
  [[ "$EUID" -eq 0 ]] || die 'the helper must run as root through sudo'
  [[ "${SUDO_USER:-}" == "$EXPECTED_SUDO_USER" ]] || die 'the sudo caller is not authorized'
  [[ "$0" == "$HELPER_PATH" ]] || die 'the helper must run from its installed path'
  [[ ! -L "$HELPER_PATH" && -f "$HELPER_PATH" &&
    "$(realpath -- "$HELPER_PATH")" == "$HELPER_PATH" &&
    "$(stat --format='%U:%G:%a:%h' "$HELPER_PATH")" == 'root:root:755:1' ]] ||
    die 'the installed helper metadata is unsafe'
}

require_host_identity() {
  local droplet_id public_ipv4
  command -v curl >/dev/null || die 'curl is unavailable for host identity proof'
  droplet_id="$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
    http://169.254.169.254/metadata/v1/id)" || die 'the Droplet identity is unavailable'
  public_ipv4="$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
    http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address)" ||
    die 'the Droplet public IPv4 identity is unavailable'
  [[ "$droplet_id" == "$STAGING_DROPLET_ID" && "$public_ipv4" == "$STAGING_PUBLIC_IPV4" ]] ||
    die 'this is not the reviewed FetanAgent staging Droplet'
}

require_database_route() {
  command -v getent >/dev/null || die 'getent is unavailable for database route proof'
  command -v timeout >/dev/null || die 'timeout is unavailable for database route proof'
  ip -6 route show default | grep -q '^default ' || die 'the VM has no default IPv6 route'
  getent ahostsv6 "$STAGING_DIRECT_DATABASE_HOST" >/dev/null ||
    die 'the staging direct database hostname has no IPv6 result'
  timeout 5 bash -c \
    "exec 3<>/dev/tcp/$STAGING_DIRECT_DATABASE_HOST/5432; exec 3>&-; exec 3<&-" ||
    die 'the staging direct database is not reachable on TCP/5432'
}

acquire_mutation_lock() {
  local descriptor_identity path_identity
  command -v flock >/dev/null || die 'flock is unavailable'
  if [[ ! -e "$MUTATION_ROOT" && ! -L "$MUTATION_ROOT" ]]; then
    install -d -o root -g root -m 0700 "$MUTATION_ROOT"
  fi
  [[ ! -L "$MUTATION_ROOT" && -d "$MUTATION_ROOT" &&
    "$(realpath -- "$MUTATION_ROOT")" == "$MUTATION_ROOT" &&
    "$(stat --format='%U:%G:%a' "$MUTATION_ROOT")" == 'root:root:700' ]] ||
    die 'the shared staging mutation-lock directory is unsafe'
  if [[ ! -e "$MUTATION_LOCK" && ! -L "$MUTATION_LOCK" ]]; then
    (set -o noclobber; umask 077; : >"$MUTATION_LOCK") 2>/dev/null || true
    chown root:root "$MUTATION_LOCK"
    chmod 0600 "$MUTATION_LOCK"
  fi
  [[ ! -L "$MUTATION_LOCK" && -f "$MUTATION_LOCK" &&
    "$(stat --format='%U:%G:%a:%h' "$MUTATION_LOCK")" == 'root:root:600:1' ]] ||
    die 'the shared staging mutation lock is unsafe'
  exec 9<>"$MUTATION_LOCK"
  path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")"
  descriptor_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)"
  [[ "$descriptor_identity" == "$path_identity" ]] ||
    die 'the opened staging mutation lock changed identity'
  flock --exclusive --nonblock 9 || die 'another staging mutation is already running'
}

release_path() {
  printf '%s/%s\n' "$RELEASE_ROOT" "$1"
}

require_root_directory() {
  local path="$1"
  [[ ! -L "$path" && -d "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%u:%g:%a' "$path")" == '0:0:700' ]] ||
    die 'a shadow-verifier root directory is absent or unsafe'
}

prepare_root_directories() {
  local path
  for path in "$RELEASE_ROOT" "$STATE_ROOT"; do
    if [[ ! -e "$path" && ! -L "$path" ]]; then
      install -d -o root -g root -m 0700 "$path"
    fi
    require_root_directory "$path"
  done
}

project_container_ids() {
  env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$DOCKER_SOCKET" \
    timeout --signal=TERM --kill-after=5s 20s \
      docker --host "$DOCKER_SOCKET" container ls --all --quiet \
        --filter "label=com.docker.compose.project=$PROJECT_NAME" \
        --filter "label=com.docker.compose.service=$SERVICE_NAME"
}

require_no_project_containers() {
  [[ -z "$(project_container_ids)" ]] || die 'a shadow-verifier container already exists'
}

require_public_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" && -s "$path" &&
    "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%u:%g:%a:%h' "$path")" == '0:0:444:1' ]] ||
    die 'a release public file is absent or unsafe'
}

require_secret_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" && -s "$path" &&
    "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%u:%g:%a:%h' "$path")" == '10001:10001:400:1' ]] ||
    die 'the runtime database URL file is absent or unsafe'
}

validate_database_url() {
  local path="$1" value pattern
  value="$(<"$path")"
  [[ "$(wc -c <"$path" | tr -d ' ')" == "${#value}" ]] ||
    die 'the runtime database URL contains trailing or non-ASCII bytes'
  pattern='^postgresql://fetanagent_telebirr_shadow_verifier_runtime:[0-9a-f]{64}@db\.spzpiyxheappsfyswewl\.supabase\.co:5432/postgres\?sslmode=verify-full$'
  [[ "$value" =~ $pattern ]] || die 'the runtime database URL is not exact'
}

validate_pin_manifest() {
  local path="$1"
  jq -e '
    type == "object" and
    keys_unsorted == ["contractVersion", "assignmentSigners", "devices"] and
    .contractVersion == 1 and
    (.assignmentSigners | type == "array" and length >= 1 and length <= 16) and
    (.devices | type == "array" and length >= 1 and length <= 16) and
    ([.assignmentSigners[], .devices[]] | all(
      type == "object" and keys_unsorted == ["keyId", "publicKeySpkiDerBase64"] and
      (.keyId | test("^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$")) and
      (.publicKeySpkiDerBase64 | test("^[A-Za-z0-9+/]+={0,2}$"))
    )) and
    ([.assignmentSigners[], .devices[]] | map(.keyId) | length == (unique | length))
  ' "$path" >/dev/null || die 'the public pin manifest shape is invalid'
}

require_image() {
  local commit_sha="$1" image_tag="$2" image_id="$3" observed
  observed="$(docker_local image inspect "$image_id" --format \
    '{{.Id}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{.Config.User}}|{{json .Config.Cmd}}|{{json .Config.ExposedPorts}}')" ||
    die 'the release image is unavailable'
  [[ "$observed" == "$image_id|$commit_sha|10001:10001|[\"node\",\"apps/trusted-telebirr-verifier/dist/telebirr-shadow-verifier-main.js\"]|null" ]] ||
    die 'the release image identity or runtime contract is wrong'
  [[ "$(docker_local image inspect "$IMAGE_NAME:$image_tag" --format '{{.Id}}')" == "$image_id" ]] ||
    die 'the commit tag no longer resolves to the recorded image ID'
}

require_release() {
  local commit_sha="$1" image_tag="$2" release image_id pin_digest name
  local -a required=(
    .image-id
    .image-tag
    .pin-manifest-sha256
    .release-sha
    compose.telebirr-shadow-verifier.yaml
    supabase-ca.crt
    telebirr-shadow-verifier-database-url
    telebirr-shadow-verifier-pins.v1.json
  )
  validate_release_identity "$commit_sha" "$image_tag"
  release="$(release_path "$commit_sha")"
  [[ ! -L "$release" && -d "$release" && "$(realpath -- "$release")" == "$release" &&
    "$(stat --format='%u:%g:%a' "$release")" == '0:0:700' ]] ||
    die 'the immutable release directory is absent or unsafe'
  [[ "$(find -P "$release" -mindepth 1 -maxdepth 1 -type f | wc -l)" -eq "${#required[@]}" &&
    -z "$(find -P "$release" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
    die 'the release file set is not exact'
  for name in "${required[@]}"; do
    if [[ "$name" == 'telebirr-shadow-verifier-database-url' ]]; then
      require_secret_file "$release/$name"
    else
      require_public_file "$release/$name"
    fi
  done
  [[ "$(<"$release/.release-sha")" == "$commit_sha" &&
    "$(<"$release/.image-tag")" == "$image_tag" ]] || die 'the release markers are wrong'
  image_id="$(<"$release/.image-id")"
  pin_digest="$(<"$release/.pin-manifest-sha256")"
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ && "$pin_digest" =~ ^sha256:[0-9a-f]{64}$ ]] ||
    die 'a release digest marker is malformed'
  [[ "$(sha256sum "$release/compose.telebirr-shadow-verifier.yaml" | awk '{print $1}')" == "$EXPECTED_COMPOSE_SHA256" ]] ||
    die 'the release Compose contract changed'
  [[ "sha256:$(sha256sum "$release/telebirr-shadow-verifier-pins.v1.json" | awk '{print $1}')" == "$pin_digest" ]] ||
    die 'the public pin manifest digest changed'
  validate_database_url "$release/telebirr-shadow-verifier-database-url"
  validate_pin_manifest "$release/telebirr-shadow-verifier-pins.v1.json"
  openssl x509 -in "$release/supabase-ca.crt" -noout -checkend 0 >/dev/null ||
    die 'the Supabase CA is invalid or expired'
  require_image "$commit_sha" "$image_tag" "$image_id"
}

compose_run() {
  local commit_sha="$1" image_tag="$2" release image_id
  shift 2
  release="$(release_path "$commit_sha")"
  image_id="$(<"$release/.image-id")"
  env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$DOCKER_SOCKET" \
    FETANAGENT_TELEBIRR_SHADOW_VERIFIER_IMAGE_ID="$image_id" \
    FETANAGENT_TELEBIRR_SHADOW_VERIFIER_DATABASE_URL_SECRET_FILE="$release/telebirr-shadow-verifier-database-url" \
    FETANAGENT_TELEBIRR_SHADOW_VERIFIER_PIN_MANIFEST_CONFIG_FILE="$release/telebirr-shadow-verifier-pins.v1.json" \
    FETANAGENT_TELEBIRR_SHADOW_VERIFIER_SUPABASE_CA_CONFIG_FILE="$release/supabase-ca.crt" \
    docker --host "$DOCKER_SOCKET" compose --env-file /dev/null \
      --project-name "$PROJECT_NAME" --profile telebirr-shadow-verifier \
      --file "$release/compose.telebirr-shadow-verifier.yaml" "$@"
}

require_ready_release() {
  local commit_sha="$1" image_tag="$2" release image_id container_id inspection environment network
  require_release "$commit_sha" "$image_tag"
  release="$(release_path "$commit_sha")"
  image_id="$(<"$release/.image-id")"
  [[ ! -L "$ACTIVE_RECEIPT" && -f "$ACTIVE_RECEIPT" &&
    "$(realpath -- "$ACTIVE_RECEIPT")" == "$ACTIVE_RECEIPT" &&
    "$(stat --format='%u:%g:%a:%h:%s' "$ACTIVE_RECEIPT")" == '0:0:600:1:41' &&
    "$(<"$ACTIVE_RECEIPT")" == "$commit_sha" ]] || die 'the active-release receipt is unsafe'
  container_id="$(project_container_ids)"
  [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the shadow-verifier container inventory is not exact'
  inspection="$(docker_local container inspect "$container_id")"
  network="${PROJECT_NAME}_telebirr_shadow_verifier_egress"
  jq -e --arg image "$image_id" --arg commit "$commit_sha" --arg service "$SERVICE_NAME" --arg network "$network" '
    length == 1 and
    .[0].Image == $image and
    .[0].Config.Image == $image and
    .[0].Config.User == "10001:10001" and
    .[0].Config.Labels["org.opencontainers.image.revision"] == $commit and
    .[0].Config.Labels["com.docker.compose.service"] == $service and
    .[0].HostConfig.ReadonlyRootfs == true and
    .[0].HostConfig.RestartPolicy.Name == "unless-stopped" and
    .[0].HostConfig.CapDrop == ["ALL"] and
    (.[0].HostConfig.SecurityOpt | index("no-new-privileges:true")) != null and
    .[0].HostConfig.PortBindings == {} and
    .[0].State.Status == "running" and
    .[0].State.Health.Status == "healthy" and
    .[0].RestartCount == 0 and
    (.[0].NetworkSettings.Networks | keys) == [$network]
  ' <<<"$inspection" >/dev/null || die 'the shadow verifier is outside its exact healthy boundary'
  environment="$(docker_local container inspect "$container_id" --format '{{range .Config.Env}}{{println .}}{{end}}')"
  for exact in \
    'NODE_ENV=production' \
    'FINANCIAL_ACTIONS_MODE=dry_run' \
    'INTERNAL_TELEBIRR_SHADOW_VERIFIER_ENABLED=true' \
    'TELEBIRR_SHADOW_VERIFICATION_ENABLED=true' \
    'TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED=false' \
    'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false' \
    'TELEBIRR_SHADOW_VERIFIER_DEPLOYMENT_TARGET=staging'; do
    [[ "$(grep -Fxc "$exact" <<<"$environment")" == '1' ]] ||
      die 'the shadow-verifier safety environment is not exact'
  done
  ! grep -Eq '^(DATABASE_URL|SUPABASE_DB_PASSWORD|SUPABASE_SERVICE_ROLE_KEY|KEMERBET_EXECUTOR_DATABASE_URL|TELEGRAM_BOT_TOKEN)=' \
    <<<"$environment" || die 'a forbidden inline credential reached the shadow verifier'
  [[ "$(docker_local network inspect "$network" --format '{{.Driver}}|{{.EnableIPv6}}|{{.Internal}}|{{.Attachable}}')" == \
    'bridge|true|false|false' ]] || die 'the shadow-verifier egress network is unsafe'
}

prepare_incoming() {
  local commit_sha="$1" incoming
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || die 'the incoming commit is not canonical'
  incoming="/tmp/fetanagent-telebirr-shadow-verifier-$commit_sha"
  [[ ! -e "$incoming" && ! -L "$incoming" ]] || die 'the incoming path already exists'
  install -d -o "$EXPECTED_SUDO_USER" -g "$EXPECTED_SUDO_USER" -m 0700 "$incoming"
}

discard_incoming() {
  local commit_sha="$1" incoming
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || die 'the incoming commit is not canonical'
  incoming="/tmp/fetanagent-telebirr-shadow-verifier-$commit_sha"
  if [[ -e "$incoming" || -L "$incoming" ]]; then
    [[ ! -L "$incoming" && -d "$incoming" && "$(realpath -- "$incoming")" == "$incoming" &&
      ( "$(stat --format='%U:%G:%a' "$incoming")" == "$EXPECTED_SUDO_USER:$EXPECTED_SUDO_USER:700" ||
        "$(stat --format='%U:%G:%a' "$incoming")" == 'root:root:700' ) &&
      -z "$(find -P "$incoming" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
      die 'the incoming cleanup path is unsafe'
    find -P "$incoming" -mindepth 1 -maxdepth 1 -type f -delete
    rmdir -- "$incoming"
  fi
}

install_release() {
  local commit_sha="$1" image_tag="$2" incoming="$3" release staging image_id pin_digest name
  local -a required=(
    compose.telebirr-shadow-verifier.yaml
    fetanagent-telebirr-shadow-verifier-image.tar
    supabase-ca.crt
    telebirr-shadow-verifier-database-url
    telebirr-shadow-verifier-pins.v1.json
  )
  validate_release_identity "$commit_sha" "$image_tag"
  [[ "$incoming" == "/tmp/fetanagent-telebirr-shadow-verifier-$commit_sha" &&
    ! -L "$incoming" && -d "$incoming" && "$(realpath -- "$incoming")" == "$incoming" &&
    "$(stat --format='%U:%G:%a' "$incoming")" == "$EXPECTED_SUDO_USER:$EXPECTED_SUDO_USER:700" ]] ||
    die 'the incoming release directory is unsafe'
  [[ "$(find -P "$incoming" -mindepth 1 -maxdepth 1 -type f | wc -l)" -eq "${#required[@]}" &&
    -z "$(find -P "$incoming" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
    die 'the incoming release file set is not exact'
  for name in "${required[@]}"; do
    [[ ! -L "$incoming/$name" && -f "$incoming/$name" && -s "$incoming/$name" ]] ||
      die 'an incoming release file is absent or unsafe'
  done
  [[ "$(sha256sum "$incoming/compose.telebirr-shadow-verifier.yaml" | awk '{print $1}')" == "$EXPECTED_COMPOSE_SHA256" ]] ||
    die 'the incoming Compose contract changed'
  validate_database_url "$incoming/telebirr-shadow-verifier-database-url"
  validate_pin_manifest "$incoming/telebirr-shadow-verifier-pins.v1.json"
  openssl x509 -in "$incoming/supabase-ca.crt" -noout -checkend 0 >/dev/null ||
    die 'the incoming Supabase CA is invalid or expired'
  release="$(release_path "$commit_sha")"
  staging="$RELEASE_ROOT/.installing-$commit_sha"
  [[ ! -e "$release" && ! -L "$release" && ! -e "$staging" && ! -L "$staging" ]] ||
    die 'this immutable release was already installed or staged'
  install -d -o root -g root -m 0700 "$RELEASE_ROOT" "$staging"
  docker_local image load --input "$incoming/fetanagent-telebirr-shadow-verifier-image.tar" >/dev/null
  image_id="$(docker_local image inspect "$IMAGE_NAME:$image_tag" --format '{{.Id}}')"
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'the loaded image ID is malformed'
  require_image "$commit_sha" "$image_tag" "$image_id"
  install -o root -g root -m 0444 "$incoming/compose.telebirr-shadow-verifier.yaml" "$staging/compose.telebirr-shadow-verifier.yaml"
  install -o root -g root -m 0444 "$incoming/supabase-ca.crt" "$staging/supabase-ca.crt"
  install -o root -g root -m 0444 "$incoming/telebirr-shadow-verifier-pins.v1.json" "$staging/telebirr-shadow-verifier-pins.v1.json"
  install -o 10001 -g 10001 -m 0400 "$incoming/telebirr-shadow-verifier-database-url" "$staging/telebirr-shadow-verifier-database-url"
  pin_digest="sha256:$(sha256sum "$staging/telebirr-shadow-verifier-pins.v1.json" | awk '{print $1}')"
  printf '%s\n' "$commit_sha" >"$staging/.release-sha"
  printf '%s\n' "$image_tag" >"$staging/.image-tag"
  printf '%s\n' "$image_id" >"$staging/.image-id"
  printf '%s\n' "$pin_digest" >"$staging/.pin-manifest-sha256"
  chmod 0444 "$staging/.release-sha" "$staging/.image-tag" "$staging/.image-id" "$staging/.pin-manifest-sha256"
  mv -- "$staging" "$release"
  discard_incoming "$commit_sha"
  require_release "$commit_sha" "$image_tag"
}

start_release() {
  local commit_sha="$1" image_tag="$2" temporary_receipt="$ACTIVE_RECEIPT.new"
  require_release "$commit_sha" "$image_tag"
  require_no_project_containers
  [[ ! -e "$ACTIVE_RECEIPT" && ! -L "$ACTIVE_RECEIPT" &&
    ! -e "$temporary_receipt" && ! -L "$temporary_receipt" ]] ||
    die 'an active or interrupted release receipt already exists'
  compose_run "$commit_sha" "$image_tag" config --quiet
  if ! compose_run "$commit_sha" "$image_tag" up -d --no-build --wait --wait-timeout 90 "$SERVICE_NAME"; then
    compose_run "$commit_sha" "$image_tag" down --remove-orphans --timeout 20 >/dev/null 2>&1 || true
    die 'the shadow verifier did not become healthy'
  fi
  (umask 077; printf '%s\n' "$commit_sha" >"$temporary_receipt")
  chown root:root "$temporary_receipt"
  chmod 0600 "$temporary_receipt"
  mv -- "$temporary_receipt" "$ACTIVE_RECEIPT"
  require_ready_release "$commit_sha" "$image_tag"
}

stop_release() {
  local expected_commit="$1" output attempt receipt_error='' recorded_commit=''
  local -a ids=()
  [[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || die 'the expected release commit is not canonical'
  if [[ -e "$ACTIVE_RECEIPT" || -L "$ACTIVE_RECEIPT" ]]; then
    if [[ ! -L "$ACTIVE_RECEIPT" && -f "$ACTIVE_RECEIPT" &&
      "$(realpath -- "$ACTIVE_RECEIPT")" == "$ACTIVE_RECEIPT" &&
      "$(stat --format='%u:%g:%a:%h:%s' "$ACTIVE_RECEIPT")" == '0:0:600:1:41' ]]; then
      recorded_commit="$(<"$ACTIVE_RECEIPT")"
      [[ "$recorded_commit" == "$expected_commit" ]] ||
        die 'the active-release receipt names another release'
    elif [[ -L "$ACTIVE_RECEIPT" || ! -f "$ACTIVE_RECEIPT" ||
      "$(realpath -- "$ACTIVE_RECEIPT")" != "$ACTIVE_RECEIPT" ||
      "$(stat --format='%u:%g:%a:%h:%s' "$ACTIVE_RECEIPT")" != '0:0:600:1:41' ]]; then
      receipt_error='the active-release receipt is unsafe'
    fi
  fi
  for attempt in 1 2 3; do
    output="$(project_container_ids)" || die 'the shadow-verifier container inventory failed'
    ids=()
    if [[ -n "$output" ]]; then mapfile -t ids <<<"$output"; fi
    if [[ "${#ids[@]}" -gt 0 ]]; then
      env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$DOCKER_SOCKET" \
        timeout --signal=TERM --kill-after=5s 25s \
          docker --host "$DOCKER_SOCKET" container rm --force -- "${ids[@]}" >/dev/null || true
    fi
    if [[ "$attempt" != '3' ]]; then sleep 2; fi
  done
  require_no_project_containers
  # Corrupt state cannot prevent stopping the exact-label runtime, but it remains an operator
  # incident and is not silently removed. A sound receipt for another release was rejected above.
  [[ -z "$receipt_error" ]] || die "$receipt_error"
  if [[ -f "$ACTIVE_RECEIPT" && ! -L "$ACTIVE_RECEIPT" ]]; then rm -f -- "$ACTIVE_RECEIPT"; fi
}

require_installed_helper
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || die 'Docker overrides are forbidden'

case "${1:-}" in
  preflight|prepare-incoming|discard|install|start|stop)
    acquire_mutation_lock
    ;;
esac

case "${1:-}" in
  verify)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{64}$ ]] || die 'verify requires one SHA-256 digest'
    [[ "$(sha256sum -- "$HELPER_PATH" | awk '{print $1}')" == "$2" ]] ||
      die 'the installed helper does not match the reviewed source'
    ;;
  preflight)
    [[ $# -eq 3 ]] || die 'preflight requires a commit and image tag'
    validate_release_identity "$2" "$3"
    command -v docker >/dev/null
    command -v jq >/dev/null
    command -v openssl >/dev/null
    docker_local compose version >/dev/null
    require_host_identity
    require_database_route
    prepare_root_directories
    require_no_project_containers
    [[ ! -e "$ACTIVE_RECEIPT" && ! -L "$ACTIVE_RECEIPT" ]] ||
      die 'an active shadow-verifier release must be explicitly stopped first'
    ;;
  prepare-incoming)
    [[ $# -eq 2 ]] || die 'prepare-incoming requires one commit SHA'
    prepare_incoming "$2"
    ;;
  discard)
    [[ $# -eq 2 ]] || die 'discard requires one commit SHA'
    discard_incoming "$2"
    ;;
  install)
    [[ $# -eq 4 ]] || die 'install requires commit, image tag, and incoming directory'
    require_root_directory "$RELEASE_ROOT"
    require_root_directory "$STATE_ROOT"
    require_no_project_containers
    [[ ! -e "$ACTIVE_RECEIPT" && ! -L "$ACTIVE_RECEIPT" ]] ||
      die 'an active shadow-verifier release must be explicitly stopped first'
    install_release "$2" "$3" "$4"
    ;;
  start)
    [[ $# -eq 3 ]] || die 'start requires commit and image tag'
    require_root_directory "$RELEASE_ROOT"
    require_root_directory "$STATE_ROOT"
    require_host_identity
    require_database_route
    start_release "$2" "$3"
    ;;
  status)
    [[ $# -eq 3 ]] || die 'status requires commit and image tag'
    require_root_directory "$RELEASE_ROOT"
    require_root_directory "$STATE_ROOT"
    require_host_identity
    require_database_route
    require_ready_release "$2" "$3"
    printf 'TeleBirr shadow verifier ready: release=%s, dry-run observer enabled, live and KemerBet gates disabled, no public ingress.\n' "$2"
    ;;
  stop)
    [[ $# -eq 2 ]] || die 'stop requires the expected release commit'
    stop_release "$2"
    printf 'TeleBirr shadow verifier stopped: exact labeled containers absent.\n'
    ;;
  *)
    die 'expected verify, preflight, prepare-incoming, discard, install, start, status, or stop'
    ;;
esac
