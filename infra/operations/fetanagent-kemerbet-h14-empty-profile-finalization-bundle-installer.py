#!/usr/bin/env python3
"""Crash-resumable installer for the immutable H14 finalization bundle.

This installer only copies four already-digested, no-secret files from the
non-root workflow staging directory into a new root-owned bundle directory.
It never reads or mutates H14 state, Docker, Supabase, or provider state.
"""

import hashlib
import os
import re
import stat
import sys
import time

try:
    import fcntl
except ImportError:  # Windows is used only by the portable offline verifier.
    fcntl = None


PORTABLE_FIXTURE = False
SAFE_PARENT = (
    "/var/lib/fetanagent/"
    "kemerbet-quarantine-recovery-v14-host-retired-empty-profile-finalization-bridge-bundles"
)
STAGING = re.compile(
    r"/tmp/fetanagent-h14-empty-profile-finalization-[1-9][0-9]*-[1-9][0-9]*-[0-9a-f]{40}"
)
ROOT_LOADER = re.compile(r"/run/fetanagent-h14-empty-profile-installer\.[A-Za-z0-9]{8}")
LOCK_ROOT = "/run/fetanagent-h14-empty-profile-bundle-installer"
RELEASE = re.compile(r"[0-9a-f]{40}")
SHA = re.compile(r"[0-9a-f]{64}")
INSTALLER = "fetanagent-kemerbet-h14-empty-profile-finalization-bundle-installer.py"
FILES = (
    "fetanagent-kemerbet-h14-host-retired-empty-profile-finalization-bridge.sh",
    "fetanagent-kemerbet-h14-terminal-differential-validator.py",
    "fetanagent-kemerbet-h14-empty-profile-finalization-engine.py",
    "manifest-v1",
)
STAGED = tuple(sorted((*FILES, INSTALLER)))
HISTORICAL_RELEASE = "066572953de652e53634f562b4a63c0d9103865d"
HISTORICAL_FILES = {
    FILES[0]: (26458, "a0f27007fe5954beb2393f0acbadad6b28931a8eae01fec12bcd64eb995ede65"),
    FILES[1]: (17941, "d4e4f91603956e2051d9b77ce8a43392b6d46c062c3d397d28fa18f499b15542"),
    FILES[2]: (27047, "93ea024cdfa116f81a1ccb99e7145e60f5da012563d1cef33f9036dc25805855"),
    FILES[3]: (821, "2e6f683885ff3dda99a7f670cb4f14fe83a054f1055ca20bc178d4e2e673e877"),
}
BINARY = getattr(os, "O_BINARY", 0)
NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
CLOEXEC = getattr(os, "O_CLOEXEC", 0)

if PORTABLE_FIXTURE:
    SAFE_PARENT = os.environ["FETANAGENT_FIXTURE_BUNDLE_PARENT"]
    LOCK_ROOT = os.environ.get("FETANAGENT_FIXTURE_BUNDLE_LOCK_ROOT", LOCK_ROOT)
    fixture_historical_release = os.environ.get("FETANAGENT_FIXTURE_HISTORICAL_RELEASE")
    fixture_historical_contract = os.environ.get("FETANAGENT_FIXTURE_HISTORICAL_CONTRACT")
    if (fixture_historical_release is None) != (fixture_historical_contract is None):
        raise SystemExit(1)
    if fixture_historical_release is not None:
        fixture_items = fixture_historical_contract.split(",")
        if RELEASE.fullmatch(fixture_historical_release) is None or len(fixture_items) != len(FILES):
            raise SystemExit(1)
        fixture_contract = {}
        for filename, item in zip(FILES, fixture_items):
            size_text, digest = item.split(":", 1)
            if not size_text.isdigit() or SHA.fullmatch(digest) is None:
                raise SystemExit(1)
            fixture_contract[filename] = (int(size_text), digest)
        HISTORICAL_RELEASE = fixture_historical_release
        HISTORICAL_FILES = fixture_contract


class Rejected(Exception):
    pass


def reject():
    raise Rejected()


def identity(value):
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_uid,
        value.st_gid,
        value.st_nlink,
        value.st_size,
        value.st_mtime_ns,
    )


def sync_directory(path):
    if PORTABLE_FIXTURE:
        return
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | NOFOLLOW | CLOEXEC)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def exact_directory(path, mode, entries=None, require_root=True):
    value = os.lstat(path)
    if (
        not stat.S_ISDIR(value.st_mode)
        or (not PORTABLE_FIXTURE and os.path.realpath(path) != path)
        or (not PORTABLE_FIXTURE and require_root and (value.st_uid, value.st_gid) != (0, 0))
        or (not PORTABLE_FIXTURE and stat.S_IMODE(value.st_mode) != mode)
        or (entries is not None and sorted(os.listdir(path)) != sorted(entries))
    ):
        reject()
    return value


def exact_file(path, maximum, expected_sha=None, expected_mode=None, expected_owner=None):
    descriptor = os.open(path, os.O_RDONLY | BINARY | NOFOLLOW | CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_size > maximum
            or (not PORTABLE_FIXTURE and (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino))
            or (not PORTABLE_FIXTURE and os.path.realpath(path) != path)
            or (
                not PORTABLE_FIXTURE
                and expected_mode is not None
                and stat.S_IMODE(before.st_mode) != expected_mode
            )
            or (
                not PORTABLE_FIXTURE
                and expected_owner is not None
                and (before.st_uid, before.st_gid) != expected_owner
            )
        ):
            reject()
        chunks = []
        remaining = maximum + 1
        while remaining:
            chunk = os.read(descriptor, remaining)
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        data = b"".join(chunks)
        after = os.fstat(descriptor)
        if len(data) != before.st_size or (not PORTABLE_FIXTURE and identity(before) != identity(after)):
            reject()
    finally:
        os.close(descriptor)
    digest = hashlib.sha256(data).hexdigest()
    if expected_sha is not None and digest != expected_sha:
        reject()
    return data, before


def validate_bundle_parent(parent, release, current_entries):
    exact_directory(parent, 0o700)
    entries = set(os.listdir(parent))
    if not set(current_entries).issubset(entries):
        reject()
    for name in sorted(entries - set(current_entries)):
        if name != HISTORICAL_RELEASE or name == release:
            reject()
        historical = os.path.join(parent, name)
        exact_directory(historical, 0o700, FILES)
        for filename in FILES:
            expected_size, expected_sha = HISTORICAL_FILES[filename]
            _, value = exact_file(
                os.path.join(historical, filename),
                expected_size,
                expected_sha=expected_sha,
                expected_mode=0o400,
                expected_owner=(0, 0),
            )
            if value.st_size != expected_size:
                reject()


def create_directory(path, parent):
    if os.path.lexists(path):
        return
    os.mkdir(path, 0o700)
    if not PORTABLE_FIXTURE:
        os.chown(path, 0, 0)
        os.chmod(path, 0o700)
    sync_directory(parent)
    exact_directory(path, 0o700, [])


def acquire_installer_lock():
    if PORTABLE_FIXTURE and "FETANAGENT_FIXTURE_BUNDLE_LOCK_ROOT" not in os.environ:
        return None
    if fcntl is None:
        if PORTABLE_FIXTURE:
            return None
        reject()
    runtime = os.path.dirname(LOCK_ROOT)
    runtime_value = exact_directory(runtime, stat.S_IMODE(os.lstat(runtime).st_mode))
    if not PORTABLE_FIXTURE and (
        runtime != "/run"
        or (runtime_value.st_uid, runtime_value.st_gid, stat.S_IMODE(runtime_value.st_mode))
        != (0, 0, 0o755)
    ):
        reject()
    try:
        create_directory(LOCK_ROOT, runtime)
    except FileExistsError:
        pass
    exact_directory(LOCK_ROOT, 0o700)
    lock_path = os.path.join(LOCK_ROOT, "mutation.lock")
    if not os.path.lexists(lock_path):
        try:
            created = os.open(
                lock_path,
                os.O_RDWR | os.O_CREAT | os.O_EXCL | BINARY | NOFOLLOW | CLOEXEC,
                0o600,
            )
        except FileExistsError:
            pass
        else:
            try:
                if not PORTABLE_FIXTURE:
                    os.fchown(created, 0, 0)
                    os.fchmod(created, 0o600)
                os.fsync(created)
            finally:
                os.close(created)
            sync_directory(LOCK_ROOT)
    descriptor = os.open(lock_path, os.O_RDWR | BINARY | NOFOLLOW | CLOEXEC)
    before = os.fstat(descriptor)
    named = os.lstat(lock_path)
    if (
        not stat.S_ISREG(before.st_mode)
        or before.st_nlink != 1
        or before.st_size != 0
        or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
        or (
            not PORTABLE_FIXTURE
            and (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode)) != (0, 0, 0o600)
        )
        or (not PORTABLE_FIXTURE and os.path.realpath(lock_path) != lock_path)
    ):
        os.close(descriptor)
        reject()
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (BlockingIOError, OSError):
        os.close(descriptor)
        reject()
    after = os.fstat(descriptor)
    named_after = os.lstat(lock_path)
    if (
        identity(after) != identity(before)
        or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)
    ):
        os.close(descriptor)
        reject()
    return descriptor


def write_all(descriptor, data):
    offset = 0
    while offset < len(data):
        written = os.write(descriptor, data[offset:])
        if written <= 0:
            reject()
        offset += written


def publish_file(source, target, expected_sha, expected_size):
    expected, _ = exact_file(source, expected_size, expected_sha, 0o600)
    if len(expected) != expected_size:
        reject()
    directory = os.path.dirname(target)
    temporary = os.path.join(directory, f".{os.path.basename(target)}.installing")
    if os.path.lexists(target):
        if os.path.lexists(temporary):
            reject()
        data, _ = exact_file(target, expected_size, expected_sha, 0o400, (0, 0))
        if data != expected or len(data) != expected_size:
            reject()
        return
    if os.path.lexists(temporary):
        descriptor = os.open(temporary, os.O_RDWR | BINARY | NOFOLLOW | CLOEXEC)
        before = os.fstat(descriptor)
        named = os.lstat(temporary)
        prefix = os.read(descriptor, expected_size + 1)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or len(prefix) > expected_size
            or prefix != expected[: len(prefix)]
            or (not PORTABLE_FIXTURE and (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino))
            or (
                not PORTABLE_FIXTURE
                and (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode)) != (0, 0, 0o400)
            )
        ):
            os.close(descriptor)
            reject()
    else:
        descriptor = os.open(
            temporary,
            os.O_RDWR | os.O_CREAT | os.O_EXCL | BINARY | NOFOLLOW | CLOEXEC,
            0o400,
        )
        prefix = b""
        if PORTABLE_FIXTURE:
            os.chmod(temporary, 0o400)
        else:
            os.fchown(descriptor, 0, 0)
            os.fchmod(descriptor, 0o400)
    try:
        os.lseek(descriptor, 0, os.SEEK_END)
        write_all(descriptor, expected[len(prefix) :])
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    data, _ = exact_file(temporary, expected_size, expected_sha, 0o400, (0, 0))
    if data != expected or len(data) != expected_size:
        reject()
    sync_directory(directory)
    os.rename(temporary, target)
    sync_directory(directory)


def allowed_prefixes():
    result = {()}
    completed = []
    for name in FILES:
        result.add(tuple(sorted((*completed, f".{name}.installing"))))
        completed.append(name)
        result.add(tuple(sorted(completed)))
    return result


def main(argv):
    if len(argv) != 14 or (not PORTABLE_FIXTURE and os.geteuid() != 0):
        reject()
    (
        staging,
        parent,
        release,
        installer_sha,
        installer_size_text,
        script_sha,
        script_size_text,
        diagnostic_sha,
        diagnostic_size_text,
        engine_sha,
        engine_size_text,
        manifest_sha,
        manifest_size_text,
    ) = argv[1:]
    if (
        parent != SAFE_PARENT
        or RELEASE.fullmatch(release) is None
        or (not PORTABLE_FIXTURE and STAGING.fullmatch(staging) is None)
        or any(
            SHA.fullmatch(value) is None
            for value in (installer_sha, script_sha, diagnostic_sha, engine_sha, manifest_sha)
        )
        or any(
            re.fullmatch(r"[1-9][0-9]{0,8}", value) is None
            for value in (
                installer_size_text,
                script_size_text,
                diagnostic_size_text,
                engine_size_text,
                manifest_size_text,
            )
        )
    ):
        reject()
    installer_size, script_size, diagnostic_size, engine_size, manifest_size = map(
        int,
        (
            installer_size_text,
            script_size_text,
            diagnostic_size_text,
            engine_size_text,
            manifest_size_text,
        ),
    )
    installer_lock = acquire_installer_lock()
    if PORTABLE_FIXTURE and os.environ.get("FETANAGENT_FIXTURE_BUNDLE_LOCK_READY"):
        ready = os.environ["FETANAGENT_FIXTURE_BUNDLE_LOCK_READY"]
        descriptor = os.open(ready, os.O_WRONLY | os.O_CREAT | os.O_EXCL | BINARY | CLOEXEC, 0o600)
        try:
            write_all(descriptor, b"locked\n")
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        time.sleep(float(os.environ.get("FETANAGENT_FIXTURE_BUNDLE_LOCK_HOLD_SECONDS", "0")))
    expected_installer_path = os.path.join(staging, INSTALLER)
    if PORTABLE_FIXTURE:
        same_installer = os.path.normcase(os.path.normpath(argv[0])) == os.path.normcase(
            os.path.normpath(expected_installer_path)
        )
    else:
        same_installer = (
            ROOT_LOADER.fullmatch(argv[0]) is not None and os.path.realpath(argv[0]) == argv[0]
        )
    if not same_installer:
        reject()
    if not PORTABLE_FIXTURE:
        loader_data, _ = exact_file(
            argv[0], installer_size, installer_sha, 0o400, (0, 0)
        )
        if len(loader_data) != installer_size:
            reject()
    exact_directory(staging, 0o700, STAGED, require_root=False)
    source_owner = os.lstat(expected_installer_path)
    if not PORTABLE_FIXTURE and source_owner.st_uid == 0:
        reject()
    staged_owner = (source_owner.st_uid, source_owner.st_gid)
    for name in STAGED:
        value = os.lstat(os.path.join(staging, name))
        if not PORTABLE_FIXTURE and (value.st_uid, value.st_gid) != staged_owner:
            reject()
    exact_file(
        expected_installer_path,
        installer_size,
        installer_sha,
        0o600,
        staged_owner,
    )

    ancestor = os.path.dirname(parent)
    exact_directory(ancestor, stat.S_IMODE(os.lstat(ancestor).st_mode))
    if not PORTABLE_FIXTURE and stat.S_IMODE(os.lstat(ancestor).st_mode) & 0o022:
        reject()
    if not os.path.lexists(parent):
        create_directory(parent, ancestor)
        sync_directory(ancestor)
    exact_directory(parent, 0o700)
    installing = os.path.join(parent, f".installing-{release}")
    final = os.path.join(parent, release)
    if os.path.lexists(final):
        validate_bundle_parent(parent, release, {release})
        exact_directory(final, 0o700, FILES)
        targets = (
            (FILES[0], script_sha, script_size),
            (FILES[1], diagnostic_sha, diagnostic_size),
            (FILES[2], engine_sha, engine_size),
            (FILES[3], manifest_sha, manifest_size),
        )
        for name, digest, size in targets:
            exact_file(os.path.join(final, name), size, digest, 0o400, (0, 0))
        sys.stdout.write(final + "\n")
        if installer_lock is not None:
            os.close(installer_lock)
        return
    if not os.path.lexists(installing):
        validate_bundle_parent(parent, release, set())
        create_directory(installing, parent)
    validate_bundle_parent(parent, release, {f".installing-{release}"})
    exact_directory(installing, 0o700)
    if tuple(sorted(os.listdir(installing))) not in allowed_prefixes():
        reject()
    targets = (
        (FILES[0], script_sha, script_size),
        (FILES[1], diagnostic_sha, diagnostic_size),
        (FILES[2], engine_sha, engine_size),
        (FILES[3], manifest_sha, manifest_size),
    )
    for name, digest, size in targets:
        publish_file(os.path.join(staging, name), os.path.join(installing, name), digest, size)
    exact_directory(installing, 0o700, FILES)
    sync_directory(installing)
    os.rename(installing, final)
    sync_directory(parent)
    validate_bundle_parent(parent, release, {release})
    exact_directory(final, 0o700, FILES)
    sys.stdout.write(final + "\n")
    if installer_lock is not None:
        os.close(installer_lock)


try:
    main(sys.argv)
except BaseException:
    raise SystemExit(1)
