import { request as httpRequest } from 'node:http';

import { AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE } from '@fetanagent/agent-platform-companion-contracts';
import { COMPANION_EXECUTION_HANDOFF_SIGN_PATH } from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it, vi } from 'vitest';

import { createProtectedHandoffLoopbackServer } from './protected-handoff-loopback-server.js';

function post(
  port: number,
  body: string,
  contentLength = true,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
        method: 'POST',
        headers: {
          accept: AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
          'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
          ...(contentLength
            ? { 'content-length': Buffer.byteLength(body) }
            : { 'transfer-encoding': 'chunked' }),
        },
      },
      async (response) => {
        try {
          let received = '';
          for await (const chunk of response) received += String(chunk);
          resolve({ status: response.statusCode ?? 0, body: received });
        } catch (error) {
          reject(error);
        }
      },
    );
    request.once('error', reject);
    request.end(body);
  });
}

describe('protected handoff loopback transport', () => {
  it('accepts an exact bounded request on loopback only and returns no-store content', async () => {
    const handler = vi.fn(async () => ({
      statusCode: 200 as const,
      headers: {
        'cache-control': 'no-store',
        'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
      },
      body: Buffer.from('{"ok":true}'),
    }));
    const server = createProtectedHandoffLoopbackServer(handler, 0);
    const port = await server.listen();
    try {
      const response = await post(port, '{"request":true}');
      expect(response).toEqual({ status: 200, body: '{"ok":true}' });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]?.[0]).toMatchObject({
        method: 'POST',
        path: COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
      });
      expect((await post(port, '{}', false)).status).toBe(503);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });
});
