#!/usr/bin/env bash
# One-use, root-console-only H18 -> H19 promotion. It installs the reviewed
# staging helper, continuous finalizer/sudoers checksum pair, and production
# ingress guard while staging is stopped and production remains byte-for-byte
# at the protected baseline. It does not replace a production container.
set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly CONTINUOUS_FINALIZER='/usr/local/sbin/fetanagent-staging-continuous-availability'
readonly CONTINUOUS_SUDOERS='/etc/sudoers.d/fetanagent-staging-continuous-availability'
readonly INGRESS_GUARD='/usr/local/sbin/fetanagent-production-ingress-h19'
readonly DEPLOY_SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly DEPLOY_SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.h19-disabled'
readonly CONTINUOUS_SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-continuous-availability.h19-disabled'
readonly HELPER_INSTALLING='/usr/local/sbin/.fetanagent-staging-deploy-helper.h19-installing'
readonly FINALIZER_INSTALLING='/usr/local/sbin/.fetanagent-staging-continuous-availability.h19-installing'
readonly GUARD_INSTALLING='/usr/local/sbin/.fetanagent-production-ingress-h19.installing'
readonly SUDOERS_INSTALLING='/etc/sudoers.d/.fetanagent-staging-continuous-availability.h19-installing'
readonly H18_PARENT='/var/lib/fetanagent/shared-telebirr-ingress-helper-bridge-v18'
readonly H19_PARENT='/var/lib/fetanagent/staging-telebirr-route-helper-bridge-v19'
readonly TRANSITION_PARENT='/var/lib/fetanagent/production-gateway-staging-route-v1'
readonly PRODUCTION_ROOT='/srv/fetanagent/production'
readonly PRODUCTION_RELEASE_ROOT="$PRODUCTION_ROOT/releases"
readonly PRODUCTION_CURRENT="$PRODUCTION_ROOT/current"
readonly PRODUCTION_PROJECT='fetanagent-production'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly DEVICE_PILOT_PROJECT='fetanagent-telebirr-device-pilot'
readonly PROFILE_VOLUME='fetanagent-staging-beta_kemerbet_sessions'
readonly SESSION_CONTROL_VOLUME='fetanagent-staging-beta_kemerbet_session_control'
readonly STAGING_DIRECT_DATABASE_HOST='db.spzpiyxheappsfyswewl.supabase.co'
readonly TIMER='fetanagent-staging-runtime-expiry-stop.timer'
readonly SERVICE='fetanagent-staging-runtime-expiry-stop.service'
readonly TIMER_PATH="/etc/systemd/system/$TIMER"
readonly SERVICE_PATH="/etc/systemd/system/$SERVICE"
readonly PROTECTED_RELEASE='69be82ac3e49ff8c63c64c9aa7926e0046b48a10'
readonly SHARED_NETWORK='fetanagent-telebirr-device-ingress'
readonly SHARED_NETWORK_ID='5b3dc890fad4f062ac570e4bbc66f950d002b536843b2630473eb817537af738'
readonly BASELINE_CADDY_SHA256='181992c8958397d63a7ae34137d51d4186ce0383c8cfd2bf8df137da11e12f24'
readonly CANDIDATE_CADDY_SHA256='afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616'
readonly PREDECESSOR_HELPER_SHA256='3adb799d17c3f51e2f6c49957d3a170e63151c30509962acdaf08c105dc65267'
readonly PREDECESSOR_FINALIZER_SHA256='103b40c6ef76cca08e92bb5b475104f775b054b3981c5bb55057a085126745ea'
readonly PREDECESSOR_SUDOERS_SHA256='d33645e4767102a64463d27d90b63685dd71d1352fb175eb64a738a06b21f958'
readonly REVIEWED_SUCCESSOR_HELPER_SHA256='b4a5975f97be388b8862e8d21c207815f02708e6476fa5e79b795825b3a01381'
readonly REVIEWED_SUCCESSOR_FINALIZER_SHA256='a1951a5559ef735e507b762369861fd71fefbde518a415f8c928956f7e20df39'
readonly REVIEWED_SUCCESSOR_SUDOERS_SHA256='5e92a8c42d6b44ae22fa837efc9b35e54033a00a1e830a7bad8de2d3382f3796'
readonly REVIEWED_INGRESS_GUARD_SHA256='13e6f430d1fb6e83736265055bed9569431403411e5d459fd86c1d32b00adced'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="$LOCK_ROOT/mutation.lock"
readonly CANONICAL_H14_RELEASE='06459511d9330a0e1d956c42529b81aa9970e7a2'
readonly SCRIPT_BASENAME='fetanagent-staging-telebirr-route-helper-bridge-v19.sh'
readonly CONFIRMATION='I-UNDERSTAND-THIS-INSTALLS-H19-INGRESS-GUARDS-WITH-NO-PRODUCTION-OR-MONEY-MUTATION'

export PATH="$SAFE_PATH"
umask 077

die() {
  printf 'FetanAgent H19 route-helper bridge failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 7 ]] ||
  die 'expected the H19 release, candidate release, four artifact digests, and exact confirmation'
readonly BRIDGE_RELEASE="$1"
readonly CANDIDATE_RELEASE="$2"
readonly SUCCESSOR_HELPER_SHA256="$3"
readonly SUCCESSOR_FINALIZER_SHA256="$4"
readonly SUCCESSOR_SUDOERS_SHA256="$5"
readonly INGRESS_GUARD_SHA256="$6"
readonly PROVIDED_CONFIRMATION="$7"
readonly STAGING_ROOT="/root/fetanagent-staging-telebirr-route-helper-bridge-v19-$BRIDGE_RELEASE"
readonly STAGED_INSTALLER="$STAGING_ROOT/$SCRIPT_BASENAME"
readonly STAGED_HELPER="$STAGING_ROOT/fetanagent-staging-deploy-helper.next"
readonly STAGED_FINALIZER="$STAGING_ROOT/fetanagent-staging-continuous-availability.next"
readonly STAGED_SUDOERS="$STAGING_ROOT/fetanagent-staging-continuous-availability.sudoers.next"
readonly STAGED_GUARD="$STAGING_ROOT/fetanagent-production-ingress-h19.next"
readonly H19_ROOT="$H19_PARENT/$BRIDGE_RELEASE"
readonly H19_INSTALLING="$H19_PARENT/.installing-$BRIDGE_RELEASE"

[[ "$BRIDGE_RELEASE" =~ ^[0-9a-f]{40}$ && "$CANDIDATE_RELEASE" == "$BRIDGE_RELEASE" &&
  "$BRIDGE_RELEASE" != "$PROTECTED_RELEASE" ]] ||
  die 'H19 requires one distinct full release SHA for both helper provenance and candidate gateway'
[[ "$SUCCESSOR_HELPER_SHA256" == "$REVIEWED_SUCCESSOR_HELPER_SHA256" &&
  "$SUCCESSOR_FINALIZER_SHA256" == "$REVIEWED_SUCCESSOR_FINALIZER_SHA256" &&
  "$SUCCESSOR_SUDOERS_SHA256" == "$REVIEWED_SUCCESSOR_SUDOERS_SHA256" &&
  "$INGRESS_GUARD_SHA256" == "$REVIEWED_INGRESS_GUARD_SHA256" ]] ||
  die 'one or more staged artifacts do not match the reviewed H19 digest chain'
[[ "$SUCCESSOR_HELPER_SHA256" != "$PREDECESSOR_HELPER_SHA256" &&
  "$SUCCESSOR_FINALIZER_SHA256" != "$PREDECESSOR_FINALIZER_SHA256" &&
  "$SUCCESSOR_SUDOERS_SHA256" != "$PREDECESSOR_SUDOERS_SHA256" ]] ||
  die 'the H19 successor chain must be distinct from H18'
[[ "$PROVIDED_CONFIRMATION" == "$CONFIRMATION" ]] ||
  die 'the exact one-use no-money H19 confirmation is required'
[[ "$(id -u)" == '0' && "$(id -un)" == 'root' && -z "${SUDO_USER:-}" ]] ||
  die 'run this installer only in the DigitalOcean root console'
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'Docker environment overrides are forbidden'

for command in awk bash cmp curl dirname docker env find flock getent grep id install ip jq mv \
  openssl python3 readlink realpath rm sha256sum sort ss stat sync systemctl visudo; do
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

expected_deploy_sudoers() {
  printf '%s\n' \
    'fetanagent-admin ALL=(root) NOPASSWD: /usr/local/sbin/fetanagent-staging-deploy-helper *'
}

require_exact_file() {
  local path="$1" digest="$2" mode="$3" maximum="${4:-2097152}"
  env -i PATH="$SAFE_PATH" python3 -I - "$path" "$digest" "$mode" "$maximum" <<'PY'
import hashlib, os, stat, sys
path, digest, mode_text, maximum_text = sys.argv[1:]
mode, maximum = int(mode_text, 8), int(maximum_text)
try:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd); named = os.lstat(path)
        if (not stat.S_ISREG(before.st_mode)
            or (before.st_uid,before.st_gid,stat.S_IMODE(before.st_mode),before.st_nlink)
               != (0,0,mode,1)
            or (before.st_dev,before.st_ino)!=(named.st_dev,named.st_ino)
            or before.st_size <= 0 or before.st_size > maximum
            or os.path.realpath(path) != path): raise RuntimeError()
        data = os.pread(fd, maximum + 1, 0); after = os.fstat(fd); named_after = os.lstat(path)
        if (len(data) != before.st_size
            or (before.st_dev,before.st_ino,before.st_mode,before.st_uid,before.st_gid,
                before.st_nlink,before.st_size,before.st_mtime_ns)
               != (after.st_dev,after.st_ino,after.st_mode,after.st_uid,after.st_gid,
                   after.st_nlink,after.st_size,after.st_mtime_ns)
            or (after.st_dev,after.st_ino)!=(named_after.st_dev,named_after.st_ino)
            or hashlib.sha256(data).hexdigest() != digest): raise RuntimeError()
    finally: os.close(fd)
except Exception: raise SystemExit(1)
PY
}

require_exact_deploy_sudoers() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:440:1' ]] || return 1
  cmp -s -- "$path" <(expected_deploy_sudoers)
}

require_active_deploy_grant() {
  require_exact_deploy_sudoers "$DEPLOY_SUDOERS" &&
    [[ ! -e "$DEPLOY_SUDOERS_DISABLED" && ! -L "$DEPLOY_SUDOERS_DISABLED" ]] &&
    visudo -cf /etc/sudoers >/dev/null
}

require_disabled_deploy_grant() {
  [[ ! -e "$DEPLOY_SUDOERS" && ! -L "$DEPLOY_SUDOERS" ]] &&
    require_exact_deploy_sudoers "$DEPLOY_SUDOERS_DISABLED" &&
    visudo -cf /etc/sudoers >/dev/null
}

disable_deploy_grant() {
  if require_disabled_deploy_grant; then return 0; fi
  require_active_deploy_grant || return 1
  mv -- "$DEPLOY_SUDOERS" "$DEPLOY_SUDOERS_DISABLED" || return 1
  sync -f /etc/sudoers.d || return 1
  require_disabled_deploy_grant
}

restore_deploy_grant() {
  if require_active_deploy_grant; then return 0; fi
  require_disabled_deploy_grant || return 1
  mv -- "$DEPLOY_SUDOERS_DISABLED" "$DEPLOY_SUDOERS" || return 1
  sync -f /etc/sudoers.d || return 1
  require_active_deploy_grant
}

disable_continuous_grant() {
  if [[ ! -e "$CONTINUOUS_SUDOERS" && ! -L "$CONTINUOUS_SUDOERS" ]] &&
    require_exact_file "$CONTINUOUS_SUDOERS_DISABLED" "$PREDECESSOR_SUDOERS_SHA256" 440 65536; then
    visudo -cf /etc/sudoers >/dev/null
    return
  fi
  require_exact_file "$CONTINUOUS_SUDOERS" "$PREDECESSOR_SUDOERS_SHA256" 440 65536 || return 1
  [[ ! -e "$CONTINUOUS_SUDOERS_DISABLED" && ! -L "$CONTINUOUS_SUDOERS_DISABLED" ]] || return 1
  mv -- "$CONTINUOUS_SUDOERS" "$CONTINUOUS_SUDOERS_DISABLED" || return 1
  sync -f /etc/sudoers.d || return 1
  [[ ! -e "$CONTINUOUS_SUDOERS" && ! -L "$CONTINUOUS_SUDOERS" ]] &&
    require_exact_file "$CONTINUOUS_SUDOERS_DISABLED" "$PREDECESSOR_SUDOERS_SHA256" 440 65536 &&
    visudo -cf /etc/sudoers >/dev/null
}

run_helper_direct() {
  env -i PATH="$SAFE_PATH" HOME='/root' SUDO_USER='fetanagent-admin' "$TARGET" "$@"
}

require_predecessor_helper_boundary() {
  require_exact_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 &&
    run_helper_direct verify "$PREDECESSOR_HELPER_SHA256" >/dev/null &&
    run_helper_direct kemerbet-v3-runtime-bridge-ready "$PREDECESSOR_HELPER_SHA256" >/dev/null &&
    run_helper_direct kemerbet-quarantine-recovery-ready "$CANONICAL_H14_RELEASE" >/dev/null &&
    run_helper_direct fresh-host-ready "$BRIDGE_RELEASE" >/dev/null
}

require_staged_bundle() {
  [[ ! -L "$STAGING_ROOT" && -d "$STAGING_ROOT" &&
    "$(realpath -- "$STAGING_ROOT")" == "$STAGING_ROOT" &&
    "$(stat --format='%U:%G:%a' "$STAGING_ROOT")" == 'root:root:700' &&
    "$(find -P "$STAGING_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" == \
      $'fetanagent-production-ingress-h19.next\nfetanagent-staging-continuous-availability.next\nfetanagent-staging-continuous-availability.sudoers.next\nfetanagent-staging-deploy-helper.next\nfetanagent-staging-telebirr-route-helper-bridge-v19.sh' &&
    ! -L "$STAGED_INSTALLER" && -f "$STAGED_INSTALLER" &&
    "$(realpath -- "$0")" == "$STAGED_INSTALLER" &&
    "$(stat --format='%U:%G:%a:%h' "$STAGED_INSTALLER")" == 'root:root:700:1' ]] || return 1
  require_exact_file "$STAGED_HELPER" "$SUCCESSOR_HELPER_SHA256" 600 || return 1
  require_exact_file "$STAGED_FINALIZER" "$SUCCESSOR_FINALIZER_SHA256" 600 || return 1
  require_exact_file "$STAGED_SUDOERS" "$SUCCESSOR_SUDOERS_SHA256" 600 65536 || return 1
  require_exact_file "$STAGED_GUARD" "$INGRESS_GUARD_SHA256" 600 || return 1
  bash -n "$STAGED_HELPER" && bash -n "$STAGED_FINALIZER" && bash -n "$STAGED_GUARD" &&
    visudo -cf "$STAGED_SUDOERS" >/dev/null
}

resolve_h18_record() {
  local output
  output="$(env -i PATH="$SAFE_PATH" python3 -I - "$H18_PARENT" <<'PY'
import hashlib, os, re, stat, sys
parent = sys.argv[1]
release_re = re.compile(r'[0-9a-f]{40}')
sha_re = re.compile(r'[0-9a-f]{64}')
predecessor = '77e4822a0827413290fba94747698536b6af5bca3f2f7cdc58975dce390f7c84'
successor = '3adb799d17c3f51e2f6c49957d3a170e63151c30509962acdaf08c105dc65267'
protected = '69be82ac3e49ff8c63c64c9aa7926e0046b48a10'
network_id = '5b3dc890fad4f062ac570e4bbc66f950d002b536843b2630473eb817537af738'

def exact_file(path, mode, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before=os.fstat(fd); named=os.lstat(path)
        if (not stat.S_ISREG(before.st_mode)
            or (before.st_uid,before.st_gid,stat.S_IMODE(before.st_mode),before.st_nlink)
               != (0,0,mode,1)
            or (before.st_dev,before.st_ino)!=(named.st_dev,named.st_ino)
            or before.st_size <= 0 or before.st_size > maximum
            or os.path.realpath(path)!=path): raise RuntimeError()
        data=os.pread(fd,maximum+1,0); after=os.fstat(fd); named_after=os.lstat(path)
        if (len(data)!=before.st_size
            or (before.st_dev,before.st_ino,before.st_mode,before.st_uid,before.st_gid,
                before.st_nlink,before.st_size,before.st_mtime_ns)
               != (after.st_dev,after.st_ino,after.st_mode,after.st_uid,after.st_gid,
                   after.st_nlink,after.st_size,after.st_mtime_ns)
            or (after.st_dev,after.st_ino)!=(named_after.st_dev,named_after.st_ino)):
            raise RuntimeError()
        return data
    finally: os.close(fd)

def exact_dir(path, entries):
    value=os.lstat(path)
    if (not stat.S_ISDIR(value.st_mode)
        or (value.st_uid,value.st_gid,stat.S_IMODE(value.st_mode))!=(0,0,0o700)
        or os.path.realpath(path)!=path or sorted(os.listdir(path))!=entries):
        raise RuntimeError()

try:
    children=os.listdir(parent)
    if len(children)!=1 or release_re.fullmatch(children[0]) is None: raise RuntimeError()
    release=children[0]; root=f'{parent}/{release}'
    exact_dir(parent,[release]); exact_dir(root,['completed-v1','intent-v1','predecessor-helper'])
    intent_data=exact_file(f'{root}/intent-v1',0o600,4096)
    completion_data=exact_file(f'{root}/completed-v1',0o600,4096)
    archived=exact_file(f'{root}/predecessor-helper',0o400,2*1024*1024)
    intent=intent_data.decode('ascii').splitlines(); completion=completion_data.decode('ascii').splitlines()
    h17=intent[3].split('=',1)[1] if len(intent)>3 else ''
    h17_intent=intent[6].split('=',1)[1] if len(intent)>6 else ''
    h17_completion=intent[7].split('=',1)[1] if len(intent)>7 else ''
    stopped=intent[8].split('=',1)[1] if len(intent)>8 else ''
    production=intent[9].split('=',1)[1] if len(intent)>9 else ''
    ingress=intent[10].split('=',1)[1] if len(intent)>10 else ''
    if (len(intent)!=23 or len(completion)!=24
        or intent[0]!='contract=fetanagent-shared-telebirr-ingress-helper-bridge-v18'
        or intent[1]!='state=authorized' or intent[2]!=f'bridge_release={release}'
        or not intent[3].startswith('h17_bridge_release=') or release_re.fullmatch(h17) is None
        or intent[4]!=f'predecessor_helper_sha256={predecessor}'
        or intent[5]!=f'successor_helper_sha256={successor}'
        or not intent[6].startswith('h17_bridge_intent_sha256=') or sha_re.fullmatch(h17_intent) is None
        or not intent[7].startswith('h17_bridge_completion_sha256=') or sha_re.fullmatch(h17_completion) is None
        or not intent[8].startswith('stopped_boundary_sha256=') or sha_re.fullmatch(stopped) is None
        or not intent[9].startswith('production_boundary_sha256=') or sha_re.fullmatch(production) is None
        or not intent[10].startswith('shared_ingress_boundary_sha256=') or sha_re.fullmatch(ingress) is None
        or intent[11:]!=[
          'staging_runtime_stopped=true',
          'shared_ingress_network=fetanagent-telebirr-device-ingress',
          f'shared_ingress_network_id={network_id}', 'shared_ingress_contract=exact',
          f'production_release={protected}', 'production_endpoint_set=exact',
          'production_runtime_mutation=false','database_mutation=false',
          'financial_actions_mode=disabled','transfer_enabled=false','amount_enabled=false',
          'money_moved=false']
        or completion[0]!=intent[0] or completion[1]!='state=shared-ingress-helper-installed'
        or completion[2:23]!=intent[2:23]
        or completion[23]!=f'bridge_intent_sha256={hashlib.sha256(intent_data).hexdigest()}'
        or intent_data!=('\n'.join(intent)+'\n').encode('ascii')
        or completion_data!=('\n'.join(completion)+'\n').encode('ascii')
        or hashlib.sha256(archived).hexdigest()!=predecessor): raise RuntimeError()
    print(release); print(hashlib.sha256(intent_data).hexdigest())
    print(hashlib.sha256(completion_data).hexdigest()); print(stopped)
except Exception: raise SystemExit(1)
PY
)" || return 1
  mapfile -t H18_RECORD <<<"$output"
  [[ "${#H18_RECORD[@]}" -eq 4 && "${H18_RECORD[0]}" =~ ^[0-9a-f]{40}$ &&
    "${H18_RECORD[0]}" != "$BRIDGE_RELEASE" && "${H18_RECORD[0]}" != "$PROTECTED_RELEASE" &&
    "${H18_RECORD[1]}" =~ ^[0-9a-f]{64}$ && "${H18_RECORD[2]}" =~ ^[0-9a-f]{64}$ &&
    "${H18_RECORD[3]}" =~ ^[0-9a-f]{64}$ ]]
}

production_inspection() {
  local inventory
  inventory="$(docker_local container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PRODUCTION_PROJECT" | LC_ALL=C sort)" || return 1
  mapfile -t PRODUCTION_IDS <<<"$inventory"
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

shared_ingress_boundary_digest() {
  docker_local network inspect "$SHARED_NETWORK_ID" | jq -S -c '.[0]' |
    sha256sum | awk '{print $1}'
}

tls_leaf_digest() {
  local digest
  digest="$(printf '' | openssl s_client -connect device.fetanagent.com:443 \
    -servername device.fetanagent.com 2>/dev/null | openssl x509 -outform DER 2>/dev/null |
    sha256sum | awk '{print $1}')" || return 1
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$digest"
}

require_no_staging_runtime() {
  local project inventory
  for project in "$PROJECT_NAME" "$DEVICE_PILOT_PROJECT"; do
    inventory="$(docker_local container ls --all --quiet --no-trunc \
      --filter "label=com.docker.compose.project=$project")" || return 1
    [[ -z "$inventory" ]] || return 1
  done
}

expiry_guard_snapshot() {
  local path service_load timer_load
  timer_load="$(systemctl show --property=LoadState --value "$TIMER")" || return 1
  service_load="$(systemctl show --property=LoadState --value "$SERVICE")" || return 1
  case "$timer_load:$service_load" in
    loaded:loaded)
      for path in "$TIMER_PATH" "$SERVICE_PATH"; do
        [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
          "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:644:1' ]] || return 1
      done
      [[ "$(systemctl show --property=FragmentPath --value "$TIMER")" == "$TIMER_PATH" &&
        "$(systemctl show --property=ActiveState --value "$TIMER")" == inactive &&
        "$(systemctl show --property=UnitFileState --value "$TIMER")" == disabled &&
        -z "$(systemctl show --property=NextElapseUSecRealtime --value "$TIMER")" &&
        -z "$(systemctl show --property=DropInPaths --value "$TIMER")" &&
        "$(systemctl show --property=FragmentPath --value "$SERVICE")" == "$SERVICE_PATH" &&
        "$(systemctl show --property=ActiveState --value "$SERVICE")" == inactive &&
        -z "$(systemctl show --property=DropInPaths --value "$SERVICE")" ]] || return 1
      ;;
    not-found:not-found)
      [[ ! -e "$TIMER_PATH" && ! -L "$TIMER_PATH" &&
        ! -e "$SERVICE_PATH" && ! -L "$SERVICE_PATH" &&
        "$(systemctl show --property=ActiveState --value "$TIMER")" == inactive &&
        -z "$(systemctl show --property=UnitFileState --value "$TIMER")" &&
        -z "$(systemctl show --property=FragmentPath --value "$TIMER")" &&
        -z "$(systemctl show --property=NextElapseUSecRealtime --value "$TIMER")" &&
        -z "$(systemctl show --property=DropInPaths --value "$TIMER")" &&
        "$(systemctl show --property=ActiveState --value "$SERVICE")" == inactive &&
        -z "$(systemctl show --property=UnitFileState --value "$SERVICE")" &&
        -z "$(systemctl show --property=FragmentPath --value "$SERVICE")" &&
        -z "$(systemctl show --property=DropInPaths --value "$SERVICE")" ]] || return 1
      ;;
    *) return 1 ;;
  esac
  systemctl show --property=LoadState,ActiveState,UnitFileState,\
NextElapseUSecRealtime,DropInPaths "$TIMER" "$SERVICE" | LC_ALL=C sort
}

stopped_staging_boundary_digest() {
  local addresses database_addresses holders mountpoint mountpoint_stat namespace_networks
  local network_inventory port_inventory project_networks routes systemd_snapshot volume volumes
  local volume_inspection volume_snapshot snapshot=''
  require_no_staging_runtime || return 1
  project_networks="$(docker_local network ls --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" | LC_ALL=C sort)" || return 1
  [[ "$project_networks" == "$SHARED_NETWORK_ID" ]] || return 1
  namespace_networks="$(docker_local network ls --quiet --no-trunc \
    --filter "name=^${PROJECT_NAME}_" | LC_ALL=C sort)" || return 1
  [[ -z "$namespace_networks" ]] || return 1
  volumes="$(docker_local volume ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" | LC_ALL=C sort)" || return 1
  [[ "$volumes" == $'fetanagent-staging-beta_kemerbet_session_control\nfetanagent-staging-beta_kemerbet_sessions' ]] ||
    return 1
  volume_inspection="$(docker_local volume inspect "$PROFILE_VOLUME" "$SESSION_CONTROL_VOLUME")" ||
    return 1
  volume_snapshot="$(jq -S -c 'sort_by(.Name) | map({Name,Driver,Scope,Options,Labels,Mountpoint})' \
    <<<"$volume_inspection")" || return 1
  [[ -n "$volume_snapshot" ]] || return 1
  snapshot+="staging_containers=none"$'\n'
  snapshot+="staging_project_network=$project_networks"$'\n'
  snapshot+="staging_namespace_networks=none"$'\n'
  snapshot+="$volume_snapshot"$'\n'
  for volume in "$PROFILE_VOLUME" "$SESSION_CONTROL_VOLUME"; do
    holders="$(docker_local container ls --all --quiet --no-trunc --filter "volume=$volume")" || return 1
    [[ -z "$holders" ]] || return 1
    mountpoint="$(docker_local volume inspect "$volume" --format '{{.Mountpoint}}')" || return 1
    [[ ! -L "$mountpoint" && -d "$mountpoint" && "$(realpath -- "$mountpoint")" == "$mountpoint" &&
      "$(stat --format='%u:%g:%a' "$mountpoint")" == '10001:10001:700' ]] || return 1
    if [[ "$volume" == "$SESSION_CONTROL_VOLUME" ]]; then
      [[ "$(stat --format='%h' "$mountpoint")" == 2 ]] || return 1
    fi
    mountpoint_stat="$(stat --format='%d:%i:%u:%g:%a:%h' "$mountpoint")" || return 1
    snapshot+="$volume|$mountpoint_stat"$'\n'
  done
  systemd_snapshot="$(expiry_guard_snapshot)" || return 1
  addresses="$(ip -6 -o address show scope global | LC_ALL=C sort -u)" || return 1
  routes="$(ip -6 route show default | LC_ALL=C sort -u)" || return 1
  database_addresses="$(getent ahostsv6 "$STAGING_DIRECT_DATABASE_HOST" | LC_ALL=C sort -u)" || return 1
  port_inventory="$(ss -ltnH | awk '$4 ~ /:3002$/ { print }' | LC_ALL=C sort)" || return 1
  network_inventory="$(docker_local network inspect "$SHARED_NETWORK_ID" | jq -S -c '.[0]')" ||
    return 1
  [[ -n "$addresses" && -n "$routes" && -n "$database_addresses" && -z "$port_inventory" &&
    -n "$network_inventory" ]] || return 1
  snapshot+="$systemd_snapshot"$'\n'
  snapshot+="$addresses"$'\n'
  snapshot+="$routes"$'\n'
  snapshot+="$database_addresses"$'\n'
  snapshot+="port_3002=free"$'\n'
  snapshot+="$network_inventory"$'\n'
  printf '%s' "$snapshot" | sha256sum | awk '{print $1}'
}

require_protected_gateway_and_bridge() {
  production_inspection | jq -e --arg release "$PROTECTED_RELEASE" '
    [.[] | select(.Config.Labels["com.docker.compose.service"] == "gateway" or
      .Config.Labels["com.docker.compose.service"] == "telebirr-device-bridge")] as $edge |
    ($edge | length) == 2 and all($edge[];
      .Config.Labels["org.opencontainers.image.revision"] == $release and
      .State.Running == true and .State.Health.Status == "healthy" and .RestartCount == 0) and
    all(.[] | select(.Config.Labels["com.docker.compose.service"] != "gateway");
      .Config.Labels["org.opencontainers.image.revision"] == $release and
      ([.Config.Env[] | select(startswith("FINANCIAL_ACTIONS_MODE="))] ==
        ["FINANCIAL_ACTIONS_MODE=dry_run"]) and
      ([.Config.Env[] | select(startswith("KEMERBET_EXECUTOR_ENABLED="))] ==
        ["KEMERBET_EXECUTOR_ENABLED=false"]) and
      ([.Config.Env[] | select(startswith("KEMERBET_FINAL_ACTION_ENABLED="))] ==
        ["KEMERBET_FINAL_ACTION_ENABLED=false"]))' >/dev/null
}

require_transition_namespace_absent() {
  [[ ! -e "$TRANSITION_PARENT" && ! -L "$TRANSITION_PARENT" ]]
}

require_preserved_boundaries() {
  require_no_staging_runtime && require_protected_gateway_and_bridge &&
    require_transition_namespace_absent &&
    [[ "$(stopped_staging_boundary_digest)" == "$BASELINE_STOPPED_STAGING_BOUNDARY_SHA256" &&
      "$(gateway_caddy_sha256)" == "$BASELINE_CADDY_SHA256" &&
      "$(production_boundary_digest)" == "$BASELINE_PRODUCTION_BOUNDARY_SHA256" &&
      "$(shared_ingress_boundary_digest)" == "$BASELINE_SHARED_INGRESS_BOUNDARY_SHA256" &&
      "$(tls_leaf_digest)" == "$BASELINE_TLS_LEAF_SHA256" ]]
}

open_lock() {
  local identity
  [[ ! -L "$LOCK_ROOT" && -d "$LOCK_ROOT" && "$(realpath -- "$LOCK_ROOT")" == "$LOCK_ROOT" &&
    "$(stat --format='%U:%G:%a' "$LOCK_ROOT")" == 'root:root:700' &&
    ! -L "$LOCK" && -f "$LOCK" && "$(realpath -- "$LOCK")" == "$LOCK" &&
    "$(stat --format='%U:%G:%a:%h' "$LOCK")" == 'root:root:600:1' ]] || return 1
  exec 9<>"$LOCK" || return 1
  identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")" || return 1
  [[ "$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)" == "$identity" ]] || return 1
  flock --exclusive --nonblock 9 || return 1
  [[ "$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")" == "$identity" ]]
}

close_lock() {
  flock --unlock 9 && exec 9>&-
}

require_no_other_mutators() {
  local argument basename cmdline pid
  for cmdline in /proc/[0-9]*/cmdline; do
    [[ -r "$cmdline" ]] || continue
    pid="${cmdline#/proc/}"; pid="${pid%/cmdline}"
    [[ "$pid" == "$$" ]] && continue
    while IFS= read -r -d '' argument; do
      basename="${argument##*/}"
      case "$argument" in
        "$TARGET"|"$CONTINUOUS_FINALIZER"|"$INGRESS_GUARD"|"$STAGED_INSTALLER") return 1 ;;
      esac
      [[ "$basename" == "$SCRIPT_BASENAME" ]] && return 1
    done <"$cmdline" || true
  done
}

expected_intent() {
  printf '%s\n' \
    'contract=fetanagent-staging-telebirr-route-helper-bridge-v19' \
    'state=authorized' \
    "bridge_release=$BRIDGE_RELEASE" \
    "candidate_gateway_release=$CANDIDATE_RELEASE" \
    "h18_bridge_release=${H18_RECORD[0]}" \
    "predecessor_helper_sha256=$PREDECESSOR_HELPER_SHA256" \
    "successor_helper_sha256=$SUCCESSOR_HELPER_SHA256" \
    "predecessor_continuous_finalizer_sha256=$PREDECESSOR_FINALIZER_SHA256" \
    "successor_continuous_finalizer_sha256=$SUCCESSOR_FINALIZER_SHA256" \
    "predecessor_continuous_sudoers_sha256=$PREDECESSOR_SUDOERS_SHA256" \
    "successor_continuous_sudoers_sha256=$SUCCESSOR_SUDOERS_SHA256" \
    "ingress_guard_sha256=$INGRESS_GUARD_SHA256" \
    "h18_bridge_intent_sha256=${H18_RECORD[1]}" \
    "h18_bridge_completion_sha256=${H18_RECORD[2]}" \
    "stopped_staging_boundary_sha256=$BASELINE_STOPPED_STAGING_BOUNDARY_SHA256" \
    "baseline_production_boundary_sha256=$BASELINE_PRODUCTION_BOUNDARY_SHA256" \
    "baseline_shared_ingress_boundary_sha256=$BASELINE_SHARED_INGRESS_BOUNDARY_SHA256" \
    "baseline_tls_leaf_sha256=$BASELINE_TLS_LEAF_SHA256" \
    "baseline_gateway_caddyfile_sha256=$BASELINE_CADDY_SHA256" \
    "candidate_gateway_caddyfile_sha256=$CANDIDATE_CADDY_SHA256" \
    'staging_runtime_stopped=true' \
    "shared_ingress_network=$SHARED_NETWORK" \
    "shared_ingress_network_id=$SHARED_NETWORK_ID" \
    "protected_production_release=$PROTECTED_RELEASE" \
    'accepted_production_ingress_states=baseline-or-reviewed-gateway-only' \
    'continuous_pair_rotated=true' \
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
  expected_intent | awk 'NR == 2 { print "state=route-helper-pair-installed"; next } { print }'
  printf 'bridge_intent_sha256=%s\n' "$intent_sha"
}

publish_record_atomically() {
  local root="$1" name="$2" producer="$3"
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$root/.$name.installing" "$root/$name" 3< <("$producer") <<'PY'
import os, stat, sys
temporary, target = sys.argv[1:]
expected=bytearray()
while len(expected)<=4096:
    chunk=os.read(3,4097-len(expected))
    if not chunk: break
    expected.extend(chunk)
expected=bytes(expected)
if not expected or len(expected)>4096 or not expected.endswith(b'\n'): raise SystemExit(1)
def open_exact(path, prefix):
    fd=os.open(path,os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        value=os.fstat(fd); named=os.lstat(path)
        if (not stat.S_ISREG(value.st_mode)
            or (value.st_uid,value.st_gid,stat.S_IMODE(value.st_mode),value.st_nlink)!=(0,0,0o600,1)
            or (value.st_dev,value.st_ino)!=(named.st_dev,named.st_ino)
            or os.path.realpath(path)!=path or value.st_size>len(expected)): raise RuntimeError()
        existing=os.read(fd,len(expected)+1)
        if (prefix and not expected.startswith(existing)) or (not prefix and existing!=expected):
            raise RuntimeError()
        return fd,existing
    except Exception:
        os.close(fd); raise
if os.path.lexists(target):
    if os.path.lexists(temporary): raise SystemExit(1)
    fd,_=open_exact(target,False); os.close(fd); raise SystemExit(0)
if os.path.lexists(temporary): fd,existing=open_exact(temporary,True)
else:
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
    os.fchmod(fd,0o600); existing=b''
try:
    os.lseek(fd,len(existing),os.SEEK_SET); remaining=expected[len(existing):]
    while remaining:
        count=os.write(fd,remaining)
        if count<=0: raise RuntimeError()
        remaining=remaining[count:]
    os.fsync(fd)
finally: os.close(fd)
os.rename(temporary,target)
directory=os.open(os.path.dirname(target),os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
try: os.fsync(directory)
finally: os.close(directory)
PY
}

reconcile_copy() {
  local source="$1" source_mode="$2" target="$3" target_mode="$4" digest="$5"
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$source" "$source_mode" "$target" "$target_mode" "$digest" <<'PY'
import hashlib, os, stat, sys
source, source_mode_text, target, target_mode_text, digest=sys.argv[1:]
source_mode,target_mode=int(source_mode_text,8),int(target_mode_text,8)
maximum=2*1024*1024 if target_mode!=0o400 or 'sudoers' not in target else 65536
temporary=f'{os.path.dirname(target)}/.{os.path.basename(target)}.installing'
def read(path,mode,allow_empty=False,writable=False):
    flags=(os.O_RDWR if writable else os.O_RDONLY)|os.O_NOFOLLOW|os.O_CLOEXEC
    fd=os.open(path,flags)
    try:
        before=os.fstat(fd); named=os.lstat(path)
        if (not stat.S_ISREG(before.st_mode)
            or (before.st_uid,before.st_gid,stat.S_IMODE(before.st_mode),before.st_nlink)!=(0,0,mode,1)
            or (before.st_dev,before.st_ino)!=(named.st_dev,named.st_ino)
            or (not allow_empty and before.st_size<=0) or before.st_size>maximum
            or os.path.realpath(path)!=path): raise RuntimeError()
        data=os.pread(fd,maximum+1,0); after=os.fstat(fd); named_after=os.lstat(path)
        if (len(data)!=before.st_size
            or (before.st_dev,before.st_ino,before.st_mode,before.st_uid,before.st_gid,
                before.st_nlink,before.st_size,before.st_mtime_ns)
               != (after.st_dev,after.st_ino,after.st_mode,after.st_uid,after.st_gid,
                   after.st_nlink,after.st_size,after.st_mtime_ns)
            or (after.st_dev,after.st_ino)!=(named_after.st_dev,named_after.st_ino)):
            raise RuntimeError()
        return fd,data
    except Exception:
        os.close(fd); raise
try:
    if os.path.lexists(target):
        if os.path.lexists(temporary): raise RuntimeError()
        fd,data=read(target,target_mode); os.close(fd)
        if hashlib.sha256(data).hexdigest()!=digest: raise RuntimeError()
        raise SystemExit(0)
    source_fd,expected=read(source,source_mode); os.close(source_fd)
    if hashlib.sha256(expected).hexdigest()!=digest: raise RuntimeError()
    if os.path.lexists(temporary):
        fd,existing=read(temporary,target_mode,True,True)
        if existing!=expected[:len(existing)]: raise RuntimeError()
    else:
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,target_mode)
        os.fchmod(fd,target_mode); existing=b''
    try:
        offset=len(existing)
        while offset<len(expected):
            count=os.pwrite(fd,expected[offset:],offset)
            if count<=0: raise RuntimeError()
            offset+=count
        os.fsync(fd)
    finally: os.close(fd)
    os.rename(temporary,target)
    directory=os.open(os.path.dirname(target),os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try: os.fsync(directory)
    finally: os.close(directory)
except SystemExit: raise
except Exception: raise SystemExit(1)
PY
}

reconcile_replace() {
  local source="$1" source_mode="$2" target="$3" target_mode="$4"
  local old_digest="$5" new_digest="$6" temporary="$7"
  env -i PATH="$SAFE_PATH" python3 -I - "$source" "$source_mode" "$target" "$target_mode" \
    "$old_digest" "$new_digest" "$temporary" <<'PY'
import hashlib, os, stat, sys
source,source_mode_text,target,target_mode_text,old_digest,new_digest,temporary=sys.argv[1:]
source_mode,target_mode=int(source_mode_text,8),int(target_mode_text,8)
maximum=65536 if 'sudoers' in target else 2*1024*1024
def read(path,mode,allow_empty=False,writable=False):
    flags=(os.O_RDWR if writable else os.O_RDONLY)|os.O_NOFOLLOW|os.O_CLOEXEC
    fd=os.open(path,flags)
    try:
        before=os.fstat(fd); named=os.lstat(path)
        if (not stat.S_ISREG(before.st_mode)
            or (before.st_uid,before.st_gid,stat.S_IMODE(before.st_mode),before.st_nlink)!=(0,0,mode,1)
            or (before.st_dev,before.st_ino)!=(named.st_dev,named.st_ino)
            or (not allow_empty and before.st_size<=0) or before.st_size>maximum
            or os.path.realpath(path)!=path): raise RuntimeError()
        data=os.pread(fd,maximum+1,0); after=os.fstat(fd); named_after=os.lstat(path)
        if (len(data)!=before.st_size
            or (before.st_dev,before.st_ino,before.st_mode,before.st_uid,before.st_gid,
                before.st_nlink,before.st_size,before.st_mtime_ns)
               != (after.st_dev,after.st_ino,after.st_mode,after.st_uid,after.st_gid,
                   after.st_nlink,after.st_size,after.st_mtime_ns)
            or (after.st_dev,after.st_ino)!=(named_after.st_dev,named_after.st_ino)):
            raise RuntimeError()
        return fd,data
    except Exception:
        os.close(fd); raise
def digest_at(path,mode):
    fd,data=read(path,mode); os.close(fd); return hashlib.sha256(data).hexdigest()
try:
    source_fd,expected=read(source,source_mode); os.close(source_fd)
    if hashlib.sha256(expected).hexdigest()!=new_digest: raise RuntimeError()
    if os.path.lexists(target) and digest_at(target,target_mode)==new_digest:
        if os.path.lexists(temporary): raise RuntimeError()
        raise SystemExit(0)
    if old_digest=='absent':
        if os.path.lexists(target): raise RuntimeError()
    elif not os.path.lexists(target) or digest_at(target,target_mode)!=old_digest:
        raise RuntimeError()
    if os.path.lexists(temporary):
        fd,existing=read(temporary,target_mode,True,True)
        if existing!=expected[:len(existing)]: raise RuntimeError()
    else:
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,target_mode)
        os.fchmod(fd,target_mode); existing=b''
    try:
        offset=len(existing)
        while offset<len(expected):
            count=os.pwrite(fd,expected[offset:],offset)
            if count<=0: raise RuntimeError()
            offset+=count
        os.fsync(fd)
    finally: os.close(fd)
    if old_digest=='absent':
        if os.path.lexists(target): raise RuntimeError()
    elif digest_at(target,target_mode)!=old_digest: raise RuntimeError()
    os.replace(temporary,target)
    directory=os.open(os.path.dirname(target),os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try: os.fsync(directory)
    finally: os.close(directory)
except SystemExit: raise
except Exception: raise SystemExit(1)
PY
}

require_exact_record_payload() {
  local path="$1" producer="$2"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:600:1' ]] &&
    cmp -s -- "$path" <("$producer")
}

require_record_prefix() {
  local path="$1" producer="$2"
  env -i PATH="$SAFE_PATH" python3 -I - "$path" 3< <("$producer") <<'PY'
import os, stat, sys
path=sys.argv[1]; expected=bytearray()
while len(expected)<=4096:
    chunk=os.read(3,4097-len(expected))
    if not chunk: break
    expected.extend(chunk)
expected=bytes(expected)
if not expected or len(expected)>4096 or not expected.endswith(b'\n'): raise SystemExit(1)
try:
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        before=os.fstat(fd); named=os.lstat(path)
        if (not stat.S_ISREG(before.st_mode)
            or (before.st_uid,before.st_gid,stat.S_IMODE(before.st_mode),before.st_nlink)!=(0,0,0o600,1)
            or (before.st_dev,before.st_ino)!=(named.st_dev,named.st_ino)
            or before.st_size>len(expected) or os.path.realpath(path)!=path): raise RuntimeError()
        data=os.pread(fd,len(expected)+1,0); after=os.fstat(fd); named_after=os.lstat(path)
        if (data!=expected[:len(data)] or len(data)!=before.st_size
            or (before.st_dev,before.st_ino,before.st_mode,before.st_uid,before.st_gid,
                before.st_nlink,before.st_size,before.st_mtime_ns)
               != (after.st_dev,after.st_ino,after.st_mode,after.st_uid,after.st_gid,
                   after.st_nlink,after.st_size,after.st_mtime_ns)
            or (after.st_dev,after.st_ino)!=(named_after.st_dev,named_after.st_ino)):
            raise RuntimeError()
    finally: os.close(fd)
except Exception: raise SystemExit(1)
PY
}

require_copy_prefix() {
  local source="$1" source_mode="$2" target="$3" target_mode="$4" digest="$5"
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$source" "$source_mode" "$target" "$target_mode" "$digest" <<'PY'
import hashlib, os, stat, sys
source,source_mode_text,target,target_mode_text,digest=sys.argv[1:]
source_mode,target_mode=int(source_mode_text,8),int(target_mode_text,8)
maximum=65536 if 'sudoers' in target else 2*1024*1024
def read(path,mode,allow_empty=False):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        before=os.fstat(fd); named=os.lstat(path)
        if (not stat.S_ISREG(before.st_mode)
            or (before.st_uid,before.st_gid,stat.S_IMODE(before.st_mode),before.st_nlink)!=(0,0,mode,1)
            or (before.st_dev,before.st_ino)!=(named.st_dev,named.st_ino)
            or (not allow_empty and before.st_size<=0) or before.st_size>maximum
            or os.path.realpath(path)!=path): raise RuntimeError()
        data=os.pread(fd,maximum+1,0); after=os.fstat(fd); named_after=os.lstat(path)
        if (len(data)!=before.st_size
            or (before.st_dev,before.st_ino,before.st_mode,before.st_uid,before.st_gid,
                before.st_nlink,before.st_size,before.st_mtime_ns)
               != (after.st_dev,after.st_ino,after.st_mode,after.st_uid,after.st_gid,
                   after.st_nlink,after.st_size,after.st_mtime_ns)
            or (after.st_dev,after.st_ino)!=(named_after.st_dev,named_after.st_ino)):
            raise RuntimeError()
        return data
    finally: os.close(fd)
try:
    expected=read(source,source_mode); existing=read(target,target_mode,True)
    if hashlib.sha256(expected).hexdigest()!=digest or existing!=expected[:len(existing)]:
        raise RuntimeError()
except Exception: raise SystemExit(1)
PY
}

require_installing_record() {
  local entries
  [[ ! -L "$H19_INSTALLING" && -d "$H19_INSTALLING" &&
    "$(realpath -- "$H19_INSTALLING")" == "$H19_INSTALLING" &&
    "$(stat --format='%U:%G:%a' "$H19_INSTALLING")" == 'root:root:700' ]] || return 1
  entries="$(find -P "$H19_INSTALLING" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' |
    LC_ALL=C sort)" || return 1
  case "$entries" in
    '') ;;
    '.intent-v1.installing:f')
      require_record_prefix "$H19_INSTALLING/.intent-v1.installing" expected_intent ;;
    'intent-v1:f')
      require_exact_record_payload "$H19_INSTALLING/intent-v1" expected_intent ;;
    $'.predecessor-helper.installing:f\nintent-v1:f')
      require_exact_record_payload "$H19_INSTALLING/intent-v1" expected_intent &&
        require_copy_prefix "$TARGET" 755 "$H19_INSTALLING/.predecessor-helper.installing" 400 \
          "$PREDECESSOR_HELPER_SHA256" ;;
    $'intent-v1:f\npredecessor-helper:f')
      require_exact_record_payload "$H19_INSTALLING/intent-v1" expected_intent &&
        require_exact_file "$H19_INSTALLING/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400 ;;
    $'.predecessor-continuous-finalizer.installing:f\nintent-v1:f\npredecessor-helper:f')
      require_exact_record_payload "$H19_INSTALLING/intent-v1" expected_intent &&
        require_exact_file "$H19_INSTALLING/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400 &&
        require_copy_prefix "$CONTINUOUS_FINALIZER" 755 \
          "$H19_INSTALLING/.predecessor-continuous-finalizer.installing" 400 \
          "$PREDECESSOR_FINALIZER_SHA256" ;;
    $'intent-v1:f\npredecessor-continuous-finalizer:f\npredecessor-helper:f')
      require_exact_record_payload "$H19_INSTALLING/intent-v1" expected_intent &&
        require_exact_file "$H19_INSTALLING/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400 &&
        require_exact_file "$H19_INSTALLING/predecessor-continuous-finalizer" \
          "$PREDECESSOR_FINALIZER_SHA256" 400 ;;
    $'.predecessor-continuous-sudoers.installing:f\nintent-v1:f\npredecessor-continuous-finalizer:f\npredecessor-helper:f')
      require_exact_record_payload "$H19_INSTALLING/intent-v1" expected_intent &&
        require_exact_file "$H19_INSTALLING/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400 &&
        require_exact_file "$H19_INSTALLING/predecessor-continuous-finalizer" \
          "$PREDECESSOR_FINALIZER_SHA256" 400 &&
        require_copy_prefix "$CONTINUOUS_SUDOERS_DISABLED" 440 \
          "$H19_INSTALLING/.predecessor-continuous-sudoers.installing" 400 \
          "$PREDECESSOR_SUDOERS_SHA256" ;;
    $'intent-v1:f\npredecessor-continuous-finalizer:f\npredecessor-continuous-sudoers:f\npredecessor-helper:f')
      require_exact_record_payload "$H19_INSTALLING/intent-v1" expected_intent &&
        require_exact_file "$H19_INSTALLING/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400 &&
        require_exact_file "$H19_INSTALLING/predecessor-continuous-finalizer" \
          "$PREDECESSOR_FINALIZER_SHA256" 400 &&
        require_exact_file "$H19_INSTALLING/predecessor-continuous-sudoers" \
          "$PREDECESSOR_SUDOERS_SHA256" 400 65536 ;;
    $'.completed-v1.installing:f\nintent-v1:f\npredecessor-continuous-finalizer:f\npredecessor-continuous-sudoers:f\npredecessor-helper:f')
      require_exact_record_payload "$H19_INSTALLING/intent-v1" expected_intent &&
        require_exact_file "$H19_INSTALLING/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400 &&
        require_exact_file "$H19_INSTALLING/predecessor-continuous-finalizer" \
          "$PREDECESSOR_FINALIZER_SHA256" 400 &&
        require_exact_file "$H19_INSTALLING/predecessor-continuous-sudoers" \
          "$PREDECESSOR_SUDOERS_SHA256" 400 65536 &&
        require_record_prefix "$H19_INSTALLING/.completed-v1.installing" expected_completion ;;
    $'completed-v1:f\nintent-v1:f\npredecessor-continuous-finalizer:f\npredecessor-continuous-sudoers:f\npredecessor-helper:f')
      require_exact_record_payload "$H19_INSTALLING/intent-v1" expected_intent &&
        require_exact_record_payload "$H19_INSTALLING/completed-v1" expected_completion &&
        require_exact_file "$H19_INSTALLING/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400 &&
        require_exact_file "$H19_INSTALLING/predecessor-continuous-finalizer" \
          "$PREDECESSOR_FINALIZER_SHA256" 400 &&
        require_exact_file "$H19_INSTALLING/predecessor-continuous-sudoers" \
          "$PREDECESSOR_SUDOERS_SHA256" 400 65536 ;;
    *) return 1 ;;
  esac
}

require_exact_record() {
  local root="$1"
  [[ ! -L "$root" && -d "$root" && "$(realpath -- "$root")" == "$root" &&
    "$(stat --format='%U:%G:%a' "$root")" == 'root:root:700' &&
    "$(find -P "$root" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" == \
      $'completed-v1\nintent-v1\npredecessor-continuous-finalizer\npredecessor-continuous-sudoers\npredecessor-helper' ]] || return 1
  require_exact_record_payload "$root/intent-v1" expected_intent &&
    require_exact_record_payload "$root/completed-v1" expected_completion &&
    require_exact_file "$root/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400 &&
    require_exact_file "$root/predecessor-continuous-finalizer" "$PREDECESSOR_FINALIZER_SHA256" 400 &&
    require_exact_file "$root/predecessor-continuous-sudoers" "$PREDECESSOR_SUDOERS_SHA256" 400 65536
}

classify_namespace() {
  if [[ ! -e "$H19_PARENT" && ! -L "$H19_PARENT" ]]; then printf '%s' absent; return; fi
  [[ ! -L "$H19_PARENT" && -d "$H19_PARENT" && "$(realpath -- "$H19_PARENT")" == "$H19_PARENT" &&
    "$(stat --format='%U:%G:%a' "$H19_PARENT")" == 'root:root:700' ]] || return 1
  local entries
  entries="$(find -P "$H19_PARENT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | LC_ALL=C sort)" || return 1
  case "$entries" in
    '') printf '%s' empty-parent ;;
    ".installing-$BRIDGE_RELEASE:d") require_installing_record && printf '%s' interrupted ;;
    "$BRIDGE_RELEASE:d") require_exact_record "$H19_ROOT" && printf '%s' completed ;;
    *) return 1 ;;
  esac
}

artifact_state() {
  local path="$1" mode="$2" old="$3" new="$4" maximum="${5:-2097152}"
  if [[ ! -e "$path" && ! -L "$path" ]]; then printf '%s' missing
  elif [[ "$old" != 'absent' ]] && require_exact_file "$path" "$old" "$mode" "$maximum"; then printf '%s' old
  elif [[ "$new" != 'absent' ]] && require_exact_file "$path" "$new" "$mode" "$maximum"; then printf '%s' new
  else return 1
  fi
}

require_causal_topology() {
  local namespace helper finalizer guard continuous disabled deploy topology
  namespace="$(classify_namespace)" || return 1
  helper="$(artifact_state "$TARGET" 755 "$PREDECESSOR_HELPER_SHA256" "$SUCCESSOR_HELPER_SHA256")" || return 1
  finalizer="$(artifact_state "$CONTINUOUS_FINALIZER" 755 "$PREDECESSOR_FINALIZER_SHA256" "$SUCCESSOR_FINALIZER_SHA256")" || return 1
  guard="$(artifact_state "$INGRESS_GUARD" 755 absent "$INGRESS_GUARD_SHA256")" || return 1
  continuous="$(artifact_state "$CONTINUOUS_SUDOERS" 440 "$PREDECESSOR_SUDOERS_SHA256" \
    "$SUCCESSOR_SUDOERS_SHA256" 65536)" || return 1
  disabled="$(artifact_state "$CONTINUOUS_SUDOERS_DISABLED" 440 "$PREDECESSOR_SUDOERS_SHA256" absent 65536)" || return 1
  if require_active_deploy_grant; then deploy=active
  elif require_disabled_deploy_grant; then deploy=disabled
  else return 1
  fi
  topology="$namespace:$helper:$finalizer:$guard:$continuous:$disabled:$deploy"
  case "$topology" in
    absent:old:old:missing:old:missing:active|\
    absent:old:old:missing:old:missing:disabled|\
    absent:old:old:missing:missing:old:disabled|\
    empty-parent:old:old:missing:missing:old:disabled|\
    interrupted:old:old:missing:missing:old:disabled|\
    interrupted:old:old:new:missing:old:disabled|\
    interrupted:new:old:new:missing:old:disabled|\
    interrupted:new:new:new:missing:old:disabled|\
    completed:new:new:new:missing:old:disabled|\
    completed:new:new:new:new:old:disabled|\
    completed:new:new:new:new:missing:disabled|\
    completed:new:new:new:new:missing:active) return 0 ;;
    *) return 1 ;;
  esac
}

transaction_snapshot() {
  local namespace helper finalizer guard continuous disabled deploy production ingress tls stopped
  namespace="$(classify_namespace)" || return 1
  helper="$(artifact_state "$TARGET" 755 "$PREDECESSOR_HELPER_SHA256" "$SUCCESSOR_HELPER_SHA256")" || return 1
  finalizer="$(artifact_state "$CONTINUOUS_FINALIZER" 755 "$PREDECESSOR_FINALIZER_SHA256" "$SUCCESSOR_FINALIZER_SHA256")" || return 1
  guard="$(artifact_state "$INGRESS_GUARD" 755 absent "$INGRESS_GUARD_SHA256")" || return 1
  continuous="$(artifact_state "$CONTINUOUS_SUDOERS" 440 "$PREDECESSOR_SUDOERS_SHA256" \
    "$SUCCESSOR_SUDOERS_SHA256" 65536)" || return 1
  disabled="$(artifact_state "$CONTINUOUS_SUDOERS_DISABLED" 440 "$PREDECESSOR_SUDOERS_SHA256" absent 65536)" || return 1
  if require_active_deploy_grant; then deploy=active
  elif require_disabled_deploy_grant; then deploy=disabled
  else return 1
  fi
  production="$(production_boundary_digest)" || return 1
  ingress="$(shared_ingress_boundary_digest)" || return 1
  tls="$(tls_leaf_digest)" || return 1
  stopped="$(stopped_staging_boundary_digest)" || return 1
  printf '%s\n' \
    "namespace=$namespace" "helper=$helper" "finalizer=$finalizer" "guard=$guard" \
    "continuous_sudoers=$continuous" "disabled_continuous_sudoers=$disabled" \
    "deploy_grant=$deploy" "h18_release=${H18_RECORD[0]}" \
    "h18_intent_sha256=${H18_RECORD[1]}" "h18_completion_sha256=${H18_RECORD[2]}" \
    "stopped_staging_boundary_sha256=$stopped" \
    "production_boundary_sha256=$production" \
    "shared_ingress_boundary_sha256=$ingress" "tls_leaf_sha256=$tls"
}

archive_predecessors() {
  reconcile_copy "$TARGET" 755 "$H19_INSTALLING/predecessor-helper" 400 \
    "$PREDECESSOR_HELPER_SHA256" || return 1
  reconcile_copy "$CONTINUOUS_FINALIZER" 755 \
    "$H19_INSTALLING/predecessor-continuous-finalizer" 400 \
    "$PREDECESSOR_FINALIZER_SHA256" || return 1
  reconcile_copy "$CONTINUOUS_SUDOERS_DISABLED" 440 \
    "$H19_INSTALLING/predecessor-continuous-sudoers" 400 \
    "$PREDECESSOR_SUDOERS_SHA256"
}

install_successor_artifacts() {
  reconcile_replace "$STAGED_GUARD" 600 "$INGRESS_GUARD" 755 absent \
    "$INGRESS_GUARD_SHA256" "$GUARD_INSTALLING" || return 1
  require_causal_topology || return 1
  reconcile_replace "$STAGED_HELPER" 600 "$TARGET" 755 "$PREDECESSOR_HELPER_SHA256" \
    "$SUCCESSOR_HELPER_SHA256" "$HELPER_INSTALLING" || return 1
  require_causal_topology || return 1
  reconcile_replace "$STAGED_FINALIZER" 600 "$CONTINUOUS_FINALIZER" 755 \
    "$PREDECESSOR_FINALIZER_SHA256" "$SUCCESSOR_FINALIZER_SHA256" \
    "$FINALIZER_INSTALLING" || return 1
  require_causal_topology
}

install_successor_continuous_sudoers() {
  reconcile_replace "$STAGED_SUDOERS" 600 "$CONTINUOUS_SUDOERS" 440 absent \
    "$SUCCESSOR_SUDOERS_SHA256" "$SUDOERS_INSTALLING" || return 1
  visudo -cf "$CONTINUOUS_SUDOERS" >/dev/null && visudo -cf /etc/sudoers >/dev/null
}

remove_disabled_predecessor_sudoers() {
  if [[ ! -e "$CONTINUOUS_SUDOERS_DISABLED" && ! -L "$CONTINUOUS_SUDOERS_DISABLED" ]]; then
    return 0
  fi
  require_exact_file "$CONTINUOUS_SUDOERS_DISABLED" "$PREDECESSOR_SUDOERS_SHA256" 440 65536 &&
    require_exact_file "$H19_ROOT/predecessor-continuous-sudoers" \
      "$PREDECESSOR_SUDOERS_SHA256" 400 65536 &&
    require_exact_file "$CONTINUOUS_SUDOERS" "$SUCCESSOR_SUDOERS_SHA256" 440 65536 || return 1
  rm -- "$CONTINUOUS_SUDOERS_DISABLED" || return 1
  sync -f /etc/sudoers.d || return 1
  [[ ! -e "$CONTINUOUS_SUDOERS_DISABLED" && ! -L "$CONTINUOUS_SUDOERS_DISABLED" ]]
}

require_successor_bundle() {
  require_exact_record "$H19_ROOT" &&
    require_exact_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 && bash -n "$TARGET" &&
    require_exact_file "$CONTINUOUS_FINALIZER" "$SUCCESSOR_FINALIZER_SHA256" 755 &&
    bash -n "$CONTINUOUS_FINALIZER" &&
    require_exact_file "$CONTINUOUS_SUDOERS" "$SUCCESSOR_SUDOERS_SHA256" 440 65536 &&
    visudo -cf "$CONTINUOUS_SUDOERS" >/dev/null &&
    require_exact_file "$INGRESS_GUARD" "$INGRESS_GUARD_SHA256" 755 && bash -n "$INGRESS_GUARD" &&
    [[ ! -e "$CONTINUOUS_SUDOERS_DISABLED" && ! -L "$CONTINUOUS_SUDOERS_DISABLED" &&
      ! -e "$HELPER_INSTALLING" && ! -L "$HELPER_INSTALLING" &&
      ! -e "$FINALIZER_INSTALLING" && ! -L "$FINALIZER_INSTALLING" &&
      ! -e "$GUARD_INSTALLING" && ! -L "$GUARD_INSTALLING" &&
      ! -e "$SUDOERS_INSTALLING" && ! -L "$SUDOERS_INSTALLING" ]]
}

require_successor_helper_boundary() {
  run_helper_direct verify "$SUCCESSOR_HELPER_SHA256" >/dev/null &&
    run_helper_direct kemerbet-v3-runtime-bridge-ready "$SUCCESSOR_HELPER_SHA256" >/dev/null &&
    run_helper_direct kemerbet-quarantine-recovery-ready "$CANONICAL_H14_RELEASE" >/dev/null &&
    run_helper_direct fresh-host-ready "$BRIDGE_RELEASE" >/dev/null
}

cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 ]] && require_disabled_deploy_grant; then
    printf '%s\n' \
      'H19 stopped with the deployment grant disabled. Rerun this exact installer; do not edit the evidence or restore grants manually.' >&2
  fi
  exit "$status"
}

require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'
require_staged_bundle || die 'the exact root-owned H19 staged bundle is unavailable'
resolve_h18_record || die 'the completed H18 provenance record is unavailable or invalid'

initial_helper_state="$(artifact_state "$TARGET" 755 "$PREDECESSOR_HELPER_SHA256" \
  "$SUCCESSOR_HELPER_SHA256")" || die 'the installed helper is neither the H18 predecessor nor H19 successor'
if [[ "$initial_helper_state" == old ]]; then
  require_predecessor_helper_boundary || die 'the H18 helper or stopped staging boundary is invalid'
fi
require_no_staging_runtime || die 'staging or the device pilot is running'
require_protected_gateway_and_bridge || die 'production is not the exact protected all-baseline runtime'
require_transition_namespace_absent || die 'a production gateway transition record already exists'
[[ "$(gateway_caddy_sha256)" == "$BASELINE_CADDY_SHA256" ]] ||
  die 'the baseline production Caddyfile is not exact'
BASELINE_PRODUCTION_BOUNDARY_SHA256="$(production_boundary_digest)" ||
  die 'the baseline production boundary digest is unavailable'
BASELINE_SHARED_INGRESS_BOUNDARY_SHA256="$(shared_ingress_boundary_digest)" ||
  die 'the baseline shared-ingress boundary digest is unavailable'
BASELINE_TLS_LEAF_SHA256="$(tls_leaf_digest)" || die 'the baseline TLS leaf digest is unavailable'
BASELINE_STOPPED_STAGING_BOUNDARY_SHA256="$(stopped_staging_boundary_digest)" ||
  die 'the baseline stopped-staging boundary digest is unavailable'
readonly BASELINE_PRODUCTION_BOUNDARY_SHA256 BASELINE_SHARED_INGRESS_BOUNDARY_SHA256 \
  BASELINE_TLS_LEAF_SHA256 BASELINE_STOPPED_STAGING_BOUNDARY_SHA256
for digest in "$BASELINE_PRODUCTION_BOUNDARY_SHA256" "$BASELINE_SHARED_INGRESS_BOUNDARY_SHA256" \
  "$BASELINE_TLS_LEAF_SHA256" "$BASELINE_STOPPED_STAGING_BOUNDARY_SHA256"; do
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || die 'a baseline boundary digest is invalid'
done

require_preserved_boundaries || die 'a protected boundary changed during H19 preflight'
require_causal_topology || die 'the H19 transaction topology is not causally recoverable'
PREFLIGHT_SNAPSHOT="$(transaction_snapshot)" || die 'the H19 transaction snapshot is unavailable'
readonly PREFLIGHT_SNAPSHOT

trap cleanup EXIT
open_lock || die 'the exact shared mutation lock is unsafe or busy'
require_no_other_mutators || die 'another staging or H19 mutator is active'
LOCKED_SNAPSHOT="$(transaction_snapshot)" || die 'the locked H19 transaction snapshot is unavailable'
[[ "$LOCKED_SNAPSHOT" == "$PREFLIGHT_SNAPSHOT" ]] ||
  die 'the H19 transaction changed before the lock was acquired'
require_causal_topology && require_preserved_boundaries ||
  die 'the protected transaction boundary changed under lock'

disable_deploy_grant || die 'the deployment capability could not be isolated'
require_causal_topology || die 'the topology is invalid after deployment-grant isolation'

namespace="$(classify_namespace)" || die 'the H19 evidence namespace is invalid'
continuous_state="$(artifact_state "$CONTINUOUS_SUDOERS" 440 "$PREDECESSOR_SUDOERS_SHA256" \
  "$SUCCESSOR_SUDOERS_SHA256" 65536)" || die 'the continuous sudoers state is invalid'
if [[ "$continuous_state" == old ]]; then
  disable_continuous_grant || die 'the H18 continuous capability could not be isolated'
elif [[ "$continuous_state" != new || "$namespace" != completed ]]; then
  [[ "$continuous_state" == missing ]] || die 'the continuous checksum pair is causally invalid'
fi
require_causal_topology && require_preserved_boundaries ||
  die 'the boundary changed after capability isolation'

namespace="$(classify_namespace)" || die 'the H19 namespace changed unexpectedly'
if [[ "$namespace" != completed ]]; then
  if [[ "$namespace" == absent ]]; then
    install -d -o root -g root -m 0700 "$H19_PARENT"
    sync -f "$(dirname -- "$H19_PARENT")"
    namespace=empty-parent
  fi
  if [[ "$namespace" == empty-parent ]]; then
    install -d -o root -g root -m 0700 "$H19_INSTALLING"
    sync -f "$H19_PARENT"
    namespace=interrupted
  fi
  [[ "$namespace" == interrupted ]] || die 'the H19 installing namespace is invalid'
  require_installing_record || die 'the resumable H19 record prefix is invalid'
  publish_record_atomically "$H19_INSTALLING" intent-v1 expected_intent ||
    die 'the H19 intent could not be published atomically'
  require_installing_record && require_preserved_boundaries ||
    die 'the H19 intent phase did not preserve all boundaries'
  archive_predecessors || die 'the H18 helper/finalizer/sudoers archives could not be sealed'
  require_installing_record && require_causal_topology && require_preserved_boundaries ||
    die 'the H19 predecessor archive phase is invalid'
  install_successor_artifacts || die 'the H19 successor artifacts could not be installed atomically'
  require_installing_record && require_causal_topology && require_preserved_boundaries ||
    die 'the H19 successor artifact phase is invalid'
  publish_record_atomically "$H19_INSTALLING" completed-v1 expected_completion ||
    die 'the H19 completion could not be published atomically'
  require_exact_record "$H19_INSTALLING" || die 'the completed H19 installing record is invalid'
  [[ ! -e "$H19_ROOT" && ! -L "$H19_ROOT" ]] || die 'the final H19 root appeared unexpectedly'
  mv -- "$H19_INSTALLING" "$H19_ROOT"
  sync -f "$H19_PARENT"
fi

require_exact_record "$H19_ROOT" && require_causal_topology && require_preserved_boundaries ||
  die 'the terminal H19 helper provenance or protected boundary is invalid'
continuous_state="$(artifact_state "$CONTINUOUS_SUDOERS" 440 "$PREDECESSOR_SUDOERS_SHA256" \
  "$SUCCESSOR_SUDOERS_SHA256" 65536)" || die 'the terminal continuous sudoers state is invalid'
if [[ "$continuous_state" == missing ]]; then
  install_successor_continuous_sudoers ||
    die 'the H19 continuous finalizer/sudoers checksum pair could not be completed'
elif [[ "$continuous_state" != new ]]; then
  die 'the predecessor continuous capability remained active after H19 completion'
fi
require_causal_topology && require_preserved_boundaries ||
  die 'the checksum-pair rotation changed a protected boundary'
remove_disabled_predecessor_sudoers || die 'the archived predecessor sudoers could not be retired'
require_causal_topology && require_successor_bundle && require_preserved_boundaries ||
  die 'the terminal H19 bundle is not exact before grant restoration'
require_successor_helper_boundary ||
  die 'the installed H19 helper rejected the chained evidence or exact baseline ingress state'
require_preserved_boundaries ||
  die 'a protected boundary changed during successor-helper attestation'
restore_deploy_grant || die 'the deployment capability could not be restored safely'
require_causal_topology && require_successor_bundle && require_preserved_boundaries ||
  die 'the restored H19 transaction is not exact'
close_lock || die 'the H19 mutation lock could not be released'

require_successor_helper_boundary ||
  die 'the installed H19 helper rejected the post-unlock chained evidence or baseline ingress state'
require_preserved_boundaries || die 'a protected boundary changed after H19 helper attestation'
trap - EXIT

printf '%s\n' \
  'FetanAgent H19 route-helper guards installed or validated: staging stopped; production baseline unchanged; continuous checksum pair rotated; no money moved.'
