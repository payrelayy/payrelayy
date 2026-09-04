import { sign, type KeyObject } from 'node:crypto';
import { isProxy } from 'node:util/types';

import {
  AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_PAIRING_PATH,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalCompanionEnrollmentCertificateSignatureBytes,
  certificateMatchesPairingRequest,
  decodeCompanionEnrollmentCertificateBody,
  decodeSignedCompanionEnrollmentCertificate,
  decodeSignedCompanionPairingRequest,
  digestCompanionEnrollmentCertificateBody,
  verifySignedCompanionEnrollmentCertificate,
  verifySignedCompanionPairingRequest,
  type CompanionEnrollmentCertificateBody,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionPairingRequest,
} from '@fetanagent/agent-platform-companion-contracts';

const MAXIMUM_PAIRING_BODY_BYTES = 64 * 1_024;

const responseHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const);

export interface CompanionBridgeHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: Uint8Array;
}

export interface CompanionBridgeHttpResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export type CompanionPairingClaim =
  | {
      readonly kind: 'claimed';
      readonly certificateBody: CompanionEnrollmentCertificateBody;
    }
  | { readonly kind: 'in_progress' }
  | {
      readonly kind: 'completed';
      readonly certificate: SignedCompanionEnrollmentCertificate;
    };

export interface CompanionBridgeSigner {
  readonly keyId: string;
  readonly publicKeySpkiDer: Uint8Array;
  signP1363(transcript: Uint8Array): Promise<string>;
}

export interface CompanionPairingHandlerDependencies {
  readonly signer: CompanionBridgeSigner;
  now(): string;
  claimPairing(
    request: SignedCompanionPairingRequest,
    assessedAt: string,
  ): Promise<CompanionPairingClaim | undefined>;
  completePairing(
    pairingRequestBodyDigest: string,
    certificate: SignedCompanionEnrollmentCertificate,
  ): Promise<boolean>;
  releasePairing(pairingRequestBodyDigest: string): Promise<void>;
}

function plainRecord(candidate: unknown): candidate is Record<string, unknown> {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    !isProxy(candidate) &&
    Object.getPrototypeOf(candidate) === Object.prototype
  );
}

function canonicalTimestamp(candidate: unknown): string | undefined {
  if (typeof candidate !== 'string') return undefined;
  try {
    return new Date(candidate).toISOString() === candidate ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function headerValues(
  headers: readonly (readonly [string, string])[],
  expectedName: string,
): readonly string[] | undefined {
  if (!Array.isArray(headers)) return undefined;
  const values: string[] = [];
  for (const entry of headers) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      typeof entry[1] !== 'string'
    ) {
      return undefined;
    }
    if (entry[0].toLowerCase() === expectedName) values.push(entry[1]);
  }
  return values;
}

function validHttpEnvelope(request: CompanionBridgeHttpRequest): boolean {
  const contentTypes = headerValues(request.headers, 'content-type');
  const accepts = headerValues(request.headers, 'accept');
  return Boolean(
    request.method === 'POST' &&
    request.path === AGENT_PLATFORM_COMPANION_PAIRING_PATH &&
    contentTypes?.length === 1 &&
    contentTypes[0] === AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE &&
    accepts?.length === 1 &&
    accepts[0] === AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE &&
    request.body instanceof Uint8Array &&
    request.body.byteLength > 0 &&
    request.body.byteLength <= MAXIMUM_PAIRING_BODY_BYTES,
  );
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    const text = Buffer.from(bytes).toString('utf8');
    const parsed = JSON.parse(text);
    return plainRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function jsonResponse(statusCode: number, value: unknown): CompanionBridgeHttpResponse {
  return Object.freeze({
    statusCode,
    headers: responseHeaders,
    body: Buffer.from(JSON.stringify(value), 'utf8'),
  });
}

function errorResponse(
  statusCode: 400 | 401 | 409 | 413 | 503,
  code: 'invalid_request' | 'request_in_progress' | 'temporarily_unavailable',
): CompanionBridgeHttpResponse {
  return jsonResponse(statusCode, { code });
}

function bodyMatchesRequest(
  body: CompanionEnrollmentCertificateBody,
  request: SignedCompanionPairingRequest,
  assessedAt: string,
): boolean {
  return (
    body.state === 'active' &&
    body.pairingConsumed === true &&
    body.pairingId === request.body.pairingId &&
    body.pairingRequestBodyDigest === request.bodyDigest &&
    body.pairingNonceDigest === request.body.pairingNonceDigest &&
    body.deviceId === request.body.deviceId &&
    body.deviceKeyId === request.body.deviceKeyId &&
    body.devicePublicKeySpki === request.body.devicePublicKeySpki &&
    body.devicePublicKeySpkiSha256 === request.body.devicePublicKeySpkiSha256 &&
    body.devicePlatform === request.body.devicePlatform &&
    body.companionVersion === request.body.companionVersion &&
    Date.parse(body.issuedAt) === Date.parse(assessedAt) &&
    Date.parse(body.validFrom) === Date.parse(assessedAt) &&
    Date.parse(body.validUntil) > Date.parse(body.validFrom)
  );
}

async function signCertificate(
  body: CompanionEnrollmentCertificateBody,
  signer: CompanionBridgeSigner,
): Promise<SignedCompanionEnrollmentCertificate | undefined> {
  const bodyDigest = digestCompanionEnrollmentCertificateBody(body);
  const transcript = canonicalCompanionEnrollmentCertificateSignatureBytes(body, signer.keyId);
  if (!bodyDigest || !transcript) return undefined;
  const signature = await signer.signP1363(transcript);
  const certificate = decodeSignedCompanionEnrollmentCertificate({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    signerKeyId: signer.keyId,
    body,
    signature,
  });
  return certificate &&
    verifySignedCompanionEnrollmentCertificate(certificate, signer.publicKeySpkiDer)
    ? certificate
    : undefined;
}

function validCompleted(
  candidate: unknown,
  request: SignedCompanionPairingRequest,
  signer: CompanionBridgeSigner,
  assessedAt: string,
): candidate is SignedCompanionEnrollmentCertificate {
  const certificate = decodeSignedCompanionEnrollmentCertificate(candidate);
  return Boolean(
    certificate &&
    certificate.signerKeyId === signer.keyId &&
    certificate.body.state === 'active' &&
    Date.parse(certificate.body.validFrom) <= Date.parse(assessedAt) &&
    Date.parse(certificate.body.validUntil) > Date.parse(assessedAt) &&
    verifySignedCompanionEnrollmentCertificate(certificate, signer.publicKeySpkiDer) &&
    certificateMatchesPairingRequest(certificate, request),
  );
}

export function createCompanionPairingHandler(
  dependencies: CompanionPairingHandlerDependencies,
): (request: CompanionBridgeHttpRequest) => Promise<CompanionBridgeHttpResponse> {
  return async (request) => {
    try {
      if (request.body.byteLength > MAXIMUM_PAIRING_BODY_BYTES) {
        return errorResponse(413, 'invalid_request');
      }
      if (!validHttpEnvelope(request)) return errorResponse(400, 'invalid_request');
      const pairing = decodeSignedCompanionPairingRequest(parseJson(request.body));
      const assessedAt = canonicalTimestamp(dependencies.now());
      if (
        !pairing ||
        !assessedAt ||
        !verifySignedCompanionPairingRequest(pairing) ||
        Date.parse(assessedAt) < Date.parse(pairing.body.issuedAt) ||
        Date.parse(assessedAt) >= Date.parse(pairing.body.expiresAt)
      ) {
        return errorResponse(401, 'invalid_request');
      }
      const claim = await dependencies.claimPairing(pairing, assessedAt);
      if (!claim) return errorResponse(401, 'invalid_request');
      if (claim.kind === 'in_progress') return errorResponse(409, 'request_in_progress');
      if (claim.kind === 'completed') {
        return validCompleted(claim.certificate, pairing, dependencies.signer, assessedAt)
          ? jsonResponse(200, { certificate: claim.certificate })
          : errorResponse(503, 'temporarily_unavailable');
      }
      const body = decodeCompanionEnrollmentCertificateBody(claim.certificateBody);
      if (!body || !bodyMatchesRequest(body, pairing, assessedAt)) {
        await dependencies.releasePairing(pairing.bodyDigest);
        return errorResponse(503, 'temporarily_unavailable');
      }
      let certificate: SignedCompanionEnrollmentCertificate | undefined;
      try {
        certificate = await signCertificate(body, dependencies.signer);
      } catch {
        await dependencies.releasePairing(pairing.bodyDigest);
        return errorResponse(503, 'temporarily_unavailable');
      }
      if (!certificate || !certificateMatchesPairingRequest(certificate, pairing)) {
        await dependencies.releasePairing(pairing.bodyDigest);
        return errorResponse(503, 'temporarily_unavailable');
      }
      try {
        if (!(await dependencies.completePairing(pairing.bodyDigest, certificate))) {
          return errorResponse(503, 'temporarily_unavailable');
        }
      } catch {
        // Completion may have committed before its acknowledgement was lost. Preserve the claim;
        // the same signed body can recover the stored certificate on an exact retry.
        return errorResponse(503, 'temporarily_unavailable');
      }
      return jsonResponse(201, { certificate });
    } catch {
      return errorResponse(503, 'temporarily_unavailable');
    }
  };
}

export function createP256CompanionBridgeSigner(
  keyId: string,
  privateKey: KeyObject,
  publicKeySpkiDer: Uint8Array,
): CompanionBridgeSigner {
  return Object.freeze({
    keyId,
    publicKeySpkiDer: Uint8Array.from(publicKeySpkiDer),
    signP1363: async (transcript: Uint8Array) =>
      sign('sha256', transcript, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString(
        'base64url',
      ),
  });
}
