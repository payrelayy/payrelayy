#!/usr/bin/env bash
# One-use, root-console-only migration from the failed v2 readiness binding to the
# stable-profile v3 successor. This script preserves the canonical retirement record
# and creates root-protected successor evidence; it never deletes the only binding.

set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly SOURCE_ROOT='/var/lib/fetanagent/kemerbet-readiness-seal-output'
readonly SOURCE="$SOURCE_ROOT/kemerbet_agent_identity_bindings"
readonly RETIREMENT_ROOT='/var/lib/fetanagent/kemerbet-readiness-binding-v1-retirement'
readonly RETIREMENT_INSTALLING="${RETIREMENT_ROOT}.installing"
readonly MIGRATION_PARENT='/var/lib/fetanagent/kemerbet-readiness-v2-v3-successor'
readonly SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.v2-v3-disabled'
readonly INSTALLING_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.v3-installing'
readonly INSTALLING_HELPER_PARTIAL='/usr/local/sbin/.fetanagent-staging-deploy-helper.v3-installing.partial'
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="$LOCK_ROOT/mutation.lock"
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly CONFIRMATION='I-UNDERSTAND-THIS-ARCHIVES-V2-AND-INSTALLS-THE-V3-SUCCESSOR'
readonly PROJECT_NAME='fetanagent-staging-beta'

export PATH="$SAFE_PATH"
umask 022

die() {
  printf 'FetanAgent v2-to-v3 successor migration failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 6 ]] ||
  die 'expected predecessor release, successor release, predecessor helper digest, v2 binding digest, successor helper digest, and exact confirmation'

readonly PREDECESSOR_RELEASE="$1"
readonly SUCCESSOR_RELEASE="$2"
readonly PREDECESSOR_HELPER_SHA256="$3"
readonly V2_BINDING_SHA256="$4"
readonly SUCCESSOR_HELPER_SHA256="$5"
readonly PROVIDED_CONFIRMATION="$6"
readonly STAGING_ROOT="/root/fetanagent-v3-successor-$SUCCESSOR_RELEASE"
readonly STAGED_HELPER="$STAGING_ROOT/fetanagent-staging-deploy-helper.next"
readonly MIGRATION_ROOT="$MIGRATION_PARENT/$SUCCESSOR_RELEASE"
readonly MIGRATION_INSTALLING="${MIGRATION_ROOT}.installing"
readonly MIGRATION_INTENT_NAME='intent-v1'
readonly MIGRATION_COMPLETION_NAME='completed-v1'
readonly V2_ARCHIVE_NAME='binding-v2'
readonly HELPER_ARCHIVE_NAME='predecessor-helper'
RETIREMENT_INTENT_SHA256=''
RETIREMENT_COMPLETION_SHA256=''

for value in "$PREDECESSOR_RELEASE" "$SUCCESSOR_RELEASE"; do
  [[ "$value" =~ ^[0-9a-f]{40}$ ]] || die 'release identities must be full lowercase Git commit SHAs'
done
[[ "$PREDECESSOR_RELEASE" != "$SUCCESSOR_RELEASE" ]] || die 'the successor must be a different reviewed release'
for value in "$PREDECESSOR_HELPER_SHA256" "$V2_BINDING_SHA256" "$SUCCESSOR_HELPER_SHA256"; do
  [[ "$value" =~ ^[0-9a-f]{64}$ ]] || die 'all reviewed artifact digests must be lowercase SHA-256 values'
done
[[ "$PROVIDED_CONFIRMATION" == "$CONFIRMATION" ]] || die 'the exact one-use migration confirmation is required'
[[ "$(id -u)" == '0' && "$(id -un)" == 'root' ]] || die 'run this operation only in the DigitalOcean root console'
[[ -z "${SUDO_USER:-}" && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'sudo and Docker environment overrides are forbidden'

for command in awk bash basename chmod cmp curl docker env find flock id install mkdir mv python3 realpath runuser sha256sum sort stat sudo sync visudo; do
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

require_helper_file() {
  local path="$1" expected_digest="$2" expected_mode="$3"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == "root:root:$expected_mode:1" &&
    "$(sha256sum -- "$path" | awk '{print $1}')" == "$expected_digest" ]] || return 1
  bash -n "$path"
}

require_no_helper_processes() {
  local argument cmdline found
  for cmdline in /proc/[0-9]*/cmdline; do
    [[ -r "$cmdline" ]] || continue
    found='false'
    while IFS= read -r -d '' argument; do
      if [[ "$argument" == "$TARGET" ]]; then
        found='true'
        break
      fi
    done <"$cmdline" || true
    [[ "$found" == 'false' ]] || return 1
  done
}

run_predecessor_helper() {
  runuser -u fetanagent-admin -- sudo -n "$TARGET" "$@"
}

require_migration_intent() {
  local root="$1" path="$1/$MIGRATION_INTENT_NAME"
  [[ ! -L "$root" && -d "$root" && "$(realpath -- "$root")" == "$root" &&
    "$(stat --format='%U:%G:%a' "$root")" == 'root:root:700' &&
    ! -L "$path" && -f "$path" && "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:600:1' ]] ||
    return 1
  cmp -s -- "$path" <(printf '%s\n' \
    'contract=fetanagent-kemerbet-readiness-v2-v3-successor-v1' \
    'state=authorized' \
    "predecessor_release=$PREDECESSOR_RELEASE" \
    "successor_release=$SUCCESSOR_RELEASE" \
    "predecessor_helper_sha256=$PREDECESSOR_HELPER_SHA256" \
    "successor_helper_sha256=$SUCCESSOR_HELPER_SHA256" \
    "v2_binding_sha256=$V2_BINDING_SHA256" \
    "retirement_intent_sha256=$RETIREMENT_INTENT_SHA256" \
    "retirement_completion_sha256=$RETIREMENT_COMPLETION_SHA256")
}

load_retirement_evidence_digests() {
  local completion="$RETIREMENT_ROOT/completed-v1" intent="$RETIREMENT_ROOT/intent-v1"
  [[ ! -L "$RETIREMENT_ROOT" && -d "$RETIREMENT_ROOT" &&
    "$(realpath -- "$RETIREMENT_ROOT")" == "$RETIREMENT_ROOT" &&
    "$(stat --format='%U:%G:%a' "$RETIREMENT_ROOT")" == 'root:root:700' ]] || return 1
  [[ "$(find -P "$RETIREMENT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" == \
    $'completed-v1\nintent-v1' ]] || return 1
  for path in "$intent" "$completion"; do
    [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
      "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:600:1' ]] || return 1
  done
  RETIREMENT_INTENT_SHA256="$(sha256sum -- "$intent" | awk '{print $1}')" || return 1
  RETIREMENT_COMPLETION_SHA256="$(sha256sum -- "$completion" | awk '{print $1}')" || return 1
  [[ "$RETIREMENT_INTENT_SHA256" =~ ^[0-9a-f]{64}$ &&
    "$RETIREMENT_COMPLETION_SHA256" =~ ^[0-9a-f]{64}$ ]]
}

require_migration_installing_prefix() {
  local root="$1"
  env -i PATH="$SAFE_PATH" python3 -I - "$root" <<'PY'
import os
import stat
import sys

root = sys.argv[1]
allowed = {
    '.binding-v2.installing': (0o400, 230),
    '.completed-v1.installing': (0o600, 2048),
    '.intent-v1.installing': (0o600, 2048),
    '.predecessor-helper.installing': (0o400, 2 * 1024 * 1024),
    'binding-v2': (0o400, 230),
    'completed-v1': (0o600, 2048),
    'intent-v1': (0o600, 2048),
    'predecessor-helper': (0o400, 2 * 1024 * 1024),
}
value = os.lstat(root)
if (
    not stat.S_ISDIR(value.st_mode)
    or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700)
    or os.path.realpath(root) != root
):
    raise SystemExit(1)
entries = os.listdir(root)
if any(name not in allowed for name in entries):
    raise SystemExit(1)
for final, temporary in (
    ('intent-v1', '.intent-v1.installing'),
    ('binding-v2', '.binding-v2.installing'),
    ('predecessor-helper', '.predecessor-helper.installing'),
    ('completed-v1', '.completed-v1.installing'),
):
    if final in entries and temporary in entries:
        raise SystemExit(1)
for name in entries:
    mode, maximum = allowed[name]
    item = os.lstat(f'{root}/{name}')
    if (
        not stat.S_ISREG(item.st_mode)
        or (item.st_uid, item.st_gid, stat.S_IMODE(item.st_mode), item.st_nlink) != (0, 0, mode, 1)
        or item.st_size > maximum
    ):
        raise SystemExit(1)
PY
}

validate_retirement_and_binding() {
  local retirement="$1" binding="$2"
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$retirement" "$binding" "$TARGET" "$PREDECESSOR_RELEASE" \
    "$PREDECESSOR_HELPER_SHA256" "$V2_BINDING_SHA256" <<'PY'
import hashlib
import os
import re
import stat
import sys

retirement, binding, helper, release, helper_sha, binding_sha = sys.argv[1:]
uuid = rb'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
v2_pattern = re.compile(
    uuid + rb' hmac-sha256-agent-identity-v1:[0-9a-f]{64} '
    rb'sha256-provider-authorization-v1:[0-9a-f]{64}\n'
)


def reject():
    raise RuntimeError()


def exact_file(path, owner, mode, maximum, exact_size=None):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_uid, before.st_gid) != owner
            or stat.S_IMODE(before.st_mode) != mode
            or before.st_nlink != 1
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or before.st_size > maximum
            or (exact_size is not None and before.st_size != exact_size)
            or os.path.realpath(path) != path
        ):
            reject()
        data = bytearray()
        while len(data) <= maximum:
            chunk = os.read(descriptor, maximum + 1 - len(data))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(descriptor)
        named_after = os.lstat(path)
        if (
            (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
             before.st_nlink, before.st_size, before.st_mtime_ns) !=
            (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
             after.st_nlink, after.st_size, after.st_mtime_ns)
            or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)
        ):
            reject()
        return bytes(data)
    finally:
        os.close(descriptor)


root = os.lstat(retirement)
if (
    not stat.S_ISDIR(root.st_mode)
    or (root.st_uid, root.st_gid) != (0, 0)
    or stat.S_IMODE(root.st_mode) != 0o700
    or os.path.realpath(retirement) != retirement
    or sorted(os.listdir(retirement)) != ['completed-v1', 'intent-v1']
):
    reject()
intent = exact_file(f'{retirement}/intent-v1', (0, 0), 0o600, 4096).decode('ascii').splitlines()
completion = exact_file(f'{retirement}/completed-v1', (0, 0), 0o600, 4096).decode('ascii').splitlines()
dev_ino = re.compile(r'[0-9]+:[0-9]+')
sha = re.compile(r'[0-9a-f]{64}')
if (
    len(intent) != 14
    or len(completion) != 16
    or intent[0] != 'contract=fetanagent-kemerbet-readiness-binding-v1-retirement-v1'
    or intent[1] != 'state=retirement-authorized'
    or intent[2] != f'release={release}'
    or not intent[3].startswith('helper_dev_ino=')
    or dev_ino.fullmatch(intent[3].split('=', 1)[1]) is None
    or intent[4] != f'helper_sha256={helper_sha}'
    or not intent[5].startswith('legacy_binding_dev_ino=')
    or dev_ino.fullmatch(intent[5].split('=', 1)[1]) is None
    or not intent[6].startswith('legacy_binding_sha256=')
    or sha.fullmatch(intent[6].split('=', 1)[1]) is None
    or not intent[7].startswith('identity_hmac_key_dev_ino=')
    or dev_ino.fullmatch(intent[7].split('=', 1)[1]) is None
    or not intent[8].startswith('identity_hmac_key_sha256=')
    or sha.fullmatch(intent[8].split('=', 1)[1]) is None
    or not intent[9].startswith('claim_sha256=')
    or sha.fullmatch(intent[9].split('=', 1)[1]) is None
    or not intent[10].startswith('owner_stage_player_ids_dev_ino=')
    or dev_ino.fullmatch(intent[10].split('=', 1)[1]) is None
    or not intent[11].startswith('owner_stage_player_ids_sha256=')
    or sha.fullmatch(intent[11].split('=', 1)[1]) is None
    or not intent[12].startswith('owner_stage_claim_dev_ino=')
    or dev_ino.fullmatch(intent[12].split('=', 1)[1]) is None
    or not intent[13].startswith('release_asset_sha256=')
    or sha.fullmatch(intent[13].split('=', 1)[1]) is None
    or completion[:1] != intent[:1]
    or completion[1] != 'state=resealed-v2'
    or completion[2:14] != intent[2:14]
    or not completion[14].startswith('v2_binding_dev_ino=')
    or dev_ino.fullmatch(completion[14].split('=', 1)[1]) is None
    or completion[15] != f'v2_binding_sha256={binding_sha}'
):
    reject()
helper_data = exact_file(helper, (0, 0), 0o755, 2 * 1024 * 1024)
binding_data = exact_file(binding, (10001, 10001), 0o600, 230, 230)
helper_stat = os.stat(helper, follow_symlinks=False)
binding_stat = os.stat(binding, follow_symlinks=False)
if (
    hashlib.sha256(helper_data).hexdigest() != helper_sha
    or intent[3] != f'helper_dev_ino={helper_stat.st_dev}:{helper_stat.st_ino}'
):
    reject()
if (
    hashlib.sha256(binding_data).hexdigest() != binding_sha
    or completion[14] != f'v2_binding_dev_ino={binding_stat.st_dev}:{binding_stat.st_ino}'
    or v2_pattern.fullmatch(binding_data) is None
):
    reject()
PY
}

require_v3_binding() {
  local path="$1"
  env -i PATH="$SAFE_PATH" python3 -I - "$path" <<'PY'
import os
import re
import stat
import sys

path = sys.argv[1]
pattern = re.compile(
    rb'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} '
    rb'hmac-sha256-agent-identity-v1:([0-9a-f]{64}) '
    rb'hmac-sha256-agent-profile-pin-v3:\1\n'
)
descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    value = os.fstat(descriptor)
    named = os.lstat(path)
    data = bytearray()
    while len(data) <= 230:
        chunk = os.read(descriptor, 231 - len(data))
        if not chunk:
            break
        data.extend(chunk)
finally:
    os.close(descriptor)
if (
    not stat.S_ISREG(value.st_mode)
    or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink, value.st_size) !=
       (10001, 10001, 0o600, 1, 230)
    or (value.st_dev, value.st_ino) != (named.st_dev, named.st_ino)
    or os.path.realpath(path) != path
    or pattern.fullmatch(bytes(data)) is None
):
    raise SystemExit(1)
PY
}

publish_intent() {
  local root="$1"
  env -i PATH="$SAFE_PATH" python3 -I - "$root" \
    "$PREDECESSOR_RELEASE" "$SUCCESSOR_RELEASE" "$PREDECESSOR_HELPER_SHA256" \
    "$SUCCESSOR_HELPER_SHA256" "$V2_BINDING_SHA256" "$RETIREMENT_INTENT_SHA256" \
    "$RETIREMENT_COMPLETION_SHA256" <<'PY'
import os
import stat
import sys

root, predecessor, successor, old_helper, new_helper, v2_sha, retirement_intent, retirement_completion = sys.argv[1:]
target = 'intent-v1'
temporary = '.intent-v1.installing'
expected = (
    'contract=fetanagent-kemerbet-readiness-v2-v3-successor-v1\n'
    'state=authorized\n'
    f'predecessor_release={predecessor}\n'
    f'successor_release={successor}\n'
    f'predecessor_helper_sha256={old_helper}\n'
    f'successor_helper_sha256={new_helper}\n'
    f'v2_binding_sha256={v2_sha}\n'
    f'retirement_intent_sha256={retirement_intent}\n'
    f'retirement_completion_sha256={retirement_completion}\n'
).encode('ascii')


def reject():
    raise RuntimeError()


def write_all(descriptor, data):
    offset = 0
    while offset < len(data):
        written = os.write(descriptor, data[offset:])
        if written <= 0:
            reject()
        offset += written


def read_bounded(descriptor, maximum):
    data = bytearray()
    while len(data) <= maximum:
        chunk = os.read(descriptor, maximum + 1 - len(data))
        if not chunk:
            break
        data.extend(chunk)
    return bytes(data)


directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    if target in os.listdir(directory):
        if temporary in os.listdir(directory):
            reject()
        descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
        try:
            value = os.fstat(descriptor)
            data = read_bounded(descriptor, len(expected))
        finally:
            os.close(descriptor)
        if (
            (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) != (0, 0, 0o600, 1)
            or data != expected
        ):
            reject()
        raise SystemExit(0)
    if temporary in os.listdir(directory):
        descriptor = os.open(temporary, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
        try:
            value = os.fstat(descriptor)
            existing = read_bounded(descriptor, len(expected))
            if (
                (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) != (0, 0, 0o600, 1)
                or not expected.startswith(existing)
            ):
                reject()
            os.lseek(descriptor, len(existing), os.SEEK_SET)
            write_all(descriptor, expected[len(existing):])
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    else:
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            0o600,
            dir_fd=directory,
        )
        try:
            os.fchmod(descriptor, 0o600)
            write_all(descriptor, expected)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    os.rename(temporary, target, src_dir_fd=directory, dst_dir_fd=directory)
    os.fsync(directory)
finally:
    os.close(directory)
PY
  require_migration_intent "$root" || die 'the migration intent failed exact attestation'
}

archive_and_transform_binding() {
  local root="$1"
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$SOURCE_ROOT" "$(basename -- "$SOURCE")" "$root" "$V2_ARCHIVE_NAME" \
    "$V2_BINDING_SHA256" <<'PY'
import hashlib
import os
import re
import stat
import sys

source_root, source_name, archive_root, archive_name, expected_sha = sys.argv[1:]
uuid = rb'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
v2 = re.compile(
    b'(' + uuid + rb') hmac-sha256-agent-identity-v1:([0-9a-f]{64}) '
    rb'sha256-provider-authorization-v1:[0-9a-f]{64}\n'
)
v3 = re.compile(
    b'(' + uuid + rb') hmac-sha256-agent-identity-v1:([0-9a-f]{64}) '
    rb'hmac-sha256-agent-profile-pin-v3:\2\n'
)


def reject():
    raise RuntimeError()


def read_exact(directory_fd, name, owner, mode):
    value = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    if (
        not stat.S_ISREG(value.st_mode)
        or (value.st_uid, value.st_gid) != owner
        or stat.S_IMODE(value.st_mode) != mode
        or value.st_nlink != 1
        or value.st_size != 230
    ):
        reject()
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory_fd)
    try:
        opened = os.fstat(descriptor)
        data = bytearray()
        while len(data) <= 230:
            chunk = os.read(descriptor, 231 - len(data))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    if (
        (value.st_dev, value.st_ino, value.st_mode, value.st_uid, value.st_gid,
         value.st_nlink, value.st_size, value.st_mtime_ns) !=
        (opened.st_dev, opened.st_ino, opened.st_mode, opened.st_uid, opened.st_gid,
         opened.st_nlink, opened.st_size, opened.st_mtime_ns)
        or (opened.st_dev, opened.st_ino, opened.st_mtime_ns) !=
           (after.st_dev, after.st_ino, after.st_mtime_ns)
        or len(data) != 230
    ):
        reject()
    return bytes(data)


def write_all(descriptor, content):
    offset = 0
    while offset < len(content):
        written = os.write(descriptor, content[offset:])
        if written <= 0:
            reject()
        offset += written


def read_bounded(descriptor, maximum):
    data = bytearray()
    while len(data) <= maximum:
        chunk = os.read(descriptor, maximum + 1 - len(data))
        if not chunk:
            break
        data.extend(chunk)
    return bytes(data)


source_fd = os.open(source_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
archive_fd = os.open(archive_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    archive_exists = archive_name in os.listdir(archive_fd)
    archive_temporary = f'.{archive_name}.installing'
    if archive_exists:
        if archive_temporary in os.listdir(archive_fd):
            reject()
        archived = read_exact(archive_fd, archive_name, (0, 0), 0o400)
        if hashlib.sha256(archived).hexdigest() != expected_sha or v2.fullmatch(archived) is None:
            reject()
    else:
        source = read_exact(source_fd, source_name, (10001, 10001), 0o600)
        if hashlib.sha256(source).hexdigest() != expected_sha or v2.fullmatch(source) is None:
            reject()
        if archive_temporary in os.listdir(archive_fd):
            descriptor = os.open(
                archive_temporary,
                os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=archive_fd,
            )
            try:
                value = os.fstat(descriptor)
                existing = read_bounded(descriptor, 230)
                if (
                    (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) !=
                       (0, 0, 0o400, 1)
                    or not source.startswith(existing)
                ):
                    reject()
                os.lseek(descriptor, len(existing), os.SEEK_SET)
                write_all(descriptor, source[len(existing):])
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        else:
            descriptor = os.open(
                archive_temporary,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                0o400,
                dir_fd=archive_fd,
            )
            try:
                os.fchmod(descriptor, 0o400)
                write_all(descriptor, source)
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        os.rename(archive_temporary, archive_name, src_dir_fd=archive_fd, dst_dir_fd=archive_fd)
        os.fsync(archive_fd)
        archived = read_exact(archive_fd, archive_name, (0, 0), 0o400)
    match = v2.fullmatch(archived)
    if match is None:
        reject()
    expected_v3 = (
        match.group(1) + b' hmac-sha256-agent-identity-v1:' + match.group(2) +
        b' hmac-sha256-agent-profile-pin-v3:' + match.group(2) + b'\n'
    )
    current = read_exact(source_fd, source_name, (10001, 10001), 0o600)
    temporary = f'.{source_name}.v3-installing'
    if current == expected_v3 and v3.fullmatch(current) is not None:
        if temporary in os.listdir(source_fd):
            reject()
        raise SystemExit(0)
    if current != archived:
        reject()
    if temporary in os.listdir(source_fd):
        descriptor = os.open(
            temporary,
            os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=source_fd,
        )
        try:
            value = os.fstat(descriptor)
            existing = read_bounded(descriptor, 230)
            if (
                not stat.S_ISREG(value.st_mode)
                or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) not in
                   ((0, 0, 0o600, 1), (10001, 10001, 0o600, 1))
                or not expected_v3.startswith(existing)
            ):
                reject()
            os.fchmod(descriptor, 0o600)
            os.lseek(descriptor, len(existing), os.SEEK_SET)
            write_all(descriptor, expected_v3[len(existing):])
            os.fsync(descriptor)
            os.fchown(descriptor, 10001, 10001)
            os.fchmod(descriptor, 0o600)
            os.fsync(descriptor)
            promoted = os.fstat(descriptor)
            if (
                not stat.S_ISREG(promoted.st_mode)
                or (promoted.st_uid, promoted.st_gid, stat.S_IMODE(promoted.st_mode),
                    promoted.st_nlink, promoted.st_size) != (10001, 10001, 0o600, 1, 230)
            ):
                reject()
        finally:
            os.close(descriptor)
    else:
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            0o600,
            dir_fd=source_fd,
        )
        try:
            os.fchmod(descriptor, 0o600)
            write_all(descriptor, expected_v3)
            os.fsync(descriptor)
            os.fchown(descriptor, 10001, 10001)
            os.fchmod(descriptor, 0o600)
            os.fsync(descriptor)
            promoted = os.fstat(descriptor)
            if (
                not stat.S_ISREG(promoted.st_mode)
                or (promoted.st_uid, promoted.st_gid, stat.S_IMODE(promoted.st_mode),
                    promoted.st_nlink, promoted.st_size) != (10001, 10001, 0o600, 1, 230)
            ):
                reject()
        finally:
            os.close(descriptor)
    os.rename(temporary, source_name, src_dir_fd=source_fd, dst_dir_fd=source_fd)
    os.fsync(source_fd)
    if read_exact(source_fd, source_name, (10001, 10001), 0o600) != expected_v3:
        reject()
finally:
    os.close(archive_fd)
    os.close(source_fd)
PY
}

copy_root_file_atomically() {
  local source="$1" temporary="$2" target="$3" source_mode="$4" target_mode="$5"
  local expected_digest="$6"
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$source" "$temporary" "$target" "$source_mode" "$target_mode" "$expected_digest" <<'PY'
import hashlib
import os
import stat
import sys

source, temporary, target, source_mode_text, target_mode_text, expected_digest = sys.argv[1:]
source_mode = int(source_mode_text, 8)
target_mode = int(target_mode_text, 8)


def reject():
    raise RuntimeError()


def write_all(descriptor, data):
    offset = 0
    while offset < len(data):
        written = os.write(descriptor, data[offset:])
        if written <= 0:
            reject()
        offset += written


def read_bounded(descriptor, maximum):
    data = bytearray()
    while len(data) <= maximum:
        chunk = os.read(descriptor, maximum + 1 - len(data))
        if not chunk:
            break
        data.extend(chunk)
    return bytes(data)


descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    before = os.fstat(descriptor)
    named = os.lstat(source)
    if (
        not stat.S_ISREG(before.st_mode)
        or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink) !=
           (0, 0, source_mode, 1)
        or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
        or before.st_size > 2 * 1024 * 1024
        or os.path.realpath(source) != source
    ):
        reject()
    data = bytearray()
    while len(data) <= 2 * 1024 * 1024:
        chunk = os.read(descriptor, 65536)
        if not chunk:
            break
        data.extend(chunk)
    after = os.fstat(descriptor)
    if (
        (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
         before.st_nlink, before.st_size, before.st_mtime_ns) !=
        (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
         after.st_nlink, after.st_size, after.st_mtime_ns)
        or hashlib.sha256(data).hexdigest() != expected_digest
    ):
        reject()
finally:
    os.close(descriptor)

if os.path.lexists(target):
    reject()
if os.path.lexists(temporary):
    descriptor = os.open(temporary, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        value = os.fstat(descriptor)
        existing = read_bounded(descriptor, len(data))
        if (
            (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) !=
               (0, 0, target_mode, 1)
            or not bytes(data).startswith(existing)
        ):
            reject()
        os.lseek(descriptor, len(existing), os.SEEK_SET)
        write_all(descriptor, bytes(data[len(existing):]))
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
else:
    descriptor = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        target_mode,
    )
    try:
        os.fchmod(descriptor, target_mode)
        write_all(descriptor, bytes(data))
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
os.rename(temporary, target)
directory = os.open(os.path.dirname(target), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    os.fsync(directory)
finally:
    os.close(directory)
PY
}

publish_completion() {
  local root="$1" v3_digest
  v3_digest="$(sha256sum -- "$SOURCE" | awk '{print $1}')"
  [[ "$v3_digest" =~ ^[0-9a-f]{64}$ ]] || die 'the v3 binding digest is invalid'
  env -i PATH="$SAFE_PATH" python3 -I - "$root" \
    "$PREDECESSOR_RELEASE" "$SUCCESSOR_RELEASE" "$PREDECESSOR_HELPER_SHA256" \
    "$SUCCESSOR_HELPER_SHA256" "$V2_BINDING_SHA256" "$RETIREMENT_INTENT_SHA256" \
    "$RETIREMENT_COMPLETION_SHA256" "$v3_digest" <<'PY'
import os
import stat
import sys

root, predecessor, successor, old_helper, new_helper, v2_sha, retirement_intent, retirement_completion, v3_sha = sys.argv[1:]
target = 'completed-v1'
temporary = '.completed-v1.installing'
expected = (
    'contract=fetanagent-kemerbet-readiness-v2-v3-successor-v1\n'
    'state=successor-installed\n'
    f'predecessor_release={predecessor}\n'
    f'successor_release={successor}\n'
    f'predecessor_helper_sha256={old_helper}\n'
    f'successor_helper_sha256={new_helper}\n'
    f'v2_binding_sha256={v2_sha}\n'
    f'retirement_intent_sha256={retirement_intent}\n'
    f'retirement_completion_sha256={retirement_completion}\n'
    f'v3_binding_sha256={v3_sha}\n'
).encode('ascii')


def reject():
    raise RuntimeError()


def write_all(descriptor, data):
    offset = 0
    while offset < len(data):
        written = os.write(descriptor, data[offset:])
        if written <= 0:
            reject()
        offset += written


def read_bounded(descriptor, maximum):
    data = bytearray()
    while len(data) <= maximum:
        chunk = os.read(descriptor, maximum + 1 - len(data))
        if not chunk:
            break
        data.extend(chunk)
    return bytes(data)


directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    entries = os.listdir(directory)
    if target in entries:
        if temporary in entries:
            reject()
        descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
        try:
            value = os.fstat(descriptor)
            data = read_bounded(descriptor, len(expected))
        finally:
            os.close(descriptor)
        if (
            (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) != (0, 0, 0o600, 1)
            or data != expected
        ):
            reject()
        raise SystemExit(0)
    if temporary in entries:
        descriptor = os.open(temporary, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
        try:
            value = os.fstat(descriptor)
            existing = read_bounded(descriptor, len(expected))
            if (
                (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) != (0, 0, 0o600, 1)
                or not expected.startswith(existing)
            ):
                reject()
            os.lseek(descriptor, len(existing), os.SEEK_SET)
            write_all(descriptor, expected[len(existing):])
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    else:
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            0o600,
            dir_fd=directory,
        )
        try:
            os.fchmod(descriptor, 0o600)
            write_all(descriptor, expected)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    os.rename(temporary, target, src_dir_fd=directory, dst_dir_fd=directory)
    os.fsync(directory)
finally:
    os.close(directory)
PY
}

restore_sudoers() {
  [[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]] || return 1
  require_exact_sudoers_file "$SUDOERS_DISABLED" || return 1
  visudo -cf "$SUDOERS_DISABLED" >/dev/null || return 1
  visudo -cf /etc/sudoers >/dev/null || return 1
  mv -- "$SUDOERS_DISABLED" "$SUDOERS" || return 1
  if sync -f /etc/sudoers.d && require_exact_sudoers_file "$SUDOERS" &&
    visudo -cf /etc/sudoers >/dev/null; then
    return 0
  fi
  if [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" &&
    -e "$SUDOERS" && ! -L "$SUDOERS" ]] && require_exact_sudoers_file "$SUDOERS"; then
    mv -- "$SUDOERS" "$SUDOERS_DISABLED" || return 1
    sync -f /etc/sudoers.d || return 1
    require_exact_sudoers_file "$SUDOERS_DISABLED" || return 1
  fi
  return 1
}

sudoers_may_restore='false'
sudoers_disabled='false'
cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$sudoers_may_restore" == 'true' ]]; then
    restore_sudoers || status=1
  elif [[ "$sudoers_disabled" == 'true' ]]; then
    printf '%s\n' 'FetanAgent migration stopped after the privileged grant was disabled; leave it disabled and rerun this exact reviewed migration from the root console.' >&2
  fi
  exit "$status"
}

[[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 "$METADATA/id")" == "$EXPECTED_DROPLET_ID" ]] ||
  die 'the DigitalOcean Droplet identity is wrong'
[[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
  "$METADATA/interfaces/public/0/ipv4/address")" == "$EXPECTED_PUBLIC_IPV4" ]] ||
  die 'the DigitalOcean public IPv4 identity is wrong'
[[ ! -L "$STAGING_ROOT" && -d "$STAGING_ROOT" && "$(realpath -- "$STAGING_ROOT")" == "$STAGING_ROOT" &&
  "$(stat --format='%U:%G:%a' "$STAGING_ROOT")" == 'root:root:700' ]] || die 'the reviewed staging root is unsafe'
require_helper_file "$STAGED_HELPER" "$SUCCESSOR_HELPER_SHA256" 600 || die 'the staged successor helper is invalid'
load_retirement_evidence_digests || die 'the canonical predecessor retirement evidence is invalid'

if [[ ! -e "$MIGRATION_ROOT" && ! -L "$MIGRATION_ROOT" &&
  ! -e "$MIGRATION_INSTALLING" && ! -L "$MIGRATION_INSTALLING" ]]; then
  require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 || die 'the installed predecessor helper is invalid'
  if require_exact_sudoers_file "$SUDOERS"; then
    migration_state='fresh'
    [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]] ||
      die 'both enabled and disabled deployment grants exist'
    run_predecessor_helper verify "$PREDECESSOR_HELPER_SHA256" >/dev/null
    run_predecessor_helper stop >/dev/null
    run_predecessor_helper kemerbet-v1-retirement-recovery-ready "$PREDECESSOR_RELEASE" >/dev/null
    validate_retirement_and_binding "$RETIREMENT_ROOT" "$SOURCE" ||
      die 'the predecessor retirement and v2 source failed exact continuity validation'
  elif [[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]] &&
    require_exact_sudoers_file "$SUDOERS_DISABLED"; then
    migration_state='fresh-disabled'
    [[ -z "$(docker --host unix:///var/run/docker.sock container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME")" ]] ||
      die 'disabled-grant recovery requires the staging project to remain fully stopped'
    validate_retirement_and_binding "$RETIREMENT_ROOT" "$SOURCE" ||
      die 'the disabled-grant predecessor retirement and v2 source failed exact continuity validation'
  else
    die 'the deployment sudoers grant topology is unavailable or ambiguous'
  fi
elif [[ -e "$MIGRATION_ROOT" || -L "$MIGRATION_ROOT" ]]; then
  migration_state='completed'
  [[ ! -e "$MIGRATION_INSTALLING" && ! -L "$MIGRATION_INSTALLING" ]] || die 'both final and installing migration roots exist'
else
  migration_state='interrupted'
  [[ ! -e "$MIGRATION_ROOT" && ! -L "$MIGRATION_ROOT" ]] || die 'the migration root topology is ambiguous'
  require_migration_installing_prefix "$MIGRATION_INSTALLING" ||
    die 'the interrupted migration prefix is invalid'
  [[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]] &&
    require_exact_sudoers_file "$SUDOERS_DISABLED" ||
    die 'an interrupted migration must retain the disabled deployment grant'
fi

if [[ -e "$MIGRATION_PARENT" || -L "$MIGRATION_PARENT" ]]; then
  [[ ! -L "$MIGRATION_PARENT" && -d "$MIGRATION_PARENT" &&
    "$(realpath -- "$MIGRATION_PARENT")" == "$MIGRATION_PARENT" &&
    "$(stat --format='%U:%G:%a' "$MIGRATION_PARENT")" == 'root:root:700' ]] ||
    die 'the migration parent topology is unsafe'
  migration_parent_entries="$(find -P "$MIGRATION_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)"
  case "$migration_state" in
    fresh|fresh-disabled) [[ -z "$migration_parent_entries" ]] || die 'the fresh migration parent is not empty' ;;
    interrupted) [[ "$migration_parent_entries" == "${SUCCESSOR_RELEASE}.installing" ]] ||
      die 'the interrupted migration parent has foreign entries' ;;
    completed) [[ "$migration_parent_entries" == "$SUCCESSOR_RELEASE" ]] ||
      die 'the completed migration parent has foreign entries' ;;
  esac
elif [[ "$migration_state" != 'fresh' && "$migration_state" != 'fresh-disabled' ]]; then
  die 'the existing migration lost its canonical parent'
fi

require_no_helper_processes || die 'another helper invocation is still active'
if [[ ! -e "$LOCK_ROOT" && ! -L "$LOCK_ROOT" ]]; then
  (umask 077 && mkdir --mode=0700 -- "$LOCK_ROOT") || die 'the mutation-lock root could not be created'
fi
[[ ! -L "$LOCK_ROOT" && -d "$LOCK_ROOT" && "$(realpath -- "$LOCK_ROOT")" == "$LOCK_ROOT" &&
  "$(stat --format='%U:%G:%a' "$LOCK_ROOT")" == 'root:root:700' ]] || die 'the mutation-lock root is unsafe'
if [[ ! -e "$LOCK" && ! -L "$LOCK" ]]; then
  (set -o noclobber; umask 077; : >"$LOCK") 2>/dev/null || true
fi
[[ ! -L "$LOCK" && -f "$LOCK" && "$(realpath -- "$LOCK")" == "$LOCK" &&
  "$(stat --format='%U:%G:%a:%h' "$LOCK")" == 'root:root:600:1' ]] || die 'the mutation lock is unsafe'
exec 9<>"$LOCK"
flock --exclusive --nonblock 9 || die 'another staging mutation is active'
require_no_helper_processes || die 'a helper process appeared after the mutation lock was acquired'

if [[ "$migration_state" == 'completed' ]]; then
  require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 || die 'the installed successor helper is invalid'
  require_v3_binding "$SOURCE" || die 'the installed v3 binding is invalid'
  env -i PATH="$SAFE_PATH" SUDO_USER='fetanagent-admin' "$TARGET" \
    kemerbet-v3-successor-ready "$SUCCESSOR_RELEASE" "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
    die 'the completed successor migration failed exact re-attestation'
  if [[ -e "$SUDOERS_DISABLED" || -L "$SUDOERS_DISABLED" ]]; then
    restore_sudoers || die 'the exact deployment sudoers grant could not be restored'
  else
    require_exact_sudoers_file "$SUDOERS" || die 'the exact deployment sudoers grant is invalid'
  fi
  printf '%s\n' 'FetanAgent KemerBet v3 successor migration already completed and re-attested.'
  exit 0
fi

trap cleanup EXIT
if [[ -e "$SUDOERS" || -L "$SUDOERS" ]]; then
  require_exact_sudoers_file "$SUDOERS" || die 'the deployment sudoers grant is invalid'
  [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]] || die 'the disabled sudoers target already exists'
  mv -- "$SUDOERS" "$SUDOERS_DISABLED"
  sudoers_disabled='true'
  sync -f /etc/sudoers.d
else
  sudoers_disabled='true'
fi
require_exact_sudoers_file "$SUDOERS_DISABLED" || die 'the disabled deployment grant is invalid'
[[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]] || die 'the deployment grant remained enabled'
visudo -cf /etc/sudoers >/dev/null || die 'sudoers validation failed with the grant disabled'
require_no_helper_processes || die 'a helper process appeared after the deployment grant was disabled'

# Disable the predecessor helper grant before publishing any successor namespace. If the host
# stops between those operations, the exact fresh-disabled topology above is the only accepted
# restart state. Once the prefix exists, every interruption is recoverable only with the grant
# still disabled, so the predecessor helper can never mutate alongside successor evidence.
if [[ ! -e "$MIGRATION_INSTALLING" && ! -L "$MIGRATION_INSTALLING" ]]; then
  [[ ! -e "$MIGRATION_ROOT" && ! -L "$MIGRATION_ROOT" ]] || die 'the final migration root already exists'
  if [[ ! -e "$MIGRATION_PARENT" && ! -L "$MIGRATION_PARENT" ]]; then
    (umask 077 && mkdir --mode=0700 -- "$MIGRATION_PARENT") || die 'the migration parent could not be created'
    sync -f "$(dirname -- "$MIGRATION_PARENT")" || die 'the migration parent namespace could not be synchronized'
  fi
  [[ ! -L "$MIGRATION_PARENT" && -d "$MIGRATION_PARENT" && "$(realpath -- "$MIGRATION_PARENT")" == "$MIGRATION_PARENT" &&
    "$(stat --format='%U:%G:%a' "$MIGRATION_PARENT")" == 'root:root:700' ]] || die 'the migration parent is unsafe'
  (umask 077 && mkdir --mode=0700 -- "$MIGRATION_INSTALLING") || die 'the migration installer could not be created'
  sync -f "$MIGRATION_PARENT" || die 'the migration installer namespace could not be synchronized'
fi
[[ ! -L "$MIGRATION_PARENT" && -d "$MIGRATION_PARENT" &&
  "$(realpath -- "$MIGRATION_PARENT")" == "$MIGRATION_PARENT" &&
  "$(stat --format='%U:%G:%a' "$MIGRATION_PARENT")" == 'root:root:700' ]] ||
  die 'the migration parent changed under lock'
publish_intent "$MIGRATION_INSTALLING"
require_migration_intent "$MIGRATION_INSTALLING" || die 'the migration intent changed under disabled grant'

[[ -z "$(docker --host unix:///var/run/docker.sock container ls --all --quiet \
  --filter "label=com.docker.compose.project=$PROJECT_NAME")" ]] || die 'the staging project is not fully stopped'
[[ ! -e "$RETIREMENT_INSTALLING" && ! -L "$RETIREMENT_INSTALLING" ]] || die 'a predecessor retirement installer remains'
require_migration_intent "$MIGRATION_INSTALLING" || die 'the migration intent changed under lock'

[[ ! -L "$RETIREMENT_ROOT" && -d "$RETIREMENT_ROOT" &&
  "$(realpath -- "$RETIREMENT_ROOT")" == "$RETIREMENT_ROOT" &&
  "$(stat --format='%U:%G:%a' "$RETIREMENT_ROOT")" == 'root:root:700' ]] ||
  die 'the canonical predecessor retirement root changed under lock'

archive_and_transform_binding "$MIGRATION_INSTALLING"
require_v3_binding "$SOURCE" || die 'the stable v3 binding failed exact post-transform validation'

if [[ ! -e "$MIGRATION_INSTALLING/$HELPER_ARCHIVE_NAME" &&
  ! -L "$MIGRATION_INSTALLING/$HELPER_ARCHIVE_NAME" ]]; then
  require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 || die 'the predecessor helper changed before archival'
  copy_root_file_atomically "$TARGET" \
    "$MIGRATION_INSTALLING/.${HELPER_ARCHIVE_NAME}.installing" \
    "$MIGRATION_INSTALLING/$HELPER_ARCHIVE_NAME" 0755 0400 "$PREDECESSOR_HELPER_SHA256"
fi
require_helper_file "$MIGRATION_INSTALLING/$HELPER_ARCHIVE_NAME" "$PREDECESSOR_HELPER_SHA256" 400 ||
  die 'the predecessor helper archive is invalid'

if require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755; then
  if [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" ]]; then
    copy_root_file_atomically "$STAGED_HELPER" "$INSTALLING_HELPER_PARTIAL" \
      "$INSTALLING_HELPER" 0600 0755 "$SUCCESSOR_HELPER_SHA256"
  else
    [[ ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] ||
      die 'both complete and partial successor helper installers exist'
  fi
  require_helper_file "$INSTALLING_HELPER" "$SUCCESSOR_HELPER_SHA256" 755 || die 'the successor helper installer is invalid'
  mv -- "$INSTALLING_HELPER" "$TARGET"
  sync -f /usr/local/sbin
fi
require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 || die 'the installed successor helper is invalid'
[[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
  ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] ||
  die 'a successor helper installer residue remains'
env -i PATH="$SAFE_PATH" SUDO_USER='fetanagent-admin' "$TARGET" verify "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
  die 'the installed successor helper rejected its exact reviewed digest'

publish_completion "$MIGRATION_INSTALLING"
[[ ! -e "$MIGRATION_ROOT" && ! -L "$MIGRATION_ROOT" ]] || die 'the final migration root appeared unexpectedly'
mv -- "$MIGRATION_INSTALLING" "$MIGRATION_ROOT"
sync -f "$MIGRATION_PARENT"
[[ ! -L "$RETIREMENT_ROOT" && -d "$RETIREMENT_ROOT" ]] ||
  die 'the canonical predecessor retirement root was not preserved'
require_v3_binding "$SOURCE" || die 'the final stable v3 binding is invalid'
require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 || die 'the final successor helper is invalid'
env -i PATH="$SAFE_PATH" SUDO_USER='fetanagent-admin' "$TARGET" \
  kemerbet-v3-successor-ready "$SUCCESSOR_RELEASE" "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
  die 'the successor helper rejected the completed v3 migration overlay'

sudoers_may_restore='true'
restore_sudoers || die 'the exact deployment grant could not be restored after successor verification'
sudoers_may_restore='false'
sudoers_disabled='false'
trap - EXIT
printf '%s\n' 'FetanAgent KemerBet v2 evidence archived; stable v3 successor helper installed. Transfer remained disabled and no money moved.'
