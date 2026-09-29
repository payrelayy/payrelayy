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
  COMPANION_EXECUTION_OPERATOR_BOOTSTRAP_PATH,
  digestCompanionExecutionOperatorBootstrapContent,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createProtectedOperatorBootstrapRequestHandler,
  OPERATOR_BOOTSTRAP_OWNER_SQL,
} from './protected-operator-bootstrap-request.js';
import type { ProtectedHandoffHttpRequest } from './protected-handoff-request.js';
import { SNAPSHOT_SQL } from './snapshot.js';

const serverSigner = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const serverSpki = Buffer.from(serverSigner.publicKey.export({ format: 'der', type: 'spki' }));
const deviceSpki = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
const sha = (character: string) => `sha256:${character.repeat(64)}`;
const digest = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const signature = (key: typeof device.privateKey, bytes: Uint8Array) =>
  sign('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
const requestKey = randomUUID();
const actorAuthUserId = randomUUID();
const certificateId = randomUUID();
const pilotRevisionId = randomUUID();
const accountId = randomUUID();
const signerKeyId = 'server-signing-key-0001';
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
  signature: signature(
    serverSigner.privateKey,
    canonicalCompanionEnrollmentCertificateSignatureBytes(certificateBody, signerKeyId)!,
  ),
};

function signedHttp(overrides: Partial<CompanionHttpRequestBody> = {}) {
  const body: CompanionHttpRequestBody = {
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    requestId: randomUUID(),
    certificateId,
    deviceId: certificateBody.deviceId,
    deviceKeyId: certificateBody.deviceKeyId,
    method: 'POST',
    canonicalPath: COMPANION_EXECUTION_OPERATOR_BOOTSTRAP_PATH,
    queryDigest: digestCompanionLookupEmptyQuery(),
    contentDigest: digestCompanionExecutionOperatorBootstrapContent(certificate.bodyDigest)!,
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
    signature: signature(device.privateKey, canonicalCompanionHttpRequestSignatureBytes(body)!),
  };
}

function request(overrides: Record<string, unknown> = {}): ProtectedHandoffHttpRequest {
  return {
    method: 'POST',
    path: COMPANION_EXECUTION_OPERATOR_BOOTSTRAP_PATH,
    headers: [
      ['content-type', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE],
      ['accept', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE],
    ],
    body: Buffer.from(JSON.stringify({ certificate, httpRequest: signedHttp(), ...overrides })),
  };
}

function fixture(
  ownerRows: readonly Record<string, unknown>[] = [{ actor_auth_user_id: actorAuthUserId }],
) {
  const query = vi.fn(async (sql: string, values: unknown[]) => {
    expect(values).toEqual([requestKey]);
    if (sql === OPERATOR_BOOTSTRAP_OWNER_SQL) return { rows: ownerRows };
    expect(sql).toBe(SNAPSHOT_SQL);
    return {
      rows: [
        {
          request_key: requestKey,
          request_pilot_revision_id: pilotRevisionId,
          request_activation_epoch: '1',
          request_certificate_id: certificateId,
          request_account_id: accountId,
          companion_release_sha: 'a'.repeat(40),
          companion_archive_sha256: sha('b'),
          companion_installation_tree_sha256: sha('c'),
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
        },
      ],
    };
  });
  const handler = createProtectedOperatorBootstrapRequestHandler({
    administrator: { query },
    requestKey,
    trustedNoMoneySignerKeyId: signerKeyId,
    trustedNoMoneySignerPublicKeySpkiDer: serverSpki,
    trustedNow: () => new Date('2026-09-27T12:01:00.000Z'),
  });
  return { handler, query };
}

describe('paired protected operator bootstrap', () => {
  it('returns only the live request and exact Owner actor after signed certificate checks', async () => {
    const { handler, query } = fixture();
    const response = await handler(request());
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(Buffer.from(response.body).toString('utf8'))).toEqual({
      requestKey,
      actorAuthUserId,
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(OPERATOR_BOOTSTRAP_OWNER_SQL).not.toMatch(
      /\b(insert|update|delete|truncate)\b|for\s+(share|update)/iu,
    );
  });

  it('rejects malformed, incorrectly signed, mismatched, or expired input before any lookup', async () => {
    const candidates = [
      { ...request(), path: '/wrong' },
      { ...request(), headers: [['content-type', 'text/plain']] },
      request({ extra: true }),
      request({ httpRequest: signedHttp({ contentDigest: sha('f') }) }),
      request({
        httpRequest: signedHttp({
          issuedAt: '2026-09-27T11:00:50.000Z',
          expiresAt: '2026-09-27T11:01:50.000Z',
        }),
      }),
      request({ certificate: { ...certificate, signature: 'tampered' } }),
    ];
    for (const candidate of candidates) {
      const { handler, query } = fixture();
      expect((await handler(candidate)).statusCode).toBe(503);
      expect(query).not.toHaveBeenCalled();
    }
  });

  it('fails closed when the Owner binding is absent or ambiguous', async () => {
    for (const rows of [
      [],
      [{ actor_auth_user_id: actorAuthUserId }, { actor_auth_user_id: actorAuthUserId }],
    ]) {
      const { handler, query } = fixture(rows);
      expect((await handler(request())).statusCode).toBe(503);
      expect(query).toHaveBeenCalledTimes(2);
    }
  });
});
