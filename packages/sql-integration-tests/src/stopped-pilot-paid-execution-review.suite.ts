import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  completeVerification,
  prepareTelebirrPilot,
  prepareVerification,
} from './private-live-telebirr-proof-lineage.suite.js';

type ReviewRow = { readonly review_state: string; readonly replayed: boolean };
type ResolutionRow = { readonly resolution_state: string; readonly replayed: boolean };
type ReadinessRow = {
  readonly redacted_status: {
    readonly cancelledUntouchedJobs: number;
    readonly customerResolutionPending: boolean;
    readonly nextAction: string;
    readonly openExecutionReviewCases: number;
    readonly openJobs: number;
    readonly stoppedPilotUntouchedJob: boolean;
  };
};

const readinessSource = readFileSync(
  new URL(
    '../../../infra/sql/production-companion-execution-activation-status.sql',
    import.meta.url,
  ),
  'utf8',
);
const readinessSelect = readinessSource.slice(
  readinessSource.indexOf('with latest_pilot as materialized ('),
  readinessSource.lastIndexOf('\ncommit;'),
);

async function withRollback(client: Client, body: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await body();
  } finally {
    await client.query('rollback');
  }
}

async function expectRejected(client: Client, operation: () => Promise<unknown>): Promise<void> {
  const savepoint = `stopped_paid_review_${randomUUID().replaceAll('-', '')}`;
  await client.query(`savepoint ${savepoint}`);
  let failure: unknown;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  expect(failure).toBeInstanceOf(Error);
}

export function registerStoppedPilotPaidExecutionReviewSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('stopped-pilot paid execution review', () => {
    it('has no runtime grant and keeps its receipt private and immutable', async () => {
      const client = getClient();
      const boundary = await client.query<{
        readonly force_rls: boolean;
        readonly owner_only: boolean;
        readonly runtime_execute: boolean;
        readonly runtime_table_access: boolean;
      }>(`
        select relation.relforcerowsecurity as force_rls,
               routine.prosecdef
                 and routine.proconfig is not null
                 and routine.proowner = 'postgres'::regrole as owner_only,
               pg_catalog.has_function_privilege(
                 'fetanagent_owner_control_runtime', routine.oid, 'EXECUTE'
               ) or pg_catalog.has_function_privilege(
                 'fetanagent_deposit_executor_runtime', routine.oid, 'EXECUTE'
               ) as runtime_execute,
               pg_catalog.has_table_privilege(
                 'fetanagent_owner_control_runtime', relation.oid, 'INSERT'
               ) or pg_catalog.has_table_privilege(
                 'fetanagent_deposit_executor_runtime', relation.oid, 'SELECT'
               ) as runtime_table_access
          from pg_catalog.pg_class relation
          join pg_catalog.pg_namespace namespace
            on namespace.oid = relation.relnamespace
          cross join pg_catalog.pg_proc routine
         where namespace.nspname = 'app'
           and relation.relname = 'stopped_pilot_paid_execution_reviews'
           and routine.oid =
             'app.review_stopped_pilot_paid_execution_job(uuid,uuid,uuid,uuid)'::regprocedure
      `);
      expect(boundary.rows).toEqual([
        {
          force_rls: true,
          owner_only: true,
          runtime_execute: false,
          runtime_table_access: false,
        },
      ]);

      const resolutionBoundary = await client.query<{
        readonly force_rls: boolean;
        readonly owner_only: boolean;
        readonly public_execute: boolean;
        readonly owner_execute: boolean;
        readonly runtime_execute: boolean;
        readonly runtime_table_access: boolean;
        readonly immutable_triggers: string;
      }>(`
        select relation.relforcerowsecurity as force_rls,
               routine.prosecdef
                 and routine.proowner = 'postgres'::regrole as owner_only,
               pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
                 as public_execute,
               pg_catalog.has_function_privilege(
                 'fetanagent_owner_control', routine.oid, 'EXECUTE'
               ) as owner_execute,
               pg_catalog.has_function_privilege(
                 'fetanagent_owner_control_runtime', routine.oid, 'EXECUTE'
               ) or pg_catalog.has_function_privilege(
                 'fetanagent_deposit_executor_runtime', routine.oid, 'EXECUTE'
               ) as runtime_execute,
               pg_catalog.has_table_privilege(
                 'fetanagent_owner_control_runtime', relation.oid, 'INSERT'
               ) or pg_catalog.has_table_privilege(
                 'fetanagent_deposit_executor_runtime', relation.oid, 'SELECT'
               ) as runtime_table_access,
               (select count(*)
                  from pg_catalog.pg_trigger trigger
                 where trigger.tgrelid = relation.oid
                   and not trigger.tgisinternal) as immutable_triggers
          from pg_catalog.pg_class relation
          join pg_catalog.pg_namespace namespace
            on namespace.oid = relation.relnamespace
          cross join pg_catalog.pg_proc routine
         where namespace.nspname = 'app'
           and relation.relname = 'stopped_pilot_owner_test_resolutions'
           and routine.oid =
             'app.resolve_stopped_pilot_owner_test_payment(uuid,uuid,uuid,boolean,boolean)'::regprocedure
      `);
      expect(resolutionBoundary.rows).toEqual([
        {
          force_rls: true,
          owner_only: true,
          public_execute: false,
          owner_execute: false,
          runtime_execute: false,
          runtime_table_access: false,
          immutable_triggers: '2',
        },
      ]);
    });

    it('rejects an active pilot, then moves only its untouched paid job to review', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const pilot = await prepareTelebirrPilot(client, getOwnerAdminId(), {
          maximumPerDepositMinor: 2500,
          maximumPerPlayerMinor: 2500,
          maximumAggregateMinor: 12500,
        });
        const prepared = await prepareVerification(client, pilot);
        const completion = await completeVerification(client, pilot, prepared, {
          disposition: 'settlement_candidate',
          reasonCode: 'exact_proof_match',
        });
        const jobId = completion.row.execution_job_id;
        const intentId = completion.row.deposit_intent_id;
        expect(jobId).toEqual(expect.any(String));
        expect(intentId).toEqual(expect.any(String));
        const requestKey = randomUUID();
        const invoke = (key: string, targetJobId: string) =>
          client.query<ReviewRow>(
            `select * from app.review_stopped_pilot_paid_execution_job(
              $1::uuid, $2::uuid, $3::uuid, $4::uuid
            )`,
            [getOwnerAdminId(), pilot.pilotRevisionId, targetJobId, key],
          );

        await expectRejected(client, () => invoke(requestKey, jobId!));
        const before = await client.query<{ readonly status: string }>(
          'select status from app.deposit_jobs where id = $1::uuid',
          [jobId],
        );
        expect(before.rows).toEqual([{ status: 'queued' }]);
        await client.query(
          `select app.stop_private_live_deposit_pilot(
            $1::uuid, $2::uuid, 'owner_stop'
          )`,
          [getOwnerAdminId(), pilot.pilotRevisionId],
        );
        const beforeReview = await client.query<ReadinessRow>(readinessSelect);
        expect(beforeReview.rows[0]?.redacted_status).toMatchObject({
          cancelledUntouchedJobs: 0,
          customerResolutionPending: false,
          nextAction: 'paid_stopped_pilot_review',
          openExecutionReviewCases: 0,
          openJobs: 1,
          stoppedPilotUntouchedJob: true,
        });
        const first = await invoke(requestKey, jobId!);
        expect(first.rows).toEqual([{ review_state: 'review_required', replayed: false }]);
        const replay = await invoke(requestKey, jobId!);
        expect(replay.rows).toEqual([{ review_state: 'review_required', replayed: true }]);
        await expectRejected(client, () => invoke(randomUUID(), jobId!));
        await expectRejected(client, () => invoke(requestKey, randomUUID()));

        const result = await client.query<{
          readonly attempt_count: number;
          readonly claim_count: number;
          readonly disposition_count: number;
          readonly execution_attempt_count: number;
          readonly intent_status: string;
          readonly job_status: string;
          readonly open_review_count: number;
          readonly reservation_count: number;
        }>(
          `
          select job.status::text as job_status,
                 job.attempt_count,
                 intent.status::text as intent_status,
                 (select count(*)::integer from app.deposit_payment_claims
                   where deposit_intent_id = intent.id) as claim_count,
                 (select count(*)::integer from app.private_live_deposit_pilot_reservations
                   where deposit_intent_id = intent.id) as reservation_count,
                 (select count(*)::integer from app.deposit_execution_attempts
                   where deposit_intent_id = intent.id) as execution_attempt_count,
                 (select count(*)::integer from app.deposit_review_cases
                   where deposit_intent_id = intent.id and review_kind = 'execution'
                     and status = 'open') as open_review_count,
                 (select count(*)::integer from app.stopped_pilot_paid_execution_reviews
                   where deposit_intent_id = intent.id) as disposition_count
            from app.deposit_jobs job
            join app.deposit_intents intent on intent.id = job.deposit_intent_id
           where job.id = $1::uuid
             and intent.id = $2::uuid
        `,
          [jobId, intentId],
        );
        expect(result.rows).toEqual([
          {
            attempt_count: 0,
            claim_count: 1,
            disposition_count: 1,
            execution_attempt_count: 0,
            intent_status: 'execution_review',
            job_status: 'cancelled',
            open_review_count: 1,
            reservation_count: 1,
          },
        ]);
        const afterReview = await client.query<ReadinessRow>(readinessSelect);
        expect(afterReview.rows[0]?.redacted_status).toMatchObject({
          cancelledUntouchedJobs: 1,
          customerResolutionPending: true,
          nextAction: 'customer_resolution_pending',
          openExecutionReviewCases: 1,
          openJobs: 0,
          stoppedPilotUntouchedJob: false,
        });
        await expectRejected(client, () =>
          client.query(
            `update app.stopped_pilot_paid_execution_reviews
                set reason_code = reason_code
              where request_key = $1::uuid`,
            [requestKey],
          ),
        );

        const resolutionKey = randomUUID();
        const resolve = (
          key: string,
          paidReviewKey = requestKey,
          bothWallets = true,
          acceptsNoCreditOrRefund = true,
        ) =>
          client.query<ResolutionRow>(
            `select * from app.resolve_stopped_pilot_owner_test_payment(
              $1::uuid, $2::uuid, $3::uuid, $4::boolean, $5::boolean
            )`,
            [getOwnerAdminId(), paidReviewKey, key, bothWallets, acceptsNoCreditOrRefund],
          );
        await expectRejected(client, () => resolve(resolutionKey, requestKey, false));
        await expectRejected(client, () => resolve(resolutionKey, requestKey, true, false));
        await expectRejected(client, () => resolve(resolutionKey, randomUUID()));

        const resolution = await resolve(resolutionKey);
        expect(resolution.rows).toEqual([
          { resolution_state: 'owner_test_closed', replayed: false },
        ]);
        const resolutionReplay = await resolve(resolutionKey);
        expect(resolutionReplay.rows).toEqual([
          { resolution_state: 'owner_test_closed', replayed: true },
        ]);
        await expectRejected(client, () => resolve(randomUUID()));
        await expectRejected(client, () => resolve(resolutionKey, randomUUID()));

        const closed = await client.query<{
          readonly attempt_count: number;
          readonly claim_count: number;
          readonly intent_status: string;
          readonly job_status: string;
          readonly open_review_count: number;
          readonly rejection_reason_code: string;
          readonly reservation_count: number;
          readonly resolution_code: string;
          readonly resolution_count: number;
        }>(
          `select job.status::text as job_status,
                  intent.status::text as intent_status,
                  intent.rejection_reason_code,
                  review_case.resolution_code,
                  (select count(*)::integer from app.deposit_payment_claims
                    where deposit_intent_id = intent.id) as claim_count,
                  (select count(*)::integer from app.private_live_deposit_pilot_reservations
                    where deposit_intent_id = intent.id) as reservation_count,
                  (select count(*)::integer from app.deposit_execution_attempts
                    where deposit_intent_id = intent.id) as attempt_count,
                  (select count(*)::integer from app.deposit_review_cases
                    where deposit_intent_id = intent.id and review_kind = 'execution'
                      and status in ('open', 'assigned')) as open_review_count,
                  (select count(*)::integer from app.stopped_pilot_owner_test_resolutions
                    where deposit_intent_id = intent.id) as resolution_count
             from app.deposit_jobs job
             join app.deposit_intents intent on intent.id = job.deposit_intent_id
             join app.deposit_review_cases review_case
               on review_case.deposit_intent_id = intent.id
              and review_case.review_kind = 'execution'
            where job.id = $1::uuid`,
          [jobId],
        );
        expect(closed.rows).toEqual([
          {
            attempt_count: 0,
            claim_count: 1,
            intent_status: 'rejected',
            job_status: 'cancelled',
            open_review_count: 0,
            rejection_reason_code: 'owner_self_funded_test_no_credit_or_refund',
            reservation_count: 1,
            resolution_code: 'owner_self_funded_test_no_credit_or_refund',
            resolution_count: 1,
          },
        ]);
        const afterResolution = await client.query<ReadinessRow>(readinessSelect);
        expect(afterResolution.rows[0]?.redacted_status).toMatchObject({
          cancelledUntouchedJobs: 1,
          customerResolutionPending: false,
          nextAction: 'pilot_review',
          openExecutionReviewCases: 0,
          openJobs: 0,
        });
        await expectRejected(client, () =>
          client.query(
            `update app.stopped_pilot_owner_test_resolutions
                set resolution_code = resolution_code
              where resolution_request_key = $1::uuid`,
            [resolutionKey],
          ),
        );
      });
    });
  });
}
