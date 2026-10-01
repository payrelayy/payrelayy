#!/bin/bash
set -euo pipefail
IFS=$'\n\t'
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
LC_ALL=C
LANG=C
export PATH LC_ALL LANG
unset BASH_ENV CDPATH ENV DOCKER_API_VERSION DOCKER_CERT_PATH DOCKER_CONFIG DOCKER_CONTEXT
unset DOCKER_HOST DOCKER_TLS_VERIFY COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_NAME
unset COMPOSE_ENV_FILES COMPOSE_DISABLE_ENV_FILE
umask 077

# A one-use image-only handoff. The original release, credential, activation and pilot stay bound
# to the existing active record. A separate atomic marker records only the successor image.
readonly ROOT='/srv/fetanagent/production-trusted-telebirr-verifier'
readonly STATE='/var/lib/fetanagent/production-trusted-telebirr-verifier'
readonly SHARED_STATE='/var/lib/fetanagent/production'
readonly RECORD="$STATE/active-record"
readonly MARKER="$STATE/image-handoff-record"
readonly PIN_MARKER="$STATE/device-pin-handoff-record"
readonly PIN_OVERRIDE="$STATE/device-pin-handoff-manifest.v1.json"
readonly FENCE="$STATE/emergency-fence"
readonly PROJECT='fetanagent-production-trusted-telebirr-verifier'
readonly SERVICE='trusted-telebirr-verifier'
readonly IMAGE='fetanagent-trusted-telebirr-verifier'
readonly NETWORK="${PROJECT}_trusted_telebirr_verifier_database_egress"
readonly COMPOSE_SHA='fc46313c95b1c71afd9f3d33c4304110a31f7da1342e22b17ace4a16b6c1901b'
readonly SELF='/usr/local/sbin/fetanagent-production-trusted-telebirr-verifier-handoff'
readonly EMERGENCY='/usr/local/sbin/fetanagent-production-trusted-telebirr-verifier-helper'

die() { printf '%s\n' "Production verifier handoff denied: $*" >&2; exit 1; }
[[ "$(id -u)" == '0' ]] || die 'root is required'

require_sha() { [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] || die 'an exact commit is required'; }
require_uuid() {
  [[ "${1:-}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
    die 'the active record is malformed'
}
require_file() {
  [[ ! -L "$1" && -f "$1" && -s "$1" && "$(stat --format='%u:%g:%a' "$1")" == "$2" ]] ||
    die 'a protected release file is unsafe'
}

lock_operations() {
  local path
  for path in "$SHARED_STATE" "$STATE"; do
    [[ ! -L "$path" && -d "$path" && "$(realpath -- "$path")" == "$path" &&
      "$(stat --format='%u:%g:%a' "$path")" == '0:0:700' ]] ||
      die 'a production state directory is unsafe'
  done
  for path in "$SHARED_STATE/helper.lock" "$STATE/helper.lock"; do
    [[ ! -L "$path" ]] || die 'a production lock is unsafe'
    if [[ -e "$path" ]]; then
      [[ -f "$path" && "$(stat --format='%u:%g:%a' "$path")" == '0:0:600' ]] ||
        die 'a production lock is unsafe'
    fi
  done
  exec 8>>"$SHARED_STATE/helper.lock"
  flock --nonblock 8 || die 'another production operation is in progress'
  exec 9>>"$STATE/helper.lock"
  flock --nonblock 9 || die 'another verifier operation is in progress'
}

active_container() {
  local found
  local -a matches=()
  found="$(timeout --signal=TERM --kill-after=5s 20s docker container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$SERVICE")" || die 'container inventory unavailable'
  if [[ -n "$found" ]]; then mapfile -t matches <<<"$found"; fi
  [[ "${#matches[@]}" -eq 1 ]] || die 'exactly one verifier container is required'
  printf '%s\n' "${matches[0]}"
}

healthy_image() {
  local container="$1" expected="$2" actual
  actual="$(timeout --signal=TERM --kill-after=5s 20s docker container inspect \
    --format '{{.Image}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' \
    "$container")" || return 1
  [[ "$actual" == "$expected|true|healthy|$PROJECT|$SERVICE" ]]
}

network_exact() {
  local actual
  actual="$(timeout --signal=TERM --kill-after=5s 20s docker network inspect \
    --format '{{.EnableIPv6}}|{{.Internal}}|{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.network"}}|{{len .Containers}}' \
    "$NETWORK")" || return 1
  [[ "$actual" == "true|false|$PROJECT|trusted_telebirr_verifier_database_egress|1" ]]
}

read_original_binding() {
  local expected_pin credential
  local -a lines=()
  require_file "$RECORD" '0:0:600'
  mapfile -t lines <"$RECORD"
  [[ "${#lines[@]}" -eq 4 ]] || die 'the active record is malformed'
  old_sha="${lines[0]}"
  request_key="${lines[1]}"
  epoch="${lines[2]}"
  pilot="${lines[3]}"
  require_sha "$old_sha"
  require_uuid "$request_key"
  [[ "$epoch" =~ ^[1-9][0-9]*$ ]] || die 'the active epoch is malformed'
  require_uuid "$pilot"
  release="$ROOT/releases/$old_sha"
  [[ ! -L "$release" && -d "$release" && "$(realpath -- "$release")" == "$release" &&
    "$(stat --format='%u:%g:%a' "$release")" == '0:0:700' ]] ||
    die 'the original release is unsafe'
  [[ "$(find -P "$release" -mindepth 1 -maxdepth 1 -type f | wc -l)" -eq 8 &&
    -z "$(find -P "$release" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
    die 'the original release shape changed'
  require_file "$release/.release-sha" '0:0:444'
  require_file "$release/.image-id" '0:0:444'
  require_file "$release/.image-tag" '0:0:444'
  require_file "$release/.pin-manifest-sha256" '0:0:444'
  require_file "$release/compose.production-trusted-telebirr-verifier.yaml" '0:0:444'
  require_file "$release/trusted-telebirr-verifier-pins.v1.json" '0:0:444'
  require_file "$release/supabase-ca.crt" '0:0:444'
  require_file "$release/trusted-telebirr-verifier-database-url" '10001:10001:400'
  [[ "$(<"$release/.release-sha")" == "$old_sha" &&
    "$(<"$release/.image-tag")" == "${old_sha:0:12}" &&
    "$(sha256sum "$release/compose.production-trusted-telebirr-verifier.yaml" | cut -d ' ' -f 1)" == "$COMPOSE_SHA" ]] ||
    die 'the original release contract changed'
  old_image="$(<"$release/.image-id")"
  [[ "$old_image" =~ ^sha256:[0-9a-f]{64}$ &&
    "$(docker image inspect "$IMAGE:${old_sha:0:12}" --format '{{.Id}}')" == "$old_image" &&
    "$(docker image inspect "$old_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$old_sha" ]] ||
    die 'the original image is not exact'
  expected_pin="$(<"$release/.pin-manifest-sha256")"
  [[ "$expected_pin" =~ ^sha256:[0-9a-f]{64}$ &&
    "sha256:$(sha256sum "$release/trusted-telebirr-verifier-pins.v1.json" | cut -d ' ' -f 1)" == "$expected_pin" ]] ||
    die 'the pinned manifest changed'
  openssl x509 -in "$release/supabase-ca.crt" -noout -checkend 0 >/dev/null ||
    die 'the production CA is invalid'
  credential="$STATE/credentials/$request_key"
  [[ ! -L "$credential" && -d "$credential" &&
    "$(realpath -- "$credential")" == "$credential" &&
    "$(stat --format='%u:%g:%a' "$credential")" == '0:0:700' ]] ||
    die 'the runtime credential directory is unsafe'
  [[ "$(find -P "$credential" -mindepth 1 -maxdepth 1 -type f | wc -l)" -eq 3 &&
    -z "$(find -P "$credential" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
    die 'the runtime credential shape changed'
  require_file "$credential/.release-sha" '0:0:444'
  require_file "$credential/.pin-manifest-sha256" '0:0:444'
  require_file "$credential/trusted-telebirr-verifier-database-url" '10001:10001:400'
  [[ "$(<"$credential/.release-sha")" == "$old_sha" &&
    "$(<"$credential/.pin-manifest-sha256")" == "$expected_pin" ]] ||
    die 'the runtime credential binding changed'
  local database_pattern='^postgresql://fetanagent_trusted_telebirr_verifier_runtime:[0-9a-f]{64}@db\.xzztugbgtulptnbpoelr\.supabase\.co:5432/postgres\?sslmode=verify-full$'
  [[ "$(<"$credential/trusted-telebirr-verifier-database-url")" =~ $database_pattern ]] ||
    die 'the runtime credential scope changed'
  credential_file="$credential/trusted-telebirr-verifier-database-url"
  pin_file="$release/trusted-telebirr-verifier-pins.v1.json"
  ca_file="$release/supabase-ca.crt"
}

read_target_image() {
  local target_sha="$1" tag
  require_sha "$target_sha"
  tag="${target_sha:0:12}"
  new_image="$(docker image inspect "$IMAGE:$tag" --format '{{.Id}}')" ||
    die 'the staged verifier image is missing'
  [[ "$new_image" =~ ^sha256:[0-9a-f]{64}$ && "$new_image" != "$old_image" &&
    "$(docker image inspect "$new_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$target_sha" &&
    "$(docker image inspect "$new_image" --format '{{.Config.User}}')" == '10001:10001' &&
    "$(docker image inspect "$new_image" --format '{{json .Config.ExposedPorts}}')" == 'null' &&
    "$(docker image inspect "$new_image" --format '{{json .Config.Cmd}}')" == \
      '["node","apps/trusted-telebirr-verifier/dist/trusted-telebirr-verifier-main.js"]' ]] ||
    die 'the staged verifier image is not exact'
}

compose_up() {
  local image_id="$1"
  FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_IMAGE_ID="$image_id" \
  FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_SECRET_FILE="$credential_file" \
  FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_CONFIG_FILE="$pin_file" \
  FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_CONFIG_FILE="$ca_file" \
  FETANAGENT_PRODUCTION_TRUSTED_TELEBIRR_FINANCIAL_ACTIONS_MODE='live' \
  FETANAGENT_PRODUCTION_INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED='true' \
  FETANAGENT_PRODUCTION_TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED='true' \
    timeout --signal=TERM --kill-after=10s 110s docker compose \
      --project-directory "$release" --env-file /dev/null \
      --file "$release/compose.production-trusted-telebirr-verifier.yaml" \
      --profile production-trusted-telebirr-verifier \
      up --detach --force-recreate --no-build --no-deps "$SERVICE" >/dev/null 2>&1
}

compose_valid() {
  local image_id="$1"
  FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_IMAGE_ID="$image_id" \
  FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_SECRET_FILE="$credential_file" \
  FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_CONFIG_FILE="$pin_file" \
  FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_CONFIG_FILE="$ca_file" \
  FETANAGENT_PRODUCTION_TRUSTED_TELEBIRR_FINANCIAL_ACTIONS_MODE='live' \
  FETANAGENT_PRODUCTION_INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED='true' \
  FETANAGENT_PRODUCTION_TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED='true' \
    timeout --signal=TERM --kill-after=5s 20s docker compose \
      --project-directory "$release" --env-file /dev/null \
      --file "$release/compose.production-trusted-telebirr-verifier.yaml" \
      --profile production-trusted-telebirr-verifier config --quiet >/dev/null 2>&1
}

wait_healthy() {
  local image_id="$1" attempt container
  for attempt in {1..45}; do
    [[ ! -e "$FENCE" && ! -L "$FENCE" ]] || return 1
    container="$(active_container)" || return 1
    if healthy_image "$container" "$image_id"; then return 0; fi
    [[ "$attempt" != '45' ]] || return 1
    sleep 2
  done
}

pin_mount_source() {
  local container="$1"
  timeout --signal=TERM --kill-after=5s 20s docker container inspect \
    --format '{{range .Mounts}}{{if eq .Destination "/run/configs/trusted_telebirr_verifier_pins.v1.json"}}{{.Source}}{{end}}{{end}}' \
    "$container"
}

read_image_handoff() {
  require_file "$MARKER" '0:0:600'
  [[ "$(<"$MARKER")" == "$(printf '%s\n%s\n%s\n%s' "$old_sha" "$target_sha" "$old_image" "$new_image")" ]] ||
    die 'the prior image handoff is not exact'
}

read_pin_candidate() {
  local expected_pin="$1" expected_device="$2" old_pin compact device_pin
  [[ "$expected_pin" =~ ^sha256:[0-9a-f]{64}$ &&
    "$expected_device" =~ ^sha256:[0-9a-f]{64}$ ]] ||
    die 'exact public-pin digests are required'
  require_file "$PIN_OVERRIDE" '0:0:444'
  [[ "sha256:$(sha256sum "$PIN_OVERRIDE" | cut -d ' ' -f 1)" == "$expected_pin" ]] ||
    die 'the candidate pin manifest digest changed'
  jq -e '
    type == "object" and keys_unsorted == ["contractVersion", "assignmentSigners", "devices"] and
    .contractVersion == 1 and
    (.assignmentSigners | type == "array" and length == 1) and
    (.devices | type == "array" and length == 1) and
    ([.assignmentSigners[], .devices[]] | all(
      type == "object" and keys_unsorted == ["keyId", "publicKeySpkiDerBase64"] and
      (.keyId | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$")) and
      (.publicKeySpkiDerBase64 | type == "string" and test("^[A-Za-z0-9+/]+={0,2}$"))
    )) and
    ([.assignmentSigners[], .devices[]] | map(.keyId) | length == (unique | length))
  ' "$PIN_OVERRIDE" >/dev/null || die 'the candidate pin manifest shape is invalid'
  compact="$(jq -c . "$PIN_OVERRIDE")" || die 'the candidate manifest is not JSON'
  [[ "$(wc -c <"$PIN_OVERRIDE")" -eq "${#compact}" && "$(<"$PIN_OVERRIDE")" == "$compact" ]] ||
    die 'the candidate pin manifest is not canonical JSON'
  jq -e '.contractVersion == 1 and (.assignmentSigners | length == 1) and (.devices | length == 1)' \
    "$release/trusted-telebirr-verifier-pins.v1.json" >/dev/null ||
    die 'the original pin manifest is not a one-phone release'
  [[ "$(jq -c '.assignmentSigners' "$PIN_OVERRIDE")" == \
    "$(jq -c '.assignmentSigners' "$release/trusted-telebirr-verifier-pins.v1.json")" ]] ||
    die 'the assignment signer pin changed'
  device_pin="sha256:$(jq -r '.devices[0].publicKeySpkiDerBase64' "$PIN_OVERRIDE" |
    base64 --decode | sha256sum | cut -d ' ' -f 1)" ||
    die 'the candidate device pin is invalid'
  old_pin="sha256:$(jq -r '.devices[0].publicKeySpkiDerBase64' \
    "$release/trusted-telebirr-verifier-pins.v1.json" |
    base64 --decode | sha256sum | cut -d ' ' -f 1)" || die 'the original device pin is invalid'
  [[ "$device_pin" == "$expected_device" && "$device_pin" != "$old_pin" ]] ||
    die 'the candidate device pin is not the independently confirmed new key'
  [[ "$device_pin" != "sha256:$(jq -r '.assignmentSigners[0].publicKeySpkiDerBase64' \
    "$PIN_OVERRIDE" | base64 --decode | sha256sum | cut -d ' ' -f 1)" ]] ||
    die 'the device and signer pins must differ'
}

case "${1:-}" in
  verify)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{64}$ ]] || die 'verify expects a helper digest'
    [[ "$(sha256sum "$SELF" | cut -d ' ' -f 1)" == "$2" ]] ||
      die 'installed helper digest mismatch'
    printf '%s\n' 'Verifier handoff helper digest verified.'
    ;;
  preflight|handoff|status|pin-preflight|pin-handoff|pin-status)
    if [[ "$1" == pin-* ]]; then
      [[ $# -eq 4 ]] || die 'the pin command expects image, manifest and device digests'
    else
      [[ $# -eq 2 ]] || die 'the command expects one exact staged-image commit'
    fi
    target_sha="$2"
    require_sha "$target_sha"
    lock_operations
    read_original_binding
    read_target_image "$target_sha"
    [[ ! -e "$FENCE" && ! -L "$FENCE" ]] || die 'an emergency fence is active'
    case "$1" in
      preflight|handoff)
        [[ ! -e "$MARKER" && ! -L "$MARKER" ]] || die 'a handoff was already recorded'
        container="$(active_container)"
        healthy_image "$container" "$old_image" && network_exact &&
          compose_valid "$new_image" || die 'the original verifier or successor config is not exact'
        if [[ "$1" == 'preflight' ]]; then
          printf '%s\n' 'Verifier image handoff preflight passed; no service changed.'
          exit 0
        fi
        # The workflow performs the independent database/no-candidate preflight immediately
        # before this command. No second handoff attempt is made if anything below fails.
        started=1
        rollback() {
          local marker_safe=1
          trap - EXIT INT TERM
          if [[ -e "$MARKER" || -L "$MARKER" ]]; then
            if [[ ! -L "$MARKER" && -f "$MARKER" &&
              "$(stat --format='%u:%g:%a' "$MARKER")" == '0:0:600' &&
              "$(<"$MARKER")" == "$(printf '%s\n%s\n%s\n%s' "$old_sha" "$target_sha" "$old_image" "$new_image")" ]]; then
              rm -- "$MARKER" || marker_safe=0
            else
              marker_safe=0
            fi
          fi
          if [[ -e "${pending:-}" || -L "${pending:-}" ]]; then
            if [[ "${pending:-}" == "$STATE/.image-handoff-record.$$" &&
              ! -L "$pending" && -f "$pending" &&
              "$(stat --format='%u:%g:%a' "$pending")" == '0:0:600' ]]; then
              rm -- "$pending" || marker_safe=0
            else
              marker_safe=0
            fi
          fi
          if [[ "$marker_safe" == '1' && ! -e "$FENCE" && ! -L "$FENCE" ]] &&
            healthy_image "$(active_container)" "$old_image" && network_exact; then
            printf '%s\n' 'Verifier handoff failed before replacement; original service unchanged.' >&2
            exit 2
          fi
          if [[ "$marker_safe" == '1' && "$started" == '1' &&
            ! -e "$FENCE" && ! -L "$FENCE" ]] &&
            compose_up "$old_image" && wait_healthy "$old_image" && network_exact; then
            printf '%s\n' 'Verifier handoff failed; original service restored. No retry performed.' >&2
            exit 2
          fi
          "$EMERGENCY" emergency-stop >/dev/null 2>&1 || true
          printf '%s\n' 'Verifier handoff failed and original service could not be proven; emergency host stop attempted.' >&2
          exit 3
        }
        trap rollback EXIT
        trap 'exit 130' INT
        trap 'exit 143' TERM
        compose_up "$new_image" || die 'the successor service could not be started'
        wait_healthy "$new_image" && network_exact ||
          die 'the successor service did not become healthy and exact'
        [[ "$(active_container)" != "$container" ]] ||
          die 'the old verifier container was not replaced'
        [[ ! -e "$MARKER" && ! -L "$MARKER" ]] || die 'the handoff marker path changed'
        pending="$STATE/.image-handoff-record.$$"
        [[ ! -e "$pending" && ! -L "$pending" ]] || die 'the handoff staging path is unsafe'
        printf '%s\n%s\n%s\n%s\n' "$old_sha" "$target_sha" "$old_image" "$new_image" >"$pending"
        chown root:root "$pending"
        chmod 0600 "$pending"
        mv -- "$pending" "$MARKER"
        sync -f "$STATE" || die 'the handoff record could not be synced'
        healthy_image "$(active_container)" "$new_image" ||
          die 'the successor service changed after recording'
        trap - EXIT INT TERM
        printf '%s\n' 'Verifier image handoff completed; one healthy successor, original activation unchanged.'
        ;;
      status)
        require_file "$MARKER" '0:0:600'
        [[ "$(<"$MARKER")" == "$(printf '%s\n%s\n%s\n%s' "$old_sha" "$target_sha" "$old_image" "$new_image")" ]] ||
          die 'the handoff marker is not exact'
        container="$(active_container)"
        healthy_image "$container" "$new_image" && network_exact ||
          die 'the successor verifier is not healthy and exact'
        printf '%s\n' 'Verifier image handoff status: one healthy successor; original activation unchanged.'
        ;;
      pin-preflight|pin-handoff|pin-status)
        read_image_handoff
        original_pin_file="$pin_file"
        expected_pin_digest="$3"
        expected_device_digest="$4"
        read_pin_candidate "$expected_pin_digest" "$expected_device_digest"
        container="$(active_container)"
        healthy_image "$container" "$new_image" && network_exact ||
          die 'the image successor is not healthy and exact'
        if [[ "$1" == 'pin-status' ]]; then
          require_file "$PIN_MARKER" '0:0:600'
          [[ "$(<"$PIN_MARKER")" == "$(printf '%s\n%s\n%s' "$target_sha" "$expected_pin_digest" "$expected_device_digest")" &&
            "$(pin_mount_source "$container")" == "$PIN_OVERRIDE" ]] ||
            die 'the device pin handoff is not exact'
          printf '%s\n' 'Verifier device-pin handoff status: one healthy successor; original activation unchanged.'
          exit 0
        fi
        [[ ! -e "$PIN_MARKER" && ! -L "$PIN_MARKER" &&
          "$(pin_mount_source "$container")" == "$original_pin_file" ]] ||
          die 'the device pin handoff was already used or the original mount changed'
        pin_file="$PIN_OVERRIDE"
        compose_valid "$new_image" || die 'the candidate Compose configuration is invalid'
        if [[ "$1" == 'pin-preflight' ]]; then
          printf '%s\n' 'Verifier device-pin preflight passed; no service changed.'
          exit 0
        fi
        pin_rollback() {
          local marker_safe=1
          trap - EXIT INT TERM
          if [[ -e "$PIN_MARKER" || -L "$PIN_MARKER" ]]; then
            if [[ ! -L "$PIN_MARKER" && -f "$PIN_MARKER" &&
              "$(stat --format='%u:%g:%a' "$PIN_MARKER")" == '0:0:600' &&
              "$(<"$PIN_MARKER")" == "$(printf '%s\n%s\n%s' "$target_sha" "$expected_pin_digest" "$expected_device_digest")" ]]; then
              rm -- "$PIN_MARKER" || marker_safe=0
            else
              marker_safe=0
            fi
          fi
          if [[ -e "${pending:-}" || -L "${pending:-}" ]]; then
            if [[ "${pending:-}" == "$STATE/.device-pin-handoff-record.$$" &&
              ! -L "$pending" && -f "$pending" &&
              "$(stat --format='%u:%g:%a' "$pending")" == '0:0:600' ]]; then
              rm -- "$pending" || marker_safe=0
            else
              marker_safe=0
            fi
          fi
          pin_file="$original_pin_file"
          if [[ "$marker_safe" == '1' && ! -e "$FENCE" && ! -L "$FENCE" ]] &&
            healthy_image "$(active_container)" "$new_image" && network_exact &&
            [[ "$(pin_mount_source "$(active_container)")" == "$original_pin_file" ]]; then
            printf '%s\n' 'Verifier pin handoff failed before replacement; original service unchanged.' >&2
            exit 2
          fi
          if [[ "$marker_safe" == '1' && ! -e "$FENCE" && ! -L "$FENCE" ]] &&
            compose_up "$new_image" && wait_healthy "$new_image" && network_exact &&
            [[ "$(pin_mount_source "$(active_container)")" == "$original_pin_file" ]]; then
            printf '%s\n' 'Verifier pin handoff failed; original pin restored. No retry performed.' >&2
            exit 2
          fi
          "$EMERGENCY" emergency-stop >/dev/null 2>&1 || true
          printf '%s\n' 'Verifier pin handoff failed; emergency host stop attempted.' >&2
          exit 3
        }
        trap pin_rollback EXIT
        trap 'exit 130' INT
        trap 'exit 143' TERM
        compose_up "$new_image" || die 'the new pin configuration could not be started'
        wait_healthy "$new_image" && network_exact ||
          die 'the new pin configuration did not become healthy and exact'
        [[ "$(active_container)" != "$container" &&
          "$(pin_mount_source "$(active_container)")" == "$PIN_OVERRIDE" ]] ||
          die 'the verifier was not replaced with the new pin mount'
        pending="$STATE/.device-pin-handoff-record.$$"
        [[ ! -e "$pending" && ! -L "$pending" ]] || die 'the pin marker staging path is unsafe'
        printf '%s\n%s\n%s\n' "$target_sha" "$expected_pin_digest" "$expected_device_digest" >"$pending"
        chown root:root "$pending"
        chmod 0600 "$pending"
        mv -- "$pending" "$PIN_MARKER"
        sync -f "$STATE" || die 'the pin handoff record could not be synced'
        healthy_image "$(active_container)" "$new_image" && network_exact &&
          [[ "$(pin_mount_source "$(active_container)")" == "$PIN_OVERRIDE" ]] ||
          die 'the verifier changed after recording the pin handoff'
        trap - EXIT INT TERM
        printf '%s\n' 'Verifier device-pin handoff completed; original activation unchanged.'
        ;;
    esac
    ;;
  *) die 'expected verify, image handoff, or device-pin handoff mode' ;;
esac
