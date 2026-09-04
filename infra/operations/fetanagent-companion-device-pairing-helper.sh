#!/usr/bin/env bash
# Root-owned, checksum-bound helper for the pairing-only Windows companion bridge.
# It owns no KemerBet credential and exposes no lookup, deposit, transfer, or settlement operation.

set -euo pipefail

readonly EXPECTED_SUDO_USER='fetanagent-admin'
readonly HELPER_PATH='/usr/local/sbin/fetanagent-companion-device-pairing-helper'
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly PROJECT_NAME='fetanagent-companion-device-pairing'
readonly SERVICE_NAME='companion-device-bridge'
readonly IMAGE_NAME='fetanagent-companion-device-bridge'
readonly RELEASE_ROOT='/srv/fetanagent/companion-device-pairing/releases'
readonly STATE_ROOT='/var/lib/fetanagent-companion-device-pairing'
readonly CURRENT_RELEASE="$STATE_ROOT/current-release"
readonly INGRESS_NETWORK='fetanagent-companion-device-ingress'
readonly INGRESS_NETWORK_LABEL='companion-device-ingress-v1'
readonly MUTATION_LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly MUTATION_LOCK="$MUTATION_LOCK_ROOT/mutation.lock"
readonly STAGING_DROPLET_ID='593344964'
readonly STAGING_PUBLIC_IPV4='161.35.41.232'
readonly DATABASE_ROLE='fetanagent_companion_device_bridge_runtime'
readonly DATABASE_HOST='db.spzpiyxheappsfyswewl.supabase.co'

export PATH="$SAFE_PATH"

die() {
  printf 'companion pairing helper failed: %s\n' "$1" >&2
  exit 1
}

docker_local() {
  env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$DOCKER_SOCKET" \
    docker --host "$DOCKER_SOCKET" "$@"
}

validate_release() {
  local commit_sha="$1" image_tag="$2"
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || die 'the release must be a full lowercase commit SHA'
  [[ "$image_tag" =~ ^[0-9a-f]{12}$ && "$image_tag" == "${commit_sha:0:12}" ]] ||
    die 'the image tag must be the release SHA prefix'
}

require_host_identity() {
  local droplet_id public_ipv4
  command -v curl >/dev/null 2>&1 || die 'curl is unavailable for host identity proof'
  droplet_id="$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
    http://169.254.169.254/metadata/v1/id)" || die 'the DigitalOcean droplet identity is unavailable'
  public_ipv4="$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
    http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address)" ||
    die 'the DigitalOcean public IPv4 identity is unavailable'
  [[ "$droplet_id" == "$STAGING_DROPLET_ID" && "$public_ipv4" == "$STAGING_PUBLIC_IPV4" ]] ||
    die 'this is not the reviewed FetanAgent staging droplet'
}

acquire_mutation_lock() {
  local fd_identity path_identity
  command -v flock >/dev/null 2>&1 || die 'flock is unavailable'
  if [[ ! -e "$MUTATION_LOCK_ROOT" && ! -L "$MUTATION_LOCK_ROOT" ]]; then
    install -d -o root -g root -m 0700 "$MUTATION_LOCK_ROOT"
  fi
  [[ ! -L "$MUTATION_LOCK_ROOT" && -d "$MUTATION_LOCK_ROOT" &&
    "$(realpath -- "$MUTATION_LOCK_ROOT")" == "$MUTATION_LOCK_ROOT" &&
    "$(stat --format='%U:%G:%a' "$MUTATION_LOCK_ROOT")" == 'root:root:700' ]] ||
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
  fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)"
  [[ "$fd_identity" == "$path_identity" ]] || die 'the opened staging mutation lock changed identity'
  flock --exclusive --nonblock 9 || die 'another staging mutation is already running'
}

require_public_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a' "$path")" == 'root:root:444' ]] ||
    die 'a release config file is absent or unsafe'
}

require_secret_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%u:%g:%a' "$path")" == '10001:10001:400' ]] ||
    die 'a release secret file is absent or unsafe'
}

release_path() {
  printf '%s/%s\n' "$RELEASE_ROOT" "$1"
}

require_release_files_at() {
  local root="$1" commit_sha="$2" image_tag="$3" observed_image
  [[ ! -L "$root" && -d "$root" && "$(realpath -- "$root")" == "$root" &&
    "$(stat --format='%U:%G:%a' "$root")" == 'root:root:755' ]] ||
    die 'the companion release directory is absent or unsafe'
  require_public_file "$root/infra/compose.companion-device-pairing.yaml"
  require_public_file "$root/configs/companion-device-bridge-runtime-manifest.v1.json"
  require_public_file "$root/configs/supabase-ca.crt"
  require_secret_file "$root/secrets/companion-device-bridge-database-url"
  require_secret_file "$root/secrets/companion-device-bridge-server-signer.pkcs8.der"
  observed_image="$(docker_local image inspect "$IMAGE_NAME:$image_tag" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}|{{.Config.User}}|{{json .Config.Cmd}}')" ||
    die 'the companion bridge image could not be inspected'
  [[ "$observed_image" == \
    "$commit_sha|10001:10001|[\"node\",\"apps/companion-device-bridge/dist/main.js\"]" ]] ||
    die 'the companion bridge image does not match the reviewed release'
}

require_release_files() {
  local commit_sha="$1" image_tag="$2"
  require_release_files_at "$(release_path "$commit_sha")" "$commit_sha" "$image_tag"
}

require_ingress_network() {
  local identifiers observed
  identifiers="$(docker_local network ls --quiet --filter "name=^${INGRESS_NETWORK}$")" ||
    die 'the companion ingress network could not be listed'
  [[ "$identifiers" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the companion ingress network is absent or ambiguous'
  observed="$(docker_local network inspect "$identifiers" --format \
    '{{.Name}}|{{.Driver}}|{{.Internal}}|{{.Attachable}}|{{ index .Labels "com.fetanagent.boundary" }}')" ||
    die 'the companion ingress network could not be inspected'
  [[ "$observed" == "$INGRESS_NETWORK|bridge|true|false|$INGRESS_NETWORK_LABEL" ]] ||
    die 'the companion ingress network contract is unsafe'
}

ensure_ingress_network() {
  local identifiers
  identifiers="$(docker_local network ls --quiet --filter "name=^${INGRESS_NETWORK}$")" ||
    die 'the companion ingress network could not be listed'
  if [[ -z "$identifiers" ]]; then
    docker_local network create --driver bridge --internal --attachable=false \
      --label "com.fetanagent.boundary=$INGRESS_NETWORK_LABEL" "$INGRESS_NETWORK" >/dev/null ||
      die 'the companion ingress network could not be created'
  fi
  require_ingress_network
}

compose_environment() {
  local commit_sha="$1" image_tag="$2" root
  root="$(release_path "$commit_sha")"
  printf '%s\0' \
    "PATH=$SAFE_PATH" \
    'HOME=/root' \
    "DOCKER_HOST=$DOCKER_SOCKET" \
    "FETANAGENT_VCS_REF=$commit_sha" \
    "FETANAGENT_IMAGE_TAG=$image_tag" \
    "FETANAGENT_COMPANION_SUPABASE_CA_CERTIFICATE_FILE=$root/configs/supabase-ca.crt" \
    "FETANAGENT_COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE=$root/configs/companion-device-bridge-runtime-manifest.v1.json" \
    "FETANAGENT_COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE=$root/secrets/companion-device-bridge-database-url" \
    "FETANAGENT_COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY_FILE=$root/secrets/companion-device-bridge-server-signer.pkcs8.der"
}

compose_run() {
  local commit_sha="$1" image_tag="$2"
  shift 2
  local root
  local -a environment
  root="$(release_path "$commit_sha")"
  mapfile -d '' -t environment < <(compose_environment "$commit_sha" "$image_tag")
  env -i "${environment[@]}" docker --host "$DOCKER_SOCKET" compose --env-file /dev/null \
    --project-name "$PROJECT_NAME" --profile companion-device-pairing \
    --file "$root/infra/compose.companion-device-pairing.yaml" "$@"
}

project_container_ids() {
  docker_local container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PROJECT_NAME"
}

require_no_project_containers() {
  [[ -z "$(project_container_ids)" ]] || die 'a companion pairing container is already present'
}

read_current_release() {
  local value
  [[ ! -L "$CURRENT_RELEASE" && -f "$CURRENT_RELEASE" &&
    "$(stat --format='%U:%G:%a' "$CURRENT_RELEASE")" == 'root:root:444' ]] || return 1
  value="$(<"$CURRENT_RELEASE")"
  [[ "$value" =~ ^[0-9a-f]{40}$ ]] || return 1
  printf '%s\n' "$value"
}

record_current_release() {
  local commit_sha="$1" temporary="$STATE_ROOT/.current-release.installing"
  install -d -o root -g root -m 0700 "$STATE_ROOT"
  [[ ! -e "$temporary" && ! -L "$temporary" ]] ||
    die 'an interrupted companion release-state write remains'
  (umask 077; printf '%s\n' "$commit_sha" >"$temporary")
  chown root:root "$temporary"
  chmod 0444 "$temporary"
  mv -f -- "$temporary" "$CURRENT_RELEASE"
  sync -f "$STATE_ROOT"
}

require_ready_release() {
  local commit_sha="$1" image_tag="$2" container_id environment networks observed port_bindings
  local expected_networks
  require_release_files "$commit_sha" "$image_tag"
  require_ingress_network
  [[ "$(read_current_release)" == "$commit_sha" ]] ||
    die 'the active companion release marker does not match'
  container_id="$(project_container_ids)"
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the companion project container inventory is not exact'
  observed="$(docker_local container inspect "$container_id" --format \
    '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.Config.Image}}|{{.Config.User}}|{{.HostConfig.ReadonlyRootfs}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "org.opencontainers.image.revision"}}')" ||
    die 'the companion bridge container could not be inspected'
  [[ "$observed" == "running|healthy|$IMAGE_NAME:$image_tag|10001:10001|true|$SERVICE_NAME|$commit_sha" ]] ||
    die 'the companion bridge container is not the exact healthy release'
  port_bindings="$(docker_local container inspect "$container_id" \
    --format '{{json .HostConfig.PortBindings}}')" || die 'container port bindings could not be inspected'
  [[ "$port_bindings" == '{}' || "$port_bindings" == 'null' ]] ||
    die 'the companion bridge unexpectedly publishes a host port'
  networks="$(docker_local container inspect "$container_id" --format \
    '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' |
    sed '/^$/d' | LC_ALL=C sort)" ||
    die 'the companion bridge network membership could not be inspected'
  expected_networks="$(printf '%s\n%s\n' \
    "${PROJECT_NAME}_companion_device_database_egress" "$INGRESS_NETWORK" | LC_ALL=C sort)"
  [[ "$networks" == "$expected_networks" ]] ||
    die 'the companion bridge network membership is not exact'
  environment="$(docker_local container inspect "$container_id" --format \
    '{{range .Config.Env}}{{println .}}{{end}}')" || die 'the companion environment could not be inspected'
  for exact in \
    'NODE_ENV=production' \
    'FINANCIAL_ACTIONS_MODE=dry_run' \
    'INTERNAL_COMPANION_DEVICE_BRIDGE_ENABLED=true' \
    'COMPANION_DEVICE_BRIDGE_NO_MONEY_PAIRING_ENABLED=true'; do
    [[ "$(grep -Fxc "$exact" <<<"$environment")" == '1' ]] ||
      die 'the companion bridge safety environment is not exact'
  done
  ! grep -Eq '^(DATABASE_URL|SUPABASE_DB_PASSWORD|SUPABASE_SERVICE_ROLE_KEY|OWNER_CONTROL_DATABASE_URL|KEMERBET_EXECUTOR_DATABASE_URL)=' \
    <<<"$environment" || die 'a forbidden inline credential reached the companion bridge'
  ! grep -Eiq '^(.*(TRANSFER|AMOUNT_ENTRY|FINAL_ACTION|SETTLEMENT|EXECUTOR).*)=(1|true|yes|on|live)$' \
    <<<"$environment" || die 'a financial capability is enabled in the companion bridge'
}

stop_release() {
  local commit_sha image_tag
  if ! commit_sha="$(read_current_release)"; then
    [[ -z "$(project_container_ids)" ]] ||
      die 'the companion project exists without an exact active-release marker'
    return 0
  fi
  image_tag="${commit_sha:0:12}"
  require_release_files "$commit_sha" "$image_tag"
  compose_run "$commit_sha" "$image_tag" down --remove-orphans --timeout 20
  require_no_project_containers
}

start_release() {
  local commit_sha="$1" image_tag="$2"
  require_release_files "$commit_sha" "$image_tag"
  ensure_ingress_network
  require_no_project_containers
  compose_run "$commit_sha" "$image_tag" run --rm --no-deps "$SERVICE_NAME" \
    node apps/companion-device-bridge/dist/database-preflight-cli.js || return 1
  compose_run "$commit_sha" "$image_tag" up -d --no-build --wait --wait-timeout 90 \
    "$SERVICE_NAME" || return 1
  record_current_release "$commit_sha"
  require_ready_release "$commit_sha" "$image_tag"
}

validate_incoming_material() {
  local incoming="$1" expected_files actual_files manifest_digest derived_digest
  expected_files="$(printf '%s\n' \
    companion-device-bridge-database-url \
    companion-device-bridge-runtime-manifest.v1.json \
    companion-device-bridge-server-signer.pkcs8.der \
    compose.companion-device-pairing.yaml \
    fetanagent-companion-device-bridge.tar \
    supabase-ca.crt | LC_ALL=C sort)"
  actual_files="$(find -P "$incoming" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)"
  [[ "$actual_files" == "$expected_files" ]] || die 'the incoming companion release file set is not exact'
  while IFS= read -r name; do
    [[ ! -L "$incoming/$name" && -f "$incoming/$name" ]] ||
      die 'an incoming companion release input is not a regular file'
  done <<<"$actual_files"
  if ! env -i PATH="$SAFE_PATH" python3 -I - \
    "$incoming/companion-device-bridge-database-url" "$DATABASE_ROLE" "$DATABASE_HOST" <<'PY'
import re, sys
from pathlib import Path

path = Path(sys.argv[1])
file_stat = path.stat()
if file_stat.st_size < 1 or file_stat.st_size > 512:
    raise SystemExit(1)
raw = path.read_bytes()
role = sys.argv[2].encode('ascii')
host = sys.argv[3].encode('ascii')
pattern = (
    rb'postgresql://' + re.escape(role) + rb':[0-9a-f]{64}@' + re.escape(host) +
    rb':5432/postgres\?sslmode=verify-full'
)
if len(raw) != file_stat.st_size or re.fullmatch(pattern, raw) is None:
    raise SystemExit(1)
PY
  then
    die 'the companion database URL is not exact canonical bytes'
  fi
  openssl x509 -in "$incoming/supabase-ca.crt" -noout -checkend 0 >/dev/null 2>&1 ||
    die 'the Supabase CA certificate is invalid or expired'
  openssl pkey -inform DER -in "$incoming/companion-device-bridge-server-signer.pkcs8.der" \
    -check -noout >/dev/null 2>&1 || die 'the companion signer private key is invalid'
  manifest_digest="$(env -i PATH="$SAFE_PATH" python3 -I - \
    "$incoming/companion-device-bridge-runtime-manifest.v1.json" <<'PY'
import json, re, sys
from pathlib import Path

path = Path(sys.argv[1])
raw = path.read_bytes()
if not raw or len(raw) > 16384 or b'\x00' in raw or b'\r' in raw or b'\n' in raw:
    raise SystemExit(1)
value = json.loads(raw.decode('utf-8'))
if not isinstance(value, dict) or list(value) != [
    'contractVersion', 'deploymentTarget', 'pairingOnly', 'moneyMovementAllowed',
    'serverSignerId', 'serverSignerKeyId', 'serverSignerPublicKeySpkiSha256'
] or json.dumps(value, separators=(',', ':')).encode() != raw:
    raise SystemExit(1)
if value['contractVersion'] != 1 or value['deploymentTarget'] != 'staging' or \
        value['pairingOnly'] is not True or value['moneyMovementAllowed'] is not False or \
        value['serverSignerKeyId'] != 'companion-server-staging-v1' or \
        not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', value['serverSignerId']) or \
        not re.fullmatch(r'sha256:[0-9a-f]{64}', value['serverSignerPublicKeySpkiSha256']):
    raise SystemExit(1)
print(value['serverSignerPublicKeySpkiSha256'])
PY
  )" || die 'the companion runtime manifest is invalid'
  derived_digest="sha256:$(openssl pkey -inform DER \
    -in "$incoming/companion-device-bridge-server-signer.pkcs8.der" -pubout -outform DER 2>/dev/null |
    sha256sum | awk '{print $1}')"
  [[ "$derived_digest" == "$manifest_digest" ]] ||
    die 'the companion signer does not match the runtime manifest'
}

install_release() {
  local commit_sha="$1" image_tag="$2" incoming="$3" release installing
  release="$(release_path "$commit_sha")"
  installing="$RELEASE_ROOT/.installing-$commit_sha"
  if [[ -d "$release" && ! -L "$release" ]]; then
    require_release_files "$commit_sha" "$image_tag"
    rm -rf -- "$incoming"
    return 0
  fi
  [[ ! -e "$release" && ! -L "$release" && ! -e "$installing" && ! -L "$installing" ]] ||
    die 'the companion release destination is not empty'
  install -d -o root -g root -m 0755 "$RELEASE_ROOT" "$installing" \
    "$installing/infra" "$installing/configs" "$installing/secrets"
  install -o root -g root -m 0444 "$incoming/compose.companion-device-pairing.yaml" \
    "$installing/infra/compose.companion-device-pairing.yaml"
  install -o root -g root -m 0444 "$incoming/companion-device-bridge-runtime-manifest.v1.json" \
    "$installing/configs/companion-device-bridge-runtime-manifest.v1.json"
  install -o root -g root -m 0444 "$incoming/supabase-ca.crt" \
    "$installing/configs/supabase-ca.crt"
  install -o 10001 -g 10001 -m 0400 "$incoming/companion-device-bridge-database-url" \
    "$installing/secrets/companion-device-bridge-database-url"
  install -o 10001 -g 10001 -m 0400 "$incoming/companion-device-bridge-server-signer.pkcs8.der" \
    "$installing/secrets/companion-device-bridge-server-signer.pkcs8.der"
  docker_local image load --input "$incoming/fetanagent-companion-device-bridge.tar" >/dev/null
  require_release_files_at "$installing" "$commit_sha" "$image_tag"
  mv -- "$installing" "$release"
  sync -f "$RELEASE_ROOT"
  require_release_files "$commit_sha" "$image_tag"
  rm -rf -- "$incoming"
}

command="${1:-}"
[[ $EUID -eq 0 ]] || die 'the helper must run as root through sudo'
[[ "${SUDO_USER:-}" == "$EXPECTED_SUDO_USER" ]] ||
  die 'the helper requires the dedicated deployment identity'
[[ ! -L "$HELPER_PATH" && -f "$HELPER_PATH" &&
  "$(realpath -- "$HELPER_PATH")" == "$HELPER_PATH" &&
  "$(stat --format='%U:%G:%a:%h' "$HELPER_PATH")" == 'root:root:755:1' ]] ||
  die 'the installed helper path, ownership, or mode is unsafe'
installed_helper_identity="$(stat --format='%d:%i' "$HELPER_PATH")" ||
  die 'the installed helper identity could not be read'
executing_helper_identity="$(stat -L --format='%d:%i' -- "$0")" ||
  die 'the executing helper identity could not be read'
[[ "$executing_helper_identity" == "$installed_helper_identity" ]] ||
  die 'the executing helper is not the installed helper'
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || die 'Docker overrides are forbidden'

case "$command" in
  verify)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{64}$ ]] || die 'verify requires one SHA-256 digest'
    [[ "$(sha256sum "$HELPER_PATH" | awk '{print $1}')" == "$2" ]] ||
      die 'the installed helper does not match the reviewed repository helper'
    ;;

  install)
    [[ $# -eq 4 ]] || die 'install requires a commit, image tag, and incoming directory'
    validate_release "$2" "$3"
    [[ "$4" == "/tmp/fetanagent-companion-$2" && ! -L "$4" && -d "$4" &&
      "$(stat --format='%U:%a' "$4")" == "$EXPECTED_SUDO_USER:700" ]] ||
      die 'the incoming companion directory is outside the approved boundary'
    acquire_mutation_lock
    require_host_identity
    validate_incoming_material "$4"
    install_commit="$2"
    installing="$RELEASE_ROOT/.installing-$install_commit"
    cleanup_failed_install() {
      local status=$?
      trap - EXIT
      if [[ "$status" -ne 0 &&
        "$installing" == "$RELEASE_ROOT/.installing-$install_commit" &&
        -d "$installing" && ! -L "$installing" ]]; then
        rm -rf -- "$installing"
      fi
      exit "$status"
    }
    trap cleanup_failed_install EXIT
    install_release "$2" "$3" "$4"
    trap - EXIT
    ;;

  activate)
    [[ $# -eq 3 ]] || die 'activate requires a commit and image tag'
    validate_release "$2" "$3"
    acquire_mutation_lock
    require_host_identity
    previous_release="$(read_current_release || true)"
    stop_release
    if ! start_release "$2" "$3"; then
      compose_run "$2" "$3" down --remove-orphans --timeout 20 >/dev/null 2>&1 || true
      if [[ "$previous_release" =~ ^[0-9a-f]{40}$ && "$previous_release" != "$2" ]]; then
        start_release "$previous_release" "${previous_release:0:12}" || true
      fi
      die 'the companion release did not become healthy'
    fi
    ;;

  ready)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{40}$ ]] || die 'ready requires one full commit SHA'
    acquire_mutation_lock
    require_host_identity
    require_ready_release "$2" "${2:0:12}"
    printf '%s\n' 'Companion pairing bridge ready: pairing only; lookup and money movement disabled.'
    ;;

  stop)
    [[ $# -eq 1 ]] || die 'stop accepts no additional arguments'
    acquire_mutation_lock
    require_host_identity
    stop_release
    printf '%s\n' 'Companion pairing bridge stopped; no financial runtime was changed.'
    ;;

  discard)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{40}$ ]] || die 'discard requires one full commit SHA'
    acquire_mutation_lock
    incoming="/tmp/fetanagent-companion-$2"
    if [[ -e "$incoming" || -L "$incoming" ]]; then
      [[ ! -L "$incoming" && -d "$incoming" &&
        "$(stat --format='%U:%a' "$incoming")" == "$EXPECTED_SUDO_USER:700" ]] ||
        die 'the incoming companion cleanup target is unsafe'
      rm -rf -- "$incoming"
    fi
    ;;

  *) die 'expected verify, install, activate, ready, stop, or discard' ;;
esac
