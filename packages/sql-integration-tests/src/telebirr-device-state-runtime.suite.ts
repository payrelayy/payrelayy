import { createHash, randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  createLiveProof,
  prepareTelebirrPilot,
  stageProof,
  type TelebirrPilot,
} from './private-live-telebirr-proof-lineage.suite.js';

const deviceStateGroup = 'fetanagent_telebirr_device_state';
const deviceStateRuntime = 'fetanagent_telebirr_device_state_runtime';
const issueFunction =
  'app.issue_private_telebirr_device_pairing(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamp with time zone)';
const ownerIssueFunction = 'app.issue_current_private_telebirr_device_pairing(uuid,uuid,text,text)';
const deviceFunctions = [
  'app.claim_private_telebirr_device_pairing(uuid,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone)',
  'app.claim_private_telebirr_device_replay(text,timestamp with time zone)',
  'app.complete_private_telebirr_device_pairing(text,text,text,text,jsonb)',
  'app.complete_private_telebirr_device_replay(text,jsonb,timestamp with time zone)',
  'app.load_private_telebirr_device_enrollment(uuid)',
  'app.record_private_telebirr_device_heartbeat(uuid,text,text,text,text,timestamp with time zone)',
  'app.release_private_telebirr_device_pairing(text)',
  'app.release_private_telebirr_device_replay(text)',
  'app.stage_private_telebirr_device_evidence(uuid,text,text,text,jsonb,jsonb)',
] as const;

const deviceTables = [
  'private_live_telebirr_device_command_replays',
  'private_live_telebirr_device_enrollment_certificates',
  'private_live_telebirr_device_evidence_staging',
  'private_live_telebirr_device_heartbeats',
  'private_live_telebirr_device_pairing_challenges',
] as const;

type ClaimRow = {
  readonly certificate_body: Record<string, unknown> | null;
  readonly claim_state: 'claimed' | 'completed' | 'in_progress';
  readonly signed_certificate: Record<string, unknown> | null;
};

type IssuedRow = {
  readonly expires_at: Date;
  readonly pairing_id: string;
  readonly pairing_nonce_digest: string;
  readonly replayed: boolean;
};

type LeaseRow = {
  readonly assignment_id: string;
  readonly candidate_reference_fingerprint: string;
  readonly challenge_digest: string;
  readonly challenge_id: string;
  readonly device_id: string;
  readonly device_key_id: string;
  readonly expires_at: Date;
  readonly job_id: string;
  readonly lease_nonce_digest: string;
  readonly lease_token: string;
  readonly pilot_revision_id: string;
  readonly receiver_configuration_digest: string;
  readonly receiver_profile_digest: string;
  readonly receiver_profile_id: string;
  readonly receiver_revision_id: string;
  readonly request_id: string;
  readonly verification_attempt_id: string;
};

type PairedDevice = {
  readonly certificate: Record<string, unknown>;
  readonly certificateBody: Record<string, unknown>;
  readonly deviceId: string;
  readonly enrollmentId: string;
  readonly keyId: string;
  readonly pairingBodyDigest: string;
  readonly pairingId: string;
};

function sha(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function signature(byte: number): { readonly digest: string; readonly encoded: string } {
  const bytes = Buffer.alloc(64, byte);
  try {
    return {
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      encoded: bytes.toString('base64url'),
    };
  } finally {
    bytes.fill(0);
  }
}

async function withRollback(client: Client, body: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await body();
  } finally {
    await client.query('rollback');
  }
}

async function issuePairing(
  client: Client,
  ownerAdminId: string,
  pilot: TelebirrPilot,
): Promise<{
  readonly issueRequestKey: string;
  readonly pairingId: string;
  readonly pairingNonceDigest: string;
}> {
  const issueRequestKey = randomUUID();
  const pairingId = randomUUID();
  const pairingNonceDigest = sha(`pairing-nonce:${pairingId}`);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1_000);
  const issued = await client.query<IssuedRow>(
    `select *
       from app.issue_private_telebirr_device_pairing(
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
         $7::text, $8::text, $9::timestamptz
       )`,
    [
      ownerAdminId,
      issueRequestKey,
      pairingId,
      pilot.pilotRevisionId,
      pilot.receiverProfileId,
      pilot.assignmentSignerId,
      pairingNonceDigest,
      '0.3.0-device-bridge-inert',
      expiresAt,
    ],
  );
  expect(issued.rows).toHaveLength(1);
  expect(issued.rows[0]).toMatchObject({
    pairing_id: pairingId,
    pairing_nonce_digest: pairingNonceDigest,
    replayed: false,
  });

  const replay = await client.query<IssuedRow>(
    `select *
       from app.issue_private_telebirr_device_pairing(
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
         $7::text, $8::text, $9::timestamptz
       )`,
    [
      ownerAdminId,
      issueRequestKey,
      pairingId,
      pilot.pilotRevisionId,
      pilot.receiverProfileId,
      pilot.assignmentSignerId,
      pairingNonceDigest,
      '0.3.0-device-bridge-inert',
      expiresAt,
    ],
  );
  expect(replay.rows).toHaveLength(1);
  expect(replay.rows[0]).toMatchObject({ pairing_id: pairingId, replayed: true });
  return { issueRequestKey, pairingId, pairingNonceDigest };
}

async function pairDevice(
  client: Client,
  ownerAdminId: string,
  pilot: TelebirrPilot,
): Promise<PairedDevice> {
  const pairing = await issuePairing(client, ownerAdminId, pilot);
  const deviceId = `sql-device-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const keyId = `sql-device-key-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const publicKey = Buffer.alloc(91, 0x41);
  const publicKeySpki = publicKey.toString('base64url');
  const publicKeyDigest = sha(publicKey);
  publicKey.fill(0);
  const pairingBodyDigest = sha(`pairing-body:${pairing.pairingId}`);
  const requestIssuedAt = new Date(Date.now() - 1_000);
  const requestExpiresAt = new Date(Date.now() + 90_000);
  const claimValues = [
    pairing.pairingId,
    pairing.pairingNonceDigest,
    pairingBodyDigest,
    deviceId,
    keyId,
    publicKeySpki,
    publicKeyDigest,
    '0.3.0-device-bridge-inert',
    requestIssuedAt,
    requestExpiresAt,
  ] as const;
  const claimSql = `select *
    from app.claim_private_telebirr_device_pairing(
      $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
      $7::text, $8::text, $9::timestamptz, $10::timestamptz
    )`;

  const mismatchedKeyDigest = await client.query<ClaimRow>(claimSql, [
    pairing.pairingId,
    pairing.pairingNonceDigest,
    pairingBodyDigest,
    deviceId,
    keyId,
    publicKeySpki,
    sha(`wrong-public-key:${pairing.pairingId}`),
    '0.3.0-device-bridge-inert',
    requestIssuedAt,
    requestExpiresAt,
  ]);
  expect(mismatchedKeyDigest.rows).toHaveLength(0);

  const first = await client.query<ClaimRow>(claimSql, [...claimValues]);
  expect(first.rows).toHaveLength(1);
  expect(first.rows[0]!.claim_state).toBe('claimed');
  const certificateBody = first.rows[0]!.certificate_body!;
  expect(certificateBody).toMatchObject({
    pairingId: pairing.pairingId,
    pairingRequestBodyDigest: pairingBodyDigest,
    deviceId,
    keyId,
    pilotRevisionId: pilot.pilotRevisionId,
    receiverRevisionId: pilot.receiverAccountId,
    receiverProfileId: pilot.receiverProfileId,
    evidenceOnly: true,
    databaseAccessAllowed: false,
    settlementAllowed: false,
    executionAllowed: false,
    moneyMovementAllowed: false,
  });

  const concurrent = await client.query<ClaimRow>(claimSql, [...claimValues]);
  expect(concurrent.rows).toEqual([
    { claim_state: 'in_progress', certificate_body: null, signed_certificate: null },
  ]);
  await client.query(`select app.release_private_telebirr_device_pairing($1::text)`, [
    pairingBodyDigest,
  ]);

  const differentRequest = await client.query<ClaimRow>(claimSql, [
    pairing.pairingId,
    pairing.pairingNonceDigest,
    sha(`different-pairing-body:${pairing.pairingId}`),
    deviceId,
    keyId,
    publicKeySpki,
    publicKeyDigest,
    '0.3.0-device-bridge-inert',
    requestIssuedAt,
    requestExpiresAt,
  ]);
  expect(differentRequest.rows).toHaveLength(0);

  const reclaimed = await client.query<ClaimRow>(claimSql, [...claimValues]);
  expect(reclaimed.rows).toHaveLength(1);
  expect(reclaimed.rows[0]).toMatchObject({
    claim_state: 'claimed',
    certificate_body: certificateBody,
  });

  const certificateSignature = signature(0x31).encoded;
  const certificateBodyDigest = sha(JSON.stringify(certificateBody));
  const certificate = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'device_bridge_no_money_v1',
    transcriptVersion: 'telebirr-device-bridge-certificate-transcript-v1',
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: certificateBodyDigest,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    signerKeyId: 'sql-bridge-server-key-0001',
    body: certificateBody,
    signature: certificateSignature,
  };
  const completed = await client.query<{ readonly completed: boolean }>(
    `select app.complete_private_telebirr_device_pairing(
       $1::text, $2::text, $3::text, $4::text, $5::jsonb
     ) as completed`,
    [
      pairingBodyDigest,
      certificateBodyDigest,
      certificate.signerKeyId,
      certificateSignature,
      certificate,
    ],
  );
  expect(completed.rows).toEqual([{ completed: true }]);

  const lostResponseRetry = await client.query<ClaimRow>(claimSql, [...claimValues]);
  expect(lostResponseRetry.rows).toEqual([
    {
      claim_state: 'completed',
      certificate_body: certificateBody,
      signed_certificate: certificate,
    },
  ]);
  const enrollmentId = String(certificateBody.enrollmentId);
  const loaded = await client.query<{ readonly certificate: Record<string, unknown> }>(
    `select app.load_private_telebirr_device_enrollment($1::uuid) as certificate`,
    [enrollmentId],
  );
  expect(loaded.rows).toEqual([{ certificate }]);

  return {
    certificate,
    certificateBody,
    deviceId,
    enrollmentId,
    keyId,
    pairingBodyDigest,
    pairingId: pairing.pairingId,
  };
}

export function registerTelebirrDeviceStateRuntimeSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('private TeleBirr device-state database boundary', () => {
    it('accepts an Android runtime flavor at the same suffix-free numeric version floor', async () => {
      const client = getClient();
      const versions = await client.query<{
        readonly different_flavor_rejected: boolean;
        readonly exact_flavor_accepted: boolean;
        readonly flavor_at_numeric_floor_accepted: boolean;
        readonly malformed_rejected: boolean;
        readonly newer_numeric_version_accepted: boolean;
        readonly older_numeric_version_rejected: boolean;
        readonly stable_at_flavor_floor_rejected: boolean;
      }>(`
        select
          app.private_telebirr_device_app_version_at_least(
            '0.5.0-secure-pairing', '0.5.0'
          ) as flavor_at_numeric_floor_accepted,
          app.private_telebirr_device_app_version_at_least(
            '0.5.0-secure-pairing', '0.5.0-secure-pairing'
          ) as exact_flavor_accepted,
          not app.private_telebirr_device_app_version_at_least(
            '0.5.0-evidence-only', '0.5.0-secure-pairing'
          ) as different_flavor_rejected,
          not app.private_telebirr_device_app_version_at_least(
            '0.5.0', '0.5.0-secure-pairing'
          ) as stable_at_flavor_floor_rejected,
          app.private_telebirr_device_app_version_at_least(
            '0.5.1-secure-pairing', '0.5.0-secure-pairing'
          ) as newer_numeric_version_accepted,
          not app.private_telebirr_device_app_version_at_least(
            '0.4.9-secure-pairing', '0.5.0'
          ) as older_numeric_version_rejected,
          not app.private_telebirr_device_app_version_at_least(
            'not-a-version', '0.5.0'
          ) as malformed_rejected
      `);
      expect(versions.rows).toEqual([
        {
          different_flavor_rejected: true,
          exact_flavor_accepted: true,
          flavor_at_numeric_floor_accepted: true,
          malformed_rejected: true,
          newer_numeric_version_accepted: true,
          older_numeric_version_rejected: true,
          stable_at_flavor_floor_rejected: true,
        },
      ]);
    });

    it('creates a dormant non-settable role edge with only nine device-state routines', async () => {
      const client = getClient();
      const roles = await client.query<{
        readonly rolbypassrls: boolean;
        readonly rolcanlogin: boolean;
        readonly rolconnlimit: number;
        readonly rolcreatedb: boolean;
        readonly rolcreaterole: boolean;
        readonly rolinherit: boolean;
        readonly rolname: string;
        readonly rolreplication: boolean;
        readonly rolsuper: boolean;
      }>(`
        select rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
               rolreplication, rolbypassrls, rolconnlimit
          from pg_roles
         where rolname in ('${deviceStateGroup}', '${deviceStateRuntime}')
         order by rolname
      `);
      expect(roles.rows).toEqual([
        {
          rolname: deviceStateGroup,
          rolcanlogin: false,
          rolinherit: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          rolconnlimit: 2,
        },
        {
          rolname: deviceStateRuntime,
          rolcanlogin: false,
          rolinherit: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          rolconnlimit: 1,
        },
      ]);

      const memberships = await client.query<{
        readonly admin_option: boolean;
        readonly group_role: string;
        readonly inherit_option: boolean;
        readonly member_role: string;
        readonly set_option: boolean;
      }>(`
        select granted.rolname as group_role, member.rolname as member_role,
               membership.inherit_option, membership.set_option, membership.admin_option
          from pg_auth_members membership
          join pg_roles granted on granted.oid = membership.roleid
          join pg_roles member on member.oid = membership.member
         where granted.rolname in ('${deviceStateGroup}', '${deviceStateRuntime}')
            or member.rolname in ('${deviceStateGroup}', '${deviceStateRuntime}')
      `);
      expect(memberships.rows).toEqual([
        {
          group_role: deviceStateGroup,
          member_role: deviceStateRuntime,
          inherit_option: true,
          set_option: false,
          admin_option: false,
        },
      ]);

      const routines = await client.query<{
        readonly hardened: boolean;
        readonly signature: string;
      }>(`
        select routine.oid::regprocedure::text as signature,
               routine.prosecdef
                 and routine.proowner = 'postgres'::regrole
                 and routine.proconfig = array['search_path=pg_catalog']::text[] as hardened
          from pg_proc routine
          join pg_namespace namespace on namespace.oid = routine.pronamespace
         where namespace.nspname = 'app'
           and has_function_privilege('${deviceStateGroup}', routine.oid, 'EXECUTE')
         order by signature
      `);
      expect(routines.rows).toEqual(
        [...deviceFunctions].sort().map((signature) => ({ signature, hardened: true })),
      );
      expect(
        await client.query(`select has_function_privilege(
          '${deviceStateGroup}', '${issueFunction}', 'EXECUTE'
        ) as allowed`),
      ).toMatchObject({ rows: [{ allowed: false }] });
      expect(
        await client.query(`select has_function_privilege(
          'fetanagent_owner_control', '${issueFunction}', 'EXECUTE'
        ) as allowed`),
      ).toMatchObject({ rows: [{ allowed: false }] });
      expect(
        await client.query(`select has_function_privilege(
          'fetanagent_owner_control', '${ownerIssueFunction}', 'EXECUTE'
        ) as allowed`),
      ).toMatchObject({ rows: [{ allowed: true }] });
    });

    it('forces RLS, exposes no base storage, and stores no raw pairing nonce', async () => {
      const client = getClient();
      const rls = await client.query<{
        readonly relforcerowsecurity: boolean;
        readonly relname: string;
        readonly relrowsecurity: boolean;
      }>(
        `
        select relation.relname, relation.relrowsecurity, relation.relforcerowsecurity
          from pg_class relation
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'app'
           and relation.relname = any($1::text[])
         order by relation.relname
      `,
        [[...deviceTables]],
      );
      expect(rls.rows).toEqual(
        [...deviceTables].sort().map((relname) => ({
          relname,
          relrowsecurity: true,
          relforcerowsecurity: true,
        })),
      );

      const baseAccess = await client.query<{ readonly accessible: boolean }>(`
        select exists (
          select 1
            from pg_class relation
            join pg_namespace namespace on namespace.oid = relation.relnamespace
           where namespace.nspname = 'app'
             and relation.relkind in ('r','p','v','m','f')
             and has_table_privilege(
               '${deviceStateGroup}', relation.oid,
               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
             )
        ) as accessible
      `);
      expect(baseAccess.rows).toEqual([{ accessible: false }]);

      const pairingColumns = await client.query<{ readonly column_name: string }>(`
        select column_name
          from information_schema.columns
         where table_schema = 'app'
           and table_name = 'private_live_telebirr_device_pairing_challenges'
         order by ordinal_position
      `);
      expect(pairingColumns.rows.map((row) => row.column_name)).toContain('pairing_nonce_digest');
      expect(pairingColumns.rows.map((row) => row.column_name)).not.toContain('pairing_nonce');
      expect(
        pairingColumns.rows.some((row) => /raw.*nonce|nonce.*raw/iu.test(row.column_name)),
      ).toBe(false);

      const forbidden = await client.query<{ readonly executable: boolean }>(`
        select exists (
          select 1
            from unnest(array[
              'app.complete_private_live_telebirr_verification(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,bigint,timestamp with time zone,text)',
              'app.finalize_private_live_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)'
            ]::text[]) requested(signature)
           where has_function_privilege('${deviceStateGroup}', requested.signature, 'EXECUTE')
        ) as executable
      `);
      expect(forbidden.rows).toEqual([{ executable: false }]);
    });

    it('binds one pairing request and recovers the exact certificate after a lost response', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const pilot = await prepareTelebirrPilot(client, getOwnerAdminId());
        const paired = await pairDevice(client, getOwnerAdminId(), pilot);
        expect(paired.enrollmentId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        );

        const persisted = await client.query<{
          readonly certificate_count: string;
          readonly enrollment_count: string;
          readonly raw_nonce_columns: string;
        }>(
          `select
             (select count(*)::text
                from app.private_live_telebirr_device_enrollment_certificates
               where device_enrollment_id = $1::uuid) as certificate_count,
             (select count(*)::text
                from app.private_live_telebirr_device_enrollments
               where id = $1::uuid) as enrollment_count,
             (select count(*)::text
                from information_schema.columns
               where table_schema = 'app'
                 and table_name = 'private_live_telebirr_device_pairing_challenges'
                 and column_name = 'pairing_nonce') as raw_nonce_columns`,
          [paired.enrollmentId],
        );
        expect(persisted.rows).toEqual([
          { certificate_count: '1', enrollment_count: '1', raw_nonce_columns: '0' },
        ]);
      });
    });

    it('lets the Owner issue one current no-money package without choosing database authority', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const ownerAdminId = getOwnerAdminId();
        const pilot = await prepareTelebirrPilot(client, ownerAdminId);
        const signer = await client.query<{ readonly signer_key_id: string }>(
          `select signer_key_id
             from app.private_live_telebirr_assignment_signers
            where id = $1::uuid`,
          [pilot.assignmentSignerId],
        );
        expect(signer.rows).toHaveLength(1);

        const dormantSwitches = await client.query<{ readonly feature_key: string }>(
          `update app.feature_switches
              set mode = case
                    when feature_key = 'private_live_deposit_pilot'
                      then 'dry_run'::app.feature_mode
                    else 'disabled'::app.feature_mode
                  end,
                  settings = case
                    when feature_key = 'private_live_deposit_pilot'
                      then pg_catalog.jsonb_build_object(
                        'contract_version', 1,
                        'pilot_revision_id', $1::uuid,
                        'configuration_digest', $2::text
                      )
                    else '{}'::jsonb
                  end
            where feature_key in (
              'cbe_birr_authoritative_verification',
              'deposit_execution',
              'payment_verification',
              'private_live_deposit_pilot',
              'telebirr_authoritative_verification'
            )
          returning feature_key`,
          [pilot.pilotRevisionId, pilot.configurationDigest],
        );
        expect(dormantSwitches.rows).toHaveLength(5);

        const requestId = randomUUID();
        const startedAt = Date.now();
        const first = await client.query<IssuedRow>(
          `select *
             from app.issue_current_private_telebirr_device_pairing(
               $1::uuid, $2::uuid, $3::text, '0.5.0'::text
             )`,
          [ownerAdminId, requestId, signer.rows[0]!.signer_key_id],
        );
        expect(first.rows).toHaveLength(1);
        expect(first.rows[0]!.pairing_id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        );
        expect(first.rows[0]!.pairing_nonce_digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
        expect(first.rows[0]!.replayed).toBe(false);
        expect(first.rows[0]!.expires_at.getTime()).toBeGreaterThan(startedAt + 30_000);
        expect(first.rows[0]!.expires_at.getTime()).toBeLessThanOrEqual(startedAt + 601_000);

        const replay = await client.query<IssuedRow>(
          `select *
             from app.issue_current_private_telebirr_device_pairing(
               $1::uuid, $2::uuid, $3::text, '0.5.0'::text
             )`,
          [ownerAdminId, requestId, signer.rows[0]!.signer_key_id],
        );
        expect(replay.rows).toEqual([{ ...first.rows[0]!, replayed: true }]);

        const stored = await client.query<{ readonly count: string }>(
          `select pg_catalog.count(*)::text as count
             from app.private_live_telebirr_device_pairing_challenges
            where issue_request_key = $1::uuid`,
          [requestId],
        );
        expect(stored.rows).toEqual([{ count: '1' }]);

        await expect(
          client.query(
            `select *
               from app.issue_current_private_telebirr_device_pairing(
                 $1::uuid, $2::uuid, 'unknown_signer_key_0001'::text, '0.5.0'::text
               )`,
            [ownerAdminId, randomUUID()],
          ),
        ).rejects.toThrow(/assignment signer is not ready/iu);
      });
    });

    it('claims, releases, completes, and exactly replays bounded command responses', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const identity = sha(`replay:${randomUUID()}`);
        const expiresAt = new Date(Date.now() + 90_000);
        const first = await client.query(
          `select * from app.claim_private_telebirr_device_replay($1::text, $2::timestamptz)`,
          [identity, expiresAt],
        );
        expect(first.rows).toEqual([{ claim_state: 'claimed', response: null }]);
        const concurrent = await client.query(
          `select * from app.claim_private_telebirr_device_replay($1::text, $2::timestamptz)`,
          [identity, expiresAt],
        );
        expect(concurrent.rows).toEqual([{ claim_state: 'in_progress', response: null }]);

        const response = { acknowledgement: { outcome: 'no_assignment' }, assignment: null };
        const completed = await client.query<{ readonly completed: boolean }>(
          `select app.complete_private_telebirr_device_replay(
             $1::text, $2::jsonb, $3::timestamptz
           ) as completed`,
          [identity, response, expiresAt],
        );
        expect(completed.rows).toEqual([{ completed: true }]);
        const replay = await client.query(
          `select * from app.claim_private_telebirr_device_replay($1::text, $2::timestamptz)`,
          [identity, expiresAt],
        );
        expect(replay.rows).toEqual([{ claim_state: 'completed', response }]);

        const releasedIdentity = sha(`released-replay:${randomUUID()}`);
        await client.query(
          `select * from app.claim_private_telebirr_device_replay($1::text, $2::timestamptz)`,
          [releasedIdentity, expiresAt],
        );
        await client.query(`select app.release_private_telebirr_device_replay($1::text)`, [
          releasedIdentity,
        ]);
        const reclaimed = await client.query(
          `select * from app.claim_private_telebirr_device_replay($1::text, $2::timestamptz)`,
          [releasedIdentity, expiresAt],
        );
        expect(reclaimed.rows).toEqual([{ claim_state: 'claimed', response: null }]);
      });
    });

    it('records redacted heartbeat health and stages evidence without completing verification', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const pilot = await prepareTelebirrPilot(client, getOwnerAdminId());
        const paired = await pairDevice(client, getOwnerAdminId(), pilot);
        const heartbeat = await client.query(
          `select *
             from app.record_private_telebirr_device_heartbeat(
               $1::uuid, $2::text, 'ready', 'provider_ready',
               '0.3.0-device-bridge-inert', $3::timestamptz
             )`,
          [paired.enrollmentId, sha(`heartbeat:${randomUUID()}`), new Date()],
        );
        expect(heartbeat.rows).toEqual([{ outcome: 'accepted', reason_code: null }]);

        const proof = await createLiveProof(client, pilot);
        await stageProof(client, proof.id);
        const lease = await client.query<LeaseRow>(
          `select *
             from app.lease_private_live_telebirr_assignment_broker(
               $1::uuid, $2::text, $3::uuid, 120
             )`,
          [paired.enrollmentId, 'sql-telebirr-device-state-01', randomUUID()],
        );
        expect(lease.rows).toHaveLength(1);
        const assignment = lease.rows[0]!;
        const assignmentBodyDigest = sha(`assignment:${assignment.assignment_id}`);
        const referenceBindingDigest = sha(`reference:${assignment.assignment_id}`);
        const assignmentSignature = signature(0x42);
        const persisted = await client.query<{
          readonly assignment_signature: string;
        }>(
          `select *
             from app.persist_private_live_telebirr_assignment_broker_signature(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::text
             )`,
          [
            assignment.verification_attempt_id,
            assignment.lease_token,
            pilot.assignmentSignerId,
            assignmentBodyDigest,
            assignmentSignature.encoded,
            assignmentSignature.digest,
            referenceBindingDigest,
          ],
        );
        expect(persisted.rows).toHaveLength(1);
        const signer = await client.query<{ readonly signer_key_id: string }>(
          `select signer_key_id
             from app.private_live_telebirr_assignment_signers
            where id = $1::uuid`,
          [pilot.assignmentSignerId],
        );
        const binding = {
          assignmentId: assignment.assignment_id,
          requestId: assignment.request_id,
          jobId: assignment.job_id,
          attemptNumber: 1,
          pilotRevisionId: assignment.pilot_revision_id,
          deviceId: assignment.device_id,
          keyId: assignment.device_key_id,
          leaseNonceDigest: assignment.lease_nonce_digest,
          challengeId: assignment.challenge_id,
          challengeDigest: assignment.challenge_digest,
          referenceFingerprint: assignment.candidate_reference_fingerprint,
          referenceBindingDigest,
          receiverRevisionId: assignment.receiver_revision_id,
          receiverProfileId: assignment.receiver_profile_id,
          receiverProfileDigest: assignment.receiver_profile_digest,
          receiverConfigurationDigest: assignment.receiver_configuration_digest,
        };
        const signedAssignment = {
          bodyDigest: assignmentBodyDigest,
          signerKeyId: signer.rows[0]!.signer_key_id,
          signature: persisted.rows[0]!.assignment_signature,
          body: binding,
        };
        const observationBodyDigest = sha(`observation:${assignment.assignment_id}`);
        const signedObservation = {
          bodyDigest: observationBodyDigest,
          signature: signature(0x53).encoded,
          body: {
            ...binding,
            assignmentBodyDigest,
            observedAt: new Date().toISOString(),
          },
        };
        const before = await client.query<{
          readonly observations: string;
          readonly outcomes: string;
        }>(`
          select
            (select count(*)::text
               from app.private_live_telebirr_observation_transcripts) as observations,
            (select count(*)::text
               from app.private_live_telebirr_verification_outcomes) as outcomes
        `);
        const staged = await client.query(
          `select *
             from app.stage_private_telebirr_device_evidence(
               $1::uuid, $2::text, $3::text, $4::text, $5::jsonb, $6::jsonb
             )`,
          [
            paired.enrollmentId,
            sha(`upload-request:${randomUUID()}`),
            assignmentBodyDigest,
            observationBodyDigest,
            signedAssignment,
            signedObservation,
          ],
        );
        expect(staged.rows).toEqual([{ outcome: 'accepted', reason_code: null, replayed: false }]);
        const replayed = await client.query(
          `select *
             from app.stage_private_telebirr_device_evidence(
               $1::uuid, $2::text, $3::text, $4::text, $5::jsonb, $6::jsonb
             )`,
          [
            paired.enrollmentId,
            sha(`fresh-upload-request:${randomUUID()}`),
            assignmentBodyDigest,
            observationBodyDigest,
            signedAssignment,
            signedObservation,
          ],
        );
        expect(replayed.rows).toEqual([{ outcome: 'accepted', reason_code: null, replayed: true }]);

        const after = await client.query<{
          readonly evidence: string;
          readonly observations: string;
          readonly outcomes: string;
        }>(`
          select
            (select count(*)::text
               from app.private_live_telebirr_device_evidence_staging
              where observation_body_digest = '${observationBodyDigest}') as evidence,
            (select count(*)::text
               from app.private_live_telebirr_observation_transcripts) as observations,
            (select count(*)::text
               from app.private_live_telebirr_verification_outcomes) as outcomes
        `);
        expect(after.rows[0]).toEqual({
          evidence: '1',
          observations: before.rows[0]!.observations,
          outcomes: before.rows[0]!.outcomes,
        });
      });
    });

    it('rejects an unprovisioned runtime session despite inherited routine grants', async () => {
      const client = getClient();
      let failure: unknown;
      try {
        await client.query(`set session authorization ${deviceStateRuntime}`);
        await client.query(
          `select *
             from app.claim_private_telebirr_device_replay(
               $1::text, $2::timestamptz
             )`,
          [sha(`unprovisioned:${randomUUID()}`), new Date(Date.now() + 60_000)],
        );
      } catch (error) {
        failure = error;
      } finally {
        await client.query('reset session authorization');
      }
      expect(failure).toBeInstanceOf(Error);
      expect(failure instanceof Error ? failure.message : String(failure)).toMatch(
        /session is not currently authorized/iu,
      );
    });
  });
}
