import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "ban_repair", Path(__file__).with_name("repair-diagnostic-database-ban.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
PROJECT = "a" * 20
SOURCE = "2606:4700::1111"
OTHER = "2606:4700::1001"


class BanRepairTests(unittest.TestCase):
    def test_only_the_verified_source_is_removed_once(self):
        calls = []
        responses = iter([json.dumps([SOURCE, OTHER]), "", json.dumps([OTHER])])
        def cli(args):
            calls.append(args)
            return next(responses)
        self.assertTrue(module.repair(PROJECT, SOURCE, cli))
        removals = [args for args in calls if args[1] == "remove"]
        self.assertEqual(len(removals), 1)
        self.assertEqual(removals[0][removals[0].index("--db-unban-ip") + 1], SOURCE)
        self.assertTrue(all("--project-ref" in args for args in calls))

    def test_a_clear_source_causes_no_write(self):
        calls = []
        def cli(args):
            calls.append(args)
            return json.dumps([OTHER])
        self.assertFalse(module.repair(PROJECT, SOURCE, cli))
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1], "get")

    def test_malformed_bans_are_refused_before_removal(self):
        for response in ('{}', '[42]', '["untrusted"]', 'private-invalid-material'):
            calls = []
            def cli(args):
                calls.append(args)
                return response
            with self.assertRaises(Exception):
                module.repair(PROJECT, SOURCE, cli)
            self.assertTrue(all(args[1] == "get" for args in calls))

    def test_non_global_sources_or_invalid_projects_cannot_call_cli(self):
        for project, source in (("wrong", SOURCE), (PROJECT, "::1"),
                                (PROJECT, "2001:db8::1"), (PROJECT, "1.1.1.1")):
            with self.assertRaises(Exception):
                module.repair(project, source, lambda _: self.fail("CLI must not run"))

    def test_a_failed_removal_is_not_repeated(self):
        calls = []
        def cli(args):
            calls.append(args)
            if args[1] == "remove":
                raise module.RepairFailure()
            return json.dumps([SOURCE])
        with self.assertRaises(module.RepairFailure):
            module.repair(PROJECT, SOURCE, cli)
        self.assertEqual(sum(args[1] == "remove" for args in calls), 1)


if __name__ == "__main__":
    unittest.main()
