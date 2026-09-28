#!/usr/bin/env bash
# One foreground operator session. Installation and inspection are inert; run
# consumes one private launch document on stdin and never stores it on the host.

set -Eeuo pipefail

readonly INSTALLED='/usr/local/sbin/fetanagent-production-operator-host-launch'
readonly IMAGE='fetanagent-protected-operator-host:ci'
readonly CONTAINER='fetanagent-protected-operator-host'
readonly SIGNER_SOURCE='/etc/fetanagent/companion-execution-secrets/production-execution-signer.pkcs8.der'
readonly SIGNER_TARGET='/run/secrets/companion_execution_signer.pkcs8.der'
readonly RUNTIME_DIR='/run/fetanagent-operator-host'
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

export PATH="$SAFE_PATH"
umask 077

die() {
  printf '%s\n' 'Protected operator launch refused; inspect the exact host before retrying.' >&2
  exit 1
}

require_installed_root_entry() {
  [[ $EUID -eq 0 ]] || die
  [[ ! -L "$INSTALLED" && -f "$INSTALLED" &&
    "$(realpath -- "$INSTALLED")" == "$INSTALLED" &&
    "$(realpath -- "$0")" == "$INSTALLED" &&
    "$(stat --format='%u:%g:%a:%h' "$INSTALLED")" == '0:0:700:1' ]] || die
}

require_dormant_host() {
  local expected_revision="$1" actual_revision image_user entrypoint
  [[ "$expected_revision" =~ ^[0-9a-f]{40}$ ]] || die
  [[ "$(findmnt -n -o FSTYPE --target /run)" == 'tmpfs' ]] || die
  [[ ! -L "$SIGNER_SOURCE" && -f "$SIGNER_SOURCE" &&
    "$(stat --format='%u:%g:%a:%h' "$SIGNER_SOURCE")" == '0:0:400:1' ]] || die
  [[ "$(stat --format='%s' "$SIGNER_SOURCE")" -ge 100 &&
    "$(stat --format='%s' "$SIGNER_SOURCE")" -le 4096 ]] || die
  actual_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE")" || die
  image_user="$(docker image inspect --format '{{.Config.User}}' "$IMAGE")" || die
  entrypoint="$(docker image inspect --format '{{json .Config.Entrypoint}}' "$IMAGE")" || die
  [[ "$actual_revision" == "$expected_revision" && "$image_user" == '10001:10001' &&
    "$entrypoint" == '["/usr/local/bin/node","/workspace/packages/agent-platform-companion-operator-host/dist/index.js"]' ]] || die
  ! docker container inspect "$CONTAINER" >/dev/null 2>&1 || die
  [[ -z "$(ss -H -ltn '( sport = :743 )')" ]] || die
}

prepare_runtime_dir() {
  [[ ! -L "$RUNTIME_DIR" ]] || die
  if [[ ! -e "$RUNTIME_DIR" ]]; then
    mkdir -m 0700 -- "$RUNTIME_DIR" || die
  fi
  [[ -d "$RUNTIME_DIR" &&
    "$(stat --format='%u:%g:%a' "$RUNTIME_DIR")" == '0:0:700' ]] || die
}

run_once() {
  [[ ! -t 0 ]] || die
  prepare_runtime_dir
  exec 9>"$RUNTIME_DIR/one-shot.lock"
  flock -n 9 || die
  require_dormant_host "$1"
  operator_stage_dir="$(mktemp -d -p "$RUNTIME_DIR" 'session.XXXXXXXX')" || die
  operator_staged_signer="$operator_stage_dir/signer.pkcs8.der"
  operator_cidfile="$operator_stage_dir/container-id"
  cleanup() {
    local initial_status=$? stop_failed=0 operator_cid=''
    trap - EXIT INT TERM
    if [[ -f "$operator_cidfile" ]]; then
      IFS= read -r operator_cid <"$operator_cidfile" || true
      if [[ "$operator_cid" =~ ^[0-9a-f]{64}$ ]]; then
        if ! docker stop --time 20 "$operator_cid" >/dev/null 2>&1; then
          if docker container inspect "$operator_cid" >/dev/null 2>&1; then
            stop_failed=1
          fi
        fi
      else
        stop_failed=1
      fi
    fi
    rm -f -- "$operator_staged_signer" "$operator_cidfile" || stop_failed=1
    rmdir -- "$operator_stage_dir" || stop_failed=1
    docker info >/dev/null 2>&1 || stop_failed=1
    ! docker container inspect "$CONTAINER" >/dev/null 2>&1 || stop_failed=1
    [[ -z "$(ss -H -ltn '( sport = :743 )')" ]] || stop_failed=1
    if [[ "$initial_status" -ne 0 || "$stop_failed" -ne 0 ]]; then
      printf '%s\n' 'Protected operator stopped or uncertain; reconcile before another request.' >&2
      exit 1
    fi
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  install -m 0400 -o 10001 -g 10001 -- "$SIGNER_SOURCE" "$operator_staged_signer" || die
  docker run --rm -i --name "$CONTAINER" --cidfile "$operator_cidfile" \
    --network host --read-only --log-driver none \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m,uid=10001,gid=10001,mode=700 \
    --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 512m \
    --user 10001:10001 --stop-timeout 20 \
    --mount "type=bind,src=$operator_staged_signer,dst=$SIGNER_TARGET,readonly" \
    "$IMAGE"
  exit $?
}

[[ $# -eq 2 ]] || die
require_installed_root_entry
case "$1" in
  inspect)
    require_dormant_host "$2"
    printf '%s\n' 'protected_operator_image_ready_dormant'
    ;;
  run)
    run_once "$2"
    ;;
  *) die ;;
esac
