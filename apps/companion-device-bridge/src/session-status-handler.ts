import { isProxy } from 'node:util/types';

import {
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_SESSION_STATUS_PATH,
  decodeSignedCompanionEnrollmentCertificate,
  decodeSignedCompanionHttpRequest,
  deriveCompanionHttpRequestReplayIdentity,
  digestCompanionLookupEmptyQuery,
  digestCompanionSessionStatusContent,
  verifySignedCompanionEnrollmentCertificate,
  verifySignedCompanionHttpRequest,
} from '@fetanagent/agent-platform-companion-contracts';

import type { CompanionDeviceStateDatabase } from './postgres-state.js';
import type {
  CompanionBridgeHttpRequest,
  CompanionBridgeHttpResponse,
  CompanionBridgeSigner,
} from './pairing-handler.js';

const headers = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});
const errorHeaders = Object.freeze({
  ...headers,
  'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
});

function error(statusCode: number): CompanionBridgeHttpResponse {
  return {
    statusCode,
    headers: errorHeaders,
    body: Buffer.from(
      JSON.stringify({ code: statusCode === 503 ? 'temporarily_unavailable' : 'invalid_request' }),
      'utf8',
    ),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !isProxy(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Accepts only a signed paired-device session state. No credential or money field is accepted. */
export function createCompanionSessionStatusHandler(options: {
  readonly signer: CompanionBridgeSigner;
  readonly database: CompanionDeviceStateDatabase;
  now(): string;
}): (request: CompanionBridgeHttpRequest) => Promise<CompanionBridgeHttpResponse> {
  return async (request) => {
    if (
      request.method !== 'POST' ||
      request.path !== AGENT_PLATFORM_COMPANION_SESSION_STATUS_PATH ||
      request.body.byteLength < 1 ||
      request.body.byteLength > 16 * 1024 ||
      request.headers
        .filter(([name]) => name.toLowerCase() === 'content-type')
        .map(([, value]) => value)
        .join() !== AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE ||
      request.headers
        .filter(([name]) => name.toLowerCase() === 'accept')
        .map(([, value]) => value)
        .join() !== AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE
    )
      return error(400);
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(request.body).toString('utf8'));
    } catch {
      return error(400);
    }
    if (
      !record(parsed) ||
      Object.keys(parsed).length !== 4 ||
      !['certificate', 'httpRequest', 'platformAgentAccountId', 'state'].every((key) =>
        Object.hasOwn(parsed, key),
      )
    )
      return error(400);
    const certificate = decodeSignedCompanionEnrollmentCertificate(parsed.certificate);
    const httpRequest = decodeSignedCompanionHttpRequest(parsed.httpRequest);
    const assessedAt = options.now();
    const contentDigest =
      certificate &&
      digestCompanionSessionStatusContent(
        certificate.bodyDigest,
        parsed.platformAgentAccountId,
        parsed.state,
      );
    if (
      !certificate ||
      !httpRequest ||
      !contentDigest ||
      certificate.signerKeyId !== options.signer.keyId ||
      !verifySignedCompanionEnrollmentCertificate(certificate, options.signer.publicKeySpkiDer) ||
      !verifySignedCompanionHttpRequest(
        httpRequest,
        certificate,
        options.signer.publicKeySpkiDer,
        assessedAt,
      ) ||
      httpRequest.body.method !== 'POST' ||
      httpRequest.body.canonicalPath !== AGENT_PLATFORM_COMPANION_SESSION_STATUS_PATH ||
      httpRequest.body.queryDigest !== digestCompanionLookupEmptyQuery() ||
      httpRequest.body.contentDigest !== contentDigest
    )
      return error(401);
    const replayIdentity = deriveCompanionHttpRequestReplayIdentity(httpRequest);
    if (!replayIdentity) return error(401);
    try {
      const result = await options.database.query(
        'select app.record_companion_kemerbet_session_status($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::timestamptz,$7::timestamptz,$8::timestamptz,$9::uuid,$10::text,$11::text) as accepted',
        [
          certificate.body.certificateId,
          certificate.body.deviceId,
          certificate.body.deviceKeyId,
          httpRequest.body.requestId,
          replayIdentity,
          httpRequest.body.issuedAt,
          httpRequest.body.expiresAt,
          assessedAt,
          parsed.platformAgentAccountId as string,
          parsed.state as string,
          contentDigest,
        ],
      );
      if (result.rows.length !== 1 || !record(result.rows[0]) || result.rows[0].accepted !== true)
        return error(401);
      return { statusCode: 204, headers, body: Buffer.alloc(0) };
    } catch {
      return error(503);
    }
  };
}
