import { randomBytes } from 'node:crypto';

import {
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  decodeSignedCompanionEnrollmentCertificate,
  decodeSignedCompanionHttpRequest,
  digestCompanionLookupEmptyQuery,
  verifySignedCompanionEnrollmentCertificate,
  verifySignedCompanionHttpRequest,
} from '@fetanagent/agent-platform-companion-contracts';
import { COMPANION_EXECUTION_OPERATOR_QUERY_PATH } from '@fetanagent/agent-platform-companion-execution-contracts';

import type {
  ProtectedHandoffHttpRequest,
  ProtectedHandoffHttpResponse,
} from './protected-handoff-request.js';
import {
  protectedOperatorQueries,
  type ProtectedOperatorQueryName,
} from './protected-operator-query-catalog.js';
import type { ProtectedOperatorQuerySession } from './protected-operator-query-session.js';
import {
  digestProtectedOperatorWireCommand,
  exactRecord,
  validWireCommand,
} from './protected-operator-query-wire.js';
import {
  loadCompanionActivationDatabaseSnapshot,
  type CompanionActivationSnapshotQuery,
} from './snapshot.js';

const MAX_BODY_BYTES = 16 * 1_024;
export const CERTIFICATE_CURRENT_SQL = `select exists (
  select 1
    from app.agent_platform_companion_enrollment_certificates certificate
    join app.agent_platform_companion_pairing_challenges pairing
      on pairing.pairing_id = certificate.pairing_id
     and pairing.state = 'completed'
    join app.admin_users owner_user
      on owner_user.id = pairing.created_by_admin_id
     and owner_user.role = 'owner'
     and owner_user.status = 'active'
    join app.agent_platform_companion_server_signers signer
      on signer.id = certificate.server_signer_id
     and signer.signer_key_id = certificate.certificate_signer_key_id
    left join app.agent_platform_companion_device_revocations device_revocation
      on device_revocation.certificate_id = certificate.certificate_id
    left join app.agent_platform_companion_server_signer_revocations signer_revocation
      on signer_revocation.server_signer_id = signer.id
   where certificate.certificate_id = $1::uuid
     and certificate.certificate_body_digest = $2::text
     and certificate.device_key_id = $3::text
     and signer.signer_key_id = $4::text
     and certificate.valid_from <= pg_catalog.clock_timestamp()
     and certificate.valid_until > pg_catalog.clock_timestamp()
     and signer.valid_from <= pg_catalog.clock_timestamp()
     and signer.valid_until > pg_catalog.clock_timestamp()
     and device_revocation.certificate_id is null
     and signer_revocation.server_signer_id is null
     and session_user = 'postgres' and current_user = 'postgres'
) as current`;
const responseHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

export interface ProtectedOperatorQueryRequestDependencies {
  /** The same dedicated server-held administrator client that owns the session. */
  readonly administrator: CompanionActivationSnapshotQuery;
  readonly session: ProtectedOperatorQuerySession;
  readonly requestKey: string;
  readonly trustedNoMoneySignerKeyId: string;
  readonly trustedNoMoneySignerPublicKeySpkiDer: Uint8Array;
  readonly trustedNow: () => Date;
}

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
    if (!Array.isArray(entry) || entry.length !== 2) return undefined;
    if (typeof entry[0] !== 'string' || typeof entry[1] !== 'string') return undefined;
    if (entry[0].toLowerCase() === name) values.push(entry[1]);
  }
  return values;
}

function exactEnvelope(request: ProtectedHandoffHttpRequest): boolean {
  const contentTypes = headerValues(request.headers, 'content-type');
  const accepts = headerValues(request.headers, 'accept');
  const encodings = headerValues(request.headers, 'content-encoding');
  const transferEncodings = headerValues(request.headers, 'transfer-encoding');
  const expects = headerValues(request.headers, 'expect');
  return Boolean(
    request.method === 'POST' &&
    request.path === COMPANION_EXECUTION_OPERATOR_QUERY_PATH &&
    contentTypes?.length === 1 &&
    contentTypes[0] === AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE &&
    accepts?.length === 1 &&
    accepts[0] === AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE &&
    encodings?.length === 0 &&
    transferEncodings?.length === 0 &&
    expects?.length === 0 &&
    request.body instanceof Uint8Array &&
    request.body.byteLength > 0 &&
    request.body.byteLength <= MAX_BODY_BYTES,
  );
}

/**
 * Private, serial, paired-certificate-authenticated adapter. A caller must
 * supply the separate authenticated tunnel and close the loopback listener
 * and exact database session on every outcome. It cannot be mounted on the
 * always-on public companion bridge.
 */
export function createProtectedOperatorQueryRequestHandler(
  dependencies: ProtectedOperatorQueryRequestDependencies,
): (request: ProtectedHandoffHttpRequest) => Promise<ProtectedHandoffHttpResponse> {
  let opened = false;
  let closed = false;
  let nextSequence = 0;
  let sessionNonce: string | undefined;
  let certificateDigest: string | undefined;
  let busy = false;

  return async (request) => {
    if (busy) {
      closed = true;
      try {
        await dependencies.session.close();
      } catch {
        // A failed stop is still an unavailable session, never authority.
      }
      return unavailable();
    }
    busy = true;
    try {
      if (closed || !exactEnvelope(request)) throw new Error();
      const raw = Buffer.from(request.body).toString('utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!exactRecord(parsed, ['command', 'certificate', 'httpRequest'])) throw new Error();
      if (JSON.stringify(parsed) !== raw || !validWireCommand(parsed.command)) throw new Error();
      const command = parsed.command;
      const certificate = decodeSignedCompanionEnrollmentCertificate(parsed.certificate);
      const signed = decodeSignedCompanionHttpRequest(parsed.httpRequest);
      const now = dependencies.trustedNow();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error();
      if (
        command.requestKey !== dependencies.requestKey ||
        command.sequence !== nextSequence ||
        (opened && command.sessionNonce !== sessionNonce) ||
        (!opened && command.name !== 'open') ||
        (opened && command.name === 'open') ||
        !certificate ||
        !signed ||
        certificate.signerKeyId !== dependencies.trustedNoMoneySignerKeyId ||
        !verifySignedCompanionEnrollmentCertificate(
          certificate,
          dependencies.trustedNoMoneySignerPublicKeySpkiDer,
        ) ||
        !verifySignedCompanionHttpRequest(
          signed,
          certificate,
          dependencies.trustedNoMoneySignerPublicKeySpkiDer,
          now.toISOString(),
        ) ||
        signed.body.method !== 'POST' ||
        signed.body.canonicalPath !== COMPANION_EXECUTION_OPERATOR_QUERY_PATH ||
        signed.body.queryDigest !== digestCompanionLookupEmptyQuery() ||
        signed.body.contentDigest !== digestProtectedOperatorWireCommand(command) ||
        (opened && certificate.bodyDigest !== certificateDigest)
      )
        throw new Error();

      // Consume the authenticated message before any database round-trip.
      nextSequence += 1;
      if (opened) {
        const current = await dependencies.administrator.query(CERTIFICATE_CURRENT_SQL, [
          certificate.body.certificateId,
          certificate.bodyDigest,
          certificate.body.deviceKeyId,
          certificate.signerKeyId,
        ]);
        if (
          current.rows.length !== 1 ||
          !current.rows[0] ||
          Object.keys(current.rows[0]).length !== 1 ||
          current.rows[0]['current'] !== true
        )
          throw new Error();
      }
      let reply: Record<string, unknown>;
      if (command.name === 'open') {
        const snapshot = await loadCompanionActivationDatabaseSnapshot(
          dependencies.requestKey,
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
        certificateDigest = certificate.bodyDigest;
        sessionNonce = randomBytes(32).toString('base64url');
        opened = true;
        reply = {
          sequence: command.sequence,
          backendPid: dependencies.session.backendPid,
          sessionNonce,
        };
      } else if (command.name === 'close') {
        if (command.values.length !== 0) throw new Error();
        await dependencies.session.close();
        closed = true;
        reply = { sequence: command.sequence, closed: true };
      } else {
        if (!Object.hasOwn(protectedOperatorQueries, command.name)) throw new Error();
        const result = await dependencies.session.execute(
          command.name as ProtectedOperatorQueryName,
          command.values,
        );
        reply = { sequence: command.sequence, rows: result.rows };
      }
      const body = Buffer.from(JSON.stringify(reply), 'utf8');
      if (body.byteLength > MAX_BODY_BYTES) throw new Error();
      return Object.freeze({ statusCode: 200, headers: responseHeaders, body });
    } catch {
      closed = true;
      try {
        await dependencies.session.close();
      } catch {
        // The independent database watchdog remains the fail-closed backstop.
      }
      return unavailable();
    } finally {
      busy = false;
    }
  };
}
