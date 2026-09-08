#!/usr/bin/env python3
"""Read-only host/application availability checks; no financial or database access."""

import argparse
import contextlib
import email.message
import http.client
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import smtplib
import ssl
import stat
import subprocess
import sys
import tempfile
import time

try:
    import fcntl
except ImportError:  # Unit tests are also run on Windows; installation is Linux-only.
    fcntl = None

CONFIG_PATH = Path('/etc/fetanagent/availability-monitor/smtp.json')
STATE_DIR = Path('/var/lib/fetanagent-availability-monitor')
PROJECT = 'fetanagent-production'
SERVICES = (
    'owner-control', 'customer-web', 'api', 'beta-admission', 'bot',
    'telebirr-assignment-broker', 'telebirr-device-state-broker',
    'telebirr-device-bridge', 'production-companion-device-bridge', 'gateway',
)
ENDPOINTS = (
    ('home', 'fetanagent.com', '/', b'FetanAgent'),
    ('sign-in', 'fetanagent.com', '/sign-in', b'id="sign-in-title"'),
    ('owner', 'owner.fetanagent.com', '/owner', b'Private production control'),
)
BODY_LIMIT = 512 * 1024
COMMAND_LIMIT = 16 * 1024
RETRY_SECONDS = 300
REMINDER_SECONDS = 3600
ISSUES = frozenset(
    [f'container:{service}:{reason}' for service in SERVICES
     for reason in ('missing', 'not_running', 'unhealthy', 'identity_mismatch')]
    + [f'https:{name}:{reason}' for name, _, _, _ in ENDPOINTS
       for reason in ('unavailable', 'timeout', 'tls_error', 'status', 'body', 'oversized')]
    + ['docker:unavailable', 'docker:timeout', 'docker:malformed',
       'disk:warning_85', 'disk:critical_95', 'disk:unavailable']
)


def log(code):
    # Call sites supply fixed event identifiers, never exception text or request data.
    if not re.fullmatch(r'[a-z_]{1,48}', code):
        code = 'invalid_log_event'
    print(f'availability_monitor event={code}', flush=True)


def strict_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate key')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique)


def secure_read(path, limit=8192):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != 0
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1
                or not 0 < info.st_size <= limit):
            raise ValueError('unsafe file')
        data = os.read(descriptor, limit + 1)
        if len(data) > limit:
            raise ValueError('oversized file')
        return strict_json(data)
    finally:
        os.close(descriptor)


def load_config(path=CONFIG_PATH):
    parent = path.parent.lstat()
    if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0 or parent.st_gid != 0
            or stat.S_IMODE(parent.st_mode) & 0o022):
        raise ValueError('configuration directory')
    value = secure_read(path)
    if not isinstance(value, dict) or set(value) != {'host', 'port', 'from', 'to', 'user', 'password'}:
        raise ValueError('configuration shape')
    # Fixed Mailgun submission endpoint: DigitalOcean blocks the standard SMTP ports.
    # Port 2525 still requires certificate-verified STARTTLS before authentication below.
    if value['host'] != 'smtp.eu.mailgun.org' or type(value['port']) is not int or value['port'] != 2525:
        raise ValueError('SMTP target')
    for field in ('from', 'to', 'user'):
        if (not isinstance(value[field], str) or len(value[field]) > 254
                or not re.fullmatch(r'[A-Za-z0-9.!#$%&\x27*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}', value[field])):
            raise ValueError('address')
    password = value['password']
    if not isinstance(password, str) or not 1 <= len(password) <= 1024 or any(ord(c) < 32 or ord(c) == 127 for c in password):
        raise ValueError('password shape')
    return value


def run_docker_metadata():
    """Fixed command, bounded stdout, discarded stderr; no full inspect/env/log capture."""
    template = '{{.Name}}\t{{.State.Status}}\t{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}\t{{index .Config.Labels "com.docker.compose.project"}}\t{{index .Config.Labels "com.docker.compose.service"}}'
    command = ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock', 'container', 'inspect',
               '--format', template] + [f'{PROJECT}-{service}-1' for service in SERVICES]
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, env={'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent'})
    data = bytearray()
    deadline = time.monotonic() + 8
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('docker deadline')
                if not selector.select(remaining):
                    raise TimeoutError('docker deadline')
                chunk = os.read(process.stdout.fileno(), min(4096, COMMAND_LIMIT + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
                if len(data) > COMMAND_LIMIT:
                    raise ValueError('docker bounds')
        return process.wait(timeout=max(0.01, deadline - time.monotonic())), data.decode('ascii')
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=2)
        process.stdout.close()


def check_containers():
    try:
        returncode, output = run_docker_metadata()
        if len(output) > COMMAND_LIMIT:
            raise ValueError('bounds')
        rows = {}
        for line in output.splitlines():
            fields = line.split('\t')
            if len(fields) != 5:
                raise ValueError('shape')
            name, status, health, project, service = fields
            if service not in SERVICES or service in rows:
                raise ValueError('identity')
            rows[service] = (name, status, health, project)
        issues = ['docker:unavailable'] if returncode else []
        if returncode and not rows:
            return ['docker:unavailable']
        for service in SERVICES:
            if service not in rows:
                issues.append(f'container:{service}:missing')
                continue
            name, status, health, project = rows[service]
            if name != f'/{PROJECT}-{service}-1' or project != PROJECT:
                issues.append(f'container:{service}:identity_mismatch')
            elif status != 'running':
                issues.append(f'container:{service}:not_running')
            elif health != 'healthy':
                issues.append(f'container:{service}:unhealthy')
        return issues
    except (TimeoutError, subprocess.TimeoutExpired):
        return ['docker:timeout']
    except (ValueError, UnicodeError):
        return ['docker:malformed']
    except OSError:
        return ['docker:unavailable']


def check_https(endpoint):
    name, host, path, marker = endpoint
    connection = None
    try:
        context = ssl.create_default_context()
        connection = http.client.HTTPSConnection(host, 443, timeout=4, context=context)
        connection.request('GET', path, headers={'User-Agent': 'FetanAgent-Availability/1',
                                               'Accept': 'text/html', 'Accept-Encoding': 'identity'})
        response = connection.getresponse()
        # http.client never follows redirects. Do not accept sign-in redirects as success.
        if response.status != 200:
            return [f'https:{name}:status']
        length = response.getheader('Content-Length')
        if length is not None and (not length.isdigit() or int(length) > BODY_LIMIT):
            return [f'https:{name}:oversized']
        if response.getheader('Content-Encoding', 'identity').lower() not in ('identity', ''):
            return [f'https:{name}:body']
        body = response.read(BODY_LIMIT + 1)
        if len(body) > BODY_LIMIT:
            return [f'https:{name}:oversized']
        if 'text/html' not in response.getheader('Content-Type', '').lower() or marker not in body:
            return [f'https:{name}:body']
        return []
    except ssl.SSLError:
        return [f'https:{name}:tls_error']
    except TimeoutError:
        return [f'https:{name}:timeout']
    except (OSError, http.client.HTTPException, ValueError):
        return [f'https:{name}:unavailable']
    finally:
        if connection is not None:
            connection.close()


def check_disk():
    try:
        usage = shutil.disk_usage('/srv/fetanagent/production')
        if usage.total <= 0 or not 0 <= usage.free <= usage.total:
            return ['disk:unavailable']
        used = (usage.total - usage.free) * 100 / usage.total
        if used >= 95:
            return ['disk:critical_95']
        if used >= 85:
            return ['disk:warning_85']
        return []
    except OSError:
        return ['disk:unavailable']


def collect_issues():
    issues = check_containers() + check_disk()
    for endpoint in ENDPOINTS:
        issues.extend(check_https(endpoint))
    return sorted(set(issues))


def initial_state():
    return {'version': 1, 'failures': 0, 'successes': 0, 'incident': False,
            'notified': False, 'last_attempt': 0, 'last_sent': 0, 'test_last_attempt': 0}


def validate_state(value, now):
    if (not isinstance(value, dict) or set(value) != set(initial_state())
            or type(value['version']) is not int or value['version'] != 1):
        raise ValueError('state shape')
    for name, maximum in (('failures', 3), ('successes', 2)):
        if type(value[name]) is not int or not 0 <= value[name] <= maximum:
            raise ValueError('state counters')
    for name in ('incident', 'notified'):
        if type(value[name]) is not bool:
            raise ValueError('state booleans')
    for name in ('last_attempt', 'last_sent', 'test_last_attempt'):
        if type(value[name]) is not int or not 0 <= value[name] <= now:
            raise ValueError('state clock')
    if value['notified'] and not value['incident']:
        raise ValueError('state incident')
    if (value['failures'] and value['successes']
            or value['last_sent'] > value['last_attempt']
            or value['notified'] and value['last_sent'] == 0):
        raise ValueError('state consistency')
    return value


def next_event(state, issues, now):
    validate_state(state, now)
    if any(issue not in ISSUES for issue in issues):
        raise ValueError('issue shape')
    if issues:
        state['successes'] = 0
        state['failures'] = min(3, state['failures'] + 1)
        if state['failures'] < 3:
            return None
        state['incident'] = True
        if state['last_attempt'] and now - state['last_attempt'] < RETRY_SECONDS:
            return None
        if not state['notified']:
            return 'outage'
        if now - state['last_sent'] >= REMINDER_SECONDS:
            return 'reminder'
    else:
        state['failures'] = 0
        state['successes'] = min(2, state['successes'] + 1)
        if state['successes'] == 2 and state['incident']:
            if not state['notified']:
                state['incident'] = False
            elif not state['last_attempt'] or now - state['last_attempt'] >= RETRY_SECONDS:
                return 'recovery'
    return None


def atomic_state(path, state):
    descriptor, temporary = tempfile.mkstemp(prefix='.availability-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='ascii') as stream:
            json.dump(state, stream, separators=(',', ':'), sort_keys=True)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextlib.contextmanager
def locked_state(directory=STATE_DIR):
    info = directory.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != 0
            or stat.S_IMODE(info.st_mode) != 0o700 or fcntl is None):
        raise ValueError('state directory')
    descriptor = os.open(directory / 'monitor.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != 0
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
            raise ValueError('lock shape')
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)


def send_email(config, event, issues, now):
    if event not in ('outage', 'reminder', 'recovery', 'test') or any(i not in ISSUES for i in issues):
        raise ValueError('message shape')
    message = email.message.EmailMessage()
    message['From'] = config['from']
    message['To'] = config['to']
    label = 'SERVICE TEST — no outage asserted' if event == 'test' else event.upper()
    message['Subject'] = f'FetanAgent availability: {label}'
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(now))
    details = '\n'.join(f'- {issue}' for issue in sorted(set(issues))) or '- No failed availability check.'
    message.set_content(f'FetanAgent service availability {event}.\nObserved: {timestamp}\n\n{details}\n\n'
                        'This is an infrastructure notification, not a payment or account-status message.\n'
                        'No service was restarted. Check the existing operations runbook.\n'
                        'This host-based monitor cannot report a complete host or outbound-network outage.\n')
    smtp = None
    try:
        smtp = smtplib.SMTP(config['host'], config['port'], timeout=6)
        smtp.ehlo()
        smtp.starttls(context=ssl.create_default_context())
        smtp.ehlo()
        smtp.login(config['user'], config['password'])
        refused = smtp.send_message(message, from_addr=config['from'], to_addrs=[config['to']])
        if refused:
            raise RuntimeError('recipient refused')
    finally:
        if smtp is not None:
            smtp.close()


def process_result(state, issues, now, config, path, *, test=False):
    validate_state(state, now)
    if test:
        if state['test_last_attempt'] and now - state['test_last_attempt'] < RETRY_SECONDS:
            log('test_rate_limited')
            return 2
        event = 'test'
        state['test_last_attempt'] = now
    else:
        event = next_event(state, issues, now)
        if event:
            state['last_attempt'] = now
    # Persist the attempt BEFORE SMTP: a crash cannot trigger a one-minute retry flood.
    atomic_state(path, state)
    if event:
        try:
            send_email(config, event, issues, now)
        except Exception:
            log('email_delivery_failed')
            return 2
        if event == 'recovery':
            state['incident'] = False
            state['notified'] = False
            state['last_sent'] = now
        elif event in ('outage', 'reminder'):
            state['notified'] = True
            state['last_sent'] = now
        atomic_state(path, state)
        log('test_email_accepted' if test else 'incident_email_accepted')
    elif issues:
        log('check_failed')
    else:
        log('check_healthy')
    return 1 if issues else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check-only', action='store_true', help='No config, state changes or email')
    mode.add_argument('--send-test', action='store_true', help='Explicitly send a labelled service-test email')
    arguments = parser.parse_args(argv)
    if not hasattr(os, 'geteuid') or os.geteuid() != 0:
        log('root_required')
        return 2
    if arguments.check_only:
        issues = collect_issues()
        print(json.dumps({'status': 'unhealthy' if issues else 'healthy', 'issues': issues}, separators=(',', ':')))
        return 1 if issues else 0
    try:
        config = load_config()
    except Exception:
        log('configuration_invalid')
        return 2
    try:
        with locked_state():
            path = STATE_DIR / 'state.json'
            try:
                state = secure_read(path)
            except FileNotFoundError:
                state = initial_state()
            now = int(time.time())
            validate_state(state, now)
            issues = [] if arguments.send_test else collect_issues()
            return process_result(state, issues, now, config, path, test=arguments.send_test)
    except BlockingIOError:
        log('already_running')
        return 0
    except Exception:
        log('monitor_failed')
        return 2


if __name__ == '__main__':
    def deadline(_signal, _frame):
        # Exit immediately: SIGALRM must not be swallowed by probe/SMTP error handling.
        log('overall_timeout')
        os._exit(2)
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(45)
    try:
        sys.exit(main())
    except Exception:
        log('monitor_failed')
        sys.exit(2)
