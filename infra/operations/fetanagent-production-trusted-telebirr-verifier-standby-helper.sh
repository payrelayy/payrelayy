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

readonly HELPER_PATH='/usr/local/sbin/fetanagent-production-trusted-telebirr-verifier-standby-helper'
readonly SHARED_STATE='/var/lib/fetanagent/production'
readonly STATE='/var/lib/fetanagent/production-trusted-telebirr-verifier-standby'
readonly PROJECT='fetanagent-production-trusted-telebirr-verifier'
readonly SERVICE='trusted-telebirr-verifier'
readonly IMAGE='fetanagent-trusted-telebirr-verifier'

die() { printf '%s\n' "Production verifier standby check denied: $*" >&2; exit 1; }
[[ "$(id -u)" == '0' ]] || die 'root is required'

require_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || die 'exact reviewed commit required'
}
require_digest() {
  [[ "$1" =~ ^[0-9a-f]{64}$ ]] || die 'exact archive digest required'
}

active_container() {
  local output
  local -a matches=()
  output="$(timeout --signal=TERM --kill-after=5s 20s docker container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$SERVICE")" || die 'active inventory unavailable'
  if [[ -n "$output" ]]; then mapfile -t matches <<<"$output"; fi
  [[ "${#matches[@]}" -eq 1 ]] || die 'exactly one existing verifier is required'
  printf '%s\n' "${matches[0]}"
}

active_snapshot() {
  local container_id="$1" snapshot
  snapshot="$(timeout --signal=TERM --kill-after=5s 20s docker container inspect \
    --format '{{.Id}}|{{.Image}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
    "$container_id")" || die 'active inspection unavailable'
  [[ "$snapshot" =~ ^[0-9a-f]{64}\|sha256:[0-9a-f]{64}\|true\|healthy$ ]] ||
    die 'the existing verifier is not healthy'
  printf '%s\n' "$snapshot"
}

lock_operations() {
  local path
  for path in "$SHARED_STATE" "$STATE"; do
    [[ ! -L "$path" ]] || die 'an operation state path is unsafe'
    if [[ "$path" == "$STATE" && ! -e "$path" ]]; then
      install -d -m 0700 -o root -g root "$path"
    fi
    [[ -d "$path" && "$(stat --format='%u:%g:%a' "$path")" == '0:0:700' ]] ||
      die 'an operation state path is unsafe'
  done
  for path in "$SHARED_STATE/helper.lock" "$STATE/helper.lock"; do
    [[ ! -L "$path" ]] || die 'an operation lock is unsafe'
    if [[ -e "$path" ]]; then
      [[ -f "$path" && "$(stat --format='%u:%g:%a' "$path")" == '0:0:600' ]] ||
        die 'an operation lock is unsafe'
    fi
  done
  exec 8>>"$SHARED_STATE/helper.lock"
  flock --nonblock 8 || die 'another production operation is in progress'
  exec 9>>"$STATE/helper.lock"
  flock --nonblock 9 || die 'another standby operation is in progress'
}

incoming_path() {
  require_sha "$1"
  printf '/tmp/fetanagent-production-verifier-standby-%s\n' "$1"
}

cleanup_incoming() {
  local incoming="$1"
  if [[ ! -e "$incoming" && ! -L "$incoming" ]]; then return; fi
  [[ ! -L "$incoming" && -d "$incoming" && "$(realpath -- "$incoming")" == "$incoming" &&
     ( "$(stat --format='%U:%G:%a' "$incoming")" == 'fetanagent-admin:fetanagent-admin:700' ||
       "$(stat --format='%U:%G:%a' "$incoming")" == 'root:root:700' ) &&
     -z "$(find -P "$incoming" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
    die 'the incoming directory is unsafe'
  [[ -z "$(find -P "$incoming" -mindepth 1 -maxdepth 1 ! -name 'verifier-image.tar' -print -quit)" ]] ||
    die 'the incoming directory contains an unexpected file'
  find -P "$incoming" -mindepth 1 -maxdepth 1 -type f -delete
  rmdir -- "$incoming"
}

cleanup_sealed() {
  local sha="$1" sealed="$STATE/.incoming-$1"
  require_sha "$sha"
  if [[ ! -e "$sealed" && ! -L "$sealed" ]]; then return; fi
  [[ ! -L "$sealed" && -d "$sealed" && "$(realpath -- "$sealed")" == "$sealed" &&
    "$(stat --format='%u:%g:%a' "$sealed")" == '0:0:700' &&
    -z "$(find -P "$sealed" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" &&
    -z "$(find -P "$sealed" -mindepth 1 -maxdepth 1 ! -name 'verifier-image.tar' -print -quit)" ]] ||
    die 'the sealed archive directory is unsafe'
  find -P "$sealed" -mindepth 1 -maxdepth 1 -type f -delete
  rmdir -- "$sealed"
}

case "${1:-}" in
  verify)
    [[ $# -eq 2 ]] || die 'verify expects one helper digest'
    require_digest "$2"
    [[ "$(sha256sum "$HELPER_PATH" | cut -d ' ' -f 1)" == "$2" ]] ||
      die 'installed helper digest mismatch'
    ;;
  prepare|cleanup|stage-smoke)
    lock_operations
    ;;
  *) die 'expected verify, prepare, stage-smoke, or cleanup' ;;
esac

case "${1:-}" in
  prepare)
    [[ $# -eq 3 && "$3" =~ ^[1-9][0-9]{0,9}$ && "$3" -le 4294967296 ]] ||
      die 'prepare expects SHA and bounded archive size'
    incoming="$(incoming_path "$2")"
    [[ ! -e "$incoming" && ! -L "$incoming" ]] || die 'incoming path already exists'
    [[ ! -e "$STATE/.incoming-$2" && ! -L "$STATE/.incoming-$2" ]] ||
      die 'a prior sealed archive requires review'
    active_id="$(active_container)"
    active_snapshot "$active_id" >/dev/null
    docker_root="$(docker info --format '{{.DockerRootDir}}')" || die 'Docker storage unavailable'
    [[ "$docker_root" == /* && ! -L "$docker_root" && -d "$docker_root" ]] ||
      die 'Docker storage path is unsafe'
    available="$(df --output=avail --block-size=1 /tmp | tail -n 1 | tr -d ' ')"
    image_available="$(df --output=avail --block-size=1 "$docker_root" | tail -n 1 | tr -d ' ')"
    [[ "$available" =~ ^[0-9]+$ && "$available" -gt $((2 * $3 + 536870912)) &&
      "$image_available" =~ ^[0-9]+$ && "$image_available" -gt $((2 * $3 + 536870912)) ]] ||
      die 'insufficient staging space'
    install -d -m 0700 -o fetanagent-admin -g fetanagent-admin "$incoming"
    ;;
  cleanup)
    [[ $# -eq 2 ]] || die 'cleanup expects SHA'
    cleanup_incoming "$(incoming_path "$2")"
    cleanup_sealed "$2"
    ;;
  stage-smoke)
    [[ $# -eq 3 ]] || die 'stage-smoke expects SHA and archive digest'
    sha="$2"
    require_sha "$sha"
    require_digest "$3"
    incoming="$(incoming_path "$sha")"
    [[ ! -L "$incoming" && -d "$incoming" && "$(realpath -- "$incoming")" == "$incoming" &&
      "$(stat --format='%U:%G:%a' "$incoming")" == 'fetanagent-admin:fetanagent-admin:700' ]] ||
      die 'the incoming directory is unsafe'
    [[ "$(find -P "$incoming" -mindepth 1 -maxdepth 1 -type f | wc -l)" -eq 1 &&
      -z "$(find -P "$incoming" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" &&
      -f "$incoming/verifier-image.tar" && ! -L "$incoming/verifier-image.tar" &&
      "$(stat --format='%U:%G:%a' "$incoming/verifier-image.tar")" == \
        'fetanagent-admin:fetanagent-admin:600' ]] || die 'the incoming archive is unsafe'
    incoming_identity="$(stat --format='%d:%i' "$incoming")"
    chown --no-dereference root:root "$incoming"
    [[ "$(stat --format='%d:%i:%u:%g:%a' "$incoming")" == \
      "$incoming_identity:0:0:700" ]] || die 'the incoming directory changed'
    sealed="$STATE/.incoming-$sha"
    [[ ! -e "$sealed" && ! -L "$sealed" ]] || die 'a sealed archive already exists'
    install -d -m 0700 -o root -g root "$sealed"
    cp --no-dereference --reflink=never -- "$incoming/verifier-image.tar" \
      "$sealed/verifier-image.tar"
    [[ ! -L "$sealed/verifier-image.tar" &&
      "$(stat --format='%u:%g:%h' "$sealed/verifier-image.tar")" == '0:0:1' ]] ||
      die 'the sealed archive is unsafe'
    active_id="$(active_container)"
    before="$(active_snapshot "$active_id")"
    tag="${sha:0:12}"
    if docker image inspect "$IMAGE:$tag" >/dev/null 2>&1; then
      die 'standby tag already exists'
    fi
    [[ "$(sha256sum "$sealed/verifier-image.tar" | cut -d ' ' -f 1)" == "$3" ]] ||
      die 'archive digest mismatch'
    docker load --input "$sealed/verifier-image.tar" >/dev/null
    image_id="$(docker image inspect "$IMAGE:$tag" --format '{{.Id}}')" ||
      die 'standby image not loaded'
    [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ &&
      "$(docker image inspect "$image_id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$sha" &&
      "$(docker image inspect "$image_id" --format '{{.Config.User}}')" == '10001:10001' &&
      "$(docker image inspect "$image_id" --format '{{json .Config.ExposedPorts}}')" == 'null' &&
      "$(docker image inspect "$image_id" --format '{{json .Config.Cmd}}')" == \
        '["node","apps/trusted-telebirr-verifier/dist/trusted-telebirr-verifier-main.js"]' ]] ||
      die 'standby image metadata is not exact'
    IFS='|' read -r old_container_id old_image_id old_running old_health <<<"$before"
    [[ "$image_id" != "$old_image_id" ]] || die 'standby image equals active image'
    # No network, credential, configuration, or activation input is supplied. The real entrypoint
    # must fail closed with a fixed message; this is not a live verifier start or evidence replay.
    smoke_name="fetanagent-trusted-telebirr-standby-smoke-$tag"
    if docker container inspect "$smoke_name" >/dev/null 2>&1; then
      die 'an inert startup container name already exists'
    fi
    set +e
    output="$(timeout --signal=TERM --kill-after=5s 30s docker run --rm \
      --name "$smoke_name" --network none \
      --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m,mode=1777 \
      --cap-drop ALL --security-opt no-new-privileges \
      --pids-limit 32 --memory 128m --cpus 0.25 \
      --env NODE_ENV=production --env FINANCIAL_ACTIONS_MODE=dry_run \
      --env INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED=false \
      --env TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED=false "$image_id" 2>&1)"
    exit_code=$?
    set -e
    if docker container inspect "$smoke_name" >/dev/null 2>&1; then
      timeout --signal=TERM --kill-after=5s 25s docker container rm --force "$smoke_name" >/dev/null ||
        die 'the inert startup container could not be removed'
    fi
    if docker container inspect "$smoke_name" >/dev/null 2>&1; then
      die 'the inert startup container remains present'
    fi
    [[ "$exit_code" -eq 1 && "$output" == 'FetanAgent trusted TeleBirr verifier failed closed.' ]] ||
      die 'standby startup did not fail closed exactly'
    [[ "$(active_container)" == "$active_id" && "$(active_snapshot "$active_id")" == "$before" ]] ||
      die 'the active verifier changed during the standby check'
    cleanup_incoming "$incoming"
    cleanup_sealed "$sha"
    printf '%s\n' 'Standby image loaded and inert startup verified; active verifier unchanged.'
    ;;
esac
