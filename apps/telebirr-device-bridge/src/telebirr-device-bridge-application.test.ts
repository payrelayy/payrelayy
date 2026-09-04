import { readFile } from 'node:fs/promises';

import {
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_ROOT,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET,
  TELEBIRR_DEVICE_STATE_LOCAL_ROOT,
  TELEBIRR_DEVICE_STATE_LOCAL_SOCKET,
} from '@fetanagent/telebirr-verification-foundation';
import { describe, expect, it, vi } from 'vitest';

import {
  TelebirrDeviceBridgeApplicationError,
  startTelebirrDeviceBridgeApplication,
  type TelebirrDeviceBridgeApplicationDependencies,
  type TelebirrDeviceBridgeLocalPathStat,
} from './telebirr-device-bridge-application.js';
import type { TelebirrDeviceBridgeConfig } from './telebirr-device-bridge-config.js';
import type {
  TelebirrDeviceBridgeDependencies,
  TelebirrDeviceBridgeHttpResponse,
} from './telebirr-device-bridge.js';
import type {
  TelebirrDeviceBridgeHandler,
  TelebirrDeviceBridgeHttpServerRuntime,
} from './telebirr-device-bridge-server.js';

const RUNTIME_UID = 10_001;
const roots = new Set<string>([
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_ROOT,
  TELEBIRR_DEVICE_STATE_LOCAL_ROOT,
]);
const sockets = new Set<string>([
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET,
  TELEBIRR_DEVICE_STATE_LOCAL_SOCKET,
]);

function config(): Extract<TelebirrDeviceBridgeConfig, { enabled: true }> {
  return {
    enabled: true,
    deploymentTarget: 'staging',
    host: '0.0.0.0',
    port: 8084,
    serverSigningPublicKeySpkiDer: Uint8Array.of(1, 2, 3),
    assignmentSigningPublicKeySpkiDer: Uint8Array.of(4, 5, 6),
    serverSigner: {
      keyId: 'server-key-0001',
      signP1363: vi.fn(async () => 'A'.repeat(86)),
    },
  };
}

interface MutableLocalHealth {
  healthy: boolean;
  driftIdentity: boolean;
  modeOverride?: number;
  ownerOverride?: number;
  realpathOverride?: string;
  socketIsFile: boolean;
  symbolicLink: boolean;
}

function localStat(
  path: string,
  health: MutableLocalHealth,
  occurrence: number,
): TelebirrDeviceBridgeLocalPathStat {
  const directory = roots.has(path);
  const socket = sockets.has(path);
  if ((!directory && !socket) || !health.healthy) throw new Error('private path detail');
  const baseInode = directory ? (path === TELEBIRR_ASSIGNMENT_BROKER_LOCAL_ROOT ? 11 : 12) : 21;
  return {
    dev: 7,
    ino: health.driftIdentity && occurrence % 2 === 0 ? baseInode + 100 : baseInode,
    mode:
      health.modeOverride ??
      (directory ? 0o040_700 : socket && !health.socketIsFile ? 0o140_600 : 0o100_600),
    uid: health.ownerOverride ?? RUNTIME_UID,
    isDirectory: () => directory,
    isSocket: () => socket && !health.socketIsFile,
    isSymbolicLink: () => health.symbolicLink,
  };
}

interface RuntimeFixture {
  readonly captured: { bridge?: TelebirrDeviceBridgeDependencies };
  readonly dependencies: TelebirrDeviceBridgeApplicationDependencies;
  readonly events: string[];
  readonly health: MutableLocalHealth;
  readonly server: TelebirrDeviceBridgeHttpServerRuntime;
  readonly serverState: { available: boolean; listening: boolean };
}

function runtimeFixture(
  options: {
    readonly closeFails?: boolean;
    readonly listenFails?: boolean;
    readonly readyAfterListen?: boolean;
    readonly makeLocalUnhealthyAfterListen?: boolean;
  } = {},
): RuntimeFixture {
  const events: string[] = [];
  const captured: { bridge?: TelebirrDeviceBridgeDependencies } = {};
  const health: MutableLocalHealth = {
    healthy: true,
    driftIdentity: false,
    socketIsFile: false,
    symbolicLink: false,
  };
  const occurrences = new Map<string, number>();
  const serverState = { available: false, listening: false };
  const response: TelebirrDeviceBridgeHttpResponse = {
    statusCode: 503,
    headers: {},
    body: Buffer.from('{}'),
  };
  const handler: TelebirrDeviceBridgeHandler = vi.fn(async () => response);
  const server: TelebirrDeviceBridgeHttpServerRuntime = {
    server: serverState,
    listen: vi.fn(async () => {
      events.push('server.listen');
      if (options.listenFails) throw new Error('private listen detail');
      serverState.listening = true;
      serverState.available = options.readyAfterListen ?? true;
      if (options.makeLocalUnhealthyAfterListen) health.healthy = false;
    }),
    ready: vi.fn(() => serverState.available && serverState.listening),
    close: vi.fn(async () => {
      events.push('server.close');
      serverState.available = false;
      serverState.listening = false;
      if (options.closeFails) throw new Error('private close detail');
    }),
  };
  const state = {
    claimPairingChallenge: vi.fn(async () => undefined),
    completePairingChallenge: vi.fn(async () => false),
    releasePairingChallenge: vi.fn(async () => undefined),
    loadEnrollment: vi.fn(async () => undefined),
    claimReplay: vi.fn(async () => ({ kind: 'in_progress' as const })),
    completeReplay: vi.fn(async () => false),
    releaseReplay: vi.fn(async () => undefined),
    recordHeartbeat: vi.fn(async () => ({ kind: 'retry' as const })),
    stageEvidenceOnly: vi.fn(async () => ({ kind: 'retry' as const })),
  };
  const pollAssignment: TelebirrDeviceBridgeDependencies['pollAssignment'] = vi.fn(async () => ({
    kind: 'none' as const,
  }));
  const dependencies: TelebirrDeviceBridgeApplicationDependencies = {
    platform: 'linux',
    effectiveUserId: RUNTIME_UID,
    fileSystem: {
      lstat: vi.fn(async (path) => {
        events.push(`lstat:${path}`);
        const occurrence = (occurrences.get(path) ?? 0) + 1;
        occurrences.set(path, occurrence);
        return localStat(path, health, occurrence);
      }),
      realpath: vi.fn(async (path) => {
        events.push(`realpath:${path}`);
        if (!health.healthy) throw new Error('private path detail');
        return health.realpathOverride ?? path;
      }),
    },
    createDeviceStateDependencies: vi.fn(() => {
      events.push('state.create');
      return state;
    }),
    createPollAssignment: vi.fn(() => {
      events.push('assignment.create');
      return pollAssignment;
    }),
    createHandler: vi.fn((bridge) => {
      events.push('handler.create');
      captured.bridge = bridge;
      return handler;
    }),
    createHttpServer: vi.fn((_handler, optionsValue) => {
      events.push(`server.create:${optionsValue.host}:${optionsValue.port}`);
      return server;
    }),
  };
  return { captured, dependencies, events, health, server, serverState };
}

describe('TeleBirr device bridge application', () => {
  it('refuses the default-disabled configuration without inspecting local paths', async () => {
    const fixture = runtimeFixture();
    await expect(
      startTelebirrDeviceBridgeApplication({ enabled: false }, fixture.dependencies),
    ).rejects.toThrow(TelebirrDeviceBridgeApplicationError);
    expect(fixture.events).toEqual([]);
  });

  it('preflights both private sockets, composes the closed adapters, then listens and rechecks', async () => {
    const fixture = runtimeFixture();
    const enabledConfig = config();
    const application = await startTelebirrDeviceBridgeApplication(
      enabledConfig,
      fixture.dependencies,
    );
    const firstComposition = fixture.events.indexOf('state.create');
    const listen = fixture.events.indexOf('server.listen');
    const lastPathCheck = fixture.events.lastIndexOf(`lstat:${TELEBIRR_DEVICE_STATE_LOCAL_SOCKET}`);
    expect(firstComposition).toBeGreaterThan(
      fixture.events.indexOf(`realpath:${TELEBIRR_DEVICE_STATE_LOCAL_SOCKET}`),
    );
    expect(listen).toBeGreaterThan(firstComposition);
    expect(lastPathCheck).toBeGreaterThan(listen);
    expect(fixture.events).toContain('server.create:0.0.0.0:8084');
    expect(fixture.captured.bridge?.serverSigner).toBe(enabledConfig.serverSigner);
    expect(fixture.captured.bridge?.claimReplay).toBeDefined();
    expect(fixture.captured.bridge?.stageEvidenceOnly).toBeDefined();
    expect(fixture.captured.bridge?.pollAssignment).toBeDefined();
    expect(fixture.captured.bridge?.now()).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(fixture.captured.bridge?.nextOpaqueId('acknowledgement')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/u,
    );
    await expect(application.ready()).resolves.toBe(true);
    await application.close();
  });

  it('fails before composing a public handler when either private broker is absent', async () => {
    const fixture = runtimeFixture();
    fixture.health.healthy = false;
    await expect(
      startTelebirrDeviceBridgeApplication(config(), fixture.dependencies),
    ).rejects.toThrow('application is unavailable');
    expect(fixture.events).not.toContain('state.create');
    expect(fixture.server.listen).not.toHaveBeenCalled();
  });

  it.each([
    ['a root or socket is a symlink', (health: MutableLocalHealth) => (health.symbolicLink = true)],
    ['ownership differs', (health: MutableLocalHealth) => (health.ownerOverride = 0)],
    ['mode is broader', (health: MutableLocalHealth) => (health.modeOverride = 0o040_770)],
    ['the endpoint is not a socket', (health: MutableLocalHealth) => (health.socketIsFile = true)],
    [
      'realpath escapes the fixed path',
      (health: MutableLocalHealth) => (health.realpathOverride = '/run/replaced'),
    ],
    [
      'identity changes during inspection',
      (health: MutableLocalHealth) => (health.driftIdentity = true),
    ],
  ])('fails closed when %s', async (_label, mutate) => {
    const fixture = runtimeFixture();
    mutate(fixture.health);
    await expect(
      startTelebirrDeviceBridgeApplication(config(), fixture.dependencies),
    ).rejects.toThrow(TelebirrDeviceBridgeApplicationError);
    expect(fixture.events).not.toContain('state.create');
  });

  it('requires Linux and a non-root runtime identity', async () => {
    const windows = runtimeFixture();
    const root = runtimeFixture();
    await expect(
      startTelebirrDeviceBridgeApplication(config(), {
        ...windows.dependencies,
        platform: 'win32',
      }),
    ).rejects.toThrow(TelebirrDeviceBridgeApplicationError);
    await expect(
      startTelebirrDeviceBridgeApplication(config(), {
        ...root.dependencies,
        effectiveUserId: 0,
      }),
    ).rejects.toThrow(TelebirrDeviceBridgeApplicationError);
    expect(windows.events).toEqual([]);
    expect(root.events).toEqual([]);
  });

  it('closes the listener when post-listen broker validation fails', async () => {
    const fixture = runtimeFixture({ makeLocalUnhealthyAfterListen: true });
    await expect(
      startTelebirrDeviceBridgeApplication(config(), fixture.dependencies),
    ).rejects.toThrow(TelebirrDeviceBridgeApplicationError);
    expect(fixture.events.slice(-2)).toEqual([
      `lstat:${TELEBIRR_ASSIGNMENT_BROKER_LOCAL_ROOT}`,
      'server.close',
    ]);
    expect(fixture.serverState.listening).toBe(false);
  });

  it('closes a failed or non-ready listener and exposes only the fixed error', async () => {
    for (const options of [{ listenFails: true }, { readyAfterListen: false }]) {
      const fixture = runtimeFixture(options);
      await expect(
        startTelebirrDeviceBridgeApplication(config(), fixture.dependencies),
      ).rejects.toThrow('application is unavailable');
      expect(fixture.server.close).toHaveBeenCalledOnce();
    }
  });

  it('reduces runtime broker replacement or removal to not-ready', async () => {
    const fixture = runtimeFixture();
    const application = await startTelebirrDeviceBridgeApplication(config(), fixture.dependencies);
    fixture.health.healthy = false;
    await expect(application.ready()).resolves.toBe(false);
    await application.close();
  });

  it('closes once and hides listener close details', async () => {
    const fixture = runtimeFixture({ closeFails: true });
    const application = await startTelebirrDeviceBridgeApplication(config(), fixture.dependencies);
    await expect(application.close()).rejects.toThrow(TelebirrDeviceBridgeApplicationError);
    await expect(application.close()).rejects.toThrow('application is unavailable');
    expect(fixture.server.close).toHaveBeenCalledOnce();
    await expect(application.ready()).resolves.toBe(false);
  });

  it('keeps the executable redacted, database-free, and free of a calendar stop', async () => {
    const source = await readFile(
      new URL('./telebirr-device-bridge-main.ts', import.meta.url),
      'utf8',
    );
    const applicationSource = await readFile(
      new URL('./telebirr-device-bridge-application.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain("event: 'listening'");
    expect(source).toContain("event: 'startup_failed'");
    expect(source).toContain('detailsRedacted: true');
    expect(source).not.toMatch(/console\.(?:info|error)\([^\n]*(?:error|config)/u);
    expect(`${source}\n${applicationSource}`).not.toMatch(
      /2026-09-04|shutdownAt|stopAt|service[_-]?role|postgres|supabase/u,
    );
  });
});
