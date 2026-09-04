import type { Server } from 'node:http';

import { createTelebirrDeviceStateLocalUnixServer } from './local-telebirr-device-state-server.js';
import {
  createTelebirrDeviceStatePostgresRuntime,
  type TelebirrDeviceStatePostgresRuntime,
} from './postgres-telebirr-device-state.js';
import type { TelebirrDeviceStateBrokerConfig } from './telebirr-device-state-broker-config.js';
import type { TelebirrDeviceStateDatabase } from './telebirr-device-state.js';

type EnabledConfig = Extract<TelebirrDeviceStateBrokerConfig, { readonly enabled: true }>;

export interface TelebirrDeviceStateLocalServerRuntime {
  readonly server: Pick<Server, 'listening'>;
  readonly listen: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface TelebirrDeviceStateBrokerApplicationDependencies {
  readonly createPostgresRuntime?: (
    connection: EnabledConfig['connection'],
  ) => Promise<TelebirrDeviceStatePostgresRuntime>;
  readonly createLocalServer?: (
    database: TelebirrDeviceStateDatabase,
  ) => TelebirrDeviceStateLocalServerRuntime;
}

export interface TelebirrDeviceStateBrokerApplication {
  readonly ready: () => Promise<boolean>;
  readonly close: () => Promise<void>;
}

export class TelebirrDeviceStateBrokerApplicationError extends Error {
  constructor() {
    super('The private TeleBirr device-state broker application is unavailable.');
    this.name = 'TelebirrDeviceStateBrokerApplicationError';
  }
}

async function closeRuntimes(
  localServer: TelebirrDeviceStateLocalServerRuntime | undefined,
  postgres: TelebirrDeviceStatePostgresRuntime | undefined,
): Promise<void> {
  let failed = false;
  if (localServer !== undefined) {
    try {
      await localServer.close();
    } catch {
      failed = true;
    }
  }
  if (postgres !== undefined) {
    try {
      await postgres.close();
    } catch {
      failed = true;
    }
  }
  if (failed) throw new TelebirrDeviceStateBrokerApplicationError();
}

export async function startTelebirrDeviceStateBrokerApplication(
  config: TelebirrDeviceStateBrokerConfig,
  dependencies: TelebirrDeviceStateBrokerApplicationDependencies = {},
): Promise<TelebirrDeviceStateBrokerApplication> {
  if (!config.enabled) throw new TelebirrDeviceStateBrokerApplicationError();
  const createPostgresRuntime =
    dependencies.createPostgresRuntime ?? createTelebirrDeviceStatePostgresRuntime;
  const createLocalServer =
    dependencies.createLocalServer ?? createTelebirrDeviceStateLocalUnixServer;
  let postgres: TelebirrDeviceStatePostgresRuntime | undefined;
  let localServer: TelebirrDeviceStateLocalServerRuntime | undefined;
  try {
    postgres = await createPostgresRuntime(config.connection);
    if (!(await postgres.ready())) throw new Error();
    localServer = createLocalServer(postgres.database);
    await localServer.listen();
    if (!localServer.server.listening || !(await postgres.ready())) throw new Error();
  } catch {
    await closeRuntimes(localServer, postgres).catch(() => undefined);
    throw new TelebirrDeviceStateBrokerApplicationError();
  }

  const activePostgres = postgres;
  const activeLocalServer = localServer;
  let closePromise: Promise<void> | undefined;
  let closed = false;
  return Object.freeze({
    ready: async () => {
      if (closed || !activeLocalServer.server.listening) return false;
      try {
        return await activePostgres.ready();
      } catch {
        return false;
      }
    },
    close: () => {
      closePromise ??= (async () => {
        closed = true;
        await closeRuntimes(activeLocalServer, activePostgres);
      })();
      return closePromise;
    },
  });
}
