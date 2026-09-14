import { isProxy } from 'node:util/types';

import {
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  decodeSignedCompanionEnrollmentCertificate,
  decodeSignedCompanionHttpRequest,
  deriveCompanionHttpRequestReplayIdentity,
  verifySignedCompanionEnrollmentCertificate,
  verifySignedCompanionHttpRequest,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionHttpRequest,
} from '@fetanagent/agent-platform-companion-contracts';
import {
  COMPANION_AUTHORITATIVE_EXECUTION_STATUS_TRANSCRIPT,
  COMPANION_EXECUTION_ASSIGNMENT_TRANSCRIPT,
  COMPANION_EXECUTION_AUTHORITY_PATH,
  COMPANION_EXECUTION_CONTRACT_VERSION,
  COMPANION_EXECUTION_DIGEST_ALGORITHM,
  COMPANION_EXECUTION_ENROLLMENT_TRANSCRIPT,
  COMPANION_EXECUTION_POLL_PATH,
  COMPANION_EXECUTION_PROTOCOL_MODE,
  COMPANION_EXECUTION_RESULT_PATH,
  COMPANION_EXECUTION_RESULT_TRANSCRIPT,
  COMPANION_EXECUTION_SIGNATURE_ALGORITHM,
  COMPANION_EXECUTION_SIGNATURE_ENCODING,
  COMPANION_EXECUTION_STATUS_PATH,
  COMPANION_ONE_USE_ACTION_AUTHORITY_TRANSCRIPT,
  canonicalAuthoritativeExecutionStatusSignatureBytes,
  canonicalExecutionAssignmentSignatureBytes,
  canonicalExecutionEnrollmentSignatureBytes,
  canonicalOneUseActionAuthoritySignatureBytes,
  decodeAuthoritativeExecutionStatusBody,
  decodeExecutionAssignmentBody,
  decodeExecutionEnrollmentBody,
  decodeOneUseActionAuthorityBody,
  decodeSignedAuthoritativeExecutionStatus,
  decodeSignedExecutionAssignment,
  decodeSignedExecutionEnrollment,
  decodeSignedExecutionResult,
  decodeSignedOneUseActionAuthority,
  digestAuthoritativeExecutionStatusBody,
  digestCompanionExecutionAuthorityRequestContent,
  digestCompanionExecutionPlayerId,
  digestCompanionExecutionPollContent,
  digestCompanionExecutionResultContent,
  digestCompanionExecutionStatusQueryContent,
  digestExecutionAssignmentBody,
  digestExecutionEnrollmentBody,
  digestOneUseActionAuthorityBody,
  verifySignedAuthoritativeExecutionStatus,
  verifySignedExecutionAssignment,
  verifySignedExecutionEnrollment,
  verifySignedExecutionResult,
  verifySignedOneUseActionAuthorityCryptographically,
  type AuthoritativeExecutionStatusBody,
  type ExecutionAssignmentBody,
  type ExecutionEnrollmentBody,
  type OneUseActionAuthorityBody,
  type SignedAuthoritativeExecutionStatus,
  type SignedExecutionAssignment,
  type SignedExecutionEnrollment,
  type SignedExecutionResult,
  type SignedOneUseActionAuthority,
  type TrustedExecutionIdentityContext,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import type {
  CompanionBridgeHttpRequest,
  CompanionBridgeHttpResponse,
  CompanionBridgeSigner,
} from './pairing-handler.js';

const MAXIMUM_EXECUTION_BODY_BYTES = 128 * 1_024;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const responseHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const);

export type CompanionExecutionAssignmentClaim =
  | { readonly kind: 'none' }
  | { readonly kind: 'in_progress' }
  | {
      readonly kind: 'claimed';
      readonly enrollmentBody: ExecutionEnrollmentBody;
      readonly assignmentBody: ExecutionAssignmentBody;
      readonly playerId: string;
    }
  | {
      readonly kind: 'completed';
      readonly enrollment: SignedExecutionEnrollment;
      readonly assignment: SignedExecutionAssignment;
      readonly playerId: string;
      readonly authority: SignedOneUseActionAuthority | null;
      readonly result: SignedExecutionResult | null;
    };

export type CompanionExecutionAuthorityClaim =
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'claimed'; readonly authorityBody: OneUseActionAuthorityBody }
  | { readonly kind: 'completed'; readonly authority: SignedOneUseActionAuthority };

export type CompanionExecutionStatusClaim =
  | { readonly kind: 'claimed'; readonly statusBody: AuthoritativeExecutionStatusBody }
  | { readonly kind: 'completed'; readonly status: SignedAuthoritativeExecutionStatus };

export interface CompanionExecutionAcceptance {
  readonly accepted: true;
  readonly replayed: boolean;
}

export interface CompanionExecutionHandlerDependencies {
  readonly noMoneySigner: CompanionBridgeSigner;
  readonly executionSigner: CompanionBridgeSigner;
  now(): string;
  claimAssignment(
    certificate: SignedCompanionEnrollmentCertificate,
    request: SignedCompanionHttpRequest,
    httpReplayIdentity: string,
    assessedAt: string,
  ): Promise<CompanionExecutionAssignmentClaim | undefined>;
  completeAssignment(
    enrollmentBodyDigest: string,
    enrollment: SignedExecutionEnrollment,
    assignmentBodyDigest: string,
    assignment: SignedExecutionAssignment,
  ): Promise<boolean>;
  claimAuthority(
    certificate: SignedCompanionEnrollmentCertificate,
    request: SignedCompanionHttpRequest,
    httpReplayIdentity: string,
    enrollment: SignedExecutionEnrollment,
    assignment: SignedExecutionAssignment,
    requestNonceDigest: string,
    assessedAt: string,
  ): Promise<CompanionExecutionAuthorityClaim | undefined>;
  completeAuthority(
    authorityBodyDigest: string,
    authority: SignedOneUseActionAuthority,
  ): Promise<boolean>;
  acceptResult(
    certificate: SignedCompanionEnrollmentCertificate,
    request: SignedCompanionHttpRequest,
    httpReplayIdentity: string,
    enrollment: SignedExecutionEnrollment,
    assignment: SignedExecutionAssignment,
    authority: SignedOneUseActionAuthority,
    result: SignedExecutionResult,
    assessedAt: string,
  ): Promise<CompanionExecutionAcceptance | undefined>;
  claimStatus(
    certificate: SignedCompanionEnrollmentCertificate,
    request: SignedCompanionHttpRequest,
    httpReplayIdentity: string,
    enrollment: SignedExecutionEnrollment,
    assignment: SignedExecutionAssignment,
    authority: SignedOneUseActionAuthority | null,
    result: SignedExecutionResult | null,
    queryNonceDigest: string,
    assessedAt: string,
  ): Promise<CompanionExecutionStatusClaim | undefined>;
  completeStatus(
    statusBodyDigest: string,
    status: SignedAuthoritativeExecutionStatus,
  ): Promise<boolean>;
}

interface VerifiedHttpBase {
  readonly certificate: SignedCompanionEnrollmentCertificate;
  readonly httpRequest: SignedCompanionHttpRequest;
  readonly httpReplayIdentity: string;
}

interface VerifiedExecutionChain {
  readonly enrollment: SignedExecutionEnrollment;
  readonly assignment: SignedExecutionAssignment;
  readonly identity: TrustedExecutionIdentityContext;
}

/**
 * Keep the published execution paths opaque while the separately gated execution transport is
 * dormant. The HTTP server has already validated the request envelope before this handler runs;
 * returning the same unauthenticated response as the active handler avoids routing an execution
 * path through the unrelated pairing protocol and grants no database or signing capability.
 */
export function createDormantCompanionExecutionHandler(): (
  request: CompanionBridgeHttpRequest,
) => Promise<CompanionBridgeHttpResponse> {
  return async (_request) => errorResponse(401, 'invalid_request');
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
    [
      COMPANION_EXECUTION_POLL_PATH,
      COMPANION_EXECUTION_AUTHORITY_PATH,
      COMPANION_EXECUTION_RESULT_PATH,
      COMPANION_EXECUTION_STATUS_PATH,
    ].includes(request.path as never) &&
    contentTypes?.length === 1 &&
    contentTypes[0] === AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE &&
    accepts?.length === 1 &&
    accepts[0] === AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE &&
    request.body instanceof Uint8Array &&
    request.body.byteLength > 0 &&
    request.body.byteLength <= MAXIMUM_EXECUTION_BODY_BYTES,
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

function verifiedHttpBase(
  candidate: Record<string, unknown>,
  expectedKeys: readonly string[],
  path: CompanionBridgeHttpRequest['path'],
  contentDigest: string | undefined,
  signer: CompanionBridgeSigner,
  assessedAt: string,
): VerifiedHttpBase | undefined {
  if (!exactKeys(candidate, expectedKeys) || !contentDigest) return undefined;
  const certificate = decodeSignedCompanionEnrollmentCertificate(candidate.certificate);
  const httpRequest = decodeSignedCompanionHttpRequest(candidate.httpRequest);
  if (
    !certificate ||
    !httpRequest ||
    certificate.signerKeyId !== signer.keyId ||
    httpRequest.body.method !== 'POST' ||
    httpRequest.body.canonicalPath !== path ||
    httpRequest.body.contentDigest !== contentDigest ||
    httpRequest.body.certificateId !== certificate.body.certificateId ||
    httpRequest.body.deviceId !== certificate.body.deviceId ||
    httpRequest.body.deviceKeyId !== certificate.body.deviceKeyId ||
    !verifySignedCompanionEnrollmentCertificate(certificate, signer.publicKeySpkiDer) ||
    !verifySignedCompanionHttpRequest(httpRequest, certificate, signer.publicKeySpkiDer, assessedAt)
  ) {
    return undefined;
  }
  const httpReplayIdentity = deriveCompanionHttpRequestReplayIdentity(httpRequest);
  return httpReplayIdentity ? { certificate, httpRequest, httpReplayIdentity } : undefined;
}

function identityContext(
  certificate: SignedCompanionEnrollmentCertificate,
  assignment: SignedExecutionAssignment,
  noMoneySigner: CompanionBridgeSigner,
  executionSigner: CompanionBridgeSigner,
  assessedAt: string,
): TrustedExecutionIdentityContext {
  return {
    signedNoMoneyCertificate: certificate,
    trustedNoMoneyServerPublicKeySpkiDer: noMoneySigner.publicKeySpkiDer,
    trustedExecutionSignerKeyId: executionSigner.keyId,
    trustedExecutionSignerPublicKeySpkiDer: executionSigner.publicKeySpkiDer,
    expectedDeviceId: certificate.body.deviceId,
    expectedDeviceKeyId: certificate.body.deviceKeyId,
    expectedPlatformAgentAccountId: assignment.body.platformAgentAccountId,
    trustedNow: assessedAt,
  };
}

function verifiedExecutionChain(
  certificate: SignedCompanionEnrollmentCertificate,
  enrollmentCandidate: unknown,
  assignmentCandidate: unknown,
  noMoneySigner: CompanionBridgeSigner,
  executionSigner: CompanionBridgeSigner,
  assessedAt: string,
): VerifiedExecutionChain | undefined {
  const enrollment = decodeSignedExecutionEnrollment(enrollmentCandidate);
  const assignment = decodeSignedExecutionAssignment(assignmentCandidate);
  if (!enrollment || !assignment) return undefined;
  const identity = identityContext(
    certificate,
    assignment,
    noMoneySigner,
    executionSigner,
    assessedAt,
  );
  if (
    !verifySignedExecutionEnrollment(enrollment, identity) ||
    !verifySignedExecutionAssignment(assignment, {
      ...identity,
      signedExecutionEnrollment: enrollment,
      roundTrip: { monotonicRequestStartedMs: 0, monotonicResponseReceivedMs: 0 },
      consumedReplayIdentities: [],
    })
  ) {
    return undefined;
  }
  return { enrollment, assignment, identity };
}

async function signEnrollment(
  body: ExecutionEnrollmentBody,
  signer: CompanionBridgeSigner,
): Promise<SignedExecutionEnrollment | undefined> {
  const bodyDigest = digestExecutionEnrollmentBody(body);
  const transcript = canonicalExecutionEnrollmentSignatureBytes(body);
  if (!bodyDigest || !transcript) return undefined;
  const signature = await signer.signP1363(transcript);
  return decodeSignedExecutionEnrollment({
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    transcriptVersion: COMPANION_EXECUTION_ENROLLMENT_TRANSCRIPT,
    bodyDigestAlgorithm: COMPANION_EXECUTION_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: COMPANION_EXECUTION_SIGNATURE_ALGORITHM,
    signatureEncoding: COMPANION_EXECUTION_SIGNATURE_ENCODING,
    signerKeyId: signer.keyId,
    body,
    signature,
  });
}

async function signAssignment(
  body: ExecutionAssignmentBody,
  signer: CompanionBridgeSigner,
): Promise<SignedExecutionAssignment | undefined> {
  const bodyDigest = digestExecutionAssignmentBody(body);
  const transcript = canonicalExecutionAssignmentSignatureBytes(body);
  if (!bodyDigest || !transcript) return undefined;
  const signature = await signer.signP1363(transcript);
  return decodeSignedExecutionAssignment({
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    transcriptVersion: COMPANION_EXECUTION_ASSIGNMENT_TRANSCRIPT,
    bodyDigestAlgorithm: COMPANION_EXECUTION_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: COMPANION_EXECUTION_SIGNATURE_ALGORITHM,
    signatureEncoding: COMPANION_EXECUTION_SIGNATURE_ENCODING,
    signerKeyId: signer.keyId,
    body,
    signature,
  });
}

async function signAuthority(
  body: OneUseActionAuthorityBody,
  signer: CompanionBridgeSigner,
): Promise<SignedOneUseActionAuthority | undefined> {
  const bodyDigest = digestOneUseActionAuthorityBody(body);
  const transcript = canonicalOneUseActionAuthoritySignatureBytes(body);
  if (!bodyDigest || !transcript) return undefined;
  const signature = await signer.signP1363(transcript);
  return decodeSignedOneUseActionAuthority({
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    transcriptVersion: COMPANION_ONE_USE_ACTION_AUTHORITY_TRANSCRIPT,
    bodyDigestAlgorithm: COMPANION_EXECUTION_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: COMPANION_EXECUTION_SIGNATURE_ALGORITHM,
    signatureEncoding: COMPANION_EXECUTION_SIGNATURE_ENCODING,
    signerKeyId: signer.keyId,
    body,
    signature,
  });
}

async function signStatus(
  body: AuthoritativeExecutionStatusBody,
  signer: CompanionBridgeSigner,
): Promise<SignedAuthoritativeExecutionStatus | undefined> {
  const bodyDigest = digestAuthoritativeExecutionStatusBody(body);
  const transcript = canonicalAuthoritativeExecutionStatusSignatureBytes(body);
  if (!bodyDigest || !transcript) return undefined;
  const signature = await signer.signP1363(transcript);
  return decodeSignedAuthoritativeExecutionStatus({
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    transcriptVersion: COMPANION_AUTHORITATIVE_EXECUTION_STATUS_TRANSCRIPT,
    bodyDigestAlgorithm: COMPANION_EXECUTION_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: COMPANION_EXECUTION_SIGNATURE_ALGORITHM,
    signatureEncoding: COMPANION_EXECUTION_SIGNATURE_ENCODING,
    signerKeyId: signer.keyId,
    body,
    signature,
  });
}

/**
 * The bridge authenticates transport with the paired no-money certificate. Only a separately
 * signed, database-fenced authority response can reach the later local action boundary.
 */
export function createCompanionExecutionHandler(
  dependencies: CompanionExecutionHandlerDependencies,
): (request: CompanionBridgeHttpRequest) => Promise<CompanionBridgeHttpResponse> {
  return async (request) => {
    try {
      if (request.body.byteLength > MAXIMUM_EXECUTION_BODY_BYTES) {
        return errorResponse(413, 'invalid_request');
      }
      if (!validHttpEnvelope(request)) return errorResponse(400, 'invalid_request');
      const parsed = parseJson(request.body);
      const assessedAt = canonicalTimestamp(dependencies.now());
      if (!parsed || !assessedAt) return errorResponse(401, 'invalid_request');

      if (request.path === COMPANION_EXECUTION_POLL_PATH) {
        const certificateCandidate = decodeSignedCompanionEnrollmentCertificate(parsed.certificate);
        const base = verifiedHttpBase(
          parsed,
          ['certificate', 'httpRequest'],
          request.path,
          digestCompanionExecutionPollContent(certificateCandidate?.bodyDigest),
          dependencies.noMoneySigner,
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
          const chain = verifiedExecutionChain(
            base.certificate,
            claim.enrollment,
            claim.assignment,
            dependencies.noMoneySigner,
            dependencies.executionSigner,
            assessedAt,
          );
          if (
            !chain ||
            digestCompanionExecutionPlayerId(claim.playerId) !==
              claim.assignment.body.playerIdDigest
          ) {
            return errorResponse(503, 'temporarily_unavailable');
          }
          return jsonResponse(200, {
            enrollment: claim.enrollment,
            assignment: claim.assignment,
            playerId: claim.playerId,
            authority: claim.authority,
            result: claim.result,
          });
        }
        const enrollmentBody = decodeExecutionEnrollmentBody(claim.enrollmentBody);
        const assignmentBody = decodeExecutionAssignmentBody(claim.assignmentBody);
        if (
          !enrollmentBody ||
          !assignmentBody ||
          enrollmentBody.executionSignerKeyId !== dependencies.executionSigner.keyId ||
          assignmentBody.executionSignerKeyId !== dependencies.executionSigner.keyId ||
          assignmentBody.enrollmentId !== enrollmentBody.enrollmentId ||
          digestCompanionExecutionPlayerId(claim.playerId) !== assignmentBody.playerIdDigest
        ) {
          return errorResponse(503, 'temporarily_unavailable');
        }
        const enrollment = await signEnrollment(enrollmentBody, dependencies.executionSigner);
        const assignment = await signAssignment(assignmentBody, dependencies.executionSigner);
        if (!enrollment || !assignment) return errorResponse(503, 'temporarily_unavailable');
        const chain = verifiedExecutionChain(
          base.certificate,
          enrollment,
          assignment,
          dependencies.noMoneySigner,
          dependencies.executionSigner,
          assessedAt,
        );
        if (!chain) return errorResponse(503, 'temporarily_unavailable');
        try {
          if (
            !(await dependencies.completeAssignment(
              enrollment.bodyDigest,
              enrollment,
              assignment.bodyDigest,
              assignment,
            ))
          ) {
            return errorResponse(503, 'temporarily_unavailable');
          }
        } catch {
          return errorResponse(503, 'temporarily_unavailable');
        }
        return jsonResponse(201, {
          enrollment,
          assignment,
          playerId: claim.playerId,
          authority: null,
          result: null,
        });
      }

      if (request.path === COMPANION_EXECUTION_AUTHORITY_PATH) {
        const requestNonceDigest = parsed.requestNonceDigest;
        const contentDigest = digestCompanionExecutionAuthorityRequestContent(
          parsed.enrollment,
          parsed.assignment,
          requestNonceDigest,
        );
        const base = verifiedHttpBase(
          parsed,
          ['certificate', 'httpRequest', 'enrollment', 'assignment', 'requestNonceDigest'],
          request.path,
          contentDigest,
          dependencies.noMoneySigner,
          assessedAt,
        );
        const chain =
          base &&
          verifiedExecutionChain(
            base.certificate,
            parsed.enrollment,
            parsed.assignment,
            dependencies.noMoneySigner,
            dependencies.executionSigner,
            assessedAt,
          );
        if (!base || !chain || typeof requestNonceDigest !== 'string') {
          return errorResponse(401, 'invalid_request');
        }
        const claim = await dependencies.claimAuthority(
          base.certificate,
          base.httpRequest,
          base.httpReplayIdentity,
          chain.enrollment,
          chain.assignment,
          requestNonceDigest,
          assessedAt,
        );
        if (!claim) return errorResponse(401, 'invalid_request');
        if (claim.kind === 'in_progress') return errorResponse(409, 'request_in_progress');
        const authority =
          claim.kind === 'completed'
            ? claim.authority
            : await signAuthority(claim.authorityBody, dependencies.executionSigner);
        if (
          !authority ||
          !verifySignedOneUseActionAuthorityCryptographically(authority, {
            ...chain.identity,
            signedExecutionEnrollment: chain.enrollment,
            signedExecutionAssignment: chain.assignment,
            expectedRequestNonceDigest: requestNonceDigest,
            roundTrip: { monotonicRequestStartedMs: 0, monotonicResponseReceivedMs: 0 },
            consumedReplayIdentities: [],
          })
        ) {
          return errorResponse(503, 'temporarily_unavailable');
        }
        if (
          claim.kind === 'claimed' &&
          !(await dependencies.completeAuthority(authority.bodyDigest, authority))
        ) {
          return errorResponse(503, 'temporarily_unavailable');
        }
        return jsonResponse(claim.kind === 'claimed' ? 201 : 200, { authority });
      }

      if (request.path === COMPANION_EXECUTION_RESULT_PATH) {
        const contentDigest = digestCompanionExecutionResultContent(
          parsed.enrollment,
          parsed.assignment,
          parsed.authority,
          parsed.result,
        );
        const base = verifiedHttpBase(
          parsed,
          ['certificate', 'httpRequest', 'enrollment', 'assignment', 'authority', 'result'],
          request.path,
          contentDigest,
          dependencies.noMoneySigner,
          assessedAt,
        );
        const chain =
          base &&
          verifiedExecutionChain(
            base.certificate,
            parsed.enrollment,
            parsed.assignment,
            dependencies.noMoneySigner,
            dependencies.executionSigner,
            assessedAt,
          );
        const authority = decodeSignedOneUseActionAuthority(parsed.authority);
        const result = decodeSignedExecutionResult(parsed.result);
        if (
          !base ||
          !chain ||
          !authority ||
          !result ||
          !verifySignedExecutionResult(result, {
            ...chain.identity,
            signedExecutionEnrollment: chain.enrollment,
            signedExecutionAssignment: chain.assignment,
            signedOneUseActionAuthority: authority,
            consumedReplayIdentities: [],
          })
        ) {
          return errorResponse(401, 'invalid_request');
        }
        const accepted = await dependencies.acceptResult(
          base.certificate,
          base.httpRequest,
          base.httpReplayIdentity,
          chain.enrollment,
          chain.assignment,
          authority,
          result,
          assessedAt,
        );
        return accepted
          ? jsonResponse(accepted.replayed ? 200 : 201, accepted)
          : errorResponse(401, 'invalid_request');
      }

      const queryNonceDigest = parsed.queryNonceDigest;
      const contentDigest = digestCompanionExecutionStatusQueryContent(
        parsed.enrollment,
        parsed.assignment,
        queryNonceDigest,
      );
      const base = verifiedHttpBase(
        parsed,
        [
          'certificate',
          'httpRequest',
          'enrollment',
          'assignment',
          'authority',
          'result',
          'queryNonceDigest',
        ],
        request.path,
        contentDigest,
        dependencies.noMoneySigner,
        assessedAt,
      );
      const chain =
        base &&
        verifiedExecutionChain(
          base.certificate,
          parsed.enrollment,
          parsed.assignment,
          dependencies.noMoneySigner,
          dependencies.executionSigner,
          assessedAt,
        );
      const authority =
        parsed.authority === null
          ? null
          : (decodeSignedOneUseActionAuthority(parsed.authority) ?? null);
      const result =
        parsed.result === null ? null : (decodeSignedExecutionResult(parsed.result) ?? null);
      if (
        !base ||
        !chain ||
        typeof queryNonceDigest !== 'string' ||
        (parsed.authority !== null && !authority) ||
        (parsed.result !== null && !result)
      ) {
        return errorResponse(401, 'invalid_request');
      }
      if (
        result &&
        !verifySignedExecutionResult(result, {
          ...chain.identity,
          signedExecutionEnrollment: chain.enrollment,
          signedExecutionAssignment: chain.assignment,
          signedOneUseActionAuthority: authority,
          consumedReplayIdentities: [],
        })
      ) {
        return errorResponse(401, 'invalid_request');
      }
      const claim = await dependencies.claimStatus(
        base.certificate,
        base.httpRequest,
        base.httpReplayIdentity,
        chain.enrollment,
        chain.assignment,
        authority,
        result,
        queryNonceDigest,
        assessedAt,
      );
      if (!claim) return errorResponse(401, 'invalid_request');
      const status =
        claim.kind === 'completed'
          ? claim.status
          : await signStatus(claim.statusBody, dependencies.executionSigner);
      if (
        !status ||
        !verifySignedAuthoritativeExecutionStatus(status, {
          ...chain.identity,
          signedExecutionEnrollment: chain.enrollment,
          signedExecutionAssignment: chain.assignment,
          signedOneUseActionAuthority: authority,
          signedExecutionResult: result,
          expectedQueryNonceDigest: queryNonceDigest,
          minimumStatusSequence: '1',
          roundTrip: { monotonicRequestStartedMs: 0, monotonicResponseReceivedMs: 0 },
          consumedReplayIdentities: [],
        })
      ) {
        return errorResponse(503, 'temporarily_unavailable');
      }
      if (
        claim.kind === 'claimed' &&
        !(await dependencies.completeStatus(status.bodyDigest, status))
      ) {
        return errorResponse(503, 'temporarily_unavailable');
      }
      return jsonResponse(claim.kind === 'claimed' ? 201 : 200, { status });
    } catch {
      return errorResponse(503, 'temporarily_unavailable');
    }
  };
}
