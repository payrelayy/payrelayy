import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  completeVerification,
  prepareTelebirrPilot,
  prepareVerification,
} from './private-live-telebirr-proof-lineage.suite.js';

type ReviewRow = { readonly review_state: string; readonly replayed: boolean };

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
                 and routine.proconfig @> array['search_path=']::text[]
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
        await expectRejected(client, () =>
          client.query(
            `update app.stopped_pilot_paid_execution_reviews
                set reason_code = reason_code
              where request_key = $1::uuid`,
            [requestKey],
          ),
        );
      });
    });
  });
}
