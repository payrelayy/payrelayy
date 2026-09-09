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
readonly LEGACY_TELEBIRR_PROJECT='fetanagent-telebirr-device-pilot'
readonly TELEBIRR_INGRESS_NETWORK='fetanagent-telebirr-device-ingress'
readonly TELEBIRR_PUBLIC_ORIGIN='https://device.fetanagent.com'
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

acquire_operation_lock() {
  command -v flock >/dev/null || die 'the production operation lock is unavailable'
  [[ ! -L "$STATE_ROOT" ]] || die 'the production state directory is unsafe'
  if [[ ! -e "$STATE_ROOT" ]]; then install -d -m 0700 -o root -g root "$STATE_ROOT"; fi
  [[ -d "$STATE_ROOT" && "$(stat --format='%u:%g:%a' "$STATE_ROOT")" == '0:0:700' ]] ||
    die 'the production state directory is unsafe'
  local lock_file="$STATE_ROOT/helper.lock"
  [[ ! -L "$lock_file" ]] || die 'the production operation lock is unsafe'
  if [[ -e "$lock_file" ]]; then
    [[ -f "$lock_file" && "$(stat --format='%u:%g:%a' "$lock_file")" == '0:0:600' ]] ||
      die 'the production operation lock is unsafe'
  fi
  exec 9>>"$lock_file"
  flock --nonblock 9 || die 'another production operation is in progress; retry after it finishes'
}

# Caller holds the operation lock. Validation itself never changes services or receipts.
validate_rollback_transition() {
  local sha="$1" release="$2" receipt="$STATE_ROOT/pending-$1.previous"
  local previous='' current='' previous_sha='' current_sha='' ids='' revisions='' id revision
  local -a receipt_lines=() container_ids=()
  [[ "$(require_release "$sha")" == "$release" ]] || die 'the rollback candidate is not exact'
  [[ ! -L "$receipt" && -f "$receipt" &&
    "$(stat --format='%u:%g:%a' "$receipt")" == '0:0:600' &&
    "$(stat --format='%s' "$receipt")" -le 4096 ]] ||
    die 'the pending rollback receipt is absent or unsafe'
  mapfile -t receipt_lines <"$receipt"
  [[ "${#receipt_lines[@]}" -eq 1 ]] || die 'the pending rollback receipt is malformed'
  previous="${receipt_lines[0]}"
  if [[ -n "$previous" ]]; then
    previous_sha="${previous##*/}"
    [[ "$previous" == "$(require_release "$previous_sha")" && "$previous" != "$release" ]] ||
      die 'the rollback predecessor is not exact'
  fi
  if [[ -L "$CURRENT_LINK" ]]; then
    current="$(readlink -f -- "$CURRENT_LINK")" || die 'the current production release link is unsafe'
    current_sha="${current##*/}"
    [[ "$current" == "$(require_release "$current_sha")" ]] ||
      die 'the current production release link is unsafe'
  elif [[ -e "$CURRENT_LINK" ]]; then
    die 'the current production release marker is unsafe'
  fi
  [[ "$current" == "$release" ||
    ( -n "$previous" && "$current" == "$previous" ) ||
    ( -z "$previous" && -z "$current" ) ]] ||
    die 'stale rollback refused: production is outside this pending transition'
  ids="$(docker container ls --all --quiet --filter "label=com.docker.compose.project=$PROJECT_NAME")" ||
    die 'the production container identities could not be read'
  if [[ -n "$ids" ]]; then
    mapfile -t container_ids <<<"$ids"
    for id in "${container_ids[@]}"; do
      [[ "$id" =~ ^[0-9a-f]{12,64}$ ]] || die 'a production container identity is malformed'
    done
    revisions="$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "${container_ids[@]}")" ||
      die 'the production container revisions could not be read'
    mapfile -t receipt_lines <<<"$revisions"
    [[ "${#receipt_lines[@]}" -eq "${#container_ids[@]}" ]] ||
      die 'the production container revision count is wrong'
    for revision in "${receipt_lines[@]}"; do
      [[ "$revision" =~ ^[0-9a-f]{40}$ &&
        ( "$revision" == "$sha" || ( -n "$previous_sha" && "$revision" == "$previous_sha" ) ) ]] ||
        die 'stale rollback refused: a production container is outside this pending transition'
    done
  fi
  ROLLBACK_PREVIOUS="$previous"
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
  local sha="$1" tag="$2" release="${3:-}" image
  local -a images=(owner-control customer-web api beta-admission bot gateway)
  require_sha "$sha"
  require_tag "$tag"
  if [[ -n "$release" ]] && grep -Fq '  telebirr-assignment-broker:' "$release/compose.production.yaml"; then
    images+=(telebirr-assignment-broker telebirr-device-state-broker telebirr-device-bridge)
  fi
  if [[ -n "$release" ]] && grep -Fq '  production-companion-device-bridge:' "$release/compose.production.yaml"; then
    images+=(companion-device-bridge)
  fi
  for image in "${images[@]}"; do
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
    telebirr-assignment.spki.der
    telebirr-bridge-runtime-manifest.v1.json
    telebirr-bridge-server-signer.pkcs8.der
    telebirr-device-state-database-url
  )
  if grep -Fq '  production-companion-device-bridge:' "$release/compose.production.yaml"; then
    required+=(companion-device-database-url companion-bridge-server-signer.pkcs8.der companion-bridge-runtime-manifest.v2.json)
  fi
  [[ ! -L "$release/secrets" && -d "$release/secrets" ]] || die 'the secret directory is unsafe'
  for name in "${required[@]}"; do
    [[ ! -L "$release/secrets/$name" && -f "$release/secrets/$name" && -s "$release/secrets/$name" ]] ||
      die "the production release is missing $name"
    case "$name" in
      supabase-ca.crt|cbe-deposit-reference-key-profile.v1.json|deposit-proof-reference-profile.v2.json|telebirr-assignment.spki.der|telebirr-bridge-runtime-manifest.v1.json|companion-bridge-runtime-manifest.v2.json)
        [[ "$(stat --format='%u:%g:%a' "$release/secrets/$name")" == '0:0:444' ]] ||
          die "the production config metadata is wrong for $name"
        ;;
      *)
        [[ "$(stat --format='%u:%g:%a' "$release/secrets/$name")" == '10001:10001:400' ]] ||
          die "the production secret metadata is wrong for $name"
        ;;
    esac
  done
  [[ "$(find -P "$release/secrets" -mindepth 1 -maxdepth 1 -type f | wc -l)" -eq "${#required[@]}" ]] ||
    die 'the production secret directory contains an unexpected file'
  [[ -z "$(find -P "$release/secrets" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
    die 'the production secret directory contains a non-file entry'
}

restore_legacy_telebirr_bridge() {
  local sha="$1" receipt="$STATE_ROOT/pending-$1.legacy-bridge" id
  if [[ ! -e "$receipt" && ! -L "$receipt" ]]; then return; fi
  [[ ! -L "$receipt" && -f "$receipt" && "$(stat --format='%U:%G:%a' "$receipt")" == 'root:root:600' ]] ||
    die 'the legacy TeleBirr bridge rollback receipt is unsafe'
  id="$(<"$receipt")"
  [[ "$id" =~ ^[0-9a-f]{12,64}$ ]] || die 'the legacy TeleBirr bridge rollback identity is malformed'
  [[ "$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$id")" == "$LEGACY_TELEBIRR_PROJECT" &&
    "$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$id")" == 'telebirr-device-bridge' ]] ||
    die 'the legacy TeleBirr bridge rollback identity is not exact'
  start_if_stopped "$id"
  rm -f -- "$receipt"
}

quiesce_legacy_telebirr_bridge() {
  local sha="$1" receipt="$STATE_ROOT/pending-$1.legacy-bridge" id inspection
  [[ ! -e "$receipt" && ! -L "$receipt" ]] || die 'a legacy TeleBirr bridge rollback receipt already exists'
  id="$(container_for "$LEGACY_TELEBIRR_PROJECT" telebirr-device-bridge)"
  if ! container_running "$id"; then return; fi
  inspection="$(docker inspect "$id")"
  jq -e --arg project "$LEGACY_TELEBIRR_PROJECT" --arg network "$TELEBIRR_INGRESS_NETWORK" '
    length == 1 and
    .[0].Config.Labels["com.docker.compose.project"] == $project and
    .[0].Config.Labels["com.docker.compose.service"] == "telebirr-device-bridge" and
    .[0].State.Status == "running" and
    .[0].State.Health.Status == "healthy" and
    .[0].HostConfig.RestartPolicy.Name == "unless-stopped" and
    (.[0].NetworkSettings.Networks | has($network))
  ' <<<"$inspection" >/dev/null || die 'the legacy TeleBirr bridge is not safe to hand over'
  printf '%s\n' "$id" >"$receipt"
  chown root:root "$receipt"
  chmod 0600 "$receipt"
  stop_if_running "$id"
}

negative_telebirr_public_smoke() {
  local status route
  status="$(curl --http1.1 --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 8 --request POST \
    --header 'Content-Type: application/vnd.fetanagent.telebirr-device-bridge+json' \
    --data '{}' "$TELEBIRR_PUBLIC_ORIGIN/v1/telebirr/device/enrollments:pair")"
  [[ "$status" == '401' ]] || die 'the production pairing route did not reject an unsigned request'
  for route in \
    '/v1/telebirr/device/assignments:poll' \
    '/v1/telebirr/device/heartbeat' \
    '/v1/telebirr/device/observations:upload'
  do
    status="$(curl --http1.1 --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --max-time 8 --request POST \
      --header 'Content-Type: application/vnd.fetanagent.telebirr-device-bridge+json' \
      --data '{}' "$TELEBIRR_PUBLIC_ORIGIN$route")"
    [[ "$status" == '400' ]] || die 'a production device route did not reach the rejecting bridge'
  done
}

negative_companion_public_smoke() {
  local release="$1" status route
  if ! grep -Fq '  production-companion-device-bridge:' "$release/compose.production.yaml"; then return; fi
  for route in \
    '/v1/companion/device/enrollments:pair' \
    '/v1/companion/device/lookup-assignments:poll' \
    '/v1/companion/device/lookup-results:submit'
  do
    status="$(curl --http1.1 --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --proto '=https' --tlsv1.2 --max-time 8 --request POST \
      --header 'Content-Type: application/vnd.fetanagent.companion-device-bridge+json' \
      --header 'Accept: application/vnd.fetanagent.companion-device-bridge+json' \
      --data '{}' "https://device.fetanagent.com$route")"
    [[ "$status" == '401' ]] || die 'a production companion route did not reject an unsigned request'
  done
}

rollback_transition() {
  local sha="$1" release="$2" previous=''
  validate_rollback_transition "$sha" "$release"
  previous="$ROLLBACK_PREVIOUS"
  compose_release "$release" down --remove-orphans --timeout 30 >/dev/null 2>&1 || true
  if [[ -n "$previous" ]]; then
    compose_release "$previous" up --detach --no-build --wait --wait-timeout 120
    ln -sfn -- "$previous" "$CURRENT_LINK.next"
    mv -Tf -- "$CURRENT_LINK.next" "$CURRENT_LINK"
  else
    start_if_stopped "$(container_for "$STAGING_PROJECT" bot)"
    start_if_stopped "$(container_for "$STAGING_PROJECT" gateway)"
    rm -f -- "$CURRENT_LINK"
  fi
  restore_legacy_telebirr_bridge "$sha"
}

# Hold the same host lock throughout activation, including its internal ERR rollback.
case "${1:-}" in
  preflight|prepare-incoming|cleanup-incoming|install|activate|finalize|rollback|stop|check-rollback)
    acquire_operation_lock
    ;;
esac

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
      for service in owner-control customer-web api beta-admission bot telebirr-assignment-broker telebirr-device-state-broker telebirr-device-bridge production-companion-device-bridge gateway; do
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
      verify_images "$sha" "$tag" "$release"
      exit 0
    fi
    local_count="$(find -P "$incoming" -mindepth 1 -maxdepth 1 -type f | wc -l)"
    expected_count=29
    if grep -Fq '  production-companion-device-bridge:' "$incoming/compose.production.yaml"; then
      expected_count=32
    fi
    [[ "$local_count" -eq "$expected_count" && -z "$(find -P "$incoming" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ]] ||
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
    chown 10001:10001 "$incoming/secrets"/*
    chmod 0400 "$incoming/secrets"/*
    chown root:root \
      "$incoming/secrets/supabase-ca.crt" \
      "$incoming/secrets/cbe-deposit-reference-key-profile.v1.json" \
      "$incoming/secrets/deposit-proof-reference-profile.v2.json" \
      "$incoming/secrets/telebirr-assignment.spki.der" \
      "$incoming/secrets/telebirr-bridge-runtime-manifest.v1.json"
    chmod 0444 \
      "$incoming/secrets/supabase-ca.crt" \
      "$incoming/secrets/cbe-deposit-reference-key-profile.v1.json" \
      "$incoming/secrets/deposit-proof-reference-profile.v2.json" \
      "$incoming/secrets/telebirr-assignment.spki.der" \
      "$incoming/secrets/telebirr-bridge-runtime-manifest.v1.json"
    chmod 0444 "$incoming/compose.production.yaml" "$incoming/telebirr-assignment-signer-key-id" \
      "$incoming/.release-sha" "$incoming/.image-tag"
    if grep -Fq '  production-companion-device-bridge:' "$incoming/compose.production.yaml"; then
      chown root:root "$incoming/secrets/companion-bridge-runtime-manifest.v2.json"
      chmod 0444 "$incoming/secrets/companion-bridge-runtime-manifest.v2.json"
    fi
    mv -- "$incoming" "$release"
    verify_release_files "$release"
    docker load --input "$release/fetanagent-production-images.tar" >/dev/null
    rm -f -- "$release/fetanagent-production-images.tar"
    verify_images "$sha" "$tag" "$release"
    ;;

  activate)
    [[ $# -eq 2 ]] || die 'activate requires one exact commit SHA'
    sha="$2"
    release="$(require_release "$sha")"
    previous_file="$STATE_ROOT/pending-$sha.previous"
    [[ ! -e "$previous_file" && ! -L "$previous_file" ]] ||
      die 'a pending activation already exists; inspect its rollback boundary before retrying'
    previous=''
    if [[ -L "$CURRENT_LINK" ]]; then
      previous="$(readlink -f -- "$CURRENT_LINK")"
      [[ "$previous" == "$(require_release "${previous##*/}")" ]] ||
        die 'the current production release link is unsafe'
      [[ "$previous" != "$release" ]] ||
        die 'the requested release is already current; use status instead of reactivating it'
    elif [[ -e "$CURRENT_LINK" ]]; then
      die 'the current production release marker is unsafe'
    fi
    tag="$(<"$release/.image-tag")"
    verify_release_files "$release"
    verify_images "$sha" "$tag" "$release"
    printf '%s\n' "$previous" >"$previous_file"
    trap 'rollback_transition "$sha" "$release"' ERR
    compose_release "$release" config --quiet
    compose_release "$release" up --detach --no-build --wait --wait-timeout 120 \
      owner-control customer-web api beta-admission telebirr-assignment-broker telebirr-device-state-broker
    if [[ -z "$previous" ]]; then
      stop_if_running "$(container_for "$STAGING_PROJECT" bot)"
      stop_if_running "$(container_for "$STAGING_PROJECT" gateway)"
    fi
    quiesce_legacy_telebirr_bridge "$sha"
    compose_release "$release" up --detach --no-build --wait --wait-timeout 120 \
      telebirr-device-bridge
    if grep -Fq '  production-companion-device-bridge:' "$release/compose.production.yaml"; then
      compose_release "$release" up --detach --no-build --wait --wait-timeout 120 production-companion-device-bridge
    fi
    compose_release "$release" up --detach --no-build --wait --wait-timeout 120 bot gateway
    owner_body="$(curl --fail --silent --show-error --proto '=https' --tlsv1.2 --max-time 15 https://owner.fetanagent.com/owner)"
    if ! grep -Fq 'Private production control' <<<"$owner_body"; then
      rollback_transition "$sha" "$release"
      trap - ERR
      die 'the public Owner page is not production-bound'
    fi
    negative_telebirr_public_smoke
    negative_companion_public_smoke "$release"
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
    verify_images "$sha" "$tag" "$release"
    services=(owner-control customer-web api beta-admission gateway)
    if grep -Fq '  telebirr-assignment-broker:' "$release/compose.production.yaml"; then
      services=(owner-control customer-web api beta-admission telebirr-assignment-broker telebirr-device-state-broker telebirr-device-bridge gateway)
    fi
    if grep -Fq '  production-companion-device-bridge:' "$release/compose.production.yaml"; then
      services+=(production-companion-device-bridge)
    fi
    for service in "${services[@]}"; do
      id="$(container_for "$PROJECT_NAME" "$service")"
      container_running "$id" || die "$service is not running"
      [[ "$(docker inspect --format '{{.State.Health.Status}}' "$id")" == 'healthy' ]] ||
        die "$service is not healthy"
      [[ "$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$id")" == "$sha" ]] ||
        die "$service revision is wrong"
    done
    id="$(container_for "$PROJECT_NAME" bot)"
    container_running "$id" || die 'the Telegram bot is not running'
    [[ "$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$id")" == "$sha" ]] ||
      die 'the Telegram bot revision is wrong'
    if grep -Fq 'apps/bot/dist/telegram-polling-healthcheck.js' "$release/compose.production.yaml"; then
      [[ "$(docker inspect --format '{{.State.Health.Status}}' "$id")" == 'healthy' ]] ||
        die 'the Telegram bot has no recent successful polling check'
    else
      printf '%s\n' 'Legacy release: Telegram polling health is unverified; only process and revision were checked.' >&2
    fi
    negative_telebirr_public_smoke
    negative_companion_public_smoke "$release"
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
    for service in telebirr-device-bridge telebirr-device-state-broker telebirr-assignment-broker; do
      stop_if_running "$(container_for "$LEGACY_TELEBIRR_PROJECT" "$service")"
    done
    rm -f -- "$STATE_ROOT/pending-$sha.legacy-bridge"
    rm -f -- "$STATE_ROOT/pending-$sha.previous"
    ;;

  rollback)
    [[ $# -eq 2 ]] || die 'rollback requires one exact commit SHA'
    sha="$2"
    release="$(require_release "$sha")"
    previous_file="$STATE_ROOT/pending-$sha.previous"
    if [[ -e "$previous_file" || -L "$previous_file" ]]; then
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

  check-rollback)
    [[ $# -eq 2 ]] || die 'check-rollback requires one exact commit SHA'
    sha="$2"
    release="$(require_release "$sha")"
    validate_rollback_transition "$sha" "$release"
    printf '%s\n' 'The pending rollback boundary is valid; no services or receipts were changed.'
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
    die 'expected verify, preflight, current-state, prepare-incoming, cleanup-incoming, install, activate, status, finalize, rollback, check-rollback, or stop'
    ;;
esac
