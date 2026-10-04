import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { createVerifiedDepositFixture } from './deposit-execution-commands.suite.js';

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
  await client.query('savepoint routine_rejection');
  try {
    await expect(client.query(query, [...values])).rejects.toBeDefined();
  } finally {
    await client.query('rollback to savepoint routine_rejection');
    await client.query('release savepoint routine_rejection');
  }
}
async function account(client: Client): Promise<string> {
  const existing = await client.query<{ id: string }>(`
    select agent.id from app.platform_agent_accounts agent
      join app.platforms platform on platform.id = agent.platform_id
      where platform.code = 'kemerbet' and agent.status = 'active' limit 1
  `);
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await client.query<{ id: string }>(`
    insert into app.platform_agent_accounts (platform_id, label, credential_ref)
      select id, 'routine-policy-fixture', 'secret://synthetic-routine-policy' from app.platforms
        where code = 'kemerbet' returning id
  `);
  return inserted.rows[0]!.id;
}

async function save(client: Client, owner: string, selectedAccount: string, key = randomUUID()) {
  const result = await client.query<{ configuration: Record<string, unknown> }>(
    `
    select app.save_owner_routine_telebirr_processing($1::uuid, $2::uuid, $3::uuid) as configuration
  `,
    [owner, selectedAccount, key],
  );
  return result.rows[0]!.configuration;
}

async function persistentPolicyFixture(
  client: Client,
  owner: string,
): Promise<{ authorityId: string; accountId: string }> {
  const accountId = await account(client);
  // This disposable fixture models an authorization committed before the current transaction.
  // The real save procedure is tested separately; no mutable timestamp is changed or bypassed.
  const authority = await client.query<{ id: string }>(
    `
    insert into app.routine_telebirr_processing_authorizations (
      platform_agent_account_id, deposit_policy_version_id, authorized_by_admin_id, authorized_at
    ) select $1::uuid, policy.id, owner_user.id, transaction_timestamp() - interval '1 second'
      from app.deposit_policy_versions policy, app.admin_users owner_user
      where policy.status = 'active' and owner_user.auth_user_id = $2::uuid returning id
  `,
    [accountId, owner],
  );
  const authorityId = authority.rows[0]!.id;
  await client.query(
    `
    insert into app.routine_telebirr_processing_events (request_key, authorization_id, event_kind, actor_admin_id)
      select $1::uuid, $2::uuid, 'authorize', id from app.admin_users where auth_user_id = $3::uuid
  `,
    [randomUUID(), authorityId, owner],
  );
  return { authorityId, accountId };
}

async function paidJob(
  client: Client,
  amountMinor = 2500,
  providerCode: 'telebirr' | 'cbe_birr' = 'telebirr',
) {
  const fixture = await createVerifiedDepositFixture(client, 'routine-' + randomUUID(), {
    providerCode,
    amountMinor,
  });
  const settled = await client.query<{ execution_job_id: string; payment_claim_id: string }>(
    `
    select execution_job_id, payment_claim_id
      from app.finalize_verified_deposit_and_enqueue_execution($1::uuid, $2::uuid, $3::uuid)
  `,
    [fixture.depositIntentId, fixture.verificationAttemptId, fixture.evidenceId],
  );
  expect(settled.rows).toHaveLength(1);
  return {
    ...fixture,
    jobId: settled.rows[0]!.execution_job_id,
    claimId: settled.rows[0]!.payment_claim_id,
  };
}

export function registerRoutineTelebirrProcessingPolicySqlTests(
  getClient: () => Client,
  getOwner: () => string,
): void {
  describe('persistent routine TeleBirr policy and non-executing admission', () => {
    it('has forced RLS, immutable retained records, no expiry/quota and no execution-role privileges', async () => {
      const client = getClient();
      const tables = [
        'routine_telebirr_processing_authorizations',
        'routine_telebirr_processing_events',
        'routine_telebirr_execution_bindings',
      ];
      const rows = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `
        select relname, relrowsecurity, relforcerowsecurity from pg_class
          where relnamespace = 'app'::regnamespace and relname = any($1::text[]) order by relname
      `,
        [tables],
      );
      expect(rows.rows).toHaveLength(3);
      expect(rows.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
      const columns = await client.query<{ attname: string }>(`
        select attname from pg_attribute where attrelid = 'app.routine_telebirr_processing_authorizations'::regclass
          and attnum > 0 and not attisdropped
      `);
      expect(columns.rows.map((row) => row.attname)).not.toContain('expires_at');
      const procedures = await client.query<{
        proname: string;
        hardened: boolean;
        owner_allowed: boolean;
        runtime_allowed: boolean;
      }>(`
        select procedure.proname,
          procedure.prosecdef and procedure.proowner = 'postgres'::regrole
            and procedure.proconfig = array['search_path=""']::text[] as hardened,
          has_function_privilege('fetanagent_owner_control', procedure.oid, 'execute') as owner_allowed,
          has_function_privilege('fetanagent_owner_control_runtime', procedure.oid, 'execute') as runtime_allowed
        from pg_proc procedure where procedure.oid = any(array[
          'app.get_owner_routine_telebirr_processing(uuid)'::regprocedure,
          'app.save_owner_routine_telebirr_processing(uuid,uuid,uuid)'::regprocedure,
          'app.stop_owner_routine_telebirr_processing(uuid,uuid)'::regprocedure
        ]) order by procedure.proname
      `);
      expect(procedures.rows).toHaveLength(3);
      expect(
        procedures.rows.every((row) => row.hardened && row.owner_allowed && row.runtime_allowed),
      ).toBe(true);
      for (const role of [
        'anon',
        'authenticated',
        'service_role',
        'fetanagent_api',
        'fetanagent_deposit_executor',
        'fetanagent_companion_execution_bridge',
        'fetanagent_owner_control',
      ]) {
        for (const table of tables) {
          const access = await client.query<{ allowed: boolean }>(
            `select has_table_privilege($1::text, $2::text, 'select,insert,update,delete,truncate') as allowed`,
            [role, 'app.' + table],
          );
          expect(access.rows[0]!.allowed).toBe(false);
        }
        for (const signature of [
          'app.assess_routine_telebirr_execution_job(uuid)',
          'app.admit_routine_telebirr_execution_job(uuid)',
        ]) {
          const access = await client.query<{ allowed: boolean }>(
            `select has_function_privilege($1::text, $2::text, 'execute') as allowed`,
            [role, signature],
          );
          expect(access.rows[0]!.allowed).toBe(false);
        }
      }
    });

    it('works through the real Owner runtime identity without direct table or admission access', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const selectedAccount = await account(client);
        await client.query('set session authorization fetanagent_owner_control_runtime');
        try {
          expect((await save(client, getOwner(), selectedAccount)).configurationState).toBe(
            'authorized',
          );
          await rejected(client, 'select * from app.routine_telebirr_processing_authorizations');
          await rejected(client, 'select app.admit_routine_telebirr_execution_job($1::uuid)', [
            randomUUID(),
          ]);
          expect(
            (
              await client.query(
                'select app.stop_owner_routine_telebirr_processing($1::uuid,$2::uuid) as configuration',
                [getOwner(), randomUUID()],
              )
            ).rows[0].configuration.configurationState,
          ).toBe('stopped');
        } finally {
          await client.query('reset session authorization');
        }
      });
    });

    it('saves a non-expiring policy once, does not renew it, and never activates financial state', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const selectedAccount = await account(client);
        const before = await client.query(
          `select jsonb_agg(to_jsonb(switch) order by feature_key) as switches from app.feature_switches switch`,
        );
        const key = randomUUID();
        const saved = await save(client, getOwner(), selectedAccount, key);
        expect(saved).toMatchObject({
          configurationState: 'authorized',
          executionEnabled: false,
          policy: {
            minimumAmountMinor: 2500,
            maximumAmountMinor: 2500000,
            dailyQuotaMinor: null,
            successfulDepositQuota: null,
            maxConcurrentDeposits: 1,
            playerOwnershipRequired: false,
            playerScope: 'all_active_deposit_eligible',
            amountSource: 'official_receipt_settled_amount',
          },
        });
        expect(saved).not.toHaveProperty('expiresAt');
        expect(await save(client, getOwner(), selectedAccount, key)).toEqual(saved);
        const savedAgain = await save(client, getOwner(), selectedAccount);
        expect(savedAgain.authorizationId).toEqual(saved.authorizationId);
        expect(savedAgain.authorizedAt).toEqual(saved.authorizedAt);
        const count = await client.query(
          `select count(*)::integer as count from app.routine_telebirr_processing_authorizations`,
        );
        expect(count.rows[0].count).toBe(1);
        expect(
          (
            await client.query(
              `select jsonb_agg(to_jsonb(switch) order by feature_key) as switches from app.feature_switches switch`,
            )
          ).rows,
        ).toEqual(before.rows);
        expect(
          (
            await client.query(
              `select count(*)::integer as count from app.deposit_execution_attempts`,
            )
          ).rows[0].count,
        ).toBe(0);
      });
    });

    it('keeps stop persistent, makes replay non-reactivating, and rejects request-key reuse', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const selectedAccount = await account(client);
        const authorizationKey = randomUUID();
        await save(client, getOwner(), selectedAccount, authorizationKey);
        const stopKey = randomUUID();
        const stopped = await client.query(
          `select app.stop_owner_routine_telebirr_processing($1::uuid, $2::uuid) as configuration`,
          [getOwner(), stopKey],
        );
        expect(stopped.rows[0].configuration.configurationState).toBe('stopped');
        expect(
          (await save(client, getOwner(), selectedAccount, authorizationKey)).configurationState,
        ).toBe('stopped');
        await rejected(
          client,
          `select app.save_owner_routine_telebirr_processing($1::uuid, $2::uuid, $3::uuid)`,
          [getOwner(), selectedAccount, stopKey],
        );
        await rejected(
          client,
          `select app.stop_owner_routine_telebirr_processing($1::uuid, $2::uuid)`,
          [getOwner(), authorizationKey],
        );
        const count = await client.query(
          `select count(*)::integer as count from app.routine_telebirr_processing_events`,
        );
        expect(count.rows[0].count).toBe(2);
      });
    });

    it('requires active Owner and agent, protects immutable policy and event history', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const selectedAccount = await account(client);
        await rejected(
          client,
          `select app.save_owner_routine_telebirr_processing($1::uuid, $2::uuid, $3::uuid)`,
          [randomUUID(), selectedAccount, randomUUID()],
        );
        await rejected(
          client,
          `select app.save_owner_routine_telebirr_processing($1::uuid, $2::uuid, $3::uuid)`,
          [getOwner(), randomUUID(), randomUUID()],
        );
        await save(client, getOwner(), selectedAccount);
        for (const table of [
          'routine_telebirr_processing_authorizations',
          'routine_telebirr_processing_events',
        ]) {
          await rejected(client, `delete from app.${table}`);
          await rejected(client, `truncate app.${table} cascade`);
        }
        await rejected(
          client,
          `update app.routine_telebirr_processing_authorizations set authorized_at = authorized_at - interval '1 day'`,
        );
        await rejected(
          client,
          `update app.routine_telebirr_processing_events set event_kind = 'stop'`,
        );
        await client.query(
          `update app.admin_users set status = 'inactive' where auth_user_id = $1::uuid`,
          [getOwner()],
        );
        await rejected(client, `select app.get_owner_routine_telebirr_processing($1::uuid)`, [
          getOwner(),
        ]);
      });
    });

    it.each([2500, 2501, 2500000])(
      'admits only the exact verified receipt amount %s without leasing or approving',
      async (amountMinor) => {
        const client = getClient();
        await rollback(client, async () => {
          const policy = await persistentPolicyFixture(client, getOwner());
          const deposit = await paidJob(client, amountMinor);
          const assessed = await client.query(
            `select * from app.assess_routine_telebirr_execution_job($1::uuid)`,
            [deposit.jobId],
          );
          expect(assessed.rows).toEqual([
            {
              authorization_id: policy.authorityId,
              platform_agent_account_id: policy.accountId,
              deposit_intent_id: deposit.depositIntentId,
              deposit_payment_claim_id: deposit.claimId,
              player_id: deposit.playerId,
              amount_minor: String(amountMinor),
              currency_code: 'ETB',
            },
          ]);
          for (let replay = 0; replay < 2; replay += 1) {
            expect(
              (
                await client.query(
                  `select app.admit_routine_telebirr_execution_job($1::uuid) as id`,
                  [deposit.jobId],
                )
              ).rows[0].id,
            ).toBe(deposit.jobId);
          }
          const job = await client.query(
            `select status, attempt_count, lease_token from app.deposit_jobs where id = $1::uuid`,
            [deposit.jobId],
          );
          expect(job.rows).toEqual([{ status: 'queued', attempt_count: 0, lease_token: null }]);
          expect(
            (
              await client.query(
                `select count(*)::integer as count from app.deposit_execution_owner_approvals`,
              )
            ).rows[0].count,
          ).toBe(0);
          expect(
            (
              await client.query(
                `select count(*)::integer as count from app.deposit_execution_attempts`,
              )
            ).rows[0].count,
          ).toBe(0);
          await rejected(
            client,
            `update app.deposit_jobs set status = 'leased', attempt_count = 1, lease_token = gen_random_uuid(), leased_by = 'not-authorized', lease_expires_at = clock_timestamp() + interval '1 minute' where id = $1::uuid`,
            [deposit.jobId],
          );
        });
      },
    );

    it('admits more than five distinct eligible deposits without a pilot or quota', async () => {
      const client = getClient();
      await rollback(client, async () => {
        await persistentPolicyFixture(client, getOwner());
        for (let index = 0; index < 7; index += 1) {
          const deposit = await paidJob(client, 2500 + index);
          await client.query(`select app.admit_routine_telebirr_execution_job($1::uuid)`, [
            deposit.jobId,
          ]);
        }
        expect(
          (
            await client.query(
              `select count(*)::integer as count from app.routine_telebirr_execution_bindings`,
            )
          ).rows[0].count,
        ).toBe(7);
        expect(
          (
            await client.query(
              `select count(*)::integer as count from app.private_live_deposit_pilot_reservations`,
            )
          ).rows[0].count,
        ).toBe(0);
      });
    });

    it('rechecks revoked eligibility, stopped authorization, inactive agent and current receiver', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const policy = await persistentPolicyFixture(client, getOwner());
        const deposit = await paidJob(client);
        await client.query('savepoint routine_mutable');
        const mutations = [
          `update app.platform_agent_accounts set status = 'inactive' where id = '${policy.accountId}'::uuid`,
          `update app.customer_platform_players set status = 'inactive' where id = (select player_account_id from app.deposit_intents where id = '${deposit.depositIntentId}'::uuid)`,
          `update app.receiver_accounts set status = 'inactive' where id = (select receiver_account_id from app.deposit_intents where id = '${deposit.depositIntentId}'::uuid)`,
        ];
        for (const mutation of mutations) {
          await client.query(mutation);
          expect(
            (
              await client.query(
                `select * from app.assess_routine_telebirr_execution_job($1::uuid)`,
                [deposit.jobId],
              )
            ).rows,
          ).toHaveLength(0);
          await rejected(client, `select app.admit_routine_telebirr_execution_job($1::uuid)`, [
            deposit.jobId,
          ]);
          await client.query('rollback to savepoint routine_mutable');
        }
        await client.query(
          `select app.stop_owner_routine_telebirr_processing($1::uuid, $2::uuid)`,
          [getOwner(), randomUUID()],
        );
        expect(
          (
            await client.query(
              `select * from app.assess_routine_telebirr_execution_job($1::uuid)`,
              [deposit.jobId],
            )
          ).rows,
        ).toHaveLength(0);
        await rejected(client, `select app.admit_routine_telebirr_execution_job($1::uuid)`, [
          deposit.jobId,
        ]);
        await client.query('release savepoint routine_mutable');
      });
    });

    it('does not adopt earlier payments, another provider or a missing verified claim', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const old = await paidJob(client);
        await save(client, getOwner(), await account(client));
        const cbe = await paidJob(client, 2500, 'cbe_birr');
        for (const jobId of [old.jobId, cbe.jobId, randomUUID()]) {
          expect(
            (
              await client.query(
                `select * from app.assess_routine_telebirr_execution_job($1::uuid)`,
                [jobId],
              )
            ).rows,
          ).toHaveLength(0);
          await rejected(client, `select app.admit_routine_telebirr_execution_job($1::uuid)`, [
            jobId,
          ]);
        }
      });
    });
  });
}
