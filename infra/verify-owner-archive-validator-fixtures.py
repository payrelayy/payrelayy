#!/usr/bin/env python3
"""Linux-compatible regression fixtures for the Owner archive validator."""

import hashlib
import io
import json
import pathlib
import subprocess
import sys
import tarfile
import tempfile


VALIDATOR = pathlib.Path(sys.argv[1]).resolve()
TAG = "fetanagent-owner-control:fixture000001"


def encoded(value) -> bytes:
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode()


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def archive(path: pathlib.Path, entries):
    with tarfile.open(path, "w") as output:
        for name, data, kind in entries:
            member = tarfile.TarInfo(name)
            member.mode = 0o755 if kind == "dir" else 0o644
            if kind == "dir":
                member.type = tarfile.DIRTYPE
                output.addfile(member)
            else:
                member.size = len(data)
                output.addfile(member, io.BytesIO(data))


def invoke(path, image_id, encoding, layers, members, success):
    result = subprocess.run(
        [sys.executable, "-I", str(VALIDATOR), str(path), TAG, image_id,
         encoding, str(layers), str(members)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if (result.returncode == 0) != success:
        raise AssertionError(
            f"{path.name}: expected success={success}, got {result.returncode}: "
            f"{result.stdout}{result.stderr}"
        )


def classic_entries(extra_tag=False, extra_file=False):
    config_data = b'{"fixture":"classic"}'
    image = digest(config_data)
    layer_id = "1" * 64
    manifest = [{
        "Config": f"{image}.json",
        "RepoTags": [TAG, "fetanagent-owner-control:extra"] if extra_tag else [TAG],
        "Layers": [f"{layer_id}/layer.tar"],
    }]
    repository, tag = TAG.rsplit(":", 1)
    entries = [
        (layer_id, b"", "dir"),
        (f"{image}.json", config_data, "file"),
        (f"{layer_id}/VERSION", b"1.0", "file"),
        (f"{layer_id}/json", b"{}", "file"),
        (f"{layer_id}/layer.tar", b"classic-layer", "file"),
        ("manifest.json", encoded(manifest), "file"),
        ("repositories", encoded({repository: {tag: layer_id}}), "file"),
    ]
    if extra_file:
        entries.append(("unexpected", b"x", "file"))
    return image, entries


def oci_entries(*, extra_tag=False, layer_sources_extra=False, bad_blob=False,
                extra_blob=False, unexpected=False, unsafe=False, duplicate=False,
                index_media_type="application/vnd.oci.image.index.v1+json"):
    config_data = b'{"fixture":"oci"}'
    layer_data = b"oci-layer"
    config_digest = digest(config_data)
    layer_digest = digest(layer_data)
    config_path = f"blobs/sha256/{config_digest}"
    layer_path = f"blobs/sha256/{layer_digest}"
    image_manifest = {
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "config": {
            "mediaType": "application/vnd.oci.image.config.v1+json",
            "size": len(config_data),
            "digest": f"sha256:{config_digest}",
        },
        "layers": [{
            "mediaType": "application/vnd.oci.image.layer.v1.tar",
            "size": len(layer_data),
            "digest": f"sha256:{layer_digest}",
        }],
    }
    image_manifest_data = encoded(image_manifest)
    image_manifest_digest = digest(image_manifest_data)
    image_manifest_path = f"blobs/sha256/{image_manifest_digest}"
    layer_sources = {
        f"sha256:{layer_digest}": {
            "mediaType": "application/vnd.oci.image.layer.v1.tar",
            "size": len(layer_data),
            "digest": f"sha256:{layer_digest}",
        }
    }
    if layer_sources_extra:
        layer_sources["sha256:" + "f" * 64] = {
            "mediaType": "application/vnd.oci.image.layer.v1.tar",
            "size": 1,
            "digest": "sha256:" + "f" * 64,
        }
    record = {
        "Config": config_path,
        "RepoTags": [TAG, "fetanagent-owner-control:extra"] if extra_tag else [TAG],
        "Layers": [layer_path],
        "LayerSources": layer_sources,
    }
    repository, tag = TAG.rsplit(":", 1)
    index = {
        "schemaVersion": 2,
        "mediaType": index_media_type,
        "manifests": [{
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "digest": f"sha256:{image_manifest_digest}",
            "size": len(image_manifest_data),
            "annotations": {
                "io.containerd.image.name": f"docker.io/library/{TAG}",
                "org.opencontainers.image.ref.name": tag,
            },
        }],
    }
    entries = [
        ("blobs", b"", "dir"),
        ("blobs/sha256", b"", "dir"),
        (config_path, config_data, "file"),
        (layer_path, b"corrupt" if bad_blob else layer_data, "file"),
        (image_manifest_path, image_manifest_data, "file"),
        ("index.json", encoded(index), "file"),
        ("manifest.json", encoded([record]), "file"),
        ("oci-layout", encoded({"imageLayoutVersion": "1.0.0"}), "file"),
        ("repositories", encoded({repository: {tag: layer_digest}}), "file"),
    ]
    if extra_blob:
        data = b"valid unreferenced content-addressed blob"
        entries.append((f"blobs/sha256/{digest(data)}", data, "file"))
    if unexpected:
        entries.append(("unexpected", b"x", "file"))
    if unsafe:
        entries.append(("../escape", b"x", "file"))
    if duplicate:
        entries.append(("manifest.json", encoded([record]), "file"))
    return config_digest, entries


def main():
    with tempfile.TemporaryDirectory(prefix="owner-archive-validator-") as folder:
        root = pathlib.Path(folder)
        cases = []

        classic_id, entries = classic_entries()
        cases.append(("classic-valid", classic_id, "classic", 1, entries, True))
        for name, kwargs in [
            ("classic-extra-tag", {"extra_tag": True}),
            ("classic-extra-file", {"extra_file": True}),
        ]:
            image, value = classic_entries(**kwargs)
            cases.append((name, image, "classic", 1, value, False))

        variants = [
            ("oci-valid", {}, True),
            ("oci-valid-extra-addressed-blob", {"extra_blob": True}, True),
            ("oci-extra-tag", {"extra_tag": True}, False),
            ("oci-extra-layer-source", {"layer_sources_extra": True}, False),
            ("oci-wrong-index-media-type", {"index_media_type": "application/json"}, False),
            ("oci-bad-blob", {"bad_blob": True}, False),
            ("oci-unexpected-file", {"unexpected": True}, False),
            ("oci-unsafe-path", {"unsafe": True}, False),
            ("oci-duplicate-name", {"duplicate": True}, False),
        ]
        for name, kwargs, success in variants:
            image, value = oci_entries(**kwargs)
            cases.append((name, image, "oci", 1, value, success))

        for name, image, encoding, layers, entries, success in cases:
            path = root / f"{name}.tar"
            archive(path, entries)
            invoke(path, f"sha256:{image}", encoding, layers, len(entries), success)

    print("Owner archive validator classic/OCI fixtures passed")


if __name__ == "__main__":
    main()
