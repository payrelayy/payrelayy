import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const TABLE = 'app.routine_telebirr_untrusted_proof_requests';

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
  await client.query('savepoint routine_proof_rejection');
  try {
    await expect(client.query(query, [...values])).rejects.toBeDefined();
  } finally {
    await client.query('rollback to savepoint routine_proof_rejection');
    await client.query('release savepoint routine_proof_rejection');
  }
}

async function fixtureIdentity(client: Client): Promise<{
  customerId: string;
  identityId: string;
}> {
  const customer = await client.query<{ id: string }>(
    'insert into app.customers default values returning id',
  );
  const identity = await client.query<{ id: string }>(
    `insert into app.customer_identities (customer_id, identity_kind, external_subject)
     values ($1::uuid, 'telegram', $2::text) returning id`,
    [customer.rows[0]!.id, `routine-proof-${randomUUID()}`],
  );
  return { customerId: customer.rows[0]!.id, identityId: identity.rows[0]!.id };
}

async function snapshot(client: Client): Promise<string> {
  const result = await client.query<{ state: string }>(`
    select jsonb_build_object(
      'intents', (select count(*) from app.deposit_intents),
      'evidence', (select count(*) from app.provider_payment_evidence),
      'claims', (select count(*) from app.deposit_payment_claims),
      'jobs', (select count(*) from app.deposit_jobs),
      'attempts', (select count(*) from app.deposit_execution_attempts),
      'live_switches', (select count(*) from app.feature_switches where mode = 'live')
    )::text as state
  `);
  return result.rows[0]!.state;
}

export function registerRoutineTelebirrUntrustedProofSqlTests(getClient: () => Client): void {
  describe('dormant non-pilot TeleBirr proof foundation', () => {
    it('has forced RLS, no policies, no application access, and no amount or pilot column', async () => {
      const client = getClient();
      const catalog = await client.query<{
        force_rls: boolean;
        rls: boolean;
        policies: string;
        accessible_roles: string;
        amount_columns: string;
        pilot_columns: string;
      }>(`
        select class.relrowsecurity as rls,
               class.relforcerowsecurity as force_rls,
               (select count(*)::text from pg_catalog.pg_policies policy
                 where policy.schemaname = 'app'
                   and policy.tablename = 'routine_telebirr_untrusted_proof_requests') as policies,
               (select count(*)::text from pg_catalog.pg_roles role
                 where role.rolname in (
                   'anon', 'authenticated', 'service_role',
                   'fetanagent_player_actions', 'fetanagent_player_actions_runtime',
                   'fetanagent_customer_web', 'fetanagent_customer_web_runtime',
                   'fetanagent_telebirr_shadow_verifier_runtime',
                   'fetanagent_trusted_telebirr_verifier_runtime',
                   'fetanagent_routine_deposit_broker_runtime',
                   'fetanagent_deposit_executor_runtime'
                 ) and pg_catalog.has_table_privilege(role.rolname, class.oid,
                   'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) as accessible_roles,
               (select count(*)::text from information_schema.columns column_info
                 where column_info.table_schema = 'app'
                   and column_info.table_name = 'routine_telebirr_untrusted_proof_requests'
                   and column_info.column_name like '%amount%') as amount_columns,
               (select count(*)::text from information_schema.columns column_info
                 where column_info.table_schema = 'app'
                   and column_info.table_name = 'routine_telebirr_untrusted_proof_requests'
                   and column_info.column_name like '%pilot%') as pilot_columns
          from pg_catalog.pg_class class
         where class.oid = '${TABLE}'::pg_catalog.regclass
      `);
      expect(catalog.rows).toEqual([
        {
          rls: true,
          force_rls: true,
          policies: '0',
          accessible_roles: '0',
          amount_columns: '0',
          pilot_columns: '0',
        },
      ]);
    });

    it('retains separate untrusted candidates without creating financial lineage', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const before = await snapshot(client);
        const firstIdentity = await fixtureIdentity(client);
        const secondIdentity = await fixtureIdentity(client);
        const platform = await client.query<{ id: string }>(
          `select id from app.platforms where code = 'kemerbet' and status = 'active'`,
        );
        const provider = await client.query<{ id: string }>(
          `select id from app.payment_providers where code = 'telebirr' and status = 'active'`,
        );
        expect(platform.rows).toHaveLength(1);
        expect(provider.rows).toHaveLength(1);
        const player = await client.query<{ id: string }>(
          `insert into app.customer_platform_players (customer_id, platform_id, player_id)
           values ($1::uuid, $2::uuid, $3::text) returning id`,
          [firstIdentity.customerId, platform.rows[0]!.id, `ROUTINE-${randomUUID()}`],
        );
        const playerId = player.rows[0]!.id;
        await client.query(
          `insert into app.player_validation_attempts (
             player_account_id, attempt_number, outcome, reason_code, adapter_version,
             started_at, completed_at, result_digest
           ) values ($1::uuid, 1, 'valid', 'routine_proof_fixture', 'fixture_v1',
             clock_timestamp() - interval '1 second', clock_timestamp(), $2::text)`,
          [playerId, `routine-proof-validation-${randomUUID()}`],
        );
        await client.query(
          `update app.customer_platform_players set validation_status = 'valid' where id = $1::uuid`,
          [playerId],
        );
        const eligibility = await client.query<{ id: string }>(
          `insert into app.player_deposit_eligibility_decisions
             (player_account_id, decision_version, decision, reason_code, actor_kind)
           values ($1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'system')
           returning id`,
          [playerId],
        );
        const referenceCiphertext = `v2.telebirr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(11)}`;
        const values = [
          firstIdentity.customerId,
          firstIdentity.identityId,
          randomUUID(),
          `hmac-sha256-v1:${'a'.repeat(64)}`,
          platform.rows[0]!.id,
          playerId,
          eligibility.rows[0]!.id,
          provider.rows[0]!.id,
          referenceCiphertext,
          'b'.repeat(64),
          '***AB12',
        ];
        const insert = `
          insert into ${TABLE} (
            submitting_customer_id, origin_identity_id, origin_channel,
            origin_request_key, semantic_input_hmac, platform_id, player_account_id,
            player_deposit_eligibility_decision_id, payment_provider_id,
            candidate_reference_ciphertext, candidate_reference_fingerprint,
            candidate_reference_masked, reference_encryption_key_version,
            reference_profile_version
          ) values (
            $1::uuid, $2::uuid, 'telegram', $3::uuid, $4::text,
            $5::uuid, $6::uuid, $7::uuid, $8::uuid,
            $9::text, $10::text, $11::text, 2, 2
          ) returning id
        `;
        const first = await client.query<{ id: string }>(insert, values);
        expect(first.rows).toHaveLength(1);
        await rejected(client, insert, values); // An origin event has one immutable result.
        await rejected(
          client,
          `update ${TABLE} set candidate_reference_masked = '***ZZ99' where id = $1::uuid`,
          [first.rows[0]!.id],
        );
        await rejected(client, `delete from ${TABLE} where id = $1::uuid`, [first.rows[0]!.id]);
        await rejected(client, `truncate ${TABLE}`);
        await rejected(client, insert, [...values.slice(0, 9), 'not-a-fingerprint', values[10]]);
        const second = await client.query<{ id: string }>(insert, [
          secondIdentity.customerId,
          secondIdentity.identityId,
          randomUUID(),
          values[3],
          ...values.slice(4),
        ]);
        expect(second.rows).toHaveLength(1);
        expect(second.rows[0]!.id).not.toBe(first.rows[0]!.id);
        expect(await snapshot(client)).toBe(before);
      });
    });
  });
}
