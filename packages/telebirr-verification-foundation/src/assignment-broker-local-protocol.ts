import { isProxy } from 'node:util/types';

import {
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
} from './exact-data-record.js';
import {
  decodeTelebirrDeviceBridgeEnrollmentCertificateBody,
  type TelebirrDeviceBridgeEnrollmentCertificateBody,
  type TelebirrDeviceBridgeNoMoneySafety,
} from './device-bridge-protocol.js';
import {
  decodeTelebirrLivePilotSignedAssignment,
  type TelebirrLivePilotSignedAssignment,
} from './live-private-pilot-protocol.js';

/**
 * Exact local-only protocol between the internet-facing device bridge and the private assignment
 * broker. The protocol deliberately has no address, credential, database command, key-opening
 * command, settlement command, or generic RPC method.
 */
export const TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION = 1 as const;
export const TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE = 'telebirr' as const;
export const TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE =
  'assignment_broker_local_no_money_v1' as const;
export const TELEBIRR_ASSIGNMENT_BROKER_LOCAL_POLL_PATH = '/v1/assignment:poll' as const;
export const TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTENT_TYPE =
  'application/vnd.fetanagent.telebirr-assignment-broker-local+json' as const;
export const TELEBIRR_ASSIGNMENT_BROKER_LOCAL_ROOT =
  '/run/fetanagent-telebirr-assignment-broker' as const;
export const TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET =
  '/run/fetanagent-telebirr-assignment-broker/assignment.sock' as const;
export const TELEBIRR_ASSIGNMENT_BROKER_LOCAL_MAX_REQUEST_BYTES = 32_768 as const;
export const TELEBIRR_ASSIGNMENT_BROKER_LOCAL_MAX_RESPONSE_BYTES = 32_768 as const;

export const TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY = Object.freeze({
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

export interface TelebirrAssignmentBrokerLocalPollRequest extends TelebirrDeviceBridgeNoMoneySafety {
  readonly contractVersion: typeof TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION;
  readonly providerCode: typeof TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE;
  readonly protocolMode: typeof TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE;
  readonly certificate: TelebirrDeviceBridgeEnrollmentCertificateBody;
  readonly bridgeRequestBodyDigest: string;
  readonly requestedLeaseSeconds: number;
}

export type TelebirrAssignmentBrokerLocalOutcome = 'assignment' | 'no_assignment';

interface TelebirrAssignmentBrokerLocalPollResponseHeader extends TelebirrDeviceBridgeNoMoneySafety {
  readonly contractVersion: typeof TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION;
  readonly providerCode: typeof TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE;
  readonly protocolMode: typeof TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE;
}

export type TelebirrAssignmentBrokerLocalPollResponse =
  | (TelebirrAssignmentBrokerLocalPollResponseHeader & {
      readonly outcome: 'assignment';
      readonly assignment: TelebirrLivePilotSignedAssignment;
    })
  | (TelebirrAssignmentBrokerLocalPollResponseHeader & {
      readonly outcome: 'no_assignment';
      readonly assignment: null;
    });

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const safetyKeys = Object.freeze(
  Object.keys(TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY),
) as readonly (keyof TelebirrDeviceBridgeNoMoneySafety)[];
const requestKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'certificate',
  'bridgeRequestBodyDigest',
  'requestedLeaseSeconds',
  ...safetyKeys,
] as const;
const responseKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'outcome',
  'assignment',
  ...safetyKeys,
] as const;

function hasHeader(candidate: Record<string, unknown>): boolean {
  return (
    ownDataValue(candidate, 'contractVersion') ===
      TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION &&
    ownDataValue(candidate, 'providerCode') === TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE &&
    ownDataValue(candidate, 'protocolMode') === TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE
  );
}

function hasNoMoneySafety(candidate: Record<string, unknown>): boolean {
  return safetyKeys.every(
    (key) => ownDataValue(candidate, key) === TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY[key],
  );
}

export function decodeTelebirrAssignmentBrokerLocalPollRequest(
  candidate: unknown,
): TelebirrAssignmentBrokerLocalPollRequest | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, requestKeys) ||
      !hasHeader(candidate) ||
      !hasNoMoneySafety(candidate)
    ) {
      return undefined;
    }
    const certificate = decodeTelebirrDeviceBridgeEnrollmentCertificateBody(
      ownDataValue(candidate, 'certificate'),
    );
    const bridgeRequestBodyDigest = ownDataValue(candidate, 'bridgeRequestBodyDigest');
    const requestedLeaseSeconds = ownDataValue(candidate, 'requestedLeaseSeconds');
    if (
      certificate?.state !== 'active' ||
      typeof bridgeRequestBodyDigest !== 'string' ||
      !SHA256_PATTERN.test(bridgeRequestBodyDigest) ||
      !Number.isSafeInteger(requestedLeaseSeconds) ||
      (requestedLeaseSeconds as number) < 30 ||
      (requestedLeaseSeconds as number) > 300
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
      providerCode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
      protocolMode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
      certificate,
      bridgeRequestBodyDigest,
      requestedLeaseSeconds: requestedLeaseSeconds as number,
      ...TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
    });
  } catch {
    return undefined;
  }
}

export function decodeTelebirrAssignmentBrokerLocalPollResponse(
  candidate: unknown,
): TelebirrAssignmentBrokerLocalPollResponse | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, responseKeys) ||
      !hasHeader(candidate) ||
      !hasNoMoneySafety(candidate)
    ) {
      return undefined;
    }
    const outcome = ownDataValue(candidate, 'outcome');
    const assignmentCandidate = ownDataValue(candidate, 'assignment');
    if (outcome === 'no_assignment' && assignmentCandidate === null) {
      return Object.freeze({
        contractVersion: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
        providerCode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
        protocolMode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
        outcome,
        assignment: null,
        ...TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
      });
    }
    const assignment = decodeTelebirrLivePilotSignedAssignment(assignmentCandidate);
    if (outcome !== 'assignment' || assignment === undefined) return undefined;
    return Object.freeze({
      contractVersion: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
      providerCode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
      protocolMode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
      outcome,
      assignment,
      ...TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
    });
  } catch {
    return undefined;
  }
}

function parseCanonicalJson<T>(
  bytes: unknown,
  maximumBytes: number,
  decode: (candidate: unknown) => T | undefined,
): T | undefined {
  try {
    if (
      !(bytes instanceof Uint8Array) ||
      isProxy(bytes) ||
      bytes.byteLength === 0 ||
      bytes.byteLength > maximumBytes
    ) {
      return undefined;
    }
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) return undefined;
    const decoded = decode(JSON.parse(text) as unknown);
    if (decoded === undefined) return undefined;
    const canonical = Buffer.from(JSON.stringify(decoded), 'utf8');
    return canonical.equals(Buffer.from(bytes)) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

export function decodeTelebirrAssignmentBrokerLocalPollRequestBytes(
  bytes: unknown,
): TelebirrAssignmentBrokerLocalPollRequest | undefined {
  return parseCanonicalJson(
    bytes,
    TELEBIRR_ASSIGNMENT_BROKER_LOCAL_MAX_REQUEST_BYTES,
    decodeTelebirrAssignmentBrokerLocalPollRequest,
  );
}

export function decodeTelebirrAssignmentBrokerLocalPollResponseBytes(
  bytes: unknown,
): TelebirrAssignmentBrokerLocalPollResponse | undefined {
  return parseCanonicalJson(
    bytes,
    TELEBIRR_ASSIGNMENT_BROKER_LOCAL_MAX_RESPONSE_BYTES,
    decodeTelebirrAssignmentBrokerLocalPollResponse,
  );
}

export function encodeTelebirrAssignmentBrokerLocalPollRequest(
  candidate: unknown,
): Buffer | undefined {
  const decoded = decodeTelebirrAssignmentBrokerLocalPollRequest(candidate);
  if (decoded === undefined) return undefined;
  const encoded = Buffer.from(JSON.stringify(decoded), 'utf8');
  return encoded.byteLength <= TELEBIRR_ASSIGNMENT_BROKER_LOCAL_MAX_REQUEST_BYTES
    ? encoded
    : undefined;
}

export function encodeTelebirrAssignmentBrokerLocalPollResponse(
  candidate: unknown,
): Buffer | undefined {
  const decoded = decodeTelebirrAssignmentBrokerLocalPollResponse(candidate);
  if (decoded === undefined) return undefined;
  const encoded = Buffer.from(JSON.stringify(decoded), 'utf8');
  return encoded.byteLength <= TELEBIRR_ASSIGNMENT_BROKER_LOCAL_MAX_RESPONSE_BYTES
    ? encoded
    : undefined;
}
