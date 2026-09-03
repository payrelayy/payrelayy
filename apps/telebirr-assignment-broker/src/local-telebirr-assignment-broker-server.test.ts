import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTENT_TYPE,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_POLL_PATH,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
  decodeTelebirrAssignmentBrokerLocalPollResponseBytes,
  encodeTelebirrAssignmentBrokerLocalPollRequest,
  type TelebirrDeviceBridgeEnrollmentCertificateBody,
} from '@fetanagent/telebirr-verification-foundation';
import { describe, expect, it, vi } from 'vitest';

import {
  createTelebirrAssignmentBrokerLocalHandler,
  createTelebirrAssignmentBrokerLocalUnixServer,
  type TelebirrAssignmentBrokerLocalHttpRequest,
} from './local-telebirr-assignment-broker-server.js';
import type { TelebirrAssignmentBrokerPollInput } from './telebirr-assignment-broker.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;

function certificate(): TelebirrDeviceBridgeEnrollmentCertificateBody {
  const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const deviceSpki = Buffer.from(device.publicKey.export({ type: 'spki', format: 'der' }));
  const signer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signerSpki = Buffer.from(signer.publicKey.export({ type: 'spki', format: 'der' }));
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'device_bridge_no_money_v1',
    enrollmentId: 'pilot-enrollment-0001',
    pairingId: 'pilot-pairing-0000001',
    pairingRequestBodyDigest: sha('1'),
    pairingNonceDigest: sha('2'),
    pairingConsumed: true,
    deviceId: 'pilot-device-00000001',
    keyId: 'pilot-device-key-0001',
    devicePublicKeySpki: deviceSpki.toString('base64url'),
    devicePublicKeySpkiSha256: `sha256:${createHash('sha256').update(deviceSpki).digest('hex')}`,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    devicePlatform: 'android',
    minimumAppVersion: '0.3.0-device-bridge-inert',
    pilotRevisionId: 'pilot-revision-0000001',
    receiverRevisionId: 'pilot-receiver-revision-0001',
    receiverProfileId: 'pilot-receiver-profile-00001',
    receiverProfileDigest: sha('3'),
    receiverConfigurationDigest: sha('4'),
    assignmentSignerKeyId: 'pilot-assignment-key-0001',
    assignmentSignerPublicKeySpkiSha256: `sha256:${createHash('sha256')
      .update(signerSpki)
      .digest('hex')}`,
    state: 'active',
    issuedAt: '2026-09-04T10:00:00.000Z',
    validFrom: '2026-09-04T10:00:00.000Z',
    validUntil: '2026-10-04T10:00:00.000Z',
    ...TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
  };
}

function canonicalBody(): Buffer {
  return encodeTelebirrAssignmentBrokerLocalPollRequest({
    contractVersion: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
    providerCode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
    protocolMode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
    certificate: certificate(),
    bridgeRequestBodyDigest: sha('5'),
    requestedLeaseSeconds: 120,
    ...TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
  })!;
}

function httpRequest(
  body: Buffer,
  overrides: Partial<TelebirrAssignmentBrokerLocalHttpRequest> = {},
): TelebirrAssignmentBrokerLocalHttpRequest {
  return {
    method: 'POST',
    path: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_POLL_PATH,
    headers: [
      ['content-type', TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTENT_TYPE],
      ['content-length', String(body.byteLength)],
    ],
    body,
    ...overrides,
  };
}

describe('local TeleBirr assignment broker server', () => {
  it('maps one exact canonical request into one private broker poll', async () => {
    const poll = vi.fn(async (_input: TelebirrAssignmentBrokerPollInput) => ({
      kind: 'no_assignment' as const,
    }));
    const handler = createTelebirrAssignmentBrokerLocalHandler(poll);
    const body = canonicalBody();
    const result = await handler(httpRequest(body));
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toBe(TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTENT_TYPE);
    expect(decodeTelebirrAssignmentBrokerLocalPollResponseBytes(result.body)?.outcome).toBe(
      'no_assignment',
    );
    expect(poll).toHaveBeenCalledOnce();
    expect(poll.mock.calls[0]?.[0]).toMatchObject({
      bridgeRequestBodyDigest: sha('5'),
      requestedLeaseSeconds: 120,
    });
  });

  it.each([
    { name: 'wrong method', override: { method: 'GET' } },
    { name: 'query path', override: { path: `${TELEBIRR_ASSIGNMENT_BROKER_LOCAL_POLL_PATH}?x=1` } },
    {
      name: 'duplicate content type',
      override: {
        headers: [
          ['content-type', TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTENT_TYPE],
          ['Content-Type', TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTENT_TYPE],
          ['content-length', '<length>'],
        ],
      },
    },
    {
      name: 'content encoding',
      override: {
        headers: [
          ['content-type', TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTENT_TYPE],
          ['content-length', '<length>'],
          ['content-encoding', 'gzip'],
        ],
      },
    },
    {
      name: 'transfer encoding',
      override: {
        headers: [
          ['content-type', TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTENT_TYPE],
          ['content-length', '<length>'],
          ['transfer-encoding', 'chunked'],
        ],
      },
    },
  ])('rejects ambiguous HTTP framing: $name', async ({ override }) => {
    const poll = vi.fn(async () => ({ kind: 'no_assignment' as const }));
    const handler = createTelebirrAssignmentBrokerLocalHandler(poll);
    const body = canonicalBody();
    const rawOverride = override as Partial<TelebirrAssignmentBrokerLocalHttpRequest>;
    const headers = rawOverride.headers?.map(
      ([name, value]) => [name, value === '<length>' ? String(body.byteLength) : value] as const,
    );
    const result = await handler(
      httpRequest(body, { ...rawOverride, ...(headers === undefined ? {} : { headers }) }),
    );
    expect(result.statusCode).toBe(400);
    expect(poll).not.toHaveBeenCalled();
  });

  it('returns only an opaque temporary failure when the private poll fails', async () => {
    const handler = createTelebirrAssignmentBrokerLocalHandler(async () => {
      throw new Error(`must-not-leak-${sha('9')}`);
    });
    const result = await handler(httpRequest(canonicalBody()));
    expect(result.statusCode).toBe(503);
    expect(Buffer.from(result.body).toString('utf8')).toBe(
      JSON.stringify({ code: 'temporarily_unavailable' }),
    );
    expect(Buffer.from(result.body).toString('utf8')).not.toContain('must-not-leak');
  });

  it('constructs only a fixed Unix-socket server with a mode-0600 endpoint', async () => {
    const runtime = createTelebirrAssignmentBrokerLocalUnixServer(async () => ({
      kind: 'no_assignment',
    }));
    expect(runtime.server.listening).toBe(false);
    await runtime.close();

    const source = await readFile(
      new URL('./local-telebirr-assignment-broker-server.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('server.listen(TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET');
    expect(source).toContain('chmod(TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET, 0o600)');
    expect(source).not.toMatch(/server\.listen\(\s*\{/u);
    expect(source).not.toMatch(/\b(?:service_role|SUPABASE|DATABASE_URL)\b/u);
  });
});
