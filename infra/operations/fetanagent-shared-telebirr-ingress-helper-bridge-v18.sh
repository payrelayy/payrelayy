#!/usr/bin/env bash
# One-use, root-console-only promotion from the exact H17 helper to the H18
# shared-TeleBirr-ingress helper. It appends provenance and replaces only the
# reviewed staging helper while staging is stopped. Production containers, the
# shared network, database roles, KemerBet evidence, and money controls are read-only.
set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly PRODUCTION_PROJECT='fetanagent-production'
readonly PRODUCTION_RELEASE='69be82ac3e49ff8c63c64c9aa7926e0046b48a10'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly SHARED_NETWORK='fetanagent-telebirr-device-ingress'
readonly SHARED_NETWORK_ID='5b3dc890fad4f062ac570e4bbc66f950d002b536843b2630473eb817537af738'
readonly SHARED_NETWORK_CONFIG_HASH='ac7f178b6d4280a708b951cb93740b0f8323fb2cb2c75d05cf040f44e2c34209'
readonly PREDECESSOR_HELPER_SHA256='77e4822a0827413290fba94747698536b6af5bca3f2f7cdc58975dce390f7c84'
readonly REVIEWED_SUCCESSOR_HELPER_SHA256='3adb799d17c3f51e2f6c49957d3a170e63151c30509962acdaf08c105dc65267'
readonly CONFIRMATION='I-UNDERSTAND-THIS-INSTALLS-ONE-H18-SHARED-INGRESS-HELPER-WITH-NO-MONEY'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly STAGING_DIRECT_DATABASE_HOST='db.spzpiyxheappsfyswewl.supabase.co'
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="$LOCK_ROOT/mutation.lock"
readonly SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.shared-telebirr-ingress-helper-bridge-v18-disabled'
readonly CONTINUOUS_FINALIZER='/usr/local/sbin/fetanagent-staging-continuous-availability'
readonly CONTINUOUS_SUDOERS='/etc/sudoers.d/fetanagent-staging-continuous-availability'
readonly H17_CONTINUOUS_FINALIZER_SHA256='8e7e00aa8f83b08bb07a7b09c7d0ade3c89b4014c82d7047a7677a96b13b78d5'
readonly H17_CONTINUOUS_SUDOERS_SHA256='6a00778d52e4f2e58596ab8c287eebad0069f4997ef4439fa775115d8f7aabc0'
readonly SUCCESSOR_CONTINUOUS_FINALIZER_SHA256='103b40c6ef76cca08e92bb5b475104f775b054b3981c5bb55057a085126745ea'
readonly SUCCESSOR_CONTINUOUS_SUDOERS_SHA256='d33645e4767102a64463d27d90b63685dd71d1352fb175eb64a738a06b21f958'
readonly H17_PARENT='/var/lib/fetanagent/kemerbet-continuous-availability-helper-bridge-v17'
readonly H18_PARENT='/var/lib/fetanagent/shared-telebirr-ingress-helper-bridge-v18'
readonly TIMER='fetanagent-staging-runtime-expiry-stop.timer'
readonly SERVICE='fetanagent-staging-runtime-expiry-stop.service'
readonly PROFILE_VOLUME='fetanagent-staging-beta_kemerbet_sessions'
readonly SESSION_CONTROL_VOLUME='fetanagent-staging-beta_kemerbet_session_control'
readonly PROFILE_VOLUME_CONFIG_HASH='a32bd0939846bcf3962c5f6fce0b4faeb20ed73332d44d4fbde4c2441f83217a'
readonly SESSION_CONTROL_VOLUME_CONFIG_HASH='ece38b330a5f072e571f8d000a89f7622e8b790c3e02bce42df7a844fba7a085'
readonly INSTALLING_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.shared-telebirr-ingress-helper-bridge-v18-installing'
readonly SCRIPT_BASENAME='fetanagent-shared-telebirr-ingress-helper-bridge-v18.sh'
readonly CANONICAL_H14_RELEASE='06459511d9330a0e1d956c42529b81aa9970e7a2'

export PATH="$SAFE_PATH"
umask 077

die() {
  printf 'FetanAgent H18 shared-ingress helper bridge failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 3 ]] || die 'expected the bridge release, reviewed helper digest, and exact confirmation'
readonly BRIDGE_RELEASE="$1"
readonly SUCCESSOR_HELPER_SHA256="$2"
readonly PROVIDED_CONFIRMATION="$3"
readonly STAGING_ROOT="/root/fetanagent-shared-telebirr-ingress-helper-bridge-v18-$BRIDGE_RELEASE"
readonly STAGED_INSTALLER="$STAGING_ROOT/$SCRIPT_BASENAME"
readonly STAGED_HELPER="$STAGING_ROOT/fetanagent-staging-deploy-helper.next"
readonly H18_ROOT="$H18_PARENT/$BRIDGE_RELEASE"
readonly H18_INSTALLING="$H18_PARENT/.installing-$BRIDGE_RELEASE"

[[ "$REVIEWED_SUCCESSOR_HELPER_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
  die 'the reviewed H18 successor helper digest placeholder has not been finalized'
[[ "$BRIDGE_RELEASE" =~ ^[0-9a-f]{40}$ ]] ||
  die 'the H18 bridge release must be a full lowercase Git commit SHA'
[[ "$SUCCESSOR_HELPER_SHA256" == "$REVIEWED_SUCCESSOR_HELPER_SHA256" &&
  "$SUCCESSOR_HELPER_SHA256" != "$PREDECESSOR_HELPER_SHA256" ]] ||
  die 'the successor helper digest is not the distinct reviewed H18 artifact'
[[ "$PROVIDED_CONFIRMATION" == "$CONFIRMATION" ]] ||
  die 'the exact one-use no-money H18 confirmation is required'
[[ "$(id -u)" == '0' && "$(id -un)" == 'root' ]] ||
  die 'run this installer only in the DigitalOcean root console'
[[ -z "${SUDO_USER:-}" && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'sudo and Docker environment overrides are forbidden'

for command in awk bash chmod chown cmp curl dirname docker env find flock getent grep id \
  install ip jq mv python3 realpath sha256sum sort ss stat sync systemctl visudo; do
  command -v "$command" >/dev/null 2>&1 || die "required command is unavailable: $command"
done

expected_sudoers() {
  printf '%s\n' \
    'fetanagent-admin ALL=(root) NOPASSWD: /usr/local/sbin/fetanagent-staging-deploy-helper *'
}

require_exact_sudoers_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:440:1' ]] || return 1
  cmp -s -- "$path" <(expected_sudoers)
}

require_active_grant_only() {
  require_exact_sudoers_file "$SUDOERS" || return 1
  [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]] || return 1
  visudo -cf /etc/sudoers >/dev/null
}

require_disabled_grant_only() {
  [[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]] || return 1
  require_exact_sudoers_file "$SUDOERS_DISABLED" || return 1
  visudo -cf /etc/sudoers >/dev/null
}

disable_sudoers() {
  require_active_grant_only || return 1
  mv -- "$SUDOERS" "$SUDOERS_DISABLED" || return 1
  grant_disabled='true'
  sync -f /etc/sudoers.d || return 1
  require_disabled_grant_only
}

restore_sudoers() {
  require_disabled_grant_only || return 1
  visudo -cf "$SUDOERS_DISABLED" >/dev/null || return 1
  mv -- "$SUDOERS_DISABLED" "$SUDOERS" || return 1
  grant_disabled='false'
  if sync -f /etc/sudoers.d && require_active_grant_only; then
    return 0
  fi
  if [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]] &&
    require_exact_sudoers_file "$SUDOERS"; then
    mv -- "$SUDOERS" "$SUDOERS_DISABLED" || return 1
    grant_disabled='true'
    sync -f /etc/sudoers.d || return 1
    require_disabled_grant_only || return 1
  fi
  return 1
}

require_helper_file() {
  local path="$1" expected_digest="$2" expected_mode="$3"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == "root:root:$expected_mode:1" &&
    "$(sha256sum -- "$path" | awk '{print $1}')" == "$expected_digest" ]] || return 1
  bash -n "$path"
}

require_checksum_file() {
  local path="$1" expected_digest="$2" expected_mode="$3"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == "root:root:$expected_mode:1" &&
    "$(sha256sum -- "$path" | awk '{print $1}')" == "$expected_digest" ]]
}

run_helper_direct() {
  env -i PATH="$SAFE_PATH" HOME='/root' SUDO_USER='fetanagent-admin' "$TARGET" "$@"
}

docker_local_read_only() {
  env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    docker --host "$LOCAL_DOCKER_SOCKET" "$@"
}

require_exact_droplet() {
  [[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 "$METADATA/id")" == \
      "$EXPECTED_DROPLET_ID" &&
    "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
      "$METADATA/interfaces/public/0/ipv4/address")" == "$EXPECTED_PUBLIC_IPV4" ]]
}

require_timer_disabled() {
  [[ "$(systemctl show --property=LoadState --value "$TIMER")" == 'loaded' &&
    "$(systemctl show --property=ActiveState --value "$TIMER")" == 'inactive' &&
    "$(systemctl show --property=UnitFileState --value "$TIMER")" == 'disabled' &&
    -z "$(systemctl show --property=NextElapseUSecRealtime --value "$TIMER")" &&
    -z "$(systemctl show --property=DropInPaths --value "$TIMER")" &&
    "$(systemctl show --property=LoadState --value "$SERVICE")" == 'loaded' &&
    "$(systemctl show --property=ActiveState --value "$SERVICE")" == 'inactive' &&
    -z "$(systemctl show --property=DropInPaths --value "$SERVICE")" ]]
}

require_ipv6_host_ready() {
  local address_inventory route_inventory
  address_inventory="$(ip -6 address show scope global)" || return 1
  route_inventory="$(ip -6 route show default)" || return 1
  grep -q 'inet6 ' <<<"$address_inventory" || return 1
  grep -q '^default ' <<<"$route_inventory" || return 1
  getent ahostsv6 "$STAGING_DIRECT_DATABASE_HOST" >/dev/null
}

require_port_3002_free() {
  local socket_inventory
  socket_inventory="$(ss -ltnH)" || return 1
  ! awk '$4 ~ /:3002$/ { found = 1 } END { exit !found }' <<<"$socket_inventory"
}

require_successor_readiness() {
  require_ipv6_host_ready && require_port_3002_free
}

successor_readiness_digest() {
  local addresses database_addresses namespace_networks port_3002 routes
  require_successor_readiness || return 1
  addresses="$(ip -6 -o address show scope global |
    awk '{ print $2 "|" $4 }' | LC_ALL=C sort -u)" || return 1
  routes="$(ip -6 route show default | LC_ALL=C sort -u)" || return 1
  database_addresses="$(getent ahostsv6 "$STAGING_DIRECT_DATABASE_HOST" |
    LC_ALL=C sort -u)" || return 1
  namespace_networks="$(docker_local_read_only network ls --quiet --no-trunc \
    --filter "name=^${PROJECT_NAME}_" | LC_ALL=C sort)" || return 1
  [[ -z "$namespace_networks" ]] || return 1
  port_3002="$(ss -ltnH | awk '$4 ~ /:3002$/ { print }' | LC_ALL=C sort)" || return 1
  [[ -z "$port_3002" ]] || return 1
  [[ -n "$addresses" && -n "$routes" && -n "$database_addresses" ]] || return 1
  printf '%s\n%s\n%s\nnamespace_networks=none\nport_3002=free\n' \
    "$addresses" "$routes" "$database_addresses" | sha256sum | awk '{print $1}'
}

require_production_runtime() {
  local inventory
  local -a containers=()
  inventory="$(docker_local_read_only container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PRODUCTION_PROJECT" | LC_ALL=C sort)" ||
    return 1
  mapfile -t containers <<<"$inventory"
  [[ "${#containers[@]}" -eq 10 ]] || return 1
  docker_local_read_only container inspect "${containers[@]}" | jq -e \
    --arg release "$PRODUCTION_RELEASE" '
      (map(.Config.Labels["com.docker.compose.service"]) | sort) == [
        "api",
        "beta-admission",
        "bot",
        "customer-web",
        "gateway",
        "owner-control",
        "production-companion-device-bridge",
        "telebirr-assignment-broker",
        "telebirr-device-bridge",
        "telebirr-device-state-broker"
      ] and
      all(.[];
        .Config.Labels["com.docker.compose.project"] == "fetanagent-production" and
        .Config.Labels["org.opencontainers.image.revision"] == $release and
        .State.Status == "running" and
        .State.Running == true and
        .State.Paused == false and
        .State.Restarting == false and
        .State.Dead == false and
        .State.OOMKilled == false and
        .State.Health.Status == "healthy" and
        .RestartCount == 0
      )' >/dev/null
}

production_boundary_digest() {
  local container inspection service snapshot=''
  for service in api beta-admission bot customer-web gateway owner-control \
    production-companion-device-bridge telebirr-assignment-broker \
    telebirr-device-bridge telebirr-device-state-broker; do
    container="$(docker_local_read_only container ls --all --quiet --no-trunc \
      --filter "label=com.docker.compose.project=$PRODUCTION_PROJECT" \
      --filter "label=com.docker.compose.service=$service")" || return 1
    [[ "$container" =~ ^[0-9a-f]{64}$ ]] || return 1
    inspection="$(docker_local_read_only container inspect "$container" --format \
      '{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.RestartCount}}|{{ index .Config.Labels "com.docker.compose.service" }}|{{ index .Config.Labels "org.opencontainers.image.revision" }}')" ||
      return 1
    [[ "$inspection" =~ ^[0-9a-f]{64}\|sha256:[0-9a-f]{64}\|[^|]+\|[0-9]+\|[a-z0-9-]+\|[0-9a-f]{40}$ ]] ||
      return 1
    snapshot+="$inspection"$'\n'
  done
  printf '%s' "$snapshot" | sha256sum | awk '{print $1}'
}

require_shared_ingress_boundary() {
  local container_endpoints inspection network_endpoints network_id
  network_id="$(docker_local_read_only network ls --quiet --no-trunc \
    --filter "name=^${SHARED_NETWORK}$")" || return 1
  [[ "$network_id" == "$SHARED_NETWORK_ID" ]] || return 1
  inspection="$(docker_local_read_only network inspect "$SHARED_NETWORK_ID")" || return 1
  jq -e --arg config_hash "$SHARED_NETWORK_CONFIG_HASH" \
    --arg id "$SHARED_NETWORK_ID" --arg release "$PRODUCTION_RELEASE" '
      length == 1 and
      .[0].Id == $id and
      .[0].Name == "fetanagent-telebirr-device-ingress" and
      .[0].Scope == "local" and
      .[0].Driver == "bridge" and
      .[0].EnableIPv6 == false and
      .[0].Internal == true and
      .[0].Attachable == false and
      .[0].Ingress == false and
      .[0].ConfigOnly == false and
      .[0].Options == {} and
      .[0].IPAM.Driver == "default" and
      .[0].IPAM.Options == null and
      .[0].IPAM.Config == [{"Subnet":"172.23.0.0/16","Gateway":"172.23.0.1"}] and
      .[0].Labels == {
        "com.docker.compose.config-hash": $config_hash,
        "com.docker.compose.network": "telebirr_device_ingress",
        "com.docker.compose.project": "fetanagent-staging-beta",
        "com.docker.compose.version": "5.1.4"
      } and
      ((.[0].Containers | to_entries | map(.value.Name)) | sort) == [
        "fetanagent-production-gateway-1",
        "fetanagent-production-telebirr-device-bridge-1"
      ] and
      all(.[0].Containers | to_entries[];
        (.key | test("^[0-9a-f]{64}$")) and
        (.value.EndpointID | test("^[0-9a-f]{64}$")) and
        (.value.MacAddress | test("^([0-9a-f]{2}:){5}[0-9a-f]{2}$")) and
        (.value.IPv4Address | test("^172\\.23\\.[0-9]{1,3}\\.[0-9]{1,3}/16$")) and
        .value.IPv6Address == ""
      )' <<<"$inspection" >/dev/null || return 1

  network_endpoints="$(jq -r '.[0].Containers | to_entries[] |
    [.key, .value.EndpointID, .value.MacAddress, .value.IPv4Address, .value.IPv6Address] |
    @tsv' <<<"$inspection" | LC_ALL=C sort)" || return 1
  container_endpoints="$(docker_local_read_only container inspect \
    fetanagent-production-gateway-1 fetanagent-production-telebirr-device-bridge-1 |
    jq -r --arg network "$SHARED_NETWORK" '.[] |
      [.Id, .NetworkSettings.Networks[$network].EndpointID,
       .NetworkSettings.Networks[$network].MacAddress,
       (.NetworkSettings.Networks[$network].IPAddress + "/" +
         (.NetworkSettings.Networks[$network].IPPrefixLen | tostring)),
       .NetworkSettings.Networks[$network].GlobalIPv6Address] | @tsv' |
    LC_ALL=C sort)" || return 1
  [[ -n "$network_endpoints" && "$container_endpoints" == "$network_endpoints" ]] || return 1

  docker_local_read_only container inspect \
    fetanagent-production-gateway-1 fetanagent-production-telebirr-device-bridge-1 |
    jq -e --arg network "$SHARED_NETWORK" --arg network_id "$SHARED_NETWORK_ID" \
      --arg release "$PRODUCTION_RELEASE" '
        length == 2 and
        (map(.Config.Labels["com.docker.compose.service"]) | sort) ==
          ["gateway", "telebirr-device-bridge"] and
        all(.[];
          .Config.Labels["com.docker.compose.project"] == "fetanagent-production" and
          .Config.Labels["org.opencontainers.image.revision"] == $release and
          .Config.User == "10001:10001" and
          .State.Running == true and
          .State.Health.Status == "healthy" and
          .RestartCount == 0 and
          .NetworkSettings.Networks[$network].NetworkID == $network_id and
          (if .Config.Labels["com.docker.compose.service"] == "gateway" then
            .Name == "/fetanagent-production-gateway-1" and
            .Config.Image == ("fetanagent-gateway:" + ($release[0:12])) and
            .Config.Labels["org.opencontainers.image.title"] == "fetanagent-gateway" and
            .Config.Entrypoint == null and
            .Config.Cmd == ["caddy","run","--config","/etc/caddy/Caddyfile","--adapter","caddyfile"] and
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
          else
            .Name == "/fetanagent-production-telebirr-device-bridge-1" and
            .Config.Image == ("fetanagent-telebirr-device-bridge:" + ($release[0:12])) and
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
            .HostConfig.PortBindings == {} and
            .Config.ExposedPorts == null and
            .NetworkSettings.Ports == {}
          end)
        )' >/dev/null
}

shared_ingress_boundary_digest() {
  local container_snapshot network_snapshot
  network_snapshot="$(docker_local_read_only network inspect "$SHARED_NETWORK_ID" |
    jq -S -c '.[0] | {
        Id, Name, Scope, Driver, EnableIPv6, Internal, Attachable, Ingress, ConfigOnly,
        Options, Labels, IPAM,
        Containers: (.Containers | to_entries | sort_by(.key))
      }')" || return 1
  [[ -n "$network_snapshot" ]] || return 1
  container_snapshot="$(docker_local_read_only container inspect \
    fetanagent-production-gateway-1 fetanagent-production-telebirr-device-bridge-1 |
    jq -S -c 'sort_by(.Name) | map({
        Id, Image, Name, RestartCount,
        State: {Status: .State.Status, StartedAt: .State.StartedAt, Health: .State.Health.Status},
        Project: .Config.Labels["com.docker.compose.project"],
        Service: .Config.Labels["com.docker.compose.service"],
        Revision: .Config.Labels["org.opencontainers.image.revision"],
        User: .Config.User,
        Entrypoint: .Config.Entrypoint,
        Cmd: .Config.Cmd,
        Environment: .Config.Env,
        ExposedPorts: .Config.ExposedPorts,
        PortBindings: .HostConfig.PortBindings,
        Networks: .NetworkSettings.Networks,
        Ports: .NetworkSettings.Ports
      })')" || return 1
  [[ -n "$container_snapshot" ]] || return 1
  printf '%s\n%s\n' "$network_snapshot" "$container_snapshot" |
    sha256sum | awk '{print $1}'
}

require_stopped_staging_boundary() {
  local containers holders mountpoint namespace_networks networks volume volume_inspection volumes
  containers="$(docker_local_read_only container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  [[ -z "$containers" ]] || return 1
  networks="$(docker_local_read_only network ls --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" | LC_ALL=C sort)" || return 1
  [[ "$networks" == "$SHARED_NETWORK_ID" ]] || return 1
  namespace_networks="$(docker_local_read_only network ls --quiet --no-trunc \
    --filter "name=^${PROJECT_NAME}_")" || return 1
  [[ -z "$namespace_networks" ]] || return 1
  volumes="$(docker_local_read_only volume ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" | LC_ALL=C sort)" || return 1
  [[ "$volumes" == $'fetanagent-staging-beta_kemerbet_session_control\nfetanagent-staging-beta_kemerbet_sessions' ]] ||
    return 1
  volume_inspection="$(docker_local_read_only volume inspect \
    "$PROFILE_VOLUME" "$SESSION_CONTROL_VOLUME")" || return 1
  jq -e \
    --arg profile_hash "$PROFILE_VOLUME_CONFIG_HASH" \
    --arg profile_name "$PROFILE_VOLUME" \
    --arg session_hash "$SESSION_CONTROL_VOLUME_CONFIG_HASH" \
    --arg session_name "$SESSION_CONTROL_VOLUME" '
      length == 2 and
      (map(.Name) | sort) == ([$profile_name, $session_name] | sort) and
      all(.[];
        .Driver == "local" and
        .Scope == "local" and
        .Options == null and
        .Labels["com.docker.compose.project"] == "fetanagent-staging-beta" and
        .Labels["com.docker.compose.version"] == "5.1.4" and
        (.Labels | keys | sort) == [
          "com.docker.compose.config-hash",
          "com.docker.compose.project",
          "com.docker.compose.version",
          "com.docker.compose.volume"
        ] and
        (if .Name == $profile_name then
          .Labels["com.docker.compose.config-hash"] == $profile_hash and
          .Labels["com.docker.compose.volume"] == "kemerbet_sessions" and
          .Mountpoint == ("/var/lib/docker/volumes/" + $profile_name + "/_data")
        elif .Name == $session_name then
          .Labels["com.docker.compose.config-hash"] == $session_hash and
          .Labels["com.docker.compose.volume"] == "kemerbet_session_control" and
          .Mountpoint == ("/var/lib/docker/volumes/" + $session_name + "/_data")
        else false end)
      )' <<<"$volume_inspection" >/dev/null || return 1
  for volume in "$PROFILE_VOLUME" "$SESSION_CONTROL_VOLUME"; do
    holders="$(docker_local_read_only container ls --all --quiet --no-trunc \
      --filter "volume=$volume")" || return 1
    [[ -z "$holders" ]] || return 1
    mountpoint="$(docker_local_read_only volume inspect "$volume" --format '{{.Mountpoint}}')" ||
      return 1
    [[ ! -L "$mountpoint" && -d "$mountpoint" &&
      "$(realpath -- "$mountpoint")" == "$mountpoint" &&
      "$(stat --format='%u:%g:%a' "$mountpoint")" == '10001:10001:700' ]] || return 1
    if [[ "$volume" == "$SESSION_CONTROL_VOLUME" ]]; then
      [[ "$(stat --format='%h' "$mountpoint")" == '2' ]] || return 1
    fi
  done
  require_timer_disabled || return 1
  require_shared_ingress_boundary
}

stopped_boundary_digest() {
  local mountpoint mountpoint_stat readiness_digest snapshot volume volume_snapshot
  volume_snapshot="$(docker_local_read_only volume inspect \
    "$PROFILE_VOLUME" "$SESSION_CONTROL_VOLUME" |
    jq -S -c 'sort_by(.Name) | map({Name, Driver, Scope, Options, Labels, Mountpoint})')" ||
    return 1
  [[ -n "$volume_snapshot" ]] || return 1
  snapshot="$(printf '%s\n' \
    'staging_project_containers=none' \
    "staging_project_network=$SHARED_NETWORK_ID" \
    'durable_volume_holders=none' \
    "$volume_snapshot")"$'\n'
  for volume in "$PROFILE_VOLUME" "$SESSION_CONTROL_VOLUME"; do
    mountpoint="$(docker_local_read_only volume inspect "$volume" --format '{{.Mountpoint}}')" ||
      return 1
    [[ ! -L "$mountpoint" && -d "$mountpoint" &&
      "$(realpath -- "$mountpoint")" == "$mountpoint" ]] || return 1
    mountpoint_stat="$(stat --format='%d:%i:%u:%g:%a:%h' "$mountpoint")" || return 1
    [[ "$mountpoint_stat" =~ ^[0-9]+:[0-9]+:[0-9]+:[0-9]+:[0-7]+:[0-9]+$ ]] || return 1
    snapshot+="$volume|$mountpoint_stat"$'\n'
  done
  snapshot+='expiry_timer=inactive-disabled'$'\n'
  readiness_digest="$(successor_readiness_digest)" || return 1
  [[ "$readiness_digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  snapshot+="successor_readiness_sha256=$readiness_digest"$'\n'
  printf '%s' "$snapshot" | sha256sum | awk '{print $1}'
}

require_helper_boundary() {
  local digest="$1" output
  run_helper_direct verify "$digest" >/dev/null || return 1
  run_helper_direct kemerbet-v3-runtime-bridge-ready "$digest" >/dev/null || return 1
  output="$(run_helper_direct kemerbet-quarantine-recovery-ready \
    "$CANONICAL_H14_RELEASE")" || return 1
  [[ "$output" == \
    'KemerBet H14 recovery state: cohort-prepared; Transfer and Amount disabled.' ]] || return 1
  if [[ "$digest" == "$SUCCESSOR_HELPER_SHA256" ]]; then
    run_helper_direct fresh-host-ready "$BRIDGE_RELEASE" >/dev/null || return 1
  fi
}

resolve_h17_record() {
  local inspection
  local -a h17_lines=()
  inspection="$(env -i PATH="$SAFE_PATH" python3 -I - "$H17_PARENT" <<'PY'
import hashlib
import os
import re
import stat
import sys

parent = sys.argv[1]
release = re.compile(r'[0-9a-f]{40}')

def read_exact(path, mode):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        named = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
            != (0, 0, mode, 1)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or before.st_size > 4096
            or os.path.realpath(path) != path
        ):
            raise RuntimeError()
        data = os.pread(fd, 4097, 0)
        after = os.fstat(fd)
        if len(data) != before.st_size or (
            before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
            before.st_nlink, before.st_size, before.st_mtime_ns
        ) != (
            after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
            after.st_nlink, after.st_size, after.st_mtime_ns
        ):
            raise RuntimeError()
        return data
    finally:
        os.close(fd)

try:
    value = os.lstat(parent)
    children = os.listdir(parent)
    if (
        not stat.S_ISDIR(value.st_mode)
        or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(parent) != parent
        or len(children) != 1
        or release.fullmatch(children[0]) is None
    ):
        raise RuntimeError()
    root = f'{parent}/{children[0]}'
    root_value = os.lstat(root)
    if (
        not stat.S_ISDIR(root_value.st_mode)
        or (root_value.st_uid, root_value.st_gid, stat.S_IMODE(root_value.st_mode))
        != (0, 0, 0o700)
        or os.path.realpath(root) != root
        or sorted(os.listdir(root)) != ['completed-v1', 'intent-v1', 'predecessor-helper']
    ):
        raise RuntimeError()
    intent = read_exact(f'{root}/intent-v1', 0o600)
    completion = read_exact(f'{root}/completed-v1', 0o600)
    print(children[0])
    print(hashlib.sha256(intent).hexdigest())
    print(hashlib.sha256(completion).hexdigest())
except Exception:
    raise SystemExit(1)
PY
)" || return 1
  mapfile -t h17_lines <<<"$inspection"
  [[ "${#h17_lines[@]}" -eq 3 &&
    "${h17_lines[0]}" =~ ^[0-9a-f]{40}$ &&
    "${h17_lines[1]}" =~ ^[0-9a-f]{64}$ &&
    "${h17_lines[2]}" =~ ^[0-9a-f]{64}$ ]] || return 1
  H17_RELEASE="${h17_lines[0]}"
  H17_INTENT_SHA256="${h17_lines[1]}"
  H17_COMPLETION_SHA256="${h17_lines[2]}"
  [[ "$H17_RELEASE" != "$BRIDGE_RELEASE" ]]
}

expected_intent() {
  printf '%s\n' \
    'contract=fetanagent-shared-telebirr-ingress-helper-bridge-v18' \
    'state=authorized' \
    "bridge_release=$BRIDGE_RELEASE" \
    "h17_bridge_release=$H17_RELEASE" \
    "predecessor_helper_sha256=$PREDECESSOR_HELPER_SHA256" \
    "successor_helper_sha256=$SUCCESSOR_HELPER_SHA256" \
    "h17_bridge_intent_sha256=$H17_INTENT_SHA256" \
    "h17_bridge_completion_sha256=$H17_COMPLETION_SHA256" \
    "stopped_boundary_sha256=$STOPPED_BOUNDARY_SHA256" \
    "production_boundary_sha256=$PRODUCTION_BOUNDARY_SHA256" \
    "shared_ingress_boundary_sha256=$SHARED_INGRESS_BOUNDARY_SHA256" \
    'staging_runtime_stopped=true' \
    "shared_ingress_network=$SHARED_NETWORK" \
    "shared_ingress_network_id=$SHARED_NETWORK_ID" \
    'shared_ingress_contract=exact' \
    "production_release=$PRODUCTION_RELEASE" \
    'production_endpoint_set=exact' \
    'production_runtime_mutation=false' \
    'database_mutation=false' \
    'financial_actions_mode=disabled' \
    'transfer_enabled=false' \
    'amount_enabled=false' \
    'money_moved=false'
}

expected_completion() {
  local intent_sha256
  intent_sha256="$(expected_intent | sha256sum | awk '{print $1}')"
  expected_intent | awk 'NR == 2 { print "state=shared-ingress-helper-installed"; next } { print }'
  printf 'bridge_intent_sha256=%s\n' "$intent_sha256"
}

publish_record_atomically() {
  local root="$1" name="$2" mode="$3" producer="$4"
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$root/.$name.installing" "$root/$name" "$mode" 3< <("$producer") <<'PY'
import os
import stat
import sys

temporary, target, mode_text = sys.argv[1:]
mode = int(mode_text, 8)
expected = bytearray()
while len(expected) <= 4096:
    chunk = os.read(3, 4097 - len(expected))
    if not chunk:
        break
    expected.extend(chunk)
expected = bytes(expected)
if not expected or len(expected) > 4096 or not expected.endswith(b'\n'):
    raise SystemExit(1)

def exact(path, prefix):
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        value = os.fstat(fd)
        named = os.lstat(path)
        if (
            not stat.S_ISREG(value.st_mode)
            or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink)
            != (0, 0, mode, 1)
            or (value.st_dev, value.st_ino) != (named.st_dev, named.st_ino)
            or os.path.realpath(path) != path
            or value.st_size > len(expected)
        ):
            raise RuntimeError()
        existing = os.read(fd, len(expected) + 1)
        if (prefix and not expected.startswith(existing)) or (not prefix and existing != expected):
            raise RuntimeError()
        return fd, existing
    except Exception:
        os.close(fd)
        raise

if os.path.lexists(target):
    if os.path.lexists(temporary):
        raise SystemExit(1)
    fd, _ = exact(target, False)
    os.close(fd)
    raise SystemExit(0)
if os.path.lexists(temporary):
    fd, existing = exact(temporary, True)
else:
    fd = os.open(
        temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode
    )
    os.fchmod(fd, mode)
    existing = b''
try:
    os.lseek(fd, len(existing), os.SEEK_SET)
    remaining = expected[len(existing):]
    while remaining:
        written = os.write(fd, remaining)
        if written <= 0:
            raise RuntimeError()
        remaining = remaining[written:]
    os.fsync(fd)
finally:
    os.close(fd)
os.rename(temporary, target)
directory = os.open(os.path.dirname(target), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    os.fsync(directory)
finally:
    os.close(directory)
PY
}

prepare_helper_copy_resumably() {
  local source="$1" source_mode="$2" target="$3" target_mode="$4" expected_digest="$5"
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$source" "$source_mode" "$target" "$target_mode" "$expected_digest" <<'PY'
import hashlib
import os
import stat
import sys

source, source_mode_text, target, target_mode_text, expected_digest = sys.argv[1:]
source_mode = int(source_mode_text, 8)
target_mode = int(target_mode_text, 8)
maximum = 2 * 1024 * 1024


def read_exact(path, mode):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
            != (0, 0, mode, 1)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or before.st_size <= 0
            or before.st_size > maximum
            or os.path.realpath(path) != path
        ):
            raise RuntimeError()
        data = os.pread(descriptor, maximum + 1, 0)
        after = os.fstat(descriptor)
        named_after = os.lstat(path)
        if (
            len(data) != before.st_size
            or (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
                before.st_nlink, before.st_size, before.st_mtime_ns)
            != (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
                after.st_nlink, after.st_size, after.st_mtime_ns)
            or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)
        ):
            raise RuntimeError()
        return data
    finally:
        os.close(descriptor)


expected = read_exact(source, source_mode)
if hashlib.sha256(expected).hexdigest() != expected_digest:
    raise SystemExit(1)
if os.path.lexists(target):
    descriptor = os.open(target, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        value = os.fstat(descriptor)
        named = os.lstat(target)
        if (
            not stat.S_ISREG(value.st_mode)
            or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink)
            != (0, 0, target_mode, 1)
            or (value.st_dev, value.st_ino) != (named.st_dev, named.st_ino)
            or value.st_size > len(expected)
            or os.path.realpath(target) != target
        ):
            raise RuntimeError()
        existing = os.pread(descriptor, len(expected) + 1, 0)
        if existing != expected[:len(existing)]:
            raise RuntimeError()
    except Exception:
        os.close(descriptor)
        raise
else:
    descriptor = os.open(
        target,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        target_mode,
    )
    os.fchmod(descriptor, target_mode)
    existing = b''
try:
    offset = len(existing)
    while offset < len(expected):
        written = os.pwrite(descriptor, expected[offset:], offset)
        if written <= 0:
            raise RuntimeError()
        offset += written
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY
}

copy_predecessor_atomically() {
  local final="$H18_INSTALLING/predecessor-helper"
  local temporary="$H18_INSTALLING/.predecessor-helper.installing"
  if [[ -e "$final" || -L "$final" ]]; then
    [[ ! -e "$temporary" && ! -L "$temporary" ]] || return 1
    require_helper_file "$final" "$PREDECESSOR_HELPER_SHA256" 400
    return
  fi
  prepare_helper_copy_resumably \
    "$TARGET" 755 "$temporary" 400 "$PREDECESSOR_HELPER_SHA256" || return 1
  require_helper_file "$temporary" "$PREDECESSOR_HELPER_SHA256" 400 || return 1
  mv -- "$temporary" "$final" || return 1
  sync -f "$H18_INSTALLING" || return 1
  require_helper_file "$final" "$PREDECESSOR_HELPER_SHA256" 400
}

require_exact_record() {
  local root="$1"
  [[ ! -L "$root" && -d "$root" && "$(realpath -- "$root")" == "$root" &&
    "$(stat --format='%U:%G:%a' "$root")" == 'root:root:700' &&
    "$(find -P "$root" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" == \
      $'completed-v1\nintent-v1\npredecessor-helper' ]] || return 1
  [[ ! -L "$root/intent-v1" && ! -L "$root/completed-v1" &&
    "$(realpath -- "$root/intent-v1")" == "$root/intent-v1" &&
    "$(realpath -- "$root/completed-v1")" == "$root/completed-v1" &&
    "$(stat --format='%U:%G:%a:%h' "$root/intent-v1")" == 'root:root:600:1' &&
    "$(stat --format='%U:%G:%a:%h' "$root/completed-v1")" == 'root:root:600:1' ]] || return 1
  cmp -s -- "$root/intent-v1" <(expected_intent) || return 1
  cmp -s -- "$root/completed-v1" <(expected_completion) || return 1
  require_helper_file "$root/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400
}

classify_namespace() {
  env -i PATH="$SAFE_PATH" python3 -I - "$H18_PARENT" "$BRIDGE_RELEASE" <<'PY'
import os
import stat
import sys

parent, release = sys.argv[1:]
if not os.path.lexists(parent):
    print('absent')
    raise SystemExit(0)
value = os.lstat(parent)
if (
    not stat.S_ISDIR(value.st_mode)
    or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700)
    or os.path.realpath(parent) != parent
):
    raise SystemExit(1)
entries = sorted(os.listdir(parent))
if entries == []:
    print('empty-parent')
elif entries == [f'.installing-{release}']:
    print('interrupted')
elif entries == [release]:
    print('completed')
else:
    raise SystemExit(1)
PY
}

require_installing_root() {
  [[ ! -L "$H18_INSTALLING" && -d "$H18_INSTALLING" &&
    "$(realpath -- "$H18_INSTALLING")" == "$H18_INSTALLING" &&
    "$(stat --format='%U:%G:%a' "$H18_INSTALLING")" == 'root:root:700' ]] || return 1
}

require_record_prefix() {
  local path="$1" mode="$2" producer="$3"
  env -i PATH="$SAFE_PATH" python3 -I - "$path" "$mode" 3< <("$producer") <<'PY'
import os
import stat
import sys

path, mode_text = sys.argv[1:]
mode = int(mode_text, 8)
expected = bytearray()
while len(expected) <= 4096:
    chunk = os.read(3, 4097 - len(expected))
    if not chunk:
        break
    expected.extend(chunk)
expected = bytes(expected)
if not expected or len(expected) > 4096 or not expected.endswith(b'\n'):
    raise SystemExit(1)
descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    before = os.fstat(descriptor)
    named = os.lstat(path)
    if (
        not stat.S_ISREG(before.st_mode)
        or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
        != (0, 0, mode, 1)
        or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
        or before.st_size > len(expected)
        or os.path.realpath(path) != path
    ):
        raise RuntimeError()
    existing = os.pread(descriptor, len(expected) + 1, 0)
    after = os.fstat(descriptor)
    named_after = os.lstat(path)
    if (
        existing != expected[:len(existing)]
        or len(existing) != before.st_size
        or (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
            before.st_nlink, before.st_size, before.st_mtime_ns)
        != (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
            after.st_nlink, after.st_size, after.st_mtime_ns)
        or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)
    ):
        raise RuntimeError()
finally:
    os.close(descriptor)
PY
}

require_helper_prefix() {
  local source="$1" source_mode="$2" target="$3" target_mode="$4" expected_digest="$5"
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$source" "$source_mode" "$target" "$target_mode" "$expected_digest" <<'PY'
import hashlib
import os
import stat
import sys

source, source_mode_text, target, target_mode_text, expected_digest = sys.argv[1:]
source_mode = int(source_mode_text, 8)
target_mode = int(target_mode_text, 8)
maximum = 2 * 1024 * 1024

def stable_read(path, mode, allow_empty):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
            != (0, 0, mode, 1)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or (not allow_empty and before.st_size == 0)
            or before.st_size > maximum
            or os.path.realpath(path) != path
        ):
            raise RuntimeError()
        data = os.pread(descriptor, maximum + 1, 0)
        after = os.fstat(descriptor)
        named_after = os.lstat(path)
        if (
            len(data) != before.st_size
            or (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
                before.st_nlink, before.st_size, before.st_mtime_ns)
            != (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
                after.st_nlink, after.st_size, after.st_mtime_ns)
            or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)
        ):
            raise RuntimeError()
        return data
    finally:
        os.close(descriptor)

expected = stable_read(source, source_mode, False)
if hashlib.sha256(expected).hexdigest() != expected_digest:
    raise SystemExit(1)
existing = stable_read(target, target_mode, True)
if len(existing) > len(expected) or existing != expected[:len(existing)]:
    raise SystemExit(1)
PY
}

require_global_installing_helper_absent() {
  [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" ]]
}

require_exact_record_payload() {
  local path="$1" producer="$2"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:600:1' ]] || return 1
  cmp -s -- "$path" <("$producer")
}

require_interrupted_predecessor_record() {
  local entries
  require_installing_root || return 1
  entries="$(find -P "$H18_INSTALLING" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' |
    LC_ALL=C sort)" || return 1
  case "$entries" in
    '')
      require_global_installing_helper_absent
      ;;
    '.intent-v1.installing:f')
      require_record_prefix "$H18_INSTALLING/.intent-v1.installing" 600 expected_intent &&
        require_global_installing_helper_absent
      ;;
    'intent-v1:f')
      require_exact_record_payload "$H18_INSTALLING/intent-v1" expected_intent &&
        require_global_installing_helper_absent
      ;;
    $'.predecessor-helper.installing:f\nintent-v1:f')
      require_exact_record_payload "$H18_INSTALLING/intent-v1" expected_intent &&
        require_helper_prefix "$TARGET" 755 \
          "$H18_INSTALLING/.predecessor-helper.installing" 400 \
          "$PREDECESSOR_HELPER_SHA256" &&
        require_global_installing_helper_absent
      ;;
    $'intent-v1:f\npredecessor-helper:f')
      require_exact_record_payload "$H18_INSTALLING/intent-v1" expected_intent &&
        require_helper_file "$H18_INSTALLING/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400 ||
        return 1
      if [[ -e "$INSTALLING_HELPER" || -L "$INSTALLING_HELPER" ]]; then
        require_helper_prefix "$STAGED_HELPER" 600 "$INSTALLING_HELPER" 755 \
          "$SUCCESSOR_HELPER_SHA256"
      fi
      ;;
    *) return 1 ;;
  esac
}

require_interrupted_successor_record() {
  local entries
  require_installing_root || return 1
  entries="$(find -P "$H18_INSTALLING" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' |
    LC_ALL=C sort)" || return 1
  case "$entries" in
    $'intent-v1:f\npredecessor-helper:f') ;;
    $'.completed-v1.installing:f\nintent-v1:f\npredecessor-helper:f')
      require_record_prefix "$H18_INSTALLING/.completed-v1.installing" 600 expected_completion ||
        return 1
      ;;
    $'completed-v1:f\nintent-v1:f\npredecessor-helper:f')
      require_exact_record_payload "$H18_INSTALLING/completed-v1" expected_completion || return 1
      ;;
    *) return 1 ;;
  esac
  require_global_installing_helper_absent || return 1
  require_exact_record_payload "$H18_INSTALLING/intent-v1" expected_intent || return 1
  require_helper_file \
    "$H18_INSTALLING/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400 || return 1
}

current_target_state() {
  if require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755; then
    printf '%s' 'predecessor'
  elif require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755; then
    printf '%s' 'successor'
  else
    return 1
  fi
}

current_grant_state() {
  if require_active_grant_only; then
    printf '%s' 'active'
  elif require_disabled_grant_only; then
    printf '%s' 'disabled'
  else
    return 1
  fi
}

classify_continuous_finalizer_topology() {
  continuous_finalizer_state='invalid'
  continuous_sudoers_state='invalid'
  continuous_topology='invalid'
  if require_checksum_file \
    "$CONTINUOUS_FINALIZER" "$H17_CONTINUOUS_FINALIZER_SHA256" 755 &&
    bash -n "$CONTINUOUS_FINALIZER"; then
    continuous_finalizer_state='h17'
  elif require_checksum_file \
    "$CONTINUOUS_FINALIZER" "$SUCCESSOR_CONTINUOUS_FINALIZER_SHA256" 755 &&
    bash -n "$CONTINUOUS_FINALIZER"; then
    continuous_finalizer_state='successor'
  else
    return 1
  fi
  if require_checksum_file \
    "$CONTINUOUS_SUDOERS" "$H17_CONTINUOUS_SUDOERS_SHA256" 440 &&
    visudo -cf "$CONTINUOUS_SUDOERS" >/dev/null; then
    continuous_sudoers_state='h17'
  elif require_checksum_file \
    "$CONTINUOUS_SUDOERS" "$SUCCESSOR_CONTINUOUS_SUDOERS_SHA256" 440 &&
    visudo -cf "$CONTINUOUS_SUDOERS" >/dev/null; then
    continuous_sudoers_state='successor'
  else
    return 1
  fi
  case "$target_state:$continuous_finalizer_state:$continuous_sudoers_state" in
    predecessor:h17:h17) continuous_topology='h17-pair' ;;
    successor:h17:h17) continuous_topology='h17-pair' ;;
    successor:successor:h17) continuous_topology='successor-finalizer-h17-sudoers' ;;
    successor:successor:successor) continuous_topology='successor-pair' ;;
    *) return 1 ;;
  esac
  visudo -cf /etc/sudoers >/dev/null
}

capture_transaction_snapshot() {
  h18_state="$(classify_namespace)" || return 1
  target_state="$(current_target_state)" || return 1
  grant_state="$(current_grant_state)" || return 1
  resolve_h17_record || return 1
  classify_continuous_finalizer_topology || return 1
  H17_TUPLE="$(printf '%s\n%s\n%s\n' \
    "$H17_RELEASE" "$H17_INTENT_SHA256" "$H17_COMPLETION_SHA256")"
  TRANSACTION_SNAPSHOT="$(printf '%s\n' \
    "namespace=$h18_state" \
    "target=$target_state" \
    "grant=$grant_state" \
    "h17_release=$H17_RELEASE" \
    "h17_intent_sha256=$H17_INTENT_SHA256" \
    "h17_completion_sha256=$H17_COMPLETION_SHA256" \
    "continuous_finalizer=$continuous_finalizer_state" \
    "continuous_sudoers=$continuous_sudoers_state" \
    "continuous_topology=$continuous_topology")"
}

require_recoverable_transaction_state() {
  [[ "$(classify_namespace)" == "$h18_state" &&
    "$(current_target_state)" == "$target_state" &&
    "$(current_grant_state)" == "$grant_state" ]] || return 1
  classify_continuous_finalizer_topology || return 1
  case "$h18_state:$target_state:$grant_state" in
    absent:predecessor:active|absent:predecessor:disabled)
      require_global_installing_helper_absent
      ;;
    empty-parent:predecessor:disabled)
      require_global_installing_helper_absent
      ;;
    interrupted:predecessor:disabled)
      require_interrupted_predecessor_record
      ;;
    interrupted:successor:disabled)
      require_interrupted_successor_record
      ;;
    completed:successor:active|completed:successor:disabled)
      require_exact_record "$H18_ROOT" && require_global_installing_helper_absent
      ;;
    *) return 1 ;;
  esac
}

install_successor_atomically() {
  if require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755; then
    [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" ]]
    return
  fi
  require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 || return 1
  prepare_helper_copy_resumably \
    "$STAGED_HELPER" 600 "$INSTALLING_HELPER" 755 "$SUCCESSOR_HELPER_SHA256" || return 1
  require_helper_file "$INSTALLING_HELPER" "$SUCCESSOR_HELPER_SHA256" 755 || return 1
  mv -- "$INSTALLING_HELPER" "$TARGET" || return 1
  sync -f /usr/local/sbin || return 1
  require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755
}

open_lock() {
  local fd_identity path_identity
  [[ ! -L "$LOCK_ROOT" && -d "$LOCK_ROOT" && "$(realpath -- "$LOCK_ROOT")" == "$LOCK_ROOT" &&
    "$(stat --format='%U:%G:%a' "$LOCK_ROOT")" == 'root:root:700' &&
    ! -L "$LOCK" && -f "$LOCK" && "$(realpath -- "$LOCK")" == "$LOCK" &&
    "$(stat --format='%U:%G:%a:%h' "$LOCK")" == 'root:root:600:1' ]] || return 1
  exec 9<>"$LOCK" || return 1
  path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")" || return 1
  fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)" || return 1
  [[ "$fd_identity" == "$path_identity" ]] || return 1
  flock --exclusive --nonblock 9 || return 1
  [[ "$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")" == "$fd_identity" ]]
}

close_lock() {
  flock --unlock 9 || return 1
  exec 9>&- || return 1
}

require_no_other_mutator_processes() {
  local argument basename cmdline pid
  for cmdline in /proc/[0-9]*/cmdline; do
    [[ -r "$cmdline" ]] || continue
    pid="${cmdline#/proc/}"
    pid="${pid%/cmdline}"
    [[ "$pid" == "$$" ]] && continue
    while IFS= read -r -d '' argument; do
      basename="${argument##*/}"
      case "$argument" in
        "$TARGET"|"$STAGED_HELPER"|"$INSTALLING_HELPER") return 1 ;;
      esac
      [[ "$basename" == "$SCRIPT_BASENAME" ]] && return 1
    done <"$cmdline" || true
  done
}

require_all_boundaries() {
  require_exact_droplet &&
    require_successor_readiness &&
    require_stopped_staging_boundary &&
    require_production_runtime &&
    [[ "$(stopped_boundary_digest)" == "$STOPPED_BOUNDARY_SHA256" ]] &&
    [[ "$(production_boundary_digest)" == "$PRODUCTION_BOUNDARY_SHA256" ]] &&
    [[ "$(shared_ingress_boundary_digest)" == "$SHARED_INGRESS_BOUNDARY_SHA256" ]]
}

grant_disabled='false'
cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 ]] && require_disabled_grant_only; then
    printf '%s\n' \
      'FetanAgent H18 bridge stopped with the deployment grant disabled. Rerun this exact installer; do not restore the grant or edit evidence manually.' >&2
  fi
  exit "$status"
}

require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'
[[ ! -L "$STAGING_ROOT" && -d "$STAGING_ROOT" &&
  "$(realpath -- "$STAGING_ROOT")" == "$STAGING_ROOT" &&
  "$(stat --format='%U:%G:%a' "$STAGING_ROOT")" == 'root:root:700' ]] ||
  die 'the reviewed H18 staging root is absent or unsafe'
[[ ! -L "$STAGED_INSTALLER" && -f "$STAGED_INSTALLER" &&
  "$(realpath -- "$0")" == "$STAGED_INSTALLER" &&
  "$(stat --format='%U:%G:%a:%h' "$STAGED_INSTALLER")" == 'root:root:700:1' ]] ||
  die 'run only the root-owned installer staged at the exact reviewed H18 path'
require_helper_file "$STAGED_HELPER" "$SUCCESSOR_HELPER_SHA256" 600 ||
  die 'the staged H18 successor helper is invalid'
resolve_h17_record || die 'the exact completed H17 record is unavailable'

require_stopped_staging_boundary || die 'the staging runtime is not in the exact shared-ingress stopped boundary'
require_successor_readiness || die 'the successor fresh-host IPv6 and port boundary is not ready'
require_production_runtime || die 'the production runtime is not in its exact unchanged boundary'
STOPPED_BOUNDARY_SHA256="$(stopped_boundary_digest)" ||
  die 'the stopped staging boundary digest is unavailable'
PRODUCTION_BOUNDARY_SHA256="$(production_boundary_digest)" ||
  die 'the production runtime digest is unavailable'
SHARED_INGRESS_BOUNDARY_SHA256="$(shared_ingress_boundary_digest)" ||
  die 'the shared-ingress boundary digest is unavailable'
for digest in "$STOPPED_BOUNDARY_SHA256" "$PRODUCTION_BOUNDARY_SHA256" \
  "$SHARED_INGRESS_BOUNDARY_SHA256"; do
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || die 'a boundary digest is invalid'
done

capture_transaction_snapshot || die 'the H18 transaction topology is invalid'
require_recoverable_transaction_state || die 'the H18 transaction state is not causally recoverable'
readonly PREFLIGHT_TRANSACTION_SNAPSHOT="$TRANSACTION_SNAPSHOT"
readonly PREFLIGHT_H17_TUPLE="$H17_TUPLE"
[[ "$grant_state" == 'disabled' ]] && grant_disabled='true'

trap cleanup EXIT
if [[ "$target_state" == 'predecessor' ]]; then
  require_helper_boundary "$PREDECESSOR_HELPER_SHA256" ||
    die 'the installed predecessor helper boundary is invalid'
elif [[ "$h18_state" == 'completed' ]]; then
  require_helper_boundary "$SUCCESSOR_HELPER_SHA256" ||
    die 'the installed successor helper boundary is invalid'
fi
require_all_boundaries || die 'a protected boundary changed before H18 locking'

open_lock || die 'the exact staging mutation lock is unsafe or another mutation is active'
require_no_other_mutator_processes || die 'another helper or H18 installer process is active'
capture_transaction_snapshot || die 'the H18 transaction topology became invalid under lock'
[[ "$TRANSACTION_SNAPSHOT" == "$PREFLIGHT_TRANSACTION_SNAPSHOT" ]] ||
  die 'the H18 transaction topology changed before the lock was acquired'
require_recoverable_transaction_state || die 'the H18 transaction state is not recoverable under lock'
[[ "$H17_TUPLE" == "$PREFLIGHT_H17_TUPLE" ]] || die 'the H17 predecessor record changed under lock'
if [[ "$grant_state" == 'disabled' ]]; then grant_disabled='true'; else grant_disabled='false'; fi
require_all_boundaries || die 'a protected boundary changed under the H18 lock'

if [[ "$grant_disabled" != 'true' ]]; then
  if [[ "$h18_state" == 'completed' && "$target_state" == 'successor' ]]; then
    require_active_grant_only || die 'the completed active grant changed under lock'
  else
    disable_sudoers || die 'the deployment grant could not be disabled safely'
    grant_state='disabled'
  fi
fi
if [[ "$h18_state" != 'completed' ]]; then
  require_disabled_grant_only || die 'the deployment grant is not isolated before H18 mutation'
  grant_disabled='true'
  grant_state='disabled'
  require_recoverable_transaction_state || die 'the isolated H18 transaction state is invalid'
fi
require_all_boundaries || die 'a protected boundary changed after grant isolation'

if [[ "$h18_state" != 'completed' ]]; then
  if [[ "$h18_state" == 'absent' ]]; then
    install -d -o root -g root -m 0700 "$H18_PARENT"
    sync -f "$(dirname -- "$H18_PARENT")"
  fi
  if [[ "$h18_state" == 'absent' || "$h18_state" == 'empty-parent' ]]; then
    install -d -o root -g root -m 0700 "$H18_INSTALLING"
    sync -f "$H18_PARENT"
    h18_state='interrupted'
  fi
  require_recoverable_transaction_state || die 'the predecessor H18 installing prefix is invalid'
  publish_record_atomically "$H18_INSTALLING" intent-v1 0600 expected_intent ||
    die 'the H18 intent could not be published atomically'
  require_recoverable_transaction_state || die 'the H18 intent phase is invalid'
  require_all_boundaries || die 'a protected boundary changed before predecessor archival'
  copy_predecessor_atomically || die 'the predecessor helper archive could not be published atomically'
  require_recoverable_transaction_state || die 'the H18 predecessor archive phase is invalid'
  require_all_boundaries || die 'a protected boundary changed before helper replacement'
  install_successor_atomically || die 'the H18 helper replacement could not be completed atomically'
  target_state='successor'
  require_disabled_grant_only || die 'the deployment grant changed during helper replacement'
  require_recoverable_transaction_state || die 'the H18 successor phase is invalid'
  require_all_boundaries || die 'a protected boundary changed before H18 completion'
  publish_record_atomically "$H18_INSTALLING" completed-v1 0600 expected_completion ||
    die 'the H18 completion could not be published atomically'
  require_recoverable_transaction_state || die 'the H18 completion phase is invalid'
  require_exact_record "$H18_INSTALLING" || die 'the completed H18 installing record is invalid'
  [[ ! -e "$H18_ROOT" && ! -L "$H18_ROOT" ]] || die 'the final H18 root appeared unexpectedly'
  mv -- "$H18_INSTALLING" "$H18_ROOT"
  sync -f "$H18_PARENT"
  h18_state='completed'
  require_disabled_grant_only || die 'the deployment grant changed during evidence publication'
  require_recoverable_transaction_state || die 'the completed H18 evidence phase is invalid'
fi
require_exact_record "$H18_ROOT" || die 'the final H18 evidence is invalid'
require_all_boundaries || die 'a protected boundary changed during H18 promotion'
close_lock

require_helper_boundary "$SUCCESSOR_HELPER_SHA256" ||
  die 'the installed H18 helper rejected the preserved evidence and shared-ingress boundary'
require_all_boundaries || die 'a protected boundary changed after H18 helper attestation'

open_lock || die 'the mutation lock changed before grant restoration'
require_no_other_mutator_processes || die 'another helper or H18 installer process appeared'
capture_transaction_snapshot || die 'the completed H18 transaction topology is invalid'
[[ "$H17_TUPLE" == "$PREFLIGHT_H17_TUPLE" ]] ||
  die 'the H17 predecessor record changed before grant restoration'
require_recoverable_transaction_state || die 'the completed H18 transaction is not recoverable'
[[ "$h18_state" == 'completed' && "$target_state" == 'successor' ]] ||
  die 'the H18 transaction is not complete before grant restoration'
require_exact_record "$H18_ROOT" || die 'the H18 evidence changed before grant restoration'
require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
  die 'the H18 helper changed before grant restoration'
require_all_boundaries || die 'a protected boundary changed before grant restoration'
if [[ "$grant_disabled" == 'true' ]]; then
  [[ "$grant_state" == 'disabled' ]] || die 'the deployment grant state changed before restoration'
  restore_sudoers || die 'the deployment grant could not be restored safely'
  grant_disabled='false'
else
  [[ "$grant_state" == 'active' ]] || die 'the deployment grant state changed unexpectedly'
  require_active_grant_only || die 'the active deployment grant changed'
fi
capture_transaction_snapshot || die 'the restored H18 transaction topology is invalid'
[[ "$h18_state" == 'completed' && "$target_state" == 'successor' && "$grant_state" == 'active' &&
  "$H17_TUPLE" == "$PREFLIGHT_H17_TUPLE" ]] || die 'the restored H18 transaction state is not exact'
require_recoverable_transaction_state || die 'the restored H18 transaction is not valid'
close_lock
trap - EXIT

printf '%s\n' \
  'FetanAgent H18 shared-ingress helper installed or validated: staging stopped; production and shared ingress unchanged; Transfer disabled; no money moved.'
