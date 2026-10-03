# document_bytes arrives only as private SSH stdin; no launch-document file.
import os
import select
import stat
import struct
import time
from pathlib import Path

DIRECTORY = Path("/run/fetanagent-activation-diagnostic-delivery")
FIFO = DIRECTORY / "input"


def require(value):
    if not value:
        raise ValueError("unavailable")


def deliver(document):
    require(isinstance(document, bytes) and 0 < len(document) <= 16 * 1024)
    parent = os.lstat(DIRECTORY)
    before = os.lstat(FIFO)
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == 0
            and parent.st_gid == os.getgid() and stat.S_IMODE(parent.st_mode) == 0o710)
    require(stat.S_ISFIFO(before.st_mode) and before.st_uid == os.getuid()
            and before.st_gid == os.getgid() and before.st_nlink == 1
            and stat.S_IMODE(before.st_mode) == 0o600)
    fd = os.open(FIFO, os.O_WRONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        actual = os.fstat(fd)
        require((actual.st_dev, actual.st_ino) == (before.st_dev, before.st_ino))
        frame = struct.pack("!I", len(document)) + document
        offset = 0
        deadline = time.monotonic() + 10
        while offset < len(frame):
            remaining = deadline - time.monotonic()
            require(remaining > 0 and select.select([], [fd], [], remaining)[1])
            offset += os.write(fd, frame[offset:])
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        deliver(document_bytes)
        print("activation_diagnostic_delivery=accepted")
    except Exception:
        print("activation_diagnostic_delivery=refused")
        raise SystemExit(1)
