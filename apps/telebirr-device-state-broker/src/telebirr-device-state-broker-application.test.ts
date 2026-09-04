import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  TelebirrDeviceStateBrokerApplicationError,
  startTelebirrDeviceStateBrokerApplication,
  type TelebirrDeviceStateBrokerApplicationDependencies,
  type TelebirrDeviceStateLocalServerRuntime,
} from './telebirr-device-state-broker-application.js';
import type { TelebirrDeviceStateBrokerConfig } from './telebirr-device-state-broker-config.js';
import type { TelebirrDeviceStatePostgresRuntime } from './postgres-telebirr-device-state.js';
import type { TelebirrDeviceStateDatabase } from './telebirr-device-state.js';

function config(): Extract<TelebirrDeviceStateBrokerConfig, { enabled: true }> {
  return {
    enabled: true,
    deploymentTarget: 'staging',
    projectReference: 'spzpiyxheappsfyswewl',
    connection: {
      ca: `-----BEGIN CERTIFICATE-----\n${'A'.repeat(64)}\n-----END CERTIFICATE-----\n`,
      database: 'postgres',
      host: 'db.spzpiyxheappsfyswewl.supabase.co',
      password: 'synthetic-password-123456',
      port: 5432,
      user: 'fetanagent_telebirr_device_state_runtime',
    },
  };
}

function database(): TelebirrDeviceStateDatabase {
  return {
    claimPairingChallenge: vi.fn(async () => undefined),
    completePairingChallenge: vi.fn(async () => false),
    releasePairingChallenge: vi.fn(async () => undefined),
    loadEnrollment: vi.fn(async () => undefined),
    claimReplay: vi.fn(async () => ({ kind: 'claimed' as const })),
    completeReplay: vi.fn(async () => false),
    releaseReplay: vi.fn(async () => undefined),
    recordHeartbeat: vi.fn(async () => ({ kind: 'retry' as const })),
    stageEvidenceOnly: vi.fn(async () => ({ kind: 'retry' as const })),
  };
}

interface RuntimeFixture {
  readonly dependencies: TelebirrDeviceStateBrokerApplicationDependencies;
  readonly events: string[];
  readonly postgres: TelebirrDeviceStatePostgresRuntime;
  readonly server: TelebirrDeviceStateLocalServerRuntime;
  readonly state: { listening: boolean };
}

function runtimeFixture(
  options: {
    readonly postgresReady?: readonly boolean[];
    readonly listenFails?: boolean;
    readonly serverCloseFails?: boolean;
    readonly postgresCloseFails?: boolean;
  } = {},
): RuntimeFixture {
  const events: string[] = [];
  const readyValues = [...(options.postgresReady ?? [true, true, true])];
  const state = { listening: false };
  const postgres: TelebirrDeviceStatePostgresRuntime = {
    database: database(),
    ready: vi.fn(async () => {
      events.push('postgres.ready');
      return readyValues.shift() ?? false;
    }),
    close: vi.fn(async () => {
      events.push('postgres.close');
      if (options.postgresCloseFails) throw new Error('private postgres detail');
    }),
  };
  const server: TelebirrDeviceStateLocalServerRuntime = {
    server: state,
    listen: vi.fn(async () => {
      events.push('server.listen');
      if (options.listenFails) throw new Error('private socket detail');
      state.listening = true;
    }),
    close: vi.fn(async () => {
      events.push('server.close');
      state.listening = false;
      if (options.serverCloseFails) throw new Error('private socket close detail');
    }),
  };
  return {
    dependencies: {
      createPostgresRuntime: vi.fn(async () => {
        events.push('postgres.create');
        return postgres;
      }),
      createLocalServer: vi.fn((selectedDatabase) => {
        events.push('server.create');
        if (selectedDatabase !== postgres.database) throw new Error('wrong database');
        return server;
      }),
    },
    events,
    postgres,
    server,
    state,
  };
}

describe('private TeleBirr device-state broker application', () => {
  it('refuses to start from the default disabled configuration', async () => {
    const fixture = runtimeFixture();
    await expect(
      startTelebirrDeviceStateBrokerApplication({ enabled: false }, fixture.dependencies),
    ).rejects.toThrow(TelebirrDeviceStateBrokerApplicationError);
    expect(fixture.events).toEqual([]);
  });

  it('starts PostgreSQL before the local socket and closes in reverse authority order', async () => {
    const fixture = runtimeFixture();
    const application = await startTelebirrDeviceStateBrokerApplication(
      config(),
      fixture.dependencies,
    );
    expect(fixture.events).toEqual([
      'postgres.create',
      'postgres.ready',
      'server.create',
      'server.listen',
      'postgres.ready',
    ]);
    await expect(application.ready()).resolves.toBe(true);
    await Promise.all([application.close(), application.close()]);
    expect(fixture.events.slice(-2)).toEqual(['server.close', 'postgres.close']);
    expect(fixture.server.close).toHaveBeenCalledOnce();
    expect(fixture.postgres.close).toHaveBeenCalledOnce();
    await expect(application.ready()).resolves.toBe(false);
  });

  it('closes PostgreSQL without creating a socket when the catalog preflight is not ready', async () => {
    const fixture = runtimeFixture({ postgresReady: [false] });
    await expect(
      startTelebirrDeviceStateBrokerApplication(config(), fixture.dependencies),
    ).rejects.toThrow(TelebirrDeviceStateBrokerApplicationError);
    expect(fixture.events).toEqual(['postgres.create', 'postgres.ready', 'postgres.close']);
  });

  it('closes both runtimes and hides details when local socket startup fails', async () => {
    const fixture = runtimeFixture({ listenFails: true });
    await expect(
      startTelebirrDeviceStateBrokerApplication(config(), fixture.dependencies),
    ).rejects.toThrow('application is unavailable');
    expect(fixture.events.slice(-2)).toEqual(['server.close', 'postgres.close']);
  });

  it('tears down the listener if the post-listen database readiness check fails', async () => {
    const fixture = runtimeFixture({ postgresReady: [true, false] });
    await expect(
      startTelebirrDeviceStateBrokerApplication(config(), fixture.dependencies),
    ).rejects.toThrow(TelebirrDeviceStateBrokerApplicationError);
    expect(fixture.events.slice(-2)).toEqual(['server.close', 'postgres.close']);
    expect(fixture.state.listening).toBe(false);
  });

  it('reduces runtime readiness exceptions to false', async () => {
    const fixture = runtimeFixture();
    const application = await startTelebirrDeviceStateBrokerApplication(
      config(),
      fixture.dependencies,
    );
    vi.mocked(fixture.postgres.ready).mockRejectedValueOnce(new Error('private database detail'));
    await expect(application.ready()).resolves.toBe(false);
    await application.close();
  });

  it('attempts both closes and returns only a fixed error if either close fails', async () => {
    const fixture = runtimeFixture({ serverCloseFails: true, postgresCloseFails: true });
    const application = await startTelebirrDeviceStateBrokerApplication(
      config(),
      fixture.dependencies,
    );
    await expect(application.close()).rejects.toThrow(TelebirrDeviceStateBrokerApplicationError);
    expect(fixture.server.close).toHaveBeenCalledOnce();
    expect(fixture.postgres.close).toHaveBeenCalledOnce();
  });

  it('keeps the main entrypoint redacted and free of a calendar stop', async () => {
    const source = await readFile(
      new URL('./telebirr-device-state-broker-main.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain("event: 'listening'");
    expect(source).toContain("event: 'startup_failed'");
    expect(source).toContain('detailsRedacted: true');
    expect(source).not.toMatch(/console\.(?:info|error)\([^\n]*(?:error|config)/u);
    expect(source).not.toMatch(/2026-09-04|shutdownAt|stopAt/u);
  });
});
