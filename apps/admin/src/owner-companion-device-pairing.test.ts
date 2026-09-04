import { createHash, generateKeyPairSync } from 'node:crypto';

import { AGENT_PLATFORM_COMPANION_PAIRING_PACKAGE_PREFIX } from '@fetanagent/agent-platform-companion-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  ISSUE_OWNER_COMPANION_PAIRING_SQL,
  OWNER_COMPANION_MINIMUM_VERSION,
  OWNER_COMPANION_PAIRING_ENDPOINT,
  OwnerCompanionDevicePairingNotReadyError,
  OwnerCompanionDevicePairingRejectedError,
  OwnerCompanionDevicePairingUnavailableError,
  PostgresOwnerCompanionDevicePairing,
} from './owner-companion-device-pairing.js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const signerKeyId = 'companion_server_signer_2026_01';
const issuedAt = new Date('2026-09-04T12:00:00.000Z');
const expiresAt = new Date('2026-09-04T12:10:00.000Z');

function signer() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = Buffer.from(pair.publicKey.export({ format: 'der', type: 'spki' }));
  return {
    encoded: spki.toString('base64url'),
    digest: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  const publicSigner = signer();
  return {
    pairing_id: '33333333-3333-4333-8333-333333333333',
    pairing_nonce_digest: `sha256:${'a'.repeat(64)}`,
    issued_at: issuedAt,
    expires_at: expiresAt,
    signer_key_id: signerKeyId,
    server_signing_public_key_spki: publicSigner.encoded,
    server_signing_public_key_spki_sha256: publicSigner.digest,
    minimum_companion_version: OWNER_COMPANION_MINIMUM_VERSION,
    replayed: false,
    ...overrides,
  };
}

describe('Owner Windows companion pairing', () => {
  it('issues one exact no-money package with a validated public server key', async () => {
    const query = vi.fn(async () => ({ rows: [row()] }));
    const issuer = new PostgresOwnerCompanionDevicePairing({ query }, signerKeyId);
    const receipt = await issuer.issue(authUserId, requestId);
    expect(query).toHaveBeenCalledWith(ISSUE_OWNER_COMPANION_PAIRING_SQL, [
      authUserId,
      requestId,
      signerKeyId,
      OWNER_COMPANION_MINIMUM_VERSION,
    ]);
    expect(receipt).toMatchObject({
      alreadyIssued: false,
      devicePlatform: 'windows',
      lookupAllowed: false,
      moneyMovementAllowed: false,
      pairingOnly: true,
      transferDisabled: true,
    });
    expect(receipt.pairingPackage.startsWith(AGENT_PLATFORM_COMPANION_PAIRING_PACKAGE_PREFIX)).toBe(
      true,
    );
    const decoded = JSON.parse(
      Buffer.from(
        receipt.pairingPackage.slice(AGENT_PLATFORM_COMPANION_PAIRING_PACKAGE_PREFIX.length),
        'base64url',
      ).toString('utf8'),
    ) as Record<string, unknown>;
    expect(decoded).toMatchObject({
      endpoint: OWNER_COMPANION_PAIRING_ENDPOINT,
      minimumCompanionVersion: OWNER_COMPANION_MINIMUM_VERSION,
      moneyMovementAllowed: false,
      transferAllowed: false,
      transferDisabled: true,
      oneUse: true,
    });
    expect(decoded).not.toHaveProperty('amount');
    expect(decoded).not.toHaveProperty('playerIds');
  });

  it('returns the same idempotent package metadata as already issued', async () => {
    const issuer = new PostgresOwnerCompanionDevicePairing(
      { query: async () => ({ rows: [row({ replayed: true })] }) },
      signerKeyId,
    );
    await expect(issuer.issue(authUserId, requestId)).resolves.toMatchObject({
      alreadyIssued: true,
      pairingOnly: true,
    });
  });

  it('rejects malformed authority inputs and malformed database signer material', async () => {
    expect(
      () => new PostgresOwnerCompanionDevicePairing({ query: async () => ({ rows: [] }) }, 'short'),
    ).toThrow(OwnerCompanionDevicePairingRejectedError);
    const issuer = new PostgresOwnerCompanionDevicePairing(
      {
        query: async () => ({
          rows: [row({ server_signing_public_key_spki_sha256: `sha256:${'0'.repeat(64)}` })],
        }),
      },
      signerKeyId,
    );
    await expect(issuer.issue(authUserId, requestId)).rejects.toThrow(
      OwnerCompanionDevicePairingUnavailableError,
    );
  });

  it('maps guarded PostgreSQL readiness rejection separately from availability failure', async () => {
    const notReady = new PostgresOwnerCompanionDevicePairing(
      {
        query: async () => {
          throw Object.assign(new Error(), { code: 'P0001' });
        },
      },
      signerKeyId,
    );
    await expect(notReady.issue(authUserId, requestId)).rejects.toThrow(
      OwnerCompanionDevicePairingNotReadyError,
    );
    const unavailable = new PostgresOwnerCompanionDevicePairing(
      {
        query: async () => {
          throw new Error();
        },
      },
      signerKeyId,
    );
    await expect(unavailable.issue(authUserId, requestId)).rejects.toThrow(
      OwnerCompanionDevicePairingUnavailableError,
    );
  });
});
