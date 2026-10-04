import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import {
  CONTENT_TYPE,
  PREVIEW_PATH,
  TransportPreviewUnavailableError,
  createTransportPreviewServer,
  parsePreviewConnection,
  previewReport,
  previewResponse,
  previewSshArguments,
  previewWithSpawn,
} from './operator-transport-preview.mjs';

const challenge = '0123456789abcdef0123456789abcdef';
const connection = {
  identityFile: 'C:\\operator\\identity',
  knownHostsFile: 'C:\\operator\\known_hosts',
  remoteHostIpv4: '192.0.2.12',
  remoteUser: 'fetanagent-operator',
  remoteSshPort: 22,
  remoteLoopbackPort: 743,
};

test('reads connection only; rejects broadened SSH target or identity', () => {
  assert.deepEqual(parsePreviewConnection(JSON.stringify({ version: 2, connection })), connection);
  for (const changed of [
    { remoteUser: 'root' },
    { remoteLoopbackPort: 744 },
    { remoteHostIpv4: 'host.example' },
    { remoteSshPort: 0 },
    { knownHostsFile: 'C:\\space dir\\known_hosts' },
    { additional: true },
  ]) {
    assert.throws(() =>
      parsePreviewConnection(
        JSON.stringify({ version: 2, connection: { ...connection, ...changed } }),
      ),
    );
  }
});

test('SSH flags, minimal environment, and content type match the shipped transport', () => {
  const shipped = readFileSync(
    new URL(
      '../../packages/agent-platform-companion-activation-issuer/src/protected-operator-query-ssh-client.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const expression = shipped.match(/function sshArguments\([^]*?return (\[[^]*?\]);/u)?.[1];
  assert.ok(expression);
  assert.equal(
    JSON.stringify(previewSshArguments(connection)),
    JSON.stringify(runInNewContext(expression, { connection }, { timeout: 100 })),
  );
  assert.ok(
    shipped.includes("PROGRAMDATA: win32.join(win32.parse(windowsRoot).root, 'ProgramData')"),
  );
  const contracts = readFileSync(
    new URL('../../packages/agent-platform-companion-contracts/src/index.ts', import.meta.url),
    'utf8',
  );
  assert.ok(contracts.includes(`'${CONTENT_TYPE}'`));
});

function post(port, path, value) {
  const body = JSON.stringify(value);
  return new Promise((accept, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          Host: '127.0.0.1',
          'Content-Type': CONTENT_TYPE,
          'Content-Length': Buffer.byteLength(body),
          Connection: 'close',
        },
      },
      (reply) => {
        const parts = [];
        reply.on('data', (part) => parts.push(part));
        reply.on('end', () =>
          accept({
            status: reply.statusCode,
            body: Buffer.concat(parts).toString(),
            headers: reply.headers,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

test('loopback server rejects operator routes and wrong nonce, answers once, then closes', async (t) => {
  const server = createTransportPreviewServer(challenge, { port: 0, lifetimeMs: 5_000 });
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  await once(server, 'listening');
  assert.equal(server.address().address, '127.0.0.1');
  const port = server.address().port;
  for (const path of ['/bootstrap', '/query', '/sign-handoff', '/stop', '/']) {
    assert.equal((await post(port, path, { version: 1, challenge })).status, 404);
  }
  assert.equal(
    (await post(port, PREVIEW_PATH, { version: 1, challenge: 'f'.repeat(32) })).status,
    404,
  );
  const closed = once(server, 'close');
  const reply = await post(port, PREVIEW_PATH, { version: 1, challenge });
  assert.equal(reply.status, 200);
  assert.equal(reply.body, previewResponse(challenge));
  assert.equal(reply.headers['cache-control'], 'no-store');
  await closed;
  assert.equal(server.listening, false);
});

test('server self-closes without a client or any operator action', async () => {
  const server = createTransportPreviewServer(challenge, { port: 0, lifetimeMs: 30 });
  await once(server, 'close');
  assert.equal(server.listening, false);
});

function wireResponse(body = previewResponse(challenge), extra = '') {
  return Buffer.from(
    `HTTP/1.1 200 OK\r\nContent-Type: ${CONTENT_TYPE}\r\n` +
      `Cache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\n${extra}\r\n${body}`,
  );
}

function fakeSpawn(
  { response = wireResponse(), stderr = '', code = 0, hang = false } = {},
  inspect,
) {
  return (file, args, options) => {
    inspect?.(file, args, options);
    const child = new EventEmitter();
    child.pid = 123;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      setImmediate(() => child.emit('close', 1, null));
      return true;
    };
    let bodyWritten = false;
    child.stdin.on('data', () => {
      if (bodyWritten) return;
      bodyWritten = true;
      setImmediate(() => {
        assert.equal(child.stdin.writableEnded, false);
        if (hang) return;
        child.stderr.write(stderr);
        child.stdout.end(response);
        setImmediate(() => child.emit('close', code, null));
      });
    });
    return child;
  };
}

test('one spawn uses native SSH, production flags/environment, and delayed EOF', async () => {
  let count = 0;
  await previewWithSpawn(
    connection,
    'C:\\Windows',
    challenge,
    fakeSpawn({}, (file, args, options) => {
      count += 1;
      assert.equal(file, 'C:\\Windows\\System32\\OpenSSH\\ssh.exe');
      assert.deepEqual(args, previewSshArguments(connection));
      assert.deepEqual(options.env, {
        SystemRoot: 'C:\\Windows',
        WINDIR: 'C:\\Windows',
        PROGRAMDATA: 'C:\\ProgramData',
      });
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
    }),
  );
  assert.equal(count, 1);
});

test('wrong challenge, framing, encoding, oversized output, and timeout stop without retry', async () => {
  for (const fixture of [
    { response: wireResponse(previewResponse('f'.repeat(32))) },
    { response: wireResponse('not json') },
    { response: wireResponse(undefined, 'Transfer-Encoding: chunked\r\n') },
    { response: Buffer.alloc(30_000) },
    { hang: true },
  ]) {
    let count = 0;
    await assert.rejects(
      previewWithSpawn(
        connection,
        'C:\\Windows',
        challenge,
        fakeSpawn(fixture, () => count++),
        20,
      ),
      TransportPreviewUnavailableError,
    );
    assert.equal(count, 1);
  }
});

test('SSH errors produce fixed categories, never raw identifiers or key details', async () => {
  for (const [stderr, category] of [
    ['private-host: Permission denied (publickey).', 'ssh_authentication'],
    ['Host key verification failed: private-host', 'host_key_rejected'],
    ['open failed: administratively prohibited', 'forwarding_refused'],
    ['connect to private-host: Connection timed out', 'connection_timeout'],
    ['unexpected sensitive detail', 'ssh_transport'],
  ]) {
    let error;
    try {
      await previewWithSpawn(
        connection,
        'C:\\Windows',
        challenge,
        fakeSpawn({ stderr, code: 255 }),
      );
    } catch (caught) {
      error = caught;
    }
    const report = previewReport(error);
    assert.equal(report.failureCategory, category);
    assert.equal(report.liveExecutionReadinessProven, false);
    assert.equal(report.requestCreated, false);
    assert.equal(report.moneyMoved, false);
    assert.equal(JSON.stringify(report).includes('private-host'), false);
    assert.equal(JSON.stringify(report).includes('sensitive'), false);
  }
});
