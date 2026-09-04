import { describe, expect, it } from 'vitest';

import {
  TELEBIRR_DEVICE_STATE_LOCAL_CONTRACT_VERSION,
  TELEBIRR_DEVICE_STATE_LOCAL_MAX_REQUEST_BYTES,
  TELEBIRR_DEVICE_STATE_LOCAL_NO_MONEY_SAFETY,
  TELEBIRR_DEVICE_STATE_LOCAL_PATHS,
  TELEBIRR_DEVICE_STATE_LOCAL_PROTOCOL_MODE,
  TELEBIRR_DEVICE_STATE_LOCAL_PROVIDER_CODE,
  TELEBIRR_DEVICE_STATE_LOCAL_SOCKET,
  decodeTelebirrDeviceStateLocalRequest,
  decodeTelebirrDeviceStateLocalRequestBytes,
  decodeTelebirrDeviceStateLocalResponseBytes,
  encodeTelebirrDeviceStateLocalRequest,
  encodeTelebirrDeviceStateLocalResponse,
  telebirrDeviceStateLocalPathForOperation,
} from './device-state-local-protocol.js';

const sha = (character: string): string => 'sha256:' + character.repeat(64);
const header = {
  contractVersion: TELEBIRR_DEVICE_STATE_LOCAL_CONTRACT_VERSION,
  providerCode: TELEBIRR_DEVICE_STATE_LOCAL_PROVIDER_CODE,
  protocolMode: TELEBIRR_DEVICE_STATE_LOCAL_PROTOCOL_MODE,
  ...TELEBIRR_DEVICE_STATE_LOCAL_NO_MONEY_SAFETY,
} as const;

describe('local TeleBirr device-state protocol', () => {
  it('pins exactly nine operations to one fixed Unix socket and distinct fixed paths', () => {
    expect(Object.keys(TELEBIRR_DEVICE_STATE_LOCAL_PATHS)).toHaveLength(9);
    expect(new Set(Object.values(TELEBIRR_DEVICE_STATE_LOCAL_PATHS)).size).toBe(9);
    expect(TELEBIRR_DEVICE_STATE_LOCAL_SOCKET).toBe(
      '/run/fetanagent-telebirr-device-state/state.sock',
    );
    for (const [operation, path] of Object.entries(TELEBIRR_DEVICE_STATE_LOCAL_PATHS)) {
      expect(telebirrDeviceStateLocalPathForOperation(operation)).toBe(path);
    }
    expect(telebirrDeviceStateLocalPathForOperation('generic_sql')).toBeUndefined();
  });

  it.each([
    {
      operation: 'pairing_release',
      fields: { pairingRequestBodyDigest: sha('1') },
    },
    {
      operation: 'enrollment_load',
      fields: { enrollmentId: '11111111-1111-4111-8111-111111111111' },
    },
    {
      operation: 'replay_claim',
      fields: {
        replayIdentity: sha('2'),
        requestExpiresAt: '2026-09-04T10:03:00.000Z',
      },
    },
    {
      operation: 'replay_release',
      fields: { replayIdentity: sha('3') },
    },
  ] as const)('round-trips the exact canonical $operation request', ({ operation, fields }) => {
    const encoded = encodeTelebirrDeviceStateLocalRequest({
      ...header,
      operation,
      ...fields,
    });
    expect(encoded).toBeDefined();
    expect(decodeTelebirrDeviceStateLocalRequestBytes(encoded)?.operation).toBe(operation);
  });

  it.each([
    {
      operation: 'pairing_complete',
      fields: { completed: false },
    },
    {
      operation: 'pairing_release',
      fields: { released: true },
    },
    {
      operation: 'enrollment_load',
      fields: { certificate: null },
    },
    {
      operation: 'replay_claim',
      fields: { outcome: 'claimed', response: null },
    },
    {
      operation: 'replay_complete',
      fields: { completed: true },
    },
    {
      operation: 'replay_release',
      fields: { released: true },
    },
    {
      operation: 'heartbeat_record',
      fields: { outcome: 'rejected', reason: 'device_revoked' },
    },
    {
      operation: 'evidence_stage',
      fields: {
        outcome: 'accepted',
        reason: null,
        replayed: true,
      },
    },
  ] as const)('round-trips the exact canonical $operation response', ({ operation, fields }) => {
    const encoded = encodeTelebirrDeviceStateLocalResponse({
      ...header,
      operation,
      ...fields,
    });
    expect(encoded).toBeDefined();
    expect(decodeTelebirrDeviceStateLocalResponseBytes(encoded)?.operation).toBe(operation);
  });

  it('rejects extra fields, wrong safety, accessors, proxies, and non-canonical bytes', () => {
    const baseline = {
      ...header,
      operation: 'replay_release',
      replayIdentity: sha('4'),
    } as const;
    expect(
      decodeTelebirrDeviceStateLocalRequest({ ...baseline, unexpected: true }),
    ).toBeUndefined();
    expect(
      decodeTelebirrDeviceStateLocalRequest({
        ...baseline,
        moneyMovementAllowed: true,
      }),
    ).toBeUndefined();

    let invoked = false;
    const accessor = Object.defineProperty({ ...baseline }, 'replayIdentity', {
      enumerable: true,
      get: () => {
        invoked = true;
        return sha('4');
      },
    });
    expect(decodeTelebirrDeviceStateLocalRequest(accessor)).toBeUndefined();
    expect(invoked).toBe(false);
    expect(decodeTelebirrDeviceStateLocalRequest(new Proxy(baseline, {}))).toBeUndefined();

    const canonical = encodeTelebirrDeviceStateLocalRequest(baseline)!;
    expect(
      decodeTelebirrDeviceStateLocalRequestBytes(
        Buffer.concat([Buffer.from(' ', 'utf8'), canonical]),
      ),
    ).toBeUndefined();
    expect(
      decodeTelebirrDeviceStateLocalRequestBytes(
        Buffer.alloc(TELEBIRR_DEVICE_STATE_LOCAL_MAX_REQUEST_BYTES + 1),
      ),
    ).toBeUndefined();
  });

  it('rejects cross-variant and impossible response shapes', () => {
    expect(
      encodeTelebirrDeviceStateLocalResponse({
        ...header,
        operation: 'heartbeat_record',
        outcome: 'accepted',
        reason: 'device_revoked',
      }),
    ).toBeUndefined();
    expect(
      encodeTelebirrDeviceStateLocalResponse({
        ...header,
        operation: 'evidence_stage',
        outcome: 'retry',
        reason: null,
        replayed: true,
      }),
    ).toBeUndefined();
    expect(
      encodeTelebirrDeviceStateLocalResponse({
        ...header,
        operation: 'pairing_release',
        released: false,
      }),
    ).toBeUndefined();
  });
});
