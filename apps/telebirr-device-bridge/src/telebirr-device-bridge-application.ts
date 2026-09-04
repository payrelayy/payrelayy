import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';

import {
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_ROOT,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET,
  TELEBIRR_DEVICE_STATE_LOCAL_ROOT,
  TELEBIRR_DEVICE_STATE_LOCAL_SOCKET,
} from '@fetanagent/telebirr-verification-foundation';

import { createTelebirrAssignmentBrokerUnixPollAssignment } from './local-telebirr-assignment-broker-client.js';
import {
  createTelebirrDeviceStateUnixDependencies,
  type TelebirrDeviceStateBridgeDependencies,
} from './local-telebirr-device-state-client.js';
import type { TelebirrDeviceBridgeConfig } from './telebirr-device-bridge-config.js';
import {
  createTelebirrDeviceBridgeHandler,
  type TelebirrDeviceBridgeDependencies,
} from './telebirr-device-bridge.js';
import {
  createTelebirrDeviceBridgeHttpServer,
  type TelebirrDeviceBridgeHandler,
  type TelebirrDeviceBridgeHttpServerRuntime,
} from './telebirr-device-bridge-server.js';

type EnabledConfig = Extract<TelebirrDeviceBridgeConfig, { readonly enabled: true }>;

export interface TelebirrDeviceBridgeLocalPathStat {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly uid: number;
  isDirectory(): boolean;
  isSocket(): boolean;
  isSymbolicLink(): boolean;
}

export interface TelebirrDeviceBridgeLocalFileSystem {
  lstat(path: string): Promise<TelebirrDeviceBridgeLocalPathStat>;
  realpath(path: string): Promise<string>;
}

export interface TelebirrDeviceBridgeApplicationDependencies {
  readonly createDeviceStateDependencies?: () => TelebirrDeviceStateBridgeDependencies;
  readonly createPollAssignment?: () => TelebirrDeviceBridgeDependencies['pollAssignment'];
  readonly createHandler?: (
    dependencies: TelebirrDeviceBridgeDependencies,
  ) => TelebirrDeviceBridgeHandler;
  readonly createHttpServer?: (
    handler: TelebirrDeviceBridgeHandler,
    options: Pick<EnabledConfig, 'host' | 'port'>,
  ) => TelebirrDeviceBridgeHttpServerRuntime;
  readonly effectiveUserId?: number;
  readonly fileSystem?: TelebirrDeviceBridgeLocalFileSystem;
  readonly nextOpaqueId?: TelebirrDeviceBridgeDependencies['nextOpaqueId'];
  readonly now?: () => string;
  readonly platform?: NodeJS.Platform;
}

export interface TelebirrDeviceBridgeApplication {
  readonly ready: () => Promise<boolean>;
  readonly close: () => Promise<void>;
}

export class TelebirrDeviceBridgeApplicationError extends Error {
  constructor() {
    super('The TeleBirr device bridge application is unavailable.');
    this.name = 'TelebirrDeviceBridgeApplicationError';
  }
}

const nodeFileSystem: TelebirrDeviceBridgeLocalFileSystem = {
  lstat,
  realpath,
};

function sameIdentity(
  left: TelebirrDeviceBridgeLocalPathStat,
  right: TelebirrDeviceBridgeLocalPathStat,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function validDirectory(stat: TelebirrDeviceBridgeLocalPathStat, owner: number): boolean {
  return (
    stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    stat.uid === owner &&
    (stat.mode & 0o7777) === 0o700
  );
}

function validSocket(stat: TelebirrDeviceBridgeLocalPathStat, owner: number): boolean {
  return (
    stat.isSocket() &&
    !stat.isSymbolicLink() &&
    stat.uid === owner &&
    (stat.mode & 0o7777) === 0o600
  );
}

async function assertLocalEndpoint(
  fileSystem: TelebirrDeviceBridgeLocalFileSystem,
  owner: number,
  root: string,
  socket: string,
): Promise<void> {
  const rootBefore = await fileSystem.lstat(root);
  if (!validDirectory(rootBefore, owner) || (await fileSystem.realpath(root)) !== root) {
    throw new Error();
  }
  const rootAfter = await fileSystem.lstat(root);
  if (!sameIdentity(rootBefore, rootAfter) || !validDirectory(rootAfter, owner)) {
    throw new Error();
  }

  const socketBefore = await fileSystem.lstat(socket);
  if (!validSocket(socketBefore, owner) || (await fileSystem.realpath(socket)) !== socket) {
    throw new Error();
  }
  const socketAfter = await fileSystem.lstat(socket);
  if (!sameIdentity(socketBefore, socketAfter) || !validSocket(socketAfter, owner)) {
    throw new Error();
  }
}

async function assertPrivateBrokers(
  dependencies: TelebirrDeviceBridgeApplicationDependencies,
): Promise<void> {
  const platform = dependencies.platform ?? process.platform;
  const effectiveUserId = dependencies.effectiveUserId ?? process.geteuid?.();
  if (platform !== 'linux' || effectiveUserId === undefined || effectiveUserId <= 0) {
    throw new Error();
  }
  const fileSystem = dependencies.fileSystem ?? nodeFileSystem;
  await assertLocalEndpoint(
    fileSystem,
    effectiveUserId,
    TELEBIRR_ASSIGNMENT_BROKER_LOCAL_ROOT,
    TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET,
  );
  await assertLocalEndpoint(
    fileSystem,
    effectiveUserId,
    TELEBIRR_DEVICE_STATE_LOCAL_ROOT,
    TELEBIRR_DEVICE_STATE_LOCAL_SOCKET,
  );
}

export async function startTelebirrDeviceBridgeApplication(
  config: TelebirrDeviceBridgeConfig,
  dependencies: TelebirrDeviceBridgeApplicationDependencies = {},
): Promise<TelebirrDeviceBridgeApplication> {
  if (!config.enabled) throw new TelebirrDeviceBridgeApplicationError();
  const createDeviceStateDependencies =
    dependencies.createDeviceStateDependencies ?? createTelebirrDeviceStateUnixDependencies;
  const createPollAssignment =
    dependencies.createPollAssignment ?? createTelebirrAssignmentBrokerUnixPollAssignment;
  const createHandler = dependencies.createHandler ?? createTelebirrDeviceBridgeHandler;
  const createHttpServer = dependencies.createHttpServer ?? createTelebirrDeviceBridgeHttpServer;
  let server: TelebirrDeviceBridgeHttpServerRuntime | undefined;
  try {
    await assertPrivateBrokers(dependencies);
    const state = createDeviceStateDependencies();
    const handler = createHandler({
      serverSigningPublicKeySpkiDer: config.serverSigningPublicKeySpkiDer,
      assignmentSigningPublicKeySpkiDer: config.assignmentSigningPublicKeySpkiDer,
      serverSigner: config.serverSigner,
      now: dependencies.now ?? (() => new Date().toISOString()),
      nextOpaqueId: dependencies.nextOpaqueId ?? (() => randomUUID()),
      ...state,
      pollAssignment: createPollAssignment(),
    });
    server = createHttpServer(handler, { host: config.host, port: config.port });
    await server.listen();
    if (!server.ready()) throw new Error();
    await assertPrivateBrokers(dependencies);
    if (!server.ready()) throw new Error();
  } catch {
    await server?.close().catch(() => undefined);
    throw new TelebirrDeviceBridgeApplicationError();
  }

  const activeServer = server;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    ready: async () => {
      if (closed || !activeServer.ready()) return false;
      try {
        await assertPrivateBrokers(dependencies);
        return activeServer.ready();
      } catch {
        return false;
      }
    },
    close: () => {
      closePromise ??= (async () => {
        closed = true;
        try {
          await activeServer.close();
        } catch {
          throw new TelebirrDeviceBridgeApplicationError();
        }
      })();
      return closePromise;
    },
  });
}
