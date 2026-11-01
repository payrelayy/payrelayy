import { isProxy } from 'node:util/types';

import {
  AGENT_PLATFORM_COMPANION_KEMERBET_SIGNIN_PATH,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  decodeSignedCompanionEnrollmentCertificate,
  decodeSignedCompanionHttpRequest,
  deriveCompanionHttpRequestReplayIdentity,
  digestCompanionKemerBetSigninContent,
  digestCompanionLookupEmptyQuery,
  verifySignedCompanionEnrollmentCertificate,
  verifySignedCompanionHttpRequest,
} from '@fetanagent/agent-platform-companion-contracts';

import type { CompanionDeviceStateDatabase } from './postgres-state.js';
import type {
  CompanionBridgeHttpRequest,
  CompanionBridgeHttpResponse,
  CompanionBridgeSigner,
} from './pairing-handler.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const headers = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

function reply(statusCode: number, value: unknown): CompanionBridgeHttpResponse {
  return { statusCode, headers, body: Buffer.from(JSON.stringify(value), 'utf8') };
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

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const names = Object.keys(value);
  return names.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function headerValues(request: CompanionBridgeHttpRequest, name: string): string[] {
  return request.headers.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
}

/** The signed, paired device alone can read the current credential for its configured account. */
export function createKemerBetSigninHandler(options: {
  readonly signer: CompanionBridgeSigner;
  readonly database: CompanionDeviceStateDatabase;
  now(): string;
}): (request: CompanionBridgeHttpRequest) => Promise<CompanionBridgeHttpResponse> {
  return async (request) => {
    if (
      request.method !== 'POST' ||
      request.path !== AGENT_PLATFORM_COMPANION_KEMERBET_SIGNIN_PATH ||
      request.body.byteLength < 1 ||
      request.body.byteLength > 64 * 1024 ||
      headerValues(request, 'content-type').join() !==
        AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE ||
      headerValues(request, 'accept').join() !== AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE
    )
      return reply(400, { code: 'invalid_request' });
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(request.body).toString('utf8'));
    } catch {
      return reply(400, { code: 'invalid_request' });
    }
    if (
      !record(parsed) ||
      !exact(parsed, ['certificate', 'httpRequest', 'platformAgentAccountId']) ||
      typeof parsed.platformAgentAccountId !== 'string' ||
      !UUID.test(parsed.platformAgentAccountId)
    ) {
      return reply(400, { code: 'invalid_request' });
    }
    const certificate = decodeSignedCompanionEnrollmentCertificate(parsed.certificate);
    const httpRequest = decodeSignedCompanionHttpRequest(parsed.httpRequest);
    const assessedAt = options.now();
    const expectedDigest =
      certificate &&
      digestCompanionKemerBetSigninContent(certificate.bodyDigest, parsed.platformAgentAccountId);
    if (
      !certificate ||
      !httpRequest ||
      !expectedDigest ||
      certificate.signerKeyId !== options.signer.keyId ||
      !verifySignedCompanionEnrollmentCertificate(certificate, options.signer.publicKeySpkiDer) ||
      !verifySignedCompanionHttpRequest(
        httpRequest,
        certificate,
        options.signer.publicKeySpkiDer,
        assessedAt,
      ) ||
      httpRequest.body.method !== 'POST' ||
      httpRequest.body.canonicalPath !== AGENT_PLATFORM_COMPANION_KEMERBET_SIGNIN_PATH ||
      httpRequest.body.queryDigest !== digestCompanionLookupEmptyQuery() ||
      httpRequest.body.contentDigest !== expectedDigest
    ) {
      return reply(401, { code: 'invalid_request' });
    }
    const replayIdentity = deriveCompanionHttpRequestReplayIdentity(httpRequest);
    if (!replayIdentity) return reply(401, { code: 'invalid_request' });
    try {
      const result = await options.database.query(
        'select username, password, revision from app.get_companion_kemerbet_signin_credentials($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::timestamptz,$7::timestamptz,$8::timestamptz,$9::uuid)',
        [
          certificate.body.certificateId,
          certificate.body.deviceId,
          certificate.body.deviceKeyId,
          replayIdentity,
          httpRequest.body.requestId,
          httpRequest.body.issuedAt,
          httpRequest.body.expiresAt,
          assessedAt,
          parsed.platformAgentAccountId,
        ],
      );
      if (result.rows.length === 0) return reply(200, { settings: null });
      if (result.rows.length !== 1 || !record(result.rows[0])) throw new Error();
      const row = result.rows[0];
      if (
        typeof row.username !== 'string' ||
        row.username.length < 1 ||
        row.username.length > 128 ||
        typeof row.password !== 'string' ||
        row.password.length < 1 ||
        row.password.length > 256 ||
        !Number.isSafeInteger(row.revision) ||
        (row.revision as number) < 1
      )
        throw new Error();
      return reply(200, {
        settings: { username: row.username, password: row.password, revision: row.revision },
      });
    } catch {
      return reply(503, { code: 'temporarily_unavailable' });
    }
  };
}
