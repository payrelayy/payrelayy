#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 077

readonly PROJECT_NAME='fetanagent-production-trusted-telebirr-verifier'
readonly ROOT='/srv/fetanagent/production-trusted-telebirr-verifier'
readonly RELEASE_ROOT="$ROOT/releases"
readonly CURRENT_LINK="$ROOT/current"
readonly STATE_ROOT='/var/lib/fetanagent/production-trusted-telebirr-verifier'
readonly PRODUCTION_STATE_ROOT='/var/lib/fetanagent/production'
readonly HELPER_PATH='/usr/local/sbin/fetanagent-production-trusted-telebirr-verifier-helper'
readonly EXPECTED_COMPOSE_SHA256='8b9610be87d5347a3f30e6d9fd007ac256c55ddb5d50eac90edb99543e1856c2'

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

container_for_verifier() {
  local -a matches=()
  mapfile -t matches < <(
    docker container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=trusted-telebirr-verifier'
  )
  [[ "${#matches[@]}" -le 1 ]] || die 'multiple production verifier containers are present'
  if [[ "${#matches[@]}" -eq 1 ]]; then printf '%s\n' "${matches[0]}"; fi
}

assert_verifier_container_absent() {
  [[ -z "$(container_for_verifier)" ]] ||
    die 'the production verifier container remains present'
}

assert_deposit_executor_absent() {
  local id title service
  local -a running=()
  mapfile -t running < <(docker container ls --quiet)
  for id in "${running[@]}"; do
    title="$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.title" }}' "$id")"
    service="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$id")"
    [[ "$title" != 'fetanagent-deposit-executor' && "$service" != 'executor' ]] ||
      die 'a deposit executor container is running; verifier activation is refused'
  done
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

compose_release() {
  local release="$1" gate_mode="$2"
  shift 2
  local financial_mode='dry_run' verifier_enabled='false' pilot_enabled='false'
  if [[ "$gate_mode" == 'active' ]]; then
    financial_mode='live'
    verifier_enabled='true'
    pilot_enabled='true'
  elif [[ "$gate_mode" != 'disabled' ]]; then
    die 'the verifier gate mode is invalid'
  fi
  FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_IMAGE_ID="$(<"$release/.image-id")" \
    FETANAGENT_TRUSTED_TELEBIRR_FINANCIAL_ACTIONS_MODE="$financial_mode" \
    FETANAGENT_INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED="$verifier_enabled" \
    FETANAGENT_TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED="$pilot_enabled" \
    FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_SECRET_FILE="$release/trusted-telebirr-verifier-database-url" \
    FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_CONFIG_FILE="$release/trusted-telebirr-verifier-pins.v1.json" \
    FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_CONFIG_FILE="$release/supabase-ca.crt" \
    docker compose --project-name "$PROJECT_NAME" \
      --file "$release/compose.production-trusted-telebirr-verifier.yaml" \
      --profile production-trusted-telebirr-verifier "$@"
}

verify_running() {
  local sha="$1" release="$2" id inspection image_id
  id="$(container_for_verifier)"
  [[ -n "$id" ]] || die 'the production verifier container is absent'
  inspection="$(docker inspect "$id")"
  image_id="$(<"$release/.image-id")"
  jq -e --arg project "$PROJECT_NAME" --arg revision "$sha" --arg image "$image_id" '
    length == 1 and
    .[0].Config.Labels["com.docker.compose.project"] == $project and
    .[0].Config.Labels["com.docker.compose.service"] == "trusted-telebirr-verifier" and
    .[0].Config.Labels["org.opencontainers.image.revision"] == $revision and
    .[0].Image == $image and
    .[0].State.Running == true and .[0].State.Health.Status == "healthy" and
    .[0].Config.User == "10001:10001" and
    .[0].HostConfig.ReadonlyRootfs == true and
    .[0].HostConfig.Privileged == false and
    .[0].HostConfig.RestartPolicy.Name == "unless-stopped" and
    .[0].HostConfig.CapDrop == ["ALL"] and
    .[0].HostConfig.SecurityOpt == ["no-new-privileges:true"] and
    (.[0].NetworkSettings.Ports | length) == 0 and
    (.[0].NetworkSettings.Networks | length) == 1
  ' <<<"$inspection" >/dev/null || die 'the production verifier container boundary is wrong'
}

rollback_transition() {
  local sha="$1" release="$2" receipt="$STATE_ROOT/pending-$sha.previous" previous=''
  [[ ! -L "$receipt" && -f "$receipt" && "$(stat --format='%u:%g:%a' "$receipt")" == '0:0:600' ]] ||
    die 'the verifier rollback receipt is absent or unsafe'
  previous="$(<"$receipt")"
  compose_release "$release" disabled down --remove-orphans --timeout 20
  assert_verifier_container_absent
  if [[ -n "$previous" ]]; then
    assert_deposit_executor_absent
    previous_sha="${previous##*/}"
    [[ "$previous" == "$(require_release "$previous_sha")" && "$previous" != "$release" ]] ||
      die 'the verifier rollback predecessor is not exact'
    verify_release "$previous_sha" "$previous"
    compose_release "$previous" active up --detach --no-build --wait --wait-timeout 90
    verify_running "$previous_sha" "$previous"
    ln -sfn -- "$previous" "$CURRENT_LINK.next"
    mv -Tf -- "$CURRENT_LINK.next" "$CURRENT_LINK"
  else
    rm -f -- "$CURRENT_LINK"
  fi
  rm -f -- "$receipt"
}

case "${1:-}" in
  preflight|prepare-incoming|cleanup-incoming|install|activation-preflight|activate|status|status-current|finalize|rollback|stop)
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
    install -d -m 0700 -o root -g root "$ROOT" "$RELEASE_ROOT" "$STATE_ROOT"
    available="$(df --output=avail --block-size=1 "$ROOT" | tail -n 1 | tr -d ' ')"
    [[ "$available" =~ ^[0-9]+$ && "$available" -gt $((2 * $2 + 536870912)) ]] ||
      die 'insufficient storage for the verifier release and rollback margin'
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
        "$(stat --format='%U:%G:%a' "$incoming")" == 'fetanagent-admin:fetanagent-admin:700' ]] ||
        die 'the verifier incoming path is unsafe'
      find -P "$incoming" -mindepth 1 -maxdepth 1 -type f -delete
      rmdir -- "$incoming"
    fi
    ;;

  install)
    [[ $# -eq 5 ]] || die 'install requires commit SHA, tag, pin digest, and incoming directory'
    sha="$2"
    tag="$3"
    pin_digest="$4"
    incoming="$5"
    require_sha "$sha"
    require_tag "$tag"
    require_pin_digest "$pin_digest"
    [[ "$tag" == "${sha:0:12}" ]] || die 'the image tag does not match the commit SHA'
    [[ "$incoming" == "/tmp/fetanagent-production-trusted-telebirr-verifier-$sha" ]] ||
      die 'the verifier incoming path is not exact'
    [[ ! -L "$incoming" && -d "$incoming" && "$(realpath -- "$incoming")" == "$incoming" &&
      "$(stat --format='%U:%G:%a' "$incoming")" == 'fetanagent-admin:fetanagent-admin:700' ]] ||
      die 'the verifier incoming directory is unsafe'
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

    docker load --input "$incoming/fetanagent-trusted-telebirr-verifier-image.tar" >/dev/null
    image_id="$(docker image inspect "fetanagent-trusted-telebirr-verifier:$tag" --format '{{.Id}}')"
    [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'the loaded verifier image ID is invalid'
    [[ "$(docker image inspect "$image_id" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$sha" ]] ||
      die 'the loaded verifier image revision is wrong'
    rm -f -- "$incoming/fetanagent-trusted-telebirr-verifier-image.tar"
    printf '%s\n' "$sha" >"$incoming/.release-sha"
    printf '%s\n' "$tag" >"$incoming/.image-tag"
    printf '%s\n' "$image_id" >"$incoming/.image-id"
    printf '%s\n' "$pin_digest" >"$incoming/.pin-manifest-sha256"
    chown -R root:root "$incoming"
    chmod 0700 "$incoming"
    chmod 0444 \
      "$incoming/compose.production-trusted-telebirr-verifier.yaml" \
      "$incoming/supabase-ca.crt" \
      "$incoming/trusted-telebirr-verifier-pins.v1.json" \
      "$incoming/.release-sha" "$incoming/.image-tag" \
      "$incoming/.image-id" "$incoming/.pin-manifest-sha256"
    chown 10001:10001 "$incoming/trusted-telebirr-verifier-database-url"
    chmod 0400 "$incoming/trusted-telebirr-verifier-database-url"
    mv -- "$incoming" "$release"
    verify_release "$sha" "$release"
    ;;

  activation-preflight)
    [[ $# -eq 2 ]] || die 'activation-preflight requires one exact commit SHA'
    sha="$2"
    release="$(require_release "$sha")"
    verify_release "$sha" "$release"
    assert_deposit_executor_absent
    shopt -s nullglob
    pending_receipts=("$STATE_ROOT"/pending-*.previous)
    shopt -u nullglob
    [[ "${#pending_receipts[@]}" -eq 0 ]] ||
      die 'a pending verifier transition must be resolved before activation'
    if [[ -L "$CURRENT_LINK" ]]; then
      previous="$(readlink -f -- "$CURRENT_LINK")"
      [[ "$previous" != "$release" ]] || die 'the requested verifier release is already current'
      previous_sha="${previous##*/}"
      [[ "$previous" == "$(require_release "$previous_sha")" ]] ||
        die 'the current verifier release link is unsafe'
      verify_release "$previous_sha" "$previous"
      verify_running "$previous_sha" "$previous"
      cmp --silent -- "$previous/trusted-telebirr-verifier-database-url" \
        "$release/trusted-telebirr-verifier-database-url" ||
        die 'an active verifier upgrade cannot rotate its runtime credential'
    elif [[ -e "$CURRENT_LINK" ]]; then
      die 'the current verifier release marker is unsafe'
    else
      [[ -z "$(container_for_verifier)" ]] || die 'an untracked verifier container is present'
    fi
    printf '%s\n' 'The exact staged verifier release is eligible for a separately confirmed activation.'
    ;;

  activate)
    [[ $# -eq 2 ]] || die 'activate requires one exact commit SHA'
    sha="$2"
    release="$(require_release "$sha")"
    verify_release "$sha" "$release"
    assert_deposit_executor_absent
    receipt="$STATE_ROOT/pending-$sha.previous"
    [[ ! -e "$receipt" && ! -L "$receipt" ]] || die 'a pending verifier activation already exists'
    previous=''
    if [[ -L "$CURRENT_LINK" ]]; then
      previous="$(readlink -f -- "$CURRENT_LINK")"
      [[ "$previous" == "$(require_release "${previous##*/}")" ]] ||
        die 'the current verifier release link is unsafe'
      [[ "$previous" != "$release" ]] || die 'the requested verifier release is already current'
      verify_release "${previous##*/}" "$previous"
      verify_running "${previous##*/}" "$previous"
      cmp --silent -- "$previous/trusted-telebirr-verifier-database-url" \
        "$release/trusted-telebirr-verifier-database-url" ||
        die 'an active verifier upgrade cannot rotate its runtime credential'
    elif [[ -e "$CURRENT_LINK" ]]; then
      die 'the current verifier release marker is unsafe'
    fi
    printf '%s\n' "$previous" >"$receipt"
    chown root:root "$receipt"
    chmod 0600 "$receipt"
    trap 'rollback_transition "$sha" "$release"' ERR
    if [[ -n "$previous" ]]; then
      compose_release "$previous" disabled down --remove-orphans --timeout 20
      assert_verifier_container_absent
    fi
    compose_release "$release" active config --quiet
    compose_release "$release" active up --detach --no-build --wait --wait-timeout 90
    verify_running "$sha" "$release"
    ln -sfn -- "$release" "$CURRENT_LINK.next"
    mv -Tf -- "$CURRENT_LINK.next" "$CURRENT_LINK"
    trap - ERR
    ;;

  status)
    [[ $# -eq 2 ]] || die 'status requires one exact commit SHA'
    sha="$2"
    release="$(require_release "$sha")"
    [[ -L "$CURRENT_LINK" && "$(readlink -f -- "$CURRENT_LINK")" == "$release" ]] ||
      die 'the requested verifier release is not current'
    verify_release "$sha" "$release"
    assert_deposit_executor_absent
    verify_running "$sha" "$release"
    printf '%s\n' 'Production trusted TeleBirr verifier: exact release running and healthy.'
    ;;

  status-current)
    [[ $# -eq 1 ]] || die 'status-current accepts no arguments'
    [[ -L "$CURRENT_LINK" ]] || die 'there is no current production verifier release'
    release="$(readlink -f -- "$CURRENT_LINK")"
    sha="${release##*/}"
    [[ "$release" == "$(require_release "$sha")" ]] ||
      die 'the current verifier release is unsafe'
    verify_release "$sha" "$release"
    assert_deposit_executor_absent
    verify_running "$sha" "$release"
    printf '%s\n' 'Production trusted TeleBirr verifier: current release running and healthy.'
    ;;

  finalize)
    [[ $# -eq 2 ]] || die 'finalize requires one exact commit SHA'
    sha="$2"
    release="$(require_release "$sha")"
    [[ -L "$CURRENT_LINK" && "$(readlink -f -- "$CURRENT_LINK")" == "$release" ]] ||
      die 'only the current verifier release can be finalized'
    assert_deposit_executor_absent
    verify_running "$sha" "$release"
    receipt="$STATE_ROOT/pending-$sha.previous"
    [[ ! -L "$receipt" && -f "$receipt" ]] || die 'the verifier activation receipt is absent'
    rm -f -- "$receipt"
    ;;

  rollback)
    [[ $# -eq 2 ]] || die 'rollback requires one exact commit SHA'
    sha="$2"
    release="$(require_release "$sha")"
    receipt="$STATE_ROOT/pending-$sha.previous"
    if [[ -e "$receipt" || -L "$receipt" ]]; then
      rollback_transition "$sha" "$release"
    elif [[ ! -e "$CURRENT_LINK" && ! -L "$CURRENT_LINK" ]]; then
      printf '%s\n' 'The verifier activation was already rolled back to no active release.'
    elif [[ -L "$CURRENT_LINK" && "$(readlink -f -- "$CURRENT_LINK")" != "$release" ]]; then
      printf '%s\n' 'The verifier activation was already rolled back to its predecessor.'
    else
      die 'the current verifier release has no pending rollback boundary'
    fi
    ;;

  stop)
    [[ $# -eq 1 ]] || die 'stop accepts no arguments'
    if [[ -L "$CURRENT_LINK" ]]; then
      release="$(readlink -f -- "$CURRENT_LINK")"
      sha="${release##*/}"
      [[ "$release" == "$(require_release "$sha")" ]] || die 'the current verifier release is unsafe'
      compose_release "$release" disabled down --remove-orphans --timeout 20
      assert_verifier_container_absent
      rm -f -- "$CURRENT_LINK"
    elif [[ -e "$CURRENT_LINK" ]]; then
      die 'the current verifier release marker is unsafe'
    else
      [[ -z "$(container_for_verifier)" ]] || die 'an untracked verifier container is present'
    fi
    ;;

  *)
    die 'expected verify, preflight, prepare-incoming, cleanup-incoming, install, activation-preflight, activate, status, status-current, finalize, rollback, or stop'
    ;;
esac
