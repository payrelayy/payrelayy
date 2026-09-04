import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import {
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DEVICE_PLATFORM,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_PAIRING_PATH,
  AGENT_PLATFORM_COMPANION_PAIRING_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalCompanionPairingSignatureBytes,
  digestCompanionPairingPublicPayload,
  verifySignedCompanionEnrollmentCertificate,
  type CompanionEnrollmentCertificateBody,
  type CompanionNoMoneySafety,
  type CompanionPairingPublicPayload,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionPairingRequest,
} from '@fetanagent/agent-platform-companion-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createCompanionPairingHandler,
  createP256CompanionBridgeSigner,
  type CompanionBridgeHttpRequest,
} from './pairing-handler.js';

const assessedAt = '2026-09-04T12:00:05.000Z';

const safety: CompanionNoMoneySafety = Object.freeze({
  accountMutationAllowed: false,
  balanceMutationAllowed: false,
  providerMutationAllowed: false,
  paymentAllowed: false,
  depositAllowed: false,
  withdrawAllowed: false,
  transferAllowed: false,
  settlementAllowed: false,
  finalActionAllowed: false,
  financialActionAllowed: false,
  moneyMovementAllowed: false,
  transferDisabled: true,
  identifiersRedacted: true,
  moneyMoved: false,
});

function sha(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function pairingRequest(): SignedCompanionPairingRequest {
  const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
  const body: CompanionPairingPublicPayload = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    pairingId: '11111111-1111-4111-8111-111111111111',
    pairingNonceDigest: `sha256:${'a'.repeat(64)}`,
    deviceId: '22222222-2222-4222-8222-222222222222',
    deviceKeyId: '33333333-3333-4333-8333-333333333333',
    devicePublicKeySpki: spki.toString('base64url'),
    devicePublicKeySpkiSha256: sha(spki),
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    devicePlatform: AGENT_PLATFORM_COMPANION_DEVICE_PLATFORM,
    companionVersion: '0.1.4',
    issuedAt: '2026-09-04T12:00:00.000Z',
    expiresAt: '2026-09-04T12:10:00.000Z',
    oneUse: true,
    ...safety,
  });
  const bodyDigest = digestCompanionPairingPublicPayload(body)!;
  return Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_PAIRING_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    deviceKeyId: body.deviceKeyId,
    body,
    signature: sign('sha256', canonicalCompanionPairingSignatureBytes(body)!, {
      key: device.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  });
}

function certificateBody(
  request: SignedCompanionPairingRequest,
): CompanionEnrollmentCertificateBody {
  return Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    certificateId: randomUUID(),
    pairingId: request.body.pairingId,
    pairingRequestBodyDigest: request.bodyDigest,
    pairingNonceDigest: request.body.pairingNonceDigest,
    pairingConsumed: true,
    deviceId: request.body.deviceId,
    deviceKeyId: request.body.deviceKeyId,
    devicePublicKeySpki: request.body.devicePublicKeySpki,
    devicePublicKeySpkiSha256: request.body.devicePublicKeySpkiSha256,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    devicePlatform: AGENT_PLATFORM_COMPANION_DEVICE_PLATFORM,
    companionVersion: request.body.companionVersion,
    state: 'active',
    issuedAt: assessedAt,
    validFrom: assessedAt,
    validUntil: '2026-12-03T12:00:05.000Z',
    ...safety,
  });
}

function httpRequest(request: SignedCompanionPairingRequest): CompanionBridgeHttpRequest {
  return Object.freeze({
    method: 'POST',
    path: AGENT_PLATFORM_COMPANION_PAIRING_PATH,
    headers: Object.freeze([
      Object.freeze(['content-type', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE] as const),
      Object.freeze(['accept', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE] as const),
    ]),
    body: Buffer.from(JSON.stringify(request), 'utf8'),
  });
}

function fixture() {
  const request = pairingRequest();
  const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const serverSpki = Buffer.from(server.publicKey.export({ format: 'der', type: 'spki' }));
  const signer = createP256CompanionBridgeSigner(
    'companion-server-staging-v1',
    server.privateKey,
    serverSpki,
  );
  const state: { certificate?: SignedCompanionEnrollmentCertificate; claimed: boolean } = {
    claimed: false,
  };
  const claimPairing = vi.fn(async () => {
    if (state.certificate) return { kind: 'completed' as const, certificate: state.certificate };
    if (state.claimed) return { kind: 'in_progress' as const };
    state.claimed = true;
    return { kind: 'claimed' as const, certificateBody: certificateBody(request) };
  });
  const completePairing = vi.fn(
    async (_digest: string, certificate: SignedCompanionEnrollmentCertificate) => {
      state.certificate = certificate;
      state.claimed = false;
      return true;
    },
  );
  const releasePairing = vi.fn(async () => {
    state.claimed = false;
  });
  const handler = createCompanionPairingHandler({
    signer,
    now: () => assessedAt,
    claimPairing,
    completePairing,
    releasePairing,
  });
  return {
    request,
    serverSpki,
    signer,
    state,
    claimPairing,
    completePairing,
    releasePairing,
    handler,
  };
}

async function json(response: { readonly body: Uint8Array }): Promise<Record<string, unknown>> {
  return JSON.parse(Buffer.from(response.body).toString('utf8')) as Record<string, unknown>;
}

describe('companion device pairing handler', () => {
  it('consumes one signed challenge and returns a self-verified no-money certificate', async () => {
    const value = fixture();
    const response = await value.handler(httpRequest(value.request));
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const certificate = (await json(response)).certificate as SignedCompanionEnrollmentCertificate;
    expect(verifySignedCompanionEnrollmentCertificate(certificate, value.serverSpki)).toBe(true);
    expect(certificate.body).toMatchObject({
      transferDisabled: true,
      moneyMovementAllowed: false,
      moneyMoved: false,
      pairingConsumed: true,
      state: 'active',
    });
    expect(value.completePairing).toHaveBeenCalledWith(value.request.bodyDigest, certificate);
  });

  it('recovers the exact stored certificate after a lost response without signing twice', async () => {
    const value = fixture();
    const first = await value.handler(httpRequest(value.request));
    const firstCertificate = (await json(first)).certificate;
    const second = await value.handler(httpRequest(value.request));
    expect(second.statusCode).toBe(200);
    expect((await json(second)).certificate).toEqual(firstCertificate);
    expect(value.completePairing).toHaveBeenCalledTimes(1);
  });

  it('rejects expiry, altered signatures, duplicate framing headers, and non-pairing paths', async () => {
    const expired = fixture();
    const expiredHandler = createCompanionPairingHandler({
      signer: expired.signer,
      now: () => '2026-09-04T12:10:00.000Z',
      claimPairing: expired.claimPairing,
      completePairing: expired.completePairing,
      releasePairing: expired.releasePairing,
    });
    expect((await expiredHandler(httpRequest(expired.request))).statusCode).toBe(401);
    expect(expired.claimPairing).not.toHaveBeenCalled();

    const altered = fixture();
    const alteredSignature = Buffer.from(altered.request.signature, 'base64url');
    alteredSignature[0] = (alteredSignature[0] ?? 0) ^ 1;
    const alteredRequest = {
      ...altered.request,
      signature: alteredSignature.toString('base64url'),
    };
    expect((await altered.handler(httpRequest(alteredRequest))).statusCode).toBe(401);

    const duplicate = httpRequest(altered.request);
    expect(
      (
        await altered.handler({
          ...duplicate,
          headers: [
            ...duplicate.headers,
            ['Content-Type', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE],
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect((await altered.handler({ ...duplicate, path: '/v1/transfer' })).statusCode).toBe(400);
  });

  it('releases an unsigned claim when the database returns a mismatched certificate body', async () => {
    const value = fixture();
    const handler = createCompanionPairingHandler({
      signer: value.signer,
      now: () => assessedAt,
      claimPairing: async () => ({
        kind: 'claimed',
        certificateBody: { ...certificateBody(value.request), deviceId: randomUUID() },
      }),
      completePairing: value.completePairing,
      releasePairing: value.releasePairing,
    });
    expect((await handler(httpRequest(value.request))).statusCode).toBe(503);
    expect(value.releasePairing).toHaveBeenCalledWith(value.request.bodyDigest);
    expect(value.completePairing).not.toHaveBeenCalled();
  });

  it('keeps a possibly committed claim after an uncertain completion acknowledgement', async () => {
    const value = fixture();
    const handler = createCompanionPairingHandler({
      signer: value.signer,
      now: () => assessedAt,
      claimPairing: value.claimPairing,
      completePairing: async (_digest, certificate) => {
        value.state.certificate = certificate;
        throw new Error('acknowledgement lost');
      },
      releasePairing: value.releasePairing,
    });
    expect((await handler(httpRequest(value.request))).statusCode).toBe(503);
    expect(value.releasePairing).not.toHaveBeenCalled();
    expect((await handler(httpRequest(value.request))).statusCode).toBe(200);
  });
});
