#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 077

readonly PROJECT_NAME='fetanagent-production'
readonly ROOT='/srv/fetanagent/production'
readonly RELEASE_ROOT="$ROOT/releases"
readonly CURRENT_LINK="$ROOT/current"
readonly STATE_ROOT='/var/lib/fetanagent/production'
readonly STAGING_PROJECT='fetanagent-staging-beta'
readonly HELPER_PATH='/usr/local/sbin/fetanagent-production-deploy-helper'

die() {
  printf 'fetanagent production deploy helper: %s\n' "$*" >&2
  exit 1
}

[[ "$(id -u)" == '0' ]] || die 'root execution is required'

require_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || die 'an exact 40-character commit SHA is required'
}

require_tag() {
  [[ "$1" =~ ^[0-9a-f]{12}$ ]] || die 'an exact 12-character image tag is required'
}

release_dir() {
  require_sha "$1"
  printf '%s/%s\n' "$RELEASE_ROOT" "$1"
}

require_release() {
  local sha="$1" release
  release="$(release_dir "$sha")"
  [[ ! -L "$release" && -d "$release" && "$(realpath -- "$release")" == "$release" ]] ||
    die 'the exact production release is absent or unsafe'
  [[ "$(<"$release/.release-sha")" == "$sha" ]] || die 'the production release marker is wrong'
  printf '%s\n' "$release"
}

compose_release() {
  local release="$1"
  shift
  local tag signer_id
  tag="$(<"$release/.image-tag")"
  signer_id="$(<"$release/telebirr-assignment-signer-key-id")"
  require_tag "$tag"
  [[ "$signer_id" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$ ]] ||
    die 'the production assignment signer identifier is malformed'
  FETANAGENT_IMAGE_TAG="$tag" \
    FETANAGENT_PRODUCTION_SECRET_DIR="$release/secrets" \
    FETANAGENT_TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID="$signer_id" \
    docker compose --project-name "$PROJECT_NAME" \
      --file "$release/compose.production.yaml" --profile production "$@"
}

container_for() {
  local project="$1" service="$2"
  mapfile -t matches < <(
    docker container ls --all --quiet \
      --filter "label=com.docker.compose.project=$project" \
      --filter "label=com.docker.compose.service=$service"
  )
  [[ "${#matches[@]}" -le 1 ]] || die "multiple $project/$service containers are present"
  if [[ "${#matches[@]}" -eq 1 ]]; then printf '%s\n' "${matches[0]}"; fi
}

container_running() {
  [[ -n "$1" && "$(docker inspect --format '{{.State.Running}}' "$1")" == 'true' ]]
}

stop_if_running() {
  local id="$1"
  if container_running "$id"; then docker container stop --time 20 "$id" >/dev/null; fi
}

start_if_stopped() {
  local id="$1"
  if [[ -n "$id" ]] && ! container_running "$id"; then docker container start "$id" >/dev/null; fi
}

verify_images() {
  local sha="$1" tag="$2" image
  require_sha "$sha"
  require_tag "$tag"
  for image in owner-control customer-web api beta-admission bot gateway; do
    [[ "$(docker image inspect "fetanagent-$image:$tag" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$sha" ]] ||
      die "the $image image is absent or has the wrong revision"
  done
}

verify_release_files() {
  local release="$1" name
  local -a required=(
    api-action-capability-hmac
    api-action-payload-hmac
    api-action-semantic-hmac
    api-action-transport-hmac
    beta-database-url
    beta-payload-hmac
    beta-transport-hmac
    bot-action-transport-hmac
    bot-token
    bot-transport-hmac
    cbe-deposit-reference-encryption-key
    cbe-deposit-reference-fingerprint-key
    cbe-deposit-reference-key-profile.v1.json
    customer-web-database-url
    customer-web-rate-limit-hmac
    deposit-proof-reference-encryption-master
    deposit-proof-reference-fingerprint-master
    deposit-proof-reference-profile.v2.json
    owner-database-url
    player-action-database-url
    publishable-key
    supabase-ca.crt
  )
  [[ ! -L "$release/secrets" && -d "$release/secrets" ]] || die 'the secret directory is unsafe'
  for name in "${required[@]}"; do
    [[ ! -L "$release/secrets/$name" && -f "$release/secrets/$name" && -s "$release/secrets/$name" ]] ||
      die "the production release is missing $name"
  done
  [[ "$(find -P "$release/secrets" -mindepth 1 -maxdepth 1 -type f | wc -l)" -eq "${#required[@]}" ]] ||
    die 'the production secret directory contains an unexpected file'
  [[ -z "$(find -P "$release/secrets" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
    die 'the production secret directory contains a non-file entry'
}

rollback_transition() {
  local sha="$1" release="$2" previous_file="$STATE_ROOT/pending-$sha.previous" previous=''
  if [[ -f "$previous_file" ]]; then previous="$(<"$previous_file")"; fi
  compose_release "$release" down --remove-orphans --timeout 30 >/dev/null 2>&1 || true
  if [[ -n "$previous" && ! -L "$previous" && -d "$previous" && "$previous" == "$RELEASE_ROOT/"* ]]; then
    compose_release "$previous" up --detach --no-build --wait --wait-timeout 120
    ln -sfn -- "$previous" "$CURRENT_LINK.next"
    mv -Tf -- "$CURRENT_LINK.next" "$CURRENT_LINK"
  else
    start_if_stopped "$(container_for "$STAGING_PROJECT" bot)"
    start_if_stopped "$(container_for "$STAGING_PROJECT" gateway)"
    rm -f -- "$CURRENT_LINK"
  fi
}

case "${1:-}" in
  verify)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{64}$ ]] || die 'verify requires one SHA-256 digest'
    [[ "$(sha256sum "$HELPER_PATH" | cut -d ' ' -f 1)" == "$2" ]] || die 'installed helper digest mismatch'
    ;;

  preflight)
    [[ $# -eq 2 ]] || die 'preflight requires the expected image-bundle byte count'
    [[ "$2" =~ ^[1-9][0-9]*$ ]] || die 'the image-bundle byte count is invalid'
    command -v docker >/dev/null
    docker compose version >/dev/null
    docker network inspect fetanagent-companion-device-ingress >/dev/null
    docker network inspect fetanagent-telebirr-device-ingress >/dev/null
    install -d -m 0700 -o root -g root "$ROOT" "$RELEASE_ROOT" "$STATE_ROOT"
    available="$(df --output=avail --block-size=1 "$ROOT" | tail -n 1 | tr -d ' ')"
    [[ "$available" =~ ^[0-9]+$ && "$available" -gt $((2 * $2 + 1073741824)) ]] ||
      die 'insufficient storage for a sealed production release and rollback margin'
    ;;

  current-state)
    [[ $# -eq 1 ]] || die 'current-state accepts no arguments'
    if [[ -L "$CURRENT_LINK" ]]; then
      release="$(readlink -f -- "$CURRENT_LINK")"
      [[ "$release" == "$RELEASE_ROOT/"* && ! -L "$release" && -d "$release" ]] ||
        die 'the current production release link is unsafe'
      require_release "$(<"$release/.release-sha")" >/dev/null
      printf 'present\n'
    elif [[ -e "$CURRENT_LINK" ]]; then
      die 'the current production release marker is unsafe'
    else
      for service in owner-control customer-web api beta-admission bot gateway; do
        [[ -z "$(container_for "$PROJECT_NAME" "$service")" ]] ||
          die 'production containers exist without a current release marker'
      done
      printf 'absent\n'
    fi
    ;;

  prepare-incoming)
    [[ $# -eq 2 ]] || die 'prepare-incoming requires one exact commit SHA'
    sha="$2"
    require_sha "$sha"
    incoming="/tmp/fetanagent-production-$sha"
    if [[ -e "$incoming" || -L "$incoming" ]]; then
      [[ ! -L "$incoming" && -d "$incoming" && "$(realpath -- "$incoming")" == "$incoming" &&
        "$(stat --format='%U:%G:%a' "$incoming")" == 'fetanagent-admin:fetanagent-admin:700' ]] ||
        die 'an unsafe incoming production path already exists'
      rm -rf -- "$incoming"
    fi
    install -d -m 0700 -o fetanagent-admin -g fetanagent-admin "$incoming"
    ;;

  cleanup-incoming)
    [[ $# -eq 2 ]] || die 'cleanup-incoming requires one exact commit SHA'
    sha="$2"
    require_sha "$sha"
    incoming="/tmp/fetanagent-production-$sha"
    if [[ -e "$incoming" || -L "$incoming" ]]; then
      [[ ! -L "$incoming" && -d "$incoming" && "$(realpath -- "$incoming")" == "$incoming" &&
        "$(stat --format='%U:%G:%a' "$incoming")" == 'fetanagent-admin:fetanagent-admin:700' ]] ||
        die 'the incoming production path is unsafe and was not removed'
      rm -rf -- "$incoming"
    fi
    ;;

  install)
    [[ $# -eq 4 ]] || die 'install requires commit SHA, image tag, and incoming directory'
    sha="$2"
    tag="$3"
    incoming="$4"
    require_sha "$sha"
    require_tag "$tag"
    [[ "$tag" == "${sha:0:12}" ]] || die 'the image tag does not match the commit SHA'
    [[ "$incoming" == "/tmp/fetanagent-production-$sha" ]] || die 'the incoming path is not exact'
    [[ ! -L "$incoming" && -d "$incoming" && "$(realpath -- "$incoming")" == "$incoming" ]] ||
      die 'the incoming release directory is unsafe'
    [[ "$(stat --format='%U:%G:%a' "$incoming")" == 'fetanagent-admin:fetanagent-admin:700' ]] ||
      die 'the incoming release owner or mode is wrong'
    release="$RELEASE_ROOT/$sha"
    if [[ -e "$release" || -L "$release" ]]; then
      [[ ! -L "$release" && -d "$release" && "$(<"$release/.release-sha")" == "$sha" &&
        "$(<"$release/.image-tag")" == "$tag" ]] || die 'an unsafe conflicting release already exists'
      rm -rf -- "$incoming"
      verify_release_files "$release"
      verify_images "$sha" "$tag"
      exit 0
    fi
    local_count="$(find -P "$incoming" -mindepth 1 -maxdepth 1 -type f | wc -l)"
    [[ "$local_count" -eq 25 && -z "$(find -P "$incoming" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
      die 'the incoming production bundle shape is wrong'
    [[ -s "$incoming/fetanagent-production-images.tar" && -s "$incoming/compose.production.yaml" &&
      -s "$incoming/telebirr-assignment-signer-key-id" ]] || die 'the incoming production contract is incomplete'
    install -d -m 0700 "$incoming/secrets"
    for file in "$incoming"/*; do
      case "${file##*/}" in
        fetanagent-production-images.tar|compose.production.yaml|telebirr-assignment-signer-key-id|secrets) ;;
        *) mv -- "$file" "$incoming/secrets/" ;;
      esac
    done
    printf '%s\n' "$sha" >"$incoming/.release-sha"
    printf '%s\n' "$tag" >"$incoming/.image-tag"
    chown -R root:root "$incoming"
    chmod 0700 "$incoming" "$incoming/secrets"
    chmod 0400 "$incoming/secrets"/*
    chmod 0444 "$incoming/compose.production.yaml" "$incoming/telebirr-assignment-signer-key-id" \
      "$incoming/.release-sha" "$incoming/.image-tag"
    mv -- "$incoming" "$release"
    verify_release_files "$release"
    docker load --input "$release/fetanagent-production-images.tar" >/dev/null
    rm -f -- "$release/fetanagent-production-images.tar"
    verify_images "$sha" "$tag"
    ;;

  activate)
    [[ $# -eq 2 ]] || die 'activate requires one exact commit SHA'
    sha="$2"
    release="$(require_release "$sha")"
    tag="$(<"$release/.image-tag")"
    verify_release_files "$release"
    verify_images "$sha" "$tag"
    install -d -m 0700 "$STATE_ROOT"
    previous_file="$STATE_ROOT/pending-$sha.previous"
    previous=''
    if [[ -L "$CURRENT_LINK" ]]; then
      previous="$(readlink -f -- "$CURRENT_LINK")"
      [[ "$previous" == "$RELEASE_ROOT/"* && -d "$previous" ]] || die 'the current production release link is unsafe'
    elif [[ -e "$CURRENT_LINK" ]]; then
      die 'the current production release marker is unsafe'
    fi
    printf '%s\n' "$previous" >"$previous_file"
    trap 'rollback_transition "$sha" "$release"' ERR
    compose_release "$release" config --quiet
    compose_release "$release" up --detach --no-build --wait --wait-timeout 120 \
      owner-control customer-web api beta-admission
    if [[ -z "$previous" ]]; then
      stop_if_running "$(container_for "$STAGING_PROJECT" bot)"
      stop_if_running "$(container_for "$STAGING_PROJECT" gateway)"
    fi
    compose_release "$release" up --detach --no-build --wait --wait-timeout 120 bot gateway
    owner_body="$(curl --fail --silent --show-error --proto '=https' --tlsv1.2 --max-time 15 https://owner.fetanagent.com/owner)"
    if ! grep -Fq 'Private production control' <<<"$owner_body"; then
      rollback_transition "$sha" "$release"
      trap - ERR
      die 'the public Owner page is not production-bound'
    fi
    ln -sfn -- "$release" "$CURRENT_LINK.next"
    mv -Tf -- "$CURRENT_LINK.next" "$CURRENT_LINK"
    trap - ERR
    ;;

  status)
    [[ $# -eq 2 ]] || die 'status requires one exact commit SHA'
    sha="$2"
    release="$(require_release "$sha")"
    [[ -L "$CURRENT_LINK" && "$(readlink -f -- "$CURRENT_LINK")" == "$release" ]] ||
      die 'the requested release is not current'
    tag="$(<"$release/.image-tag")"
    verify_images "$sha" "$tag"
    for service in owner-control customer-web api beta-admission gateway; do
      id="$(container_for "$PROJECT_NAME" "$service")"
      container_running "$id" || die "$service is not running"
      [[ "$(docker inspect --format '{{.State.Health.Status}}' "$id")" == 'healthy' ]] ||
        die "$service is not healthy"
    done
    id="$(container_for "$PROJECT_NAME" bot)"
    container_running "$id" || die 'the Telegram bot is not running'
    [[ "$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$id")" == "$sha" ]] ||
      die 'the Telegram bot revision is wrong'
    ;;

  finalize)
    [[ $# -eq 2 ]] || die 'finalize requires one exact commit SHA'
    sha="$2"
    release="$(require_release "$sha")"
    [[ -L "$CURRENT_LINK" && "$(readlink -f -- "$CURRENT_LINK")" == "$release" ]] ||
      die 'only the current production release can be finalized'
    for service in owner-control customer-web api beta-admission; do
      stop_if_running "$(container_for "$STAGING_PROJECT" "$service")"
    done
    rm -f -- "$STATE_ROOT/pending-$sha.previous"
    ;;

  rollback)
    [[ $# -eq 2 ]] || die 'rollback requires one exact commit SHA'
    sha="$2"
    release="$(require_release "$sha")"
    previous_file="$STATE_ROOT/pending-$sha.previous"
    if [[ -f "$previous_file" ]]; then
      rollback_transition "$sha" "$release"
      rm -f -- "$previous_file"
    elif [[ -L "$CURRENT_LINK" ]]; then
      current="$(readlink -f -- "$CURRENT_LINK")"
      [[ "$current" == "$RELEASE_ROOT/"* && -d "$current" ]] ||
        die 'the current production release link is unsafe'
      [[ "$current" != "$release" ]] ||
        die 'a finalized production release cannot be rolled back without a pending predecessor'
    elif [[ -e "$CURRENT_LINK" ]]; then
      die 'the current production release marker is unsafe'
    fi
    ;;

  stop)
    [[ $# -eq 1 ]] || die 'stop accepts no arguments'
    if [[ -L "$CURRENT_LINK" ]]; then
      release="$(readlink -f -- "$CURRENT_LINK")"
      [[ "$release" == "$RELEASE_ROOT/"* && -d "$release" ]] || die 'the current release link is unsafe'
      compose_release "$release" down --remove-orphans --timeout 30
      rm -f -- "$CURRENT_LINK"
    elif [[ -e "$CURRENT_LINK" ]]; then
      die 'the current release marker is unsafe'
    fi
    ;;

  *)
    die 'expected verify, preflight, current-state, prepare-incoming, cleanup-incoming, install, activate, status, finalize, rollback, or stop'
    ;;
esac
