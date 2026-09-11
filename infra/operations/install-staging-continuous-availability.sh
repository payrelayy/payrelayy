#!/usr/bin/env bash
# Install one checksum-bound, non-financial deployment capability from reviewed root staging.
set -euo pipefail
export PATH='/usr/sbin:/usr/bin:/sbin:/bin'
umask 077
die() { printf '%s\n' "$1" >&2; exit 1; }
[[ $# -eq 2 && "$(id -u)" == 0 && -z "${SUDO_USER:-}" ]] || die 'Use the trusted root session with the staging directory and reviewed finalizer digest.'
readonly STAGED="$1" EXPECTED_SHA="$2"
readonly TARGET='/usr/local/sbin/fetanagent-staging-continuous-availability'
readonly SUDOERS='/etc/sudoers.d/fetanagent-staging-continuous-availability'
readonly TARGET_INSTALLING='/usr/local/sbin/.fetanagent-staging-continuous-availability.installing'
readonly SUDOERS_INSTALLING='/etc/sudoers.d/.fetanagent-staging-continuous-availability.installing'
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="$LOCK_ROOT/mutation.lock"
readonly PREDECESSOR_FINALIZER_SHA='a52a4db7a46849c75f94d734d005d34360e555ebbe46274b59d5c5d9f8a5917f'
readonly PREDECESSOR_SUDOERS_SHA='677eeb3bf0a4ff428f7db953d75485ae7405e9a36d2bbe428879a54a8e805138'
readonly PREFLIGHT_FINALIZER_SHA='37a8ddebe924f92f0c6dafa001a183326e63fb26a3d65e0996238ac808870e1d'
readonly PREFLIGHT_SUDOERS_SHA='4300ee2f62475c607d7ee96a34c0ceb47ce67668a3b71a8c6515f3749229f483'
readonly H17_FINALIZER_SHA='8e7e00aa8f83b08bb07a7b09c7d0ade3c89b4014c82d7047a7677a96b13b78d5'
readonly H17_SUDOERS_SHA='6a00778d52e4f2e58596ab8c287eebad0069f4997ef4439fa775115d8f7aabc0'
[[ "$STAGED" =~ ^/run/fetanagent-continuity-install-[0-9a-f]{40}$ && "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]] ||
  die 'The source directory or reviewed digest is invalid.'
[[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 5 http://169.254.169.254/metadata/v1/id)" == 593344964 ]] ||
  die 'This is not the approved staging Droplet.'
[[ ! -L "$STAGED" && -d "$STAGED" && "$(realpath -- "$STAGED")" == "$STAGED" &&
  "$(stat --format='%U:%G:%a' "$STAGED")" == 'root:root:700' ]] || die 'The reviewed staging directory is unsafe.'
for file in finalizer.sh finalizer.sudoers; do
  [[ ! -L "$STAGED/$file" && -f "$STAGED/$file" &&
    "$(stat --format='%U:%G:%a:%h' "$STAGED/$file")" == 'root:root:600:1' ]] || die 'A reviewed source file is unsafe.'
done
[[ "$(sha256sum "$STAGED/finalizer.sh" | awk '{print $1}')" == "$EXPECTED_SHA" ]] || die 'The finalizer digest does not match the reviewed source.'
bash -n "$STAGED/finalizer.sh"
cmp -s "$STAGED/finalizer.sudoers" <(printf '%s\n' \
  "fetanagent-admin ALL=(root) NOPASSWD: sha256:$EXPECTED_SHA $TARGET preflight *" \
  "fetanagent-admin ALL=(root) NOPASSWD: sha256:$EXPECTED_SHA $TARGET disable-expiry *") ||
  die 'The sudo capability is not the exact checksum-bound preflight and finalizer commands.'
readonly EXPECTED_SUDOERS_SHA="$(sha256sum "$STAGED/finalizer.sudoers" | awk '{print $1}')"
[[ "$EXPECTED_SUDOERS_SHA" =~ ^[0-9a-f]{64}$ ]] || die 'The reviewed sudo capability digest is invalid.'
visudo -cf "$STAGED/finalizer.sudoers" >/dev/null
visudo -c >/dev/null

[[ ! -L "$LOCK_ROOT" && "$(stat --format='%U:%G:%a' "$LOCK_ROOT")" == 'root:root:700' &&
  ! -L "$LOCK" && -f "$LOCK" && "$(stat --format='%U:%G:%a:%h' "$LOCK")" == 'root:root:600:1' ]] ||
  die 'The existing deployment lock is unsafe.'
exec 9<>"$LOCK"
lock_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")"
[[ "$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)" == "$lock_identity" ]] || die 'The opened deployment lock changed.'
flock --exclusive --nonblock 9 || die 'Another deployment operation is active.'
[[ "$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")" == "$lock_identity" ]] || die 'The deployment lock changed while acquiring it.'

verify_installed() {
  local path="$1" source="$2" mode="$3"
  [[ ! -L "$path" && -f "$path" && "$(stat --format='%U:%G:%a:%h' "$path")" == "root:root:$mode:1" ]] &&
    cmp -s "$path" "$source"
}
verify_predecessor() {
  local path="$1" expected_sha="$2" mode="$3"
  [[ ! -L "$path" && -f "$path" && "$(stat --format='%U:%G:%a:%h' "$path")" == "root:root:$mode:1" &&
    "$(sha256sum "$path" | awk '{print $1}')" == "$expected_sha" ]]
}

require_copy_prefix() {
  local source="$1" source_mode="$2" target="$3" target_mode="$4" expected_sha="$5"
  env -i PATH="$PATH" python3 -I - \
    "$source" "$source_mode" "$target" "$target_mode" "$expected_sha" <<'PY'
import hashlib
import os
import stat
import sys

source, source_mode_text, target, target_mode_text, expected_sha = sys.argv[1:]
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
if hashlib.sha256(expected).hexdigest() != expected_sha:
    raise SystemExit(1)
existing = stable_read(target, target_mode, True)
if len(existing) > len(expected) or existing != expected[:len(existing)]:
    raise SystemExit(1)
PY
}

prepare_copy_resumably() {
  local source="$1" source_mode="$2" target="$3" target_mode="$4" expected_sha="$5"
  env -i PATH="$PATH" python3 -I - \
    "$source" "$source_mode" "$target" "$target_mode" "$expected_sha" <<'PY'
import hashlib
import os
import stat
import sys

source, source_mode_text, target, target_mode_text, expected_sha = sys.argv[1:]
source_mode = int(source_mode_text, 8)
target_mode = int(target_mode_text, 8)
maximum = 2 * 1024 * 1024

def stable_source(path, mode):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
            != (0, 0, mode, 1)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or before.st_size == 0
            or before.st_size > maximum
            or os.path.realpath(path) != path
        ):
            raise RuntimeError()
        data = os.pread(descriptor, maximum + 1, 0)
        after = os.fstat(descriptor)
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
        os.close(descriptor)

expected = stable_source(source, source_mode)
if hashlib.sha256(expected).hexdigest() != expected_sha:
    raise SystemExit(1)
if os.path.lexists(target):
    descriptor = os.open(target, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(target)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
            != (0, 0, target_mode, 1)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or before.st_size > len(expected)
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
# Only an exact reviewed predecessor pair can be upgraded. Check both paths before
# replacing either; only a successor-finalizer plus its matching predecessor sudoers
# is accepted as the resumable one-file-installed state.
target_state='absent'
if [[ -e "$TARGET" || -L "$TARGET" ]]; then
  if verify_installed "$TARGET" "$STAGED/finalizer.sh" 755; then
    target_state='successor'
  elif verify_predecessor "$TARGET" "$PREDECESSOR_FINALIZER_SHA" 755; then
    target_state='predecessor'
  elif verify_predecessor "$TARGET" "$PREFLIGHT_FINALIZER_SHA" 755; then
    target_state='preflight'
  elif verify_predecessor "$TARGET" "$H17_FINALIZER_SHA" 755; then
    target_state='h17'
  else
    die 'A different finalizer already exists; no files were replaced.'
  fi
fi
sudoers_state='absent'
if [[ -e "$SUDOERS" || -L "$SUDOERS" ]]; then
  if verify_installed "$SUDOERS" "$STAGED/finalizer.sudoers" 440; then
    sudoers_state='successor'
  elif verify_predecessor "$SUDOERS" "$PREDECESSOR_SUDOERS_SHA" 440; then
    sudoers_state='predecessor'
  elif verify_predecessor "$SUDOERS" "$PREFLIGHT_SUDOERS_SHA" 440; then
    sudoers_state='preflight'
  elif verify_predecessor "$SUDOERS" "$H17_SUDOERS_SHA" 440; then
    sudoers_state='h17'
  else
    die 'A different sudo capability already exists; no files were replaced.'
  fi
fi
target_installing_state='absent'
if [[ -e "$TARGET_INSTALLING" || -L "$TARGET_INSTALLING" ]]; then
  require_copy_prefix "$STAGED/finalizer.sh" 600 "$TARGET_INSTALLING" 755 "$EXPECTED_SHA" ||
    die 'The finalizer temporary copy is not an exact resumable prefix.'
  target_installing_state='prefix'
fi
sudoers_installing_state='absent'
if [[ -e "$SUDOERS_INSTALLING" || -L "$SUDOERS_INSTALLING" ]]; then
  require_copy_prefix "$STAGED/finalizer.sudoers" 600 "$SUDOERS_INSTALLING" 440 \
    "$EXPECTED_SUDOERS_SHA" || die 'The sudo capability temporary copy is not an exact resumable prefix.'
  sudoers_installing_state='prefix'
fi
case "$target_state:$sudoers_state:$target_installing_state:$sudoers_installing_state" in
  absent:absent:absent:absent|absent:absent:prefix:absent) ;;
  predecessor:predecessor:absent:absent|predecessor:predecessor:prefix:absent) ;;
  preflight:preflight:absent:absent|preflight:preflight:prefix:absent) ;;
  h17:h17:absent:absent|h17:h17:prefix:absent) ;;
  successor:absent:absent:absent|successor:absent:absent:prefix) ;;
  successor:predecessor:absent:absent|successor:predecessor:absent:prefix) ;;
  successor:preflight:absent:absent|successor:preflight:absent:prefix) ;;
  successor:h17:absent:absent|successor:h17:absent:prefix) ;;
  successor:successor:absent:absent) ;;
  *) die 'The finalizer and sudo capability do not form one exact resumable release pair; no files were replaced.' ;;
esac
if ! verify_installed "$TARGET" "$STAGED/finalizer.sh" 755; then
  prepare_copy_resumably "$STAGED/finalizer.sh" 600 "$TARGET_INSTALLING" 755 "$EXPECTED_SHA"
  verify_installed "$TARGET_INSTALLING" "$STAGED/finalizer.sh" 755 ||
    die 'The finalizer temporary copy did not verify.'
  mv -- "$TARGET_INSTALLING" "$TARGET"
  sync -f /usr/local/sbin
fi
verify_installed "$TARGET" "$STAGED/finalizer.sh" 755 || die 'The installed finalizer did not verify.'
if ! verify_installed "$SUDOERS" "$STAGED/finalizer.sudoers" 440; then
  prepare_copy_resumably "$STAGED/finalizer.sudoers" 600 "$SUDOERS_INSTALLING" 440 \
    "$EXPECTED_SUDOERS_SHA"
  verify_installed "$SUDOERS_INSTALLING" "$STAGED/finalizer.sudoers" 440 ||
    die 'The sudo capability temporary copy did not verify.'
  visudo -cf "$SUDOERS_INSTALLING" >/dev/null
  mv -- "$SUDOERS_INSTALLING" "$SUDOERS"
  sync -f /etc/sudoers.d
fi
verify_installed "$SUDOERS" "$STAGED/finalizer.sudoers" 440 || die 'The installed sudo capability did not verify.'
visudo -c >/dev/null
printf '%s\n' 'Installed checksum-bound read-only preflight and disable-expiry capabilities; no credentials, running services, or legacy helper were changed.'
