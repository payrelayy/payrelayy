import { describe, expect, it } from 'vitest';

import {
  OWNER_TELEBIRR_MINIMUM_ANDROID_APP_VERSION,
  OwnerTelebirrDevicePairingNotReadyError,
  OwnerTelebirrDevicePairingRejectedError,
  OwnerTelebirrDevicePairingUnavailableError,
  PostgresOwnerTelebirrDevicePairing,
} from './owner-telebirr-device-pairing.js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const pairingId = '33333333-3333-4333-8333-333333333333';
const signerKeyId = 'telebirr_assignment_signer_2026_01';
const nonceDigest = `sha256:${'a'.repeat(64)}`;
const expiresAt = new Date('2026-09-04T12:10:00.000Z');

describe('Owner TeleBirr Android pairing-package adapter', () => {
  it('returns the exact canonical Android package and no financial authority', async () => {
    const calls: Array<{ readonly sql: string; readonly values: readonly string[] }> = [];
    const pairing = new PostgresOwnerTelebirrDevicePairing(
      {
        query: async (sql, values) => {
          calls.push({ sql, values });
          return {
            rows: [
              {
                expires_at: expiresAt,
                pairing_id: pairingId,
                pairing_nonce_digest: nonceDigest,
                replayed: false,
              },
            ],
          };
        },
      },
      signerKeyId,
    );

    const receipt = await pairing.issue(authUserId, requestId);
    const expectedJson = JSON.stringify({
      schemaVersion: 1,
      pairingId,
      pairingNonceDigest: nonceDigest,
      expiresAt: expiresAt.toISOString(),
    });
    expect(receipt).toEqual({
      alreadyIssued: false,
      assignmentPollingAllowed: false,
      expiresAt: expiresAt.toISOString(),
      moneyMovementAllowed: false,
      pairingOnly: true,
      pairingPackage:
        'fetanagent-pairing-v1.' + Buffer.from(expectedJson, 'utf8').toString('base64url'),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain('app.issue_current_private_telebirr_device_pairing');
    expect(calls[0]!.values).toEqual([
      authUserId,
      requestId,
      signerKeyId,
      OWNER_TELEBIRR_MINIMUM_ANDROID_APP_VERSION,
    ]);
  });

  it('marks an exact database replay without changing the package', async () => {
    const database = {
      query: async () => ({
        rows: [
          {
            expires_at: expiresAt,
            pairing_id: pairingId,
            pairing_nonce_digest: nonceDigest,
            replayed: true,
          },
        ],
      }),
    };
    const receipt = await new PostgresOwnerTelebirrDevicePairing(database, signerKeyId).issue(
      authUserId,
      requestId,
    );
    expect(receipt.alreadyIssued).toBe(true);
    expect(receipt.pairingPackage).toMatch(/^fetanagent-pairing-v1\.[A-Za-z0-9_-]+$/u);
  });

  it('classifies malformed input, no-ready authority, and malformed rows fail closed', async () => {
    const rejected = new PostgresOwnerTelebirrDevicePairing(
      { query: async () => ({ rows: [] }) },
      signerKeyId,
    );
    await expect(rejected.issue(authUserId, 'not-a-request-id')).rejects.toBeInstanceOf(
      OwnerTelebirrDevicePairingRejectedError,
    );

    const notReady = new PostgresOwnerTelebirrDevicePairing(
      {
        query: async () => {
          throw Object.assign(new Error('redacted database rejection'), { code: 'P0001' });
        },
      },
      signerKeyId,
    );
    await expect(notReady.issue(authUserId, requestId)).rejects.toBeInstanceOf(
      OwnerTelebirrDevicePairingNotReadyError,
    );

    const malformed = new PostgresOwnerTelebirrDevicePairing(
      { query: async () => ({ rows: [{ pairing_id: pairingId }] }) },
      signerKeyId,
    );
    await expect(malformed.issue(authUserId, requestId)).rejects.toBeInstanceOf(
      OwnerTelebirrDevicePairingUnavailableError,
    );
  });
});
