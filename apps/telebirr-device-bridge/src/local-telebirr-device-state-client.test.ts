import { readFile } from 'node:fs/promises';

import {
  TELEBIRR_DEVICE_STATE_LOCAL_CONTRACT_VERSION,
  TELEBIRR_DEVICE_STATE_LOCAL_NO_MONEY_SAFETY,
  TELEBIRR_DEVICE_STATE_LOCAL_PATHS,
  TELEBIRR_DEVICE_STATE_LOCAL_PROTOCOL_MODE,
  TELEBIRR_DEVICE_STATE_LOCAL_PROVIDER_CODE,
  decodeTelebirrDeviceStateLocalRequestBytes,
  encodeTelebirrDeviceStateLocalResponse,
  type TelebirrDeviceStateLocalOperation,
} from '@fetanagent/telebirr-verification-foundation';
import { describe, expect, it, vi } from 'vitest';

import {
  TelebirrDeviceStateLocalClientError,
  createTelebirrDeviceStateLocalAdapter,
  createTelebirrDeviceStateUnixDependencies,
} from './local-telebirr-device-state-client.js';

const replayIdentity = 'sha256:' + '9'.repeat(64);

function response<T extends TelebirrDeviceStateLocalOperation>(
  operation: T,
  fields: Readonly<Record<string, unknown>>,
): Buffer {
  const encoded = encodeTelebirrDeviceStateLocalResponse({
    contractVersion: TELEBIRR_DEVICE_STATE_LOCAL_CONTRACT_VERSION,
    providerCode: TELEBIRR_DEVICE_STATE_LOCAL_PROVIDER_CODE,
    protocolMode: TELEBIRR_DEVICE_STATE_LOCAL_PROTOCOL_MODE,
    operation,
    ...fields,
    ...TELEBIRR_DEVICE_STATE_LOCAL_NO_MONEY_SAFETY,
  });
  if (!encoded) throw new Error('invalid synthetic local response');
  return encoded;
}

describe('local TeleBirr device-state bridge adapter', () => {
  it('maps fixed enrollment and replay operations without exposing transport choices', async () => {
    const operations: string[] = [];
    const exchange = vi.fn(async (path, body: Uint8Array) => {
      const decoded = decodeTelebirrDeviceStateLocalRequestBytes(body);
      if (!decoded) throw new Error('invalid request');
      operations.push(decoded.operation);
      expect(path).toBe(TELEBIRR_DEVICE_STATE_LOCAL_PATHS[decoded.operation]);
      switch (decoded.operation) {
        case 'enrollment_load':
          return response(decoded.operation, { certificate: null });
        case 'replay_claim':
          return response(decoded.operation, { outcome: 'claimed', response: null });
        case 'replay_release':
          return response(decoded.operation, { released: true });
        default:
          throw new Error('unexpected operation');
      }
    });
    const adapter = createTelebirrDeviceStateLocalAdapter(exchange);
    await expect(
      adapter.loadEnrollment('11111111-1111-4111-8111-111111111111'),
    ).resolves.toBeUndefined();
    await expect(adapter.claimReplay(replayIdentity, '2026-09-04T10:03:00.000Z')).resolves.toEqual({
      kind: 'claimed',
    });
    await expect(adapter.releaseReplay(replayIdentity)).resolves.toBeUndefined();
    expect(operations).toEqual(['enrollment_load', 'replay_claim', 'replay_release']);
  });

  it('rejects invalid inputs before transport and cross-operation responses after transport', async () => {
    const exchange = vi.fn(async () =>
      response('replay_release', {
        released: true,
      }),
    );
    const adapter = createTelebirrDeviceStateLocalAdapter(exchange);
    await expect(adapter.loadEnrollment('opaque-enrollment-0001')).rejects.toThrow(
      TelebirrDeviceStateLocalClientError,
    );
    expect(exchange).not.toHaveBeenCalled();

    await expect(adapter.loadEnrollment('11111111-1111-4111-8111-111111111111')).rejects.toThrow(
      TelebirrDeviceStateLocalClientError,
    );
  });

  it.each([
    {
      name: 'transport failure',
      exchange: async (): Promise<Uint8Array> => {
        throw new Error('socket detail must not escape');
      },
    },
    {
      name: 'malformed response',
      exchange: async (): Promise<Uint8Array> => Buffer.from('{}', 'utf8'),
    },
  ])('reduces $name to one fixed local error', async ({ exchange }) => {
    const adapter = createTelebirrDeviceStateLocalAdapter(exchange);
    await expect(adapter.releaseReplay(replayIdentity)).rejects.toEqual(
      new TelebirrDeviceStateLocalClientError(),
    );
  });

  it('keeps production transport fixed to one Unix socket with no private runtime import', async () => {
    expect(Object.keys(createTelebirrDeviceStateUnixDependencies())).toEqual([
      'claimPairingChallenge',
      'completePairingChallenge',
      'releasePairingChallenge',
      'loadEnrollment',
      'claimReplay',
      'completeReplay',
      'releaseReplay',
      'recordHeartbeat',
      'stageEvidenceOnly',
    ]);
    const source = await readFile(
      new URL('./local-telebirr-device-state-client.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('socketPath: TELEBIRR_DEVICE_STATE_LOCAL_SOCKET');
    expect(source).not.toMatch(
      /\b(?:service_role|SUPABASE|DATABASE_URL|from ['"]pg['"]|postgres)\b/u,
    );
    expect(source).not.toMatch(/https?:\/\//u);
  });
});
