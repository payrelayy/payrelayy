import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import type { TrustedTelebirrPostgresRuntime } from './postgres-trusted-telebirr-verifier.js';
import type { TrustedTelebirrVerifierConfig } from './trusted-telebirr-verifier-config.js';
import {
  createTrustedTelebirrVerifierApplication,
  TrustedTelebirrVerifierApplicationUnavailableError,
} from './trusted-telebirr-verifier-application.js';
import type { TrustedTelebirrVerifierHealthServer } from './trusted-telebirr-verifier-health-server.js';

const ENABLED_CONFIG: Extract<TrustedTelebirrVerifierConfig, { readonly enabled: true }> = {
  enabled: true,
  deploymentTarget: 'staging',
  projectReference: 'spzpiyxheappsfyswewl',
  connection: {
    ca: 'test-ca',
    database: 'postgres',
    host: 'db.spzpiyxheappsfyswewl.supabase.co',
    password: 'test-only',
    port: 5432,
    user: 'fetanagent_trusted_telebirr_verifier_runtime',
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

function runtime(
  events: string[],
  options: { readonly ready?: boolean; readonly close?: () => Promise<void> } = {},
): TrustedTelebirrPostgresRuntime {
  return {
    database: {
      loadAuthority: vi.fn(),
      complete: vi.fn(),
    },
    workSource: {
      loadNext: vi.fn(async () => null),
      quarantineInvalid: vi.fn(async () => undefined),
    },
    ready: vi.fn(async () => options.ready ?? true),
    close: vi.fn(
      options.close ??
        (async () => {
          events.push('database_closed');
        }),
    ),
  };
}

function healthServer(events: string[]): TrustedTelebirrVerifierHealthServer {
  return {
    start: vi.fn(async () => {
      events.push('health_started');
    }),
    close: vi.fn(async () => {
      events.push('health_closed');
    }),
    address: () => ({ host: '127.0.0.1', port: 8091 }),
  };
}

describe('trusted TeleBirr verifier application', () => {
  it('refuses a disabled checked-in configuration without opening PostgreSQL', async () => {
    const createPostgresRuntime = vi.fn();
    await expect(
      createTrustedTelebirrVerifierApplication({
        loadConfiguration: () => ({ enabled: false }),
        createPostgresRuntime,
      }),
    ).rejects.toBeInstanceOf(TrustedTelebirrVerifierApplicationUnavailableError);
    expect(createPostgresRuntime).not.toHaveBeenCalled();
  });

  it('composes the singleton database and pinned verifier before health, then shuts down cleanly', async () => {
    const events: string[] = [];
    const signalSource = new SignalSource();
    const postgres = runtime(events);
    const server = healthServer(events);
    const createVerifier = vi.fn(
      (_database: typeof postgres.database, _pinnedKeys: typeof ENABLED_CONFIG.pinnedKeys) => ({
        verifyAndComplete: vi.fn(),
      }),
    );
    const application = await createTrustedTelebirrVerifierApplication({
      loadConfiguration: () => ENABLED_CONFIG,
      createPostgresRuntime: async () => {
        events.push('database_created');
        return postgres;
      },
      createVerifier: (database, pinnedKeys) => {
        events.push('verifier_pinned');
        return createVerifier(database, pinnedKeys);
      },
      createHealthServer: () => server,
      signalSource,
    });

    const running = application.run();
    await vi.waitFor(() => expect(events).toContain('health_started'));
    expect(events.slice(0, 3)).toEqual(['database_created', 'verifier_pinned', 'health_started']);
    expect(createVerifier).toHaveBeenCalledWith(postgres.database, ENABLED_CONFIG.pinnedKeys);

    signalSource.emit('SIGTERM');
    await expect(running).resolves.toBeUndefined();
    expect(events).toEqual([
      'database_created',
      'verifier_pinned',
      'health_started',
      'health_closed',
      'database_closed',
    ]);
    expect(signalSource.listenerCount('SIGINT')).toBe(0);
    expect(signalSource.listenerCount('SIGTERM')).toBe(0);
    await expect(application.stop()).resolves.toBeUndefined();
  });

  it('closes the database and fails closed if initial readiness is unavailable', async () => {
    const events: string[] = [];
    const postgres = runtime(events, { ready: false });
    await expect(
      createTrustedTelebirrVerifierApplication({
        loadConfiguration: () => ENABLED_CONFIG,
        createPostgresRuntime: async () => postgres,
        createVerifier: () => ({ verifyAndComplete: vi.fn() }),
        createHealthServer: () => healthServer(events),
      }),
    ).rejects.toBeInstanceOf(TrustedTelebirrVerifierApplicationUnavailableError);
    expect(events).toEqual(['database_closed']);
  });

  it('handles a stop signal while the loopback listener is still starting', async () => {
    const events: string[] = [];
    const signalSource = new SignalSource();
    let releaseStart: (() => void) | undefined;
    const server: TrustedTelebirrVerifierHealthServer = {
      start: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseStart = resolve;
          }),
      ),
      close: vi.fn(async () => {
        events.push('health_closed');
      }),
      address: () => null,
    };
    const application = await createTrustedTelebirrVerifierApplication({
      loadConfiguration: () => ENABLED_CONFIG,
      createPostgresRuntime: async () => runtime(events),
      createVerifier: () => ({ verifyAndComplete: vi.fn() }),
      createHealthServer: () => server,
      signalSource,
    });

    const running = application.run();
    await vi.waitFor(() => expect(signalSource.listenerCount('SIGTERM')).toBe(1));
    signalSource.emit('SIGTERM');
    releaseStart?.();

    await expect(running).resolves.toBeUndefined();
    expect(events).toEqual(['health_closed', 'database_closed']);
    expect(signalSource.listenerCount('SIGINT')).toBe(0);
    expect(signalSource.listenerCount('SIGTERM')).toBe(0);
  });

  it('bounds shutdown and returns only the fixed unavailable error', async () => {
    const postgres = runtime([], { close: () => new Promise<void>(() => undefined) });
    const application = await createTrustedTelebirrVerifierApplication({
      loadConfiguration: () => ENABLED_CONFIG,
      createPostgresRuntime: async () => postgres,
      createVerifier: () => ({ verifyAndComplete: vi.fn() }),
      createHealthServer: () => healthServer([]),
      shutdownTimeoutMilliseconds: 10,
    });

    await expect(application.stop()).rejects.toEqual(
      new TrustedTelebirrVerifierApplicationUnavailableError(),
    );
  });
});
