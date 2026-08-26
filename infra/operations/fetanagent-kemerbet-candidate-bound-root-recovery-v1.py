#!/usr/bin/env python3
"""Root-only filesystem transaction for one exact KemerBet candidate-bound recovery.

The shell wrapper proves the host, Docker, stopped-runtime, durable-volume, and
snapshot-volume contracts. This module handles only the root-owned recovery
evidence and the journal-authorized retryable filesystem rollback. It never
opens a network connection, starts a container, or prints private material.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import sys
import tempfile
from dataclasses import dataclass


EXPECTED_RELEASE = "4bb491943fb88c50b86166184b929bdbe2698dc4"
EXPECTED_HELPER_SHA256 = "05b0f2c8eb68716d20ad4878f1fff96c2f6a22e532e0b9c52a664e153b49e6fe"
PROJECT_NAME = "fetanagent-staging-beta"
PROFILE_VOLUME = f"{PROJECT_NAME}_kemerbet_sessions"
CONTROL_VOLUME = f"{PROJECT_NAME}_kemerbet_session_control"
SNAPSHOT_VOLUME = f"{PROJECT_NAME}-kemerbet-readiness-profile-snapshot-once"
LATCH_CONTENT = b"fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1\n"

SHA256 = re.compile(r"[0-9a-f]{64}")
DEV_INO = re.compile(r"([0-9]+):([0-9]+)")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
PROFILE_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
PLAYER_ID = re.compile(rb"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
COMPOSE_VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:[+~-][0-9A-Za-z._-]+)?")
V3_BINDING = re.compile(
    rb"([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}) "
    rb"hmac-sha256-agent-identity-v1:([0-9a-f]{64}) "
    rb"hmac-sha256-agent-profile-pin-v3:\2\n"
)


class RecoveryError(RuntimeError):
    """Fail-closed validation or mutation error."""


def reject() -> None:
    raise RecoveryError()


def mode(value: os.stat_result) -> int:
    return stat.S_IMODE(value.st_mode)


def identity(value: os.stat_result) -> tuple[int, int, int, int, int, int, int, int]:
    return (
        value.st_dev,
        value.st_ino,
        value.st_uid,
        value.st_gid,
        value.st_mode,
        value.st_nlink,
        value.st_size,
        value.st_mtime_ns,
    )


def dev_ino(value: os.stat_result) -> str:
    return f"{value.st_dev}:{value.st_ino}"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def path_absent(path: str) -> bool:
    return not os.path.lexists(path)


def require_absent(path: str) -> None:
    if not path_absent(path):
        reject()


def exact_directory(
    path: str,
    owner: tuple[int, int],
    expected_mode: int,
    expected_entries: list[str] | None = None,
) -> os.stat_result:
    value = os.lstat(path)
    if (
        not stat.S_ISDIR(value.st_mode)
        or (value.st_uid, value.st_gid, mode(value)) != (*owner, expected_mode)
        or os.path.realpath(path) != path
    ):
        reject()
    if expected_entries is not None and sorted(os.listdir(path)) != sorted(expected_entries):
        reject()
    return value


def read_exact_file(
    path: str,
    owner: tuple[int, int],
    expected_mode: int,
    maximum: int,
    *,
    expected_size: int | None = None,
    expected_links: int = 1,
    expected_content: bytes | None = None,
) -> tuple[os.stat_result, bytes]:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        opened = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            not stat.S_ISREG(opened.st_mode)
            or identity(opened) != identity(named)
            or (opened.st_uid, opened.st_gid, mode(opened), opened.st_nlink)
            != (*owner, expected_mode, expected_links)
            or opened.st_size > maximum
            or (expected_size is not None and opened.st_size != expected_size)
            or os.path.realpath(path) != path
        ):
            reject()
        content = os.pread(descriptor, maximum + 1, 0)
        if len(content) != opened.st_size or (
            expected_content is not None and content != expected_content
        ):
            reject()
        after = os.fstat(descriptor)
        named_after = os.lstat(path)
        if identity(opened) != identity(after) or identity(after) != identity(named_after):
            reject()
        return opened, content
    finally:
        os.close(descriptor)


def fsync_directory(path: str) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def ensure_directory(path: str, owner: tuple[int, int], expected_mode: int) -> None:
    if path_absent(path):
        parent = os.path.dirname(path)
        os.mkdir(path, expected_mode)
        os.chown(path, *owner)
        os.chmod(path, expected_mode)
        fsync_directory(parent)
    exact_directory(path, owner, expected_mode)


def atomic_publish(
    directory: str,
    name: str,
    content: bytes,
    owner: tuple[int, int],
    expected_mode: int,
) -> None:
    temporary = f".{name}.installing"
    target = os.path.join(directory, name)
    temporary_path = os.path.join(directory, temporary)
    if not path_absent(target):
        require_absent(temporary_path)
        read_exact_file(
            target,
            owner,
            expected_mode,
            len(content),
            expected_size=len(content),
            expected_content=content,
        )
        return
    if path_absent(temporary_path):
        descriptor = os.open(
            temporary_path,
            os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            expected_mode,
        )
        try:
            os.fchown(descriptor, *owner)
            os.fchmod(descriptor, expected_mode)
            offset = 0
            while offset < len(content):
                written = os.write(descriptor, content[offset:])
                if written <= 0:
                    reject()
                offset += written
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    else:
        descriptor = os.open(temporary_path, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            opened = os.fstat(descriptor)
            existing = os.pread(descriptor, len(content) + 1, 0)
            if (
                not stat.S_ISREG(opened.st_mode)
                or (opened.st_uid, opened.st_gid, mode(opened), opened.st_nlink)
                != (*owner, expected_mode, 1)
            ):
                reject()
            require_content_prefix(existing, content)
            os.lseek(descriptor, len(existing), os.SEEK_SET)
            offset = len(existing)
            while offset < len(content):
                written = os.write(descriptor, content[offset:])
                if written <= 0:
                    reject()
                offset += written
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    read_exact_file(
        temporary_path,
        owner,
        expected_mode,
        len(content),
        expected_size=len(content),
        expected_content=content,
    )
    os.rename(temporary_path, target)
    fsync_directory(directory)
    read_exact_file(
        target,
        owner,
        expected_mode,
        len(content),
        expected_size=len(content),
        expected_content=content,
    )


def require_content_prefix(existing: bytes, intended: bytes) -> None:
    if not intended.startswith(existing):
        reject()


def promotion_root_state(entries: list[str]) -> str:
    if not entries:
        return "retirement-prefix"
    if sorted(entries) == ["pending-v1"]:
        return "journal-present"
    reject()


@dataclass(frozen=True)
class Paths:
    promotion_root: str
    journal: str
    receipt_root: str
    imported: str
    imported_installing: str
    failed: str
    failed_installing: str
    completed: str
    completed_installing: str
    latch: str
    latch_installing: str
    recheck_receipt_root: str
    candidate_root: str
    canonical_binding: str
    internal_player_ids: str
    binding_source: str
    identity_key: str
    selector: str
    profile_mountpoint: str
    control_mountpoint: str
    recovery_parent: str
    recovery_root: str
    archive: str
    intent: str
    snapshot_authorization: str
    retryable: str
    recovery_completed: str

    @staticmethod
    def production() -> "Paths":
        receipt_root = "/var/lib/fetanagent/kemerbet-readiness-cohort-receipts"
        promotion_root = "/var/lib/fetanagent/kemerbet-readiness-recheck-promotion"
        recovery_parent = "/var/lib/fetanagent/kemerbet-candidate-bound-root-recovery-v1"
        recovery_root = os.path.join(recovery_parent, EXPECTED_RELEASE)
        control_mountpoint = f"/var/lib/docker/volumes/{CONTROL_VOLUME}/_data"
        return Paths(
            promotion_root=promotion_root,
            journal=os.path.join(promotion_root, "pending-v1"),
            receipt_root=receipt_root,
            imported=os.path.join(receipt_root, "kemerbet-readiness-cohort-imported-v1"),
            imported_installing=os.path.join(
                receipt_root, ".kemerbet-readiness-cohort-imported-v1.installing"
            ),
            failed=os.path.join(receipt_root, "kemerbet-readiness-cohort-failed-v1"),
            failed_installing=os.path.join(
                receipt_root, ".kemerbet-readiness-cohort-failed-v1.installing"
            ),
            completed=os.path.join(receipt_root, "kemerbet-readiness-cohort-completed-v1"),
            completed_installing=os.path.join(
                receipt_root, ".kemerbet-readiness-cohort-completed-v1.installing"
            ),
            latch=os.path.join(
                receipt_root, "kemerbet-readiness-recovery-in-progress-or-failed-v1"
            ),
            latch_installing=os.path.join(
                receipt_root, ".kemerbet-readiness-recovery-in-progress-or-failed-v1.installing"
            ),
            recheck_receipt_root="/var/lib/fetanagent/kemerbet-readiness-recheck",
            candidate_root="/etc/fetanagent/executor-secrets/.kemerbet-readiness-recheck-candidate",
            canonical_binding="/etc/fetanagent/executor-secrets/kemerbet_agent_identity_bindings",
            internal_player_ids="/etc/fetanagent/executor-secrets/kemerbet_no_transfer_readiness_player_ids",
            binding_source="/var/lib/fetanagent/kemerbet-readiness-seal-output/kemerbet_agent_identity_bindings",
            identity_key="/etc/fetanagent/executor-secrets/kemerbet_agent_identity_hmac_key",
            selector="/etc/fetanagent/executor-config/kemerbet-selector-contract.v2.json",
            profile_mountpoint=f"/var/lib/docker/volumes/{PROFILE_VOLUME}/_data",
            control_mountpoint=control_mountpoint,
            recovery_parent=recovery_parent,
            recovery_root=recovery_root,
            archive=os.path.join(recovery_root, "promotion-journal-v1"),
            intent=os.path.join(recovery_root, "intent-v1"),
            snapshot_authorization=os.path.join(
                recovery_root, "snapshot-removal-authorized-v1"
            ),
            retryable=os.path.join(recovery_root, "retryable-v1"),
            recovery_completed=os.path.join(recovery_root, "completed-v1"),
        )


@dataclass(frozen=True)
class Journal:
    raw: bytes
    release: str
    source_dev_ino: str
    candidate_dev_ino: str
    binding_sha256: str
    identity_key_sha256: str
    selector_sha256: str
    image_id: str
    profile_identity_sha256: str
    session_container: str
    player_ids_dev_ino: str
    owner_player_dev_ino: str
    owner_claim_dev_ino: str
    claim_id: str
    player_ids_sha256: str


def parse_candidate_journal(raw: bytes) -> Journal:
    if not raw.endswith(b"\n") or b"\r" in raw or b"\0" in raw:
        reject()
    try:
        lines = raw.decode("ascii").splitlines()
    except UnicodeDecodeError:
        reject()
    if len(lines) != 17 or lines[:2] != ["version=1", "state=candidate_bound"]:
        reject()
    expected_keys = [
        "release",
        "source_dev_ino",
        "binding_dev_ino",
        "binding_sha256",
        "identity_hmac_key_sha256",
        "selector_sha256",
        "image_id",
        "profile_volume",
        "profile_identity_sha256",
        "session_container",
        "player_ids_dev_ino",
        "owner_stage_player_ids_dev_ino",
        "owner_stage_claim_dev_ino",
        "claim_id",
        "player_ids_sha256",
    ]
    values: dict[str, str] = {}
    for line, expected_key in zip(lines[2:], expected_keys, strict=True):
        if "=" not in line:
            reject()
        key, value = line.split("=", 1)
        if key != expected_key:
            reject()
        values[key] = value
    if (
        values["release"] != EXPECTED_RELEASE
        or DEV_INO.fullmatch(values["source_dev_ino"]) is None
        or DEV_INO.fullmatch(values["binding_dev_ino"]) is None
        or SHA256.fullmatch(values["binding_sha256"]) is None
        or SHA256.fullmatch(values["identity_hmac_key_sha256"]) is None
        or SHA256.fullmatch(values["selector_sha256"]) is None
        or re.fullmatch(r"sha256:[0-9a-f]{64}", values["image_id"]) is None
        or values["profile_volume"] != PROFILE_VOLUME
        or SHA256.fullmatch(values["profile_identity_sha256"]) is None
        or re.fullmatch(r"(?:none|[0-9a-f]{12,64})", values["session_container"]) is None
        or DEV_INO.fullmatch(values["player_ids_dev_ino"]) is None
        or DEV_INO.fullmatch(values["owner_stage_player_ids_dev_ino"]) is None
        or DEV_INO.fullmatch(values["owner_stage_claim_dev_ino"]) is None
        or UUID.fullmatch(values["claim_id"]) is None
        or SHA256.fullmatch(values["player_ids_sha256"]) is None
    ):
        reject()
    return Journal(
        raw=raw,
        release=values["release"],
        source_dev_ino=values["source_dev_ino"],
        candidate_dev_ino=values["binding_dev_ino"],
        binding_sha256=values["binding_sha256"],
        identity_key_sha256=values["identity_hmac_key_sha256"],
        selector_sha256=values["selector_sha256"],
        image_id=values["image_id"],
        profile_identity_sha256=values["profile_identity_sha256"],
        session_container=values["session_container"],
        player_ids_dev_ino=values["player_ids_dev_ino"],
        owner_player_dev_ino=values["owner_stage_player_ids_dev_ino"],
        owner_claim_dev_ino=values["owner_stage_claim_dev_ino"],
        claim_id=values["claim_id"],
        player_ids_sha256=values["player_ids_sha256"],
    )


def read_journal(path: str) -> tuple[os.stat_result, Journal]:
    value, raw = read_exact_file(path, (0, 0), 0o600, 4096)
    return value, parse_candidate_journal(raw)


def parse_record(content: bytes, contract: str, state: str) -> dict[str, str]:
    if not content.endswith(b"\n") or b"\r" in content or b"\0" in content:
        reject()
    try:
        lines = content.decode("ascii").splitlines()
    except UnicodeDecodeError:
        reject()
    values: dict[str, str] = {}
    for line in lines:
        if "=" not in line:
            reject()
        key, value = line.split("=", 1)
        if key in values:
            reject()
        values[key] = value
    if values.get("contract") != contract or values.get("state") != state:
        reject()
    return values


def intent_content(journal: Journal, latch_identity: str, imported_identity: str) -> bytes:
    claim_digest = sha256((journal.claim_id + "\n").encode("ascii"))
    return (
        "contract=fetanagent-kemerbet-candidate-bound-root-recovery-v1\n"
        "state=authorized\n"
        f"release={EXPECTED_RELEASE}\n"
        f"helper_sha256={EXPECTED_HELPER_SHA256}\n"
        f"promotion_journal_sha256={sha256(journal.raw)}\n"
        f"adopted_latch_dev_ino={latch_identity}\n"
        f"imported_marker_dev_ino={imported_identity}\n"
        f"source_dev_ino={journal.source_dev_ino}\n"
        f"binding_sha256={journal.binding_sha256}\n"
        f"identity_hmac_key_sha256={journal.identity_key_sha256}\n"
        f"selector_sha256={journal.selector_sha256}\n"
        f"image_id={journal.image_id}\n"
        f"profile_identity_sha256={journal.profile_identity_sha256}\n"
        f"player_ids_dev_ino={journal.player_ids_dev_ino}\n"
        f"owner_stage_player_ids_dev_ino={journal.owner_player_dev_ino}\n"
        f"owner_stage_claim_dev_ino={journal.owner_claim_dev_ino}\n"
        f"claim_sha256={claim_digest}\n"
        f"player_ids_sha256={journal.player_ids_sha256}\n"
        f"snapshot_volume={SNAPSHOT_VOLUME}\n"
    ).encode("ascii")


def retryable_content(journal: Journal, intent: bytes, snapshot_authorization: bytes) -> bytes:
    return (
        "contract=fetanagent-kemerbet-candidate-bound-root-recovery-v1\n"
        "state=retryable-proven\n"
        f"release={EXPECTED_RELEASE}\n"
        f"helper_sha256={EXPECTED_HELPER_SHA256}\n"
        f"promotion_journal_sha256={sha256(journal.raw)}\n"
        f"intent_sha256={sha256(intent)}\n"
        f"snapshot_authorization_sha256={sha256(snapshot_authorization)}\n"
        f"source_dev_ino={journal.source_dev_ino}\n"
        f"binding_sha256={journal.binding_sha256}\n"
        f"owner_stage_player_ids_dev_ino={journal.owner_player_dev_ino}\n"
        f"owner_stage_claim_dev_ino={journal.owner_claim_dev_ino}\n"
        f"claim_sha256={sha256((journal.claim_id + chr(10)).encode('ascii'))}\n"
        f"player_ids_sha256={journal.player_ids_sha256}\n"
    ).encode("ascii")


def completion_content(journal: Journal, intent: bytes, retryable: bytes) -> bytes:
    intent_values = parse_record(
        intent, "fetanagent-kemerbet-candidate-bound-root-recovery-v1", "authorized"
    )
    return (
        "contract=fetanagent-kemerbet-candidate-bound-root-recovery-v1\n"
        "state=completed\n"
        f"release={EXPECTED_RELEASE}\n"
        f"helper_sha256={EXPECTED_HELPER_SHA256}\n"
        f"promotion_journal_sha256={sha256(journal.raw)}\n"
        f"intent_sha256={sha256(intent)}\n"
        f"retryable_sha256={sha256(retryable)}\n"
        f"adopted_latch_dev_ino={intent_values['adopted_latch_dev_ino']}\n"
        "transfer_enabled=false\n"
        "executor_started=false\n"
        "money_moved=false\n"
    ).encode("ascii")


def snapshot_authorization_content(
    journal: Journal, intent: bytes, volume: dict[str, object]
) -> bytes:
    mount = os.lstat(str(volume["Mountpoint"]))
    contract = {
        "Driver": volume["Driver"],
        "Labels": volume["Labels"],
        "Mountpoint": volume["Mountpoint"],
        "Name": volume["Name"],
        "Options": volume["Options"],
        "Scope": volume["Scope"],
    }
    contract_bytes = json.dumps(
        contract, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    ).encode("ascii")
    return (
        "contract=fetanagent-kemerbet-candidate-bound-root-recovery-v1\n"
        "state=snapshot-removal-authorized\n"
        f"release={EXPECTED_RELEASE}\n"
        f"helper_sha256={EXPECTED_HELPER_SHA256}\n"
        f"promotion_journal_sha256={sha256(journal.raw)}\n"
        f"intent_sha256={sha256(intent)}\n"
        f"snapshot_volume={SNAPSHOT_VOLUME}\n"
        f"snapshot_contract_sha256={sha256(contract_bytes)}\n"
        f"snapshot_mount_dev_ino={dev_ino(mount)}\n"
        f"snapshot_mount_mode={mount.st_uid}:{mount.st_gid}:{mode(mount):o}\n"
    ).encode("ascii")


def require_recovery_namespace(paths: Paths, allowed: set[str]) -> None:
    exact_directory(paths.recovery_parent, (0, 0), 0o700, [EXPECTED_RELEASE])
    exact_directory(paths.recovery_root, (0, 0), 0o700)
    entries = set(os.listdir(paths.recovery_root))
    known = {
        "promotion-journal-v1",
        ".promotion-journal-v1.installing",
        "intent-v1",
        ".intent-v1.installing",
        "snapshot-removal-authorized-v1",
        ".snapshot-removal-authorized-v1.installing",
        "retryable-v1",
        ".retryable-v1.installing",
        "completed-v1",
        ".completed-v1.installing",
    }
    if not entries <= known or not entries <= allowed:
        reject()


def read_archive_and_intent(paths: Paths) -> tuple[Journal, bytes]:
    _, archive_raw = read_exact_file(paths.archive, (0, 0), 0o400, 4096)
    journal = parse_candidate_journal(archive_raw)
    _, intent = read_exact_file(paths.intent, (0, 0), 0o600, 4096)
    values = parse_record(
        intent, "fetanagent-kemerbet-candidate-bound-root-recovery-v1", "authorized"
    )
    required = {
        "contract",
        "state",
        "release",
        "helper_sha256",
        "promotion_journal_sha256",
        "adopted_latch_dev_ino",
        "imported_marker_dev_ino",
        "source_dev_ino",
        "binding_sha256",
        "identity_hmac_key_sha256",
        "selector_sha256",
        "image_id",
        "profile_identity_sha256",
        "player_ids_dev_ino",
        "owner_stage_player_ids_dev_ino",
        "owner_stage_claim_dev_ino",
        "claim_sha256",
        "player_ids_sha256",
        "snapshot_volume",
    }
    if (
        set(values) != required
        or values["release"] != EXPECTED_RELEASE
        or values["helper_sha256"] != EXPECTED_HELPER_SHA256
        or values["promotion_journal_sha256"] != sha256(journal.raw)
        or DEV_INO.fullmatch(values["adopted_latch_dev_ino"]) is None
        or DEV_INO.fullmatch(values["imported_marker_dev_ino"]) is None
        or values["source_dev_ino"] != journal.source_dev_ino
        or values["binding_sha256"] != journal.binding_sha256
        or values["identity_hmac_key_sha256"] != journal.identity_key_sha256
        or values["selector_sha256"] != journal.selector_sha256
        or values["image_id"] != journal.image_id
        or values["profile_identity_sha256"] != journal.profile_identity_sha256
        or values["player_ids_dev_ino"] != journal.player_ids_dev_ino
        or values["owner_stage_player_ids_dev_ino"] != journal.owner_player_dev_ino
        or values["owner_stage_claim_dev_ino"] != journal.owner_claim_dev_ino
        or values["claim_sha256"]
        != sha256((journal.claim_id + "\n").encode("ascii"))
        or values["player_ids_sha256"] != journal.player_ids_sha256
        or values["snapshot_volume"] != SNAPSHOT_VOLUME
    ):
        reject()
    return journal, intent


def read_snapshot_authorization(
    paths: Paths, journal: Journal, intent: bytes
) -> bytes:
    _, content = read_exact_file(
        paths.snapshot_authorization, (0, 0), 0o600, 4096
    )
    values = parse_record(
        content,
        "fetanagent-kemerbet-candidate-bound-root-recovery-v1",
        "snapshot-removal-authorized",
    )
    required = {
        "contract",
        "state",
        "release",
        "helper_sha256",
        "promotion_journal_sha256",
        "intent_sha256",
        "snapshot_volume",
        "snapshot_contract_sha256",
        "snapshot_mount_dev_ino",
        "snapshot_mount_mode",
    }
    if (
        set(values) != required
        or values["release"] != EXPECTED_RELEASE
        or values["helper_sha256"] != EXPECTED_HELPER_SHA256
        or values["promotion_journal_sha256"] != sha256(journal.raw)
        or values["intent_sha256"] != sha256(intent)
        or values["snapshot_volume"] != SNAPSHOT_VOLUME
        or SHA256.fullmatch(values["snapshot_contract_sha256"]) is None
        or DEV_INO.fullmatch(values["snapshot_mount_dev_ino"]) is None
        or re.fullmatch(r"(?:0:0:(?:700|755)|10001:10001:700)", values["snapshot_mount_mode"])
        is None
    ):
        reject()
    return content


def validate_snapshot_authorization(paths: Paths, journal: Journal) -> bytes:
    archived, intent = read_archive_and_intent(paths)
    if archived.raw != journal.raw:
        reject()
    return read_snapshot_authorization(paths, journal, intent)


def exact_marker(path: str, claim_id: str, links: int = 1) -> os.stat_result:
    content = (claim_id + "\n").encode("ascii")
    value, _ = read_exact_file(
        path,
        (0, 10001),
        0o440,
        len(content),
        expected_size=len(content),
        expected_links=links,
        expected_content=content,
    )
    return value


def exact_latch(path: str, expected_dev_ino: str | None = None) -> os.stat_result:
    value, _ = read_exact_file(
        path,
        (0, 0),
        0o400,
        len(LATCH_CONTENT),
        expected_size=len(LATCH_CONTENT),
        expected_content=LATCH_CONTENT,
    )
    if expected_dev_ino is not None and dev_ino(value) != expected_dev_ino:
        reject()
    return value


def validate_player_content(content: bytes, expected_digest: str) -> None:
    lines = content[:-1].split(b"\n") if content.endswith(b"\n") else []
    if (
        len(content) < 10
        or len(content) > 1024
        or b"\r" in content
        or b"\0" in content
        or len(lines) != 5
        or len(set(lines)) != 5
        or any(PLAYER_ID.fullmatch(line) is None for line in lines)
        or sha256(content) != expected_digest
    ):
        reject()


def open_stage(
    path: str,
    expected_dev_ino: str,
    expected_content: bytes | None,
    player_digest: str | None,
) -> tuple[int, bytes]:
    match = DEV_INO.fullmatch(expected_dev_ino)
    if match is None:
        reject()
    expected_identity = (int(match.group(1)), int(match.group(2)))
    descriptor = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    opened = os.fstat(descriptor)
    named = os.lstat(path)
    content = os.pread(descriptor, 1025, 0)
    if (
        not stat.S_ISREG(opened.st_mode)
        or identity(opened) != identity(named)
        or (opened.st_dev, opened.st_ino) != expected_identity
        or (opened.st_uid, opened.st_gid, mode(opened))
        not in {
            (0, 0, 0o400),
            (0, 0, 0o444),
            (10001, 10001, 0o400),
            (10001, 10001, 0o444),
        }
        or opened.st_nlink != 1
        or len(content) != opened.st_size
    ):
        os.close(descriptor)
        reject()
    if player_digest is not None:
        validate_player_content(content, player_digest)
    elif content != expected_content:
        os.close(descriptor)
        reject()
    return descriptor, content


def validate_profile(paths: Paths, journal: Journal, binding_content: bytes) -> None:
    match = V3_BINDING.fullmatch(binding_content)
    if match is None:
        reject()
    account_id = match.group(1).decode("ascii")
    if PROFILE_UUID.fullmatch(account_id) is None or account_id == "00000000-0000-0000-0000-000000000000":
        reject()
    root = exact_directory(paths.profile_mountpoint, (10001, 10001), 0o700, [account_id])
    profile_path = os.path.join(paths.profile_mountpoint, account_id)
    profile = exact_directory(profile_path, (10001, 10001), 0o700)
    for singleton in ("SingletonCookie", "SingletonLock", "SingletonSocket"):
        require_absent(os.path.join(profile_path, singleton))
    digest_input = (
        f"volume={PROFILE_VOLUME}\n"
        f"root={root.st_dev}:{root.st_ino}:{root.st_uid}:{root.st_gid}:{mode(root):o}\n"
        f"profile={profile.st_dev}:{profile.st_ino}:{profile.st_uid}:{profile.st_gid}:{mode(profile):o}\n"
        f"account={account_id}\n"
    ).encode("ascii")
    if sha256(digest_input) != journal.profile_identity_sha256:
        reject()


def validate_binding_key_selector_and_stages(
    paths: Paths, journal: Journal, *, require_restored: bool
) -> None:
    exact_directory(paths.control_mountpoint, (10001, 10001), 0o700)
    for name in (
        ".kemerbet-readiness-player-ids.stage-v1.installing",
        ".kemerbet-readiness-cohort-claim.stage-v1.installing",
        "kemerbet-readiness-cohort-imported-v1",
        ".kemerbet-readiness-cohort-imported-v1.installing",
        "kemerbet-readiness-cohort-completed-v1",
        ".kemerbet-readiness-cohort-completed-v1.installing",
        "kemerbet-readiness-cohort-failed-v1",
        ".kemerbet-readiness-cohort-failed-v1.installing",
        "kemerbet-readiness-recovery-in-progress-or-failed-v1",
        ".kemerbet-readiness-recovery-in-progress-or-failed-v1.installing",
    ):
        require_absent(os.path.join(paths.control_mountpoint, name))
    player_path = os.path.join(paths.control_mountpoint, "kemerbet-readiness-player-ids.stage-v1")
    claim_path = os.path.join(paths.control_mountpoint, "kemerbet-readiness-cohort-claim.stage-v1")
    player_fd, player_content = open_stage(
        player_path, journal.owner_player_dev_ino, None, journal.player_ids_sha256
    )
    claim_fd, claim_content = open_stage(
        claim_path,
        journal.owner_claim_dev_ino,
        (journal.claim_id + "\n").encode("ascii"),
        None,
    )
    try:
        if require_restored:
            for descriptor, content in ((player_fd, player_content), (claim_fd, claim_content)):
                opened = os.fstat(descriptor)
                if (
                    (opened.st_uid, opened.st_gid, mode(opened), opened.st_nlink, opened.st_size)
                    != (10001, 10001, 0o400, 1, len(content))
                ):
                    reject()
    finally:
        os.close(claim_fd)
        os.close(player_fd)
    source, binding_content = read_exact_file(
        paths.binding_source,
        (10001, 10001),
        0o600,
        230,
        expected_size=230,
    )
    if (
        dev_ino(source) != journal.source_dev_ino
        or sha256(binding_content) != journal.binding_sha256
        or V3_BINDING.fullmatch(binding_content) is None
    ):
        reject()
    key_metadata = os.lstat(paths.identity_key)
    if (key_metadata.st_uid, key_metadata.st_gid, mode(key_metadata)) not in {
        (0, 0, 0o400),
        (0, 0, 0o444),
        (10001, 10001, 0o400),
        (10001, 10001, 0o444),
    }:
        reject()
    key, key_content = read_exact_file(
        paths.identity_key,
        (key_metadata.st_uid, key_metadata.st_gid),
        mode(key_metadata),
        4096,
    )
    if key.st_nlink != 1 or sha256(key_content) != journal.identity_key_sha256:
        reject()
    selector, selector_content = read_exact_file(paths.selector, (0, 0), 0o444, 1024 * 1024)
    if selector.st_nlink != 1 or sha256(selector_content) != journal.selector_sha256:
        reject()
    validate_profile(paths, journal, binding_content)


def validate_uncommitted_absences(paths: Paths, journal: Journal) -> None:
    for path in (paths.recheck_receipt_root, paths.candidate_root, paths.canonical_binding):
        require_absent(path)
    if not path_absent(paths.internal_player_ids):
        metadata = os.lstat(paths.internal_player_ids)
        if (metadata.st_uid, metadata.st_gid, mode(metadata)) not in {
            (0, 0, 0o400),
            (0, 0, 0o444),
            (10001, 10001, 0o400),
            (10001, 10001, 0o444),
        }:
            reject()
        value, content = read_exact_file(
            paths.internal_player_ids,
            (metadata.st_uid, metadata.st_gid),
            mode(metadata),
            4096,
        )
        if dev_ino(value) != journal.player_ids_dev_ino or sha256(content) != journal.player_ids_sha256:
            reject()
        validate_player_content(content, journal.player_ids_sha256)


def validate_initial_receipt(paths: Paths, journal: Journal) -> tuple[os.stat_result, os.stat_result]:
    exact_directory(
        paths.receipt_root,
        (0, 0),
        0o755,
        [os.path.basename(paths.imported), os.path.basename(paths.latch)],
    )
    require_absent(paths.imported_installing)
    require_absent(paths.failed)
    require_absent(paths.failed_installing)
    require_absent(paths.completed)
    require_absent(paths.completed_installing)
    require_absent(paths.latch_installing)
    imported = exact_marker(paths.imported, journal.claim_id)
    latch = exact_latch(paths.latch)
    return imported, latch


def validate_receipt_progress(
    paths: Paths, journal: Journal, latch_identity: str
) -> str:
    exact_directory(paths.receipt_root, (0, 0), 0o755)
    require_absent(paths.imported_installing)
    require_absent(paths.completed)
    require_absent(paths.completed_installing)
    require_absent(paths.latch_installing)
    latch = exact_latch(paths.latch, latch_identity)
    if dev_ino(latch) != latch_identity:
        reject()
    allowed = {
        os.path.basename(paths.imported),
        os.path.basename(paths.failed),
        os.path.basename(paths.failed_installing),
        os.path.basename(paths.latch),
    }
    if not set(os.listdir(paths.receipt_root)) <= allowed:
        reject()
    imported_present = not path_absent(paths.imported)
    failed_present = not path_absent(paths.failed)
    installer_present = not path_absent(paths.failed_installing)
    if imported_present:
        exact_marker(paths.imported, journal.claim_id)
        if failed_present or installer_present:
            reject()
        return "imported"
    if installer_present:
        content = (journal.claim_id + "\n").encode("ascii")
        installer = os.lstat(paths.failed_installing)
        if failed_present:
            failed = exact_marker(paths.failed, journal.claim_id, links=2)
            exact_marker(paths.failed_installing, journal.claim_id, links=2)
            if (installer.st_dev, installer.st_ino) != (failed.st_dev, failed.st_ino):
                reject()
        else:
            allowed_prefix_metadata = {
                (0, 0, 0o600),
                (0, 10001, 0o600),
                (0, 10001, 0o440),
            }
            if (installer.st_uid, installer.st_gid, mode(installer)) not in allowed_prefix_metadata:
                reject()
            _, prefix = read_exact_file(
                paths.failed_installing,
                (installer.st_uid, installer.st_gid),
                mode(installer),
                len(content),
            )
            if not content.startswith(prefix):
                reject()
        return "failed-prefix"
    if failed_present:
        exact_marker(paths.failed, journal.claim_id)
        return "failed"
    return "between-markers"


def ensure_recovery_root(paths: Paths) -> None:
    exact_directory("/var/lib/fetanagent", (0, 0), 0o755)
    ensure_directory(paths.recovery_parent, (0, 0), 0o700)
    if set(os.listdir(paths.recovery_parent)) not in (set(), {EXPECTED_RELEASE}):
        reject()
    ensure_directory(paths.recovery_root, (0, 0), 0o700)
    exact_directory(paths.recovery_parent, (0, 0), 0o700, [EXPECTED_RELEASE])


def prepare(paths: Paths) -> None:
    if not path_absent(paths.recovery_completed):
        verify_terminal(paths)
        return
    if path_absent(paths.promotion_root):
        require_recovery_namespace(
            paths,
            {
                "promotion-journal-v1",
                "intent-v1",
                "snapshot-removal-authorized-v1",
                "retryable-v1",
                ".completed-v1.installing",
            },
        )
        journal, intent = read_archive_and_intent(paths)
        snapshot_authorization = validate_snapshot_authorization(paths, journal)
        _, retryable = read_exact_file(paths.retryable, (0, 0), 0o600, 4096)
        if retryable != retryable_content(journal, intent, snapshot_authorization):
            reject()
        completed = completion_content(journal, intent, retryable)
        latch_present = not path_absent(paths.latch)
        validate_retryable_boundary(
            paths,
            journal,
            require_latch=latch_present,
            completion_installing_content=None if latch_present else completed,
        )
        return
    exact_directory(paths.promotion_root, (0, 0), 0o700)
    promotion_state = promotion_root_state(os.listdir(paths.promotion_root))
    if promotion_state == "retirement-prefix":
        require_recovery_namespace(
            paths,
            {
                "promotion-journal-v1",
                "intent-v1",
                "snapshot-removal-authorized-v1",
                "retryable-v1",
            },
        )
        journal, intent = read_archive_and_intent(paths)
        snapshot_authorization = validate_snapshot_authorization(paths, journal)
        _, retryable = read_exact_file(paths.retryable, (0, 0), 0o600, 4096)
        if retryable != retryable_content(journal, intent, snapshot_authorization):
            reject()
        validate_retryable_boundary(paths, journal, require_latch=True)
        return
    _, journal = read_journal(paths.journal)
    if not path_absent(paths.recovery_parent):
        exact_directory(paths.recovery_parent, (0, 0), 0o700, [EXPECTED_RELEASE])
        exact_directory(paths.recovery_root, (0, 0), 0o700)
        entries = set(os.listdir(paths.recovery_root))
        if "intent-v1" in entries:
            require_recovery_namespace(
                paths,
                {
                    "promotion-journal-v1",
                    "intent-v1",
                    "snapshot-removal-authorized-v1",
                    ".snapshot-removal-authorized-v1.installing",
                    "retryable-v1",
                    ".retryable-v1.installing",
                },
            )
            archived, intent = read_archive_and_intent(paths)
            if archived.raw != journal.raw:
                reject()
            intent_values = parse_record(
                intent,
                "fetanagent-kemerbet-candidate-bound-root-recovery-v1",
                "authorized",
            )
            validate_uncommitted_absences(paths, journal)
            validate_binding_key_selector_and_stages(
                paths, journal, require_restored=False
            )
            validate_receipt_progress(
                paths, journal, intent_values["adopted_latch_dev_ino"]
            )
            return
    imported, latch = validate_initial_receipt(paths, journal)
    validate_uncommitted_absences(paths, journal)
    # The failed cleanup already restored both exact stage inodes. Read-only preparation proves
    # them before archiving the private journal, but performs no marker transition.
    validate_binding_key_selector_and_stages(paths, journal, require_restored=True)
    ensure_recovery_root(paths)
    allowed_prefix = {
        "promotion-journal-v1",
        ".promotion-journal-v1.installing",
        "intent-v1",
        ".intent-v1.installing",
    }
    require_recovery_namespace(paths, allowed_prefix)
    atomic_publish(paths.recovery_root, "promotion-journal-v1", journal.raw, (0, 0), 0o400)
    intent = intent_content(journal, dev_ino(latch), dev_ino(imported))
    atomic_publish(paths.recovery_root, "intent-v1", intent, (0, 0), 0o600)
    require_recovery_namespace(paths, {"promotion-journal-v1", "intent-v1"})
    archived, observed_intent = read_archive_and_intent(paths)
    if archived.raw != journal.raw or observed_intent != intent:
        reject()


def repair_identity_key(paths: Paths, journal: Journal) -> None:
    descriptor = os.open(paths.identity_key, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        opened = os.fstat(descriptor)
        content = os.pread(descriptor, 4097, 0)
        if (
            not stat.S_ISREG(opened.st_mode)
            or (opened.st_uid, opened.st_gid, mode(opened))
            not in {
                (0, 0, 0o400),
                (0, 0, 0o444),
                (10001, 10001, 0o400),
                (10001, 10001, 0o444),
            }
            or opened.st_nlink != 1
            or len(content) != opened.st_size
            or sha256(content) != journal.identity_key_sha256
        ):
            reject()
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, 0o444)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    value, content = read_exact_file(paths.identity_key, (0, 0), 0o444, 4096)
    if value.st_nlink != 1 or sha256(content) != journal.identity_key_sha256:
        reject()


def consume_internal_player(paths: Paths, journal: Journal) -> None:
    if path_absent(paths.internal_player_ids):
        return
    parent = os.path.dirname(paths.internal_player_ids)
    exact_directory(parent, (0, 0), 0o700)
    value = os.lstat(paths.internal_player_ids)
    allowed = {
        (0, 0, 0o400),
        (0, 0, 0o444),
        (10001, 10001, 0o400),
        (10001, 10001, 0o444),
    }
    if (value.st_uid, value.st_gid, mode(value)) not in allowed:
        reject()
    actual, content = read_exact_file(
        paths.internal_player_ids,
        (value.st_uid, value.st_gid),
        mode(value),
        4096,
    )
    if dev_ino(actual) != journal.player_ids_dev_ino:
        reject()
    validate_player_content(content, journal.player_ids_sha256)
    os.unlink(paths.internal_player_ids)
    fsync_directory(parent)
    require_absent(paths.internal_player_ids)


def restore_stages(paths: Paths, journal: Journal) -> None:
    player_path = os.path.join(paths.control_mountpoint, "kemerbet-readiness-player-ids.stage-v1")
    claim_path = os.path.join(paths.control_mountpoint, "kemerbet-readiness-cohort-claim.stage-v1")
    player_fd, player_content = open_stage(
        player_path, journal.owner_player_dev_ino, None, journal.player_ids_sha256
    )
    claim_fd, claim_content = open_stage(
        claim_path,
        journal.owner_claim_dev_ino,
        (journal.claim_id + "\n").encode("ascii"),
        None,
    )
    try:
        for descriptor, content in ((player_fd, player_content), (claim_fd, claim_content)):
            os.fchown(descriptor, 10001, 10001)
            os.fchmod(descriptor, 0o400)
            os.fsync(descriptor)
            opened = os.fstat(descriptor)
            if (
                (opened.st_uid, opened.st_gid, mode(opened), opened.st_nlink, opened.st_size)
                != (10001, 10001, 0o400, 1, len(content))
            ):
                reject()
        fsync_directory(paths.control_mountpoint)
    finally:
        os.close(claim_fd)
        os.close(player_fd)
    validate_binding_key_selector_and_stages(paths, journal, require_restored=True)


def remove_imported(paths: Paths, journal: Journal, intent_values: dict[str, str]) -> None:
    if path_absent(paths.imported):
        return
    value = exact_marker(paths.imported, journal.claim_id)
    if dev_ino(value) != intent_values["imported_marker_dev_ino"]:
        reject()
    os.unlink(paths.imported)
    fsync_directory(paths.receipt_root)
    require_absent(paths.imported)


def normalize_failed_prefix(paths: Paths, journal: Journal) -> None:
    if path_absent(paths.failed_installing):
        return
    content = (journal.claim_id + "\n").encode("ascii")
    installer = os.lstat(paths.failed_installing)
    if not path_absent(paths.failed):
        failed = exact_marker(paths.failed, journal.claim_id, links=2)
        exact_marker(paths.failed_installing, journal.claim_id, links=2)
        if (installer.st_dev, installer.st_ino) != (failed.st_dev, failed.st_ino):
            reject()
        os.unlink(paths.failed_installing)
        fsync_directory(paths.receipt_root)
        exact_marker(paths.failed, journal.claim_id)
        return
    allowed_prefix_metadata = {
        (0, 0, 0o600),
        (0, 10001, 0o600),
        (0, 10001, 0o440),
    }
    if (installer.st_uid, installer.st_gid, mode(installer)) not in allowed_prefix_metadata:
        reject()
    _, prefix = read_exact_file(
        paths.failed_installing,
        (installer.st_uid, installer.st_gid),
        mode(installer),
        len(content),
    )
    if not content.startswith(prefix):
        reject()
    os.unlink(paths.failed_installing)
    fsync_directory(paths.receipt_root)


def publish_failed(paths: Paths, journal: Journal, latch_identity: str) -> None:
    normalize_failed_prefix(paths, journal)
    if not path_absent(paths.failed):
        exact_marker(paths.failed, journal.claim_id)
        exact_latch(paths.latch, latch_identity)
        return
    content = (journal.claim_id + "\n").encode("ascii")
    descriptor = os.open(
        paths.failed_installing,
        os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        0o600,
    )
    try:
        offset = 0
        while offset < len(content):
            written = os.write(descriptor, content[offset:])
            if written <= 0:
                reject()
            offset += written
        os.fchown(descriptor, 0, 10001)
        os.fchmod(descriptor, 0o440)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    exact_marker(paths.failed_installing, journal.claim_id)
    exact_latch(paths.latch, latch_identity)
    os.link(paths.failed_installing, paths.failed, follow_symlinks=False)
    fsync_directory(paths.receipt_root)
    exact_marker(paths.failed_installing, journal.claim_id, links=2)
    exact_marker(paths.failed, journal.claim_id, links=2)
    exact_latch(paths.latch, latch_identity)
    os.unlink(paths.failed_installing)
    fsync_directory(paths.receipt_root)
    exact_marker(paths.failed, journal.claim_id)
    require_absent(paths.failed_installing)


def validate_retryable_boundary(
    paths: Paths,
    journal: Journal,
    *,
    require_latch: bool,
    completion_installing_content: bytes | None = None,
) -> None:
    for path in (
        paths.recheck_receipt_root,
        paths.candidate_root,
        paths.canonical_binding,
        paths.internal_player_ids,
    ):
        require_absent(path)
    validate_binding_key_selector_and_stages(paths, journal, require_restored=True)
    entries = [os.path.basename(paths.failed)]
    if require_latch:
        _, intent = read_archive_and_intent(paths)
        values = parse_record(
            intent, "fetanagent-kemerbet-candidate-bound-root-recovery-v1", "authorized"
        )
        exact_latch(paths.latch, values["adopted_latch_dev_ino"])
        entries.append(os.path.basename(paths.latch))
    else:
        require_absent(paths.latch)
    exact_directory(paths.receipt_root, (0, 0), 0o755, entries)
    exact_marker(paths.failed, journal.claim_id)
    for path in (
        paths.imported,
        paths.imported_installing,
        paths.failed_installing,
        paths.completed,
        paths.latch_installing,
    ):
        require_absent(path)
    if completion_installing_content is None:
        require_absent(paths.completed_installing)
    elif not path_absent(paths.completed_installing):
        _, prefix = read_exact_file(
            paths.completed_installing,
            (0, 0),
            0o600,
            len(completion_installing_content),
        )
        require_content_prefix(prefix, completion_installing_content)


def remove_promotion(paths: Paths, journal: Journal) -> None:
    if path_absent(paths.promotion_root):
        return
    exact_directory(paths.promotion_root, (0, 0), 0o700)
    entries = os.listdir(paths.promotion_root)
    if entries == ["pending-v1"] or sorted(entries) == ["pending-v1"]:
        _, current = read_journal(paths.journal)
        if current.raw != journal.raw:
            reject()
        os.unlink(paths.journal)
        fsync_directory(paths.promotion_root)
    elif entries:
        reject()
    os.rmdir(paths.promotion_root)
    fsync_directory(os.path.dirname(paths.promotion_root))
    require_absent(paths.promotion_root)


def retire_adopted_latch(paths: Paths, expected_dev_ino: str) -> None:
    if path_absent(paths.latch):
        # A crash after unlink but before final completion is made durable on retry.
        fsync_directory(paths.receipt_root)
        return
    exact_latch(paths.latch, expected_dev_ino)
    os.unlink(paths.latch)
    fsync_directory(paths.receipt_root)
    require_absent(paths.latch)


def recover(paths: Paths) -> None:
    prepare(paths)
    if not path_absent(paths.recovery_completed):
        verify_terminal(paths)
        return
    journal, intent = read_archive_and_intent(paths)
    snapshot_authorization = read_snapshot_authorization(paths, journal, intent)
    intent_values = parse_record(
        intent, "fetanagent-kemerbet-candidate-bound-root-recovery-v1", "authorized"
    )
    if path_absent(paths.promotion_root) and path_absent(paths.latch):
        _, retryable = read_exact_file(paths.retryable, (0, 0), 0o600, 4096)
        if retryable != retryable_content(journal, intent, snapshot_authorization):
            reject()
        completed = completion_content(journal, intent, retryable)
        validate_retryable_boundary(
            paths,
            journal,
            require_latch=False,
            completion_installing_content=completed,
        )
        retire_adopted_latch(paths, intent_values["adopted_latch_dev_ino"])
        validate_retryable_boundary(
            paths,
            journal,
            require_latch=False,
            completion_installing_content=completed,
        )
        atomic_publish(paths.recovery_root, "completed-v1", completed, (0, 0), 0o600)
        verify_terminal(paths)
        return
    if not path_absent(paths.promotion_root):
        exact_directory(paths.promotion_root, (0, 0), 0o700)
        promotion_state = promotion_root_state(os.listdir(paths.promotion_root))
        if promotion_state == "journal-present":
            _, current = read_journal(paths.journal)
            if current.raw != journal.raw:
                reject()
        else:
            _, retryable = read_exact_file(paths.retryable, (0, 0), 0o600, 4096)
            if retryable != retryable_content(journal, intent, snapshot_authorization):
                reject()
            validate_retryable_boundary(paths, journal, require_latch=True)
    validate_uncommitted_absences(paths, journal)
    validate_binding_key_selector_and_stages(paths, journal, require_restored=False)
    validate_receipt_progress(paths, journal, intent_values["adopted_latch_dev_ino"])
    consume_internal_player(paths, journal)
    repair_identity_key(paths, journal)
    restore_stages(paths, journal)
    remove_imported(paths, journal, intent_values)
    publish_failed(paths, journal, intent_values["adopted_latch_dev_ino"])
    validate_retryable_boundary(paths, journal, require_latch=True)
    retryable = retryable_content(journal, intent, snapshot_authorization)
    atomic_publish(paths.recovery_root, "retryable-v1", retryable, (0, 0), 0o600)
    require_recovery_namespace(
        paths,
        {
            "promotion-journal-v1",
            "intent-v1",
            "snapshot-removal-authorized-v1",
            "retryable-v1",
        },
    )
    validate_retryable_boundary(paths, journal, require_latch=True)
    remove_promotion(paths, journal)
    validate_retryable_boundary(paths, journal, require_latch=True)
    retire_adopted_latch(paths, intent_values["adopted_latch_dev_ino"])
    validate_retryable_boundary(paths, journal, require_latch=False)
    completed = completion_content(journal, intent, retryable)
    atomic_publish(paths.recovery_root, "completed-v1", completed, (0, 0), 0o600)
    verify_terminal(paths)


def verify_terminal(paths: Paths) -> None:
    require_absent(paths.promotion_root)
    require_recovery_namespace(
        paths,
        {
            "promotion-journal-v1",
            "intent-v1",
            "snapshot-removal-authorized-v1",
            "retryable-v1",
            "completed-v1",
        },
    )
    journal, intent = read_archive_and_intent(paths)
    snapshot_authorization = read_snapshot_authorization(paths, journal, intent)
    _, retryable = read_exact_file(paths.retryable, (0, 0), 0o600, 4096)
    if retryable != retryable_content(journal, intent, snapshot_authorization):
        reject()
    _, completed = read_exact_file(paths.recovery_completed, (0, 0), 0o600, 4096)
    if completed != completion_content(journal, intent, retryable):
        reject()
    validate_retryable_boundary(paths, journal, require_latch=False)


def validate_volume_object(value: object, kind: str) -> str:
    if not isinstance(value, dict):
        reject()
    names = {
        "profile": (PROFILE_VOLUME, "kemerbet_sessions"),
        "control": (CONTROL_VOLUME, "kemerbet_session_control"),
        "snapshot": (SNAPSHOT_VOLUME, "kemerbet_readiness_profile_snapshot"),
    }
    if kind not in names:
        reject()
    expected_name, expected_volume_label = names[kind]
    labels = value.get("Labels")
    if (
        value.get("Name") != expected_name
        or value.get("Driver") != "local"
        or value.get("Scope") != "local"
        or value.get("Options") is not None
        or value.get("Mountpoint") != f"/var/lib/docker/volumes/{expected_name}/_data"
        or not isinstance(labels, dict)
    ):
        reject()
    if kind == "snapshot":
        expected_labels = {
            "com.docker.compose.project": PROJECT_NAME,
            "com.docker.compose.volume": expected_volume_label,
            "com.fetanagent.kemerbet-readiness.snapshot": "profile-snapshot-v1",
        }
        if labels != expected_labels:
            reject()
        mount = os.lstat(value["Mountpoint"])
        if (
            not stat.S_ISDIR(mount.st_mode)
            or os.path.realpath(value["Mountpoint"]) != value["Mountpoint"]
            or (mount.st_uid, mount.st_gid, mode(mount))
            not in {(0, 0, 0o755), (0, 0, 0o700), (10001, 10001, 0o700)}
        ):
            reject()
        return ""
    expected_label_keys = {
        "com.docker.compose.project",
        "com.docker.compose.version",
        "com.docker.compose.volume",
        "com.docker.compose.config-hash",
    }
    if (
        set(labels) != expected_label_keys
        or labels["com.docker.compose.project"] != PROJECT_NAME
        or labels["com.docker.compose.volume"] != expected_volume_label
        or COMPOSE_VERSION.fullmatch(labels["com.docker.compose.version"]) is None
        or SHA256.fullmatch(labels["com.docker.compose.config-hash"]) is None
    ):
        reject()
    mount = os.lstat(value["Mountpoint"])
    if (
        not stat.S_ISDIR(mount.st_mode)
        or os.path.realpath(value["Mountpoint"]) != value["Mountpoint"]
        or (mount.st_uid, mount.st_gid, mode(mount)) != (10001, 10001, 0o700)
    ):
        reject()
    return labels["com.docker.compose.version"]


def load_volume_json(kind: str) -> list[dict[str, object]]:
    try:
        value = json.load(sys.stdin)
    except (UnicodeDecodeError, json.JSONDecodeError, OSError):
        reject()
    if not isinstance(value, list):
        reject()
    if kind == "durable":
        if len(value) != 2:
            reject()
        by_name = {item.get("Name"): item for item in value if isinstance(item, dict)}
        if set(by_name) != {PROFILE_VOLUME, CONTROL_VOLUME}:
            reject()
        profile_version = validate_volume_object(by_name[PROFILE_VOLUME], "profile")
        control_version = validate_volume_object(by_name[CONTROL_VOLUME], "control")
        if profile_version != control_version:
            reject()
    elif kind == "snapshot":
        if len(value) != 1 or not isinstance(value[0], dict):
            reject()
        validate_volume_object(value[0], "snapshot")
    else:
        reject()
    return value


def verify_volume_json(kind: str) -> None:
    load_volume_json(kind)


def verify_authorized_snapshot_volume_json(paths: Paths) -> None:
    values = load_volume_json("snapshot")
    journal, intent = read_archive_and_intent(paths)
    observed = read_snapshot_authorization(paths, journal, intent)
    expected = snapshot_authorization_content(journal, intent, values[0])
    if observed != expected:
        reject()


def authorize_snapshot_removal(paths: Paths) -> None:
    values = load_volume_json("snapshot")
    prepare(paths)
    if path_absent(paths.promotion_root):
        reject()
    journal, intent = read_archive_and_intent(paths)
    authorization = snapshot_authorization_content(journal, intent, values[0])
    require_recovery_namespace(
        paths,
        {
            "promotion-journal-v1",
            "intent-v1",
            "snapshot-removal-authorized-v1",
            ".snapshot-removal-authorized-v1.installing",
        },
    )
    atomic_publish(
        paths.recovery_root,
        "snapshot-removal-authorized-v1",
        authorization,
        (0, 0),
        0o600,
    )
    require_recovery_namespace(
        paths,
        {
            "promotion-journal-v1",
            "intent-v1",
            "snapshot-removal-authorized-v1",
        },
    )
    observed = read_snapshot_authorization(paths, journal, intent)
    if observed != authorization:
        reject()


def self_test() -> None:
    values = {
        "release": EXPECTED_RELEASE,
        "source_dev_ino": "1:2",
        "binding_dev_ino": "3:4",
        "binding_sha256": "a" * 64,
        "identity_hmac_key_sha256": "b" * 64,
        "selector_sha256": "c" * 64,
        "image_id": "sha256:" + "d" * 64,
        "profile_volume": PROFILE_VOLUME,
        "profile_identity_sha256": "e" * 64,
        "session_container": "f" * 64,
        "player_ids_dev_ino": "5:6",
        "owner_stage_player_ids_dev_ino": "7:8",
        "owner_stage_claim_dev_ino": "9:10",
        "claim_id": "123e4567-e89b-12d3-a456-426614174000",
        "player_ids_sha256": "1" * 64,
    }
    order = [
        "release",
        "source_dev_ino",
        "binding_dev_ino",
        "binding_sha256",
        "identity_hmac_key_sha256",
        "selector_sha256",
        "image_id",
        "profile_volume",
        "profile_identity_sha256",
        "session_container",
        "player_ids_dev_ino",
        "owner_stage_player_ids_dev_ino",
        "owner_stage_claim_dev_ino",
        "claim_id",
        "player_ids_sha256",
    ]
    raw = ("version=1\nstate=candidate_bound\n" + "".join(f"{key}={values[key]}\n" for key in order)).encode(
        "ascii"
    )
    journal = parse_candidate_journal(raw)
    if journal.release != EXPECTED_RELEASE or journal.claim_id != values["claim_id"]:
        reject()
    intent = intent_content(journal, "11:12", "13:14")
    snapshot = (
        "contract=fetanagent-kemerbet-candidate-bound-root-recovery-v1\n"
        "state=snapshot-removal-authorized\n"
    ).encode("ascii")
    retryable = retryable_content(journal, intent, snapshot)
    completed = completion_content(journal, intent, retryable)
    parse_record(intent, "fetanagent-kemerbet-candidate-bound-root-recovery-v1", "authorized")
    parse_record(
        retryable,
        "fetanagent-kemerbet-candidate-bound-root-recovery-v1",
        "retryable-proven",
    )
    parse_record(completed, "fetanagent-kemerbet-candidate-bound-root-recovery-v1", "completed")
    malformed = raw.replace(b"state=candidate_bound", b"state=prepared", 1)
    try:
        parse_candidate_journal(malformed)
    except RecoveryError:
        pass
    else:
        reject()
    if (
        promotion_root_state([]) != "retirement-prefix"
        or promotion_root_state(["pending-v1"]) != "journal-present"
    ):
        reject()
    for invalid_entries in (["unexpected"], ["pending-v1", "unexpected"]):
        try:
            promotion_root_state(invalid_entries)
        except RecoveryError:
            pass
        else:
            reject()
    for prefix in (b"", completed[:1], completed[: len(completed) // 2], completed):
        require_content_prefix(prefix, completed)
    corrupted_prefix = bytearray(completed[: max(1, len(completed) // 2)])
    corrupted_prefix[-1] ^= 1
    try:
        require_content_prefix(bytes(corrupted_prefix), completed)
    except RecoveryError:
        pass
    else:
        reject()
    with tempfile.TemporaryDirectory() as temporary_root:
        mount = os.path.join(temporary_root, "snapshot")
        old_mount = os.path.join(temporary_root, "snapshot-old")
        foreign_mount = os.path.join(temporary_root, "snapshot-foreign")
        os.mkdir(mount, 0o700)
        os.mkdir(foreign_mount, 0o700)
        volume: dict[str, object] = {
            "Driver": "local",
            "Labels": {
                "com.docker.compose.project": PROJECT_NAME,
                "com.docker.compose.volume": "kemerbet_readiness_profile_snapshot",
                "com.fetanagent.kemerbet-readiness.snapshot": "profile-snapshot-v1",
            },
            "Mountpoint": mount,
            "Name": SNAPSHOT_VOLUME,
            "Options": None,
            "Scope": "local",
        }
        authorization = snapshot_authorization_content(journal, intent, volume)
        if snapshot_authorization_content(journal, intent, volume) != authorization:
            reject()
        changed_labels = dict(volume)
        changed_labels["Labels"] = dict(volume["Labels"], foreign="true")  # type: ignore[arg-type]
        changed_options = dict(volume)
        changed_options["Options"] = {"foreign": "true"}
        changed_mount = dict(volume)
        changed_mount["Mountpoint"] = foreign_mount
        for changed in (changed_labels, changed_options, changed_mount):
            if snapshot_authorization_content(journal, intent, changed) == authorization:
                reject()
        os.rename(mount, old_mount)
        os.mkdir(mount, 0o700)
        if snapshot_authorization_content(journal, intent, volume) == authorization:
            reject()


def main() -> None:
    if len(sys.argv) != 2:
        reject()
    command = sys.argv[1]
    paths = Paths.production()
    if command == "prepare":
        prepare(paths)
    elif command == "authorize-snapshot-removal":
        authorize_snapshot_removal(paths)
    elif command == "verify-snapshot-authorization":
        journal, intent = read_archive_and_intent(paths)
        read_snapshot_authorization(paths, journal, intent)
    elif command == "recover":
        recover(paths)
    elif command == "verify-terminal":
        verify_terminal(paths)
    elif command == "verify-snapshot-volume-json":
        verify_volume_json("snapshot")
    elif command == "verify-authorized-snapshot-volume-json":
        verify_authorized_snapshot_volume_json(paths)
    elif command == "verify-durable-volumes-json":
        verify_volume_json("durable")
    elif command == "self-test":
        self_test()
    else:
        reject()


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        raise SystemExit(1)
