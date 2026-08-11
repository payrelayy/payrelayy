#!/usr/bin/env bash
# Root-owned, fail-closed helper for the exact PayReplayy staging beta Compose project.
# Install this reviewed file as /usr/local/sbin/payreplayy-staging-deploy-helper with
# root:root ownership and mode 0755. The SSH deployment identity may sudo only this helper.

set -euo pipefail

readonly EXPECTED_SUDO_USER='payreplayy-admin'
readonly HELPER_PATH='/usr/local/sbin/payreplayy-staging-deploy-helper'
readonly RELEASE_ROOT='/srv/payreplayy/releases'
readonly SECRET_ROOT='/srv/payreplayy/secrets/staging'
readonly PROJECT_NAME='payreplayy-staging-beta'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

export PATH="$SAFE_PATH"

die() {
  printf 'staging deploy helper failed: %s\n' "$1" >&2
  exit 1
}

docker_local() {
  env -i \
    PATH="$SAFE_PATH" \
    HOME='/root' \
    DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    docker --host "$LOCAL_DOCKER_SOCKET" "$@"
}

validate_commit_and_tag() {
  local commit_sha="$1"
  local image_tag="$2"
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || die 'the commit must be 40 lowercase hexadecimal characters'
  [[ "$image_tag" =~ ^[0-9a-f]{12}$ ]] || die 'the image tag must be 12 lowercase hexadecimal characters'
  [[ "$image_tag" == "${commit_sha:0:12}" ]] || die 'the image tag does not match the commit'
}

require_service_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" ]] || die 'a required service file is absent or symbolic'
  [[ "$(stat --format='%u:%g:%a' "$path")" == '10001:10001:400' ]] ||
    die 'a service secret does not have the required ownership and mode'
}

stop_project() {
  local containers
  containers="$(docker_local container ls --all --quiet --filter "label=com.docker.compose.project=$PROJECT_NAME")"
  if [[ -n "$containers" ]]; then
    # Container identifiers returned by Docker contain only hexadecimal characters and newlines.
    docker_local container rm --force $containers >/dev/null
  fi
  rm -f -- \
    "$SECRET_ROOT/owner-database-url" \
    "$SECRET_ROOT/publishable-key" \
    "$SECRET_ROOT/beta-database-url" \
    "$SECRET_ROOT/beta-transport-hmac" \
    "$SECRET_ROOT/bot-transport-hmac" \
    "$SECRET_ROOT/beta-payload-hmac" \
    "$SECRET_ROOT/player-action-database-url" \
    "$SECRET_ROOT/api-action-transport-hmac" \
    "$SECRET_ROOT/api-action-payload-hmac" \
    "$SECRET_ROOT/api-action-capability-hmac" \
    "$SECRET_ROOT/api-action-semantic-hmac" \
    "$SECRET_ROOT/bot-action-transport-hmac" \
    "$SECRET_ROOT/bot-token" \
    "$SECRET_ROOT/supabase-ca.crt"
}

[[ $EUID -eq 0 ]] || die 'the helper must run as root through sudo'
[[ "${SUDO_USER:-}" == "$EXPECTED_SUDO_USER" ]] || die 'the helper requires the dedicated deployment identity'
[[ "$0" == "$HELPER_PATH" ]] || die 'the helper must run from its root-owned installed path'
[[ ! -L "$HELPER_PATH" && "$(stat --format='%U:%G:%a' "$HELPER_PATH")" == 'root:root:755' ]] ||
  die 'the installed helper ownership or mode is unsafe'
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || die 'Docker overrides are forbidden'

command="${1:-}"
case "$command" in
  verify)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{64}$ ]] || die 'verify requires one SHA-256 digest'
    [[ "$(sha256sum "$HELPER_PATH" | awk '{print $1}')" == "$2" ]] ||
      die 'the installed helper does not match the reviewed repository helper'
    ;;

  stop)
    [[ $# -eq 1 ]] || die 'stop accepts no additional arguments'
    stop_project
    ;;

  discard)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{40}$ ]] || die 'discard requires one full commit SHA'
    incoming="/tmp/payreplayy-$2"
    if [[ -e "$incoming" || -L "$incoming" ]]; then
      [[ ! -L "$incoming" && -d "$incoming" ]] || die 'the incoming cleanup target is unsafe'
      [[ "$(stat --format='%U:%a' "$incoming")" == "$EXPECTED_SUDO_USER:700" ]] ||
        die 'the incoming cleanup target ownership or mode is unsafe'
      rm -rf -- "$incoming"
    fi
    ;;

  install)
    [[ $# -eq 4 ]] || die 'install requires a commit, image tag, and incoming directory'
    commit_sha="$2"
    image_tag="$3"
    incoming="$4"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    [[ "$incoming" == "/tmp/payreplayy-$commit_sha" ]] || die 'the incoming directory is outside the approved path'
    [[ ! -L "$incoming" && -d "$incoming" ]] || die 'the incoming directory is absent or symbolic'
    [[ "$(stat --format='%U:%a' "$incoming")" == "$EXPECTED_SUDO_USER:700" ]] ||
      die 'the incoming directory ownership or mode is unsafe'

    expected_files="$({ printf '%s\n' \
      api-action-capability-hmac api-action-payload-hmac api-action-semantic-hmac \
      api-action-transport-hmac \
      beta-database-url beta-payload-hmac beta-transport-hmac bot-token bot-transport-hmac \
      bot-action-transport-hmac player-action-database-url \
      compose.staging-beta.yaml owner-database-url payreplayy-staging-images.tar publishable-key \
      supabase-ca.crt; } | sort)"
    actual_files="$(find "$incoming" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)"
    [[ "$actual_files" == "$expected_files" ]] || die 'the incoming release file set is not exact'
    while IFS= read -r incoming_file; do
      [[ ! -L "$incoming/$incoming_file" && -f "$incoming/$incoming_file" ]] ||
        die 'an incoming release input is not a regular file'
    done <<<"$actual_files"

    release="$RELEASE_ROOT/$commit_sha"
    install -d -o root -g root -m 0755 "$release/infra" "$SECRET_ROOT"
    install -o root -g root -m 0444 \
      "$incoming/compose.staging-beta.yaml" "$release/infra/compose.staging-beta.yaml"
    install -o 10001 -g 10001 -m 0400 "$incoming/beta-database-url" "$SECRET_ROOT/beta-database-url"
    install -o 10001 -g 10001 -m 0400 "$incoming/owner-database-url" "$SECRET_ROOT/owner-database-url"
    install -o 10001 -g 10001 -m 0400 "$incoming/beta-transport-hmac" "$SECRET_ROOT/beta-transport-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/bot-transport-hmac" "$SECRET_ROOT/bot-transport-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/beta-payload-hmac" "$SECRET_ROOT/beta-payload-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/player-action-database-url" "$SECRET_ROOT/player-action-database-url"
    install -o 10001 -g 10001 -m 0400 "$incoming/api-action-transport-hmac" "$SECRET_ROOT/api-action-transport-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/api-action-payload-hmac" "$SECRET_ROOT/api-action-payload-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/api-action-capability-hmac" "$SECRET_ROOT/api-action-capability-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/api-action-semantic-hmac" "$SECRET_ROOT/api-action-semantic-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/bot-action-transport-hmac" "$SECRET_ROOT/bot-action-transport-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/bot-token" "$SECRET_ROOT/bot-token"
    install -o 10001 -g 10001 -m 0400 "$incoming/publishable-key" "$SECRET_ROOT/publishable-key"
    install -o root -g root -m 0444 "$incoming/supabase-ca.crt" "$SECRET_ROOT/supabase-ca.crt"

    docker_local image load --input "$incoming/payreplayy-staging-images.tar" >/dev/null
    for image in owner-control api beta-admission bot; do
      [[ "$(docker_local image inspect "payreplayy-$image:$image_tag" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
        die 'a loaded image revision does not match the reviewed commit'
    done
    rm -rf -- "$incoming"
    ;;

  start)
    [[ $# -eq 3 ]] || die 'start requires a commit and image tag'
    commit_sha="$2"
    image_tag="$3"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    compose_file="$RELEASE_ROOT/$commit_sha/infra/compose.staging-beta.yaml"
    [[ ! -L "$compose_file" && "$(stat --format='%U:%G:%a' "$compose_file")" == 'root:root:444' ]] ||
      die 'the sealed Compose contract is absent or unsafe'
    for service_file in \
      owner-database-url publishable-key beta-database-url beta-transport-hmac \
      bot-transport-hmac beta-payload-hmac bot-token player-action-database-url \
      api-action-transport-hmac api-action-payload-hmac api-action-capability-hmac \
      api-action-semantic-hmac bot-action-transport-hmac; do
      require_service_file "$SECRET_ROOT/$service_file"
    done
    [[ ! -L "$SECRET_ROOT/supabase-ca.crt" && "$(stat --format='%U:%G:%a' "$SECRET_ROOT/supabase-ca.crt")" == 'root:root:444' ]] ||
      die 'the public Supabase CA ownership or mode is unsafe'

    for image in owner-control api beta-admission bot; do
      [[ "$(docker_local image inspect "payreplayy-$image:$image_tag" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
        die 'an image revision does not match the reviewed commit'
    done

    env -i \
      PATH="$SAFE_PATH" \
      HOME='/root' \
      DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
      PAYREPLAYY_VCS_REF="$commit_sha" \
      PAYREPLAYY_IMAGE_TAG="$image_tag" \
      PAYREPLAYY_STAGING_OWNER_CONTROL_DATABASE_URL_FILE="$SECRET_ROOT/owner-database-url" \
      PAYREPLAYY_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/publishable-key" \
      PAYREPLAYY_STAGING_BETA_ADMISSION_DATABASE_URL_FILE="$SECRET_ROOT/beta-database-url" \
      PAYREPLAYY_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/beta-transport-hmac" \
      PAYREPLAYY_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/beta-payload-hmac" \
      PAYREPLAYY_STAGING_PLAYER_ACTION_DATABASE_URL_FILE="$SECRET_ROOT/player-action-database-url" \
      PAYREPLAYY_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/api-action-transport-hmac" \
      PAYREPLAYY_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/api-action-payload-hmac" \
      PAYREPLAYY_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE="$SECRET_ROOT/api-action-capability-hmac" \
      PAYREPLAYY_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE="$SECRET_ROOT/api-action-semantic-hmac" \
      PAYREPLAYY_STAGING_SUPABASE_CA_CERTIFICATE_FILE="$SECRET_ROOT/supabase-ca.crt" \
      PAYREPLAYY_STAGING_BOT_TOKEN_FILE="$SECRET_ROOT/bot-token" \
      PAYREPLAYY_STAGING_BOT_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-transport-hmac" \
      PAYREPLAYY_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-action-transport-hmac" \
      docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null \
        --project-name "$PROJECT_NAME" --profile staging-manual -f "$compose_file" \
        up -d --no-build --wait --wait-timeout 90
    ;;

  diagnose-owner-startup)
    [[ $# -eq 3 ]] || die 'diagnose-owner-startup requires a commit and image tag'
    commit_sha="$2"
    image_tag="$3"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    owner_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=owner-control')"
    [[ "$owner_container" =~ ^[0-9a-f]{12,64}$ ]] ||
      die 'exactly one Owner-control container was not available for diagnostics'
    [[ "$(docker_local container inspect "$owner_container" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
      die 'the Owner-control diagnostic target does not match the reviewed commit'

    docker_local container inspect "$owner_container" \
      --format 'owner-control status={{.State.Status}} exit_code={{.State.ExitCode}} oom_killed={{.State.OOMKilled}}'
    printf '%s\n' 'owner-control bounded startup log follows:'
    docker_local container logs --tail 80 "$owner_container"
    ;;

  *)
    die 'expected verify, stop, discard, install, start, or diagnose-owner-startup'
    ;;
esac
