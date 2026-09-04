import { isProxy } from 'node:util/types';

import {
  AGENT_PLATFORM_COMPANION_ASSIGNMENT_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH,
  AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalKemerBetExactFiveLookupAssignmentSignatureBytes,
  decodeKemerBetExactFiveLookupAssignmentBody,
  decodeSignedCompanionEnrollmentCertificate,
  decodeSignedCompanionHttpRequest,
  decodeSignedKemerBetExactFiveLookupAssignment,
  decodeSignedKemerBetExactFiveLookupResult,
  deriveCompanionHttpRequestReplayIdentity,
  deriveKemerBetExactFiveLookupResultReplayIdentity,
  digestCompanionLookupEmptyQuery,
  digestCompanionLookupPollContent,
  digestCompanionLookupResultContent,
  digestKemerBetExactFiveLookupAssignmentBody,
  verifyKemerBetExactFiveLookupExchange,
  verifySignedCompanionEnrollmentCertificate,
  verifySignedCompanionHttpRequest,
  verifySignedKemerBetExactFiveLookupAssignment,
  type KemerBetExactFiveLookupAssignmentBody,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionHttpRequest,
  type SignedKemerBetExactFiveLookupAssignment,
  type SignedKemerBetExactFiveLookupResult,
} from '@fetanagent/agent-platform-companion-contracts';

import type {
  CompanionBridgeHttpRequest,
  CompanionBridgeHttpResponse,
  CompanionBridgeSigner,
} from './pairing-handler.js';

const MAXIMUM_LOOKUP_BODY_BYTES = 64 * 1_024;

const responseHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const);

export type CompanionLookupAssignmentClaim =
  | { readonly kind: 'none' }
  | { readonly kind: 'in_progress' }
  | {
      readonly kind: 'claimed';
      readonly assignmentBody: KemerBetExactFiveLookupAssignmentBody;
    }
  | {
      readonly kind: 'completed';
      readonly assignment: SignedKemerBetExactFiveLookupAssignment;
    };

export interface CompanionLookupAcceptance {
  readonly accepted: true;
  readonly replayed: boolean;
}

export interface CompanionLookupHandlerDependencies {
  readonly signer: CompanionBridgeSigner;
  now(): string;
  claimAssignment(
    certificate: SignedCompanionEnrollmentCertificate,
    request: SignedCompanionHttpRequest,
    httpReplayIdentity: string,
    assessedAt: string,
  ): Promise<CompanionLookupAssignmentClaim | undefined>;
  completeAssignment(
    assignmentBodyDigest: string,
    assignment: SignedKemerBetExactFiveLookupAssignment,
  ): Promise<boolean>;
  releaseAssignment(assignmentId: string): Promise<void>;
  acceptResult(
    certificate: SignedCompanionEnrollmentCertificate,
    request: SignedCompanionHttpRequest,
    httpReplayIdentity: string,
    assignment: SignedKemerBetExactFiveLookupAssignment,
    result: SignedKemerBetExactFiveLookupResult,
    resultReplayIdentity: string,
    assessedAt: string,
  ): Promise<CompanionLookupAcceptance | undefined>;
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

function exactKeys(candidate: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(candidate).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
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
    (request.path === AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH ||
      request.path === AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH) &&
    contentTypes?.length === 1 &&
    contentTypes[0] === AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE &&
    accepts?.length === 1 &&
    accepts[0] === AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE &&
    request.body instanceof Uint8Array &&
    request.body.byteLength > 0 &&
    request.body.byteLength <= MAXIMUM_LOOKUP_BODY_BYTES,
  );
}

function parseJson(bytes: Uint8Array): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
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

function noAssignmentResponse(): CompanionBridgeHttpResponse {
  return Object.freeze({
    statusCode: 204,
    headers: Object.freeze({
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    }),
    body: Buffer.alloc(0),
  });
}

function errorResponse(
  statusCode: 400 | 401 | 409 | 413 | 503,
  code: 'invalid_request' | 'request_in_progress' | 'temporarily_unavailable',
): CompanionBridgeHttpResponse {
  return jsonResponse(statusCode, { code });
}

function verifiedBase(
  candidate: Record<string, unknown>,
  expectedKeys: readonly string[],
  path:
    | typeof AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH
    | typeof AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH,
  contentDigest: string | undefined,
  signer: CompanionBridgeSigner,
  assessedAt: string,
):
  | {
      readonly certificate: SignedCompanionEnrollmentCertificate;
      readonly httpRequest: SignedCompanionHttpRequest;
      readonly httpReplayIdentity: string;
    }
  | undefined {
  if (!exactKeys(candidate, expectedKeys) || !contentDigest) return undefined;
  const certificate = decodeSignedCompanionEnrollmentCertificate(candidate.certificate);
  const httpRequest = decodeSignedCompanionHttpRequest(candidate.httpRequest);
  if (
    !certificate ||
    !httpRequest ||
    certificate.signerKeyId !== signer.keyId ||
    !verifySignedCompanionEnrollmentCertificate(certificate, signer.publicKeySpkiDer) ||
    !verifySignedCompanionHttpRequest(
      httpRequest,
      certificate,
      signer.publicKeySpkiDer,
      assessedAt,
    ) ||
    httpRequest.body.method !== 'POST' ||
    httpRequest.body.canonicalPath !== path ||
    httpRequest.body.queryDigest !== digestCompanionLookupEmptyQuery() ||
    httpRequest.body.contentDigest !== contentDigest
  ) {
    return undefined;
  }
  const httpReplayIdentity = deriveCompanionHttpRequestReplayIdentity(httpRequest);
  return httpReplayIdentity
    ? Object.freeze({ certificate, httpRequest, httpReplayIdentity })
    : undefined;
}

async function signAssignment(
  body: KemerBetExactFiveLookupAssignmentBody,
  signer: CompanionBridgeSigner,
): Promise<SignedKemerBetExactFiveLookupAssignment | undefined> {
  const bodyDigest = digestKemerBetExactFiveLookupAssignmentBody(body);
  const transcript = canonicalKemerBetExactFiveLookupAssignmentSignatureBytes(body, signer.keyId);
  if (!bodyDigest || !transcript) return undefined;
  const assignment = decodeSignedKemerBetExactFiveLookupAssignment({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_ASSIGNMENT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    signerKeyId: signer.keyId,
    body,
    signature: await signer.signP1363(transcript),
  });
  return assignment &&
    verifySignedKemerBetExactFiveLookupAssignment(assignment, signer.publicKeySpkiDer)
    ? assignment
    : undefined;
}

function completedAssignmentValid(
  assignment: SignedKemerBetExactFiveLookupAssignment,
  certificate: SignedCompanionEnrollmentCertificate,
  signer: CompanionBridgeSigner,
  assessedAt: string,
): boolean {
  return (
    assignment.signerKeyId === signer.keyId &&
    assignment.body.certificateId === certificate.body.certificateId &&
    assignment.body.deviceId === certificate.body.deviceId &&
    assignment.body.deviceKeyId === certificate.body.deviceKeyId &&
    Date.parse(assessedAt) >= Date.parse(assignment.body.issuedAt) &&
    Date.parse(assessedAt) < Date.parse(assignment.body.expiresAt) &&
    verifySignedKemerBetExactFiveLookupAssignment(assignment, signer.publicKeySpkiDer)
  );
}

export function createCompanionLookupHandler(
  dependencies: CompanionLookupHandlerDependencies,
): (request: CompanionBridgeHttpRequest) => Promise<CompanionBridgeHttpResponse> {
  return async (request) => {
    try {
      if (request.body.byteLength > MAXIMUM_LOOKUP_BODY_BYTES) {
        return errorResponse(413, 'invalid_request');
      }
      if (!validHttpEnvelope(request)) return errorResponse(400, 'invalid_request');
      const parsed = parseJson(request.body);
      const assessedAt = canonicalTimestamp(dependencies.now());
      if (!parsed || !assessedAt) return errorResponse(401, 'invalid_request');

      if (request.path === AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH) {
        const certificateCandidate = decodeSignedCompanionEnrollmentCertificate(parsed.certificate);
        const base = verifiedBase(
          parsed,
          ['certificate', 'httpRequest'],
          AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH,
          certificateCandidate && digestCompanionLookupPollContent(certificateCandidate.bodyDigest),
          dependencies.signer,
          assessedAt,
        );
        if (!base) return errorResponse(401, 'invalid_request');
        const claim = await dependencies.claimAssignment(
          base.certificate,
          base.httpRequest,
          base.httpReplayIdentity,
          assessedAt,
        );
        if (!claim) return errorResponse(401, 'invalid_request');
        if (claim.kind === 'none') return noAssignmentResponse();
        if (claim.kind === 'in_progress') return errorResponse(409, 'request_in_progress');
        if (claim.kind === 'completed') {
          return completedAssignmentValid(
            claim.assignment,
            base.certificate,
            dependencies.signer,
            assessedAt,
          )
            ? jsonResponse(200, { assignment: claim.assignment })
            : errorResponse(503, 'temporarily_unavailable');
        }
        const body = decodeKemerBetExactFiveLookupAssignmentBody(claim.assignmentBody);
        if (
          !body ||
          body.certificateId !== base.certificate.body.certificateId ||
          body.deviceId !== base.certificate.body.deviceId ||
          body.deviceKeyId !== base.certificate.body.deviceKeyId ||
          body.issuedAt > assessedAt ||
          Date.parse(body.expiresAt) <= Date.parse(assessedAt)
        ) {
          if (body) {
            await dependencies.releaseAssignment(body.assignmentId).catch(() => undefined);
          }
          return errorResponse(503, 'temporarily_unavailable');
        }
        let assignment: SignedKemerBetExactFiveLookupAssignment | undefined;
        try {
          assignment = await signAssignment(body, dependencies.signer);
        } catch {
          await dependencies.releaseAssignment(body.assignmentId);
          return errorResponse(503, 'temporarily_unavailable');
        }
        if (!assignment) {
          await dependencies.releaseAssignment(body.assignmentId).catch(() => undefined);
          return errorResponse(503, 'temporarily_unavailable');
        }
        try {
          if (!(await dependencies.completeAssignment(assignment.bodyDigest, assignment))) {
            return errorResponse(503, 'temporarily_unavailable');
          }
        } catch {
          // A committed signature is recoverable from a fresh signed poll.
          return errorResponse(503, 'temporarily_unavailable');
        }
        return jsonResponse(200, { assignment });
      }

      const assignment = decodeSignedKemerBetExactFiveLookupAssignment(parsed.signedAssignment);
      const result = decodeSignedKemerBetExactFiveLookupResult(parsed.signedResult);
      const base = verifiedBase(
        parsed,
        ['certificate', 'httpRequest', 'signedAssignment', 'signedResult'],
        AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH,
        assignment && result ? digestCompanionLookupResultContent(assignment, result) : undefined,
        dependencies.signer,
        assessedAt,
      );
      if (!base || !assignment || !result) return errorResponse(401, 'invalid_request');
      const exchange = verifyKemerBetExactFiveLookupExchange(
        {
          assessedAt,
          certificate: base.certificate,
          signedAssignment: assignment,
          signedResult: result,
        },
        dependencies.signer.publicKeySpkiDer,
      );
      const resultReplayIdentity = deriveKemerBetExactFiveLookupResultReplayIdentity(result);
      if (exchange.disposition !== 'would_accept_read_only_result' || !resultReplayIdentity) {
        return errorResponse(401, 'invalid_request');
      }
      const accepted = await dependencies.acceptResult(
        base.certificate,
        base.httpRequest,
        base.httpReplayIdentity,
        assignment,
        result,
        resultReplayIdentity,
        assessedAt,
      );
      return accepted
        ? jsonResponse(accepted.replayed ? 200 : 201, accepted)
        : errorResponse(401, 'invalid_request');
    } catch {
      return errorResponse(503, 'temporarily_unavailable');
    }
  };
}
