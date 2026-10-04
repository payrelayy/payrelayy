import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';

import { AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE } from '@fetanagent/agent-platform-companion-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ProtectedOperatorDeviceSigner } from './protected-operator-query-http-client.js';
import {
  createProtectedOperatorSshEmergencyStopWithSpawn,
  createProtectedOperatorSshHandoffSignerWithSpawn,
  createProtectedOperatorSshRemoteSessionWithSpawn,
  ProtectedOperatorSshClientUnavailableError,
  readProtectedOperatorSshBootstrapWithSpawn,
  type ProtectedOperatorSshConnection,
  type ProtectedOperatorSshFiles,
} from './protected-operator-query-ssh-client.js';

const ROOT = 'C:\\Windows';
const connection: ProtectedOperatorSshConnection = {
  identityFile: 'C:\\operator\\id_fetanagent_operator',
  knownHostsFile: 'C:\\operator\\known_hosts',
  remoteHostIpv4: '192.0.2.12',
  remoteUser: 'fetanagent-operator',
  remoteSshPort: 22,
  remoteLoopbackPort: 743,
};
const files: ProtectedOperatorSshFiles = {
  lstat: () => ({ isFile: () => true, isSymbolicLink: () => false }),
  realpath: (path) => path,
};
const device = {
  certificate: { testOnly: true },
  createSignedHttpRequest: () => ({ testOnly: true }),
} as unknown as ProtectedOperatorDeviceSigner;
const requestKey = '00000000-0000-4000-8000-000000000001';
const sessionNonce = 'a'.repeat(43);

function onCompleteRequest(stdin: PassThrough, callback: (raw: string) => void): void {
  const chunks: Buffer[] = [];
  let complete = false;
  stdin.on('data', (chunk: Buffer) => {
    if (complete) return;
    chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks);
    const boundary = raw.indexOf('\r\n\r\n');
    if (boundary < 0) return;
    const length = /^Content-Length: ([0-9]+)$/imu.exec(
      raw.subarray(0, boundary).toString('ascii'),
    );
    if (!length) return;
    if (raw.byteLength !== boundary + 4 + Number(length[1])) return;
    complete = true;
    callback(raw.toString('utf8'));
  });
}

function fakeSsh(responseFor: (sequence: number) => unknown) {
  const requests: string[] = [];
  const spawned = vi.fn((_file: string, _args: readonly string[], _options: SpawnOptions) => {
    const child = new EventEmitter() as ChildProcess;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    Object.assign(child, { pid: 417, stdin, stdout, kill: vi.fn(() => true) });
    onCompleteRequest(stdin, (raw) => {
      requests.push(raw);
      const boundary = raw.indexOf('\r\n\r\n');
      const envelope = JSON.parse(raw.slice(boundary + 4)) as { command: { sequence: number } };
      const body = JSON.stringify(responseFor(envelope.command.sequence));
      stdout.end(
        `HTTP/1.1 200 OK\r\nContent-Type: ${AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE}\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
      );
      setImmediate(() => child.emit('close', 0, null));
    });
    return child;
  });
  return { spawned, requests };
}

describe('authenticated protected operator SSH stream', () => {
  it('fetches one bounded binding through the pinned SSH tunnel without placing it in argv', async () => {
    const requests: string[] = [];
    const spawned = vi.fn((_file: string, args: readonly string[], _options: SpawnOptions) => {
      expect(args.join(' ')).not.toContain(requestKey);
      const child = new EventEmitter() as ChildProcess;
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      Object.assign(child, { pid: 420, stdin, stdout, kill: vi.fn(() => true) });
      onCompleteRequest(stdin, (raw) => {
        requests.push(raw);
        const body = JSON.stringify({
          requestKey,
          actorAuthUserId: '11111111-1111-4111-8111-111111111111',
        });
        stdout.end(
          `HTTP/1.1 200 OK\r\nContent-Type: ${AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE}\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
        );
        setImmediate(() => child.emit('close', 0, null));
      });
      return child;
    });
    const signedDevice = {
      certificate: { bodyDigest: `sha256:${'a'.repeat(64)}` },
      createSignedHttpRequest: () => ({ testOnly: true }),
    } as unknown as ProtectedOperatorDeviceSigner;
    await expect(
      readProtectedOperatorSshBootstrapWithSpawn(signedDevice, connection, ROOT, spawned, files),
    ).resolves.toEqual({
      requestKey,
      actorAuthUserId: '11111111-1111-4111-8111-111111111111',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('POST /v2/companion/operator/activation-session:bootstrap');
    expect(requests[0]).not.toContain(requestKey);
    expect(spawned).toHaveBeenCalledTimes(1);
  });

  it('keeps SSH stdin open until the remote response is complete', async () => {
    let inputClosedBeforeResponse = false;
    let responseStarted = false;
    const spawned = vi.fn((_file: string, _args: readonly string[], _options: SpawnOptions) => {
      const child = new EventEmitter() as ChildProcess;
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      Object.assign(child, { pid: 421, stdin, stdout, kill: vi.fn(() => true) });
      onCompleteRequest(stdin, (raw) => {
        expect(raw).toContain('POST /v2/companion/operator/activation-session:bootstrap');
        setImmediate(() => {
          if (inputClosedBeforeResponse) return;
          responseStarted = true;
          const body = JSON.stringify({
            requestKey,
            actorAuthUserId: '11111111-1111-4111-8111-111111111111',
          });
          stdout.end(
            `HTTP/1.1 200 OK\r\nContent-Type: ${AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE}\r\n` +
              `Cache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
          );
          setImmediate(() => child.emit('close', 0, null));
        });
      });
      stdin.on('end', () => {
        if (responseStarted) return;
        inputClosedBeforeResponse = true;
        setImmediate(() => child.emit('close', 0, null));
      });
      return child;
    });
    const signedDevice = {
      certificate: { bodyDigest: `sha256:${'a'.repeat(64)}` },
      createSignedHttpRequest: () => ({ testOnly: true }),
    } as unknown as ProtectedOperatorDeviceSigner;
    await expect(
      readProtectedOperatorSshBootstrapWithSpawn(signedDevice, connection, ROOT, spawned, files),
    ).resolves.toMatchObject({ requestKey });
    expect(inputClosedBeforeResponse).toBe(false);
    expect(responseStarted).toBe(true);
  });

  it('classifies bootstrap failure without exposing transport or response details', async () => {
    const signedDevice = {
      certificate: { bodyDigest: `sha256:${'a'.repeat(64)}` },
      createSignedHttpRequest: () => ({ testOnly: true }),
    } as unknown as ProtectedOperatorDeviceSigner;
    const spawnFor = (kind: 'transport' | 'response' | 'binding') =>
      vi.fn((_file: string, _args: readonly string[], _options: SpawnOptions) => {
        const child = new EventEmitter() as ChildProcess;
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        Object.assign(child, { pid: 420, stdin, stdout, kill: vi.fn(() => true) });
        onCompleteRequest(stdin, () => {
          if (kind === 'transport') {
            setImmediate(() => child.emit('close', 255, null));
            return;
          }
          const body = JSON.stringify({ unexpected: 'private response detail' });
          stdout.end(
            `HTTP/1.1 ${kind === 'response' ? '403 Forbidden' : '200 OK'}\r\n` +
              `Content-Type: ${AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE}\r\n` +
              'Cache-Control: no-store\r\n' +
              `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
          );
          setImmediate(() => child.emit('close', 0, null));
        });
        return child;
      });
    for (const [kind, bootstrapStage] of [
      ['transport', 'ssh_transport'],
      ['response', 'http_response'],
      ['binding', 'bootstrap_binding'],
    ] as const) {
      const spawned = spawnFor(kind);
      await expect(
        readProtectedOperatorSshBootstrapWithSpawn(signedDevice, connection, ROOT, spawned, files),
      ).rejects.toMatchObject({ bootstrapStage });
      expect(spawned).toHaveBeenCalledTimes(1);
    }
    const spawned = spawnFor('transport');
    await expect(
      readProtectedOperatorSshBootstrapWithSpawn(
        signedDevice,
        { ...connection, remoteLoopbackPort: 744 },
        ROOT,
        spawned,
        files,
      ),
    ).rejects.toMatchObject({ bootstrapStage: 'local_preflight' });
    expect(spawned).not.toHaveBeenCalled();
  });
  it('uses a pinned identity and host key with stdio forwarding, never a local listener or shell', async () => {
    const { spawned, requests } = fakeSsh((sequence) =>
      sequence === 0 ? { sequence: 0, backendPid: 417, sessionNonce } : { sequence, closed: true },
    );
    const remote = await createProtectedOperatorSshRemoteSessionWithSpawn(
      device,
      requestKey,
      connection,
      ROOT,
      spawned,
      files,
    );
    expect(remote.backendPid).toBe(417);
    await remote.close();
    expect(spawned).toHaveBeenCalledTimes(2);
    const [file, args, options] = spawned.mock.calls[0]!;
    expect(file).toBe('C:\\Windows\\System32\\OpenSSH\\ssh.exe');
    expect(args).toContain('none');
    expect(args).toContain('StrictHostKeyChecking=yes');
    expect(args).toContain('IdentityAgent=none');
    expect(args).toContain('127.0.0.1:743');
    expect(args).toContain('fetanagent-operator@192.0.2.12');
    expect(args).not.toContain('-L');
    expect(options.shell).toBe(false);
    expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    expect(options.env).toEqual({
      SystemRoot: ROOT,
      WINDIR: ROOT,
      PROGRAMDATA: 'C:\\ProgramData',
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toContain('Connection: close\r\n');
  });

  it('refuses an administrator account or missing pinned file before spawning', async () => {
    const { spawned } = fakeSsh(() => undefined);
    await expect(
      createProtectedOperatorSshRemoteSessionWithSpawn(
        device,
        requestKey,
        { ...connection, remoteUser: 'fetanagent-admin' },
        ROOT,
        spawned,
        files,
      ),
    ).rejects.toBeInstanceOf(ProtectedOperatorSshClientUnavailableError);
    await expect(
      createProtectedOperatorSshRemoteSessionWithSpawn(
        device,
        requestKey,
        connection,
        ROOT,
        spawned,
        { ...files, lstat: () => ({ isFile: () => false, isSymbolicLink: () => false }) },
      ),
    ).rejects.toBeInstanceOf(ProtectedOperatorSshClientUnavailableError);
    await expect(
      createProtectedOperatorSshRemoteSessionWithSpawn(
        device,
        requestKey,
        { ...connection, remoteLoopbackPort: 744 },
        ROOT,
        spawned,
        files,
      ),
    ).rejects.toBeInstanceOf(ProtectedOperatorSshClientUnavailableError);
    expect(spawned).not.toHaveBeenCalled();
  });

  it('rejects an unframed or otherwise unexpected remote response', async () => {
    const { spawned } = fakeSsh(() => ({ unexpected: true }));
    await expect(
      createProtectedOperatorSshRemoteSessionWithSpawn(
        device,
        requestKey,
        connection,
        ROOT,
        spawned,
        files,
      ),
    ).rejects.toBeInstanceOf(ProtectedOperatorSshClientUnavailableError);
    expect(spawned).toHaveBeenCalledTimes(1);
  });

  it('sends one proof-bound handoff signing request through the same pinned SSH endpoint', async () => {
    const requests: string[] = [];
    const spawned = vi.fn((_file: string, _args: readonly string[], _options: SpawnOptions) => {
      const child = new EventEmitter() as ChildProcess;
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      Object.assign(child, { pid: 418, stdin, stdout, kill: vi.fn(() => true) });
      onCompleteRequest(stdin, (raw) => {
        requests.push(raw);
        const body = JSON.stringify({
          body: { requestKey },
          signature: 'test',
          signerKeyId: 'test',
        });
        stdout.end(
          `HTTP/1.1 200 OK\r\nContent-Type: ${AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE}\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
        );
        setImmediate(() => child.emit('close', 0, null));
      });
      return child;
    });
    const signedDevice = {
      certificate: { bodyDigest: `sha256:${'a'.repeat(64)}` },
      createSignedHttpRequest: () => ({ testOnly: true }),
    } as unknown as ProtectedOperatorDeviceSigner;
    const signHandoff = createProtectedOperatorSshHandoffSignerWithSpawn(
      signedDevice,
      connection,
      ROOT,
      spawned,
      files,
    );
    await expect(signHandoff(requestKey)).resolves.toMatchObject({ body: { requestKey } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('POST /');
    expect(requests[0]).toContain('handoff');
    await expect(signHandoff(requestKey)).rejects.toBeInstanceOf(
      ProtectedOperatorSshClientUnavailableError,
    );
    expect(spawned).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['transport', 'ssh_transport'],
    ['response', 'http_response'],
    ['binding', 'handoff_binding'],
  ] as const)(
    'classifies a %s handoff failure without retaining response data or retrying',
    async (kind, handoffStage) => {
      const signedDevice = {
        certificate: { bodyDigest: `sha256:${'a'.repeat(64)}` },
        createSignedHttpRequest: () => ({ testOnly: true }),
      } as unknown as ProtectedOperatorDeviceSigner;
      const spawned = vi.fn((_file: string, _args: readonly string[], _options: SpawnOptions) => {
        const child = new EventEmitter() as ChildProcess;
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        Object.assign(child, { pid: 420, stdin, stdout, kill: vi.fn(() => true) });
        onCompleteRequest(stdin, () => {
          if (kind === 'transport') {
            setImmediate(() => child.emit('close', 255, null));
            return;
          }
          const body = JSON.stringify({ unexpected: 'private signed response' });
          stdout.end(
            `HTTP/1.1 ${kind === 'response' ? '403 Forbidden' : '200 OK'}\r\n` +
              `Content-Type: ${AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE}\r\n` +
              'Cache-Control: no-store\r\n' +
              `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
          );
          setImmediate(() => child.emit('close', 0, null));
        });
        return child;
      });
      const signer = createProtectedOperatorSshHandoffSignerWithSpawn(
        signedDevice,
        connection,
        ROOT,
        spawned,
        files,
      );
      const error = await signer(requestKey).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(ProtectedOperatorSshClientUnavailableError);
      expect(error).toMatchObject({ handoffStage });
      expect(JSON.stringify(error)).not.toContain('private');
      await expect(signer(requestKey)).rejects.toMatchObject({ handoffStage: 'local_preflight' });
      expect(spawned).toHaveBeenCalledTimes(1);
    },
  );

  it('reports a handoff local preflight failure before starting SSH', async () => {
    const { spawned } = fakeSsh(() => undefined);
    const signer = createProtectedOperatorSshHandoffSignerWithSpawn(
      device,
      { ...connection, remoteLoopbackPort: 744 },
      ROOT,
      spawned,
      files,
    );
    await expect(signer(requestKey)).rejects.toMatchObject({ handoffStage: 'local_preflight' });
    expect(spawned).not.toHaveBeenCalled();
  });

  it.each([
    ['Connection timed out', 'connect_timeout'],
    ['Permission denied (publickey)', 'authentication'],
    ['Host key verification failed', 'host_key'],
    ['channel 0: open failed: connect failed: Connection refused', 'channel_unavailable'],
  ] as const)(
    'keeps only the fixed category for %s, with no second SSH attempt',
    async (text, category) => {
      const spawned = vi.fn(() => {
        const child = new EventEmitter() as ChildProcess;
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        Object.assign(child, { pid: 421, stdin, stdout, stderr, kill: vi.fn(() => true) });
        onCompleteRequest(stdin, () => {
          stderr.write('private-key-path and host-detail: ');
          // Real SSH can split a diagnostic across arbitrary stream chunks.
          stderr.write(text.slice(0, 5));
          stderr.write(text.slice(5));
          setImmediate(() => child.emit('close', 255, null));
        });
        return child;
      });
      const signedDevice = {
        certificate: { bodyDigest: `sha256:${'a'.repeat(64)}` },
        createSignedHttpRequest: () => ({ testOnly: true }),
      } as unknown as ProtectedOperatorDeviceSigner;
      const signer = createProtectedOperatorSshHandoffSignerWithSpawn(
        signedDevice,
        connection,
        ROOT,
        spawned,
        files,
      );
      const error = await signer(requestKey).catch((value: unknown) => value);
      expect(error).toMatchObject({ handoffStage: 'ssh_transport', transportFailure: category });
      expect(JSON.stringify(error)).not.toContain('private-key-path');
      expect(JSON.stringify(error)).not.toContain('host-detail');
      expect(JSON.stringify(error)).not.toContain(text);
      await expect(signer(requestKey)).rejects.toMatchObject({ handoffStage: 'local_preflight' });
      expect(spawned).toHaveBeenCalledTimes(1);
    },
  );

  it('classifies the unchanged handoff response deadline without retaining output or retrying', async () => {
    vi.useFakeTimers();
    const spawned = vi.fn(() => {
      const child = new EventEmitter() as ChildProcess;
      Object.assign(child, {
        pid: 422,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => {
          child.emit('close', null, 'SIGTERM');
          return true;
        }),
      });
      return child;
    });
    const signedDevice = {
      certificate: { bodyDigest: `sha256:${'a'.repeat(64)}` },
      createSignedHttpRequest: () => ({ testOnly: true }),
    } as unknown as ProtectedOperatorDeviceSigner;
    try {
      const signer = createProtectedOperatorSshHandoffSignerWithSpawn(
        signedDevice,
        connection,
        ROOT,
        spawned,
        files,
      );
      const pending = signer(requestKey).catch((value: unknown) => value);
      await vi.advanceTimersByTimeAsync(40_000);
      expect(await pending).toMatchObject({
        handoffStage: 'ssh_transport',
        transportFailure: 'response_timeout',
      });
      expect(spawned).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifies a failed SSH spawn without leaking its original OS error', async () => {
    const spawned = vi.fn(() => {
      const child = new EventEmitter() as ChildProcess;
      Object.assign(child, {
        pid: 423,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => {
          child.emit('close', -1, null);
          return true;
        }),
      });
      setImmediate(() => child.emit('error', new Error('private executable path')));
      return child;
    });
    const signedDevice = {
      certificate: { bodyDigest: `sha256:${'a'.repeat(64)}` },
      createSignedHttpRequest: () => ({ testOnly: true }),
    } as unknown as ProtectedOperatorDeviceSigner;
    const signer = createProtectedOperatorSshHandoffSignerWithSpawn(
      signedDevice,
      connection,
      ROOT,
      spawned,
      files,
    );
    const error = await signer(requestKey).catch((value: unknown) => value);
    expect(error).toMatchObject({
      handoffStage: 'ssh_transport',
      transportFailure: 'process_start',
    });
    expect(JSON.stringify(error)).not.toContain('private');
    expect(spawned).toHaveBeenCalledTimes(1);
  });

  it('sends one stop-only command without exposing a database credential or local listener', async () => {
    const requests: string[] = [];
    const spawned = vi.fn((_file: string, _args: readonly string[], _options: SpawnOptions) => {
      const child = new EventEmitter() as ChildProcess;
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      Object.assign(child, { pid: 419, stdin, stdout, kill: vi.fn(() => true) });
      onCompleteRequest(stdin, (raw) => {
        requests.push(raw);
        const body = '{"stopped":true}';
        stdout.end(
          `HTTP/1.1 200 OK\r\nContent-Type: ${AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE}\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
        );
        setImmediate(() => child.emit('close', 0, null));
      });
      return child;
    });
    const stop = createProtectedOperatorSshEmergencyStopWithSpawn(connection, ROOT, spawned, files);
    await expect(stop(requestKey)).resolves.toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('POST /v2/companion/operator/activation-session:stop');
    expect(requests[0]).toContain(JSON.stringify({ requestKey }));
    await expect(stop(requestKey)).resolves.toBeUndefined();
    await expect(stop('11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(
      ProtectedOperatorSshClientUnavailableError,
    );
    expect(spawned).toHaveBeenCalledTimes(1);
  });
});
