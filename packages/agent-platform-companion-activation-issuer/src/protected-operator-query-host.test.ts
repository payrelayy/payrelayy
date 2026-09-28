import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';

import { AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE } from '@fetanagent/agent-platform-companion-contracts';
import {
  COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
  COMPANION_EXECUTION_OPERATOR_QUERY_PATH,
  COMPANION_EXECUTION_OPERATOR_STOP_PATH,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  openProtectedOperatorQueryHostWithPort,
  ProtectedOperatorQueryHostUnavailableError,
} from './protected-operator-query-host.js';

const requestKey = '00000000-0000-4000-8000-000000000001';

function fixture() {
  const events = new EventEmitter();
  const query = vi.fn(async () => ({ rows: [] }));
  const administrator = {
    processID: 417,
    query,
    on: events.on.bind(events),
    off: events.off.bind(events),
  };
  const closeAdministrator = vi.fn(async () => undefined);
  const disableDatabase = vi.fn(async () => undefined);
  const controller = new AbortController();
  const input = {
    administrator,
    requestKey,
    closeAdministrator,
    disableDatabase,
    trustedNoMoneySignerKeyId: 'reviewed-no-money-signer',
    trustedNoMoneySignerPublicKeySpkiDer: new Uint8Array([1]),
    trustedNow: () => new Date('2026-09-27T12:00:00.000Z'),
    signal: controller.signal,
  };
  return { input, query, closeAdministrator, disableDatabase, controller, events };
}

async function malformedRequest(
  port: number,
  path = COMPANION_EXECUTION_OPERATOR_QUERY_PATH,
  body = '{}',
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          accept: AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
          'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
          'content-length': Buffer.byteLength(body),
        },
      },
      async (response) => {
        try {
          for await (const _chunk of response) {
            // Drain the fixed generic response without returning its body.
          }
          resolve(response.statusCode ?? 0);
        } catch (error) {
          reject(error);
        }
      },
    );
    request.once('error', reject);
    request.end(body);
  });
}

describe('on-demand protected operator host', () => {
  it('opens only loopback and closes the exact idle session on caller abort', async () => {
    const { input, controller, closeAdministrator, disableDatabase, query } = fixture();
    const host = await openProtectedOperatorQueryHostWithPort(input, 0);
    expect(host.port).toBeGreaterThan(0);
    controller.abort();
    await host.stopped;
    await host.stop();
    expect(closeAdministrator).toHaveBeenCalledTimes(1);
    expect(disableDatabase).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    await expect(malformedRequest(host.port)).rejects.toThrow();
  });

  it('consumes a malformed command fail-closed and retires its listener', async () => {
    const { input, closeAdministrator, disableDatabase, query } = fixture();
    const host = await openProtectedOperatorQueryHostWithPort(input, 0);
    expect(await malformedRequest(host.port)).toBe(503);
    await host.stopped;
    expect(closeAdministrator).toHaveBeenCalledTimes(1);
    expect(disableDatabase).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    await expect(malformedRequest(host.port)).rejects.toThrow();
  });

  it('retires the listener after the dedicated administrator connection is lost', async () => {
    const { input, closeAdministrator, disableDatabase, events } = fixture();
    const host = await openProtectedOperatorQueryHostWithPort(input, 0);
    events.emit('end');
    await host.stopped;
    expect(closeAdministrator).toHaveBeenCalledTimes(1);
    expect(disableDatabase).not.toHaveBeenCalled();
    await expect(malformedRequest(host.port)).rejects.toThrow();
  });

  it('refuses an already-aborted caller before opening a listener', async () => {
    const { input, controller, closeAdministrator } = fixture();
    controller.abort();
    await expect(openProtectedOperatorQueryHostWithPort(input, 0)).rejects.toBeInstanceOf(
      ProtectedOperatorQueryHostUnavailableError,
    );
    expect(closeAdministrator).toHaveBeenCalledTimes(1);
  });

  it('requires its one-use signing operation before opening the query session', async () => {
    const { input, closeAdministrator, disableDatabase, query } = fixture();
    const signHandoff = vi.fn(async () => ({
      statusCode: 200 as const,
      headers: {
        'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
        'cache-control': 'no-store',
      },
      body: Buffer.from('{}'),
    }));
    const host = await openProtectedOperatorQueryHostWithPort({ ...input, signHandoff }, 0);
    expect(await malformedRequest(host.port, COMPANION_EXECUTION_HANDOFF_SIGN_PATH)).toBe(200);
    expect(signHandoff).toHaveBeenCalledTimes(1);
    // The second operation reaches the protected query handler, which rejects
    // malformed input and retires this exact host. Signing cannot be repeated.
    expect(await malformedRequest(host.port)).toBe(503);
    await host.stopped;
    expect(closeAdministrator).toHaveBeenCalledTimes(1);
    expect(disableDatabase).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('retires a host if a query arrives before signing', async () => {
    const { input, closeAdministrator, query } = fixture();
    const signHandoff = vi.fn();
    const host = await openProtectedOperatorQueryHostWithPort({ ...input, signHandoff }, 0);
    expect(await malformedRequest(host.port)).toBe(503);
    await host.stopped;
    expect(signHandoff).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(closeAdministrator).toHaveBeenCalledTimes(1);
  });

  it('refuses a stop command before the paired one-use signing step', async () => {
    const { input, closeAdministrator, disableDatabase } = fixture();
    const signHandoff = vi.fn();
    const host = await openProtectedOperatorQueryHostWithPort({ ...input, signHandoff }, 0);
    expect(
      await malformedRequest(
        host.port,
        COMPANION_EXECUTION_OPERATOR_STOP_PATH,
        JSON.stringify({ requestKey }),
      ),
    ).toBe(503);
    await host.stopped;
    expect(disableDatabase).not.toHaveBeenCalled();
    expect(closeAdministrator).toHaveBeenCalledTimes(1);
  });

  it('retires the listener after a failed signing response', async () => {
    const { input, closeAdministrator, disableDatabase } = fixture();
    const signHandoff = vi.fn(async () => ({
      statusCode: 503 as const,
      headers: { 'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE },
      body: Buffer.from('{}'),
    }));
    const host = await openProtectedOperatorQueryHostWithPort({ ...input, signHandoff }, 0);
    expect(await malformedRequest(host.port, COMPANION_EXECUTION_HANDOFF_SIGN_PATH)).toBe(503);
    await host.stopped;
    expect(signHandoff).toHaveBeenCalledTimes(1);
    expect(closeAdministrator).toHaveBeenCalledTimes(1);
    expect(disableDatabase).not.toHaveBeenCalled();
  });

  it('runs the independent stop once while preserving the outcome-query session', async () => {
    const { input, closeAdministrator, disableDatabase } = fixture();
    const signHandoff = vi.fn(async () => ({
      statusCode: 200 as const,
      headers: {
        'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
        'cache-control': 'no-store',
      },
      body: Buffer.from('{}'),
    }));
    const host = await openProtectedOperatorQueryHostWithPort({ ...input, signHandoff }, 0);
    expect(await malformedRequest(host.port, COMPANION_EXECUTION_HANDOFF_SIGN_PATH)).toBe(200);
    const stopBody = JSON.stringify({ requestKey });
    expect(
      await malformedRequest(host.port, COMPANION_EXECUTION_OPERATOR_STOP_PATH, stopBody),
    ).toBe(200);
    expect(
      await malformedRequest(host.port, COMPANION_EXECUTION_OPERATOR_STOP_PATH, stopBody),
    ).toBe(200);
    expect(disableDatabase).toHaveBeenCalledTimes(1);
    expect(closeAdministrator).not.toHaveBeenCalled();
    await host.stop();
    await host.stopped;
    expect(closeAdministrator).toHaveBeenCalledTimes(1);
  });
});
