import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';

import { AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE } from '@fetanagent/agent-platform-companion-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ProtectedOperatorDeviceSigner } from './protected-operator-query-http-client.js';
import {
  createProtectedOperatorSshRemoteSessionWithSpawn,
  ProtectedOperatorSshClientUnavailableError,
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

function fakeSsh(responseFor: (sequence: number) => unknown) {
  const requests: string[] = [];
  const spawned = vi.fn((_file: string, _args: readonly string[], _options: SpawnOptions) => {
    const child = new EventEmitter() as ChildProcess;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    Object.assign(child, { pid: 417, stdin, stdout, kill: vi.fn(() => true) });
    const incoming: Buffer[] = [];
    stdin.on('data', (chunk: Buffer) => incoming.push(Buffer.from(chunk)));
    stdin.on('end', () => {
      const raw = Buffer.concat(incoming).toString('utf8');
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
    expect(options.stdio).toEqual(['pipe', 'pipe', 'ignore']);
    expect(Object.keys(options.env ?? {}).sort()).toEqual(['SystemRoot', 'WINDIR']);
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
});
