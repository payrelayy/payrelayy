import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import smtplib
import ssl
import stat
import tempfile
import unittest
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location(
    'availability_monitor', Path(__file__).with_name('fetanagent-availability-monitor.py'))
monitor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(monitor)


class AvailabilityMonitorTests(unittest.TestCase):
    def setUp(self):
        self.now = 1_800_000_000
        self.issue = ['container:bot:unhealthy']
        self.config = {'host': 'smtp.eu.mailgun.org', 'port': 587,
                       'from': 'alerts@example.com', 'to': 'owner@example.com',
                       'user': 'postmaster@example.com', 'password': 'private-test-credential'}

    def healthy_docker_output(self):
        return '\n'.join(f'/{monitor.PROJECT}-{s}-1\trunning\thealthy\t{monitor.PROJECT}\t{s}'
                         for s in monitor.SERVICES)

    def test_config_rejects_wrong_targets_shape_and_header_injection(self):
        parent = Mock(st_mode=stat.S_IFDIR | 0o700, st_uid=0, st_gid=0)
        with patch.object(Path, 'lstat', return_value=parent), patch.object(monitor, 'secure_read') as read:
            read.return_value = self.config
            self.assertEqual(monitor.load_config(), self.config)
            for changes in ({'host': 'other.example.com'}, {'port': 465}, {'port': True},
                            {'to': 'owner@example.com\r\nBcc: attacker@example.com'},
                            {'from': 'Name <alerts@example.com>'}, {'user': 'bad'},
                            {'password': 'bad\nsecret'}, {'password': ''}, {'extra': 'field'}):
                read.return_value = dict(self.config, **changes)
                with self.subTest(changes=list(changes)), self.assertRaises(ValueError):
                    monitor.load_config()

    def test_config_parent_must_be_root_controlled(self):
        for info in (Mock(st_mode=stat.S_IFDIR | 0o777, st_uid=0, st_gid=0),
                     Mock(st_mode=stat.S_IFDIR | 0o700, st_uid=1000, st_gid=1000),
                     Mock(st_mode=stat.S_IFLNK | 0o777, st_uid=0, st_gid=0)):
            with patch.object(Path, 'lstat', return_value=info), self.assertRaises(ValueError):
                monitor.load_config()

    def test_duplicate_json_keys_rejected(self):
        with self.assertRaises(ValueError):
            monitor.strict_json('{"version":1,"version":2}')

    def test_docker_healthy_and_missing(self):
        output = self.healthy_docker_output()
        with patch.object(monitor, 'run_docker_metadata', return_value=(0, output)):
            self.assertEqual(monitor.check_containers(), [])
        with patch.object(monitor, 'run_docker_metadata', return_value=(1, '\n'.join(output.splitlines()[:-1]))):
            issues = monitor.check_containers()
            self.assertIn('container:gateway:missing', issues)
            self.assertIn('docker:unavailable', issues)

    def test_docker_unhealthy_and_wrong_identity(self):
        output = self.healthy_docker_output().replace('\trunning\thealthy\t', '\trunning\tunhealthy\t', 1)
        with patch.object(monitor, 'run_docker_metadata', return_value=(0, output)):
            self.assertEqual(monitor.check_containers(), ['container:owner-control:unhealthy'])
        output = self.healthy_docker_output().replace('/fetanagent-production-owner-control-1', '/wrong')
        with patch.object(monitor, 'run_docker_metadata', return_value=(0, output)):
            self.assertEqual(monitor.check_containers(), ['container:owner-control:identity_mismatch'])

    def test_docker_failures_are_bounded_and_sanitized(self):
        for failure, expected in ((TimeoutError('private marker'), 'docker:timeout'),
                                  (OSError('private marker'), 'docker:unavailable'),
                                  (ValueError('private marker'), 'docker:malformed')):
            with patch.object(monitor, 'run_docker_metadata', side_effect=failure):
                self.assertEqual(monitor.check_containers(), [expected])
        for output in ('private malformed output', 'x' * (monitor.COMMAND_LIMIT + 1),
                       self.healthy_docker_output() + '\n' + self.healthy_docker_output()):
            with patch.object(monitor, 'run_docker_metadata', return_value=(0, output)):
                self.assertEqual(monitor.check_containers(), ['docker:malformed'])

    def response(self, *, status=200, body=b'FetanAgent', headers=None):
        response = Mock(status=status)
        values = {'Content-Type': 'text/html', **(headers or {})}
        response.getheader.side_effect = lambda name, default=None: values.get(name, default)
        response.read.return_value = body
        connection = Mock()
        connection.getresponse.return_value = response
        return connection, response

    def test_https_only_exact_get_with_tls_and_bounded_body(self):
        connection, response = self.response()
        with patch.object(monitor.http.client, 'HTTPSConnection', return_value=connection) as create:
            self.assertEqual(monitor.check_https(monitor.ENDPOINTS[0]), [])
        self.assertEqual(create.call_args.args, ('fetanagent.com', 443))
        context = create.call_args.kwargs['context']
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertEqual(connection.request.call_args.args, ('GET', '/'))
        self.assertEqual(connection.request.call_args.kwargs['headers']['Accept-Encoding'], 'identity')
        response.read.assert_called_once_with(monitor.BODY_LIMIT + 1)
        connection.close.assert_called_once()

    def test_https_redirect_is_failure_not_followed(self):
        connection, response = self.response(status=302, headers={'Location': 'https://untrusted.invalid'})
        with patch.object(monitor.http.client, 'HTTPSConnection', return_value=connection) as create:
            self.assertEqual(monitor.check_https(monitor.ENDPOINTS[0]), ['https:home:status'])
            create.assert_called_once()
        response.read.assert_not_called()

    def test_https_bad_bodies_rejected(self):
        cases = (({'body': b'missing expected marker'}, 'body'),
                 ({'body': b'x' * (monitor.BODY_LIMIT + 1)}, 'oversized'),
                 ({'headers': {'Content-Length': str(monitor.BODY_LIMIT + 1)}}, 'oversized'),
                 ({'headers': {'Content-Length': 'invalid'}}, 'oversized'),
                 ({'headers': {'Content-Type': 'application/json'}}, 'body'),
                 ({'headers': {'Content-Encoding': 'gzip'}}, 'body'))
        for options, reason in cases:
            connection, _ = self.response(**options)
            with patch.object(monitor.http.client, 'HTTPSConnection', return_value=connection):
                self.assertEqual(monitor.check_https(monitor.ENDPOINTS[0]), [f'https:home:{reason}'])

    def test_https_failures_never_report_raw_exception(self):
        for error, reason in ((ssl.SSLError('private marker'), 'tls_error'),
                              (TimeoutError('private marker'), 'timeout'),
                              (OSError('private marker'), 'unavailable')):
            with patch.object(monitor.http.client, 'HTTPSConnection', side_effect=error):
                self.assertEqual(monitor.check_https(monitor.ENDPOINTS[0]), [f'https:home:{reason}'])

    def test_disk_thresholds(self):
        for used, expected in ((84, []), (85, ['disk:warning_85']), (94, ['disk:warning_85']),
                               (95, ['disk:critical_95']), (100, ['disk:critical_95'])):
            with patch.object(shutil, 'disk_usage', return_value=Mock(total=100, free=100-used)):
                self.assertEqual(monitor.check_disk(), expected)
        with patch.object(shutil, 'disk_usage', side_effect=OSError('private marker')):
            self.assertEqual(monitor.check_disk(), ['disk:unavailable'])

    def open_incident(self):
        state = monitor.initial_state()
        self.assertIsNone(monitor.next_event(state, self.issue, self.now))
        self.assertIsNone(monitor.next_event(state, self.issue, self.now + 60))
        self.assertEqual(monitor.next_event(state, self.issue, self.now + 120), 'outage')
        return state

    def test_three_consecutive_failures_and_quiet_initial_health(self):
        state = monitor.initial_state()
        for _ in range(4):
            self.assertIsNone(monitor.next_event(state, [], self.now))
        self.assertIsNone(monitor.next_event(state, self.issue, self.now))
        self.assertIsNone(monitor.next_event(state, [], self.now + 60))
        self.assertIsNone(monitor.next_event(state, self.issue, self.now + 120))
        self.assertEqual(state['failures'], 1)
        self.open_incident()

    def test_reminders_no_more_than_hourly_and_symptom_changes_do_not_bypass(self):
        state = self.open_incident()
        state.update(notified=True, last_attempt=self.now+120, last_sent=self.now+120)
        self.assertIsNone(monitor.next_event(state, ['disk:critical_95'], self.now + 370))
        self.assertIsNone(monitor.next_event(state, self.issue, self.now + 3719))
        self.assertEqual(monitor.next_event(state, self.issue, self.now + 3720), 'reminder')

    def test_recovery_requires_two_healthy_checks(self):
        state = self.open_incident()
        state.update(notified=True, last_attempt=self.now+120, last_sent=self.now+120)
        self.assertIsNone(monitor.next_event(state, [], self.now + 420))
        self.assertEqual(monitor.next_event(state, [], self.now + 480), 'recovery')

    def test_unnotified_short_incident_closes_without_recovery_email(self):
        state = self.open_incident()
        self.assertIsNone(monitor.next_event(state, [], self.now + 180))
        self.assertIsNone(monitor.next_event(state, [], self.now + 240))
        self.assertFalse(state['incident'])

    def test_attempt_is_persisted_before_send_and_failed_delivery_waits_five_minutes(self):
        state = self.open_incident()
        calls = []
        def persist(_path, value):
            calls.append(('persist', value['last_attempt']))
        def send(*_args):
            calls.append(('send', 0))
            raise smtplib.SMTPException('private SMTP credential marker')
        output = io.StringIO()
        with patch.object(monitor, 'atomic_state', side_effect=persist), patch.object(monitor, 'send_email', side_effect=send), contextlib.redirect_stdout(output):
            self.assertEqual(monitor.process_result(state, self.issue, self.now + 120, self.config, Path('state')), 2)
        self.assertEqual(calls, [('persist', self.now+120), ('send', 0)])
        self.assertNotIn('private SMTP', output.getvalue())
        self.assertIsNone(monitor.next_event(state, self.issue, self.now + 419))
        self.assertEqual(monitor.next_event(state, self.issue, self.now + 420), 'outage')

    def test_recovery_send_clears_incident_only_after_acceptance(self):
        state = self.open_incident()
        state.update(notified=True, last_attempt=self.now+120, last_sent=self.now+120, failures=0, successes=1)
        with patch.object(monitor, 'atomic_state'), patch.object(monitor, 'send_email') as send, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(monitor.process_result(state, [], self.now+500, self.config, Path('state')), 0)
        self.assertEqual(send.call_args.args[1], 'recovery')
        self.assertFalse(state['incident'])
        self.assertFalse(state['notified'])

    def test_test_email_is_labelled_and_does_not_open_incident(self):
        state = monitor.initial_state()
        with patch.object(monitor, 'atomic_state'), patch.object(monitor, 'send_email') as send, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(monitor.process_result(state, [], self.now, self.config, Path('state'), test=True), 0)
            self.assertEqual(send.call_args.args[1], 'test')
            self.assertFalse(state['incident'])
            self.assertEqual(monitor.process_result(state, [], self.now+60, self.config, Path('state'), test=True), 2)
            send.assert_called_once()

    def test_smtp_auth_occurs_only_after_verified_starttls(self):
        smtp = Mock()
        smtp.send_message.return_value = {}
        with patch.object(monitor.smtplib, 'SMTP', return_value=smtp) as connect:
            monitor.send_email(self.config, 'test', [], self.now)
        self.assertEqual([c[0] for c in smtp.method_calls], ['ehlo', 'starttls', 'ehlo', 'login', 'send_message', 'close'])
        context = smtp.starttls.call_args.kwargs['context']
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        message = smtp.send_message.call_args.args[0]
        self.assertIn('SERVICE TEST', message['Subject'])
        self.assertNotIn(self.config['password'], message.as_string())
        self.assertEqual(smtp.send_message.call_args.kwargs['to_addrs'], ['owner@example.com'])
        connect.assert_called_once_with('smtp.eu.mailgun.org', 587, timeout=6)

    def test_missing_starttls_never_sends_credentials(self):
        smtp = Mock()
        smtp.starttls.side_effect = smtplib.SMTPNotSupportedError('not supported')
        with patch.object(monitor.smtplib, 'SMTP', return_value=smtp), self.assertRaises(smtplib.SMTPException):
            monitor.send_email(self.config, 'outage', self.issue, self.now)
        smtp.login.assert_not_called()
        smtp.send_message.assert_not_called()
        smtp.close.assert_called_once()

    def test_unknown_issue_cannot_be_rendered_into_email(self):
        with self.assertRaises(ValueError):
            monitor.send_email(self.config, 'outage', ['private unexpected payload'], self.now)

    def test_state_corruption_and_clock_regression_fail_closed(self):
        for changes in ({'version': True}, {'failures': 4}, {'last_attempt': self.now+1},
                        {'incident': 1}, {'notified': True}, {'extra': 1},
                        {'failures': 1, 'successes': 1}, {'last_sent': self.now},
                        {'incident': True, 'notified': True}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                monitor.validate_state(dict(monitor.initial_state(), **changes), self.now)

    def test_check_only_does_not_read_config_write_state_or_email(self):
        with patch.object(os, 'geteuid', return_value=0, create=True), patch.object(monitor, 'collect_issues', return_value=self.issue), patch.object(monitor, 'load_config') as config, patch.object(monitor, 'atomic_state') as state, patch.object(monitor, 'send_email') as send, contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(monitor.main(['--check-only']), 1)
        self.assertEqual(json.loads(output.getvalue())['issues'], self.issue)
        config.assert_not_called()
        state.assert_not_called()
        send.assert_not_called()

    @unittest.skipUnless(os.name == 'posix' and hasattr(os, 'geteuid') and os.geteuid() == 0, 'root Linux filesystem acceptance')
    def test_secure_state_atomic_write_permissions_and_lock_contention(self):
        with tempfile.TemporaryDirectory(prefix='availability-unit-') as temporary:
            directory = Path(temporary)
            directory.chmod(0o700)
            state = monitor.initial_state()
            path = directory / 'state.json'
            monitor.atomic_state(path, state)
            self.assertEqual(monitor.secure_read(path), state)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            with monitor.locked_state(directory):
                with self.assertRaises(BlockingIOError), monitor.locked_state(directory):
                    pass
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                monitor.secure_read(path)
            path.unlink()
            (directory / 'target').write_text('{}')
            path.symlink_to(directory / 'target')
            with self.assertRaises(OSError):
                monitor.secure_read(path)

    def test_units_have_timeout_and_hardening_without_auto_restart(self):
        directory = Path(__file__).parent
        unit = (directory / 'fetanagent-availability-monitor.service').read_text()
        timer = (directory / 'fetanagent-availability-monitor.timer').read_text()
        for setting in ('Type=oneshot', 'TimeoutStartSec=50s', 'ProtectSystem=strict',
                        'NoNewPrivileges=yes', 'StateDirectoryMode=0700', 'CapabilityBoundingSet='):
            self.assertIn(setting, unit)
        self.assertNotIn('Restart=', unit)
        self.assertIn('OnUnitActiveSec=60s', timer)


if __name__ == '__main__':
    unittest.main()
