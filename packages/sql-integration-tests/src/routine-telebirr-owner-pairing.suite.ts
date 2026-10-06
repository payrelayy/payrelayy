import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const ISSUE =
  'select * from app.issue_owner_routine_telebirr_device_pairing_challenge($1::uuid,$2::uuid)';
const CONSUME =
  'select * from app.consume_routine_telebirr_device_pairing_challenge($1::uuid,$2::text)';
const READ_PROOF_CHALLENGE =
  'select * from app.get_owner_routine_telebirr_device_pairing_challenge($1::uuid,$2::uuid)';
const ENROLL = `select * from app.enroll_owner_routine_telebirr_device_pairing_proof(
  $1::uuid,$2::uuid,$3::text,$4::uuid,$5::integer,$6::text,$7::text,
  $8::text,$9::text,$10::text,$11::text,$12::timestamptz,$13::timestamptz)`;
const TABLE = 'app.routine_telebirr_device_pairing_challenges';

async function rollback<T>(client: Client, body: () => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    return await body();
  } finally {
    await client.query('rollback');
  }
}

async function rejected(
  client: Client,
  query: string,
  values: readonly unknown[] = [],
): Promise<void> {
  await client.query('savepoint routine_pairing_rejection');
  try {
    await expect(client.query(query, [...values])).rejects.toBeDefined();
  } finally {
    await client.query('rollback to savepoint routine_pairing_rejection');
    await client.query('release savepoint routine_pairing_rejection');
  }
}

async function fixtureReceiver(client: Client): Promise<void> {
  const existing = await client.query(`
    select receiver.id from app.receiver_accounts receiver
      join app.payment_providers provider on provider.id = receiver.provider_id
      where provider.code = 'telebirr' and receiver.status = 'active'
  `);
  if (existing.rows.length > 0) return;
  await client.query(
    `insert into app.receiver_accounts (
       provider_id, version, account_holder_name, account_reference_ciphertext,
       account_reference_masked, account_reference_fingerprint,
       protection_profile_version, encryption_key_version, fingerprint_key_version,
       rotation_request_id, rotation_reason
     ) select provider.id, 1, 'Synthetic Routine Pairing Receiver',
              $1::text, '***7001', repeat('4', 64), 1, 1, 1,
              $2::uuid, 'initial_configuration'
       from app.payment_providers provider where provider.code = 'telebirr'`,
    [`receiver-v1.telebirr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(16)}`, randomUUID()],
  );
}

export function registerRoutineTelebirrOwnerPairingSqlTests(
  getClient: () => Client,
  getOwnerAuthUserId: () => string,
): void {
  describe('routine TeleBirr Owner pairing challenge', () => {
    it('keeps its private one-use ledger and consumption function away from app roles', async () => {
      const client = getClient();
      const catalog = await client.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        policy_count: string;
        owner_table: boolean;
        runtime_table: boolean;
        api_table: boolean;
        owner_issue: boolean;
        runtime_issue: boolean;
        runtime_consume: boolean;
        postgres_consume: boolean;
      }>(`
        select relation.relrowsecurity, relation.relforcerowsecurity,
          (select count(*)::text from pg_policies policy
            where policy.schemaname = 'app'
              and policy.tablename = 'routine_telebirr_device_pairing_challenges') as policy_count,
          has_table_privilege('fetanagent_owner_control', relation.oid,
            'select,insert,update,delete,truncate') as owner_table,
          has_table_privilege('fetanagent_owner_control_runtime', relation.oid,
            'select,insert,update,delete,truncate') as runtime_table,
          has_table_privilege('service_role', relation.oid,
            'select,insert,update,delete,truncate') as api_table,
          has_function_privilege('fetanagent_owner_control',
            'app.issue_owner_routine_telebirr_device_pairing_challenge(uuid,uuid)', 'execute') as owner_issue,
          has_function_privilege('fetanagent_owner_control_runtime',
            'app.issue_owner_routine_telebirr_device_pairing_challenge(uuid,uuid)', 'execute') as runtime_issue,
          has_function_privilege('fetanagent_owner_control_runtime',
            'app.consume_routine_telebirr_device_pairing_challenge(uuid,text)', 'execute') as runtime_consume,
          has_function_privilege('postgres',
            'app.consume_routine_telebirr_device_pairing_challenge(uuid,text)', 'execute') as postgres_consume
        from pg_class relation where relation.oid = '${TABLE}'::regclass
      `);
      expect(catalog.rows).toEqual([
        {
          relrowsecurity: true,
          relforcerowsecurity: true,
          policy_count: '0',
          owner_table: false,
          runtime_table: false,
          api_table: false,
          owner_issue: true,
          runtime_issue: true,
          runtime_consume: false,
          postgres_consume: true,
        },
      ]);
      const functions = await client.query<{
        owner: string;
        security_definer: boolean;
        public_allowed: boolean;
        service_allowed: boolean;
      }>(`
        select procedure.proowner::regrole::text as owner,
          procedure.prosecdef as security_definer,
          has_function_privilege('public', procedure.oid, 'execute') as public_allowed,
          has_function_privilege('service_role', procedure.oid, 'execute') as service_allowed
        from pg_proc procedure where procedure.oid = any(array[
          'app.issue_owner_routine_telebirr_device_pairing_challenge(uuid,uuid)'::regprocedure,
          'app.consume_routine_telebirr_device_pairing_challenge(uuid,text)'::regprocedure
        ])
      `);
      expect(functions.rows).toEqual([
        {
          owner: 'postgres',
          security_definer: true,
          public_allowed: false,
          service_allowed: false,
        },
        {
          owner: 'postgres',
          security_definer: true,
          public_allowed: false,
          service_allowed: false,
        },
      ]);
    });

    it('issues only from the real Owner runtime, replays exactly, and consumes once without enrollment', async () => {
      const client = getClient();
      await rollback(client, async () => {
        await fixtureReceiver(client);
        const initialTrust = await client.query<{ count: string }>(
          'select count(*)::text as count from app.routine_telebirr_device_enrollments',
        );
        const requestId = randomUUID();
        await client.query('set session authorization fetanagent_owner_control_runtime');
        let issued: Record<string, unknown>;
        try {
          const first = await client.query(ISSUE, [getOwnerAuthUserId(), requestId]);
          expect(first.rows).toHaveLength(1);
          issued = first.rows[0]!;
          expect(issued.replayed).toBe(false);
          expect(issued.receiver_revision_id).toMatch(/^[0-9a-f-]{36}$/u);
          expect(issued.pairing_nonce_digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
          expect(issued.receiver_profile_digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
          expect(issued.expected_receiver_name_digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
          expect((issued.expires_at as Date).getTime() - (issued.issued_at as Date).getTime()).toBe(
            600_000,
          );
          const replay = await client.query(ISSUE, [getOwnerAuthUserId(), requestId]);
          expect(replay.rows).toEqual([{ ...issued, replayed: true }]);
          await rejected(client, `select * from ${TABLE}`);
          await rejected(client, CONSUME, [issued.pairing_id, `sha256:${'a'.repeat(64)}`]);
          await rejected(client, ISSUE, [randomUUID(), randomUUID()]);
        } finally {
          await client.query('reset session authorization');
        }
        const evidenceDigest = `sha256:${'d'.repeat(64)}`;
        const consumed = await client.query(CONSUME, [issued!.pairing_id, evidenceDigest]);
        expect(consumed.rows).toEqual([{ consumed_at: expect.any(Date), replayed: false }]);
        const replay = await client.query(CONSUME, [issued!.pairing_id, evidenceDigest]);
        expect(replay.rows).toEqual([
          { consumed_at: consumed.rows[0]!.consumed_at, replayed: true },
        ]);
        await client.query('set session authorization fetanagent_owner_control_runtime');
        try {
          await rejected(client, ISSUE, [getOwnerAuthUserId(), requestId]);
        } finally {
          await client.query('reset session authorization');
        }
        await rejected(client, CONSUME, [issued!.pairing_id, `sha256:${'e'.repeat(64)}`]);
        await rejected(
          client,
          `update ${TABLE} set expires_at = expires_at + interval '1 day'
          where pairing_id = $1::uuid`,
          [issued!.pairing_id],
        );
        const afterTrust = await client.query<{ count: string }>(
          'select count(*)::text as count from app.routine_telebirr_device_enrollments',
        );
        expect(afterTrust.rows).toEqual(initialTrust.rows);
      });
    });

    it('exposes only Owner proof RPCs, not the private challenge or enrollment tables', async () => {
      const client = getClient();
      const grants = await client.query<{
        owner_read: boolean;
        owner_enroll: boolean;
        service_read: boolean;
        service_enroll: boolean;
        owner_challenge_table: boolean;
        owner_enrollment_table: boolean;
        enrollment_rls: boolean;
        enrollment_forced_rls: boolean;
      }>(`
        select
          has_function_privilege('fetanagent_owner_control_runtime',
            'app.get_owner_routine_telebirr_device_pairing_challenge(uuid,uuid)', 'execute') as owner_read,
          has_function_privilege('fetanagent_owner_control_runtime',
            'app.enroll_owner_routine_telebirr_device_pairing_proof(uuid,uuid,text,uuid,integer,text,text,text,text,text,text,timestamptz,timestamptz)',
            'execute') as owner_enroll,
          has_function_privilege('service_role',
            'app.get_owner_routine_telebirr_device_pairing_challenge(uuid,uuid)', 'execute') as service_read,
          has_function_privilege('service_role',
            'app.enroll_owner_routine_telebirr_device_pairing_proof(uuid,uuid,text,uuid,integer,text,text,text,text,text,text,timestamptz,timestamptz)',
            'execute') as service_enroll,
          has_table_privilege('fetanagent_owner_control_runtime',
            'app.routine_telebirr_device_pairing_challenges', 'select,insert,update,delete') as owner_challenge_table,
          has_table_privilege('fetanagent_owner_control_runtime',
            'app.routine_telebirr_device_enrollments', 'select,insert,update,delete') as owner_enrollment_table,
          relation.relrowsecurity as enrollment_rls,
          relation.relforcerowsecurity as enrollment_forced_rls
        from pg_class relation
        where relation.oid = 'app.routine_telebirr_device_enrollments'::regclass
      `);
      expect(grants.rows).toEqual([
        {
          owner_read: true,
          owner_enroll: true,
          service_read: false,
          service_enroll: false,
          owner_challenge_table: false,
          owner_enrollment_table: false,
          enrollment_rls: true,
          enrollment_forced_rls: true,
        },
      ]);
    });

    it('atomically enrolls one no-money routine key after the trusted service verifies its proof', async () => {
      const client = getClient();
      await rollback(client, async () => {
        await fixtureReceiver(client);
        await client.query('set session authorization fetanagent_owner_control_runtime');
        try {
          const issued = (await client.query(ISSUE, [getOwnerAuthUserId(), randomUUID()])).rows[0]!;
          const pairingId = issued.pairing_id as string;
          const trusted = await client.query(READ_PROOF_CHALLENGE, [
            getOwnerAuthUserId(),
            pairingId,
          ]);
          expect(trusted.rows).toHaveLength(1);
          expect(trusted.rows[0]!.pairing_nonce_digest).toBe(issued.pairing_nonce_digest);
          const requestIssued = issued.issued_at as Date;
          const requestExpires = new Date(requestIssued.getTime() + 300_000);
          const inputs = [
            getOwnerAuthUserId(),
            pairingId,
            issued.pairing_nonce_digest,
            issued.receiver_revision_id,
            issued.receiver_version,
            issued.receiver_profile_digest,
            issued.expected_receiver_name_digest,
            `sha256:${'e'.repeat(64)}`,
            'routine-device-0001',
            'routine-key-0001',
            `sha256:${'f'.repeat(64)}`,
            requestIssued,
            requestExpires,
          ];
          await rejected(client, ENROLL, [
            ...inputs.slice(0, 2),
            `sha256:${'0'.repeat(64)}`,
            ...inputs.slice(3),
          ]);
          await rejected(client, ENROLL, [
            ...inputs.slice(0, 7),
            `sha256:${'1'.repeat(64)}`,
            ...inputs.slice(8, 12),
            new Date(requestIssued.getTime() - 1),
          ]);
          const first = await client.query(ENROLL, inputs);
          expect(first.rows).toHaveLength(1);
          expect(first.rows[0]!.replayed).toBe(false);
          expect(first.rows[0]!.enrollment_id).toMatch(/^[0-9a-f-]{36}$/u);
          expect(
            (first.rows[0]!.valid_until as Date).getTime() -
              (first.rows[0]!.valid_from as Date).getTime(),
          ).toBe(30 * 86_400_000);
          const replay = await client.query(ENROLL, inputs);
          expect(replay.rows).toEqual([{ ...first.rows[0], replayed: true }]);
          await rejected(client, ENROLL, [
            ...inputs.slice(0, 7),
            `sha256:${'2'.repeat(64)}`,
            ...inputs.slice(8),
          ]);
          await rejected(client, ENROLL, [
            ...inputs.slice(0, 8),
            'routine-device-9999',
            ...inputs.slice(9),
          ]);
          await rejected(client, 'select * from app.routine_telebirr_device_enrollments');
          expect(
            (await client.query(READ_PROOF_CHALLENGE, [getOwnerAuthUserId(), pairingId])).rows,
          ).toHaveLength(0);
        } finally {
          await client.query('reset session authorization');
        }
        const rows = await client.query<{ count: string }>(
          `
          select count(*)::text as count from app.routine_telebirr_device_enrollments
          where pairing_evidence_digest = $1::text
        `,
          [`sha256:${'e'.repeat(64)}`],
        );
        expect(rows.rows).toEqual([{ count: '1' }]);
        const switches = await client.query<{ count: string }>(`
          select count(*)::text as count from app.feature_switches
          where feature_key in ('deposit_execution', 'payment_verification',
            'private_live_deposit_pilot', 'telebirr_authoritative_verification',
            'cbe_birr_authoritative_verification', 'withdrawal_collection',
            'withdrawal_validation') and mode = 'disabled'
        `);
        expect(switches.rows).toEqual([{ count: '7' }]);
      });
    });
  });
}
