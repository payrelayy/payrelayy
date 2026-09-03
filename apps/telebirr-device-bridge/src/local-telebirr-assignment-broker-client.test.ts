import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
  TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_POLL_PATH,
  TELEBIRR_DEVICE_BRIDGE_REQUEST_TRANSCRIPT_VERSION,
  canonicalTelebirrDeviceBridgeRequestSignatureBytes,
  decodeTelebirrAssignmentBrokerLocalPollRequestBytes,
  digestTelebirrDeviceBridgePayload,
  digestTelebirrDeviceBridgeRequestBody,
  encodeTelebirrAssignmentBrokerLocalPollResponse,
  type SignedTelebirrDeviceBridgeRequest,
  type TelebirrDeviceBridgeAssignmentPollPayload,
  type TelebirrDeviceBridgeEnrollmentCertificateBody,
  type TelebirrDeviceBridgeRequestBody,
} from '@fetanagent/telebirr-verification-foundation';
import { describe, expect, it, vi } from 'vitest';

import {
  createTelebirrAssignmentBrokerLocalPollAdapter,
  createTelebirrAssignmentBrokerUnixPollAssignment,
} from './local-telebirr-assignment-broker-client.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;

function keyPair(): {
  readonly privateKey: KeyObject;
  readonly spki: Buffer;
  readonly digest: string;
} {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }));
  return {
    privateKey: pair.privateKey,
    spki,
    digest: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
  };
}

function certificate(
  device: ReturnType<typeof keyPair>,
  assignmentSigner: ReturnType<typeof keyPair>,
): TelebirrDeviceBridgeEnrollmentCertificateBody {
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
    devicePublicKeySpki: device.spki.toString('base64url'),
    devicePublicKeySpkiSha256: device.digest,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    devicePlatform: 'android',
    minimumAppVersion: '0.3.0-device-bridge-inert',
    pilotRevisionId: 'pilot-revision-0000001',
    receiverRevisionId: 'pilot-receiver-revision-0001',
    receiverProfileId: 'pilot-receiver-profile-00001',
    receiverProfileDigest: sha('3'),
    receiverConfigurationDigest: sha('4'),
    assignmentSignerKeyId: 'pilot-assignment-key-0001',
    assignmentSignerPublicKeySpkiSha256: assignmentSigner.digest,
    state: 'active',
    issuedAt: '2026-09-04T10:00:00.000Z',
    validFrom: '2026-09-04T10:00:00.000Z',
    validUntil: '2026-10-04T10:00:00.000Z',
    ...TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
  };
}

function signedRequest(
  device: ReturnType<typeof keyPair>,
  certificateBody: TelebirrDeviceBridgeEnrollmentCertificateBody,
  payload: TelebirrDeviceBridgeAssignmentPollPayload,
): SignedTelebirrDeviceBridgeRequest {
  const body: TelebirrDeviceBridgeRequestBody = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'device_bridge_no_money_v1',
    requestId: 'bridge-request-0000001',
    enrollmentId: certificateBody.enrollmentId,
    deviceId: certificateBody.deviceId,
    keyId: certificateBody.keyId,
    command: 'assignment_poll',
    method: 'POST',
    canonicalPath: TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_POLL_PATH,
    payloadDigest: digestTelebirrDeviceBridgePayload('assignment_poll', payload)!,
    nonceDigest: sha('5'),
    issuedAt: '2026-09-04T10:01:00.000Z',
    expiresAt: '2026-09-04T10:03:00.000Z',
    ...TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
  };
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'device_bridge_no_money_v1',
    transcriptVersion: TELEBIRR_DEVICE_BRIDGE_REQUEST_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestTelebirrDeviceBridgeRequestBody(body)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    keyId: body.keyId,
    body,
    signature: sign('sha256', canonicalTelebirrDeviceBridgeRequestSignatureBytes(body)!, {
      key: device.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
}

function noAssignmentResponse(): Buffer {
  return encodeTelebirrAssignmentBrokerLocalPollResponse({
    contractVersion: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
    providerCode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
    protocolMode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
    outcome: 'no_assignment',
    assignment: null,
    ...TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
  })!;
}

describe('local TeleBirr assignment broker bridge adapter', () => {
  it('binds the authenticated request digest and exact lease request into one local poll', async () => {
    const device = keyPair();
    const certificateBody = certificate(device, keyPair());
    const payload = { requestedLeaseSeconds: 120 } as const;
    const request = signedRequest(device, certificateBody, payload);
    const exchange = vi.fn(async (bytes: Uint8Array) => {
      const decoded = decodeTelebirrAssignmentBrokerLocalPollRequestBytes(bytes);
      expect(decoded?.certificate).toEqual(certificateBody);
      expect(decoded?.bridgeRequestBodyDigest).toBe(request.bodyDigest);
      expect(decoded?.requestedLeaseSeconds).toBe(120);
      return noAssignmentResponse();
    });
    const poll = createTelebirrAssignmentBrokerLocalPollAdapter(exchange);
    await expect(poll(certificateBody, request, payload)).resolves.toEqual({ kind: 'none' });
    expect(exchange).toHaveBeenCalledOnce();
  });

  it('fails closed before transport if the signed request and payload do not match', async () => {
    const device = keyPair();
    const certificateBody = certificate(device, keyPair());
    const payload = { requestedLeaseSeconds: 120 } as const;
    const request = signedRequest(device, certificateBody, payload);
    const exchange = vi.fn(async () => noAssignmentResponse());
    const poll = createTelebirrAssignmentBrokerLocalPollAdapter(exchange);
    await expect(poll(certificateBody, request, { requestedLeaseSeconds: 121 })).resolves.toEqual({
      kind: 'retry',
    });
    expect(exchange).not.toHaveBeenCalled();
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
  ])('reduces $name to the bridge retry outcome', async ({ exchange }) => {
    const device = keyPair();
    const certificateBody = certificate(device, keyPair());
    const payload = { requestedLeaseSeconds: 120 } as const;
    const poll = createTelebirrAssignmentBrokerLocalPollAdapter(exchange);
    await expect(
      poll(certificateBody, signedRequest(device, certificateBody, payload), payload),
    ).resolves.toEqual({ kind: 'retry' });
  });

  it('keeps the production transport fixed to a Unix socket with no private runtime import', async () => {
    expect(typeof createTelebirrAssignmentBrokerUnixPollAssignment()).toBe('function');
    const source = await readFile(
      new URL('./local-telebirr-assignment-broker-client.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('socketPath: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET');
    expect(source).not.toMatch(/\b(?:service_role|SUPABASE|DATABASE_URL|from ['"]pg['"])\b/u);
    expect(source).not.toMatch(/https?:\/\//u);
  });
});
