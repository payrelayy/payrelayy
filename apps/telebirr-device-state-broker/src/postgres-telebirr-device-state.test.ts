import { describe, expect, it, vi } from 'vitest';

import {
  CLAIM_TELEBIRR_DEVICE_PAIRING_SQL,
  CLAIM_TELEBIRR_DEVICE_REPLAY_SQL,
  COMPLETE_TELEBIRR_DEVICE_PAIRING_SQL,
  COMPLETE_TELEBIRR_DEVICE_REPLAY_SQL,
  LOAD_TELEBIRR_DEVICE_ENROLLMENT_SQL,
  RECORD_TELEBIRR_DEVICE_HEARTBEAT_SQL,
  RELEASE_TELEBIRR_DEVICE_PAIRING_SQL,
  RELEASE_TELEBIRR_DEVICE_REPLAY_SQL,
  STAGE_TELEBIRR_DEVICE_EVIDENCE_SQL,
  TELEBIRR_DEVICE_STATE_CATALOG_PREFLIGHT_SQL,
  TELEBIRR_DEVICE_STATE_PREFLIGHT_KEYS,
  TELEBIRR_DEVICE_STATE_SINGLETON_ACQUIRE_SQL,
  TELEBIRR_DEVICE_STATE_SINGLETON_HELD_SQL,
  TELEBIRR_DEVICE_STATE_SINGLETON_KEYS,
  TELEBIRR_DEVICE_STATE_SINGLETON_RELEASE_SQL,
  PostgresTelebirrDeviceStateDatabase,
  TelebirrDeviceStatePostgresUnavailableError,
  assertTelebirrDeviceStateCatalogPreflight,
  createTelebirrDeviceStatePostgresRuntime,
  type TelebirrDeviceStatePostgresClient,
  type TelebirrDeviceStatePostgresQuery,
} from './postgres-telebirr-device-state.js';
import { decodeTelebirrDeviceStateCommandResponse } from './telebirr-device-state.js';
import {
  telebirrDeviceStatePairingTestFixture,
  telebirrDeviceStateTestFixture,
  testIds,
} from './telebirr-device-state-test-fixtures.js';

const fixture = telebirrDeviceStateTestFixture();
const replayIdentity = 'sha256:' + '9'.repeat(64);

function preflightRow(overrides: Readonly<Record<string, boolean>> = {}) {
  return Object.fromEntries(
    TELEBIRR_DEVICE_STATE_PREFLIGHT_KEYS.map((key) => [key, overrides[key] ?? true]),
  );
}

function queryWith(operationSql: string, operationRows: readonly unknown[]) {
  return {
    query: vi.fn(async (query: string, _values: readonly unknown[]) => {
      if (query === TELEBIRR_DEVICE_STATE_CATALOG_PREFLIGHT_SQL) {
        return { rows: [preflightRow()] };
      }
      if (query === operationSql) return { rows: operationRows };
      throw new Error('unexpected query');
    }),
  } satisfies TelebirrDeviceStatePostgresQuery;
}

describe('TeleBirr device-state PostgreSQL adapter', () => {
  it('uses stable protocol singleton namespaces rather than a date-shaped shutdown key', () => {
    expect(TELEBIRR_DEVICE_STATE_SINGLETON_KEYS).toEqual([0x46455441, 0x54445354]);
  });

  it('requires every exact catalog fact and the complete role-graph boundary', async () => {
    const safe: TelebirrDeviceStatePostgresQuery = {
      query: vi.fn(async () => ({ rows: [preflightRow()] })),
    };
    await expect(assertTelebirrDeviceStateCatalogPreflight(safe)).resolves.toBeUndefined();

    const unsafe: TelebirrDeviceStatePostgresQuery = {
      query: vi.fn(async () => ({
        rows: [preflightRow({ group_has_no_upstream_membership: false })],
      })),
    };
    await expect(assertTelebirrDeviceStateCatalogPreflight(unsafe)).rejects.toThrow(
      TelebirrDeviceStatePostgresUnavailableError,
    );
    expect(TELEBIRR_DEVICE_STATE_PREFLIGHT_KEYS).toEqual(
      expect.arrayContaining([
        'runtime_only_trusted_members',
        'group_only_expected_members',
        'group_has_no_upstream_membership',
        'no_reachable_unallowlisted_security_definer',
      ]),
    );
    expect(TELEBIRR_DEVICE_STATE_CATALOG_PREFLIGHT_SQL).toContain("member.rolname = 'postgres'");
    expect(TELEBIRR_DEVICE_STATE_CATALOG_PREFLIGHT_SQL).toContain(
      "count(*) filter (where member.rolname = 'postgres') <= 1",
    );
    expect(TELEBIRR_DEVICE_STATE_CATALOG_PREFLIGHT_SQL).toContain('routine.pronargdefaults = 0');
    expect(TELEBIRR_DEVICE_STATE_CATALOG_PREFLIGHT_SQL).toContain('defaults.defaclnamespace = 0');
    expect(TELEBIRR_DEVICE_STATE_CATALOG_PREFLIGHT_SQL).toContain(
      'pg_catalog.array_agg(namespace.nspname::text order by namespace.nspname)',
    );
    expect(TELEBIRR_DEVICE_STATE_CATALOG_PREFLIGHT_SQL).not.toContain(
      'namespace.oid = defaults.defaclnamespace',
    );
  });

  it('rejects preflight rows with extras, accessors, proxies, or non-boolean facts', async () => {
    const rows: unknown[] = [
      { ...preflightRow(), unexpected: true },
      Object.defineProperty(preflightRow(), 'runtime_login_is_safe', {
        enumerable: true,
        get: () => true,
      }),
      new Proxy(preflightRow(), {}),
      { ...preflightRow(), runtime_login_is_safe: 1 },
    ];
    for (const row of rows) {
      const database: TelebirrDeviceStatePostgresQuery = {
        query: vi.fn(async () => ({ rows: [row] })),
      };
      await expect(assertTelebirrDeviceStateCatalogPreflight(database)).rejects.toThrow(
        TelebirrDeviceStatePostgresUnavailableError,
      );
    }
  });

  it('claims the exact pairing binding and maps claimed, in-progress, completed, and missing', async () => {
    const claimedQuery = queryWith(CLAIM_TELEBIRR_DEVICE_PAIRING_SQL, [
      {
        claim_state: 'claimed',
        certificate_body: fixture.enrollmentBody,
        signed_certificate: null,
      },
    ]);
    const claimed = new PostgresTelebirrDeviceStateDatabase(claimedQuery);
    await expect(
      claimed.claimPairingChallenge(fixture.pairing, '2026-09-04T10:00:05.000Z'),
    ).resolves.toEqual({ kind: 'claimed', certificateBody: fixture.enrollmentBody });
    expect(claimedQuery.query).toHaveBeenNthCalledWith(2, CLAIM_TELEBIRR_DEVICE_PAIRING_SQL, [
      fixture.pairing.body.pairingId,
      fixture.pairing.body.pairingNonceDigest,
      fixture.pairing.bodyDigest,
      fixture.pairing.body.deviceId,
      fixture.pairing.body.keyId,
      fixture.pairing.body.devicePublicKeySpki,
      fixture.pairing.body.devicePublicKeySpkiSha256,
      fixture.pairing.body.appVersion,
      fixture.pairing.body.issuedAt,
      fixture.pairing.body.expiresAt,
    ]);

    const inProgress = new PostgresTelebirrDeviceStateDatabase(
      queryWith(CLAIM_TELEBIRR_DEVICE_PAIRING_SQL, [
        { claim_state: 'in_progress', certificate_body: null, signed_certificate: null },
      ]),
    );
    await expect(
      inProgress.claimPairingChallenge(fixture.pairing, '2026-09-04T10:00:05.000Z'),
    ).resolves.toEqual({ kind: 'in_progress' });

    const completed = new PostgresTelebirrDeviceStateDatabase(
      queryWith(CLAIM_TELEBIRR_DEVICE_PAIRING_SQL, [
        {
          claim_state: 'completed',
          certificate_body: fixture.enrollmentBody,
          signed_certificate: fixture.certificate,
        },
      ]),
    );
    await expect(
      completed.claimPairingChallenge(fixture.pairing, '2026-09-04T10:00:05.000Z'),
    ).resolves.toEqual({ kind: 'completed', certificate: fixture.certificate });

    const missing = new PostgresTelebirrDeviceStateDatabase(
      queryWith(CLAIM_TELEBIRR_DEVICE_PAIRING_SQL, []),
    );
    await expect(
      missing.claimPairingChallenge(fixture.pairing, '2026-09-04T10:00:05.000Z'),
    ).resolves.toBeUndefined();
  });

  it('rejects pairing rows with a mismatched body, an accessor, or an invalid assessment time', async () => {
    const mismatch = new PostgresTelebirrDeviceStateDatabase(
      queryWith(CLAIM_TELEBIRR_DEVICE_PAIRING_SQL, [
        {
          claim_state: 'claimed',
          certificate_body: { ...fixture.enrollmentBody, deviceId: 'wrong-device-0001' },
          signed_certificate: null,
        },
      ]),
    );
    await expect(
      mismatch.claimPairingChallenge(fixture.pairing, '2026-09-04T10:00:05.000Z'),
    ).rejects.toThrow(TelebirrDeviceStatePostgresUnavailableError);

    const hostile = {
      claim_state: 'claimed',
      certificate_body: fixture.enrollmentBody,
      signed_certificate: null,
    };
    Object.defineProperty(hostile, 'certificate_body', {
      enumerable: true,
      get: () => fixture.enrollmentBody,
    });
    const accessor = new PostgresTelebirrDeviceStateDatabase(
      queryWith(CLAIM_TELEBIRR_DEVICE_PAIRING_SQL, [hostile]),
    );
    await expect(
      accessor.claimPairingChallenge(fixture.pairing, '2026-09-04T10:00:05.000Z'),
    ).rejects.toThrow(TelebirrDeviceStatePostgresUnavailableError);

    const neverCalled: TelebirrDeviceStatePostgresQuery = { query: vi.fn() };
    await expect(
      new PostgresTelebirrDeviceStateDatabase(neverCalled).claimPairingChallenge(
        fixture.pairing,
        '2026-09-04T10:00:05Z',
      ),
    ).rejects.toThrow(TelebirrDeviceStatePostgresUnavailableError);
    expect(neverCalled.query).not.toHaveBeenCalled();
  });

  it('does not let public opaque IDs reach PostgreSQL UUID casts', async () => {
    const query: TelebirrDeviceStatePostgresQuery = { query: vi.fn() };
    const database = new PostgresTelebirrDeviceStateDatabase(query);
    const nonUuidPairing = telebirrDeviceStatePairingTestFixture('pairing-request-0001');

    await expect(
      database.claimPairingChallenge(nonUuidPairing, '2026-09-04T10:00:05.000Z'),
    ).resolves.toBeUndefined();
    await expect(database.loadEnrollment('opaque-enrollment-0001')).resolves.toBeUndefined();
    expect(query.query).not.toHaveBeenCalled();
  });

  it('completes pairing with exact booleans and preserves a valid database false', async () => {
    for (const completed of [true, false]) {
      const query = queryWith(COMPLETE_TELEBIRR_DEVICE_PAIRING_SQL, [{ completed }]);
      const database = new PostgresTelebirrDeviceStateDatabase(query);
      await expect(
        database.completePairingChallenge(fixture.pairing.bodyDigest, fixture.certificate),
      ).resolves.toBe(completed);
      expect(query.query).toHaveBeenNthCalledWith(2, COMPLETE_TELEBIRR_DEVICE_PAIRING_SQL, [
        fixture.pairing.bodyDigest,
        fixture.certificate.bodyDigest,
        fixture.certificate.signerKeyId,
        fixture.certificate.signature,
        fixture.certificate,
      ]);
    }

    const malformed = new PostgresTelebirrDeviceStateDatabase(
      queryWith(COMPLETE_TELEBIRR_DEVICE_PAIRING_SQL, [{ completed: 'false' }]),
    );
    await expect(
      malformed.completePairingChallenge(fixture.pairing.bodyDigest, fixture.certificate),
    ).rejects.toThrow(TelebirrDeviceStatePostgresUnavailableError);
  });

  it('loads the exact signed enrollment and releases both claim types through void RPCs', async () => {
    const load = queryWith(LOAD_TELEBIRR_DEVICE_ENROLLMENT_SQL, [
      { certificate: fixture.certificate },
    ]);
    await expect(
      new PostgresTelebirrDeviceStateDatabase(load).loadEnrollment(testIds.enrollment),
    ).resolves.toEqual(fixture.certificate);
    expect(load.query).toHaveBeenNthCalledWith(2, LOAD_TELEBIRR_DEVICE_ENROLLMENT_SQL, [
      testIds.enrollment,
    ]);

    const absent = new PostgresTelebirrDeviceStateDatabase(
      queryWith(LOAD_TELEBIRR_DEVICE_ENROLLMENT_SQL, [{ certificate: null }]),
    );
    await expect(absent.loadEnrollment(testIds.enrollment)).resolves.toBeUndefined();

    const pairingRelease = queryWith(RELEASE_TELEBIRR_DEVICE_PAIRING_SQL, [{ released: null }]);
    await expect(
      new PostgresTelebirrDeviceStateDatabase(pairingRelease).releasePairingChallenge(
        fixture.pairing.bodyDigest,
      ),
    ).resolves.toBeUndefined();

    const replayRelease = queryWith(RELEASE_TELEBIRR_DEVICE_REPLAY_SQL, [{ released: null }]);
    await expect(
      new PostgresTelebirrDeviceStateDatabase(replayRelease).releaseReplay(replayIdentity),
    ).resolves.toBeUndefined();
  });

  it('maps replay claims and hardens the cached command-response boundary', async () => {
    for (const [claim_state, response, expected] of [
      ['claimed', null, { kind: 'claimed' }],
      ['in_progress', null, { kind: 'in_progress' }],
      ['completed', fixture.response, { kind: 'completed', response: fixture.response }],
    ] as const) {
      const query = queryWith(CLAIM_TELEBIRR_DEVICE_REPLAY_SQL, [{ claim_state, response }]);
      const database = new PostgresTelebirrDeviceStateDatabase(query);
      await expect(
        database.claimReplay(replayIdentity, '2026-09-04T10:03:00.000Z'),
      ).resolves.toEqual(expected);
      expect(query.query).toHaveBeenNthCalledWith(2, CLAIM_TELEBIRR_DEVICE_REPLAY_SQL, [
        replayIdentity,
        '2026-09-04T10:03:00.000Z',
      ]);
    }

    const proxyResponse = new Proxy(fixture.response, {});
    const hostile = new PostgresTelebirrDeviceStateDatabase(
      queryWith(CLAIM_TELEBIRR_DEVICE_REPLAY_SQL, [
        { claim_state: 'completed', response: proxyResponse },
      ]),
    );
    await expect(hostile.claimReplay(replayIdentity, '2026-09-04T10:03:00.000Z')).rejects.toThrow(
      TelebirrDeviceStatePostgresUnavailableError,
    );

    let getterInvoked = false;
    const accessor = Object.defineProperty({ assignment: null }, 'acknowledgement', {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return fixture.response.acknowledgement;
      },
    });
    expect(decodeTelebirrDeviceStateCommandResponse(accessor)).toBeUndefined();
    expect(getterInvoked).toBe(false);
  });

  it('completes replay with exact booleans and rejects malformed completion rows', async () => {
    for (const completed of [true, false]) {
      const query = queryWith(COMPLETE_TELEBIRR_DEVICE_REPLAY_SQL, [{ completed }]);
      const database = new PostgresTelebirrDeviceStateDatabase(query);
      await expect(
        database.completeReplay(replayIdentity, fixture.response, '2026-09-04T10:03:00.000Z'),
      ).resolves.toBe(completed);
      expect(query.query).toHaveBeenNthCalledWith(2, COMPLETE_TELEBIRR_DEVICE_REPLAY_SQL, [
        replayIdentity,
        fixture.response,
        '2026-09-04T10:03:00.000Z',
      ]);
    }

    const malformed = new PostgresTelebirrDeviceStateDatabase(
      queryWith(COMPLETE_TELEBIRR_DEVICE_REPLAY_SQL, [{ completed: 0 }]),
    );
    await expect(
      malformed.completeReplay(replayIdentity, fixture.response, '2026-09-04T10:03:00.000Z'),
    ).rejects.toThrow(TelebirrDeviceStatePostgresUnavailableError);
  });

  it('records only an exact request-bound heartbeat and maps every bounded outcome', async () => {
    for (const [row, expected] of [
      [{ outcome: 'accepted', reason_code: null }, { kind: 'accepted' }],
      [{ outcome: 'retry', reason_code: null }, { kind: 'retry' }],
      [
        { outcome: 'rejected', reason_code: 'device_revoked' },
        { kind: 'rejected', reason: 'device_revoked' },
      ],
      [
        { outcome: 'rejected', reason_code: 'pilot_stopped' },
        { kind: 'rejected', reason: 'pilot_stopped' },
      ],
    ] as const) {
      const query = queryWith(RECORD_TELEBIRR_DEVICE_HEARTBEAT_SQL, [row]);
      const database = new PostgresTelebirrDeviceStateDatabase(query);
      await expect(
        database.recordHeartbeat(
          fixture.enrollmentBody,
          fixture.heartbeatRequest,
          fixture.heartbeatPayload,
        ),
      ).resolves.toEqual(expected);
      expect(query.query).toHaveBeenNthCalledWith(2, RECORD_TELEBIRR_DEVICE_HEARTBEAT_SQL, [
        testIds.enrollment,
        fixture.heartbeatRequest.bodyDigest,
        fixture.heartbeatPayload.runtimeState,
        fixture.heartbeatPayload.statusCode,
        fixture.heartbeatPayload.appVersion,
        fixture.heartbeatRequest.body.issuedAt,
      ]);
    }

    const query: TelebirrDeviceStatePostgresQuery = { query: vi.fn() };
    await expect(
      new PostgresTelebirrDeviceStateDatabase(query).recordHeartbeat(
        fixture.enrollmentBody,
        fixture.heartbeatRequest,
        { ...fixture.heartbeatPayload, statusCode: 'altered_status' },
      ),
    ).rejects.toThrow(TelebirrDeviceStatePostgresUnavailableError);
    expect(query.query).not.toHaveBeenCalled();
  });

  it('stages only signed, request-bound evidence and maps accepted, retry, and rejection', async () => {
    for (const [row, expected] of [
      [
        { outcome: 'accepted', reason_code: null, replayed: false },
        { kind: 'accepted', replayed: false },
      ],
      [
        { outcome: 'accepted', reason_code: null, replayed: true },
        { kind: 'accepted', replayed: true },
      ],
      [{ outcome: 'retry', reason_code: null, replayed: false }, { kind: 'retry' }],
      [
        { outcome: 'rejected', reason_code: 'binding_mismatch', replayed: false },
        { kind: 'rejected', reason: 'binding_mismatch' },
      ],
      [
        { outcome: 'rejected', reason_code: 'observation_rejected', replayed: false },
        { kind: 'rejected', reason: 'observation_rejected' },
      ],
    ] as const) {
      const query = queryWith(STAGE_TELEBIRR_DEVICE_EVIDENCE_SQL, [row]);
      const database = new PostgresTelebirrDeviceStateDatabase(query);
      await expect(
        database.stageEvidenceOnly(
          fixture.enrollmentBody,
          fixture.evidenceRequest,
          fixture.evidencePayload,
        ),
      ).resolves.toEqual(expected);
      expect(query.query).toHaveBeenNthCalledWith(2, STAGE_TELEBIRR_DEVICE_EVIDENCE_SQL, [
        testIds.enrollment,
        fixture.evidenceRequest.bodyDigest,
        fixture.evidencePayload.signedAssignment.bodyDigest,
        fixture.evidencePayload.signedObservation.bodyDigest,
        fixture.evidencePayload.signedAssignment,
        fixture.evidencePayload.signedObservation,
      ]);
    }

    const query: TelebirrDeviceStatePostgresQuery = { query: vi.fn() };
    const altered = {
      ...fixture.evidencePayload,
      signedObservation: {
        ...fixture.evidencePayload.signedObservation,
        bodyDigest: 'sha256:' + '0'.repeat(64),
      },
    };
    await expect(
      new PostgresTelebirrDeviceStateDatabase(query).stageEvidenceOnly(
        fixture.enrollmentBody,
        fixture.evidenceRequest,
        altered,
      ),
    ).rejects.toThrow(TelebirrDeviceStatePostgresUnavailableError);
    expect(query.query).not.toHaveBeenCalled();
  });

  it('acquires one direct TLS connection, rechecks readiness, and releases cleanly', async () => {
    const listeners = new Map<string, (error?: Error) => void>();
    const client: TelebirrDeviceStatePostgresClient = {
      connect: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      on: vi.fn((event, listener) => void listeners.set(event, listener)),
      removeListener: vi.fn((event) => void listeners.delete(event)),
      query: vi.fn(async (query: string) => {
        if (query === TELEBIRR_DEVICE_STATE_SINGLETON_ACQUIRE_SQL) {
          return { rows: [{ singleton_acquired: true }] };
        }
        if (query === TELEBIRR_DEVICE_STATE_CATALOG_PREFLIGHT_SQL) {
          return { rows: [preflightRow()] };
        }
        if (query === TELEBIRR_DEVICE_STATE_SINGLETON_HELD_SQL) {
          return { rows: [{ singleton_held: true }] };
        }
        if (query === TELEBIRR_DEVICE_STATE_SINGLETON_RELEASE_SQL) {
          return { rows: [{ singleton_released: true }] };
        }
        throw new Error('unexpected query');
      }),
    };
    const createClient = vi.fn(() => client);
    const runtime = await createTelebirrDeviceStatePostgresRuntime(
      {
        ca: 'synthetic-ca',
        database: 'postgres',
        host: 'db.example.test',
        password: 'synthetic-password-value',
        port: 5432,
        user: 'fetanagent_telebirr_device_state_runtime',
      },
      { createClient },
    );
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        application_name: 'fetanagent_telebirr_device_state',
        connectionTimeoutMillis: 5_000,
        statement_timeout: 15_000,
        query_timeout: 20_000,
        ssl: { ca: 'synthetic-ca', rejectUnauthorized: true },
      }),
    );
    await expect(runtime.ready()).resolves.toBe(true);
    await expect(runtime.close()).resolves.toBeUndefined();
    expect(client.end).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it('fails startup closed for an owned singleton or malformed lock row', async () => {
    for (const row of [{ singleton_acquired: false }, { singleton_acquired: 'true' }]) {
      const client: TelebirrDeviceStatePostgresClient = {
        connect: vi.fn(async () => undefined),
        end: vi.fn(async () => undefined),
        on: vi.fn(),
        removeListener: vi.fn(),
        query: vi.fn(async () => ({ rows: [row] })),
      };
      await expect(
        createTelebirrDeviceStatePostgresRuntime(
          {
            ca: 'synthetic-ca',
            database: 'postgres',
            host: 'db.example.test',
            password: 'synthetic-password-value',
            port: 5432,
            user: 'fetanagent_telebirr_device_state_runtime',
          },
          { createClient: () => client },
        ),
      ).rejects.toThrow(TelebirrDeviceStatePostgresUnavailableError);
      expect(client.end).toHaveBeenCalledOnce();
    }
  });

  it('marks the runtime unavailable when readiness detects catalog drift', async () => {
    let preflightCount = 0;
    const client: TelebirrDeviceStatePostgresClient = {
      connect: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      on: vi.fn(),
      removeListener: vi.fn(),
      query: vi.fn(async (query: string) => {
        if (query === TELEBIRR_DEVICE_STATE_SINGLETON_ACQUIRE_SQL) {
          return { rows: [{ singleton_acquired: true }] };
        }
        if (query === TELEBIRR_DEVICE_STATE_SINGLETON_HELD_SQL) {
          return { rows: [{ singleton_held: true }] };
        }
        if (query === TELEBIRR_DEVICE_STATE_CATALOG_PREFLIGHT_SQL) {
          preflightCount += 1;
          return {
            rows: [
              preflightRow(
                preflightCount === 1 ? {} : { exact_reachable_function_surface_allowed: false },
              ),
            ],
          };
        }
        throw new Error('unexpected query');
      }),
    };
    const runtime = await createTelebirrDeviceStatePostgresRuntime(
      {
        ca: 'synthetic-ca',
        database: 'postgres',
        host: 'db.example.test',
        password: 'synthetic-password-value',
        port: 5432,
        user: 'fetanagent_telebirr_device_state_runtime',
      },
      { createClient: () => client },
    );
    await expect(runtime.ready()).resolves.toBe(false);
    await expect(
      runtime.database.claimReplay(replayIdentity, '2026-09-04T10:03:00.000Z'),
    ).rejects.toThrow(TelebirrDeviceStatePostgresUnavailableError);
    await expect(runtime.close()).resolves.toBeUndefined();
  });
});
