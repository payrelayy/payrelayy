import { createHash } from 'node:crypto';
import type { Client, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

type ClientFactory = () => Client;
type ClientGetter = () => Client;
type SqlValue = boolean | Date | number | string | null;

type SettlementFixture = {
  readonly depositIntentId: string;
  readonly evidenceId: string;
  readonly playerAccountId: string;
  readonly sensitiveReferenceMaterial: readonly string[];
  readonly submissionId: string;
  readonly verificationAttemptId: string;
};

type SettlementFixtureOptions = {
  readonly evidenceAmountMinor?: number;
  readonly evidenceReceiverMatches?: boolean;
  readonly evidenceReferenceMatches?: boolean;
  readonly evidenceTiming?: 'before-intent' | 'valid';
};

type SettlementInput = {
  readonly depositIntentId: string;
  readonly evidenceId: string;
  readonly verificationAttemptId: string;
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

type SettlementSnapshot = {
  readonly deposit_status: string;
  readonly execution_jobs: number;
  readonly payment_claims: number;
  readonly submission_status: string;
};

type PreparedSettlementExecution = {
  readonly executionAttemptId: string;
  readonly executionJobId: string;
  readonly executionLeaseToken: string;
  readonly fixture: SettlementFixture;
  readonly paymentClaimId: string;
};

type SettlementTransitionKind = 'cancel' | 'fence' | 'handoff';
type SettlementTransitionOrder = 'settlement-first' | 'transition-first';

const settlementFunction =
  'app.finalize_private_live_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)';
const legacySettlementFunction =
  'app.finalize_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)';
const executorRole = 'fetanagent_deposit_executor_runtime';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function settlementInput(fixture: SettlementFixture): SettlementInput {
  return {
    depositIntentId: fixture.depositIntentId,
    evidenceId: fixture.evidenceId,
    verificationAttemptId: fixture.verificationAttemptId,
  };
}

function expectNoSensitiveReferenceMaterial(
  text: string,
  fixtures: readonly SettlementFixture[],
): void {
  for (const fixture of fixtures) {
    for (const sensitiveValue of fixture.sensitiveReferenceMaterial) {
      expect(text).not.toContain(sensitiveValue);
    }
  }
}

async function queryLegacySettlementAsMigrationOwner<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  await client.query('begin');
  try {
    const result = await client.query<T>(query, [...values]);
    await client.query('commit');
    return result.rows;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function queryAsExecutor<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  await client.query('begin');
  try {
    await client.query(`set local role ${executorRole}`);
    const result = await client.query<T>(query, [...values]);
    await client.query('commit');
    return result.rows;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function callSettlement(
  client: Client,
  input: SettlementInput,
): Promise<readonly SettlementRow[]> {
  // These legacy semantic tests execute as the disposable migration owner. The production
  // settlement role is intentionally denied this RPC by the private-pilot boundary and is
  // covered through the strict wrapper in the pilot suite.
  return queryLegacySettlementAsMigrationOwner<SettlementRow>(
    client,
    `select *
       from app.finalize_verified_deposit_and_enqueue_execution(
         $1::uuid, $2::uuid, $3::uuid
       )`,
    [input.depositIntentId, input.verificationAttemptId, input.evidenceId],
  );
}

async function callSettlementInCurrentTransaction(
  client: Client,
  input: SettlementInput,
): Promise<readonly SettlementRow[]> {
  const result = await client.query<SettlementRow>(
    `select *
       from app.finalize_verified_deposit_and_enqueue_execution(
         $1::uuid, $2::uuid, $3::uuid
       )`,
    [input.depositIntentId, input.verificationAttemptId, input.evidenceId],
  );
  return result.rows;
}

async function captureSettlementFailure(client: Client, input: SettlementInput): Promise<string> {
  try {
    await callSettlement(client, input);
  } catch (error) {
    return errorMessage(error);
  }

  throw new Error('The hostile settlement call unexpectedly succeeded.');
}

async function captureSettlementFailureAtSavepoint(
  client: Client,
  input: SettlementInput,
): Promise<string> {
  await client.query('savepoint expected_settlement_failure');
  let failure: unknown;
  try {
    await client.query(
      `select *
         from app.finalize_verified_deposit_and_enqueue_execution(
           $1::uuid, $2::uuid, $3::uuid
         )`,
      [input.depositIntentId, input.verificationAttemptId, input.evidenceId],
    );
  } catch (error) {
    failure = error;
  }

  await client.query('rollback to savepoint expected_settlement_failure');
  await client.query('release savepoint expected_settlement_failure');

  if (failure === undefined) {
    throw new Error('The hostile settlement call unexpectedly succeeded.');
  }
  return errorMessage(failure);
}

async function enableLiveFinancialSwitches(client: Client): Promise<void> {
  await client.query(`
    update app.feature_switches
       set mode = 'live'
     where feature_key in ('payment_verification', 'deposit_execution')
  `);
}

async function createSettlementFixture(
  client: Client,
  suffix: string,
  options: SettlementFixtureOptions = {},
): Promise<SettlementFixture> {
  await enableLiveFinancialSwitches(client);

  const customer = await client.query<{ readonly id: string }>(
    `insert into app.customers default values returning id`,
  );
  const platform = await client.query<{ readonly id: string }>(
    `select id from app.platforms where code = 'kemerbet' and status = 'active'`,
  );
  expect(platform.rows).toHaveLength(1);

  const fixtureDigest = sha256(`verification-settlement:${suffix}`);
  const player = await client.query<{ readonly id: string }>(
    `insert into app.customer_platform_players (customer_id, platform_id, player_id)
     values ($1::uuid, $2::uuid, $3::text)
     returning id`,
    [customer.rows[0]!.id, platform.rows[0]!.id, `SETTLEMENT-${fixtureDigest.slice(0, 24)}`],
  );
  const playerAccountId = player.rows[0]!.id;

  await client.query(
    `insert into app.player_validation_attempts (
       player_account_id, attempt_number, outcome, reason_code, adapter_version,
       started_at, completed_at, result_digest
     ) values (
       $1::uuid, 1, 'valid', 'verification_settlement_fixture', 'fixture_v1',
       clock_timestamp() - interval '1 second', clock_timestamp(), $2::text
     )`,
    [playerAccountId, `verification-settlement-validation-${fixtureDigest}`],
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

  const paymentBoundary = await client.query<{
    readonly payment_provider_id: string;
    readonly receiver_account_id: string;
    readonly receiver_account_version: number;
  }>(`
    select provider.id as payment_provider_id,
           receiver.id as receiver_account_id,
           receiver.version as receiver_account_version
      from app.payment_providers provider
      join app.receiver_accounts receiver
        on receiver.provider_id = provider.id
       and receiver.status = 'active'
     where provider.code = 'cbe_birr'
       and provider.status = 'active'
  `);
  expect(paymentBoundary.rows).toHaveLength(1);

  const intent = await client.query<{
    readonly id: string;
    readonly opened_at: Date;
  }>(
    `insert into app.deposit_intents (
       customer_id, platform_id, player_account_id, payment_provider_id,
       receiver_account_id, expected_amount_minor
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 2500)
     returning id, opened_at`,
    [
      customer.rows[0]!.id,
      platform.rows[0]!.id,
      playerAccountId,
      paymentBoundary.rows[0]!.payment_provider_id,
      paymentBoundary.rows[0]!.receiver_account_id,
    ],
  );
  const depositIntentId = intent.rows[0]!.id;
  const submittedReferenceCiphertext = `raw-submitted-reference-${suffix}-${fixtureDigest}`;
  const submittedReferenceFingerprint = sha256(`submitted-reference:${suffix}`);
  const submittedReferenceMasked = `***${fixtureDigest.slice(-16)}`;
  const canonicalReferenceCiphertext = `raw-provider-reference-${suffix}-${fixtureDigest}`;
  const canonicalReferenceFingerprint =
    options.evidenceReferenceMatches === false
      ? sha256(`different-provider-reference:${suffix}`)
      : submittedReferenceFingerprint;
  const canonicalReferenceMasked = `***${fixtureDigest.slice(-32, -16)}`;

  const submission = await client.query<{ readonly id: string }>(
    `insert into app.deposit_submissions (
       deposit_intent_id, submission_number, submitted_reference_ciphertext,
       submitted_reference_fingerprint, submitted_reference_masked,
       reference_encryption_key_version
     ) values ($1::uuid, 1, $2::text, $3::text, $4::text, 1)
     returning id`,
    [
      depositIntentId,
      submittedReferenceCiphertext,
      submittedReferenceFingerprint,
      submittedReferenceMasked,
    ],
  );
  const submissionId = submission.rows[0]!.id;

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
    [submissionId],
  );

  const occurredAt =
    options.evidenceTiming === 'before-intent'
      ? new Date(intent.rows[0]!.opened_at.getTime() - 1_000)
      : new Date(intent.rows[0]!.opened_at.getTime() + 1);
  const retrievedAt = new Date(occurredAt.getTime() + 1);
  const evidence = await client.query<{ readonly id: string }>(
    `insert into app.provider_payment_evidence (
       payment_provider_id, canonical_reference_ciphertext,
       canonical_reference_fingerprint, canonical_reference_masked,
       reference_encryption_key_version, evidence_source, amount_minor, currency_code,
       occurred_at, matched_receiver_account_id, matched_receiver_account_version,
       evidence_digest, adapter_version, normalization_version, retrieved_at
     ) values (
       $1::uuid, $2::text, $3::text, $4::text, 1, 'provider_receipt_lookup',
       $5::bigint, 'ETB', $6::timestamptz, $7::uuid, $8::integer,
       $9::text, 'fixture_v1', 'fixture_v1', $10::timestamptz
     )
     returning id`,
    [
      paymentBoundary.rows[0]!.payment_provider_id,
      canonicalReferenceCiphertext,
      canonicalReferenceFingerprint,
      canonicalReferenceMasked,
      options.evidenceAmountMinor ?? 2500,
      occurredAt,
      options.evidenceReceiverMatches === false
        ? null
        : paymentBoundary.rows[0]!.receiver_account_id,
      options.evidenceReceiverMatches === false
        ? null
        : paymentBoundary.rows[0]!.receiver_account_version,
      `verification-settlement-evidence-${fixtureDigest}`,
      retrievedAt,
    ],
  );
  const evidenceId = evidence.rows[0]!.id;

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
    [depositIntentId, submissionId, evidenceId, `verification-response-${fixtureDigest}`],
  );

  return {
    depositIntentId,
    evidenceId,
    playerAccountId,
    sensitiveReferenceMaterial: [
      submittedReferenceCiphertext,
      submittedReferenceFingerprint,
      submittedReferenceMasked,
      canonicalReferenceCiphertext,
      canonicalReferenceFingerprint,
      canonicalReferenceMasked,
    ],
    submissionId,
    verificationAttemptId: verification.rows[0]!.id,
  };
}

async function readSettlementSnapshot(
  client: Client,
  fixture: SettlementFixture,
): Promise<SettlementSnapshot> {
  const result = await client.query<SettlementSnapshot>(
    `select intent.status::text as deposit_status,
            submission.status::text as submission_status,
            (select count(*)::integer
               from app.deposit_payment_claims claim
              where claim.deposit_intent_id = intent.id) as payment_claims,
            (select count(*)::integer
               from app.deposit_jobs job
              where job.deposit_intent_id = intent.id
                and job.job_kind = 'execute_deposit') as execution_jobs
       from app.deposit_intents intent
       join app.deposit_submissions submission
         on submission.id = $2::uuid
        and submission.deposit_intent_id = intent.id
      where intent.id = $1::uuid`,
    [fixture.depositIntentId, fixture.submissionId],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

async function expectPendingWithoutSettlement(
  client: Client,
  fixture: SettlementFixture,
): Promise<void> {
  expect(await readSettlementSnapshot(client, fixture)).toEqual({
    deposit_status: 'verification_pending',
    execution_jobs: 0,
    payment_claims: 0,
    submission_status: 'verification_enqueued',
  });
}

async function expectProofFailure(
  client: Client,
  fixture: SettlementFixture,
  input: SettlementInput,
  sensitiveFixtures: readonly SettlementFixture[] = [fixture],
): Promise<void> {
  const message = await captureSettlementFailure(client, input);
  expect(message).toMatch(/verified deposit settlement proof is invalid/i);
  expectNoSensitiveReferenceMaterial(message, sensitiveFixtures);
  await expectPendingWithoutSettlement(client, fixture);
}

async function expectFailureAfterMutation(
  client: Client,
  fixture: SettlementFixture,
  mutate: (connection: Client) => Promise<void>,
  expectedMessage: RegExp,
): Promise<string> {
  let failureMessage = '';
  await client.query('begin');
  try {
    await mutate(client);
    failureMessage = await captureSettlementFailureAtSavepoint(client, settlementInput(fixture));
    expect(failureMessage).toMatch(expectedMessage);
    expectNoSensitiveReferenceMaterial(failureMessage, [fixture]);
    await expectPendingWithoutSettlement(client, fixture);
  } finally {
    await client.query('rollback');
  }
  await expectPendingWithoutSettlement(client, fixture);
  return failureMessage;
}

async function rotateActiveKemerbetAgent(client: Client, suffix: string): Promise<string> {
  await client.query(`
    update app.platform_agent_accounts agent
       set status = 'inactive'
      from app.platforms platform
     where platform.id = agent.platform_id
       and platform.code = 'kemerbet'
       and agent.status = 'active'
  `);
  const inserted = await client.query<{ readonly id: string }>(
    `insert into app.platform_agent_accounts (platform_id, label, credential_ref)
     select platform.id, $1::text, $2::text
       from app.platforms platform
      where platform.code = 'kemerbet'
        and platform.status = 'active'
     returning id`,
    [`settlement-lock-order-${suffix}`, `secret://settlement-lock-order-${suffix}`],
  );
  expect(inserted.rows).toHaveLength(1);
  return inserted.rows[0]!.id;
}

async function prepareSettlementExecution(
  client: Client,
  kind: SettlementTransitionKind,
  suffix: string,
): Promise<PreparedSettlementExecution> {
  const platformAgentAccountId = await rotateActiveKemerbetAgent(client, suffix);
  const fixture = await createSettlementFixture(client, suffix);
  const settled = await callSettlement(client, settlementInput(fixture));
  expect(settled).toHaveLength(1);
  expect(settled[0]).toMatchObject({
    already_finalized: false,
    deposit_intent_id: fixture.depositIntentId,
    deposit_status: 'execution_pending',
    execution_job_status: 'queued',
  });

  await client.query('begin');
  try {
    const leased = await client.query<{ readonly lease_token: string }>(
      `update app.deposit_jobs
          set status = 'leased',
              attempt_count = 1,
              lease_token = gen_random_uuid(),
              leased_by = $2::text,
              lease_expires_at = clock_timestamp() + interval '5 minutes'
        where id = $1::uuid
          and deposit_intent_id = $3::uuid
          and job_kind = 'execute_deposit'
          and status = 'queued'
        returning lease_token`,
      [settled[0]!.execution_job_id, `settlement-lock-order-${suffix}`, fixture.depositIntentId],
    );
    expect(leased.rows).toHaveLength(1);

    const attempt = await client.query<{ readonly id: string }>(
      `insert into app.deposit_execution_attempts (
         deposit_intent_id, deposit_job_id, platform_agent_account_id, attempt_number
       ) values ($1::uuid, $2::uuid, $3::uuid, 1)
       returning id`,
      [fixture.depositIntentId, settled[0]!.execution_job_id, platformAgentAccountId],
    );
    expect(attempt.rows).toHaveLength(1);
    await client.query('commit');

    const prepared = {
      executionAttemptId: attempt.rows[0]!.id,
      executionJobId: settled[0]!.execution_job_id,
      executionLeaseToken: leased.rows[0]!.lease_token,
      fixture,
      paymentClaimId: settled[0]!.payment_claim_id,
    };

    if (kind === 'handoff') {
      // The live executor can fence only through the private-pilot wrapper now. This historical
      // non-pilot regression invokes the revoked legacy primitive as the disposable migration
      // owner; the private-pilot suite exercises the granted wrapper and its exact envelope.
      const fenced = await client.query<{ readonly first_fence_acquired: boolean }>(
        `select first_fence_acquired
           from app.fence_deposit_execution_final_action($1::uuid, $2::uuid)`,
        [prepared.executionAttemptId, prepared.executionLeaseToken],
      );
      expect(fenced.rows).toEqual([{ first_fence_acquired: true }]);
    }

    return prepared;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function beginRoleTransaction(
  client: Client,
  role: typeof executorRole | null,
  applicationName: string,
): Promise<void> {
  await client.query(`select set_config('application_name', $1::text, false)`, [applicationName]);
  await client.query('begin');
  if (role !== null) {
    await client.query(`set local role ${role}`);
  }
  await client.query(`set local lock_timeout = '5s'`);
  await client.query(`set local statement_timeout = '10s'`);
}

async function waitForAdvisoryLock(client: Client, applicationName: string): Promise<void> {
  for (let poll = 0; poll < 100; poll += 1) {
    const activity = await client.query<{
      readonly state: string;
      readonly wait_event: string | null;
      readonly wait_event_type: string | null;
    }>(
      `select state, wait_event_type, wait_event
         from pg_stat_activity
        where application_name = $1::text
          and pid <> pg_backend_pid()`,
      [applicationName],
    );
    expect(activity.rows.length).toBeLessThanOrEqual(1);
    const row = activity.rows[0];
    if (row?.wait_event_type === 'Lock') {
      expect(row.wait_event?.toLowerCase()).toBe('advisory');
      return;
    }
    if (row?.state.startsWith('idle')) {
      throw new Error('The lock-order waiter completed before reaching the intent advisory lock.');
    }
    await client.query(`select pg_sleep(0.025)`);
  }

  throw new Error('The lock-order waiter did not reach the intent advisory lock in time.');
}

async function awaitWithoutDeadlock<T>(pending: Promise<T>): Promise<T> {
  try {
    return await pending;
  } catch (error) {
    const sqlState =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { readonly code?: unknown }).code)
        : null;
    expect(sqlState).not.toBe('40P01');
    throw error;
  }
}

async function callExecutionTransitionInCurrentTransaction(
  client: Client,
  kind: SettlementTransitionKind,
  prepared: PreparedSettlementExecution,
): Promise<readonly QueryResultRow[]> {
  if (kind === 'cancel') {
    const result = await client.query<{
      readonly attempt_status: string;
      readonly deposit_status: string;
    }>(
      `select attempt_status, deposit_status
         from app.cancel_deposit_execution_before_action(
           $1::uuid, $2::uuid, 'session_unavailable_before_action'
         )`,
      [prepared.executionAttemptId, prepared.executionLeaseToken],
    );
    return result.rows;
  }

  if (kind === 'fence') {
    const result = await client.query<{ readonly first_fence_acquired: boolean }>(
      `select first_fence_acquired
         from app.fence_deposit_execution_final_action($1::uuid, $2::uuid)`,
      [prepared.executionAttemptId, prepared.executionLeaseToken],
    );
    return result.rows;
  }

  const result = await client.query<{
    readonly attempt_status: string;
    readonly deposit_status: string;
    readonly recovery_handoff: boolean;
  }>(
    `select attempt_status, deposit_status, recovery_handoff
       from app.require_deposit_execution_reconciliation($1::uuid, $2::uuid, true)`,
    [prepared.executionAttemptId, prepared.executionLeaseToken],
  );
  return result.rows;
}

function expectExecutionTransitionResult(
  kind: SettlementTransitionKind,
  rows: readonly QueryResultRow[],
): void {
  if (kind === 'cancel') {
    expect(rows).toEqual([
      { attempt_status: 'cancelled_before_action', deposit_status: 'execution_review' },
    ]);
  } else if (kind === 'fence') {
    expect(rows).toEqual([{ first_fence_acquired: true }]);
  } else {
    expect(rows).toEqual([
      {
        attempt_status: 'reconciliation_required',
        deposit_status: 'execution_reconciliation',
        recovery_handoff: false,
      },
    ]);
  }
}

function expectedReplayState(
  kind: SettlementTransitionKind,
  transitionCompleted: boolean,
): { readonly depositStatus: string; readonly executionJobStatus: string } {
  if (!transitionCompleted) {
    return kind === 'handoff'
      ? { depositStatus: 'execution_in_progress', executionJobStatus: 'leased' }
      : { depositStatus: 'execution_pending', executionJobStatus: 'leased' };
  }
  if (kind === 'cancel') {
    return { depositStatus: 'execution_review', executionJobStatus: 'cancelled' };
  }
  if (kind === 'fence') {
    return { depositStatus: 'execution_in_progress', executionJobStatus: 'leased' };
  }
  return { depositStatus: 'execution_reconciliation', executionJobStatus: 'succeeded' };
}

function expectExactSettlementReplay(
  rows: readonly SettlementRow[],
  prepared: PreparedSettlementExecution,
  kind: SettlementTransitionKind,
  transitionCompleted: boolean,
): void {
  const expected = expectedReplayState(kind, transitionCompleted);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    already_finalized: true,
    deposit_intent_id: prepared.fixture.depositIntentId,
    deposit_status: expected.depositStatus,
    execution_job_id: prepared.executionJobId,
    execution_job_status: expected.executionJobStatus,
    payment_claim_id: prepared.paymentClaimId,
  });
  expectNoSensitiveReferenceMaterial(JSON.stringify(rows), [prepared.fixture]);
}

async function expectFinalTransitionLedger(
  client: Client,
  prepared: PreparedSettlementExecution,
  kind: SettlementTransitionKind,
): Promise<void> {
  const result = await client.query<{
    readonly attempt_status: string;
    readonly deposit_status: string;
    readonly execution_attempts: number;
    readonly execution_job_id: string;
    readonly execution_job_status: string;
    readonly execution_jobs: number;
    readonly payment_claim_id: string;
    readonly payment_claims: number;
    readonly reconciliation_jobs: number;
  }>(
    `select intent.status::text as deposit_status,
            attempt.status::text as attempt_status,
            job.id as execution_job_id,
            job.status::text as execution_job_status,
            (select count(*)::integer from app.deposit_payment_claims claim
              where claim.deposit_intent_id = intent.id) as payment_claims,
            (select max(claim.id::text) from app.deposit_payment_claims claim
              where claim.deposit_intent_id = intent.id) as payment_claim_id,
            (select count(*)::integer from app.deposit_jobs history
              where history.deposit_intent_id = intent.id
                and history.job_kind = 'execute_deposit') as execution_jobs,
            (select count(*)::integer from app.deposit_execution_attempts history
              where history.deposit_intent_id = intent.id) as execution_attempts,
            (select count(*)::integer from app.deposit_jobs history
              where history.deposit_intent_id = intent.id
                and history.job_kind = 'reconcile_execution') as reconciliation_jobs
       from app.deposit_intents intent
       join app.deposit_execution_attempts attempt
         on attempt.id = $2::uuid
        and attempt.deposit_intent_id = intent.id
       join app.deposit_jobs job
         on job.id = $3::uuid
        and job.deposit_intent_id = intent.id
      where intent.id = $1::uuid`,
    [prepared.fixture.depositIntentId, prepared.executionAttemptId, prepared.executionJobId],
  );
  const expected =
    kind === 'cancel'
      ? {
          attempt_status: 'cancelled_before_action',
          deposit_status: 'execution_review',
          execution_job_status: 'cancelled',
          reconciliation_jobs: 0,
        }
      : kind === 'fence'
        ? {
            attempt_status: 'final_action_fenced',
            deposit_status: 'execution_in_progress',
            execution_job_status: 'leased',
            reconciliation_jobs: 0,
          }
        : {
            attempt_status: 'reconciliation_required',
            deposit_status: 'execution_reconciliation',
            execution_job_status: 'succeeded',
            reconciliation_jobs: 1,
          };
  expect(result.rows).toEqual([
    {
      ...expected,
      execution_attempts: 1,
      execution_job_id: prepared.executionJobId,
      execution_jobs: 1,
      payment_claim_id: prepared.paymentClaimId,
      payment_claims: 1,
    },
  ]);
}

async function runSettlementTransitionLockOrderRace(
  client: Client,
  createClient: ClientFactory,
  kind: SettlementTransitionKind,
  order: SettlementTransitionOrder,
): Promise<void> {
  const suffix = `${kind}-${order}`;
  const prepared = await prepareSettlementExecution(client, kind, suffix);

  await withConnectedClients(createClient, async (settlementClient, executorClient) => {
    let pending: Promise<unknown> | null = null;
    try {
      if (order === 'settlement-first') {
        await beginRoleTransaction(settlementClient, null, `settlement_lock_${kind}_blocker`);
        const blockingReplay = await callSettlementInCurrentTransaction(
          settlementClient,
          settlementInput(prepared.fixture),
        );
        expectExactSettlementReplay(blockingReplay, prepared, kind, false);

        const waiterName = `settlement_lock_${kind}_executor_waiter`;
        await beginRoleTransaction(
          executorClient,
          kind === 'fence' ? null : executorRole,
          waiterName,
        );
        const transitionPending = callExecutionTransitionInCurrentTransaction(
          executorClient,
          kind,
          prepared,
        );
        pending = transitionPending;
        void transitionPending.catch(() => undefined);
        await waitForAdvisoryLock(client, waiterName);
        await settlementClient.query('commit');
        const transitionRows = await awaitWithoutDeadlock(transitionPending);
        expectExecutionTransitionResult(kind, transitionRows);
        await executorClient.query('commit');
      } else {
        await beginRoleTransaction(
          executorClient,
          kind === 'fence' ? null : executorRole,
          `settlement_lock_${kind}_blocker`,
        );
        const blockingTransition = await callExecutionTransitionInCurrentTransaction(
          executorClient,
          kind,
          prepared,
        );
        expectExecutionTransitionResult(kind, blockingTransition);

        const waiterName = `settlement_lock_${kind}_settlement_waiter`;
        await beginRoleTransaction(settlementClient, null, waiterName);
        const replayPending = callSettlementInCurrentTransaction(
          settlementClient,
          settlementInput(prepared.fixture),
        );
        pending = replayPending;
        void replayPending.catch(() => undefined);
        await waitForAdvisoryLock(client, waiterName);
        await executorClient.query('commit');
        const replayRows = await awaitWithoutDeadlock(replayPending);
        expectExactSettlementReplay(replayRows, prepared, kind, true);
        await settlementClient.query('commit');
      }
    } finally {
      await Promise.allSettled([
        settlementClient.query('rollback'),
        executorClient.query('rollback'),
      ]);
      if (pending !== null) {
        await pending.catch(() => undefined);
      }
    }
  });

  await expectFinalTransitionLedger(client, prepared, kind);
}

async function withConnectedClients<T>(
  createClient: ClientFactory,
  operation: (left: Client, right: Client) => Promise<T>,
): Promise<T> {
  const left = createClient();
  const right = createClient();
  await Promise.all([left.connect(), right.connect()]);
  try {
    return await operation(left, right);
  } finally {
    await Promise.allSettled([left.end(), right.end()]);
  }
}

export function registerVerificationSettlementSqlTests(
  getClient: ClientGetter,
  createClient: ClientFactory,
): void {
  describe('private verified deposit settlement', () => {
    it('pins the frozen catalog contract and the two least-privilege settlement roles', async () => {
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
         where rolname in (
           'fetanagent_verification_settlement',
           'fetanagent_verification_settlement_runtime'
         )
         order by rolname
      `);
      expect(roles.rows).toEqual([
        {
          rolbypassrls: false,
          rolcanlogin: false,
          rolconnlimit: 2,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolname: 'fetanagent_verification_settlement',
          rolreplication: false,
          rolsuper: false,
        },
        {
          rolbypassrls: false,
          rolcanlogin: false,
          rolconnlimit: 1,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolname: 'fetanagent_verification_settlement_runtime',
          rolreplication: false,
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
         where group_role.rolname = 'fetanagent_verification_settlement'
            or member_role.rolname = 'fetanagent_verification_settlement_runtime'
      `);
      expect(membership.rows).toEqual([
        {
          admin_option: false,
          group_role: 'fetanagent_verification_settlement',
          inherit_option: true,
          member_role: 'fetanagent_verification_settlement_runtime',
          set_option: false,
        },
      ]);

      const routine = await client.query<{
        readonly argument_names: readonly string[];
        readonly arguments: string;
        readonly description: string;
        readonly is_security_definer: boolean;
        readonly owner_name: string;
        readonly result_type: string;
        readonly runtime_config: readonly string[];
      }>(
        `
        select owner_role.rolname as owner_name,
               procedure.prosecdef as is_security_definer,
               procedure.proconfig as runtime_config,
               procedure.proargnames as argument_names,
               pg_get_function_identity_arguments(procedure.oid) as arguments,
               lower(pg_get_function_result(procedure.oid)) as result_type,
               obj_description(procedure.oid, 'pg_proc') as description
          from pg_proc procedure
          join pg_roles owner_role on owner_role.oid = procedure.proowner
         where procedure.oid = $1::regprocedure
      `,
        [settlementFunction],
      );
      expect(routine.rows).toEqual([
        {
          argument_names: [
            'p_deposit_intent_id',
            'p_verification_attempt_id',
            'p_provider_payment_evidence_id',
            'deposit_intent_id',
            'payment_claim_id',
            'execution_job_id',
            'deposit_status',
            'execution_job_status',
            'already_finalized',
            'updated_at',
          ],
          arguments:
            'p_deposit_intent_id uuid, p_verification_attempt_id uuid, p_provider_payment_evidence_id uuid',
          description:
            "The settlement runtime's only live-deposit settlement RPC. It preserves the legacy seven-column return contract, prelocks the complete pilot authority lineage, and returns only after one immutable reservation exists.",
          is_security_definer: true,
          owner_name: 'postgres',
          result_type:
            'table(deposit_intent_id uuid, payment_claim_id uuid, execution_job_id uuid, deposit_status text, execution_job_status text, already_finalized boolean, updated_at timestamp with time zone)',
          runtime_config: ['search_path=pg_catalog'],
        },
      ]);

      const catalogSurface = JSON.stringify(routine.rows);
      expect(catalogSurface).not.toMatch(
        /submitted_reference|canonical_reference|ciphertext|fingerprint|masked/iu,
      );

      const routineSource = await client.query<{ readonly source: string }>(
        `select lower(pg_get_functiondef($1::regprocedure)) as source`,
        [settlementFunction],
      );
      expect(routineSource.rows).toHaveLength(1);
      expect(routineSource.rows[0]!.source).not.toMatch(
        /submitted_reference_ciphertext|submitted_reference_masked|canonical_reference_ciphertext|canonical_reference_masked|authoritative_locator_ciphertext/iu,
      );
      expect(routineSource.rows[0]!.source).not.toMatch(/select\s+(?:submission|evidence)\.\*/iu);
      expect(routineSource.rows[0]!.source).not.toMatch(
        /app\.(?:deposit_submissions|provider_payment_evidence)%rowtype/iu,
      );

      const schemaAccess = await client.query<{
        readonly can_create: boolean;
        readonly can_use: boolean;
        readonly role_name: string;
      }>(`
        select role_name,
               has_schema_privilege(role_name, 'app', 'USAGE') as can_use,
               has_schema_privilege(role_name, 'app', 'CREATE') as can_create
          from unnest(array[
            'fetanagent_verification_settlement',
            'fetanagent_verification_settlement_runtime'
          ]) role_name
         order by role_name
      `);
      expect(schemaAccess.rows).toEqual([
        {
          can_create: false,
          can_use: true,
          role_name: 'fetanagent_verification_settlement',
        },
        {
          can_create: false,
          can_use: true,
          role_name: 'fetanagent_verification_settlement_runtime',
        },
      ]);

      const effectiveFunctions = await client.query<{ readonly signature: string }>(`
        select procedure.oid::regprocedure::text as signature
          from pg_proc procedure
          join pg_namespace namespace on namespace.oid = procedure.pronamespace
         where namespace.nspname = 'app'
           and has_function_privilege(
             'fetanagent_verification_settlement_runtime', procedure.oid, 'EXECUTE'
           )
         order by signature
      `);
      expect(effectiveFunctions.rows.map((row) => row.signature)).toEqual([settlementFunction]);

      const explicitGrant = await client.query<{
        readonly grantee: string;
        readonly is_grantable: boolean;
        readonly privilege_type: string;
      }>(
        `
        select coalesce(grantee.rolname, 'PUBLIC') as grantee,
               privilege.privilege_type,
               privilege.is_grantable
          from pg_proc procedure
          cross join lateral aclexplode(
            coalesce(procedure.proacl, acldefault('f', procedure.proowner))
          ) privilege
          left join pg_roles grantee on grantee.oid = privilege.grantee
         where procedure.oid = $1::regprocedure
           and privilege.grantee <> procedure.proowner
         order by grantee, privilege.privilege_type
      `,
        [settlementFunction],
      );
      expect(explicitGrant.rows).toEqual([
        {
          grantee: 'fetanagent_verification_settlement',
          is_grantable: false,
          privilege_type: 'EXECUTE',
        },
      ]);

      const forbiddenCallers = await client.query<{
        readonly allowed: boolean;
        readonly role_name: string;
      }>(
        `
        select role_name,
               has_function_privilege(role_name, $1::regprocedure, 'EXECUTE') as allowed
          from unnest(array[
            'anon', 'authenticated', 'service_role',
            'fetanagent_api', 'fetanagent_api_runtime', 'fetanagent_worker',
            'fetanagent_beta_admission', 'fetanagent_beta_admission_runtime',
            'fetanagent_nonce_retention', 'fetanagent_nonce_retention_runtime',
            'fetanagent_owner_control', 'fetanagent_owner_control_runtime',
            'fetanagent_player_actions', 'fetanagent_player_actions_runtime',
            'fetanagent_cbe_birr_shadow_worker',
            'fetanagent_customer_web', 'fetanagent_customer_web_runtime',
            'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
          ]) role_name
         order by role_name
      `,
        [settlementFunction],
      );
      expect(forbiddenCallers.rows.every((row) => !row.allowed)).toBe(true);
      expect(forbiddenCallers.rows).toHaveLength(19);

      const publicExecute = await client.query<{ readonly allowed: boolean }>(
        `
        select exists (
          select 1
            from pg_proc procedure
            cross join lateral aclexplode(
              coalesce(procedure.proacl, acldefault('f', procedure.proowner))
            ) privilege
           where procedure.oid = $1::regprocedure
             and privilege.grantee = 0
             and privilege.privilege_type = 'EXECUTE'
        ) as allowed
      `,
        [settlementFunction],
      );
      expect(publicExecute.rows).toEqual([{ allowed: false }]);

      const legacyExecute = await client.query<{
        readonly allowed: boolean;
        readonly role_name: string;
      }>(
        `select role_name,
                has_function_privilege(role_name, $1::regprocedure, 'EXECUTE') as allowed
           from unnest(array[
             'fetanagent_verification_settlement',
             'fetanagent_verification_settlement_runtime'
           ]) role_name
          order by role_name`,
        [legacySettlementFunction],
      );
      expect(legacyExecute.rows).toEqual([
        { allowed: false, role_name: 'fetanagent_verification_settlement' },
        { allowed: false, role_name: 'fetanagent_verification_settlement_runtime' },
      ]);

      const relationAccess = await client.query<{
        readonly allowed_sequences: number;
        readonly allowed_tables: number;
        readonly role_name: string;
      }>(`
        select role_name,
               count(*) filter (
                 where relation.relkind in ('r', 'p', 'v', 'm', 'f')
                   and has_table_privilege(
                     role_name,
                     relation.oid,
                     'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
                   )
               )::integer as allowed_tables,
               count(*) filter (
                 where relation.relkind = 'S'
                   and has_sequence_privilege(role_name, relation.oid, 'USAGE,SELECT,UPDATE')
               )::integer as allowed_sequences
          from unnest(array[
            'fetanagent_verification_settlement',
            'fetanagent_verification_settlement_runtime'
          ]) role_name
          cross join pg_class relation
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'app'
         group by role_name
         order by role_name
      `);
      expect(relationAccess.rows).toEqual([
        {
          allowed_sequences: 0,
          allowed_tables: 0,
          role_name: 'fetanagent_verification_settlement',
        },
        {
          allowed_sequences: 0,
          allowed_tables: 0,
          role_name: 'fetanagent_verification_settlement_runtime',
        },
      ]);
    });

    it('atomically creates one claim and one execution command, then replays exact IDs', async () => {
      const client = getClient();
      const fixture = await createSettlementFixture(client, 'happy-replay');

      const first = await callSettlement(client, settlementInput(fixture));
      expect(first).toEqual([
        {
          already_finalized: false,
          deposit_intent_id: fixture.depositIntentId,
          deposit_status: 'execution_pending',
          execution_job_id: expect.any(String),
          execution_job_status: 'queued',
          payment_claim_id: expect.any(String),
          updated_at: expect.any(Date),
        },
      ]);
      expectNoSensitiveReferenceMaterial(JSON.stringify(first), [fixture]);

      const ledger = await client.query<{
        readonly deposit_status: string;
        readonly execution_job_id: string;
        readonly execution_job_status: string;
        readonly job_key: string;
        readonly max_attempts: number;
        readonly payment_claim_id: string;
        readonly submission_status: string;
      }>(
        `select intent.status::text as deposit_status,
                submission.status::text as submission_status,
                claim.id as payment_claim_id,
                job.id as execution_job_id,
                job.status::text as execution_job_status,
                job.job_key,
                job.max_attempts
           from app.deposit_intents intent
           join app.deposit_submissions submission
             on submission.id = $2::uuid
            and submission.deposit_intent_id = intent.id
           join app.deposit_payment_claims claim
             on claim.deposit_intent_id = intent.id
            and claim.verification_attempt_id = $3::uuid
            and claim.provider_payment_evidence_id = $4::uuid
           join app.deposit_jobs job
             on job.deposit_intent_id = intent.id
            and job.job_kind = 'execute_deposit'
          where intent.id = $1::uuid`,
        [
          fixture.depositIntentId,
          fixture.submissionId,
          fixture.verificationAttemptId,
          fixture.evidenceId,
        ],
      );
      expect(ledger.rows).toEqual([
        {
          deposit_status: 'execution_pending',
          execution_job_id: first[0]!.execution_job_id,
          execution_job_status: 'queued',
          job_key: `deposit-execution:v1:${fixture.depositIntentId}`,
          max_attempts: 1,
          payment_claim_id: first[0]!.payment_claim_id,
          submission_status: 'verified',
        },
      ]);

      const replay = await callSettlement(client, settlementInput(fixture));
      expect(replay).toEqual([
        {
          ...first[0]!,
          already_finalized: true,
        },
      ]);
      expect(await readSettlementSnapshot(client, fixture)).toEqual({
        deposit_status: 'execution_pending',
        execution_jobs: 1,
        payment_claims: 1,
        submission_status: 'verified',
      });

      const auditProjection = await client.query<{
        readonly audit_events: string;
        readonly state_event_count: number;
        readonly state_events: string;
      }>(
        `select coalesce((
                  select jsonb_agg(to_jsonb(audit_event) order by audit_event.id)::text
                    from app.audit_events audit_event
                ), '[]') as audit_events,
                coalesce((
                  select jsonb_agg(to_jsonb(state_event) order by state_event.id)::text
                    from app.deposit_state_events state_event
                   where state_event.deposit_intent_id = $1::uuid
                ), '[]') as state_events,
                (select count(*)::integer
                   from app.deposit_state_events state_event
                  where state_event.deposit_intent_id = $1::uuid) as state_event_count`,
        [fixture.depositIntentId],
      );
      expect(auditProjection.rows).toHaveLength(1);
      expect(auditProjection.rows[0]!.state_event_count).toBeGreaterThanOrEqual(4);
      expect(auditProjection.rows[0]!.state_events).toContain('execution_pending');
      expectNoSensitiveReferenceMaterial(JSON.stringify(auditProjection.rows[0]), [fixture]);
    });

    it('rejects a different proof triple after success and preserves the original pair', async () => {
      const client = getClient();
      const target = await createSettlementFixture(client, 'post-success-target');
      const original = await callSettlement(client, settlementInput(target));
      const differentProof = await createSettlementFixture(client, 'post-success-wrong-proof');

      const message = await captureSettlementFailure(client, {
        depositIntentId: target.depositIntentId,
        evidenceId: differentProof.evidenceId,
        verificationAttemptId: differentProof.verificationAttemptId,
      });
      expect(message).toMatch(/verified deposit settlement proof is invalid/i);
      expectNoSensitiveReferenceMaterial(message, [target, differentProof]);

      const preserved = await client.query<{
        readonly execution_job_id: string;
        readonly payment_claim_id: string;
      }>(
        `select claim.id as payment_claim_id,
                job.id as execution_job_id
           from app.deposit_payment_claims claim
           join app.deposit_jobs job
             on job.deposit_intent_id = claim.deposit_intent_id
            and job.job_kind = 'execute_deposit'
          where claim.deposit_intent_id = $1::uuid`,
        [target.depositIntentId],
      );
      expect(preserved.rows).toEqual([
        {
          execution_job_id: original[0]!.execution_job_id,
          payment_claim_id: original[0]!.payment_claim_id,
        },
      ]);
      expect(await readSettlementSnapshot(client, target)).toEqual({
        deposit_status: 'execution_pending',
        execution_jobs: 1,
        payment_claims: 1,
        submission_status: 'verified',
      });
      await expectPendingWithoutSettlement(client, differentProof);
    });

    it('rejects a verification proof bound to the wrong intent without any settlement writes', async () => {
      const client = getClient();
      const proof = await createSettlementFixture(client, 'wrong-intent-proof');
      const target = await createSettlementFixture(client, 'wrong-intent-target');
      await expectProofFailure(
        client,
        target,
        {
          depositIntentId: target.depositIntentId,
          evidenceId: proof.evidenceId,
          verificationAttemptId: proof.verificationAttemptId,
        },
        [target, proof],
      );
      await expectPendingWithoutSettlement(client, proof);
    });

    it('rejects a wrong verification attempt without any settlement writes', async () => {
      const client = getClient();
      const target = await createSettlementFixture(client, 'wrong-attempt-target');
      const wrong = await createSettlementFixture(client, 'wrong-attempt-proof');
      await expectProofFailure(
        client,
        target,
        {
          depositIntentId: target.depositIntentId,
          evidenceId: target.evidenceId,
          verificationAttemptId: wrong.verificationAttemptId,
        },
        [target, wrong],
      );
      await expectPendingWithoutSettlement(client, wrong);
    });

    it('rejects wrong provider evidence without any settlement writes', async () => {
      const client = getClient();
      const target = await createSettlementFixture(client, 'wrong-evidence-target');
      const wrong = await createSettlementFixture(client, 'wrong-evidence-proof');
      await expectProofFailure(
        client,
        target,
        {
          depositIntentId: target.depositIntentId,
          evidenceId: wrong.evidenceId,
          verificationAttemptId: target.verificationAttemptId,
        },
        [target, wrong],
      );
      await expectPendingWithoutSettlement(client, wrong);
    });

    it('rejects a reference mismatch and keeps raw references out of the error', async () => {
      const client = getClient();
      const fixture = await createSettlementFixture(client, 'reference-mismatch', {
        evidenceReferenceMatches: false,
      });
      await expectProofFailure(client, fixture, settlementInput(fixture));
    });

    it('rejects an amount mismatch without any settlement writes', async () => {
      const client = getClient();
      const fixture = await createSettlementFixture(client, 'amount-mismatch', {
        evidenceAmountMinor: 2600,
      });
      await expectProofFailure(client, fixture, settlementInput(fixture));
    });

    it('rejects a receiver mismatch without any settlement writes', async () => {
      const client = getClient();
      const fixture = await createSettlementFixture(client, 'receiver-mismatch', {
        evidenceReceiverMatches: false,
      });
      await expectProofFailure(client, fixture, settlementInput(fixture));
    });

    it('rejects evidence outside the immutable freshness window without settlement writes', async () => {
      const client = getClient();
      const fixture = await createSettlementFixture(client, 'freshness-mismatch', {
        evidenceTiming: 'before-intent',
      });
      await expectProofFailure(client, fixture, settlementInput(fixture));
    });

    it('rolls claim creation back when current Player-ID eligibility is revoked', async () => {
      const client = getClient();
      const fixture = await createSettlementFixture(client, 'revoked-eligibility');
      await expectFailureAfterMutation(
        client,
        fixture,
        async (connection) => {
          await connection.query(
            `insert into app.player_deposit_eligibility_decisions (
               player_account_id, decision_version, decision, reason_code, actor_kind
             ) values (
               $1::uuid, 2, 'revoked', 'financial_eligibility_revoked', 'system'
             )`,
            [fixture.playerAccountId],
          );
        },
        /current Player-ID deposit-eligibility decision/i,
      );
    });

    it('rolls claim creation back when the snapshotted amount policy is inactive', async () => {
      const client = getClient();
      const fixture = await createSettlementFixture(client, 'inactive-policy');
      await expectFailureAfterMutation(
        client,
        fixture,
        async (connection) => {
          const retired = await connection.query<{ readonly id: string }>(`
            update app.deposit_policy_versions policy
               set status = 'inactive',
                   retired_at = clock_timestamp()
             where policy.status = 'active'
             returning id
          `);
          expect(retired.rows).toHaveLength(1);
        },
        /current deposit amount policy is unavailable/i,
      );
    });

    it('keeps both ledgers empty when either live financial switch is off', async () => {
      const client = getClient();
      const fixture = await createSettlementFixture(client, 'switch-disabled');
      await expectFailureAfterMutation(
        client,
        fixture,
        async (connection) => {
          await connection.query(`
            update app.feature_switches
               set mode = 'disabled'
             where feature_key = 'deposit_execution'
          `);
        },
        /requires both live financial switches/i,
      );
    });

    it('fails closed on a claim-only partial state instead of repairing the execution job', async () => {
      const client = getClient();
      const fixture = await createSettlementFixture(client, 'claim-only-partial');
      const claim = await client.query<{ readonly id: string }>(
        `select app.claim_verified_deposit_payment($1::uuid, $2::uuid, $3::uuid) as id`,
        [fixture.depositIntentId, fixture.verificationAttemptId, fixture.evidenceId],
      );
      expect(claim.rows[0]!.id).toEqual(expect.any(String));

      const message = await captureSettlementFailure(client, settlementInput(fixture));
      expect(message).toMatch(/verified deposit settlement state is inconsistent/i);
      expectNoSensitiveReferenceMaterial(message, [fixture]);
      expect(await readSettlementSnapshot(client, fixture)).toEqual({
        deposit_status: 'verified',
        execution_jobs: 0,
        payment_claims: 1,
        submission_status: 'verified',
      });
    });

    it('fails closed on a job-only partial state instead of creating a payment claim', async () => {
      const client = getClient();
      const fixture = await createSettlementFixture(client, 'job-only-partial');

      await client.query('begin');
      try {
        await client.query(`set local session_replication_role = replica`);
        const job = await client.query<{ readonly id: string }>(
          `insert into app.deposit_jobs (
             deposit_intent_id, deposit_submission_id, job_kind, job_key, max_attempts
           ) values ($1::uuid, null, 'execute_deposit', $2::text, 1)
           returning id`,
          [fixture.depositIntentId, `deposit-execution:v1:${fixture.depositIntentId}`],
        );
        expect(job.rows[0]!.id).toEqual(expect.any(String));
        await client.query(`set local session_replication_role = origin`);

        const message = await captureSettlementFailureAtSavepoint(client, settlementInput(fixture));
        expect(message).toMatch(/verified deposit settlement state is inconsistent/i);
        expectNoSensitiveReferenceMaterial(message, [fixture]);
        expect(await readSettlementSnapshot(client, fixture)).toEqual({
          deposit_status: 'verification_pending',
          execution_jobs: 1,
          payment_claims: 0,
          submission_status: 'verification_enqueued',
        });
      } finally {
        await client.query('rollback');
      }
      await expectPendingWithoutSettlement(client, fixture);
    });

    it('rejects malformed complete history without repairing the existing pair', async () => {
      const client = getClient();
      const fixture = await createSettlementFixture(client, 'malformed-complete-state');
      const finalized = await callSettlement(client, settlementInput(fixture));
      expect(finalized).toHaveLength(1);

      const malformedJobKey = `malformed-settlement:${fixture.depositIntentId}`;
      await client.query('begin');
      try {
        await client.query(`set local session_replication_role = replica`);
        await client.query(
          `update app.deposit_jobs
              set job_key = $2::text
            where id = $1::uuid`,
          [finalized[0]!.execution_job_id, malformedJobKey],
        );
        await client.query(`set local session_replication_role = origin`);

        const message = await captureSettlementFailureAtSavepoint(client, settlementInput(fixture));
        expect(message).toMatch(/verified deposit settlement state is inconsistent/i);
        expectNoSensitiveReferenceMaterial(message, [fixture]);
        const unchanged = await client.query<{ readonly job_key: string }>(
          `select job_key from app.deposit_jobs where id = $1::uuid`,
          [finalized[0]!.execution_job_id],
        );
        expect(unchanged.rows).toEqual([{ job_key: malformedJobKey }]);
        expect(await readSettlementSnapshot(client, fixture)).toEqual({
          deposit_status: 'execution_pending',
          execution_jobs: 1,
          payment_claims: 1,
          submission_status: 'verified',
        });
      } finally {
        await client.query('rollback');
      }

      const replay = await callSettlement(client, settlementInput(fixture));
      expect(replay).toEqual([{ ...finalized[0]!, already_finalized: true }]);
    });

    it('serializes exact duplicate clients into one creation and one exact replay', async () => {
      const client = getClient();
      const fixture = await createSettlementFixture(client, 'duplicate-race');

      const rows = await withConnectedClients(createClient, async (left, right) => {
        const [leftRows, rightRows] = await Promise.all([
          callSettlement(left, settlementInput(fixture)),
          callSettlement(right, settlementInput(fixture)),
        ]);
        return [leftRows[0]!, rightRows[0]!] as const;
      });

      expect(rows.filter((row) => !row.already_finalized)).toHaveLength(1);
      expect(rows.filter((row) => row.already_finalized)).toHaveLength(1);
      expect(new Set(rows.map((row) => row.payment_claim_id)).size).toBe(1);
      expect(new Set(rows.map((row) => row.execution_job_id)).size).toBe(1);
      expect(rows.every((row) => row.deposit_intent_id === fixture.depositIntentId)).toBe(true);
      expect(rows.every((row) => row.deposit_status === 'execution_pending')).toBe(true);
      expect(rows.every((row) => row.execution_job_status === 'queued')).toBe(true);
      expect(await readSettlementSnapshot(client, fixture)).toEqual({
        deposit_status: 'execution_pending',
        execution_jobs: 1,
        payment_claims: 1,
        submission_status: 'verified',
      });
    });

    it('lets a valid settlement win a hostile proof race without duplicate writes', async () => {
      const client = getClient();
      const target = await createSettlementFixture(client, 'hostile-race-target');
      const hostile = await createSettlementFixture(client, 'hostile-race-proof');

      const outcomes = await withConnectedClients(
        createClient,
        async (validClient, hostileClient) =>
          Promise.allSettled([
            callSettlement(validClient, settlementInput(target)),
            callSettlement(hostileClient, {
              depositIntentId: target.depositIntentId,
              evidenceId: hostile.evidenceId,
              verificationAttemptId: target.verificationAttemptId,
            }),
          ]),
      );

      expect(outcomes[0]!.status).toBe('fulfilled');
      expect(outcomes[1]!.status).toBe('rejected');
      if (outcomes[0]!.status === 'fulfilled') {
        expect(outcomes[0]!.value).toEqual([
          {
            already_finalized: false,
            deposit_intent_id: target.depositIntentId,
            deposit_status: 'execution_pending',
            execution_job_id: expect.any(String),
            execution_job_status: 'queued',
            payment_claim_id: expect.any(String),
            updated_at: expect.any(Date),
          },
        ]);
      }
      if (outcomes[1]!.status === 'rejected') {
        const message = errorMessage(outcomes[1]!.reason);
        expect(message).toMatch(/verified deposit settlement proof is invalid/i);
        expectNoSensitiveReferenceMaterial(message, [target, hostile]);
      }

      expect(await readSettlementSnapshot(client, target)).toEqual({
        deposit_status: 'execution_pending',
        execution_jobs: 1,
        payment_claims: 1,
        submission_status: 'verified',
      });
      await expectPendingWithoutSettlement(client, hostile);
    });

    for (const kind of ['fence', 'cancel', 'handoff'] as const) {
      for (const order of ['settlement-first', 'transition-first'] as const) {
        it(`serializes exact settlement replay against ${kind} with ${order} advisory blocking`, async () => {
          await runSettlementTransitionLockOrderRace(getClient(), createClient, kind, order);
        });
      }
    }
  });
}
