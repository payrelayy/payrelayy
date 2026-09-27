import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';

import { AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE } from '@fetanagent/agent-platform-companion-contracts';
import { COMPANION_EXECUTION_OPERATOR_QUERY_PATH } from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  openProtectedOperatorQueryHost,
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

async function malformedRequest(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: COMPANION_EXECUTION_OPERATOR_QUERY_PATH,
        method: 'POST',
        headers: {
          accept: AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
          'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
          'content-length': 2,
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
    request.end('{}');
  });
}

describe('on-demand protected operator host', () => {
  it('opens only loopback and closes the exact idle session on caller abort', async () => {
    const { input, controller, closeAdministrator, disableDatabase, query } = fixture();
    const host = await openProtectedOperatorQueryHost(input);
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
    const host = await openProtectedOperatorQueryHost(input);
    expect(await malformedRequest(host.port)).toBe(503);
    await host.stopped;
    expect(closeAdministrator).toHaveBeenCalledTimes(1);
    expect(disableDatabase).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    await expect(malformedRequest(host.port)).rejects.toThrow();
  });

  it('retires the listener after the dedicated administrator connection is lost', async () => {
    const { input, closeAdministrator, disableDatabase, events } = fixture();
    const host = await openProtectedOperatorQueryHost(input);
    events.emit('end');
    await host.stopped;
    expect(closeAdministrator).toHaveBeenCalledTimes(1);
    expect(disableDatabase).not.toHaveBeenCalled();
    await expect(malformedRequest(host.port)).rejects.toThrow();
  });

  it('refuses an already-aborted caller before opening a listener', async () => {
    const { input, controller, closeAdministrator } = fixture();
    controller.abort();
    await expect(openProtectedOperatorQueryHost(input)).rejects.toBeInstanceOf(
      ProtectedOperatorQueryHostUnavailableError,
    );
    expect(closeAdministrator).toHaveBeenCalledTimes(1);
  });
});
