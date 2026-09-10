import { randomUUID } from 'node:crypto';

import type { Client, QueryResult } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  completeVerification,
  prepareTelebirrPilot,
  prepareVerification,
  type TelebirrPilot,
} from './private-live-telebirr-proof-lineage.suite.js';

type LeaseRow = {
  readonly amount_minor: string;
  readonly currency_code: string;
  readonly deposit_intent_id: string;
  readonly execution_attempt_id: string;
  readonly execution_job_id: string;
  readonly lease_disposition: string;
  readonly lease_expires_at: Date;
  readonly lease_token: string;
  readonly pilot_authorization_token: string;
  readonly pilot_configuration_digest: string;
  readonly pilot_contract_version: number;
  readonly pilot_reservation_id: string;
  readonly pilot_revision_id: string;
  readonly platform_agent_account_id: string;
  readonly player_id: string;
};

type FenceRow = {
  readonly deposit_intent_id: string;
  readonly execution_attempt_id: string;
  readonly final_action_fenced_at: Date;
  readonly first_fence_acquired: boolean;
  readonly pilot_authorization_token: string;
  readonly pilot_configuration_digest: string;
  readonly pilot_contract_version: number;
  readonly pilot_reservation_id: string;
  readonly pilot_revision_id: string;
};

type ExecutionFixture = {
  readonly epoch: string;
  readonly executionJobId: string;
  readonly pilot: TelebirrPilot;
};

async function withRollback(client: Client, operation: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await operation();
  } finally {
    await client.query('rollback');
  }
}

async function queryAsExecutor<T>(
  client: Client,
  text: string,
  values: readonly unknown[] = [],
): Promise<readonly T[]> {
  await client.query('set local role fetanagent_deposit_executor');
  let queryCompleted = false;
  try {
    const rows = (await client.query<T & Record<string, unknown>>(text, [...values])).rows;
    queryCompleted = true;
    return rows;
  } finally {
    // A failed statement leaves the transaction aborted until the surrounding savepoint rolls
    // back. Do not replace its intended database error with RESET ROLE's 25P02 error.
    if (queryCompleted) await client.query('reset role');
  }
}

async function failureAtSavepoint(
  client: Client,
  operation: () => Promise<unknown>,
): Promise<Error> {
  const savepoint = `execution_epoch_failure_${randomUUID().replaceAll('-', '')}`;
  await client.query(`savepoint ${savepoint}`);
  let failure: unknown;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  await client.query('reset role');
  expect(failure).toBeInstanceOf(Error);
  return failure as Error;
}

async function prepareQueuedExecution(
  client: Client,
  ownerAdminId: string,
): Promise<ExecutionFixture> {
  const pilot = await prepareTelebirrPilot(client, ownerAdminId);
  const prepared = await prepareVerification(client, pilot);
  const completion = await completeVerification(client, pilot, prepared, {
    disposition: 'settlement_candidate',
    reasonCode: 'exact_proof_match',
  });
  expect(completion.row.execution_job_id).toEqual(expect.any(String));
  const authority = await client.query<{ readonly current_epoch: string }>(`
    select current_epoch
      from app.private_trusted_telebirr_activation_control
     where control_key = 'trusted_telebirr_financial_authority'
  `);
  expect(authority.rows).toHaveLength(1);
  return {
    epoch: authority.rows[0]!.current_epoch,
    executionJobId: completion.row.execution_job_id!,
    pilot,
  };
}

async function leaseExecution(client: Client, seconds = 120): Promise<LeaseRow> {
  const rows = await queryAsExecutor<LeaseRow>(
    client,
    'select * from app.lease_next_private_live_deposit_execution($1::uuid, $2::integer)',
    [randomUUID(), seconds],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function fenceExecution(client: Client, lease: LeaseRow): Promise<readonly FenceRow[]> {
  return queryAsExecutor<FenceRow>(
    client,
    `select *
       from app.fence_private_live_deposit_execution_final_action(
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid
       )`,
    [
      lease.execution_attempt_id,
      lease.lease_token,
      lease.pilot_revision_id,
      lease.pilot_reservation_id,
      lease.pilot_authorization_token,
    ],
  );
}

async function assertPrepared(client: Client, executionAttemptId: string): Promise<void> {
  const attempt = await client.query<{
    readonly final_action_fenced_at: Date | null;
    readonly status: string;
  }>(
    `select status::text, final_action_fenced_at
       from app.deposit_execution_attempts
      where id = $1::uuid`,
    [executionAttemptId],
  );
  expect(attempt.rows).toEqual([{ final_action_fenced_at: null, status: 'prepared' }]);
}

export function registerPrivateLiveExecutionActivationEpochSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
  createSession: () => Client,
): void {
  describe('private-live execution activation epoch interlock', () => {
    it('preserves the public contracts while sealing the private binding and pre-epoch OIDs', async () => {
      const client = getClient();
      const relation = await client.query<{
        readonly owner_only_acl: boolean;
        readonly owner_name: string;
        readonly policies: number;
        readonly relforcerowsecurity: boolean;
        readonly relrowsecurity: boolean;
      }>(`
        select owner_role.rolname as owner_name,
               relation.relrowsecurity,
               relation.relforcerowsecurity,
               (select count(*)::integer
                  from pg_policy policy
                 where policy.polrelid = relation.oid) as policies,
               not exists (
                 select 1
                   from aclexplode(coalesce(
                     relation.relacl, acldefault('r', relation.relowner)
                   )) privilege
                  where privilege.grantee <> relation.relowner
               ) as owner_only_acl
          from pg_class relation
          join pg_namespace namespace on namespace.oid = relation.relnamespace
          join pg_roles owner_role on owner_role.oid = relation.relowner
         where namespace.nspname = 'app'
           and relation.relname = 'private_live_deposit_execution_epoch_bindings'
      `);
      expect(relation.rows).toEqual([
        {
          owner_name: 'postgres',
          owner_only_acl: true,
          policies: 0,
          relforcerowsecurity: true,
          relrowsecurity: true,
        },
      ]);

      const routines = await client.query<{
        readonly configuration: readonly string[] | null;
        readonly direct_grantees: readonly string[];
        readonly executor_allowed: boolean;
        readonly owner_name: string;
        readonly public_allowed: boolean;
        readonly result_columns: readonly string[];
        readonly signature: string;
      }>(`
        select routine.oid::regprocedure::text as signature,
               owner_role.rolname as owner_name,
               routine.proconfig as configuration,
               exists (
                 select 1
                   from aclexplode(coalesce(
                     routine.proacl, acldefault('f', routine.proowner)
                   )) privilege
                  where privilege.grantee = 0
                    and privilege.privilege_type = 'EXECUTE'
               ) as public_allowed,
               has_function_privilege(
                 'fetanagent_deposit_executor', routine.oid, 'EXECUTE'
               ) as executor_allowed,
               array(
                 select coalesce(grantee.rolname, 'PUBLIC')
                   from aclexplode(coalesce(
                     routine.proacl, acldefault('f', routine.proowner)
                   )) privilege
                   left join pg_roles grantee on grantee.oid = privilege.grantee
                  where privilege.grantee <> routine.proowner
                    and privilege.privilege_type = 'EXECUTE'
                  order by coalesce(grantee.rolname, 'PUBLIC')
               )::text[] as direct_grantees,
               array(
                 select argument.name
                   from unnest(routine.proargnames, routine.proargmodes)
                     with ordinality as argument(name, mode, position)
                  where argument.mode = 't'
                  order by argument.position
               )::text[] as result_columns
          from pg_proc routine
          join pg_roles owner_role on owner_role.oid = routine.proowner
         where routine.oid in (
           'app.recover_expired_private_live_prepared()'::regprocedure,
           'app.lease_private_live_deposit_by_provider(uuid,integer,boolean)'::regprocedure,
           'app.lease_private_live_deposit_pre_epoch(uuid,integer)'::regprocedure,
           'app.fence_private_live_deposit_pre_epoch(uuid,uuid,uuid,uuid,uuid)'::regprocedure,
           'app.lease_next_private_live_deposit_execution(uuid,integer)'::regprocedure,
           'app.fence_private_live_deposit_execution_final_action(uuid,uuid,uuid,uuid,uuid)'
             ::regprocedure
         )
         order by signature
      `);
      expect(routines.rows).toHaveLength(6);
      for (const row of routines.rows) {
        expect(row.owner_name).toBe('postgres');
        expect(row.public_allowed).toBe(false);
        expect(
          Buffer.byteLength(row.signature.split('(')[0]!.split('.').at(-1)!, 'utf8'),
        ).toBeLessThanOrEqual(63);
        const ownerOnlyInternal =
          row.signature.includes('_pre_epoch') ||
          row.signature.includes('recover_expired_private_live_prepared') ||
          row.signature.includes('lease_private_live_deposit_by_provider');
        if (ownerOnlyInternal) {
          expect(row).toMatchObject({
            configuration: [
              row.signature.includes('_pre_epoch') ? 'search_path=pg_catalog' : 'search_path=',
            ],
            direct_grantees: [],
            executor_allowed: false,
          });
        } else {
          expect(row).toMatchObject({
            configuration: ['search_path='],
            direct_grantees: ['fetanagent_deposit_executor'],
            executor_allowed: true,
          });
        }
      }

      const publicLease = routines.rows.find((row) =>
        row.signature.includes('lease_next_private_live_deposit_execution'),
      );
      expect(publicLease?.result_columns).toEqual([
        'deposit_intent_id',
        'execution_job_id',
        'execution_attempt_id',
        'platform_agent_account_id',
        'player_id',
        'amount_minor',
        'currency_code',
        'lease_token',
        'lease_expires_at',
        'lease_disposition',
        'pilot_contract_version',
        'pilot_revision_id',
        'pilot_reservation_id',
        'pilot_configuration_digest',
        'pilot_authorization_token',
      ]);
      const publicFence = routines.rows.find((row) =>
        row.signature.includes('fence_private_live_deposit_execution_final_action'),
      );
      expect(publicFence?.result_columns).toEqual([
        'deposit_intent_id',
        'execution_attempt_id',
        'final_action_fenced_at',
        'first_fence_acquired',
        'pilot_contract_version',
        'pilot_revision_id',
        'pilot_reservation_id',
        'pilot_configuration_digest',
        'pilot_authorization_token',
      ]);

      const activationWriters = await client.query(`
        select routine.oid::regprocedure::text
          from pg_proc routine
          join pg_namespace namespace on namespace.oid = routine.pronamespace
         where namespace.nspname = 'app'
           and routine.proname like 'activate_private_trusted_telebirr%'
      `);
      expect(activationWriters.rows).toEqual([]);
    });

    it('binds one lease, rejects stale authority, and preserves the exact fence contract', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await prepareQueuedExecution(client, getOwnerAdminId());

        await client.query('savepoint short_epoch_lease');
        await client.query("set local session_replication_role = 'replica'");
        await client.query(
          `update app.private_trusted_telebirr_activation_epochs
              set expires_at = clock_timestamp() + interval '60 seconds'
            where epoch = $1::bigint`,
          [fixture.epoch],
        );
        await client.query(
          `update app.private_live_deposit_pilot_revisions
              set expires_at = (
                select expires_at
                  from app.private_trusted_telebirr_activation_epochs
                 where epoch = $1::bigint
              )
            where id = $2::uuid`,
          [fixture.epoch, fixture.pilot.pilotRevisionId],
        );
        await client.query("set local session_replication_role = 'origin'");
        const shortLeaseFailure = await failureAtSavepoint(client, () =>
          queryAsExecutor(
            client,
            'select * from app.lease_next_private_live_deposit_execution($1::uuid, 120)',
            [randomUUID()],
          ),
        );
        expect(shortLeaseFailure.message).toContain('lease window exceeds activation authority');
        await client.query('rollback to savepoint short_epoch_lease');
        await client.query('release savepoint short_epoch_lease');

        const lease = await leaseExecution(client);
        expect(lease).toMatchObject({
          execution_job_id: fixture.executionJobId,
          lease_disposition: 'execution',
          pilot_configuration_digest: fixture.pilot.configurationDigest,
          pilot_contract_version: 1,
          pilot_revision_id: fixture.pilot.pilotRevisionId,
        });

        const binding = await client.query<{
          readonly activation_epoch: string;
          readonly bound_at: Date;
          readonly deposit_intent_id: string;
          readonly execution_attempt_id: string;
          readonly execution_job_id: string;
          readonly pilot_configuration_digest: string;
          readonly pilot_reservation_id: string;
          readonly pilot_revision_id: string;
          readonly platform_agent_account_id: string;
        }>(
          `select execution_attempt_id, execution_job_id, deposit_intent_id,
                  activation_epoch, pilot_revision_id, pilot_reservation_id,
                  pilot_configuration_digest, platform_agent_account_id, bound_at
             from app.private_live_deposit_execution_epoch_bindings
            where execution_attempt_id = $1::uuid`,
          [lease.execution_attempt_id],
        );
        expect(binding.rows).toEqual([
          {
            activation_epoch: fixture.epoch,
            bound_at: expect.any(Date),
            deposit_intent_id: lease.deposit_intent_id,
            execution_attempt_id: lease.execution_attempt_id,
            execution_job_id: lease.execution_job_id,
            pilot_configuration_digest: lease.pilot_configuration_digest,
            pilot_reservation_id: lease.pilot_reservation_id,
            pilot_revision_id: lease.pilot_revision_id,
            platform_agent_account_id: lease.platform_agent_account_id,
          },
        ]);

        const mutationFailure = await failureAtSavepoint(client, () =>
          client.query(
            `update app.private_live_deposit_execution_epoch_bindings
                set bound_at = bound_at + interval '1 second'
              where execution_attempt_id = $1::uuid`,
            [lease.execution_attempt_id],
          ),
        );
        expect(mutationFailure.message).toContain('bindings are immutable');
        const deleteFailure = await failureAtSavepoint(client, () =>
          client.query(
            `delete from app.private_live_deposit_execution_epoch_bindings
              where execution_attempt_id = $1::uuid`,
            [lease.execution_attempt_id],
          ),
        );
        expect(deleteFailure.message).toContain('bindings are immutable');
        const truncateFailure = await failureAtSavepoint(client, () =>
          client.query('truncate table app.private_live_deposit_execution_epoch_bindings'),
        );
        expect(truncateFailure.message).toContain('cannot be truncated');

        await client.query('savepoint expired_epoch_fence');
        await client.query("set local session_replication_role = 'replica'");
        await client.query(
          `update app.private_trusted_telebirr_activation_epochs
              set active_from = clock_timestamp() - interval '1 hour',
                  activated_at = clock_timestamp() - interval '1 hour',
                  expires_at = clock_timestamp() - interval '1 second'
            where epoch = $1::bigint`,
          [fixture.epoch],
        );
        await client.query("set local session_replication_role = 'origin'");
        const expiredFailure = await failureAtSavepoint(client, () =>
          fenceExecution(client, lease),
        );
        expect(expiredFailure.message).toMatch(
          /execution authorization is invalid|activation epoch|not currently authorized/iu,
        );
        await assertPrepared(client, lease.execution_attempt_id);
        await client.query('rollback to savepoint expired_epoch_fence');
        await client.query('release savepoint expired_epoch_fence');

        await client.query('savepoint revoked_epoch_fence');
        await client.query(
          `update app.private_trusted_telebirr_activation_epochs
              set revoked_at = clock_timestamp(),
                  revocation_reason_code = 'provider_incident'
            where epoch = $1::bigint`,
          [fixture.epoch],
        );
        const revokedFailure = await failureAtSavepoint(client, () =>
          fenceExecution(client, lease),
        );
        expect(revokedFailure.message).toContain('not currently authorized');
        await assertPrepared(client, lease.execution_attempt_id);
        await client.query('rollback to savepoint revoked_epoch_fence');
        await client.query('release savepoint revoked_epoch_fence');

        await client.query('savepoint advanced_epoch_fence');
        await client.query(
          `update app.private_trusted_telebirr_activation_epochs
              set revoked_at = clock_timestamp(),
                  revocation_reason_code = 'owner_stop'
            where epoch = $1::bigint`,
          [fixture.epoch],
        );
        const nextEpoch = String(Number(fixture.epoch) + 1);
        await client.query(
          `insert into app.private_trusted_telebirr_activation_epochs (
             epoch, authority_state, pilot_revision_id, configuration_digest,
             active_from, expires_at, activated_by_admin_id, activated_at
           )
           select $1::bigint, 'active', pilot_revision_id, configuration_digest,
                  active_from, expires_at, $2::uuid, clock_timestamp()
             from app.private_trusted_telebirr_activation_epochs
            where epoch = $3::bigint`,
          [nextEpoch, getOwnerAdminId(), fixture.epoch],
        );
        await client.query(
          `update app.private_trusted_telebirr_activation_control
              set current_epoch = $1::bigint
            where control_key = 'trusted_telebirr_financial_authority'`,
          [nextEpoch],
        );
        const advancedFailure = await failureAtSavepoint(client, () =>
          fenceExecution(client, lease),
        );
        expect(advancedFailure.message).toContain('activation epoch changed before final action');
        await assertPrepared(client, lease.execution_attempt_id);
        await client.query('rollback to savepoint advanced_epoch_fence');
        await client.query('release savepoint advanced_epoch_fence');

        await client.query('savepoint short_epoch_fence');
        await client.query("set local session_replication_role = 'replica'");
        await client.query(
          `update app.private_trusted_telebirr_activation_epochs
              set expires_at = clock_timestamp() + interval '9 seconds'
            where epoch = $1::bigint`,
          [fixture.epoch],
        );
        await client.query(
          `update app.private_live_deposit_pilot_revisions
              set expires_at = (
                select expires_at
                  from app.private_trusted_telebirr_activation_epochs
                 where epoch = $1::bigint
              )
            where id = $2::uuid`,
          [fixture.epoch, fixture.pilot.pilotRevisionId],
        );
        await client.query("set local session_replication_role = 'origin'");
        const shortFenceFailure = await failureAtSavepoint(client, () =>
          fenceExecution(client, lease),
        );
        expect(shortFenceFailure.message).toContain(
          'final-action window exceeds activation authority',
        );
        await assertPrepared(client, lease.execution_attempt_id);
        await client.query('rollback to savepoint short_epoch_fence');
        await client.query('release savepoint short_epoch_fence');

        const fence = await fenceExecution(client, lease);
        expect(fence).toEqual([
          {
            deposit_intent_id: lease.deposit_intent_id,
            execution_attempt_id: lease.execution_attempt_id,
            final_action_fenced_at: expect.any(Date),
            first_fence_acquired: true,
            pilot_authorization_token: lease.pilot_authorization_token,
            pilot_configuration_digest: lease.pilot_configuration_digest,
            pilot_contract_version: lease.pilot_contract_version,
            pilot_reservation_id: lease.pilot_reservation_id,
            pilot_revision_id: lease.pilot_revision_id,
          },
        ]);
      });
    });

    it('allows reconciliation to tighten a fenced attempt after emergency revocation', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await prepareQueuedExecution(client, getOwnerAdminId());
        const lease = await leaseExecution(client);
        expect(await fenceExecution(client, lease)).toHaveLength(1);

        await client.query(
          `select * from app.request_private_trusted_telebirr_emergency_disable(
             $1::uuid, $2::bigint, $3::uuid, 'execution_uncertainty'
           )`,
          [getOwnerAdminId(), fixture.epoch, randomUUID()],
        );

        const reconciliation = await queryAsExecutor<{
          readonly execution_attempt_id: string;
          readonly attempt_status: string;
          readonly deposit_status: string;
          readonly reconciliation_job_id: string;
        }>(
          client,
          `select execution_attempt_id, reconciliation_job_id, attempt_status,
                  deposit_status
             from app.require_deposit_execution_reconciliation(
               $1::uuid, $2::uuid, true
             )`,
          [lease.execution_attempt_id, lease.lease_token],
        );
        expect(reconciliation).toHaveLength(1);
        expect(reconciliation[0]).toMatchObject({
          execution_attempt_id: lease.execution_attempt_id,
          attempt_status: 'reconciliation_required',
          deposit_status: 'execution_reconciliation',
          reconciliation_job_id: expect.any(String),
        });
      });
    });

    it('recovers an expired prepared TeleBirr attempt after emergency stop without new authority', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await prepareQueuedExecution(client, getOwnerAdminId());
        const lease = await leaseExecution(client, 30);

        await client.query(
          `select * from app.request_private_trusted_telebirr_emergency_disable(
             $1::uuid, $2::bigint, $3::uuid, 'execution_uncertainty'
           )`,
          [getOwnerAdminId(), fixture.epoch, randomUUID()],
        );
        await client.query("set local session_replication_role = 'replica'");
        await client.query(
          `update app.deposit_jobs
              set lease_expires_at = clock_timestamp() - interval '1 day'
            where id = $1::uuid`,
          [lease.execution_job_id],
        );
        await client.query("set local session_replication_role = 'origin'");

        const recovered = await queryAsExecutor<LeaseRow>(
          client,
          'select * from app.lease_next_private_live_deposit_execution($1::uuid, 30)',
          [randomUUID()],
        );
        expect(recovered).toHaveLength(1);
        expect(recovered[0]).toMatchObject({
          deposit_intent_id: lease.deposit_intent_id,
          execution_attempt_id: lease.execution_attempt_id,
          execution_job_id: null,
          lease_disposition: 'recovered_expired_prepared',
          lease_token: null,
          pilot_authorization_token: null,
          pilot_revision_id: null,
        });

        const terminal = await client.query<{
          readonly attempt_count: number;
          readonly attempt_status: string;
          readonly binding_count: number;
          readonly deposit_status: string;
          readonly job_status: string;
        }>(
          `select execution_attempt.status::text as attempt_status,
                  execution_job.status::text as job_status,
                  deposit_intent.status::text as deposit_status,
                  (select count(*)::integer
                     from app.deposit_execution_attempts counted_attempt
                    where counted_attempt.deposit_intent_id = deposit_intent.id)
                    as attempt_count,
                  (select count(*)::integer
                     from app.private_live_deposit_execution_epoch_bindings epoch_binding
                    where epoch_binding.execution_attempt_id = execution_attempt.id)
                    as binding_count
             from app.deposit_execution_attempts execution_attempt
             join app.deposit_jobs execution_job
               on execution_job.id = execution_attempt.deposit_job_id
             join app.deposit_intents deposit_intent
               on deposit_intent.id = execution_attempt.deposit_intent_id
            where execution_attempt.id = $1::uuid`,
          [lease.execution_attempt_id],
        );
        expect(terminal.rows).toEqual([
          {
            attempt_count: 1,
            attempt_status: 'cancelled_before_action',
            binding_count: 1,
            deposit_status: 'execution_review',
            job_status: 'cancelled',
          },
        ]);
      });
    });

    it('rechecks expiry after a fence waits on the activation-control lock', async () => {
      const client = getClient();
      const ownerAdminId = getOwnerAdminId();
      let fixture: ExecutionFixture | undefined;
      let lease: LeaseRow | undefined;
      let cleanupRequestKey: string | undefined;
      let setupCommitted = false;

      try {
        await client.query('begin');
        fixture = await prepareQueuedExecution(client, ownerAdminId);
        lease = await leaseExecution(client, 30);
        await client.query('commit');
        setupCommitted = true;
        cleanupRequestKey = randomUUID();

        const expiresAt = new Date(Date.now() + 2_000);
        await client.query('begin');
        await client.query("set local session_replication_role = 'replica'");
        await client.query(
          `update app.private_trusted_telebirr_activation_epochs
              set expires_at = $1::timestamptz
            where epoch = $2::bigint`,
          [expiresAt, fixture.epoch],
        );
        await client.query(
          `update app.private_live_deposit_pilot_revisions
              set expires_at = $1::timestamptz
            where id = $2::uuid`,
          [expiresAt, fixture.pilot.pilotRevisionId],
        );
        await client.query('commit');

        const locker = createSession();
        const executor = createSession();
        let lockerCommitted = false;
        let executorRolledBack = false;
        let fenceAttempt: Promise<QueryResult> | undefined;
        await Promise.all([locker.connect(), executor.connect()]);
        try {
          await Promise.all([locker.query('begin'), executor.query('begin')]);
          await locker.query("set local lock_timeout = '8s'");
          await executor.query("set local lock_timeout = '8s'");
          await executor.query("set local statement_timeout = '12s'");
          await executor.query('set local role fetanagent_deposit_executor');
          await executor.query(
            "set local application_name = 'private_live_execution_epoch_expiry_wait'",
          );
          await locker.query(`
            select current_epoch
              from app.private_trusted_telebirr_activation_control
             where control_key = 'trusted_telebirr_financial_authority'
             for update
          `);

          fenceAttempt = executor.query(
            `select *
               from app.fence_private_live_deposit_execution_final_action(
                 $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid
               )`,
            [
              lease.execution_attempt_id,
              lease.lease_token,
              lease.pilot_revision_id,
              lease.pilot_reservation_id,
              lease.pilot_authorization_token,
            ],
          );

          let observedWait = false;
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const lockState = await client.query<{ readonly waiting: boolean }>(`
              select exists (
                select 1
                  from pg_stat_activity activity
                 where activity.application_name =
                       'private_live_execution_epoch_expiry_wait'
                   and activity.wait_event_type = 'Lock'
              ) as waiting
            `);
            if (lockState.rows[0]!.waiting) {
              observedWait = true;
              break;
            }
            await client.query('select pg_sleep(0.025)');
          }
          expect(observedWait).toBe(true);

          await client.query('select pg_sleep(2.1)');
          await locker.query('commit');
          lockerCommitted = true;
          await expect(fenceAttempt).rejects.toThrow(
            /financially active|execution authorization|activation epoch/iu,
          );
          fenceAttempt = undefined;
          await executor.query('rollback');
          executorRolledBack = true;
          await assertPrepared(client, lease.execution_attempt_id);
        } finally {
          if (!lockerCommitted) await Promise.allSettled([locker.query('rollback')]);
          if (fenceAttempt) await Promise.allSettled([fenceAttempt]);
          if (!executorRolledBack) await Promise.allSettled([executor.query('rollback')]);
          await Promise.allSettled([locker.end(), executor.end()]);
        }
      } finally {
        await Promise.allSettled([client.query('rollback')]);
        if (setupCommitted && fixture && lease && cleanupRequestKey) {
          await client.query(
            `select * from app.request_private_trusted_telebirr_emergency_disable(
               $1::uuid, $2::bigint, $3::uuid, 'execution_uncertainty'
             )`,
            [ownerAdminId, fixture.epoch, cleanupRequestKey],
          );
          await queryAsExecutor(
            client,
            `select * from app.cancel_deposit_execution_before_action(
               $1::uuid, $2::uuid, 'operator_stopped_before_action'
             )`,
            [lease.execution_attempt_id, lease.lease_token],
          );
        }
      }
    });
  });
}
