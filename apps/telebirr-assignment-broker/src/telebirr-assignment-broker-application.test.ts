import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION,
  TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
  TELEBIRR_REFERENCE_OPENING_PROVIDER,
  TELEBIRR_REFERENCE_OPENING_PURPOSE,
} from '@fetanagent/telebirr-reference-opening';
import {
  TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
  digestTelebirrLivePilotReceiverName,
} from '@fetanagent/telebirr-verification-foundation';
import { describe, expect, it, vi } from 'vitest';

import {
  TelebirrAssignmentBrokerApplicationError,
  startTelebirrAssignmentBrokerApplication,
  type TelebirrAssignmentBrokerApplicationDependencies,
  type TelebirrAssignmentBrokerLocalServerRuntime,
} from './telebirr-assignment-broker-application.js';
import type { TelebirrAssignmentBrokerConfig } from './telebirr-assignment-broker-config.js';
import type { TelebirrAssignmentBrokerPostgresRuntime } from './postgres-telebirr-assignment-broker.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;

function config(): Extract<TelebirrAssignmentBrokerConfig, { enabled: true }> {
  const signerPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signerSpki = Buffer.from(signerPair.publicKey.export({ format: 'der', type: 'spki' }));
  const keyHex = 'a'.repeat(64);
  const keyBytes = Buffer.from(keyHex, 'hex');
  const openingKeyId = `sha256:${createHash('sha256').update(keyBytes).digest('hex')}`;
  keyBytes.fill(0);
  const receiverName = 'synthetic pilot receiver';
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
      user: 'fetanagent_telebirr_assignment_broker_runtime',
    },
    openingKey: {
      contractVersion: TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION,
      providerCode: TELEBIRR_REFERENCE_OPENING_PROVIDER,
      purpose: TELEBIRR_REFERENCE_OPENING_PURPOSE,
      keyVersion: TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
      keyId: openingKeyId,
      keyHex,
    },
    receiverManifest: {
      contractVersion: 1,
      providerCode: 'telebirr',
      pilotRevisionId: '11111111-1111-4111-8111-111111111111',
      receiverRevisionId: '22222222-2222-4222-8222-222222222222',
      receiverProfileId: '33333333-3333-4333-8333-333333333333',
      receiverProfileDigest: sha('1'),
      receiverConfigurationDigest: sha('2'),
      receiverNameNormalizerVersion: TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
      expectedReceiverNameNormalized: receiverName,
      expectedReceiverNameDigest: digestTelebirrLivePilotReceiverName(receiverName)!,
    },
    signer: {
      assignmentSignerId: '44444444-4444-4444-8444-444444444444',
      keyId: 'pilot-assignment-key-0001',
      publicKeySpkiDer: signerSpki,
      signP1363: async (transcript) =>
        sign('sha256', transcript, {
          key: signerPair.privateKey,
          dsaEncoding: 'ieee-p1363',
        }).toString('base64url'),
    },
  };
}

interface RuntimeFixture {
  readonly dependencies: TelebirrAssignmentBrokerApplicationDependencies;
  readonly events: string[];
  readonly postgres: TelebirrAssignmentBrokerPostgresRuntime;
  readonly server: TelebirrAssignmentBrokerLocalServerRuntime;
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
  const postgres: TelebirrAssignmentBrokerPostgresRuntime = {
    database: {
      leaseAssignment: vi.fn(async () => null),
      persistAssignmentSignature: vi.fn(async () => ({
        assignmentSignature: 'A'.repeat(86),
        assignmentSignatureDigest: sha('9'),
        replayed: false,
      })),
    },
    ready: vi.fn(async () => {
      events.push('postgres.ready');
      return readyValues.shift() ?? false;
    }),
    close: vi.fn(async () => {
      events.push('postgres.close');
      if (options.postgresCloseFails) throw new Error('private postgres detail');
    }),
  };
  const server: TelebirrAssignmentBrokerLocalServerRuntime = {
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
      createLocalServer: vi.fn(() => {
        events.push('server.create');
        return server;
      }),
    },
    events,
    postgres,
    server,
    state,
  };
}

describe('private TeleBirr assignment broker application', () => {
  it('refuses to start from the default disabled configuration', async () => {
    const fixture = runtimeFixture();
    await expect(
      startTelebirrAssignmentBrokerApplication({ enabled: false }, fixture.dependencies),
    ).rejects.toThrow(TelebirrAssignmentBrokerApplicationError);
    expect(fixture.events).toEqual([]);
  });

  it('starts PostgreSQL before the local socket and closes in the reverse authority order', async () => {
    const fixture = runtimeFixture();
    const application = await startTelebirrAssignmentBrokerApplication(
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
      startTelebirrAssignmentBrokerApplication(config(), fixture.dependencies),
    ).rejects.toThrow(TelebirrAssignmentBrokerApplicationError);
    expect(fixture.events).toEqual(['postgres.create', 'postgres.ready', 'postgres.close']);
  });

  it('closes both runtimes and hides details when local socket startup fails', async () => {
    const fixture = runtimeFixture({ listenFails: true });
    await expect(
      startTelebirrAssignmentBrokerApplication(config(), fixture.dependencies),
    ).rejects.toThrow('application is unavailable');
    expect(fixture.events.slice(-2)).toEqual(['server.close', 'postgres.close']);
  });

  it('tears down a listener if the post-listen database readiness check fails', async () => {
    const fixture = runtimeFixture({ postgresReady: [true, false] });
    await expect(
      startTelebirrAssignmentBrokerApplication(config(), fixture.dependencies),
    ).rejects.toThrow(TelebirrAssignmentBrokerApplicationError);
    expect(fixture.events.slice(-2)).toEqual(['server.close', 'postgres.close']);
    expect(fixture.state.listening).toBe(false);
  });

  it('reduces runtime readiness exceptions to false', async () => {
    const fixture = runtimeFixture();
    const application = await startTelebirrAssignmentBrokerApplication(
      config(),
      fixture.dependencies,
    );
    vi.mocked(fixture.postgres.ready).mockRejectedValueOnce(new Error('private database detail'));
    await expect(application.ready()).resolves.toBe(false);
    await application.close();
  });

  it('attempts both closes and returns only a fixed error if either close fails', async () => {
    const fixture = runtimeFixture({ serverCloseFails: true, postgresCloseFails: true });
    const application = await startTelebirrAssignmentBrokerApplication(
      config(),
      fixture.dependencies,
    );
    await expect(application.close()).rejects.toThrow(TelebirrAssignmentBrokerApplicationError);
    expect(fixture.server.close).toHaveBeenCalledOnce();
    expect(fixture.postgres.close).toHaveBeenCalledOnce();
  });

  it('keeps the main entrypoint redacted and free of a calendar stop', async () => {
    const source = await readFile(
      new URL('./telebirr-assignment-broker-main.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain("event: 'listening'");
    expect(source).toContain("event: 'startup_failed'");
    expect(source).toContain('detailsRedacted: true');
    expect(source).not.toMatch(/console\.(?:info|error)\([^\n]*(?:error|config)/u);
    expect(source).not.toMatch(/2026-09-04|shutdownAt|stopAt/u);
  });
});
