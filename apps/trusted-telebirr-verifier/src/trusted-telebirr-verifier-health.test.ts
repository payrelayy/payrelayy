import { describe, expect, it, vi } from 'vitest';

import {
  createTelebirrShadowVerifierHealth,
  createTrustedTelebirrVerifierHealth,
} from './trusted-telebirr-verifier-health.js';

describe('trusted TeleBirr verifier health', () => {
  it('reports redacted liveness and database-backed readiness', async () => {
    const probe = vi.fn(async () => true);
    const health = createTrustedTelebirrVerifierHealth(probe);

    expect(health.healthz()).toEqual({
      status: 'ok',
      service: 'fetanagent-trusted-telebirr-verifier',
    });
    await expect(health.readyz()).resolves.toEqual({
      ready: true,
      status: 'ready',
      service: 'fetanagent-trusted-telebirr-verifier',
    });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent probes and converts errors into one fixed unavailable result', async () => {
    let resolveProbe: ((value: boolean) => void) | undefined;
    const probe = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const health = createTrustedTelebirrVerifierHealth(probe);

    const first = health.readyz();
    const second = health.readyz();
    expect(second).toBe(first);
    resolveProbe?.(false);

    await expect(first).resolves.toEqual({
      ready: false,
      status: 'unavailable',
      service: 'fetanagent-trusted-telebirr-verifier',
      reason: 'database_unavailable',
    });
    expect(probe).toHaveBeenCalledTimes(1);

    const failed = createTrustedTelebirrVerifierHealth(async () => {
      throw new Error('sensitive database detail');
    });
    expect(JSON.stringify(await failed.readyz())).not.toContain('sensitive');
  });

  it('becomes permanently unavailable as soon as shutdown begins', async () => {
    const health = createTrustedTelebirrVerifierHealth(async () => true);
    health.markStopping();
    await expect(health.readyz()).resolves.toEqual({
      ready: false,
      status: 'unavailable',
      service: 'fetanagent-trusted-telebirr-verifier',
      reason: 'stopping',
    });
  });

  it('uses a distinct redacted service identity for the no-money shadow process', async () => {
    const health = createTelebirrShadowVerifierHealth(async () => true);
    expect(health.healthz()).toEqual({
      status: 'ok',
      service: 'fetanagent-telebirr-shadow-verifier',
    });
    await expect(health.readyz()).resolves.toEqual({
      ready: true,
      status: 'ready',
      service: 'fetanagent-telebirr-shadow-verifier',
    });
  });
});
