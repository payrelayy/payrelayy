import { createHash, randomUUID } from 'node:crypto';

import type { Client, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

type ClientGetter = () => Client;
type SqlValue = boolean | Date | number | string | null;

type VerifiedDepositFixture = {
  readonly depositIntentId: string;
  readonly evidenceId: string;
  readonly playerId: string;
  readonly verificationAttemptId: string;
};

const executorFunctions = [
  'app.cancel_deposit_execution_before_action(uuid,uuid,text)',
  'app.fence_private_live_deposit_execution_final_action(uuid,uuid,uuid,uuid,uuid)',
  'app.lease_next_deposit_execution_reconciliation(uuid,integer)',
  'app.lease_next_private_live_deposit_execution(uuid,integer)',
  'app.record_deposit_execution_reconciliation(uuid,uuid,text,text,smallint,text,timestamp with time zone,boolean,boolean,boolean,boolean)',
  'app.require_deposit_execution_reconciliation(uuid,uuid,boolean)',
] as const;

const settlementFunction = 'app.finalize_verified_deposit_and_enqueue_execution';

let savepointSequence = 0;

async function withSavepoint<T>(client: Client, body: () => Promise<T>): Promise<T> {
  const savepointName = `sql_test_savepoint_${(savepointSequence += 1)}`;
  await client.query(`savepoint ${savepointName}`);

  try {
    const result = await body();
    await client.query(`release savepoint ${savepointName}`);
    return result;
  } catch (error) {
    try {
      await client.query(`rollback to savepoint ${savepointName}`);
    } catch {
      // Preserve the original database error; the outer test rollback remains authoritative.
    }
    try {
      await client.query(`release savepoint ${savepointName}`);
    } catch {
      // Preserve the original database error; the outer test rollback remains authoritative.
    }
    throw error;
  }
}

async function withRollback<T>(client: Client, body: () => Promise<T>): Promise<T> {
  await client.query('begin');
  let bodyFailed = false;

  try {
    return await body();
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    try {
      await client.query('rollback');
    } catch (rollbackError) {
      if (!bodyFailed) {
        throw rollbackError;
      }
    }
  }
}

async function queryAsExecutor<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  return withSavepoint(client, async () => {
    const historicalPilotPrimitive =
      /app\.(?:lease_next_deposit_execution|fence_deposit_execution_final_action)\s*\(/u.test(
        query,
      );
    if (!historicalPilotPrimitive) {
      await client.query('set local role fetanagent_deposit_executor');
    }
    const result = await client.query<T>(query, [...values]);
    if (!historicalPilotPrimitive) {
      await client.query('reset role');
    }
    return result.rows;
  });
}

async function queryAsSettlement<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  // Historical non-pilot settlement semantics remain regression-tested as the disposable
  // migration owner. The production settlement role is denied this primitive and the private
  // pilot suite exercises the only granted strict wrapper.
  return withSavepoint(client, async () => {
    const result = await client.query<T>(query, [...values]);
    return result.rows;
  });
}

async function enableLiveDepositSwitches(client: Client): Promise<void> {
  await client.query(`
    update app.feature_switches
       set mode = 'live'
     where feature_key in ('payment_verification', 'deposit_execution')
  `);
}

async function ensureActiveKemerbetAgent(client: Client): Promise<string> {
  const existing = await client.query<{ readonly id: string }>(`
    select agent.id
      from app.platform_agent_accounts agent
      join app.platforms platform on platform.id = agent.platform_id
     where platform.code = 'kemerbet'
       and agent.status = 'active'
     order by agent.created_at, agent.id
     limit 1
  `);
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const inserted = await client.query<{ readonly id: string }>(`
    insert into app.platform_agent_accounts (platform_id, label, credential_ref)
    select platform.id,
           'production-command-sql-agent',
           'secret://production-command-sql-agent'
      from app.platforms platform
     where platform.code = 'kemerbet'
    returning id
  `);
  expect(inserted.rows).toHaveLength(1);
  return inserted.rows[0]!.id;
}

async function ensureActiveTelebirrReceiver(client: Client): Promise<void> {
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
     ) select provider.id, 1, 'Synthetic Credited Test Receiver',
              $1::text, '***7300', repeat('7', 64), 1, 1, 1,
              $2::uuid, 'initial_configuration'
         from app.payment_providers provider where provider.code = 'telebirr'`,
    [`receiver-v1.telebirr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(16)}`, randomUUID()],
  );
}

async function rotateActiveKemerbetAgent(client: Client, suffix: string): Promise<void> {
  await client.query(`
    update app.platform_agent_accounts agent
       set status = 'inactive'
      from app.platforms platform
     where platform.id = agent.platform_id
       and platform.code = 'kemerbet'
       and agent.status = 'active'
  `);
  await client.query(
    `insert into app.platform_agent_accounts (platform_id, label, credential_ref)
     select platform.id, $1::text, $2::text
       from app.platforms platform
      where platform.code = 'kemerbet'`,
    [`production-command-${suffix}`, `secret://production-command-${suffix}`],
  );
}

export async function createVerifiedDepositFixture(
  client: Client,
  suffix: string,
  options: {
    readonly providerCode?: 'cbe_birr' | 'telebirr';
    readonly amountMinor?: number;
    readonly existingPlayer?: {
      readonly customerId: string;
      readonly playerAccountId: string;
      readonly playerId: string;
    };
  } = {},
): Promise<VerifiedDepositFixture> {
  const amountMinor = options.amountMinor ?? 2500;
  const referenceFingerprint = createHash('sha256')
    .update(`production-command-reference:${suffix}`, 'utf8')
    .digest('hex');
  await enableLiveDepositSwitches(client);
  await ensureActiveKemerbetAgent(client);

  const customer = options.existingPlayer
    ? null
    : await client.query<{ readonly id: string }>(
        `insert into app.customers default values returning id`,
      );
  const customerId = options.existingPlayer?.customerId ?? customer!.rows[0]!.id;
  const platform = await client.query<{ readonly id: string }>(
    `select id from app.platforms where code = 'kemerbet'`,
  );
  const playerId = options.existingPlayer?.playerId ?? `PRODUCTION-${suffix}`;
  let playerAccountId = options.existingPlayer?.playerAccountId;
  if (!playerAccountId) {
    const player = await client.query<{ readonly id: string }>(
      `insert into app.customer_platform_players (customer_id, platform_id, player_id)
       values ($1::uuid, $2::uuid, $3::text)
       returning id`,
      [customerId, platform.rows[0]!.id, playerId],
    );
    playerAccountId = player.rows[0]!.id;
    await client.query(
      `insert into app.player_validation_attempts (
         player_account_id, attempt_number, outcome, reason_code, adapter_version,
         started_at, completed_at, result_digest
       ) values (
         $1::uuid, 1, 'valid', 'production_command_fixture', 'fixture_v1',
         clock_timestamp() - interval '1 second', clock_timestamp(), $2::text
       )`,
      [playerAccountId, `production-command-validation-${suffix}`],
    );
    await client.query(
      `update app.customer_platform_players
          set validation_status = 'valid'
        where id = $1::uuid`,
      [playerAccountId],
    );
    await client.query(
      `insert into app.player_deposit_eligibility_decisions (
         player_account_id, decision_version, decision, reason_code, actor_kind
       ) values ($1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'system')`,
      [playerAccountId],
    );
  }

  const paymentBoundary = await client.query<{
    readonly payment_provider_id: string;
    readonly receiver_account_id: string;
  }>(
    `
    select provider.id as payment_provider_id,
           receiver.id as receiver_account_id
      from app.payment_providers provider
      join app.receiver_accounts receiver
        on receiver.provider_id = provider.id
       and receiver.status = 'active'
     where provider.code = $1::text
       and provider.status = 'active'
  `,
    [options.providerCode ?? 'cbe_birr'],
  );
  expect(paymentBoundary.rows).toHaveLength(1);

  const intent = await client.query<{
    readonly id: string;
    readonly opened_at: Date;
    readonly payment_deadline_at: Date;
    readonly receiver_account_version: number;
  }>(
    `insert into app.deposit_intents (
       customer_id, platform_id, player_account_id, payment_provider_id,
       receiver_account_id, expected_amount_minor
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::bigint)
     returning id, opened_at, payment_deadline_at, receiver_account_version`,
    [
      customerId,
      platform.rows[0]!.id,
      playerAccountId,
      paymentBoundary.rows[0]!.payment_provider_id,
      paymentBoundary.rows[0]!.receiver_account_id,
      amountMinor,
    ],
  );
  const depositIntentId = intent.rows[0]!.id;

  const submission = await client.query<{ readonly id: string }>(
    `insert into app.deposit_submissions (
       deposit_intent_id, submission_number, submitted_reference_ciphertext,
       submitted_reference_fingerprint, submitted_reference_masked,
       reference_encryption_key_version
     ) values ($1::uuid, 1, $2::text, $3::text, $4::text, 1)
     returning id`,
    [depositIntentId, `ciphertext-${suffix}`, referenceFingerprint, `***${suffix.slice(-4)}`],
  );

  await client.query(
    `update app.deposit_intents
        set status = 'verification_pending'
      where id = $1::uuid`,
    [depositIntentId],
  );
  await client.query(
    `update app.deposit_submissions
        set status = 'verification_enqueued'
      where id = $1::uuid`,
    [submission.rows[0]!.id],
  );

  const evidence = await client.query<{ readonly id: string }>(
    `insert into app.provider_payment_evidence (
       payment_provider_id, canonical_reference_ciphertext,
       canonical_reference_fingerprint, canonical_reference_masked,
       reference_encryption_key_version, evidence_source, amount_minor, currency_code,
       occurred_at, matched_receiver_account_id, matched_receiver_account_version,
       evidence_digest, adapter_version, normalization_version, retrieved_at
     ) values (
       $1::uuid, $2::text, $3::text, $4::text, 1, 'provider_receipt_lookup',
       $9::bigint, 'ETB', $5::timestamptz + interval '1 millisecond',
       $6::uuid, $7::integer, $8::text, 'fixture_v1', 'fixture_v1',
       $5::timestamptz + interval '2 milliseconds'
     )
     returning id`,
    [
      paymentBoundary.rows[0]!.payment_provider_id,
      `canonical-ciphertext-${suffix}`,
      referenceFingerprint,
      `***${suffix.slice(-4)}`,
      intent.rows[0]!.opened_at,
      paymentBoundary.rows[0]!.receiver_account_id,
      intent.rows[0]!.receiver_account_version,
      `evidence-digest-${suffix}`,
      amountMinor,
    ],
  );

  const verification = await client.query<{ readonly id: string }>(
    `insert into app.deposit_verification_attempts (
       deposit_intent_id, deposit_submission_id, attempt_number, outcome, reason_code,
       provider_payment_evidence_id, adapter_version, response_digest, started_at, completed_at
     ) values (
       $1::uuid, $2::uuid, 1, 'verified', 'provider_payment_verified',
       $3::uuid, 'fixture_v1', $4::text,
       clock_timestamp() - interval '1 second', clock_timestamp()
     )
     returning id`,
    [
      depositIntentId,
      submission.rows[0]!.id,
      evidence.rows[0]!.id,
      `verification-response-${suffix}`,
    ],
  );

  return {
    depositIntentId,
    evidenceId: evidence.rows[0]!.id,
    playerId,
    verificationAttemptId: verification.rows[0]!.id,
  };
}

type SettledDeposit = {
  readonly already_finalized: boolean;
  readonly deposit_intent_id: string;
  readonly deposit_status: string;
  readonly execution_job_id: string;
  readonly execution_job_status: string;
  readonly payment_claim_id: string;
  readonly updated_at: Date;
};

async function settleVerifiedDeposit(
  client: Client,
  fixture: VerifiedDepositFixture,
): Promise<SettledDeposit> {
  const settled = await queryAsSettlement<SettledDeposit>(
    client,
    `select *
       from ${settlementFunction}($1::uuid, $2::uuid, $3::uuid)`,
    [fixture.depositIntentId, fixture.verificationAttemptId, fixture.evidenceId],
  );
  expect(settled).toHaveLength(1);
  return settled[0]!;
}

async function enqueueAndLease(
  client: Client,
  fixture: VerifiedDepositFixture,
  workerId: string,
): Promise<{
  readonly executionAttemptId: string;
  readonly executionJobId: string;
  readonly executionLeaseToken: string;
}> {
  const settled = await settleVerifiedDeposit(client, fixture);
  expect(settled).toEqual({
    already_finalized: false,
    deposit_intent_id: fixture.depositIntentId,
    deposit_status: 'execution_pending',
    execution_job_id: expect.any(String),
    execution_job_status: 'queued',
    payment_claim_id: expect.any(String),
    updated_at: expect.any(Date),
  });

  const replay = await settleVerifiedDeposit(client, fixture);
  expect(replay).toEqual({
    ...settled,
    already_finalized: true,
  });

  const leased = await queryAsExecutor<{
    readonly amount_minor: string;
    readonly currency_code: string;
    readonly deposit_intent_id: string;
    readonly execution_attempt_id: string;
    readonly execution_job_id: string;
    readonly lease_disposition: string;
    readonly lease_expires_at: Date;
    readonly lease_token: string;
    readonly player_id: string;
  }>(client, `select * from app.lease_next_deposit_execution($1::uuid, 300)`, [workerId]);
  expect(leased).toEqual([
    {
      amount_minor: '2500',
      currency_code: 'ETB',
      deposit_intent_id: fixture.depositIntentId,
      execution_attempt_id: expect.any(String),
      execution_job_id: settled.execution_job_id,
      lease_disposition: 'execution',
      lease_expires_at: expect.any(Date),
      lease_token: expect.any(String),
      platform_agent_account_id: expect.any(String),
      player_id: fixture.playerId,
    },
  ]);

  return {
    executionAttemptId: leased[0]!.execution_attempt_id,
    executionJobId: settled.execution_job_id,
    executionLeaseToken: leased[0]!.lease_token,
  };
}

export function registerDepositExecutionCommandSqlTests(
  getClient: ClientGetter,
  getOwnerAdminId: () => string,
): void {
  describe('private production deposit execution commands', () => {
    it('pins the consume-only executor roles, grants, and zero direct ledger access', async () => {
      const client = getClient();
      const roles = await client.query<{
        readonly rolbypassrls: boolean;
        readonly rolcanlogin: boolean;
        readonly rolconnlimit: number;
        readonly rolinherit: boolean;
        readonly rolname: string;
        readonly rolsuper: boolean;
      }>(`
        select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolconnlimit
          from pg_roles
         where rolname in ('fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime')
         order by rolname
      `);
      expect(roles.rows).toEqual([
        {
          rolbypassrls: false,
          rolcanlogin: false,
          rolconnlimit: 2,
          rolinherit: false,
          rolname: 'fetanagent_deposit_executor',
          rolsuper: false,
        },
        {
          rolbypassrls: false,
          rolcanlogin: false,
          rolconnlimit: 1,
          rolinherit: false,
          rolname: 'fetanagent_deposit_executor_runtime',
          rolsuper: false,
        },
      ]);

      const membership = await client.query<{
        readonly admin_option: boolean;
        readonly group_role: string;
        readonly inherit_option: boolean;
        readonly member_role: string;
        readonly set_option: boolean;
      }>(`
        select group_role.rolname as group_role,
               member_role.rolname as member_role,
               membership.inherit_option,
               membership.set_option,
               membership.admin_option
          from pg_auth_members membership
          join pg_roles group_role on group_role.oid = membership.roleid
          join pg_roles member_role on member_role.oid = membership.member
         where group_role.rolname = 'fetanagent_deposit_executor'
            or member_role.rolname = 'fetanagent_deposit_executor_runtime'
      `);
      expect(membership.rows).toEqual([
        {
          admin_option: false,
          group_role: 'fetanagent_deposit_executor',
          inherit_option: true,
          member_role: 'fetanagent_deposit_executor_runtime',
          set_option: false,
        },
      ]);

      const effectiveFunctions = await client.query<{ readonly signature: string }>(`
        select procedure.oid::regprocedure::text as signature
          from pg_proc procedure
          join pg_namespace namespace on namespace.oid = procedure.pronamespace
         where namespace.nspname = 'app'
           and has_function_privilege(
             'fetanagent_deposit_executor_runtime', procedure.oid, 'EXECUTE'
           )
         order by signature
      `);
      expect(effectiveFunctions.rows.map((row) => row.signature)).toEqual(executorFunctions);

      const revokedPilotPrimitives = await client.query<{
        readonly allowed: boolean;
        readonly role_name: string;
        readonly signature: string;
      }>(`
        select candidate.role_name,
               candidate.signature,
               has_function_privilege(
                 candidate.role_name,
                 candidate.signature::regprocedure,
                 'EXECUTE'
               ) as allowed
          from (values
            ('fetanagent_deposit_executor',
             'app.lease_next_deposit_execution(uuid,integer)'),
            ('fetanagent_deposit_executor_runtime',
             'app.lease_next_deposit_execution(uuid,integer)'),
            ('fetanagent_deposit_executor',
             'app.fence_deposit_execution_final_action(uuid,uuid)'),
            ('fetanagent_deposit_executor_runtime',
             'app.fence_deposit_execution_final_action(uuid,uuid)'),
            ('fetanagent_verification_settlement',
             'app.finalize_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)'),
            ('fetanagent_verification_settlement_runtime',
             'app.finalize_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)')
          ) candidate(role_name, signature)
         order by candidate.role_name, candidate.signature
      `);
      expect(revokedPilotPrimitives.rows).toHaveLength(6);
      expect(revokedPilotPrimitives.rows.every((row) => !row.allowed)).toBe(true);

      const enqueuePrivileges = await client.query<{
        readonly allowed: boolean;
        readonly role_name: string;
      }>(`
        select role_name,
               has_function_privilege(
                 role_name,
                 'app.enqueue_verified_deposit_execution(uuid)'::regprocedure,
                 'EXECUTE'
               ) as allowed
          from unnest(array[
            'anon', 'authenticated', 'service_role',
            'fetanagent_api', 'fetanagent_api_runtime', 'fetanagent_worker',
            'fetanagent_player_actions', 'fetanagent_player_actions_runtime',
            'fetanagent_customer_web', 'fetanagent_customer_web_runtime',
            'fetanagent_verification_settlement',
            'fetanagent_verification_settlement_runtime',
            'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
          ]) role_name
         order by role_name
      `);
      expect(enqueuePrivileges.rows.every((row) => !row.allowed)).toBe(true);
      expect(enqueuePrivileges.rows).toHaveLength(14);

      const nonOwnerEnqueueAcl = await client.query<{ readonly grantee: string }>(`
        select coalesce(grantee.rolname, 'PUBLIC') as grantee
          from pg_proc procedure
          cross join lateral aclexplode(
            coalesce(procedure.proacl, acldefault('f', procedure.proowner))
          ) privilege
          left join pg_roles grantee on grantee.oid = privilege.grantee
         where procedure.oid = 'app.enqueue_verified_deposit_execution(uuid)'::regprocedure
           and privilege.grantee <> procedure.proowner
         order by grantee
      `);
      expect(nonOwnerEnqueueAcl.rows).toEqual([]);

      const directTableAccess = await client.query<{ readonly allowed: boolean }>(`
        select has_table_privilege(
                 role_name,
                 'app.' || table_name,
                 'SELECT,INSERT,UPDATE,DELETE'
               ) as allowed
          from unnest(array[
            'fetanagent_deposit_executor',
            'fetanagent_deposit_executor_runtime',
            'anon', 'authenticated', 'service_role'
          ]) role_name
          cross join unnest(array[
            'deposit_intents',
            'deposit_payment_claims',
            'deposit_review_cases',
            'deposit_jobs',
            'deposit_execution_attempts',
            'execution_reconciliations',
            'player_deposit_eligibility_decisions'
          ]) table_name
      `);
      expect(directTableAccess.rows.every((row) => !row.allowed)).toBe(true);

      const functionSource = await client.query<{ readonly source: string }>(`
        select lower(pg_get_functiondef(
          'app.enqueue_verified_deposit_execution(uuid)'::regprocedure
        )) as source
      `);
      expect(functionSource.rows[0]!.source).toContain('expected_amount_minor < 2500');
      expect(functionSource.rows[0]!.source).toContain('expected_amount_minor > 2500000');
      expect(functionSource.rows[0]!.source).toContain('maximum_amount_minor');
      expect(functionSource.rows[0]!.source).toContain('deposit_payment_claims');
      expect(functionSource.rows[0]!.source).toContain('player_deposit_eligibility_decisions');
      expect(functionSource.rows[0]!.source).toContain("feature_switch.mode = 'live'");

      const leaseContract = await client.query<{ readonly result_type: string }>(`
        select lower(pg_get_function_result(
                 'app.lease_next_deposit_execution(uuid,integer)'::regprocedure
               )) as result_type
      `);
      expect(leaseContract.rows[0]!.result_type).toContain('lease_disposition text');
      expect(leaseContract.rows[0]!.result_type).toContain('execution_job_id uuid');
    });

    it('acquires the shared intent advisory lock before every transition row lock', async () => {
      const client = getClient();
      const definitions = await client.query<{
        readonly function_name: string;
        readonly source: string;
      }>(`
        select procedure.proname as function_name,
               lower(pg_get_functiondef(procedure.oid)) as source
          from pg_proc procedure
          join pg_namespace namespace on namespace.oid = procedure.pronamespace
         where namespace.nspname = 'app'
           and procedure.proname in (
             'cancel_deposit_execution_before_action',
             'fence_deposit_execution_final_action',
             'require_deposit_execution_reconciliation'
           )
         order by procedure.proname
      `);
      expect(definitions.rows).toHaveLength(3);

      for (const definition of definitions.rows) {
        const resolveIndex = definition.source.indexOf('select attempt.deposit_intent_id');
        const advisoryIndex = definition.source.indexOf(
          'pg_catalog.hashtextextended(resolved_deposit_intent_id::text, 20260815203606)',
        );
        const lockedAttemptIndex = definition.source.indexOf('select attempt.*', advisoryIndex);
        const firstRowLockIndex = definition.source.indexOf('for update', lockedAttemptIndex);
        const revalidationIndex = definition.source.indexOf(
          'attempt_row.deposit_intent_id is distinct from resolved_deposit_intent_id',
        );

        expect(resolveIndex, definition.function_name).toBeGreaterThan(0);
        expect(advisoryIndex, definition.function_name).toBeGreaterThan(resolveIndex);
        expect(lockedAttemptIndex, definition.function_name).toBeGreaterThan(advisoryIndex);
        expect(firstRowLockIndex, definition.function_name).toBeGreaterThan(lockedAttemptIndex);
        expect(revalidationIndex, definition.function_name).toBeGreaterThan(firstRowLockIndex);
        expect(definition.source.slice(resolveIndex, advisoryIndex)).not.toContain('for update');
      }
    });

    it('denies direct enqueue to the consume-only executor without mutating proof state', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createVerifiedDepositFixture(client, 'DIRECT-ENQUEUE-DENIED');

        await expect(
          queryAsExecutor(
            client,
            `select * from app.enqueue_verified_deposit_execution($1::uuid)`,
            [fixture.depositIntentId],
          ),
        ).rejects.toThrow(/permission denied for function enqueue_verified_deposit_execution/u);

        const state = await client.query<{
          readonly claims: number;
          readonly execution_jobs: number;
          readonly status: string;
        }>(
          `select intent.status::text as status,
                  (select count(*)::integer from app.deposit_payment_claims claim
                    where claim.deposit_intent_id = intent.id) as claims,
                  (select count(*)::integer from app.deposit_jobs job
                    where job.deposit_intent_id = intent.id
                      and job.job_kind = 'execute_deposit') as execution_jobs
             from app.deposit_intents intent
            where intent.id = $1::uuid`,
          [fixture.depositIntentId],
        );
        expect(state.rows).toEqual([
          { claims: 0, execution_jobs: 0, status: 'verification_pending' },
        ]);
      });
    });

    it('fails closed at settlement when a live switch is off without partial writes', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createVerifiedDepositFixture(client, 'SWITCH-GATE');
        await client.query(`
          update app.feature_switches
             set mode = 'disabled'
           where feature_key = 'deposit_execution'
        `);

        try {
          await expect(settleVerifiedDeposit(client, fixture)).rejects.toThrow(
            'Verified deposit settlement requires both live financial switches',
          );

          const state = await client.query<{
            readonly claims: number;
            readonly execution_jobs: number;
            readonly status: string;
          }>(
            `select intent.status::text as status,
                    (select count(*)::integer from app.deposit_payment_claims claim
                      where claim.deposit_intent_id = intent.id) as claims,
                    (select count(*)::integer from app.deposit_jobs job
                      where job.deposit_intent_id = intent.id
                        and job.job_kind = 'execute_deposit') as execution_jobs
               from app.deposit_intents intent
              where intent.id = $1::uuid`,
            [fixture.depositIntentId],
          );
          expect(state.rows).toEqual([
            { claims: 0, execution_jobs: 0, status: 'verification_pending' },
          ]);
        } finally {
          await enableLiveDepositSwitches(client);
        }
      });
    });

    it('returns a recovery sentinel without leasing unrelated work in the same call', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const expiredFixture = await createVerifiedDepositFixture(client, 'PRE-FENCE-CRASH');
        const expiredExecution = await enqueueAndLease(
          client,
          expiredFixture,
          '87777777-7777-4777-8777-777777777777',
        );
        const nextFixture = await createVerifiedDepositFixture(client, 'AFTER-PRE-FENCE-CRASH');
        const nextSettlement = await settleVerifiedDeposit(client, nextFixture);
        expect(nextSettlement.already_finalized).toBe(false);

        await client.query(
          `update app.deposit_jobs
              set lease_expires_at = clock_timestamp() - interval '1 second'
            where id = $1::uuid`,
          [expiredExecution.executionJobId],
        );

        const recoverySentinel = await queryAsExecutor<{
          readonly deposit_intent_id: string;
          readonly execution_attempt_id: string;
          readonly execution_job_id: string | null;
          readonly lease_disposition: string;
          readonly lease_expires_at: Date | null;
          readonly lease_token: string | null;
          readonly player_id: string | null;
        }>(client, `select * from app.lease_next_deposit_execution($1::uuid, 300)`, [
          '88888888-8888-4888-8888-888888888888',
        ]);
        expect(recoverySentinel).toEqual([
          {
            amount_minor: null,
            currency_code: null,
            deposit_intent_id: expiredFixture.depositIntentId,
            execution_attempt_id: expiredExecution.executionAttemptId,
            execution_job_id: null,
            lease_disposition: 'recovered_expired_prepared',
            lease_expires_at: null,
            lease_token: null,
            platform_agent_account_id: null,
            player_id: null,
          },
        ]);

        const untouchedNext = await client.query<{
          readonly attempts: number;
          readonly job_status: string;
        }>(
          `select job.status::text as job_status,
                  (select count(*)::integer
                     from app.deposit_execution_attempts attempt
                    where attempt.deposit_intent_id = job.deposit_intent_id) as attempts
             from app.deposit_jobs job
            where job.id = $1::uuid`,
          [nextSettlement.execution_job_id],
        );
        expect(untouchedNext.rows).toEqual([{ attempts: 0, job_status: 'queued' }]);

        const nextLease = await queryAsExecutor<{
          readonly deposit_intent_id: string;
          readonly execution_job_id: string;
          readonly lease_disposition: string;
          readonly player_id: string;
        }>(client, `select * from app.lease_next_deposit_execution($1::uuid, 300)`, [
          '88888888-8888-4888-8888-888888888888',
        ]);
        expect(nextLease).toHaveLength(1);
        expect(nextLease[0]).toMatchObject({
          deposit_intent_id: nextFixture.depositIntentId,
          execution_job_id: nextSettlement.execution_job_id,
          lease_disposition: 'execution',
          player_id: nextFixture.playerId,
        });

        const recovered = await client.query<{
          readonly attempt_status: string;
          readonly deposit_status: string;
          readonly execution_attempts: number;
          readonly execution_jobs: number;
          readonly job_error_code: string;
          readonly job_status: string;
          readonly lease_cleared: boolean;
          readonly review_cases: number;
          readonly retry_jobs: number;
        }>(
          `select attempt.status::text as attempt_status,
                intent.status::text as deposit_status,
                job.status::text as job_status,
                job.last_error_code as job_error_code,
                (job.lease_token is null and job.leased_by is null
                  and job.lease_expires_at is null) as lease_cleared,
                (select count(*)::integer
                   from app.deposit_execution_attempts history
                  where history.deposit_intent_id = intent.id) as execution_attempts,
                (select count(*)::integer
                   from app.deposit_jobs history
                  where history.deposit_intent_id = intent.id
                    and history.job_kind = 'execute_deposit') as execution_jobs,
                (select count(*)::integer
                   from app.deposit_jobs history
                  where history.deposit_intent_id = intent.id
                    and history.job_kind = 'execute_deposit'
                    and history.status = 'retry_wait') as retry_jobs,
                (select count(*)::integer
                   from app.deposit_review_cases review_case
                  where review_case.deposit_intent_id = intent.id
                    and review_case.review_kind = 'execution'
                    and review_case.status = 'open'
                    and review_case.reason_code =
                      'execution_lease_expired_before_action') as review_cases
           from app.deposit_intents intent
           join app.deposit_execution_attempts attempt
             on attempt.deposit_intent_id = intent.id
           join app.deposit_jobs job on job.id = attempt.deposit_job_id
          where intent.id = $1::uuid`,
          [expiredFixture.depositIntentId],
        );
        expect(recovered.rows).toEqual([
          {
            attempt_status: 'cancelled_before_action',
            deposit_status: 'execution_review',
            execution_attempts: 1,
            execution_jobs: 1,
            job_error_code: 'execution_lease_expired_before_action',
            job_status: 'cancelled',
            lease_cleared: true,
            review_cases: 1,
            retry_jobs: 0,
          },
        ]);

        await expect(
          queryAsExecutor(
            client,
            `select * from app.fence_deposit_execution_final_action($1::uuid, $2::uuid)`,
            [expiredExecution.executionAttemptId, expiredExecution.executionLeaseToken],
          ),
        ).rejects.toThrow('one-shot deposit execution lease is unavailable for fencing');
      });
    });

    it('persists the modal player-credit fact for a new reconciliation worker', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createVerifiedDepositFixture(client, 'CRASH-RECOVERY');
        const execution = await enqueueAndLease(
          client,
          fixture,
          '81111111-1111-4111-8111-111111111111',
        );

        const firstFence = await queryAsExecutor<{
          readonly final_action_fenced_at: Date;
          readonly first_fence_acquired: boolean;
        }>(
          client,
          `select final_action_fenced_at, first_fence_acquired
           from app.fence_deposit_execution_final_action($1::uuid, $2::uuid)`,
          [execution.executionAttemptId, execution.executionLeaseToken],
        );
        expect(firstFence).toEqual([
          { final_action_fenced_at: expect.any(Date), first_fence_acquired: true },
        ]);

        const fenceReplay = await queryAsExecutor<{ readonly first_fence_acquired: boolean }>(
          client,
          `select first_fence_acquired
           from app.fence_deposit_execution_final_action($1::uuid, $2::uuid)`,
          [execution.executionAttemptId, execution.executionLeaseToken],
        );
        expect(fenceReplay).toEqual([{ first_fence_acquired: false }]);

        const required = await queryAsExecutor<{
          readonly recovery_handoff: boolean;
        }>(
          client,
          `select recovery_handoff
           from app.require_deposit_execution_reconciliation($1::uuid, $2::uuid, true)`,
          [execution.executionAttemptId, execution.executionLeaseToken],
        );
        expect(required).toEqual([{ recovery_handoff: false }]);

        await expect(
          withSavepoint(client, () =>
            client.query(
              `update app.deposit_execution_attempts
                  set exact_player_credit_match = false
                where id = $1::uuid`,
              [execution.executionAttemptId],
            ),
          ),
        ).rejects.toThrow('exact player-credit fact is immutable');

        const reconciliationLease = await queryAsExecutor<{
          readonly amount_minor: string;
          readonly deposit_intent_id: string;
          readonly exact_player_credit_match: boolean;
          readonly execution_attempt_id: string;
          readonly final_action_fenced_at: Date;
          readonly lease_expires_at: Date;
          readonly lease_token: string;
          readonly player_id: string;
          readonly reconciliation_job_id: string;
          readonly reconciliation_required_at: Date;
        }>(client, `select * from app.lease_next_deposit_execution_reconciliation($1::uuid, 300)`, [
          '82222222-2222-4222-8222-222222222222',
        ]);
        expect(reconciliationLease).toHaveLength(1);
        expect(reconciliationLease[0]).toMatchObject({
          amount_minor: '2500',
          deposit_intent_id: fixture.depositIntentId,
          exact_player_credit_match: true,
          execution_attempt_id: execution.executionAttemptId,
          final_action_fenced_at: firstFence[0]!.final_action_fenced_at,
          lease_token: expect.any(String),
          player_id: fixture.playerId,
          reconciliation_job_id: expect.any(String),
        });
        expect(reconciliationLease[0]!.final_action_fenced_at.getTime()).toBeLessThanOrEqual(
          reconciliationLease[0]!.reconciliation_required_at.getTime(),
        );
        expect(reconciliationLease[0]!.reconciliation_required_at.getTime()).toBeLessThan(
          reconciliationLease[0]!.lease_expires_at.getTime(),
        );

        const postRecoveryFenceReplay = await queryAsExecutor<{
          readonly first_fence_acquired: boolean;
        }>(
          client,
          `select first_fence_acquired
           from app.fence_deposit_execution_final_action($1::uuid, $2::uuid)`,
          [execution.executionAttemptId, execution.executionLeaseToken],
        );
        expect(postRecoveryFenceReplay).toEqual([{ first_fence_acquired: false }]);

        const matchedHistory = await client.query<{
          readonly matched_history_occurred_at: string;
        }>(
          `select (
             attempt.final_action_fenced_at
               + (
                   attempt.reconciliation_required_at
                     - attempt.final_action_fenced_at
                 ) / 2
           )::text as matched_history_occurred_at
             from app.deposit_execution_attempts attempt
            where attempt.id = $1::uuid
              and attempt.final_action_fenced_at is not null
              and attempt.reconciliation_required_at is not null`,
          [execution.executionAttemptId],
        );
        expect(matchedHistory.rows).toHaveLength(1);

        const reconciled = await queryAsExecutor<{
          readonly attempt_status: string;
          readonly deposit_status: string;
          readonly follow_up_job_id: string | null;
          readonly outcome: string;
          readonly reason_code: string;
        }>(
          client,
          `select attempt_status, deposit_status, follow_up_job_id, outcome, reason_code
           from app.record_deposit_execution_reconciliation(
             $1::uuid, $2::uuid, 'confirmed_executed', $3::text, 1::smallint,
             'deposit', $4::timestamptz, true, true, true, true
           )`,
          [
            reconciliationLease[0]!.reconciliation_job_id,
            reconciliationLease[0]!.lease_token,
            `hmac-sha256-v1:${'c'.repeat(64)}`,
            matchedHistory.rows[0]!.matched_history_occurred_at,
          ],
        );
        expect(reconciled).toEqual([
          {
            attempt_status: 'confirmed_executed',
            deposit_status: 'executed',
            follow_up_job_id: null,
            outcome: 'confirmed_executed',
            reason_code: 'agent_deposit_history_in_window_and_player_credit_confirmed',
          },
        ]);

        const oneShot = await client.query<{
          readonly execution_attempts: number;
          readonly execution_jobs: number;
        }>(
          `select
           (select count(*)::integer from app.deposit_execution_attempts
             where deposit_intent_id = $1::uuid) as execution_attempts,
           (select count(*)::integer from app.deposit_jobs
             where deposit_intent_id = $1::uuid and job_kind = 'execute_deposit')
             as execution_jobs`,
          [fixture.depositIntentId],
        );
        expect(oneShot.rows).toEqual([{ execution_attempts: 1, execution_jobs: 1 }]);
      });
    });

    it('fails closed when a fenced worker crashes before persisting the modal fact', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createVerifiedDepositFixture(client, 'FENCED-FACT-CRASH');
        const execution = await enqueueAndLease(
          client,
          fixture,
          '89999999-9999-4999-8999-999999999999',
        );
        const fence = await queryAsExecutor<{ readonly final_action_fenced_at: Date }>(
          client,
          `select final_action_fenced_at
           from app.fence_deposit_execution_final_action($1::uuid, $2::uuid)`,
          [execution.executionAttemptId, execution.executionLeaseToken],
        );

        await client.query(
          `update app.deposit_jobs
            set lease_expires_at = clock_timestamp() - interval '1 second'
          where id = $1::uuid`,
          [execution.executionJobId],
        );

        const lease = await queryAsExecutor<{
          readonly exact_player_credit_match: boolean | null;
          readonly lease_token: string;
          readonly reconciliation_job_id: string;
        }>(client, `select * from app.lease_next_deposit_execution_reconciliation($1::uuid, 300)`, [
          '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ]);
        expect(lease).toHaveLength(1);
        expect(lease[0]!.exact_player_credit_match).toBeNull();

        await expect(
          queryAsExecutor(
            client,
            `select * from app.record_deposit_execution_reconciliation(
             $1::uuid, $2::uuid, 'confirmed_executed', $3::text, 1::smallint,
             'deposit', $4::timestamptz, true, true, true, true
           )`,
            [
              lease[0]!.reconciliation_job_id,
              lease[0]!.lease_token,
              `hmac-sha256-v1:${'d'.repeat(64)}`,
              fence[0]!.final_action_fenced_at,
            ],
          ),
        ).rejects.toThrow('exact player-credit reconciliation fact does not match');

        const failClosed = await queryAsExecutor<{
          readonly attempt_status: string;
          readonly deposit_status: string;
          readonly follow_up_job_id: string | null;
          readonly outcome: string;
          readonly reason_code: string;
        }>(
          client,
          `select attempt_status, deposit_status, follow_up_job_id, outcome, reason_code
           from app.record_deposit_execution_reconciliation(
             $1::uuid, $2::uuid, 'confirmed_executed', $3::text, 1::smallint,
             'deposit', $4::timestamptz, null, true, true, true
           )`,
          [
            lease[0]!.reconciliation_job_id,
            lease[0]!.lease_token,
            `hmac-sha256-v1:${'d'.repeat(64)}`,
            fence[0]!.final_action_fenced_at,
          ],
        );
        expect(failClosed).toEqual([
          {
            attempt_status: 'review_required',
            deposit_status: 'execution_review',
            follow_up_job_id: null,
            outcome: 'ambiguous',
            reason_code: 'agent_history_ambiguous',
          },
        ]);

        const oneShot = await client.query<{
          readonly execution_attempts: number;
          readonly execution_jobs: number;
        }>(
          `select
           (select count(*)::integer from app.deposit_execution_attempts
             where deposit_intent_id = $1::uuid) as execution_attempts,
           (select count(*)::integer from app.deposit_jobs
             where deposit_intent_id = $1::uuid and job_kind = 'execute_deposit')
             as execution_jobs`,
          [fixture.depositIntentId],
        );
        expect(oneShot.rows).toEqual([{ execution_attempts: 1, execution_jobs: 1 }]);
        await rotateActiveKemerbetAgent(client, 'after-fenced-fact-crash');
      });
    });

    it('reconciles an Owner-confirmed 30 ETB credit without a second execution', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        await ensureActiveTelebirrReceiver(client);
        const fixture = await createVerifiedDepositFixture(client, 'OWNER-CREDITED-30', {
          providerCode: 'telebirr',
          amountMinor: 3000,
        });
        const settled = await settleVerifiedDeposit(client, fixture);
        // Arrange the already-fenced historical incident without manufacturing a
        // live Owner approval or activation epoch. The trigger is restored before
        // exercising the gates-off resolution under test.
        await client.query(
          `alter table app.deposit_jobs
             disable trigger deposit_jobs_require_owner_approved_telebirr_execution`,
        );
        const leased = await queryAsExecutor<{
          readonly execution_attempt_id: string;
          readonly execution_job_id: string;
          readonly lease_token: string;
        }>(client, `select * from app.lease_next_deposit_execution($1::uuid, 300)`, [
          '92222222-2222-4222-8222-222222222222',
        ]);
        await client.query(
          `alter table app.deposit_jobs
             enable trigger deposit_jobs_require_owner_approved_telebirr_execution`,
        );
        expect(leased).toHaveLength(1);
        expect(leased[0]!.execution_job_id).toBe(settled.execution_job_id);
        const attemptId = leased[0]!.execution_attempt_id;
        // Preserve PostgreSQL microseconds: the JS Date parser truncates the
        // fence and would put the synthetic history instant just before it.
        const fence = await queryAsExecutor<{ readonly final_action_fenced_at: string }>(
          client,
          `select final_action_fenced_at::text as final_action_fenced_at
             from app.fence_deposit_execution_final_action($1::uuid, $2::uuid)`,
          [attemptId, leased[0]!.lease_token],
        );
        expect(fence).toHaveLength(1);
        await client.query(
          `update app.deposit_jobs
              set lease_expires_at = clock_timestamp() - interval '1 second'
            where id = $1::uuid`,
          [settled.execution_job_id],
        );

        const requestKey = '93333333-3333-4333-8333-333333333333';
        const fingerprint = `hmac-sha256-v1:${'e'.repeat(64)}`;
        const resolve = (attested: boolean, playerId = fixture.playerId, key = requestKey) =>
          client.query<{ readonly resolution_state: string; readonly replayed: boolean }>(
            `select * from app.resolve_owner_confirmed_fenced_test_credit(
              $1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz,
              $6::text, 3000::bigint, true, $7::boolean, true
            )`,
            [
              getOwnerAdminId(),
              attemptId,
              key,
              fingerprint,
              fence[0]!.final_action_fenced_at,
              playerId,
              attested,
            ],
          );
        await expect(withSavepoint(client, () => resolve(true))).rejects.toThrow(
          'dormant financial authority',
        );
        await client.query(`
          update app.feature_switches
             set mode = 'disabled', settings = '{}'::jsonb
           where feature_key in (
             'cbe_birr_authoritative_verification', 'deposit_execution',
             'payment_verification', 'private_live_deposit_pilot',
             'telebirr_authoritative_verification', 'withdrawal_collection',
             'withdrawal_validation'
           )
        `);
        await expect(withSavepoint(client, () => resolve(false))).rejects.toThrow(
          'attestation is incomplete',
        );
        await expect(withSavepoint(client, () => resolve(true, 'OTHER-PLAYER'))).rejects.toThrow(
          'lineage is not eligible',
        );

        const arranged = await client.query(
          `select
             attempt.status::text as attempt_status,
             attempt.exact_player_credit_match as exact_player_credit_match,
             intent.status::text as intent_status,
             intent.expected_amount_minor as amount_minor,
             provider.code::text as provider_code,
             platform.code::text as platform_code,
             player.player_id = $2::text as player_matches,
             job.status::text as execution_job_status,
             job.attempt_count as execution_attempt_count,
             job.max_attempts as execution_max_attempts,
             job.lease_expires_at <= clock_timestamp() as lease_expired,
             attempt.final_action_fenced_at is not null as fenced,
             $3::timestamptz between attempt.final_action_fenced_at
               and clock_timestamp() as history_in_window,
             (select count(*)::integer from app.deposit_execution_attempts other_attempt
               where other_attempt.deposit_intent_id = intent.id) as attempt_count,
             (select count(*)::integer from app.deposit_jobs other_job
               where other_job.job_kind in ('execute_deposit', 'reconcile_execution')
                 and other_job.status in ('queued', 'leased', 'retry_wait')
                 and other_job.id <> job.id) as other_active_jobs,
             (select count(*)::integer from app.deposit_execution_attempts other_attempt
               where other_attempt.id <> attempt.id
                 and other_attempt.status in (
                   'prepared', 'final_action_fenced',
                   'reconciliation_required', 'review_required'
                 )) as other_blocking_attempts,
             (select count(*)::integer from app.routine_telebirr_dispatch_evidence evidence
               where evidence.execution_attempt_id = attempt.id) as dispatches,
             (select count(*)::integer from app.execution_reconciliations reconciliation
               where reconciliation.deposit_execution_attempt_id = attempt.id)
               as reconciliations,
             (select count(*)::integer from app.deposit_review_cases review_case
               where review_case.deposit_intent_id = intent.id) as review_cases
           from app.deposit_execution_attempts attempt
           join app.deposit_intents intent on intent.id = attempt.deposit_intent_id
           join app.deposit_jobs job on job.id = attempt.deposit_job_id
           join app.payment_providers provider on provider.id = intent.payment_provider_id
           join app.platforms platform on platform.id = intent.platform_id
           join app.customer_platform_players player on player.id = intent.player_account_id
           where attempt.id = $1::uuid`,
          [attemptId, fixture.playerId, fence[0]!.final_action_fenced_at],
        );
        expect(arranged.rows).toEqual([
          {
            attempt_status: 'final_action_fenced',
            exact_player_credit_match: null,
            intent_status: 'execution_in_progress',
            amount_minor: '3000',
            provider_code: 'telebirr',
            platform_code: 'kemerbet',
            player_matches: true,
            execution_job_status: 'leased',
            execution_attempt_count: 1,
            execution_max_attempts: 1,
            lease_expired: true,
            fenced: true,
            history_in_window: true,
            attempt_count: 1,
            other_active_jobs: 0,
            other_blocking_attempts: 0,
            dispatches: 0,
            reconciliations: 0,
            review_cases: 0,
          },
        ]);

        const first = await resolve(true);
        expect(first.rows).toEqual([{ resolution_state: 'confirmed_executed', replayed: false }]);
        const replay = await resolve(true);
        expect(replay.rows).toEqual([{ resolution_state: 'confirmed_executed', replayed: true }]);
        await expect(
          withSavepoint(client, () =>
            resolve(true, fixture.playerId, '94444444-4444-4444-8444-444444444444'),
          ),
        ).rejects.toThrow('conflicts with its immutable receipt');

        const final = await client.query<{
          readonly attempt_status: string;
          readonly execution_jobs: number;
          readonly intent_status: string;
          readonly reconciliation_jobs: number;
          readonly reconciliations: number;
          readonly receipts: number;
          readonly dispatches: number;
          readonly switch_live_count: number;
        }>(
          `select attempt.status::text as attempt_status,
                  intent.status::text as intent_status,
                  (select count(*)::integer from app.deposit_jobs job
                    where job.deposit_intent_id = intent.id
                      and job.job_kind = 'execute_deposit') as execution_jobs,
                  (select count(*)::integer from app.deposit_jobs job
                    where job.deposit_intent_id = intent.id
                      and job.job_kind = 'reconcile_execution') as reconciliation_jobs,
                  (select count(*)::integer from app.execution_reconciliations item
                    where item.deposit_execution_attempt_id = attempt.id) as reconciliations,
                  (select count(*)::integer from app.owner_confirmed_fenced_test_credits item
                    where item.execution_attempt_id = attempt.id) as receipts,
                  (select count(*)::integer from app.routine_telebirr_dispatch_evidence item
                    where item.execution_attempt_id = attempt.id) as dispatches,
                  (select count(*)::integer from app.feature_switches feature_switch
                    where feature_switch.mode = 'live') as switch_live_count
             from app.deposit_intents intent
             join app.deposit_execution_attempts attempt
               on attempt.deposit_intent_id = intent.id
            where intent.id = $1::uuid`,
          [fixture.depositIntentId],
        );
        expect(final.rows).toEqual([
          {
            attempt_status: 'confirmed_executed',
            intent_status: 'executed',
            execution_jobs: 1,
            reconciliation_jobs: 1,
            reconciliations: 1,
            receipts: 1,
            dispatches: 0,
            switch_live_count: 0,
          },
        ]);
        const permissions = await client.query<{ readonly executor_allowed: boolean }>(
          `select pg_catalog.has_function_privilege(
             'fetanagent_deposit_executor',
             'app.resolve_owner_confirmed_fenced_test_credit(uuid,uuid,uuid,text,timestamptz,text,bigint,boolean,boolean,boolean)',
             'EXECUTE'
           ) as executor_allowed`,
        );
        expect(permissions.rows).toEqual([{ executor_allowed: false }]);
      });
    });

    it('turns an exhausted reconciliation lease into durable blocking review', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createVerifiedDepositFixture(client, 'RECON-LEASE-EXHAUSTED');
        const execution = await enqueueAndLease(
          client,
          fixture,
          '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        );
        await queryAsExecutor(
          client,
          `select * from app.fence_deposit_execution_final_action($1::uuid, $2::uuid)`,
          [execution.executionAttemptId, execution.executionLeaseToken],
        );
        await queryAsExecutor(
          client,
          `select *
           from app.require_deposit_execution_reconciliation($1::uuid, $2::uuid, false)`,
          [execution.executionAttemptId, execution.executionLeaseToken],
        );
        const reconciliationWorkerId = '8ccccccc-cccc-4ccc-8ccc-cccccccccccc';
        const lease = await queryAsExecutor<{
          readonly reconciliation_job_id: string;
        }>(client, `select * from app.lease_next_deposit_execution_reconciliation($1::uuid, 300)`, [
          reconciliationWorkerId,
        ]);
        expect(lease).toHaveLength(1);

        const initialJobState = await client.query<{
          readonly attempt_count: number;
          readonly max_attempts: number;
          readonly status: string;
        }>(
          `select job.status::text as status,
                  job.attempt_count,
                  job.max_attempts
             from app.deposit_jobs job
            where job.id = $1::uuid`,
          [lease[0]!.reconciliation_job_id],
        );
        expect(initialJobState.rows).toEqual([
          { status: 'leased', attempt_count: 1, max_attempts: 8 },
        ]);

        const maxAttempts = initialJobState.rows[0]!.max_attempts;
        for (
          let expectedAttemptCount = 2;
          expectedAttemptCount <= maxAttempts;
          expectedAttemptCount += 1
        ) {
          const expiredLease = await client.query<{
            readonly attempt_count: number;
            readonly max_attempts: number;
            readonly status: string;
          }>(
            `update app.deposit_jobs
                set lease_expires_at = clock_timestamp() - interval '1 second'
              where id = $1::uuid
                and status = 'leased'
            returning status::text, attempt_count, max_attempts`,
            [lease[0]!.reconciliation_job_id],
          );
          expect(expiredLease.rows).toEqual([
            {
              status: 'leased',
              attempt_count: expectedAttemptCount - 1,
              max_attempts: maxAttempts,
            },
          ]);

          const renewedLease = await queryAsExecutor<{
            readonly reconciliation_job_id: string;
          }>(
            client,
            `select reconciliation_job_id
               from app.lease_next_deposit_execution_reconciliation($1::uuid, 300)`,
            [reconciliationWorkerId],
          );
          expect(renewedLease).toEqual([
            { reconciliation_job_id: lease[0]!.reconciliation_job_id },
          ]);

          const renewedJobState = await client.query<{
            readonly attempt_count: number;
            readonly max_attempts: number;
            readonly status: string;
          }>(
            `select job.status::text as status,
                    job.attempt_count,
                    job.max_attempts
               from app.deposit_jobs job
              where job.id = $1::uuid`,
            [lease[0]!.reconciliation_job_id],
          );
          expect(renewedJobState.rows).toEqual([
            {
              status: 'leased',
              attempt_count: expectedAttemptCount,
              max_attempts: maxAttempts,
            },
          ]);
        }

        const finalExpiredLease = await client.query<{
          readonly attempt_count: number;
          readonly max_attempts: number;
          readonly status: string;
        }>(
          `update app.deposit_jobs
              set lease_expires_at = clock_timestamp() - interval '1 second'
            where id = $1::uuid
              and status = 'leased'
          returning status::text, attempt_count, max_attempts`,
          [lease[0]!.reconciliation_job_id],
        );
        expect(finalExpiredLease.rows).toEqual([
          { status: 'leased', attempt_count: maxAttempts, max_attempts: maxAttempts },
        ]);

        const nextLease = await queryAsExecutor(
          client,
          `select * from app.lease_next_deposit_execution_reconciliation($1::uuid, 300)`,
          [reconciliationWorkerId],
        );
        expect(nextLease).toEqual([]);

        const reviewed = await client.query<{
          readonly attempt_status: string;
          readonly deposit_status: string;
          readonly job_status: string;
          readonly outcome: string;
          readonly reason_code: string;
          readonly review_cases: number;
        }>(
          `select attempt.status::text as attempt_status,
                intent.status::text as deposit_status,
                job.status::text as job_status,
                reconciliation.outcome::text as outcome,
                reconciliation.reason_code,
                (select count(*)::integer
                   from app.deposit_review_cases review_case
                  where review_case.deposit_intent_id = intent.id
                    and review_case.review_kind = 'execution'
                    and review_case.status = 'open'
                    and review_case.reason_code =
                      'reconciliation_lease_exhausted') as review_cases
           from app.deposit_intents intent
           join app.deposit_execution_attempts attempt
             on attempt.deposit_intent_id = intent.id
           join app.execution_reconciliations reconciliation
             on reconciliation.deposit_execution_attempt_id = attempt.id
           join app.deposit_jobs job on job.id = reconciliation.deposit_job_id
          where intent.id = $1::uuid`,
          [fixture.depositIntentId],
        );
        expect(reviewed.rows).toEqual([
          {
            attempt_status: 'review_required',
            deposit_status: 'execution_review',
            job_status: 'succeeded',
            outcome: 'ambiguous',
            reason_code: 'agent_history_ambiguous',
            review_cases: 1,
          },
        ]);
        await rotateActiveKemerbetAgent(client, 'after-reconciliation-exhaustion');
      });
    });

    it('cancels only before the fence and releases the agent lane into review', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createVerifiedDepositFixture(client, 'CANCEL-BEFORE-FENCE');
        const execution = await enqueueAndLease(
          client,
          fixture,
          '83333333-3333-4333-8333-333333333333',
        );

        const cancelled = await queryAsExecutor<{
          readonly attempt_status: string;
          readonly deposit_status: string;
        }>(
          client,
          `select attempt_status, deposit_status
           from app.cancel_deposit_execution_before_action(
             $1::uuid, $2::uuid, 'session_unavailable_before_action'
           )`,
          [execution.executionAttemptId, execution.executionLeaseToken],
        );
        expect(cancelled).toEqual([
          { attempt_status: 'cancelled_before_action', deposit_status: 'execution_review' },
        ]);

        await expect(
          queryAsExecutor(
            client,
            `select * from app.fence_deposit_execution_final_action($1::uuid, $2::uuid)`,
            [execution.executionAttemptId, execution.executionLeaseToken],
          ),
        ).rejects.toThrow('one-shot deposit execution lease is unavailable for fencing');
      });
    });

    it('bounds absent observations and keeps ambiguous execution agent-blocking', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createVerifiedDepositFixture(client, 'ABSENCE-CAP');
        const execution = await enqueueAndLease(
          client,
          fixture,
          '84444444-4444-4444-8444-444444444444',
        );
        await queryAsExecutor(
          client,
          `select * from app.fence_deposit_execution_final_action($1::uuid, $2::uuid)`,
          [execution.executionAttemptId, execution.executionLeaseToken],
        );
        await queryAsExecutor(
          client,
          `select *
           from app.require_deposit_execution_reconciliation($1::uuid, $2::uuid, true)`,
          [execution.executionAttemptId, execution.executionLeaseToken],
        );

        for (let observationNumber = 1; observationNumber <= 6; observationNumber += 1) {
          if (observationNumber > 1) {
            await client.query(`select pg_sleep(2.05)`);
          }
          const lease = await queryAsExecutor<{
            readonly lease_token: string;
            readonly reconciliation_job_id: string;
          }>(
            client,
            `select reconciliation_job_id, lease_token
             from app.lease_next_deposit_execution_reconciliation($1::uuid, 300)`,
            [`85555555-5555-4555-8555-55555555555${observationNumber}`],
          );
          expect(lease).toHaveLength(1);

          const observed = await queryAsExecutor<{
            readonly attempt_status: string;
            readonly deposit_status: string;
            readonly follow_up_job_id: string | null;
            readonly outcome: string;
            readonly reason_code: string;
          }>(
            client,
            `select attempt_status, deposit_status, follow_up_job_id, outcome, reason_code
             from app.record_deposit_execution_reconciliation(
               $1::uuid, $2::uuid, 'not_observed',
               null, null, null, null, true, null, null, null
             )`,
            [lease[0]!.reconciliation_job_id, lease[0]!.lease_token],
          );

          if (observationNumber < 6) {
            expect(observed).toEqual([
              {
                attempt_status: 'reconciliation_required',
                deposit_status: 'execution_reconciliation',
                follow_up_job_id: expect.any(String),
                outcome: 'not_observed',
                reason_code: 'agent_history_not_observed',
              },
            ]);
          } else {
            expect(observed).toEqual([
              {
                attempt_status: 'review_required',
                deposit_status: 'execution_review',
                follow_up_job_id: null,
                outcome: 'ambiguous',
                reason_code: 'agent_history_ambiguous',
              },
            ]);
          }
        }

        const blockedFixture = await createVerifiedDepositFixture(client, 'BLOCKED-AGENT-LANE');
        const blockedSettlement = await settleVerifiedDeposit(client, blockedFixture);
        expect(blockedSettlement.already_finalized).toBe(false);
        const blockedLease = await queryAsExecutor(
          client,
          `select * from app.lease_next_deposit_execution($1::uuid, 300)`,
          ['86666666-6666-4666-8666-666666666666'],
        );
        expect(blockedLease).toEqual([]);
      });
    });
  });
}
