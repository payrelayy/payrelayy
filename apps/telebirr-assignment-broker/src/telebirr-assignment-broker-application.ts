import type { Server } from 'node:http';

import {
  createTelebirrAssignmentBrokerLocalUnixServer,
  type TelebirrAssignmentBrokerPoll,
} from './local-telebirr-assignment-broker-server.js';
import {
  createTelebirrAssignmentBrokerPostgresRuntime,
  type TelebirrAssignmentBrokerPostgresRuntime,
} from './postgres-telebirr-assignment-broker.js';
import type { TelebirrAssignmentBrokerConfig } from './telebirr-assignment-broker-config.js';
import { createTelebirrAssignmentBroker } from './telebirr-assignment-broker.js';

type EnabledConfig = Extract<TelebirrAssignmentBrokerConfig, { readonly enabled: true }>;

export interface TelebirrAssignmentBrokerLocalServerRuntime {
  readonly server: Pick<Server, 'listening'>;
  readonly listen: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface TelebirrAssignmentBrokerApplicationDependencies {
  readonly createPostgresRuntime?: (
    connection: EnabledConfig['connection'],
  ) => Promise<TelebirrAssignmentBrokerPostgresRuntime>;
  readonly createLocalServer?: (
    poll: TelebirrAssignmentBrokerPoll,
  ) => TelebirrAssignmentBrokerLocalServerRuntime;
}

export interface TelebirrAssignmentBrokerApplication {
  readonly ready: () => Promise<boolean>;
  readonly close: () => Promise<void>;
}

export class TelebirrAssignmentBrokerApplicationError extends Error {
  constructor() {
    super('The private TeleBirr assignment broker application is unavailable.');
    this.name = 'TelebirrAssignmentBrokerApplicationError';
  }
}

async function closeRuntimes(
  localServer: TelebirrAssignmentBrokerLocalServerRuntime | undefined,
  postgres: TelebirrAssignmentBrokerPostgresRuntime | undefined,
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
  if (failed) throw new TelebirrAssignmentBrokerApplicationError();
}

export async function startTelebirrAssignmentBrokerApplication(
  config: TelebirrAssignmentBrokerConfig,
  dependencies: TelebirrAssignmentBrokerApplicationDependencies = {},
): Promise<TelebirrAssignmentBrokerApplication> {
  if (!config.enabled) throw new TelebirrAssignmentBrokerApplicationError();
  const createPostgresRuntime =
    dependencies.createPostgresRuntime ?? createTelebirrAssignmentBrokerPostgresRuntime;
  const createLocalServer =
    dependencies.createLocalServer ?? createTelebirrAssignmentBrokerLocalUnixServer;
  let postgres: TelebirrAssignmentBrokerPostgresRuntime | undefined;
  let localServer: TelebirrAssignmentBrokerLocalServerRuntime | undefined;
  try {
    postgres = await createPostgresRuntime(config.connection);
    if (!(await postgres.ready())) throw new Error();
    const poll = createTelebirrAssignmentBroker({
      database: postgres.database,
      openingKey: config.openingKey,
      receiverManifest: config.receiverManifest,
      signer: config.signer,
    });
    localServer = createLocalServer(poll);
    await localServer.listen();
    if (!localServer.server.listening || !(await postgres.ready())) throw new Error();
  } catch {
    await closeRuntimes(localServer, postgres).catch(() => undefined);
    throw new TelebirrAssignmentBrokerApplicationError();
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
