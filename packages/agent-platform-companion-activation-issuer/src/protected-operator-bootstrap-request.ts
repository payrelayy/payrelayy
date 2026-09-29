import {
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  decodeSignedCompanionEnrollmentCertificate,
  decodeSignedCompanionHttpRequest,
  digestCompanionLookupEmptyQuery,
  verifySignedCompanionEnrollmentCertificate,
  verifySignedCompanionHttpRequest,
} from '@fetanagent/agent-platform-companion-contracts';
import {
  COMPANION_EXECUTION_OPERATOR_BOOTSTRAP_PATH,
  digestCompanionExecutionOperatorBootstrapContent,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import type {
  ProtectedHandoffHttpRequest,
  ProtectedHandoffHttpResponse,
} from './protected-handoff-request.js';
import {
  loadCompanionActivationDatabaseSnapshot,
  type CompanionActivationSnapshotQuery,
} from './snapshot.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_REQUEST_BYTES = 16 * 1_024;
const headers = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

/** The primary-key lookup has no mutation, lock, or role-changing helper. */
export const OPERATOR_BOOTSTRAP_OWNER_SQL = `
  select owner_user.auth_user_id::text as actor_auth_user_id
    from app.agent_platform_companion_execution_activation_requests request
    join app.admin_users owner_user on owner_user.id = request.requested_by_admin_id
   where request.request_key = $1::uuid
     and request.expires_at > pg_catalog.clock_timestamp()
     and owner_user.role = 'owner'
     and owner_user.status = 'active'
     and session_user = 'postgres'
`;

function exactHeaders(request: ProtectedHandoffHttpRequest): boolean {
  const values = (name: string) =>
    request.headers.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
  return (
    request.method === 'POST' &&
    request.path === COMPANION_EXECUTION_OPERATOR_BOOTSTRAP_PATH &&
    values('accept').length === 1 &&
    values('accept')[0] === AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE &&
    values('content-type').length === 1 &&
    values('content-type')[0] === AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE &&
    values('content-encoding').length === 0 &&
    values('transfer-encoding').length === 0 &&
    values('expect').length === 0 &&
    request.body instanceof Uint8Array &&
    request.body.byteLength > 0 &&
    request.body.byteLength <= MAX_REQUEST_BYTES
  );
}

export interface ProtectedOperatorBootstrapDependencies {
  readonly administrator: CompanionActivationSnapshotQuery;
  readonly requestKey: string;
  readonly trustedNoMoneySignerKeyId: string;
  readonly trustedNoMoneySignerPublicKeySpkiDer: Uint8Array;
  readonly trustedNow: () => Date;
}

/**
 * Reveals only this host's short-lived request binding to the exact paired
 * device over the separately pinned SSH tunnel. No request key is accepted
 * from Windows and no database state is changed. The host owns one-use order.
 */
export function createProtectedOperatorBootstrapRequestHandler(
  input: ProtectedOperatorBootstrapDependencies,
): (request: ProtectedHandoffHttpRequest) => Promise<ProtectedHandoffHttpResponse> {
  return async (request) => {
    try {
      if (!exactHeaders(request)) throw new Error();
      const raw = Buffer.from(request.body).toString('utf8');
      const parsed: unknown = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        Object.keys(parsed).sort().join(',') !== 'certificate,httpRequest' ||
        JSON.stringify(parsed) !== raw
      )
        throw new Error();
      const record = parsed as Record<string, unknown>;
      const certificate = decodeSignedCompanionEnrollmentCertificate(record.certificate);
      const httpRequest = decodeSignedCompanionHttpRequest(record.httpRequest);
      const contentDigest = digestCompanionExecutionOperatorBootstrapContent(
        certificate?.bodyDigest,
      );
      const now = input.trustedNow();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error();
      if (
        !certificate ||
        !httpRequest ||
        !contentDigest ||
        certificate.signerKeyId !== input.trustedNoMoneySignerKeyId ||
        !verifySignedCompanionEnrollmentCertificate(
          certificate,
          input.trustedNoMoneySignerPublicKeySpkiDer,
        ) ||
        !verifySignedCompanionHttpRequest(
          httpRequest,
          certificate,
          input.trustedNoMoneySignerPublicKeySpkiDer,
          now.toISOString(),
        ) ||
        httpRequest.body.method !== 'POST' ||
        httpRequest.body.canonicalPath !== COMPANION_EXECUTION_OPERATOR_BOOTSTRAP_PATH ||
        httpRequest.body.queryDigest !== digestCompanionLookupEmptyQuery() ||
        httpRequest.body.contentDigest !== contentDigest
      )
        throw new Error();
      const snapshot = await loadCompanionActivationDatabaseSnapshot(
        input.requestKey,
        input.administrator,
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
      const result = await input.administrator.query(OPERATOR_BOOTSTRAP_OWNER_SQL, [
        input.requestKey,
      ]);
      const actorAuthUserId = result.rows[0]?.['actor_auth_user_id'];
      if (
        result.rows.length !== 1 ||
        typeof actorAuthUserId !== 'string' ||
        !UUID.test(actorAuthUserId)
      )
        throw new Error();
      const body = Buffer.from(
        JSON.stringify({ requestKey: input.requestKey, actorAuthUserId }),
        'utf8',
      );
      return Object.freeze({ statusCode: 200, headers, body });
    } catch {
      return Object.freeze({
        statusCode: 503,
        headers,
        body: Buffer.from('{"code":"temporarily_unavailable"}', 'utf8'),
      });
    }
  };
}
