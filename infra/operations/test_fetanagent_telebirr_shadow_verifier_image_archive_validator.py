#!/usr/bin/env python3
"""Hostile and format fixtures for the shadow-verifier image archive validator."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import pathlib
import tarfile
import tempfile
import unittest


VALIDATOR_PATH = pathlib.Path(__file__).with_name(
    "fetanagent-telebirr-shadow-verifier-image-archive-validator.py"
)
SPEC = importlib.util.spec_from_file_location("shadow_archive_validator", VALIDATOR_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("validator module could not be loaded")
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)

RELEASE = "a" * 40
TAG = RELEASE[:12]
FULL_TAG = f"{validator.IMAGE_REPOSITORY}:{TAG}"
DEFAULT = object()


def encoded(value) -> bytes:
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")


def runtime_config(root=DEFAULT) -> bytes:
    if root is not DEFAULT:
        return encoded(root)
    return encoded(
        {
            "architecture": "amd64",
            "os": "linux",
            "config": {
                "User": "10001:10001",
                "Entrypoint": validator.EXPECTED_ENTRYPOINT,
                "Cmd": validator.EXPECTED_COMMAND,
                "WorkingDir": "/workspace",
                "Healthcheck": validator.EXPECTED_HEALTHCHECK,
                "Labels": {
                    "org.opencontainers.image.revision": RELEASE,
                    "org.opencontainers.image.title": validator.IMAGE_REPOSITORY,
                },
                "Env": [
                    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                    "NODE_ENV=production",
                    "HOME=/tmp",
                    "HTTP_PROXY=",
                    "http_proxy=",
                    "HTTPS_PROXY=",
                    "https_proxy=",
                    "NO_PROXY=",
                    "no_proxy=",
                    "FTP_PROXY=",
                    "ftp_proxy=",
                    "ALL_PROXY=",
                    "all_proxy=",
                ],
            },
        }
    )


def add_file(archive: tarfile.TarFile, name: str, value: bytes) -> None:
    member = tarfile.TarInfo(name)
    member.mode = 0o444
    member.size = len(value)
    archive.addfile(member, io.BytesIO(value))


def write_archive(files: dict[str, bytes]) -> pathlib.Path:
    descriptor, raw_path = tempfile.mkstemp(suffix=".tar")
    import os

    os.close(descriptor)
    with tarfile.open(raw_path, mode="w") as archive:
        for name, value in files.items():
            add_file(archive, name, value)
    pathlib.Path(raw_path).chmod(0o600)
    return pathlib.Path(raw_path)


def hybrid_archive(
    *,
    descriptor_override="default",
    config_descriptor_override="default",
    config_root=DEFAULT,
    descriptor_size_delta=0,
    include_layer_sources=False,
    layer_sources_override=DEFAULT,
    layer_payload_override=DEFAULT,
    parent=DEFAULT,
    extra_files=None,
    repo_tags=None,
) -> pathlib.Path:
    layer = b"one bounded layer\n"
    layer_digest = f"sha256:{hashlib.sha256(layer).hexdigest()}"
    diff_id = f"sha256:{hashlib.sha256(b'uncompressed bounded layer').hexdigest()}"
    config = runtime_config(config_root)
    if include_layer_sources and config_root is DEFAULT:
        config_value = json.loads(config)
        config_value["rootfs"] = {"type": "layers", "diff_ids": [diff_id]}
        config = encoded(config_value)
    config_digest = f"sha256:{hashlib.sha256(config).hexdigest()}"
    config_descriptor = (
        {
            "mediaType": "application/vnd.oci.image.config.v1+json",
            "digest": config_digest,
            "size": len(config),
        }
        if config_descriptor_override == "default"
        else config_descriptor_override
    )
    layer_descriptor = {
        "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
        "digest": layer_digest,
        "size": len(layer),
    }
    image_manifest = encoded(
        {
            "schemaVersion": 2,
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "config": config_descriptor,
            "layers": [layer_descriptor],
        }
    )
    manifest_digest = f"sha256:{hashlib.sha256(image_manifest).hexdigest()}"
    descriptor = (
        {
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "digest": manifest_digest,
            "size": len(image_manifest) + descriptor_size_delta,
            "annotations": {
                "io.containerd.image.name": f"docker.io/library/{FULL_TAG}",
                "org.opencontainers.image.ref.name": TAG,
            },
        }
        if descriptor_override == "default"
        else descriptor_override
    )
    config_path = f"blobs/sha256/{config_digest.removeprefix('sha256:')}"
    layer_path = f"blobs/sha256/{layer_digest.removeprefix('sha256:')}"
    docker_entry = {
        "Config": config_path,
        "RepoTags": [FULL_TAG] if repo_tags is None else repo_tags,
        "Layers": [layer_path],
    }
    if include_layer_sources:
        docker_entry["LayerSources"] = (
            {diff_id: layer_descriptor}
            if layer_sources_override is DEFAULT
            else layer_sources_override
        )
    if parent is not DEFAULT:
        docker_entry["Parent"] = parent
    files = {
        "manifest.json": encoded([docker_entry]),
        "index.json": encoded(
            {
                "schemaVersion": 2,
                "mediaType": "application/vnd.oci.image.index.v1+json",
                "manifests": [descriptor],
            }
        ),
        "oci-layout": encoded({"imageLayoutVersion": "1.0.0"}),
        config_path: config,
        f"blobs/sha256/{manifest_digest.removeprefix('sha256:')}": image_manifest,
        layer_path: layer if layer_payload_override is DEFAULT else layer_payload_override,
    }
    if extra_files is not None:
        files.update(extra_files)
    return write_archive(files)


def non_regular_archive(member_type: bytes, name: str = "manifest.json") -> pathlib.Path:
    descriptor, raw_path = tempfile.mkstemp(suffix=".tar")
    import os

    os.close(descriptor)
    with tarfile.open(raw_path, mode="w") as archive:
        member = tarfile.TarInfo(name)
        member.type = member_type
        member.linkname = "elsewhere"
        archive.addfile(member)
    return pathlib.Path(raw_path)


def duplicate_member_archive() -> pathlib.Path:
    descriptor, raw_path = tempfile.mkstemp(suffix=".tar")
    import os

    os.close(descriptor)
    with tarfile.open(raw_path, mode="w") as archive:
        add_file(archive, "manifest.json", b"[]")
        add_file(archive, "manifest.json", b"[]")
    return pathlib.Path(raw_path)


def legacy_archive() -> pathlib.Path:
    layer_id = "b" * 64
    layer_path = f"{layer_id}/layer.tar"
    config = runtime_config()
    config_digest = hashlib.sha256(config).hexdigest()
    files = {
        "manifest.json": encoded(
            [
                {
                    "Config": f"{config_digest}.json",
                    "RepoTags": [FULL_TAG],
                    "Layers": [layer_path],
                }
            ]
        ),
        "repositories": encoded({validator.IMAGE_REPOSITORY: {TAG: layer_id}}),
        f"{config_digest}.json": config,
        f"{layer_id}/VERSION": b"1.0",
        f"{layer_id}/json": encoded({"id": layer_id}),
        layer_path: b"legacy layer\n",
    }
    return write_archive(files)


class ArchiveValidatorTests(unittest.TestCase):
    def tearDown(self) -> None:
        for path in getattr(self, "paths", []):
            path.unlink(missing_ok=True)

    def keep(self, path: pathlib.Path) -> pathlib.Path:
        self.paths = [*getattr(self, "paths", []), path]
        return path

    def test_accepts_singular_oci_backed_docker_save(self) -> None:
        result = validator.validate(str(self.keep(hybrid_archive())), TAG, RELEASE)
        self.assertEqual(result["archiveFormat"], "docker-save-oci-v1")
        self.assertRegex(result["imageConfigDigest"], r"^sha256:[0-9a-f]{64}$")
        self.assertRegex(result["imageManifestDigest"], r"^sha256:[0-9a-f]{64}$")

    def test_accepts_exact_oci_layer_sources_and_parent_metadata(self) -> None:
        result = validator.validate(
            str(
                self.keep(
                    hybrid_archive(
                        include_layer_sources=True,
                        parent=f"sha256:{'c' * 64}",
                    )
                )
            ),
            TAG,
            RELEASE,
        )
        self.assertEqual(result["archiveFormat"], "docker-save-oci-v1")

    def test_rejects_unbound_oci_layer_sources_and_invalid_parent_metadata(self) -> None:
        hostile_archives = [
            hybrid_archive(include_layer_sources=True, layer_sources_override={}),
            hybrid_archive(include_layer_sources=True, layer_sources_override=[]),
            hybrid_archive(parent="not-a-digest"),
        ]
        for path in hostile_archives:
            with self.subTest(path=path):
                with self.assertRaises(RuntimeError):
                    validator.validate(str(self.keep(path)), TAG, RELEASE)

    def test_accepts_singular_legacy_docker_save(self) -> None:
        result = validator.validate(str(self.keep(legacy_archive())), TAG, RELEASE)
        self.assertEqual(result["archiveFormat"], "docker-save-legacy-v1")

    def test_rejects_multiple_tags(self) -> None:
        path = self.keep(hybrid_archive(repo_tags=[FULL_TAG, "unrelated:latest"]))
        with self.assertRaisesRegex(RuntimeError, "another image tag"):
            validator.validate(str(path), TAG, RELEASE)

    def test_rejects_non_object_oci_descriptors_without_type_confusion(self) -> None:
        for value in (None, False, [], [None]):
            with self.subTest(value=value):
                path = self.keep(hybrid_archive(descriptor_override=value))
                with self.assertRaises(RuntimeError):
                    validator.validate(str(path), TAG, RELEASE)

    def test_rejects_non_object_config_descriptors_without_type_confusion(self) -> None:
        for value in (None, False, [], [None]):
            with self.subTest(value=value):
                path = self.keep(hybrid_archive(config_descriptor_override=value))
                with self.assertRaises(RuntimeError):
                    validator.validate(str(path), TAG, RELEASE)

    def test_rejects_non_object_image_configs_without_type_confusion(self) -> None:
        for value in (None, False, [], [None]):
            with self.subTest(value=value):
                path = self.keep(hybrid_archive(config_root=value))
                with self.assertRaises(RuntimeError):
                    validator.validate(str(path), TAG, RELEASE)

    def test_rejects_unsafe_members_duplicate_names_and_extra_payloads(self) -> None:
        unsafe_paths = [
            non_regular_archive(tarfile.SYMTYPE),
            non_regular_archive(tarfile.REGTYPE, "../manifest.json"),
            duplicate_member_archive(),
            hybrid_archive(extra_files={"unrelated.txt": b"not part of the image"}),
        ]
        for path in unsafe_paths:
            with self.subTest(path=path):
                with self.assertRaises(RuntimeError):
                    validator.validate(str(self.keep(path)), TAG, RELEASE)

    def test_rejects_blob_digest_and_descriptor_size_mismatches(self) -> None:
        hostile_archives = [
            hybrid_archive(layer_payload_override=b"changed layer bytes\n"),
            hybrid_archive(descriptor_size_delta=1),
        ]
        for path in hostile_archives:
            with self.subTest(path=path):
                with self.assertRaises(RuntimeError):
                    validator.validate(str(self.keep(path)), TAG, RELEASE)

    def test_rejects_wrong_or_financial_runtime_config(self) -> None:
        base = json.loads(runtime_config())
        hostile_configs = []
        for field, value in (
            ("User", "0:0"),
            ("Cmd", ["sh"]),
            ("Entrypoint", ["sh"]),
            ("Labels", {"org.opencontainers.image.revision": RELEASE}),
        ):
            candidate = json.loads(json.dumps(base))
            candidate["config"][field] = value
            hostile_configs.append(candidate)
        candidate = json.loads(json.dumps(base))
        candidate["config"]["Env"].append("FINANCIAL_ACTIONS_MODE=enabled")
        hostile_configs.append(candidate)

        for config in hostile_configs:
            with self.subTest(config=config["config"]):
                path = self.keep(hybrid_archive(config_root=config))
                with self.assertRaises(RuntimeError):
                    validator.validate(str(path), TAG, RELEASE)

    def test_rejects_archive_identity_tag_and_release_mismatches(self) -> None:
        path = self.keep(hybrid_archive())
        for tag, release in (
            ("b" * 12, "b" * 40),
            ("b" * 12, RELEASE),
            (TAG, "b" * 40),
            ("not-a-tag", RELEASE),
        ):
            with self.subTest(tag=tag, release=release):
                with self.assertRaises(RuntimeError):
                    validator.validate(str(path), tag, release)


if __name__ == "__main__":
    unittest.main()
