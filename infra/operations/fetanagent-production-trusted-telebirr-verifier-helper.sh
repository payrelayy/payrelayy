#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 077

readonly PROJECT_NAME='fetanagent-production-trusted-telebirr-verifier'
readonly ROOT='/srv/fetanagent/production-trusted-telebirr-verifier'
readonly RELEASE_ROOT="$ROOT/releases"
readonly STATE_ROOT='/var/lib/fetanagent/production-trusted-telebirr-verifier'
readonly PRODUCTION_STATE_ROOT='/var/lib/fetanagent/production'
readonly HELPER_PATH='/usr/local/sbin/fetanagent-production-trusted-telebirr-verifier-helper'
readonly EXPECTED_COMPOSE_SHA256='8498713c25e93b929b110d2945b83f7b6dd4c26e9d59eb45073aa8fbe720740f'

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

emergency_stop_verifier() {
  local attempt output
  local -a ids=()
  command -v docker >/dev/null || die 'Docker is required for emergency stop'
  command -v timeout >/dev/null || die 'timeout is required for bounded emergency stop'

  # There is deliberately no operation-lock, release, current-link, or Compose dependency here.
  # The three exact-label scans close a concurrent observation/removal window. No command in this
  # helper can create or start this service, so a successful final scan is stable within this
  # lifecycle. Direct root Docker access remains outside the delegated helper boundary.
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
  preflight|prepare-incoming|cleanup-incoming|install)
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

  status-inert)
    [[ $# -eq 1 ]] || die 'status-inert accepts no arguments'
    assert_verifier_container_absent
    printf '%s\n' 'Production trusted TeleBirr verifier: activation unavailable; no service container exists.'
    ;;

  emergency-stop)
    [[ $# -eq 1 ]] || die 'emergency-stop accepts no arguments'
    emergency_stop_verifier
    printf '%s\n' 'Production trusted TeleBirr verifier: exact labeled service container absent.'
    ;;

  *)
    die 'expected verify, preflight, prepare-incoming, cleanup-incoming, install, status-inert, or emergency-stop'
    ;;
esac
