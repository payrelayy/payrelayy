import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  AGENT_PLATFORM_COMPANION_ASSIGNMENT_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_PAIRING_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_RESULT_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalCompanionEnrollmentCertificateSignatureBytes,
  canonicalCompanionHttpRequestBodyBytes,
  canonicalCompanionHttpRequestSignatureBytes,
  canonicalCompanionPairingPublicPayloadBytes,
  canonicalCompanionPairingSignatureBytes,
  canonicalKemerBetExactFiveLookupAssignmentBodyBytes,
  canonicalKemerBetExactFiveLookupAssignmentSignatureBytes,
  canonicalKemerBetExactFiveLookupResultBodyBytes,
  canonicalKemerBetExactFiveLookupResultSignatureBytes,
  certificateMatchesPairingRequest,
  decodeCompanionEnrollmentCertificateBody,
  decodeCompanionHttpRequestBody,
  decodeCompanionPairingPublicPayload,
  decodeKemerBetExactFiveLookupAssignmentBody,
  decodeKemerBetExactFiveLookupResultBody,
  decodeSignedCompanionEnrollmentCertificate,
  decodeSignedCompanionHttpRequest,
  decodeSignedCompanionPairingRequest,
  decodeSignedKemerBetExactFiveLookupAssignment,
  decodeSignedKemerBetExactFiveLookupResult,
  deriveCompanionHttpRequestReplayIdentity,
  deriveCompanionPairingReplayIdentity,
  deriveKemerBetExactFiveLookupAssignmentReplayIdentity,
  digestCompanionEnrollmentCertificateBody,
  digestCompanionHttpRequestBody,
  digestCompanionPairingPublicPayload,
  digestCompanionPlayerId,
  digestKemerBetExactFiveLookupAssignmentBody,
  digestKemerBetExactFiveLookupResultBody,
  verifyKemerBetExactFiveLookupExchange,
  verifySignedCompanionEnrollmentCertificate,
  verifySignedCompanionHttpRequest,
  verifySignedCompanionPairingRequest,
  verifySignedKemerBetExactFiveLookupAssignment,
  verifySignedKemerBetExactFiveLookupResult,
  type CompanionEnrollmentCertificateBody,
  type CompanionHttpRequestBody,
  type CompanionNoMoneySafety,
  type CompanionPairingPublicPayload,
  type CompanionPlayerLookupResultItem,
  type KemerBetExactFiveLookupAssignmentBody,
  type KemerBetExactFiveLookupResultBody,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionHttpRequest,
  type SignedCompanionPairingRequest,
  type SignedKemerBetExactFiveLookupAssignment,
  type SignedKemerBetExactFiveLookupResult,
} from './index.js';

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

const sha = (character: string): string => `sha256:${character.repeat(64)}`;

interface KeyFixture {
  readonly privateKey: KeyObject;
  readonly spki: Buffer;
  readonly encodedSpki: string;
  readonly digest: string;
}

function keyPair(namedCurve = 'prime256v1'): KeyFixture {
  const pair = generateKeyPairSync('ec', { namedCurve });
  const spki = Buffer.from(pair.publicKey.export({ format: 'der', type: 'spki' }));
  return {
    privateKey: pair.privateKey,
    spki,
    encodedSpki: spki.toString('base64url'),
    digest: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
  };
}

function p1363(privateKey: KeyObject, bytes: Uint8Array): string {
  return sign('sha256', bytes, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString(
    'base64url',
  );
}

function pairingBody(
  device: KeyFixture,
  overrides: Partial<CompanionPairingPublicPayload> = {},
): CompanionPairingPublicPayload {
  return {
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    pairingId: 'pairing-request-0001',
    pairingNonceDigest: sha('1'),
    deviceId: 'windows-device-0001',
    deviceKeyId: 'windows-device-key-0001',
    devicePublicKeySpki: device.encodedSpki,
    devicePublicKeySpkiSha256: device.digest,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    devicePlatform: 'windows',
    companionVersion: '1.0.0',
    issuedAt: '2026-09-02T10:00:00.000Z',
    expiresAt: '2026-09-02T10:05:00.000Z',
    oneUse: true,
    ...safe,
    ...overrides,
  };
}

function signedPairing(
  body: CompanionPairingPublicPayload,
  deviceKey: KeyObject,
  overrides: Partial<SignedCompanionPairingRequest> = {},
): SignedCompanionPairingRequest {
  return {
    contractVersion: 1,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_PAIRING_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest: digestCompanionPairingPublicPayload(body)!,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    deviceKeyId: body.deviceKeyId,
    body,
    signature: p1363(deviceKey, canonicalCompanionPairingSignatureBytes(body)!),
    ...overrides,
  };
}

function certificateBody(
  pairing: SignedCompanionPairingRequest,
  overrides: Partial<CompanionEnrollmentCertificateBody> = {},
): CompanionEnrollmentCertificateBody {
  return {
    contractVersion: 1,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    certificateId: 'device-certificate-0001',
    pairingId: pairing.body.pairingId,
    pairingRequestBodyDigest: pairing.bodyDigest,
    pairingNonceDigest: pairing.body.pairingNonceDigest,
    pairingConsumed: true,
    deviceId: pairing.body.deviceId,
    deviceKeyId: pairing.body.deviceKeyId,
    devicePublicKeySpki: pairing.body.devicePublicKeySpki,
    devicePublicKeySpkiSha256: pairing.body.devicePublicKeySpkiSha256,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    devicePlatform: 'windows',
    companionVersion: pairing.body.companionVersion,
    state: 'active',
    issuedAt: '2026-09-02T10:00:30.000Z',
    validFrom: '2026-09-02T10:00:30.000Z',
    validUntil: '2026-12-01T10:00:30.000Z',
    ...safe,
    ...overrides,
  };
}

function signedCertificate(
  body: CompanionEnrollmentCertificateBody,
  serverKey: KeyObject,
  overrides: Partial<SignedCompanionEnrollmentCertificate> = {},
): SignedCompanionEnrollmentCertificate {
  const signerKeyId = overrides.signerKeyId ?? 'server-signing-key-0001';
  return {
    contractVersion: 1,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestCompanionEnrollmentCertificateBody(body)!,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    signerKeyId,
    body,
    signature: p1363(
      serverKey,
      canonicalCompanionEnrollmentCertificateSignatureBytes(body, signerKeyId)!,
    ),
    ...overrides,
  };
}

function httpBody(
  certificate: CompanionEnrollmentCertificateBody,
  overrides: Partial<CompanionHttpRequestBody> = {},
): CompanionHttpRequestBody {
  return {
    contractVersion: 1,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    requestId: 'signed-http-request-0001',
    certificateId: certificate.certificateId,
    deviceId: certificate.deviceId,
    deviceKeyId: certificate.deviceKeyId,
    method: 'POST',
    canonicalPath: '/v1/companion/results',
    queryDigest: sha('2'),
    contentDigest: sha('3'),
    nonceDigest: sha('4'),
    issuedAt: '2026-09-02T10:01:00.000Z',
    expiresAt: '2026-09-02T10:03:00.000Z',
    ...safe,
    ...overrides,
  };
}

function signedHttp(
  body: CompanionHttpRequestBody,
  deviceKey: KeyObject,
  overrides: Partial<SignedCompanionHttpRequest> = {},
): SignedCompanionHttpRequest {
  return {
    contractVersion: 1,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestCompanionHttpRequestBody(body)!,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    deviceKeyId: body.deviceKeyId,
    body,
    signature: p1363(deviceKey, canonicalCompanionHttpRequestSignatureBytes(body)!),
    ...overrides,
  };
}

const playerIds = ['28379330', '28379331', '28379332', '28379333', '28379334'] as const;

function assignmentBody(
  certificate: CompanionEnrollmentCertificateBody,
  overrides: Partial<KemerBetExactFiveLookupAssignmentBody> = {},
): KemerBetExactFiveLookupAssignmentBody {
  return {
    contractVersion: 1,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    assignmentId: 'lookup-assignment-0001',
    requestId: 'lookup-request-0001',
    certificateId: certificate.certificateId,
    deviceId: certificate.deviceId,
    deviceKeyId: certificate.deviceKeyId,
    platformCode: 'kemerbet',
    assignmentKind: 'exact_five_player_lookup',
    lookupMode: 'find_only',
    playerIds,
    currencyCode: 'ETB',
    leaseNonceDigest: sha('5'),
    oneUse: true,
    issuedAt: '2026-09-02T10:01:00.000Z',
    expiresAt: '2026-09-02T10:06:00.000Z',
    ...safe,
    ...overrides,
  };
}

function signedAssignment(
  body: KemerBetExactFiveLookupAssignmentBody,
  serverKey: KeyObject,
  overrides: Partial<SignedKemerBetExactFiveLookupAssignment> = {},
): SignedKemerBetExactFiveLookupAssignment {
  const signerKeyId = overrides.signerKeyId ?? 'server-signing-key-0001';
  return {
    contractVersion: 1,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_ASSIGNMENT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestKemerBetExactFiveLookupAssignmentBody(body)!,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    signerKeyId,
    body,
    signature: p1363(
      serverKey,
      canonicalKemerBetExactFiveLookupAssignmentSignatureBytes(body, signerKeyId)!,
    ),
    ...overrides,
  };
}

function resultBody(
  assignment: SignedKemerBetExactFiveLookupAssignment,
  overrides: Partial<KemerBetExactFiveLookupResultBody> = {},
): KemerBetExactFiveLookupResultBody {
  const outcomes = ['found', 'found', 'not_found', 'review_required', 'found'] as const;
  const items = assignment.body.playerIds.map((playerId, playerIndex) => ({
    playerIndex: playerIndex as 0 | 1 | 2 | 3 | 4,
    playerIdDigest: digestCompanionPlayerId(playerId)!,
    outcome: outcomes[playerIndex]!,
  })) as unknown as readonly [
    CompanionPlayerLookupResultItem,
    CompanionPlayerLookupResultItem,
    CompanionPlayerLookupResultItem,
    CompanionPlayerLookupResultItem,
    CompanionPlayerLookupResultItem,
  ];
  return {
    contractVersion: 1,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    resultId: 'lookup-result-0001',
    assignmentId: assignment.body.assignmentId,
    assignmentBodyDigest: assignment.bodyDigest,
    requestId: assignment.body.requestId,
    certificateId: assignment.body.certificateId,
    deviceId: assignment.body.deviceId,
    deviceKeyId: assignment.body.deviceKeyId,
    platformCode: 'kemerbet',
    assignmentKind: 'exact_five_player_lookup',
    lookupMode: 'find_only',
    currencyCode: 'ETB',
    items,
    foundCount: 3,
    notFoundCount: 1,
    reviewRequiredCount: 1,
    observedAt: '2026-09-02T10:04:00.000Z',
    ...safe,
    ...overrides,
  };
}

function signedResult(
  body: KemerBetExactFiveLookupResultBody,
  deviceKey: KeyObject,
  overrides: Partial<SignedKemerBetExactFiveLookupResult> = {},
): SignedKemerBetExactFiveLookupResult {
  return {
    contractVersion: 1,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_RESULT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestKemerBetExactFiveLookupResultBody(body)!,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    deviceKeyId: body.deviceKeyId,
    body,
    signature: p1363(deviceKey, canonicalKemerBetExactFiveLookupResultSignatureBytes(body)!),
    ...overrides,
  };
}

function fixture() {
  const device = keyPair();
  const server = keyPair();
  const pairing = signedPairing(pairingBody(device), device.privateKey);
  const certificate = signedCertificate(certificateBody(pairing), server.privateKey);
  const assignment = signedAssignment(assignmentBody(certificate.body), server.privateKey);
  const result = signedResult(resultBody(assignment), device.privateKey);
  return { device, server, pairing, certificate, assignment, result };
}

describe('agent-platform companion contracts', () => {
  it('pins P-256/SHA-256, P1363/base64url, Windows, and a no-money protocol', () => {
    expect({
      version: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      mode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      algorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
      encoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    }).toEqual({
      version: 1,
      mode: 'local_companion_no_transfer_v1',
      algorithm: 'ecdsa-p256-sha256',
      encoding: 'ieee-p1363-base64url',
    });
    expect(safe).toMatchObject({
      accountMutationAllowed: false,
      providerMutationAllowed: false,
      depositAllowed: false,
      withdrawAllowed: false,
      transferAllowed: false,
      financialActionAllowed: false,
      moneyMovementAllowed: false,
      transferDisabled: true,
      identifiersRedacted: true,
      moneyMoved: false,
    });
  });

  it('verifies a one-use pairing proof with its embedded canonical P-256 key', () => {
    const value = fixture();
    expect(decodeCompanionPairingPublicPayload(value.pairing.body)).toBeDefined();
    expect(decodeSignedCompanionPairingRequest(value.pairing)).toBeDefined();
    expect(verifySignedCompanionPairingRequest(value.pairing)).toBe(true);
    expect(deriveCompanionPairingReplayIdentity(value.pairing)).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(decodeCompanionPairingPublicPayload(value.pairing.body))).toBe(true);
  });

  it('rejects a mismatched pairing key digest, a non-P256 key, and an overlong challenge', () => {
    const value = fixture();
    expect(
      decodeCompanionPairingPublicPayload({
        ...value.pairing.body,
        devicePublicKeySpkiSha256: sha('9'),
      }),
    ).toBeUndefined();

    const p384 = keyPair('secp384r1');
    expect(
      decodeCompanionPairingPublicPayload(
        pairingBody(p384, { devicePublicKeySpkiSha256: p384.digest }),
      ),
    ).toBeUndefined();

    expect(
      decodeCompanionPairingPublicPayload({
        ...value.pairing.body,
        expiresAt: '2026-09-02T10:10:00.001Z',
      }),
    ).toBeUndefined();
  });

  it('rejects tampered pairing bytes, DER signatures, and cross-domain signatures', () => {
    const value = fixture();
    expect(
      verifySignedCompanionPairingRequest({
        ...value.pairing,
        body: { ...value.pairing.body, companionVersion: '1.0.1' },
      }),
    ).toBe(false);

    const der = sign('sha256', canonicalCompanionPairingSignatureBytes(value.pairing.body)!, {
      key: value.device.privateKey,
      dsaEncoding: 'der',
    }).toString('base64url');
    expect(
      decodeSignedCompanionPairingRequest({ ...value.pairing, signature: der }),
    ).toBeUndefined();

    const wrongDomainSignature = p1363(
      value.device.privateKey,
      canonicalCompanionHttpRequestSignatureBytes(httpBody(value.certificate.body))!,
    );
    expect(
      verifySignedCompanionPairingRequest({
        ...value.pairing,
        signature: wrongDomainSignature,
      }),
    ).toBe(false);
  });

  it('verifies the server certificate and its exact consumed pairing binding', () => {
    const value = fixture();
    expect(decodeCompanionEnrollmentCertificateBody(value.certificate.body)).toBeDefined();
    expect(decodeSignedCompanionEnrollmentCertificate(value.certificate)).toBeDefined();
    expect(verifySignedCompanionEnrollmentCertificate(value.certificate, value.server.spki)).toBe(
      true,
    );
    expect(certificateMatchesPairingRequest(value.certificate, value.pairing)).toBe(true);
    expect(
      certificateMatchesPairingRequest(
        {
          ...value.certificate,
          body: { ...value.certificate.body, pairingNonceDigest: sha('8') },
        },
        value.pairing,
      ),
    ).toBe(false);
  });

  it('rejects a certificate signed by another key or with unsafe capability literals', () => {
    const value = fixture();
    expect(verifySignedCompanionEnrollmentCertificate(value.certificate, keyPair().spki)).toBe(
      false,
    );
    expect(
      decodeCompanionEnrollmentCertificateBody({
        ...value.certificate.body,
        moneyMovementAllowed: true,
      }),
    ).toBeUndefined();
  });

  it('verifies a replay-bounded device-signed HTTP request and its server certificate', () => {
    const value = fixture();
    const request = signedHttp(httpBody(value.certificate.body), value.device.privateKey);
    expect(decodeCompanionHttpRequestBody(request.body)).toBeDefined();
    expect(decodeSignedCompanionHttpRequest(request)).toBeDefined();
    expect(
      verifySignedCompanionHttpRequest(
        request,
        value.certificate,
        value.server.spki,
        '2026-09-02T10:02:00.000Z',
      ),
    ).toBe(true);
    const replay = deriveCompanionHttpRequestReplayIdentity(request)!;
    expect(
      verifySignedCompanionHttpRequest(
        request,
        value.certificate,
        value.server.spki,
        '2026-09-02T10:02:00.000Z',
        [replay],
      ),
    ).toBe(false);
  });

  it('rejects unsafe HTTP paths, expired requests, altered bodies, and revoked certificates', () => {
    const value = fixture();
    expect(
      decodeCompanionHttpRequestBody(
        httpBody(value.certificate.body, { canonicalPath: '/v1/../x' }),
      ),
    ).toBeUndefined();
    expect(
      decodeCompanionHttpRequestBody(
        httpBody(value.certificate.body, { expiresAt: '2026-09-02T10:06:00.001Z' }),
      ),
    ).toBeUndefined();

    const request = signedHttp(httpBody(value.certificate.body), value.device.privateKey);
    expect(
      verifySignedCompanionHttpRequest(
        { ...request, body: { ...request.body, contentDigest: sha('9') } },
        value.certificate,
        value.server.spki,
        '2026-09-02T10:02:00.000Z',
      ),
    ).toBe(false);

    const revokedBody = certificateBody(value.pairing, { state: 'revoked' });
    const revoked = signedCertificate(revokedBody, value.server.privateKey);
    expect(
      verifySignedCompanionHttpRequest(
        request,
        revoked,
        value.server.spki,
        '2026-09-02T10:02:00.000Z',
      ),
    ).toBe(false);
  });

  it('accepts only exactly five unique KemerBet Player IDs in ETB and find-only mode', () => {
    const value = fixture();
    const decoded = decodeKemerBetExactFiveLookupAssignmentBody(value.assignment.body);
    expect(decoded).toBeDefined();
    expect(decoded?.playerIds).toEqual(playerIds);
    expect(Object.isFrozen(decoded?.playerIds)).toBe(true);
    expect(verifySignedKemerBetExactFiveLookupAssignment(value.assignment, value.server.spki)).toBe(
      true,
    );

    for (const invalid of [
      playerIds.slice(0, 4),
      [...playerIds, '28379335'],
      [playerIds[0], playerIds[0], ...playerIds.slice(2)],
      [...playerIds.slice(0, 4), ' bad id '],
    ]) {
      expect(
        decodeKemerBetExactFiveLookupAssignmentBody({
          ...value.assignment.body,
          playerIds: invalid,
        }),
      ).toBeUndefined();
    }
    expect(
      decodeKemerBetExactFiveLookupAssignmentBody({
        ...value.assignment.body,
        currencyCode: 'USD',
      }),
    ).toBeUndefined();
    expect(
      decodeKemerBetExactFiveLookupAssignmentBody({
        ...value.assignment.body,
        lookupMode: 'transfer',
      }),
    ).toBeUndefined();
  });

  it('uses deterministic, domain-separated canonical assignment and result bytes', () => {
    const value = fixture();
    const reorderedAssignment = Object.fromEntries(Object.entries(value.assignment.body).reverse());
    const reorderedResult = Object.fromEntries(Object.entries(value.result.body).reverse());
    expect(canonicalKemerBetExactFiveLookupAssignmentBodyBytes(reorderedAssignment)).toEqual(
      canonicalKemerBetExactFiveLookupAssignmentBodyBytes(value.assignment.body),
    );
    expect(canonicalKemerBetExactFiveLookupResultBodyBytes(reorderedResult)).toEqual(
      canonicalKemerBetExactFiveLookupResultBodyBytes(value.result.body),
    );
    expect(canonicalCompanionPairingPublicPayloadBytes(value.pairing.body)).not.toEqual(
      canonicalKemerBetExactFiveLookupAssignmentBodyBytes(value.assignment.body),
    );
    expect(canonicalCompanionHttpRequestBodyBytes(httpBody(value.certificate.body))).not.toEqual(
      canonicalKemerBetExactFiveLookupResultBodyBytes(value.result.body),
    );
  });

  it('accepts only five redacted aggregate items whose counts agree', () => {
    const value = fixture();
    const decoded = decodeKemerBetExactFiveLookupResultBody(value.result.body);
    expect(decoded).toBeDefined();
    expect(decoded?.items).toHaveLength(5);
    expect(decoded?.items.every((item) => !('playerId' in item))).toBe(true);
    expect(decoded).toMatchObject({
      currencyCode: 'ETB',
      identifiersRedacted: true,
      moneyMoved: false,
      transferDisabled: true,
      foundCount: 3,
      notFoundCount: 1,
      reviewRequiredCount: 1,
    });

    expect(
      decodeKemerBetExactFiveLookupResultBody({ ...value.result.body, foundCount: 4 }),
    ).toBeUndefined();
    const wrongIndex = value.result.body.items.map((item) => ({ ...item }));
    wrongIndex[0] = { ...wrongIndex[0]!, playerIndex: 1 };
    expect(
      decodeKemerBetExactFiveLookupResultBody({ ...value.result.body, items: wrongIndex }),
    ).toBeUndefined();
    const duplicateDigest = value.result.body.items.map((item) => ({ ...item }));
    duplicateDigest[4] = {
      ...duplicateDigest[4]!,
      playerIdDigest: duplicateDigest[0]!.playerIdDigest,
    };
    expect(
      decodeKemerBetExactFiveLookupResultBody({ ...value.result.body, items: duplicateDigest }),
    ).toBeUndefined();
  });

  it('cryptographically verifies the complete read-only exact-five exchange', () => {
    const value = fixture();
    expect(decodeSignedKemerBetExactFiveLookupAssignment(value.assignment)).toBeDefined();
    expect(decodeSignedKemerBetExactFiveLookupResult(value.result)).toBeDefined();
    expect(verifySignedKemerBetExactFiveLookupResult(value.result, value.certificate)).toBe(true);
    const verified = verifyKemerBetExactFiveLookupExchange(
      {
        assessedAt: '2026-09-02T10:04:30.000Z',
        certificate: value.certificate,
        signedAssignment: value.assignment,
        signedResult: value.result,
      },
      value.server.spki,
    );
    expect(verified).toEqual({
      contractVersion: 1,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      advisoryOnly: true,
      ...safe,
      disposition: 'would_accept_read_only_result',
      reasonCode: 'signed_read_only_result_verified',
      replayIdentity: deriveKemerBetExactFiveLookupAssignmentReplayIdentity(value.assignment),
    });
  });

  it('routes binding, Player-ID digest, signature, expiry, and replay failures to review', () => {
    const value = fixture();
    const verify = (
      assignment: unknown,
      result: unknown,
      assessedAt = '2026-09-02T10:04:30.000Z',
      consumedReplayIdentities: readonly string[] = [],
    ) =>
      verifyKemerBetExactFiveLookupExchange(
        {
          assessedAt,
          certificate: value.certificate,
          signedAssignment: assignment,
          signedResult: result,
          consumedReplayIdentities,
        },
        value.server.spki,
      );

    const otherAssignmentBody = assignmentBody(value.certificate.body, {
      assignmentId: 'lookup-assignment-0002',
    });
    const otherAssignment = signedAssignment(otherAssignmentBody, value.server.privateKey);
    expect(verify(otherAssignment, value.result)).toMatchObject({ reasonCode: 'binding_mismatch' });

    const wrongItems = value.result.body.items.map((item) => ({ ...item }));
    wrongItems[0] = { ...wrongItems[0]!, playerIdDigest: sha('9') };
    const wrongDigestBody = resultBody(value.assignment, {
      items: wrongItems as KemerBetExactFiveLookupResultBody['items'],
    });
    const wrongDigestResult = signedResult(wrongDigestBody, value.device.privateKey);
    expect(verify(value.assignment, wrongDigestResult)).toMatchObject({
      reasonCode: 'player_digest_mismatch',
    });

    expect(verify({ ...value.assignment, signature: 'A'.repeat(86) }, value.result)).toMatchObject({
      reasonCode: 'assignment_signature_invalid',
    });
    expect(verify(value.assignment, { ...value.result, signature: 'A'.repeat(86) })).toMatchObject({
      reasonCode: 'result_signature_invalid',
    });
    expect(verify(value.assignment, value.result, '2026-09-02T10:06:00.000Z')).toMatchObject({
      reasonCode: 'assignment_expired',
    });
    expect(
      verify(value.assignment, value.result, '2026-09-02T10:04:30.000Z', [
        deriveKemerBetExactFiveLookupAssignmentReplayIdentity(value.assignment)!,
      ]),
    ).toMatchObject({ reasonCode: 'replay_detected' });
  });

  it.each(['amount', 'amountMinor', 'notes', 'transfer', 'deposit', 'withdraw'])(
    'structurally rejects forbidden %s fields at every command boundary',
    (field) => {
      const value = fixture();
      expect(
        decodeCompanionPairingPublicPayload({ ...value.pairing.body, [field]: 'x' }),
      ).toBeUndefined();
      expect(
        decodeCompanionHttpRequestBody({ ...httpBody(value.certificate.body), [field]: 'x' }),
      ).toBeUndefined();
      expect(
        decodeKemerBetExactFiveLookupAssignmentBody({ ...value.assignment.body, [field]: 'x' }),
      ).toBeUndefined();
      expect(
        decodeKemerBetExactFiveLookupResultBody({ ...value.result.body, [field]: 'x' }),
      ).toBeUndefined();
      expect(
        decodeKemerBetExactFiveLookupResultBody({
          ...value.result.body,
          items: value.result.body.items.map((item, index) =>
            index === 0 ? { ...item, [field]: 'x' } : item,
          ),
        }),
      ).toBeUndefined();
    },
  );

  it('rejects getters, symbols, proxies, sparse arrays, and inherited records', () => {
    const value = fixture();
    const getter = { ...value.assignment.body } as Record<string, unknown>;
    Object.defineProperty(getter, 'assignmentId', {
      enumerable: true,
      get: () => value.assignment.body.assignmentId,
    });
    expect(decodeKemerBetExactFiveLookupAssignmentBody(getter)).toBeUndefined();
    expect(
      decodeKemerBetExactFiveLookupAssignmentBody(
        Object.assign({ ...value.assignment.body }, { [Symbol('hidden')]: true }),
      ),
    ).toBeUndefined();
    expect(
      decodeKemerBetExactFiveLookupAssignmentBody(new Proxy(value.assignment.body, {})),
    ).toBeUndefined();

    const sparse = [...value.assignment.body.playerIds] as unknown[];
    delete sparse[2];
    expect(
      decodeKemerBetExactFiveLookupAssignmentBody({ ...value.assignment.body, playerIds: sparse }),
    ).toBeUndefined();

    const inherited = Object.create({ inherited: true }) as Record<string, unknown>;
    Object.assign(inherited, value.result.body);
    expect(decodeKemerBetExactFiveLookupResultBody(inherited)).toBeUndefined();
  });
});
