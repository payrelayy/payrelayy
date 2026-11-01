import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import {
  AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_KEMERBET_SIGNIN_PATH,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalCompanionEnrollmentCertificateSignatureBytes,
  canonicalCompanionHttpRequestSignatureBytes,
  digestCompanionEnrollmentCertificateBody,
  digestCompanionHttpRequestBody,
  digestCompanionKemerBetSigninContent,
  digestCompanionLookupEmptyQuery,
  type CompanionEnrollmentCertificateBody,
  type CompanionHttpRequestBody,
} from '@fetanagent/agent-platform-companion-contracts';
import { describe, expect, it, vi } from 'vitest';

import { createKemerBetSigninHandler } from './kemerbet-signin-handler.js';
import { createP256CompanionBridgeSigner } from './pairing-handler.js';

const assessedAt = '2026-11-02T09:00:10.000Z';
const accountId = 'd992b42a-16f6-445e-b904-922b0c3faacc';
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const safety = {
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
} as const;

function fixture() {
  const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const deviceSpki = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
  const serverSpki = Buffer.from(server.publicKey.export({ format: 'der', type: 'spki' }));
  const certificateBody: CompanionEnrollmentCertificateBody = {
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    certificateId: '3c1482a3-e325-4870-810a-3f46a282e2a2',
    pairingId: 'b2b94250-d55a-4526-bf1c-59c606996cbb',
    pairingRequestBodyDigest: digest('1'),
    pairingNonceDigest: digest('2'),
    pairingConsumed: true,
    deviceId: 'windows-device-0001',
    deviceKeyId: 'windows-device-key-0001',
    devicePublicKeySpki: deviceSpki.toString('base64url'),
    devicePublicKeySpkiSha256: `sha256:${createHash('sha256').update(deviceSpki).digest('hex')}`,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    devicePlatform: 'windows',
    companionVersion: '0.1.74',
    state: 'active',
    issuedAt: '2026-11-02T08:59:00.000Z',
    validFrom: '2026-11-02T08:59:00.000Z',
    validUntil: '2026-12-02T08:59:00.000Z',
    ...safety,
  };
  const signerKeyId = 'server-signing-key-0001';
  const certificate = {
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest: digestCompanionEnrollmentCertificateBody(certificateBody)!,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    signerKeyId,
    body: certificateBody,
    signature: sign(
      'sha256',
      canonicalCompanionEnrollmentCertificateSignatureBytes(certificateBody, signerKeyId)!,
      { key: server.privateKey, dsaEncoding: 'ieee-p1363' },
    ).toString('base64url'),
  };
  const requestBody: CompanionHttpRequestBody = {
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    requestId: 'signin-request-0001',
    certificateId: certificateBody.certificateId,
    deviceId: certificateBody.deviceId,
    deviceKeyId: certificateBody.deviceKeyId,
    method: 'POST',
    canonicalPath: AGENT_PLATFORM_COMPANION_KEMERBET_SIGNIN_PATH,
    queryDigest: digestCompanionLookupEmptyQuery(),
    contentDigest: digestCompanionKemerBetSigninContent(certificate.bodyDigest, accountId)!,
    nonceDigest: digest('3'),
    issuedAt: '2026-11-02T09:00:05.000Z',
    expiresAt: '2026-11-02T09:00:35.000Z',
    ...safety,
  };
  const httpRequest = {
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest: digestCompanionHttpRequestBody(requestBody)!,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    deviceKeyId: certificateBody.deviceKeyId,
    body: requestBody,
    signature: sign('sha256', canonicalCompanionHttpRequestSignatureBytes(requestBody)!, {
      key: device.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
  const makeRequest = (presentedAccount = accountId) => ({
    method: 'POST',
    path: AGENT_PLATFORM_COMPANION_KEMERBET_SIGNIN_PATH,
    headers: [
      ['content-type', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE],
      ['accept', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE],
    ] as const,
    body: Buffer.from(
      JSON.stringify({ certificate, httpRequest, platformAgentAccountId: presentedAccount }),
    ),
  });
  return {
    signer: createP256CompanionBridgeSigner(signerKeyId, server.privateKey, serverSpki),
    makeRequest,
  };
}

describe('paired KemerBet sign-in endpoint', () => {
  it('returns the current credential only for the signed account and never accepts account substitution', async () => {
    const value = fixture();
    const query = vi.fn(async () => ({
      rows: [{ username: 'agent', password: 'secret', revision: 2 }],
    }));
    const handler = createKemerBetSigninHandler({
      signer: value.signer,
      database: { query },
      now: () => assessedAt,
    });
    const accepted = await handler(value.makeRequest());
    expect(accepted.statusCode).toBe(200);
    expect(JSON.parse(Buffer.from(accepted.body).toString('utf8'))).toEqual({
      settings: { username: 'agent', password: 'secret', revision: 2 },
    });
    expect(accepted.headers['cache-control']).toBe('no-store');
    const substituted = await handler(value.makeRequest('ab8b8fad-9520-401d-9e8c-62d3045114b7'));
    expect(substituted.statusCode).toBe(401);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
