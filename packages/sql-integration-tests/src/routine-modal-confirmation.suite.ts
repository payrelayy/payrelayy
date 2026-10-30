import { randomBytes, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { paidJob, persistentPolicyFixture } from './routine-telebirr-processing-policy.suite.js';
import {
  activeCertificate,
  boundCommand,
  digest,
  execute,
  leaseCommand,
} from './routine-telebirr-execution-broker.suite.js';

const modalCommandSignature =
  'app.execute_agent_platform_routine_deposit_modal_confirmation(text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,text,text,text,jsonb)';

/** Exercises the new migration on the post-cutover database, not the historical 25 ETB snapshot. */
export function registerRoutineModalConfirmationSqlTests(
  getClient: () => Client,
  getOwnerAuthUserId: () => string,
  getOwnerAdminId: () => string,
  createRuntimeClient: (password: string) => Client,
): void {
  describe('routine modal confirmation after 100 ETB cutover', () => {
    it('exposes one hardened modal function and keeps its ledgers private', async () => {
      const client = getClient();
      const privileges = await client.query<{
        broker_execute: boolean;
        runtime_execute: boolean;
        public_execute: boolean;
        hardened: boolean;
      }>(
        `select
          has_function_privilege('fetanagent_routine_deposit_broker', $1::text, 'execute')
            as broker_execute,
          has_function_privilege('fetanagent_routine_deposit_broker_runtime', $1::text, 'execute')
            as runtime_execute,
          has_function_privilege('public', $1::text, 'execute') as public_execute,
          (select procedure.prosecdef and procedure.proowner = 'postgres'::regrole
            and procedure.proconfig = array['search_path=pg_catalog']::text[]
           from pg_proc procedure where procedure.oid = $1::regprocedure) as hardened`,
        [modalCommandSignature],
      );
      expect(privileges.rows).toEqual([
        {
          broker_execute: true,
          runtime_execute: false,
          public_execute: false,
          hardened: true,
        },
      ]);
      const ledgers = await client.query<{
        relforcerowsecurity: boolean;
        relname: string;
        relrowsecurity: boolean;
      }>(`select relname, relrowsecurity, relforcerowsecurity from pg_class
          where relnamespace = 'app'::regnamespace and relname = any(array[
            'routine_telebirr_modal_confirmations', 'routine_telebirr_modal_cutover'
          ]) order by relname`);
      expect(ledgers.rows).toHaveLength(2);
      expect(ledgers.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    });

    it('confirms a fresh exact success modal without a history receipt', async () => {
      const client = getClient();
      const originalModes = await client.query<{ feature_key: string; mode: string }>(
        `select feature_key, mode::text from app.feature_switches
          where feature_key in ('payment_verification', 'deposit_execution', 'private_live_deposit_pilot')
          order by feature_key`,
      );
      const password = randomBytes(32).toString('hex');
      const runtime = createRuntimeClient(password);
      let disabled = false;
      try {
        await client.query(
          `update app.feature_switches set mode = case
            when feature_key in ('payment_verification', 'deposit_execution') then 'live'::app.feature_mode
            else 'disabled'::app.feature_mode end
           where feature_key in ('payment_verification', 'deposit_execution', 'private_live_deposit_pilot')`,
        );
        const policy = await persistentPolicyFixture(client, getOwnerAuthUserId());
        const deposit = await paidJob(client, 10400);
        const certificate = await activeCertificate(client, getOwnerAdminId());
        await client.query(
          `select app.activate_routine_telebirr_execution_transport(
            $1::uuid, $2::uuid, $3::uuid, $4::text
          )`,
          [getOwnerAuthUserId(), certificate.certificateId, randomUUID(), password],
        );
        await runtime.connect();
        const command = leaseCommand(policy.accountId);
        const leased = (await execute(runtime, certificate, command)).result as Record<
          string,
          unknown
        >;
        const binding = {
          jobId: deposit.jobId,
          intentId: deposit.depositIntentId,
          attemptId: leased.attemptId,
          paymentClaimId: deposit.claimId,
          platformAgentAccountId: policy.accountId,
          playerId: deposit.playerId,
          amountMinor: 10400,
          currencyCode: 'ETB',
        };
        const modalCommand = boundCommand(command, 'confirm_modal', binding);
        await expect(execute(runtime, certificate, modalCommand)).rejects.toThrow();
        await execute(runtime, certificate, boundCommand(command, 'fence', binding));
        await expect(execute(runtime, certificate, modalCommand)).rejects.toThrow();
        const responseDigest = digest();
        await execute(
          runtime,
          certificate,
          boundCommand(command, 'record_dispatch', binding, {
            dispatch: {
              outcome: 'submission_attempted',
              providerResponseDigest: responseDigest,
              exactPlayerCreditMatch: true,
            },
          }),
        );
        const confirmed = await execute(runtime, certificate, modalCommand);
        expect(confirmed.result).toEqual(binding);
        expect(
          (await execute(runtime, certificate, modalCommand, confirmed.identities)).result,
        ).toEqual(binding);
        expect(
          (await execute(runtime, certificate, boundCommand(command, 'confirm_modal', binding)))
            .result,
        ).toEqual(binding);
        const state = await client.query<{
          attempt_status: string;
          intent_status: string;
          reason_code: string;
          modal_provider_response_digest: string;
          matched_history_occurred_at: Date | null;
          history_receipts: number;
          modal_receipts: number;
        }>(
          `select attempt.status::text as attempt_status,
             intent.status::text as intent_status,
             reconciliation.reason_code, reconciliation.modal_provider_response_digest,
             reconciliation.matched_history_occurred_at,
             (select count(*)::integer from app.routine_telebirr_history_confirmations history
               where history.execution_attempt_id = attempt.id) as history_receipts,
             (select count(*)::integer from app.routine_telebirr_modal_confirmations modal
               where modal.execution_attempt_id = attempt.id) as modal_receipts
           from app.deposit_execution_attempts attempt
           join app.deposit_intents intent on intent.id = attempt.deposit_intent_id
           join app.execution_reconciliations reconciliation
             on reconciliation.deposit_execution_attempt_id = attempt.id
          where attempt.id = $1::uuid`,
          [binding.attemptId],
        );
        expect(state.rows).toEqual([
          {
            attempt_status: 'confirmed_executed',
            intent_status: 'executed',
            reason_code: 'agent_transfer_success_modal_confirmed',
            modal_provider_response_digest: responseDigest,
            matched_history_occurred_at: null,
            history_receipts: 0,
            modal_receipts: 1,
          },
        ]);
        await client.query(
          `select app.disable_routine_telebirr_execution_transport($1::uuid, 'operator_requested')`,
          [randomUUID()],
        );
        disabled = true;
      } finally {
        await runtime.end().catch(() => undefined);
        if (!disabled)
          await client
            .query(
              `select app.disable_routine_telebirr_execution_transport($1::uuid, 'incident_stop')`,
              [randomUUID()],
            )
            .catch(() => undefined);
        for (const row of originalModes.rows)
          await client.query(
            `update app.feature_switches set mode = $2::app.feature_mode where feature_key = $1::text`,
            [row.feature_key, row.mode],
          );
      }
    });
  });
}
