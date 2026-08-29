#!/usr/bin/env python3
"""Fail-closed validator for the two Docker-save encodings used by FetanAgent."""

import hashlib
import json
import pathlib
import re
import sys
import tarfile


def fail(message: str) -> None:
    raise SystemExit(f"invalid Owner archive: {message}")


def digest_stream(stream) -> str:
    value = hashlib.sha256()
    while block := stream.read(1024 * 1024):
        value.update(block)
    return value.hexdigest()


def read_json(archive: tarfile.TarFile, members: dict[str, tarfile.TarInfo], name: str):
    member = members.get(name)
    if member is None or not member.isfile():
        fail(f"missing regular JSON member {name!r}")
    stream = archive.extractfile(member)
    if stream is None:
        fail(f"cannot read {name!r}")
    try:
        return json.load(stream)
    except Exception as error:
        fail(f"malformed JSON in {name!r}: {error}")


def validate(path: str, expected_tag: str, expected_id: str, encoding: str,
             expected_layers: int = 0, expected_members: int = 0) -> None:
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", expected_id):
        fail("expected image ID is malformed")
    image_digest = expected_id.removeprefix("sha256:")
    if encoding not in {"classic", "oci"}:
        fail("encoding must be classic or oci")
    with tarfile.open(path, mode="r:") as archive:
        entries = archive.getmembers()
        if not entries or len(entries) > 4096:
            fail("member count is outside the bounded range")
        if expected_members and len(entries) != expected_members:
            fail(f"member count {len(entries)} is not exact {expected_members}")
        names = [entry.name for entry in entries]
        if len(names) != len(set(names)):
            fail("duplicate member name")
        members = dict(zip(names, entries, strict=True))
        for entry in entries:
            target = pathlib.PurePosixPath(entry.name)
            if target.is_absolute() or ".." in target.parts:
                fail(f"unsafe path {entry.name!r}")
            if not (entry.isfile() or entry.isdir()):
                fail(f"unsupported member type for {entry.name!r}")
        manifest = read_json(archive, members, "manifest.json")
        if not isinstance(manifest, list) or len(manifest) != 1:
            fail("manifest.json must contain exactly one image")
        record = manifest[0]
        expected_record_keys = {"Config", "RepoTags", "Layers"} if encoding == "classic" else {"Config", "RepoTags", "Layers", "LayerSources"}
        if not isinstance(record, dict) or set(record) != expected_record_keys:
            fail("manifest image has missing or extra fields")
        if record["RepoTags"] != [expected_tag]:
            fail("RepoTags is not the exact singleton tag")
        layers = record["Layers"]
        if (not isinstance(layers, list) or not layers or
                any(not isinstance(layer, str) for layer in layers) or
                len(layers) != len(set(layers))):
            fail("Layers must be a nonempty duplicate-free string list")
        if expected_layers and len(layers) != expected_layers:
            fail(f"layer count {len(layers)} is not exact {expected_layers}")

        if encoding == "classic":
            config = f"{image_digest}.json"
            if record["Config"] != config:
                fail("classic Config does not bind the exact image ID")
            if any(re.fullmatch(r"[0-9a-f]{64}/layer\.tar", layer) is None for layer in layers):
                fail("classic layer path is malformed")
            allowed_files = {"manifest.json", "repositories", config}
            allowed_dirs: set[str] = set()
            for layer in layers:
                directory = layer.removesuffix("/layer.tar")
                allowed_dirs.add(directory)
                allowed_files.update({layer, f"{directory}/VERSION", f"{directory}/json"})
            actual_files = {name for name, member in members.items() if member.isfile()}
            actual_dirs = {name.rstrip("/") for name, member in members.items() if member.isdir()}
            if actual_files != allowed_files or not actual_dirs.issubset(allowed_dirs):
                fail("classic archive contains an unreferenced or unexpected member")
            config_member = members[config]
            stream = archive.extractfile(config_member)
            if stream is None or digest_stream(stream) != image_digest:
                fail("classic config bytes do not hash to the exact image ID")
            repository, tag = expected_tag.rsplit(":", 1)
            expected_repositories = {
                repository: {tag: layers[-1].removesuffix("/layer.tar")}
            }
            if read_json(archive, members, "repositories") != expected_repositories:
                fail("classic repositories does not bind the exact tag to the final layer")
            return

        config = f"blobs/sha256/{image_digest}"
        if record["Config"] != config:
            fail("OCI Config does not bind the exact image ID")
        blob_pattern = re.compile(r"blobs/sha256/([0-9a-f]{64})")
        if any(blob_pattern.fullmatch(layer) is None for layer in layers):
            fail("OCI layer path is malformed")
        layer_sources = record["LayerSources"]
        if not isinstance(layer_sources, dict) or set(layer_sources) != {
            f"sha256:{layer.removeprefix('blobs/sha256/')}" for layer in layers
        }:
            fail("OCI LayerSources does not exactly cover Layers")
        for blob in [config, *layers]:
            member = members.get(blob)
            match = blob_pattern.fullmatch(blob)
            if member is None or not member.isfile() or match is None:
                fail(f"missing referenced OCI blob {blob!r}")
            stream = archive.extractfile(member)
            if stream is None or digest_stream(stream) != match.group(1):
                fail(f"OCI blob bytes do not match path digest for {blob!r}")
        for layer in layers:
            digest_key = f"sha256:{layer.removeprefix('blobs/sha256/')}"
            source = layer_sources[digest_key]
            member = members[layer]
            if source != {
                "mediaType": "application/vnd.oci.image.layer.v1.tar",
                "size": member.size,
                "digest": digest_key,
            }:
                fail(f"OCI LayerSources entry is not exact for {layer!r}")

        layout = read_json(archive, members, "oci-layout")
        if layout != {"imageLayoutVersion": "1.0.0"}:
            fail("OCI layout is not exact")
        index = read_json(archive, members, "index.json")
        if not isinstance(index, dict) or set(index) != {
                "schemaVersion", "mediaType", "manifests"}:
            fail("OCI index has missing or extra fields")
        descriptors = index["manifests"]
        if (index["schemaVersion"] != 2 or
                index["mediaType"] != "application/vnd.oci.image.index.v1+json" or
                not isinstance(descriptors, list) or len(descriptors) != 1):
            fail("OCI index must have exactly one descriptor")
        descriptor = descriptors[0]
        if not isinstance(descriptor, dict) or set(descriptor) - {"mediaType", "digest", "size", "annotations"}:
            fail("OCI descriptor has extra fields")
        digest = descriptor.get("digest")
        if not isinstance(digest, str) or re.fullmatch(r"sha256:[0-9a-f]{64}", digest) is None:
            fail("OCI descriptor digest is malformed")
        image_manifest_path = f"blobs/sha256/{digest.removeprefix('sha256:')}"
        image_manifest_member = members.get(image_manifest_path)
        if image_manifest_member is None or not image_manifest_member.isfile():
            fail("OCI image manifest blob is absent")
        image_manifest_stream = archive.extractfile(image_manifest_member)
        if image_manifest_stream is None or digest_stream(image_manifest_stream) != digest.removeprefix("sha256:"):
            fail("OCI image manifest bytes do not match the descriptor digest")
        image_manifest = read_json(archive, members, image_manifest_path)
        expected_annotations = {
            "io.containerd.image.name": f"docker.io/library/{expected_tag}",
            "org.opencontainers.image.ref.name": expected_tag.rsplit(":", 1)[1],
        }
        if descriptor.get("mediaType") != "application/vnd.oci.image.manifest.v1+json" or descriptor.get("size") != image_manifest_member.size or descriptor.get("annotations") != expected_annotations:
            fail("OCI index descriptor metadata is not exact")
        if not isinstance(image_manifest, dict) or set(image_manifest) - {"schemaVersion", "mediaType", "config", "layers", "annotations"}:
            fail("OCI image manifest has extra fields")
        manifest_config = image_manifest.get("config")
        manifest_layers = image_manifest.get("layers")
        expected_manifest_config = {
            "mediaType": "application/vnd.oci.image.config.v1+json",
            "size": members[config].size,
            "digest": expected_id,
        }
        expected_manifest_layers = [
            {
                "mediaType": "application/vnd.oci.image.layer.v1.tar",
                "size": members[layer].size,
                "digest": f"sha256:{layer.removeprefix('blobs/sha256/')}",
            }
            for layer in layers
        ]
        if (image_manifest.get("schemaVersion") != 2 or
                image_manifest.get("mediaType") != "application/vnd.oci.image.manifest.v1+json" or
                manifest_config != expected_manifest_config or
                manifest_layers != expected_manifest_layers or
                ("annotations" in image_manifest and not isinstance(image_manifest["annotations"], dict))):
            fail("OCI image manifest does not bind the exact config and ordered layers")
        reachable_blobs = {config, *layers, image_manifest_path}
        actual_blobs = {name for name, member in members.items() if member.isfile() and blob_pattern.fullmatch(name)}
        if not reachable_blobs.issubset(actual_blobs):
            fail("OCI archive is missing a reachable blob")
        for blob in actual_blobs:
            match = blob_pattern.fullmatch(blob)
            stream = archive.extractfile(members[blob])
            if match is None or stream is None or digest_stream(stream) != match.group(1):
                fail(f"OCI content-addressed blob is invalid: {blob!r}")
        allowed_files = {"manifest.json", "index.json", "oci-layout", "repositories", *actual_blobs}
        actual_files = {name for name, member in members.items() if member.isfile()}
        if actual_files != allowed_files:
            fail("OCI archive contains an unexpected file")
        allowed_dirs = {"blobs", "blobs/sha256"}
        actual_dirs = {name.rstrip("/") for name, member in members.items() if member.isdir()}
        if actual_dirs != allowed_dirs:
            fail("OCI archive contains an unexpected directory")
        repositories = read_json(archive, members, "repositories")
        repository, tag = expected_tag.rsplit(":", 1)
        expected_repositories = {repository: {tag: layers[-1].removeprefix("blobs/sha256/")}}
        if repositories != expected_repositories:
            fail("repositories does not bind the exact tag to the final ordered layer")


if __name__ == "__main__":
    if len(sys.argv) not in {5, 6, 7}:
        fail("expected archive, tag, image ID, encoding, optional layer count, and optional member count")
    validate(
        *sys.argv[1:5],
        int(sys.argv[5]) if len(sys.argv) >= 6 else 0,
        int(sys.argv[6]) if len(sys.argv) == 7 else 0,
    )
