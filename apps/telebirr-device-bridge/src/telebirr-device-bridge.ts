import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import {
  TELEBIRR_DEVICE_BRIDGE_ACKNOWLEDGEMENT_TRANSCRIPT_VERSION,
  TELEBIRR_DEVICE_BRIDGE_CERTIFICATE_TRANSCRIPT_VERSION,
  TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE,
  TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
  TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM,
  TELEBIRR_DEVICE_BRIDGE_PAIRING_PATH,
  TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
  TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE,
  TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM,
  TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING,
  canonicalTelebirrDeviceBridgeAcknowledgementSignatureBytes,
  canonicalTelebirrDeviceBridgeEnrollmentCertificateSignatureBytes,
  decodeSignedTelebirrDeviceBridgeAcknowledgement,
  decodeSignedTelebirrDeviceBridgeEnrollmentCertificate,
  decodeSignedTelebirrDeviceBridgePairingRequest,
  decodeSignedTelebirrDeviceBridgeRequest,
  decodeTelebirrDeviceBridgeAcknowledgementBody,
  decodeTelebirrDeviceBridgeCommandFrame,
  decodeTelebirrDeviceBridgeEnrollmentCertificateBody,
  decodeTelebirrLivePilotSignedAssignment,
  deriveTelebirrDeviceBridgeRequestReplayIdentity,
  digestTelebirrDeviceBridgeAcknowledgementBody,
  digestTelebirrDeviceBridgeEnrollmentCertificateBody,
  telebirrDeviceBridgeCertificateMatchesPairingRequest,
  verifySignedTelebirrDeviceBridgeAcknowledgement,
  verifySignedTelebirrDeviceBridgeEnrollmentCertificate,
  verifySignedTelebirrDeviceBridgePairingRequest,
  verifySignedTelebirrDeviceBridgeRequest,
  verifyTelebirrLivePilotSignedAssignmentSignature,
  verifyTelebirrLivePilotSignedObservationSignature,
  type SignedTelebirrDeviceBridgeAcknowledgement,
  type SignedTelebirrDeviceBridgeEnrollmentCertificate,
  type SignedTelebirrDeviceBridgePairingRequest,
  type SignedTelebirrDeviceBridgeRequest,
  type TelebirrDeviceBridgeAcknowledgementBody,
  type TelebirrDeviceBridgeAssignmentPollPayload,
  type TelebirrDeviceBridgeCommandFrame,
  type TelebirrDeviceBridgeEnrollmentCertificateBody,
  type TelebirrDeviceBridgeHeartbeatPayload,
  type TelebirrDeviceBridgeObservationUploadPayload,
  type TelebirrDeviceBridgeReasonCode,
  type TelebirrLivePilotSignedAssignment,
} from '@fetanagent/telebirr-verification-foundation';

const MAX_PAIRING_BODY_BYTES = 64 * 1_024;
const MAX_COMMAND_BODY_BYTES = 256 * 1_024;
const ERROR_CONTENT_TYPE = 'application/json; charset=utf-8';
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/u;

const responseHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const);

export interface TelebirrDeviceBridgeHttpRequest {
  readonly method: string;
  readonly path: string;
  /** Header tuples preserve duplicates so ambiguous framing can be rejected. */
  readonly headers: readonly (readonly [string, string])[];
  readonly body: Uint8Array;
}

export interface TelebirrDeviceBridgeHttpResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface TelebirrDeviceBridgeCommandResponse {
  readonly acknowledgement: SignedTelebirrDeviceBridgeAcknowledgement;
  readonly assignment: TelebirrLivePilotSignedAssignment | null;
}

export type TelebirrDeviceBridgeReplayClaim =
  | { readonly kind: 'claimed' }
  | { readonly kind: 'in_progress' }
  | {
      readonly kind: 'completed';
      readonly response: TelebirrDeviceBridgeCommandResponse;
    };

export type TelebirrDeviceBridgePairingClaim =
  | {
      readonly kind: 'claimed';
      readonly certificateBody: TelebirrDeviceBridgeEnrollmentCertificateBody;
    }
  | { readonly kind: 'in_progress' }
  | {
      readonly kind: 'completed';
      readonly certificate: SignedTelebirrDeviceBridgeEnrollmentCertificate;
    };

export type TelebirrDeviceBridgeAssignmentPollResult =
  | { readonly kind: 'assignment'; readonly assignment: TelebirrLivePilotSignedAssignment }
  | { readonly kind: 'none' }
  | { readonly kind: 'retry' }
  | {
      readonly kind: 'rejected';
      readonly reason: Extract<TelebirrDeviceBridgeReasonCode, 'device_revoked' | 'pilot_stopped'>;
    };

export type TelebirrDeviceBridgeEvidenceStageResult =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'retry' }
  | {
      readonly kind: 'rejected';
      readonly reason: Extract<
        TelebirrDeviceBridgeReasonCode,
        'binding_mismatch' | 'device_revoked' | 'observation_rejected' | 'pilot_stopped'
      >;
    };

export type TelebirrDeviceBridgeHeartbeatResult =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'retry' }
  | {
      readonly kind: 'rejected';
      readonly reason: Extract<TelebirrDeviceBridgeReasonCode, 'device_revoked' | 'pilot_stopped'>;
    };

export interface TelebirrDeviceBridgeServerSigner {
  readonly keyId: string;
  signP1363(transcript: Uint8Array): Promise<string>;
}

export interface TelebirrDeviceBridgeDependencies {
  /** Public half of serverSigner; used to self-check every certificate and acknowledgement. */
  readonly serverSigningPublicKeySpkiDer: Uint8Array;
  /** Public assignment key; its digest must equal the certificate's pinned signer digest. */
  readonly assignmentSigningPublicKeySpkiDer: Uint8Array;
  readonly serverSigner: TelebirrDeviceBridgeServerSigner;
  readonly now: () => string;
  readonly nextOpaqueId: (kind: 'acknowledgement') => string;

  /**
   * Atomically claims an Owner-created one-use challenge. An exact retry after an uncertain reply
   * returns the original signed certificate; a different request can never consume that replay.
   */
  claimPairingChallenge(
    request: SignedTelebirrDeviceBridgePairingRequest,
    assessedAt: string,
  ): Promise<TelebirrDeviceBridgePairingClaim | undefined>;
  completePairingChallenge(
    pairingRequestBodyDigest: string,
    certificate: SignedTelebirrDeviceBridgeEnrollmentCertificate,
  ): Promise<boolean>;
  releasePairingChallenge(pairingRequestBodyDigest: string): Promise<void>;

  loadEnrollment(
    enrollmentId: string,
  ): Promise<SignedTelebirrDeviceBridgeEnrollmentCertificate | undefined>;

  /** Replay state stores only protocol objects and expiry; implementations must be atomic. */
  claimReplay(
    replayIdentity: string,
    requestExpiresAt: string,
  ): Promise<TelebirrDeviceBridgeReplayClaim>;
  completeReplay(
    replayIdentity: string,
    response: TelebirrDeviceBridgeCommandResponse,
    requestExpiresAt: string,
  ): Promise<boolean>;
  releaseReplay(replayIdentity: string): Promise<void>;

  pollAssignment(
    certificate: TelebirrDeviceBridgeEnrollmentCertificateBody,
    request: SignedTelebirrDeviceBridgeRequest,
    payload: TelebirrDeviceBridgeAssignmentPollPayload,
  ): Promise<TelebirrDeviceBridgeAssignmentPollResult>;

  recordHeartbeat(
    certificate: TelebirrDeviceBridgeEnrollmentCertificateBody,
    request: SignedTelebirrDeviceBridgeRequest,
    payload: TelebirrDeviceBridgeHeartbeatPayload,
  ): Promise<TelebirrDeviceBridgeHeartbeatResult>;

  /**
   * Evidence-only sink. It may stage the exact pair for the isolated trusted verifier, but must not
   * claim, settle, enqueue, execute, mutate a wallet, or expose a database credential.
   * Implementations must be idempotent by the signed observation body digest because a device may
   * create a fresh authenticated HTTP request around the same staged evidence after a lost reply.
   */
  stageEvidenceOnly(
    certificate: TelebirrDeviceBridgeEnrollmentCertificateBody,
    request: SignedTelebirrDeviceBridgeRequest,
    payload: TelebirrDeviceBridgeObservationUploadPayload,
  ): Promise<TelebirrDeviceBridgeEvidenceStageResult>;
}

export function createTelebirrDeviceBridgeHandler(
  dependencies: TelebirrDeviceBridgeDependencies,
): (request: TelebirrDeviceBridgeHttpRequest) => Promise<TelebirrDeviceBridgeHttpResponse> {
  const serverSpki = copyBytes(dependencies.serverSigningPublicKeySpkiDer);
  const assignmentSpki = copyBytes(dependencies.assignmentSigningPublicKeySpkiDer);
  const assignmentSpkiDigest = sha256(assignmentSpki);

  return async (request) => {
    try {
      if (!validHttpEnvelope(request)) return errorResponse(400, 'invalid_request');
      if (request.path === TELEBIRR_DEVICE_BRIDGE_PAIRING_PATH) {
        return await handlePairing(request, dependencies, serverSpki, assignmentSpkiDigest);
      }
      return await handleCommand(
        request,
        dependencies,
        serverSpki,
        assignmentSpki,
        assignmentSpkiDigest,
      );
    } catch {
      return errorResponse(503, 'temporarily_unavailable');
    }
  };
}

async function handlePairing(
  request: TelebirrDeviceBridgeHttpRequest,
  dependencies: TelebirrDeviceBridgeDependencies,
  serverSpki: Uint8Array,
  assignmentSpkiDigest: string,
): Promise<TelebirrDeviceBridgeHttpResponse> {
  if (request.body.byteLength > MAX_PAIRING_BODY_BYTES)
    return errorResponse(413, 'invalid_request');
  const decoded = parseJson(request.body);
  const pairing = decodeSignedTelebirrDeviceBridgePairingRequest(decoded);
  const assessedAt = canonicalTimestamp(dependencies.now());
  if (
    !pairing ||
    !assessedAt ||
    !verifySignedTelebirrDeviceBridgePairingRequest(pairing) ||
    Date.parse(assessedAt) < Date.parse(pairing.body.issuedAt)
  ) {
    return errorResponse(401, 'invalid_request');
  }
  const claim = await dependencies.claimPairingChallenge(pairing, assessedAt);
  if (!claim) return errorResponse(401, 'invalid_request');
  if (claim.kind === 'in_progress') return errorResponse(409, 'request_in_progress');
  if (claim.kind === 'completed') {
    return validCachedCertificate(
      claim.certificate,
      pairing,
      serverSpki,
      assignmentSpkiDigest,
      assessedAt,
    )
      ? jsonResponse(201, { certificate: claim.certificate })
      : errorResponse(503, 'temporarily_unavailable');
  }

  const body = decodeTelebirrDeviceBridgeEnrollmentCertificateBody(claim.certificateBody);
  if (
    Date.parse(assessedAt) >= Date.parse(pairing.body.expiresAt) ||
    !body ||
    body.state !== 'active' ||
    body.assignmentSignerPublicKeySpkiSha256 !== assignmentSpkiDigest
  ) {
    await dependencies.releasePairingChallenge(pairing.bodyDigest);
    return errorResponse(401, 'invalid_request');
  }
  let certificate: SignedTelebirrDeviceBridgeEnrollmentCertificate | undefined;
  try {
    certificate = await signCertificate(body, dependencies, serverSpki);
  } catch {
    await dependencies.releasePairingChallenge(pairing.bodyDigest);
    return errorResponse(503, 'temporarily_unavailable');
  }
  if (!certificate || !telebirrDeviceBridgeCertificateMatchesPairingRequest(certificate, pairing)) {
    await dependencies.releasePairingChallenge(pairing.bodyDigest);
    return errorResponse(503, 'temporarily_unavailable');
  }
  try {
    if (!(await dependencies.completePairingChallenge(pairing.bodyDigest, certificate))) {
      return errorResponse(503, 'temporarily_unavailable');
    }
  } catch {
    // Completion may have committed before its acknowledgement was lost. Preserve the claim so an
    // exact retry can recover the signed certificate instead of consuming the challenge twice.
    return errorResponse(503, 'temporarily_unavailable');
  }
  return jsonResponse(201, { certificate });
}

function validCachedCertificate(
  candidate: unknown,
  pairing: SignedTelebirrDeviceBridgePairingRequest,
  serverSpki: Uint8Array,
  assignmentSpkiDigest: string,
  assessedAt: string,
): candidate is SignedTelebirrDeviceBridgeEnrollmentCertificate {
  const certificate = decodeSignedTelebirrDeviceBridgeEnrollmentCertificate(candidate);
  return Boolean(
    certificate &&
    certificate.body.state === 'active' &&
    certificate.body.assignmentSignerPublicKeySpkiSha256 === assignmentSpkiDigest &&
    Date.parse(assessedAt) >= Date.parse(certificate.body.validFrom) &&
    Date.parse(assessedAt) < Date.parse(certificate.body.validUntil) &&
    verifySignedTelebirrDeviceBridgeEnrollmentCertificate(certificate, serverSpki) &&
    telebirrDeviceBridgeCertificateMatchesPairingRequest(certificate, pairing),
  );
}

async function handleCommand(
  request: TelebirrDeviceBridgeHttpRequest,
  dependencies: TelebirrDeviceBridgeDependencies,
  serverSpki: Uint8Array,
  assignmentSpki: Uint8Array,
  assignmentSpkiDigest: string,
): Promise<TelebirrDeviceBridgeHttpResponse> {
  if (request.body.byteLength > MAX_COMMAND_BODY_BYTES)
    return errorResponse(413, 'invalid_request');
  const decoded = parseJson(request.body);
  const rawFrame = extractRawCommandFrame(decoded);
  const signedRequest = rawFrame && decodeSignedTelebirrDeviceBridgeRequest(rawFrame.request);
  const assessedAt = canonicalTimestamp(dependencies.now());
  if (!signedRequest || !assessedAt || signedRequest.body.canonicalPath !== request.path) {
    return errorResponse(400, 'invalid_request');
  }
  const certificate = await dependencies.loadEnrollment(signedRequest.body.enrollmentId);
  if (
    !certificate ||
    !verifySignedTelebirrDeviceBridgeRequest(signedRequest, certificate, serverSpki, assessedAt)
  ) {
    return errorResponse(401, 'invalid_request');
  }
  const frame = decodeTelebirrDeviceBridgeCommandFrame(decoded);
  if (!frame) return errorResponse(400, 'invalid_request');
  const replayIdentity = deriveTelebirrDeviceBridgeRequestReplayIdentity(frame.request);
  if (!replayIdentity) return errorResponse(400, 'invalid_request');
  const claim = await dependencies.claimReplay(replayIdentity, frame.request.body.expiresAt);
  if (claim.kind === 'in_progress') return errorResponse(409, 'request_in_progress');
  if (claim.kind === 'completed') {
    return validCachedResponse(claim.response, frame.request, serverSpki, assessedAt)
      ? jsonResponse(200, claim.response)
      : errorResponse(503, 'temporarily_unavailable');
  }

  try {
    const response = await dispatchCommand(
      frame,
      certificate.body,
      dependencies,
      serverSpki,
      assignmentSpki,
      assignmentSpkiDigest,
      assessedAt,
    );
    if (!response) {
      await dependencies.releaseReplay(replayIdentity);
      return errorResponse(503, 'temporarily_unavailable');
    }
    const completed = await dependencies.completeReplay(
      replayIdentity,
      response,
      frame.request.body.expiresAt,
    );
    if (!completed) {
      return errorResponse(503, 'temporarily_unavailable');
    }
    return jsonResponse(200, response);
  } catch {
    return errorResponse(503, 'temporarily_unavailable');
  }
}

async function dispatchCommand(
  frame: TelebirrDeviceBridgeCommandFrame,
  certificate: TelebirrDeviceBridgeEnrollmentCertificateBody,
  dependencies: TelebirrDeviceBridgeDependencies,
  serverSpki: Uint8Array,
  assignmentSpki: Uint8Array,
  assignmentSpkiDigest: string,
  assessedAt: string,
): Promise<TelebirrDeviceBridgeCommandResponse | undefined> {
  switch (frame.request.body.command) {
    case 'assignment_poll': {
      const result = await dependencies.pollAssignment(
        certificate,
        frame.request,
        frame.payload as TelebirrDeviceBridgeAssignmentPollPayload,
      );
      if (result.kind === 'assignment') {
        if (
          !validAssignmentForCertificate(
            result.assignment,
            certificate,
            assignmentSpki,
            assignmentSpkiDigest,
            assessedAt,
          )
        ) {
          return undefined;
        }
        return makeResponse(
          frame.request,
          dependencies,
          serverSpki,
          'assignment',
          result.assignment.bodyDigest,
          null,
          null,
          result.assignment,
        );
      }
      if (result.kind === 'none') {
        return makeResponse(
          frame.request,
          dependencies,
          serverSpki,
          'no_assignment',
          null,
          null,
          null,
          null,
        );
      }
      if (result.kind === 'retry') {
        return makeResponse(
          frame.request,
          dependencies,
          serverSpki,
          'retry',
          null,
          null,
          'temporary_unavailable',
          null,
        );
      }
      return makeResponse(
        frame.request,
        dependencies,
        serverSpki,
        'rejected',
        null,
        null,
        result.reason,
        null,
      );
    }
    case 'heartbeat': {
      const result = await dependencies.recordHeartbeat(
        certificate,
        frame.request,
        frame.payload as TelebirrDeviceBridgeHeartbeatPayload,
      );
      return result.kind === 'accepted'
        ? makeResponse(
            frame.request,
            dependencies,
            serverSpki,
            'acknowledged',
            null,
            null,
            null,
            null,
          )
        : result.kind === 'retry'
          ? makeResponse(
              frame.request,
              dependencies,
              serverSpki,
              'retry',
              null,
              null,
              'temporary_unavailable',
              null,
            )
          : makeResponse(
              frame.request,
              dependencies,
              serverSpki,
              'rejected',
              null,
              null,
              result.reason,
              null,
            );
    }
    case 'observation_upload': {
      const payload = frame.payload as TelebirrDeviceBridgeObservationUploadPayload;
      if (
        !validUploadForCertificate(
          payload,
          certificate,
          assignmentSpki,
          assignmentSpkiDigest,
          assessedAt,
        )
      ) {
        return makeResponse(
          frame.request,
          dependencies,
          serverSpki,
          'rejected',
          null,
          null,
          'binding_mismatch',
          null,
        );
      }
      const result = await dependencies.stageEvidenceOnly(certificate, frame.request, payload);
      if (result.kind === 'accepted') {
        return makeResponse(
          frame.request,
          dependencies,
          serverSpki,
          'acknowledged',
          payload.signedAssignment.bodyDigest,
          payload.signedObservation.bodyDigest,
          null,
          null,
        );
      }
      return result.kind === 'retry'
        ? makeResponse(
            frame.request,
            dependencies,
            serverSpki,
            'retry',
            null,
            null,
            'temporary_unavailable',
            null,
          )
        : makeResponse(
            frame.request,
            dependencies,
            serverSpki,
            'rejected',
            null,
            null,
            result.reason,
            null,
          );
    }
  }
}

async function makeResponse(
  request: SignedTelebirrDeviceBridgeRequest,
  dependencies: TelebirrDeviceBridgeDependencies,
  serverSpki: Uint8Array,
  outcome: TelebirrDeviceBridgeAcknowledgementBody['outcome'],
  assignmentBodyDigest: string | null,
  observationBodyDigest: string | null,
  reasonCode: TelebirrDeviceBridgeReasonCode | null,
  assignment: TelebirrLivePilotSignedAssignment | null,
): Promise<TelebirrDeviceBridgeCommandResponse | undefined> {
  const issuedAt = canonicalTimestamp(dependencies.now());
  const acknowledgementId = dependencies.nextOpaqueId('acknowledgement');
  if (!issuedAt || !OPAQUE_ID_PATTERN.test(acknowledgementId)) return undefined;
  const body = decodeTelebirrDeviceBridgeAcknowledgementBody({
    contractVersion: TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
    providerCode: TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE,
    protocolMode: TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
    acknowledgementId,
    requestId: request.body.requestId,
    enrollmentId: request.body.enrollmentId,
    deviceId: request.body.deviceId,
    keyId: request.body.keyId,
    command: request.body.command,
    requestBodyDigest: request.bodyDigest,
    requestPayloadDigest: request.body.payloadDigest,
    outcome,
    assignmentBodyDigest,
    observationBodyDigest,
    reasonCode,
    issuedAt,
    expiresAt: request.body.expiresAt,
    evidenceOnly: true,
    databaseAccessAllowed: false,
    claimAllowed: false,
    settlementAllowed: false,
    enqueueAllowed: false,
    executionAllowed: false,
    financialActionAllowed: false,
    moneyMovementAllowed: false,
    rawReceiptUploadAllowed: false,
    sensitiveLoggingAllowed: false,
  });
  if (!body) return undefined;
  const acknowledgement = await signAcknowledgement(body, request, dependencies, serverSpki);
  return acknowledgement ? Object.freeze({ acknowledgement, assignment }) : undefined;
}

async function signCertificate(
  body: TelebirrDeviceBridgeEnrollmentCertificateBody,
  dependencies: TelebirrDeviceBridgeDependencies,
  serverSpki: Uint8Array,
): Promise<SignedTelebirrDeviceBridgeEnrollmentCertificate | undefined> {
  const signerKeyId = dependencies.serverSigner.keyId;
  if (!OPAQUE_ID_PATTERN.test(signerKeyId)) return undefined;
  const bodyDigest = digestTelebirrDeviceBridgeEnrollmentCertificateBody(body);
  const transcript = canonicalTelebirrDeviceBridgeEnrollmentCertificateSignatureBytes(
    body,
    signerKeyId,
  );
  if (!bodyDigest || !transcript) return undefined;
  const signature = await dependencies.serverSigner.signP1363(transcript);
  if (!SIGNATURE_PATTERN.test(signature)) return undefined;
  const certificate = decodeSignedTelebirrDeviceBridgeEnrollmentCertificate({
    contractVersion: TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
    providerCode: TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE,
    protocolMode: TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
    transcriptVersion: TELEBIRR_DEVICE_BRIDGE_CERTIFICATE_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM,
    signatureEncoding: TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING,
    signerKeyId,
    body,
    signature,
  });
  return certificate &&
    verifySignedTelebirrDeviceBridgeEnrollmentCertificate(certificate, serverSpki)
    ? certificate
    : undefined;
}

async function signAcknowledgement(
  body: TelebirrDeviceBridgeAcknowledgementBody,
  request: SignedTelebirrDeviceBridgeRequest,
  dependencies: TelebirrDeviceBridgeDependencies,
  serverSpki: Uint8Array,
): Promise<SignedTelebirrDeviceBridgeAcknowledgement | undefined> {
  const signerKeyId = dependencies.serverSigner.keyId;
  if (!OPAQUE_ID_PATTERN.test(signerKeyId)) return undefined;
  const bodyDigest = digestTelebirrDeviceBridgeAcknowledgementBody(body);
  const transcript = canonicalTelebirrDeviceBridgeAcknowledgementSignatureBytes(body, signerKeyId);
  if (!bodyDigest || !transcript) return undefined;
  const signature = await dependencies.serverSigner.signP1363(transcript);
  if (!SIGNATURE_PATTERN.test(signature)) return undefined;
  const acknowledgement = decodeSignedTelebirrDeviceBridgeAcknowledgement({
    contractVersion: TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
    providerCode: TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE,
    protocolMode: TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
    transcriptVersion: TELEBIRR_DEVICE_BRIDGE_ACKNOWLEDGEMENT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM,
    signatureEncoding: TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING,
    signerKeyId,
    body,
    signature,
  });
  return acknowledgement &&
    verifySignedTelebirrDeviceBridgeAcknowledgement(
      acknowledgement,
      request,
      serverSpki,
      body.issuedAt,
    )
    ? acknowledgement
    : undefined;
}

function validAssignmentForCertificate(
  candidate: unknown,
  certificate: TelebirrDeviceBridgeEnrollmentCertificateBody,
  assignmentSpki: Uint8Array,
  assignmentSpkiDigest: string,
  assessedAt: string,
): candidate is TelebirrLivePilotSignedAssignment {
  const assignment = decodeTelebirrLivePilotSignedAssignment(candidate);
  return Boolean(
    assignment &&
    certificate.assignmentSignerKeyId === assignment.signerKeyId &&
    certificate.assignmentSignerPublicKeySpkiSha256 === assignmentSpkiDigest &&
    verifyTelebirrLivePilotSignedAssignmentSignature(assignment, assignmentSpki) &&
    assignment.body.deviceId === certificate.deviceId &&
    assignment.body.keyId === certificate.keyId &&
    assignment.body.pilotRevisionId === certificate.pilotRevisionId &&
    assignment.body.receiverRevisionId === certificate.receiverRevisionId &&
    assignment.body.receiverProfileId === certificate.receiverProfileId &&
    assignment.body.receiverProfileDigest === certificate.receiverProfileDigest &&
    assignment.body.receiverConfigurationDigest === certificate.receiverConfigurationDigest &&
    Date.parse(assessedAt) >= Date.parse(assignment.body.issuedAt) &&
    Date.parse(assessedAt) < Date.parse(assignment.body.expiresAt),
  );
}

function validUploadForCertificate(
  payload: TelebirrDeviceBridgeObservationUploadPayload,
  certificate: TelebirrDeviceBridgeEnrollmentCertificateBody,
  assignmentSpki: Uint8Array,
  assignmentSpkiDigest: string,
  assessedAt: string,
): boolean {
  const deviceSpki = Buffer.from(certificate.devicePublicKeySpki, 'base64url');
  return (
    validAssignmentForCertificate(
      payload.signedAssignment,
      certificate,
      assignmentSpki,
      assignmentSpkiDigest,
      assessedAt,
    ) &&
    verifyTelebirrLivePilotSignedObservationSignature(payload.signedObservation, deviceSpki) &&
    payload.signedObservation.body.deviceId === certificate.deviceId &&
    payload.signedObservation.body.keyId === certificate.keyId &&
    payload.signedObservation.body.pilotRevisionId === certificate.pilotRevisionId &&
    payload.signedObservation.body.receiverRevisionId === certificate.receiverRevisionId &&
    payload.signedObservation.body.receiverProfileId === certificate.receiverProfileId &&
    payload.signedObservation.body.receiverProfileDigest === certificate.receiverProfileDigest &&
    payload.signedObservation.body.receiverConfigurationDigest ===
      certificate.receiverConfigurationDigest
  );
}

function validCachedResponse(
  candidate: TelebirrDeviceBridgeCommandResponse,
  request: SignedTelebirrDeviceBridgeRequest,
  serverSpki: Uint8Array,
  assessedAt: string,
): boolean {
  if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ['acknowledgement', 'assignment'])) {
    return false;
  }
  const acknowledgement = decodeSignedTelebirrDeviceBridgeAcknowledgement(
    dataValue(candidate, 'acknowledgement'),
  );
  const rawAssignment = dataValue(candidate, 'assignment');
  const assignment =
    rawAssignment === null ? null : decodeTelebirrLivePilotSignedAssignment(rawAssignment);
  return Boolean(
    acknowledgement &&
    (rawAssignment === null || assignment) &&
    verifySignedTelebirrDeviceBridgeAcknowledgement(
      acknowledgement,
      request,
      serverSpki,
      assessedAt,
    ) &&
    (acknowledgement.body.outcome === 'assignment'
      ? assignment?.bodyDigest === acknowledgement.body.assignmentBodyDigest
      : assignment === null),
  );
}

function validHttpEnvelope(request: TelebirrDeviceBridgeHttpRequest): boolean {
  if (
    request.method !== 'POST' ||
    !(
      request.path === TELEBIRR_DEVICE_BRIDGE_PAIRING_PATH ||
      request.path === '/v1/telebirr/device/assignments:poll' ||
      request.path === '/v1/telebirr/device/heartbeat' ||
      request.path === '/v1/telebirr/device/observations:upload'
    ) ||
    !(request.body instanceof Uint8Array) ||
    isProxy(request.body)
  ) {
    return false;
  }
  const contentTypes = headerValues(request.headers, 'content-type');
  const contentEncodings = headerValues(request.headers, 'content-encoding');
  return (
    contentTypes.length === 1 &&
    contentTypes[0] === TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE &&
    contentEncodings.length === 0
  );
}

function headerValues(
  headers: readonly (readonly [string, string])[],
  expectedName: string,
): readonly string[] {
  const values: string[] = [];
  for (const header of headers) {
    if (
      !Array.isArray(header) ||
      header.length !== 2 ||
      typeof header[0] !== 'string' ||
      typeof header[1] !== 'string'
    ) {
      return ['<invalid>'];
    }
    if (header[0].toLowerCase() === expectedName) values.push(header[1]);
  }
  return values;
}

function extractRawCommandFrame(
  candidate: unknown,
): { readonly request: unknown; readonly payload: unknown } | undefined {
  if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ['request', 'payload']))
    return undefined;
  return { request: dataValue(candidate, 'request'), payload: dataValue(candidate, 'payload') };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === 'string' && keys.includes(key)) &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    })
  );
}

function dataValue(value: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    if (bytes.byteLength === 0) return undefined;
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) return undefined;
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function canonicalTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : undefined;
}

function copyBytes(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) || isProxy(value) || value.byteLength === 0) {
    throw new Error('Invalid public key');
  }
  return Uint8Array.from(value);
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function jsonResponse(statusCode: number, body: unknown): TelebirrDeviceBridgeHttpResponse {
  return Object.freeze({
    statusCode,
    headers: Object.freeze({
      ...responseHeaders,
      'content-type': TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE,
    }),
    body: Buffer.from(JSON.stringify(body), 'utf8'),
  });
}

function errorResponse(statusCode: number, code: string): TelebirrDeviceBridgeHttpResponse {
  return Object.freeze({
    statusCode,
    headers: Object.freeze({ ...responseHeaders, 'content-type': ERROR_CONTENT_TYPE }),
    body: Buffer.from(JSON.stringify({ code }), 'utf8'),
  });
}
