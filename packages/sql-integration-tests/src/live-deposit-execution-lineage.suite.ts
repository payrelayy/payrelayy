import { createHash } from 'node:crypto';

import type { Client, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

type SqlValue = boolean | Date | number | string | null;

type TelegramLineageFixture = {
  readonly customerId: string;
  readonly playerId: string;
  readonly telegramIdentityId: string;
};

type SettlementRow = {
  readonly already_finalized: boolean;
  readonly deposit_intent_id: string;
  readonly deposit_status: string;
  readonly execution_job_id: string;
  readonly execution_job_status: string;
  readonly payment_claim_id: string;
  readonly updated_at: Date;
};

const playerActionsRuntimeRole = 'fetanagent_player_actions_runtime';
const settlementRuntimeRole = 'fetanagent_verification_settlement_runtime';
const executorRuntimeRole = 'fetanagent_deposit_executor_runtime';
const liveSwitchKeys = [
  'cbe_birr_authoritative_verification',
  'deposit_execution',
  'payment_verification',
] as const;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function payloadHmac(value: string): string {
  return `hmac-sha256-v1:${sha256(value)}`;
}

async function queryAsRole<T extends QueryResultRow>(
  client: Client,
  role: typeof executorRuntimeRole | typeof playerActionsRuntimeRole | typeof settlementRuntimeRole,
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  await client.query(`set local role ${role}`);
  const result = await client.query<T>(query, [...values]);
  await client.query('reset role');
  return result.rows;
}

async function expectPermissionDeniedAsRole(
  client: Client,
  role: typeof executorRuntimeRole,
  query: string,
  values: readonly SqlValue[],
): Promise<void> {
  await client.query('savepoint expected_lineage_permission_denial');
  let failure: unknown;
  try {
    await client.query(`set local role ${role}`);
    await client.query(query, [...values]);
  } catch (error) {
    failure = error;
  }

  await client.query('rollback to savepoint expected_lineage_permission_denial');
  await client.query('release savepoint expected_lineage_permission_denial');
  await client.query('reset role');

  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toMatch(/permission denied for function enqueue_verified/u);
}

async function withRollback(client: Client, body: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await body();
  } finally {
    await client.query('rollback');
  }
}

async function readFinancialSwitchModes(
  client: Client,
): Promise<readonly { readonly feature_key: string; readonly mode: string }[]> {
  const result = await client.query<{ readonly feature_key: string; readonly mode: string }>(`
    select feature_key, mode::text
      from app.feature_switches
     where feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification'
     )
     order by feature_key
  `);
  return result.rows;
}

async function enableDisposableFinancialSwitches(client: Client): Promise<void> {
  const updated = await client.query<{ readonly feature_key: string }>(`
    update app.feature_switches
       set mode = 'live'
     where feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification'
     )
    returning feature_key
  `);
  expect(updated.rows.map((row) => row.feature_key).sort()).toEqual([...liveSwitchKeys]);
}

async function createInboundEvent(
  client: Client,
  telegramIdentityId: string,
  externalEventId: string,
  digestSeed: string,
): Promise<string> {
  const event = await client.query<{ readonly id: string }>(
    `insert into app.inbound_events (
       channel, external_event_id, customer_identity_id, payload_digest
     ) values ('telegram', $1::text, $2::uuid, $3::text)
     returning id`,
    [externalEventId, telegramIdentityId, payloadHmac(digestSeed)],
  );
  expect(event.rows).toHaveLength(1);
  return event.rows[0]!.id;
}

async function createTelegramLineageFixture(client: Client): Promise<TelegramLineageFixture> {
  const fixtureSeed = sha256('live-deposit-execution-lineage');
  const telegramUserId = 9_970_000_101;
  const playerId = `LINEAGE-${fixtureSeed.slice(0, 20).toUpperCase()}`;

  await client.query(`set local session_replication_role = 'replica'`);

  const customer = await client.query<{ readonly id: string }>(
    `insert into app.customers (status) values ('active') returning id`,
  );
  const customerId = customer.rows[0]!.id;
  const telegramIdentity = await client.query<{ readonly id: string }>(
    `insert into app.customer_identities (
       customer_id, identity_kind, external_subject, status
     ) values ($1::uuid, 'telegram', $2::text, 'active')
     returning id`,
    [customerId, telegramUserId.toString()],
  );
  const telegramIdentityId = telegramIdentity.rows[0]!.id;

  await client.query(
    `insert into app.telegram_identities (
       customer_identity_id, telegram_user_id, private_chat_id, preferred_locale
     ) values ($1::uuid, $2::bigint, $2::bigint, 'en')`,
    [telegramIdentityId, telegramUserId],
  );
  await client.query(`insert into app.bot_conversations (telegram_identity_id) values ($1::uuid)`, [
    telegramIdentityId,
  ]);

  const admissionEventId = await createInboundEvent(
    client,
    telegramIdentityId,
    'update:9970000101',
    'lineage-admission',
  );
  const issuingAdmin = await client.query<{ readonly id: string }>(`
    select admin_user.id
      from app.admin_users admin_user
     where admin_user.role = 'owner'
       and admin_user.status = 'active'
     order by admin_user.id
     limit 1
  `);
  expect(issuingAdmin.rows).toHaveLength(1);
  const issuingAdminId = issuingAdmin.rows[0]!.id;
  await client.query(
    `insert into app.telegram_beta_invites (
       token_digest, status, expires_at, issued_by_admin_id, created_at,
       redeemed_telegram_user_id, redeemed_private_chat_id,
       redeemed_customer_id, redeemed_customer_identity_id,
       redeemed_inbound_event_id, redeemed_at
     ) values (
       $1::text, 'redeemed', clock_timestamp() + interval '1 hour',
       $2::uuid, clock_timestamp() - interval '10 minutes',
       $3::bigint, $3::bigint, $4::uuid, $5::uuid, $6::uuid,
       clock_timestamp() - interval '5 minutes'
     )`,
    [
      `sha256-v1:${sha256('lineage-invite')}`,
      issuingAdminId,
      telegramUserId,
      customerId,
      telegramIdentityId,
      admissionEventId,
    ],
  );

  const player = await client.query<{ readonly id: string }>(
    `insert into app.customer_platform_players (
       customer_id, platform_id, player_id, status, validation_status,
       last_validated_at, last_validation_reason_code
     )
     select $1::uuid, platform.id, $2::text, 'active', 'valid',
            clock_timestamp(), 'lineage_sql_fixture'
       from app.platforms platform
      where platform.code = 'kemerbet'
     returning id`,
    [customerId, playerId],
  );
  expect(player.rows).toHaveLength(1);
  await client.query(
    `insert into app.player_deposit_eligibility_decisions (
       player_account_id, decision_version, decision, reason_code, actor_kind,
       player_account_updated_at_snapshot, decided_at, created_at
     )
     select player_account.id, 1, 'eligible', 'financial_eligibility_approved', 'system',
            player_account.updated_at, statement_timestamp(), statement_timestamp()
       from app.customer_platform_players player_account
      where player_account.id = $1::uuid`,
    [player.rows[0]!.id],
  );

  const receiver = await client.query<{ readonly receiver_count: number }>(`
    select count(*)::integer as receiver_count
      from app.receiver_accounts receiver_account
      join app.payment_providers payment_provider
        on payment_provider.id = receiver_account.provider_id
     where payment_provider.code = 'cbe_birr'
       and receiver_account.status = 'active'
  `);
  if (receiver.rows[0]!.receiver_count === 0) {
    await client.query(`
      insert into app.receiver_accounts (
        provider_id, version, account_holder_name, account_reference_ciphertext,
        verification_reference_ciphertext, account_reference_masked, instructions
      )
      select payment_provider.id, 1, 'FetanAgent lineage SQL',
             'lineage-receiver-ciphertext', 'lineage-verification-ciphertext',
             '****7711', jsonb_build_object(
               'customer_message', 'Send CBE Birr to the shown test receiver.'
             )
        from app.payment_providers payment_provider
       where payment_provider.code = 'cbe_birr'
    `);
  }

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
    [
      `lineage-sql-agent-${fixtureSeed.slice(0, 8)}`,
      `secret://lineage-sql-agent-${fixtureSeed.slice(0, 8)}`,
    ],
  );

  await client.query(`set local session_replication_role = 'origin'`);
  return { customerId, playerId, telegramIdentityId };
}

async function createSyntheticOwnerVerification(
  client: Client,
  depositIntentId: string,
  referenceFingerprint: string,
): Promise<{ readonly evidenceId: string; readonly verificationAttemptId: string }> {
  const lineage = await client.query<{
    readonly opened_at: Date;
    readonly payment_provider_id: string;
    readonly receiver_account_id: string;
    readonly receiver_account_version: number;
    readonly submission_id: string;
    readonly verification_job_id: string;
  }>(
    `select intent.opened_at,
            intent.payment_provider_id,
            intent.receiver_account_id,
            intent.receiver_account_version,
            submission.id as submission_id,
            verification_job.id as verification_job_id
       from app.deposit_intents intent
       join app.deposit_submissions submission
         on submission.deposit_intent_id = intent.id
       join app.deposit_jobs verification_job
         on verification_job.deposit_intent_id = intent.id
        and verification_job.deposit_submission_id = submission.id
        and verification_job.job_kind = 'verify_deposit'
        and verification_job.status = 'queued'
        and verification_job.job_key =
          'cbe-birr-authoritative-verification:v1:' || submission.id::text
      where intent.id = $1::uuid
        and intent.status = 'verification_pending'
        and submission.status = 'verification_enqueued'
        and submission.submitted_reference_fingerprint = $2::text`,
    [depositIntentId, referenceFingerprint],
  );
  expect(lineage.rows).toHaveLength(1);
  const source = lineage.rows[0]!;

  // These lease, proof, and terminal-success writes are intentionally confined to the
  // disposable DB-owner fixture. They model the missing verifier's job bookkeeping without
  // creating or authorizing a production provider-verifier runtime.
  const leasedVerification = await client.query<{ readonly id: string }>(
    `update app.deposit_jobs
        set status = 'leased',
            attempt_count = attempt_count + 1,
            lease_token = gen_random_uuid(),
            leased_by = 'lineage_sql_fixture_verifier',
            lease_expires_at = clock_timestamp() + interval '5 minutes'
      where id = $1::uuid
        and status = 'queued'
        and attempt_count = 0
      returning id`,
    [source.verification_job_id],
  );
  expect(leasedVerification.rows).toEqual([{ id: source.verification_job_id }]);

  const evidence = await client.query<{ readonly id: string }>(
    `insert into app.provider_payment_evidence (
       payment_provider_id, canonical_reference_ciphertext,
       canonical_reference_fingerprint, canonical_reference_masked,
       reference_encryption_key_version, evidence_source, amount_minor, currency_code,
       occurred_at, matched_receiver_account_id, matched_receiver_account_version,
       evidence_digest, adapter_version, normalization_version, retrieved_at
     ) values (
       $1::uuid, 'lineage-provider-ciphertext', $2::text, '***7711', 1,
       'provider_receipt_lookup', 2500, 'ETB', $3::timestamptz + interval '1 millisecond',
       $4::uuid, $5::integer, $6::text, 'lineage_fixture_v1',
       'lineage_fixture_v1', $3::timestamptz + interval '2 milliseconds'
     )
     returning id`,
    [
      source.payment_provider_id,
      referenceFingerprint,
      source.opened_at,
      source.receiver_account_id,
      source.receiver_account_version,
      sha256(`lineage-evidence:${depositIntentId}`),
    ],
  );
  expect(evidence.rows).toHaveLength(1);

  const verification = await client.query<{ readonly id: string }>(
    `insert into app.deposit_verification_attempts (
       deposit_intent_id, deposit_submission_id, attempt_number, outcome, reason_code,
       provider_payment_evidence_id, adapter_version, response_digest,
       started_at, completed_at
     ) values (
       $1::uuid, $2::uuid, 1, 'verified', 'provider_payment_verified',
       $3::uuid, 'lineage_fixture_v1', $4::text,
       clock_timestamp() - interval '1 millisecond', clock_timestamp()
     )
     returning id`,
    [
      depositIntentId,
      source.submission_id,
      evidence.rows[0]!.id,
      sha256(`lineage-verification:${depositIntentId}`),
    ],
  );
  expect(verification.rows).toHaveLength(1);

  const completedVerification = await client.query<{
    readonly completed_at: Date;
    readonly status: string;
  }>(
    `update app.deposit_jobs
        set status = 'succeeded',
            lease_token = null,
            leased_by = null,
            lease_expires_at = null,
            last_error_code = null
      where id = $1::uuid
        and status = 'leased'
        and attempt_count = 1
      returning status::text, completed_at`,
    [source.verification_job_id],
  );
  expect(completedVerification.rows).toEqual([
    { completed_at: expect.any(Date), status: 'succeeded' },
  ]);

  return {
    evidenceId: evidence.rows[0]!.id,
    verificationAttemptId: verification.rows[0]!.id,
  };
}

export function registerLiveDepositExecutionLineageSqlTests(getClient: () => Client): void {
  describe('live Telegram deposit-to-executor SQL lineage', () => {
    it('captures, verifies, atomically settles, and leases one command without enqueue authority', async () => {
      const client = getClient();
      const switchModesBefore = await readFinancialSwitchModes(client);
      expect(switchModesBefore.map((row) => row.feature_key)).toEqual(liveSwitchKeys);

      await withRollback(client, async () => {
        const fixture = await createTelegramLineageFixture(client);
        await enableDisposableFinancialSwitches(client);

        const privileges = await client.query<{
          readonly executor_can_enqueue: boolean;
          readonly executor_can_lease: boolean;
          readonly executor_can_settle: boolean;
          readonly settlement_can_settle: boolean;
        }>(`
          select
            has_function_privilege(
              'fetanagent_deposit_executor_runtime',
              'app.enqueue_verified_deposit_execution(uuid)', 'execute'
            ) as executor_can_enqueue,
            has_function_privilege(
              'fetanagent_deposit_executor_runtime',
              'app.lease_next_deposit_execution(uuid,integer)', 'execute'
            ) as executor_can_lease,
            has_function_privilege(
              'fetanagent_deposit_executor_runtime',
              'app.finalize_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)', 'execute'
            ) as executor_can_settle,
            has_function_privilege(
              'fetanagent_verification_settlement_runtime',
              'app.finalize_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)', 'execute'
            ) as settlement_can_settle
        `);
        expect(privileges.rows).toEqual([
          {
            executor_can_enqueue: false,
            executor_can_lease: true,
            executor_can_settle: false,
            settlement_can_settle: true,
          },
        ]);

        const openEventId = await createInboundEvent(
          client,
          fixture.telegramIdentityId,
          'update:9970000102',
          'lineage-open',
        );
        const openInputHmac = payloadHmac('lineage-open-input');
        const opened = await queryAsRole<{
          readonly deposit_intent_id: string;
          readonly deposit_status: string;
          readonly origin_inbound_event_already_consumed: boolean;
        }>(
          client,
          playerActionsRuntimeRole,
          `select deposit_intent_id, deposit_status, origin_inbound_event_already_consumed
             from app.open_telegram_live_deposit_intent(
               $1::uuid, $2::text, 2500::bigint, $3::text
             )`,
          [openEventId, fixture.playerId, openInputHmac],
        );
        expect(opened).toEqual([
          {
            deposit_intent_id: expect.any(String),
            deposit_status: 'intake_received',
            origin_inbound_event_already_consumed: false,
          },
        ]);
        const depositIntentId = opened[0]!.deposit_intent_id;

        const openReplay = await queryAsRole<{
          readonly deposit_intent_id: string;
          readonly origin_inbound_event_already_consumed: boolean;
        }>(
          client,
          playerActionsRuntimeRole,
          `select deposit_intent_id, origin_inbound_event_already_consumed
             from app.open_telegram_live_deposit_intent(
               $1::uuid, $2::text, 2500::bigint, $3::text
             )`,
          [openEventId, fixture.playerId, openInputHmac],
        );
        expect(openReplay).toEqual([
          {
            deposit_intent_id: depositIntentId,
            origin_inbound_event_already_consumed: true,
          },
        ]);

        const captureEventId = await createInboundEvent(
          client,
          fixture.telegramIdentityId,
          'update:9970000103',
          'lineage-capture',
        );
        const referenceFingerprint = sha256('lineage-customer-reference');
        const referenceCiphertext = `v1.${'l'.repeat(16)}.${'t'.repeat(22)}.lineage7`;
        const captureInputHmac = payloadHmac('lineage-capture-input');
        const captured = await queryAsRole<{
          readonly deposit_status: string;
          readonly origin_inbound_event_already_consumed: boolean;
          readonly result_deposit_intent_id: string;
          readonly submission_status: string;
        }>(
          client,
          playerActionsRuntimeRole,
          `select result_deposit_intent_id, submission_status, deposit_status,
                  origin_inbound_event_already_consumed
             from app.capture_telegram_live_deposit_reference(
               $1::uuid, $2::uuid, $3::text, $4::text,
               '***7711'::text, 1::smallint, $5::text
             )`,
          [
            captureEventId,
            depositIntentId,
            referenceCiphertext,
            referenceFingerprint,
            captureInputHmac,
          ],
        );
        expect(captured).toEqual([
          {
            deposit_status: 'verification_pending',
            origin_inbound_event_already_consumed: false,
            result_deposit_intent_id: depositIntentId,
            submission_status: 'verification_enqueued',
          },
        ]);

        const captureReplay = await queryAsRole<{
          readonly origin_inbound_event_already_consumed: boolean;
          readonly result_deposit_intent_id: string;
        }>(
          client,
          playerActionsRuntimeRole,
          `select result_deposit_intent_id, origin_inbound_event_already_consumed
             from app.capture_telegram_live_deposit_reference(
               $1::uuid, $2::uuid, $3::text, $4::text,
               '***7711'::text, 1::smallint, $5::text
             )`,
          [
            captureEventId,
            depositIntentId,
            referenceCiphertext,
            referenceFingerprint,
            captureInputHmac,
          ],
        );
        expect(captureReplay).toEqual([
          {
            origin_inbound_event_already_consumed: true,
            result_deposit_intent_id: depositIntentId,
          },
        ]);

        const proof = await createSyntheticOwnerVerification(
          client,
          depositIntentId,
          referenceFingerprint,
        );
        const settlement = await queryAsRole<SettlementRow>(
          client,
          settlementRuntimeRole,
          `select * from app.finalize_verified_deposit_and_enqueue_execution(
             $1::uuid, $2::uuid, $3::uuid
           )`,
          [depositIntentId, proof.verificationAttemptId, proof.evidenceId],
        );
        expect(settlement).toEqual([
          {
            already_finalized: false,
            deposit_intent_id: depositIntentId,
            deposit_status: 'execution_pending',
            execution_job_id: expect.any(String),
            execution_job_status: 'queued',
            payment_claim_id: expect.any(String),
            updated_at: expect.any(Date),
          },
        ]);

        const settlementReplay = await queryAsRole<SettlementRow>(
          client,
          settlementRuntimeRole,
          `select * from app.finalize_verified_deposit_and_enqueue_execution(
             $1::uuid, $2::uuid, $3::uuid
           )`,
          [depositIntentId, proof.verificationAttemptId, proof.evidenceId],
        );
        expect(settlementReplay).toEqual([{ ...settlement[0]!, already_finalized: true }]);

        await expectPermissionDeniedAsRole(
          client,
          executorRuntimeRole,
          `select * from app.enqueue_verified_deposit_execution($1::uuid)`,
          [depositIntentId],
        );

        const commandState = await client.query<{
          readonly claims: number;
          readonly execution_jobs: number;
          readonly intent_status: string;
          readonly queued_execution_jobs: number;
          readonly submission_status: string;
          readonly verification_job_completed_at: Date;
          readonly verification_job_status: string;
          readonly verification_jobs: number;
        }>(
          `select intent.status::text as intent_status,
                  submission.status::text as submission_status,
                  (select count(*)::integer
                     from app.deposit_payment_claims claim
                    where claim.deposit_intent_id = intent.id) as claims,
                  (select count(*)::integer
                     from app.deposit_jobs job
                    where job.deposit_intent_id = intent.id
                      and job.job_kind = 'verify_deposit') as verification_jobs,
                  (select job.status::text
                     from app.deposit_jobs job
                    where job.deposit_intent_id = intent.id
                      and job.job_kind = 'verify_deposit') as verification_job_status,
                  (select job.completed_at
                     from app.deposit_jobs job
                    where job.deposit_intent_id = intent.id
                      and job.job_kind = 'verify_deposit') as verification_job_completed_at,
                  (select count(*)::integer
                     from app.deposit_jobs job
                    where job.deposit_intent_id = intent.id
                      and job.job_kind = 'execute_deposit') as execution_jobs,
                  (select count(*)::integer
                     from app.deposit_jobs job
                    where job.deposit_intent_id = intent.id
                      and job.job_kind = 'execute_deposit'
                      and job.status = 'queued') as queued_execution_jobs
             from app.deposit_intents intent
             join app.deposit_submissions submission
               on submission.deposit_intent_id = intent.id
            where intent.id = $1::uuid`,
          [depositIntentId],
        );
        expect(commandState.rows).toEqual([
          {
            claims: 1,
            execution_jobs: 1,
            intent_status: 'execution_pending',
            queued_execution_jobs: 1,
            submission_status: 'verified',
            verification_job_completed_at: expect.any(Date),
            verification_job_status: 'succeeded',
            verification_jobs: 1,
          },
        ]);

        const leased = await queryAsRole<{
          readonly amount_minor: string;
          readonly currency_code: string;
          readonly deposit_intent_id: string;
          readonly execution_attempt_id: string;
          readonly execution_job_id: string;
          readonly lease_disposition: string;
          readonly lease_expires_at: Date;
          readonly lease_token: string;
          readonly platform_agent_account_id: string;
          readonly player_id: string;
        }>(
          client,
          executorRuntimeRole,
          `select * from app.lease_next_deposit_execution(
             '97777777-7777-4777-8777-777777777777'::uuid, 300
           )`,
        );
        expect(leased).toEqual([
          {
            amount_minor: '2500',
            currency_code: 'ETB',
            deposit_intent_id: depositIntentId,
            execution_attempt_id: expect.any(String),
            execution_job_id: settlement[0]!.execution_job_id,
            lease_disposition: 'execution',
            lease_expires_at: expect.any(Date),
            lease_token: expect.any(String),
            platform_agent_account_id: expect.any(String),
            player_id: fixture.playerId,
          },
        ]);

        const afterLease = await client.query<{
          readonly execution_jobs: number;
          readonly leased_execution_jobs: number;
          readonly queued_execution_jobs: number;
        }>(
          `select count(*)::integer as execution_jobs,
                  count(*) filter (where status = 'queued')::integer
                    as queued_execution_jobs,
                  count(*) filter (where status = 'leased')::integer
                    as leased_execution_jobs
             from app.deposit_jobs
            where deposit_intent_id = $1::uuid
              and job_kind = 'execute_deposit'`,
          [depositIntentId],
        );
        expect(afterLease.rows).toEqual([
          { execution_jobs: 1, leased_execution_jobs: 1, queued_execution_jobs: 0 },
        ]);
      });

      expect(await readFinancialSwitchModes(client)).toEqual(switchModesBefore);
    });
  });
}
