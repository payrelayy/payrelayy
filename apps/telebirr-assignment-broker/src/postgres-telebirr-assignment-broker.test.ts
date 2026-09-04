import { describe, expect, it, vi } from 'vitest';

import {
  LEASE_TELEBIRR_ASSIGNMENT_SQL,
  PERSIST_TELEBIRR_ASSIGNMENT_SIGNATURE_SQL,
  TELEBIRR_ASSIGNMENT_BROKER_CATALOG_PREFLIGHT_SQL,
  TELEBIRR_ASSIGNMENT_BROKER_PREFLIGHT_KEYS,
  TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_ACQUIRE_SQL,
  TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_HELD_SQL,
  TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_KEYS,
  TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_RELEASE_SQL,
  PostgresTelebirrAssignmentBrokerDatabase,
  TelebirrAssignmentBrokerPostgresUnavailableError,
  assertTelebirrAssignmentBrokerCatalogPreflight,
  createTelebirrAssignmentBrokerPostgresRuntime,
  type TelebirrAssignmentBrokerPostgresClient,
  type TelebirrAssignmentBrokerPostgresQuery,
} from './postgres-telebirr-assignment-broker.js';

const ids = {
  enrollment: '11111111-1111-4111-8111-111111111111',
  leaseRequest: '22222222-2222-4222-8222-222222222222',
  attempt: '33333333-3333-4333-8333-333333333333',
  lease: '44444444-4444-4444-8444-444444444444',
  job: '55555555-5555-4555-8555-555555555555',
  request: '66666666-6666-4666-8666-666666666666',
  assignment: '77777777-7777-4777-8777-777777777777',
  challenge: '88888888-8888-4888-8888-888888888888',
  pilot: '99999999-9999-4999-8999-999999999999',
  receiver: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  profile: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  signer: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
} as const;
const sha = (character: string) => `sha256:${character.repeat(64)}`;

function preflightRow(overrides: Readonly<Record<string, boolean>> = {}) {
  return Object.fromEntries(
    TELEBIRR_ASSIGNMENT_BROKER_PREFLIGHT_KEYS.map((key) => [key, overrides[key] ?? true]),
  );
}

function leaseRow() {
  return {
    verification_attempt_id: ids.attempt,
    lease_token: ids.lease,
    job_id: ids.job,
    attempt_number: 1,
    request_id: ids.request,
    assignment_id: ids.assignment,
    lease_nonce_digest: sha('1'),
    challenge_id: ids.challenge,
    challenge_digest: sha('2'),
    issued_at: new Date('2026-09-04T00:01:00.000Z'),
    expires_at: new Date('2026-09-04T00:03:00.000Z'),
    pilot_revision_id: ids.pilot,
    device_enrollment_id: ids.enrollment,
    device_id: 'android_device_0001',
    device_key_id: 'android_key_0001',
    device_public_key_spki_sha256: sha('3'),
    receiver_revision_id: ids.receiver,
    receiver_profile_id: ids.profile,
    receiver_profile_digest: sha('4'),
    receiver_configuration_digest: sha('5'),
    expected_receiver_name_digest: sha('6'),
    receiver_name_normalizer_version: 'telebirr-credited-party-name-normalizer-v1',
    source_profile: 'telebirr_official_receipt_v1',
    adapter_version: 'telebirr-live-private-pilot-adapter-v1',
    parser_version: 'telebirr-official-receipt-live-pilot-parser-v1',
    facts_normalizer_version: 'telebirr-live-private-pilot-facts-normalizer-v1',
    candidate_reference_ciphertext: `v2.telebirr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(11)}`,
    candidate_reference_fingerprint: '7'.repeat(64),
    reference_encryption_key_version: 2,
    reference_profile_version: 2,
    replayed: false,
  };
}

function queryWith(operationSql: string, operationRows: readonly unknown[]) {
  return {
    query: vi.fn(async (query: string) => {
      if (query === TELEBIRR_ASSIGNMENT_BROKER_CATALOG_PREFLIGHT_SQL) {
        return { rows: [preflightRow()] };
      }
      if (query === operationSql) return { rows: operationRows };
      throw new Error('unexpected query');
    }),
  } satisfies TelebirrAssignmentBrokerPostgresQuery;
}

describe('TeleBirr assignment broker PostgreSQL adapter', () => {
  it('uses stable protocol singleton namespaces rather than a calendar-shaped key', () => {
    expect(TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_KEYS).toEqual([0x46455441, 0x54425252]);
  });

  it('requires every catalog preflight fact to be exactly true', async () => {
    const database: TelebirrAssignmentBrokerPostgresQuery = {
      query: vi.fn(async () => ({ rows: [preflightRow()] })),
    };
    await expect(assertTelebirrAssignmentBrokerCatalogPreflight(database)).resolves.toBeUndefined();

    const unsafe: TelebirrAssignmentBrokerPostgresQuery = {
      query: vi.fn(async () => ({ rows: [preflightRow({ runtime_login_is_safe: false })] })),
    };
    await expect(assertTelebirrAssignmentBrokerCatalogPreflight(unsafe)).rejects.toThrow(
      TelebirrAssignmentBrokerPostgresUnavailableError,
    );
  });

  it('allows only bounded PostgreSQL creator-admin memberships beside the runtime edge', () => {
    expect(TELEBIRR_ASSIGNMENT_BROKER_PREFLIGHT_KEYS).toContain('runtime_only_trusted_members');
    expect(TELEBIRR_ASSIGNMENT_BROKER_PREFLIGHT_KEYS).not.toContain('runtime_has_no_members');
    expect(TELEBIRR_ASSIGNMENT_BROKER_CATALOG_PREFLIGHT_SQL).toContain(
      "member.rolname = 'postgres'",
    );
    expect(TELEBIRR_ASSIGNMENT_BROKER_CATALOG_PREFLIGHT_SQL).toContain(
      'not membership.inherit_option\n        and not membership.set_option\n        and membership.admin_option',
    );
    expect(TELEBIRR_ASSIGNMENT_BROKER_CATALOG_PREFLIGHT_SQL).toContain(
      "count(*) filter (where member.rolname = 'postgres') <= 1",
    );
    expect(TELEBIRR_ASSIGNMENT_BROKER_CATALOG_PREFLIGHT_SQL).toContain(
      'defaults.defaclnamespace = 0',
    );
    expect(TELEBIRR_ASSIGNMENT_BROKER_CATALOG_PREFLIGHT_SQL).not.toContain(
      'namespace.oid = defaults.defaclnamespace',
    );
  });

  it('maps the exact lease projection and converts PostgreSQL timestamps canonically', async () => {
    const query = queryWith(LEASE_TELEBIRR_ASSIGNMENT_SQL, [leaseRow()]);
    const database = new PostgresTelebirrAssignmentBrokerDatabase(query);
    const result = await database.leaseAssignment({
      deviceEnrollmentId: ids.enrollment,
      leasedBy: 'telebirr-bridge:device-0001',
      leaseRequestKey: ids.leaseRequest,
      requestedLeaseSeconds: 120,
    });
    expect(result).toMatchObject({
      verificationAttemptId: ids.attempt,
      leaseToken: ids.lease,
      jobId: ids.job,
      issuedAt: '2026-09-04T00:01:00.000Z',
      expiresAt: '2026-09-04T00:03:00.000Z',
      deviceEnrollmentId: ids.enrollment,
      referenceEncryptionKeyVersion: 2,
      referenceProfileVersion: 2,
    });
    expect(query.query).toHaveBeenNthCalledWith(2, LEASE_TELEBIRR_ASSIGNMENT_SQL, [
      ids.enrollment,
      'telebirr-bridge:device-0001',
      ids.leaseRequest,
      120,
    ]);
  });

  it('returns null for an empty lease and rejects extra or accessor row fields', async () => {
    const empty = new PostgresTelebirrAssignmentBrokerDatabase(
      queryWith(LEASE_TELEBIRR_ASSIGNMENT_SQL, []),
    );
    await expect(
      empty.leaseAssignment({
        deviceEnrollmentId: ids.enrollment,
        leasedBy: 'telebirr-bridge:device-0001',
        leaseRequestKey: ids.leaseRequest,
        requestedLeaseSeconds: 120,
      }),
    ).resolves.toBeNull();

    const hostile = leaseRow() as Record<string, unknown>;
    Object.defineProperty(hostile, 'issued_at', {
      enumerable: true,
      get: () => new Date('2026-09-04T00:01:00.000Z'),
    });
    const rejected = new PostgresTelebirrAssignmentBrokerDatabase(
      queryWith(LEASE_TELEBIRR_ASSIGNMENT_SQL, [hostile]),
    );
    await expect(
      rejected.leaseAssignment({
        deviceEnrollmentId: ids.enrollment,
        leasedBy: 'telebirr-bridge:device-0001',
        leaseRequestKey: ids.leaseRequest,
        requestedLeaseSeconds: 120,
      }),
    ).rejects.toThrow(TelebirrAssignmentBrokerPostgresUnavailableError);
  });

  it('maps only the exact persisted signature replay row', async () => {
    const encoded = Buffer.alloc(64, 0x11).toString('base64url');
    const row = {
      assignment_signature: encoded,
      assignment_signature_digest: sha('8'),
      signed_at: new Date('2026-09-04T00:01:30.000Z'),
      replayed: true,
    };
    const query = queryWith(PERSIST_TELEBIRR_ASSIGNMENT_SIGNATURE_SQL, [row]);
    const database = new PostgresTelebirrAssignmentBrokerDatabase(query);
    await expect(
      database.persistAssignmentSignature({
        verificationAttemptId: ids.attempt,
        leaseToken: ids.lease,
        assignmentSignerId: ids.signer,
        assignmentBodyDigest: sha('9'),
        proposedAssignmentSignature: encoded,
        proposedAssignmentSignatureDigest: sha('8'),
        referenceBindingDigest: sha('a'),
      }),
    ).resolves.toEqual({
      assignmentSignature: encoded,
      assignmentSignatureDigest: sha('8'),
      replayed: true,
    });
  });

  it('acquires one direct singleton connection, rechecks readiness, and releases cleanly', async () => {
    const listeners = new Map<string, (error?: Error) => void>();
    const client: TelebirrAssignmentBrokerPostgresClient = {
      connect: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      on: vi.fn((event, listener) => void listeners.set(event, listener)),
      removeListener: vi.fn((event) => void listeners.delete(event)),
      query: vi.fn(async (query: string) => {
        if (query === TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_ACQUIRE_SQL) {
          return { rows: [{ singleton_acquired: true }] };
        }
        if (query === TELEBIRR_ASSIGNMENT_BROKER_CATALOG_PREFLIGHT_SQL) {
          return { rows: [preflightRow()] };
        }
        if (query === TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_HELD_SQL) {
          return { rows: [{ singleton_held: true }] };
        }
        if (query === TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_RELEASE_SQL) {
          return { rows: [{ singleton_released: true }] };
        }
        throw new Error('unexpected query');
      }),
    };
    const createClient = vi.fn(() => client);
    const runtime = await createTelebirrAssignmentBrokerPostgresRuntime(
      {
        ca: 'synthetic-ca',
        database: 'postgres',
        host: 'db.example.test',
        password: 'synthetic-password-value',
        port: 5432,
        user: 'fetanagent_telebirr_assignment_broker_runtime',
      },
      { createClient },
    );
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        application_name: 'fetanagent_telebirr_assignment_broker',
        ssl: { ca: 'synthetic-ca', rejectUnauthorized: true },
      }),
    );
    await expect(runtime.ready()).resolves.toBe(true);
    await expect(runtime.close()).resolves.toBeUndefined();
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('fails startup closed when the singleton lock is already owned', async () => {
    const client: TelebirrAssignmentBrokerPostgresClient = {
      connect: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      on: vi.fn(),
      removeListener: vi.fn(),
      query: vi.fn(async () => ({ rows: [{ singleton_acquired: false }] })),
    };
    await expect(
      createTelebirrAssignmentBrokerPostgresRuntime(
        {
          ca: 'synthetic-ca',
          database: 'postgres',
          host: 'db.example.test',
          password: 'synthetic-password-value',
          port: 5432,
          user: 'fetanagent_telebirr_assignment_broker_runtime',
        },
        { createClient: () => client },
      ),
    ).rejects.toThrow(TelebirrAssignmentBrokerPostgresUnavailableError);
    expect(client.end).toHaveBeenCalledOnce();
  });
});
