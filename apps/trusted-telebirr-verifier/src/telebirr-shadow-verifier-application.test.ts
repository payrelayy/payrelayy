import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import type { TrustedTelebirrPostgresRuntime } from './postgres-trusted-telebirr-verifier.js';
import {
  createTelebirrShadowVerifierApplication,
  TelebirrShadowVerifierApplicationUnavailableError,
} from './telebirr-shadow-verifier-application.js';
import type { TelebirrShadowVerifierConfig } from './trusted-telebirr-verifier-config.js';
import type { TrustedTelebirrVerifierHealthServer } from './trusted-telebirr-verifier-health-server.js';

const ENABLED_CONFIG: Extract<TelebirrShadowVerifierConfig, { readonly enabled: true }> = {
  enabled: true,
  deploymentTarget: 'staging',
  projectReference: 'spzpiyxheappsfyswewl',
  connection: {
    ca: 'test-ca',
    database: 'postgres',
    host: 'db.spzpiyxheappsfyswewl.supabase.co',
    password: 'test-only',
    port: 5432,
    user: 'fetanagent_telebirr_shadow_verifier_runtime',
  },
  pinnedKeys: { assignmentSigners: [], devices: [] },
};

class SignalSource extends EventEmitter {
  override once(event: 'SIGINT' | 'SIGTERM', listener: () => void): this {
    return super.once(event, listener);
  }

  override removeListener(event: 'SIGINT' | 'SIGTERM', listener: () => void): this {
    return super.removeListener(event, listener);
  }
}

function runtime(events: string[], ready = true): TrustedTelebirrPostgresRuntime {
  return {
    database: { loadAuthority: vi.fn(), complete: vi.fn() },
    workSource: {
      loadNext: vi.fn(async () => null),
      quarantineInvalid: vi.fn(async () => undefined),
    },
    ready: vi.fn(async () => ready),
    close: vi.fn(async () => void events.push('database_closed')),
  };
}

function healthServer(events: string[]): TrustedTelebirrVerifierHealthServer {
  return {
    start: vi.fn(async () => void events.push('health_started')),
    close: vi.fn(async () => void events.push('health_closed')),
    address: () => ({ host: '127.0.0.1', port: 8092 }),
  };
}

describe('TeleBirr shadow verifier application', () => {
  it('is inert unless the dedicated shadow configuration is enabled', async () => {
    const createPostgresRuntime = vi.fn();
    await expect(
      createTelebirrShadowVerifierApplication({
        loadConfiguration: () => ({ enabled: false }),
        createPostgresRuntime,
      }),
    ).rejects.toBeInstanceOf(TelebirrShadowVerifierApplicationUnavailableError);
    expect(createPostgresRuntime).not.toHaveBeenCalled();
  });

  it('pins the shadow verifier to the isolated runtime and closes all resources on stop', async () => {
    const events: string[] = [];
    const signalSource = new SignalSource();
    const postgres = runtime(events);
    const server = healthServer(events);
    const createVerifier = vi.fn(() => ({ verifyAndComplete: vi.fn() }));
    let resolveWorker: (() => void) | undefined;
    const worker = {
      run: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveWorker = resolve;
          }),
      ),
      stop: vi.fn(async () => resolveWorker?.()),
    };
    const application = await createTelebirrShadowVerifierApplication({
      loadConfiguration: () => ENABLED_CONFIG,
      createPostgresRuntime: async () => postgres,
      createVerifier,
      createHealthServer: () => server,
      createWorker: () => worker,
      signalSource,
    });

    const running = application.run();
    await vi.waitFor(() => expect(events).toContain('health_started'));
    expect(createVerifier).toHaveBeenCalledWith(postgres.database, ENABLED_CONFIG.pinnedKeys);
    signalSource.emit('SIGTERM');
    await expect(running).resolves.toBeUndefined();
    expect(events).toEqual(['health_started', 'health_closed', 'database_closed']);
    expect(worker.stop).toHaveBeenCalledTimes(1);
    expect(signalSource.listenerCount('SIGINT')).toBe(0);
    expect(signalSource.listenerCount('SIGTERM')).toBe(0);
  });

  it('closes PostgreSQL and fails closed when initial readiness is unavailable', async () => {
    const events: string[] = [];
    await expect(
      createTelebirrShadowVerifierApplication({
        loadConfiguration: () => ENABLED_CONFIG,
        createPostgresRuntime: async () => runtime(events, false),
        createVerifier: () => ({ verifyAndComplete: vi.fn() }),
        createHealthServer: () => healthServer(events),
      }),
    ).rejects.toBeInstanceOf(TelebirrShadowVerifierApplicationUnavailableError);
    expect(events).toEqual(['database_closed']);
  });
});
