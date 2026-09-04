import { describe, expect, it, vi } from 'vitest';

import { startCompanionDeviceBridgeApplication } from './application.js';
import type { CompanionDeviceBridgeConfig } from './config.js';
import type { CompanionDeviceBridgePostgresRuntime } from './postgres-runtime.js';
import type { CompanionDeviceBridgeServerRuntime } from './application.js';

const enabledConfig: CompanionDeviceBridgeConfig = {
  enabled: true,
  deploymentTarget: 'staging',
  projectReference: 'spzpiyxheappsfyswewl',
  connection: {
    ca: 'synthetic-ca',
    database: 'postgres',
    host: 'db.spzpiyxheappsfyswewl.supabase.co',
    password: 'synthetic-password-123456',
    port: 5432,
    user: 'fetanagent_companion_device_bridge_runtime',
  },
  serverSignerId: '11111111-1111-4111-8111-111111111111',
  signer: {
    keyId: 'companion-server-staging-v1',
    publicKeySpkiDer: Uint8Array.of(1),
    signP1363: async () => 'synthetic-signature',
  },
};

function postgresRuntime(initiallyReady = true) {
  let ready = initiallyReady;
  const close = vi.fn(async () => {
    ready = false;
  });
  const runtime = {
    close,
    database: { query: vi.fn() },
    ready: vi.fn(async () => ready),
    state: {
      claimPairing: vi.fn(),
      completePairing: vi.fn(),
      releasePairing: vi.fn(),
    },
  } as unknown as CompanionDeviceBridgePostgresRuntime;
  return { close, runtime };
}

function serverRuntime(listenFailure = false) {
  let listening = false;
  let ready = false;
  const close = vi.fn(async () => {
    listening = false;
    ready = false;
  });
  const runtime: CompanionDeviceBridgeServerRuntime = {
    server: {
      get listening() {
        return listening;
      },
    },
    listen: vi.fn(async () => {
      if (listenFailure) throw new Error('synthetic listen failure');
      listening = true;
      ready = true;
    }),
    ready: () => ready,
    close,
  };
  return { close, runtime };
}

describe('companion device bridge application lifecycle', () => {
  it('starts only after database preflight and closes both runtimes once', async () => {
    const postgres = postgresRuntime();
    const server = serverRuntime();
    const createPostgresRuntime = vi.fn(async () => postgres.runtime);
    const createServer = vi.fn(() => server.runtime);
    const application = await startCompanionDeviceBridgeApplication(enabledConfig, {
      createPostgresRuntime,
      createServer,
    });
    expect(createPostgresRuntime).toHaveBeenCalledWith(
      enabledConfig.connection,
      enabledConfig.signer.keyId,
    );
    expect(createServer).toHaveBeenCalledTimes(1);
    await expect(application.ready()).resolves.toBe(true);
    await application.close();
    await application.close();
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(postgres.close).toHaveBeenCalledTimes(1);
    await expect(application.ready()).resolves.toBe(false);
  });

  it('rejects disabled startup before constructing any runtime', async () => {
    const createPostgresRuntime = vi.fn();
    const createServer = vi.fn();
    await expect(
      startCompanionDeviceBridgeApplication(
        { enabled: false },
        { createPostgresRuntime, createServer },
      ),
    ).rejects.toThrow('application is unavailable');
    expect(createPostgresRuntime).not.toHaveBeenCalled();
    expect(createServer).not.toHaveBeenCalled();
  });

  it('closes the database runtime when server startup fails', async () => {
    const postgres = postgresRuntime();
    const server = serverRuntime(true);
    await expect(
      startCompanionDeviceBridgeApplication(enabledConfig, {
        createPostgresRuntime: async () => postgres.runtime,
        createServer: () => server.runtime,
      }),
    ).rejects.toThrow('application is unavailable');
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(postgres.close).toHaveBeenCalledTimes(1);
  });
});
