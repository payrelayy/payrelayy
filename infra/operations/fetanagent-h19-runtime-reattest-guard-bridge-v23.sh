#!/usr/bin/env bash
# One-use, root-console-only H22 -> H23 runtime re-attestation. It preserves
# every H19-H22 record, seals the already-running approved bot-only release and
# exact no-money production boundary, and atomically replaces only the ingress
# guard. It does not run Compose, alter a database, restart a container, or move
# money.
set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly INGRESS_GUARD='/usr/local/sbin/fetanagent-production-ingress-h19'
readonly GUARD_INSTALLING='/usr/local/sbin/.fetanagent-production-ingress-h19.h23-installing'
readonly DEPLOY_SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly DEPLOY_SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.h23-disabled'
readonly H22_PARENT='/var/lib/fetanagent/h19-terminal-receipt-order-guard-bridge-v22'
readonly H23_PARENT='/var/lib/fetanagent/h19-runtime-reattest-guard-bridge-v23'
readonly H22_RELEASE='50bd429d58645cf8fde6f9a9757faac689cf864c'
readonly H22_INTENT_SHA256='67e025161494c63fc7cab2560c4947218afb8f57e7e317c7a37bfeb8f96d5e27'
readonly H22_COMPLETION_SHA256='5d0e26765c30bc7a9e6ee828b130de2c09cbbb13bcbca52c67182de3d482aad1'
readonly H22_GUARD_SHA256='0b4a9b31a893073e725bfc97fc6ef3f6589fd9b5d720da5003e987ad0dcc7f17'
readonly REVIEWED_SUCCESSOR_GUARD_SHA256='16ff39bf812520d3ea271a27faa52630d69ff359597b35937e18f9e5e4dd8e23'
readonly H20_HELPER_SHA256='8c7230cea5101f182f05b11b094049822ddbe43884d7bda80a9a46b883eee4b4'
readonly H20_FINALIZER_SHA256='1ab7df7d5e530db75ba5f378169de0fda178c1a264df3a48fbb5acf76220f34f'
readonly H20_SUDOERS_SHA256='0978f4785d4661db46d8fe9bb8e29d81fa5ff2954aceb36aa6cc7d2ec4a71807'
readonly DEPLOY_SUDOERS_SHA256='19812382d8c43076726cf301c715b601a0da375bb130b17960bcffad154f7422'
readonly H19_RELEASE='90b1f059577682b6bc458d239f6bdcb591077085'
readonly APPROVED_BOT_RELEASE='bcc479be0f2e807203df5612d380002fd6df2ee5'
readonly APPROVED_BOT_IMAGE_ID='sha256:2f9e1af37575172eae8f31b302aca11bb1b807ac48d007fa14f8467c90fd73e3'
readonly CANDIDATE_GATEWAY_IMAGE_ID='sha256:443aac301bb8c26a51f7877a9cf016e8fd2101831c0cac6f59f7bd88a17189e8'
readonly CANDIDATE_CADDY_SHA256='afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616'
readonly REATTESTED_PRODUCTION_SHA256='fc65828179bb1ff86b64a53b3aaca208f60e62e12bf9ccdb5f8f81606199bef5'
readonly REATTESTED_NINE_SHA256='0b5c68c61794dadb0098470829ce581e6d8f9eec5ffc57429a5d438f72d846d6'
readonly REATTESTED_INGRESS_SHA256='770077ec0bea920eeb2bff9970df0dd30b566a21c2f9b6fb13b209be51b677eb'
readonly TLS_LEAF_SHA256='2c6bbb0eea676963398ea39a76ed974c2863da72236de67be761d19197dd7fd8'
readonly PROTECTED_RELEASE='69be82ac3e49ff8c63c64c9aa7926e0046b48a10'
readonly PROTECTED_COMPOSE_SHA256='98d7e763754868ba978d5c042c722664a1c1aec6f85e9011410d74e5d5f1928c'
readonly SHARED_NETWORK='fetanagent-telebirr-device-ingress'
readonly SHARED_NETWORK_ID='5b3dc890fad4f062ac570e4bbc66f950d002b536843b2630473eb817537af738'
readonly SHARED_NETWORK_CONFIG_HASH='ac7f178b6d4280a708b951cb93740b0f8323fb2cb2c75d05cf040f44e2c34209'
readonly PRODUCTION_ROOT='/srv/fetanagent/production'
readonly PRODUCTION_RELEASE_ROOT="$PRODUCTION_ROOT/releases"
readonly PRODUCTION_CURRENT="$PRODUCTION_ROOT/current"
readonly PRODUCTION_PROJECT='fetanagent-production'
readonly STAGING_HELPER='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly CONTINUOUS_FINALIZER='/usr/local/sbin/fetanagent-staging-continuous-availability'
readonly CONTINUOUS_SUDOERS='/etc/sudoers.d/fetanagent-staging-continuous-availability'
readonly MUTATION_LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly MUTATION_LOCK="$MUTATION_LOCK_ROOT/mutation.lock"
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly SCRIPT_BASENAME='fetanagent-h19-runtime-reattest-guard-bridge-v23.sh'
readonly CONFIRMATION='I-UNDERSTAND-THIS-REATTESTS-THE-EXACT-NO-MONEY-PRODUCTION-RUNTIME-WITHOUT-MUTATING-IT'

export PATH="$SAFE_PATH"
umask 077

die() {
  printf 'FetanAgent H23 runtime re-attestation bridge failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 3 || $# -eq 4 ]] ||
  die 'expected the H23 release, successor guard digest, exact confirmation, and optional preflight mode'
readonly BRIDGE_RELEASE="$1"
readonly SUCCESSOR_GUARD_SHA256="$2"
readonly PROVIDED_CONFIRMATION="$3"
readonly MODE="${4:-apply}"
readonly STAGING_ROOT="/root/fetanagent-h19-runtime-reattest-guard-bridge-v23-$BRIDGE_RELEASE"
readonly STAGED_INSTALLER="$STAGING_ROOT/$SCRIPT_BASENAME"
readonly STAGED_GUARD="$STAGING_ROOT/fetanagent-production-ingress-h19.next"
readonly H23_ROOT="$H23_PARENT/$BRIDGE_RELEASE"
readonly H23_INSTALLING="$H23_PARENT/.installing-$BRIDGE_RELEASE"

[[ "$BRIDGE_RELEASE" =~ ^[0-9a-f]{40}$ && "$BRIDGE_RELEASE" != "$PROTECTED_RELEASE" &&
  "$BRIDGE_RELEASE" != "$H19_RELEASE" && "$BRIDGE_RELEASE" != "$H22_RELEASE" &&
  "$BRIDGE_RELEASE" != "$APPROVED_BOT_RELEASE" ]] ||
  die 'H23 requires one distinct full release SHA for correction provenance'
[[ "$SUCCESSOR_GUARD_SHA256" == "$REVIEWED_SUCCESSOR_GUARD_SHA256" &&
  "$SUCCESSOR_GUARD_SHA256" != "$H22_GUARD_SHA256" ]] ||
  die 'the H23 successor guard digest is invalid or unchanged'
[[ "$PROVIDED_CONFIRMATION" == "$CONFIRMATION" ]] ||
  die 'the exact one-use no-money H23 confirmation is required'
[[ "$MODE" == apply || "$MODE" == preflight ]] || die 'mode must be apply or preflight'
[[ "$(id -u)" == 0 && "$(id -un)" == root && -z "${SUDO_USER:-}" ]] ||
  die 'run this installer only through the authenticated DigitalOcean root channel'
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'Docker environment overrides are forbidden'

for command in awk bash cmp curl dirname docker env find flock id install jq mv openssl \
  python3 readlink realpath sha256sum sort stat sync visudo; do
  command -v "$command" >/dev/null 2>&1 || die "required command is unavailable: $command"
done

docker_local() {
  env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    docker --host "$LOCAL_DOCKER_SOCKET" "$@"
}

require_exact_droplet() {
  [[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 "$METADATA/id")" == \
      "$EXPECTED_DROPLET_ID" &&
    "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
      "$METADATA/interfaces/public/0/ipv4/address")" == "$EXPECTED_PUBLIC_IPV4" ]]
}

require_exact_file() {
  local path="$1" digest="$2" mode="$3" maximum="${4:-2097152}"
  env -i PATH="$SAFE_PATH" python3 -I - "$path" "$digest" "$mode" "$maximum" <<'PY'
import hashlib, os, stat, sys
path, digest, mode_text, maximum_text = sys.argv[1:]
mode, maximum = int(mode_text, 8), int(maximum_text)
try:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor); named = os.lstat(path)
        if (not stat.S_ISREG(before.st_mode)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
               != (0, 0, mode, 1)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or before.st_size <= 0 or before.st_size > maximum
            or os.path.realpath(path) != path):
            raise RuntimeError()
        data = os.pread(descriptor, maximum + 1, 0)
        after = os.fstat(descriptor); named_after = os.lstat(path)
        if (len(data) != before.st_size
            or (before.st_dev, before.st_ino, before.st_mode, before.st_uid,
                before.st_gid, before.st_nlink, before.st_size, before.st_mtime_ns)
               != (after.st_dev, after.st_ino, after.st_mode, after.st_uid,
                   after.st_gid, after.st_nlink, after.st_size, after.st_mtime_ns)
            or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)
            or hashlib.sha256(data).hexdigest() != digest):
            raise RuntimeError()
    finally:
        os.close(descriptor)
except Exception:
    raise SystemExit(1)
PY
}

require_exact_directory() {
  local path="$1"
  shift
  env -i PATH="$SAFE_PATH" python3 -I - "$path" "$@" <<'PY'
import os, stat, sys
path, expected = sys.argv[1], sorted(sys.argv[2:])
try:
    value = os.lstat(path)
    if (not stat.S_ISDIR(value.st_mode)
        or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(path) != path or sorted(os.listdir(path)) != expected):
        raise RuntimeError()
except Exception:
    raise SystemExit(1)
PY
}

require_staged_bundle() {
  require_exact_directory "$STAGING_ROOT" "$SCRIPT_BASENAME" \
    fetanagent-production-ingress-h19.next || return 1
  [[ "$(realpath -- "$0")" == "$STAGED_INSTALLER" ]] || return 1
  require_exact_file "$STAGED_INSTALLER" \
    "$(sha256sum -- "$STAGED_INSTALLER" | awk '{print $1}')" 700 || return 1
  require_exact_file "$STAGED_GUARD" "$SUCCESSOR_GUARD_SHA256" 600 || return 1
  bash -n "$STAGED_INSTALLER" && bash -n "$STAGED_GUARD"
}

require_h22_boundary() {
  require_exact_directory "$H22_PARENT" "$H22_RELEASE" || return 1
  require_exact_directory "$H22_PARENT/$H22_RELEASE" completed-v1 intent-v1 \
    predecessor-ingress-guard terminal-transition-receipt || return 1
  require_exact_file "$H22_PARENT/$H22_RELEASE/intent-v1" "$H22_INTENT_SHA256" 600 4096 ||
    return 1
  require_exact_file "$H22_PARENT/$H22_RELEASE/completed-v1" \
    "$H22_COMPLETION_SHA256" 600 4096
}

require_predecessor_record_output() {
  local output
  local -a lines=()
  output="$(env -i PATH="$SAFE_PATH" HOME='/root' "$INGRESS_GUARD" record)" || return 1
  mapfile -t lines <<<"$output"
  [[ "${#lines[@]}" -eq 11 && "${lines[0]}" == active &&
    "${lines[1]}" == "$H19_RELEASE" && "${lines[2]}" == "$H19_RELEASE" &&
    "${lines[3]}" == "$H20_HELPER_SHA256" && "${lines[8]}" == "$H20_FINALIZER_SHA256" &&
    "${lines[9]}" == "$H20_SUDOERS_SHA256" && "${lines[10]}" == "$H22_GUARD_SHA256" ]]
}

require_successor_record_output() {
  local output
  local -a lines=()
  output="$(env -i PATH="$SAFE_PATH" HOME='/root' "$INGRESS_GUARD" record)" || return 1
  mapfile -t lines <<<"$output"
  [[ "${#lines[@]}" -eq 11 && "${lines[0]}" == active &&
    "${lines[1]}" == "$H19_RELEASE" && "${lines[2]}" == "$H19_RELEASE" &&
    "${lines[3]}" == "$H20_HELPER_SHA256" && "${lines[8]}" == "$H20_FINALIZER_SHA256" &&
    "${lines[9]}" == "$H20_SUDOERS_SHA256" && "${lines[10]}" == "$SUCCESSOR_GUARD_SHA256" ]]
}

production_container_ids() {
  docker_local container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PRODUCTION_PROJECT" | LC_ALL=C sort
}

production_inspection() {
  local ids
  ids="$(production_container_ids)" || return 1
  mapfile -t PRODUCTION_IDS <<<"$ids"
  [[ "${#PRODUCTION_IDS[@]}" -eq 10 ]] || return 1
  docker_local container inspect "${PRODUCTION_IDS[@]}"
}

require_production_contract() {
  local inspection
  inspection="$(production_inspection)" || return 1
  jq -e --arg bot "$APPROVED_BOT_RELEASE" --arg candidate "$H19_RELEASE" \
    --arg protected "$PROTECTED_RELEASE" '
      (map(.Config.Labels["com.docker.compose.service"]) | sort) == [
        "api", "beta-admission", "bot", "customer-web", "gateway", "owner-control",
        "production-companion-device-bridge", "telebirr-assignment-broker",
        "telebirr-device-bridge", "telebirr-device-state-broker"
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
        .HostConfig.ReadonlyRootfs == true and .HostConfig.RestartPolicy.Name == "unless-stopped" and
        .HostConfig.CapDrop == ["ALL"] and .HostConfig.Init == true and
        (.HostConfig.SecurityOpt | index("no-new-privileges:true")) != null and
        (if .Config.Labels["com.docker.compose.service"] == "gateway" then
          .Name == "/fetanagent-production-gateway-1" and
          .Config.Labels["org.opencontainers.image.revision"] == $candidate and
          .Config.Labels["org.opencontainers.image.title"] == "fetanagent-gateway" and
          .Config.Image == ("fetanagent-gateway:" + ($candidate[0:12])) and
          .Config.Entrypoint == null and
          .Config.Cmd == ["caddy","run","--config","/etc/caddy/Caddyfile","--adapter","caddyfile"] and
          ([.Config.Env[] | select(startswith("FINANCIAL_ACTIONS_MODE=") or
            startswith("KEMERBET_EXECUTOR_ENABLED=") or
            startswith("KEMERBET_FINAL_ACTION_ENABLED="))] | length) == 0 and
          ([.Config.Env[] | select(startswith("FETANAGENT_COMPANION_BRIDGE_UPSTREAM="))] ==
            ["FETANAGENT_COMPANION_BRIDGE_UPSTREAM=production-companion-device-bridge:8085"]) and
          .HostConfig.CapAdd == ["CAP_NET_BIND_SERVICE"] and
          (.HostConfig.Binds | sort) == [
            "/var/lib/fetanagent-gateway/config:/config:rw",
            "/var/lib/fetanagent-gateway/data:/data:rw"
          ] and
          .HostConfig.Memory == 134217728 and .HostConfig.NanoCpus == 250000000 and
          .HostConfig.PidsLimit == 128 and
          .HostConfig.LogConfig == {
            "Type":"json-file", "Config":{"max-file":"3","max-size":"10m"}
          } and
          .Config.Healthcheck == {
            "Test":["CMD","caddy","validate","--config","/etc/caddy/Caddyfile","--adapter","caddyfile"],
            "Interval":15000000000, "Timeout":3000000000,
            "StartPeriod":15000000000, "Retries":4
          } and
          .HostConfig.PortBindings == {
            "443/tcp":[{"HostIp":"","HostPort":"443"}],
            "80/tcp":[{"HostIp":"","HostPort":"80"}]
          } and
          (.NetworkSettings.Networks | keys | sort) == [
            "fetanagent-companion-device-ingress",
            "fetanagent-production_public_application",
            "fetanagent-telebirr-device-ingress"
          ] and all(.NetworkSettings.Networks[];
            (.Aliases | unique | sort) == ["fetanagent-production-gateway-1","gateway"])
        else
          (if .Config.Labels["com.docker.compose.service"] == "bot"
           then $bot else $protected end) as $release |
          .Config.Labels["org.opencontainers.image.revision"] == $release and
          .Config.Image == ("fetanagent-" +
            (if .Config.Labels["com.docker.compose.service"] ==
              "production-companion-device-bridge" then "companion-device-bridge"
             else .Config.Labels["com.docker.compose.service"] end) +
            ":" + ($release[0:12])) and
          ([.Config.Env[] | select(startswith("FINANCIAL_ACTIONS_MODE="))] ==
            ["FINANCIAL_ACTIONS_MODE=dry_run"]) and
          ([.Config.Env[] | select(startswith("KEMERBET_EXECUTOR_ENABLED="))] ==
            ["KEMERBET_EXECUTOR_ENABLED=false"]) and
          ([.Config.Env[] | select(startswith("KEMERBET_FINAL_ACTION_ENABLED="))] ==
            ["KEMERBET_FINAL_ACTION_ENABLED=false"]) and
          .HostConfig.PortBindings == {}
        end)
      )
    ' <<<"$inspection" >/dev/null
}

gateway_caddy_sha256() {
  local gateway
  gateway="$(docker_local container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PRODUCTION_PROJECT" \
    --filter 'label=com.docker.compose.service=gateway')" || return 1
  [[ "$gateway" =~ ^[0-9a-f]{64}$ ]] || return 1
  docker_local exec "$gateway" cat /etc/caddy/Caddyfile | sha256sum | awk '{print $1}'
}

service_image_id() {
  local service="$1"
  production_inspection | jq -er --arg service "$service" '
    [.[] | select(.Config.Labels["com.docker.compose.service"] == $service) | .Image] |
    if length == 1 and (.[0] | test("^sha256:[0-9a-f]{64}$"))
    then .[0] else error($service) end'
}

production_boundary_digest() {
  local inspection caddy current
  inspection="$(production_inspection)" || return 1
  caddy="$(gateway_caddy_sha256)" || return 1
  [[ -L "$PRODUCTION_CURRENT" ]] || return 1
  current="$(readlink -f -- "$PRODUCTION_CURRENT")" || return 1
  [[ "$current" == "$PRODUCTION_RELEASE_ROOT/$PROTECTED_RELEASE" ]] || return 1
  jq -S -c 'sort_by(.Name) | map({
    Id,Image,Name,RestartCount,Created,
    Config:{User:.Config.User,Image:.Config.Image,Entrypoint:.Config.Entrypoint,
      Cmd:.Config.Cmd,Env:.Config.Env,ExposedPorts:.Config.ExposedPorts,Labels:.Config.Labels},
    HostConfig:{ReadonlyRootfs:.HostConfig.ReadonlyRootfs,RestartPolicy:.HostConfig.RestartPolicy,
      CapAdd:.HostConfig.CapAdd,CapDrop:.HostConfig.CapDrop,SecurityOpt:.HostConfig.SecurityOpt,
      Init:.HostConfig.Init,PortBindings:.HostConfig.PortBindings,Binds:.HostConfig.Binds},
    State:{Status:.State.Status,Running:.State.Running,Paused:.State.Paused,
      Restarting:.State.Restarting,Dead:.State.Dead,OOMKilled:.State.OOMKilled,
      StartedAt:.State.StartedAt,Health:.State.Health.Status},
    NetworkSettings:{Networks:.NetworkSettings.Networks,Ports:.NetworkSettings.Ports}
  })' <<<"$inspection" | { read -r snapshot; printf '%s\n%s\n%s\n' "$snapshot" "$caddy" "$current"; } |
    sha256sum | awk '{print $1}'
}

immutable_nine_digest() {
  local inspection
  inspection="$(production_inspection)" || return 1
  jq -e 'map(select(.Config.Labels["com.docker.compose.service"] != "gateway")) |
    length == 9' <<<"$inspection" >/dev/null || return 1
  jq -S -c 'map(select(.Config.Labels["com.docker.compose.service"] != "gateway") |
      del(.ExecIDs,.State.Health.Log) |
      .Mounts |= sort_by([.Type,.Name,.Source,.Destination,.Driver,.Mode,.RW,.Propagation])) |
    sort_by(.Name)' <<<"$inspection" | sha256sum | awk '{print $1}'
}

require_shared_ingress() {
  local inspection network_id
  network_id="$(docker_local network ls --quiet --no-trunc --filter "name=^${SHARED_NETWORK}$")" ||
    return 1
  [[ "$network_id" == "$SHARED_NETWORK_ID" ]] || return 1
  inspection="$(docker_local network inspect "$network_id")" || return 1
  jq -e --arg config "$SHARED_NETWORK_CONFIG_HASH" --arg id "$SHARED_NETWORK_ID" '
    length == 1 and .[0].Id == $id and .[0].Name == "fetanagent-telebirr-device-ingress" and
    .[0].Scope == "local" and .[0].Driver == "bridge" and .[0].EnableIPv6 == false and
    .[0].Internal == true and .[0].Attachable == false and .[0].Ingress == false and
    .[0].ConfigOnly == false and .[0].Options == {} and
    .[0].IPAM.Driver == "default" and .[0].IPAM.Options == null and
    .[0].IPAM.Config == [{"Subnet":"172.23.0.0/16","Gateway":"172.23.0.1"}] and
    .[0].Labels == {
      "com.docker.compose.config-hash":$config,
      "com.docker.compose.network":"telebirr_device_ingress",
      "com.docker.compose.project":"fetanagent-staging-beta",
      "com.docker.compose.version":"5.1.4"
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
      .value.IPv6Address == "")
  ' <<<"$inspection" >/dev/null || return 1
  local network_rows container_rows
  network_rows="$(jq -r '.[0].Containers | to_entries[] |
    [.key,.value.EndpointID,.value.MacAddress,.value.IPv4Address,.value.IPv6Address] | @tsv' \
    <<<"$inspection" | LC_ALL=C sort)" || return 1
  container_rows="$(docker_local container inspect fetanagent-production-gateway-1 \
    fetanagent-production-telebirr-device-bridge-1 | jq -r --arg network "$SHARED_NETWORK" '.[] |
      [.Id,.NetworkSettings.Networks[$network].EndpointID,
       .NetworkSettings.Networks[$network].MacAddress,
       (.NetworkSettings.Networks[$network].IPAddress + "/" +
        (.NetworkSettings.Networks[$network].IPPrefixLen|tostring)),
       .NetworkSettings.Networks[$network].GlobalIPv6Address] | @tsv' | LC_ALL=C sort)" || return 1
  [[ -n "$network_rows" && "$network_rows" == "$container_rows" ]]
}

shared_ingress_digest() {
  docker_local network inspect "$SHARED_NETWORK_ID" | jq -S -c '.[0]' |
    sha256sum | awk '{print $1}'
}

tls_leaf_digest() {
  local certificate
  certificate="$(printf '' | openssl s_client -connect device.fetanagent.com:443 \
    -servername device.fetanagent.com 2>/dev/null | openssl x509 -outform DER 2>/dev/null |
    sha256sum | awk '{print $1}')" || return 1
  [[ "$certificate" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$certificate"
}

require_staging_absent() {
  local project inventory
  for project in fetanagent-staging-beta fetanagent-telebirr-device-pilot; do
    inventory="$(docker_local container ls --all --quiet --no-trunc \
      --filter "label=com.docker.compose.project=$project")" || return 1
    [[ -z "$inventory" ]] || return 1
  done
}

require_current_boundaries() {
  require_staging_absent && require_production_contract && require_shared_ingress &&
    [[ "$(service_image_id gateway)" == "$CANDIDATE_GATEWAY_IMAGE_ID" &&
      "$(service_image_id bot)" == "$APPROVED_BOT_IMAGE_ID" &&
      "$(gateway_caddy_sha256)" == "$CANDIDATE_CADDY_SHA256" &&
      "$(production_boundary_digest)" == "$REATTESTED_PRODUCTION_SHA256" &&
      "$(immutable_nine_digest)" == "$REATTESTED_NINE_SHA256" &&
      "$(shared_ingress_digest)" == "$REATTESTED_INGRESS_SHA256" &&
      "$(tls_leaf_digest)" == "$TLS_LEAF_SHA256" ]]
}

require_release_source() {
  local base="$PRODUCTION_RELEASE_ROOT/$PROTECTED_RELEASE"
  [[ ! -L "$base" && -d "$base" && "$(realpath -- "$base")" == "$base" &&
    "$(stat --format='%U:%G:%a' "$base")" == root:root:700 &&
    ! -L "$base/compose.production.yaml" && -f "$base/compose.production.yaml" &&
    "$(stat --format='%U:%G:%a:%h' "$base/compose.production.yaml")" == root:root:444:1 &&
    "$(sha256sum -- "$base/compose.production.yaml" | awk '{print $1}')" == \
      "$PROTECTED_COMPOSE_SHA256" ]]
}

public_smoke() {
  local body code
  body="$(curl --fail --silent --show-error --proto '=https' --tlsv1.2 --max-time 15 \
    https://owner.fetanagent.com/owner)" || return 1
  grep -Fqi production <<<"$body" || return 1
  code="$(curl --silent --show-error --output /dev/null --proto '=https' --tlsv1.2 \
    --max-time 15 --write-out '%{http_code}' https://device.fetanagent.com/)" || return 1
  [[ "$code" == 404 ]] || return 1
  code="$(curl --silent --show-error --output /dev/null --proto '=https' --tlsv1.2 --max-time 15 \
    --request POST --header 'Content-Type: application/vnd.fetanagent.telebirr-device-bridge+json' \
    --data '{}' --write-out '%{http_code}' \
    https://device.fetanagent.com/v1/telebirr/device/heartbeat)" || return 1
  [[ "$code" == 400 ]]
}

require_active_deploy_grant() {
  require_exact_file "$DEPLOY_SUDOERS" "$DEPLOY_SUDOERS_SHA256" 440 65536 &&
    [[ ! -e "$DEPLOY_SUDOERS_DISABLED" && ! -L "$DEPLOY_SUDOERS_DISABLED" ]] &&
    visudo -cf /etc/sudoers >/dev/null
}

require_disabled_deploy_grant() {
  [[ ! -e "$DEPLOY_SUDOERS" && ! -L "$DEPLOY_SUDOERS" ]] &&
    require_exact_file "$DEPLOY_SUDOERS_DISABLED" "$DEPLOY_SUDOERS_SHA256" 440 65536 &&
    visudo -cf /etc/sudoers >/dev/null
}

disable_deploy_grant() {
  if require_disabled_deploy_grant; then return; fi
  require_active_deploy_grant || return 1
  mv -- "$DEPLOY_SUDOERS" "$DEPLOY_SUDOERS_DISABLED" || return 1
  sync -f /etc/sudoers.d || return 1
  require_disabled_deploy_grant
}

restore_deploy_grant() {
  if require_active_deploy_grant; then return; fi
  require_disabled_deploy_grant || return 1
  mv -- "$DEPLOY_SUDOERS_DISABLED" "$DEPLOY_SUDOERS" || return 1
  sync -f /etc/sudoers.d || return 1
  require_active_deploy_grant
}

open_lock() {
  local identity
  [[ ! -L "$MUTATION_LOCK_ROOT" && -d "$MUTATION_LOCK_ROOT" &&
    "$(realpath -- "$MUTATION_LOCK_ROOT")" == "$MUTATION_LOCK_ROOT" &&
    "$(stat --format='%U:%G:%a' "$MUTATION_LOCK_ROOT")" == root:root:700 &&
    ! -L "$MUTATION_LOCK" && -f "$MUTATION_LOCK" &&
    "$(realpath -- "$MUTATION_LOCK")" == "$MUTATION_LOCK" &&
    "$(stat --format='%U:%G:%a:%h' "$MUTATION_LOCK")" == root:root:600:1 ]] || return 1
  exec 9<>"$MUTATION_LOCK" || return 1
  identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")" || return 1
  [[ "$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)" == "$identity" ]] || return 1
  flock --exclusive --nonblock 9 || return 1
  [[ "$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")" == "$identity" ]]
}

expected_intent() {
  printf '%s\n' \
    'contract=fetanagent-h19-runtime-reattest-guard-bridge-v23' \
    'state=authorized' \
    "bridge_release=$BRIDGE_RELEASE" \
    "h22_bridge_release=$H22_RELEASE" \
    "h22_bridge_intent_sha256=$H22_INTENT_SHA256" \
    "h22_bridge_completion_sha256=$H22_COMPLETION_SHA256" \
    "h19_bridge_release=$H19_RELEASE" \
    "candidate_gateway_release=$H19_RELEASE" \
    "predecessor_ingress_guard_sha256=$H22_GUARD_SHA256" \
    "successor_ingress_guard_sha256=$SUCCESSOR_GUARD_SHA256" \
    "approved_telegram_bot_release=$APPROVED_BOT_RELEASE" \
    "approved_telegram_bot_image_id=$APPROVED_BOT_IMAGE_ID" \
    "reattested_production_boundary_sha256=$REATTESTED_PRODUCTION_SHA256" \
    "reattested_immutable_nine_sha256=$REATTESTED_NINE_SHA256" \
    "reattested_shared_ingress_sha256=$REATTESTED_INGRESS_SHA256" \
    "reattested_tls_leaf_sha256=$TLS_LEAF_SHA256" \
    "candidate_gateway_image_id=$CANDIDATE_GATEWAY_IMAGE_ID" \
    "candidate_gateway_caddyfile_sha256=$CANDIDATE_CADDY_SHA256" \
    'staging_runtime_stopped=true' \
    'correction=approved-runtime-identity-reattest' \
    'h19_through_h22_evidence_preserved=true' \
    'production_runtime_mutation=false' \
    'database_mutation=false' \
    'financial_actions_mode=disabled' \
    'transfer_enabled=false' \
    'amount_enabled=false' \
    'money_moved=false'
}

expected_completion() {
  local intent_sha
  intent_sha="$(expected_intent | sha256sum | awk '{print $1}')" || return 1
  expected_intent | awk 'NR == 2 {$0="state=runtime-reattest-guard-installed"} {print}'
  printf 'bridge_intent_sha256=%s\n' "$intent_sha"
}

require_expected_record() {
  local path="$1" mode="$2" producer="$3" digest
  digest="$($producer | sha256sum | awk '{print $1}')" || return 1
  require_exact_file "$path" "$digest" "$mode" 8192 && cmp -s -- "$path" <($producer)
}

publish_record() {
  local root="$1" name="$2" producer="$3" target temporary
  target="$root/$name"
  temporary="$target.installing"
  if [[ -e "$target" || -L "$target" ]]; then
    [[ ! -e "$temporary" && ! -L "$temporary" ]] || return 1
    require_expected_record "$target" 600 "$producer"
    return
  fi
  if [[ ! -e "$temporary" && ! -L "$temporary" ]]; then
    install -o root -g root -m 0600 /dev/null "$temporary" || return 1
    "$producer" >"$temporary" || return 1
    sync -f "$temporary" || return 1
  fi
  require_expected_record "$temporary" 600 "$producer" || return 1
  mv -- "$temporary" "$target" || return 1
  sync -f "$root" || return 1
  require_expected_record "$target" 600 "$producer"
}

archive_predecessor_guard() {
  local target="$H23_INSTALLING/predecessor-ingress-guard" temporary="$target.installing"
  if [[ -e "$target" || -L "$target" ]]; then
    [[ ! -e "$temporary" && ! -L "$temporary" ]] || return 1
    require_exact_file "$target" "$H22_GUARD_SHA256" 400
    return
  fi
  if [[ ! -e "$temporary" && ! -L "$temporary" ]]; then
    require_exact_file "$INGRESS_GUARD" "$H22_GUARD_SHA256" 755 || return 1
    install -o root -g root -m 0400 "$INGRESS_GUARD" "$temporary" || return 1
    sync -f "$temporary" || return 1
  fi
  require_exact_file "$temporary" "$H22_GUARD_SHA256" 400 || return 1
  mv -- "$temporary" "$target" || return 1
  sync -f "$H23_INSTALLING"
}

guard_state() {
  if require_exact_file "$INGRESS_GUARD" "$H22_GUARD_SHA256" 755 2>/dev/null; then
    printf old
  elif require_exact_file "$INGRESS_GUARD" "$SUCCESSOR_GUARD_SHA256" 755 2>/dev/null; then
    printf new
  else
    return 1
  fi
}

install_successor_guard() {
  local state
  state="$(guard_state)" || return 1
  if [[ "$state" == new ]]; then
    [[ ! -e "$GUARD_INSTALLING" && ! -L "$GUARD_INSTALLING" ]]
    return
  fi
  if [[ ! -e "$GUARD_INSTALLING" && ! -L "$GUARD_INSTALLING" ]]; then
    install -o root -g root -m 0755 "$STAGED_GUARD" "$GUARD_INSTALLING" || return 1
    sync -f "$GUARD_INSTALLING" || return 1
  fi
  require_exact_file "$GUARD_INSTALLING" "$SUCCESSOR_GUARD_SHA256" 755 || return 1
  mv -- "$GUARD_INSTALLING" "$INGRESS_GUARD" || return 1
  sync -f /usr/local/sbin || return 1
  require_exact_file "$INGRESS_GUARD" "$SUCCESSOR_GUARD_SHA256" 755 && bash -n "$INGRESS_GUARD"
}

namespace_state() {
  if [[ ! -e "$H23_PARENT" && ! -L "$H23_PARENT" ]]; then printf absent; return; fi
  [[ ! -L "$H23_PARENT" && -d "$H23_PARENT" &&
    "$(realpath -- "$H23_PARENT")" == "$H23_PARENT" &&
    "$(stat --format='%U:%G:%a' "$H23_PARENT")" == root:root:700 ]] || return 1
  local entries
  entries="$(find -P "$H23_PARENT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' |
    LC_ALL=C sort)" || return 1
  case "$entries" in
    '') printf empty-parent ;;
    ".installing-$BRIDGE_RELEASE:d") printf installing ;;
    "$BRIDGE_RELEASE:d") printf completed ;;
    *) return 1 ;;
  esac
}

require_terminal_record() {
  require_exact_directory "$H23_PARENT" "$BRIDGE_RELEASE" &&
    require_exact_directory "$H23_ROOT" completed-v1 intent-v1 predecessor-ingress-guard &&
    require_expected_record "$H23_ROOT/intent-v1" 600 expected_intent &&
    require_expected_record "$H23_ROOT/completed-v1" 600 expected_completion &&
    require_exact_file "$H23_ROOT/predecessor-ingress-guard" "$H22_GUARD_SHA256" 400
}

require_staged_bundle || die 'the root-owned staged H23 bundle is not exact'
require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'
require_h22_boundary || die 'the terminal H22 evidence is not exact'
require_exact_file "$STAGING_HELPER" "$H20_HELPER_SHA256" 755 ||
  die 'the staging helper changed outside the H19-H22 chain'
require_exact_file "$CONTINUOUS_FINALIZER" "$H20_FINALIZER_SHA256" 755 ||
  die 'the continuous finalizer changed outside the H19-H22 chain'
require_exact_file "$CONTINUOUS_SUDOERS" "$H20_SUDOERS_SHA256" 440 65536 ||
  die 'the continuous sudoers changed outside the H19-H22 chain'
require_release_source || die 'the protected production source changed'
require_current_boundaries || die 'the approved no-money production boundary is not exact'
public_smoke || die 'the public no-money boundary is not healthy'
state="$(namespace_state)" || die 'the H23 namespace is invalid'
guard="$(guard_state)" || die 'the installed guard is neither the H22 predecessor nor H23 successor'
if [[ "$guard" == old ]]; then
  require_predecessor_record_output || die 'the installed H22 guard rejected its provenance chain'
fi
case "$state:$guard" in
  absent:old|empty-parent:old|installing:old|installing:new|completed:new) ;;
  *) die 'the H23 evidence and installed-guard topology is causally invalid' ;;
esac
if [[ "$state" == completed ]]; then require_terminal_record || die 'the terminal H23 record is invalid'; fi
require_active_deploy_grant || require_disabled_deploy_grant ||
  die 'the staging deployment grant is not in an exact recoverable state'

if [[ "$MODE" == preflight ]]; then
  printf '%s\n' \
    'FetanAgent H23 preflight passed: exact approved runtime verified; no state changed; money moved=false.'
  exit 0
fi

open_lock || die 'the shared staging mutation lock is unavailable'
require_h22_boundary || die 'the H22 chain changed after lock acquisition'
require_current_boundaries || die 'the production boundary changed after lock acquisition'
public_smoke || die 'the public boundary changed after lock acquisition'
guard="$(guard_state)" || die 'the installed guard changed after lock acquisition'
if [[ "$guard" == old ]]; then
  require_predecessor_record_output || die 'the H22 provenance changed after lock acquisition'
fi
disable_deploy_grant || die 'the staging deployment capability could not be isolated'

state="$(namespace_state)" || die 'the H23 namespace changed unexpectedly'
if [[ "$state" != completed ]]; then
  if [[ "$state" == absent ]]; then
    install -d -o root -g root -m 0700 "$H23_PARENT" || die 'the H23 parent could not be created'
    sync -f "$(dirname -- "$H23_PARENT")"
    state=empty-parent
  fi
  if [[ "$state" == empty-parent ]]; then
    install -d -o root -g root -m 0700 "$H23_INSTALLING" ||
      die 'the H23 installing root could not be created'
    sync -f "$H23_PARENT"
    state=installing
  fi
  [[ "$state" == installing ]] || die 'the H23 installing namespace is invalid'
  publish_record "$H23_INSTALLING" intent-v1 expected_intent || die 'the H23 intent could not be sealed'
  archive_predecessor_guard || die 'the H22 guard could not be archived'
  install_successor_guard || die 'the H23 successor guard could not be installed atomically'
  publish_record "$H23_INSTALLING" completed-v1 expected_completion ||
    die 'the H23 completion could not be sealed'
  require_exact_directory "$H23_INSTALLING" completed-v1 intent-v1 predecessor-ingress-guard &&
    require_expected_record "$H23_INSTALLING/intent-v1" 600 expected_intent &&
    require_expected_record "$H23_INSTALLING/completed-v1" 600 expected_completion &&
    require_exact_file "$H23_INSTALLING/predecessor-ingress-guard" "$H22_GUARD_SHA256" 400 ||
    die 'the completed H23 installing record is invalid'
  [[ ! -e "$H23_ROOT" && ! -L "$H23_ROOT" ]] || die 'the terminal H23 root appeared unexpectedly'
  mv -- "$H23_INSTALLING" "$H23_ROOT" || die 'the H23 record could not become terminal'
  sync -f "$H23_PARENT"
fi

require_terminal_record || die 'the terminal H23 record is invalid'
require_exact_file "$INGRESS_GUARD" "$SUCCESSOR_GUARD_SHA256" 755 ||
  die 'the installed H23 successor guard is not exact'
require_current_boundaries || die 'the re-attested production boundary changed during H23 installation'
env -i PATH="$SAFE_PATH" HOME='/root' "$INGRESS_GUARD" inspect "$H19_RELEASE" ||
  die 'the H23 successor guard rejected the exact re-attested state'
require_successor_record_output || die 'the H23 successor record chain is invalid'
restore_deploy_grant || die 'the staging deployment capability could not be restored safely'
require_terminal_record && require_successor_record_output && require_current_boundaries && public_smoke ||
  die 'the restored H23 transaction is not exact'
flock --unlock 9 || die 'the shared mutation lock could not be released'
exec 9>&-

printf '%s\n' \
  'FetanAgent H23 runtime re-attestation installed: approved bot retained; containers and database untouched; financial actions disabled; money moved=false.'
