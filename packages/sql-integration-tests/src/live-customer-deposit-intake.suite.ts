import { describe, expect, it } from 'vitest';
import type { Client, QueryResultRow } from 'pg';

type Fixture = {
  readonly authUserId: string;
  readonly customerId: string;
  readonly playerAccountId: string;
  readonly playerId: string;
  readonly telegramIdentityId: string;
};

type OpenRow = {
  readonly currency_code: string;
  readonly deposit_intent_id: string;
  readonly deposit_status: string;
  readonly expected_amount_minor: string;
  readonly origin_inbound_event_already_consumed?: boolean;
  readonly payment_deadline_at: Date;
  readonly provider_code: string;
  readonly receiver_account_holder_name: string;
  readonly receiver_account_masked: string;
  readonly receiver_customer_instruction: string;
  readonly request_key_already_used?: boolean;
};

type CaptureRow = {
  readonly deposit_status: string;
  readonly origin_inbound_event_already_consumed?: boolean;
  readonly request_key_already_used?: boolean;
  readonly result_deposit_intent_id: string;
  readonly submission_status: string;
  readonly submitted_at: Date;
};

type OpenReplaySnapshot = {
  readonly audit_events: number;
  readonly intent_status: string;
  readonly intent_updated_at: Date;
  readonly intents: number;
  readonly jobs: number;
  readonly receipts: number;
  readonly submissions: number;
};

const payloadHmac = (hexCharacter: string): string => `hmac-sha256-v1:${hexCharacter.repeat(64)}`;

const referenceNonceSegment = 'n'.repeat(16);
const referenceTagSegment = 't'.repeat(22);
const validReferenceCiphertext = `v1.${referenceNonceSegment}.${referenceTagSegment}.seven77`;
const shortReferenceCiphertext = `v1.${referenceNonceSegment}.${referenceTagSegment}.short6`;
const invalidNonceReferenceCiphertext = `v1.${'n'.repeat(15)}.${referenceTagSegment}.seven77`;
const invalidTagReferenceCiphertext = `v1.${referenceNonceSegment}.${'t'.repeat(21)}.seven77`;
const unsupportedReferenceCiphertext = `v2.${referenceNonceSegment}.${referenceTagSegment}.seven77`;
const replayReferenceCiphertext = `v1.${'r'.repeat(16)}.${'s'.repeat(22)}.payload2`;
const anotherReplayReferenceCiphertext = `v1.${'u'.repeat(16)}.${'v'.repeat(22)}.payload3`;

async function queryAsRole<T extends QueryResultRow>(
  client: Client,
  role: 'fetanagent_customer_web' | 'fetanagent_player_actions',
  query: string,
  values: readonly (number | string | null)[] = [],
): Promise<readonly T[]> {
  // The private-pilot migration deliberately revokes these amount-first RPCs from both runtime
  // groups. Retain their historical behavior regressions under the disposable migration owner;
  // the pilot suite independently pins the production runtime denials.
  if (
    /app\.(?:open_telegram_live_deposit_intent|capture_telegram_live_deposit_reference|open_customer_web_deposit_intent|capture_customer_web_deposit_reference)\s*\(/u.test(
      query,
    )
  ) {
    const result = await client.query<T>(query, [...values]);
    return result.rows;
  }

  await client.query(`set local role ${role}`);
  const result = await client.query<T>(query, [...values]);
  await client.query('reset role');
  return result.rows;
}

async function expectSqlFailure(
  client: Client,
  operation: () => Promise<unknown>,
  expectedMessage: RegExp,
): Promise<void> {
  await client.query('savepoint expected_live_deposit_failure');
  try {
    await expect(operation()).rejects.toThrow(expectedMessage);
  } finally {
    await client.query('rollback to savepoint expected_live_deposit_failure');
    await client.query('release savepoint expected_live_deposit_failure');
    await client.query('reset role');
  }
}

async function withRollback(client: Client, body: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await body();
  } finally {
    await client.query('rollback');
  }
}

async function readOpenReplaySnapshot(
  client: Client,
  depositIntentId: string,
  customerId: string,
  channel: 'customer_web' | 'telegram',
): Promise<OpenReplaySnapshot> {
  const receiptCount =
    channel === 'telegram'
      ? `(select count(*)::integer
            from app.telegram_live_deposit_request_receipts receipt
           where receipt.customer_id = $2::uuid)`
      : `(select count(*)::integer
            from app.customer_web_deposit_request_receipts receipt
            join app.customer_auth_identities actor
              on actor.customer_identity_id = receipt.customer_auth_identity_id
           where actor.customer_id = $2::uuid)`;
  const result = await client.query<OpenReplaySnapshot>(
    `select intent.status::text as intent_status,
            intent.updated_at as intent_updated_at,
            (select count(*)::integer
               from app.deposit_intents customer_intent
              where customer_intent.customer_id = $2::uuid) as intents,
            (select count(*)::integer
               from app.deposit_submissions submission
               join app.deposit_intents submission_intent
                 on submission_intent.id = submission.deposit_intent_id
              where submission_intent.customer_id = $2::uuid) as submissions,
            (select count(*)::integer
               from app.deposit_jobs job
               join app.deposit_intents job_intent
                 on job_intent.id = job.deposit_intent_id
              where job_intent.customer_id = $2::uuid) as jobs,
            ${receiptCount} as receipts,
            (select count(*)::integer
               from app.audit_events audit_event
              where audit_event.actor_customer_id = $2::uuid
                and audit_event.action = 'deposit.live_intent_opened') as audit_events
       from app.deposit_intents intent
      where intent.id = $1::uuid`,
    [depositIntentId, customerId],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

async function createFixture(client: Client, seed: string, telegramBase: number): Promise<Fixture> {
  const authUserId = `40000000-0000-4000-8000-${seed.padStart(12, '0')}`;
  const playerId = `LIVE${seed}`;

  await client.query(`set local session_replication_role = replica`);
  const customer = await client.query<{ readonly id: string }>(
    `insert into app.customers (status) values ('active') returning id`,
  );
  const customerId = customer.rows[0]!.id;

  const telegramIdentity = await client.query<{ readonly id: string }>(
    `insert into app.customer_identities (
         customer_id, identity_kind, external_subject, status
       ) values ($1::uuid, 'telegram', $2::text, 'active')
       returning id`,
    [customerId, telegramBase.toString()],
  );
  const telegramIdentityId = telegramIdentity.rows[0]!.id;

  await client.query(
    `insert into app.telegram_identities (
         customer_identity_id, telegram_user_id, private_chat_id, preferred_locale
       ) values ($1::uuid, $2::bigint, $2::bigint, 'en')`,
    [telegramIdentityId, telegramBase],
  );
  await client.query(
    `insert into app.bot_conversations (telegram_identity_id)
       values ($1::uuid)`,
    [telegramIdentityId],
  );

  const admissionEvent = await client.query<{ readonly id: string }>(
    `insert into app.inbound_events (
         channel, external_event_id, customer_identity_id, payload_digest
       ) values ('telegram', $1::text, $2::uuid, $3::text)
       returning id`,
    [`update:${telegramBase}`, telegramIdentityId, payloadHmac('1')],
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
      `sha256-v1:${seed.slice(-1).repeat(64)}`,
      issuingAdminId,
      telegramBase,
      customerId,
      telegramIdentityId,
      admissionEvent.rows[0]!.id,
    ],
  );

  await client.query(`insert into auth.users (id, email) values ($1::uuid, $2::text)`, [
    authUserId,
    `${seed}@live-deposit.invalid`,
  ]);
  const webIdentity = await client.query<{ readonly id: string }>(
    `insert into app.customer_identities (
         customer_id, identity_kind, external_subject, status
       ) values ($1::uuid, 'supabase_auth', $2::text, 'active')
       returning id`,
    [customerId, authUserId],
  );
  await client.query(
    `insert into app.customer_auth_identities (
         customer_identity_id, customer_id, auth_user_id
       ) values ($1::uuid, $2::uuid, $3::uuid)`,
    [webIdentity.rows[0]!.id, customerId, authUserId],
  );

  const player = await client.query<{ readonly id: string }>(
    `insert into app.customer_platform_players (
         customer_id, platform_id, player_id, status, validation_status,
         last_validated_at, last_validation_reason_code
       )
       select $1::uuid, platform.id, $2::text, 'active', 'valid',
              clock_timestamp(), 'live_sql_fixture'
         from app.platforms platform
        where platform.code = 'kemerbet'
       returning id`,
    [customerId, playerId],
  );
  const playerAccountId = player.rows[0]!.id;
  await client.query(
    `insert into app.player_deposit_eligibility_decisions (
         player_account_id, decision_version, decision, reason_code, actor_kind,
         player_account_updated_at_snapshot, decided_at, created_at
       )
       select player_account.id, 1, 'eligible', 'financial_eligibility_approved', 'system',
              player_account.updated_at, statement_timestamp(), statement_timestamp()
         from app.customer_platform_players player_account
        where player_account.id = $1::uuid`,
    [playerAccountId],
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
        select payment_provider.id,
               coalesce((select max(existing.version) + 1
                   from app.receiver_accounts existing
                  where existing.provider_id = payment_provider.id), 1),
               'FetanAgent Live SQL', 'receiver-ciphertext',
               'receiver-verification-ciphertext', '****1234',
               jsonb_build_object('customer_message', 'Send CBE Birr to the shown account.')
          from app.payment_providers payment_provider
         where payment_provider.code = 'cbe_birr'
      `);
  }

  await client.query(`set local session_replication_role = origin`);
  return { authUserId, customerId, playerAccountId, playerId, telegramIdentityId };
}

async function enableLiveIntake(client: Client): Promise<void> {
  await client.query(`
    update app.feature_switches
       set mode = 'live'
     where feature_key in (
       'payment_verification',
       'deposit_execution',
       'cbe_birr_authoritative_verification'
     )
  `);
}

async function createInboundEvent(
  client: Client,
  identityId: string,
  updateId: number,
  hmacCharacter: string,
): Promise<string> {
  const event = await client.query<{ readonly id: string }>(
    `insert into app.inbound_events (
       channel, external_event_id, customer_identity_id, payload_digest
     ) values ('telegram', $1::text, $2::uuid, $3::text)
     returning id`,
    [`update:${updateId}`, identityId, payloadHmac(hmacCharacter)],
  );
  return event.rows[0]!.id;
}

export function registerLiveCustomerDepositIntakeSqlTests(getClient: () => Client): void {
  describe('private live customer deposit intake', () => {
    it('pins the disabled switch, forced-RLS receipt ledgers, exact results, and direct ACLs', async () => {
      const client = getClient();
      const switchRow = await client.query<{ readonly mode: string }>(`
        select mode::text
          from app.feature_switches
         where feature_key = 'cbe_birr_authoritative_verification'
      `);
      expect(switchRow.rows).toEqual([{ mode: 'disabled' }]);

      const relations = await client.query<{
        readonly policies: number;
        readonly relforcerowsecurity: boolean;
        readonly relname: string;
        readonly relrowsecurity: boolean;
        readonly non_owner_table_acl_entries: number;
      }>(`
        select relation.relname,
               relation.relrowsecurity,
               relation.relforcerowsecurity,
               (select count(*)::integer
                  from pg_policy policy
                 where policy.polrelid = relation.oid) as policies,
               (select count(*)::integer
                  from aclexplode(coalesce(
                    relation.relacl,
                    acldefault('r', relation.relowner)
                  )) acl
                 where acl.grantee <> relation.relowner) as non_owner_table_acl_entries
          from pg_class relation
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'app'
           and relation.relname in (
             'telegram_live_deposit_request_receipts',
             'customer_web_deposit_request_receipts'
           )
         order by relation.relname
      `);
      expect(relations.rows).toEqual([
        {
          non_owner_table_acl_entries: 0,
          policies: 0,
          relforcerowsecurity: true,
          relname: 'customer_web_deposit_request_receipts',
          relrowsecurity: true,
        },
        {
          non_owner_table_acl_entries: 0,
          policies: 0,
          relforcerowsecurity: true,
          relname: 'telegram_live_deposit_request_receipts',
          relrowsecurity: true,
        },
      ]);

      const functions = await client.query<{
        readonly direct_grantees: string[];
        readonly function_result: string;
        readonly proname: string;
        readonly prosecdef: boolean;
        readonly search_path: string[];
      }>(`
        select procedure.proname,
               procedure.prosecdef,
               procedure.proconfig as search_path,
               pg_get_function_result(procedure.oid) as function_result,
               coalesce((
                 select array_agg(
                          coalesce(role.rolname::text, 'PUBLIC')
                          order by coalesce(role.rolname::text, 'PUBLIC')
                        )::text[]
                   from aclexplode(coalesce(
                     procedure.proacl,
                     acldefault('f', procedure.proowner)
                   )) acl
                   left join pg_roles role on role.oid = acl.grantee
                  where acl.privilege_type = 'EXECUTE'
                    and acl.grantee <> procedure.proowner
               ), array[]::text[]) as direct_grantees
          from pg_proc procedure
          join pg_namespace namespace on namespace.oid = procedure.pronamespace
         where namespace.nspname = 'app'
           and procedure.proname in (
             'open_telegram_live_deposit_intent',
             'capture_telegram_live_deposit_reference',
             'get_telegram_customer_deposit',
             'open_customer_web_deposit_intent',
             'capture_customer_web_deposit_reference',
             'list_customer_web_deposits'
           )
         order by procedure.proname
      `);
      expect(functions.rows).toHaveLength(6);
      for (const row of functions.rows) {
        expect(row.prosecdef).toBe(true);
        expect(row.search_path).toEqual(['search_path=pg_catalog, app, pg_temp']);
        expect(row.direct_grantees).toEqual(
          row.proname.startsWith('open_') || row.proname.startsWith('capture_')
            ? []
            : [
                row.proname.includes('customer_web')
                  ? 'fetanagent_customer_web'
                  : 'fetanagent_player_actions',
              ],
        );
      }
      expect(functions.rows.map((row) => row.function_result)).toEqual(
        expect.arrayContaining([
          'TABLE(deposit_intent_id uuid, provider_code text, receiver_account_holder_name text, receiver_account_masked text, receiver_customer_instruction text, expected_amount_minor bigint, currency_code text, payment_deadline_at timestamp with time zone, deposit_status text, origin_inbound_event_already_consumed boolean)',
          'TABLE(deposit_intent_id uuid, provider_code text, receiver_account_holder_name text, receiver_account_masked text, receiver_customer_instruction text, expected_amount_minor bigint, currency_code text, payment_deadline_at timestamp with time zone, deposit_status text, request_key_already_used boolean)',
          'TABLE(result_deposit_intent_id uuid, submission_status text, deposit_status text, submitted_at timestamp with time zone, origin_inbound_event_already_consumed boolean)',
          'TABLE(result_deposit_intent_id uuid, submission_status text, deposit_status text, submitted_at timestamp with time zone, request_key_already_used boolean)',
          'TABLE(deposit_intent_id uuid, expected_amount_minor bigint, currency_code text, deposit_status text, created_at timestamp with time zone, updated_at timestamp with time zone)',
        ]),
      );

      const helpers = await client.query<{
        readonly proname: string;
        readonly prosecdef: boolean;
        readonly search_path: string[];
      }>(`
        select procedure.proname, procedure.prosecdef,
               procedure.proconfig as search_path
          from pg_proc procedure
          join pg_namespace namespace on namespace.oid = procedure.pronamespace
         where namespace.nspname = 'app'
           and procedure.proname in (
             'reject_live_deposit_request_receipt_mutation',
             'enforce_telegram_live_deposit_receipt_binding',
             'block_inbound_consumption_after_live_deposit_receipt',
             'require_live_deposit_request_receipt_result',
             'require_live_customer_deposit_switches',
             'resolve_current_live_customer_deposit_boundary'
           )
         order by procedure.proname
      `);
      expect(helpers.rows).toHaveLength(6);
      expect(helpers.rows.every((row) => row.prosecdef === false)).toBe(true);
      expect(
        helpers.rows.every(
          (row) => row.search_path.join(',') === 'search_path=pg_catalog, app, pg_temp',
        ),
      ).toBe(true);
    });

    it('keeps new writes default-off with no partial financial or receipt state', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '101', 9_910_000_101);
        const inboundEventId = await createInboundEvent(
          client,
          fixture.telegramIdentityId,
          9_910_000_102,
          '2',
        );

        await expectSqlFailure(
          client,
          () =>
            queryAsRole(
              client,
              'fetanagent_player_actions',
              `select * from app.open_telegram_live_deposit_intent(
                 $1::uuid, $2::text, 2500::bigint, $3::text
               )`,
              [inboundEventId, fixture.playerId, payloadHmac('3')],
            ),
          /not enabled/i,
        );

        const snapshot = await client.query<{
          readonly intents: number;
          readonly jobs: number;
          readonly receipts: number;
          readonly submissions: number;
        }>(
          `
          select
            (select count(*)::integer from app.deposit_intents
              where customer_id = $1::uuid) as intents,
            (select count(*)::integer from app.deposit_submissions submission
              join app.deposit_intents intent on intent.id = submission.deposit_intent_id
             where intent.customer_id = $1::uuid) as submissions,
            (select count(*)::integer from app.deposit_jobs job
              join app.deposit_intents intent on intent.id = job.deposit_intent_id
             where intent.customer_id = $1::uuid) as jobs,
            (select count(*)::integer from app.telegram_live_deposit_request_receipts
              where customer_id = $1::uuid) as receipts
        `,
          [fixture.customerId],
        );
        expect(snapshot.rows).toEqual([{ intents: 0, jobs: 0, receipts: 0, submissions: 0 }]);
      });
    });

    it('fails closed before opening when the active receiver is not safely masked', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '404', 9_940_000_401);
        await enableLiveIntake(client);

        await client.query(`set local session_replication_role = replica`);
        await client.query(`
          update app.receiver_accounts receiver_account
             set account_reference_masked = '1234567890'
            from app.payment_providers payment_provider
           where payment_provider.id = receiver_account.provider_id
             and payment_provider.code = 'cbe_birr'
             and receiver_account.status = 'active'
        `);
        await client.query(`set local session_replication_role = origin`);

        await expectSqlFailure(
          client,
          () =>
            queryAsRole(
              client,
              'fetanagent_customer_web',
              `select * from app.open_customer_web_deposit_intent(
                 $1::uuid, '44000000-0000-4000-8000-000000000404'::uuid,
                 $2::text, 2500::bigint
               )`,
              [fixture.authUserId, fixture.playerId],
            ),
          /receiver is unavailable/i,
        );

        const writes = await client.query<{
          readonly intents: number;
          readonly receipts: number;
        }>(
          `select
             (select count(*)::integer from app.deposit_intents
               where customer_id = $1::uuid) as intents,
             (select count(*)::integer
                from app.customer_web_deposit_request_receipts receipt
                join app.customer_auth_identities actor
                  on actor.customer_identity_id = receipt.customer_auth_identity_id
               where actor.customer_id = $1::uuid) as receipts`,
          [fixture.customerId],
        );
        expect(writes.rows).toEqual([{ intents: 0, receipts: 0 }]);
      });
    });

    it('opens and captures Telegram exactly once, queues no shadow job, and reads with switches off', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '202', 9_920_000_201);
        await enableLiveIntake(client);
        const openEventId = await createInboundEvent(
          client,
          fixture.telegramIdentityId,
          9_920_000_202,
          '4',
        );
        const openHmac = payloadHmac('5');
        const opened = await queryAsRole<OpenRow>(
          client,
          'fetanagent_player_actions',
          `select * from app.open_telegram_live_deposit_intent(
             $1::uuid, $2::text, 2500::bigint, $3::text
           )`,
          [openEventId, fixture.playerId, openHmac],
        );
        expect(opened).toEqual([
          {
            currency_code: 'ETB',
            deposit_intent_id: expect.any(String),
            deposit_status: 'intake_received',
            expected_amount_minor: '2500',
            origin_inbound_event_already_consumed: false,
            payment_deadline_at: expect.any(Date),
            provider_code: 'cbe_birr',
            receiver_account_holder_name: expect.any(String),
            receiver_account_masked: expect.any(String),
            receiver_customer_instruction: expect.any(String),
          },
        ]);
        const depositIntentId = opened[0]!.deposit_intent_id;

        const replay = await queryAsRole<OpenRow>(
          client,
          'fetanagent_player_actions',
          `select * from app.open_telegram_live_deposit_intent(
             $1::uuid, $2::text, 2500::bigint, $3::text
           )`,
          [openEventId, fixture.playerId, openHmac],
        );
        expect(replay[0]).toEqual({
          ...opened[0],
          origin_inbound_event_already_consumed: true,
        });

        const referenceFingerprint = 'a'.repeat(64);
        const captureHmac = payloadHmac('7');
        const shortCaptureEventId = await createInboundEvent(
          client,
          fixture.telegramIdentityId,
          9_920_000_207,
          'b',
        );
        const beforeShortCiphertext = await readOpenReplaySnapshot(
          client,
          depositIntentId,
          fixture.customerId,
          'telegram',
        );
        await expectSqlFailure(
          client,
          () =>
            queryAsRole(
              client,
              'fetanagent_player_actions',
              `select * from app.capture_telegram_live_deposit_reference(
                 $1::uuid, $2::uuid, $3::text,
                 $4::text, '***AB12'::text, 1::smallint, $5::text
               )`,
              [
                shortCaptureEventId,
                depositIntentId,
                shortReferenceCiphertext,
                referenceFingerprint,
                captureHmac,
              ],
            ),
          /protected Telegram live deposit reference is invalid/i,
        );
        expect(
          await readOpenReplaySnapshot(client, depositIntentId, fixture.customerId, 'telegram'),
        ).toEqual(beforeShortCiphertext);

        const invalidNonceEventId = await createInboundEvent(
          client,
          fixture.telegramIdentityId,
          9_920_000_209,
          'd',
        );
        const invalidTagEventId = await createInboundEvent(
          client,
          fixture.telegramIdentityId,
          9_920_000_210,
          'e',
        );
        const beforeMalformedFrame = await readOpenReplaySnapshot(
          client,
          depositIntentId,
          fixture.customerId,
          'telegram',
        );
        for (const [eventId, referenceCiphertext] of [
          [invalidNonceEventId, invalidNonceReferenceCiphertext],
          [invalidTagEventId, invalidTagReferenceCiphertext],
        ] as const) {
          await expectSqlFailure(
            client,
            () =>
              queryAsRole(
                client,
                'fetanagent_player_actions',
                `select * from app.capture_telegram_live_deposit_reference(
                   $1::uuid, $2::uuid, $3::text,
                   $4::text, '***AB12'::text, 1::smallint, $5::text
                 )`,
                [eventId, depositIntentId, referenceCiphertext, referenceFingerprint, captureHmac],
              ),
            /protected Telegram live deposit reference is invalid/i,
          );
        }
        expect(
          await readOpenReplaySnapshot(client, depositIntentId, fixture.customerId, 'telegram'),
        ).toEqual(beforeMalformedFrame);

        const unsupportedVersionEventId = await createInboundEvent(
          client,
          fixture.telegramIdentityId,
          9_920_000_208,
          'c',
        );
        const beforeUnsupportedVersion = await readOpenReplaySnapshot(
          client,
          depositIntentId,
          fixture.customerId,
          'telegram',
        );
        await expectSqlFailure(
          client,
          () =>
            queryAsRole(
              client,
              'fetanagent_player_actions',
              `select * from app.capture_telegram_live_deposit_reference(
                 $1::uuid, $2::uuid, $3::text,
                 $4::text, '***AB12'::text, 2::smallint, $5::text
               )`,
              [
                unsupportedVersionEventId,
                depositIntentId,
                unsupportedReferenceCiphertext,
                referenceFingerprint,
                captureHmac,
              ],
            ),
          /protected Telegram live deposit reference is invalid/i,
        );
        expect(
          await readOpenReplaySnapshot(client, depositIntentId, fixture.customerId, 'telegram'),
        ).toEqual(beforeUnsupportedVersion);

        const captureEventId = await createInboundEvent(
          client,
          fixture.telegramIdentityId,
          9_920_000_203,
          '6',
        );
        const captured = await queryAsRole<CaptureRow>(
          client,
          'fetanagent_player_actions',
          `select * from app.capture_telegram_live_deposit_reference(
             $1::uuid, $2::uuid, $3::text,
             $4::text, '***AB12'::text, 1::smallint, $5::text
           )`,
          [
            captureEventId,
            depositIntentId,
            validReferenceCiphertext,
            referenceFingerprint,
            captureHmac,
          ],
        );
        expect(captured).toEqual([
          {
            deposit_status: 'verification_pending',
            origin_inbound_event_already_consumed: false,
            result_deposit_intent_id: depositIntentId,
            submission_status: 'verification_enqueued',
            submitted_at: expect.any(Date),
          },
        ]);

        const internal = await client.query<{
          readonly jobs: number;
          readonly shadow_jobs: number;
          readonly status: string;
          readonly submission_status: string;
        }>(
          `
          select intent.status::text,
                 submission.status::text as submission_status,
                 (select count(*)::integer from app.deposit_jobs job
                   where job.deposit_intent_id = intent.id
                     and job.deposit_submission_id = submission.id
                     and job.job_kind = 'verify_deposit'
                     and job.job_key =
                       'cbe-birr-authoritative-verification:v1:' || submission.id::text) as jobs,
                 (select count(*)::integer
                    from app.cbe_birr_shadow_verification_jobs shadow_job
                   where shadow_job.deposit_intent_id = intent.id) as shadow_jobs
            from app.deposit_intents intent
            join app.deposit_submissions submission
              on submission.deposit_intent_id = intent.id
           where intent.id = $1::uuid
        `,
          [depositIntentId],
        );
        expect(internal.rows).toEqual([
          {
            jobs: 1,
            shadow_jobs: 0,
            status: 'verification_pending',
            submission_status: 'verification_enqueued',
          },
        ]);

        await client.query(`
          update app.feature_switches set mode = 'disabled'
           where feature_key in (
             'payment_verification', 'deposit_execution',
             'cbe_birr_authoritative_verification'
            )
        `);
        const beforeOpenReplayAfterCapture = await readOpenReplaySnapshot(
          client,
          depositIntentId,
          fixture.customerId,
          'telegram',
        );
        await expectSqlFailure(
          client,
          () =>
            queryAsRole(
              client,
              'fetanagent_player_actions',
              `select * from app.open_telegram_live_deposit_intent(
                 $1::uuid, $2::text, 2500::bigint, $3::text
               )`,
              [openEventId, fixture.playerId, openHmac],
            ),
          /replayed Telegram live deposit request requires remediation/i,
        );
        expect(
          await readOpenReplaySnapshot(client, depositIntentId, fixture.customerId, 'telegram'),
        ).toEqual(beforeOpenReplayAfterCapture);

        const captureReplay = await queryAsRole<CaptureRow>(
          client,
          'fetanagent_player_actions',
          `select * from app.capture_telegram_live_deposit_reference(
             $1::uuid, $2::uuid, $3::text,
             $4::text, '***AB12'::text, 1::smallint, $5::text
           )`,
          [
            captureEventId,
            depositIntentId,
            replayReferenceCiphertext,
            referenceFingerprint,
            captureHmac,
          ],
        );
        expect(captureReplay).toEqual([
          { ...captured[0]!, origin_inbound_event_already_consumed: true },
        ]);

        const beforeMismatch = await client.query<{
          readonly jobs: number;
          readonly submissions: number;
        }>(
          `select
             (select count(*)::integer from app.deposit_jobs
               where deposit_intent_id = $1::uuid) as jobs,
             (select count(*)::integer from app.deposit_submissions
               where deposit_intent_id = $1::uuid) as submissions`,
          [depositIntentId],
        );
        await expectSqlFailure(
          client,
          () =>
            queryAsRole(
              client,
              'fetanagent_player_actions',
              `select * from app.capture_telegram_live_deposit_reference(
                 $1::uuid, $2::uuid, $3::text,
                 $4::text, '***AB12'::text, 1::smallint, $5::text
               )`,
              [
                captureEventId,
                depositIntentId,
                validReferenceCiphertext,
                referenceFingerprint,
                payloadHmac('8'),
              ],
            ),
          /does not match its receipt/i,
        );
        const afterMismatch = await client.query<{
          readonly jobs: number;
          readonly submissions: number;
        }>(
          `select
             (select count(*)::integer from app.deposit_jobs
               where deposit_intent_id = $1::uuid) as jobs,
             (select count(*)::integer from app.deposit_submissions
               where deposit_intent_id = $1::uuid) as submissions`,
          [depositIntentId],
        );
        expect(afterMismatch.rows).toEqual(beforeMismatch.rows);

        const statusEventId = await createInboundEvent(
          client,
          fixture.telegramIdentityId,
          9_920_000_204,
          '9',
        );
        const status = await queryAsRole(
          client,
          'fetanagent_player_actions',
          `select * from app.get_telegram_customer_deposit($1::uuid, $2::uuid)`,
          [statusEventId, depositIntentId],
        );
        expect(status).toEqual([
          {
            created_at: expect.any(Date),
            currency_code: 'ETB',
            deposit_intent_id: depositIntentId,
            deposit_status: 'verification_pending',
            expected_amount_minor: '2500',
            updated_at: expect.any(Date),
          },
        ]);

        const otherFixture = await createFixture(client, '203', 9_920_000_205);
        const otherStatusEventId = await createInboundEvent(
          client,
          otherFixture.telegramIdentityId,
          9_920_000_206,
          'a',
        );
        const otherActorStatus = await queryAsRole(
          client,
          'fetanagent_player_actions',
          `select * from app.get_telegram_customer_deposit($1::uuid, $2::uuid)`,
          [otherStatusEventId, depositIntentId],
        );
        expect(otherActorStatus).toEqual([]);
      });
    });

    it('uses UUIDv4 web receipts and exposes only owned switch-independent status rows', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const fixture = await createFixture(client, '303', 9_930_000_301);
        await enableLiveIntake(client);
        const openRequestKey = '43000000-0000-4000-8000-000000000301';
        const captureRequestKey = '43000000-0000-4000-8000-000000000302';
        const shortCaptureRequestKey = '43000000-0000-4000-8000-000000000303';
        const unsupportedVersionRequestKey = '43000000-0000-4000-8000-000000000304';
        const invalidNonceRequestKey = '43000000-0000-4000-8000-000000000305';
        const invalidTagRequestKey = '43000000-0000-4000-8000-000000000306';

        const opened = await queryAsRole<OpenRow>(
          client,
          'fetanagent_customer_web',
          `select * from app.open_customer_web_deposit_intent(
             $1::uuid, $2::uuid, $3::text, 2500::bigint
           )`,
          [fixture.authUserId, openRequestKey, fixture.playerId],
        );
        expect(opened[0]).toMatchObject({
          currency_code: 'ETB',
          deposit_status: 'intake_received',
          expected_amount_minor: '2500',
          provider_code: 'cbe_birr',
          request_key_already_used: false,
        });
        const depositIntentId = opened[0]!.deposit_intent_id;

        await expectSqlFailure(
          client,
          () =>
            queryAsRole(
              client,
              'fetanagent_customer_web',
              `select * from app.open_customer_web_deposit_intent(
                 $1::uuid, $2::uuid, $3::text, 2600::bigint
               )`,
              [fixture.authUserId, openRequestKey, fixture.playerId],
            ),
          /conflicts with its receipt/i,
        );

        const referenceFingerprint = 'b'.repeat(64);
        const beforeShortCiphertext = await readOpenReplaySnapshot(
          client,
          depositIntentId,
          fixture.customerId,
          'customer_web',
        );
        await expectSqlFailure(
          client,
          () =>
            queryAsRole(
              client,
              'fetanagent_customer_web',
              `select * from app.capture_customer_web_deposit_reference(
                 $1::uuid, $2::uuid, $3::uuid, $4::text,
                 $5::text, '***CD34'::text, 1::smallint
               )`,
              [
                fixture.authUserId,
                shortCaptureRequestKey,
                depositIntentId,
                shortReferenceCiphertext,
                referenceFingerprint,
              ],
            ),
          /protected customer-web live deposit reference is invalid/i,
        );
        expect(
          await readOpenReplaySnapshot(client, depositIntentId, fixture.customerId, 'customer_web'),
        ).toEqual(beforeShortCiphertext);

        const beforeMalformedFrame = await readOpenReplaySnapshot(
          client,
          depositIntentId,
          fixture.customerId,
          'customer_web',
        );
        for (const [requestKey, referenceCiphertext] of [
          [invalidNonceRequestKey, invalidNonceReferenceCiphertext],
          [invalidTagRequestKey, invalidTagReferenceCiphertext],
        ] as const) {
          await expectSqlFailure(
            client,
            () =>
              queryAsRole(
                client,
                'fetanagent_customer_web',
                `select * from app.capture_customer_web_deposit_reference(
                   $1::uuid, $2::uuid, $3::uuid, $4::text,
                   $5::text, '***CD34'::text, 1::smallint
                 )`,
                [
                  fixture.authUserId,
                  requestKey,
                  depositIntentId,
                  referenceCiphertext,
                  referenceFingerprint,
                ],
              ),
            /protected customer-web live deposit reference is invalid/i,
          );
        }
        expect(
          await readOpenReplaySnapshot(client, depositIntentId, fixture.customerId, 'customer_web'),
        ).toEqual(beforeMalformedFrame);

        const beforeUnsupportedVersion = await readOpenReplaySnapshot(
          client,
          depositIntentId,
          fixture.customerId,
          'customer_web',
        );
        await expectSqlFailure(
          client,
          () =>
            queryAsRole(
              client,
              'fetanagent_customer_web',
              `select * from app.capture_customer_web_deposit_reference(
                 $1::uuid, $2::uuid, $3::uuid, $4::text,
                 $5::text, '***CD34'::text, 2::smallint
               )`,
              [
                fixture.authUserId,
                unsupportedVersionRequestKey,
                depositIntentId,
                unsupportedReferenceCiphertext,
                referenceFingerprint,
              ],
            ),
          /protected customer-web live deposit reference is invalid/i,
        );
        expect(
          await readOpenReplaySnapshot(client, depositIntentId, fixture.customerId, 'customer_web'),
        ).toEqual(beforeUnsupportedVersion);

        const captured = await queryAsRole<CaptureRow>(
          client,
          'fetanagent_customer_web',
          `select * from app.capture_customer_web_deposit_reference(
             $1::uuid, $2::uuid, $3::uuid, $4::text,
             $5::text, '***CD34'::text, 1::smallint
           )`,
          [
            fixture.authUserId,
            captureRequestKey,
            depositIntentId,
            validReferenceCiphertext,
            referenceFingerprint,
          ],
        );
        expect(captured).toEqual([
          {
            deposit_status: 'verification_pending',
            request_key_already_used: false,
            result_deposit_intent_id: depositIntentId,
            submission_status: 'verification_enqueued',
            submitted_at: expect.any(Date),
          },
        ]);

        await client.query(`
          update app.feature_switches set mode = 'disabled'
           where feature_key in (
             'payment_verification', 'deposit_execution',
             'cbe_birr_authoritative_verification'
            )
        `);
        const beforeOpenReplayAfterCapture = await readOpenReplaySnapshot(
          client,
          depositIntentId,
          fixture.customerId,
          'customer_web',
        );
        await expectSqlFailure(
          client,
          () =>
            queryAsRole(
              client,
              'fetanagent_customer_web',
              `select * from app.open_customer_web_deposit_intent(
                 $1::uuid, $2::uuid, $3::text, 2500::bigint
               )`,
              [fixture.authUserId, openRequestKey, fixture.playerId],
            ),
          /replayed customer-web live deposit request requires remediation/i,
        );
        expect(
          await readOpenReplaySnapshot(client, depositIntentId, fixture.customerId, 'customer_web'),
        ).toEqual(beforeOpenReplayAfterCapture);

        const replay = await queryAsRole<CaptureRow>(
          client,
          'fetanagent_customer_web',
          `select * from app.capture_customer_web_deposit_reference(
             $1::uuid, $2::uuid, $3::uuid, $4::text,
             $5::text, '***CD34'::text, 1::smallint
           )`,
          [
            fixture.authUserId,
            captureRequestKey,
            depositIntentId,
            replayReferenceCiphertext,
            referenceFingerprint,
          ],
        );
        expect(replay).toEqual([{ ...captured[0]!, request_key_already_used: true }]);

        const list = await queryAsRole(
          client,
          'fetanagent_customer_web',
          `select * from app.list_customer_web_deposits($1::uuid, 20::integer)`,
          [fixture.authUserId],
        );
        expect(list).toEqual([
          {
            created_at: expect.any(Date),
            currency_code: 'ETB',
            deposit_intent_id: depositIntentId,
            deposit_status: 'verification_pending',
            expected_amount_minor: '2500',
            updated_at: expect.any(Date),
          },
        ]);

        const otherFixture = await createFixture(client, '304', 9_930_000_304);
        const otherActorList = await queryAsRole(
          client,
          'fetanagent_customer_web',
          `select * from app.list_customer_web_deposits($1::uuid, 20::integer)`,
          [otherFixture.authUserId],
        );
        expect(otherActorList).toEqual([]);

        await client.query(`update app.customers set status = 'inactive' where id = $1::uuid`, [
          fixture.customerId,
        ]);
        const inactiveActorReplay = await queryAsRole<CaptureRow>(
          client,
          'fetanagent_customer_web',
          `select * from app.capture_customer_web_deposit_reference(
             $1::uuid, $2::uuid, $3::uuid, $4::text,
             $5::text, '***CD34'::text, 1::smallint
           )`,
          [
            fixture.authUserId,
            captureRequestKey,
            depositIntentId,
            anotherReplayReferenceCiphertext,
            referenceFingerprint,
          ],
        );
        expect(inactiveActorReplay).toEqual([{ ...captured[0]!, request_key_already_used: true }]);

        await expectSqlFailure(
          client,
          () =>
            queryAsRole(
              client,
              'fetanagent_customer_web',
              `select * from app.open_customer_web_deposit_intent(
                 $1::uuid, '43000000-0000-1000-8000-000000000399'::uuid,
                 $2::text, 2500::bigint
               )`,
              [fixture.authUserId, fixture.playerId],
            ),
          /invalid/i,
        );
      });
    });
  });
}
