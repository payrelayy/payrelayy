#!/usr/bin/env python3
"""Read-only differential validator for the canonical H14 host-retired gate.

This program intentionally emits only one stable predicate identifier.  It
never prints a path, record value, identifier, digest, or record content.
It is a diagnostic mirror, not an authorization or recovery mechanism.
"""

import hashlib
import os
import re
import stat
import sys


# Test code replaces this literal in an in-memory copy.  The checked-in
# diagnostic always enforces the canonical Linux ownership and mode contract.
PORTABLE_FIXTURE = False

H13_RELEASE = "306818ca812bd2abce8479396c4eea8383ea00f9"
EMPTY_CHECKPOINT_RELEASE = "4239201b5496bd08912cce4b5581fe19b29a84d4"
H13_HELPER_SHA256 = "3b789c983c415326171c6b4224016d2a04769a0b8c37cb91fc463383f2d141aa"
MARKER = b"fetanagent-kemerbet-session-active-v1\n"
READ_ONLY_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)

RELEASE = re.compile(r"[0-9a-f]{40}")
SHA = re.compile(r"[0-9a-f]{64}")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
PROFILE_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
DEV_INO = re.compile(r"[0-9]+:[0-9]+")
V3 = re.compile(
    rb"([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}) "
    rb"(hmac-sha256-agent-identity-v1:([0-9a-f]{64})) "
    rb"(hmac-sha256-agent-profile-pin-v3:\3)\n"
)


class PredicateFailure(Exception):
    pass


current_predicate = "H14-D001"


def at(code):
    global current_predicate
    current_predicate = code


def reject():
    raise PredicateFailure()


def exact_metadata(value, owner, mode, links=None):
    if PORTABLE_FIXTURE:
        return links is None or value.st_nlink == links
    return (
        (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) == (*owner, mode)
        and (links is None or value.st_nlink == links)
    )


def exact_directory(path, owner, mode, entries=None):
    value = os.lstat(path)
    if (
        not stat.S_ISDIR(value.st_mode)
        or not exact_metadata(value, owner, mode)
        or (not PORTABLE_FIXTURE and os.path.realpath(path) != path)
    ):
        reject()
    if entries is not None and sorted(os.listdir(path)) != sorted(entries):
        reject()
    return value


def read_at(descriptor, size):
    if hasattr(os, "pread"):
        return os.pread(descriptor, size, 0)
    if not PORTABLE_FIXTURE:
        reject()
    os.lseek(descriptor, 0, os.SEEK_SET)
    return os.read(descriptor, size)


def exact_file(path, owner, mode, maximum, exact_size=None):
    descriptor = os.open(path, READ_ONLY_FLAGS)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or not exact_metadata(before, owner, mode, 1)
            or before.st_size > maximum
            or (exact_size is not None and before.st_size != exact_size)
            or (not PORTABLE_FIXTURE and os.path.realpath(path) != path)
        ):
            reject()
        data = read_at(descriptor, maximum + 1)
        after = os.fstat(descriptor)
        before_tuple = (
            before.st_dev,
            before.st_ino,
            before.st_mode,
            before.st_uid,
            before.st_gid,
            before.st_nlink,
            before.st_size,
            before.st_mtime_ns,
        )
        after_tuple = (
            after.st_dev,
            after.st_ino,
            after.st_mode,
            after.st_uid,
            after.st_gid,
            after.st_nlink,
            after.st_size,
            after.st_mtime_ns,
        )
        if len(data) != before.st_size or before_tuple != after_tuple:
            reject()
        return data, before
    finally:
        os.close(descriptor)


def exact_ascii_lines(path, owner, mode, count):
    data, value = exact_file(path, owner, mode, 8192)
    try:
        text = data.decode("ascii")
    except UnicodeDecodeError:
        reject()
    lines = text.splitlines()
    if len(lines) != count or data != ("\n".join(lines) + "\n").encode("ascii"):
        reject()
    return lines, data, value


def require_v3(path, owner, mode):
    data, value = exact_file(path, owner, mode, 230, 230)
    matched = V3.fullmatch(data)
    if matched is None:
        reject()
    return data, value, matched


def latch_state(final_path, installing_path, expected):
    final_present = os.path.lexists(final_path)
    installing_present = os.path.lexists(installing_path)
    if final_present:
        if installing_present:
            reject()
        data, _ = exact_file(final_path, (0, 10001), 0o440, len(expected), len(expected))
        if data != expected:
            reject()
        return "final"
    if not installing_present:
        return "absent"
    descriptor = os.open(installing_path, READ_ONLY_FLAGS)
    try:
        value = os.fstat(descriptor)
        named = os.lstat(installing_path)
        data = read_at(descriptor, len(expected) + 1)
        metadata = (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink)
        accepted = {
            (0, 0, 0o600, 1),
            (0, 10001, 0o600, 1),
            (0, 10001, 0o440, 1),
        }
        if (
            not stat.S_ISREG(value.st_mode)
            or (value.st_dev, value.st_ino) != (named.st_dev, named.st_ino)
            or ((metadata not in accepted) if not PORTABLE_FIXTURE else value.st_nlink != 1)
            or value.st_size > len(expected)
            or data != expected[: value.st_size]
            or (not PORTABLE_FIXTURE and os.path.realpath(installing_path) != installing_path)
        ):
            reject()
    finally:
        os.close(descriptor)
    return "installing"


def main(argv):
    at("H14-D001")
    if len(argv) != 13:
        reject()
    (
        parent,
        helper,
        profile_root,
        control_root,
        seal_binding,
        final_binding,
        recheck_receipt,
        owner_receipt_root,
        authorization_sha,
        profile_ack_name,
        terminal_marker_name,
        profile_finalized_marker_name,
    ) = argv[1:]
    if (
        SHA.fullmatch(authorization_sha) is None
        or profile_ack_name != "kemerbet-quarantine-recovery-profile-prepared-v1"
        or terminal_marker_name != "kemerbet-readiness-cohort-security-recovery-failed-terminal-v1"
        or profile_finalized_marker_name
        != "kemerbet-readiness-cohort-security-recovery-profile-finalized-v1"
    ):
        reject()

    at("H14-D010")
    exact_directory(parent, (0, 0), 0o700)
    parent_entries = os.listdir(parent)
    if len(parent_entries) != 1 or RELEASE.fullmatch(parent_entries[0]) is None:
        reject()
    release = parent_entries[0]
    if release in {H13_RELEASE, EMPTY_CHECKPOINT_RELEASE}:
        reject()

    at("H14-D020")
    root = f"{parent}/{release}"
    root_value = exact_directory(root, (0, 0), 0o700)
    base = {
        "claim-stage-consumption-v1",
        "empty-predecessor-checkpoint-adoption-v1",
        "host-retired-v1",
        "intent-v1",
        "owner-runtime-restored-v1",
        "player-stage-consumption-v1",
        "predecessor-helper",
        "quarantined-profile-v1",
        "retired-binding-v3",
        "retired-retryable-failure-v1",
        "runtime-retired-v1",
        "runtime-retirement-intent-v1",
    }
    entries = set(os.listdir(root))
    if entries != base:
        reject()

    at("H14-D030")
    adoption, _, _ = exact_ascii_lines(
        f"{root}/empty-predecessor-checkpoint-adoption-v1", (0, 0), 0o600, 20
    )
    if adoption != [
        "version=1",
        "contract=fetanagent-kemerbet-quarantine-recovery-v14-empty-checkpoint-adoption",
        "state=adoption-prepared",
        "same_inode_target_rename_authorized=true",
        "namespace_rename_pending_at_publication=true",
        f"predecessor_recovery_release={EMPTY_CHECKPOINT_RELEASE}",
        f"successor_recovery_release={release}",
        f"checkpoint_dev_ino={root_value.st_dev}:{root_value.st_ino}",
        f"source_namespace=.installing-{EMPTY_CHECKPOINT_RELEASE}",
        f"target_namespace=.installing-{release}",
        "durable_retirement_intent_present=false",
        "deployment_grant_changed=false",
        "helper_changed=false",
        "runtime_mutated=false",
        "financial_actions_mode=dry_run",
        "kemerbet_executor_enabled=false",
        "kemerbet_final_action_enabled=false",
        "amount_entry_enabled=false",
        "transfer_enabled=false",
        "money_moved=false",
    ]:
        reject()

    at("H14-D040")
    intent, intent_data, _ = exact_ascii_lines(f"{root}/intent-v1", (0, 0), 0o600, 22)
    if (
        intent[0] != "contract=fetanagent-kemerbet-quarantine-recovery-v14"
        or intent[1] != "state=authorized"
        or intent[2] != f"recovery_release={release}"
        or intent[3] != f"predecessor_release={H13_RELEASE}"
        or intent[4] != f"predecessor_helper_sha256={H13_HELPER_SHA256}"
        or not intent[5].startswith("successor_helper_sha256=")
        or SHA.fullmatch(intent[5].split("=", 1)[1]) is None
        or intent[6] != f"authorization_sha256={authorization_sha}"
        or not intent[7].startswith("old_claim_id=")
        or UUID.fullmatch(intent[7].split("=", 1)[1]) is None
        or not intent[8].startswith("old_profile_id=")
        or PROFILE_UUID.fullmatch(intent[8].split("=", 1)[1]) is None
        or not intent[9].startswith("old_binding_sha256=")
        or SHA.fullmatch(intent[9].split("=", 1)[1]) is None
        or not intent[10].startswith("old_player_ids_sha256=")
        or SHA.fullmatch(intent[10].split("=", 1)[1]) is None
        or any(
            not intent[index].split("=", 1)[1]
            or DEV_INO.fullmatch(intent[index].split("=", 1)[1]) is None
            for index in range(11, 15)
        )
        or intent[15:]
        != [
            "financial_actions_mode=dry_run",
            "kemerbet_executor_enabled=false",
            "kemerbet_final_action_enabled=false",
            "transfer_enabled=false",
            "amount_entry_enabled=false",
            "lookup_authorized=false",
            "recheck_authorized=false",
        ]
    ):
        reject()
    predecessor_helper_sha = intent[4].split("=", 1)[1]
    successor_helper_sha = intent[5].split("=", 1)[1]
    old_claim = intent[7].split("=", 1)[1]
    old_profile = intent[8].split("=", 1)[1]
    old_binding_sha = intent[9].split("=", 1)[1]
    old_player_sha = intent[10].split("=", 1)[1]

    at("H14-D050")
    runtime_intent, _, _ = exact_ascii_lines(
        f"{root}/runtime-retirement-intent-v1", (0, 0), 0o600, 12
    )
    if (
        runtime_intent[0] != "version=1"
        or runtime_intent[1] != f"recovery_release={release}"
        or runtime_intent[2] != f"runtime_release={H13_RELEASE}"
        or re.fullmatch(r"coordinator_container_id=(absent|[0-9a-f]{64})", runtime_intent[3])
        is None
        or re.fullmatch(
            r"coordinator_contract_sha256=(absent|[0-9a-f]{64})", runtime_intent[4]
        )
        is None
        or re.fullmatch(r"owner_container_id=[0-9a-f]{64}", runtime_intent[5]) is None
        or re.fullmatch(r"owner_contract_sha256=[0-9a-f]{64}", runtime_intent[6]) is None
        or runtime_intent[7:]
        != [
            "financial_actions_mode=dry_run",
            "kemerbet_executor_enabled=false",
            "kemerbet_final_action_enabled=false",
            "transfer_enabled=false",
            "money_moved=false",
        ]
        or (runtime_intent[3].endswith("=absent"))
        != (runtime_intent[4].endswith("=absent"))
    ):
        reject()
    coordinator_id = runtime_intent[3].split("=", 1)[1]
    owner_container_id = runtime_intent[5].split("=", 1)[1]
    owner_contract_sha = runtime_intent[6].split("=", 1)[1]

    at("H14-D060")
    runtime_retired, _, _ = exact_ascii_lines(
        f"{root}/runtime-retired-v1", (0, 0), 0o600, 13
    )
    if runtime_retired != [
        "version=1",
        f"recovery_release={release}",
        f"runtime_release={H13_RELEASE}",
        f"coordinator_container_id={coordinator_id}",
        f"owner_container_id={owner_container_id}",
        "coordinator_removed=true",
        "owner_stopped=true",
        "profile_volume_holders=none",
        f"control_volume_holder={owner_container_id}-stopped",
        "chromium_processes=none",
        "transfer_disabled=true",
        "amount_entry_enabled=false",
        "money_moved=false",
    ]:
        reject()

    at("H14-D070")
    owner_restored, _, _ = exact_ascii_lines(
        f"{root}/owner-runtime-restored-v1", (0, 0), 0o600, 11
    )
    if owner_restored != [
        "version=1",
        f"recovery_release={release}",
        f"runtime_release={H13_RELEASE}",
        f"owner_container_id={owner_container_id}",
        f"owner_contract_sha256={owner_contract_sha}",
        "owner_running=true",
        "owner_healthy=true",
        "coordinator_absent=true",
        "transfer_disabled=true",
        "amount_entry_enabled=false",
        "money_moved=false",
    ]:
        reject()

    at("H14-D080")
    player_consumed, _, _ = exact_ascii_lines(
        f"{root}/player-stage-consumption-v1", (0, 0), 0o600, 5
    )
    if player_consumed != [
        "version=1",
        "stage=player-ids",
        f"source_dev_ino={intent[12].split('=', 1)[1]}",
        f"source_sha256={old_player_sha}",
        "raw_player_ids_preserved=false",
    ]:
        reject()

    at("H14-D090")
    claim_data = (old_claim + "\n").encode("ascii")
    claim_consumed, _, _ = exact_ascii_lines(
        f"{root}/claim-stage-consumption-v1", (0, 0), 0o600, 6
    )
    if claim_consumed != [
        "version=1",
        "stage=claim",
        f"claim_id={old_claim}",
        f"source_dev_ino={intent[13].split('=', 1)[1]}",
        f"source_sha256={hashlib.sha256(claim_data).hexdigest()}",
        "raw_stage_preserved=false",
    ]:
        reject()

    at("H14-D100")
    helper_data, _ = exact_file(helper, (0, 0), 0o755, 2 * 1024 * 1024)
    predecessor_data, _ = exact_file(
        f"{root}/predecessor-helper", (0, 0), 0o400, 2 * 1024 * 1024
    )
    if (
        hashlib.sha256(helper_data).hexdigest() != successor_helper_sha
        or hashlib.sha256(predecessor_data).hexdigest() != predecessor_helper_sha
    ):
        reject()

    at("H14-D110")
    old_binding, old_binding_value, old_match = require_v3(
        f"{root}/retired-binding-v3", (10001, 10001), 0o600
    )
    if (
        hashlib.sha256(old_binding).hexdigest() != old_binding_sha
        or old_match.group(1).decode("ascii") != old_profile
        or f"{old_binding_value.st_dev}:{old_binding_value.st_ino}"
        != intent[11].split("=", 1)[1]
    ):
        reject()

    at("H14-D120")
    retired_failed, _ = exact_file(
        f"{root}/retired-retryable-failure-v1", (0, 10001), 0o440, 37, 37
    )
    if retired_failed != claim_data:
        reject()

    at("H14-D130")
    quarantined = exact_directory(f"{root}/quarantined-profile-v1", (10001, 10001), 0o700)
    if f"{quarantined.st_dev}:{quarantined.st_ino}" != intent[14].split("=", 1)[1]:
        reject()
    marker, _ = exact_file(
        f"{root}/quarantined-profile-v1/.fetanagent-unclean-session-generation-v1",
        (10001, 10001),
        0o600,
        len(MARKER),
        len(MARKER),
    )
    if marker != MARKER:
        reject()

    at("H14-D140")
    host, _, _ = exact_ascii_lines(f"{root}/host-retired-v1", (0, 0), 0o600, 10)
    if host != [
        "version=1",
        f"recovery_release={release}",
        f"old_claim_id={old_claim}",
        f"old_profile_id={old_profile}",
        f"old_binding_sha256={old_binding_sha}",
        f"old_player_ids_sha256={old_player_sha}",
        f"intent_sha256={hashlib.sha256(intent_data).hexdigest()}",
        "transfer_disabled=true",
        "amount_entry_enabled=false",
        "money_moved=false",
    ]:
        reject()

    at("H14-D150")
    if os.path.lexists(f"{owner_receipt_root}/kemerbet-readiness-cohort-failed-v1"):
        reject()
    player_path = f"{control_root}/kemerbet-readiness-player-ids.stage-v1"
    claim_path = f"{control_root}/kemerbet-readiness-cohort-claim.stage-v1"
    if os.path.lexists(player_path) != os.path.lexists(claim_path):
        reject()
    if os.path.lexists(player_path):
        # Canonical base/host-retired has no runtime-ready subset, so any fresh
        # stage pair is invalid at this exact terminal point.
        reject()

    at("H14-D160")
    if os.path.lexists(seal_binding):
        require_v3(seal_binding, (10001, 10001), 0o600)
    if os.path.lexists(final_binding):
        require_v3(final_binding, (0, 0), 0o444)

    at("H14-D170")
    marker_path = f"{owner_receipt_root}/{terminal_marker_name}"
    marker_installing = f"{owner_receipt_root}/.{terminal_marker_name}.installing"
    finalized_path = f"{owner_receipt_root}/{profile_finalized_marker_name}"
    finalized_installing = f"{owner_receipt_root}/.{profile_finalized_marker_name}.installing"
    ack_installing = f"{control_root}/.{profile_ack_name}.installing"
    if os.path.lexists(marker_installing) or os.path.lexists(ack_installing):
        reject()
    terminal_source, _ = exact_file(marker_path, (0, 10001), 0o440, 37, 37)
    if terminal_source != claim_data:
        reject()
    if latch_state(finalized_path, finalized_installing, claim_data) != "absent":
        reject()
    if latch_state(
        f"{root}/terminal-recovery-marker-v1",
        f"{root}/.terminal-recovery-marker-v1.installing",
        claim_data,
    ) != "absent":
        reject()

try:
    main(sys.argv)
except BaseException:
    sys.stdout.write(f"FAIL {current_predicate}\n")
    raise SystemExit(1)
else:
    sys.stdout.write("PASS H14-D000\n")
