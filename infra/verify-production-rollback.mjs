import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const helperSource = readFileSync(
  join(repository, 'infra/operations/fetanagent-production-deploy-helper.sh'),
  'utf8',
).replace(/\r\n/g, '\n');
const candidate = 'a'.repeat(40);
const predecessor = 'b'.repeat(40);
const newer = 'c'.repeat(40);
const project = 'fetanagent-production';

// These tests execute the complete checked-in helper, not a reimplemented guard. Its fixed
// paths are rewritten only in the disposable copy. No Docker command can reach a daemon.
const stubSource = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const fixture = process.env.FETANAGENT_TEST_FIXTURE;
if (!fixture || !path.basename(fixture).startsWith('fetanagent-rollback-test-')) process.exit(90);
const config = JSON.parse(fs.readFileSync(path.join(fixture, 'config.json'), 'utf8'));
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
function output(value) { process.stdout.write(String(value) + '\\n'); }
function unexpected() { output('UNEXPECTED STUB INVOCATION'); process.exit(91); }
if (name === 'id') { if (args.join(' ') !== '-u') unexpected(); output(0); }
else if (name === 'stat') {
  const target = args.at(-1);
  if (!target.startsWith(fixture + path.sep)) unexpected();
  let stat;
  try { stat = fs.lstatSync(target); } catch { process.exit(1); }
  const format = args.find(v => v.startsWith('--format='))?.slice(9) ?? args[args.indexOf('-c') + 1];
  const overridden = config.unsafeOwner === target;
  const values = { '%u': overridden ? '123' : '0', '%g': overridden ? '123' : '0',
    '%U': overridden ? 'unsafe' : 'root', '%G': overridden ? 'unsafe' : 'root',
    '%a': (stat.mode & 0o777).toString(8), '%h': String(stat.nlink), '%s': String(stat.size) };
  if (typeof format !== 'string') unexpected();
  output(format.replace(/%[ugUGahs]/g, token => values[token]));
}
else if (name === 'docker') {
  const entry = { args, mutation: false };
  const record = () => fs.appendFileSync(path.join(fixture, 'docker-calls.jsonl'), JSON.stringify(entry) + '\\n');
  if (args[0] === 'container' && args[1] === 'ls') {
    record();
    if (config.listFailure) process.exit(1);
    const filters = args.filter((_, i) => args[i - 1] === '--filter');
    const selected = config.containers.filter(container => filters.every(filter => {
      if (filter.startsWith('label=com.docker.compose.project=')) return container.project === filter.split('=').at(-1);
      if (filter.startsWith('label=com.docker.compose.service=')) return container.service === filter.split('=').at(-1);
      unexpected();
    }));
    if (selected.length) output(selected.map(container => container.id).join('\\n'));
  } else if (args[0] === 'inspect') {
    record();
    if (config.inspectFailure) process.exit(1);
    if (args[1] !== '--format' || args.length < 4) unexpected();
    const format = args[args.indexOf('--format') + 1];
    for (const id of args.slice(3)) {
      const container = config.containers.find(value => value.id === id);
      if (!container) process.exit(1);
      if (format === '{{ index .Config.Labels "org.opencontainers.image.revision" }}') output(container.revision);
      else if (format === '{{ index .Config.Labels "com.docker.compose.project" }}') output(container.project);
      else if (format === '{{ index .Config.Labels "com.docker.compose.service" }}') output(container.service);
      else if (format === '{{.State.Running}}') output(container.running !== false);
      else unexpected();
    }
  } else if (args[0] === 'compose') {
    const compose = args[args.indexOf('--file') + 1];
    if (!compose?.startsWith(fixture + '/production/releases/') ||
        args[args.indexOf('--project-name') + 1] !== '${project}' ||
        !args.some(value => value === 'down' || value === 'up')) unexpected();
    entry.mutation = true; record();
  } else if (args[0] === 'container' && ['start', 'stop'].includes(args[1])) {
    entry.mutation = true; record();
  } else { record(); unexpected(); }
} else unexpected();
`;

function write(path, content, mode = 0o600) {
  writeFileSync(path, content, { mode });
  chmodSync(path, mode);
}

function fixture({
  current = predecessor,
  previous = predecessor,
  revisions = [candidate, predecessor],
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'fetanagent-rollback-test-'));
  const root = join(directory, 'production');
  const state = join(directory, 'state');
  const bin = join(directory, 'bin');
  for (const path of [root, state, bin]) mkdirSync(path, { mode: 0o700 });
  for (const sha of [candidate, predecessor, newer]) {
    const release = join(root, 'releases', sha);
    mkdirSync(release, { recursive: true, mode: 0o700 });
    write(join(release, '.release-sha'), `${sha}\n`);
    write(join(release, '.image-tag'), `${sha.slice(0, 12)}\n`);
    write(join(release, 'telebirr-assignment-signer-key-id'), 'test-signer-v1\n');
    write(join(release, 'compose.production.yaml'), 'services: {}\n');
  }
  const release = (sha) => join(root, 'releases', sha);
  const currentLink = join(root, 'current');
  if (current) symlinkSync(release(current), currentLink);
  const receipt = join(state, `pending-${candidate}.previous`);
  if (previous !== undefined) write(receipt, previous ? `${release(previous)}\n` : '\n');
  write(join(state, 'helper.lock'), '');
  const config = {
    containers: revisions.map((revision, index) => ({
      id: String(index + 1).repeat(64),
      project,
      service: index ? 'gateway' : 'owner-control',
      revision,
    })),
  };
  const saveConfig = () => write(join(directory, 'config.json'), JSON.stringify(config));
  saveConfig();
  const helper = join(directory, 'deploy-helper');
  let source = helperSource;
  for (const [before, after] of [
    ["readonly ROOT='/srv/fetanagent/production'", `readonly ROOT='${root}'`],
    ["readonly STATE_ROOT='/var/lib/fetanagent/production'", `readonly STATE_ROOT='${state}'`],
    [
      "readonly HELPER_PATH='/usr/local/sbin/fetanagent-production-deploy-helper'",
      `readonly HELPER_PATH='${helper}'`,
    ],
    [
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      `PATH=${bin}:/usr/bin:/bin`,
    ],
  ]) {
    assert.equal(
      source.split(before).length,
      2,
      `fixture rewrite must match exactly once: ${before}`,
    );
    source = source.replace(before, after);
  }
  write(helper, source, 0o700);
  for (const command of ['docker', 'id', 'stat']) write(join(bin, command), stubSource, 0o700);
  const inspectFile = (path) => {
    if (!existsSync(path)) {
      try {
        return `link:${readlinkSync(path)}`;
      } catch {
        return 'absent';
      }
    }
    const stats = lstatSync(path);
    return stats.isSymbolicLink()
      ? `link:${readlinkSync(path)}`
      : `${stats.mode & 0o777}:${readFileSync(path, 'utf8')}`;
  };
  const snapshot = () =>
    JSON.stringify([
      inspectFile(currentLink),
      inspectFile(receipt),
      inspectFile(join(state, `pending-${candidate}.legacy-bridge`)),
    ]);
  const calls = () =>
    existsSync(join(directory, 'docker-calls.jsonl'))
      ? readFileSync(join(directory, 'docker-calls.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(JSON.parse)
      : [];
  return {
    directory,
    root,
    state,
    receipt,
    release,
    currentLink,
    config,
    saveConfig,
    calls,
    snapshot,
    run(command = 'check-rollback', sha = candidate) {
      const result = spawnSync('/bin/bash', [helper, command, sha], {
        env: { PATH: '/usr/bin:/bin', LANG: 'C', FETANAGENT_TEST_FIXTURE: directory },
        timeout: 5_000,
        encoding: 'utf8',
        maxBuffer: 64 * 1024,
      });
      assert.equal(result.error, undefined, result.error?.message);
      assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED STUB INVOCATION/);
      return result;
    },
    cleanup() {
      assert.equal(dirname(directory), tmpdir());
      assert.ok(directory.includes('/fetanagent-rollback-test-'));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function isolated(name, operation) {
  test(name, { timeout: 10_000 }, async () => {
    const subject = fixture();
    try {
      await operation(subject);
    } finally {
      subject.cleanup();
    }
  });
}

function rejectWithoutMutation(subject, command = 'check-rollback') {
  const before = subject.snapshot();
  const result = subject.run(command);
  assert.notEqual(result.status, 0, `unsafe ${command} succeeded: ${result.stdout}`);
  assert.equal(subject.snapshot(), before, 'rejected rollback altered a receipt or current marker');
  assert.equal(
    subject.calls().filter((call) => call.mutation).length,
    0,
    'rejected rollback changed services',
  );
}

if (process.platform !== 'linux') {
  test(
    'production rollback behavior requires Linux bash/flock; no production services are accessed',
    { skip: true },
    () => {},
  );
} else {
  for (const command of ['check-rollback', 'rollback']) {
    isolated(`${command} rejects an older receipt against newer healthy production`, (subject) => {
      rmSync(subject.currentLink);
      symlinkSync(subject.release(newer), subject.currentLink);
      subject.config.containers.forEach((container) => {
        container.revision = newer;
      });
      subject.saveConfig();
      write(join(subject.state, `pending-${candidate}.legacy-bridge`), `${'d'.repeat(64)}\n`);
      rejectWithoutMutation(subject, command);
    });
    isolated(
      `${command} rejects a newer interrupted transition sharing the predecessor`,
      (subject) => {
        subject.config.containers[0].revision = newer;
        subject.saveConfig();
        rejectWithoutMutation(subject, command);
      },
    );
  }

  for (const current of [predecessor, candidate]) {
    isolated(
      `valid ${current === candidate ? 'post' : 'pre'}-cutover transition checks read-only and rolls back`,
      (subject) => {
        rmSync(subject.currentLink);
        symlinkSync(subject.release(current), subject.currentLink);
        const before = subject.snapshot();
        const checked = subject.run();
        assert.equal(checked.status, 0, checked.stderr);
        assert.equal(subject.snapshot(), before);
        assert.equal(subject.calls().filter((call) => call.mutation).length, 0);
        const rolledBack = subject.run('rollback');
        assert.equal(rolledBack.status, 0, rolledBack.stderr);
        assert.equal(readlinkSync(subject.currentLink), subject.release(predecessor));
        assert.equal(existsSync(subject.receipt), false);
        assert.deepEqual(
          subject
            .calls()
            .filter((call) => call.mutation)
            .map((call) => (call.args.includes('down') ? 'down' : 'up')),
          ['down', 'up'],
        );
      },
    );
  }

  for (const cutoverComplete of [false, true]) {
    isolated(
      `initial ${cutoverComplete ? 'post' : 'pre'}-cutover rollback preserves empty-predecessor recovery`,
      (subject) => {
        rmSync(subject.currentLink);
        if (cutoverComplete) symlinkSync(subject.release(candidate), subject.currentLink);
        write(subject.receipt, '\n');
        subject.config.containers = cutoverComplete ? [subject.config.containers[0]] : [];
        subject.saveConfig();
        const checked = subject.run();
        assert.equal(checked.status, 0, checked.stderr);
        const rolledBack = subject.run('rollback');
        assert.equal(rolledBack.status, 0, rolledBack.stderr);
        assert.equal(existsSync(subject.currentLink), false);
        assert.equal(existsSync(subject.receipt), false);
      },
    );
  }

  for (const [name, change] of [
    ['missing pending receipt', (subject) => rmSync(subject.receipt)],
    [
      'symlink pending receipt',
      (subject) => {
        rmSync(subject.receipt);
        symlinkSync('/dev/null', subject.receipt);
      },
    ],
    [
      'multiline pending receipt',
      (subject) =>
        write(subject.receipt, `${subject.release(predecessor)}\n${subject.release(newer)}\n`),
    ],
    ['wrong receipt permissions', (subject) => chmodSync(subject.receipt, 0o644)],
    ['oversized pending receipt', (subject) => write(subject.receipt, 'x'.repeat(4097))],
    ['empty malformed receipt', (subject) => write(subject.receipt, '')],
    [
      'wrong receipt owner',
      (subject) => {
        subject.config.unsafeOwner = subject.receipt;
        subject.saveConfig();
      },
    ],
    [
      'missing predecessor',
      (subject) => write(subject.receipt, `${subject.release('d'.repeat(40))}\n`),
    ],
    ['self predecessor', (subject) => write(subject.receipt, `${subject.release(candidate)}\n`)],
    [
      'noncanonical predecessor',
      (subject) => write(subject.receipt, `${subject.release(predecessor)}/../${predecessor}\n`),
    ],
    ['missing current with nonempty predecessor', (subject) => rmSync(subject.currentLink)],
    [
      'regular-file current marker',
      (subject) => {
        rmSync(subject.currentLink);
        write(subject.currentLink, 'invalid');
      },
    ],
    [
      'broken current symlink',
      (subject) => {
        rmSync(subject.currentLink);
        symlinkSync(subject.release('d'.repeat(40)), subject.currentLink);
      },
    ],
    [
      'wrong predecessor release marker',
      (subject) => write(join(subject.release(predecessor), '.release-sha'), `${newer}\n`),
    ],
    [
      'wrong candidate release marker',
      (subject) => write(join(subject.release(candidate), '.release-sha'), `${newer}\n`),
    ],
    [
      'unavailable container listing',
      (subject) => {
        subject.config.listFailure = true;
        subject.saveConfig();
      },
    ],
    [
      'unavailable container inspection',
      (subject) => {
        subject.config.inspectFailure = true;
        subject.saveConfig();
      },
    ],
    [
      'missing container revision',
      (subject) => {
        subject.config.containers[0].revision = '';
        subject.saveConfig();
      },
    ],
    [
      'invalid container ID',
      (subject) => {
        subject.config.containers[0].id = 'not-a-container-id';
        subject.saveConfig();
      },
    ],
    ['unsafe state directory', (subject) => chmodSync(subject.state, 0o755)],
    ['unsafe operation lock', (subject) => chmodSync(join(subject.state, 'helper.lock'), 0o644)],
  ]) {
    for (const command of name === 'missing pending receipt'
      ? ['check-rollback']
      : ['check-rollback', 'rollback']) {
      isolated(`${command} rejects ${name} before service or receipt mutation`, (subject) => {
        change(subject);
        rejectWithoutMutation(subject, command);
      });
    }
  }

  isolated(
    'containers outside the production project do not block a valid transition',
    (subject) => {
      subject.config.containers.push({
        id: 'e'.repeat(64),
        project: 'unrelated-project',
        service: 'gateway',
        revision: newer,
      });
      subject.saveConfig();
      const before = subject.snapshot();
      const result = subject.run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(subject.snapshot(), before);
      assert.equal(subject.calls().filter((call) => call.mutation).length, 0);
    },
  );

  isolated(
    'rollback still rejects a finalized current release without a predecessor',
    (subject) => {
      rmSync(subject.currentLink);
      symlinkSync(subject.release(candidate), subject.currentLink);
      rmSync(subject.receipt);
      rejectWithoutMutation(subject, 'rollback');
    },
  );

  isolated(
    'activate rejects an already-current candidate without creating a receipt',
    (subject) => {
      rmSync(subject.currentLink);
      symlinkSync(subject.release(candidate), subject.currentLink);
      rmSync(subject.receipt);
      rejectWithoutMutation(subject, 'activate');
    },
  );

  isolated(
    'activate preserves an existing pending receipt and rejects a second attempt',
    (subject) => {
      rejectWithoutMutation(subject, 'activate');
    },
  );

  isolated(
    'an active operation lock rejects concurrent rollback without mutation',
    async (subject) => {
      const holder = spawn(
        '/usr/bin/flock',
        [
          '-x',
          join(subject.state, 'helper.lock'),
          '/bin/bash',
          '-c',
          'printf ready; cat >/dev/null',
        ],
        {
          env: { PATH: '/usr/bin:/bin' },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      const closed = new Promise((resolveClose) => holder.once('close', resolveClose));
      try {
        await new Promise((resolveReady, rejectReady) => {
          const timeout = setTimeout(
            () => rejectReady(new Error('fixture lock was not acquired')),
            2_000,
          );
          holder.once('error', (error) => {
            clearTimeout(timeout);
            rejectReady(error);
          });
          holder.stdout.once('data', (data) => {
            clearTimeout(timeout);
            assert.equal(data.toString(), 'ready');
            resolveReady();
          });
        });
        rejectWithoutMutation(subject, 'rollback');
      } finally {
        holder.stdin.end();
        const timeout = setTimeout(() => holder.kill('SIGKILL'), 2_000);
        try {
          await closed;
        } finally {
          clearTimeout(timeout);
        }
      }
    },
  );
}
