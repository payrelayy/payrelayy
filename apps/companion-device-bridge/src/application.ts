import type { Server } from 'node:http';

import type { CompanionDeviceBridgeConfig } from './config.js';
import { createCompanionPairingHandler } from './pairing-handler.js';
import {
  createCompanionDeviceBridgePostgresRuntime,
  type CompanionDeviceBridgePostgresRuntime,
} from './postgres-runtime.js';
import {
  COMPANION_DEVICE_BRIDGE_LISTEN_HOST,
  COMPANION_DEVICE_BRIDGE_LISTEN_PORT,
  createCompanionDeviceBridgeHttpServer,
  type CompanionDeviceBridgeHandler,
} from './server.js';

type EnabledConfig = Extract<CompanionDeviceBridgeConfig, { readonly enabled: true }>;

export interface CompanionDeviceBridgeServerRuntime {
  readonly server: Pick<Server, 'listening'>;
  listen(): Promise<void>;
  ready(): boolean;
  close(): Promise<void>;
}

export interface CompanionDeviceBridgeApplicationDependencies {
  readonly createPostgresRuntime?: (
    config: EnabledConfig['connection'],
    signerKeyId: string,
  ) => Promise<CompanionDeviceBridgePostgresRuntime>;
  readonly createServer?: (
    handler: CompanionDeviceBridgeHandler,
  ) => CompanionDeviceBridgeServerRuntime;
  readonly now?: () => string;
}

export interface CompanionDeviceBridgeApplication {
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

export class CompanionDeviceBridgeApplicationError extends Error {
  constructor() {
    super('The companion device bridge application is unavailable.');
    this.name = 'CompanionDeviceBridgeApplicationError';
  }
}

async function closeRuntimes(
  server: CompanionDeviceBridgeServerRuntime | undefined,
  postgres: CompanionDeviceBridgePostgresRuntime | undefined,
): Promise<void> {
  let failed = false;
  try {
    await server?.close();
  } catch {
    failed = true;
  }
  try {
    await postgres?.close();
  } catch {
    failed = true;
  }
  if (failed) throw new CompanionDeviceBridgeApplicationError();
}

export async function startCompanionDeviceBridgeApplication(
  config: CompanionDeviceBridgeConfig,
  dependencies: CompanionDeviceBridgeApplicationDependencies = {},
): Promise<CompanionDeviceBridgeApplication> {
  if (!config.enabled) throw new CompanionDeviceBridgeApplicationError();
  const createPostgresRuntime =
    dependencies.createPostgresRuntime ?? createCompanionDeviceBridgePostgresRuntime;
  const createServer =
    dependencies.createServer ??
    ((handler: CompanionDeviceBridgeHandler) =>
      createCompanionDeviceBridgeHttpServer(handler, {
        host: COMPANION_DEVICE_BRIDGE_LISTEN_HOST,
        port: COMPANION_DEVICE_BRIDGE_LISTEN_PORT,
      }));
  let postgres: CompanionDeviceBridgePostgresRuntime | undefined;
  let server: CompanionDeviceBridgeServerRuntime | undefined;
  try {
    postgres = await createPostgresRuntime(config.connection, config.signer.keyId);
    if (!(await postgres.ready())) throw new Error();
    const state = postgres.state;
    const handler = createCompanionPairingHandler({
      signer: config.signer,
      now: dependencies.now ?? (() => new Date().toISOString()),
      claimPairing: (request, assessedAt) => state.claimPairing(request, assessedAt),
      completePairing: (bodyDigest, certificate) => state.completePairing(bodyDigest, certificate),
      releasePairing: (bodyDigest) => state.releasePairing(bodyDigest),
    });
    server = createServer(handler);
    await server.listen();
    if (!server.ready() || !server.server.listening || !(await postgres.ready())) {
      throw new Error();
    }
  } catch {
    await closeRuntimes(server, postgres).catch(() => undefined);
    throw new CompanionDeviceBridgeApplicationError();
  }

  const activeServer = server;
  const activePostgres = postgres;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    async ready() {
      if (closed || !activeServer.ready() || !activeServer.server.listening) return false;
      try {
        return await activePostgres.ready();
      } catch {
        return false;
      }
    },
    close() {
      closePromise ??= (async () => {
        closed = true;
        await closeRuntimes(activeServer, activePostgres);
      })();
      return closePromise;
    },
  });
}
