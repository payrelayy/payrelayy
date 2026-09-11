#!/usr/bin/env bash
# Root-owned deployment boundary for the no-money TeleBirr Android device stack.
# Install as /usr/local/sbin/fetanagent-telebirr-device-pilot-helper, root:root 0755.

set -euo pipefail

readonly EXPECTED_SUDO_USER='fetanagent-admin'
readonly HELPER_PATH='/usr/local/sbin/fetanagent-telebirr-device-pilot-helper'
readonly PILOT_RELEASE_ROOT='/var/lib/fetanagent/telebirr-device-pilot'
readonly PILOT_PROJECT='fetanagent-telebirr-device-pilot'
readonly PRODUCTION_PROJECT='fetanagent-production'
readonly PRODUCTION_RELEASE='69be82ac3e49ff8c63c64c9aa7926e0046b48a10'
readonly INGRESS_NETWORK='fetanagent-telebirr-device-ingress'
readonly INGRESS_NETWORK_ID='5b3dc890fad4f062ac570e4bbc66f950d002b536843b2630473eb817537af738'
readonly INGRESS_NETWORK_CONFIG_HASH='ac7f178b6d4280a708b951cb93740b0f8323fb2cb2c75d05cf040f44e2c34209'
readonly INGRESS_NETWORK_COMPOSE_VERSION='5.1.4'
readonly INGRESS_NETWORK_IPV4_SUBNET='172.23.0.0/16'
readonly INGRESS_NETWORK_IPV4_GATEWAY='172.23.0.1'
readonly STAGING_BRIDGE_SERVICE='staging-device-pilot-bridge'
readonly LEGACY_BRIDGE_SERVICE='telebirr-device-bridge'
readonly ASSIGNMENT_EGRESS_NETWORK="${PILOT_PROJECT}_telebirr_assignment_database_egress"
readonly DEVICE_STATE_EGRESS_NETWORK="${PILOT_PROJECT}_telebirr_device_state_database_egress"
readonly STALE_PILOT_RELEASE='1478fc81b2d68fbfda31c954cd2fd7141044f0d2'
readonly STALE_ASSIGNMENT_EGRESS_NETWORK_ID='2d934c613623a579d463e080ecf6769d45cc781f7ceae340b9b989b5dea3e7ed'
readonly STALE_DEVICE_STATE_EGRESS_NETWORK_ID='2d9952e6b2e6d8cd0a3e8c4c6a91afc996b91bc1a1a2d00b99b8f69e5c261598'
readonly ASSIGNMENT_EGRESS_CONFIG_HASH='f360d1a51d3a3e8469bacc65c776a94657fadb0fd2106cb9c24fad0e5911c928'
readonly DEVICE_STATE_EGRESS_CONFIG_HASH='4995938523f921b6722ed64688aeadc173fc3351209d4ad4a557b7e7cfcc514c'
readonly DEPLOYMENT_TARGET_HEADER='X-FetanAgent-Deployment-Target: staging'
readonly EXPECTED_GATEWAY_CADDYFILE_SHA256='afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616'
readonly BASELINE_GATEWAY_CADDYFILE_SHA256='181992c8958397d63a7ae34137d51d4186ce0383c8cfd2bf8df137da11e12f24'
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

validate_images() {
  local commit_sha="$1" image_tag="$2"
  require_image "fetanagent-telebirr-assignment-broker:$image_tag" "$commit_sha" \
    '["node","apps/telebirr-assignment-broker/dist/telebirr-assignment-broker-main.js"]'
  require_image "fetanagent-telebirr-device-state-broker:$image_tag" "$commit_sha" \
    '["node","apps/telebirr-device-state-broker/dist/telebirr-device-state-broker-main.js"]'
  require_image "fetanagent-telebirr-device-bridge:$image_tag" "$commit_sha" \
    '["node","apps/telebirr-device-bridge/dist/telebirr-device-bridge-main.js"]'
}

bridge_service_for_release() {
  local release="$1" has_staging=false has_legacy=false
  grep -Fqx '  staging-device-pilot-bridge:' \
    "$release/compose.telebirr-device-pilot.yaml" && has_staging=true
  grep -Fqx '  telebirr-device-bridge:' \
    "$release/compose.telebirr-device-pilot.yaml" && has_legacy=true
  case "$has_staging:$has_legacy" in
    true:false) printf '%s' "$STAGING_BRIDGE_SERVICE" ;;
    false:true) printf '%s' "$LEGACY_BRIDGE_SERVICE" ;;
    *) die 'the sealed release has an ambiguous bridge service identity' ;;
  esac
}

validate_stoppable_release() {
  local release="$1" commit_sha="$2" image_tag="$3"
  [[ "$release" == "$PILOT_RELEASE_ROOT/$commit_sha" && ! -L "$release" && -d "$release" &&
    "$(realpath -- "$release")" == "$release" &&
    "$(stat --format='%U:%G:%a' "$release")" == 'root:root:700' ]] ||
    die 'the sealed pilot release directory is unsafe'
  require_release_file "$release/compose.telebirr-device-pilot.yaml" '0:0:444'
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
  bridge_service_for_release "$release" >/dev/null
  run_pilot_compose "$release" "$commit_sha" "$image_tag" config --quiet
  validate_images "$commit_sha" "$image_tag"
}

validate_release() {
  local release="$1" commit_sha="$2" image_tag="$3"
  validate_stoppable_release "$release" "$commit_sha" "$image_tag"
  [[ "$(bridge_service_for_release "$release")" == "$STAGING_BRIDGE_SERVICE" ]] ||
    die 'a new release must use the staging-specific bridge service identity'
}

container_for_service() {
  local project="$1" service="$2" container
  container="$(docker_local container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$service")"
  [[ "$container" =~ ^[0-9a-f]{64}$ ]] || die 'a component container inventory is ambiguous'
  printf '%s' "$container"
}

optional_container_for_service() {
  local project="$1" service="$2" container
  container="$(docker_local container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$service")" ||
    die 'an optional component container inventory could not be read'
  [[ -z "$container" || "$container" =~ ^[0-9a-f]{64}$ ]] ||
    die 'an optional component container inventory is ambiguous'
  printf '%s' "$container"
}

pilot_container_inventory() {
  docker_local container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PILOT_PROJECT" | sort
}

require_no_pilot_containers() {
  local failure="$1" inventory
  inventory="$(pilot_container_inventory)" ||
    die 'the TeleBirr pilot container inventory could not be read'
  [[ -z "$inventory" ]] || die "$failure"
}

remove_exact_empty_pilot_networks() {
  local commit_sha="$1" inventory inspection inventory_after network_id
  local -a networks
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || die 'the pilot network release is not canonical'
  inventory="$(docker_local network ls --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PILOT_PROJECT" | sort)" ||
    die 'the pilot network inventory could not be read'
  [[ -n "$inventory" ]] || return
  mapfile -t networks <<<"$inventory"
  [[ "${#networks[@]}" -le 2 ]] || die 'the pilot network inventory contains an extra network'
  inspection="$(docker_local network inspect "${networks[@]}")" ||
    die 'the pilot network inventory could not be inspected'
  jq -e --arg assignment "$ASSIGNMENT_EGRESS_NETWORK" \
    --arg assignment_hash "$ASSIGNMENT_EGRESS_CONFIG_HASH" \
    --arg commit "$commit_sha" --arg device_state "$DEVICE_STATE_EGRESS_NETWORK" \
    --arg device_state_hash "$DEVICE_STATE_EGRESS_CONFIG_HASH" \
    --arg project "$PILOT_PROJECT" --arg stale_release "$STALE_PILOT_RELEASE" \
    --arg stale_assignment_id "$STALE_ASSIGNMENT_EGRESS_NETWORK_ID" \
    --arg stale_device_state_id "$STALE_DEVICE_STATE_EGRESS_NETWORK_ID" '
      length >= 1 and length <= 2 and
      (map(.Id) | unique | length) == length and
      (map(.Name) | unique | length) == length and
      all(.[];
        (.Id | test("^[0-9a-f]{64}$")) and
        (.Name == $assignment or .Name == $device_state) and
        .Scope == "local" and .Driver == "bridge" and .EnableIPv4 == true and
        .EnableIPv6 == true and .Internal == false and .Attachable == false and
        .Ingress == false and
        .ConfigOnly == false and .Options == {} and
        .IPAM.Driver == "default" and .IPAM.Options == null and
        (.IPAM.Config | type) == "array" and (.IPAM.Config | length) == 2 and
        ([.IPAM.Config[] | select(
          ((.Subnet | capture("^172\\.(?<octet>1[6-9]|2[0-9]|3[01])\\.0\\.0/16$").octet) as $octet |
            .Gateway == ("172." + $octet + ".0.1"))
        )] | length) == 1 and
        ([.IPAM.Config[] | select(
          ((.Subnet | capture("^fdfe:628:7be8:(?<block>[0-9a-f]+)::/64$").block) as $block |
            .Gateway == ("fdfe:628:7be8:" + $block + "::1"))
        )] | length) == 1 and
        (.Containers // {}) == {} and
        (.Labels | keys | sort) == [
          "com.docker.compose.config-hash", "com.docker.compose.network",
          "com.docker.compose.project", "com.docker.compose.version"
        ] and
        .Labels["com.docker.compose.project"] == $project and
        .Labels["com.docker.compose.version"] == "5.1.4" and
        (if .Name == $assignment then
          .Labels["com.docker.compose.network"] == "telebirr_assignment_database_egress" and
          .Labels["com.docker.compose.config-hash"] == $assignment_hash and
          ($commit != $stale_release or
            (
              .Id == $stale_assignment_id and
              .IPAM.Config == [
                {"Subnet":"172.24.0.0/16","Gateway":"172.24.0.1"},
                {"Subnet":"fdfe:628:7be8:3::/64","Gateway":"fdfe:628:7be8:3::1"}
              ]
            ))
        else
          .Labels["com.docker.compose.network"] == "telebirr_device_state_database_egress" and
          .Labels["com.docker.compose.config-hash"] == $device_state_hash and
          ($commit != $stale_release or
            (
              .Id == $stale_device_state_id and
              .IPAM.Config == [
                {"Subnet":"172.25.0.0/16","Gateway":"172.25.0.1"},
                {"Subnet":"fdfe:628:7be8:4::/64","Gateway":"fdfe:628:7be8:4::1"}
              ]
            ))
        end)
      )
    ' <<<"$inspection" >/dev/null ||
    die 'a pilot network is not an exact empty Compose-owned database-egress network'
  inventory_after="$(docker_local network ls --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PILOT_PROJECT" | sort)" ||
    die 'the pilot network inventory could not be re-read'
  [[ "$inventory_after" == "$inventory" ]] ||
    die 'the pilot network inventory changed before exact removal'
  for network_id in "${networks[@]}"; do
    docker_local network inspect "$network_id" | jq -e '
      length == 1 and (.[0].Containers // {}) == {}
    ' >/dev/null || die 'a pilot network gained an endpoint before exact removal'
    docker_local network rm "$network_id" >/dev/null ||
      die 'an exact empty pilot database-egress network could not be removed'
  done
  [[ -z "$(docker_local network ls --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PILOT_PROJECT")" ]] ||
    die 'a pilot project network remained after exact removal'
}

require_stoppable_pilot_inventory() {
  local bridge_service="$1" commit_sha="$2" image_tag="$3" inventory inspection
  local -a containers
  inventory="$(pilot_container_inventory)" ||
    die 'the TeleBirr pilot container inventory could not be read'
  [[ -n "$inventory" ]] || return
  mapfile -t containers <<<"$inventory"
  inspection="$(docker_local container inspect "${containers[@]}")" ||
    die 'the TeleBirr pilot containers could not be inspected'
  jq -e --arg project "$PILOT_PROJECT" --arg bridge "$bridge_service" \
    --arg commit "$commit_sha" --arg tag "$image_tag" --arg ingress "$INGRESS_NETWORK" \
    --arg assignment "$ASSIGNMENT_EGRESS_NETWORK" \
    --arg device_state "$DEVICE_STATE_EGRESS_NETWORK" '
    . as $containers |
    ($containers | length) >= 1 and
    ($containers | length) <= 3 and
    all($containers[];
      (.Id | test("^[0-9a-f]{64}$")) and
      .Config.Labels["com.docker.compose.project"] == $project and
      .Config.Labels["com.docker.compose.container-number"] == "1" and
      .Config.Labels["com.docker.compose.oneoff"] == "False" and
      .Config.Labels["org.opencontainers.image.revision"] == $commit and
      .Config.User == "10001:10001" and
      .Config.Entrypoint == ["docker-entrypoint.sh"] and
      ([.Config.Env[] | select(startswith("FINANCIAL_ACTIONS_MODE="))] ==
        ["FINANCIAL_ACTIONS_MODE=dry_run"]) and
      ([.Config.Env[] | select(
        . == "KEMERBET_EXECUTOR_ENABLED=true" or . == "KEMERBET_FINAL_ACTION_ENABLED=true"
      )] | length) == 0 and
      .HostConfig.ReadonlyRootfs == true and
      .HostConfig.RestartPolicy.Name == "unless-stopped" and
      .HostConfig.Privileged == false and
      .HostConfig.CapDrop == ["ALL"] and
      .HostConfig.PortBindings == {} and .Config.ExposedPorts == null and
      .State.Paused == false and .State.Restarting == false and
      .State.Dead == false and .State.OOMKilled == false and .RestartCount == 0 and
      (
        (.State.Status == "running" and .State.Running == true) or
        (.State.Status == "created" and .State.Running == false) or
        (.State.Status == "exited" and .State.Running == false and .State.ExitCode == 0)
      ) and
      (
        (
          .Config.Labels["com.docker.compose.service"] == "telebirr-assignment-broker" and
          .Name == "/\($project)-telebirr-assignment-broker-1" and
          .Config.Image == "fetanagent-telebirr-assignment-broker:\($tag)" and
          .Config.Labels["org.opencontainers.image.title"] ==
            "fetanagent-telebirr-assignment-broker" and
          .Config.Cmd ==
            ["node","apps/telebirr-assignment-broker/dist/telebirr-assignment-broker-main.js"] and
          ([.Config.Env[] | select(startswith(
            "TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET="
          ))] == ["TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET=staging"]) and
          (.NetworkSettings.Networks | keys) == [$assignment]
        ) or
        (
          .Config.Labels["com.docker.compose.service"] == "telebirr-device-state-broker" and
          .Name == "/\($project)-telebirr-device-state-broker-1" and
          .Config.Image == "fetanagent-telebirr-device-state-broker:\($tag)" and
          .Config.Labels["org.opencontainers.image.title"] ==
            "fetanagent-telebirr-device-state-broker" and
          .Config.Cmd ==
            ["node","apps/telebirr-device-state-broker/dist/telebirr-device-state-broker-main.js"] and
          ([.Config.Env[] | select(startswith(
            "TELEBIRR_DEVICE_STATE_BROKER_DEPLOYMENT_TARGET="
          ))] == ["TELEBIRR_DEVICE_STATE_BROKER_DEPLOYMENT_TARGET=staging"]) and
          (.NetworkSettings.Networks | keys) == [$device_state]
        ) or
        (
          .Config.Labels["com.docker.compose.service"] == $bridge and
          .Name == "/\($project)-\($bridge)-1" and
          .Config.Image == "fetanagent-telebirr-device-bridge:\($tag)" and
          .Config.Labels["org.opencontainers.image.title"] ==
            "fetanagent-telebirr-device-bridge" and
          .Config.Cmd ==
            ["node","apps/telebirr-device-bridge/dist/telebirr-device-bridge-main.js"] and
          ([.Config.Env[] | select(startswith(
            "TELEBIRR_DEVICE_BRIDGE_DEPLOYMENT_TARGET="
          ))] == ["TELEBIRR_DEVICE_BRIDGE_DEPLOYMENT_TARGET=staging"]) and
          ((.NetworkSettings.Networks | keys) == [] or
            (.NetworkSettings.Networks | keys) == [$ingress])
        )
      )
    ) and
    (
      ($containers | map(.Config.Labels["com.docker.compose.service"]) | unique | length) ==
      ($containers | length)
    )
  ' <<<"$inspection" >/dev/null ||
    die 'the pilot container inventory is not an exact subset of the sealed release'
}

gateway_caddyfile_sha256() {
  local gateway="$1" digest
  [[ "$gateway" =~ ^[0-9a-f]{64}$ ]] || die 'the production gateway identity is invalid'
  digest="$(
    docker_local exec "$gateway" cat /etc/caddy/Caddyfile | sha256sum | awk '{print $1}'
  )" || die 'the production gateway Caddyfile could not be attested'
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || die 'the production gateway Caddyfile digest is invalid'
  printf '%s' "$digest"
}

require_production_endpoint_boundary() {
  local expected_gateway_revision="${1:-}" gateway production_bridge inspection
  local gateway_revision caddyfile_sha256
  [[ -z "$expected_gateway_revision" || "$expected_gateway_revision" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the expected production gateway revision is invalid'
  gateway="$(container_for_service "$PRODUCTION_PROJECT" gateway)"
  production_bridge="$(container_for_service "$PRODUCTION_PROJECT" "$LEGACY_BRIDGE_SERVICE")"
  inspection="$(docker_local container inspect \
    "$PRODUCTION_PROJECT-gateway-1" "$PRODUCTION_PROJECT-$LEGACY_BRIDGE_SERVICE-1")" ||
    die 'the production ingress containers could not be inspected by exact name'
  jq -e --arg gateway_id "$gateway" --arg bridge_id "$production_bridge" \
    --arg expected_gateway_revision "$expected_gateway_revision" \
    --arg network "$INGRESS_NETWORK" --arg network_id "$INGRESS_NETWORK_ID" \
    --arg production_release "$PRODUCTION_RELEASE" '
    length == 2 and
    (map(.Id) | sort) == ([$gateway_id, $bridge_id] | sort) and
    (map(.Name) | sort) == [
      "/fetanagent-production-gateway-1",
      "/fetanagent-production-telebirr-device-bridge-1"
    ] and
    all(.[];
      .Config.Labels["com.docker.compose.project"] == "fetanagent-production" and
      .Config.Labels["com.docker.compose.container-number"] == "1" and
      .Config.Labels["com.docker.compose.oneoff"] == "False" and
      .Config.User == "10001:10001" and
      .State.Status == "running" and .State.Running == true and
      .State.Paused == false and .State.Restarting == false and
      .State.Dead == false and .State.OOMKilled == false and
      .State.Health.Status == "healthy" and .RestartCount == 0 and
      .HostConfig.ReadonlyRootfs == true and
      .HostConfig.RestartPolicy.Name == "unless-stopped" and
      .HostConfig.CapDrop == ["ALL"] and
      .NetworkSettings.Networks[$network].NetworkID == $network_id and
      (if .Config.Labels["com.docker.compose.service"] == "gateway" then
        .Id == $gateway_id and
        .Name == "/fetanagent-production-gateway-1" and
        (.Config.Labels["org.opencontainers.image.revision"] | test("^[0-9a-f]{40}$")) and
        ($expected_gateway_revision == "" or
          .Config.Labels["org.opencontainers.image.revision"] == $expected_gateway_revision) and
        .Config.Image == ("fetanagent-gateway:" +
          (.Config.Labels["org.opencontainers.image.revision"][0:12])) and
        .Config.Labels["org.opencontainers.image.title"] == "fetanagent-gateway" and
        .Config.Entrypoint == null and
        .Config.Cmd == ["caddy","run","--config","/etc/caddy/Caddyfile","--adapter","caddyfile"] and
        ([.Config.Env[] | select(
          startswith("FINANCIAL_ACTIONS_MODE=") or
          startswith("KEMERBET_EXECUTOR_ENABLED=") or
          startswith("KEMERBET_FINAL_ACTION_ENABLED=")
        )] | length) == 0 and
        (.NetworkSettings.Networks | keys | sort) == [
          "fetanagent-companion-device-ingress",
          "fetanagent-production_public_application",
          "fetanagent-telebirr-device-ingress"
        ] and
        all(.NetworkSettings.Networks[];
          (.Aliases | unique | sort) == ["fetanagent-production-gateway-1", "gateway"]) and
        .HostConfig.PortBindings == {
          "443/tcp": [{"HostIp":"","HostPort":"443"}],
          "80/tcp": [{"HostIp":"","HostPort":"80"}]
        }
      elif .Config.Labels["com.docker.compose.service"] == "telebirr-device-bridge" then
        .Id == $bridge_id and
        .Name == "/fetanagent-production-telebirr-device-bridge-1" and
        .Config.Labels["org.opencontainers.image.revision"] == $production_release and
        .Config.Image == ("fetanagent-telebirr-device-bridge:" + ($production_release[0:12])) and
        .Config.Labels["org.opencontainers.image.title"] == "fetanagent-telebirr-device-bridge" and
        .Config.Entrypoint == ["docker-entrypoint.sh"] and
        .Config.Cmd == ["node","apps/telebirr-device-bridge/dist/telebirr-device-bridge-main.js"] and
        ([.Config.Env[] | select(startswith("FINANCIAL_ACTIONS_MODE="))] ==
          ["FINANCIAL_ACTIONS_MODE=dry_run"]) and
        ([.Config.Env[] | select(startswith("KEMERBET_EXECUTOR_ENABLED="))] ==
          ["KEMERBET_EXECUTOR_ENABLED=false"]) and
        ([.Config.Env[] | select(startswith("KEMERBET_FINAL_ACTION_ENABLED="))] ==
          ["KEMERBET_FINAL_ACTION_ENABLED=false"]) and
        (.NetworkSettings.Networks | keys) == [$network] and
        (.NetworkSettings.Networks[$network].Aliases | unique | sort) == [
          "fetanagent-production-telebirr-device-bridge-1",
          "telebirr-device-bridge"
        ] and
        .HostConfig.PortBindings == {} and .Config.ExposedPorts == null and
        .NetworkSettings.Ports == {}
      else false end)
    )
  ' <<<"$inspection" >/dev/null ||
    die 'the production gateway or TeleBirr bridge is outside the exact H18-derived boundary'

  gateway_revision="$(jq -r '.[] | select(
    .Config.Labels["com.docker.compose.service"] == "gateway"
  ) | .Config.Labels["org.opencontainers.image.revision"]' <<<"$inspection")" ||
    die 'the production gateway revision could not be read'
  caddyfile_sha256="$(gateway_caddyfile_sha256 "$gateway")"
  if [[ -n "$expected_gateway_revision" ]]; then
    [[ "$gateway_revision" == "$expected_gateway_revision" &&
      "$caddyfile_sha256" == "$EXPECTED_GATEWAY_CADDYFILE_SHA256" ]] ||
      die 'the production gateway route revision and Caddyfile are not the reviewed pair'
    docker_local exec "$gateway" caddy validate \
      --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null ||
      die 'the exact production gateway configuration is invalid'
  elif [[ "$gateway_revision" == "$PRODUCTION_RELEASE" ]]; then
    [[ "$caddyfile_sha256" == "$BASELINE_GATEWAY_CADDYFILE_SHA256" ]] ||
      die 'the baseline production gateway revision has unexpected Caddyfile bytes'
  else
    [[ "$caddyfile_sha256" == "$EXPECTED_GATEWAY_CADDYFILE_SHA256" ]] ||
      die 'a post-baseline production gateway lacks the reviewed dual-route Caddyfile'
  fi
}

production_ingress_runtime_digest() {
  local expected_gateway_revision="${1:-}" inspection snapshot caddyfile_sha256 gateway
  require_production_endpoint_boundary "$expected_gateway_revision"
  gateway="$(container_for_service "$PRODUCTION_PROJECT" gateway)"
  inspection="$(docker_local container inspect \
    "$PRODUCTION_PROJECT-gateway-1" "$PRODUCTION_PROJECT-$LEGACY_BRIDGE_SERVICE-1")" ||
    die 'the production ingress runtime fingerprint could not be inspected'
  snapshot="$(jq -S -c 'sort_by(.Name) | map({
    Id, Image, Name, RestartCount,
    Config: {
      User: .Config.User, Image: .Config.Image, Entrypoint: .Config.Entrypoint,
      Cmd: .Config.Cmd, Env: .Config.Env, ExposedPorts: .Config.ExposedPorts,
      Labels: .Config.Labels
    },
    HostConfig: {
      ReadonlyRootfs: .HostConfig.ReadonlyRootfs,
      RestartPolicy: .HostConfig.RestartPolicy,
      CapAdd: .HostConfig.CapAdd,
      CapDrop: .HostConfig.CapDrop,
      SecurityOpt: .HostConfig.SecurityOpt,
      PortBindings: .HostConfig.PortBindings
    },
    State: {
      Status: .State.Status, Running: .State.Running, Paused: .State.Paused,
      Restarting: .State.Restarting, Dead: .State.Dead, OOMKilled: .State.OOMKilled,
      StartedAt: .State.StartedAt, Health: .State.Health.Status
    },
    NetworkSettings: {Networks: .NetworkSettings.Networks, Ports: .NetworkSettings.Ports}
  })' <<<"$inspection")" || die 'the production ingress runtime snapshot is unavailable'
  [[ -n "$snapshot" ]] || die 'the production ingress runtime snapshot is empty'
  caddyfile_sha256="$(gateway_caddyfile_sha256 "$gateway")"
  printf '%s\n%s\n' "$snapshot" "$caddyfile_sha256" | sha256sum | awk '{print $1}'
}

shared_ingress_network_id() {
  local network_id
  network_id="$(docker_local network ls --quiet --no-trunc \
    --filter "name=^${INGRESS_NETWORK}$")" ||
    die 'the shared ingress network inventory could not be read'
  [[ "$network_id" == "$INGRESS_NETWORK_ID" ]] ||
    die 'the shared ingress network identity changed'
  printf '%s' "$network_id"
}

require_shared_ingress_boundary() {
  local pilot_bridge_service="${1:-}" pilot_commit_sha="${2:-}" pilot_image_tag="${3:-}"
  local pilot_expected_state="${4:-running}"
  local network_id inspection inspection_after inspection_digest gateway production_bridge
  local pilot_bridge='' expected_pilot_name='' endpoint_rows container_rows pilot_inspection
  local -a endpoint_containers
  [[ -z "$pilot_bridge_service" ||
    "$pilot_bridge_service" == "$STAGING_BRIDGE_SERVICE" ||
    "$pilot_bridge_service" == "$LEGACY_BRIDGE_SERVICE" ]] ||
    die 'the shared-ingress pilot service identity is invalid'
  if [[ -n "$pilot_bridge_service" ]]; then
    validate_commit_and_tag "$pilot_commit_sha" "$pilot_image_tag"
    [[ "$pilot_expected_state" == 'running' || "$pilot_expected_state" == 'recoverable' ]] ||
      die 'the pilot bridge state contract is invalid'
    pilot_bridge="$(container_for_service "$PILOT_PROJECT" "$pilot_bridge_service")"
    expected_pilot_name="$PILOT_PROJECT-$pilot_bridge_service-1"
  fi
  gateway="$(container_for_service "$PRODUCTION_PROJECT" gateway)"
  production_bridge="$(container_for_service "$PRODUCTION_PROJECT" "$LEGACY_BRIDGE_SERVICE")"
  network_id="$(shared_ingress_network_id)"
  inspection="$(docker_local network inspect "$network_id")" ||
    die 'the exact shared ingress network could not be inspected'
  jq -e --arg gateway "$INGRESS_NETWORK_IPV4_GATEWAY" \
    --arg config_hash "$INGRESS_NETWORK_CONFIG_HASH" \
    --arg compose_version "$INGRESS_NETWORK_COMPOSE_VERSION" \
    --arg id "$INGRESS_NETWORK_ID" --arg name "$INGRESS_NETWORK" \
    --arg project 'fetanagent-staging-beta' --arg subnet "$INGRESS_NETWORK_IPV4_SUBNET" \
    --arg gateway_id "$gateway" --arg bridge_id "$production_bridge" \
    --arg pilot_id "$pilot_bridge" --arg pilot_name "$expected_pilot_name" '
    length == 1 and .[0].Id == $id and .[0].Name == $name and
    .[0].Scope == "local" and .[0].Driver == "bridge" and
    .[0].EnableIPv4 == true and .[0].EnableIPv6 == false and .[0].Internal == true and
    .[0].Attachable == false and .[0].Ingress == false and
    .[0].ConfigOnly == false and .[0].Options == {} and
    (.[0].Labels | keys | sort) == [
      "com.docker.compose.config-hash", "com.docker.compose.network",
      "com.docker.compose.project", "com.docker.compose.version"
    ] and
    .[0].Labels == {
      "com.docker.compose.config-hash": $config_hash,
      "com.docker.compose.network": "telebirr_device_ingress",
      "com.docker.compose.project": $project,
      "com.docker.compose.version": $compose_version
    } and
    .[0].IPAM.Driver == "default" and .[0].IPAM.Options == null and
    .[0].IPAM.Config == [{"Subnet":$subnet,"Gateway":$gateway}] and
    (.[0].Containers | keys | sort) ==
      (if $pilot_id == "" then [$gateway_id, $bridge_id] else
        [$gateway_id, $bridge_id, $pilot_id] end | sort) and
    ((.[0].Containers | to_entries | map(.value.Name)) | sort) ==
      (if $pilot_id == "" then
        ["fetanagent-production-gateway-1",
          "fetanagent-production-telebirr-device-bridge-1"]
      else
        ["fetanagent-production-gateway-1",
          "fetanagent-production-telebirr-device-bridge-1", $pilot_name]
      end | sort) and
    all(.[0].Containers | to_entries[];
      (.key | test("^[0-9a-f]{64}$")) and
      (.value.EndpointID | test("^[0-9a-f]{64}$")) and
      (.value.MacAddress | test("^([0-9a-f]{2}:){5}[0-9a-f]{2}$")) and
      (.value.IPv4Address | test("^172\\.23\\.[0-9]{1,3}\\.[0-9]{1,3}/16$")) and
      .value.IPv6Address == "")
  ' <<<"$inspection" >/dev/null ||
    die 'the shared ingress network is outside the exact H18-derived topology'
  inspection_digest="$(jq -S -c '.[0]' <<<"$inspection" | sha256sum | awk '{print $1}')" ||
    die 'the shared ingress network snapshot is unavailable'

  endpoint_rows="$(jq -r '.[0].Containers | to_entries[] |
    [.key, .value.EndpointID, .value.MacAddress, .value.IPv4Address, .value.IPv6Address] |
    @tsv' <<<"$inspection" | LC_ALL=C sort)" ||
    die 'the shared ingress endpoint inventory is unavailable'
  endpoint_containers=("$gateway" "$production_bridge")
  [[ -z "$pilot_bridge" ]] || endpoint_containers+=("$pilot_bridge")
  container_rows="$(docker_local container inspect "${endpoint_containers[@]}" |
    jq -r --arg network "$INGRESS_NETWORK" '.[] |
      [.Id, .NetworkSettings.Networks[$network].EndpointID,
       .NetworkSettings.Networks[$network].MacAddress,
       (.NetworkSettings.Networks[$network].IPAddress + "/" +
         (.NetworkSettings.Networks[$network].IPPrefixLen | tostring)),
       .NetworkSettings.Networks[$network].GlobalIPv6Address] | @tsv' |
    LC_ALL=C sort)" || die 'the shared ingress container endpoint inventory is unavailable'
  [[ -n "$endpoint_rows" && "$container_rows" == "$endpoint_rows" ]] ||
    die 'the shared ingress network and container endpoints do not match exactly'

  if [[ -n "$pilot_bridge" ]]; then
    pilot_inspection="$(docker_local container inspect "$pilot_bridge")" ||
      die 'the pilot bridge endpoint could not be inspected'
    jq -e --arg id "$pilot_bridge" --arg project "$PILOT_PROJECT" \
      --arg service "$pilot_bridge_service" --arg name "/$expected_pilot_name" \
      --arg commit "$pilot_commit_sha" --arg tag "$pilot_image_tag" \
      --arg network "$INGRESS_NETWORK" --arg network_id "$INGRESS_NETWORK_ID" \
      --arg expected_state "$pilot_expected_state" '
      length == 1 and .[0].Id == $id and .[0].Name == $name and
      .[0].Config.Labels["com.docker.compose.project"] == $project and
      .[0].Config.Labels["com.docker.compose.service"] == $service and
      .[0].Config.Labels["com.docker.compose.container-number"] == "1" and
      .[0].Config.Labels["com.docker.compose.oneoff"] == "False" and
      .[0].Config.Labels["org.opencontainers.image.revision"] == $commit and
      .[0].Config.Labels["org.opencontainers.image.title"] ==
        "fetanagent-telebirr-device-bridge" and
      .[0].Config.Image == ("fetanagent-telebirr-device-bridge:" + $tag) and
      .[0].Config.User == "10001:10001" and
      .[0].Config.Entrypoint == ["docker-entrypoint.sh"] and
      .[0].Config.Cmd ==
        ["node","apps/telebirr-device-bridge/dist/telebirr-device-bridge-main.js"] and
      ([.[0].Config.Env[] | select(startswith("FINANCIAL_ACTIONS_MODE="))] ==
        ["FINANCIAL_ACTIONS_MODE=dry_run"]) and
      ([.[0].Config.Env[] | select(startswith("TELEBIRR_DEVICE_BRIDGE_DEPLOYMENT_TARGET="))] ==
        ["TELEBIRR_DEVICE_BRIDGE_DEPLOYMENT_TARGET=staging"]) and
      ([.[0].Config.Env[] | select(
        . == "KEMERBET_EXECUTOR_ENABLED=true" or . == "KEMERBET_FINAL_ACTION_ENABLED=true"
      )] | length) == 0 and
      (
        (
          .[0].State.Status == "running" and .[0].State.Running == true and
          .[0].State.Paused == false and .[0].State.Restarting == false and
          .[0].State.Dead == false and .[0].State.OOMKilled == false and
          .[0].State.Health.Status == "healthy" and .[0].RestartCount == 0
        ) or
        (
          $expected_state == "recoverable" and
          (.[0].State.Status == "created" or .[0].State.Status == "exited") and
          .[0].State.Running == false and .[0].State.Paused == false and
          .[0].State.Restarting == false and .[0].State.Dead == false
        )
      ) and
      .[0].HostConfig.ReadonlyRootfs == true and
      .[0].HostConfig.RestartPolicy.Name == "unless-stopped" and
      .[0].HostConfig.CapDrop == ["ALL"] and
      .[0].HostConfig.PortBindings == {} and .[0].Config.ExposedPorts == null and
      .[0].NetworkSettings.Ports == {} and
      (.[0].NetworkSettings.Networks | keys) == [$network] and
      .[0].NetworkSettings.Networks[$network].NetworkID == $network_id and
      (.[0].NetworkSettings.Networks[$network].Aliases | unique | sort) ==
        [($name | ltrimstr("/")), $service]
    ' <<<"$pilot_inspection" >/dev/null ||
      die 'the staging pilot bridge is not the exact no-money shared-ingress endpoint'
  fi

  inspection_after="$(docker_local network inspect "$network_id")" ||
    die 'the shared ingress network could not be re-inspected'
  [[ "$(jq -S -c '.[0]' <<<"$inspection_after" | sha256sum | awk '{print $1}')" == \
    "$inspection_digest" ]] || die 'the shared ingress network changed during inspection'
}

require_current_shared_ingress_boundary() {
  local bridge_service="$1" commit_sha="$2" image_tag="$3" bridge attached
  bridge="$(optional_container_for_service "$PILOT_PROJECT" "$bridge_service")"
  if [[ -z "$bridge" ]]; then
    require_shared_ingress_boundary
    return
  fi
  attached="$(docker_local container inspect "$bridge" --format \
    "{{if index .NetworkSettings.Networks \"$INGRESS_NETWORK\"}}true{{else}}false{{end}}")" ||
    die 'the pilot bridge shared-ingress attachment state could not be read'
  case "$attached" in
    true)
      require_shared_ingress_boundary \
        "$bridge_service" "$commit_sha" "$image_tag" recoverable
      ;;
    false) require_shared_ingress_boundary ;;
    *) die 'the pilot bridge shared-ingress attachment state is invalid' ;;
  esac
}

require_production_ingress() {
  local expected_pilot_state="$1" expected_gateway_revision="$2" pilot_image_tag="$3"
  validate_commit_and_tag "$expected_gateway_revision" "$pilot_image_tag"
  require_production_endpoint_boundary "$expected_gateway_revision"
  case "$expected_pilot_state" in
    stopped) require_shared_ingress_boundary ;;
    running)
      require_shared_ingress_boundary "$STAGING_BRIDGE_SERVICE" \
        "$expected_gateway_revision" "$pilot_image_tag"
      ;;
    *) die 'the expected pilot ingress state is invalid' ;;
  esac
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

require_preflight_ingress() {
  local next_commit_sha="$1" next_image_tag="$2"
  local active_commit_sha active_image_tag active_release bridge_service inventory
  validate_commit_and_tag "$next_commit_sha" "$next_image_tag"
  inventory="$(pilot_container_inventory)" ||
    die 'the TeleBirr pilot container inventory could not be read'
  if [[ -z "$inventory" ]]; then
    require_production_ingress stopped "$next_commit_sha" "$next_image_tag"
    return
  fi
  [[ -e "$ACTIVE_RECEIPT" || -L "$ACTIVE_RECEIPT" ]] ||
    die 'pilot containers exist without an active-release receipt'
  active_commit_sha="$(read_active_commit)"
  active_image_tag="${active_commit_sha:0:12}"
  active_release="$PILOT_RELEASE_ROOT/$active_commit_sha"
  validate_stoppable_release "$active_release" "$active_commit_sha" "$active_image_tag"
  bridge_service="$(bridge_service_for_release "$active_release")"
  require_stoppable_pilot_inventory "$bridge_service" "$active_commit_sha" "$active_image_tag"
  require_production_endpoint_boundary "$next_commit_sha"
  require_current_shared_ingress_boundary \
    "$bridge_service" "$active_commit_sha" "$active_image_tag"
}

negative_public_smoke() {
  local status route

  status="$(curl --http1.1 --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 8 --request POST \
    --header "$DEPLOYMENT_TARGET_HEADER" \
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
      --header "$DEPLOYMENT_TARGET_HEADER" \
      --header 'Content-Type: application/vnd.fetanagent.telebirr-device-bridge+json' \
      --data '{}' "$PUBLIC_ORIGIN$route")"
    [[ "$status" == '400' ]] || die 'an exact public device route did not reach the rejecting bridge'
  done
  status="$(curl --http1.1 --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 8 --request GET --header "$DEPLOYMENT_TARGET_HEADER" \
    "$PUBLIC_ORIGIN/v1/telebirr/device/heartbeat")"
  [[ "$status" == '404' ]] || die 'the public gateway accepted a wrong method'
  status="$(curl --http1.1 --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 8 --request POST --header "$DEPLOYMENT_TARGET_HEADER" \
    --header 'Content-Type: application/json' --data '{}' \
    "$PUBLIC_ORIGIN/v1/telebirr/device/heartbeat")"
  [[ "$status" == '404' ]] || die 'the public gateway accepted a wrong content type'
  status="$(curl --http1.1 --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 8 --request POST \
    --header "$DEPLOYMENT_TARGET_HEADER" \
    --header 'Content-Type: application/vnd.fetanagent.telebirr-device-bridge+json' \
    --data '{}' "$PUBLIC_ORIGIN/v1/telebirr/device/heartbeat?unexpected=1")"
  [[ "$status" == '400' ]] || die 'the public bridge did not reject a query-bearing route'
  status="$(curl --http1.1 --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 8 --request POST \
    --header "$DEPLOYMENT_TARGET_HEADER" \
    --header 'Content-Type: application/vnd.fetanagent.telebirr-device-bridge+json' \
    --data '{}' "$PUBLIC_ORIGIN/v1/telebirr/device/unknown")"
  [[ "$status" == '404' ]] || die 'the public gateway accepted an unknown route'
}

ready() {
  local commit_sha="$1" image_tag="$2" release="$PILOT_RELEASE_ROOT/$1"
  validate_commit_and_tag "$commit_sha" "$image_tag"
  validate_release "$release" "$commit_sha" "$image_tag"
  require_component_ready telebirr-assignment-broker "$commit_sha" \
    "${PILOT_PROJECT}_telebirr_assignment_database_egress"
  require_component_ready telebirr-device-state-broker "$commit_sha" \
    "${PILOT_PROJECT}_telebirr_device_state_database_egress"
  require_component_ready "$STAGING_BRIDGE_SERVICE" "$commit_sha" "$INGRESS_NETWORK"
  require_production_ingress running "$commit_sha" "$image_tag"
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
    fetanagent-telebirr-images.tar compose.telebirr-device-pilot.yaml \
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
  local production_fingerprint_before production_fingerprint_after
  validate_commit_and_tag "$commit_sha" "$image_tag"
  validate_release "$release" "$commit_sha" "$image_tag"
  [[ ! -e "$ACTIVE_RECEIPT" && ! -L "$ACTIVE_RECEIPT" ]] ||
    die 'another active TeleBirr device release is already recorded'
  require_no_pilot_containers 'unrecorded TeleBirr pilot containers block activation'
  require_production_ingress stopped "$commit_sha" "$image_tag"
  production_fingerprint_before="$(production_ingress_runtime_digest "$commit_sha")" ||
    die 'the pre-start production ingress runtime digest could not be captured'
  run_pilot_compose "$release" "$commit_sha" "$image_tag" \
    up -d --no-build --wait --wait-timeout 120
  ready "$commit_sha" "$image_tag"
  production_fingerprint_after="$(production_ingress_runtime_digest "$commit_sha")" ||
    die 'the post-start production ingress runtime digest could not be captured'
  [[ "$production_fingerprint_after" == "$production_fingerprint_before" ]] ||
    die 'the production ingress runtime changed during the pilot start'
  (umask 077; printf '%s\n' "$commit_sha" >"$ACTIVE_RECEIPT")
  chown root:root "$ACTIVE_RECEIPT"
  chmod 0600 "$ACTIVE_RECEIPT"
}

quiesce_active_for_upgrade() {
  local next_commit_sha="$1" next_image_tag="$2"
  local active_commit_sha active_image_tag
  validate_commit_and_tag "$next_commit_sha" "$next_image_tag"
  if [[ ! -e "$ACTIVE_RECEIPT" && ! -L "$ACTIVE_RECEIPT" ]]; then
    require_no_pilot_containers 'unrecorded TeleBirr pilot containers block the upgrade'
    printf 'TeleBirr Android device transport upgrade boundary ready: no active release recorded.\n'
    return
  fi
  active_commit_sha="$(read_active_commit)"
  [[ "$active_commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the active-release receipt is not canonical'
  [[ "$active_commit_sha" != "$next_commit_sha" ]] ||
    die 'the immutable active release cannot be redeployed as an upgrade'
  active_image_tag="${active_commit_sha:0:12}"
  stop_release "$active_commit_sha" "$active_image_tag"
  [[ ! -e "$ACTIVE_RECEIPT" && ! -L "$ACTIVE_RECEIPT" ]] ||
    die 'the active-release receipt remained after quiescence'
  printf 'TeleBirr Android device transport quiesced: exact sealed predecessor stopped for upgrade.\n'
}

stop_release() {
  local commit_sha="$1" image_tag="$2" release="$PILOT_RELEASE_ROOT/$1"
  local bridge_service production_fingerprint_before production_fingerprint_after
  validate_commit_and_tag "$commit_sha" "$image_tag"
  validate_stoppable_release "$release" "$commit_sha" "$image_tag"
  bridge_service="$(bridge_service_for_release "$release")"
  require_stoppable_pilot_inventory "$bridge_service" "$commit_sha" "$image_tag"
  require_production_endpoint_boundary
  require_current_shared_ingress_boundary "$bridge_service" "$commit_sha" "$image_tag"
  production_fingerprint_before="$(production_ingress_runtime_digest)" ||
    die 'the pre-stop production ingress runtime digest could not be captured'
  if [[ -e "$ACTIVE_RECEIPT" || -L "$ACTIVE_RECEIPT" ]]; then
    [[ "$(read_active_commit)" == "$commit_sha" ]] ||
      die 'the active-release receipt does not bind the requested release'
  fi
  run_pilot_compose "$release" "$commit_sha" "$image_tag" \
    rm --stop --force "$bridge_service" telebirr-device-state-broker telebirr-assignment-broker
  require_no_pilot_containers 'the exact TeleBirr pilot containers remained after stop'
  remove_exact_empty_pilot_networks "$commit_sha"
  require_production_endpoint_boundary
  require_shared_ingress_boundary
  production_fingerprint_after="$(production_ingress_runtime_digest)" ||
    die 'the post-stop production ingress runtime digest could not be captured'
  [[ "$production_fingerprint_after" == "$production_fingerprint_before" ]] ||
    die 'the production ingress runtime changed during the pilot stop'
  if [[ -f "$ACTIVE_RECEIPT" && ! -L "$ACTIVE_RECEIPT" ]]; then rm -f -- "$ACTIVE_RECEIPT"; fi
}

read_active_commit() {
  [[ ! -L "$ACTIVE_RECEIPT" && -f "$ACTIVE_RECEIPT" &&
    "$(realpath -- "$ACTIVE_RECEIPT")" == "$ACTIVE_RECEIPT" &&
    "$(stat --format='%U:%G:%a:%h:%s' "$ACTIVE_RECEIPT")" == 'root:root:600:1:41' ]] ||
    die 'the active-release receipt is unsafe'
  local active_commit_sha
  active_commit_sha="$(<"$ACTIVE_RECEIPT")"
  [[ "$active_commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the active-release receipt is not canonical'
  printf '%s' "$active_commit_sha"
}

stop_active_release() {
  local active_commit_sha active_image_tag
  if [[ ! -e "$ACTIVE_RECEIPT" && ! -L "$ACTIVE_RECEIPT" ]]; then
    require_no_pilot_containers 'pilot containers exist without an active-release receipt'
    printf 'TeleBirr Android device transport already stopped: no active receipt or pilot containers.\n'
    return
  fi
  active_commit_sha="$(read_active_commit)"
  active_image_tag="${active_commit_sha:0:12}"
  stop_release "$active_commit_sha" "$active_image_tag"
  [[ ! -e "$ACTIVE_RECEIPT" && ! -L "$ACTIVE_RECEIPT" ]] ||
    die 'the active-release receipt remained after stop'
  printf 'TeleBirr Android device transport stopped: exact sealed active release released.\n'
}

rollback_release() {
  stop_release "$1" "$2"
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
    require_preflight_ingress "$2" "$3"
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
  quiesce-active-for-upgrade)
    [[ $# -eq 3 ]] || die 'quiesce-active-for-upgrade requires the next commit and image tag'
    acquire_mutation_lock
    quiesce_active_for_upgrade "$2" "$3"
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
  stop-active)
    [[ $# -eq 1 ]] || die 'stop-active takes no release argument'
    acquire_mutation_lock
    stop_active_release
    ;;
  rollback)
    [[ $# -eq 3 ]] || die 'rollback requires commit and image tag'
    acquire_mutation_lock
    rollback_release "$2" "$3"
    ;;
  *)
    die 'expected verify, preflight, install, start, quiesce-active-for-upgrade, ready, stop, stop-active, or rollback'
    ;;
esac
