import importlib.util
import json
import os
from pathlib import Path
import stat
import struct
import sys
import types
import unittest
from unittest import mock

# Windows lacks these POSIX modules. Pure protocol tests remain portable.
for name in ("fcntl", "pwd"):
    try:
        __import__(name)
    except ImportError:
        sys.modules[name] = types.ModuleType(name)

ROOT = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


receiver = load("diagnostic_receiver", "operator-activation-diagnostic-receiver.py")
delivery = load("diagnostic_delivery", "deliver-activation-diagnostic-document.py")


def document():
    return json.dumps({
        "version": 1, "requestKey": "00000000-0000-4000-8000-000000000001",
        "databaseUrl": "synthetic", "databaseCaPem": "synthetic",
        "releaseTag": "windows-companion-v0.1.17",
    }).encode()


def frame(raw):
    return struct.pack("!I", len(raw)) + raw


class ProtocolTests(unittest.TestCase):
    def test_existing_document_round_trip(self):
        raw = document()
        self.assertEqual(receiver.decode_frame(frame(raw)), raw)

    def test_incomplete_oversized_and_extra_data_refused(self):
        for value in (b"", b"\0\0\0\0", struct.pack("!I", 16 * 1024 + 1),
                      frame(document())[:-1], frame(document()) + b"extra"):
            with self.assertRaises(ValueError):
                receiver.decode_frame(value)

    def test_alternate_release_or_new_shape_refused(self):
        for changes in ({"releaseTag": "windows-companion-v0.1.18"},
                        {"requestKey": "wrong"}, {"newRequest": True}):
            value = json.loads(document())
            value.update(changes)
            with self.assertRaises(ValueError):
                receiver.decode_frame(frame(json.dumps(value).encode()))

    def test_fixed_passed_and_stopped_reports(self):
        passed = dict(receiver.BASE, result="passed", stage="inspected")
        stopped = dict(receiver.BASE, stage="database_request")
        self.assertEqual(receiver.validate_report(json.dumps(passed), 0), passed)
        self.assertEqual(receiver.validate_report(json.dumps(stopped), 1), stopped)

    def test_unknown_fields_authority_claims_and_bad_exit_refused(self):
        variants = [dict(receiver.BASE, stage="untrusted-dynamic-stage"),
                    dict(receiver.BASE, private="unwanted"),
                    dict(receiver.BASE, moneyMoved=True),
                    dict(receiver.BASE, moneyMoved=0),
                    dict(receiver.BASE, requestCreated=True),
                    dict(receiver.BASE, liveReadinessProven=True)]
        for value in variants:
            with self.assertRaises(ValueError):
                receiver.validate_report(json.dumps(value), 1)
        with self.assertRaises(ValueError):
            receiver.validate_report(json.dumps(receiver.BASE), 0)

    @unittest.skipIf(os.name == "nt", "POSIX pipe flags are covered by Linux CI")
    def test_delivery_partial_writes_are_one_framed_document(self):
        read_fd, write_fd = os.pipe()
        uid, gid = os.getuid(), os.getgid()
        parent = types.SimpleNamespace(st_mode=stat.S_IFDIR | 0o710, st_uid=0, st_gid=gid)
        inode = types.SimpleNamespace(st_mode=stat.S_IFIFO | 0o600, st_uid=uid, st_gid=gid,
                                      st_nlink=1, st_dev=4, st_ino=7)
        actual_write = os.write
        try:
            with mock.patch.object(delivery.os, "lstat", side_effect=[parent, inode]), \
                 mock.patch.object(delivery.os, "open", return_value=write_fd), \
                 mock.patch.object(delivery.os, "fstat", return_value=inode), \
                 mock.patch.object(delivery.os, "write", side_effect=lambda fd, data: actual_write(fd, data[:13])):
                delivery.deliver(document())
            write_fd = None
            data = os.read(read_fd, 16 * 1024 + 4)
            self.assertEqual(receiver.decode_frame(data), document())
        finally:
            os.close(read_fd)
            if write_fd is not None:
                os.close(write_fd)

    @unittest.skipIf(os.name == "nt", "POSIX ownership checks are covered by Linux CI")
    def test_symlink_or_changed_inode_cannot_deliver(self):
        uid, gid = os.getuid(), os.getgid()
        parent = types.SimpleNamespace(st_mode=stat.S_IFDIR | 0o710, st_uid=0, st_gid=gid)
        link = types.SimpleNamespace(st_mode=stat.S_IFLNK | 0o600, st_uid=uid, st_gid=gid,
                                     st_nlink=1, st_dev=4, st_ino=7)
        with mock.patch.object(delivery.os, "lstat", side_effect=[parent, link]), \
             mock.patch.object(delivery.os, "open") as opened:
            with self.assertRaises(ValueError):
                delivery.deliver(document())
            opened.assert_not_called()


if __name__ == "__main__":
    unittest.main()
