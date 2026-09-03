import { createHash, randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  createLiveProof,
  prepareTelebirrPilot,
  stageProof,
} from './private-live-telebirr-proof-lineage.suite.js';

const brokerGroup = 'fetanagent_telebirr_assignment_broker';
const brokerRuntime = 'fetanagent_telebirr_assignment_broker_runtime';
const leaseFunction = 'app.lease_private_live_telebirr_assignment_broker(uuid,text,uuid,integer)';
const persistFunction =
  'app.persist_private_live_telebirr_assignment_broker_signature(uuid,uuid,uuid,text,text,text,text)';
const guardFunction = 'app.require_telebirr_assignment_broker_session()';
const signatureDigestFunction = 'app.private_live_telebirr_assignment_signature_digest(text)';

type BrokerLeaseRow = {
  readonly verification_attempt_id: string;
  readonly lease_token: string;
  readonly job_id: string;
  readonly attempt_number: number;
  readonly request_id: string;
  readonly assignment_id: string;
  readonly lease_nonce_digest: string;
  readonly challenge_id: string;
  readonly challenge_digest: string;
  readonly issued_at: Date;
  readonly expires_at: Date;
  readonly pilot_revision_id: string;
  readonly device_enrollment_id: string;
  readonly device_id: string;
  readonly device_key_id: string;
  readonly device_public_key_spki_sha256: string;
  readonly receiver_revision_id: string;
  readonly receiver_profile_id: string;
  readonly receiver_profile_digest: string;
  readonly receiver_configuration_digest: string;
  readonly expected_receiver_name_digest: string;
  readonly receiver_name_normalizer_version: string;
  readonly source_profile: string;
  readonly adapter_version: string;
  readonly parser_version: string;
  readonly facts_normalizer_version: string;
  readonly candidate_reference_ciphertext: string;
  readonly candidate_reference_fingerprint: string;
  readonly reference_encryption_key_version: number;
  readonly reference_profile_version: number;
  readonly replayed: boolean;
};

type PersistedRow = {
  readonly assignment_signature: string;
  readonly assignment_signature_digest: string;
  readonly signed_at: Date;
  readonly replayed: boolean;
};

function sha(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function signature(byte: number): { readonly encoded: string; readonly digest: string } {
  const bytes = Buffer.alloc(64, byte);
  try {
    return {
      encoded: bytes.toString('base64url'),
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
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

async function expectFailure(
  client: Client,
  query: string,
  values: readonly unknown[],
  expected: RegExp,
): Promise<void> {
  const savepoint = `broker_expected_failure_${randomUUID().replaceAll('-', '')}`;
  await client.query(`savepoint ${savepoint}`);
  let failure: unknown;
  try {
    await client.query(query, [...values]);
  } catch (error) {
    failure = error;
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  expect(failure).toBeInstanceOf(Error);
  expect(failure instanceof Error ? failure.message : String(failure)).toMatch(expected);
}

export function registerTelebirrAssignmentBrokerRuntimeSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('private TeleBirr assignment broker database boundary', () => {
    it('creates one dormant non-settable role edge and exactly two executable routines', async () => {
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
         where rolname in ('${brokerGroup}', '${brokerRuntime}')
         order by rolname
      `);
      expect(roles.rows).toEqual([
        {
          rolname: brokerGroup,
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
          rolname: brokerRuntime,
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
         where granted.rolname in ('${brokerGroup}', '${brokerRuntime}')
            or member.rolname in ('${brokerGroup}', '${brokerRuntime}')
         order by group_role, member_role
      `);
      expect(memberships.rows).toEqual([
        {
          group_role: brokerGroup,
          member_role: brokerRuntime,
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
           and has_function_privilege('${brokerGroup}', routine.oid, 'EXECUTE')
         order by signature
      `);
      expect(routines.rows).toEqual([
        { signature: leaseFunction, hardened: true },
        { signature: persistFunction, hardened: true },
      ]);

      const ownerOnly = await client.query<{
        readonly group_execute: boolean;
        readonly public_execute: boolean;
        readonly runtime_execute: boolean;
        readonly signature: string;
      }>(`
        select requested.signature,
               has_function_privilege('${brokerGroup}', requested.signature, 'EXECUTE')
                 as group_execute,
               has_function_privilege('${brokerRuntime}', requested.signature, 'EXECUTE')
                 as runtime_execute,
               has_function_privilege('public', requested.signature, 'EXECUTE')
                 as public_execute
          from unnest(array[
            '${guardFunction}',
            '${signatureDigestFunction}'
          ]::text[]) requested(signature)
         order by requested.signature
      `);
      expect(ownerOnly.rows).toEqual([
        {
          signature: signatureDigestFunction,
          group_execute: false,
          runtime_execute: false,
          public_execute: false,
        },
        {
          signature: guardFunction,
          group_execute: false,
          runtime_execute: false,
          public_execute: false,
        },
      ]);
    });

    it('exposes no base table, sequence, public API, verifier completion, or settlement authority', async () => {
      const client = getClient();
      const baseAccess = await client.query<{ readonly accessible: boolean }>(`
        select exists (
          select 1
            from pg_class relation
            join pg_namespace namespace on namespace.oid = relation.relnamespace
           where namespace.nspname = 'app'
             and (
               (relation.relkind = 'S' and has_sequence_privilege(
                 '${brokerGroup}', relation.oid, 'USAGE,SELECT,UPDATE'
               ))
               or (relation.relkind in ('r','p','v','m','f') and (
                 has_table_privilege(
                   '${brokerGroup}', relation.oid,
                   'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
                 )
                 or has_any_column_privilege(
                   '${brokerGroup}', relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
                 )
               ))
             )
        ) as accessible
      `);
      expect(baseAccess.rows).toEqual([{ accessible: false }]);

      const forbidden = await client.query<{ readonly executable: boolean }>(`
        select exists (
          select 1
            from unnest(array[
              'app.load_private_live_telebirr_verification_authority(uuid,uuid,timestamp with time zone)',
              'app.complete_private_live_telebirr_verification(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,bigint,timestamp with time zone,text)',
              'app.finalize_private_live_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)'
            ]::text[]) requested(signature)
           where has_function_privilege('${brokerGroup}', requested.signature, 'EXECUTE')
        ) as executable
      `);
      expect(forbidden.rows).toEqual([{ executable: false }]);
    });

    it('leases one protected assignment and durably replays the first public signature', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const pilot = await prepareTelebirrPilot(client, getOwnerAdminId());
        const proof = await createLiveProof(client, pilot);
        const stage = await stageProof(client, proof.id);
        const leased = await client.query<BrokerLeaseRow>(
          `select *
             from app.lease_private_live_telebirr_assignment_broker(
               $1::uuid, $2::text, $3::uuid, 120
             )`,
          [pilot.deviceEnrollmentId, 'sql-telebirr-assignment-broker-01', randomUUID()],
        );
        expect(leased.rows).toHaveLength(1);
        const lease = leased.rows[0]!;
        expect(lease.job_id).toBe(stage.row.verification_job_id);
        expect(lease.device_enrollment_id).toBe(pilot.deviceEnrollmentId);
        expect(lease.receiver_profile_id).toBe(pilot.receiverProfileId);
        expect(lease.candidate_reference_ciphertext).toMatch(/^v2\.telebirr\./u);
        expect(lease.reference_encryption_key_version).toBe(2);
        expect(lease.reference_profile_version).toBe(2);

        const bodyDigest = sha(`body:${lease.assignment_id}`);
        const referenceBindingDigest = sha(`reference:${lease.assignment_id}`);
        const firstSignature = signature(0x11);
        const first = await client.query<PersistedRow>(
          `select *
             from app.persist_private_live_telebirr_assignment_broker_signature(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::text
             )`,
          [
            lease.verification_attempt_id,
            lease.lease_token,
            pilot.assignmentSignerId,
            bodyDigest,
            firstSignature.encoded,
            firstSignature.digest,
            referenceBindingDigest,
          ],
        );
        expect(first.rows).toHaveLength(1);
        expect(first.rows[0]).toMatchObject({
          assignment_signature: firstSignature.encoded,
          assignment_signature_digest: firstSignature.digest,
          replayed: false,
        });

        const secondSignature = signature(0x22);
        const replay = await client.query<PersistedRow>(
          `select *
             from app.persist_private_live_telebirr_assignment_broker_signature(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::text
             )`,
          [
            lease.verification_attempt_id,
            lease.lease_token,
            pilot.assignmentSignerId,
            bodyDigest,
            secondSignature.encoded,
            secondSignature.digest,
            referenceBindingDigest,
          ],
        );
        expect(replay.rows).toHaveLength(1);
        expect(replay.rows[0]).toMatchObject({
          assignment_signature: firstSignature.encoded,
          assignment_signature_digest: firstSignature.digest,
          replayed: true,
        });

        const stored = await client.query<{ readonly count: string }>(
          `select count(*)::text as count
             from app.private_live_telebirr_assignment_deliveries
            where verification_attempt_id = $1::uuid`,
          [lease.verification_attempt_id],
        );
        expect(stored.rows).toEqual([{ count: '1' }]);

        await expectFailure(
          client,
          `select *
             from app.persist_private_live_telebirr_assignment_broker_signature(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::text
             )`,
          [
            lease.verification_attempt_id,
            lease.lease_token,
            pilot.assignmentSignerId,
            bodyDigest,
            secondSignature.encoded,
            firstSignature.digest,
            referenceBindingDigest,
          ],
          /signature digest does not match/iu,
        );
      });
    });

    it('keeps delivery rows append-only and schema-free of plaintext reference fields', async () => {
      const client = getClient();
      const columns = await client.query<{ readonly column_name: string }>(`
        select column_name
          from information_schema.columns
         where table_schema = 'app'
           and table_name = 'private_live_telebirr_assignment_deliveries'
         order by ordinal_position
      `);
      expect(columns.rows.map((row) => row.column_name)).toEqual([
        'verification_attempt_id',
        'assignment_transcript_id',
        'assignment_signature',
        'assignment_signature_digest',
        'persisted_at',
      ]);
      expect(
        columns.rows.some((row) =>
          /reference|receiver|receipt|amount|claim/iu.test(row.column_name),
        ),
      ).toBe(false);

      const rls = await client.query<{
        readonly relforcerowsecurity: boolean;
        readonly relrowsecurity: boolean;
      }>(`
        select relrowsecurity, relforcerowsecurity
          from pg_class
         where oid = 'app.private_live_telebirr_assignment_deliveries'::regclass
      `);
      expect(rls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);

      const uniqueConstraints = await client.query<{
        readonly columns: readonly string[];
        readonly constraint_name: string;
      }>(`
        select
          constraint_row.conname as constraint_name,
          array_agg(attribute_row.attname order by constraint_column.ordinality) as columns
        from pg_constraint constraint_row
        cross join lateral unnest(constraint_row.conkey)
          with ordinality as constraint_column(attribute_number, ordinality)
        join pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.conrelid
         and attribute_row.attnum = constraint_column.attribute_number
        where constraint_row.conrelid =
          'app.private_live_telebirr_assignment_deliveries'::regclass
          and constraint_row.contype = 'u'
        group by constraint_row.conname
        order by constraint_row.conname
      `);
      expect(uniqueConstraints.rows).toContainEqual({
        constraint_name: 'private_live_telebirr_assignment_delivery_cover_key',
        columns: [
          'assignment_transcript_id',
          'verification_attempt_id',
          'assignment_signature_digest',
        ],
      });
      expect(
        uniqueConstraints.rows.some(
          (constraint) =>
            constraint.columns.length === 1 && constraint.columns[0] === 'assignment_transcript_id',
        ),
      ).toBe(false);
    });

    it('rejects an unprovisioned runtime session even though it inherits the two routines', async () => {
      const client = getClient();
      let failure: unknown;
      try {
        await client.query(`set session authorization ${brokerRuntime}`);
        await client.query(
          `select *
             from app.lease_private_live_telebirr_assignment_broker(
               $1::uuid, $2::text, $3::uuid, 120
             )`,
          [randomUUID(), 'sql-telebirr-assignment-broker-02', randomUUID()],
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
