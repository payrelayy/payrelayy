#!/usr/bin/env python3
"""Fail-closed validator for one exact TeleBirr shadow-verifier Docker archive."""

from __future__ import annotations

import hashlib
import json
import pathlib
import re
import stat
import sys
import tarfile
from collections.abc import Mapping
from typing import BinaryIO


DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
RELEASE = re.compile(r"[0-9a-f]{40}")
IMAGE_REPOSITORY = "fetanagent-telebirr-shadow-verifier"
EXPECTED_COMMAND = [
    "node",
    "apps/trusted-telebirr-verifier/dist/telebirr-shadow-verifier-main.js",
]
EXPECTED_ENTRYPOINT = ["docker-entrypoint.sh"]
EXPECTED_HEALTHCHECK = {
    "Test": [
        "CMD",
        "node",
        "-e",
        "fetch('http://127.0.0.1:8092/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))",
    ],
    "Interval": 30_000_000_000,
    "Timeout": 5_000_000_000,
    "StartPeriod": 15_000_000_000,
    "Retries": 3,
}
MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
MAX_LAYER_BYTES = 512 * 1024 * 1024
MAX_METADATA_BYTES = 16 * 1024 * 1024
MAX_MEMBERS = 4096


def refuse(message: str) -> None:
    raise RuntimeError(message)


def is_digest(value: object) -> bool:
    return isinstance(value, str) and DIGEST.fullmatch(value) is not None


def parse_json(value: bytes, description: str):
    try:
        return json.loads(value)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"{description} is not valid JSON") from error


def read_exact(stream: BinaryIO, expected_size: int, maximum_size: int) -> bytes:
    if (
        isinstance(expected_size, bool)
        or not isinstance(expected_size, int)
        or not 0 < expected_size <= maximum_size
    ):
        refuse("archive member size is outside its reviewed limit")
    value = stream.read(expected_size + 1)
    if len(value) != expected_size:
        refuse("archive member length changed while reading")
    return value


def hash_exact(stream: BinaryIO, expected_size: int, maximum_size: int) -> str:
    if (
        isinstance(expected_size, bool)
        or not isinstance(expected_size, int)
        or not 0 < expected_size <= maximum_size
    ):
        refuse("archive member size is outside its reviewed limit")
    digest = hashlib.sha256()
    observed = 0
    while True:
        block = stream.read(1024 * 1024)
        if not block:
            break
        observed += len(block)
        if observed > expected_size:
            refuse("archive member grew while hashing")
        digest.update(block)
    if observed != expected_size:
        refuse("archive member length changed while hashing")
    return digest.hexdigest()


def member_stream(
    archive: tarfile.TarFile,
    members_by_name: Mapping[str, tarfile.TarInfo],
    name: str,
    maximum_size: int,
) -> tuple[tarfile.TarInfo, BinaryIO]:
    member = members_by_name.get(name)
    if member is None or not member.isfile() or not 0 < member.size <= maximum_size:
        refuse(f"required Docker archive member is missing or unsafe: {name}")
    stream = archive.extractfile(member)
    if stream is None:
        refuse(f"required Docker archive member cannot be read: {name}")
    return member, stream


def member_bytes(
    archive: tarfile.TarFile,
    members_by_name: Mapping[str, tarfile.TarInfo],
    name: str,
    maximum_size: int = MAX_METADATA_BYTES,
) -> bytes:
    member, stream = member_stream(archive, members_by_name, name, maximum_size)
    return read_exact(stream, member.size, maximum_size)


def require_digest_bound_blob(
    archive: tarfile.TarFile,
    members_by_name: Mapping[str, tarfile.TarInfo],
    digest: str,
    expected_size: int,
    maximum_size: int,
    return_bytes: bool,
) -> bytes | None:
    if not is_digest(digest):
        refuse("OCI blob digest is invalid")
    path = f"blobs/sha256/{digest.removeprefix('sha256:')}"
    member, stream = member_stream(archive, members_by_name, path, maximum_size)
    if member.size != expected_size:
        refuse("OCI blob length does not match its descriptor")
    if return_bytes:
        value = read_exact(stream, expected_size, maximum_size)
        observed_digest = hashlib.sha256(value).hexdigest()
    else:
        value = None
        observed_digest = hash_exact(stream, expected_size, maximum_size)
    if observed_digest != digest.removeprefix("sha256:"):
        refuse("OCI blob does not match its descriptor digest")
    return value


def validate_runtime_config(config_bytes: bytes, expected_release: str) -> dict[str, object]:
    image = parse_json(config_bytes, "image config")
    if not isinstance(image, dict):
        refuse("image config root is not an object")
    runtime = image.get("config")
    if not isinstance(runtime, dict):
        refuse("image runtime Config is not an object")
    if (
        image.get("architecture") != "amd64"
        or image.get("os") != "linux"
        or runtime.get("User") != "10001:10001"
        or runtime.get("Entrypoint") != EXPECTED_ENTRYPOINT
        or runtime.get("Cmd") != EXPECTED_COMMAND
        or runtime.get("WorkingDir") != "/workspace"
        or runtime.get("ExposedPorts") is not None
        or runtime.get("Volumes") is not None
        or runtime.get("OnBuild") is not None
        or runtime.get("Healthcheck") != EXPECTED_HEALTHCHECK
        or runtime.get("Labels")
        != {
            "org.opencontainers.image.revision": expected_release,
            "org.opencontainers.image.title": IMAGE_REPOSITORY,
        }
    ):
        refuse("image Config is outside the exact runtime contract")
    environment = runtime.get("Env")
    if (
        not isinstance(environment, list)
        or any(not isinstance(value, str) or "=" not in value for value in environment)
    ):
        refuse("image environment is invalid")
    environment_names = [value.partition("=")[0] for value in environment]
    if len(environment_names) != len(set(environment_names)):
        refuse("image environment contains duplicate names")
    observed_environment = {value.partition("=")[0]: value.partition("=")[2] for value in environment}
    required_environment = {
        "NODE_ENV": "production",
        "HOME": "/tmp",
        "HTTP_PROXY": "",
        "http_proxy": "",
        "HTTPS_PROXY": "",
        "https_proxy": "",
        "NO_PROXY": "",
        "no_proxy": "",
        "FTP_PROXY": "",
        "ftp_proxy": "",
        "ALL_PROXY": "",
        "all_proxy": "",
    }
    if any(observed_environment.get(name) != value for name, value in required_environment.items()):
        refuse("image environment is outside the exact no-proxy contract")
    forbidden_environment = {
        "DATABASE_URL",
        "SUPABASE_DB_PASSWORD",
        "SUPABASE_SERVICE_ROLE_KEY",
        "KEMERBET_EXECUTOR_DATABASE_URL",
        "TELEGRAM_BOT_TOKEN",
        "FINANCIAL_ACTIONS_MODE",
        "TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED",
        "KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED",
    }
    if forbidden_environment.intersection(environment_names):
        refuse("image embeds a runtime secret or financial-action setting")
    return image


def validate_oci_archive(
    archive: tarfile.TarFile,
    members_by_name: Mapping[str, tarfile.TarInfo],
    docker_entry: Mapping[str, object],
    expected_full_tag: str,
    expected_tag: str,
    expected_release: str,
) -> dict[str, str]:
    index = parse_json(member_bytes(archive, members_by_name, "index.json"), "OCI index")
    if not isinstance(index, dict):
        refuse("OCI index root is not an object")
    descriptors = index.get("manifests")
    if (
        set(index) != {"schemaVersion", "mediaType", "manifests"}
        or index.get("schemaVersion") != 2
        or index.get("mediaType") != "application/vnd.oci.image.index.v1+json"
        or not isinstance(descriptors, list)
        or len(descriptors) != 1
    ):
        refuse("OCI archive index is not singular and exact")
    descriptor = descriptors[0]
    if not isinstance(descriptor, dict):
        refuse("OCI archive descriptor is not an object")
    descriptor_size = descriptor.get("size")
    image_manifest_digest = descriptor.get("digest")
    if (
        set(descriptor) != {"mediaType", "digest", "size", "annotations"}
        or descriptor.get("mediaType") != "application/vnd.oci.image.manifest.v1+json"
        or not is_digest(image_manifest_digest)
        or isinstance(descriptor_size, bool)
        or not isinstance(descriptor_size, int)
        or not 0 < descriptor_size <= MAX_METADATA_BYTES
        or descriptor.get("annotations")
        != {
            "io.containerd.image.name": f"docker.io/library/{expected_full_tag}",
            "org.opencontainers.image.ref.name": expected_tag,
        }
    ):
        refuse("OCI archive descriptor is invalid or has another tag")
    image_manifest_bytes = require_digest_bound_blob(
        archive, members_by_name, image_manifest_digest, descriptor_size, MAX_METADATA_BYTES, True
    )
    if not isinstance(image_manifest_bytes, bytes):
        refuse("OCI image manifest was not read")
    image_manifest = parse_json(image_manifest_bytes, "OCI image manifest")
    if not isinstance(image_manifest, dict):
        refuse("OCI image manifest root is not an object")
    config_descriptor = image_manifest.get("config")
    layers = image_manifest.get("layers")
    if (
        set(image_manifest) != {"schemaVersion", "mediaType", "config", "layers"}
        or image_manifest.get("schemaVersion") != 2
        or image_manifest.get("mediaType") != "application/vnd.oci.image.manifest.v1+json"
        or not isinstance(config_descriptor, dict)
        or not isinstance(layers, list)
        or not layers
    ):
        refuse("OCI image manifest is not exact")
    config_size = config_descriptor.get("size")
    image_config_digest = config_descriptor.get("digest")
    if (
        set(config_descriptor) != {"mediaType", "digest", "size"}
        or config_descriptor.get("mediaType") != "application/vnd.oci.image.config.v1+json"
        or not is_digest(image_config_digest)
        or image_config_digest == image_manifest_digest
        or isinstance(config_size, bool)
        or not isinstance(config_size, int)
        or not 0 < config_size <= MAX_METADATA_BYTES
    ):
        refuse("OCI image config descriptor is invalid")
    config_bytes = require_digest_bound_blob(
        archive, members_by_name, image_config_digest, config_size, MAX_METADATA_BYTES, True
    )
    if not isinstance(config_bytes, bytes):
        refuse("OCI image config was not read")
    image_config = validate_runtime_config(config_bytes, expected_release)
    expected_config_path = f"blobs/sha256/{image_config_digest.removeprefix('sha256:')}"
    if docker_entry.get("Config") != expected_config_path:
        refuse("Docker manifest does not name the exact OCI config")

    layer_paths: list[str] = []
    layers_seen: set[str] = set()
    for layer in layers:
        if not isinstance(layer, dict):
            refuse("OCI layer descriptor is not an object")
        layer_digest = layer.get("digest")
        layer_size = layer.get("size")
        if (
            set(layer) != {"mediaType", "digest", "size"}
            or layer.get("mediaType")
            not in {
                "application/vnd.oci.image.layer.v1.tar",
                "application/vnd.oci.image.layer.v1.tar+gzip",
                "application/vnd.oci.image.layer.v1.tar+zstd",
            }
            or not is_digest(layer_digest)
            or layer_digest in layers_seen
            or isinstance(layer_size, bool)
            or not isinstance(layer_size, int)
            or not 0 < layer_size <= MAX_LAYER_BYTES
        ):
            refuse("OCI layer descriptor is invalid")
        layers_seen.add(layer_digest)
        require_digest_bound_blob(
            archive, members_by_name, layer_digest, layer_size, MAX_LAYER_BYTES, False
        )
        layer_paths.append(f"blobs/sha256/{layer_digest.removeprefix('sha256:')}")
    if docker_entry.get("Layers") != layer_paths:
        refuse("Docker and OCI layer inventories differ")
    if "LayerSources" in docker_entry:
        layer_sources = docker_entry.get("LayerSources")
        rootfs = image_config.get("rootfs")
        diff_ids = rootfs.get("diff_ids") if isinstance(rootfs, dict) else None
        if (
            not isinstance(layer_sources, dict)
            or not isinstance(rootfs, dict)
            or set(rootfs) != {"type", "diff_ids"}
            or rootfs.get("type") != "layers"
            or not isinstance(diff_ids, list)
            or len(diff_ids) != len(layers)
            or any(not is_digest(diff_id) for diff_id in diff_ids)
            or len(set(diff_ids)) != len(diff_ids)
            or layer_sources
            != {
                diff_id: layer
                for diff_id, layer in zip(diff_ids, layers, strict=True)
            }
        ):
            refuse("Docker layer sources are not exactly bound to the image config and manifest")
    oci_layout = parse_json(member_bytes(archive, members_by_name, "oci-layout"), "OCI layout")
    if oci_layout != {"imageLayoutVersion": "1.0.0"}:
        refuse("OCI layout version is not exact")
    expected_files = {
        "manifest.json",
        "index.json",
        "oci-layout",
        expected_config_path,
        f"blobs/sha256/{image_manifest_digest.removeprefix('sha256:')}",
        *layer_paths,
    }
    observed_files = {member.name for member in members_by_name.values() if member.isfile()}
    if observed_files != expected_files:
        refuse("OCI Docker archive contains an unrelated image or payload")
    return {
        "archiveFormat": "docker-save-oci-v1",
        "imageConfigDigest": image_config_digest,
        "imageManifestDigest": image_manifest_digest,
    }


def validate_legacy_archive(
    archive: tarfile.TarFile,
    members_by_name: Mapping[str, tarfile.TarInfo],
    docker_manifest_bytes: bytes,
    docker_entry: Mapping[str, object],
    expected_tag: str,
    expected_release: str,
) -> dict[str, str]:
    if "LayerSources" in docker_entry:
        refuse("legacy Docker archive unexpectedly contains OCI layer sources")
    config_path = docker_entry.get("Config")
    config_match = (
        re.fullmatch(r"([0-9a-f]{64})\.json", config_path)
        if isinstance(config_path, str)
        else None
    )
    layers = docker_entry.get("Layers")
    if (
        config_match is None
        or not isinstance(layers, list)
        or not layers
        or any(
            not isinstance(layer, str)
            or re.fullmatch(r"[0-9a-f]{64}/layer\.tar", layer) is None
            for layer in layers
        )
    ):
        refuse("legacy Docker archive config or layers are not exact")
    if len(set(layers)) != len(layers):
        refuse("legacy Docker archive contains duplicate layers")
    image_config_digest = f"sha256:{config_match.group(1)}"
    config_bytes = member_bytes(archive, members_by_name, config_path)
    if hashlib.sha256(config_bytes).hexdigest() != config_match.group(1):
        refuse("legacy Docker image config digest is invalid")

    layer_ids = [layer.split("/", 1)[0] for layer in layers]
    expected_files = {"manifest.json", "repositories", config_path}
    previous_layer: str | None = None
    for layer_id, layer_path in zip(layer_ids, layers, strict=True):
        layer_member, layer_stream = member_stream(archive, members_by_name, layer_path, MAX_LAYER_BYTES)
        hash_exact(layer_stream, layer_member.size, MAX_LAYER_BYTES)
        version = member_bytes(archive, members_by_name, f"{layer_id}/VERSION", 64)
        metadata = parse_json(
            member_bytes(archive, members_by_name, f"{layer_id}/json"),
            "legacy Docker layer metadata",
        )
        if not isinstance(metadata, dict) or metadata.get("id") != layer_id:
            refuse("legacy Docker layer identity is invalid")
        if previous_layer is None:
            if metadata.get("parent") not in (None, ""):
                refuse("legacy Docker base layer unexpectedly names a parent")
        elif metadata.get("parent") != previous_layer:
            refuse("legacy Docker layer parent chain is invalid")
        if version != b"1.0":
            refuse("legacy Docker layer version is invalid")
        previous_layer = layer_id
        expected_files.update({layer_path, f"{layer_id}/VERSION", f"{layer_id}/json"})

    repositories = parse_json(
        member_bytes(archive, members_by_name, "repositories"), "legacy repositories"
    )
    if repositories != {IMAGE_REPOSITORY: {expected_tag: layer_ids[-1]}}:
        refuse("legacy Docker repositories map contains another tag")
    observed_files = {member.name for member in members_by_name.values() if member.isfile()}
    if observed_files != expected_files:
        refuse("legacy Docker archive contains an unrelated image or payload")
    validate_runtime_config(config_bytes, expected_release)
    return {
        "archiveFormat": "docker-save-legacy-v1",
        "imageConfigDigest": image_config_digest,
        "imageManifestDigest": f"sha256:{hashlib.sha256(docker_manifest_bytes).hexdigest()}",
    }


def validate(archive_path: str, expected_tag: str, expected_release: str) -> dict[str, str]:
    expected_full_tag = f"{IMAGE_REPOSITORY}:{expected_tag}"
    if (
        RELEASE.fullmatch(expected_release) is None
        or re.fullmatch(r"[0-9a-f]{12}", expected_tag) is None
        or expected_tag != expected_release[:12]
    ):
        refuse("release identity is not canonical")
    archive_stat = pathlib.Path(archive_path).lstat()
    if (
        not stat.S_ISREG(archive_stat.st_mode)
        or archive_stat.st_nlink != 1
        or not 0 < archive_stat.st_size <= MAX_ARCHIVE_BYTES
    ):
        refuse("Docker archive file is absent or unsafe")

    with tarfile.open(archive_path, mode="r:") as archive:
        members = archive.getmembers()
        if not members or len(members) > MAX_MEMBERS:
            refuse("Docker archive member count is unsafe")
        members_by_name: dict[str, tarfile.TarInfo] = {}
        total_size = 0
        for member in members:
            target = pathlib.PurePosixPath(member.name)
            if (
                member.name in members_by_name
                or target.is_absolute()
                or ".." in target.parts
                or not (member.isfile() or member.isdir())
            ):
                refuse("Docker archive contains an unsafe member")
            total_size += member.size
            if total_size > MAX_ARCHIVE_BYTES:
                refuse("Docker archive expands beyond the reviewed limit")
            members_by_name[member.name] = member

        docker_manifest_bytes = member_bytes(archive, members_by_name, "manifest.json")
        docker_manifest = parse_json(docker_manifest_bytes, "Docker manifest")
        if not isinstance(docker_manifest, list) or len(docker_manifest) != 1:
            refuse("Docker archive manifest is not singular")
        docker_entry = docker_manifest[0]
        required_entry_fields = {"Config", "RepoTags", "Layers"}
        allowed_entry_fields = required_entry_fields | {"Parent", "LayerSources"}
        if (
            not isinstance(docker_entry, dict)
            or not required_entry_fields.issubset(docker_entry)
            or not set(docker_entry).issubset(allowed_entry_fields)
        ):
            refuse("Docker archive manifest entry is not exact")
        parent = docker_entry.get("Parent")
        if "Parent" in docker_entry and not is_digest(parent):
            refuse("Docker archive parent identity is invalid")
        if docker_entry.get("RepoTags") != [expected_full_tag]:
            refuse("Docker archive contains another image tag")

        has_index = "index.json" in members_by_name
        has_layout = "oci-layout" in members_by_name
        has_repositories = "repositories" in members_by_name
        if has_index and has_layout and not has_repositories:
            return validate_oci_archive(
                archive,
                members_by_name,
                docker_entry,
                expected_full_tag,
                expected_tag,
                expected_release,
            )
        if has_repositories and not has_index and not has_layout:
            return validate_legacy_archive(
                archive,
                members_by_name,
                docker_manifest_bytes,
                docker_entry,
                expected_tag,
                expected_release,
            )
        refuse("Docker archive mixes or omits reviewed save formats")


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: validator ARCHIVE IMAGE_TAG RELEASE_SHA", file=sys.stderr)
        return 2
    try:
        result = validate(sys.argv[1], sys.argv[2], sys.argv[3])
    except (OSError, RuntimeError, tarfile.TarError) as error:
        print(f"TeleBirr shadow-verifier archive rejected: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
