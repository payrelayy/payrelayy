import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';

import {
  AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalCompanionEnrollmentCertificateSignatureBytes,
  canonicalCompanionHttpRequestSignatureBytes,
  digestCompanionEnrollmentCertificateBody,
  digestCompanionHttpRequestBody,
  digestCompanionLookupEmptyQuery,
  type CompanionEnrollmentCertificateBody,
  type CompanionHttpRequestBody,
  type CompanionNoMoneySafety,
} from '@fetanagent/agent-platform-companion-contracts';
import { COMPANION_EXECUTION_OPERATOR_QUERY_PATH } from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it, vi } from 'vitest';

import { createGuardedOperatorQueryClient } from './guarded-operator-query-client.js';
import { ACQUIRE_SQL, RELEASE_SQL } from './guarded-operator-lifecycle-lock.js';
import { createProtectedHandoffLoopbackServer } from './protected-handoff-loopback-server.js';
import { createProtectedOperatorHttpRemoteSession } from './protected-operator-query-http-client.js';
import {
  CERTIFICATE_CURRENT_SQL,
  createProtectedOperatorQueryRequestHandler,
} from './protected-operator-query-request.js';
import { createProtectedOperatorQuerySession } from './protected-operator-query-session.js';
import {
  digestProtectedOperatorWireCommand,
  type ProtectedOperatorWireCommand,
} from './protected-operator-query-wire.js';
import { SNAPSHOT_SQL } from './snapshot.js';

const noMoneySigner = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const noMoneySpki = Buffer.from(noMoneySigner.publicKey.export({ format: 'der', type: 'spki' }));
const deviceSpki = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
const digest = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const sha = (character: string) => `sha256:${character.repeat(64)}`;
const encodeSignature = (key: typeof device.privateKey, bytes: Uint8Array) =>
  sign('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
const requestKey = randomUUID();
const certificateId = randomUUID();
const deviceKeyId = 'windows-device-key-0001';
const signerKeyId = 'server-signing-key-0001';
const now = '2026-09-27T12:01:00.000Z';
const safe: CompanionNoMoneySafety = {
  accountMutationAllowed: false,
  balanceMutationAllowed: false,
  providerMutationAllowed: false,
  paymentAllowed: false,
  depositAllowed: false,
  withdrawAllowed: false,
  transferAllowed: false,
  settlementAllowed: false,
  finalActionAllowed: false,
  financialActionAllowed: false,
  moneyMovementAllowed: false,
  transferDisabled: true,
  identifiersRedacted: true,
  moneyMoved: false,
};
const certificateBody: CompanionEnrollmentCertificateBody = {
  contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  certificateId,
  pairingId: 'pairing-request-0001',
  pairingRequestBodyDigest: sha('1'),
  pairingNonceDigest: sha('2'),
  pairingConsumed: true,
  deviceId: 'windows-device-0001',
  deviceKeyId,
  devicePublicKeySpki: deviceSpki.toString('base64url'),
  devicePublicKeySpkiSha256: digest(deviceSpki),
  signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  devicePlatform: 'windows',
  companionVersion: '0.1.11',
  state: 'active',
  issuedAt: '2026-09-27T11:00:00.000Z',
  validFrom: '2026-09-27T11:00:00.000Z',
  validUntil: '2026-09-27T15:00:00.000Z',
  ...safe,
};
const certificate = {
  contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  transcriptVersion: AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
  bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  bodyDigest: digestCompanionEnrollmentCertificateBody(certificateBody)!,
  signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  signerKeyId,
  body: certificateBody,
  signature: encodeSignature(
    noMoneySigner.privateKey,
    canonicalCompanionEnrollmentCertificateSignatureBytes(certificateBody, signerKeyId)!,
  ),
};

function signer() {
  return {
    certificate,
    createSignedHttpRequest(
      path: typeof COMPANION_EXECUTION_OPERATOR_QUERY_PATH,
      contentDigest: string,
    ) {
      const body: CompanionHttpRequestBody = {
        contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
        protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
        requestId: randomUUID(),
        certificateId,
        deviceId: certificateBody.deviceId,
        deviceKeyId,
        method: 'POST',
        canonicalPath: path,
        queryDigest: digestCompanionLookupEmptyQuery(),
        contentDigest,
        nonceDigest: digest(randomBytes(32)),
        issuedAt: '2026-09-27T12:00:50.000Z',
        expiresAt: '2026-09-27T12:01:50.000Z',
        ...safe,
      };
      return {
        contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
        protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
        transcriptVersion: AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
        bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
        bodyDigest: digestCompanionHttpRequestBody(body)!,
        signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
        signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
        deviceKeyId,
        body,
        signature: encodeSignature(
          device.privateKey,
          canonicalCompanionHttpRequestSignatureBytes(body)!,
        ),
      };
    },
  };
}

function snapshotRow() {
  const pilotId = randomUUID();
  return {
    request_key: requestKey,
    request_pilot_revision_id: pilotId,
    request_activation_epoch: '1',
    request_certificate_id: certificateId,
    request_account_id: randomUUID(),
    companion_release_sha: 'a'.repeat(40),
    companion_archive_sha256: sha('b'),
    companion_installation_tree_sha256: sha('c'),
    requested_at: new Date('2026-09-27T12:00:00.000Z'),
    request_expires_at: new Date('2026-09-27T12:10:00.000Z'),
    current_pilot_revision_id: pilotId,
    current_activation_epoch: '1',
    current_certificate_id: certificateId,
    current_account_id: randomUUID(),
    certificate_body_digest: certificate.bodyDigest,
    device_key_id: deviceKeyId,
    device_public_key_spki: certificateBody.devicePublicKeySpki,
    device_public_key_spki_sha256: certificateBody.devicePublicKeySpkiSha256,
    certificate_valid_from: new Date(certificateBody.validFrom),
    certificate_valid_until: new Date(certificateBody.validUntil),
  };
}

function directRequest(command: ProtectedOperatorWireCommand) {
  const httpRequest = signer().createSignedHttpRequest(
    COMPANION_EXECUTION_OPERATOR_QUERY_PATH,
    digestProtectedOperatorWireCommand(command),
  );
  return {
    method: 'POST',
    path: COMPANION_EXECUTION_OPERATOR_QUERY_PATH,
    headers: [
      ['content-type', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE],
      ['accept', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE],
    ],
    body: Buffer.from(JSON.stringify({ command, certificate, httpRequest }), 'utf8'),
  };
}

function directFixture(certificateCurrent = true) {
  const query = vi.fn(async (sql: string) => {
    if (sql === SNAPSHOT_SQL) return { rows: [snapshotRow()] };
    if (sql === CERTIFICATE_CURRENT_SQL) return { rows: [{ current: certificateCurrent }] };
    if (sql === ACQUIRE_SQL) return { rows: [{ acquired: true }] };
    if (sql === RELEASE_SQL) return { rows: [{ released: true }] };
    throw new Error();
  });
  const administrator = { processID: 417, query, on: vi.fn(), off: vi.fn() };
  const closeAdministrator = vi.fn(async () => undefined);
  const session = createProtectedOperatorQuerySession({
    administrator,
    requestKey,
    closeAdministrator,
    disableDatabase: vi.fn(async () => undefined),
  });
  const handler = createProtectedOperatorQueryRequestHandler({
    administrator,
    session,
    requestKey,
    trustedNoMoneySignerKeyId: signerKeyId,
    trustedNoMoneySignerPublicKeySpkiDer: noMoneySpki,
    trustedNow: () => new Date(now),
  });
  return { query, closeAdministrator, handler };
}

describe('paired protected operator query transport', () => {
  it('binds the signed loopback session to one request and preserves Postgres timestamp types', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === SNAPSHOT_SQL) return { rows: [snapshotRow()] };
      if (sql === CERTIFICATE_CURRENT_SQL) return { rows: [{ current: true }] };
      if (sql === ACQUIRE_SQL) return { rows: [{ acquired: true }] };
      if (sql === RELEASE_SQL) return { rows: [{ released: true }] };
      throw new Error();
    });
    const administrator = { processID: 417, query, on: vi.fn(), off: vi.fn() };
    const closeAdministrator = vi.fn(async () => undefined);
    const disableDatabase = vi.fn(async () => undefined);
    const session = createProtectedOperatorQuerySession({
      administrator,
      requestKey,
      closeAdministrator,
      disableDatabase,
    });
    const handler = createProtectedOperatorQueryRequestHandler({
      administrator,
      session,
      requestKey,
      trustedNoMoneySignerKeyId: signerKeyId,
      trustedNoMoneySignerPublicKeySpkiDer: noMoneySpki,
      trustedNow: () => new Date(now),
    });
    const server = createProtectedHandoffLoopbackServer(handler, 0);
    const port = await server.listen();
    try {
      const remote = await createProtectedOperatorHttpRemoteSession(signer(), requestKey, port);
      const client = createGuardedOperatorQueryClient(remote);
      const lockValues = [1178682452, 1329885472, 417];
      expect(
        (await client.administrator.query(ACQUIRE_SQL, lockValues)).rows[0]?.['acquired'],
      ).toBe(true);
      const snapshot = await client.administrator.query(SNAPSHOT_SQL, [requestKey]);
      expect(snapshot.rows[0]?.['request_key']).toBe(requestKey);
      expect(snapshot.rows[0]?.['requested_at']).toBeInstanceOf(Date);
      await client.administrator.query(RELEASE_SQL, lockValues);
      await client.close();
      expect(closeAdministrator).toHaveBeenCalledTimes(1);
      expect(disableDatabase).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledTimes(8);
    } finally {
      await server.close();
    }
  });

  it('consumes the signed opening nonce and rejects a replay without a second database operation', async () => {
    const { handler, query, closeAdministrator } = directFixture();
    const opening: ProtectedOperatorWireCommand = {
      requestKey,
      sequence: 0,
      name: 'open',
      values: [],
      sessionNonce: null,
    };
    const sameSignedRequest = directRequest(opening);
    expect((await handler(sameSignedRequest)).statusCode).toBe(200);
    expect((await handler(sameSignedRequest)).statusCode).toBe(503);
    await vi.waitFor(() => expect(closeAdministrator).toHaveBeenCalledTimes(1));
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects a signed sequence gap and never forwards its requested operation', async () => {
    const { handler, query, closeAdministrator } = directFixture();
    const opened = await handler(
      directRequest({ requestKey, sequence: 0, name: 'open', values: [], sessionNonce: null }),
    );
    expect(opened.statusCode).toBe(200);
    const reply = JSON.parse(Buffer.from(opened.body).toString('utf8')) as { sessionNonce: string };
    expect(
      (
        await handler(
          directRequest({
            requestKey,
            sequence: 2,
            name: 'acquire',
            values: [1178682452, 1329885472, 417],
            sessionNonce: reply.sessionNonce,
          }),
        )
      ).statusCode,
    ).toBe(503);
    await vi.waitFor(() => expect(closeAdministrator).toHaveBeenCalledTimes(1));
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('stops when the paired certificate is no longer current before forwarding a query', async () => {
    const { handler, query, closeAdministrator } = directFixture(false);
    const opened = await handler(
      directRequest({ requestKey, sequence: 0, name: 'open', values: [], sessionNonce: null }),
    );
    expect(opened.statusCode).toBe(200);
    const reply = JSON.parse(Buffer.from(opened.body).toString('utf8')) as { sessionNonce: string };
    expect(
      (
        await handler(
          directRequest({
            requestKey,
            sequence: 1,
            name: 'acquire',
            values: [1178682452, 1329885472, 417],
            sessionNonce: reply.sessionNonce,
          }),
        )
      ).statusCode,
    ).toBe(503);
    await vi.waitFor(() => expect(closeAdministrator).toHaveBeenCalledTimes(1));
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([SNAPSHOT_SQL, CERTIFICATE_CURRENT_SQL]);
  });
});
