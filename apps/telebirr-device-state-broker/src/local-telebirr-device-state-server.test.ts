import { readFile } from 'node:fs/promises';

import {
  TELEBIRR_DEVICE_STATE_LOCAL_CONTENT_TYPE,
  TELEBIRR_DEVICE_STATE_LOCAL_CONTRACT_VERSION,
  TELEBIRR_DEVICE_STATE_LOCAL_NO_MONEY_SAFETY,
  TELEBIRR_DEVICE_STATE_LOCAL_PATHS,
  TELEBIRR_DEVICE_STATE_LOCAL_PROTOCOL_MODE,
  TELEBIRR_DEVICE_STATE_LOCAL_PROVIDER_CODE,
  decodeTelebirrDeviceStateLocalResponseBytes,
  encodeTelebirrDeviceStateLocalRequest,
  telebirrDeviceStateLocalPathForOperation,
  type TelebirrDeviceStateLocalRequest,
} from '@fetanagent/telebirr-verification-foundation';
import { describe, expect, it, vi } from 'vitest';

import {
  createTelebirrDeviceStateLocalHandler,
  createTelebirrDeviceStateLocalUnixServer,
  type TelebirrDeviceStateLocalHttpRequest,
} from './local-telebirr-device-state-server.js';
import { telebirrDeviceStateTestFixture, testIds } from './telebirr-device-state-test-fixtures.js';
import type { TelebirrDeviceStateDatabase } from './telebirr-device-state.js';

const fixture = telebirrDeviceStateTestFixture();
const replayIdentity = 'sha256:' + '9'.repeat(64);
const header = {
  contractVersion: TELEBIRR_DEVICE_STATE_LOCAL_CONTRACT_VERSION,
  providerCode: TELEBIRR_DEVICE_STATE_LOCAL_PROVIDER_CODE,
  protocolMode: TELEBIRR_DEVICE_STATE_LOCAL_PROTOCOL_MODE,
  ...TELEBIRR_DEVICE_STATE_LOCAL_NO_MONEY_SAFETY,
} as const;

function databaseFixture(): {
  readonly database: TelebirrDeviceStateDatabase;
  readonly methods: Readonly<Record<keyof TelebirrDeviceStateDatabase, ReturnType<typeof vi.fn>>>;
} {
  const methods = {
    claimPairingChallenge: vi.fn(async () => ({
      kind: 'claimed' as const,
      certificateBody: fixture.enrollmentBody,
    })),
    completePairingChallenge: vi.fn(async () => true),
    releasePairingChallenge: vi.fn(async () => undefined),
    loadEnrollment: vi.fn(async () => fixture.certificate),
    claimReplay: vi.fn(async () => ({
      kind: 'completed' as const,
      response: fixture.response,
    })),
    completeReplay: vi.fn(async () => true),
    releaseReplay: vi.fn(async () => undefined),
    recordHeartbeat: vi.fn(async () => ({ kind: 'accepted' as const })),
    stageEvidenceOnly: vi.fn(async () => ({ kind: 'accepted' as const, replayed: true })),
  };
  return { database: methods, methods };
}

function httpRequest(
  request: TelebirrDeviceStateLocalRequest,
  overrides: Partial<TelebirrDeviceStateLocalHttpRequest> = {},
): TelebirrDeviceStateLocalHttpRequest {
  const body = encodeTelebirrDeviceStateLocalRequest(request);
  const path = telebirrDeviceStateLocalPathForOperation(request.operation);
  if (!body || !path) throw new Error('invalid synthetic local request');
  return {
    method: 'POST',
    path,
    headers: [
      ['content-type', TELEBIRR_DEVICE_STATE_LOCAL_CONTENT_TYPE],
      ['content-length', String(body.byteLength)],
    ],
    body,
    ...overrides,
  };
}

function requests(): readonly TelebirrDeviceStateLocalRequest[] {
  return [
    {
      ...header,
      operation: 'pairing_claim',
      pairingRequest: fixture.pairing,
      assessedAt: '2026-09-04T10:00:05.000Z',
    },
    {
      ...header,
      operation: 'pairing_complete',
      pairingRequestBodyDigest: fixture.pairing.bodyDigest,
      certificate: fixture.certificate,
    },
    {
      ...header,
      operation: 'pairing_release',
      pairingRequestBodyDigest: fixture.pairing.bodyDigest,
    },
    {
      ...header,
      operation: 'enrollment_load',
      enrollmentId: testIds.enrollment,
    },
    {
      ...header,
      operation: 'replay_claim',
      replayIdentity,
      requestExpiresAt: '2026-09-04T10:03:00.000Z',
    },
    {
      ...header,
      operation: 'replay_complete',
      replayIdentity,
      response: fixture.response,
      requestExpiresAt: '2026-09-04T10:03:00.000Z',
    },
    {
      ...header,
      operation: 'replay_release',
      replayIdentity,
    },
    {
      ...header,
      operation: 'heartbeat_record',
      certificate: fixture.enrollmentBody,
      request: fixture.heartbeatRequest,
      payload: fixture.heartbeatPayload,
    },
    {
      ...header,
      operation: 'evidence_stage',
      certificate: fixture.enrollmentBody,
      request: fixture.evidenceRequest,
      payload: fixture.evidencePayload,
    },
  ];
}

describe('local TeleBirr device-state server', () => {
  it('dispatches exactly the nine canonical operations and returns typed responses', async () => {
    const value = databaseFixture();
    const handler = createTelebirrDeviceStateLocalHandler(value.database);
    const seen = new Set<string>();
    for (const request of requests()) {
      const result = await handler(httpRequest(request));
      expect(result.statusCode).toBe(200);
      expect(result.headers['content-type']).toBe(TELEBIRR_DEVICE_STATE_LOCAL_CONTENT_TYPE);
      const decoded = decodeTelebirrDeviceStateLocalResponseBytes(result.body);
      expect(decoded?.operation).toBe(request.operation);
      if (decoded) seen.add(decoded.operation);
    }
    expect(seen).toEqual(new Set(Object.keys(TELEBIRR_DEVICE_STATE_LOCAL_PATHS)));
    for (const method of Object.values(value.methods)) expect(method).toHaveBeenCalledOnce();
    expect(value.methods.stageEvidenceOnly).toHaveBeenCalledWith(
      fixture.enrollmentBody,
      fixture.evidenceRequest,
      fixture.evidencePayload,
    );
  });

  it('rejects path confusion and ambiguous HTTP framing before database dispatch', async () => {
    const value = databaseFixture();
    const handler = createTelebirrDeviceStateLocalHandler(value.database);
    const request = requests()[6];
    if (!request) throw new Error('missing synthetic request');
    const wrongPath = await handler(
      httpRequest(request, { path: TELEBIRR_DEVICE_STATE_LOCAL_PATHS.enrollment_load }),
    );
    expect(wrongPath.statusCode).toBe(400);

    const baseline = httpRequest(request);
    const duplicate = await handler({
      ...baseline,
      headers: [
        ['content-type', TELEBIRR_DEVICE_STATE_LOCAL_CONTENT_TYPE],
        ['Content-Type', TELEBIRR_DEVICE_STATE_LOCAL_CONTENT_TYPE],
        ['content-length', String(baseline.body.byteLength)],
      ],
    });
    expect(duplicate.statusCode).toBe(400);
    for (const method of Object.values(value.methods)) expect(method).not.toHaveBeenCalled();
  });

  it('returns only an opaque temporary failure when private state fails', async () => {
    const value = databaseFixture();
    value.methods.releaseReplay.mockRejectedValue(
      new Error('must-not-leak-private-database-detail'),
    );
    const handler = createTelebirrDeviceStateLocalHandler(value.database);
    const request = requests()[6];
    if (!request) throw new Error('missing synthetic request');
    const result = await handler(httpRequest(request));
    expect(result.statusCode).toBe(503);
    expect(Buffer.from(result.body).toString('utf8')).toBe(
      JSON.stringify({ code: 'temporarily_unavailable' }),
    );
    expect(Buffer.from(result.body).toString('utf8')).not.toContain('database');
  });

  it('constructs only a fixed Unix-socket server with a mode-0600 endpoint', async () => {
    const value = databaseFixture();
    const runtime = createTelebirrDeviceStateLocalUnixServer(value.database);
    expect(runtime.server.listening).toBe(false);
    await runtime.close();

    const source = await readFile(
      new URL('./local-telebirr-device-state-server.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('server.listen(TELEBIRR_DEVICE_STATE_LOCAL_SOCKET');
    expect(source).toContain('chmod(TELEBIRR_DEVICE_STATE_LOCAL_SOCKET, 0o600)');
    expect(source).not.toMatch(/server\.listen\(\s*\{/u);
    expect(source).not.toMatch(/\b(?:service_role|SUPABASE|wallet|settlement)\b/u);
  });
});
