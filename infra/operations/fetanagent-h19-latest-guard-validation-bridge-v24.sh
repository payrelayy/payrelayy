#!/usr/bin/env bash
# One-use, root-console-only H23 -> H24 guard-ordering correction. It preserves
# every H19-H23 record, archives the exact rejected H23 guard, and installs a
# successor that validates the installed guard only at the newest terminal
# bridge. It does not run Compose, alter a database, restart a container, or
# move money.
set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly INGRESS_GUARD='/usr/local/sbin/fetanagent-production-ingress-h19'
readonly GUARD_INSTALLING='/usr/local/sbin/.fetanagent-production-ingress-h19.h24-installing'
readonly DEPLOY_SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly DEPLOY_SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.h23-disabled'
readonly H19_PARENT='/var/lib/fetanagent/staging-telebirr-route-helper-bridge-v19'
readonly H20_PARENT='/var/lib/fetanagent/h19-canonical-cap-guard-bridge-v20'
readonly H21_PARENT='/var/lib/fetanagent/h19-stable-nine-guard-bridge-v21'
readonly H22_PARENT='/var/lib/fetanagent/h19-terminal-receipt-order-guard-bridge-v22'
readonly H23_PARENT='/var/lib/fetanagent/h19-runtime-reattest-guard-bridge-v23'
readonly H24_PARENT='/var/lib/fetanagent/h19-latest-guard-validation-bridge-v24'
readonly TRANSITION_PARENT='/var/lib/fetanagent/production-gateway-staging-route-v1'
readonly H23_RELEASE='837f3addad1e1acf9707099c0590824739e8c788'
readonly H23_INTENT_SHA256='0d842ba7013b9af71543e906d5db7fec6ecf509485f21c6b814b3c4486213489'
readonly H23_COMPLETION_SHA256='b51c3074d25daea13cd525c34de62a5a0efbf414cd16f5e0277cea76514f0d6a'
readonly H23_GUARD_SHA256='351156b4d6d18d1f7920ebee7b8817ca937d126faabf9863f31d8811662dd759'
readonly H23_CORRECTION_RELEASE='930a76e11cd8f7ad77726a81981f2d25694d24da'
readonly H23_INSTALLER_SHA256='0e991a51096e57067857e005baea147f0c03cc865fb58e82e6c9ee13900a92a1'
readonly H22_GUARD_SHA256='0b4a9b31a893073e725bfc97fc6ef3f6589fd9b5d720da5003e987ad0dcc7f17'
readonly H19_RELEASE='90b1f059577682b6bc458d239f6bdcb591077085'
readonly H20_HELPER_SHA256='8c7230cea5101f182f05b11b094049822ddbe43884d7bda80a9a46b883eee4b4'
readonly H20_FINALIZER_SHA256='1ab7df7d5e530db75ba5f378169de0fda178c1a264df3a48fbb5acf76220f34f'
readonly H20_SUDOERS_SHA256='0978f4785d4661db46d8fe9bb8e29d81fa5ff2954aceb36aa6cc7d2ec4a71807'
readonly DEPLOY_SUDOERS_SHA256='19812382d8c43076726cf301c715b601a0da375bb130b17960bcffad154f7422'
readonly PROTECTED_RELEASE='69be82ac3e49ff8c63c64c9aa7926e0046b48a10'
readonly APPROVED_BOT_RELEASE='bcc479be0f2e807203df5612d380002fd6df2ee5'
readonly REVIEWED_SUCCESSOR_GUARD_SHA256='73f447a25ff1c0c242a16ff04d0c0fd572fb78b20e55cec082659c8b760fd9d3'
readonly H23_STAGING_ROOT="/root/fetanagent-h19-runtime-reattest-guard-bridge-v23-$H23_RELEASE"
readonly H23_INSTALLER="$H23_STAGING_ROOT/fetanagent-h19-runtime-reattest-guard-bridge-v23.sh"
readonly H23_STAGED_GUARD="$H23_STAGING_ROOT/fetanagent-production-ingress-h19.next"
readonly H23_CONFIRMATION='I-UNDERSTAND-THIS-REATTESTS-THE-EXACT-NO-MONEY-PRODUCTION-RUNTIME-WITHOUT-MUTATING-IT'
readonly STAGING_HELPER='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly CONTINUOUS_FINALIZER='/usr/local/sbin/fetanagent-staging-continuous-availability'
readonly CONTINUOUS_SUDOERS='/etc/sudoers.d/fetanagent-staging-continuous-availability'
readonly MUTATION_LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly MUTATION_LOCK="$MUTATION_LOCK_ROOT/mutation.lock"
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly SCRIPT_BASENAME='fetanagent-h19-latest-guard-validation-bridge-v24.sh'
readonly CONFIRMATION='I-UNDERSTAND-THIS-CORRECTS-H23-GUARD-ORDERING-WITHOUT-MUTATING-THE-RUNTIME'

export PATH="$SAFE_PATH"
umask 077

die() {
  printf 'FetanAgent H24 latest-guard validation bridge failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 3 || $# -eq 4 ]] ||
  die 'expected the H24 release, successor guard digest, exact confirmation, and optional preflight mode'
readonly BRIDGE_RELEASE="$1"
readonly SUCCESSOR_GUARD_SHA256="$2"
readonly PROVIDED_CONFIRMATION="$3"
readonly MODE="${4:-apply}"
readonly STAGING_ROOT="/root/fetanagent-h19-latest-guard-validation-bridge-v24-$BRIDGE_RELEASE"
readonly STAGED_INSTALLER="$STAGING_ROOT/$SCRIPT_BASENAME"
readonly STAGED_GUARD="$STAGING_ROOT/fetanagent-production-ingress-h19.next"
readonly H24_ROOT="$H24_PARENT/$BRIDGE_RELEASE"
readonly H24_INSTALLING="$H24_PARENT/.installing-$BRIDGE_RELEASE"

[[ "$BRIDGE_RELEASE" =~ ^[0-9a-f]{40}$ &&
  "$BRIDGE_RELEASE" != "$PROTECTED_RELEASE" && "$BRIDGE_RELEASE" != "$H19_RELEASE" &&
  "$BRIDGE_RELEASE" != "$H23_RELEASE" && "$BRIDGE_RELEASE" != "$H23_CORRECTION_RELEASE" &&
  "$BRIDGE_RELEASE" != "$APPROVED_BOT_RELEASE" ]] ||
  die 'H24 requires one distinct full bridge release SHA'
[[ "$SUCCESSOR_GUARD_SHA256" == "$REVIEWED_SUCCESSOR_GUARD_SHA256" &&
  "$SUCCESSOR_GUARD_SHA256" != "$H23_GUARD_SHA256" &&
  "$SUCCESSOR_GUARD_SHA256" != "$H22_GUARD_SHA256" ]] ||
  die 'the H24 successor guard digest is invalid or unchanged'
[[ "$PROVIDED_CONFIRMATION" == "$CONFIRMATION" ]] ||
  die 'the exact one-use no-money H24 confirmation is required'
[[ "$MODE" == apply || "$MODE" == preflight ]] || die 'mode must be apply or preflight'
[[ "$(id -u)" == 0 && "$(id -un)" == root && -z "${SUDO_USER:-}" ]] ||
  die 'run this installer only through the authenticated DigitalOcean root channel'
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'Docker environment overrides are forbidden'

for command in awk bash chmod cmp curl dirname env find flock id install mktemp mv python3 realpath rm \
  sha256sum sort stat sync visudo; do
  command -v "$command" >/dev/null 2>&1 || die "required command is unavailable: $command"
done

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

require_h23_boundary() {
  require_exact_directory "$H23_PARENT" "$H23_RELEASE" || return 1
  require_exact_directory "$H23_PARENT/$H23_RELEASE" completed-v1 intent-v1 \
    predecessor-ingress-guard || return 1
  require_exact_file "$H23_PARENT/$H23_RELEASE/intent-v1" "$H23_INTENT_SHA256" 600 4096 ||
    return 1
  require_exact_file "$H23_PARENT/$H23_RELEASE/completed-v1" \
    "$H23_COMPLETION_SHA256" 600 4096 || return 1
  require_exact_file "$H23_PARENT/$H23_RELEASE/predecessor-ingress-guard" \
    "$H22_GUARD_SHA256" 400
}

require_h23_preflight_bundle() {
  require_exact_directory "$H23_STAGING_ROOT" \
    fetanagent-h19-runtime-reattest-guard-bridge-v23.sh \
    fetanagent-production-ingress-h19.next || return 1
  require_exact_file "$H23_INSTALLER" "$H23_INSTALLER_SHA256" 700 || return 1
  require_exact_file "$H23_STAGED_GUARD" "$H23_GUARD_SHA256" 600
}

run_h23_preflight() {
  require_h23_preflight_bundle || return 1
  env -i PATH="$SAFE_PATH" HOME='/root' "$H23_INSTALLER" \
    "$H23_RELEASE" "$H23_GUARD_SHA256" "$H23_CONFIRMATION" \
    "$H23_CORRECTION_RELEASE" preflight >/dev/null
}

require_disabled_deploy_grant() {
  [[ ! -e "$DEPLOY_SUDOERS" && ! -L "$DEPLOY_SUDOERS" ]] &&
    require_exact_file "$DEPLOY_SUDOERS_DISABLED" "$DEPLOY_SUDOERS_SHA256" 440 65536 &&
    visudo -cf /etc/sudoers >/dev/null
}

require_active_deploy_grant() {
  require_exact_file "$DEPLOY_SUDOERS" "$DEPLOY_SUDOERS_SHA256" 440 65536 &&
    [[ ! -e "$DEPLOY_SUDOERS_DISABLED" && ! -L "$DEPLOY_SUDOERS_DISABLED" ]] &&
    visudo -cf /etc/sudoers >/dev/null
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
    'contract=fetanagent-h19-latest-guard-validation-bridge-v24' \
    'state=authorized' \
    "bridge_release=$BRIDGE_RELEASE" \
    "h23_bridge_release=$H23_RELEASE" \
    "h23_bridge_intent_sha256=$H23_INTENT_SHA256" \
    "h23_bridge_completion_sha256=$H23_COMPLETION_SHA256" \
    "h19_bridge_release=$H19_RELEASE" \
    "candidate_gateway_release=$H19_RELEASE" \
    "predecessor_ingress_guard_sha256=$H23_GUARD_SHA256" \
    "successor_ingress_guard_sha256=$SUCCESSOR_GUARD_SHA256" \
    'correction=validate-installed-guard-at-latest-terminal-bridge' \
    'h19_through_h23_evidence_preserved=true' \
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
  expected_intent | awk 'NR == 2 {$0="state=latest-guard-validation-installed"} {print}'
  printf '%s\n' "bridge_intent_sha256=$intent_sha"
}

probe_successor_guard() {
  local probe_root probe_parent probe_release probe_guard probe_reader
  probe_root="$(mktemp -d /run/fetanagent-h24-guard-probe.XXXXXXXX)" || return 1
  [[ "$probe_root" == /run/fetanagent-h24-guard-probe.* &&
    ! -L "$probe_root" && "$(realpath -- "$probe_root")" == "$probe_root" ]] || return 1
  probe_parent="$probe_root/h24"
  probe_release="$probe_parent/$BRIDGE_RELEASE"
  probe_guard="$probe_root/fetanagent-production-ingress-h19"
  probe_reader="$probe_root/read-h19-record.py"
  install -d -o root -g root -m 0700 "$probe_parent" "$probe_release" || {
    rm -rf -- "$probe_root"
    return 1
  }
  expected_intent >"$probe_release/intent-v1" || {
    rm -rf -- "$probe_root"
    return 1
  }
  expected_completion >"$probe_release/completed-v1" || {
    rm -rf -- "$probe_root"
    return 1
  }
  chmod 0600 "$probe_release/intent-v1" "$probe_release/completed-v1" || {
    rm -rf -- "$probe_root"
    return 1
  }
  install -o root -g root -m 0400 "$INGRESS_GUARD" \
    "$probe_release/predecessor-ingress-guard" || {
    rm -rf -- "$probe_root"
    return 1
  }
  install -o root -g root -m 0755 "$STAGED_GUARD" "$probe_guard" || {
    rm -rf -- "$probe_root"
    return 1
  }
  awk '
    /^read_h19_record\(\) \{/ { in_reader=1 }
    in_reader && /<<'\''PY'\''$/ { capture=1; next }
    capture && /^PY$/ { exit }
    capture { print }
  ' "$STAGED_GUARD" >"$probe_reader" || {
    rm -rf -- "$probe_root"
    return 1
  }
  chmod 0600 "$probe_reader" || {
    rm -rf -- "$probe_root"
    return 1
  }
  env -i PATH="$SAFE_PATH" python3 -I "$probe_reader" \
    "$H19_PARENT" "$H20_PARENT" "$H21_PARENT" "$H22_PARENT" "$H23_PARENT" \
    "$probe_parent" "$TRANSITION_PARENT" "$STAGING_HELPER" "$CONTINUOUS_FINALIZER" \
    "$CONTINUOUS_SUDOERS" "$probe_guard" >/dev/null || {
    rm -rf -- "$probe_root"
    return 1
  }
  rm -rf -- "$probe_root"
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
  local target temporary
  target="$H24_INSTALLING/predecessor-ingress-guard"
  temporary="$target.installing"
  if [[ -e "$target" || -L "$target" ]]; then
    [[ ! -e "$temporary" && ! -L "$temporary" ]] || return 1
    require_exact_file "$target" "$H23_GUARD_SHA256" 400
    return
  fi
  if [[ ! -e "$temporary" && ! -L "$temporary" ]]; then
    require_exact_file "$INGRESS_GUARD" "$H23_GUARD_SHA256" 755 || return 1
    install -o root -g root -m 0400 "$INGRESS_GUARD" "$temporary" || return 1
    sync -f "$temporary" || return 1
  fi
  require_exact_file "$temporary" "$H23_GUARD_SHA256" 400 || return 1
  mv -- "$temporary" "$target" || return 1
  sync -f "$H24_INSTALLING"
}

guard_state() {
  if require_exact_file "$INGRESS_GUARD" "$H23_GUARD_SHA256" 755 2>/dev/null; then
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
  if [[ ! -e "$H24_PARENT" && ! -L "$H24_PARENT" ]]; then printf absent; return; fi
  [[ ! -L "$H24_PARENT" && -d "$H24_PARENT" &&
    "$(realpath -- "$H24_PARENT")" == "$H24_PARENT" &&
    "$(stat --format='%U:%G:%a' "$H24_PARENT")" == root:root:700 ]] || return 1
  local entries
  entries="$(find -P "$H24_PARENT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' |
    LC_ALL=C sort)" || return 1
  case "$entries" in
    '') printf empty-parent ;;
    ".installing-$BRIDGE_RELEASE:d") printf installing ;;
    "$BRIDGE_RELEASE:d") printf completed ;;
    *) return 1 ;;
  esac
}

ensure_installing_namespace() {
  local state
  state="$(namespace_state)" || return 1
  if [[ "$state" == absent ]]; then
    install -d -o root -g root -m 0700 "$H24_PARENT" || return 1
    sync -f "$(dirname -- "$H24_PARENT")" || return 1
    state=empty-parent
  fi
  if [[ "$state" == empty-parent ]]; then
    install -d -o root -g root -m 0700 "$H24_INSTALLING" || return 1
    sync -f "$H24_PARENT" || return 1
  fi
  [[ "$(namespace_state)" == installing ]]
}

require_terminal_record() {
  require_exact_directory "$H24_PARENT" "$BRIDGE_RELEASE" &&
    require_exact_directory "$H24_ROOT" completed-v1 intent-v1 predecessor-ingress-guard &&
    require_expected_record "$H24_ROOT/intent-v1" 600 expected_intent &&
    require_expected_record "$H24_ROOT/completed-v1" 600 expected_completion &&
    require_exact_file "$H24_ROOT/predecessor-ingress-guard" "$H23_GUARD_SHA256" 400
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

require_staged_bundle || die 'the root-owned staged H24 bundle is not exact'
require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'
require_h23_boundary || die 'the terminal H23 evidence is not exact'
require_exact_file "$STAGING_HELPER" "$H20_HELPER_SHA256" 755 ||
  die 'the staging helper changed outside the H19-H23 chain'
require_exact_file "$CONTINUOUS_FINALIZER" "$H20_FINALIZER_SHA256" 755 ||
  die 'the continuous finalizer changed outside the H19-H23 chain'
require_exact_file "$CONTINUOUS_SUDOERS" "$H20_SUDOERS_SHA256" 440 65536 ||
  die 'the continuous sudoers changed outside the H19-H23 chain'
require_disabled_deploy_grant || die 'the staging deployment grant is not in the exact H23-isolated state'
state="$(namespace_state)" || die 'the H24 namespace is invalid'
guard="$(guard_state)" || die 'the installed guard is neither the H23 predecessor nor H24 successor'
case "$state:$guard" in
  absent:old|empty-parent:old|installing:old)
    run_h23_preflight || die 'the exact H23 terminal runtime no longer re-attests'
    probe_successor_guard || die 'the H24 successor rejected the real H19-H23 chain during preinstall probing'
    ;;
  installing:new)
    ;;
  completed:new)
    require_terminal_record || die 'the terminal H24 record is invalid'
    env -i PATH="$SAFE_PATH" HOME='/root' "$INGRESS_GUARD" inspect "$H19_RELEASE" ||
      die 'the installed H24 guard rejected the runtime'
    require_successor_record_output || die 'the installed H24 record output is invalid'
    ;;
  *) die 'the H24 evidence and installed-guard topology is causally invalid' ;;
esac

if [[ "$MODE" == preflight ]]; then
  printf '%s\n' \
    'FetanAgent H24 preflight passed: exact H23 failure state verified; no state changed; money moved=false.'
  exit 0
fi

open_lock || die 'the shared staging mutation lock is unavailable'
require_h23_boundary || die 'the H23 chain changed after lock acquisition'
require_disabled_deploy_grant || die 'the isolated staging deployment grant changed after lock acquisition'
state="$(namespace_state)" || die 'the H24 namespace changed after lock acquisition'
guard="$(guard_state)" || die 'the installed guard changed after lock acquisition'
if [[ "$guard" == old ]]; then
  run_h23_preflight || die 'the H23 runtime changed after lock acquisition'
  probe_successor_guard || die 'the H24 successor preinstall probe changed after lock acquisition'
fi

if [[ "$state" != completed ]]; then
  ensure_installing_namespace || die 'the H24 installing namespace could not be made exact'
  publish_record "$H24_INSTALLING" intent-v1 expected_intent || die 'the H24 intent could not be sealed'
  archive_predecessor_guard || die 'the rejected H23 guard could not be archived'
  install_successor_guard || die 'the H24 successor guard could not be installed atomically'
  publish_record "$H24_INSTALLING" completed-v1 expected_completion ||
    die 'the H24 completion could not be sealed'
  require_exact_directory "$H24_INSTALLING" completed-v1 intent-v1 predecessor-ingress-guard &&
    require_expected_record "$H24_INSTALLING/intent-v1" 600 expected_intent &&
    require_expected_record "$H24_INSTALLING/completed-v1" 600 expected_completion &&
    require_exact_file "$H24_INSTALLING/predecessor-ingress-guard" "$H23_GUARD_SHA256" 400 ||
    die 'the completed H24 installing record is invalid'
  [[ ! -e "$H24_ROOT" && ! -L "$H24_ROOT" ]] || die 'the terminal H24 root appeared unexpectedly'
  mv -- "$H24_INSTALLING" "$H24_ROOT" || die 'the H24 record could not become terminal'
  sync -f "$H24_PARENT"
fi

require_terminal_record || die 'the terminal H24 record is invalid'
require_exact_file "$INGRESS_GUARD" "$SUCCESSOR_GUARD_SHA256" 755 ||
  die 'the installed H24 successor guard is not exact'
env -i PATH="$SAFE_PATH" HOME='/root' "$INGRESS_GUARD" inspect "$H19_RELEASE" ||
  die 'the H24 successor guard rejected the exact no-money runtime'
require_successor_record_output || die 'the H24 successor record chain is invalid'
restore_deploy_grant || die 'the staging deployment capability could not be restored safely'
env -i PATH="$SAFE_PATH" HOME='/root' "$INGRESS_GUARD" inspect "$H19_RELEASE" ||
  die 'the restored H24 runtime no longer re-attests'
require_terminal_record && require_successor_record_output && require_active_deploy_grant ||
  die 'the restored H24 transaction is not exact'
flock --unlock 9 || die 'the shared mutation lock could not be released'
exec 9>&-

printf '%s\n' \
  'FetanAgent H24 latest-guard validation installed: H19-H23 evidence preserved; containers and database untouched; financial actions disabled; money moved=false.'
