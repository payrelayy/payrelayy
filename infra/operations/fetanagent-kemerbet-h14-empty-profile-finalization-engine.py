#!/usr/bin/env python3
"""One-use H14 host-retired profile-finalization transaction engine.

The engine never starts a container, calls a provider, enables Amount or
Transfer, or replaces the installed helper.  It validates the durable P0-P5
prefix, pins every canonical base record, and performs only the canonical
append/rename finalization sequence.
"""

import hashlib
import os
import re
import stat
import sys


PORTABLE_FIXTURE = False
CANONICAL_RELEASE = "06459511d9330a0e1d956c42529b81aa9970e7a2"
CANONICAL_HELPER_SHA256 = "c36c2b509ef3f560f934dfaf033e34656f36748f4b82e3c0a3398564f8161f58"
STAGING_PROJECT_REF = "spzpiyxheappsfyswewl"
STAGING_DROPLET_ID = "593344964"
H14_PARENT = "/var/lib/fetanagent/kemerbet-quarantine-recovery-v14"
BRIDGE_PARENT = (
    "/var/lib/fetanagent/"
    "kemerbet-quarantine-recovery-v14-host-retired-profile-tree-finalization-bridge"
)
HELPER_PATH = "/usr/local/sbin/fetanagent-staging-deploy-helper"
ACK_SOURCE = (
    "/var/lib/docker/volumes/"
    "fetanagent-staging-beta_kemerbet_session_control/_data/"
    "kemerbet-quarantine-recovery-profile-prepared-v1"
)
MARKER_SOURCE = (
    "/var/lib/fetanagent/kemerbet-readiness-cohort-receipts/"
    "kemerbet-readiness-cohort-security-recovery-failed-terminal-v1"
)
MARKER_TARGET = (
    "/var/lib/fetanagent/kemerbet-readiness-cohort-receipts/"
    "kemerbet-readiness-cohort-security-recovery-profile-finalized-v1"
)
MARKER = b"fetanagent-kemerbet-session-active-v1\n"
QUARANTINED_PROFILE_MAX_OBJECTS = 512
QUARANTINED_PROFILE_MAX_FILE_BYTES = 8 * 1024 * 1024
QUARANTINED_PROFILE_MAX_TOTAL_BYTES = 16 * 1024 * 1024
QUARANTINED_PROFILE_MAX_DEPTH = 8
QUARANTINED_PROFILE_MAX_NAME_BYTES = 128
QUARANTINED_PROFILE_MAX_PATH_BYTES = 256
QUARANTINED_PROFILE_FILE_MODES = {0o600, 0o644}
EXPIRY_GUARD_SERVICE_SHA256 = "c206af7923aae32743ddf841ee8e673544e963e5a8730c3c6074fa7852dcd063"
EXPIRY_GUARD_TIMER_SHA256 = "d155578fb560103d3452ba2d489828f29a8a6b8b1d604eb37235f7d5ef07eb48"
EXPIRY_GUARD_CALENDAR = "2026-08-29 12:47:49 UTC"
PREDECESSOR_BRIDGE_RELEASE = "066572953de652e53634f562b4a63c0d9103865d"
PREDECESSOR_BRIDGE_PARENT = (
    "/var/lib/fetanagent/"
    "kemerbet-quarantine-recovery-v14-host-retired-empty-profile-finalization-bridge"
)
PREDECESSOR_BUNDLE_ROOT = (
    "/var/lib/fetanagent/"
    "kemerbet-quarantine-recovery-v14-host-retired-empty-profile-finalization-bridge-bundles/"
    + PREDECESSOR_BRIDGE_RELEASE
)
PREDECESSOR_BUNDLE_FILES = {
    "fetanagent-kemerbet-h14-host-retired-empty-profile-finalization-bridge.sh": (
        26458,
        "a0f27007fe5954beb2393f0acbadad6b28931a8eae01fec12bcd64eb995ede65",
    ),
    "fetanagent-kemerbet-h14-terminal-differential-validator.py": (
        17941,
        "d4e4f91603956e2051d9b77ce8a43392b6d46c062c3d397d28fa18f499b15542",
    ),
    "fetanagent-kemerbet-h14-empty-profile-finalization-engine.py": (
        27047,
        "93ea024cdfa116f81a1ccb99e7145e60f5da012563d1cef33f9036dc25805855",
    ),
    "manifest-v1": (
        821,
        "2e6f683885ff3dda99a7f670cb4f14fe83a054f1055ca20bc178d4e2e673e877",
    ),
}

if PORTABLE_FIXTURE:
    # The offline verifier replaces only the literal PORTABLE_FIXTURE value in
    # an in-memory copy.  Production cannot select these environment overrides.
    CANONICAL_HELPER_SHA256 = os.environ["FETANAGENT_FIXTURE_HELPER_SHA256"]
    H14_PARENT = os.environ["FETANAGENT_FIXTURE_H14_PARENT"]
    BRIDGE_PARENT = os.environ["FETANAGENT_FIXTURE_BRIDGE_PARENT"]
    HELPER_PATH = os.environ["FETANAGENT_FIXTURE_HELPER_PATH"]
    ACK_SOURCE = os.environ["FETANAGENT_FIXTURE_ACK_SOURCE"]
    MARKER_SOURCE = os.environ["FETANAGENT_FIXTURE_MARKER_SOURCE"]
    MARKER_TARGET = os.environ["FETANAGENT_FIXTURE_MARKER_TARGET"]
    PREDECESSOR_BRIDGE_PARENT = os.environ["FETANAGENT_FIXTURE_PREDECESSOR_BRIDGE_PARENT"]
    PREDECESSOR_BUNDLE_ROOT = os.environ["FETANAGENT_FIXTURE_PREDECESSOR_BUNDLE_ROOT"]
    PREDECESSOR_BUNDLE_FILES = {
        name: (
            int(os.environ[f"FETANAGENT_FIXTURE_PREDECESSOR_SIZE_{index}"]),
            os.environ[f"FETANAGENT_FIXTURE_PREDECESSOR_SHA256_{index}"],
        )
        for index, name in enumerate(PREDECESSOR_BUNDLE_FILES)
    }

RELEASE = re.compile(r"[0-9a-f]{40}")
SHA = re.compile(r"[0-9a-f]{64}")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
PROFILE_UUID = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
)
V3 = re.compile(
    rb"([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}) "
    rb"(hmac-sha256-agent-identity-v1:([0-9a-f]{64})) "
    rb"(hmac-sha256-agent-profile-pin-v3:\3)\n"
)
BINARY_FLAG = getattr(os, "O_BINARY", 0)
READ_FLAGS = (
    os.O_RDONLY
    | BINARY_FLAG
    | getattr(os, "O_NOFOLLOW", 0)
    | getattr(os, "O_CLOEXEC", 0)
    | getattr(os, "O_NONBLOCK", 0)
)
DIRECTORY_READ_FLAGS = (
    os.O_RDONLY
    | BINARY_FLAG
    | getattr(os, "O_DIRECTORY", 0)
    | getattr(os, "O_NOFOLLOW", 0)
    | getattr(os, "O_CLOEXEC", 0)
    | getattr(os, "O_NONBLOCK", 0)
)
DESCRIPTOR_RELATIVE_TREE = (
    os.name == "posix"
    and getattr(os, "O_DIRECTORY", 0) != 0
    and getattr(os, "O_NOFOLLOW", 0) != 0
    and os.open in os.supports_dir_fd
    and os.stat in os.supports_dir_fd
    and os.listdir in os.supports_fd
)

BASE_CONTRACT = {
    "claim-stage-consumption-v1": ("file", (0, 0), 0o600, 8192),
    "empty-predecessor-checkpoint-adoption-v1": ("file", (0, 0), 0o600, 8192),
    "host-retired-v1": ("file", (0, 0), 0o600, 8192),
    "intent-v1": ("file", (0, 0), 0o600, 8192),
    "owner-runtime-restored-v1": ("file", (0, 0), 0o600, 8192),
    "player-stage-consumption-v1": ("file", (0, 0), 0o600, 8192),
    "predecessor-helper": ("file", (0, 0), 0o400, 2 * 1024 * 1024),
    "quarantined-profile-v1": ("directory", (10001, 10001), 0o700, 0),
    "retired-binding-v3": ("file", (10001, 10001), 0o600, 230),
    "retired-retryable-failure-v1": ("file", (0, 10001), 0o440, 37),
    "runtime-retired-v1": ("file", (0, 0), 0o600, 8192),
    "runtime-retirement-intent-v1": ("file", (0, 0), 0o600, 8192),
}
BASE = set(BASE_CONTRACT)
P0_TO_P5 = [
    BASE,
    BASE | {".recovery-identity-authorization-v1.installing"},
    BASE | {"recovery-identity-authorization-v1"},
    BASE | {"recovery-identity-authorization-v1", ".terminal-recovery-marker-v1.installing"},
    BASE | {"recovery-identity-authorization-v1", "terminal-recovery-marker-v1"},
    BASE
    | {
        "recovery-identity-authorization-v1",
        "terminal-recovery-marker-v1",
        "database-profile-prepared-v1",
    },
    BASE
    | {
        "recovery-identity-authorization-v1",
        "terminal-recovery-marker-v1",
        "database-profile-prepared-v1",
        ".runtime-ready-v1.installing",
    },
    BASE
    | {
        "recovery-identity-authorization-v1",
        "terminal-recovery-marker-v1",
        "database-profile-prepared-v1",
        "runtime-ready-v1",
    },
]


class Rejected(Exception):
    pass


def reject():
    raise Rejected()


def metadata_matches(value, owner, mode, links=None):
    if PORTABLE_FIXTURE:
        return links is None or value.st_nlink == links
    return (
        (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) == (*owner, mode)
        and (links is None or value.st_nlink == links)
    )


def object_identity(value):
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


def read_at(descriptor, maximum):
    if hasattr(os, "pread"):
        return os.pread(descriptor, maximum, 0)
    if not PORTABLE_FIXTURE:
        reject()
    os.lseek(descriptor, 0, os.SEEK_SET)
    return os.read(descriptor, maximum)


def exact_file(path, owner, mode, maximum, exact_size=None):
    descriptor = os.open(path, READ_FLAGS)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        if PORTABLE_FIXTURE:
            invalid = (
                not stat.S_ISREG(before.st_mode)
                or before.st_nlink != 1
                or before.st_size > maximum
                or (exact_size is not None and before.st_size != exact_size)
            )
        else:
            invalid = (
                not stat.S_ISREG(before.st_mode)
                or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
                or not metadata_matches(before, owner, mode, 1)
                or before.st_size > maximum
                or (exact_size is not None and before.st_size != exact_size)
                or os.path.realpath(path) != path
            )
        if invalid:
            reject()
        data = read_at(descriptor, maximum + 1)
        after = os.fstat(descriptor)
        if len(data) != before.st_size or (
            not PORTABLE_FIXTURE and object_identity(before) != object_identity(after)
        ):
            reject()
        return data, before
    finally:
        os.close(descriptor)


def exact_lines(path, owner, mode, count):
    data, value = exact_file(path, owner, mode, 8192)
    try:
        text = data.decode("ascii")
    except UnicodeDecodeError:
        reject()
    lines = text.splitlines()
    if len(lines) != count or data != ("\n".join(lines) + "\n").encode("ascii"):
        reject()
    return lines, data, value


def exact_directory(path, owner, mode, entries=None):
    value = os.lstat(path)
    if (
        not stat.S_ISDIR(value.st_mode)
        or not metadata_matches(value, owner, mode)
        or (not PORTABLE_FIXTURE and os.path.realpath(path) != path)
    ):
        reject()
    if entries is not None and sorted(os.listdir(path)) != sorted(entries):
        reject()
    return value


def pin(value, kind, digest):
    return "|".join(
        [
            kind,
            f"{value.st_dev}:{value.st_ino}",
            f"{value.st_uid}:{value.st_gid}:{stat.S_IMODE(value.st_mode):o}:{value.st_nlink}:{value.st_size}",
            digest,
        ]
    )


def exact_failed_predecessor_pins():
    installing_name = f".installing-{PREDECESSOR_BRIDGE_RELEASE}"
    parent_value = exact_directory(
        PREDECESSOR_BRIDGE_PARENT,
        (0, 0),
        0o700,
        [installing_name],
    )
    installing_path = os.path.join(PREDECESSOR_BRIDGE_PARENT, installing_name)
    installing_value = exact_directory(installing_path, (0, 0), 0o700, [])
    ledger_material = (
        "\n".join(
            [
                f"release={PREDECESSOR_BRIDGE_RELEASE}",
                f"parent={pin(parent_value, 'directory', hashlib.sha256(installing_name.encode('ascii')).hexdigest())}",
                f"installing={pin(installing_value, 'directory', hashlib.sha256(b'entries=').hexdigest())}",
            ]
        )
        + "\n"
    ).encode("ascii")

    bundle_value = exact_directory(
        PREDECESSOR_BUNDLE_ROOT,
        (0, 0),
        0o700,
        PREDECESSOR_BUNDLE_FILES,
    )
    bundle_lines = [
        f"release={PREDECESSOR_BRIDGE_RELEASE}",
        "bundle="
        + pin(
            bundle_value,
            "directory",
            hashlib.sha256(
                ("entries=" + "\n".join(sorted(PREDECESSOR_BUNDLE_FILES))).encode("ascii")
            ).hexdigest(),
        ),
    ]
    for name in sorted(PREDECESSOR_BUNDLE_FILES):
        expected_size, expected_sha = PREDECESSOR_BUNDLE_FILES[name]
        data, value = exact_file(
            os.path.join(PREDECESSOR_BUNDLE_ROOT, name),
            (0, 0),
            0o400,
            expected_size,
            expected_size,
        )
        if hashlib.sha256(data).hexdigest() != expected_sha:
            reject()
        bundle_lines.append(f"{name}={pin(value, 'file', expected_sha)}")
    bundle_material = ("\n".join(bundle_lines) + "\n").encode("ascii")
    return (
        hashlib.sha256(ledger_material).hexdigest(),
        hashlib.sha256(bundle_material).hexdigest(),
    )


def exact_expiry_guard_records(ledger_root, bridge_release):
    retirement_intent = (
        "\n".join(
            [
                "version=1",
                "contract=fetanagent-staging-expired-runtime-guard-retirement-v1",
                "state=authorized",
                f"bridge_release={bridge_release}",
                f"canonical_h14_release={CANONICAL_RELEASE}",
                f"staging_project_ref={STAGING_PROJECT_REF}",
                f"staging_droplet_id={STAGING_DROPLET_ID}",
                "service_name=fetanagent-staging-runtime-expiry-stop.service",
                f"service_unit_sha256={EXPIRY_GUARD_SERVICE_SHA256}",
                "timer_name=fetanagent-staging-runtime-expiry-stop.timer",
                f"timer_unit_sha256={EXPIRY_GUARD_TIMER_SHA256}",
                f"timer_on_calendar={EXPIRY_GUARD_CALENDAR}",
                "timer_expired=true",
                f"installed_helper_sha256={CANONICAL_HELPER_SHA256}",
                "financial_actions_mode=dry_run",
                "provider_action_enabled=false",
                "amount_entry_enabled=false",
                "transfer_enabled=false",
                "money_moved=false",
            ]
        )
        + "\n"
    ).encode("ascii")
    intent_sha = hashlib.sha256(retirement_intent).hexdigest()
    retired = (
        "\n".join(
            [
                "version=1",
                "contract=fetanagent-staging-expired-runtime-guard-retirement-v1",
                "state=completed",
                f"bridge_release={bridge_release}",
                f"canonical_h14_release={CANONICAL_RELEASE}",
                f"retirement_intent_sha256={intent_sha}",
                "service_load_state=not-found",
                "timer_load_state=not-found",
                "unit_files_absent=true",
                "timer_enablement_link_absent=true",
                "service_active_state=inactive",
                "service_sub_state=dead",
                "service_main_pid=0",
                "service_job_absent=true",
                "timer_active_state=inactive",
                "timer_sub_state=dead",
                "timer_job_absent=true",
                "installed_helper_changed=false",
                "financial_actions_mode=dry_run",
                "provider_action_enabled=false",
                "amount_entry_enabled=false",
                "transfer_enabled=false",
                "money_moved=false",
            ]
        )
        + "\n"
    ).encode("ascii")
    for name, expected in (
        ("expiry-guard-retirement-intent-v1", retirement_intent),
        ("expiry-guard-retired-v1", retired),
    ):
        data, _ = exact_file(
            os.path.join(ledger_root, name),
            (0, 0),
            0o600,
            len(expected),
            len(expected),
        )
        if data != expected:
            reject()
    return hashlib.sha256(retirement_intent).hexdigest(), hashlib.sha256(retired).hexdigest()


def reject_nested_mounts(path):
    if PORTABLE_FIXTURE:
        return
    descriptor = os.open(
        "/proc/self/mountinfo",
        os.O_RDONLY | BINARY_FLAG | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        data = b""
        while len(data) <= 1024 * 1024:
            chunk = os.read(descriptor, min(65536, 1024 * 1024 + 1 - len(data)))
            if not chunk:
                break
            data += chunk
    finally:
        os.close(descriptor)
    if not data or len(data) > 1024 * 1024 or not data.endswith(b"\n"):
        reject()
    root = os.fsencode(os.path.realpath(path)).rstrip(b"/")
    escaped = re.compile(rb"\\([0-7]{3})")
    for line in data.splitlines():
        fields = line.split()
        if len(fields) < 10 or b"-" not in fields:
            reject()
        mount_point = escaped.sub(lambda match: bytes([int(match.group(1), 8)]), fields[4])
        if mount_point == root or mount_point.startswith(root + b"/"):
            reject()


def quarantined_metadata_matches(value, mode, links=None):
    if PORTABLE_FIXTURE:
        # The Linux fixture exercises the descriptor-relative implementation and
        # its mode/link invariants without requiring uid 10001.  Windows keeps
        # the older path-only portability concession because it has neither
        # openat-style dir_fd traversal nor POSIX mode semantics.
        return (
            (not DESCRIPTOR_RELATIVE_TREE or stat.S_IMODE(value.st_mode) == mode)
            and (links is None or value.st_nlink == links)
        )
    return metadata_matches(value, (10001, 10001), mode, links)


def reject_descriptor_xattrs(descriptor):
    if not hasattr(os, "listxattr"):
        if PORTABLE_FIXTURE:
            return
        reject()
    try:
        attributes = os.listxattr(f"/proc/self/fd/{descriptor}", follow_symlinks=True)
    except (OSError, TypeError, ValueError):
        reject()
    if attributes:
        reject()


def quarantined_tree_snapshot_descriptor_relative(path):
    # Every child is named relative to an already-open parent descriptor.  All
    # descriptors remain open through the final name/identity/xattr recheck, so
    # an ancestor rename or symlink swap cannot redirect a later read.
    opened = []
    bindings = []
    directories = []
    records = []
    object_count = 0
    total_bytes = 0
    root_named = os.lstat(path)
    try:
        root_descriptor = os.open(path, DIRECTORY_READ_FLAGS)
        opened.append(root_descriptor)
        root_value = os.fstat(root_descriptor)
        if (
            not stat.S_ISDIR(root_value.st_mode)
            or object_identity(root_named) != object_identity(root_value)
            or not quarantined_metadata_matches(root_value, 0o700)
            or (not PORTABLE_FIXTURE and os.path.realpath(path) != path)
        ):
            reject()
        root_identity = object_identity(root_value)
        root_device = root_value.st_dev
        reject_descriptor_xattrs(root_descriptor)
        reject_nested_mounts(path)
        pending = [(root_descriptor, tuple())]

        while pending:
            current_descriptor, parent_parts = pending.pop()
            try:
                names = sorted(os.listdir(current_descriptor), key=os.fsencode)
            except OSError:
                reject()
            directories.append((current_descriptor, tuple(names)))
            for name in names:
                object_count += 1
                if object_count > QUARANTINED_PROFILE_MAX_OBJECTS:
                    reject()
                name_bytes = os.fsencode(name)
                relative_parts = (*parent_parts, name)
                relative_bytes = b"/".join(os.fsencode(part) for part in relative_parts)
                if (
                    not name_bytes
                    or name_bytes in (b".", b"..")
                    or b"/" in name_bytes
                    or b"\0" in name_bytes
                    or len(relative_parts) > QUARANTINED_PROFILE_MAX_DEPTH
                    or len(name_bytes) > QUARANTINED_PROFILE_MAX_NAME_BYTES
                    or len(relative_bytes) > QUARANTINED_PROFILE_MAX_PATH_BYTES
                ):
                    reject()
                try:
                    named = os.stat(
                        name,
                        dir_fd=current_descriptor,
                        follow_symlinks=False,
                    )
                except OSError:
                    reject()
                if named.st_dev != root_device:
                    reject()

                if stat.S_ISDIR(named.st_mode):
                    try:
                        descriptor = os.open(
                            name,
                            DIRECTORY_READ_FLAGS,
                            dir_fd=current_descriptor,
                        )
                    except OSError:
                        reject()
                    opened.append(descriptor)
                    value = os.fstat(descriptor)
                    if (
                        not stat.S_ISDIR(value.st_mode)
                        or object_identity(value) != object_identity(named)
                        or value.st_dev != root_device
                        or not quarantined_metadata_matches(value, 0o700)
                    ):
                        reject()
                    reject_descriptor_xattrs(descriptor)
                    pending.append((descriptor, relative_parts))
                    content_sha = "-"
                    kind = "directory"
                elif stat.S_ISREG(named.st_mode):
                    mode = stat.S_IMODE(named.st_mode)
                    if mode not in QUARANTINED_PROFILE_FILE_MODES:
                        reject()
                    try:
                        descriptor = os.open(name, READ_FLAGS, dir_fd=current_descriptor)
                    except OSError:
                        reject()
                    opened.append(descriptor)
                    before = os.fstat(descriptor)
                    if (
                        not stat.S_ISREG(before.st_mode)
                        or object_identity(before) != object_identity(named)
                        or before.st_dev != root_device
                        or not quarantined_metadata_matches(before, mode, 1)
                        or before.st_size > QUARANTINED_PROFILE_MAX_FILE_BYTES
                    ):
                        reject()
                    reject_descriptor_xattrs(descriptor)
                    data = read_at(descriptor, QUARANTINED_PROFILE_MAX_FILE_BYTES + 1)
                    value = os.fstat(descriptor)
                    if len(data) != before.st_size or object_identity(value) != object_identity(before):
                        reject()
                    total_bytes += len(data)
                    if total_bytes > QUARANTINED_PROFILE_MAX_TOTAL_BYTES:
                        reject()
                    content_sha = hashlib.sha256(data).hexdigest()
                    kind = "file"
                else:
                    reject()

                identity = object_identity(value)
                bindings.append((current_descriptor, name, descriptor, identity))
                record = "|".join(
                    [
                        kind,
                        relative_bytes.hex(),
                        f"{value.st_dev}:{value.st_ino}",
                        f"{value.st_uid}:{value.st_gid}:{stat.S_IMODE(value.st_mode):o}:{value.st_nlink}:{value.st_size}",
                        str(value.st_mtime_ns),
                        content_sha,
                    ]
                ).encode("ascii")
                records.append((relative_bytes, record))

        reject_nested_mounts(path)
        if (
            object_identity(os.lstat(path)) != root_identity
            or object_identity(os.fstat(root_descriptor)) != root_identity
        ):
            reject()
        for descriptor, expected_names in directories:
            try:
                actual_names = tuple(sorted(os.listdir(descriptor), key=os.fsencode))
            except OSError:
                reject()
            if actual_names != expected_names:
                reject()
        for parent_descriptor, name, descriptor, expected_identity in bindings:
            try:
                named = os.stat(
                    name,
                    dir_fd=parent_descriptor,
                    follow_symlinks=False,
                )
            except OSError:
                reject()
            if (
                object_identity(named) != expected_identity
                or object_identity(os.fstat(descriptor)) != expected_identity
            ):
                reject()
            reject_descriptor_xattrs(descriptor)
        reject_descriptor_xattrs(root_descriptor)

        digest = hashlib.sha256()
        for _, record in sorted(records):
            digest.update(len(record).to_bytes(8, "big"))
            digest.update(record)
        return digest.hexdigest()
    finally:
        for descriptor in reversed(opened):
            try:
                os.close(descriptor)
            except OSError:
                pass


def quarantined_tree_snapshot_portable_path(path):
    # Windows-only portable verifier fallback.  Production rejects runtimes
    # without the descriptor-relative POSIX primitives above.
    root_value = exact_directory(path, (10001, 10001), 0o700)
    root_device = root_value.st_dev
    object_count = 0
    total_bytes = 0
    records = []
    evidence_identities = [(path, object_identity(root_value))]
    pending = [path]
    while pending:
        current = pending.pop()
        try:
            names = sorted(os.listdir(current), key=os.fsencode)
        except OSError:
            reject()
        for name in names:
            object_count += 1
            if object_count > QUARANTINED_PROFILE_MAX_OBJECTS:
                reject()
            current_path = os.path.join(current, name)
            relative = os.path.relpath(current_path, path)
            relative_parts = relative.split(os.sep)
            name_bytes = os.fsencode(name)
            relative_bytes = b"/".join(os.fsencode(part) for part in relative_parts)
            if (
                not relative_bytes
                or len(relative_parts) > QUARANTINED_PROFILE_MAX_DEPTH
                or len(name_bytes) > QUARANTINED_PROFILE_MAX_NAME_BYTES
                or len(relative_bytes) > QUARANTINED_PROFILE_MAX_PATH_BYTES
                or b"\0" in relative_bytes
            ):
                reject()
            named = os.lstat(current_path)
            if named.st_dev != root_device:
                reject()
            if stat.S_ISDIR(named.st_mode):
                value = exact_directory(current_path, (10001, 10001), 0o700)
                content_sha = "-"
                evidence_identities.append((current_path, object_identity(value)))
                pending.append(current_path)
                kind = "directory"
            elif stat.S_ISREG(named.st_mode):
                data, value = exact_file(
                    current_path,
                    (10001, 10001),
                    stat.S_IMODE(named.st_mode),
                    QUARANTINED_PROFILE_MAX_FILE_BYTES,
                )
                total_bytes += len(data)
                if total_bytes > QUARANTINED_PROFILE_MAX_TOTAL_BYTES:
                    reject()
                content_sha = hashlib.sha256(data).hexdigest()
                evidence_identities.append((current_path, object_identity(value)))
                kind = "file"
            else:
                reject()
            record = "|".join(
                [
                    kind,
                    relative_bytes.hex(),
                    f"{value.st_dev}:{value.st_ino}",
                    f"{value.st_uid}:{value.st_gid}:{stat.S_IMODE(value.st_mode):o}:{value.st_nlink}:{value.st_size}",
                    str(value.st_mtime_ns),
                    content_sha,
                ]
            ).encode("ascii")
            records.append((relative_bytes, record))
    digest = hashlib.sha256()
    for _, record in sorted(records):
        digest.update(len(record).to_bytes(8, "big"))
        digest.update(record)
    for evidence_path, expected_identity in evidence_identities:
        if object_identity(os.lstat(evidence_path)) != expected_identity:
            reject()
    return digest.hexdigest()


def quarantined_tree_snapshot(path):
    # The retired profile is evidence, not an empty scratch directory.  Pin its
    # complete bounded tree without following links so retained Chromium state
    # cannot be discarded, replaced, or changed between transaction phases.
    if DESCRIPTOR_RELATIVE_TREE:
        return quarantined_tree_snapshot_descriptor_relative(path)
    if PORTABLE_FIXTURE:
        return quarantined_tree_snapshot_portable_path(path)
    reject()


def base_pins(root):
    result = []
    for index, name in enumerate(sorted(BASE_CONTRACT)):
        kind, owner, mode, maximum = BASE_CONTRACT[name]
        path = os.path.join(root, name)
        if kind == "file":
            data, value = exact_file(path, owner, mode, maximum)
            digest = hashlib.sha256(data).hexdigest()
        else:
            value = exact_directory(path, owner, mode)
            marker, _ = exact_file(
                os.path.join(path, ".fetanagent-unclean-session-generation-v1"),
                (10001, 10001),
                0o600,
                len(MARKER),
                len(MARKER),
            )
            if marker != MARKER:
                reject()
            first_snapshot = quarantined_tree_snapshot(path)
            second_snapshot = quarantined_tree_snapshot(path)
            after = exact_directory(path, owner, mode)
            if first_snapshot != second_snapshot or object_identity(value) != object_identity(after):
                reject()
            digest = first_snapshot
        result.append(f"base_entry_{index:02d}={name}|{pin(value, kind, digest)}")
    return result


def select_exact(first, second, owner, mode, maximum, exact_size=None):
    selected = []
    for path in (first, second):
        if os.path.lexists(path):
            data, value = exact_file(path, owner, mode, maximum, exact_size)
            selected.append((path, data, value))
    if len(selected) != 1:
        reject()
    return selected[0]


def require_v3(path, owner, mode):
    data, value = exact_file(path, owner, mode, 230, 230)
    matched = V3.fullmatch(data)
    if matched is None:
        reject()
    return data, value, matched


def parse_h14_identity(root):
    intent, intent_data, _ = exact_lines(os.path.join(root, "intent-v1"), (0, 0), 0o600, 22)
    if (
        intent[0] != "contract=fetanagent-kemerbet-quarantine-recovery-v14"
        or intent[1] != "state=authorized"
        or intent[2] != f"recovery_release={CANONICAL_RELEASE}"
        or intent[5] != f"successor_helper_sha256={CANONICAL_HELPER_SHA256}"
        or not intent[7].startswith("old_claim_id=")
        or UUID.fullmatch(intent[7].split("=", 1)[1]) is None
        or not intent[8].startswith("old_profile_id=")
        or PROFILE_UUID.fullmatch(intent[8].split("=", 1)[1]) is None
    ):
        reject()
    return intent[7].split("=", 1)[1], intent[8].split("=", 1)[1], intent_data


def expected_intent(
    root,
    helper,
    ack_source,
    marker_source,
    marker_target,
    ledger_root,
    bridge_release,
    script_sha,
    diagnostic_sha,
    engine_sha,
    manifest_sha,
):
    if (
        root != f"{H14_PARENT}/{CANONICAL_RELEASE}"
        or helper != HELPER_PATH
        or ack_source != ACK_SOURCE
        or marker_source != MARKER_SOURCE
        or marker_target != MARKER_TARGET
        or RELEASE.fullmatch(bridge_release) is None
        or bridge_release == CANONICAL_RELEASE
        or SHA.fullmatch(script_sha) is None
        or SHA.fullmatch(diagnostic_sha) is None
        or SHA.fullmatch(engine_sha) is None
        or SHA.fullmatch(manifest_sha) is None
    ):
        reject()
    root_value = exact_directory(root, (0, 0), 0o700)
    entries = set(os.listdir(root))
    if entries not in P0_TO_P5:
        reject()
    helper_data, helper_value = exact_file(helper, (0, 0), 0o755, 2 * 1024 * 1024)
    if hashlib.sha256(helper_data).hexdigest() != CANONICAL_HELPER_SHA256:
        reject()
    predecessor_ledger_sha, predecessor_bundle_sha = exact_failed_predecessor_pins()
    expiry_retirement_sha, expiry_retired_sha = exact_expiry_guard_records(
        ledger_root,
        bridge_release,
    )
    old_claim, old_profile, _ = parse_h14_identity(root)
    old_binding, _, old_match = require_v3(
        os.path.join(root, "retired-binding-v3"), (10001, 10001), 0o600
    )
    if old_match.group(1).decode("ascii") != old_profile:
        reject()
    ack_target = os.path.join(root, "database-profile-prepared-v1")
    ack_selected, ack_data, ack_value = select_exact(
        ack_source, ack_target, (10001, 10001), 0o400, 8192
    )
    try:
        ack_text = ack_data.decode("ascii")
    except UnicodeDecodeError:
        reject()
    ack = ack_text.splitlines()
    if (
        len(ack) != 9
        or ack_data != ("\n".join(ack) + "\n").encode("ascii")
        or ack[0] != "version=1"
        or ack[1] != f"claim_id={old_claim}"
        or not ack[2].startswith("receipt_id=")
        or UUID.fullmatch(ack[2].split("=", 1)[1]) is None
        or ack[3] != "platform_code=kemerbet"
        or not ack[4].startswith("platform_agent_account_id=")
        or PROFILE_UUID.fullmatch(ack[4].split("=", 1)[1]) is None
        or ack[4].split("=", 1)[1] == old_profile
        or re.fullmatch(r"profile_revision=[1-9][0-9]{0,8}", ack[5]) is None
        or ack[6:]
        != [
            "configuration_reason=security_recovery",
            "transfer_disabled=true",
            "money_moved=false",
        ]
    ):
        reject()
    marker_selected, marker_data, marker_value = select_exact(
        marker_source, marker_target, (0, 10001), 0o440, 37, 37
    )
    if marker_data != (old_claim + "\n").encode("ascii"):
        reject()
    terminal_ready = "terminal-recovery-marker-v1" in entries
    database_ready = "database-profile-prepared-v1" in entries
    if (
        (ack_selected == ack_target) != database_ready
        or (marker_selected == marker_target and not terminal_ready)
        or (database_ready and marker_selected != marker_target)
    ):
        # The only legitimate external-latch interruption is after publishing
        # the terminal record and moving its latch, but before moving the ACK.
        # An ACK cannot move first, and neither external source may disappear
        # before the corresponding durable H14 record exists.
        reject()
    lines = [
        "version=1",
        "contract=fetanagent-kemerbet-h14-host-retired-empty-profile-finalization-bridge",
        "state=authorized",
        f"bridge_release={bridge_release}",
        f"canonical_h14_release={CANONICAL_RELEASE}",
        f"staging_project_ref={STAGING_PROJECT_REF}",
        f"staging_droplet_id={STAGING_DROPLET_ID}",
        f"bridge_script_sha256={script_sha}",
        f"diagnostic_sha256={diagnostic_sha}",
        f"engine_sha256={engine_sha}",
        f"bundle_manifest_sha256={manifest_sha}",
        f"failed_predecessor_ledger_pin_sha256={predecessor_ledger_sha}",
        f"failed_predecessor_bundle_pin_sha256={predecessor_bundle_sha}",
        f"expiry_guard_retirement_intent_sha256={expiry_retirement_sha}",
        f"expiry_guard_retired_sha256={expiry_retired_sha}",
        f"canonical_helper_pin={pin(helper_value, 'file', CANONICAL_HELPER_SHA256)}",
        "h14_root_pin="
        + "|".join(
            [
                "directory",
                f"{root_value.st_dev}:{root_value.st_ino}",
                f"{root_value.st_uid}:{root_value.st_gid}:{stat.S_IMODE(root_value.st_mode):o}:{root_value.st_nlink}",
                hashlib.sha256(("entries=" + "\n".join(sorted(BASE))).encode("ascii")).hexdigest(),
            ]
        ),
        *base_pins(root),
        f"ack_pin={pin(ack_value, 'file', hashlib.sha256(ack_data).hexdigest())}",
        f"terminal_pin={pin(marker_value, 'file', hashlib.sha256(marker_data).hexdigest())}",
        "profile_revision_contract=postgres-int32-positive-max-9-digits",
        "installed_helper_changed=false",
        "financial_actions_mode=dry_run",
        "kemerbet_executor_enabled=false",
        "kemerbet_final_action_enabled=false",
        "provider_action_enabled=false",
        "amount_entry_enabled=false",
        "transfer_enabled=false",
        "money_moved=false",
    ]
    return (
        ("\n".join(lines) + "\n").encode("ascii"),
        ack_data,
        marker_data,
        object_identity(ack_value),
        object_identity(marker_value),
        old_claim,
        old_profile,
        old_match,
    )


def exact_ledger(path, expected, accepted_modes=(0o600,)):
    descriptor = os.open(path, READ_FLAGS)
    try:
        value = os.fstat(descriptor)
        named = os.lstat(path)
        data = read_at(descriptor, len(expected) + 1)
        if (
            not stat.S_ISREG(value.st_mode)
            or (value.st_dev, value.st_ino) != (named.st_dev, named.st_ino)
            or value.st_nlink != 1
            or (
                not PORTABLE_FIXTURE
                and (
                    (value.st_uid, value.st_gid) != (0, 0)
                    or stat.S_IMODE(value.st_mode) not in accepted_modes
                )
            )
            or data != expected
            or (not PORTABLE_FIXTURE and os.path.realpath(path) != path)
        ):
            reject()
    finally:
        os.close(descriptor)


def write_all(descriptor, data):
    offset = 0
    while offset < len(data):
        written = os.write(descriptor, data[offset:])
        if written <= 0:
            reject()
        offset += written


def create_exact(path, data, uid, gid, mode):
    descriptor = os.open(
        path,
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | BINARY_FLAG
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0),
        mode,
    )
    try:
        if PORTABLE_FIXTURE:
            os.chmod(path, mode)
        else:
            os.fchown(descriptor, uid, gid)
            os.fchmod(descriptor, mode)
        write_all(descriptor, data)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def sync_directory(path):
    if PORTABLE_FIXTURE:
        return
    descriptor = os.open(
        path,
        os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def move_exact(source, target, expected, owner, mode, expected_identity):
    if os.path.lexists(target):
        if os.path.lexists(source):
            reject()
        data, value = exact_file(target, owner, mode, len(expected), len(expected))
        if data != expected or object_identity(value) != expected_identity:
            reject()
        return
    data, source_value = exact_file(source, owner, mode, len(expected), len(expected))
    source_directory = os.path.dirname(source)
    target_directory = os.path.dirname(target)
    if (
        data != expected
        or object_identity(source_value) != expected_identity
        or source_value.st_dev != os.lstat(os.path.dirname(target)).st_dev
    ):
        reject()
    os.rename(source, target)
    sync_directory(source_directory)
    sync_directory(target_directory)
    target_value = os.lstat(target)
    if (target_value.st_dev, target_value.st_ino) != (source_value.st_dev, source_value.st_ino):
        reject()


def publish_exact(path, expected, uid, gid, mode):
    directory = os.path.dirname(path)
    temporary = os.path.join(directory, f".{os.path.basename(path)}.installing")
    if os.path.lexists(path):
        if os.path.lexists(temporary):
            reject()
        data, _ = exact_file(path, (uid, gid), mode, len(expected), len(expected))
        if data != expected:
            reject()
        return
    if os.path.lexists(temporary):
        descriptor = os.open(
            temporary,
            os.O_RDWR
            | BINARY_FLAG
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
        )
        try:
            value = os.fstat(descriptor)
            named = os.lstat(temporary)
            data = read_at(descriptor, len(expected) + 1)
            if (
                not stat.S_ISREG(value.st_mode)
                or (value.st_dev, value.st_ino) != (named.st_dev, named.st_ino)
                or not metadata_matches(value, (uid, gid), mode, 1)
                or len(data) > len(expected)
                or data != expected[: len(data)]
            ):
                reject()
            os.lseek(descriptor, 0, os.SEEK_END)
            write_all(descriptor, expected[len(data) :])
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    else:
        create_exact(temporary, expected, uid, gid, mode)
    data, _ = exact_file(temporary, (uid, gid), mode, len(expected), len(expected))
    if data != expected:
        reject()
    sync_directory(directory)
    os.rename(temporary, path)
    sync_directory(directory)


def transition_latch(source, target, expected, expected_identity):
    directory = os.path.dirname(source)
    if directory != os.path.dirname(target):
        reject()
    if os.path.lexists(target):
        if os.path.lexists(source):
            reject()
        data, value = exact_file(target, (0, 10001), 0o440, len(expected), len(expected))
        if data != expected or object_identity(value) != expected_identity:
            reject()
        return
    data, value = exact_file(source, (0, 10001), 0o440, len(expected), len(expected))
    if data != expected or object_identity(value) != expected_identity:
        reject()
    os.rename(source, target)
    sync_directory(directory)
    target_value = os.lstat(target)
    if (target_value.st_dev, target_value.st_ino) != (value.st_dev, value.st_ino):
        reject()


def finalize(
    root,
    ack_source,
    marker_source,
    marker_target,
    expected_ack,
    expected_marker,
    ack_identity,
    marker_identity,
    old_claim,
    old_profile,
    old_match,
):
    ack_target = os.path.join(root, "database-profile-prepared-v1")
    _, ack_data, ack_value = select_exact(ack_source, ack_target, (10001, 10001), 0o400, 8192)
    _, marker_data, marker_value = select_exact(
        marker_source, marker_target, (0, 10001), 0o440, 37, 37
    )
    if (
        ack_data != expected_ack
        or marker_data != expected_marker
        or object_identity(ack_value) != ack_identity
        or object_identity(marker_value) != marker_identity
    ):
        reject()
    ack = ack_data.decode("ascii").splitlines()
    profile_id = ack[4].split("=", 1)[1]
    authorization_data = (
        "\n".join(
            [
                "version=1",
                "contract=fetanagent-kemerbet-quarantine-recovery-identity-authorization-v1",
                f"old_profile_id={old_profile}",
                f"old_identity_fingerprint={old_match.group(2).decode('ascii')}",
                f"new_profile_id={profile_id}",
                "configuration_reason=security_recovery",
                "transfer_disabled=true",
                "money_moved=false",
            ]
        )
        + "\n"
    ).encode("ascii")
    if len(authorization_data) != 389:
        reject()
    publish_exact(
        os.path.join(root, "recovery-identity-authorization-v1"),
        authorization_data,
        0,
        10001,
        0o440,
    )
    marker_data = (old_claim + "\n").encode("ascii")
    publish_exact(os.path.join(root, "terminal-recovery-marker-v1"), marker_data, 0, 10001, 0o440)
    transition_latch(marker_source, marker_target, marker_data, marker_identity)
    move_exact(ack_source, ack_target, ack_data, (10001, 10001), 0o400, ack_identity)
    runtime_data = (
        "\n".join(
            [
                "version=1",
                f"recovery_release={CANONICAL_RELEASE}",
                f"old_claim_id={old_claim}",
                f"new_profile_id={profile_id}",
                f"recovery_identity_authorization_sha256={hashlib.sha256(authorization_data).hexdigest()}",
                f"database_ack_sha256={hashlib.sha256(ack_data).hexdigest()}",
                "transfer_disabled=true",
                "money_moved=false",
            ]
        )
        + "\n"
    ).encode("ascii")
    publish_exact(os.path.join(root, "runtime-ready-v1"), runtime_data, 0, 0, 0o600)


def expected_completion(root, intent_data):
    authorization, _ = exact_file(
        os.path.join(root, "recovery-identity-authorization-v1"), (0, 10001), 0o440, 389, 389
    )
    terminal, _ = exact_file(
        os.path.join(root, "terminal-recovery-marker-v1"), (0, 10001), 0o440, 37, 37
    )
    ack, _ = exact_file(
        os.path.join(root, "database-profile-prepared-v1"), (10001, 10001), 0o400, 8192
    )
    runtime, _ = exact_file(os.path.join(root, "runtime-ready-v1"), (0, 0), 0o600, 8192)
    lines = [
        "version=1",
        "contract=fetanagent-kemerbet-h14-host-retired-empty-profile-finalization-bridge",
        "state=completed",
        f"canonical_h14_release={CANONICAL_RELEASE}",
        f"intent_sha256={hashlib.sha256(intent_data).hexdigest()}",
        f"authorization_sha256={hashlib.sha256(authorization).hexdigest()}",
        f"terminal_sha256={hashlib.sha256(terminal).hexdigest()}",
        f"database_ack_sha256={hashlib.sha256(ack).hexdigest()}",
        f"runtime_ready_sha256={hashlib.sha256(runtime).hexdigest()}",
        "installed_helper_changed=false",
        "financial_actions_mode=dry_run",
        "kemerbet_executor_enabled=false",
        "kemerbet_final_action_enabled=false",
        "provider_action_enabled=false",
        "amount_entry_enabled=false",
        "transfer_enabled=false",
        "money_moved=false",
    ]
    return ("\n".join(lines) + "\n").encode("ascii")


def main(argv):
    if len(argv) != 14:
        reject()
    (
        mode,
        root,
        helper,
        ack_source,
        marker_source,
        marker_target,
        bridge_release,
        script_sha,
        diagnostic_sha,
        engine_sha,
        manifest_sha,
        intent_path,
        completion_path,
    ) = argv[1:]
    installing_root = os.path.join(BRIDGE_PARENT, f".installing-{bridge_release}")
    final_root = os.path.join(BRIDGE_PARENT, bridge_release)
    installing_pair = (
        os.path.join(installing_root, "intent-v1"),
        os.path.join(installing_root, "completed-v1"),
    )
    final_pair = (
        os.path.join(final_root, "intent-v1"),
        os.path.join(final_root, "completed-v1"),
    )
    supplied_pair = (intent_path, completion_path)
    if PORTABLE_FIXTURE:
        supplied_pair = tuple(os.path.normcase(os.path.normpath(path)) for path in supplied_pair)
        installing_pair = tuple(os.path.normcase(os.path.normpath(path)) for path in installing_pair)
        final_pair = tuple(os.path.normcase(os.path.normpath(path)) for path in final_pair)
    if supplied_pair != installing_pair and not (
        mode == "verify-completed" and supplied_pair == final_pair
    ):
        reject()
    (
        expected,
        expected_ack,
        expected_marker,
        ack_identity,
        marker_identity,
        old_claim,
        old_profile,
        old_match,
    ) = expected_intent(
        root,
        helper,
        ack_source,
        marker_source,
        marker_target,
        os.path.dirname(intent_path),
        bridge_release,
        script_sha,
        diagnostic_sha,
        engine_sha,
        manifest_sha,
    )
    if mode == "emit-intent":
        sys.stdout.buffer.write(expected)
        return
    exact_ledger(intent_path, expected)
    if mode == "finalize":
        finalize(
            root,
            ack_source,
            marker_source,
            marker_target,
            expected_ack,
            expected_marker,
            ack_identity,
            marker_identity,
            old_claim,
            old_profile,
            old_match,
        )
        return
    expected_after, _, _, _, _, _, _, _ = expected_intent(
        root,
        helper,
        ack_source,
        marker_source,
        marker_target,
        os.path.dirname(intent_path),
        bridge_release,
        script_sha,
        diagnostic_sha,
        engine_sha,
        manifest_sha,
    )
    if expected_after != expected or set(os.listdir(root)) != P0_TO_P5[-1]:
        reject()
    completion = expected_completion(root, expected)
    if mode == "emit-completion":
        sys.stdout.buffer.write(completion)
    elif mode == "verify-completed":
        exact_ledger(completion_path, completion)
    else:
        reject()


try:
    main(sys.argv)
except BaseException:
    raise SystemExit(1)
