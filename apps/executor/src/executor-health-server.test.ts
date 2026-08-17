import { describe, expect, it } from 'vitest';

import { createKemerBetExecutorHealth } from './executor-health.js';
import { createKemerBetExecutorHealthServer } from './executor-health-server.js';

const ACCOUNT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

describe('KemerBet executor private health listener', () => {
  it('serves only GET healthz and readyz on loopback', async () => {
    const health = createKemerBetExecutorHealth({
      platformAgentAccountIds: [ACCOUNT_ID],
      probeDatabase: async () => true,
      probeSessionReadiness: async () => ({ ready: true, reason: 'ready' }),
    });
    const server = createKemerBetExecutorHealthServer(health, {
      host: '127.0.0.1',
      port: 0,
      allowEphemeralTestPort: true,
    });
    await server.start();
    const port = server.address()!.port;
    try {
      const healthResponse = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(healthResponse.status).toBe(200);
      await expect(healthResponse.json()).resolves.toEqual({
        status: 'ok',
        service: 'fetanagent-executor',
      });

      const readyResponse = await fetch(`http://127.0.0.1:${port}/readyz`);
      expect(readyResponse.status).toBe(200);
      await expect(readyResponse.json()).resolves.toMatchObject({ ready: true });

      const postResponse = await fetch(`http://127.0.0.1:${port}/readyz`, { method: 'POST' });
      expect(postResponse.status).toBe(405);
      expect(postResponse.headers.get('allow')).toBe('GET');

      expect((await fetch(`http://127.0.0.1:${port}/action`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/readyz?unsafe=1`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('returns 503 with a redacted body when readiness fails', async () => {
    const health = createKemerBetExecutorHealth({
      platformAgentAccountIds: [ACCOUNT_ID],
      probeDatabase: async () => false,
      probeSessionReadiness: async () => ({ ready: true, reason: 'ready' }),
    });
    const server = createKemerBetExecutorHealthServer(health, {
      host: '127.0.0.1',
      port: 0,
      allowEphemeralTestPort: true,
    });
    await server.start();
    try {
      const response = await fetch(`http://127.0.0.1:${server.address()!.port}/readyz`);
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).toContain('database_unavailable');
      expect(body).not.toContain(ACCOUNT_ID);
    } finally {
      await server.close();
    }
  });

  it('rejects a public or non-frozen listener boundary', () => {
    expect(() =>
      createKemerBetExecutorHealthServer(
        createKemerBetExecutorHealth({
          platformAgentAccountIds: [ACCOUNT_ID],
          probeDatabase: async () => true,
          probeSessionReadiness: async () => ({ ready: true, reason: 'ready' }),
        }),
        { host: '0.0.0.0' as '127.0.0.1', port: 8090 },
      ),
    ).toThrow('private loopback');
  });
});
