# Ephemeral root-side receiver; no new login, sudo rule, or live launcher.
import fcntl
import hashlib
import json
import os
import pwd
import re
import select
import signal
import stat
import struct
import subprocess
import tempfile
import time
from pathlib import Path

IMAGE = "fetanagent-protected-operator-host:activation-diagnostic-pr619"
CURRENT_IMAGE = "fetanagent-protected-operator-host:ci"
CONTAINER = "fetanagent-activation-readonly-diagnostic"
LAUNCHER = Path("/usr/local/sbin/fetanagent-production-operator-host-launch")
RUNTIME = Path("/run/fetanagent-operator-host")
DELIVERY = Path("/run/fetanagent-activation-diagnostic-delivery")
SIGNER = Path("/etc/fetanagent/companion-execution-secrets/production-execution-signer.pkcs8.der")
ENTRY = ["/usr/local/bin/node", "/workspace/packages/agent-platform-companion-operator-host/dist/index.js"]
STAGES = {
    "input_validation", "node_database", "database_request", "database_boundary",
    "financial_state", "request_binding", "historical_window", "certificate_binding",
    "snapshot_shape", "published_release", "handoff_derivation", "execution_signer",
    "state_changed", "cleanup", "inspected",
}
BASE = {
    "component": "fetanagent_operator_activation_diagnostic",
    "result": "stopped", "stage": "input_validation",
    "inspectionMode": "historical_reconstruction", "liveReadinessProven": False,
    "requestCreated": False, "handoffSigned": False, "executionEnabled": False,
    "moneyMoved": False, "identifiersRedacted": True,
}


def require(value):
    if not value:
        raise ValueError("unavailable")


def command(*args, timeout=20):
    result = subprocess.run(args, capture_output=True, timeout=timeout)
    require(result.returncode == 0)
    return result.stdout.decode().strip()


def image_id(tag):
    return command("docker", "image", "inspect", tag, "--format", "{{.Id}}")


def no_listener():
    return command("ss", "-H", "-ltn", "( sport = :743 )") == ""


def decode_frame(frame):
    require(len(frame) >= 4)
    size = struct.unpack("!I", frame[:4])[0]
    require(0 < size <= 16 * 1024 and len(frame) == size + 4)
    document = bytes(frame[4:])
    value = json.loads(document)
    require(isinstance(value, dict) and set(value) == {
        "version", "requestKey", "databaseUrl", "databaseCaPem", "releaseTag"})
    require(value["version"] == 1 and value["releaseTag"] == "windows-companion-v0.1.17")
    require(isinstance(value["requestKey"], str) and re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
        value["requestKey"]))
    return document


def receive_frame(fd, seconds=300):
    frame = bytearray()
    deadline = time.monotonic() + seconds
    try:
        while True:
            remaining = deadline - time.monotonic()
            require(remaining > 0 and select.select([fd], [], [], remaining)[0])
            part = os.read(fd, 16 * 1024 + 5 - len(frame))
            require(part)
            frame.extend(part)
            require(len(frame) <= 16 * 1024 + 4)
            if len(frame) >= 4:
                size = struct.unpack("!I", frame[:4])[0]
                require(0 < size <= 16 * 1024 and len(frame) <= size + 4)
                if len(frame) == size + 4:
                    return decode_frame(frame)
    finally:
        frame[:] = b"\0" * len(frame)


def validate_report(raw, status):
    value = json.loads(raw)
    require(isinstance(value, dict) and set(value) == set(BASE))
    require(value["component"] == BASE["component"] and value["stage"] in STAGES)
    require(value["result"] in ("passed", "stopped"))
    require(all(type(value[k]) is type(BASE[k]) and value[k] == BASE[k] for k in (
        "inspectionMode", "liveReadinessProven", "requestCreated", "handoffSigned",
        "executionEnabled", "moneyMoved", "identifiersRedacted")))
    require((status == 0) == (value["result"] == "passed" and value["stage"] == "inspected"))
    return value


def inspect_once(options):
    report = dict(BASE)
    cleanup = {"containerRemoved": False, "signerCopyRemoved": False,
               "deliveryPipeRemoved": False, "currentImageUnchanged": False,
               "launcherUnchanged": False, "listenerAbsent": False,
               "diagnosisRun": False, "credentialDocumentPersisted": False}
    lock_fd = None
    input_fd = None
    stage = None
    document = None
    delivery_created = False
    current_id = None
    launcher_hash = None
    diagnostic_id = None
    try:
        require(os.getuid() == 0 and re.fullmatch(r"[0-9a-f]{40}", options["imageRevision"]))
        require(command("findmnt", "-n", "-o", "FSTYPE", "--target", "/run") == "tmpfs")
        require(not RUNTIME.is_symlink() and RUNTIME.is_dir())
        runtime_stat = RUNTIME.stat()
        require(runtime_stat.st_uid == 0 and runtime_stat.st_gid == 0
                and stat.S_IMODE(runtime_stat.st_mode) == 0o700)
        lock = RUNTIME / "one-shot.lock"
        lock_stat = os.lstat(lock)
        require(stat.S_ISREG(lock_stat.st_mode) and lock_stat.st_uid == 0
                and lock_stat.st_gid == 0 and lock_stat.st_nlink == 1
                and stat.S_IMODE(lock_stat.st_mode) == 0o600)
        lock_fd = os.open(lock, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
        require((os.fstat(lock_fd).st_dev, os.fstat(lock_fd).st_ino)
                == (lock_stat.st_dev, lock_stat.st_ino))
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current_id = image_id(CURRENT_IMAGE)
        launcher_hash = hashlib.sha256(LAUNCHER.read_bytes()).hexdigest()
        diagnostic_id = image_id(IMAGE)
        require(command("docker", "image", "inspect", IMAGE, "--format",
                        '{{index .Config.Labels "org.opencontainers.image.revision"}}')
                == options["imageRevision"])
        require(command("docker", "image", "inspect", IMAGE, "--format", "{{.Config.User}}")
                == "10001:10001")
        require(json.loads(command("docker", "image", "inspect", IMAGE, "--format",
                                   "{{json .Config.Entrypoint}}")) == ENTRY)
        names = command("docker", "ps", "-a", "--format", "{{.Names}}").splitlines()
        require(CONTAINER not in names and "fetanagent-protected-operator-host" not in names
                and no_listener())
        require(not DELIVERY.exists() and not DELIVERY.is_symlink())
        administrator = pwd.getpwnam("fetanagent-admin")
        DELIVERY.mkdir(mode=0o710)
        delivery_created = True
        os.chown(DELIVERY, 0, administrator.pw_gid)
        DELIVERY.chmod(0o710)
        fifo = DELIVERY / "input"
        os.mkfifo(fifo, mode=0o600)
        os.chown(fifo, administrator.pw_uid, administrator.pw_gid)
        input_fd = os.open(fifo, os.O_RDWR | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
        print(json.dumps({"component": "fetanagent_activation_diagnostic_receiver",
                          "result": "ready", "stage": "waiting_for_delivery",
                          "diagnosisRun": False, "moneyMoved": False,
                          "identifiersRedacted": True}, separators=(",", ":")), flush=True)
        document = receive_frame(input_fd)
        os.close(input_fd)
        input_fd = None
        require(image_id(CURRENT_IMAGE) == current_id
                and hashlib.sha256(LAUNCHER.read_bytes()).hexdigest() == launcher_hash
                and no_listener())
        stage = Path(tempfile.mkdtemp(prefix="activation-diagnostic.", dir=RUNTIME))
        signer_stat = os.lstat(SIGNER)
        require(stat.S_ISREG(signer_stat.st_mode) and signer_stat.st_uid == 0
                and signer_stat.st_gid == 0 and signer_stat.st_nlink == 1
                and stat.S_IMODE(signer_stat.st_mode) == 0o400
                and 100 <= signer_stat.st_size <= 4096)
        original_fd = os.open(SIGNER, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            actual = os.fstat(original_fd)
            require((actual.st_dev, actual.st_ino) == (signer_stat.st_dev, signer_stat.st_ino))
            key = bytearray(os.read(original_fd, 4097))
            require(len(key) == signer_stat.st_size)
        finally:
            os.close(original_fd)
        signer_copy = stage / "signer.pkcs8.der"
        try:
            with signer_copy.open("xb") as output:
                output.write(key)
            os.chown(signer_copy, 10001, 10001)
            signer_copy.chmod(0o400)
        finally:
            key[:] = b"\0" * len(key)
        cleanup["diagnosisRun"] = True
        result = subprocess.run([
            "docker", "run", "--rm", "-i", "--name", CONTAINER,
            "--network", "host", "--read-only", "--log-driver", "none",
            "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m,uid=10001,gid=10001,mode=700",
            "--cap-drop", "ALL", "--cap-add", "NET_BIND_SERVICE",
            "--security-opt", "no-new-privileges", "--pids-limit", "64",
            "--memory", "512m", "--user", "10001:10001", "--stop-timeout", "20",
            "--mount", "type=bind,src=" + str(signer_copy)
            + ",dst=/run/secrets/companion_execution_signer.pkcs8.der,readonly",
            IMAGE, "--diagnose-activation",
        ], input=document, capture_output=True, timeout=90)
        require(len(result.stdout) <= 8192)
        report = validate_report(result.stdout, result.returncode)
    except Exception:
        pass
    finally:
        document = None
        try:
            if input_fd is not None:
                os.close(input_fd)
            if cleanup["diagnosisRun"]:
                existing = subprocess.run(["docker", "container", "inspect", CONTAINER,
                                           "--format", "{{.Image}}"],
                                          capture_output=True, timeout=15)
                if existing.returncode == 0:
                    require(existing.stdout.decode().strip() == diagnostic_id)
                    command("docker", "stop", "--time", "20", CONTAINER, timeout=30)
            command("docker", "info", "--format", "{{.ServerVersion}}")
            require(CONTAINER not in command("docker", "ps", "-a", "--format", "{{.Names}}").splitlines())
            cleanup["containerRemoved"] = True
            if stage is not None:
                require(stage.parent == RUNTIME and stage.name.startswith("activation-diagnostic.")
                        and not stage.is_symlink() and stage.stat().st_uid == 0)
                signer_copy = stage / "signer.pkcs8.der"
                if signer_copy.exists():
                    require(not signer_copy.is_symlink() and signer_copy.is_file())
                    signer_copy.unlink()
                stage.rmdir()
            cleanup["signerCopyRemoved"] = True
            if delivery_created:
                require(not DELIVERY.is_symlink() and DELIVERY.is_dir() and DELIVERY.stat().st_uid == 0)
                fifo = DELIVERY / "input"
                if fifo.exists():
                    require(stat.S_ISFIFO(os.lstat(fifo).st_mode))
                    fifo.unlink()
                DELIVERY.rmdir()
            cleanup["deliveryPipeRemoved"] = not DELIVERY.exists()
            cleanup["currentImageUnchanged"] = current_id is not None and image_id(CURRENT_IMAGE) == current_id
            cleanup["launcherUnchanged"] = launcher_hash is not None and hashlib.sha256(LAUNCHER.read_bytes()).hexdigest() == launcher_hash
            cleanup["listenerAbsent"] = no_listener()
            require(all(cleanup[k] for k in (
                "containerRemoved", "signerCopyRemoved", "deliveryPipeRemoved",
                "currentImageUnchanged", "launcherUnchanged", "listenerAbsent")))
        except Exception:
            report = dict(BASE, stage="cleanup")
        finally:
            if lock_fd is not None:
                os.close(lock_fd)
    return dict(report, **cleanup)


if __name__ == "__main__":
    def interrupted(_signal, _frame):
        raise InterruptedError("Read-only diagnostic interrupted.")
    for name in ("SIGHUP", "SIGINT", "SIGTERM"):
        signal.signal(getattr(signal, name), interrupted)
    report = inspect_once(OPTIONS)
    print(json.dumps(report, separators=(",", ":")), flush=True)
    raise SystemExit(0 if report["result"] == "passed" else 1)
