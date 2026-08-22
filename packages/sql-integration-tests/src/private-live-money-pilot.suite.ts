import { createHash, randomUUID } from 'node:crypto';

import type { Client, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

type SqlValue = boolean | Date | number | string | readonly string[] | null;

export type PilotPrerequisites = {
  readonly ownerCustomerId: string;
  readonly paymentProviderId: string;
  readonly platformId: string;
  readonly playerAccountIds: readonly string[];
  readonly playerIds: readonly string[];
  readonly receiverAccountId: string;
  readonly receiverAccountVersion: number;
  readonly submittingCustomerId: string;
};

export type PreparedPilot = PilotPrerequisites & {
  readonly activeFrom: Date;
  readonly configurationDigest: string;
  readonly expiresAt: Date;
  readonly pilotRevisionId: string;
  readonly requestKey: string;
};

type SettlementLineage = {
  readonly depositIntentId: string;
  readonly evidenceId: string;
  readonly fingerprint: string;
  readonly proofId: string;
  readonly verificationAttemptId: string;
};

export type PilotPreparationOptions = {
  readonly maximumAggregateMinor: number;
  readonly maximumPerDepositMinor: number;
  readonly maximumPerPlayerMinor: number;
  readonly maximumReservationCount: number;
  readonly submittingCustomerIds: readonly string[];
};

type SettlementLineageOptions = {
  readonly amountMinor?: number;
  readonly fingerprint?: string;
  readonly playerIndex?: number;
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

type LeaseRow = {
  readonly amount_minor: string;
  readonly currency_code: string;
  readonly deposit_intent_id: string;
  readonly execution_attempt_id: string;
  readonly execution_job_id: string;
  readonly lease_disposition: string;
  readonly lease_expires_at: Date;
  readonly lease_token: string;
  readonly pilot_authorization_token: string | null;
  readonly pilot_configuration_digest: string | null;
  readonly pilot_contract_version: number | null;
  readonly pilot_reservation_id: string | null;
  readonly pilot_revision_id: string | null;
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

const pilotSwitchKeys = [
  'cbe_birr_authoritative_verification',
  'deposit_execution',
  'payment_verification',
  'private_live_deposit_pilot',
  'telebirr_authoritative_verification',
] as const;

const pilotTableNames = [
  'private_live_deposit_pilot_customers',
  'private_live_deposit_pilot_players',
  'private_live_deposit_pilot_proofs',
  'private_live_deposit_pilot_providers',
  'private_live_deposit_pilot_reservations',
  'private_live_deposit_pilot_revisions',
] as const;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withRollback(client: Client, body: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await body();
  } finally {
    await client.query('rollback');
  }
}

async function queryAsRole<T extends QueryResultRow>(
  client: Client,
  role:
    | 'fetanagent_deposit_executor'
    | 'fetanagent_owner_control'
    | 'fetanagent_verification_settlement',
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  await client.query(`set local role ${role}`);
  try {
    const result = await client.query<T>(query, [...values]);
    return result.rows;
  } finally {
    await client.query('reset role');
  }
}

async function queryAsMigrationOwner<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  const result = await client.query<T>(query, [...values]);
  return result.rows;
}

async function expectFailureAtSavepoint(
  client: Client,
  query: string,
  values: readonly SqlValue[],
  expected: RegExp | string,
  role?:
    | 'fetanagent_deposit_executor'
    | 'fetanagent_owner_control'
    | 'fetanagent_verification_settlement',
): Promise<void> {
  const savepoint = `expected_private_pilot_failure_${sha256(randomUUID()).slice(0, 12)}`;
  await client.query(`savepoint ${savepoint}`);
  let failure: unknown;
  try {
    if (role) await client.query(`set local role ${role}`);
    await client.query(query, [...values]);
  } catch (error) {
    failure = error;
  }

  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  await client.query('reset role');

  expect(failure).toBeInstanceOf(Error);
  if (expected instanceof RegExp) {
    expect(errorMessage(failure)).toMatch(expected);
  } else {
    expect(errorMessage(failure)).toContain(expected);
  }
}

async function neutralizeBlockingExecutionRows(client: Client): Promise<void> {
  await client.query(`set local session_replication_role = 'replica'`);
  try {
    await client.query(`
      update app.deposit_execution_attempts
         set status = 'confirmed_executed',
             final_action_fenced_at = coalesce(final_action_fenced_at, clock_timestamp()),
             reconciliation_required_at = coalesce(
               reconciliation_required_at,
               final_action_fenced_at,
               clock_timestamp()
             ),
             resolved_at = coalesce(resolved_at, clock_timestamp())
       where status in (
         'prepared',
         'final_action_fenced',
         'reconciliation_required',
         'review_required'
       )
    `);
    await client.query(`
      update app.deposit_jobs
         set status = 'cancelled',
             lease_token = null,
             leased_by = null,
             lease_expires_at = null,
             last_error_code = 'private_pilot_fixture_isolation',
             completed_at = clock_timestamp()
       where job_kind in ('execute_deposit', 'reconcile_execution')
         and status in ('queued', 'leased', 'retry_wait')
    `);
  } finally {
    await client.query(`set local session_replication_role = 'origin'`);
  }
}

export async function createPilotPrerequisites(client: Client): Promise<PilotPrerequisites> {
  await neutralizeBlockingExecutionRows(client);
  await client.query(
    `update app.feature_switches
        set mode = 'disabled', settings = '{}'::jsonb, updated_by_admin_id = null
      where feature_key = any($1::text[])`,
    [[...pilotSwitchKeys]],
  );

  const customers = await client.query<{
    readonly owner_customer_id: string;
    readonly submitting_customer_id: string;
  }>(`
    with owner_customer as (
      insert into app.customers (status) values ('active') returning id
    ), submitting_customer as (
      insert into app.customers (status) values ('active') returning id
    )
    select owner_customer.id as owner_customer_id,
           submitting_customer.id as submitting_customer_id
      from owner_customer cross join submitting_customer
  `);
  expect(customers.rows).toHaveLength(1);
  const ownerCustomerId = customers.rows[0]!.owner_customer_id;
  const submittingCustomerId = customers.rows[0]!.submitting_customer_id;

  const platform = await client.query<{ readonly id: string }>(`
    select id from app.platforms where code = 'kemerbet' and status = 'active'
  `);
  expect(platform.rows).toHaveLength(1);
  const platformId = platform.rows[0]!.id;

  const activeAgent = await client.query<{ readonly id: string }>(
    `select id
       from app.platform_agent_accounts
      where platform_id = $1::uuid and status = 'active'`,
    [platformId],
  );
  if (activeAgent.rows.length === 0) {
    await client.query(
      `insert into app.platform_agent_accounts (platform_id, label, credential_ref)
       values ($1::uuid, $2::text, $3::text)`,
      [
        platformId,
        `private-pilot-agent-${randomUUID().slice(0, 8)}`,
        `secret://private-pilot/${randomUUID()}`,
      ],
    );
  }

  const boundary = await client.query<{
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

  if (boundary.rows.length === 0) {
    await client.query(`
      insert into app.receiver_accounts (
        provider_id,
        version,
        account_holder_name,
        account_reference_ciphertext,
        verification_reference_ciphertext,
        account_reference_masked,
        instructions
      )
      select provider.id,
             coalesce((select max(version) + 1 from app.receiver_accounts), 1),
             'Synthetic Private Pilot Receiver',
             'synthetic-private-pilot-account-ciphertext',
             'synthetic-private-pilot-verification-ciphertext',
             '****9001',
             jsonb_build_object('customer_message', 'Synthetic SQL fixture only')
        from app.payment_providers provider
       where provider.code = 'cbe_birr'
    `);
  }

  const resolvedBoundary = await client.query<{
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
  expect(resolvedBoundary.rows).toHaveLength(1);

  const playerAccountIds: string[] = [];
  const playerIds: string[] = [];
  const fixtureSeed = randomUUID().replaceAll('-', '').toUpperCase();
  for (let index = 1; index <= 5; index += 1) {
    const playerId = `PILOT-${fixtureSeed.slice(0, 20)}-${index}`;
    const player = await client.query<{ readonly id: string }>(
      `insert into app.customer_platform_players (
         customer_id, platform_id, player_id
       ) values ($1::uuid, $2::uuid, $3::text)
       returning id`,
      [ownerCustomerId, platformId, playerId],
    );
    const playerAccountId = player.rows[0]!.id;
    await client.query(
      `insert into app.player_validation_attempts (
         player_account_id, attempt_number, outcome, reason_code, adapter_version,
         started_at, completed_at, result_digest
       ) values (
         $1::uuid, 1, 'valid', 'private_pilot_sql_fixture', 'fixture_v1',
         clock_timestamp() - interval '1 second', clock_timestamp(), $2::text
       )`,
      [playerAccountId, `private-pilot-validation-${fixtureSeed}-${index}`],
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
       ) values (
         $1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'system'
       )`,
      [playerAccountId],
    );
    playerAccountIds.push(playerAccountId);
    playerIds.push(playerId);
  }

  return {
    ownerCustomerId,
    paymentProviderId: resolvedBoundary.rows[0]!.payment_provider_id,
    platformId,
    playerAccountIds,
    playerIds,
    receiverAccountId: resolvedBoundary.rows[0]!.receiver_account_id,
    receiverAccountVersion: resolvedBoundary.rows[0]!.receiver_account_version,
    submittingCustomerId,
  };
}

export async function preparePilot(
  client: Client,
  ownerAdminId: string,
  prerequisites: PilotPrerequisites,
  options: Partial<PilotPreparationOptions> = {},
): Promise<PreparedPilot> {
  const maximumReservationCount = options.maximumReservationCount ?? 5;
  const maximumPerDepositMinor = options.maximumPerDepositMinor ?? 2_500_000;
  const maximumPerPlayerMinor = options.maximumPerPlayerMinor ?? 2_500_000;
  const maximumAggregateMinor = options.maximumAggregateMinor ?? 12_500_000;
  const submittingCustomerIds = options.submittingCustomerIds ?? [
    prerequisites.ownerCustomerId,
    prerequisites.submittingCustomerId,
  ];
  const requestKey = randomUUID();
  const activeFrom = new Date(Date.now() - 30_000);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1_000);
  const rows = await queryAsMigrationOwner<{ readonly pilot_revision_id: string }>(
    client,
    `select app.prepare_private_live_deposit_pilot(
       $1::uuid,
       $2::uuid,
       array['cbe_birr']::text[],
       $3::text[],
       $4::uuid[],
       2500::bigint,
       $5::bigint,
       $6::bigint,
       $7::bigint,
       $8::smallint,
       $9::timestamptz,
       $10::timestamptz
     ) as pilot_revision_id`,
    [
      ownerAdminId,
      requestKey,
      prerequisites.playerIds,
      submittingCustomerIds,
      maximumPerDepositMinor,
      maximumPerPlayerMinor,
      maximumAggregateMinor,
      maximumReservationCount,
      activeFrom,
      expiresAt,
    ],
  );
  expect(rows).toHaveLength(1);

  const manifest = await client.query<{ readonly configuration_digest: string }>(
    `select configuration_digest
       from app.private_live_deposit_pilot_revisions
      where id = $1::uuid`,
    [rows[0]!.pilot_revision_id],
  );
  expect(manifest.rows).toHaveLength(1);

  return {
    ...prerequisites,
    activeFrom,
    configurationDigest: manifest.rows[0]!.configuration_digest,
    expiresAt,
    pilotRevisionId: rows[0]!.pilot_revision_id,
    requestKey,
  };
}

export async function armPilot(
  client: Client,
  ownerAdminId: string,
  pilot: PreparedPilot,
): Promise<void> {
  await queryAsMigrationOwner(
    client,
    `select app.arm_private_live_deposit_pilot($1::uuid, $2::uuid)`,
    [ownerAdminId, pilot.pilotRevisionId],
  );
}

export async function activateSyntheticPilot(client: Client): Promise<void> {
  const activated = await client.query<{ readonly feature_key: string }>(`
    update app.feature_switches
       set mode = 'live'
     where feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'private_live_deposit_pilot'
     )
    returning feature_key
  `);
  expect(activated.rows.map((row) => row.feature_key).sort()).toEqual([
    'cbe_birr_authoritative_verification',
    'deposit_execution',
    'payment_verification',
    'private_live_deposit_pilot',
  ]);
}

async function createSettlementLineage(
  client: Client,
  pilot: PreparedPilot,
  options: SettlementLineageOptions = {},
): Promise<SettlementLineage> {
  const amountMinor = options.amountMinor ?? 2500;
  const playerIndex = options.playerIndex ?? 0;
  const playerAccountId = pilot.playerAccountIds[playerIndex];
  if (!playerAccountId) throw new Error('The private pilot SQL fixture Player index is invalid.');
  const fingerprint = options.fingerprint ?? sha256(`private-pilot-proof:${randomUUID()}`);
  const intent = await client.query<{ readonly id: string; readonly opened_at: Date }>(
    `insert into app.deposit_intents (
       customer_id, platform_id, player_account_id, payment_provider_id,
       receiver_account_id, expected_amount_minor
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::bigint)
     returning id, opened_at`,
    [
      pilot.ownerCustomerId,
      pilot.platformId,
      playerAccountId,
      pilot.paymentProviderId,
      pilot.receiverAccountId,
      amountMinor,
    ],
  );
  const depositIntentId = intent.rows[0]!.id;

  const proof = await client.query<{ readonly id: string }>(
    `insert into app.private_live_deposit_pilot_proofs (
       pilot_revision_id,
       submitting_customer_id,
       player_account_id,
       payment_provider_id,
       provider_code_snapshot,
       origin_channel,
       input_kind,
       candidate_reference_ciphertext,
       candidate_reference_fingerprint,
       candidate_reference_masked,
       reference_encryption_key_version,
       reference_profile_version
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'cbe_birr', 'telegram', 'pasted_sms',
       $5::text, $6::text, $7::text, 2, 2
     ) returning id`,
    [
      pilot.pilotRevisionId,
      pilot.submittingCustomerId,
      playerAccountId,
      pilot.paymentProviderId,
      `v2.cbe_birr.${fingerprint.slice(0, 16)}.${fingerprint.slice(16, 38)}.${fingerprint.slice(38, 60)}`,
      fingerprint,
      `***${fingerprint.slice(0, 4).toUpperCase()}`,
    ],
  );

  const submission = await client.query<{ readonly id: string }>(
    `insert into app.deposit_submissions (
       deposit_intent_id,
       submission_number,
       submitted_reference_ciphertext,
       submitted_reference_fingerprint,
       submitted_reference_masked,
       reference_encryption_key_version
     ) values ($1::uuid, 1, $2::text, $3::text, $4::text, 1)
     returning id`,
    [depositIntentId, `synthetic-submission-${randomUUID()}`, fingerprint, '***PILOT'],
  );

  await client.query(
    `update app.deposit_intents set status = 'verification_pending' where id = $1::uuid`,
    [depositIntentId],
  );
  await client.query(
    `update app.deposit_submissions set status = 'verification_enqueued' where id = $1::uuid`,
    [submission.rows[0]!.id],
  );

  const occurredAt = new Date(intent.rows[0]!.opened_at.getTime() + 1);
  const evidence = await client.query<{ readonly id: string }>(
    `insert into app.provider_payment_evidence (
       payment_provider_id,
       canonical_reference_ciphertext,
       canonical_reference_fingerprint,
       canonical_reference_masked,
       reference_encryption_key_version,
       evidence_source,
       amount_minor,
       currency_code,
       occurred_at,
       matched_receiver_account_id,
       matched_receiver_account_version,
       evidence_digest,
       adapter_version,
       normalization_version,
       retrieved_at
     ) values (
       $1::uuid, $2::text, $3::text, '***PILOT', 1, 'provider_receipt_lookup',
       $9::bigint, 'ETB', $4::timestamptz, $5::uuid, $6::integer,
       $7::text, 'fixture_v1', 'fixture_v1', $8::timestamptz
     ) returning id`,
    [
      pilot.paymentProviderId,
      `synthetic-provider-evidence-${randomUUID()}`,
      fingerprint,
      occurredAt,
      pilot.receiverAccountId,
      pilot.receiverAccountVersion,
      `private-pilot-evidence-${fingerprint}`,
      new Date(occurredAt.getTime() + 1),
      amountMinor,
    ],
  );

  const verification = await client.query<{ readonly id: string }>(
    `insert into app.deposit_verification_attempts (
       deposit_intent_id,
       deposit_submission_id,
       attempt_number,
       outcome,
       reason_code,
       provider_payment_evidence_id,
       adapter_version,
       response_digest,
       started_at,
       completed_at
     ) values (
       $1::uuid, $2::uuid, 1, 'verified', 'provider_payment_verified', $3::uuid,
       'fixture_v1', $4::text, clock_timestamp() - interval '1 second', clock_timestamp()
     ) returning id`,
    [
      depositIntentId,
      submission.rows[0]!.id,
      evidence.rows[0]!.id,
      `private-pilot-verification-${fingerprint}`,
    ],
  );

  return {
    depositIntentId,
    evidenceId: evidence.rows[0]!.id,
    fingerprint,
    proofId: proof.rows[0]!.id,
    verificationAttemptId: verification.rows[0]!.id,
  };
}

async function settlePrivatePilot(
  client: Client,
  lineage: SettlementLineage,
): Promise<readonly SettlementRow[]> {
  return queryAsRole<SettlementRow>(
    client,
    'fetanagent_verification_settlement',
    `select *
       from app.finalize_private_live_verified_deposit_and_enqueue_execution(
         $1::uuid, $2::uuid, $3::uuid
       )`,
    [lineage.depositIntentId, lineage.verificationAttemptId, lineage.evidenceId],
  );
}

async function expectPilotReservationCount(
  client: Client,
  pilotRevisionId: string,
  expectedCount: number,
): Promise<void> {
  const count = await client.query<{ readonly count: number }>(
    `select count(*)::integer as count
       from app.private_live_deposit_pilot_reservations
      where pilot_revision_id = $1::uuid`,
    [pilotRevisionId],
  );
  expect(count.rows).toEqual([{ count: expectedCount }]);
}

export function registerPrivateLiveMoneyPilotSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('private five-account live-money pilot boundary', () => {
    it('prepares exactly five immutable Player snapshots and replays only the identical request', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const prerequisites = await createPilotPrerequisites(client);
        const ownerAdminId = getOwnerAdminId();
        const pilot = await preparePilot(client, ownerAdminId, prerequisites);

        expect(pilot.configurationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
        const snapshot = await client.query<{
          readonly configuration_digest: string;
          readonly customer_count: number;
          readonly maximum_reservation_count: number;
          readonly player_count: number;
          readonly provider_count: number;
          readonly status: string;
        }>(
          `select revision.status,
                  revision.configuration_digest,
                  revision.maximum_reservation_count,
                  (select count(*)::integer
                     from app.private_live_deposit_pilot_players player
                    where player.pilot_revision_id = revision.id) as player_count,
                  (select count(*)::integer
                     from app.private_live_deposit_pilot_customers customer
                    where customer.pilot_revision_id = revision.id) as customer_count,
                  (select count(*)::integer
                     from app.private_live_deposit_pilot_providers provider
                    where provider.pilot_revision_id = revision.id) as provider_count
             from app.private_live_deposit_pilot_revisions revision
            where revision.id = $1::uuid`,
          [pilot.pilotRevisionId],
        );
        expect(snapshot.rows).toEqual([
          {
            configuration_digest: pilot.configurationDigest,
            customer_count: 2,
            maximum_reservation_count: 5,
            player_count: 5,
            provider_count: 1,
            status: 'draft',
          },
        ]);

        const playerSnapshots = await client.query<{
          readonly owner_customer_id: string;
          readonly player_id: string;
          readonly snapshot_current: boolean;
        }>(
          `select member.player_id_snapshot as player_id,
                  member.player_owner_customer_id_snapshot as owner_customer_id,
                  player.updated_at is not distinct from member.player_updated_at_snapshot
                    and player_owner_customer.status = 'active'
                    and player_owner_customer.status
                        = member.player_owner_customer_status_snapshot
                    and player_owner_customer.updated_at
                        is not distinct from member.player_owner_customer_updated_at_snapshot
                    and decision.id = member.eligibility_decision_id_snapshot
                    and decision.player_account_updated_at_snapshot
                        is not distinct from player.updated_at as snapshot_current
             from app.private_live_deposit_pilot_players member
             join app.customer_platform_players player on player.id = member.player_account_id
             join app.customers player_owner_customer
               on player_owner_customer.id = member.player_owner_customer_id_snapshot
             join app.player_deposit_eligibility_decisions decision
               on decision.id = member.eligibility_decision_id_snapshot
            where member.pilot_revision_id = $1::uuid
            order by member.player_id_snapshot`,
          [pilot.pilotRevisionId],
        );
        expect(playerSnapshots.rows.map((row) => row.player_id)).toEqual(
          [...pilot.playerIds].sort(),
        );
        expect(
          playerSnapshots.rows.every(
            (row) => row.owner_customer_id === pilot.ownerCustomerId && row.snapshot_current,
          ),
        ).toBe(true);

        const providerSnapshot = await client.query<{
          readonly receiver_account_id: string;
          readonly receiver_account_version: number;
          readonly receiver_current: boolean;
        }>(
          `select member.receiver_account_id,
                  member.receiver_account_version,
                  receiver.updated_at is not distinct from member.receiver_updated_at_snapshot
                    and receiver.account_holder_name
                        = member.receiver_account_holder_name_snapshot
                    and receiver.account_reference_masked
                        = member.receiver_account_masked_snapshot as receiver_current
             from app.private_live_deposit_pilot_providers member
             join app.receiver_accounts receiver
               on receiver.id = member.receiver_account_id
              and receiver.provider_id = member.payment_provider_id
              and receiver.version = member.receiver_account_version
            where member.pilot_revision_id = $1::uuid`,
          [pilot.pilotRevisionId],
        );
        expect(providerSnapshot.rows).toEqual([
          {
            receiver_account_id: pilot.receiverAccountId,
            receiver_account_version: pilot.receiverAccountVersion,
            receiver_current: true,
          },
        ]);

        const replay = await queryAsMigrationOwner<{ readonly pilot_revision_id: string }>(
          client,
          `select app.prepare_private_live_deposit_pilot(
             $1::uuid, $2::uuid, array['cbe_birr']::text[], $3::text[], $4::uuid[],
             2500::bigint, 2500000::bigint, 2500000::bigint, 12500000::bigint,
             5::smallint,
             $5::timestamptz, $6::timestamptz
           ) as pilot_revision_id`,
          [
            ownerAdminId,
            pilot.requestKey,
            pilot.playerIds,
            [pilot.ownerCustomerId, pilot.submittingCustomerId],
            pilot.activeFrom,
            pilot.expiresAt,
          ],
        );
        expect(replay).toEqual([{ pilot_revision_id: pilot.pilotRevisionId }]);

        await expectFailureAtSavepoint(
          client,
          `select app.prepare_private_live_deposit_pilot(
             $1::uuid, $2::uuid, array['cbe_birr']::text[], $3::text[], $4::uuid[],
             2500::bigint, 2500000::bigint, 2500000::bigint, 12500000::bigint,
             5::smallint,
             $5::timestamptz, $6::timestamptz
           )`,
          [
            ownerAdminId,
            randomUUID(),
            pilot.playerIds.slice(0, 4),
            [pilot.ownerCustomerId],
            pilot.activeFrom,
            pilot.expiresAt,
          ],
          /preparation request is invalid/u,
        );
        await expectFailureAtSavepoint(
          client,
          `select app.prepare_private_live_deposit_pilot(
             $1::uuid, $2::uuid, array['cbe_birr']::text[], $3::text[], $4::uuid[],
             2500::bigint, 2500000::bigint, 2500000::bigint, 12500000::bigint,
             5::smallint,
             $5::timestamptz, $6::timestamptz
           )`,
          [
            ownerAdminId,
            randomUUID(),
            [pilot.playerIds[0]!, pilot.playerIds[0]!, ...pilot.playerIds.slice(2)],
            [pilot.ownerCustomerId],
            pilot.activeFrom,
            pilot.expiresAt,
          ],
          /preparation request is invalid/u,
        );
        await expectFailureAtSavepoint(
          client,
          `select app.prepare_private_live_deposit_pilot(
             $1::uuid, $2::uuid, array['cbe_birr']::text[], $3::text[], $4::uuid[],
             2500::bigint, 2500000::bigint, 2500000::bigint, 5000000::bigint,
             1::smallint,
             $5::timestamptz, $6::timestamptz
           )`,
          [
            ownerAdminId,
            randomUUID(),
            pilot.playerIds,
            [pilot.ownerCustomerId],
            pilot.activeFrom,
            pilot.expiresAt,
          ],
          /preparation request is invalid/u,
        );

        await expectFailureAtSavepoint(
          client,
          `update app.private_live_deposit_pilot_players
              set player_id_snapshot = 'MUTATED'
            where pilot_revision_id = $1::uuid`,
          [pilot.pilotRevisionId],
          /retained and immutable/u,
        );
        await expectFailureAtSavepoint(
          client,
          `update app.private_live_deposit_pilot_revisions
              set maximum_aggregate_minor = maximum_aggregate_minor + 1
            where id = $1::uuid`,
          [pilot.pilotRevisionId],
          /configuration is immutable/u,
        );
      });
    });

    it('accepts one independent submitting customer and rejects a six-customer manifest', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const prerequisites = await createPilotPrerequisites(client);
        const pilot = await preparePilot(client, getOwnerAdminId(), prerequisites, {
          submittingCustomerIds: [prerequisites.submittingCustomerId],
        });

        const customerCount = await client.query<{ readonly count: number }>(
          `select count(*)::integer as count
             from app.private_live_deposit_pilot_customers
            where pilot_revision_id = $1::uuid`,
          [pilot.pilotRevisionId],
        );
        expect(customerCount.rows).toEqual([{ count: 1 }]);

        const excessCustomers = await client.query<{ readonly customer_ids: readonly string[] }>(`
          with inserted as (
            insert into app.customers (status)
            select 'active'::app.record_status from generate_series(1, 6)
            returning id
          )
          select array_agg(id order by id) as customer_ids from inserted
        `);
        expect(excessCustomers.rows[0]!.customer_ids).toHaveLength(6);

        await expectFailureAtSavepoint(
          client,
          `select app.prepare_private_live_deposit_pilot(
             $1::uuid, $2::uuid, array['cbe_birr']::text[], $3::text[], $4::uuid[],
             2500::bigint, 2500000::bigint, 2500000::bigint, 12500000::bigint,
             5::smallint,
             $5::timestamptz, $6::timestamptz
           )`,
          [
            getOwnerAdminId(),
            randomUUID(),
            pilot.playerIds,
            excessCustomers.rows[0]!.customer_ids,
            pilot.activeFrom,
            pilot.expiresAt,
          ],
          /preparation request is invalid/u,
        );
      });
    });

    it('enforces per-deposit, per-Player, aggregate, and reservation-count budgets', async () => {
      const client = getClient();

      await withRollback(client, async () => {
        const pilot = await preparePilot(
          client,
          getOwnerAdminId(),
          await createPilotPrerequisites(client),
          {
            maximumAggregateMinor: 5000,
            maximumPerDepositMinor: 2500,
            maximumPerPlayerMinor: 2500,
            maximumReservationCount: 2,
          },
        );
        await armPilot(client, getOwnerAdminId(), pilot);
        await activateSyntheticPilot(client);
        const overPerDeposit = await createSettlementLineage(client, pilot, {
          amountMinor: 2501,
        });
        await expectFailureAtSavepoint(
          client,
          `select * from app.finalize_private_live_verified_deposit_and_enqueue_execution(
             $1::uuid, $2::uuid, $3::uuid
           )`,
          [
            overPerDeposit.depositIntentId,
            overPerDeposit.verificationAttemptId,
            overPerDeposit.evidenceId,
          ],
          /payment lineage is inconsistent/u,
          'fetanagent_verification_settlement',
        );
        await expectPilotReservationCount(client, pilot.pilotRevisionId, 0);
      });

      await withRollback(client, async () => {
        const pilot = await preparePilot(
          client,
          getOwnerAdminId(),
          await createPilotPrerequisites(client),
          {
            maximumAggregateMinor: 5000,
            maximumPerDepositMinor: 2500,
            maximumPerPlayerMinor: 2500,
            maximumReservationCount: 2,
          },
        );
        await armPilot(client, getOwnerAdminId(), pilot);
        await activateSyntheticPilot(client);
        await settlePrivatePilot(client, await createSettlementLineage(client, pilot));
        const overPlayer = await createSettlementLineage(client, pilot);
        await expectFailureAtSavepoint(
          client,
          `select * from app.finalize_private_live_verified_deposit_and_enqueue_execution(
             $1::uuid, $2::uuid, $3::uuid
           )`,
          [overPlayer.depositIntentId, overPlayer.verificationAttemptId, overPlayer.evidenceId],
          /reservation budget is exhausted/u,
          'fetanagent_verification_settlement',
        );
        await expectPilotReservationCount(client, pilot.pilotRevisionId, 1);
      });

      await withRollback(client, async () => {
        const pilot = await preparePilot(
          client,
          getOwnerAdminId(),
          await createPilotPrerequisites(client),
          {
            maximumAggregateMinor: 2500,
            maximumPerDepositMinor: 2500,
            maximumPerPlayerMinor: 2500,
            maximumReservationCount: 2,
          },
        );
        await armPilot(client, getOwnerAdminId(), pilot);
        await activateSyntheticPilot(client);
        await settlePrivatePilot(client, await createSettlementLineage(client, pilot));
        const overAggregate = await createSettlementLineage(client, pilot, { playerIndex: 1 });
        await expectFailureAtSavepoint(
          client,
          `select * from app.finalize_private_live_verified_deposit_and_enqueue_execution(
             $1::uuid, $2::uuid, $3::uuid
           )`,
          [
            overAggregate.depositIntentId,
            overAggregate.verificationAttemptId,
            overAggregate.evidenceId,
          ],
          /reservation budget is exhausted/u,
          'fetanagent_verification_settlement',
        );
        await expectPilotReservationCount(client, pilot.pilotRevisionId, 1);
      });

      await withRollback(client, async () => {
        const pilot = await preparePilot(
          client,
          getOwnerAdminId(),
          await createPilotPrerequisites(client),
          {
            maximumAggregateMinor: 5000,
            maximumPerDepositMinor: 5000,
            maximumPerPlayerMinor: 5000,
            maximumReservationCount: 1,
          },
        );
        await armPilot(client, getOwnerAdminId(), pilot);
        await activateSyntheticPilot(client);
        await settlePrivatePilot(client, await createSettlementLineage(client, pilot));
        const overCount = await createSettlementLineage(client, pilot, { playerIndex: 1 });
        await expectFailureAtSavepoint(
          client,
          `select * from app.finalize_private_live_verified_deposit_and_enqueue_execution(
             $1::uuid, $2::uuid, $3::uuid
           )`,
          [overCount.depositIntentId, overCount.verificationAttemptId, overCount.evidenceId],
          /reservation budget is exhausted/u,
          'fetanagent_verification_settlement',
        );
        await expectPilotReservationCount(client, pilot.pilotRevisionId, 1);
      });
    });

    it('arms only a dormant manifest, rejects proof capture, and stops all five switches', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const pilot = await preparePilot(
          client,
          getOwnerAdminId(),
          await createPilotPrerequisites(client),
        );
        await armPilot(client, getOwnerAdminId(), pilot);

        const switches = await client.query<{
          readonly feature_key: string;
          readonly mode: string;
          readonly settings: Record<string, unknown>;
        }>(
          `select feature_key, mode::text, settings
             from app.feature_switches
            where feature_key = any($1::text[])
            order by feature_key`,
          [[...pilotSwitchKeys]],
        );
        expect(switches.rows).toHaveLength(5);
        expect(
          switches.rows
            .filter((row) => row.feature_key !== 'private_live_deposit_pilot')
            .every((row) => row.mode === 'disabled' && Object.keys(row.settings).length === 0),
        ).toBe(true);
        expect(
          switches.rows.find((row) => row.feature_key === 'private_live_deposit_pilot'),
        ).toEqual({
          feature_key: 'private_live_deposit_pilot',
          mode: 'dry_run',
          settings: {
            configuration_digest: pilot.configurationDigest,
            contract_version: 1,
            pilot_revision_id: pilot.pilotRevisionId,
          },
        });

        const status = await queryAsMigrationOwner<{
          readonly financially_active: boolean;
          readonly pilot_status: string;
          readonly reserved_deposit_count: number;
          readonly switch_mode: string;
        }>(
          client,
          `select pilot_status, switch_mode, financially_active, reserved_deposit_count
             from app.get_private_live_deposit_pilot_status($1::uuid, $2::uuid)`,
          [getOwnerAdminId(), pilot.pilotRevisionId],
        );
        expect(status).toEqual([
          {
            financially_active: false,
            pilot_status: 'armed',
            reserved_deposit_count: 0,
            switch_mode: 'dry_run',
          },
        ]);

        const fingerprint = sha256(`dormant-proof:${randomUUID()}`);
        await expectFailureAtSavepoint(
          client,
          `insert into app.private_live_deposit_pilot_proofs (
             pilot_revision_id, submitting_customer_id, player_account_id,
             payment_provider_id, provider_code_snapshot, origin_channel, input_kind,
             candidate_reference_ciphertext, candidate_reference_fingerprint,
             candidate_reference_masked, reference_encryption_key_version,
             reference_profile_version
           ) values (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'cbe_birr', 'telegram',
             'pasted_sms', $5::text, $6::text, '***ABCD', 2, 2
           )`,
          [
            pilot.pilotRevisionId,
            pilot.submittingCustomerId,
            pilot.playerAccountIds[0]!,
            pilot.paymentProviderId,
            `v2.cbe_birr.${fingerprint.slice(0, 16)}.${fingerprint.slice(16, 38)}.${fingerprint.slice(38, 60)}`,
            fingerprint,
          ],
          /cannot capture a live proof/u,
        );

        const idleLease = await queryAsRole<LeaseRow>(
          client,
          'fetanagent_deposit_executor',
          `select * from app.lease_next_private_live_deposit_execution($1::uuid, 300)`,
          [randomUUID()],
        );
        expect(idleLease).toEqual([]);

        await queryAsMigrationOwner(
          client,
          `select app.stop_private_live_deposit_pilot($1::uuid, $2::uuid, 'owner_stop')`,
          [getOwnerAdminId(), pilot.pilotRevisionId],
        );
        const stoppedSwitches = await client.query<{ readonly mode: string }>(
          `select mode::text
             from app.feature_switches
            where feature_key = any($1::text[])`,
          [[...pilotSwitchKeys]],
        );
        expect(stoppedSwitches.rows.every((row) => row.mode === 'disabled')).toBe(true);

        await queryAsMigrationOwner(
          client,
          `select app.stop_private_live_deposit_pilot($1::uuid, $2::uuid, 'owner_stop')`,
          [getOwnerAdminId(), pilot.pilotRevisionId],
        );
        await expectFailureAtSavepoint(
          client,
          `select app.stop_private_live_deposit_pilot(
             $1::uuid, $2::uuid, 'provider_incident'
           )`,
          [getOwnerAdminId(), pilot.pilotRevisionId],
          /already stopped for another reason/u,
        );
      });
    });

    it('binds cross-customer proof, claim, intent, snapshots, reservation, lease, and fence', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const pilot = await preparePilot(
          client,
          getOwnerAdminId(),
          await createPilotPrerequisites(client),
        );
        await armPilot(client, getOwnerAdminId(), pilot);
        await activateSyntheticPilot(client);
        const lineage = await createSettlementLineage(client, pilot);

        expect(pilot.submittingCustomerId).not.toBe(pilot.ownerCustomerId);
        await expectFailureAtSavepoint(
          client,
          `insert into app.private_live_deposit_pilot_proofs (
             pilot_revision_id, submitting_customer_id, player_account_id,
             payment_provider_id, provider_code_snapshot, origin_channel, input_kind,
             candidate_reference_ciphertext, candidate_reference_fingerprint,
             candidate_reference_masked, reference_encryption_key_version,
             reference_profile_version
           )
           select pilot_revision_id, submitting_customer_id, player_account_id,
                  payment_provider_id, provider_code_snapshot, origin_channel, input_kind,
                  candidate_reference_ciphertext, candidate_reference_fingerprint,
                  candidate_reference_masked, reference_encryption_key_version,
                  reference_profile_version
             from app.private_live_deposit_pilot_proofs
            where id = $1::uuid`,
          [lineage.proofId],
          /private_live_deposit_pilot_proofs_provider_reference_key|duplicate key/u,
        );

        const inactiveOwnerSavepoint = `inactive_owner_${sha256(randomUUID()).slice(0, 12)}`;
        await client.query(`savepoint ${inactiveOwnerSavepoint}`);
        await client.query(`update app.customers set status = 'inactive' where id = $1::uuid`, [
          pilot.ownerCustomerId,
        ]);
        await expectFailureAtSavepoint(
          client,
          `select * from app.finalize_private_live_verified_deposit_and_enqueue_execution(
             $1::uuid, $2::uuid, $3::uuid
           )`,
          [lineage.depositIntentId, lineage.verificationAttemptId, lineage.evidenceId],
          /settlement proof is not authorized/u,
          'fetanagent_verification_settlement',
        );
        await client.query(`rollback to savepoint ${inactiveOwnerSavepoint}`);
        await client.query(`release savepoint ${inactiveOwnerSavepoint}`);

        const firstSettlement = await settlePrivatePilot(client, lineage);
        expect(firstSettlement).toHaveLength(1);
        expect(firstSettlement[0]).toMatchObject({
          already_finalized: false,
          deposit_intent_id: lineage.depositIntentId,
          deposit_status: 'execution_pending',
          execution_job_status: 'queued',
        });

        const reservation = await client.query<{
          readonly amount_minor: string;
          readonly authorization_token: string;
          readonly canonical_reference_fingerprint: string;
          readonly currency_code: string;
          readonly deposit_intent_id: string;
          readonly deposit_payment_claim_id: string;
          readonly id: string;
          readonly payment_provider_id: string;
          readonly pilot_revision_id: string;
          readonly player_account_id: string;
          readonly player_owner_customer_id_snapshot: string;
          readonly private_live_deposit_pilot_proof_id: string;
          readonly provider_payment_evidence_id: string;
          readonly receiver_account_id: string;
          readonly receiver_account_version: number;
          readonly submitting_customer_id: string;
          readonly verification_attempt_id: string;
        }>(
          `select id,
                  pilot_revision_id,
                  private_live_deposit_pilot_proof_id,
                  deposit_intent_id,
                  deposit_payment_claim_id,
                  verification_attempt_id,
                  provider_payment_evidence_id,
                  submitting_customer_id,
                  player_account_id,
                  player_owner_customer_id_snapshot,
                  payment_provider_id,
                  receiver_account_id,
                  receiver_account_version,
                  canonical_reference_fingerprint,
                  amount_minor,
                  currency_code,
                  authorization_token
             from app.private_live_deposit_pilot_reservations
            where deposit_intent_id = $1::uuid`,
          [lineage.depositIntentId],
        );
        expect(reservation.rows).toHaveLength(1);
        expect(reservation.rows[0]).toMatchObject({
          amount_minor: '2500',
          canonical_reference_fingerprint: lineage.fingerprint,
          currency_code: 'ETB',
          deposit_intent_id: lineage.depositIntentId,
          deposit_payment_claim_id: firstSettlement[0]!.payment_claim_id,
          payment_provider_id: pilot.paymentProviderId,
          pilot_revision_id: pilot.pilotRevisionId,
          player_account_id: pilot.playerAccountIds[0],
          player_owner_customer_id_snapshot: pilot.ownerCustomerId,
          private_live_deposit_pilot_proof_id: lineage.proofId,
          provider_payment_evidence_id: lineage.evidenceId,
          receiver_account_id: pilot.receiverAccountId,
          receiver_account_version: pilot.receiverAccountVersion,
          submitting_customer_id: pilot.submittingCustomerId,
          verification_attempt_id: lineage.verificationAttemptId,
        });
        expect(reservation.rows[0]!.authorization_token).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        );

        const replay = await settlePrivatePilot(client, lineage);
        expect(replay).toHaveLength(1);
        expect(replay[0]).toMatchObject({
          already_finalized: true,
          deposit_intent_id: firstSettlement[0]!.deposit_intent_id,
          execution_job_id: firstSettlement[0]!.execution_job_id,
          payment_claim_id: firstSettlement[0]!.payment_claim_id,
        });
        const replayCardinality = await client.query<{
          readonly evidence_count: number;
          readonly proof_count: number;
          readonly reservation_count: number;
        }>(
          `select
             (select count(*)::integer
                from app.private_live_deposit_pilot_proofs proof
               where proof.payment_provider_id = $1::uuid
                 and proof.candidate_reference_fingerprint = $2::text) as proof_count,
             (select count(*)::integer
                from app.provider_payment_evidence evidence
               where evidence.payment_provider_id = $1::uuid
                 and evidence.canonical_reference_fingerprint = $2::text) as evidence_count,
             (select count(*)::integer
                from app.private_live_deposit_pilot_reservations reservation
               where reservation.pilot_revision_id = $3::uuid) as reservation_count`,
          [pilot.paymentProviderId, lineage.fingerprint, pilot.pilotRevisionId],
        );
        expect(replayCardinality.rows).toEqual([
          { evidence_count: 1, proof_count: 1, reservation_count: 1 },
        ]);

        await expectFailureAtSavepoint(
          client,
          `update app.private_live_deposit_pilot_reservations
              set amount_minor = amount_minor + 1
            where id = $1::uuid`,
          [reservation.rows[0]!.id],
          /retained and immutable/u,
        );
        await expectFailureAtSavepoint(
          client,
          `delete from app.private_live_deposit_pilot_proofs where id = $1::uuid`,
          [lineage.proofId],
          /retained and immutable/u,
        );
        await expectFailureAtSavepoint(
          client,
          `truncate table app.private_live_deposit_pilot_reservations`,
          [],
          /cannot be truncated/u,
        );

        const stopSavepoint = `stopped_lease_probe_${sha256(randomUUID()).slice(0, 12)}`;
        await client.query(`savepoint ${stopSavepoint}`);
        await queryAsMigrationOwner(
          client,
          `select app.stop_private_live_deposit_pilot($1::uuid, $2::uuid, 'owner_stop')`,
          [getOwnerAdminId(), pilot.pilotRevisionId],
        );
        const stoppedLease = await queryAsRole<LeaseRow>(
          client,
          'fetanagent_deposit_executor',
          `select * from app.lease_next_private_live_deposit_execution($1::uuid, 300)`,
          [randomUUID()],
        );
        expect(stoppedLease).toEqual([]);
        await client.query(`rollback to savepoint ${stopSavepoint}`);
        await client.query(`release savepoint ${stopSavepoint}`);

        const expiredLeaseSavepoint = `expired_lease_probe_${sha256(randomUUID()).slice(0, 12)}`;
        await client.query(`savepoint ${expiredLeaseSavepoint}`);
        await client.query(`set local session_replication_role = 'replica'`);
        await client.query(
          `update app.private_live_deposit_pilot_revisions
              set expires_at = active_from + interval '1 second'
            where id = $1::uuid`,
          [pilot.pilotRevisionId],
        );
        await client.query(`set local session_replication_role = 'origin'`);
        const expiredLease = await queryAsRole<LeaseRow>(
          client,
          'fetanagent_deposit_executor',
          `select * from app.lease_next_private_live_deposit_execution($1::uuid, 300)`,
          [randomUUID()],
        );
        expect(expiredLease).toEqual([]);
        await client.query(`rollback to savepoint ${expiredLeaseSavepoint}`);
        await client.query(`release savepoint ${expiredLeaseSavepoint}`);

        const lease = await queryAsRole<LeaseRow>(
          client,
          'fetanagent_deposit_executor',
          `select * from app.lease_next_private_live_deposit_execution($1::uuid, 300)`,
          [randomUUID()],
        );
        expect(lease).toHaveLength(1);
        expect(lease[0]).toMatchObject({
          amount_minor: '2500',
          currency_code: 'ETB',
          deposit_intent_id: lineage.depositIntentId,
          execution_job_id: firstSettlement[0]!.execution_job_id,
          lease_disposition: 'execution',
          pilot_authorization_token: reservation.rows[0]!.authorization_token,
          pilot_configuration_digest: pilot.configurationDigest,
          pilot_contract_version: 1,
          pilot_reservation_id: reservation.rows[0]!.id,
          pilot_revision_id: pilot.pilotRevisionId,
          player_id: pilot.playerIds[0],
        });
        expect(lease[0]!.lease_expires_at).toBeInstanceOf(Date);

        const stoppedFenceSavepoint = `stopped_fence_probe_${sha256(randomUUID()).slice(0, 12)}`;
        await client.query(`savepoint ${stoppedFenceSavepoint}`);
        await queryAsMigrationOwner(
          client,
          `select app.stop_private_live_deposit_pilot($1::uuid, $2::uuid, 'owner_stop')`,
          [getOwnerAdminId(), pilot.pilotRevisionId],
        );
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.fence_private_live_deposit_execution_final_action(
               $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid
             )`,
          [
            lease[0]!.execution_attempt_id,
            lease[0]!.lease_token,
            lease[0]!.pilot_revision_id!,
            lease[0]!.pilot_reservation_id!,
            lease[0]!.pilot_authorization_token!,
          ],
          /not financially active/u,
          'fetanagent_deposit_executor',
        );
        await client.query(`rollback to savepoint ${stoppedFenceSavepoint}`);
        await client.query(`release savepoint ${stoppedFenceSavepoint}`);

        const expiredFenceSavepoint = `expired_fence_probe_${sha256(randomUUID()).slice(0, 12)}`;
        await client.query(`savepoint ${expiredFenceSavepoint}`);
        await client.query(`set local session_replication_role = 'replica'`);
        await client.query(
          `update app.private_live_deposit_pilot_revisions
              set expires_at = active_from + interval '1 second'
            where id = $1::uuid`,
          [pilot.pilotRevisionId],
        );
        await client.query(`set local session_replication_role = 'origin'`);
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.fence_private_live_deposit_execution_final_action(
               $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid
             )`,
          [
            lease[0]!.execution_attempt_id,
            lease[0]!.lease_token,
            lease[0]!.pilot_revision_id!,
            lease[0]!.pilot_reservation_id!,
            lease[0]!.pilot_authorization_token!,
          ],
          /execution authorization is invalid/u,
          'fetanagent_deposit_executor',
        );
        await client.query(`rollback to savepoint ${expiredFenceSavepoint}`);
        await client.query(`release savepoint ${expiredFenceSavepoint}`);

        await expectFailureAtSavepoint(
          client,
          `select *
             from app.fence_private_live_deposit_execution_final_action(
               $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid
             )`,
          [
            lease[0]!.execution_attempt_id,
            lease[0]!.lease_token,
            pilot.pilotRevisionId,
            reservation.rows[0]!.id,
            randomUUID(),
          ],
          /lease authorization does not match/u,
          'fetanagent_deposit_executor',
        );

        const fence = await queryAsRole<FenceRow>(
          client,
          'fetanagent_deposit_executor',
          `select *
             from app.fence_private_live_deposit_execution_final_action(
               $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid
             )`,
          [
            lease[0]!.execution_attempt_id,
            lease[0]!.lease_token,
            lease[0]!.pilot_revision_id!,
            lease[0]!.pilot_reservation_id!,
            lease[0]!.pilot_authorization_token!,
          ],
        );
        expect(fence).toHaveLength(1);
        expect(fence[0]).toMatchObject({
          deposit_intent_id: lease[0]!.deposit_intent_id,
          execution_attempt_id: lease[0]!.execution_attempt_id,
          first_fence_acquired: true,
          pilot_authorization_token: lease[0]!.pilot_authorization_token,
          pilot_configuration_digest: lease[0]!.pilot_configuration_digest,
          pilot_contract_version: lease[0]!.pilot_contract_version,
          pilot_reservation_id: lease[0]!.pilot_reservation_id,
          pilot_revision_id: lease[0]!.pilot_revision_id,
        });
        expect(fence[0]!.final_action_fenced_at).toBeInstanceOf(Date);
      });
    });

    it('forces RLS, exposes no table policy or amount-first writer, and pins the RPC ACL', async () => {
      const client = getClient();
      const relations = await client.query<{
        readonly owner_name: string;
        readonly policies: number;
        readonly relforcerowsecurity: boolean;
        readonly relname: string;
        readonly relrowsecurity: boolean;
      }>(
        `select relation.relname,
                owner_role.rolname as owner_name,
                relation.relrowsecurity,
                relation.relforcerowsecurity,
                (select count(*)::integer
                   from pg_policy policy
                  where policy.polrelid = relation.oid) as policies
           from pg_class relation
           join pg_namespace namespace on namespace.oid = relation.relnamespace
           join pg_roles owner_role on owner_role.oid = relation.relowner
          where namespace.nspname = 'app'
            and relation.relname = any($1::text[])
          order by relation.relname`,
        [[...pilotTableNames]],
      );
      expect(relations.rows.map((row) => row.relname)).toEqual([...pilotTableNames]);
      expect(
        relations.rows.every(
          (row) =>
            row.owner_name === 'postgres' &&
            row.policies === 0 &&
            row.relforcerowsecurity &&
            row.relrowsecurity,
        ),
      ).toBe(true);

      const forbiddenTableAccess = await client.query<{
        readonly allowed: boolean;
        readonly role_name: string;
      }>(
        `select role_name,
                exists (
                  select 1
                    from unnest($2::text[]) table_name
                   where has_table_privilege(
                     role_name,
                     format('app.%I', table_name),
                     'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
                   )
                ) as allowed
           from unnest($1::text[]) role_name
          order by role_name`,
        [
          [
            'anon',
            'authenticated',
            'service_role',
            'fetanagent_api',
            'fetanagent_api_runtime',
            'fetanagent_customer_web',
            'fetanagent_customer_web_runtime',
            'fetanagent_deposit_executor',
            'fetanagent_deposit_executor_runtime',
            'fetanagent_owner_control',
            'fetanagent_owner_control_runtime',
            'fetanagent_player_actions',
            'fetanagent_player_actions_runtime',
            'fetanagent_verification_settlement',
            'fetanagent_verification_settlement_runtime',
          ],
          [...pilotTableNames],
        ],
      );
      expect(forbiddenTableAccess.rows.every((row) => !row.allowed)).toBe(true);

      const proofColumns = await client.query<{ readonly column_name: string }>(`
        select column_name
          from information_schema.columns
         where table_schema = 'app'
           and table_name = 'private_live_deposit_pilot_proofs'
         order by ordinal_position
      `);
      expect(proofColumns.rows.map((row) => row.column_name)).not.toContain('amount_minor');
      expect(proofColumns.rows.map((row) => row.column_name)).not.toContain(
        'customer_entered_amount_minor',
      );

      const functionCatalog = await client.query<{
        readonly is_security_definer: boolean;
        readonly owner_name: string;
        readonly runtime_config: readonly string[];
        readonly signature: string;
      }>(`
        select procedure.oid::regprocedure::text as signature,
               procedure.prosecdef as is_security_definer,
               procedure.proconfig as runtime_config,
               owner_role.rolname as owner_name
          from pg_proc procedure
          join pg_namespace namespace on namespace.oid = procedure.pronamespace
          join pg_roles owner_role on owner_role.oid = procedure.proowner
         where procedure.oid in (
           'app.prepare_private_live_deposit_pilot(uuid,uuid,text[],text[],uuid[],bigint,bigint,bigint,bigint,smallint,timestamptz,timestamptz)'::regprocedure,
           'app.arm_private_live_deposit_pilot(uuid,uuid)'::regprocedure,
           'app.stop_private_live_deposit_pilot(uuid,uuid,text)'::regprocedure,
           'app.get_private_live_deposit_pilot_status(uuid,uuid)'::regprocedure,
           'app.finalize_private_live_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)'::regprocedure,
           'app.lease_next_private_live_deposit_execution(uuid,integer)'::regprocedure,
           'app.fence_private_live_deposit_execution_final_action(uuid,uuid,uuid,uuid,uuid)'::regprocedure
         )
         order by signature
      `);
      expect(functionCatalog.rows).toHaveLength(7);
      expect(
        functionCatalog.rows.every(
          (row) =>
            row.is_security_definer &&
            row.owner_name === 'postgres' &&
            JSON.stringify(row.runtime_config) === JSON.stringify(['search_path=pg_catalog']),
        ),
      ).toBe(true);

      const leaseSources = await client.query<{
        readonly function_name: string;
        readonly source: string;
      }>(`
        select procedure.proname as function_name,
               lower(pg_get_functiondef(procedure.oid)) as source
          from pg_proc procedure
         where procedure.oid in (
           'app.lease_next_deposit_execution(uuid,integer)'::regprocedure,
           'app.lease_next_private_live_deposit_execution(uuid,integer)'::regprocedure
         )
         order by function_name
      `);
      expect(leaseSources.rows).toHaveLength(2);
      expect(
        leaseSources.rows.find((row) => row.function_name === 'lease_next_deposit_execution')
          ?.source,
      ).toMatch(/for update of [^;]+ skip locked/iu);
      expect(
        leaseSources.rows.find(
          (row) => row.function_name === 'lease_next_private_live_deposit_execution',
        )?.source,
      ).toContain('from app.lease_next_deposit_execution(');

      const authoritySources = await client.query<{
        readonly function_name: string;
        readonly source: string;
      }>(`
        select procedure.proname as function_name,
               lower(pg_get_functiondef(procedure.oid)) as source
          from pg_proc procedure
         where procedure.oid in (
           'app.arm_private_live_deposit_pilot_by_admin_id(uuid,uuid)'::regprocedure,
           'app.enforce_private_live_deposit_pilot_proof_insert()'::regprocedure,
           'app.reserve_private_live_deposit_pilot_claim(uuid)'::regprocedure,
           'app.require_private_live_deposit_pilot_authorization(uuid,uuid)'::regprocedure,
           'app.finalize_private_live_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)'::regprocedure
         )
         order by function_name
      `);
      expect(authoritySources.rows).toHaveLength(5);
      for (const row of authoritySources.rows) {
        expect(row.source).not.toContain('for key share');
        const orderedMutableLocks = [
          'perform platform.id',
          'perform agent.id',
          'perform customer.id',
          'perform player.id',
          'perform decision.id',
          'perform payment_provider.id',
          'perform receiver.id',
        ].map((fragment) => row.source.indexOf(fragment));
        expect(orderedMutableLocks.every((index) => index >= 0)).toBe(true);
        expect(orderedMutableLocks).toEqual(
          [...orderedMutableLocks].sort((left, right) => left - right),
        );
        const finalClockAssignment =
          row.function_name === 'enforce_private_live_deposit_pilot_proof_insert'
            ? row.source.lastIndexOf('captured_at := clock_timestamp()')
            : row.function_name === 'arm_private_live_deposit_pilot_by_admin_id'
              ? row.source.lastIndexOf('armed_time := clock_timestamp()')
              : row.source.lastIndexOf('checked_at := clock_timestamp()');
        expect(finalClockAssignment).toBeGreaterThan(orderedMutableLocks.at(-1)!);
      }
      const reservationSource = authoritySources.rows.find(
        (row) => row.function_name === 'reserve_private_live_deposit_pilot_claim',
      )!.source;
      expect(reservationSource).toMatch(
        /from app\.private_live_deposit_pilot_revisions pilot_revision[\s\S]*for update[\s\S]*pg_advisory_xact_lock[\s\S]*sum\(reservation\.amount_minor\)/iu,
      );

      const capabilityChecks = await client.query<{
        readonly direct_grantees: readonly string[];
        readonly executor_allowed: boolean;
        readonly owner_allowed: boolean;
        readonly owner_runtime_allowed: boolean;
        readonly public_allowed: boolean;
        readonly settlement_allowed: boolean;
        readonly signature: string;
      }>(`
        select procedure.oid::regprocedure::text as signature,
               has_function_privilege('fetanagent_owner_control', procedure.oid, 'EXECUTE')
                 as owner_allowed,
               has_function_privilege(
                 'fetanagent_owner_control_runtime', procedure.oid, 'EXECUTE'
               ) as owner_runtime_allowed,
               has_function_privilege('fetanagent_deposit_executor', procedure.oid, 'EXECUTE')
                 as executor_allowed,
               has_function_privilege(
                 'fetanagent_verification_settlement', procedure.oid, 'EXECUTE'
               ) as settlement_allowed,
               exists (
                 select 1
                   from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
                  where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
               ) as public_allowed,
               array(
                 select coalesce(grantee.rolname, 'PUBLIC')
                   from aclexplode(
                     coalesce(procedure.proacl, acldefault('f', procedure.proowner))
                   ) acl
                   left join pg_roles grantee on grantee.oid = acl.grantee
                  where acl.grantee <> procedure.proowner
                    and acl.privilege_type = 'EXECUTE'
                  order by coalesce(grantee.rolname, 'PUBLIC')
               )::text[] as direct_grantees
          from pg_proc procedure
          join pg_namespace namespace on namespace.oid = procedure.pronamespace
         where namespace.nspname = 'app'
           and procedure.proname in (
             'prepare_private_live_deposit_pilot',
             'arm_private_live_deposit_pilot',
             'stop_private_live_deposit_pilot',
             'get_private_live_deposit_pilot_status',
             'finalize_private_live_verified_deposit_and_enqueue_execution',
             'lease_next_private_live_deposit_execution',
             'fence_private_live_deposit_execution_final_action'
           )
         order by signature
      `);
      for (const row of capabilityChecks.rows) {
        expect(row.public_allowed).toBe(false);
        if (row.signature.includes('finalize_private_live')) {
          expect(row).toMatchObject({
            direct_grantees: ['fetanagent_verification_settlement'],
            executor_allowed: false,
            owner_allowed: false,
            owner_runtime_allowed: false,
            settlement_allowed: true,
          });
        } else if (
          row.signature.includes('lease_next_private') ||
          row.signature.includes('fence_private')
        ) {
          expect(row).toMatchObject({
            direct_grantees: ['fetanagent_deposit_executor'],
            executor_allowed: true,
            owner_allowed: false,
            owner_runtime_allowed: false,
            settlement_allowed: false,
          });
        } else if (row.signature.includes('prepare_private_live_deposit_pilot')) {
          expect(row).toMatchObject({
            direct_grantees: [],
            executor_allowed: false,
            owner_allowed: false,
            owner_runtime_allowed: false,
            settlement_allowed: false,
          });
        } else {
          expect(row).toMatchObject({
            direct_grantees: ['fetanagent_owner_control'],
            executor_allowed: false,
            owner_allowed: true,
            owner_runtime_allowed: true,
            settlement_allowed: false,
          });
        }
      }

      const bypassChecks = await client.query<{
        readonly player_actions_allowed: boolean;
        readonly customer_web_allowed: boolean;
        readonly executor_allowed: boolean;
        readonly settlement_allowed: boolean;
        readonly signature: string;
      }>(`
        select procedure.oid::regprocedure::text as signature,
               has_function_privilege('fetanagent_player_actions_runtime', procedure.oid, 'EXECUTE')
                 as player_actions_allowed,
               has_function_privilege('fetanagent_customer_web_runtime', procedure.oid, 'EXECUTE')
                 as customer_web_allowed,
               has_function_privilege('fetanagent_deposit_executor_runtime', procedure.oid, 'EXECUTE')
                 as executor_allowed,
               has_function_privilege(
                 'fetanagent_verification_settlement_runtime', procedure.oid, 'EXECUTE'
               ) as settlement_allowed
          from pg_proc procedure
         where procedure.oid in (
           'app.open_telegram_live_deposit_intent(uuid,text,bigint,text)'::regprocedure,
           'app.capture_telegram_live_deposit_reference(uuid,uuid,text,text,text,smallint,text)'::regprocedure,
           'app.open_customer_web_deposit_intent(uuid,uuid,text,bigint)'::regprocedure,
           'app.capture_customer_web_deposit_reference(uuid,uuid,uuid,text,text,text,smallint)'::regprocedure,
           'app.lease_next_deposit_execution(uuid,integer)'::regprocedure,
           'app.fence_deposit_execution_final_action(uuid,uuid)'::regprocedure,
           'app.finalize_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)'::regprocedure
         )
         order by signature
      `);
      expect(bypassChecks.rows).toHaveLength(7);
      expect(
        bypassChecks.rows.every(
          (row) =>
            !row.player_actions_allowed &&
            !row.customer_web_allowed &&
            !row.executor_allowed &&
            !row.settlement_allowed,
        ),
      ).toBe(true);

      const indexCatalog = await client.query<{ readonly indexname: string }>(`
        select indexname
          from pg_indexes
         where schemaname = 'app'
           and indexname in (
             'receiver_accounts_private_live_pilot_identity_idx',
             'private_live_deposit_pilot_one_armed_revision_idx',
             'private_live_deposit_pilot_one_open_revision_idx',
             'private_live_deposit_pilot_proofs_pilot_customer_idx',
             'private_live_deposit_pilot_proofs_pilot_player_idx',
             'private_live_deposit_pilot_proofs_pilot_provider_idx',
             'private_live_deposit_pilot_reservations_pilot_reserved_idx',
             'private_live_deposit_pilot_reservations_player_reserved_idx',
             'private_live_deposit_pilot_reservations_pilot_customer_idx',
             'private_live_deposit_pilot_reservations_player_idx',
             'private_live_deposit_pilot_proofs_pilot_submitted_idx',
             'private_live_deposit_pilot_providers_receiver_revision_idx',
             'private_live_pilot_reservations_provider_receiver_idx'
           )
         order by indexname
      `);
      expect(indexCatalog.rows).toHaveLength(13);
    });
  });
}
