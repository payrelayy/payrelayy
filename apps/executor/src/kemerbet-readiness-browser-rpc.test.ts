import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import {
  createKemerBetReadinessBrowserRpcClient,
  KEMERBET_READINESS_BROWSER_RPC_CONTRACT,
  KemerBetReadinessBrowserRpcUnavailableError,
  loadKemerBetReadinessBrowserRpcCapability,
  startKemerBetReadinessBrowserRpcServer,
  type KemerBetReadinessBrowserDriverSession,
} from './kemerbet-readiness-browser-rpc.js';

const PLAYER_IDS = ['PLAYER-1', 'PLAYER-2', 'PLAYER-3', 'PLAYER-4', 'PLAYER-5'] as const;
const RAW_IDENTITY = 'agent@example.invalid';
const authorization = (sequence: number): string =>
  `v1.${'1'.repeat(32)}.${sequence}.${String(sequence).repeat(64)}`;

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('unavailable');
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  return address.port;
}

async function harness(options: { readonly agentIdentity?: string } = {}) {
  const capability = Buffer.alloc(32, 0x5a);
  const port = await reservePort();
  const lookups: Array<{ readonly authorization: string; readonly playerId: string }> = [];
  const finalize = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  const session: KemerBetReadinessBrowserDriverSession = {
    agentIdentity: options.agentIdentity ?? RAW_IDENTITY,
    lookup: async (playerId, layer7Authorization) => {
      lookups.push({ authorization: layer7Authorization, playerId });
    },
    finalize,
    close,
  };
  const openSession = vi.fn(async () => session);
  const server = await startKemerBetReadinessBrowserRpcServer({
    capability,
    expectedHost: `127.0.0.1:${port}`,
    host: '127.0.0.1',
    openSession,
    port,
  });
  const client = createKemerBetReadinessBrowserRpcClient({
    capability,
    origin: server.origin,
  });
  return { capability, client, close, finalize, lookups, openSession, server };
}

describe('KemerBet readiness browser RPC', () => {
  it('uses only the fixed control IPv4 authority in production', () => {
    expect(KEMERBET_READINESS_BROWSER_RPC_CONTRACT.origin).toBe('http://172.31.254.3:4587');
    expect(KEMERBET_READINESS_BROWSER_RPC_CONTRACT.bindIpv4).toBe('172.31.254.3');
  });

  it('loads only a caller-owned immutable 0400 capability copy', async () => {
    const serialized = `${'5a'.repeat(32)}\n`;
    const stat = {
      dev: 1,
      gid: 10002,
      ino: 2,
      mode: 0o100400,
      nlink: 1,
      size: Buffer.byteLength(serialized),
      uid: 10002,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    const close = vi.fn(async () => undefined);
    const capability = await loadKemerBetReadinessBrowserRpcCapability({
      effectiveUserId: 10002,
      fileSystem: {
        lstat: async () => stat,
        open: async () =>
          ({
            close,
            readFile: async () => serialized,
            stat: async () => stat,
          }) as never,
        realpath: async (path) => path,
      },
    });
    expect(capability.equals(Buffer.alloc(32, 0x5a))).toBe(true);
    expect(close).toHaveBeenCalledOnce();

    await expect(
      loadKemerBetReadinessBrowserRpcCapability({
        effectiveUserId: 10001,
        fileSystem: {
          lstat: async () => stat,
          open: async () =>
            ({
              close: async () => undefined,
              readFile: async () => serialized,
              stat: async () => stat,
            }) as never,
          realpath: async (path) => path,
        },
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessBrowserRpcUnavailableError);
  });

  it('permits only open, five sequential one-ID lookups, finalize, and close', async () => {
    const test = await harness();
    try {
      await expect(test.client.open()).resolves.toBe(RAW_IDENTITY);
      for (const [index, playerId] of PLAYER_IDS.entries()) {
        await test.client.lookup(playerId, authorization(index + 1));
      }
      await expect(test.client.finalize()).resolves.toBeUndefined();
      await expect(test.client.close()).resolves.toBeUndefined();
      await expect(test.server.completed).resolves.toBe('succeeded');
      expect(test.lookups).toEqual(
        PLAYER_IDS.map((playerId, index) => ({
          authorization: authorization(index + 1),
          playerId,
        })),
      );
      expect(test.openSession).toHaveBeenCalledTimes(1);
      expect(test.finalize).toHaveBeenCalledTimes(1);
      expect(test.close).toHaveBeenCalledTimes(1);
    } finally {
      await test.server.close();
    }
  });

  it('fails closed on an out-of-order finalize and closes the opened driver resource', async () => {
    const test = await harness();
    try {
      await test.client.open();
      await expect(test.client.finalize()).rejects.toBeInstanceOf(
        KemerBetReadinessBrowserRpcUnavailableError,
      );
      expect(test.finalize).not.toHaveBeenCalled();
      await test.client.close();
      expect(test.close).toHaveBeenCalledTimes(1);
    } finally {
      await test.server.close();
    }
  });

  it('closes a newly opened session when post-open raw identity validation fails', async () => {
    const test = await harness({ agentIdentity: 'unsafe\nidentity' });
    try {
      await expect(test.client.open()).rejects.toBeInstanceOf(
        KemerBetReadinessBrowserRpcUnavailableError,
      );
      expect(test.openSession).toHaveBeenCalledTimes(1);
      expect(test.close).toHaveBeenCalledTimes(1);
    } finally {
      await test.server.close();
    }
  });

  it('uses a generic error for a wrong capability and never returns identity data', async () => {
    const test = await harness();
    try {
      const body = '{"version":"1"}';
      const response = await fetch(
        `${test.server.origin}${KEMERBET_READINESS_BROWSER_RPC_CONTRACT.openPath}`,
        {
          body,
          headers: {
            'content-length': String(Buffer.byteLength(body)),
            'content-type': KEMERBET_READINESS_BROWSER_RPC_CONTRACT.contentType,
            'x-fetanagent-readiness-capability': Buffer.alloc(32, 0x6b).toString('hex'),
          },
          method: 'POST',
        },
      );
      const serialized = await response.text();
      expect(response.status).toBe(400);
      expect(serialized).toBe('{"ok":false}');
      expect(serialized).not.toContain(RAW_IDENTITY);
      expect(test.openSession).not.toHaveBeenCalled();
    } finally {
      await test.server.close();
    }
  });

  it('rejects a sixth lookup locally and never expands the five-call driver loop', async () => {
    const test = await harness();
    try {
      await test.client.open();
      for (const [index, playerId] of PLAYER_IDS.entries()) {
        await test.client.lookup(playerId, authorization(index + 1));
      }
      await expect(test.client.lookup('PLAYER-6', authorization(5))).rejects.toBeInstanceOf(
        KemerBetReadinessBrowserRpcUnavailableError,
      );
      expect(test.lookups.map(({ playerId }) => playerId)).toEqual(PLAYER_IDS);
      await test.client.finalize();
      await test.client.close();
    } finally {
      await test.server.close();
    }
  });

  it('closes a late OPEN result after the requesting peer disconnects', async () => {
    const capability = Buffer.alloc(32, 0x4a);
    const port = await reservePort();
    let resolveOpen!: (session: KemerBetReadinessBrowserDriverSession) => void;
    const close = vi.fn(async () => undefined);
    const session: KemerBetReadinessBrowserDriverSession = {
      agentIdentity: RAW_IDENTITY,
      close,
      finalize: async () => undefined,
      lookup: async () => undefined,
    };
    const openSession = vi.fn(
      async () =>
        new Promise<KemerBetReadinessBrowserDriverSession>((resolvePromise) => {
          resolveOpen = resolvePromise;
        }),
    );
    const server = await startKemerBetReadinessBrowserRpcServer({
      capability,
      expectedHost: `127.0.0.1:${port}`,
      host: '127.0.0.1',
      openSession,
      port,
    });
    try {
      const body = '{"version":"1"}';
      const request = httpRequest(
        `${server.origin}${KEMERBET_READINESS_BROWSER_RPC_CONTRACT.openPath}`,
        {
          headers: {
            'content-length': String(Buffer.byteLength(body)),
            'content-type': KEMERBET_READINESS_BROWSER_RPC_CONTRACT.contentType,
            'x-fetanagent-readiness-capability': capability.toString('hex'),
          },
          method: 'POST',
        },
      );
      request.on('error', () => undefined);
      request.end(body);
      await vi.waitFor(() => expect(openSession).toHaveBeenCalledOnce());
      request.destroy();
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 50));
      resolveOpen(session);

      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
      await expect(server.completed).resolves.toBe('failed');
    } finally {
      await server.close();
    }
  });

  it('cannot resurrect a late OPEN resource after a concurrent request aborts the state machine', async () => {
    const capability = Buffer.alloc(32, 0x4b);
    const port = await reservePort();
    let resolveOpen!: (session: KemerBetReadinessBrowserDriverSession) => void;
    const close = vi.fn(async () => undefined);
    const session: KemerBetReadinessBrowserDriverSession = {
      agentIdentity: RAW_IDENTITY,
      close,
      finalize: async () => undefined,
      lookup: async () => undefined,
    };
    const openSession = vi.fn(
      async () =>
        new Promise<KemerBetReadinessBrowserDriverSession>((resolvePromise) => {
          resolveOpen = resolvePromise;
        }),
    );
    const server = await startKemerBetReadinessBrowserRpcServer({
      capability,
      expectedHost: `127.0.0.1:${port}`,
      host: '127.0.0.1',
      openSession,
      port,
    });
    try {
      const body = '{"version":"1"}';
      const first = httpRequest(
        `${server.origin}${KEMERBET_READINESS_BROWSER_RPC_CONTRACT.openPath}`,
        {
          headers: {
            'content-length': String(Buffer.byteLength(body)),
            'content-type': KEMERBET_READINESS_BROWSER_RPC_CONTRACT.contentType,
            'x-fetanagent-readiness-capability': capability.toString('hex'),
          },
          method: 'POST',
        },
        (response) => response.resume(),
      );
      first.on('error', () => undefined);
      first.end(body);
      await vi.waitFor(() => expect(openSession).toHaveBeenCalledOnce());

      const second = await fetch(
        `${server.origin}${KEMERBET_READINESS_BROWSER_RPC_CONTRACT.openPath}`,
        {
          body,
          headers: {
            'content-length': String(Buffer.byteLength(body)),
            'content-type': KEMERBET_READINESS_BROWSER_RPC_CONTRACT.contentType,
            'x-fetanagent-readiness-capability': capability.toString('hex'),
          },
          method: 'POST',
        },
      );
      expect(second.status).toBe(400);
      resolveOpen(session);

      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
      await expect(server.completed).resolves.toBe('failed');
    } finally {
      await server.close();
    }
  });
});
