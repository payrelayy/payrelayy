import type { KeyObject } from 'node:crypto';

import {
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  decodeSignedCompanionEnrollmentCertificate,
  decodeSignedCompanionHttpRequest,
  digestCompanionLookupEmptyQuery,
  verifySignedCompanionEnrollmentCertificate,
  verifySignedCompanionHttpRequest,
} from '@fetanagent/agent-platform-companion-contracts';
import {
  COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
  digestCompanionExecutionHandoffSigningContent,
  type CompanionActivationReleaseAttestation,
  type CompanionActivationRequestSnapshot,
  type SignedCompanionExecutionActivationHandoff,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import {
  signGuardedServerCompanionHandoff,
  type GuardedServerHandoffSignerInput,
} from './guarded-server-handoff-signer.js';
import {
  loadCompanionActivationDatabaseSnapshot,
  type CompanionActivationSnapshotQuery,
} from './snapshot.js';

const MAX_REQUEST_BYTES = 16 * 1_024;
const MAX_RESPONSE_BYTES = 4_096;
const responseHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

export interface ProtectedHandoffHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: Uint8Array;
}

export interface ProtectedHandoffHttpResponse {
  readonly statusCode: 200 | 503;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface ProtectedHandoffRequestDependencies {
  /** A protected, server-owned administrator session; never the Windows client. */
  readonly administrator: CompanionActivationSnapshotQuery;
  readonly trustedNoMoneySignerKeyId: string;
  readonly trustedNoMoneySignerPublicKeySpkiDer: Uint8Array;
  readonly signerPrivateKey: KeyObject;
  readonly verifyPublishedRelease: (
    request: CompanionActivationRequestSnapshot,
  ) => Promise<CompanionActivationReleaseAttestation>;
  readonly trustedNow: () => Date;
}

type ProtectedSigner = (
  input: GuardedServerHandoffSignerInput,
) => Promise<SignedCompanionExecutionActivationHandoff>;

function unavailable(): ProtectedHandoffHttpResponse {
  return Object.freeze({
    statusCode: 503,
    headers: responseHeaders,
    body: Buffer.from('{"code":"temporarily_unavailable"}', 'utf8'),
  });
}

function headerValues(
  headers: readonly (readonly [string, string])[],
  name: string,
): readonly string[] | undefined {
  if (!Array.isArray(headers)) return undefined;
  const values: string[] = [];
  for (const entry of headers) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      typeof entry[1] !== 'string'
    )
      return undefined;
    if (entry[0].toLowerCase() === name) values.push(entry[1]);
  }
  return values;
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validEnvelope(request: ProtectedHandoffHttpRequest): boolean {
  const contentTypes = headerValues(request.headers, 'content-type');
  const accepts = headerValues(request.headers, 'accept');
  const encodings = headerValues(request.headers, 'content-encoding');
  const transferEncodings = headerValues(request.headers, 'transfer-encoding');
  const expects = headerValues(request.headers, 'expect');
  return Boolean(
    request.method === 'POST' &&
    request.path === COMPANION_EXECUTION_HANDOFF_SIGN_PATH &&
    contentTypes?.length === 1 &&
    contentTypes[0] === AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE &&
    accepts?.length === 1 &&
    accepts[0] === AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE &&
    encodings?.length === 0 &&
    transferEncodings?.length === 0 &&
    expects?.length === 0 &&
    request.body instanceof Uint8Array &&
    request.body.byteLength > 0 &&
    request.body.byteLength <= MAX_REQUEST_BYTES,
  );
}

/**
 * One-use server-side handler. A valid paired signature and the exact live
 * certificate are required before the protected signer is invoked. Even a
 * failed authenticated signing attempt consumes this handler instance; a
 * caller must never expose it through the always-on public device bridge.
 */
export function createProtectedHandoffRequestHandlerWithSigner(
  dependencies: ProtectedHandoffRequestDependencies,
  signer: ProtectedSigner,
): (request: ProtectedHandoffHttpRequest) => Promise<ProtectedHandoffHttpResponse> {
  let attempted = false;
  return async (request) => {
    try {
      if (attempted || !validEnvelope(request)) throw new Error();
      const raw = Buffer.from(request.body).toString('utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!exactRecord(parsed, ['requestKey', 'certificate', 'httpRequest'])) throw new Error();
      if (JSON.stringify(parsed) !== raw) throw new Error();
      const certificate = decodeSignedCompanionEnrollmentCertificate(parsed.certificate);
      const httpRequest = decodeSignedCompanionHttpRequest(parsed.httpRequest);
      const contentDigest = digestCompanionExecutionHandoffSigningContent(
        parsed.requestKey,
        certificate?.bodyDigest,
      );
      const now = dependencies.trustedNow();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error();
      const assessedAt = now.toISOString();
      if (
        !certificate ||
        !httpRequest ||
        !contentDigest ||
        certificate.signerKeyId !== dependencies.trustedNoMoneySignerKeyId ||
        !verifySignedCompanionEnrollmentCertificate(
          certificate,
          dependencies.trustedNoMoneySignerPublicKeySpkiDer,
        ) ||
        !verifySignedCompanionHttpRequest(
          httpRequest,
          certificate,
          dependencies.trustedNoMoneySignerPublicKeySpkiDer,
          assessedAt,
        ) ||
        httpRequest.body.method !== 'POST' ||
        httpRequest.body.canonicalPath !== COMPANION_EXECUTION_HANDOFF_SIGN_PATH ||
        httpRequest.body.queryDigest !== digestCompanionLookupEmptyQuery() ||
        httpRequest.body.contentDigest !== contentDigest
      )
        throw new Error();
      const requestKey = parsed.requestKey as string;
      const snapshot = await loadCompanionActivationDatabaseSnapshot(
        requestKey,
        dependencies.administrator,
      );
      if (
        certificate.bodyDigest !== snapshot.certificate.certificateBodyDigest ||
        certificate.body.certificateId !== snapshot.certificate.certificateId ||
        certificate.body.deviceKeyId !== snapshot.certificate.deviceKeyId ||
        certificate.body.devicePublicKeySpki !== snapshot.certificate.devicePublicKeySpki ||
        certificate.body.devicePublicKeySpkiSha256 !==
          snapshot.certificate.devicePublicKeySpkiSha256
      )
        throw new Error();
      if (attempted) throw new Error();
      attempted = true;
      const signed = await signer({
        requestKey,
        administrator: dependencies.administrator,
        verifyPublishedRelease: dependencies.verifyPublishedRelease,
        signerPrivateKey: dependencies.signerPrivateKey,
        trustedNow: dependencies.trustedNow,
      });
      if (
        signed.body.requestKey !== requestKey ||
        signed.body.noMoneyCertificateBodyDigest !== certificate.bodyDigest
      )
        throw new Error();
      const body = Buffer.from(JSON.stringify(signed), 'utf8');
      if (body.byteLength > MAX_RESPONSE_BYTES) throw new Error();
      return Object.freeze({ statusCode: 200, headers: responseHeaders, body });
    } catch {
      return unavailable();
    }
  };
}

/** Pinned production signer; no HTTP listener or credential loader is installed here. */
export function createProtectedHandoffRequestHandler(
  dependencies: ProtectedHandoffRequestDependencies,
): (request: ProtectedHandoffHttpRequest) => Promise<ProtectedHandoffHttpResponse> {
  return createProtectedHandoffRequestHandlerWithSigner(
    dependencies,
    signGuardedServerCompanionHandoff,
  );
}
