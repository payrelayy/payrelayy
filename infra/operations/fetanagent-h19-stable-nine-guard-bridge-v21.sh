#!/usr/bin/env bash
# One-use, root-console-only H20 -> H21 guard correction. It preserves the
# already-authorized H19 gateway transition, replaces only the ingress guard,
# and bridges the legacy raw Docker inspection digest to one stable canonical
# digest. It does not run Compose, alter a database, or move money.
set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly INGRESS_GUARD='/usr/local/sbin/fetanagent-production-ingress-h19'
readonly GUARD_INSTALLING='/usr/local/sbin/.fetanagent-production-ingress-h19.h21-installing'
readonly DEPLOY_SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly DEPLOY_SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.h21-disabled'
readonly H20_PARENT='/var/lib/fetanagent/h19-canonical-cap-guard-bridge-v20'
readonly H21_PARENT='/var/lib/fetanagent/h19-stable-nine-guard-bridge-v21'
readonly TRANSITION_PARENT='/var/lib/fetanagent/production-gateway-staging-route-v1'
readonly H20_RELEASE='db8ca9889a63045f4da403eebb028618a400407f'
readonly H20_INTENT_SHA256='369ac69c0492e870101281af499edf51181bc3b4d4c84b2361ebd1ad053cfb88'
readonly H20_COMPLETION_SHA256='37446dca1a59fb190299addf3679f2d4a2be27b8af5c52ad8dffc84232425f62'
readonly H19_RELEASE='90b1f059577682b6bc458d239f6bdcb591077085'
readonly H19_INTENT_SHA256='51e0f03017e8986d5bd76bbb97759437d86011ce448c34999ef1bb9836d056a3'
readonly H19_COMPLETION_SHA256='fdccf275bb43f95ea140411c0cee044a6c8e13d884dae640c64123936a8119d5'
readonly H19_HELPER_SHA256='b4a5975f97be388b8862e8d21c207815f02708e6476fa5e79b795825b3a01381'
readonly H19_FINALIZER_SHA256='a1951a5559ef735e507b762369861fd71fefbde518a415f8c928956f7e20df39'
readonly H19_SUDOERS_SHA256='5e92a8c42d6b44ae22fa837efc9b35e54033a00a1e830a7bad8de2d3382f3796'
readonly H19_GUARD_SHA256='13e6f430d1fb6e83736265055bed9569431403411e5d459fd86c1d32b00adced'
readonly H20_HELPER_SHA256='8c7230cea5101f182f05b11b094049822ddbe43884d7bda80a9a46b883eee4b4'
readonly H20_FINALIZER_SHA256='1ab7df7d5e530db75ba5f378169de0fda178c1a264df3a48fbb5acf76220f34f'
readonly H20_SUDOERS_SHA256='0978f4785d4661db46d8fe9bb8e29d81fa5ff2954aceb36aa6cc7d2ec4a71807'
readonly PREDECESSOR_GUARD_SHA256='4481190534fb41f057f0f3c716d74ba1f6445da009d491936c1098bdaa756f5a'
readonly REVIEWED_SUCCESSOR_GUARD_SHA256='a4e31a95bfb4826634069cdc31f745ed53cccb0db2cc01578851ac8330623813'
readonly DEPLOY_SUDOERS_SHA256='19812382d8c43076726cf301c715b601a0da375bb130b17960bcffad154f7422'
readonly REVIEWED_INTERRUPTED_INTENT_SHA256='b0dd0ff0f66d961448e6e214feea8806627bf9f5aac1995436b2105f3fce6537'
readonly LEGACY_RAW_NINE_SHA256='6aa4f35860635609b54e0884810b16fdb10a39275b687a8f678e5af86ed00c42'
readonly REVIEWED_CANONICAL_NINE_SHA256='a72b855a5b59e2169b9bbdca1dce03aa8dec17b16082fa83b0dc55b1910c90c9'
readonly PRODUCTION_BOUNDARY_SHA256='5dad1d4193f55450bb0b50c5132fd3ae91c64e6978cb6318bbfdbdb0846b7b00'
readonly SHARED_INGRESS_SHA256='c1161bba74e998ddc1282e23b7e269dcd4b552e0e39532d914ace73b1c05378a'
readonly TLS_LEAF_SHA256='2c6bbb0eea676963398ea39a76ed974c2863da72236de67be761d19197dd7fd8'
readonly PROTECTED_RELEASE='69be82ac3e49ff8c63c64c9aa7926e0046b48a10'
readonly BASELINE_CADDY_SHA256='181992c8958397d63a7ae34137d51d4186ce0383c8cfd2bf8df137da11e12f24'
readonly BASELINE_GATEWAY_IMAGE_ID='sha256:72f13d02d86c41d0b6fd1dd86d2827c16442f417ec5ef61c983eae297f57a209'
readonly REVIEWED_CANDIDATE_IMAGE_ID='sha256:443aac301bb8c26a51f7877a9cf016e8fd2101831c0cac6f59f7bd88a17189e8'
readonly PRODUCTION_ROOT='/srv/fetanagent/production'
readonly PRODUCTION_RELEASE_ROOT="$PRODUCTION_ROOT/releases"
readonly PRODUCTION_CURRENT="$PRODUCTION_ROOT/current"
readonly PRODUCTION_PROJECT='fetanagent-production'
readonly SHARED_NETWORK_ID='5b3dc890fad4f062ac570e4bbc66f950d002b536843b2630473eb817537af738'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly MUTATION_LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly MUTATION_LOCK="$MUTATION_LOCK_ROOT/mutation.lock"
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly SCRIPT_BASENAME='fetanagent-h19-stable-nine-guard-bridge-v21.sh'
readonly CONFIRMATION='I-UNDERSTAND-THIS-CORRECTS-H19-STABLE-NINE-DIGEST-WITH-NO-PRODUCTION-OR-MONEY-MUTATION'

export PATH="$SAFE_PATH"
umask 077

die() {
  printf 'FetanAgent H21 stable-nine guard bridge failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 6 ]] ||
  die 'expected the H21 release, guard digest, interrupted-intent digest, canonical digest, candidate image ID, and exact confirmation'
readonly BRIDGE_RELEASE="$1"
readonly SUCCESSOR_GUARD_SHA256="$2"
readonly INTERRUPTED_INTENT_SHA256="$3"
readonly CANONICAL_NINE_SHA256="$4"
readonly CANDIDATE_IMAGE_ID="$5"
readonly PROVIDED_CONFIRMATION="$6"
readonly STAGING_ROOT="/root/fetanagent-h19-stable-nine-guard-bridge-v21-$BRIDGE_RELEASE"
readonly STAGED_INSTALLER="$STAGING_ROOT/$SCRIPT_BASENAME"
readonly STAGED_GUARD="$STAGING_ROOT/fetanagent-production-ingress-h19.next"
readonly H21_ROOT="$H21_PARENT/$BRIDGE_RELEASE"
readonly H21_INSTALLING="$H21_PARENT/.installing-$BRIDGE_RELEASE"
readonly TRANSITION_INSTALLING="$TRANSITION_PARENT/.installing-$H19_RELEASE"

[[ "$BRIDGE_RELEASE" =~ ^[0-9a-f]{40}$ &&
  "$BRIDGE_RELEASE" != "$PROTECTED_RELEASE" && "$BRIDGE_RELEASE" != "$H19_RELEASE" &&
  "$BRIDGE_RELEASE" != "$H20_RELEASE" ]] ||
  die 'H21 requires one distinct full release SHA for correction provenance'
[[ "$SUCCESSOR_GUARD_SHA256" == "$REVIEWED_SUCCESSOR_GUARD_SHA256" &&
  "$INTERRUPTED_INTENT_SHA256" == "$REVIEWED_INTERRUPTED_INTENT_SHA256" &&
  "$CANONICAL_NINE_SHA256" == "$REVIEWED_CANONICAL_NINE_SHA256" &&
  "$CANDIDATE_IMAGE_ID" == "$REVIEWED_CANDIDATE_IMAGE_ID" ]] ||
  die 'the staged H21 values do not match the reviewed recovery chain'
[[ "$SUCCESSOR_GUARD_SHA256" != "$PREDECESSOR_GUARD_SHA256" ]] ||
  die 'the successor guard must be distinct from H20'
[[ "$PROVIDED_CONFIRMATION" == "$CONFIRMATION" ]] ||
  die 'the exact one-use no-money H21 confirmation is required'
[[ "$(id -u)" == '0' && "$(id -un)" == 'root' && -z "${SUDO_USER:-}" ]] ||
  die 'run this installer only in the DigitalOcean root console'
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
    'fetanagent-production-ingress-h19.next' || return 1
  [[ "$(realpath -- "$0")" == "$STAGED_INSTALLER" ]] || return 1
  require_exact_file "$STAGED_INSTALLER" \
    "$(sha256sum -- "$STAGED_INSTALLER" | awk '{print $1}')" 700 || return 1
  require_exact_file "$STAGED_GUARD" "$SUCCESSOR_GUARD_SHA256" 600 || return 1
  bash -n "$STAGED_INSTALLER" && bash -n "$STAGED_GUARD"
}

require_h20_record_and_artifacts() {
  require_exact_directory "$H20_PARENT" "$H20_RELEASE" || return 1
  local root="$H20_PARENT/$H20_RELEASE"
  require_exact_directory "$root" completed-v1 intent-v1 predecessor-continuous-finalizer \
    predecessor-continuous-sudoers predecessor-helper predecessor-ingress-guard || return 1
  require_exact_file "$root/intent-v1" "$H20_INTENT_SHA256" 600 4096 || return 1
  require_exact_file "$root/completed-v1" "$H20_COMPLETION_SHA256" 600 4096 || return 1
  require_exact_file "$root/predecessor-helper" "$H19_HELPER_SHA256" 400 || return 1
  require_exact_file "$root/predecessor-continuous-finalizer" "$H19_FINALIZER_SHA256" 400 || return 1
  require_exact_file "$root/predecessor-continuous-sudoers" "$H19_SUDOERS_SHA256" 400 65536 || return 1
  require_exact_file "$root/predecessor-ingress-guard" "$H19_GUARD_SHA256" 400 || return 1
  require_exact_file /usr/local/sbin/fetanagent-staging-deploy-helper "$H20_HELPER_SHA256" 755 || return 1
  require_exact_file /usr/local/sbin/fetanagent-staging-continuous-availability \
    "$H20_FINALIZER_SHA256" 755 || return 1
  require_exact_file /etc/sudoers.d/fetanagent-staging-continuous-availability \
    "$H20_SUDOERS_SHA256" 440 65536 || return 1
}

guard_state() {
  if require_exact_file "$INGRESS_GUARD" "$PREDECESSOR_GUARD_SHA256" 755 2>/dev/null; then
    printf old
  elif require_exact_file "$INGRESS_GUARD" "$SUCCESSOR_GUARD_SHA256" 755 2>/dev/null; then
    printf new
  else
    return 1
  fi
}

namespace_state() {
  if [[ ! -e "$H21_PARENT" && ! -L "$H21_PARENT" ]]; then
    printf absent
    return
  fi
  [[ ! -L "$H21_PARENT" && -d "$H21_PARENT" &&
    "$(realpath -- "$H21_PARENT")" == "$H21_PARENT" &&
    "$(stat --format='%U:%G:%a' "$H21_PARENT")" == 'root:root:700' ]] || return 1
  local entries
  entries="$(find -P "$H21_PARENT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' |
    LC_ALL=C sort)" || return 1
  case "$entries" in
    '') printf empty-parent ;;
    ".installing-$BRIDGE_RELEASE:d") printf installing ;;
    "$BRIDGE_RELEASE:d") printf completed ;;
    *) return 1 ;;
  esac
}

require_interrupted_transition() {
  require_exact_directory "$TRANSITION_PARENT" ".installing-$H19_RELEASE" || return 1
  require_exact_directory "$TRANSITION_INSTALLING" intent-v1 || return 1
  require_exact_file "$TRANSITION_INSTALLING/intent-v1" "$INTERRUPTED_INTENT_SHA256" 600 8192
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

gateway_caddy_sha256() {
  local gateway
  gateway="$(docker_local container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PRODUCTION_PROJECT" \
    --filter 'label=com.docker.compose.service=gateway')" || return 1
  [[ "$gateway" =~ ^[0-9a-f]{64}$ ]] || return 1
  docker_local exec "$gateway" cat /etc/caddy/Caddyfile | sha256sum | awk '{print $1}'
}

gateway_image_id() {
  production_inspection | jq -er '
    [.[] | select(.Config.Labels["com.docker.compose.service"] == "gateway") | .Image] |
    if length == 1 and (.[0] | test("^sha256:[0-9a-f]{64}$"))
    then .[0] else error("gateway") end'
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

canonical_nine_digest() {
  local inspection
  inspection="$(production_inspection)" || return 1
  jq -e '
    map(select(.Config.Labels["com.docker.compose.service"] != "gateway")) as $nine |
    ($nine | length) == 9 and
    ($nine | map(.Config.Labels["com.docker.compose.service"]) | sort) == [
      "api", "beta-admission", "bot", "customer-web", "owner-control",
      "production-companion-device-bridge", "telebirr-assignment-broker",
      "telebirr-device-bridge", "telebirr-device-state-broker"
    ]
  ' <<<"$inspection" >/dev/null || return 1
  jq -S -c 'map(select(.Config.Labels["com.docker.compose.service"] != "gateway") |
      del(.State.Health.Log) |
      .Mounts |= sort_by([.Type,.Name,.Source,.Destination,.Driver,.Mode,.RW,.Propagation])) |
    sort_by(.Name)' <<<"$inspection" | sha256sum | awk '{print $1}'
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

require_protected_boundaries() {
  require_staging_absent || return 1
  [[ "$(gateway_image_id)" == "$BASELINE_GATEWAY_IMAGE_ID" &&
    "$(gateway_caddy_sha256)" == "$BASELINE_CADDY_SHA256" &&
    "$(production_boundary_digest)" == "$PRODUCTION_BOUNDARY_SHA256" &&
    "$(canonical_nine_digest)" == "$CANONICAL_NINE_SHA256" &&
    "$(shared_ingress_digest)" == "$SHARED_INGRESS_SHA256" &&
    "$(tls_leaf_digest)" == "$TLS_LEAF_SHA256" ]]
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
    "$(stat --format='%U:%G:%a' "$MUTATION_LOCK_ROOT")" == 'root:root:700' &&
    ! -L "$MUTATION_LOCK" && -f "$MUTATION_LOCK" &&
    "$(realpath -- "$MUTATION_LOCK")" == "$MUTATION_LOCK" &&
    "$(stat --format='%U:%G:%a:%h' "$MUTATION_LOCK")" == 'root:root:600:1' ]] || return 1
  exec 9<>"$MUTATION_LOCK" || return 1
  identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")" || return 1
  [[ "$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)" == "$identity" ]] || return 1
  flock --exclusive --nonblock 9 || return 1
  [[ "$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")" == "$identity" ]]
}

expected_intent() {
  printf '%s\n' \
    'contract=fetanagent-h19-stable-nine-guard-bridge-v21' \
    'state=authorized' \
    "bridge_release=$BRIDGE_RELEASE" \
    "h20_bridge_release=$H20_RELEASE" \
    "h20_bridge_intent_sha256=$H20_INTENT_SHA256" \
    "h20_bridge_completion_sha256=$H20_COMPLETION_SHA256" \
    "h19_bridge_release=$H19_RELEASE" \
    "candidate_gateway_release=$H19_RELEASE" \
    "predecessor_ingress_guard_sha256=$PREDECESSOR_GUARD_SHA256" \
    "successor_ingress_guard_sha256=$SUCCESSOR_GUARD_SHA256" \
    "interrupted_transition_intent_sha256=$INTERRUPTED_INTENT_SHA256" \
    "legacy_raw_immutable_nine_sha256=$LEGACY_RAW_NINE_SHA256" \
    "canonical_immutable_nine_sha256=$CANONICAL_NINE_SHA256" \
    'immutable_nine_canonicalization=drop-health-log-sort-mounts-and-containers' \
    "baseline_production_boundary_sha256=$PRODUCTION_BOUNDARY_SHA256" \
    "baseline_shared_ingress_boundary_sha256=$SHARED_INGRESS_SHA256" \
    "baseline_tls_leaf_sha256=$TLS_LEAF_SHA256" \
    "baseline_gateway_image_id=$BASELINE_GATEWAY_IMAGE_ID" \
    "candidate_gateway_image_id=$CANDIDATE_IMAGE_ID" \
    "protected_production_release=$PROTECTED_RELEASE" \
    'transition_contract=fetanagent-production-gateway-staging-route-v1' \
    'interrupted_transition_state=authorized' \
    'transition_evidence_preserved=true' \
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
  expected_intent | awk 'NR == 2 {$0="state=stable-nine-guard-installed"} {print}'
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

archive_file() {
  local source="$1" target="$2" digest="$3" maximum="$4" temporary
  temporary="$target.installing"
  if [[ -e "$target" || -L "$target" ]]; then
    [[ ! -e "$temporary" && ! -L "$temporary" ]] || return 1
    require_exact_file "$target" "$digest" 400 "$maximum"
    return
  fi
  if [[ ! -e "$temporary" && ! -L "$temporary" ]]; then
    require_exact_file "$source" "$digest" "${5}" "$maximum" || return 1
    install -o root -g root -m 0400 "$source" "$temporary" || return 1
    sync -f "$temporary" || return 1
  fi
  require_exact_file "$temporary" "$digest" 400 "$maximum" || return 1
  mv -- "$temporary" "$target" || return 1
  sync -f "$(dirname -- "$target")" || return 1
  require_exact_file "$target" "$digest" 400 "$maximum"
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

require_terminal_record() {
  require_exact_directory "$H21_PARENT" "$BRIDGE_RELEASE" || return 1
  require_exact_directory "$H21_ROOT" completed-v1 intent-v1 interrupted-transition-intent \
    predecessor-ingress-guard || return 1
  require_expected_record "$H21_ROOT/intent-v1" 600 expected_intent || return 1
  require_expected_record "$H21_ROOT/completed-v1" 600 expected_completion || return 1
  require_exact_file "$H21_ROOT/predecessor-ingress-guard" "$PREDECESSOR_GUARD_SHA256" 400 || return 1
  require_exact_file "$H21_ROOT/interrupted-transition-intent" "$INTERRUPTED_INTENT_SHA256" 400 8192
}

require_predecessor_record_output() {
  local output
  local -a RECORD_LINES=()
  output="$(env -i PATH="$SAFE_PATH" HOME='/root' "$INGRESS_GUARD" record)" || return 1
  mapfile -t RECORD_LINES <<<"$output"
  [[ "${#RECORD_LINES[@]}" -eq 11 && "${RECORD_LINES[0]}" == active &&
    "${RECORD_LINES[1]}" == "$H19_RELEASE" && "${RECORD_LINES[2]}" == "$H19_RELEASE" &&
    "${RECORD_LINES[3]}" == "$H20_HELPER_SHA256" &&
    "${RECORD_LINES[8]}" == "$H20_FINALIZER_SHA256" &&
    "${RECORD_LINES[9]}" == "$H20_SUDOERS_SHA256" &&
    "${RECORD_LINES[10]}" == "$PREDECESSOR_GUARD_SHA256" ]]
}

require_successor_record_output() {
  local output
  local -a RECORD_LINES=()
  output="$(env -i PATH="$SAFE_PATH" HOME='/root' "$INGRESS_GUARD" record)" || return 1
  mapfile -t RECORD_LINES <<<"$output"
  [[ "${#RECORD_LINES[@]}" -eq 11 && "${RECORD_LINES[0]}" == active &&
    "${RECORD_LINES[1]}" == "$H19_RELEASE" && "${RECORD_LINES[2]}" == "$H19_RELEASE" &&
    "${RECORD_LINES[3]}" == "$H20_HELPER_SHA256" &&
    "${RECORD_LINES[8]}" == "$H20_FINALIZER_SHA256" &&
    "${RECORD_LINES[9]}" == "$H20_SUDOERS_SHA256" &&
    "${RECORD_LINES[10]}" == "$SUCCESSOR_GUARD_SHA256" ]]
}

require_staged_bundle || die 'the root-owned staged H21 bundle is not exact'
require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'
require_h20_record_and_artifacts || die 'the terminal H20 provenance or installed artifact chain is invalid'
require_interrupted_transition || die 'the sealed interrupted H19 transition is not exact'
require_protected_boundaries || die 'a protected pre-H21 boundary is not exact'
state="$(namespace_state)" || die 'the H21 namespace is invalid'
guard="$(guard_state)" || die 'the installed guard is neither the H20 predecessor nor H21 successor'
if [[ "$guard" == old ]]; then
  require_predecessor_record_output || die 'the installed H20 guard rejected its provenance chain'
fi
case "$state:$guard" in
  absent:old|empty-parent:old|installing:old|installing:new|completed:new) ;;
  *) die 'the H21 evidence and installed-guard topology is causally invalid' ;;
esac
if [[ "$state" == completed ]]; then
  require_terminal_record || die 'the terminal H21 record is invalid'
fi
[[ "$state" == completed ]] || require_active_deploy_grant || require_disabled_deploy_grant ||
  die 'the staging deployment grant is not in an exact recoverable state'

open_lock || die 'the shared staging mutation lock is unavailable'
require_h20_record_and_artifacts || die 'the H20 chain changed after lock acquisition'
require_interrupted_transition || die 'the interrupted transition changed after lock acquisition'
require_protected_boundaries || die 'a protected boundary changed after lock acquisition'
guard="$(guard_state)" || die 'the installed guard changed after lock acquisition'
if [[ "$guard" == old ]]; then
  require_predecessor_record_output || die 'the H20 provenance changed after lock acquisition'
fi
disable_deploy_grant || die 'the staging deployment capability could not be isolated'

state="$(namespace_state)" || die 'the H21 namespace changed unexpectedly'
if [[ "$state" != completed ]]; then
  if [[ "$state" == absent ]]; then
    install -d -o root -g root -m 0700 "$H21_PARENT" ||
      die 'the H21 evidence parent could not be created'
    sync -f "$(dirname -- "$H21_PARENT")"
    state=empty-parent
  fi
  if [[ "$state" == empty-parent ]]; then
    install -d -o root -g root -m 0700 "$H21_INSTALLING" ||
      die 'the H21 installing root could not be created'
    sync -f "$H21_PARENT"
    state=installing
  fi
  [[ "$state" == installing ]] || die 'the H21 installing namespace is invalid'
  publish_record "$H21_INSTALLING" intent-v1 expected_intent ||
    die 'the H21 intent could not be sealed'
  archive_file "$INGRESS_GUARD" "$H21_INSTALLING/predecessor-ingress-guard" \
    "$PREDECESSOR_GUARD_SHA256" 2097152 755 ||
    die 'the H20 ingress guard could not be archived'
  archive_file "$TRANSITION_INSTALLING/intent-v1" \
    "$H21_INSTALLING/interrupted-transition-intent" "$INTERRUPTED_INTENT_SHA256" 8192 600 ||
    die 'the interrupted transition intent could not be archived'
  install_successor_guard || die 'the H21 successor guard could not be installed atomically'
  publish_record "$H21_INSTALLING" completed-v1 expected_completion ||
    die 'the H21 completion could not be sealed'
  require_exact_directory "$H21_INSTALLING" completed-v1 intent-v1 \
    interrupted-transition-intent predecessor-ingress-guard &&
    require_expected_record "$H21_INSTALLING/intent-v1" 600 expected_intent &&
    require_expected_record "$H21_INSTALLING/completed-v1" 600 expected_completion &&
    require_exact_file "$H21_INSTALLING/predecessor-ingress-guard" \
      "$PREDECESSOR_GUARD_SHA256" 400 &&
    require_exact_file "$H21_INSTALLING/interrupted-transition-intent" \
      "$INTERRUPTED_INTENT_SHA256" 400 8192 ||
    die 'the completed H21 installing record is invalid'
  [[ ! -e "$H21_ROOT" && ! -L "$H21_ROOT" ]] ||
    die 'the terminal H21 root appeared unexpectedly'
  mv -- "$H21_INSTALLING" "$H21_ROOT" || die 'the H21 record could not become terminal'
  sync -f "$H21_PARENT"
fi

require_terminal_record || die 'the terminal H21 record is invalid'
require_exact_file "$INGRESS_GUARD" "$SUCCESSOR_GUARD_SHA256" 755 ||
  die 'the installed H21 successor guard is not exact'
require_h20_record_and_artifacts || die 'the H20 chain changed during H21 installation'
require_interrupted_transition || die 'the interrupted transition was changed during H21 installation'
require_protected_boundaries || die 'a protected boundary changed during H21 installation'
env -i PATH="$SAFE_PATH" HOME='/root' "$INGRESS_GUARD" recovery-inspect ||
  die 'the H21 successor guard rejected the exact recovery state'
require_successor_record_output || die 'the H21 successor record chain is invalid'
restore_deploy_grant || die 'the staging deployment capability could not be restored safely'
require_terminal_record && require_successor_record_output && require_protected_boundaries ||
  die 'the restored H21 transaction is not exact'
flock --unlock 9 || die 'the shared mutation lock could not be released'
exec 9>&-

printf '%s\n' \
  'FetanAgent H21 stable-nine guard correction installed or validated: interrupted transition preserved; production baseline unchanged; database untouched; money moved=false.'
