#!/usr/bin/env bash
# Root-owned H19 production-ingress guard and gateway-only transition.
# It admits only the protected all-baseline state or one immutable, reviewed
# gateway revision while every other production container remains protected.
set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly INSTALLED_PATH='/usr/local/sbin/fetanagent-production-ingress-h19'
readonly STAGING_HELPER='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly CONTINUOUS_FINALIZER='/usr/local/sbin/fetanagent-staging-continuous-availability'
readonly CONTINUOUS_SUDOERS='/etc/sudoers.d/fetanagent-staging-continuous-availability'
readonly H19_PARENT='/var/lib/fetanagent/staging-telebirr-route-helper-bridge-v19'
readonly H20_PARENT='/var/lib/fetanagent/h19-canonical-cap-guard-bridge-v20'
readonly TRANSITION_PARENT='/var/lib/fetanagent/production-gateway-staging-route-v1'
readonly PRODUCTION_ROOT='/srv/fetanagent/production'
readonly PRODUCTION_RELEASE_ROOT="$PRODUCTION_ROOT/releases"
readonly PRODUCTION_CURRENT="$PRODUCTION_ROOT/current"
readonly PRODUCTION_PROJECT='fetanagent-production'
readonly PROTECTED_RELEASE='69be82ac3e49ff8c63c64c9aa7926e0046b48a10'
readonly BASELINE_CADDY_SHA256='181992c8958397d63a7ae34137d51d4186ce0383c8cfd2bf8df137da11e12f24'
readonly CANDIDATE_CADDY_SHA256='afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616'
readonly PROTECTED_COMPOSE_SHA256='98d7e763754868ba978d5c042c722664a1c1aec6f85e9011410d74e5d5f1928c'
readonly SHARED_NETWORK='fetanagent-telebirr-device-ingress'
readonly SHARED_NETWORK_ID='5b3dc890fad4f062ac570e4bbc66f950d002b536843b2630473eb817537af738'
readonly SHARED_NETWORK_CONFIG_HASH='ac7f178b6d4280a708b951cb93740b0f8323fb2cb2c75d05cf040f44e2c34209'
readonly MUTATION_LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly MUTATION_LOCK="$MUTATION_LOCK_ROOT/mutation.lock"
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly CONFIRMATION='I-UNDERSTAND-THIS-REPLACES-ONLY-THE-PRODUCTION-GATEWAY-WITH-NO-MONEY'

export PATH="$SAFE_PATH"
umask 077

die() {
  printf 'FetanAgent H19 production-ingress guard failed closed: %s\n' "$1" >&2
  exit 1
}

docker_local() {
  env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    docker --host "$LOCAL_DOCKER_SOCKET" "$@"
}

require_installed_self() {
  [[ "$0" == "$INSTALLED_PATH" && ! -L "$INSTALLED_PATH" && -f "$INSTALLED_PATH" &&
    "$(realpath -- "$INSTALLED_PATH")" == "$INSTALLED_PATH" &&
    "$(stat --format='%U:%G:%a:%h' "$INSTALLED_PATH")" == 'root:root:755:1' ]] ||
    return 1
}

require_exact_droplet() {
  [[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 "$METADATA/id")" == \
      "$EXPECTED_DROPLET_ID" &&
    "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
      "$METADATA/interfaces/public/0/ipv4/address")" == "$EXPECTED_PUBLIC_IPV4" ]]
}

read_h19_record_v19() {
  local output
  output="$(env -i PATH="$SAFE_PATH" python3 -I - \
    "$H19_PARENT" "$STAGING_HELPER" "$CONTINUOUS_FINALIZER" \
    "$CONTINUOUS_SUDOERS" "$INSTALLED_PATH" <<'PY'
import hashlib
import os
import re
import stat
import sys

parent, helper, finalizer, sudoers, guard = sys.argv[1:]
release_re = re.compile(r'[0-9a-f]{40}')
sha_re = re.compile(r'[0-9a-f]{64}')
protected = '69be82ac3e49ff8c63c64c9aa7926e0046b48a10'
baseline_caddy = '181992c8958397d63a7ae34137d51d4186ce0383c8cfd2bf8df137da11e12f24'
candidate_caddy = 'afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616'
predecessor_helper = '3adb799d17c3f51e2f6c49957d3a170e63151c30509962acdaf08c105dc65267'
predecessor_finalizer = '103b40c6ef76cca08e92bb5b475104f775b054b3981c5bb55057a085126745ea'
predecessor_sudoers = 'd33645e4767102a64463d27d90b63685dd71d1352fb175eb64a738a06b21f958'

def exact_file(path, mode, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        named = os.lstat(path)
        if (not stat.S_ISREG(before.st_mode)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
               != (0, 0, mode, 1)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or before.st_size <= 0 or before.st_size > maximum
            or os.path.realpath(path) != path):
            raise RuntimeError()
        data = os.pread(fd, maximum + 1, 0)
        after = os.fstat(fd)
        named_after = os.lstat(path)
        if (len(data) != before.st_size
            or (before.st_dev, before.st_ino, before.st_mode, before.st_uid,
                before.st_gid, before.st_nlink, before.st_size, before.st_mtime_ns)
               != (after.st_dev, after.st_ino, after.st_mode, after.st_uid,
                   after.st_gid, after.st_nlink, after.st_size, after.st_mtime_ns)
            or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)):
            raise RuntimeError()
        return data
    finally:
        os.close(fd)

def exact_dir(path, entries):
    value = os.lstat(path)
    if (not stat.S_ISDIR(value.st_mode)
        or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(path) != path or sorted(os.listdir(path)) != entries):
        raise RuntimeError()

try:
    children = os.listdir(parent)
    if len(children) != 1 or release_re.fullmatch(children[0]) is None:
        raise RuntimeError()
    release = children[0]
    root = f'{parent}/{release}'
    exact_dir(parent, [release])
    exact_dir(root, ['completed-v1', 'intent-v1', 'predecessor-continuous-finalizer',
                     'predecessor-continuous-sudoers', 'predecessor-helper'])
    intent_data = exact_file(f'{root}/intent-v1', 0o600, 4096)
    completed_data = exact_file(f'{root}/completed-v1', 0o600, 4096)
    archived_helper = exact_file(f'{root}/predecessor-helper', 0o400, 2 * 1024 * 1024)
    archived_finalizer = exact_file(
        f'{root}/predecessor-continuous-finalizer', 0o400, 2 * 1024 * 1024)
    archived_sudoers = exact_file(
        f'{root}/predecessor-continuous-sudoers', 0o400, 64 * 1024)
    intent = intent_data.decode('ascii').splitlines()
    completed = completed_data.decode('ascii').splitlines()
    candidate = intent[3].split('=', 1)[1] if len(intent) > 3 else ''
    h18_release = intent[4].split('=', 1)[1] if len(intent) > 4 else ''
    helper_sha = intent[6].split('=', 1)[1] if len(intent) > 6 else ''
    finalizer_sha = intent[8].split('=', 1)[1] if len(intent) > 8 else ''
    sudoers_sha = intent[10].split('=', 1)[1] if len(intent) > 10 else ''
    guard_sha = intent[11].split('=', 1)[1] if len(intent) > 11 else ''
    h18_intent_sha = intent[12].split('=', 1)[1] if len(intent) > 12 else ''
    h18_completion_sha = intent[13].split('=', 1)[1] if len(intent) > 13 else ''
    stopped_staging_sha = intent[14].split('=', 1)[1] if len(intent) > 14 else ''
    baseline_production_sha = intent[15].split('=', 1)[1] if len(intent) > 15 else ''
    baseline_ingress_sha = intent[16].split('=', 1)[1] if len(intent) > 16 else ''
    baseline_tls_sha = intent[17].split('=', 1)[1] if len(intent) > 17 else ''
    expected_tail = [
        f'baseline_gateway_caddyfile_sha256={baseline_caddy}',
        f'candidate_gateway_caddyfile_sha256={candidate_caddy}',
        'staging_runtime_stopped=true',
        'shared_ingress_network=fetanagent-telebirr-device-ingress',
        'shared_ingress_network_id=5b3dc890fad4f062ac570e4bbc66f950d002b536843b2630473eb817537af738',
        f'protected_production_release={protected}',
        'accepted_production_ingress_states=baseline-or-reviewed-gateway-only',
        'continuous_pair_rotated=true',
        'production_runtime_mutation=false',
        'database_mutation=false',
        'financial_actions_mode=disabled',
        'transfer_enabled=false',
        'amount_enabled=false',
        'money_moved=false',
    ]
    if (len(intent) != 32 or len(completed) != 33
        or intent[0] != 'contract=fetanagent-staging-telebirr-route-helper-bridge-v19'
        or intent[1] != 'state=authorized'
        or intent[2] != f'bridge_release={release}'
        or not intent[3].startswith('candidate_gateway_release=')
        or release_re.fullmatch(candidate) is None or candidate != release or candidate == protected
        or not intent[4].startswith('h18_bridge_release=')
        or release_re.fullmatch(h18_release) is None
        or h18_release in (protected, release, candidate)
        or intent[5] != f'predecessor_helper_sha256={predecessor_helper}'
        or not intent[6].startswith('successor_helper_sha256=')
        or sha_re.fullmatch(helper_sha) is None or helper_sha == predecessor_helper
        or intent[7] != f'predecessor_continuous_finalizer_sha256={predecessor_finalizer}'
        or not intent[8].startswith('successor_continuous_finalizer_sha256=')
        or sha_re.fullmatch(finalizer_sha) is None or finalizer_sha == predecessor_finalizer
        or intent[9] != f'predecessor_continuous_sudoers_sha256={predecessor_sudoers}'
        or not intent[10].startswith('successor_continuous_sudoers_sha256=')
        or sha_re.fullmatch(sudoers_sha) is None or sudoers_sha == predecessor_sudoers
        or not intent[11].startswith('ingress_guard_sha256=')
        or sha_re.fullmatch(guard_sha) is None
        or not intent[12].startswith('h18_bridge_intent_sha256=')
        or sha_re.fullmatch(h18_intent_sha) is None
        or not intent[13].startswith('h18_bridge_completion_sha256=')
        or sha_re.fullmatch(h18_completion_sha) is None
        or not intent[14].startswith('stopped_staging_boundary_sha256=')
        or sha_re.fullmatch(stopped_staging_sha) is None
        or not intent[15].startswith('baseline_production_boundary_sha256=')
        or sha_re.fullmatch(baseline_production_sha) is None
        or not intent[16].startswith('baseline_shared_ingress_boundary_sha256=')
        or sha_re.fullmatch(baseline_ingress_sha) is None
        or not intent[17].startswith('baseline_tls_leaf_sha256=')
        or sha_re.fullmatch(baseline_tls_sha) is None
        or intent[18:] != expected_tail
        or completed[0] != intent[0] or completed[1] != 'state=route-helper-pair-installed'
        or completed[2:32] != intent[2:32]
        or completed[32] != f'bridge_intent_sha256={hashlib.sha256(intent_data).hexdigest()}'
        or completed_data != ('\n'.join(completed) + '\n').encode('ascii')
        or hashlib.sha256(archived_helper).hexdigest() != predecessor_helper
        or hashlib.sha256(archived_finalizer).hexdigest() != predecessor_finalizer
        or hashlib.sha256(archived_sudoers).hexdigest() != predecessor_sudoers):
        raise RuntimeError()
    installed = [(helper, 0o755, helper_sha, 2 * 1024 * 1024),
                 (finalizer, 0o755, finalizer_sha, 2 * 1024 * 1024),
                 (sudoers, 0o440, sudoers_sha, 64 * 1024),
                 (guard, 0o755, guard_sha, 2 * 1024 * 1024)]
    if any(hashlib.sha256(exact_file(path, mode, maximum)).hexdigest() != digest
           for path, mode, digest, maximum in installed):
        raise RuntimeError()
    print(release)
    print(candidate)
    print(helper_sha)
    print(finalizer_sha)
    print(sudoers_sha)
    print(guard_sha)
    print(h18_release)
    print(h18_intent_sha)
    print(h18_completion_sha)
    print(baseline_production_sha)
    print(baseline_ingress_sha)
    print(baseline_tls_sha)
    print(hashlib.sha256(intent_data).hexdigest())
    print(hashlib.sha256(completed_data).hexdigest())
except Exception:
    raise SystemExit(1)
PY
)" || return 1
  mapfile -t H19_RECORD <<<"$output"
  [[ "${#H19_RECORD[@]}" -eq 14 && "${H19_RECORD[0]}" =~ ^[0-9a-f]{40}$ &&
    "${H19_RECORD[1]}" =~ ^[0-9a-f]{40}$ ]] || return 1
  local value
  for value in "${H19_RECORD[@]:2}"; do
    [[ "$value" =~ ^[0-9a-f]{64}$ || "$value" =~ ^[0-9a-f]{40}$ ]] || return 1
  done
}

read_h19_record() {
  local output
  output="$(env -i PATH="$SAFE_PATH" python3 -I - \
    "$H19_PARENT" "$H20_PARENT" "$STAGING_HELPER" "$CONTINUOUS_FINALIZER" \
    "$CONTINUOUS_SUDOERS" "$INSTALLED_PATH" <<'PY'
import hashlib
import os
import re
import stat
import sys

h19_parent, h20_parent, helper, finalizer, sudoers, guard = sys.argv[1:]
release_re = re.compile(r'[0-9a-f]{40}')
sha_re = re.compile(r'[0-9a-f]{64}')
protected = '69be82ac3e49ff8c63c64c9aa7926e0046b48a10'
h19_release = '90b1f059577682b6bc458d239f6bdcb591077085'
h19_intent_sha = '51e0f03017e8986d5bd76bbb97759437d86011ce448c34999ef1bb9836d056a3'
h19_completion_sha = 'fdccf275bb43f95ea140411c0cee044a6c8e13d884dae640c64123936a8119d5'
h19_helper_sha = 'b4a5975f97be388b8862e8d21c207815f02708e6476fa5e79b795825b3a01381'
h19_finalizer_sha = 'a1951a5559ef735e507b762369861fd71fefbde518a415f8c928956f7e20df39'
h19_sudoers_sha = '5e92a8c42d6b44ae22fa837efc9b35e54033a00a1e830a7bad8de2d3382f3796'
h19_guard_sha = '13e6f430d1fb6e83736265055bed9569431403411e5d459fd86c1d32b00adced'
h18_helper_sha = '3adb799d17c3f51e2f6c49957d3a170e63151c30509962acdaf08c105dc65267'
h18_finalizer_sha = '103b40c6ef76cca08e92bb5b475104f775b054b3981c5bb55057a085126745ea'
h18_sudoers_sha = 'd33645e4767102a64463d27d90b63685dd71d1352fb175eb64a738a06b21f958'
stopped_sha = 'e6bc16831fd5172076bd02b655dfa1605cf622aa23bf576e1a28b8ee4e3502b5'
production_sha = '5dad1d4193f55450bb0b50c5132fd3ae91c64e6978cb6318bbfdbdb0846b7b00'
ingress_sha = 'c1161bba74e998ddc1282e23b7e269dcd4b552e0e39532d914ace73b1c05378a'
tls_sha = '2c6bbb0eea676963398ea39a76ed974c2863da72236de67be761d19197dd7fd8'
baseline_caddy = '181992c8958397d63a7ae34137d51d4186ce0383c8cfd2bf8df137da11e12f24'
candidate_caddy = 'afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616'


def exact_file(path, mode, maximum):
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
            or (
                before.st_dev, before.st_ino, before.st_mode, before.st_uid,
                before.st_gid, before.st_nlink, before.st_size, before.st_mtime_ns,
            )
            != (
                after.st_dev, after.st_ino, after.st_mode, after.st_uid,
                after.st_gid, after.st_nlink, after.st_size, after.st_mtime_ns,
            )
            or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)
        ):
            raise RuntimeError()
        return data
    finally:
        os.close(descriptor)


def exact_dir(path, entries):
    value = os.lstat(path)
    if (
        not stat.S_ISDIR(value.st_mode)
        or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(path) != path
        or sorted(os.listdir(path)) != entries
    ):
        raise RuntimeError()


def digest(data):
    return hashlib.sha256(data).hexdigest()


try:
    exact_dir(h19_parent, [h19_release])
    h19_root = f'{h19_parent}/{h19_release}'
    exact_dir(h19_root, [
        'completed-v1', 'intent-v1', 'predecessor-continuous-finalizer',
        'predecessor-continuous-sudoers', 'predecessor-helper',
    ])
    h19_intent_data = exact_file(f'{h19_root}/intent-v1', 0o600, 4096)
    h19_completion_data = exact_file(f'{h19_root}/completed-v1', 0o600, 4096)
    h19_archived_helper = exact_file(f'{h19_root}/predecessor-helper', 0o400, 2 * 1024 * 1024)
    h19_archived_finalizer = exact_file(
        f'{h19_root}/predecessor-continuous-finalizer', 0o400, 2 * 1024 * 1024
    )
    h19_archived_sudoers = exact_file(
        f'{h19_root}/predecessor-continuous-sudoers', 0o400, 64 * 1024
    )
    if (
        digest(h19_intent_data) != h19_intent_sha
        or digest(h19_completion_data) != h19_completion_sha
        or digest(h19_archived_helper) != h18_helper_sha
        or digest(h19_archived_finalizer) != h18_finalizer_sha
        or digest(h19_archived_sudoers) != h18_sudoers_sha
    ):
        raise RuntimeError()
    h19_intent = h19_intent_data.decode('ascii').splitlines()
    h18_release = h19_intent[4].split('=', 1)[1] if len(h19_intent) > 4 else ''
    h18_intent_sha = h19_intent[12].split('=', 1)[1] if len(h19_intent) > 12 else ''
    h18_completion_sha = h19_intent[13].split('=', 1)[1] if len(h19_intent) > 13 else ''
    if (
        release_re.fullmatch(h18_release) is None
        or sha_re.fullmatch(h18_intent_sha) is None
        or sha_re.fullmatch(h18_completion_sha) is None
    ):
        raise RuntimeError()

    h20_children = os.listdir(h20_parent)
    if len(h20_children) != 1 or release_re.fullmatch(h20_children[0]) is None:
        raise RuntimeError()
    h20_release = h20_children[0]
    if h20_release in (protected, h19_release):
        raise RuntimeError()
    exact_dir(h20_parent, [h20_release])
    h20_root = f'{h20_parent}/{h20_release}'
    exact_dir(h20_root, [
        'completed-v1', 'intent-v1', 'predecessor-continuous-finalizer',
        'predecessor-continuous-sudoers', 'predecessor-helper',
        'predecessor-ingress-guard',
    ])
    intent_data = exact_file(f'{h20_root}/intent-v1', 0o600, 4096)
    completion_data = exact_file(f'{h20_root}/completed-v1', 0o600, 4096)
    archived_helper = exact_file(f'{h20_root}/predecessor-helper', 0o400, 2 * 1024 * 1024)
    archived_finalizer = exact_file(
        f'{h20_root}/predecessor-continuous-finalizer', 0o400, 2 * 1024 * 1024
    )
    archived_sudoers = exact_file(
        f'{h20_root}/predecessor-continuous-sudoers', 0o400, 64 * 1024
    )
    archived_guard = exact_file(
        f'{h20_root}/predecessor-ingress-guard', 0o400, 2 * 1024 * 1024
    )
    intent = intent_data.decode('ascii').splitlines()
    completion = completion_data.decode('ascii').splitlines()
    successor_helper_sha = intent[8].split('=', 1)[1] if len(intent) > 8 else ''
    successor_finalizer_sha = intent[10].split('=', 1)[1] if len(intent) > 10 else ''
    successor_sudoers_sha = intent[12].split('=', 1)[1] if len(intent) > 12 else ''
    successor_guard_sha = intent[14].split('=', 1)[1] if len(intent) > 14 else ''
    expected = [
        'contract=fetanagent-h19-canonical-cap-guard-bridge-v20',
        'state=authorized',
        f'bridge_release={h20_release}',
        f'h19_bridge_release={h19_release}',
        f'candidate_gateway_release={h19_release}',
        f'h19_bridge_intent_sha256={h19_intent_sha}',
        f'h19_bridge_completion_sha256={h19_completion_sha}',
        f'predecessor_helper_sha256={h19_helper_sha}',
        f'successor_helper_sha256={successor_helper_sha}',
        f'predecessor_continuous_finalizer_sha256={h19_finalizer_sha}',
        f'successor_continuous_finalizer_sha256={successor_finalizer_sha}',
        f'predecessor_continuous_sudoers_sha256={h19_sudoers_sha}',
        f'successor_continuous_sudoers_sha256={successor_sudoers_sha}',
        f'predecessor_ingress_guard_sha256={h19_guard_sha}',
        f'successor_ingress_guard_sha256={successor_guard_sha}',
        f'stopped_staging_boundary_sha256={stopped_sha}',
        f'baseline_production_boundary_sha256={production_sha}',
        f'baseline_shared_ingress_boundary_sha256={ingress_sha}',
        f'baseline_tls_leaf_sha256={tls_sha}',
        f'baseline_gateway_caddyfile_sha256={baseline_caddy}',
        f'candidate_gateway_caddyfile_sha256={candidate_caddy}',
        'staging_runtime_stopped=true',
        'shared_ingress_network=fetanagent-telebirr-device-ingress',
        'shared_ingress_network_id=5b3dc890fad4f062ac570e4bbc66f950d002b536843b2630473eb817537af738',
        f'protected_production_release={protected}',
        'accepted_production_ingress_states=baseline-or-reviewed-gateway-only',
        'correction=docker-capability-canonicalization',
        'h19_terminal_evidence_preserved=true',
        'continuous_pair_rotated=true',
        'production_runtime_mutation=false',
        'database_mutation=false',
        'financial_actions_mode=disabled',
        'transfer_enabled=false',
        'amount_enabled=false',
        'money_moved=false',
    ]
    if (
        len(intent) != 35
        or len(completion) != 36
        or any(sha_re.fullmatch(value) is None for value in (
            successor_helper_sha, successor_finalizer_sha,
            successor_sudoers_sha, successor_guard_sha,
        ))
        or successor_helper_sha == h19_helper_sha
        or successor_finalizer_sha == h19_finalizer_sha
        or successor_sudoers_sha == h19_sudoers_sha
        or successor_guard_sha == h19_guard_sha
        or intent != expected
        or completion[0] != intent[0]
        or completion[1] != 'state=canonical-cap-guard-installed'
        or completion[2:35] != intent[2:35]
        or completion[35] != f'bridge_intent_sha256={digest(intent_data)}'
        or intent_data != ('\n'.join(intent) + '\n').encode('ascii')
        or completion_data != ('\n'.join(completion) + '\n').encode('ascii')
        or digest(archived_helper) != h19_helper_sha
        or digest(archived_finalizer) != h19_finalizer_sha
        or digest(archived_sudoers) != h19_sudoers_sha
        or digest(archived_guard) != h19_guard_sha
        or digest(exact_file(helper, 0o755, 2 * 1024 * 1024)) != successor_helper_sha
        or digest(exact_file(finalizer, 0o755, 2 * 1024 * 1024)) != successor_finalizer_sha
        or digest(exact_file(sudoers, 0o440, 64 * 1024)) != successor_sudoers_sha
        or digest(exact_file(guard, 0o755, 2 * 1024 * 1024)) != successor_guard_sha
    ):
        raise RuntimeError()
    print(h19_release)
    print(h19_release)
    print(successor_helper_sha)
    print(successor_finalizer_sha)
    print(successor_sudoers_sha)
    print(successor_guard_sha)
    print(h18_release)
    print(h18_intent_sha)
    print(h18_completion_sha)
    print(production_sha)
    print(ingress_sha)
    print(tls_sha)
    print(h19_intent_sha)
    print(h19_completion_sha)
except Exception:
    raise SystemExit(1)
PY
)" || return 1
  mapfile -t H19_RECORD <<<"$output"
  [[ "${#H19_RECORD[@]}" -eq 14 && "${H19_RECORD[0]}" =~ ^[0-9a-f]{40}$ &&
    "${H19_RECORD[1]}" =~ ^[0-9a-f]{40}$ ]] || return 1
  local value
  for value in "${H19_RECORD[@]:2}"; do
    [[ "$value" =~ ^[0-9a-f]{64}$ || "$value" =~ ^[0-9a-f]{40}$ ]] || return 1
  done
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
  local expected_gateway_release="$1" inspection
  [[ "$expected_gateway_release" == "$PROTECTED_RELEASE" ||
    "$expected_gateway_release" == "${H19_RECORD[1]}" ]] || return 1
  inspection="$(production_inspection)" || return 1
  jq -e --arg candidate "${H19_RECORD[1]}" --arg expected "$expected_gateway_release" \
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
          .Config.Labels["org.opencontainers.image.revision"] == $expected and
          ($expected == $protected or $expected == $candidate) and
          .Config.Labels["org.opencontainers.image.title"] == "fetanagent-gateway" and
          .Config.Image == ("fetanagent-gateway:" + ($expected[0:12])) and
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
          .Config.Labels["org.opencontainers.image.revision"] == $protected and
          .Config.Image == ("fetanagent-" +
            (if .Config.Labels["com.docker.compose.service"] ==
              "production-companion-device-bridge" then "companion-device-bridge"
             else .Config.Labels["com.docker.compose.service"] end) +
            ":" + ($protected[0:12])) and
          ([.Config.Env[] | select(startswith("FINANCIAL_ACTIONS_MODE="))] ==
            ["FINANCIAL_ACTIONS_MODE=dry_run"]) and
          ([.Config.Env[] | select(startswith("KEMERBET_EXECUTOR_ENABLED="))] ==
            ["KEMERBET_EXECUTOR_ENABLED=false"]) and
          ([.Config.Env[] | select(startswith("KEMERBET_FINAL_ACTION_ENABLED="))] ==
            ["KEMERBET_FINAL_ACTION_ENABLED=false"]) and
          .HostConfig.PortBindings == {}
        end)
      )
    ' <<<"$inspection" >/dev/null || return 1
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
  local ids inspection
  ids="$(production_container_ids)" || return 1
  [[ -n "$ids" ]] || return 1
  mapfile -t PRODUCTION_IDS <<<"$ids"
  inspection="$(docker_local container inspect "${PRODUCTION_IDS[@]}")" || return 1
  jq -e '
    map(select(.Config.Labels["com.docker.compose.service"] != "gateway")) as $nine |
    ($nine | length) == 9 and
    ($nine | map(.Config.Labels["com.docker.compose.service"]) | sort) == [
      "api", "beta-admission", "bot", "customer-web", "owner-control",
      "production-companion-device-bridge", "telebirr-assignment-broker",
      "telebirr-device-bridge", "telebirr-device-state-broker"
    ]
  ' <<<"$inspection" >/dev/null || return 1
  jq -S -c 'map(select(.Config.Labels["com.docker.compose.service"] != "gateway")) |
    sort_by(.Name)' <<<"$inspection" | sha256sum | awk '{print $1}'
}

shared_ingress_digest() {
  docker_local network inspect "$SHARED_NETWORK_ID" | jq -S -c '.[0]' |
    sha256sum | awk '{print $1}'
}

tls_leaf_digest() {
  local certificate
  certificate="$(printf '' | openssl s_client -connect device.fetanagent.com:443 \
    -servername device.fetanagent.com 2>/dev/null | openssl x509 -outform DER 2>/dev/null | \
    sha256sum | awk '{print $1}')" || return 1
  [[ "$certificate" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$certificate"
}

transition_state() {
  env -i PATH="$SAFE_PATH" python3 -I - "$TRANSITION_PARENT" "${H19_RECORD[1]}" <<'PY'
import os, stat, sys
parent, candidate = sys.argv[1:]
if not os.path.lexists(parent):
    print('absent'); raise SystemExit(0)
value = os.lstat(parent)
if (not stat.S_ISDIR(value.st_mode) or
    (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700) or
    os.path.realpath(parent) != parent):
    raise SystemExit(1)
entries = sorted(os.listdir(parent))
if entries == []:
    print('preparing')
elif entries == [f'.installing-{candidate}']:
    root = f'{parent}/.installing-{candidate}'
    root_value = os.lstat(root)
    if (not stat.S_ISDIR(root_value.st_mode) or
        (root_value.st_uid, root_value.st_gid, stat.S_IMODE(root_value.st_mode)) !=
            (0, 0, 0o700) or
        os.path.realpath(root) != root):
        raise SystemExit(1)
    names = sorted(os.listdir(root))
    if names in ([], ['intent-v1.installing']):
        print('preparing')
    elif names == ['intent-v1']:
        print('interrupted')
    elif names in (['completed-v1.installing', 'intent-v1'],
                    ['completed-v1', 'intent-v1']):
        print('completing')
    elif names in (['intent-v1', 'rolled-back-v1.installing'],
                    ['intent-v1', 'rolled-back-v1']):
        print('rolling-back')
    else:
        raise SystemExit(1)
elif entries == [candidate]:
    root = f'{parent}/{candidate}'
    root_value = os.lstat(root)
    if (not stat.S_ISDIR(root_value.st_mode) or
        (root_value.st_uid, root_value.st_gid, stat.S_IMODE(root_value.st_mode)) !=
            (0, 0, 0o700) or
        os.path.realpath(root) != root):
        raise SystemExit(1)
    names = sorted(os.listdir(root))
    if names == ['completed-v1', 'intent-v1']:
        print('completed')
    elif names == ['intent-v1', 'rolled-back-v1']:
        print('rolled-back')
    else:
        raise SystemExit(1)
else:
    raise SystemExit(1)
PY
}

require_transition_phase() {
  local operation="$1" state="$2"
  case "$operation:$state" in
    transition:absent|transition:preparing|transition:interrupted|transition:completing|\
rollback:interrupted|rollback:rolling-back) return 0 ;;
    *) return 1 ;;
  esac
}

require_recoverable_gateway_revision() {
  case "$1" in
    "$PROTECTED_RELEASE"|"${H19_RECORD[1]}"|missing) return 0 ;;
    *) return 1 ;;
  esac
}

read_interrupted_transition_intent() {
  local root="$TRANSITION_PARENT/.installing-${H19_RECORD[1]}"
  env -i PATH="$SAFE_PATH" python3 -I - "$TRANSITION_PARENT" "$root" \
    "${H19_RECORD[0]}" "${H19_RECORD[1]}" "${H19_RECORD[12]}" "${H19_RECORD[13]}" <<'PY'
import hashlib
import os
import re
import stat
import sys

parent, root, h19_release, candidate, h19_intent_sha, h19_completion_sha = sys.argv[1:]
sha = re.compile(r'[0-9a-f]{64}')
image = re.compile(r'sha256:[0-9a-f]{64}')

def exact_dir(path, entries):
    value = os.lstat(path)
    if (not stat.S_ISDIR(value.st_mode)
        or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(path) != path or sorted(os.listdir(path)) != entries):
        raise RuntimeError()

def exact_file(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        if (not stat.S_ISREG(before.st_mode)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
               != (0, 0, 0o600, 1)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or before.st_size <= 0 or before.st_size > 4096
            or os.path.realpath(path) != path):
            raise RuntimeError()
        data = os.pread(descriptor, 4097, 0)
        after = os.fstat(descriptor)
        named_after = os.lstat(path)
        if (len(data) != before.st_size
            or (before.st_dev, before.st_ino, before.st_mode, before.st_uid,
                before.st_gid, before.st_nlink, before.st_size, before.st_mtime_ns)
               != (after.st_dev, after.st_ino, after.st_mode, after.st_uid,
                   after.st_gid, after.st_nlink, after.st_size, after.st_mtime_ns)
            or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)):
            raise RuntimeError()
        return data
    finally:
        os.close(descriptor)

try:
    exact_dir(parent, [f'.installing-{candidate}'])
    root_value = os.lstat(root)
    names = sorted(os.listdir(root))
    allowed = [
        ['intent-v1'],
        ['completed-v1.installing', 'intent-v1'],
        ['completed-v1', 'intent-v1'],
        ['intent-v1', 'rolled-back-v1.installing'],
        ['intent-v1', 'rolled-back-v1'],
    ]
    if (not stat.S_ISDIR(root_value.st_mode)
        or (root_value.st_uid, root_value.st_gid, stat.S_IMODE(root_value.st_mode)) !=
            (0, 0, 0o700)
        or os.path.realpath(root) != root or names not in allowed):
        raise RuntimeError()
    intent_data = exact_file(f'{root}/intent-v1')
    intent = intent_data.decode('ascii').splitlines()
    if (len(intent) != 22
        or intent[0] != 'contract=fetanagent-production-gateway-staging-route-v1'
        or intent[1] != 'state=authorized'
        or intent[2] != f'h19_bridge_release={h19_release}'
        or intent[3] != f'candidate_gateway_release={candidate}'
        or not intent[4].startswith('candidate_gateway_image_id=')
        or image.fullmatch(intent[4].split('=', 1)[1]) is None
        or intent[5] != f'h19_bridge_intent_sha256={h19_intent_sha}'
        or intent[6] != f'h19_bridge_completion_sha256={h19_completion_sha}'
        or any(not intent[index].startswith(prefix)
               or sha.fullmatch(intent[index].split('=', 1)[1]) is None
               for index, prefix in [
                   (7, 'pre_production_boundary_sha256='),
                   (8, 'pre_immutable_nine_sha256='),
                   (9, 'pre_shared_ingress_sha256='),
                   (10, 'pre_tls_leaf_sha256='),
               ])
        or not intent[11].startswith('baseline_gateway_image_id=')
        or image.fullmatch(intent[11].split('=', 1)[1]) is None
        or intent[12:] != [
            'protected_production_release=69be82ac3e49ff8c63c64c9aa7926e0046b48a10',
            'baseline_gateway_caddyfile_sha256=181992c8958397d63a7ae34137d51d4186ce0383c8cfd2bf8df137da11e12f24',
            'candidate_gateway_caddyfile_sha256=afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616',
            'protected_compose_sha256=98d7e763754868ba978d5c042c722664a1c1aec6f85e9011410d74e5d5f1928c',
            'immutable_production_services=9',
            'shared_ingress_endpoint_count=2',
            'database_mutation=false',
            'financial_actions_mode=disabled',
            'transfer_enabled=false',
            'money_moved=false',
        ]
        or intent_data != ('\n'.join(intent) + '\n').encode('ascii')):
        raise RuntimeError()
    print(intent[4].split('=', 1)[1])
    for index in range(7, 11):
        print(intent[index].split('=', 1)[1])
    print(intent[11].split('=', 1)[1])
except Exception:
    raise SystemExit(1)
PY
}

require_transition_record() {
  local state="$1" root
  root="$TRANSITION_PARENT/${H19_RECORD[1]}"
  [[ "$state" == 'completed' || "$state" == 'rolled-back' ]] || return 1
  env -i PATH="$SAFE_PATH" python3 -I - "$root" "$state" \
    "${H19_RECORD[0]}" "${H19_RECORD[1]}" "${H19_RECORD[12]}" "${H19_RECORD[13]}" <<'PY'
import hashlib, os, re, stat, sys
root, state, h19_release, candidate, h19_intent_sha, h19_completion_sha = sys.argv[1:]
sha = re.compile(r'[0-9a-f]{64}')
image = re.compile(r'sha256:[0-9a-f]{64}')
terminal = 'completed-v1' if state == 'completed' else 'rolled-back-v1'
expected_state = 'candidate-gateway-installed' if state == 'completed' else 'baseline-gateway-restored'
def read(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        st = os.fstat(fd); named = os.lstat(path)
        if (not stat.S_ISREG(st.st_mode) or
            (st.st_uid,st.st_gid,stat.S_IMODE(st.st_mode),st.st_nlink)!=(0,0,0o600,1) or
            (st.st_dev,st.st_ino)!=(named.st_dev,named.st_ino) or st.st_size>4096 or
            os.path.realpath(path)!=path): raise RuntimeError()
        return os.pread(fd,4097,0)
    finally: os.close(fd)
try:
    value=os.lstat(root)
    if (not stat.S_ISDIR(value.st_mode) or
        (value.st_uid,value.st_gid,stat.S_IMODE(value.st_mode))!=(0,0,0o700) or
        os.path.realpath(root)!=root or sorted(os.listdir(root))!=['intent-v1',terminal]):
        raise RuntimeError()
    intent_data=read(f'{root}/intent-v1'); terminal_data=read(f'{root}/{terminal}')
    intent=intent_data.decode('ascii').splitlines(); result=terminal_data.decode('ascii').splitlines()
    baseline_image = intent[11].split('=',1)[1] if len(intent) > 11 else ''
    candidate_image = intent[4].split('=',1)[1] if len(intent) > 4 else ''
    expected_post_image = candidate_image if state == 'completed' else baseline_image
    if (len(intent)!=22 or len(result)!=27 or
        intent[0]!='contract=fetanagent-production-gateway-staging-route-v1' or
        intent[1]!='state=authorized' or intent[2]!=f'h19_bridge_release={h19_release}' or
        intent[3]!=f'candidate_gateway_release={candidate}' or
        not intent[4].startswith('candidate_gateway_image_id=') or image.fullmatch(intent[4].split('=',1)[1]) is None or
        intent[5]!=f'h19_bridge_intent_sha256={h19_intent_sha}' or
        intent[6]!=f'h19_bridge_completion_sha256={h19_completion_sha}' or
        any(not intent[i].startswith(prefix) or sha.fullmatch(intent[i].split('=',1)[1]) is None
            for i,prefix in [(7,'pre_production_boundary_sha256='),(8,'pre_immutable_nine_sha256='),
                             (9,'pre_shared_ingress_sha256='),(10,'pre_tls_leaf_sha256=')]) or
        not intent[11].startswith('baseline_gateway_image_id=') or
        image.fullmatch(baseline_image) is None or
        intent[12:]!=[
          'protected_production_release=69be82ac3e49ff8c63c64c9aa7926e0046b48a10',
          'baseline_gateway_caddyfile_sha256=181992c8958397d63a7ae34137d51d4186ce0383c8cfd2bf8df137da11e12f24',
          'candidate_gateway_caddyfile_sha256=afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616',
          'protected_compose_sha256=98d7e763754868ba978d5c042c722664a1c1aec6f85e9011410d74e5d5f1928c',
          'immutable_production_services=9', 'shared_ingress_endpoint_count=2',
          'database_mutation=false','financial_actions_mode=disabled','transfer_enabled=false',
          'money_moved=false'] or
        result[0]!=intent[0] or result[1]!=f'state={expected_state}' or
        result[2:22]!=intent[2:22] or
        any(not result[i].startswith(prefix) or sha.fullmatch(result[i].split('=',1)[1]) is None
             for i,prefix in [(22,'post_production_boundary_sha256='),
                              (23,'post_shared_ingress_sha256='),(24,'post_tls_leaf_sha256=')]) or
        result[25]!=f'post_gateway_image_id={expected_post_image}' or
        result[26]!=f'transition_intent_sha256={hashlib.sha256(intent_data).hexdigest()}' or
        intent_data!=('\n'.join(intent)+'\n').encode('ascii') or
        terminal_data!=('\n'.join(result)+'\n').encode('ascii')):
        raise RuntimeError()
    print(candidate_image); print(result[22].split('=',1)[1]);
    print(result[23].split('=',1)[1]); print(result[24].split('=',1)[1]);
    print(result[25].split('=',1)[1])
except Exception: raise SystemExit(1)
PY
}

require_current_state() {
  local expected="$1" caddy gateway_id production_digest ingress_digest state transition_data tls_digest
  protected_compose_source >/dev/null || return 1
  require_production_contract "$expected" || return 1
  require_shared_ingress || return 1
  caddy="$(gateway_caddy_sha256)" || return 1
  if [[ "$expected" == "$PROTECTED_RELEASE" ]]; then
    [[ "$caddy" == "$BASELINE_CADDY_SHA256" ]] || return 1
  else
    [[ "$expected" == "${H19_RECORD[1]}" && "$caddy" == "$CANDIDATE_CADDY_SHA256" ]] ||
      return 1
  fi
  state="$(transition_state)" || return 1
  production_digest="$(production_boundary_digest)" || return 1
  ingress_digest="$(shared_ingress_digest)" || return 1
  tls_digest="$(tls_leaf_digest)" || return 1
  gateway_id="$(gateway_image_id)" || return 1
  case "$expected:$state" in
    "$PROTECTED_RELEASE:absent")
      [[ "$production_digest" == "${H19_RECORD[9]}" &&
        "$ingress_digest" == "${H19_RECORD[10]}" &&
        "$tls_digest" == "${H19_RECORD[11]}" ]] || return 1
      ;;
    "$PROTECTED_RELEASE:rolled-back"|"${H19_RECORD[1]}:completed")
      transition_data="$(require_transition_record "$state")" || return 1
      mapfile -t TRANSITION_RECORD <<<"$transition_data"
      [[ "${#TRANSITION_RECORD[@]}" -eq 5 &&
        "$production_digest" == "${TRANSITION_RECORD[1]}" &&
        "$ingress_digest" == "${TRANSITION_RECORD[2]}" &&
        "$tls_digest" == "${TRANSITION_RECORD[3]}" &&
        "$gateway_id" == "${TRANSITION_RECORD[4]}" ]] || return 1
      ;;
    *) return 1 ;;
  esac
}

require_recorded_baseline() {
  local caddy ingress_digest production_digest tls_digest
  protected_compose_source >/dev/null || return 1
  require_production_contract "$PROTECTED_RELEASE" || return 1
  require_shared_ingress || return 1
  caddy="$(gateway_caddy_sha256)" || return 1
  [[ "$caddy" == "$BASELINE_CADDY_SHA256" ]] || return 1
  production_digest="$(production_boundary_digest)" || return 1
  ingress_digest="$(shared_ingress_digest)" || return 1
  tls_digest="$(tls_leaf_digest)" || return 1
  [[ "$production_digest" == "${H19_RECORD[9]}" &&
    "$ingress_digest" == "${H19_RECORD[10]}" &&
    "$tls_digest" == "${H19_RECORD[11]}" ]]
}

current_gateway_revision() {
  local ids inspection
  ids="$(docker_local container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PRODUCTION_PROJECT" \
    --filter 'label=com.docker.compose.service=gateway')" || return 1
  if [[ -z "$ids" ]]; then
    printf '%s' missing
    return
  fi
  [[ "$ids" =~ ^[0-9a-f]{64}$ ]] || return 1
  inspection="$(docker_local container inspect "$ids")" || return 1
  jq -er 'if length == 1 and
      (.[0].Config.Labels["org.opencontainers.image.revision"] | test("^[0-9a-f]{40}$"))
    then .[0].Config.Labels["org.opencontainers.image.revision"] else error("gateway") end' \
    <<<"$inspection"
}

ensure_preparing_namespace() {
  if [[ ! -e "$TRANSITION_PARENT" && ! -L "$TRANSITION_PARENT" ]]; then
    install -d -o root -g root -m 0700 "$TRANSITION_PARENT" || return 1
    sync -f "$(dirname -- "$TRANSITION_PARENT")" || return 1
  fi
  [[ ! -L "$TRANSITION_PARENT" && -d "$TRANSITION_PARENT" &&
    "$(realpath -- "$TRANSITION_PARENT")" == "$TRANSITION_PARENT" &&
    "$(stat --format='%U:%G:%a' "$TRANSITION_PARENT")" == 'root:root:700' ]] || return 1
  local entries installing="$TRANSITION_PARENT/.installing-${H19_RECORD[1]}"
  entries="$(find -P "$TRANSITION_PARENT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' |
    LC_ALL=C sort)" || return 1
  [[ -z "$entries" || "$entries" == ".installing-${H19_RECORD[1]}:d" ]] || return 1
  if [[ ! -e "$installing" && ! -L "$installing" ]]; then
    install -d -o root -g root -m 0700 "$installing" || return 1
    sync -f "$TRANSITION_PARENT" || return 1
  fi
  [[ ! -L "$installing" && -d "$installing" && "$(realpath -- "$installing")" == "$installing" &&
    "$(stat --format='%U:%G:%a' "$installing")" == 'root:root:700' ]] || return 1
  entries="$(find -P "$installing" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' |
    LC_ALL=C sort)" || return 1
  [[ -z "$entries" || "$entries" == 'intent-v1.installing:f' ]]
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

require_staging_absent() {
  local project inventory
  for project in fetanagent-staging-beta fetanagent-telebirr-device-pilot; do
    inventory="$(docker_local container ls --all --quiet --no-trunc \
      --filter "label=com.docker.compose.project=$project")" || return 1
    [[ -z "$inventory" ]] || return 1
  done
}

require_gateway_image() {
  local expected_id="$1" release="$2" caddy_sha="$3" tag="${2:0:12}" tag_policy="$4"
  local image_caddy inspection
  [[ "$expected_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  inspection="$(docker_local image inspect "fetanagent-gateway:$tag")" || return 1
  jq -e --arg id "$expected_id" --arg release "$release" --arg tag "$tag" \
    --arg tag_policy "$tag_policy" '
    length == 1 and .[0].Id == $id and .[0].Config.User == "10001:10001" and
    .[0].Config.Labels["org.opencontainers.image.revision"] == $release and
    .[0].Config.Labels["org.opencontainers.image.title"] == "fetanagent-gateway" and
    (if $tag_policy == "only" then .[0].RepoTags == [("fetanagent-gateway:"+$tag)]
     else (.[0].RepoTags | index("fetanagent-gateway:"+$tag)) != null end) and
    .[0].Config.Entrypoint == null and
    .[0].Config.Cmd == ["caddy","run","--config","/etc/caddy/Caddyfile","--adapter","caddyfile"]
  ' <<<"$inspection" >/dev/null || return 1
  docker_local run --rm --network none --read-only --cap-drop ALL --cap-add NET_BIND_SERVICE \
    --security-opt no-new-privileges:true "$expected_id" \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || return 1
  image_caddy="$(docker_local run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --entrypoint cat "$expected_id" \
    /etc/caddy/Caddyfile | sha256sum | awk '{print $1}')" || return 1
  [[ "$image_caddy" == "$caddy_sha" ]]
}

require_candidate_image() {
  require_gateway_image "$1" "${H19_RECORD[1]}" "$CANDIDATE_CADDY_SHA256" only
}

require_baseline_image() {
  require_gateway_image "$1" "$PROTECTED_RELEASE" "$BASELINE_CADDY_SHA256" present
}

protected_compose_source() {
  local base="$PRODUCTION_RELEASE_ROOT/$PROTECTED_RELEASE" compose signer
  compose="$base/compose.production.yaml"
  signer="$base/telebirr-assignment-signer-key-id"
  [[ ! -L "$base" && -d "$base" && "$(realpath -- "$base")" == "$base" &&
    "$(stat --format='%U:%G:%a' "$base")" == 'root:root:700' &&
    ! -L "$base/.release-sha" && -f "$base/.release-sha" &&
    "$(realpath -- "$base/.release-sha")" == "$base/.release-sha" &&
    "$(stat --format='%U:%G:%a:%h' "$base/.release-sha")" == 'root:root:444:1' &&
    "$(<"$base/.release-sha")" == "$PROTECTED_RELEASE" &&
    ! -L "$base/.image-tag" && -f "$base/.image-tag" &&
    "$(realpath -- "$base/.image-tag")" == "$base/.image-tag" &&
    "$(stat --format='%U:%G:%a:%h' "$base/.image-tag")" == 'root:root:444:1' &&
    "$(<"$base/.image-tag")" == "${PROTECTED_RELEASE:0:12}" &&
    ! -L "$compose" && -f "$compose" && "$(realpath -- "$compose")" == "$compose" &&
    "$(stat --format='%U:%G:%a:%h' "$compose")" == 'root:root:444:1' &&
    "$(sha256sum -- "$compose" | awk '{print $1}')" == "$PROTECTED_COMPOSE_SHA256" &&
    ! -L "$signer" && -f "$signer" && "$(realpath -- "$signer")" == "$signer" &&
    "$(stat --format='%U:%G:%a:%h' "$signer")" == 'root:root:444:1' ]] || return 1
  signer="$(<"$signer")" || return 1
  [[ "$signer" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$ ]] || return 1
  printf '%s\n%s\n' "$base" "$signer"
}

compose_gateway() {
  local release="$1" source tag
  local -a source_lines=()
  [[ "$release" == "$PROTECTED_RELEASE" || "$release" == "${H19_RECORD[1]}" ]] || return 1
  mapfile -t source_lines < <(protected_compose_source) || return 1
  [[ "${#source_lines[@]}" -eq 2 ]] || return 1
  local base="${source_lines[0]}" signer="${source_lines[1]}"
  tag="${release:0:12}"
  env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    FETANAGENT_IMAGE_TAG="$tag" FETANAGENT_PRODUCTION_SECRET_DIR="$base/secrets" \
    FETANAGENT_TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID="$signer" \
    docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null \
      --project-name "$PRODUCTION_PROJECT" --file "$base/compose.production.yaml" \
      --profile production up --detach --no-deps --no-build --wait --wait-timeout 90 gateway
}

publish_transition_record() {
  local root="$1" name="$2" state="$3" image_id="$4" pre_production="$5"
  local pre_immutable="$6" pre_ingress="$7" pre_tls="$8"
  local baseline_gateway_image_id="${9}" post_production="${10}" post_ingress="${11}"
  local post_tls="${12}" post_gateway_image_id="${13}"
  local h19_intent="${H19_RECORD[12]}"
  local h19_completion="${H19_RECORD[13]}" intent_sha
  expected_transition_intent() {
    printf '%s\n' \
      'contract=fetanagent-production-gateway-staging-route-v1' \
      'state=authorized' \
      "h19_bridge_release=${H19_RECORD[0]}" \
      "candidate_gateway_release=${H19_RECORD[1]}" \
      "candidate_gateway_image_id=$image_id" \
      "h19_bridge_intent_sha256=$h19_intent" \
      "h19_bridge_completion_sha256=$h19_completion" \
      "pre_production_boundary_sha256=$pre_production" \
      "pre_immutable_nine_sha256=$pre_immutable" \
      "pre_shared_ingress_sha256=$pre_ingress" \
      "pre_tls_leaf_sha256=$pre_tls" \
      "baseline_gateway_image_id=$baseline_gateway_image_id" \
      "protected_production_release=$PROTECTED_RELEASE" \
      "baseline_gateway_caddyfile_sha256=$BASELINE_CADDY_SHA256" \
      "candidate_gateway_caddyfile_sha256=$CANDIDATE_CADDY_SHA256" \
      "protected_compose_sha256=$PROTECTED_COMPOSE_SHA256" \
      'immutable_production_services=9' \
      'shared_ingress_endpoint_count=2' \
      'database_mutation=false' \
      'financial_actions_mode=disabled' \
      'transfer_enabled=false' \
      'money_moved=false'
  }
  if [[ "$name" == 'intent-v1' ]]; then
    expected_transition_intent | reconcile_atomic_file "$root/$name" 0600
  else
    intent_sha="$(expected_transition_intent | sha256sum | awk '{print $1}')"
    expected_transition_intent | awk -v state="$state" \
      'NR == 2 { print "state=" state; next } { print }' |
      { cat; printf '%s\n' \
        "post_production_boundary_sha256=$post_production" \
        "post_shared_ingress_sha256=$post_ingress" \
        "post_tls_leaf_sha256=$post_tls" \
        "post_gateway_image_id=$post_gateway_image_id" \
        "transition_intent_sha256=$intent_sha"; } | reconcile_atomic_file "$root/$name" 0600
  fi
}

reconcile_atomic_file() {
  local target="$1" mode="$2"
  [[ "$mode" == 0600 ]] || return 1
  env -i PATH="$SAFE_PATH" python3 -I - "$target" "$mode" 3<&0 <<'PY'
import os, stat, sys
target, mode_text = sys.argv[1:]
mode = int(mode_text, 8)
temporary = f'{target}.installing'
expected = bytearray()
while len(expected) <= 8192:
    chunk = os.read(3, 8193 - len(expected))
    if not chunk:
        break
    expected.extend(chunk)
expected = bytes(expected)
if not expected or len(expected) > 8192 or not expected.endswith(b'\n'):
    raise SystemExit(1)

def exact_directory(path):
    value = os.lstat(path)
    if (not stat.S_ISDIR(value.st_mode)
        or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(path) != path):
        raise RuntimeError()

def open_existing(path, prefix, writable=False):
    flags = (os.O_RDWR if writable else os.O_RDONLY) | os.O_NOFOLLOW | os.O_CLOEXEC
    descriptor = os.open(path, flags)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        if (not stat.S_ISREG(before.st_mode)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
               != (0, 0, mode, 1)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or before.st_size > len(expected) or os.path.realpath(path) != path):
            raise RuntimeError()
        data = os.pread(descriptor, len(expected) + 1, 0)
        after = os.fstat(descriptor)
        named_after = os.lstat(path)
        if (len(data) != before.st_size
            or (before.st_dev, before.st_ino, before.st_mode, before.st_uid,
                before.st_gid, before.st_nlink, before.st_size, before.st_mtime_ns)
               != (after.st_dev, after.st_ino, after.st_mode, after.st_uid,
                   after.st_gid, after.st_nlink, after.st_size, after.st_mtime_ns)
            or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)
            or (expected[:len(data)] != data if prefix else expected != data)):
            raise RuntimeError()
        return descriptor, data
    except Exception:
        os.close(descriptor)
        raise

try:
    parent = os.path.dirname(target)
    exact_directory(parent)
    if os.path.lexists(target):
        if os.path.lexists(temporary):
            raise RuntimeError()
        descriptor, _ = open_existing(target, False)
        os.close(descriptor)
        raise SystemExit(0)
    if os.path.lexists(temporary):
        descriptor, existing = open_existing(temporary, True, True)
    else:
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            mode,
        )
        os.fchmod(descriptor, mode)
        existing = b''
    try:
        offset = len(existing)
        while offset < len(expected):
            count = os.pwrite(descriptor, expected[offset:], offset)
            if count <= 0:
                raise RuntimeError()
            offset += count
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.rename(temporary, target)
    directory = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
except SystemExit:
    raise
except Exception:
    raise SystemExit(1)
PY
}

public_smoke() {
  local expected="$1" body code version
  body="$(curl --fail --silent --show-error --proto '=https' --tlsv1.2 --max-time 15 \
    https://owner.fetanagent.com/owner)" || return 1
  grep -Fqi 'production' <<<"$body" || return 1
  version="$(curl --silent --show-error --output /dev/null --proto '=https' --tlsv1.2 \
    --max-time 15 --write-out '%{http_version}' https://device.fetanagent.com/)" || return 1
  [[ "$version" == '1.1' || "$version" == '2' ]] || return 1
  code="$(curl --silent --show-error --output /dev/null --proto '=https' --tlsv1.2 --max-time 15 \
    --write-out '%{http_code}' https://device.fetanagent.com/)" || return 1
  [[ "$code" == '404' ]] || return 1
  code="$(curl --silent --show-error --output /dev/null --proto '=https' --tlsv1.2 --max-time 15 \
    --request POST --header 'Content-Type: application/vnd.fetanagent.telebirr-device-bridge+json' \
    --data '{}' --write-out '%{http_code}' \
    https://device.fetanagent.com/v1/telebirr/device/heartbeat)" || return 1
  [[ "$code" == '400' ]] || return 1
  if [[ "$expected" == "${H19_RECORD[1]}" ]]; then
    code="$(curl --silent --show-error --output /dev/null --proto '=https' --tlsv1.2 --max-time 15 \
      --request POST --header 'X-FetanAgent-Deployment-Target: staging' \
      --header 'Content-Type: application/vnd.fetanagent.telebirr-device-bridge+json' \
      --data '{}' --write-out '%{http_code}' \
      https://device.fetanagent.com/v1/telebirr/device/heartbeat)" || return 1
    [[ "$code" == '502' || "$code" == '503' ]] || return 1
    code="$(curl --silent --show-error --output /dev/null --proto '=https' --tlsv1.2 --max-time 15 \
      --request POST --header 'X-FetanAgent-Deployment-Target: production' \
      --header 'Content-Type: application/vnd.fetanagent.telebirr-device-bridge+json' \
      --data '{}' --write-out '%{http_code}' \
      https://device.fetanagent.com/v1/telebirr/device/heartbeat)" || return 1
    [[ "$code" == '400' ]] || return 1
    code="$(curl --silent --show-error --output /dev/null --proto '=https' --tlsv1.2 --max-time 15 \
      --request POST --header 'X-FetanAgent-Deployment-Target: Staging' \
      --header 'Content-Type: application/vnd.fetanagent.telebirr-device-bridge+json' \
      --data '{}' --write-out '%{http_code}' \
      https://device.fetanagent.com/v1/telebirr/device/heartbeat)" || return 1
    [[ "$code" == '404' ]] || return 1
    code="$(curl --silent --show-error --output /dev/null --proto '=https' --tlsv1.2 --max-time 15 \
      --request POST --header 'X-FetanAgent-Deployment-Target: staging' \
      --header 'X-FetanAgent-Deployment-Target: staging' \
      --header 'Content-Type: application/vnd.fetanagent.telebirr-device-bridge+json' \
      --data '{}' --write-out '%{http_code}' \
      https://device.fetanagent.com/v1/telebirr/device/heartbeat)" || return 1
    [[ "$code" == '404' ]] || return 1
  fi
}

[[ $EUID -eq 0 ]] || die 'root execution is required'
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || die 'Docker overrides are forbidden'
require_installed_self || die 'run only the root-owned installed H19 ingress guard'
require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'
read_h19_record || die 'the completed H19 provenance and installed release pair are invalid'

mode="${1:-}"
case "$mode" in
  record)
    [[ $# -eq 1 && ( -z "${SUDO_USER:-}" || "${SUDO_USER:-}" == 'fetanagent-admin' ) ]] ||
      die 'record inspection requires a trusted caller and no arguments'
    printf '%s\n' \
      'active' "${H19_RECORD[0]}" "${H19_RECORD[1]}" "${H19_RECORD[2]}" \
      '3adb799d17c3f51e2f6c49957d3a170e63151c30509962acdaf08c105dc65267' \
      "${H19_RECORD[6]}" "${H19_RECORD[7]}" "${H19_RECORD[8]}" \
      "${H19_RECORD[3]}" "${H19_RECORD[4]}" "${H19_RECORD[5]}"
    ;;
  inspect)
    [[ $# -eq 2 && ( -z "${SUDO_USER:-}" || "${SUDO_USER:-}" == 'fetanagent-admin' ) ]] ||
      die 'inspect requires one expected gateway release and a trusted caller'
    require_current_state "$2" || die 'the production ingress is outside its one exact accepted state'
    printf 'H19 production ingress verified: gateway=%s; protected bridge=%s; money moved=false.\n' \
      "$2" "$PROTECTED_RELEASE"
    ;;
  transition)
    [[ $# -eq 4 && -z "${SUDO_USER:-}" && "$4" == "$CONFIRMATION" ]] ||
      die 'transition requires direct root, candidate release, image ID, and exact confirmation'
    [[ "$2" == "${H19_RECORD[1]}" ]] || die 'the candidate release is not the H19-sealed release'
    image_id="$3"
    open_lock || die 'the shared staging mutation lock is unavailable'
    require_staging_absent || die 'staging and the device pilot must be stopped'
    state="$(transition_state)" || die 'the gateway transition namespace is invalid'
    require_transition_phase transition "$state" ||
      die 'the gateway transition is already terminal'
    require_candidate_image "$image_id" || die 'the candidate gateway image is not exact'
    if [[ "$state" == 'absent' || "$state" == 'preparing' ]]; then
      require_recorded_baseline || die 'H19 transition must begin at the sealed baseline'
      pre_production="$(production_boundary_digest)"
      pre_immutable="$(immutable_nine_digest)"
      pre_ingress="$(shared_ingress_digest)"
      pre_tls="$(tls_leaf_digest)"
      baseline_gateway_image_id="$(gateway_image_id)"
      require_baseline_image "$baseline_gateway_image_id" ||
        die 'the protected rollback image is not exact'
      ensure_preparing_namespace || die 'the resumable transition namespace could not be prepared'
      installing="$TRANSITION_PARENT/.installing-${H19_RECORD[1]}"
      publish_transition_record "$installing" intent-v1 authorized "$image_id" \
        "$pre_production" "$pre_immutable" "$pre_ingress" "$pre_tls" \
        "$baseline_gateway_image_id" '' '' '' ''
      state='interrupted'
    fi
    installing="$TRANSITION_PARENT/.installing-${H19_RECORD[1]}"
    transition_data="$(read_interrupted_transition_intent)" ||
      die 'the interrupted transition intent is not exact'
    mapfile -t intent <<<"$transition_data"
    [[ "${#intent[@]}" -eq 6 && "${intent[0]}" == "$image_id" ]] ||
      die 'the requested image ID does not match the sealed interrupted transition'
    pre_production="${intent[1]}"
    pre_immutable="${intent[2]}"
    pre_ingress="${intent[3]}"
    pre_tls="${intent[4]}"
    baseline_gateway_image_id="${intent[5]}"
    [[ "$(immutable_nine_digest)" == "$pre_immutable" ]] ||
      die 'an immutable production service changed during transition'
    current_gateway="$(current_gateway_revision)" || die 'the interrupted gateway identity is invalid'
    require_recoverable_gateway_revision "$current_gateway" ||
      die 'the interrupted gateway revision is neither exact baseline, candidate, nor absent'
    if [[ "$state" == completing ]]; then
      [[ "$current_gateway" == "${H19_RECORD[1]}" ]] ||
        die 'a completing transition no longer has the candidate gateway'
    elif ! require_production_contract "${H19_RECORD[1]}" ||
      [[ "$(gateway_image_id 2>/dev/null || true)" != "$image_id" ]] ||
      [[ "$(gateway_caddy_sha256 2>/dev/null || true)" != "$CANDIDATE_CADDY_SHA256" ]]; then
      compose_gateway "${H19_RECORD[1]}" || die 'the reviewed gateway could not be started'
    fi
    if [[ "$(current_gateway_revision)" != "${H19_RECORD[1]}" ]]; then
      die 'the interrupted gateway revision is neither exact baseline nor candidate'
    fi
    require_production_contract "${H19_RECORD[1]}" || die 'the candidate production contract is invalid'
    [[ "$(gateway_image_id)" == "$image_id" ]] ||
      die 'the candidate runtime did not use the H19-sealed image ID'
    require_shared_ingress || die 'the candidate shared-ingress endpoint set is invalid'
    [[ "$(gateway_caddy_sha256)" == "$CANDIDATE_CADDY_SHA256" ]] ||
      die 'the candidate gateway Caddyfile is not exact'
    [[ "$(immutable_nine_digest)" == "$pre_immutable" ]] ||
      die 'an immutable production service changed during cutover'
    [[ "$(tls_leaf_digest)" == "$pre_tls" ]] || die 'the public TLS leaf changed during cutover'
    public_smoke "${H19_RECORD[1]}" || die 'the candidate public route smoke failed'
    post_production="$(production_boundary_digest)"
    post_ingress="$(shared_ingress_digest)"
    post_tls="$(tls_leaf_digest)"
    post_gateway_image_id="$(gateway_image_id)"
    [[ "$post_gateway_image_id" == "$image_id" ]] ||
      die 'the terminal candidate image ID changed before receipt publication'
    publish_transition_record "$installing" completed-v1 candidate-gateway-installed "$image_id" \
      "$pre_production" "$pre_immutable" "$pre_ingress" "$pre_tls" "$baseline_gateway_image_id" \
      "$post_production" "$post_ingress" "$post_tls" "$post_gateway_image_id"
    [[ "$(transition_state)" == completing ]] ||
      die 'the candidate terminal receipt did not reach its exact resumable state'
    [[ ! -e "$TRANSITION_PARENT/${H19_RECORD[1]}" &&
      ! -L "$TRANSITION_PARENT/${H19_RECORD[1]}" ]] ||
      die 'the candidate terminal record appeared unexpectedly'
    mv -- "$installing" "$TRANSITION_PARENT/${H19_RECORD[1]}"
    sync -f "$TRANSITION_PARENT"
    require_current_state "${H19_RECORD[1]}" || die 'the completed candidate state did not re-attest'
    printf '%s\n' 'H19 gateway-only transition completed; production bridge and nine services unchanged; money moved=false.'
    ;;
  rollback)
    [[ $# -eq 2 && -z "${SUDO_USER:-}" && "$2" == "$CONFIRMATION" ]] ||
      die 'rollback requires direct root and the exact confirmation'
    open_lock || die 'the shared staging mutation lock is unavailable'
    require_staging_absent || die 'staging and the device pilot must be stopped'
    state="$(transition_state)" || die 'the gateway transition namespace is invalid'
    require_transition_phase rollback "$state" ||
      die 'only an interrupted or already-rolling-back transition can roll back'
    installing="$TRANSITION_PARENT/.installing-${H19_RECORD[1]}"
    transition_data="$(read_interrupted_transition_intent)" ||
      die 'the interrupted transition intent is malformed'
    mapfile -t intent <<<"$transition_data"
    [[ "${#intent[@]}" -eq 6 ]] || die 'the interrupted transition intent is incomplete'
    image_id="${intent[0]}"
    pre_production="${intent[1]}"
    pre_immutable="${intent[2]}"
    pre_ingress="${intent[3]}"
    pre_tls="${intent[4]}"
    baseline_gateway_image_id="${intent[5]}"
    [[ "$(immutable_nine_digest)" == "$pre_immutable" ]] ||
      die 'an immutable production service changed; rollback refused'
    require_baseline_image "$baseline_gateway_image_id" ||
      die 'the protected rollback image is not the image sealed before cutover'
    current_gateway="$(current_gateway_revision)" || die 'the interrupted gateway identity is invalid'
    require_recoverable_gateway_revision "$current_gateway" ||
      die 'the interrupted gateway revision is outside the rollback contract'
    if [[ "$state" == rolling-back ]]; then
      [[ "$current_gateway" == "$PROTECTED_RELEASE" ]] ||
        die 'a rolling-back transition no longer has the protected gateway'
    elif ! require_production_contract "$PROTECTED_RELEASE" ||
      [[ "$(gateway_image_id 2>/dev/null || true)" != "$baseline_gateway_image_id" ]] ||
      [[ "$(gateway_caddy_sha256 2>/dev/null || true)" != "$BASELINE_CADDY_SHA256" ]]; then
      compose_gateway "$PROTECTED_RELEASE" || die 'the protected gateway could not be restored'
    fi
    require_production_contract "$PROTECTED_RELEASE" || die 'the restored baseline contract is invalid'
    require_shared_ingress || die 'the restored shared-ingress endpoint set is invalid'
    [[ "$(gateway_caddy_sha256)" == "$BASELINE_CADDY_SHA256" &&
      "$(immutable_nine_digest)" == "$pre_immutable" && "$(tls_leaf_digest)" == "$pre_tls" ]] ||
      die 'the restored baseline did not preserve the protected boundary'
    public_smoke "$PROTECTED_RELEASE" || die 'the restored public route smoke failed'
    post_production="$(production_boundary_digest)"
    post_ingress="$(shared_ingress_digest)"
    post_tls="$(tls_leaf_digest)"
    post_gateway_image_id="$(gateway_image_id)"
    [[ "$post_gateway_image_id" == "$baseline_gateway_image_id" ]] ||
      die 'the restored gateway did not use the pre-cutover image ID'
    publish_transition_record "$installing" rolled-back-v1 baseline-gateway-restored "$image_id" \
      "$pre_production" "$pre_immutable" "$pre_ingress" "$pre_tls" "$baseline_gateway_image_id" \
      "$post_production" "$post_ingress" "$post_tls" "$post_gateway_image_id"
    [[ "$(transition_state)" == rolling-back ]] ||
      die 'the rollback terminal receipt did not reach its exact resumable state'
    [[ ! -e "$TRANSITION_PARENT/${H19_RECORD[1]}" &&
      ! -L "$TRANSITION_PARENT/${H19_RECORD[1]}" ]] ||
      die 'the rollback terminal record appeared unexpectedly'
    mv -- "$installing" "$TRANSITION_PARENT/${H19_RECORD[1]}"
    sync -f "$TRANSITION_PARENT"
    require_current_state "$PROTECTED_RELEASE" || die 'the rolled-back baseline did not re-attest'
    printf '%s\n' 'H19 gateway transition rolled back to the protected baseline; money moved=false.'
    ;;
  *) die 'expected record, inspect, transition, or rollback' ;;
esac
