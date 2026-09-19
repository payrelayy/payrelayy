#!/bin/bash
set -euo pipefail
IFS=$'\n\t'
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
LC_ALL=C
LANG=C
export PATH LC_ALL LANG
unset BASH_ENV CDPATH ENV DOCKER_API_VERSION DOCKER_CERT_PATH DOCKER_CONFIG DOCKER_CONTEXT
unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CLI_PLUGIN_EXTRA_DIRS COMPOSE_FILE COMPOSE_PROFILES
unset COMPOSE_PROJECT_NAME COMPOSE_PATH_SEPARATOR COMPOSE_ENV_FILES COMPOSE_DISABLE_ENV_FILE
umask 077

readonly PROJECT_NAME='fetanagent-production-trusted-telebirr-verifier'
readonly VERIFIER_NETWORK_KEY='trusted_telebirr_verifier_database_egress'
readonly VERIFIER_NETWORK_NAME="${PROJECT_NAME}_${VERIFIER_NETWORK_KEY}"
readonly ROOT='/srv/fetanagent/production-trusted-telebirr-verifier'
readonly RELEASE_ROOT="$ROOT/releases"
readonly STATE_ROOT='/var/lib/fetanagent/production-trusted-telebirr-verifier'
readonly CREDENTIAL_ROOT="$STATE_ROOT/credentials"
readonly ACTIVE_RECORD="$STATE_ROOT/active-record"
readonly EMERGENCY_FENCE="$STATE_ROOT/emergency-fence"
readonly PRODUCTION_STATE_ROOT='/var/lib/fetanagent/production'
readonly HELPER_PATH='/usr/local/sbin/fetanagent-production-trusted-telebirr-verifier-helper'
readonly EXPECTED_COMPOSE_SHA256='fc46313c95b1c71afd9f3d33c4304110a31f7da1342e22b17ace4a16b6c1901b'

die() {
  printf 'fetanagent production trusted TeleBirr verifier helper: %s\n' "$*" >&2
  exit 1
}

[[ "$(id -u)" == '0' ]] || die 'root execution is required'

require_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || die 'an exact 40-character commit SHA is required'
}

require_tag() {
  [[ "$1" =~ ^[0-9a-f]{12}$ ]] || die 'an exact 12-character image tag is required'
}

require_pin_digest() {
  [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'an exact pin-manifest SHA-256 is required'
}

require_uuid() {
  [[ "$1" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
    die 'an exact lowercase UUID is required'
}

require_request_key() {
  [[ "$1" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
    die 'an exact lowercase UUIDv4 request key is required'
}

release_dir() {
  require_sha "$1"
  printf '%s/%s\n' "$RELEASE_ROOT" "$1"
}

acquire_operation_locks() {
  local shared_lock verifier_lock lock
  command -v flock >/dev/null || die 'the production operation lock is unavailable'
  [[ ! -L "$PRODUCTION_STATE_ROOT" && -d "$PRODUCTION_STATE_ROOT" &&
    "$(stat --format='%u:%g:%a' "$PRODUCTION_STATE_ROOT")" == '0:0:700' ]] ||
    die 'the shared production state directory is unavailable'
  [[ ! -L "$STATE_ROOT" ]] || die 'the verifier state directory is unsafe'
  if [[ ! -e "$STATE_ROOT" ]]; then install -d -m 0700 -o root -g root "$STATE_ROOT"; fi
  [[ -d "$STATE_ROOT" && "$(stat --format='%u:%g:%a' "$STATE_ROOT")" == '0:0:700' ]] ||
    die 'the verifier state directory is unsafe'
  [[ ! -L "$CREDENTIAL_ROOT" ]] || die 'the verifier credential directory is unsafe'
  if [[ ! -e "$CREDENTIAL_ROOT" ]]; then
    install -d -m 0700 -o root -g root "$CREDENTIAL_ROOT"
  fi
  [[ -d "$CREDENTIAL_ROOT" && "$(stat --format='%u:%g:%a' "$CREDENTIAL_ROOT")" == '0:0:700' ]] ||
    die 'the verifier credential directory is unsafe'
  shared_lock="$PRODUCTION_STATE_ROOT/helper.lock"
  verifier_lock="$STATE_ROOT/helper.lock"
  for lock in "$shared_lock" "$verifier_lock"; do
    [[ ! -L "$lock" ]] || die 'a production operation lock is unsafe'
    if [[ -e "$lock" ]]; then
      [[ -f "$lock" && "$(stat --format='%u:%g:%a' "$lock")" == '0:0:600' ]] ||
        die 'a production operation lock is unsafe'
    fi
  done
  exec 8>>"$shared_lock"
  flock --nonblock 8 || die 'another production operation is in progress'
  exec 9>>"$verifier_lock"
  flock --nonblock 9 || die 'another verifier operation is in progress'
}

require_release() {
  local sha="$1" release
  release="$(release_dir "$sha")"
  [[ ! -L "$release" && -d "$release" && "$(realpath -- "$release")" == "$release" ]] ||
    die 'the exact verifier release is absent or unsafe'
  [[ "$(<"$release/.release-sha")" == "$sha" ]] || die 'the release marker is wrong'
  printf '%s\n' "$release"
}

verifier_container_ids() {
  timeout --signal=TERM --kill-after=5s 20s \
    docker container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=trusted-telebirr-verifier'
}

container_for_verifier() {
  local output
  local -a matches=()
  output="$(verifier_container_ids)" || die 'the production verifier container inventory failed'
  if [[ -n "$output" ]]; then mapfile -t matches <<<"$output"; fi
  [[ "${#matches[@]}" -le 1 ]] || die 'multiple production verifier containers are present'
  if [[ "${#matches[@]}" -eq 1 ]]; then printf '%s\n' "${matches[0]}"; fi
}

assert_verifier_container_absent() {
  [[ -z "$(container_for_verifier)" ]] ||
    die 'the production verifier container remains present'
}

remove_inactive_verifier_network() {
  local state
  if ! timeout --signal=TERM --kill-after=5s 20s \
    docker network inspect "$VERIFIER_NETWORK_NAME" >/dev/null 2>&1; then
    return 0
  fi
  state="$(timeout --signal=TERM --kill-after=5s 20s docker network inspect \
    --format '{{.Name}}|{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.network"}}|{{len .Containers}}' \
    "$VERIFIER_NETWORK_NAME")" || die 'the inactive verifier network inspection failed'
  [[ "$state" == "$VERIFIER_NETWORK_NAME|$PROJECT_NAME|$VERIFIER_NETWORK_KEY|0" ]] ||
    die 'the inactive verifier network is not exact and empty'
  timeout --signal=TERM --kill-after=5s 20s \
    docker network rm "$VERIFIER_NETWORK_NAME" >/dev/null ||
    die 'the inactive verifier network could not be removed'
  if timeout --signal=TERM --kill-after=5s 20s \
    docker network inspect "$VERIFIER_NETWORK_NAME" >/dev/null 2>&1; then
    die 'the inactive verifier network remains present'
  fi
}

prepared_credential_dir() {
  require_request_key "$1"
  printf '%s/%s\n' "$CREDENTIAL_ROOT" "$1"
}

verify_prepared_credential() {
  local sha="$1" request_key="$2" pin_digest="$3" credential_dir database_pattern name
  credential_dir="$(prepared_credential_dir "$request_key")"
  require_sha "$sha"
  require_pin_digest "$pin_digest"
  [[ ! -L "$credential_dir" && -d "$credential_dir" &&
    "$(realpath -- "$credential_dir")" == "$credential_dir" &&
    "$(stat --format='%u:%g:%a' "$credential_dir")" == '0:0:700' ]] ||
    die 'the prepared verifier credential directory is unsafe'
  [[ "$(find -P "$credential_dir" -mindepth 1 -maxdepth 1 -type f | wc -l)" -eq 3 &&
    -z "$(find -P "$credential_dir" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
    die 'the prepared verifier credential shape is wrong'
  for name in trusted-telebirr-verifier-database-url .release-sha .pin-manifest-sha256; do
    [[ ! -L "$credential_dir/$name" && -f "$credential_dir/$name" && -s "$credential_dir/$name" ]] ||
      die "the prepared verifier credential is missing $name"
  done
  [[ "$(stat --format='%u:%g:%a' "$credential_dir/trusted-telebirr-verifier-database-url")" == \
    '10001:10001:400' ]] || die 'the prepared verifier credential metadata is wrong'
  for name in .release-sha .pin-manifest-sha256; do
    [[ "$(stat --format='%u:%g:%a' "$credential_dir/$name")" == '0:0:444' ]] ||
      die "the prepared verifier marker metadata is wrong for $name"
  done
  [[ "$(<"$credential_dir/.release-sha")" == "$sha" ]] ||
    die 'the prepared verifier release marker is wrong'
  [[ "$(<"$credential_dir/.pin-manifest-sha256")" == "$pin_digest" ]] ||
    die 'the prepared verifier pin marker is wrong'
  database_pattern='^postgresql://fetanagent_trusted_telebirr_verifier_runtime:[0-9a-f]{64}@db\.xzztugbgtulptnbpoelr\.supabase\.co:5432/postgres\?sslmode=verify-full$'
  [[ "$(<"$credential_dir/trusted-telebirr-verifier-database-url")" =~ $database_pattern ]] ||
    die 'the prepared verifier runtime URL is not exact'
  printf '%s\n' "$credential_dir"
}

remove_prepared_credential() {
  local request_key="$1" credential_dir name
  credential_dir="$(prepared_credential_dir "$request_key")"
  if [[ ! -e "$credential_dir" && ! -L "$credential_dir" ]]; then return 0; fi
  [[ ! -L "$credential_dir" && -d "$credential_dir" &&
    "$(realpath -- "$credential_dir")" == "$credential_dir" &&
    "$(stat --format='%u:%g:%a' "$credential_dir")" == '0:0:700' &&
    -z "$(find -P "$credential_dir" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
    die 'the prepared verifier credential cannot be removed safely'
  for name in trusted-telebirr-verifier-database-url .release-sha .pin-manifest-sha256; do
    if [[ -e "$credential_dir/$name" || -L "$credential_dir/$name" ]]; then
      [[ ! -L "$credential_dir/$name" && -f "$credential_dir/$name" ]] ||
        die 'the prepared verifier credential contains an unsafe entry'
    fi
  done
  find -P "$credential_dir" -mindepth 1 -maxdepth 1 -type f -delete
  rmdir -- "$credential_dir"
}

remove_all_runtime_material() {
  local credential_dir request_key
  [[ ! -L "$CREDENTIAL_ROOT" && -d "$CREDENTIAL_ROOT" &&
    "$(stat --format='%u:%g:%a' "$CREDENTIAL_ROOT")" == '0:0:700' ]] || return 1
  while IFS= read -r credential_dir; do
    request_key="${credential_dir##*/}"
    if [[ "$request_key" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]; then
      remove_prepared_credential "$request_key"
    elif [[ "$request_key" =~ ^\.incoming-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]; then
      [[ ! -L "$credential_dir" && "$(realpath -- "$credential_dir")" == "$credential_dir" &&
        "$(stat --format='%u:%g:%a' "$credential_dir")" == '0:0:700' &&
        -z "$(find -P "$credential_dir" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
        return 1
      find -P "$credential_dir" -mindepth 1 -maxdepth 1 -type f -delete
      rmdir -- "$credential_dir"
    else
      return 1
    fi
  done < <(find -P "$CREDENTIAL_ROOT" -mindepth 1 -maxdepth 1 -type d -print)
  [[ -z "$(find -P "$CREDENTIAL_ROOT" -mindepth 1 -maxdepth 1 -print -quit)" ]] || return 1
  if [[ -e "$ACTIVE_RECORD" || -L "$ACTIVE_RECORD" ]]; then
    [[ ! -L "$ACTIVE_RECORD" && -f "$ACTIVE_RECORD" &&
      "$(stat --format='%u:%g:%a' "$ACTIVE_RECORD")" == '0:0:600' ]] || return 1
    rm -f -- "$ACTIVE_RECORD"
  fi
}

arm_emergency_fence() {
  local pending="$STATE_ROOT/.emergency-fence.$$"
  [[ ! -L "$STATE_ROOT" ]] || return 1
  if [[ ! -e "$STATE_ROOT" ]]; then install -d -m 0700 -o root -g root "$STATE_ROOT"; fi
  [[ -d "$STATE_ROOT" && "$(stat --format='%u:%g:%a' "$STATE_ROOT")" == '0:0:700' ]] || return 1
  [[ ! -L "$EMERGENCY_FENCE" ]] || return 1
  if [[ -e "$EMERGENCY_FENCE" ]]; then
    [[ -f "$EMERGENCY_FENCE" &&
      "$(stat --format='%u:%g:%a' "$EMERGENCY_FENCE")" == '0:0:600' ]] || return 1
  fi
  rm -f -- "$pending"
  printf '%s\n' 'emergency-stop' >"$pending"
  chown root:root "$pending"
  chmod 0600 "$pending"
  mv -f -- "$pending" "$EMERGENCY_FENCE"
  [[ ! -L "$EMERGENCY_FENCE" && -f "$EMERGENCY_FENCE" &&
    "$(stat --format='%u:%g:%a' "$EMERGENCY_FENCE")" == '0:0:600' ]]
}

emergency_stop_verifier() {
  local attempt output state_status=0
  local -a ids=()
  command -v docker >/dev/null || die 'Docker is required for emergency stop'
  command -v timeout >/dev/null || die 'timeout is required for bounded emergency stop'

  # There is deliberately no operation-lock, release, current-link, or Compose dependency here.
  # Arm a persistent fence before scanning. A concurrent guarded start checks this fence before and
  # after service creation, while repeated exact-label scans remove any already-created container.
  arm_emergency_fence || state_status=1
  for attempt in 1 2 3; do
    output="$(verifier_container_ids)" || die 'the emergency container inventory failed'
    ids=()
    if [[ -n "$output" ]]; then mapfile -t ids <<<"$output"; fi
    if [[ "${#ids[@]}" -gt 0 ]]; then
      if ! timeout --signal=TERM --kill-after=5s 25s \
        docker container rm --force -- "${ids[@]}"; then
        printf '%s\n' 'An emergency removal attempt failed; rescanning every exact labeled container.' >&2
      fi
    fi
    if [[ "$attempt" != '3' ]]; then sleep 2; fi
  done
  output="$(verifier_container_ids)" || die 'the final emergency container inventory failed'
  [[ -z "$output" ]] || die 'a production verifier container remains present'
  if [[ ! -e "$CREDENTIAL_ROOT" ]]; then
    install -d -m 0700 -o root -g root "$CREDENTIAL_ROOT" || state_status=1
  fi
  remove_all_runtime_material || state_status=1
  [[ "$state_status" -eq 0 ]] || die 'the verifier stopped but protected runtime material needs administrator cleanup'
}

inspect_active_container() {
  local expected_image_id="$1" container_id="$2" state network_state
  local network_ipv6 network_internal network_project network_key network_count network_address
  state="$(timeout --signal=TERM --kill-after=5s 20s docker container inspect \
    --format '{{.Image}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' \
    "$container_id")" || die 'the production verifier container inspection failed'
  [[ "$state" == "$expected_image_id|true|healthy|$PROJECT_NAME|trusted-telebirr-verifier" ]] ||
    die 'the production verifier container is not exact and healthy'
  network_state="$(timeout --signal=TERM --kill-after=5s 20s docker network inspect \
    --format '{{.EnableIPv6}}|{{.Internal}}|{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.network"}}|{{len .Containers}}|{{range .Containers}}{{.IPv6Address}}{{end}}' \
    "$VERIFIER_NETWORK_NAME")" || die 'the production verifier network inspection failed'
  IFS='|' read -r network_ipv6 network_internal network_project network_key \
    network_count network_address <<<"$network_state"
  [[ "$network_ipv6" == 'true' && "$network_internal" == 'false' &&
    "$network_project" == "$PROJECT_NAME" && "$network_key" == "$VERIFIER_NETWORK_KEY" &&
    "$network_count" == '1' && "$network_address" =~ ^[0-9a-f:]+/[0-9]+$ ]] ||
    die 'the production verifier network is not exact and IPv6-enabled'
}

report_redacted_verifier_failure_stage() {
  local container_id="$1" diagnostic
  diagnostic="$(
    timeout --signal=TERM --kill-after=5s 20s docker container logs --tail 80 "$container_id" \
      2>/dev/null |
      grep -E '^FetanAgent trusted TeleBirr verifier failed closed at stage: (load_staged_evidence|unavailable|decode_request|load_first_authority|validate_first_authority|authenticate_first_evidence|load_second_authority|validate_second_authority|authenticate_second_evidence|derive_completion_input|persist_completion|validate_completion|persist_quarantine|unpersisted_result)\.$' |
      tail -n 1 || true
  )"
  if [[ -n "$diagnostic" ]]; then
    printf '%s\n' "$diagnostic" >&2
  fi
}

verify_active_record() {
  local sha="$1" request_key="$2" epoch="$3" pilot_revision_id="$4" expected
  [[ ! -L "$ACTIVE_RECORD" && -f "$ACTIVE_RECORD" &&
    "$(stat --format='%u:%g:%a' "$ACTIVE_RECORD")" == '0:0:600' ]] ||
    die 'the production verifier active record is unsafe'
  expected="$(printf '%s\n%s\n%s\n%s\n' "$sha" "$request_key" "$epoch" "$pilot_revision_id")"
  [[ "$(<"$ACTIVE_RECORD")" == "$expected" ]] ||
    die 'the production verifier active record does not match the activation'
}

verify_release() {
  local sha="$1" release="$2" tag image_id pin_digest database_pattern
  local -a required=(
    .image-id
    .image-tag
    .pin-manifest-sha256
    .release-sha
    compose.production-trusted-telebirr-verifier.yaml
    supabase-ca.crt
    trusted-telebirr-verifier-database-url
    trusted-telebirr-verifier-pins.v1.json
  )
  [[ "$(require_release "$sha")" == "$release" ]] || die 'the release path is not exact'
  [[ "$(find -P "$release" -mindepth 1 -maxdepth 1 -type f | wc -l)" -eq "${#required[@]}" ]] ||
    die 'the verifier release file count is wrong'
  [[ -z "$(find -P "$release" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
    die 'the verifier release contains a non-file entry'
  local name
  for name in "${required[@]}"; do
    [[ ! -L "$release/$name" && -f "$release/$name" && -s "$release/$name" ]] ||
      die "the verifier release is missing $name"
  done
  [[ "$(stat --format='%u:%g:%a' "$release/trusted-telebirr-verifier-database-url")" == '10001:10001:400' ]] ||
    die 'the verifier database secret metadata is wrong'
  for name in compose.production-trusted-telebirr-verifier.yaml supabase-ca.crt \
    trusted-telebirr-verifier-pins.v1.json .image-id .image-tag .pin-manifest-sha256 .release-sha; do
    [[ "$(stat --format='%u:%g:%a' "$release/$name")" == '0:0:444' ]] ||
      die "the verifier release metadata is wrong for $name"
  done

  tag="$(<"$release/.image-tag")"
  image_id="$(<"$release/.image-id")"
  pin_digest="$(<"$release/.pin-manifest-sha256")"
  require_tag "$tag"
  [[ "$tag" == "${sha:0:12}" ]] || die 'the image tag does not match the release SHA'
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'the recorded image ID is malformed'
  require_pin_digest "$pin_digest"
  [[ "sha256:$(sha256sum "$release/trusted-telebirr-verifier-pins.v1.json" | cut -d ' ' -f 1)" == "$pin_digest" ]] ||
    die 'the production verifier pin manifest digest changed'
  [[ "$(sha256sum "$release/compose.production-trusted-telebirr-verifier.yaml" | cut -d ' ' -f 1)" == \
    "$EXPECTED_COMPOSE_SHA256" ]] || die 'the production verifier Compose contract changed'
  [[ "$(docker image inspect "fetanagent-trusted-telebirr-verifier:$tag" --format '{{.Id}}')" == "$image_id" ]] ||
    die 'the commit-labelled verifier image no longer resolves to the recorded image ID'
  [[ "$(docker image inspect "$image_id" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$sha" ]] ||
    die 'the verifier image revision is wrong'
  [[ "$(docker image inspect "$image_id" --format '{{.Config.User}}')" == '10001:10001' ]] ||
    die 'the verifier image user is wrong'

  database_pattern='^postgresql://fetanagent_trusted_telebirr_verifier_runtime:[0-9a-f]{64}@db\.xzztugbgtulptnbpoelr\.supabase\.co:5432/postgres\?sslmode=verify-full$'
  [[ "$(<"$release/trusted-telebirr-verifier-database-url")" =~ $database_pattern ]] ||
    die 'the verifier database URL is not the exact scoped production direct URL'
  openssl x509 -in "$release/supabase-ca.crt" -noout -checkend 0 >/dev/null ||
    die 'the verifier CA is invalid or expired'
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
  ' "$release/trusted-telebirr-verifier-pins.v1.json" >/dev/null ||
    die 'the verifier pin manifest shape is invalid'
}

case "${1:-}" in
  preflight|prepare-incoming|cleanup-incoming|install|prepare-activation|discard-activation|start-activated|status-inert|status-active)
    acquire_operation_locks
    ;;
esac

case "${1:-}" in
  verify)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{64}$ ]] || die 'verify requires one SHA-256 digest'
    [[ "$(sha256sum "$HELPER_PATH" | cut -d ' ' -f 1)" == "$2" ]] ||
      die 'installed helper digest mismatch'
    ;;

  preflight)
    [[ $# -eq 2 && "$2" =~ ^[1-9][0-9]*$ ]] ||
      die 'preflight requires the image-bundle byte count'
    command -v docker >/dev/null
    command -v jq >/dev/null
    command -v openssl >/dev/null
    docker compose version >/dev/null
    install -d -m 0700 -o root -g root "$ROOT" "$RELEASE_ROOT" "$STATE_ROOT" "$CREDENTIAL_ROOT"
    available="$(df --output=avail --block-size=1 "$ROOT" | tail -n 1 | tr -d ' ')"
    [[ "$available" =~ ^[0-9]+$ && "$available" -gt $((2 * $2 + 536870912)) ]] ||
      die 'insufficient storage for the verifier release and staging margin'
    ;;

  prepare-incoming)
    [[ $# -eq 2 ]] || die 'prepare-incoming requires one commit SHA'
    sha="$2"
    require_sha "$sha"
    incoming="/tmp/fetanagent-production-trusted-telebirr-verifier-$sha"
    [[ ! -e "$incoming" && ! -L "$incoming" ]] || die 'the verifier incoming path already exists'
    install -d -m 0700 -o fetanagent-admin -g fetanagent-admin "$incoming"
    ;;

  cleanup-incoming)
    [[ $# -eq 2 ]] || die 'cleanup-incoming requires one commit SHA'
    sha="$2"
    require_sha "$sha"
    incoming="/tmp/fetanagent-production-trusted-telebirr-verifier-$sha"
    if [[ -e "$incoming" || -L "$incoming" ]]; then
      [[ ! -L "$incoming" && -d "$incoming" && "$(realpath -- "$incoming")" == "$incoming" &&
        ( "$(stat --format='%U:%G:%a' "$incoming")" == 'fetanagent-admin:fetanagent-admin:700' ||
          "$(stat --format='%U:%G:%a' "$incoming")" == 'root:root:700' ) &&
        -z "$(find -P "$incoming" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
        die 'the verifier incoming path is unsafe'
      find -P "$incoming" -mindepth 1 -maxdepth 1 -type f -delete
      rmdir -- "$incoming"
    fi
    sealed="$RELEASE_ROOT/.incoming-$sha"
    if [[ -e "$sealed" || -L "$sealed" ]]; then
      [[ ! -L "$sealed" && -d "$sealed" && "$(realpath -- "$sealed")" == "$sealed" &&
        "$(stat --format='%U:%G:%a' "$sealed")" == 'root:root:700' &&
        -z "$(find -P "$sealed" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
        die 'the sealed verifier staging path is unsafe'
      find -P "$sealed" -mindepth 1 -maxdepth 1 -type f -delete
      rmdir -- "$sealed"
    fi
    ;;

  install)
    [[ $# -eq 5 ]] || die 'install requires commit SHA, tag, pin digest, and incoming directory'
    sha="$2"
    tag="$3"
    pin_digest="$4"
    incoming="$5"
    assert_verifier_container_absent
    require_sha "$sha"
    require_tag "$tag"
    require_pin_digest "$pin_digest"
    [[ "$tag" == "${sha:0:12}" ]] || die 'the image tag does not match the commit SHA'
    [[ "$incoming" == "/tmp/fetanagent-production-trusted-telebirr-verifier-$sha" ]] ||
      die 'the verifier incoming path is not exact'
    [[ ! -L "$incoming" && -d "$incoming" && "$(realpath -- "$incoming")" == "$incoming" &&
      "$(stat --format='%U:%G:%a' "$incoming")" == 'fetanagent-admin:fetanagent-admin:700' ]] ||
      die 'the verifier incoming directory is unsafe'

    # Claim the directory entry without following a replacement link, then verify that the
    # exact inode we inspected is now root-owned. The sticky /tmp parent and mode 0700 prevent
    # the SSH principal from replacing entries after this point. Individual files can still
    # have pre-opened writers, so they are copied into a separate root-only staging directory
    # and every content/shape check below is repeated against that sealed copy.
    incoming_identity="$(stat --format='%d:%i' "$incoming")"
    chown --no-dereference root:root "$incoming"
    [[ ! -L "$incoming" && -d "$incoming" && "$(realpath -- "$incoming")" == "$incoming" &&
      "$(stat --format='%d:%i:%U:%G:%a' "$incoming")" == "$incoming_identity:root:root:700" ]] ||
      die 'the verifier incoming directory changed while it was claimed'
    [[ "$(find -P "$incoming" -mindepth 1 -maxdepth 1 -type f | wc -l)" -eq 5 &&
      -z "$(find -P "$incoming" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
      die 'the verifier incoming bundle shape is wrong'
    for name in fetanagent-trusted-telebirr-verifier-image.tar \
      compose.production-trusted-telebirr-verifier.yaml supabase-ca.crt \
      trusted-telebirr-verifier-database-url trusted-telebirr-verifier-pins.v1.json; do
      [[ ! -L "$incoming/$name" && -f "$incoming/$name" && -s "$incoming/$name" ]] ||
        die "the verifier incoming bundle is missing $name"
    done
    [[ "sha256:$(sha256sum "$incoming/trusted-telebirr-verifier-pins.v1.json" | cut -d ' ' -f 1)" == "$pin_digest" ]] ||
      die 'the supplied production verifier pin digest does not match'
    [[ "$(sha256sum "$incoming/compose.production-trusted-telebirr-verifier.yaml" | cut -d ' ' -f 1)" == \
      "$EXPECTED_COMPOSE_SHA256" ]] || die 'the supplied verifier Compose contract is not exact'

    release="$RELEASE_ROOT/$sha"
    if [[ -e "$release" || -L "$release" ]]; then
      verify_release "$sha" "$release"
      [[ "$(<"$release/.pin-manifest-sha256")" == "$pin_digest" ]] ||
        die 'the existing release has a different pin manifest'
      find -P "$incoming" -mindepth 1 -maxdepth 1 -type f -delete
      rmdir -- "$incoming"
      exit 0
    fi

    sealed="$RELEASE_ROOT/.incoming-$sha"
    if [[ -e "$sealed" || -L "$sealed" ]]; then
      [[ ! -L "$sealed" && -d "$sealed" && "$(realpath -- "$sealed")" == "$sealed" &&
        "$(stat --format='%U:%G:%a' "$sealed")" == 'root:root:700' &&
        -z "$(find -P "$sealed" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
        die 'the sealed verifier staging path is unsafe'
      find -P "$sealed" -mindepth 1 -maxdepth 1 -type f -delete
      rmdir -- "$sealed"
    fi
    install -d -m 0700 -o root -g root "$sealed"
    for name in fetanagent-trusted-telebirr-verifier-image.tar \
      compose.production-trusted-telebirr-verifier.yaml supabase-ca.crt \
      trusted-telebirr-verifier-database-url trusted-telebirr-verifier-pins.v1.json; do
      cp --no-dereference --reflink=never -- "$incoming/$name" "$sealed/$name"
      [[ ! -L "$sealed/$name" && -f "$sealed/$name" && -s "$sealed/$name" &&
        "$(stat --format='%U:%G:%h' "$sealed/$name")" == 'root:root:1' ]] ||
        die "the sealed verifier bundle is unsafe for $name"
    done
    find -P "$incoming" -mindepth 1 -maxdepth 1 -type f -delete
    rmdir -- "$incoming"

    [[ "sha256:$(sha256sum "$sealed/trusted-telebirr-verifier-pins.v1.json" | cut -d ' ' -f 1)" == "$pin_digest" ]] ||
      die 'the sealed production verifier pin digest does not match'
    [[ "$(sha256sum "$sealed/compose.production-trusted-telebirr-verifier.yaml" | cut -d ' ' -f 1)" == \
      "$EXPECTED_COMPOSE_SHA256" ]] || die 'the sealed verifier Compose contract is not exact'

    docker load --input "$sealed/fetanagent-trusted-telebirr-verifier-image.tar" >/dev/null
    image_id="$(docker image inspect "fetanagent-trusted-telebirr-verifier:$tag" --format '{{.Id}}')"
    [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'the loaded verifier image ID is invalid'
    [[ "$(docker image inspect "$image_id" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$sha" ]] ||
      die 'the loaded verifier image revision is wrong'
    rm -f -- "$sealed/fetanagent-trusted-telebirr-verifier-image.tar"
    printf '%s\n' "$sha" >"$sealed/.release-sha"
    printf '%s\n' "$tag" >"$sealed/.image-tag"
    printf '%s\n' "$image_id" >"$sealed/.image-id"
    printf '%s\n' "$pin_digest" >"$sealed/.pin-manifest-sha256"
    chmod 0700 "$sealed"
    chmod 0444 \
      "$sealed/compose.production-trusted-telebirr-verifier.yaml" \
      "$sealed/supabase-ca.crt" \
      "$sealed/trusted-telebirr-verifier-pins.v1.json" \
      "$sealed/.release-sha" "$sealed/.image-tag" \
      "$sealed/.image-id" "$sealed/.pin-manifest-sha256"
    chown 10001:10001 "$sealed/trusted-telebirr-verifier-database-url"
    chmod 0400 "$sealed/trusted-telebirr-verifier-database-url"
    mv -- "$sealed" "$release"
    verify_release "$sha" "$release"
    ;;

  prepare-activation)
    [[ $# -eq 4 ]] || die 'prepare-activation requires commit SHA, request key, and pin digest'
    sha="$2"
    request_key="$3"
    pin_digest="$4"
    require_sha "$sha"
    require_request_key "$request_key"
    require_pin_digest "$pin_digest"
    assert_verifier_container_absent
    release="$(require_release "$sha")"
    verify_release "$sha" "$release"
    [[ "$(<"$release/.pin-manifest-sha256")" == "$pin_digest" ]] ||
      die 'the release pin digest does not match the activation confirmation'
    incoming="/tmp/fetanagent-production-trusted-telebirr-verifier-credential-$request_key"
    [[ ! -L "$incoming" && -f "$incoming" &&
      "$(stat --format='%U:%G:%a:%h' "$incoming")" == 'fetanagent-admin:fetanagent-admin:600:1' ]] ||
      die 'the activation credential incoming file is unsafe'
    incoming_identity="$(stat --format='%d:%i' "$incoming")"
    chown --no-dereference root:root "$incoming"
    [[ ! -L "$incoming" && -f "$incoming" &&
      "$(stat --format='%d:%i:%U:%G:%a:%h' "$incoming")" == "$incoming_identity:root:root:600:1" ]] ||
      die 'the activation credential changed while it was claimed'
    database_pattern='^postgresql://fetanagent_trusted_telebirr_verifier_runtime:[0-9a-f]{64}@db\.xzztugbgtulptnbpoelr\.supabase\.co:5432/postgres\?sslmode=verify-full$'
    [[ "$(<"$incoming")" =~ $database_pattern ]] || die 'the activation credential URL is not exact'
    [[ -z "$(find -P "$CREDENTIAL_ROOT" -mindepth 1 -maxdepth 1 -print -quit)" ]] ||
      die 'another prepared verifier credential already exists'
    sealed="$CREDENTIAL_ROOT/.incoming-$request_key"
    credential_dir="$CREDENTIAL_ROOT/$request_key"
    [[ ! -e "$sealed" && ! -L "$sealed" && ! -e "$credential_dir" && ! -L "$credential_dir" ]] ||
      die 'the activation credential staging path already exists'

    cleanup_prepare_activation() {
      local command_status=$?
      trap - EXIT
      if [[ -f "$incoming" && ! -L "$incoming" ]]; then rm -f -- "$incoming"; fi
      for cleanup_dir in "$sealed" "$credential_dir"; do
        if [[ -d "$cleanup_dir" && ! -L "$cleanup_dir" &&
          "$(realpath -- "$cleanup_dir")" == "$cleanup_dir" ]]; then
          find -P "$cleanup_dir" -mindepth 1 -maxdepth 1 -type f -delete
          rmdir -- "$cleanup_dir"
        fi
      done
      exit "$command_status"
    }
    trap cleanup_prepare_activation EXIT
    install -d -m 0700 -o root -g root "$sealed"
    cp --no-dereference --reflink=never -- "$incoming" \
      "$sealed/trusted-telebirr-verifier-database-url"
    rm -f -- "$incoming"
    printf '%s\n' "$sha" >"$sealed/.release-sha"
    printf '%s\n' "$pin_digest" >"$sealed/.pin-manifest-sha256"
    chown 10001:10001 "$sealed/trusted-telebirr-verifier-database-url"
    chmod 0400 "$sealed/trusted-telebirr-verifier-database-url"
    chmod 0444 "$sealed/.release-sha" "$sealed/.pin-manifest-sha256"
    mv -- "$sealed" "$credential_dir"
    verify_prepared_credential "$sha" "$request_key" "$pin_digest" >/dev/null
    if [[ -e "$EMERGENCY_FENCE" || -L "$EMERGENCY_FENCE" ]]; then
      [[ ! -L "$EMERGENCY_FENCE" && -f "$EMERGENCY_FENCE" &&
        "$(stat --format='%u:%g:%a' "$EMERGENCY_FENCE")" == '0:0:600' ]] ||
        die 'the previous emergency fence is unsafe'
      rm -f -- "$EMERGENCY_FENCE"
    fi
    trap - EXIT
    printf '%s\n' 'Production trusted TeleBirr verifier: one credential prepared; service remains absent.'
    ;;

  discard-activation)
    [[ $# -eq 2 ]] || die 'discard-activation requires one request key'
    request_key="$2"
    require_request_key "$request_key"
    assert_verifier_container_absent
    incoming="/tmp/fetanagent-production-trusted-telebirr-verifier-credential-$request_key"
    if [[ -e "$incoming" || -L "$incoming" ]]; then
      [[ ! -L "$incoming" && -f "$incoming" &&
        ( "$(stat --format='%U:%G:%a' "$incoming")" == 'fetanagent-admin:fetanagent-admin:600' ||
          "$(stat --format='%U:%G:%a' "$incoming")" == 'root:root:600' ) ]] ||
        die 'the activation credential incoming file cannot be removed safely'
      rm -f -- "$incoming"
    fi
    remove_prepared_credential "$request_key"
    if [[ -e "$ACTIVE_RECORD" || -L "$ACTIVE_RECORD" ]]; then
      [[ ! -L "$ACTIVE_RECORD" && -f "$ACTIVE_RECORD" &&
        "$(stat --format='%u:%g:%a' "$ACTIVE_RECORD")" == '0:0:600' ]] ||
        die 'the inactive verifier record cannot be removed safely'
      mapfile -t active_record_lines <"$ACTIVE_RECORD"
      [[ "${#active_record_lines[@]}" -eq 4 && "${active_record_lines[1]}" == "$request_key" ]] ||
        die 'the inactive verifier record belongs to a different activation'
      rm -f -- "$ACTIVE_RECORD"
    fi
    printf '%s\n' 'Production trusted TeleBirr verifier: requested inactive credential absent.'
    ;;

  start-activated)
    [[ $# -eq 6 ]] ||
      die 'start-activated requires commit SHA, request key, epoch, pilot revision, and pin digest'
    sha="$2"
    request_key="$3"
    epoch="$4"
    pilot_revision_id="$5"
    pin_digest="$6"
    require_sha "$sha"
    require_request_key "$request_key"
    [[ "$epoch" =~ ^[1-9][0-9]*$ ]] || die 'a positive activation epoch is required'
    require_uuid "$pilot_revision_id"
    require_pin_digest "$pin_digest"
    assert_verifier_container_absent
    [[ ! -e "$ACTIVE_RECORD" && ! -L "$ACTIVE_RECORD" ]] ||
      die 'an active verifier record already exists'
    [[ ! -e "$EMERGENCY_FENCE" && ! -L "$EMERGENCY_FENCE" ]] ||
      die 'an emergency fence blocks verifier start'
    release="$(require_release "$sha")"
    verify_release "$sha" "$release"
    credential_dir="$(verify_prepared_credential "$sha" "$request_key" "$pin_digest")"
    image_id="$(<"$release/.image-id")"
    # Compose does not mutate an already-created bridge from IPv4-only to dual-stack. Replace only
    # the exact empty project network before start so the sealed enable_ipv6 contract takes effect.
    remove_inactive_verifier_network

    rollback_host_start() {
      local command_status=$?
      trap - EXIT INT TERM
      if [[ -n "${pending_record:-}" && -f "$pending_record" && ! -L "$pending_record" ]]; then
        rm -f -- "$pending_record"
      fi
      emergency_stop_verifier
      exit "$command_status"
    }
    trap rollback_host_start EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM

    FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_IMAGE_ID="$image_id" \
    FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_SECRET_FILE="$credential_dir/trusted-telebirr-verifier-database-url" \
    FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_CONFIG_FILE="$release/trusted-telebirr-verifier-pins.v1.json" \
    FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_CONFIG_FILE="$release/supabase-ca.crt" \
    FETANAGENT_PRODUCTION_TRUSTED_TELEBIRR_FINANCIAL_ACTIONS_MODE='live' \
    FETANAGENT_PRODUCTION_INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED='true' \
    FETANAGENT_PRODUCTION_TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED='true' \
      timeout --signal=TERM --kill-after=10s 90s docker compose \
        --project-directory "$release" --env-file /dev/null \
        --file "$release/compose.production-trusted-telebirr-verifier.yaml" \
        --profile production-trusted-telebirr-verifier \
        up --detach --no-build --no-deps trusted-telebirr-verifier

    for attempt in {1..45}; do
      [[ ! -e "$EMERGENCY_FENCE" && ! -L "$EMERGENCY_FENCE" ]] ||
        die 'an emergency fence interrupted verifier start'
      container_id="$(container_for_verifier)"
      [[ -n "$container_id" ]] || die 'the production verifier container was not created'
      health="$(timeout --signal=TERM --kill-after=5s 20s docker container inspect \
        --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id")" ||
        die 'the verifier health inspection failed'
      if [[ "$health" == 'healthy' ]]; then break; fi
      if [[ "$health" != 'starting' ]]; then
        report_redacted_verifier_failure_stage "$container_id"
        die 'the verifier became unhealthy during startup'
      fi
      [[ "$attempt" != '45' ]] || die 'the verifier did not become healthy before the deadline'
      sleep 2
    done
    inspect_active_container "$image_id" "$container_id"
    [[ ! -e "$EMERGENCY_FENCE" && ! -L "$EMERGENCY_FENCE" ]] ||
      die 'an emergency fence interrupted verifier finalization'
    pending_record="$STATE_ROOT/.active-record.$$"
    [[ ! -e "$pending_record" && ! -L "$pending_record" ]] ||
      die 'the production verifier active-record staging path is unsafe'
    printf '%s\n%s\n%s\n%s\n' "$sha" "$request_key" "$epoch" "$pilot_revision_id" >"$pending_record"
    chown root:root "$pending_record"
    chmod 0600 "$pending_record"
    mv -- "$pending_record" "$ACTIVE_RECORD"
    verify_active_record "$sha" "$request_key" "$epoch" "$pilot_revision_id"
    [[ ! -e "$EMERGENCY_FENCE" && ! -L "$EMERGENCY_FENCE" ]] ||
      die 'an emergency fence interrupted verifier completion'
    inspect_active_container "$image_id" "$container_id"
    trap - EXIT INT TERM
    printf '%s\n' 'Production trusted TeleBirr verifier: exact service is healthy.'
    ;;

  status-inert)
    [[ $# -eq 1 ]] || die 'status-inert accepts no arguments'
    assert_verifier_container_absent
    [[ -z "$(find -P "$CREDENTIAL_ROOT" -mindepth 1 -maxdepth 1 -print -quit)" ]] ||
      die 'an inactive verifier credential remains prepared'
    [[ ! -e "$ACTIVE_RECORD" && ! -L "$ACTIVE_RECORD" ]] ||
      die 'an inactive verifier active record remains present'
    printf '%s\n' 'Production trusted TeleBirr verifier: inert; no service or runtime credential exists.'
    ;;

  status-active)
    [[ $# -eq 6 ]] ||
      die 'status-active requires commit SHA, request key, epoch, pilot revision, and pin digest'
    sha="$2"
    request_key="$3"
    epoch="$4"
    pilot_revision_id="$5"
    pin_digest="$6"
    require_sha "$sha"
    require_request_key "$request_key"
    [[ "$epoch" =~ ^[1-9][0-9]*$ ]] || die 'a positive activation epoch is required'
    require_uuid "$pilot_revision_id"
    require_pin_digest "$pin_digest"
    release="$(require_release "$sha")"
    verify_release "$sha" "$release"
    verify_prepared_credential "$sha" "$request_key" "$pin_digest" >/dev/null
    verify_active_record "$sha" "$request_key" "$epoch" "$pilot_revision_id"
    [[ ! -e "$EMERGENCY_FENCE" && ! -L "$EMERGENCY_FENCE" ]] ||
      die 'an emergency fence is active'
    container_id="$(container_for_verifier)"
    [[ -n "$container_id" ]] || die 'the production verifier container is absent'
    inspect_active_container "$(<"$release/.image-id")" "$container_id"
    printf '%s\n' 'Production trusted TeleBirr verifier: exact active service is healthy.'
    ;;

  emergency-stop)
    [[ $# -eq 1 ]] || die 'emergency-stop accepts no arguments'
    emergency_stop_verifier
    printf '%s\n' 'Production trusted TeleBirr verifier: fenced, stopped, and runtime credential removed.'
    ;;

  *)
    die 'expected a verifier stage, guarded activation, status, or emergency-stop command'
    ;;
esac
