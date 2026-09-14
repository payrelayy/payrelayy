import { createHash, randomUUID } from 'node:crypto';

import type { Client, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  prepareTelebirrPilot,
  type TelebirrPilot,
} from './private-live-telebirr-proof-lineage.suite.js';

type SqlValue = boolean | number | string | null;

type TelegramActor = {
  readonly customerId: string;
  readonly identityId: string;
  readonly telegramUserId: string;
};

type DestinationRow = {
  readonly payments_enabled: boolean;
  readonly provider_code: string;
  readonly receiver_account_holder_name: string;
  readonly receiver_account_masked: string;
  readonly receiver_account_reference_ciphertext: string;
  readonly receiver_account_reference_fingerprint: string;
  readonly receiver_revision_id: string;
  readonly request_replayed: boolean;
};

type CaptureRow = {
  readonly live_proof_id: string;
  readonly live_verification_job_id: string;
  readonly proof_status: string;
  readonly provider_code: string;
  readonly request_replayed: boolean;
  readonly submitted_at: Date;
};

type StatusRow = {
  readonly amount_minor: string | null;
  readonly currency_code: string | null;
  readonly deposit_status: string;
  readonly live_proof_id: string;
  readonly provider_code: string;
  readonly submitted_at: Date;
};

type IntakeCounts = {
  readonly inbound_processed: boolean;
  readonly jobs: number;
  readonly presentations: number;
  readonly proof_receipts: number;
  readonly proofs: number;
};

const destinationStatement = `
  select *
    from app.prepare_telegram_live_telebirr_destination(
      $1::uuid,
      $2::text,
      $3::text
    )
`;

const legacyDestinationStatement = `
  select *
    from app.prepare_telegram_telebirr_destination(
      $1::uuid,
      $2::text,
      $3::text
    )
`;

const captureStatement = `
  select *
    from app.capture_telegram_live_telebirr_proof(
      $1::uuid,
      $2::text,
      'telebirr'::text,
      $3::text,
      $4::text,
      $5::text,
      2::smallint,
      2::smallint,
      $6::text
    )
`;

const statusStatement = `
  select *
    from app.get_telegram_customer_live_telebirr_proof(
      $1::uuid,
      $2::uuid
    )
`;

function semanticHmac(seed: string = randomUUID()): string {
  return `hmac-sha256-v1:${createHash('sha256').update(seed, 'utf8').digest('hex')}`;
}

function referenceFingerprint(seed: string = randomUUID()): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}

function referenceCiphertext(seed: string = randomUUID()): string {
  const payload = createHash('sha256').update(seed, 'utf8').digest('base64url').slice(0, 16);
  return `v2.telebirr.${'N'.repeat(16)}.${'T'.repeat(22)}.${payload}`;
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

async function queryAsPlayerActions<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  await client.query('set local role fetanagent_player_actions');
  try {
    return (await client.query<T>(query, [...values])).rows;
  } finally {
    await client.query('reset role');
  }
}

async function expectPlayerActionsFailure(
  client: Client,
  query: string,
  values: readonly SqlValue[],
  expected: RegExp,
): Promise<void> {
  const savepoint = `expected_live_telegram_failure_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await client.query(`savepoint ${savepoint}`);
  await client.query('set local role fetanagent_player_actions');
  let failure: unknown;
  try {
    await client.query(query, [...values]);
  } catch (error) {
    failure = error;
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  await client.query('reset role');
  expect(failure).toBeInstanceOf(Error);
  expect(errorMessage(failure)).toMatch(expected);
}

async function createTelegramActor(
  client: Client,
  ownerAdminId: string,
  customerId?: string,
): Promise<TelegramActor> {
  const resolvedCustomerId =
    customerId ??
    (
      await client.query<{ readonly id: string }>(
        `insert into app.customers (status) values ('active') returning id`,
      )
    ).rows[0]!.id;
  const telegramUserId = `${800_000_000_000n + BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 10)}`)}`;
  const identity = await client.query<{ readonly id: string }>(
    `insert into app.customer_identities (
       customer_id,
       identity_kind,
       external_subject,
       status
     ) values ($1::uuid, 'telegram', $2::text, 'active')
     returning id`,
    [resolvedCustomerId, telegramUserId],
  );
  const identityId = identity.rows[0]!.id;

  await client.query(
    `insert into app.telegram_identities (
       customer_identity_id,
       telegram_user_id,
       private_chat_id,
       preferred_locale
     ) values ($1::uuid, $2::bigint, $2::bigint, 'en')`,
    [identityId, telegramUserId],
  );
  await client.query(
    `insert into app.bot_conversations (telegram_identity_id)
     values ($1::uuid)`,
    [identityId],
  );

  const admissionEvent = await createInboundEvent(client, identityId, 'admission');
  await client.query(
    `insert into app.telegram_beta_invites (
       token_digest,
       status,
       expires_at,
       issued_by_admin_id,
       created_at,
       redeemed_telegram_user_id,
       redeemed_private_chat_id,
       redeemed_customer_id,
       redeemed_customer_identity_id,
       redeemed_inbound_event_id,
       redeemed_at
     ) values (
       $1::text,
       'redeemed',
       clock_timestamp() + interval '1 hour',
       $2::uuid,
       clock_timestamp() - interval '10 minutes',
       $3::bigint,
       $3::bigint,
       $4::uuid,
       $5::uuid,
       $6::uuid,
       clock_timestamp() - interval '5 minutes'
     )`,
    [
      `sha256-v1:${referenceFingerprint()}`,
      ownerAdminId,
      telegramUserId,
      resolvedCustomerId,
      identityId,
      admissionEvent,
    ],
  );

  return { customerId: resolvedCustomerId, identityId, telegramUserId };
}

async function createInboundEvent(
  client: Client,
  identityId: string,
  purpose: string,
): Promise<string> {
  const updateId = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`).toString();
  const inbound = await client.query<{ readonly id: string }>(
    `insert into app.inbound_events (
       channel,
       external_event_id,
       customer_identity_id,
       payload_digest
     ) values ('telegram', $1::text, $2::uuid, $3::text)
     returning id`,
    [`update:${updateId}`, identityId, semanticHmac(`${purpose}:${updateId}`)],
  );
  return inbound.rows[0]!.id;
}

async function preparePilotAndActor(
  client: Client,
  ownerAdminId: string,
): Promise<{ readonly actor: TelegramActor; readonly pilot: TelebirrPilot }> {
  const pilot = await prepareTelebirrPilot(client, ownerAdminId, {
    includePlayerOwnerAsSubmittingCustomer: true,
    maximumAggregateMinor: 12_500,
    maximumPerDepositMinor: 2_500,
    maximumPerPlayerMinor: 2_500,
  });
  const actor = await createTelegramActor(client, ownerAdminId, pilot.ownerCustomerId);
  return { actor, pilot };
}

async function prepareLiveDestination(
  client: Client,
  actor: TelegramActor,
  playerId: string,
): Promise<{ readonly inboundEventId: string; readonly row: DestinationRow }> {
  const inboundEventId = await createInboundEvent(client, actor.identityId, 'live-destination');
  const rows = await queryAsPlayerActions<DestinationRow>(client, destinationStatement, [
    inboundEventId,
    playerId,
    semanticHmac(),
  ]);
  expect(rows).toHaveLength(1);
  return { inboundEventId, row: rows[0]! };
}

async function captureProof(
  client: Client,
  actor: TelegramActor,
  playerId: string,
  options: {
    readonly ciphertext?: string;
    readonly fingerprint?: string;
    readonly inboundEventId?: string;
    readonly masked?: string;
    readonly semanticInputHmac?: string;
  } = {},
): Promise<{
  readonly arguments: readonly [string, string, string, string, string, string];
  readonly row: CaptureRow;
}> {
  const callArguments = [
    options.inboundEventId ?? (await createInboundEvent(client, actor.identityId, 'live-proof')),
    playerId,
    options.ciphertext ?? referenceCiphertext(),
    options.fingerprint ?? referenceFingerprint(),
    options.masked ?? '***AB12',
    options.semanticInputHmac ?? semanticHmac(),
  ] as const;
  const rows = await queryAsPlayerActions<CaptureRow>(client, captureStatement, callArguments);
  expect(rows).toHaveLength(1);
  return { arguments: callArguments, row: rows[0]! };
}

async function readIntakeCounts(
  client: Client,
  pilot: TelebirrPilot,
  proofInboundEventId: string,
): Promise<IntakeCounts> {
  const result = await client.query<IntakeCounts>(
    `select exists (
              select 1
                from app.inbound_events inbound_event
               where inbound_event.id = $2::uuid
                 and inbound_event.processed_at is not null
            ) as inbound_processed,
            (select count(*)::integer
               from app.telegram_live_telebirr_payment_presentations presentation
               join app.telegram_telebirr_destination_receipts destination
                 on destination.origin_inbound_event_id = presentation.origin_inbound_event_id
              where destination.player_account_id = any($3::uuid[])) as presentations,
            (select count(*)::integer
               from app.private_live_deposit_pilot_proofs proof
              where proof.pilot_revision_id = $1::uuid) as proofs,
            (select count(*)::integer
               from app.private_live_telebirr_verification_jobs job
              where job.pilot_revision_id = $1::uuid) as jobs,
            (select count(*)::integer
               from app.telegram_live_telebirr_proof_receipts receipt
               join app.private_live_deposit_pilot_proofs proof
                 on proof.id = receipt.live_proof_id
              where proof.pilot_revision_id = $1::uuid) as proof_receipts`,
    [pilot.pilotRevisionId, proofInboundEventId, pilot.playerAccountIds],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

export function registerTelegramLiveTelebirrProofIntakeSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('Telegram live TeleBirr proof intake SQL boundary', () => {
    it('creates one live presentation, one proof, and one verifier job with exact replay and identity-scoped status', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const { actor, pilot } = await preparePilotAndActor(client, getOwnerAdminId());
        const destination = await prepareLiveDestination(client, actor, pilot.playerIds[0]!);

        expect(destination.row).toMatchObject({
          payments_enabled: true,
          provider_code: 'telebirr',
          receiver_account_masked: '***7001',
          receiver_revision_id: pilot.receiverAccountId,
          request_replayed: false,
        });
        expect(destination.row.receiver_account_holder_name).toBeTruthy();
        expect(destination.row.receiver_account_reference_ciphertext).toMatch(
          /^receiver-v1\.telebirr\./u,
        );
        expect(destination.row.receiver_account_reference_fingerprint).toMatch(/^[0-9a-f]{64}$/u);

        const captured = await captureProof(client, actor, pilot.playerIds[0]!);
        expect(captured.row).toMatchObject({
          proof_status: 'verification_pending',
          provider_code: 'telebirr',
          request_replayed: false,
        });
        expect(captured.row.live_proof_id).toMatch(/^[0-9a-f-]{36}$/u);
        expect(captured.row.live_verification_job_id).toMatch(/^[0-9a-f-]{36}$/u);

        const replay = await queryAsPlayerActions<CaptureRow>(
          client,
          captureStatement,
          captured.arguments,
        );
        expect(replay).toHaveLength(1);
        expect(replay[0]).toEqual({ ...captured.row, request_replayed: true });

        const counts = await readIntakeCounts(client, pilot, captured.arguments[0]);
        expect(counts).toEqual({
          inbound_processed: true,
          jobs: 1,
          presentations: 1,
          proof_receipts: 1,
          proofs: 1,
        });

        const statusEvent = await createInboundEvent(client, actor.identityId, 'live-status');
        const status = await queryAsPlayerActions<StatusRow>(client, statusStatement, [
          statusEvent,
          captured.row.live_proof_id,
        ]);
        expect(status).toEqual([
          {
            amount_minor: null,
            currency_code: null,
            deposit_status: 'verification_pending',
            live_proof_id: captured.row.live_proof_id,
            provider_code: 'telebirr',
            submitted_at: captured.row.submitted_at,
          },
        ]);

        const foreignActor = await createTelegramActor(client, getOwnerAdminId());
        const foreignStatusEvent = await createInboundEvent(
          client,
          foreignActor.identityId,
          'foreign-live-status',
        );
        const foreignStatus = await queryAsPlayerActions<StatusRow>(client, statusStatement, [
          foreignStatusEvent,
          captured.row.live_proof_id,
        ]);
        expect(foreignStatus).toEqual([]);
      });
    });

    it('never treats a legacy review destination receipt as payment-proof authority', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const { actor, pilot } = await preparePilotAndActor(client, getOwnerAdminId());
        const destinationEvent = await createInboundEvent(
          client,
          actor.identityId,
          'review-destination',
        );
        const reviewRows = await queryAsPlayerActions<DestinationRow>(
          client,
          legacyDestinationStatement,
          [destinationEvent, pilot.playerIds[0]!, semanticHmac()],
        );
        expect(reviewRows).toHaveLength(1);

        const livePresentations = await client.query<{ readonly count: number }>(
          `select count(*)::integer as count
             from app.telegram_live_telebirr_payment_presentations
            where origin_inbound_event_id = $1::uuid`,
          [destinationEvent],
        );
        expect(livePresentations.rows).toEqual([{ count: 0 }]);

        const proofEvent = await createInboundEvent(client, actor.identityId, 'review-proof');
        await expectPlayerActionsFailure(
          client,
          captureStatement,
          [
            proofEvent,
            pilot.playerIds[0]!,
            referenceCiphertext(),
            referenceFingerprint(),
            '***CD34',
            semanticHmac(),
          ],
          /live Telegram TeleBirr proof boundary is unavailable/u,
        );

        const counts = await readIntakeCounts(client, pilot, proofEvent);
        expect(counts).toEqual({
          inbound_processed: false,
          jobs: 0,
          presentations: 0,
          proof_receipts: 0,
          proofs: 0,
        });
      });
    });

    it('rejects a reused TeleBirr reference across two separately authorized presentations', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const { actor, pilot } = await preparePilotAndActor(client, getOwnerAdminId());
        const playerId = pilot.playerIds[0]!;
        const duplicateFingerprint = referenceFingerprint('one-real-telebirr-reference');

        await prepareLiveDestination(client, actor, playerId);
        const first = await captureProof(client, actor, playerId, {
          fingerprint: duplicateFingerprint,
        });
        await prepareLiveDestination(client, actor, playerId);
        const secondEvent = await createInboundEvent(client, actor.identityId, 'duplicate-proof');
        await expectPlayerActionsFailure(
          client,
          captureStatement,
          [
            secondEvent,
            playerId,
            referenceCiphertext('same-reference-second-command'),
            duplicateFingerprint,
            '***EF56',
            semanticHmac(),
          ],
          /live Telegram TeleBirr proof boundary is unavailable/u,
        );

        const counts = await readIntakeCounts(client, pilot, secondEvent);
        expect(first.row.request_replayed).toBe(false);
        expect(counts).toEqual({
          inbound_processed: false,
          jobs: 1,
          presentations: 2,
          proof_receipts: 1,
          proofs: 1,
        });
      });
    });

    it('rejects new proof intake immediately after any trusted switch leaves the exact cohort', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const { actor, pilot } = await preparePilotAndActor(client, getOwnerAdminId());
        await prepareLiveDestination(client, actor, pilot.playerIds[0]!);
        await client.query(`
          update app.feature_switches
             set mode = 'disabled', settings = '{}'::jsonb
           where feature_key = 'telebirr_authoritative_verification'
        `);

        const proofEvent = await createInboundEvent(client, actor.identityId, 'disabled-proof');
        await expectPlayerActionsFailure(
          client,
          captureStatement,
          [
            proofEvent,
            pilot.playerIds[0]!,
            referenceCiphertext(),
            referenceFingerprint(),
            '***GH78',
            semanticHmac(),
          ],
          /live Telegram TeleBirr verification authority is unavailable/u,
        );

        const counts = await readIntakeCounts(client, pilot, proofEvent);
        expect(counts).toEqual({
          inbound_processed: false,
          jobs: 0,
          presentations: 1,
          proof_receipts: 0,
          proofs: 0,
        });
      });
    });

    it('keeps both lineage tables forced-RLS and exposes only the three public boundaries', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const tables = await client.query<{
          readonly policies: string;
          readonly relforcerowsecurity: boolean;
          readonly relname: string;
          readonly relrowsecurity: boolean;
          readonly runtime_table_access: boolean;
        }>(`
          select class.relname,
                 class.relrowsecurity,
                 class.relforcerowsecurity,
                 count(policy.*)::text as policies,
                 has_table_privilege(
                   'fetanagent_player_actions',
                   class.oid,
                   'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
                 ) as runtime_table_access
            from pg_catalog.pg_class class
            join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
            left join pg_catalog.pg_policy policy on policy.polrelid = class.oid
           where namespace.nspname = 'app'
             and class.relname in (
               'telegram_live_telebirr_payment_presentations',
               'telegram_live_telebirr_proof_receipts'
             )
           group by class.oid, class.relname, class.relrowsecurity, class.relforcerowsecurity
           order by class.relname
        `);
        expect(tables.rows).toEqual([
          {
            policies: '0',
            relforcerowsecurity: true,
            relname: 'telegram_live_telebirr_payment_presentations',
            relrowsecurity: true,
            runtime_table_access: false,
          },
          {
            policies: '0',
            relforcerowsecurity: true,
            relname: 'telegram_live_telebirr_proof_receipts',
            relrowsecurity: true,
            runtime_table_access: false,
          },
        ]);

        const functionAccess = await client.query<{
          readonly capture_allowed: boolean;
          readonly destination_allowed: boolean;
          readonly internal_guard_allowed: boolean;
          readonly status_allowed: boolean;
        }>(`
          select has_function_privilege(
                   'fetanagent_player_actions',
                   'app.prepare_telegram_live_telebirr_destination(uuid,text,text)',
                   'EXECUTE'
                 ) as destination_allowed,
                 has_function_privilege(
                   'fetanagent_player_actions',
                   'app.capture_telegram_live_telebirr_proof(uuid,text,text,text,text,text,smallint,smallint,text)',
                   'EXECUTE'
                 ) as capture_allowed,
                 has_function_privilege(
                   'fetanagent_player_actions',
                   'app.get_telegram_customer_live_telebirr_proof(uuid,uuid)',
                   'EXECUTE'
                 ) as status_allowed,
                 has_function_privilege(
                   'fetanagent_player_actions',
                   'app.enforce_telegram_live_telebirr_proof_receipt_insert()',
                   'EXECUTE'
                 ) as internal_guard_allowed
        `);
        expect(functionAccess.rows).toEqual([
          {
            capture_allowed: true,
            destination_allowed: true,
            internal_guard_allowed: false,
            status_allowed: true,
          },
        ]);
      });
    });
  });
}
