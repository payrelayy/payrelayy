import { isProxy } from 'node:util/types';

import {
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
  parseCanonicalUtcTimestamp,
  type UnknownRecord,
} from './exact-data-record.js';
import {
  TELEBIRR_DEVICE_BRIDGE_HEARTBEAT_PATH,
  TELEBIRR_DEVICE_BRIDGE_OBSERVATION_UPLOAD_PATH,
  decodeSignedTelebirrDeviceBridgeAcknowledgement,
  decodeSignedTelebirrDeviceBridgeEnrollmentCertificate,
  decodeSignedTelebirrDeviceBridgePairingRequest,
  decodeSignedTelebirrDeviceBridgeRequest,
  decodeTelebirrDeviceBridgeEnrollmentCertificateBody,
  decodeTelebirrDeviceBridgeHeartbeatPayload,
  decodeTelebirrDeviceBridgeObservationUploadPayload,
  digestTelebirrDeviceBridgeEnrollmentCertificateBody,
  digestTelebirrDeviceBridgePayload,
  digestTelebirrDeviceBridgeRequestBody,
  verifySignedTelebirrDeviceBridgePairingRequest,
  type SignedTelebirrDeviceBridgeAcknowledgement,
  type SignedTelebirrDeviceBridgeEnrollmentCertificate,
  type SignedTelebirrDeviceBridgePairingRequest,
  type SignedTelebirrDeviceBridgeRequest,
  type TelebirrDeviceBridgeEnrollmentCertificateBody,
  type TelebirrDeviceBridgeHeartbeatPayload,
  type TelebirrDeviceBridgeNoMoneySafety,
  type TelebirrDeviceBridgeObservationUploadPayload,
} from './device-bridge-protocol.js';
import {
  decodeTelebirrLivePilotSignedAssignment,
  type TelebirrLivePilotSignedAssignment,
} from './live-private-pilot-protocol.js';

/**
 * Closed local-only protocol between the internet-facing Android bridge and the private durable
 * device-state process. It has no host, URL, credential, SQL, table, wallet, settlement, execution,
 * or generic RPC operation.
 */
export const TELEBIRR_DEVICE_STATE_LOCAL_CONTRACT_VERSION = 1 as const;
export const TELEBIRR_DEVICE_STATE_LOCAL_PROVIDER_CODE = 'telebirr' as const;
export const TELEBIRR_DEVICE_STATE_LOCAL_PROTOCOL_MODE = 'device_state_local_no_money_v1' as const;
export const TELEBIRR_DEVICE_STATE_LOCAL_CONTENT_TYPE =
  'application/vnd.fetanagent.telebirr-device-state-local+json' as const;
export const TELEBIRR_DEVICE_STATE_LOCAL_ROOT = '/run/fetanagent-telebirr-device-state' as const;
export const TELEBIRR_DEVICE_STATE_LOCAL_SOCKET =
  '/run/fetanagent-telebirr-device-state/state.sock' as const;
export const TELEBIRR_DEVICE_STATE_LOCAL_MAX_REQUEST_BYTES = 524_288 as const;
export const TELEBIRR_DEVICE_STATE_LOCAL_MAX_RESPONSE_BYTES = 524_288 as const;

export const TELEBIRR_DEVICE_STATE_LOCAL_NO_MONEY_SAFETY = Object.freeze({
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
} as const satisfies TelebirrDeviceBridgeNoMoneySafety);

export const TELEBIRR_DEVICE_STATE_LOCAL_PATHS = Object.freeze({
  pairing_claim: '/v1/pairing:claim',
  pairing_complete: '/v1/pairing:complete',
  pairing_release: '/v1/pairing:release',
  enrollment_load: '/v1/enrollment:load',
  replay_claim: '/v1/replay:claim',
  replay_complete: '/v1/replay:complete',
  replay_release: '/v1/replay:release',
  heartbeat_record: '/v1/heartbeat:record',
  evidence_stage: '/v1/evidence:stage',
} as const);

export type TelebirrDeviceStateLocalOperation = keyof typeof TELEBIRR_DEVICE_STATE_LOCAL_PATHS;
export type TelebirrDeviceStateLocalPath =
  (typeof TELEBIRR_DEVICE_STATE_LOCAL_PATHS)[TelebirrDeviceStateLocalOperation];

interface TelebirrDeviceStateLocalHeader extends TelebirrDeviceBridgeNoMoneySafety {
  readonly contractVersion: typeof TELEBIRR_DEVICE_STATE_LOCAL_CONTRACT_VERSION;
  readonly providerCode: typeof TELEBIRR_DEVICE_STATE_LOCAL_PROVIDER_CODE;
  readonly protocolMode: typeof TELEBIRR_DEVICE_STATE_LOCAL_PROTOCOL_MODE;
  readonly operation: TelebirrDeviceStateLocalOperation;
}

export interface TelebirrDeviceStateLocalCommandResponse {
  readonly acknowledgement: SignedTelebirrDeviceBridgeAcknowledgement;
  readonly assignment: TelebirrLivePilotSignedAssignment | null;
}

export type TelebirrDeviceStateLocalRequest =
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'pairing_claim';
      readonly pairingRequest: SignedTelebirrDeviceBridgePairingRequest;
      readonly assessedAt: string;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'pairing_complete';
      readonly pairingRequestBodyDigest: string;
      readonly certificate: SignedTelebirrDeviceBridgeEnrollmentCertificate;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'pairing_release';
      readonly pairingRequestBodyDigest: string;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'enrollment_load';
      readonly enrollmentId: string;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'replay_claim';
      readonly replayIdentity: string;
      readonly requestExpiresAt: string;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'replay_complete';
      readonly replayIdentity: string;
      readonly response: TelebirrDeviceStateLocalCommandResponse;
      readonly requestExpiresAt: string;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'replay_release';
      readonly replayIdentity: string;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'heartbeat_record';
      readonly certificate: TelebirrDeviceBridgeEnrollmentCertificateBody;
      readonly request: SignedTelebirrDeviceBridgeRequest;
      readonly payload: TelebirrDeviceBridgeHeartbeatPayload;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'evidence_stage';
      readonly certificate: TelebirrDeviceBridgeEnrollmentCertificateBody;
      readonly request: SignedTelebirrDeviceBridgeRequest;
      readonly payload: TelebirrDeviceBridgeObservationUploadPayload;
    });

export type TelebirrDeviceStateLocalResponse =
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'pairing_claim';
      readonly outcome: 'missing' | 'claimed' | 'in_progress' | 'completed';
      readonly certificateBody: TelebirrDeviceBridgeEnrollmentCertificateBody | null;
      readonly certificate: SignedTelebirrDeviceBridgeEnrollmentCertificate | null;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'pairing_complete';
      readonly completed: boolean;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'pairing_release';
      readonly released: true;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'enrollment_load';
      readonly certificate: SignedTelebirrDeviceBridgeEnrollmentCertificate | null;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'replay_claim';
      readonly outcome: 'claimed' | 'in_progress' | 'completed';
      readonly response: TelebirrDeviceStateLocalCommandResponse | null;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'replay_complete';
      readonly completed: boolean;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'replay_release';
      readonly released: true;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'heartbeat_record';
      readonly outcome: 'accepted' | 'retry' | 'rejected';
      readonly reason: 'device_revoked' | 'pilot_stopped' | null;
    })
  | (TelebirrDeviceStateLocalHeader & {
      readonly operation: 'evidence_stage';
      readonly outcome: 'accepted' | 'retry' | 'rejected';
      readonly reason:
        'binding_mismatch' | 'device_revoked' | 'observation_rejected' | 'pilot_stopped' | null;
      readonly replayed: boolean;
    });

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const safetyKeys = Object.freeze(
  Object.keys(TELEBIRR_DEVICE_STATE_LOCAL_NO_MONEY_SAFETY),
) as readonly (keyof TelebirrDeviceBridgeNoMoneySafety)[];
const headerKeys = ['contractVersion', 'providerCode', 'protocolMode', 'operation'] as const;

const requestFieldKeys = Object.freeze({
  pairing_claim: ['pairingRequest', 'assessedAt'],
  pairing_complete: ['pairingRequestBodyDigest', 'certificate'],
  pairing_release: ['pairingRequestBodyDigest'],
  enrollment_load: ['enrollmentId'],
  replay_claim: ['replayIdentity', 'requestExpiresAt'],
  replay_complete: ['replayIdentity', 'response', 'requestExpiresAt'],
  replay_release: ['replayIdentity'],
  heartbeat_record: ['certificate', 'request', 'payload'],
  evidence_stage: ['certificate', 'request', 'payload'],
} as const satisfies Readonly<Record<TelebirrDeviceStateLocalOperation, readonly string[]>>);

const responseFieldKeys = Object.freeze({
  pairing_claim: ['outcome', 'certificateBody', 'certificate'],
  pairing_complete: ['completed'],
  pairing_release: ['released'],
  enrollment_load: ['certificate'],
  replay_claim: ['outcome', 'response'],
  replay_complete: ['completed'],
  replay_release: ['released'],
  heartbeat_record: ['outcome', 'reason'],
  evidence_stage: ['outcome', 'reason', 'replayed'],
} as const satisfies Readonly<Record<TelebirrDeviceStateLocalOperation, readonly string[]>>);

const requestMaximums = Object.freeze({
  pairing_claim: 65_536,
  pairing_complete: 131_072,
  pairing_release: 4_096,
  enrollment_load: 4_096,
  replay_claim: 4_096,
  replay_complete: TELEBIRR_DEVICE_STATE_LOCAL_MAX_REQUEST_BYTES,
  replay_release: 4_096,
  heartbeat_record: 131_072,
  evidence_stage: TELEBIRR_DEVICE_STATE_LOCAL_MAX_REQUEST_BYTES,
} as const satisfies Readonly<Record<TelebirrDeviceStateLocalOperation, number>>);

const responseMaximums = Object.freeze({
  pairing_claim: 131_072,
  pairing_complete: 4_096,
  pairing_release: 4_096,
  enrollment_load: 131_072,
  replay_claim: TELEBIRR_DEVICE_STATE_LOCAL_MAX_RESPONSE_BYTES,
  replay_complete: 4_096,
  replay_release: 4_096,
  heartbeat_record: 4_096,
  evidence_stage: 4_096,
} as const satisfies Readonly<Record<TelebirrDeviceStateLocalOperation, number>>);

function operation(value: unknown): TelebirrDeviceStateLocalOperation | undefined {
  return typeof value === 'string' && Object.hasOwn(TELEBIRR_DEVICE_STATE_LOCAL_PATHS, value)
    ? (value as TelebirrDeviceStateLocalOperation)
    : undefined;
}

function hasHeader(candidate: UnknownRecord, expected: TelebirrDeviceStateLocalOperation): boolean {
  return (
    ownDataValue(candidate, 'contractVersion') === TELEBIRR_DEVICE_STATE_LOCAL_CONTRACT_VERSION &&
    ownDataValue(candidate, 'providerCode') === TELEBIRR_DEVICE_STATE_LOCAL_PROVIDER_CODE &&
    ownDataValue(candidate, 'protocolMode') === TELEBIRR_DEVICE_STATE_LOCAL_PROTOCOL_MODE &&
    ownDataValue(candidate, 'operation') === expected &&
    safetyKeys.every(
      (key) => ownDataValue(candidate, key) === TELEBIRR_DEVICE_STATE_LOCAL_NO_MONEY_SAFETY[key],
    )
  );
}

function exactVariant(
  candidate: unknown,
  expected: TelebirrDeviceStateLocalOperation,
  fields: readonly string[],
): candidate is UnknownRecord {
  return (
    isPlainNonProxyRecord(candidate) &&
    hasExactEnumerableDataKeys(candidate, [...headerKeys, ...fields, ...safetyKeys]) &&
    hasHeader(candidate, expected)
  );
}

function header<T extends TelebirrDeviceStateLocalOperation>(
  expected: T,
): TelebirrDeviceStateLocalHeader & { readonly operation: T } {
  return {
    contractVersion: TELEBIRR_DEVICE_STATE_LOCAL_CONTRACT_VERSION,
    providerCode: TELEBIRR_DEVICE_STATE_LOCAL_PROVIDER_CODE,
    protocolMode: TELEBIRR_DEVICE_STATE_LOCAL_PROTOCOL_MODE,
    operation: expected,
    ...TELEBIRR_DEVICE_STATE_LOCAL_NO_MONEY_SAFETY,
  };
}

function commandResponse(candidate: unknown): TelebirrDeviceStateLocalCommandResponse | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, ['acknowledgement', 'assignment'])
  ) {
    return undefined;
  }
  const acknowledgement = decodeSignedTelebirrDeviceBridgeAcknowledgement(
    ownDataValue(candidate, 'acknowledgement'),
  );
  const assignmentCandidate = ownDataValue(candidate, 'assignment');
  const assignment =
    assignmentCandidate === null
      ? null
      : decodeTelebirrLivePilotSignedAssignment(assignmentCandidate);
  if (
    !acknowledgement ||
    assignment === undefined ||
    (assignment !== null && acknowledgement.body.assignmentBodyDigest !== assignment.bodyDigest)
  ) {
    return undefined;
  }
  return Object.freeze({ acknowledgement, assignment });
}

function heartbeatBinding(
  certificate: TelebirrDeviceBridgeEnrollmentCertificateBody,
  request: SignedTelebirrDeviceBridgeRequest,
  payload: TelebirrDeviceBridgeHeartbeatPayload,
): boolean {
  return (
    certificate.state === 'active' &&
    request.body.command === 'heartbeat' &&
    request.body.canonicalPath === TELEBIRR_DEVICE_BRIDGE_HEARTBEAT_PATH &&
    request.body.enrollmentId === certificate.enrollmentId &&
    request.body.deviceId === certificate.deviceId &&
    request.body.keyId === certificate.keyId &&
    digestTelebirrDeviceBridgeRequestBody(request.body) === request.bodyDigest &&
    digestTelebirrDeviceBridgePayload('heartbeat', payload) === request.body.payloadDigest
  );
}

function evidenceBinding(
  certificate: TelebirrDeviceBridgeEnrollmentCertificateBody,
  request: SignedTelebirrDeviceBridgeRequest,
  payload: TelebirrDeviceBridgeObservationUploadPayload,
): boolean {
  const assignment = payload.signedAssignment;
  const observation = payload.signedObservation;
  return (
    certificate.state === 'active' &&
    request.body.command === 'observation_upload' &&
    request.body.canonicalPath === TELEBIRR_DEVICE_BRIDGE_OBSERVATION_UPLOAD_PATH &&
    request.body.enrollmentId === certificate.enrollmentId &&
    request.body.deviceId === certificate.deviceId &&
    request.body.keyId === certificate.keyId &&
    digestTelebirrDeviceBridgeRequestBody(request.body) === request.bodyDigest &&
    digestTelebirrDeviceBridgePayload('observation_upload', payload) ===
      request.body.payloadDigest &&
    assignment.body.deviceId === certificate.deviceId &&
    assignment.body.keyId === certificate.keyId &&
    assignment.body.pilotRevisionId === certificate.pilotRevisionId &&
    assignment.body.receiverRevisionId === certificate.receiverRevisionId &&
    assignment.body.receiverProfileId === certificate.receiverProfileId &&
    assignment.body.receiverProfileDigest === certificate.receiverProfileDigest &&
    assignment.body.receiverConfigurationDigest === certificate.receiverConfigurationDigest &&
    assignment.signerKeyId === certificate.assignmentSignerKeyId &&
    observation.body.deviceId === certificate.deviceId &&
    observation.body.keyId === certificate.keyId &&
    observation.body.assignmentBodyDigest === assignment.bodyDigest
  );
}

export function telebirrDeviceStateLocalPathForOperation(
  candidate: unknown,
): TelebirrDeviceStateLocalPath | undefined {
  const decoded = operation(candidate);
  return decoded === undefined ? undefined : TELEBIRR_DEVICE_STATE_LOCAL_PATHS[decoded];
}

export function decodeTelebirrDeviceStateLocalRequest(
  candidate: unknown,
): TelebirrDeviceStateLocalRequest | undefined {
  try {
    if (!isPlainNonProxyRecord(candidate)) return undefined;
    const selected = operation(ownDataValue(candidate, 'operation'));
    if (selected === undefined || !exactVariant(candidate, selected, requestFieldKeys[selected])) {
      return undefined;
    }
    switch (selected) {
      case 'pairing_claim': {
        const pairingRequest = decodeSignedTelebirrDeviceBridgePairingRequest(
          ownDataValue(candidate, 'pairingRequest'),
        );
        const assessedAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'assessedAt'));
        return pairingRequest &&
          verifySignedTelebirrDeviceBridgePairingRequest(pairingRequest) &&
          assessedAt
          ? Object.freeze({ ...header(selected), pairingRequest, assessedAt })
          : undefined;
      }
      case 'pairing_complete': {
        const pairingRequestBodyDigest = ownDataValue(candidate, 'pairingRequestBodyDigest');
        const certificate = decodeSignedTelebirrDeviceBridgeEnrollmentCertificate(
          ownDataValue(candidate, 'certificate'),
        );
        return typeof pairingRequestBodyDigest === 'string' &&
          SHA256_PATTERN.test(pairingRequestBodyDigest) &&
          certificate?.body.pairingRequestBodyDigest === pairingRequestBodyDigest
          ? Object.freeze({ ...header(selected), pairingRequestBodyDigest, certificate })
          : undefined;
      }
      case 'pairing_release': {
        const pairingRequestBodyDigest = ownDataValue(candidate, 'pairingRequestBodyDigest');
        return typeof pairingRequestBodyDigest === 'string' &&
          SHA256_PATTERN.test(pairingRequestBodyDigest)
          ? Object.freeze({ ...header(selected), pairingRequestBodyDigest })
          : undefined;
      }
      case 'enrollment_load': {
        const enrollmentId = ownDataValue(candidate, 'enrollmentId');
        return typeof enrollmentId === 'string' && UUID_V4_PATTERN.test(enrollmentId)
          ? Object.freeze({ ...header(selected), enrollmentId })
          : undefined;
      }
      case 'replay_claim': {
        const replayIdentity = ownDataValue(candidate, 'replayIdentity');
        const requestExpiresAt = parseCanonicalUtcTimestamp(
          ownDataValue(candidate, 'requestExpiresAt'),
        );
        return typeof replayIdentity === 'string' &&
          SHA256_PATTERN.test(replayIdentity) &&
          requestExpiresAt
          ? Object.freeze({ ...header(selected), replayIdentity, requestExpiresAt })
          : undefined;
      }
      case 'replay_complete': {
        const replayIdentity = ownDataValue(candidate, 'replayIdentity');
        const response = commandResponse(ownDataValue(candidate, 'response'));
        const requestExpiresAt = parseCanonicalUtcTimestamp(
          ownDataValue(candidate, 'requestExpiresAt'),
        );
        return typeof replayIdentity === 'string' &&
          SHA256_PATTERN.test(replayIdentity) &&
          response &&
          requestExpiresAt
          ? Object.freeze({ ...header(selected), replayIdentity, response, requestExpiresAt })
          : undefined;
      }
      case 'replay_release': {
        const replayIdentity = ownDataValue(candidate, 'replayIdentity');
        return typeof replayIdentity === 'string' && SHA256_PATTERN.test(replayIdentity)
          ? Object.freeze({ ...header(selected), replayIdentity })
          : undefined;
      }
      case 'heartbeat_record': {
        const certificate = decodeTelebirrDeviceBridgeEnrollmentCertificateBody(
          ownDataValue(candidate, 'certificate'),
        );
        const request = decodeSignedTelebirrDeviceBridgeRequest(ownDataValue(candidate, 'request'));
        const payload = decodeTelebirrDeviceBridgeHeartbeatPayload(
          ownDataValue(candidate, 'payload'),
        );
        return certificate && request && payload && heartbeatBinding(certificate, request, payload)
          ? Object.freeze({ ...header(selected), certificate, request, payload })
          : undefined;
      }
      case 'evidence_stage': {
        const certificate = decodeTelebirrDeviceBridgeEnrollmentCertificateBody(
          ownDataValue(candidate, 'certificate'),
        );
        const request = decodeSignedTelebirrDeviceBridgeRequest(ownDataValue(candidate, 'request'));
        const payload = decodeTelebirrDeviceBridgeObservationUploadPayload(
          ownDataValue(candidate, 'payload'),
        );
        return certificate && request && payload && evidenceBinding(certificate, request, payload)
          ? Object.freeze({ ...header(selected), certificate, request, payload })
          : undefined;
      }
    }
  } catch {
    return undefined;
  }
}

export function decodeTelebirrDeviceStateLocalResponse(
  candidate: unknown,
): TelebirrDeviceStateLocalResponse | undefined {
  try {
    if (!isPlainNonProxyRecord(candidate)) return undefined;
    const selected = operation(ownDataValue(candidate, 'operation'));
    if (selected === undefined || !exactVariant(candidate, selected, responseFieldKeys[selected])) {
      return undefined;
    }
    switch (selected) {
      case 'pairing_claim': {
        const outcome = ownDataValue(candidate, 'outcome');
        const certificateBodyCandidate = ownDataValue(candidate, 'certificateBody');
        const certificateCandidate = ownDataValue(candidate, 'certificate');
        if (
          (outcome === 'missing' || outcome === 'in_progress') &&
          certificateBodyCandidate === null &&
          certificateCandidate === null
        ) {
          return Object.freeze({
            ...header(selected),
            outcome,
            certificateBody: null,
            certificate: null,
          });
        }
        const certificateBody =
          decodeTelebirrDeviceBridgeEnrollmentCertificateBody(certificateBodyCandidate);
        if (outcome === 'claimed' && certificateBody && certificateCandidate === null) {
          return Object.freeze({
            ...header(selected),
            outcome,
            certificateBody,
            certificate: null,
          });
        }
        const certificate =
          decodeSignedTelebirrDeviceBridgeEnrollmentCertificate(certificateCandidate);
        return outcome === 'completed' &&
          certificateBody &&
          certificate &&
          digestTelebirrDeviceBridgeEnrollmentCertificateBody(certificateBody) ===
            certificate.bodyDigest
          ? Object.freeze({
              ...header(selected),
              outcome,
              certificateBody,
              certificate,
            })
          : undefined;
      }
      case 'pairing_complete': {
        const completed = ownDataValue(candidate, 'completed');
        return typeof completed === 'boolean'
          ? Object.freeze({ ...header(selected), completed })
          : undefined;
      }
      case 'pairing_release':
        return ownDataValue(candidate, 'released') === true
          ? Object.freeze({ ...header(selected), released: true })
          : undefined;
      case 'enrollment_load': {
        const certificateCandidate = ownDataValue(candidate, 'certificate');
        if (certificateCandidate === null) {
          return Object.freeze({ ...header(selected), certificate: null });
        }
        const certificate =
          decodeSignedTelebirrDeviceBridgeEnrollmentCertificate(certificateCandidate);
        return certificate ? Object.freeze({ ...header(selected), certificate }) : undefined;
      }
      case 'replay_claim': {
        const outcome = ownDataValue(candidate, 'outcome');
        const responseCandidate = ownDataValue(candidate, 'response');
        if ((outcome === 'claimed' || outcome === 'in_progress') && responseCandidate === null) {
          return Object.freeze({ ...header(selected), outcome, response: null });
        }
        const response = commandResponse(responseCandidate);
        return outcome === 'completed' && response
          ? Object.freeze({ ...header(selected), outcome, response })
          : undefined;
      }
      case 'replay_complete': {
        const completed = ownDataValue(candidate, 'completed');
        return typeof completed === 'boolean'
          ? Object.freeze({ ...header(selected), completed })
          : undefined;
      }
      case 'replay_release':
        return ownDataValue(candidate, 'released') === true
          ? Object.freeze({ ...header(selected), released: true })
          : undefined;
      case 'heartbeat_record': {
        const outcome = ownDataValue(candidate, 'outcome');
        const reason = ownDataValue(candidate, 'reason');
        if ((outcome === 'accepted' || outcome === 'retry') && reason === null) {
          return Object.freeze({ ...header(selected), outcome, reason: null });
        }
        return outcome === 'rejected' && (reason === 'device_revoked' || reason === 'pilot_stopped')
          ? Object.freeze({ ...header(selected), outcome, reason })
          : undefined;
      }
      case 'evidence_stage': {
        const outcome = ownDataValue(candidate, 'outcome');
        const reason = ownDataValue(candidate, 'reason');
        const replayed = ownDataValue(candidate, 'replayed');
        if (outcome === 'accepted' && reason === null && typeof replayed === 'boolean') {
          return Object.freeze({ ...header(selected), outcome, reason: null, replayed });
        }
        if (outcome === 'retry' && reason === null && replayed === false) {
          return Object.freeze({
            ...header(selected),
            outcome,
            reason: null,
            replayed: false,
          });
        }
        return outcome === 'rejected' &&
          replayed === false &&
          (reason === 'binding_mismatch' ||
            reason === 'device_revoked' ||
            reason === 'observation_rejected' ||
            reason === 'pilot_stopped')
          ? Object.freeze({ ...header(selected), outcome, reason, replayed: false })
          : undefined;
      }
    }
  } catch {
    return undefined;
  }
}

function parseCanonicalJson<T extends { readonly operation: TelebirrDeviceStateLocalOperation }>(
  bytes: unknown,
  absoluteMaximum: number,
  maximums: Readonly<Record<TelebirrDeviceStateLocalOperation, number>>,
  decode: (candidate: unknown) => T | undefined,
): T | undefined {
  try {
    if (
      !(bytes instanceof Uint8Array) ||
      isProxy(bytes) ||
      bytes.byteLength === 0 ||
      bytes.byteLength > absoluteMaximum
    ) {
      return undefined;
    }
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) return undefined;
    const decoded = decode(JSON.parse(text) as unknown);
    if (decoded === undefined) return undefined;
    const canonical = Buffer.from(JSON.stringify(decoded), 'utf8');
    return canonical.byteLength <= maximums[decoded.operation] &&
      canonical.equals(Buffer.from(bytes))
      ? decoded
      : undefined;
  } catch {
    return undefined;
  }
}

function encodeCanonicalJson<T extends { readonly operation: TelebirrDeviceStateLocalOperation }>(
  candidate: unknown,
  maximums: Readonly<Record<TelebirrDeviceStateLocalOperation, number>>,
  decode: (candidate: unknown) => T | undefined,
): Buffer | undefined {
  const decoded = decode(candidate);
  if (decoded === undefined) return undefined;
  const encoded = Buffer.from(JSON.stringify(decoded), 'utf8');
  return encoded.byteLength <= maximums[decoded.operation] ? encoded : undefined;
}

export function decodeTelebirrDeviceStateLocalRequestBytes(
  bytes: unknown,
): TelebirrDeviceStateLocalRequest | undefined {
  return parseCanonicalJson(
    bytes,
    TELEBIRR_DEVICE_STATE_LOCAL_MAX_REQUEST_BYTES,
    requestMaximums,
    decodeTelebirrDeviceStateLocalRequest,
  );
}

export function decodeTelebirrDeviceStateLocalResponseBytes(
  bytes: unknown,
): TelebirrDeviceStateLocalResponse | undefined {
  return parseCanonicalJson(
    bytes,
    TELEBIRR_DEVICE_STATE_LOCAL_MAX_RESPONSE_BYTES,
    responseMaximums,
    decodeTelebirrDeviceStateLocalResponse,
  );
}

export function encodeTelebirrDeviceStateLocalRequest(candidate: unknown): Buffer | undefined {
  return encodeCanonicalJson(candidate, requestMaximums, decodeTelebirrDeviceStateLocalRequest);
}

export function encodeTelebirrDeviceStateLocalResponse(candidate: unknown): Buffer | undefined {
  return encodeCanonicalJson(candidate, responseMaximums, decodeTelebirrDeviceStateLocalResponse);
}
