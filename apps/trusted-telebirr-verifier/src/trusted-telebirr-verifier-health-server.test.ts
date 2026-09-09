import { describe, expect, it } from 'vitest';

import { createTrustedTelebirrVerifierHealth } from './trusted-telebirr-verifier-health.js';
import { createTrustedTelebirrVerifierHealthServer } from './trusted-telebirr-verifier-health-server.js';

describe('trusted TeleBirr verifier health server', () => {
  it('serves only exact GET health routes on loopback', async () => {
    const server = createTrustedTelebirrVerifierHealthServer(
      createTrustedTelebirrVerifierHealth(async () => true),
      { host: '127.0.0.1', port: 0, allowEphemeralTestPort: true },
    );
    await server.start();
    const port = server.address()!.port;
    try {
      const health = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(health.status).toBe(200);
      expect(health.headers.get('cache-control')).toBe('no-store');
      expect(health.headers.get('x-content-type-options')).toBe('nosniff');
      await expect(health.json()).resolves.toEqual({
        status: 'ok',
        service: 'fetanagent-trusted-telebirr-verifier',
      });

      const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
      expect(ready.status).toBe(200);
      await expect(ready.json()).resolves.toMatchObject({ ready: true, status: 'ready' });

      const post = await fetch(`http://127.0.0.1:${port}/readyz`, { method: 'POST' });
      expect(post.status).toBe(405);
      expect(post.headers.get('allow')).toBe('GET');
      expect((await fetch(`http://127.0.0.1:${port}/readyz?detail=true`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/verify`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('returns one redacted 503 body when the singleton/catalog probe is unavailable', async () => {
    const server = createTrustedTelebirrVerifierHealthServer(
      createTrustedTelebirrVerifierHealth(async () => false),
      { host: '127.0.0.1', port: 0, allowEphemeralTestPort: true },
    );
    await server.start();
    try {
      const response = await fetch(`http://127.0.0.1:${server.address()!.port}/readyz`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ready: false,
        status: 'unavailable',
        service: 'fetanagent-trusted-telebirr-verifier',
        reason: 'database_unavailable',
      });
    } finally {
      await server.close();
    }
  });

  it('rejects public and accidental ephemeral production listeners', () => {
    const health = createTrustedTelebirrVerifierHealth(async () => true);
    expect(() =>
      createTrustedTelebirrVerifierHealthServer(health, {
        host: '0.0.0.0' as '127.0.0.1',
        port: 8091,
      }),
    ).toThrow('must use loopback');
    expect(() =>
      createTrustedTelebirrVerifierHealthServer(health, { host: '127.0.0.1', port: 0 }),
    ).toThrow('must use loopback');
  });
});
