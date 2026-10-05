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
  ROUTINE_DEPOSIT_CONTRACT_VERSION,
  ROUTINE_DEPOSIT_DIGEST_ALGORITHM,
  ROUTINE_DEPOSIT_PROTOCOL_MODE,
  ROUTINE_DEPOSIT_RESPONSE_TRANSCRIPT,
  ROUTINE_DEPOSIT_SIGNATURE_ALGORITHM,
  ROUTINE_DEPOSIT_SIGNATURE_ENCODING,
  canonicalRoutineDepositResponseSignatureBytes,
  decodeRoutineDepositCommand,
  decodeRoutineDepositResponseBody,
  decodeSignedRoutineDepositResponse,
  digestRoutineDepositCommand,
  digestRoutineDepositResponseBody,
  type RoutineDepositCommand,
  type RoutineDepositResponseResult,
  type SignedRoutineDepositResponse,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import type {
  CompanionBridgeHttpRequest,
  CompanionBridgeHttpResponse,
  CompanionBridgeSigner,
} from './pairing-handler.js';

const MAXIMUM_BODY_BYTES = 128 * 1024;
const responseHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

type UnknownRecord = Record<string, unknown>;

export interface RoutineDepositHandlerDependencies {
  readonly noMoneySigner: CompanionBridgeSigner;
  readonly executionSigner: CompanionBridgeSigner;
  readonly now: () => Date;
  executeCommand(
    certificate: SignedCompanionEnrollmentCertificate,
    httpRequest: SignedCompanionHttpRequest,
    httpReplayIdentity: string,
    command: RoutineDepositCommand,
    assessedAt: string,
  ): Promise<RoutineDepositResponseResult | undefined>;
}

function plainRecord(candidate: unknown): candidate is UnknownRecord {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    Object.getPrototypeOf(candidate) === Object.prototype
  );
}

function exactKeys(candidate: UnknownRecord, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(candidate);
  return (
    actual.length === expected.length &&
    actual.every((key) => typeof key === 'string' && expected.includes(key)) &&
    expected.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    })
  );
}

function json(statusCode: number, value: unknown): CompanionBridgeHttpResponse {
  return Object.freeze({
    statusCode,
    headers: responseHeaders,
    body: Buffer.from(JSON.stringify(value), 'utf8'),
  });
}

function error(statusCode: 400 | 401 | 413 | 503): CompanionBridgeHttpResponse {
  return json(statusCode, {
    code: statusCode === 503 ? 'temporarily_unavailable' : 'invalid_request',
  });
}

function canonicalTimestamp(candidate: Date): string | undefined {
  if (!Number.isFinite(candidate.getTime())) return undefined;
  return new Date(Math.floor(candidate.getTime())).toISOString();
}

function oneHeader(
  headers: readonly (readonly [string, string])[],
  expectedName: string,
): string | undefined {
  const matches = headers.filter(([name]) => name.toLowerCase() === expectedName);
  return matches.length === 1 ? matches[0]?.[1] : undefined;
}

async function signedResponse(
  command: RoutineDepositCommand,
  result: RoutineDepositResponseResult,
  assessedAt: string,
  signer: CompanionBridgeSigner,
): Promise<SignedRoutineDepositResponse | undefined> {
  const requestContentDigest = digestRoutineDepositCommand(command);
  if (!requestContentDigest) return undefined;
  const body = decodeRoutineDepositResponseBody({
    contractVersion: ROUTINE_DEPOSIT_CONTRACT_VERSION,
    protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE,
    capability: command.capability,
    requestId: command.requestId,
    operation: command.operation,
    requestContentDigest,
    serverIssuedAt: assessedAt,
    result,
  });
  if (!body) return undefined;
  const bodyDigest = digestRoutineDepositResponseBody(body);
  const transcript = canonicalRoutineDepositResponseSignatureBytes(body);
  if (!bodyDigest || !transcript) return undefined;
  const signature = await signer.signP1363(transcript);
  return decodeSignedRoutineDepositResponse({
    contractVersion: ROUTINE_DEPOSIT_CONTRACT_VERSION,
    protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE,
    transcriptVersion: ROUTINE_DEPOSIT_RESPONSE_TRANSCRIPT,
    bodyDigestAlgorithm: ROUTINE_DEPOSIT_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: ROUTINE_DEPOSIT_SIGNATURE_ALGORITHM,
    signatureEncoding: ROUTINE_DEPOSIT_SIGNATURE_ENCODING,
    signerKeyId: signer.keyId,
    body,
    signature,
  });
}

/** Paired-device authentication plus a distinct execution-signed routine response. */
export function createRoutineDepositHandler(
  dependencies: RoutineDepositHandlerDependencies,
): (request: CompanionBridgeHttpRequest) => Promise<CompanionBridgeHttpResponse> {
  return async (request) => {
    try {
      if (request.body.byteLength > MAXIMUM_BODY_BYTES) return error(413);
      if (
        request.method !== 'POST' ||
        oneHeader(request.headers, 'content-type') !==
          AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE ||
        oneHeader(request.headers, 'accept') !== AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE
      ) {
        return error(400);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(request.body).toString('utf8')) as unknown;
      } catch {
        return error(400);
      }
      if (!plainRecord(parsed) || !exactKeys(parsed, ['certificate', 'httpRequest', 'command'])) {
        return error(400);
      }
      const assessedAt = canonicalTimestamp(dependencies.now());
      const certificate = decodeSignedCompanionEnrollmentCertificate(parsed.certificate);
      const httpRequest = decodeSignedCompanionHttpRequest(parsed.httpRequest);
      const command = decodeRoutineDepositCommand(parsed.command);
      const contentDigest = digestRoutineDepositCommand(command);
      if (
        !assessedAt ||
        !certificate ||
        !httpRequest ||
        !command ||
        !contentDigest ||
        certificate.signerKeyId !== dependencies.noMoneySigner.keyId ||
        httpRequest.body.method !== 'POST' ||
        httpRequest.body.canonicalPath !== request.path ||
        httpRequest.body.contentDigest !== contentDigest ||
        httpRequest.body.certificateId !== certificate.body.certificateId ||
        httpRequest.body.deviceId !== certificate.body.deviceId ||
        httpRequest.body.deviceKeyId !== certificate.body.deviceKeyId ||
        !verifySignedCompanionEnrollmentCertificate(
          certificate,
          dependencies.noMoneySigner.publicKeySpkiDer,
        ) ||
        !verifySignedCompanionHttpRequest(
          httpRequest,
          certificate,
          dependencies.noMoneySigner.publicKeySpkiDer,
          assessedAt,
        )
      ) {
        return error(401);
      }
      const replayIdentity = deriveCompanionHttpRequestReplayIdentity(httpRequest);
      if (!replayIdentity) return error(401);
      const result = await dependencies.executeCommand(
        certificate,
        httpRequest,
        replayIdentity,
        command,
        assessedAt,
      );
      if (result === undefined) return error(401);
      const response = await signedResponse(
        command,
        result,
        assessedAt,
        dependencies.executionSigner,
      );
      return response ? json(200, { response }) : error(503);
    } catch {
      return error(503);
    }
  };
}

export function createDormantRoutineDepositHandler(): (
  request: CompanionBridgeHttpRequest,
) => Promise<CompanionBridgeHttpResponse> {
  return async () => error(503);
}
