import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import {
  AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalCompanionEnrollmentCertificateSignatureBytes,
  canonicalCompanionHttpRequestSignatureBytes,
  digestCompanionEnrollmentCertificateBody,
  digestCompanionHttpRequestBody,
  digestCompanionLookupEmptyQuery,
  type CompanionEnrollmentCertificateBody,
  type CompanionHttpRequestBody,
  type CompanionNoMoneySafety,
} from '@fetanagent/agent-platform-companion-contracts';
import {
  COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
  digestCompanionExecutionHandoffSigningContent,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it, vi } from 'vitest';

import { signGuardedServerCompanionHandoffWithSigner } from './guarded-server-handoff-signer.js';
import {
  createProtectedHandoffRequestHandlerWithSigner,
  type ProtectedHandoffHttpRequest,
  type ProtectedHandoffRequestDependencies,
} from './protected-handoff-request.js';

const noMoneySigner = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const executionSigner = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const noMoneySpki = Buffer.from(noMoneySigner.publicKey.export({ format: 'der', type: 'spki' }));
const deviceSpki = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
const executionSpki = Buffer.from(
  executionSigner.publicKey.export({ format: 'der', type: 'spki' }),
);
const digest = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const sha = (character: string) => `sha256:${character.repeat(64)}`;
const encodeSignature = (key: typeof device.privateKey, bytes: Uint8Array) =>
  sign('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
const safe: CompanionNoMoneySafety = {
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
};
const requestKey = randomUUID();
const pilotRevisionId = randomUUID();
const certificateId = randomUUID();
const accountId = randomUUID();
const now = '2026-09-27T12:01:00.000Z';
const release = {
  releaseSha: 'a'.repeat(40),
  archiveSha256: sha('b'),
  installationTreeSha256: sha('c'),
  observedAt: '2026-09-27T12:00:30.000Z',
};
const certificateBody: CompanionEnrollmentCertificateBody = {
  contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  certificateId,
  pairingId: 'pairing-request-0001',
  pairingRequestBodyDigest: sha('1'),
  pairingNonceDigest: sha('2'),
  pairingConsumed: true,
  deviceId: 'windows-device-0001',
  deviceKeyId: 'windows-device-key-0001',
  devicePublicKeySpki: deviceSpki.toString('base64url'),
  devicePublicKeySpkiSha256: digest(deviceSpki),
  signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  devicePlatform: 'windows',
  companionVersion: '0.1.11',
  state: 'active',
  issuedAt: '2026-09-27T11:00:00.000Z',
  validFrom: '2026-09-27T11:00:00.000Z',
  validUntil: '2026-09-27T15:00:00.000Z',
  ...safe,
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
  signature: encodeSignature(
    noMoneySigner.privateKey,
    canonicalCompanionEnrollmentCertificateSignatureBytes(certificateBody, signerKeyId)!,
  ),
};
const trustedExecutionSigner = {
  keyId: 'test-execution-signer',
  publicKeySpkiSha256: digest(executionSpki),
};

function row() {
  return {
    request_key: requestKey,
    request_pilot_revision_id: pilotRevisionId,
    request_activation_epoch: '1',
    request_certificate_id: certificateId,
    request_account_id: accountId,
    companion_release_sha: release.releaseSha,
    companion_archive_sha256: release.archiveSha256,
    companion_installation_tree_sha256: release.installationTreeSha256,
    requested_at: new Date('2026-09-27T12:00:00.000Z'),
    request_expires_at: new Date('2026-09-27T12:10:00.000Z'),
    current_pilot_revision_id: pilotRevisionId,
    current_activation_epoch: '1',
    current_certificate_id: certificateId,
    current_account_id: accountId,
    certificate_body_digest: certificate.bodyDigest,
    device_key_id: certificateBody.deviceKeyId,
    device_public_key_spki: certificateBody.devicePublicKeySpki,
    device_public_key_spki_sha256: certificateBody.devicePublicKeySpkiSha256,
    certificate_valid_from: new Date(certificateBody.validFrom),
    certificate_valid_until: new Date(certificateBody.validUntil),
  };
}

function signedHttp(overrides: Partial<CompanionHttpRequestBody> = {}) {
  const body: CompanionHttpRequestBody = {
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    requestId: randomUUID(),
    certificateId,
    deviceId: certificateBody.deviceId,
    deviceKeyId: certificateBody.deviceKeyId,
    method: 'POST',
    canonicalPath: COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
    queryDigest: digestCompanionLookupEmptyQuery(),
    contentDigest: digestCompanionExecutionHandoffSigningContent(
      requestKey,
      certificate.bodyDigest,
    )!,
    nonceDigest: sha('3'),
    issuedAt: '2026-09-27T12:00:50.000Z',
    expiresAt: '2026-09-27T12:01:50.000Z',
    ...safe,
    ...overrides,
  };
  return {
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest: digestCompanionHttpRequestBody(body)!,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    deviceKeyId: certificateBody.deviceKeyId,
    body,
    signature: encodeSignature(
      device.privateKey,
      canonicalCompanionHttpRequestSignatureBytes(body)!,
    ),
  };
}

function httpRequest(overrides: Record<string, unknown> = {}): ProtectedHandoffHttpRequest {
  return {
    method: 'POST',
    path: COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
    headers: [
      ['content-type', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE],
      ['accept', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE],
    ],
    body: Buffer.from(
      JSON.stringify({ requestKey, certificate, httpRequest: signedHttp(), ...overrides }),
      'utf8',
    ),
  };
}

function fixture() {
  const query = vi.fn(async () => ({ rows: [row()] }));
  const dependencies: ProtectedHandoffRequestDependencies = {
    administrator: { query },
    trustedNoMoneySignerKeyId: signerKeyId,
    trustedNoMoneySignerPublicKeySpkiDer: noMoneySpki,
    signerPrivateKey: executionSigner.privateKey,
    verifyPublishedRelease: vi.fn(async () => release),
    trustedNow: () => new Date(now),
  };
  const signer = vi.fn((input) =>
    signGuardedServerCompanionHandoffWithSigner(input, trustedExecutionSigner),
  );
  return { dependencies, signer, query };
}

describe('protected paired handoff signing request', () => {
  it('signs only one certificate-bound live database request and never repeats it', async () => {
    const { dependencies, signer, query } = fixture();
    const handler = createProtectedHandoffRequestHandlerWithSigner(dependencies, signer);
    const first = await handler(httpRequest());
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(Buffer.from(first.body).toString('utf8')).body).toMatchObject({
      requestKey,
      noMoneyCertificateBodyDigest: certificate.bodyDigest,
    });
    expect(signer).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(4);
    expect((await handler(httpRequest())).statusCode).toBe(503);
    expect(signer).toHaveBeenCalledTimes(1);
  });

  it('rejects unsigned, tampered, mismatched, expired, or malformed requests before signing', async () => {
    const candidates: ProtectedHandoffHttpRequest[] = [
      { ...httpRequest(), path: '/wrong' },
      { ...httpRequest(), headers: [['content-type', 'text/plain']] },
      {
        ...httpRequest(),
        headers: [
          ['content-type', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE],
          ['content-type', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE],
          ['accept', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE],
        ],
      },
      httpRequest({ requestKey: randomUUID() }),
      httpRequest({ httpRequest: signedHttp({ canonicalPath: '/wrong' }) }),
      httpRequest({ httpRequest: signedHttp({ queryDigest: sha('f') }) }),
      httpRequest({ httpRequest: signedHttp({ contentDigest: sha('f') }) }),
      httpRequest({ httpRequest: signedHttp({ expiresAt: '2026-09-27T12:00:59.000Z' }) }),
      httpRequest({ certificate: { ...certificate, signature: 'invalid' } }),
      { ...httpRequest(), body: Buffer.from('{}') },
      {
        ...httpRequest(),
        body: Buffer.from(` ${Buffer.from(httpRequest().body).toString('utf8')}`),
      },
    ];
    for (const candidate of candidates) {
      const { dependencies, signer } = fixture();
      expect(
        (await createProtectedHandoffRequestHandlerWithSigner(dependencies, signer)(candidate))
          .statusCode,
      ).toBe(503);
      expect(signer).not.toHaveBeenCalled();
    }
  });

  it('rejects a certificate not matching the live database snapshot', async () => {
    const { dependencies, signer } = fixture();
    const handler = createProtectedHandoffRequestHandlerWithSigner(
      {
        ...dependencies,
        administrator: {
          query: async () => ({ rows: [{ ...row(), certificate_body_digest: sha('e') }] }),
        },
      },
      signer,
    );
    expect((await handler(httpRequest())).statusCode).toBe(503);
    expect(signer).not.toHaveBeenCalled();
  });

  it('consumes the handler after an authenticated signing failure without returning detail', async () => {
    const { dependencies } = fixture();
    const failing = vi.fn(async () => {
      throw new Error('private database error text');
    });
    const handler = createProtectedHandoffRequestHandlerWithSigner(dependencies, failing);
    const first = await handler(httpRequest());
    expect(first.statusCode).toBe(503);
    expect(Buffer.from(first.body).toString('utf8')).toBe('{"code":"temporarily_unavailable"}');
    expect((await handler(httpRequest())).statusCode).toBe(503);
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
