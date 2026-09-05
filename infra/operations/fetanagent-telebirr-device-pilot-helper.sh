#!/usr/bin/env bash
# Root-owned deployment boundary for the no-money TeleBirr Android device stack.
# Install as /usr/local/sbin/fetanagent-telebirr-device-pilot-helper, root:root 0755.

set -euo pipefail

readonly EXPECTED_SUDO_USER='fetanagent-admin'
readonly HELPER_PATH='/usr/local/sbin/fetanagent-telebirr-device-pilot-helper'
readonly PILOT_RELEASE_ROOT='/var/lib/fetanagent/telebirr-device-pilot'
readonly STAGING_SECRET_ROOT='/srv/fetanagent/secrets/staging'
readonly PILOT_PROJECT='fetanagent-telebirr-device-pilot'
readonly STAGING_PROJECT='fetanagent-staging-beta'
readonly INGRESS_NETWORK='fetanagent-telebirr-device-ingress'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly MUTATION_ROOT='/run/fetanagent-telebirr-device-pilot-helper'
readonly MUTATION_LOCK="$MUTATION_ROOT/mutation.lock"
readonly ACTIVE_RECEIPT="$PILOT_RELEASE_ROOT/active-v1"
readonly PUBLIC_ORIGIN='https://device.fetanagent.com'
readonly STAGING_DIRECT_DATABASE_HOST='db.spzpiyxheappsfyswewl.supabase.co'

export PATH="$SAFE_PATH"

die() {
  printf 'TeleBirr device pilot helper failed: %s\n' "$1" >&2
  exit 1
}

docker_local() {
  env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    docker --host "$LOCAL_DOCKER_SOCKET" "$@"
}

validate_commit_and_tag() {
  local commit_sha="$1" image_tag="$2"
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || die 'the commit is not canonical'
  [[ "$image_tag" =~ ^[0-9a-f]{12}$ && "$image_tag" == "${commit_sha:0:12}" ]] ||
    die 'the image tag does not match the commit'
}

require_installed_helper() {
  [[ "$EUID" -eq 0 ]] || die 'the helper must run as root through sudo'
  [[ "${SUDO_USER:-}" == "$EXPECTED_SUDO_USER" ]] || die 'the sudo caller is not authorized'
  [[ "$0" == "$HELPER_PATH" ]] || die 'the helper must run from its installed path'
  [[ ! -L "$HELPER_PATH" && -f "$HELPER_PATH" ]] || die 'the installed helper is absent or symbolic'
  [[ "$(realpath -- "$HELPER_PATH")" == "$HELPER_PATH" ]] || die 'the installed helper path is not canonical'
  [[ "$(stat --format='%U:%G:%a:%h' "$HELPER_PATH")" == 'root:root:755:1' ]] ||
    die 'the installed helper metadata is unsafe'
}

acquire_mutation_lock() {
  local path_identity fd_identity
  command -v flock >/dev/null 2>&1 || die 'flock is unavailable'
  if [[ ! -e "$MUTATION_ROOT" && ! -L "$MUTATION_ROOT" ]]; then
    install -d -o root -g root -m 0700 "$MUTATION_ROOT"
  fi
  [[ ! -L "$MUTATION_ROOT" && -d "$MUTATION_ROOT" &&
    "$(realpath -- "$MUTATION_ROOT")" == "$MUTATION_ROOT" &&
    "$(stat --format='%U:%G:%a' "$MUTATION_ROOT")" == 'root:root:700' ]] ||
    die 'the mutation-lock directory is unsafe'
  if [[ ! -e "$MUTATION_LOCK" && ! -L "$MUTATION_LOCK" ]]; then
    (set -o noclobber; umask 077; : >"$MUTATION_LOCK") 2>/dev/null || true
  fi
  [[ ! -L "$MUTATION_LOCK" && -f "$MUTATION_LOCK" &&
    "$(stat --format='%U:%G:%a:%h' "$MUTATION_LOCK")" == 'root:root:600:1' ]] ||
    die 'the mutation-lock file is unsafe'
  exec 9<>"$MUTATION_LOCK"
  path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")"
  fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)"
  [[ "$path_identity" == "$fd_identity" ]] || die 'the mutation-lock inode changed'
  flock --exclusive --nonblock 9 || die 'another TeleBirr deployment mutation is active'
}

require_incoming_directory() {
  local path="$1"
  [[ "$path" =~ ^/tmp/fetanagent-telebirr-device-pilot-[0-9a-f]{40}$ ]] ||
    die 'the incoming path is not exact'
  [[ ! -L "$path" && -d "$path" && "$(realpath -- "$path")" == "$path" ]] ||
    die 'the incoming directory is absent, symbolic, or non-canonical'
  [[ "$(stat --format='%U:%G:%a' "$path")" == "$EXPECTED_SUDO_USER:$EXPECTED_SUDO_USER:700" ]] ||
    die 'the incoming directory metadata is unsafe'
}

require_incoming_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" ]] ||
    die 'an incoming file is absent, symbolic, or non-canonical'
  [[ "$(stat --format='%U:%G:%a:%h' "$path")" == "$EXPECTED_SUDO_USER:$EXPECTED_SUDO_USER:600:1" ]] ||
    die 'an incoming file metadata boundary is unsafe'
}

require_release_file() {
  local path="$1" expected="$2"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" ]] ||
    die 'a sealed release file is absent, symbolic, or non-canonical'
  [[ "$(stat --format='%u:%g:%a:%h' "$path")" == "$expected:1" ]] ||
    die 'a sealed release file has unsafe metadata'
}

require_database_url_file() {
  local path="$1" role="$2" value='' prefix suffix password
  prefix="postgresql://$role:"
  suffix="@$STAGING_DIRECT_DATABASE_HOST:5432/postgres?sslmode=verify-full"
  IFS= read -r -d '' value <"$path" || true
  [[ ${#value} -eq $((${#prefix} + 64 + ${#suffix})) &&
    "$value" == "$prefix"*"$suffix" ]] || {
    unset value
    die 'a sealed database URL does not use the exact no-whitespace byte contract'
  }
  password="${value:${#prefix}:64}"
  unset value
  [[ "$password" =~ ^[0-9a-f]{64}$ ]] || {
    unset password
    die 'a sealed database URL credential is not canonical'
  }
  unset password
}

require_staging_secret_root() {
  [[ ! -L "$STAGING_SECRET_ROOT" && -d "$STAGING_SECRET_ROOT" &&
    "$(realpath -- "$STAGING_SECRET_ROOT")" == "$STAGING_SECRET_ROOT" &&
    "$(stat --format='%U:%G' "$STAGING_SECRET_ROOT")" == 'root:root' ]] ||
    die 'the existing staging secret root is unsafe'
  case "$(stat --format='%a' "$STAGING_SECRET_ROOT")" in
    700 | 755) ;;
    *) die 'the existing staging secret root mode is unsafe' ;;
  esac
  local name
  for name in \
    owner-database-url publishable-key customer-web-database-url customer-web-publishable-key \
    customer-web-rate-limit-hmac beta-database-url beta-transport-hmac beta-payload-hmac \
    player-action-database-url api-action-transport-hmac api-action-payload-hmac \
    api-action-capability-hmac api-action-semantic-hmac cbe-deposit-reference-encryption-key \
    cbe-deposit-reference-fingerprint-key \
    deposit-proof-reference-encryption-master deposit-proof-reference-fingerprint-master \
    bot-token bot-transport-hmac bot-action-transport-hmac
  do
    [[ ! -L "$STAGING_SECRET_ROOT/$name" && -f "$STAGING_SECRET_ROOT/$name" &&
      "$(stat --format='%u:%g:%a:%h' "$STAGING_SECRET_ROOT/$name")" == '10001:10001:400:1' ]] ||
      die 'an existing private staging secret file is unavailable or unsafe'
  done
  for name in cbe-deposit-reference-key-profile.v1.json \
    deposit-proof-reference-profile.v2.json supabase-ca.crt
  do
    [[ ! -L "$STAGING_SECRET_ROOT/$name" && -f "$STAGING_SECRET_ROOT/$name" &&
      "$(stat --format='%u:%g:%a:%h' "$STAGING_SECRET_ROOT/$name")" == '0:0:444:1' ]] ||
      die 'an existing public staging configuration file is unavailable or unsafe'
  done
}

gateway_compose_environment() {
  local commit_sha="$1" image_tag="$2"
  printf '%s\0' \
    "PATH=$SAFE_PATH" \
    'HOME=/root' \
    "DOCKER_HOST=$LOCAL_DOCKER_SOCKET" \
    "FETANAGENT_VCS_REF=$commit_sha" \
    "FETANAGENT_IMAGE_TAG=$image_tag" \
    "FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE=$STAGING_SECRET_ROOT/owner-database-url" \
    "FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE=$STAGING_SECRET_ROOT/publishable-key" \
    "FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE=$STAGING_SECRET_ROOT/customer-web-database-url" \
    "FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE=$STAGING_SECRET_ROOT/customer-web-publishable-key" \
    "FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE=$STAGING_SECRET_ROOT/customer-web-rate-limit-hmac" \
    "FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE=$STAGING_SECRET_ROOT/beta-database-url" \
    "FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE=$STAGING_SECRET_ROOT/beta-transport-hmac" \
    "FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE=$STAGING_SECRET_ROOT/beta-payload-hmac" \
    "FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE=$STAGING_SECRET_ROOT/player-action-database-url" \
    "FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE=$STAGING_SECRET_ROOT/api-action-transport-hmac" \
    "FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE=$STAGING_SECRET_ROOT/api-action-payload-hmac" \
    "FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE=$STAGING_SECRET_ROOT/api-action-capability-hmac" \
    "FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE=$STAGING_SECRET_ROOT/api-action-semantic-hmac" \
    "FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE=$STAGING_SECRET_ROOT/cbe-deposit-reference-encryption-key" \
    "FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE=$STAGING_SECRET_ROOT/cbe-deposit-reference-fingerprint-key" \
    "FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE=$STAGING_SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json" \
    "FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE=$STAGING_SECRET_ROOT/deposit-proof-reference-encryption-master" \
    "FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE=$STAGING_SECRET_ROOT/deposit-proof-reference-fingerprint-master" \
    "FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE=$STAGING_SECRET_ROOT/deposit-proof-reference-profile.v2.json" \
    "FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE=$STAGING_SECRET_ROOT/supabase-ca.crt" \
    "FETANAGENT_STAGING_BOT_TOKEN_FILE=$STAGING_SECRET_ROOT/bot-token" \
    "FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE=$STAGING_SECRET_ROOT/bot-transport-hmac" \
    "FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE=$STAGING_SECRET_ROOT/bot-action-transport-hmac"
}

run_gateway_compose() {
  local release="$1" commit_sha="$2" image_tag="$3"
  shift 3
  local -a environment
  mapfile -d '' -t environment < <(gateway_compose_environment "$commit_sha" "$image_tag")
  # Compose validates dependencies after profile filtering. Keep the already-running
  # Owner and customer services in the model while the explicit `up --no-deps gateway`
  # call below remains the only operation that can recreate a base-stack service.
  env -i "${environment[@]}" docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null \
    --project-name "$STAGING_PROJECT" --profile staging-manual --profile public-domain \
    --file "$release/compose.staging-beta.yaml" "$@"
}

pilot_compose_environment() {
  local release="$1" commit_sha="$2" image_tag="$3"
  printf '%s\0' \
    "PATH=$SAFE_PATH" \
    'HOME=/root' \
    "DOCKER_HOST=$LOCAL_DOCKER_SOCKET" \
    "FETANAGENT_VCS_REF=$commit_sha" \
    "FETANAGENT_IMAGE_TAG=$image_tag" \
    "FETANAGENT_TELEBIRR_SUPABASE_CA_CERTIFICATE_FILE=$release/supabase-ca.crt" \
    "FETANAGENT_TELEBIRR_ASSIGNMENT_SIGNER_PUBLIC_KEY_FILE=$release/assignment.spki.der" \
    "FETANAGENT_TELEBIRR_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE=$release/bridge-runtime-manifest.v1.json" \
    "FETANAGENT_TELEBIRR_ASSIGNMENT_DATABASE_URL_FILE=$release/assignment-database-url" \
    "FETANAGENT_TELEBIRR_REFERENCE_OPENING_KEY_FILE=$release/reference-opening-key.v1.json" \
    "FETANAGENT_TELEBIRR_ASSIGNMENT_RUNTIME_MANIFEST_FILE=$release/assignment-runtime-manifest.v1.json" \
    "FETANAGENT_TELEBIRR_ASSIGNMENT_SIGNER_PRIVATE_KEY_FILE=$release/assignment-signer.pkcs8.der" \
    "FETANAGENT_TELEBIRR_DEVICE_STATE_DATABASE_URL_FILE=$release/device-state-database-url" \
    "FETANAGENT_TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE=$release/bridge-server-signer.pkcs8.der"
}

run_pilot_compose() {
  local release="$1" commit_sha="$2" image_tag="$3"
  shift 3
  local -a environment
  mapfile -d '' -t environment < <(pilot_compose_environment "$release" "$commit_sha" "$image_tag")
  env -i "${environment[@]}" docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null \
    --project-name "$PILOT_PROJECT" --profile telebirr-device-pilot \
    --file "$release/compose.telebirr-device-pilot.yaml" "$@"
}

require_image() {
  local image="$1" commit_sha="$2" expected_command="$3"
  [[ "$(docker_local image inspect "$image" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
    die 'an image revision does not match the reviewed commit'
  [[ "$(docker_local image inspect "$image" --format '{{.Config.User}}')" == '10001:10001' ]] ||
    die 'an image does not use the fixed non-root identity'
  [[ "$(docker_local image inspect "$image" --format '{{json .Config.Cmd}}')" == "$expected_command" ]] ||
    die 'an image command is not exact'
  [[ "$(docker_local image inspect "$image" --format '{{json .Config.ExposedPorts}}')" == 'null' ]] ||
    die 'an internal image unexpectedly exposes a port'
}

require_gateway_image() {
  local image="$1" commit_sha="$2"
  [[ "$(docker_local image inspect "$image" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
    die 'the gateway image revision does not match the reviewed commit'
  [[ "$(docker_local image inspect "$image" --format '{{.Config.User}}')" == '10001:10001' ]] ||
    die 'the gateway image is not non-root'
  docker_local run --rm --network none --read-only --cap-drop ALL \
    --cap-add NET_BIND_SERVICE \
    --security-opt no-new-privileges:true "$image" \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
}

validate_images() {
  local commit_sha="$1" image_tag="$2"
  require_image "fetanagent-telebirr-assignment-broker:$image_tag" "$commit_sha" \
    '["node","apps/telebirr-assignment-broker/dist/telebirr-assignment-broker-main.js"]'
  require_image "fetanagent-telebirr-device-state-broker:$image_tag" "$commit_sha" \
    '["node","apps/telebirr-device-state-broker/dist/telebirr-device-state-broker-main.js"]'
  require_image "fetanagent-telebirr-device-bridge:$image_tag" "$commit_sha" \
    '["node","apps/telebirr-device-bridge/dist/telebirr-device-bridge-main.js"]'
  require_gateway_image "fetanagent-gateway:$image_tag" "$commit_sha"
}

validate_release() {
  local release="$1" commit_sha="$2" image_tag="$3"
  [[ "$release" == "$PILOT_RELEASE_ROOT/$commit_sha" && ! -L "$release" && -d "$release" &&
    "$(realpath -- "$release")" == "$release" &&
    "$(stat --format='%U:%G:%a' "$release")" == 'root:root:700' ]] ||
    die 'the sealed pilot release directory is unsafe'
  require_release_file "$release/compose.telebirr-device-pilot.yaml" '0:0:444'
  require_release_file "$release/compose.staging-beta.yaml" '0:0:444'
  require_release_file "$release/supabase-ca.crt" '0:0:444'
  require_release_file "$release/assignment.spki.der" '0:0:444'
  require_release_file "$release/bridge-runtime-manifest.v1.json" '0:0:444'
  require_release_file "$release/assignment-database-url" '10001:10001:400'
  require_release_file "$release/reference-opening-key.v1.json" '10001:10001:400'
  require_release_file "$release/assignment-runtime-manifest.v1.json" '10001:10001:400'
  require_release_file "$release/assignment-signer.pkcs8.der" '10001:10001:400'
  require_release_file "$release/device-state-database-url" '10001:10001:400'
  require_release_file "$release/bridge-server-signer.pkcs8.der" '10001:10001:400'
  require_database_url_file "$release/assignment-database-url" \
    'fetanagent_telebirr_assignment_broker_runtime'
  require_database_url_file "$release/device-state-database-url" \
    'fetanagent_telebirr_device_state_runtime'
  run_pilot_compose "$release" "$commit_sha" "$image_tag" config --quiet
  run_gateway_compose "$release" "$commit_sha" "$image_tag" config --quiet
  validate_images "$commit_sha" "$image_tag"
}

container_for_service() {
  local project="$1" service="$2" container
  container="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$service")"
  [[ "$container" =~ ^[0-9a-f]{12,64}$ ]] || die 'a component container inventory is ambiguous'
  printf '%s' "$container"
}

require_component_ready() {
  local service="$1" commit_sha="$2" expected_network="$3" container inspection
  container="$(container_for_service "$PILOT_PROJECT" "$service")"
  inspection="$(docker_local container inspect "$container")"
  jq -e --arg commit "$commit_sha" --arg network "$expected_network" '
    length == 1 and
    .[0].Config.User == "10001:10001" and
    .[0].Config.Labels["org.opencontainers.image.revision"] == $commit and
    .[0].HostConfig.ReadonlyRootfs == true and
    .[0].HostConfig.RestartPolicy.Name == "unless-stopped" and
    .[0].HostConfig.CapDrop == ["ALL"] and
    .[0].HostConfig.PortBindings == {} and
    .[0].State.Status == "running" and
    .[0].State.Health.Status == "healthy" and
    .[0].RestartCount == 0 and
    (.[0].NetworkSettings.Networks | keys) == [$network]
  ' <<<"$inspection" >/dev/null || die 'a TeleBirr component is not in its exact healthy boundary'
}

negative_public_smoke() {
  local status route

  status="$(curl --http1.1 --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 8 --request POST \
    --header 'Content-Type: application/vnd.fetanagent.telebirr-device-bridge+json' \
    --data '{}' "$PUBLIC_ORIGIN/v1/telebirr/device/enrollments:pair")"
  [[ "$status" == '401' ]] ||
    die 'the exact public pairing route did not reject an unsigned request'

  for route in \
    '/v1/telebirr/device/assignments:poll' \
    '/v1/telebirr/device/heartbeat' \
    '/v1/telebirr/device/observations:upload'
  do
    status="$(curl --http1.1 --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --max-time 8 --request POST \
      --header 'Content-Type: application/vnd.fetanagent.telebirr-device-bridge+json' \
      --data '{}' "$PUBLIC_ORIGIN$route")"
    [[ "$status" == '400' ]] || die 'an exact public device route did not reach the rejecting bridge'
  done
  status="$(curl --http1.1 --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 8 --request GET "$PUBLIC_ORIGIN/v1/telebirr/device/heartbeat")"
  [[ "$status" == '404' ]] || die 'the public gateway accepted a wrong method'
  status="$(curl --http1.1 --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 8 --request POST --header 'Content-Type: application/json' --data '{}' \
    "$PUBLIC_ORIGIN/v1/telebirr/device/heartbeat")"
  [[ "$status" == '404' ]] || die 'the public gateway accepted a wrong content type'
  status="$(curl --http1.1 --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 8 --request POST \
    --header 'Content-Type: application/vnd.fetanagent.telebirr-device-bridge+json' \
    --data '{}' "$PUBLIC_ORIGIN/v1/telebirr/device/heartbeat?unexpected=1")"
  [[ "$status" == '400' ]] || die 'the public bridge did not reject a query-bearing route'
  status="$(curl --http1.1 --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 8 --request POST \
    --header 'Content-Type: application/vnd.fetanagent.telebirr-device-bridge+json' \
    --data '{}' "$PUBLIC_ORIGIN/v1/telebirr/device/unknown")"
  [[ "$status" == '404' ]] || die 'the public gateway accepted an unknown route'
}

ready() {
  local commit_sha="$1" image_tag="$2" release="$PILOT_RELEASE_ROOT/$1" gateway inspection
  validate_commit_and_tag "$commit_sha" "$image_tag"
  validate_release "$release" "$commit_sha" "$image_tag"
  require_component_ready telebirr-assignment-broker "$commit_sha" \
    "${PILOT_PROJECT}_telebirr_assignment_database_egress"
  require_component_ready telebirr-device-state-broker "$commit_sha" \
    "${PILOT_PROJECT}_telebirr_device_state_database_egress"
  require_component_ready telebirr-device-bridge "$commit_sha" "$INGRESS_NETWORK"

  gateway="$(container_for_service "$STAGING_PROJECT" gateway)"
  inspection="$(docker_local container inspect "$gateway")"
  jq -e --arg commit "$commit_sha" --arg network "$INGRESS_NETWORK" '
    length == 1 and
    .[0].Config.Labels["org.opencontainers.image.revision"] == $commit and
    .[0].State.Status == "running" and
    .[0].State.Health.Status == "healthy" and
    (.[0].NetworkSettings.Networks | has($network))
  ' <<<"$inspection" >/dev/null || die 'the exact gateway is not healthy on the device ingress network'
  docker_local exec "$gateway" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  negative_public_smoke
  printf 'TeleBirr Android device transport ready: exact release, three healthy no-money services, valid HTTPS, financial actions disabled.\n'
}

install_release() {
  local commit_sha="$1" image_tag="$2" incoming="$3" release="$PILOT_RELEASE_ROOT/$1"
  local staging="$PILOT_RELEASE_ROOT/.${commit_sha}.installing"
  validate_commit_and_tag "$commit_sha" "$image_tag"
  require_incoming_directory "$incoming"
  local file
  for file in \
    fetanagent-telebirr-images.tar compose.telebirr-device-pilot.yaml compose.staging-beta.yaml \
    supabase-ca.crt assignment.spki.der bridge-runtime-manifest.v1.json assignment-database-url \
    reference-opening-key.v1.json assignment-runtime-manifest.v1.json assignment-signer.pkcs8.der \
    device-state-database-url bridge-server-signer.pkcs8.der
  do
    require_incoming_file "$incoming/$file"
  done
  [[ ! -e "$release" && ! -L "$release" && ! -e "$staging" && ! -L "$staging" ]] ||
    die 'the immutable release or its staging path already exists'
  install -d -o root -g root -m 0700 "$PILOT_RELEASE_ROOT" "$staging"

  docker_local load --input "$incoming/fetanagent-telebirr-images.tar" >/dev/null
  validate_images "$commit_sha" "$image_tag"

  install -o root -g root -m 0444 "$incoming/compose.telebirr-device-pilot.yaml" \
    "$staging/compose.telebirr-device-pilot.yaml"
  install -o root -g root -m 0444 "$incoming/compose.staging-beta.yaml" \
    "$staging/compose.staging-beta.yaml"
  install -o root -g root -m 0444 "$incoming/supabase-ca.crt" "$staging/supabase-ca.crt"
  install -o root -g root -m 0444 "$incoming/assignment.spki.der" "$staging/assignment.spki.der"
  install -o root -g root -m 0444 "$incoming/bridge-runtime-manifest.v1.json" \
    "$staging/bridge-runtime-manifest.v1.json"
  install -o 10001 -g 10001 -m 0400 "$incoming/assignment-database-url" \
    "$staging/assignment-database-url"
  install -o 10001 -g 10001 -m 0400 "$incoming/reference-opening-key.v1.json" \
    "$staging/reference-opening-key.v1.json"
  install -o 10001 -g 10001 -m 0400 "$incoming/assignment-runtime-manifest.v1.json" \
    "$staging/assignment-runtime-manifest.v1.json"
  install -o 10001 -g 10001 -m 0400 "$incoming/assignment-signer.pkcs8.der" \
    "$staging/assignment-signer.pkcs8.der"
  install -o 10001 -g 10001 -m 0400 "$incoming/device-state-database-url" \
    "$staging/device-state-database-url"
  install -o 10001 -g 10001 -m 0400 "$incoming/bridge-server-signer.pkcs8.der" \
    "$staging/bridge-server-signer.pkcs8.der"
  require_database_url_file "$staging/assignment-database-url" \
    'fetanagent_telebirr_assignment_broker_runtime'
  require_database_url_file "$staging/device-state-database-url" \
    'fetanagent_telebirr_device_state_runtime'
  mv -- "$staging" "$release"
  rm -f -- "$incoming"/*
  rmdir -- "$incoming"
  validate_release "$release" "$commit_sha" "$image_tag"
}

start_release() {
  local commit_sha="$1" image_tag="$2" release="$PILOT_RELEASE_ROOT/$1"
  local gateway old_image old_commit rollback_receipt
  validate_commit_and_tag "$commit_sha" "$image_tag"
  validate_release "$release" "$commit_sha" "$image_tag"
  require_staging_secret_root
  gateway="$(container_for_service "$STAGING_PROJECT" gateway)"
  old_image="$(docker_local container inspect "$gateway" --format '{{.Config.Image}}')"
  old_commit="$(docker_local container inspect "$gateway" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
  [[ "$old_image" =~ ^fetanagent-gateway:[0-9a-f]{12}$ && "$old_commit" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the existing gateway rollback identity is not canonical'
  rollback_receipt="$release/gateway-rollback-v1"
  [[ ! -e "$rollback_receipt" && ! -L "$rollback_receipt" ]] ||
    die 'the gateway rollback receipt already exists'
  (umask 077; printf 'image=%s\ncommit=%s\n' "$old_image" "$old_commit" >"$rollback_receipt")
  chown root:root "$rollback_receipt"
  chmod 0600 "$rollback_receipt"

  run_gateway_compose "$release" "$commit_sha" "$image_tag" \
    up -d --no-build --no-deps --wait --wait-timeout 90 gateway
  run_pilot_compose "$release" "$commit_sha" "$image_tag" \
    up -d --no-build --wait --wait-timeout 120
  ready "$commit_sha" "$image_tag"
  [[ ! -e "$ACTIVE_RECEIPT" && ! -L "$ACTIVE_RECEIPT" ]] ||
    die 'another active TeleBirr device release is already recorded'
  (umask 077; printf '%s\n' "$commit_sha" >"$ACTIVE_RECEIPT")
  chown root:root "$ACTIVE_RECEIPT"
  chmod 0600 "$ACTIVE_RECEIPT"
}

stop_release() {
  local commit_sha="$1" image_tag="$2" release="$PILOT_RELEASE_ROOT/$1"
  validate_commit_and_tag "$commit_sha" "$image_tag"
  validate_release "$release" "$commit_sha" "$image_tag"
  if [[ -e "$ACTIVE_RECEIPT" || -L "$ACTIVE_RECEIPT" ]]; then
    [[ ! -L "$ACTIVE_RECEIPT" && -f "$ACTIVE_RECEIPT" &&
      "$(stat --format='%U:%G:%a:%h' "$ACTIVE_RECEIPT")" == 'root:root:600:1' &&
      "$(<"$ACTIVE_RECEIPT")" == "$commit_sha" ]] || die 'the active-release receipt is unsafe'
  fi
  run_pilot_compose "$release" "$commit_sha" "$image_tag" \
    rm --stop --force telebirr-device-bridge telebirr-device-state-broker telebirr-assignment-broker
  if [[ -f "$ACTIVE_RECEIPT" && ! -L "$ACTIVE_RECEIPT" ]]; then rm -f -- "$ACTIVE_RECEIPT"; fi
}

rollback_release() {
  local commit_sha="$1" image_tag="$2" release="$PILOT_RELEASE_ROOT/$1"
  local receipt="$release/gateway-rollback-v1" old_image old_tag old_commit
  validate_commit_and_tag "$commit_sha" "$image_tag"
  [[ ! -L "$receipt" && -f "$receipt" &&
    "$(stat --format='%U:%G:%a:%h' "$receipt")" == 'root:root:600:1' ]] ||
    die 'the rollback receipt is unavailable or unsafe'
  old_image="$(sed -n 's/^image=//p' "$receipt")"
  old_commit="$(sed -n 's/^commit=//p' "$receipt")"
  [[ "$old_image" =~ ^fetanagent-gateway:([0-9a-f]{12})$ ]] ||
    die 'the rollback receipt is not canonical'
  old_tag="${BASH_REMATCH[1]}"
  [[ "$old_commit" =~ ^[0-9a-f]{40}$ ]] || die 'the rollback receipt is not canonical'
  [[ "$old_tag" == "${old_commit:0:12}" ]] || die 'the rollback gateway binding is inconsistent'
  run_pilot_compose "$release" "$commit_sha" "$image_tag" \
    rm --stop --force telebirr-device-bridge telebirr-device-state-broker telebirr-assignment-broker || true
  require_staging_secret_root
  run_gateway_compose "$release" "$old_commit" "$old_tag" \
    up -d --no-build --no-deps --wait --wait-timeout 90 gateway
  if [[ -f "$ACTIVE_RECEIPT" && ! -L "$ACTIVE_RECEIPT" && "$(<"$ACTIVE_RECEIPT")" == "$commit_sha" ]]; then
    rm -f -- "$ACTIVE_RECEIPT"
  fi
}

require_installed_helper
command="${1:-}"
case "$command" in
  verify)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{64}$ ]] || die 'verify requires one SHA-256 digest'
    [[ "$(sha256sum -- "$HELPER_PATH" | awk '{print $1}')" == "$2" ]] ||
      die 'the installed helper does not match the reviewed source'
    ;;
  preflight)
    [[ $# -eq 4 ]] || die 'preflight requires commit, image tag, and incoming directory'
    validate_commit_and_tag "$2" "$3"
    require_incoming_directory "$4"
    require_staging_secret_root
    docker_local info >/dev/null
    [[ "$(df --output=avail -B 1024 /var/lib | tail -n 1 | tr -d '[:space:]')" -ge 2097152 ]] ||
      die 'the pilot release filesystem has less than 2 GiB free'
    [[ "$(df --output=avail -B 1024 "$4" | tail -n 1 | tr -d '[:space:]')" -ge 2097152 ]] ||
      die 'the incoming filesystem has less than 2 GiB free'
    ip -6 route show default | grep -q '^default ' ||
      die 'the VM has no default IPv6 route'
    getent ahostsv6 "$STAGING_DIRECT_DATABASE_HOST" >/dev/null ||
      die 'the staging direct database host has no IPv6 result'
    timeout 5 bash -c \
      "exec 3<>/dev/tcp/$STAGING_DIRECT_DATABASE_HOST/5432; exec 3>&-; exec 3<&-" ||
      die 'the staging direct database host is not reachable on port 5432'
    docker_local network inspect "$INGRESS_NETWORK" \
      --format '{{json .Internal}}' | grep -Fx true >/dev/null ||
      die 'the fixed internal device ingress network is unavailable'
    container_for_service "$STAGING_PROJECT" gateway >/dev/null
    ;;
  install)
    [[ $# -eq 4 ]] || die 'install requires commit, image tag, and incoming directory'
    acquire_mutation_lock
    install_release "$2" "$3" "$4"
    ;;
  start)
    [[ $# -eq 3 ]] || die 'start requires commit and image tag'
    acquire_mutation_lock
    start_release "$2" "$3"
    ;;
  ready)
    [[ $# -eq 3 ]] || die 'ready requires commit and image tag'
    ready "$2" "$3"
    ;;
  stop)
    [[ $# -eq 3 ]] || die 'stop requires commit and image tag'
    acquire_mutation_lock
    stop_release "$2" "$3"
    ;;
  rollback)
    [[ $# -eq 3 ]] || die 'rollback requires commit and image tag'
    acquire_mutation_lock
    rollback_release "$2" "$3"
    ;;
  *)
    die 'expected verify, preflight, install, start, ready, stop, or rollback'
    ;;
esac
