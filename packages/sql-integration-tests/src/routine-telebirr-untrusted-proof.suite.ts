import { createHash, randomUUID } from 'node:crypto';
import { loadApiConfig } from '@fetanagent/config/api';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  captureTelegramRoutineTelebirrCandidate,
  type TelegramRoutineTelebirrCandidateDatabase,
} from '../../../apps/api/src/telegram-routine-telebirr-candidate-intake.js';

const TABLE = 'app.routine_telebirr_untrusted_proof_requests';
const CAPTURE = `
  select * from app.capture_telegram_routine_telebirr_untrusted_proof(
    $1::uuid, $2::text, 'telebirr'::text, $3::text, $4::text, $5::text,
    2::smallint, 2::smallint, $6::text
  )
`;

function digest(seed: string = randomUUID()): string {
  return createHash('sha256').update(seed).digest('hex');
}

function semanticHmac(): string {
  return `hmac-sha256-v1:${digest()}`;
}

function stagingCandidateConfig() {
  const keyFingerprint = (hex: string): string =>
    `sha256:${createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex')}`;
  return loadApiConfig({
    NODE_ENV: 'test',
    INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'true',
    INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'true',
    INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED: 'true',
    TELEGRAM_ROUTINE_TELEBIRR_CANDIDATE_STAGING_ENABLED: 'true',
    PLAYER_ACTION_DEPLOYMENT_TARGET: 'staging',
    BOT_TO_API_ACTION_HMAC_SECRET: 'a'.repeat(64),
    API_TELEGRAM_CAPABILITY_HMAC_SECRET: 'b'.repeat(64),
    API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET: 'c'.repeat(64),
    API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET: 'd'.repeat(64),
    CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET: 'e'.repeat(64),
    CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET: 'f'.repeat(64),
    CBE_DEPOSIT_REFERENCE_KEY_PROFILE: JSON.stringify({
      encryptionKeyFingerprint: keyFingerprint('e'.repeat(64)),
      fingerprintKeyFingerprint: keyFingerprint('f'.repeat(64)),
      version: 1,
    }),
    DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET: '1'.repeat(64),
    DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET: '2'.repeat(64),
    DEPOSIT_PROOF_REFERENCE_PROFILE: JSON.stringify({
      encryptionMasterFingerprint: keyFingerprint('1'.repeat(64)),
      fingerprintMasterFingerprint: keyFingerprint('2'.repeat(64)),
      version: 2,
    }),
    PLAYER_ACTION_DATABASE_URL:
      'postgres://fetanagent_player_actions_runtime:password@db.spzpiyxheappsfyswewl.supabase.co:5432/postgres?sslmode=verify-full',
  });
}

type CaptureRow = {
  proof_request_id: string;
  provider_code: string;
  proof_status: string;
  submitted_at: Date;
  request_replayed: boolean;
};

async function rollback<T>(client: Client, body: () => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    return await body();
  } finally {
    await client.query('rollback');
  }
}

async function rejected(
  client: Client,
  query: string,
  values: readonly unknown[] = [],
): Promise<void> {
  await client.query('savepoint routine_proof_rejection');
  try {
    await expect(client.query(query, [...values])).rejects.toBeDefined();
  } finally {
    await client.query('rollback to savepoint routine_proof_rejection');
    await client.query('release savepoint routine_proof_rejection');
  }
}

async function fixtureIdentity(client: Client): Promise<{
  customerId: string;
  identityId: string;
}> {
  const customer = await client.query<{ id: string }>(
    'insert into app.customers default values returning id',
  );
  const identity = await client.query<{ id: string }>(
    `insert into app.customer_identities (customer_id, identity_kind, external_subject)
     values ($1::uuid, 'telegram', $2::text) returning id`,
    [customer.rows[0]!.id, `routine-proof-${randomUUID()}`],
  );
  return { customerId: customer.rows[0]!.id, identityId: identity.rows[0]!.id };
}

async function fixtureTelegramActor(
  client: Client,
  ownerAdminId: string,
): Promise<{ customerId: string; identityId: string }> {
  const customer = await client.query<{ id: string }>(
    `insert into app.customers (status) values ('active') returning id`,
  );
  const customerId = customer.rows[0]!.id;
  const telegramUserId = `${800_000_000_000n + BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 10)}`)}`;
  const identity = await client.query<{ id: string }>(
    `insert into app.customer_identities (customer_id, identity_kind, external_subject, status)
     values ($1::uuid, 'telegram', $2::text, 'active') returning id`,
    [customerId, telegramUserId],
  );
  const identityId = identity.rows[0]!.id;
  await client.query(
    `insert into app.telegram_identities (
       customer_identity_id, telegram_user_id, private_chat_id, preferred_locale
     ) values ($1::uuid, $2::bigint, $2::bigint, 'en')`,
    [identityId, telegramUserId],
  );
  await client.query(`insert into app.bot_conversations (telegram_identity_id) values ($1::uuid)`, [
    identityId,
  ]);
  const admissionEventId = await fixtureInboundEvent(client, identityId);
  const inviteDigest = `sha256-v1:${digest()}`;
  await client.query(
    `insert into app.telegram_beta_invites (
       token_digest, expires_at, issued_by_admin_id, created_at
     ) values ($1::text, clock_timestamp() + interval '1 hour',
       $2::uuid, clock_timestamp() - interval '10 minutes')`,
    [inviteDigest, ownerAdminId],
  );
  await client.query(
    `update app.telegram_beta_invites
        set status = 'redeemed',
            redeemed_telegram_user_id = $2::bigint,
            redeemed_private_chat_id = $2::bigint,
            redeemed_customer_id = $3::uuid,
            redeemed_customer_identity_id = $4::uuid,
            redeemed_inbound_event_id = $5::uuid,
            redeemed_at = clock_timestamp() - interval '5 minutes'
      where token_digest = $1::text`,
    [inviteDigest, telegramUserId, customerId, identityId, admissionEventId],
  );
  return { customerId, identityId };
}

async function fixtureInboundEvent(client: Client, identityId: string): Promise<string> {
  const event = await client.query<{ id: string }>(
    `insert into app.inbound_events (
       channel, external_event_id, customer_identity_id, payload_digest
     ) values ('telegram', $1::text, $2::uuid, $3::text) returning id`,
    [
      `update:${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`,
      identityId,
      semanticHmac(),
    ],
  );
  return event.rows[0]!.id;
}

async function fixtureEligiblePlayer(client: Client): Promise<string> {
  const customer = await client.query<{ id: string }>(
    `insert into app.customers (status) values ('active') returning id`,
  );
  const platform = await client.query<{ id: string }>(
    `select id from app.platforms where code = 'kemerbet' and status = 'active'`,
  );
  const playerId = `ROUTINE-${randomUUID()}`;
  const player = await client.query<{ id: string }>(
    `insert into app.customer_platform_players (customer_id, platform_id, player_id)
     values ($1::uuid, $2::uuid, $3::text) returning id`,
    [customer.rows[0]!.id, platform.rows[0]!.id, playerId],
  );
  await client.query(
    `insert into app.player_validation_attempts (
       player_account_id, attempt_number, outcome, reason_code, adapter_version,
       started_at, completed_at, result_digest
     ) values ($1::uuid, 1, 'valid', 'routine_proof_fixture', 'fixture_v1',
       clock_timestamp() - interval '1 second', clock_timestamp(), $2::text)`,
    [player.rows[0]!.id, `routine-proof-validation-${randomUUID()}`],
  );
  await client.query(
    `update app.customer_platform_players set validation_status = 'valid' where id = $1::uuid`,
    [player.rows[0]!.id],
  );
  await client.query(
    `insert into app.player_deposit_eligibility_decisions
       (player_account_id, decision_version, decision, reason_code, actor_kind)
     values ($1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'system')`,
    [player.rows[0]!.id],
  );
  return playerId;
}

async function fixtureTelebirrReceiver(client: Client): Promise<{
  readonly id: string;
  readonly version: number;
}> {
  const existing = await client.query<{ id: string; version: number }>(
    `select receiver.id, receiver.version from app.receiver_accounts receiver
       join app.payment_providers provider on provider.id = receiver.provider_id
      where provider.code = 'telebirr' and receiver.status = 'active'`,
  );
  if (existing.rows.length > 0) return existing.rows[0]!;
  const inserted = await client.query<{ id: string; version: number }>(
    `insert into app.receiver_accounts (
       provider_id, version, account_holder_name, account_reference_ciphertext,
       account_reference_masked, account_reference_fingerprint,
       protection_profile_version, encryption_key_version, fingerprint_key_version,
       rotation_request_id, rotation_reason
     ) select provider.id, 1, 'FetanAgent Fixture',
              $1::text, '***7001', $2::text, 1, 1, 1,
              $3::uuid, 'initial_configuration'
         from app.payment_providers provider where provider.code = 'telebirr'
     returning id, version`,
    [
      `receiver-v1.telebirr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(16)}`,
      digest(),
      randomUUID(),
    ],
  );
  return inserted.rows[0]!;
}

function captureArguments(eventId: string, playerId: string): readonly string[] {
  return [
    eventId,
    playerId,
    `v2.telebirr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(16)}`,
    digest(),
    '***AB12',
    semanticHmac(),
  ];
}

async function snapshot(client: Client): Promise<string> {
  const result = await client.query<{ state: string }>(`
    select jsonb_build_object(
      'intents', (select count(*) from app.deposit_intents),
      'evidence', (select count(*) from app.provider_payment_evidence),
      'claims', (select count(*) from app.deposit_payment_claims),
      'jobs', (select count(*) from app.deposit_jobs),
      'attempts', (select count(*) from app.deposit_execution_attempts),
      'live_switches', (select count(*) from app.feature_switches where mode = 'live')
    )::text as state
  `);
  return result.rows[0]!.state;
}

export function registerRoutineTelebirrUntrustedProofSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('dormant non-pilot TeleBirr proof foundation', () => {
    it('has forced RLS, no policies, no application access, and no amount or pilot column', async () => {
      const client = getClient();
      const catalog = await client.query<{
        force_rls: boolean;
        rls: boolean;
        policies: string;
        accessible_roles: string;
        amount_columns: string;
        pilot_columns: string;
      }>(`
        select class.relrowsecurity as rls,
               class.relforcerowsecurity as force_rls,
               (select count(*)::text from pg_catalog.pg_policies policy
                 where policy.schemaname = 'app'
                   and policy.tablename = 'routine_telebirr_untrusted_proof_requests') as policies,
               (select count(*)::text from pg_catalog.pg_roles role
                 where role.rolname in (
                   'anon', 'authenticated', 'service_role',
                   'fetanagent_player_actions', 'fetanagent_player_actions_runtime',
                   'fetanagent_customer_web', 'fetanagent_customer_web_runtime',
                   'fetanagent_telebirr_shadow_verifier_runtime',
                   'fetanagent_trusted_telebirr_verifier_runtime',
                   'fetanagent_routine_deposit_broker_runtime',
                   'fetanagent_deposit_executor_runtime'
                 ) and pg_catalog.has_table_privilege(role.rolname, class.oid,
                   'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) as accessible_roles,
               (select count(*)::text from information_schema.columns column_info
                 where column_info.table_schema = 'app'
                   and column_info.table_name = 'routine_telebirr_untrusted_proof_requests'
                   and column_info.column_name like '%amount%') as amount_columns,
               (select count(*)::text from information_schema.columns column_info
                 where column_info.table_schema = 'app'
                   and column_info.table_name = 'routine_telebirr_untrusted_proof_requests'
                   and column_info.column_name like '%pilot%') as pilot_columns
          from pg_catalog.pg_class class
         where class.oid = '${TABLE}'::pg_catalog.regclass
      `);
      expect(catalog.rows).toEqual([
        {
          rls: true,
          force_rls: true,
          policies: '0',
          accessible_roles: '0',
          amount_columns: '0',
          pilot_columns: '0',
        },
      ]);
    });

    it('binds a mandatory receiver revision through a private insert trigger', async () => {
      const client = getClient();
      const binding = await client.query<{
        receiver_not_null: boolean;
        version_not_null: boolean;
        trigger_enabled: boolean;
        function_owner: string;
        security_definer: boolean;
        public_allowed: boolean;
        service_allowed: boolean;
        player_allowed: boolean;
      }>(`
        select
          (select attnotnull from pg_catalog.pg_attribute
            where attrelid = '${TABLE}'::pg_catalog.regclass
              and attname = 'receiver_account_id') as receiver_not_null,
          (select attnotnull from pg_catalog.pg_attribute
            where attrelid = '${TABLE}'::pg_catalog.regclass
              and attname = 'receiver_account_version') as version_not_null,
          exists (select 1 from pg_catalog.pg_trigger trigger
            where trigger.tgrelid = '${TABLE}'::pg_catalog.regclass
              and trigger.tgname = 'routine_telebirr_candidate_bind_receiver_revision'
              and trigger.tgenabled = 'O' and not trigger.tgisinternal) as trigger_enabled,
          routine.proowner::pg_catalog.regrole::text as function_owner,
          routine.prosecdef as security_definer,
          pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE') as public_allowed,
          pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE') as service_allowed,
          pg_catalog.has_function_privilege(
            'fetanagent_player_actions', routine.oid, 'EXECUTE') as player_allowed
        from pg_catalog.pg_proc routine
        where routine.oid =
          'app.bind_routine_telebirr_candidate_receiver_revision()'::pg_catalog.regprocedure
      `);
      expect(binding.rows).toEqual([
        {
          receiver_not_null: true,
          version_not_null: true,
          trigger_enabled: true,
          function_owner: 'postgres',
          security_definer: true,
          public_allowed: false,
          service_allowed: false,
          player_allowed: false,
        },
      ]);
    });

    it('retains separate untrusted candidates without creating financial lineage', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const before = await snapshot(client);
        const firstIdentity = await fixtureIdentity(client);
        const secondIdentity = await fixtureIdentity(client);
        const platform = await client.query<{ id: string }>(
          `select id from app.platforms where code = 'kemerbet' and status = 'active'`,
        );
        const provider = await client.query<{ id: string }>(
          `select id from app.payment_providers where code = 'telebirr' and status = 'active'`,
        );
        const receiver = await fixtureTelebirrReceiver(client);
        expect(platform.rows).toHaveLength(1);
        expect(provider.rows).toHaveLength(1);
        const player = await client.query<{ id: string }>(
          `insert into app.customer_platform_players (customer_id, platform_id, player_id)
           values ($1::uuid, $2::uuid, $3::text) returning id`,
          [firstIdentity.customerId, platform.rows[0]!.id, `ROUTINE-${randomUUID()}`],
        );
        const playerId = player.rows[0]!.id;
        await client.query(
          `insert into app.player_validation_attempts (
             player_account_id, attempt_number, outcome, reason_code, adapter_version,
             started_at, completed_at, result_digest
           ) values ($1::uuid, 1, 'valid', 'routine_proof_fixture', 'fixture_v1',
             clock_timestamp() - interval '1 second', clock_timestamp(), $2::text)`,
          [playerId, `routine-proof-validation-${randomUUID()}`],
        );
        await client.query(
          `update app.customer_platform_players set validation_status = 'valid' where id = $1::uuid`,
          [playerId],
        );
        const eligibility = await client.query<{ id: string }>(
          `insert into app.player_deposit_eligibility_decisions
             (player_account_id, decision_version, decision, reason_code, actor_kind)
           values ($1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'system')
           returning id`,
          [playerId],
        );
        const referenceCiphertext = `v2.telebirr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(11)}`;
        const values = [
          firstIdentity.customerId,
          firstIdentity.identityId,
          randomUUID(),
          `hmac-sha256-v1:${'a'.repeat(64)}`,
          platform.rows[0]!.id,
          playerId,
          eligibility.rows[0]!.id,
          provider.rows[0]!.id,
          referenceCiphertext,
          'b'.repeat(64),
          '***AB12',
        ];
        const insert = `
          insert into ${TABLE} (
            submitting_customer_id, origin_identity_id, origin_channel,
            origin_request_key, semantic_input_hmac, platform_id, player_account_id,
            player_deposit_eligibility_decision_id, payment_provider_id,
            candidate_reference_ciphertext, candidate_reference_fingerprint,
            candidate_reference_masked, reference_encryption_key_version,
            reference_profile_version
          ) values (
            $1::uuid, $2::uuid, 'telegram', $3::uuid, $4::text,
            $5::uuid, $6::uuid, $7::uuid, $8::uuid,
            $9::text, $10::text, $11::text, 2, 2
          ) returning id, receiver_account_id, receiver_account_version
        `;
        const first = await client.query<{
          id: string;
          receiver_account_id: string;
          receiver_account_version: number;
        }>(insert, values);
        expect(first.rows).toHaveLength(1);
        expect(first.rows[0]).toMatchObject({
          receiver_account_id: receiver.id,
          receiver_account_version: receiver.version,
        });
        await rejected(client, insert, values); // An origin event has one immutable result.
        await rejected(
          client,
          `update ${TABLE} set candidate_reference_masked = '***ZZ99' where id = $1::uuid`,
          [first.rows[0]!.id],
        );
        await rejected(client, `delete from ${TABLE} where id = $1::uuid`, [first.rows[0]!.id]);
        await rejected(client, `truncate ${TABLE}`);
        await rejected(client, insert, [...values.slice(0, 9), 'not-a-fingerprint', values[10]]);
        const second = await client.query<{ id: string }>(insert, [
          secondIdentity.customerId,
          secondIdentity.identityId,
          randomUUID(),
          values[3],
          ...values.slice(4),
        ]);
        expect(second.rows).toHaveLength(1);
        expect(second.rows[0]!.id).not.toBe(first.rows[0]!.id);
        expect(await snapshot(client)).toBe(before);
      });
    });

    it('purges only 7-day-old candidates through the postgres-only fixed batch', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const before = await snapshot(client);
        const actor = await fixtureTelegramActor(client, getOwnerAdminId());
        const playerId = await fixtureEligiblePlayer(client);
        await fixtureTelebirrReceiver(client);
        const current = await client.query<CaptureRow>(CAPTURE, [
          ...captureArguments(await fixtureInboundEvent(client, actor.identityId), playerId),
        ]);
        const old = await client.query<{ id: string }>(
          `insert into ${TABLE} (
             submitting_customer_id, origin_identity_id, origin_channel,
             origin_request_key, semantic_input_hmac, platform_id, player_account_id,
             player_deposit_eligibility_decision_id, payment_provider_id, provider_code,
             candidate_reference_ciphertext, candidate_reference_fingerprint,
             candidate_reference_masked, reference_encryption_key_version,
             reference_profile_version, submitted_at
           ) select submitting_customer_id, origin_identity_id, origin_channel,
                    pg_catalog.gen_random_uuid(), $2::text, platform_id, player_account_id,
                    player_deposit_eligibility_decision_id, payment_provider_id, provider_code,
                    candidate_reference_ciphertext, candidate_reference_fingerprint,
                    candidate_reference_masked, reference_encryption_key_version,
                    reference_profile_version, statement_timestamp() - interval '8 days'
               from ${TABLE} source
               cross join pg_catalog.generate_series(1, 1002) series
              where source.id = $1::uuid returning id`,
          [current.rows[0]!.proof_request_id, semanticHmac()],
        );
        expect(old.rows).toHaveLength(1002);

        await rejected(client, `delete from ${TABLE} where id = $1::uuid`, [
          current.rows[0]!.proof_request_id,
        ]);
        const privilegedDueDelete = await client.query(
          `delete from ${TABLE} where id = $1::uuid returning id`,
          [old.rows[0]!.id],
        );
        expect(privilegedDueDelete.rows).toEqual([{ id: old.rows[0]!.id }]);
        await rejected(
          client,
          `update ${TABLE} set candidate_reference_masked = '***ZZ99'
            where id = $1::uuid`,
          [old.rows[1]!.id],
        );
        await client.query('set local role fetanagent_player_actions');
        await rejected(client, 'select app.purge_expired_routine_telebirr_untrusted_proofs()');
        await client.query('reset role');

        const purged = await client.query<{ deleted_count: number }>(
          'select app.purge_expired_routine_telebirr_untrusted_proofs() as deleted_count',
        );
        expect(purged.rows[0]!.deleted_count).toBe(1000);
        expect(
          (
            await client.query<{ count: string }>(
              `select count(*) from ${TABLE}
                where submitted_at <= statement_timestamp() - interval '7 days'`,
            )
          ).rows[0]!.count,
        ).toBe('1');
        expect(
          (
            await client.query<{ deleted_count: number }>(
              'select app.purge_expired_routine_telebirr_untrusted_proofs() as deleted_count',
            )
          ).rows[0]!.deleted_count,
        ).toBe(1);
        expect(
          (
            await client.query<{ deleted_count: number }>(
              'select app.purge_expired_routine_telebirr_untrusted_proofs() as deleted_count',
            )
          ).rows[0]!.deleted_count,
        ).toBe(0);
        const remaining = await client.query<{ id: string }>(
          `select id from ${TABLE} where origin_identity_id = $1::uuid`,
          [actor.identityId],
        );
        expect(remaining.rows).toEqual([{ id: current.rows[0]!.proof_request_id }]);
        expect(await snapshot(client)).toBe(before);
      });
    });

    it('does not grant candidate retention execution to public or application roles', async () => {
      const client = getClient();
      const catalog = await client.query<{
        owner: string;
        security_definer: boolean;
        public_allowed: boolean;
        player_allowed: boolean;
        service_allowed: boolean;
        nonce_allowed: boolean;
        function_settings: string[];
      }>(`
        select owner.rolname as owner,
               routine.prosecdef as security_definer,
               exists (
                 select 1 from pg_catalog.aclexplode(
                   coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
                 ) privilege
                 where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
               ) as public_allowed,
               pg_catalog.has_function_privilege('fetanagent_player_actions', routine.oid, 'execute')
                 as player_allowed,
               pg_catalog.has_function_privilege('service_role', routine.oid, 'execute')
                 as service_allowed,
               pg_catalog.has_function_privilege('fetanagent_nonce_retention', routine.oid, 'execute')
                 as nonce_allowed,
               routine.proconfig as function_settings
          from pg_catalog.pg_proc routine
          join pg_catalog.pg_roles owner on owner.oid = routine.proowner
         where routine.oid = 'app.purge_expired_routine_telebirr_untrusted_proofs()'
           ::pg_catalog.regprocedure
      `);
      expect(catalog.rows).toEqual([
        {
          owner: 'postgres',
          security_definer: false,
          public_allowed: false,
          player_allowed: false,
          service_allowed: false,
          nonce_allowed: false,
          function_settings: ['search_path=pg_catalog'],
        },
      ]);
    });

    it('keeps the private capture RPC outside every application role', async () => {
      const client = getClient();
      const catalog = await client.query<{
        readonly owner: string;
        readonly security_definer: boolean;
        readonly search_path: string[];
        readonly public_allowed: boolean;
        readonly player_allowed: boolean;
        readonly service_allowed: boolean;
      }>(`
        select owner.rolname as owner,
               routine.prosecdef as security_definer,
               routine.proconfig as search_path,
               exists (
                 select 1 from pg_catalog.aclexplode(
                   coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
                 ) privilege
                 where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
               ) as public_allowed,
               pg_catalog.has_function_privilege('fetanagent_player_actions', routine.oid, 'execute')
                 as player_allowed,
               pg_catalog.has_function_privilege('service_role', routine.oid, 'execute')
                 as service_allowed
          from pg_catalog.pg_proc routine
          join pg_catalog.pg_roles owner on owner.oid = routine.proowner
         where routine.oid = 'app.capture_telegram_routine_telebirr_untrusted_proof(
           uuid,text,text,text,text,text,smallint,smallint,text
         )'::pg_catalog.regprocedure
      `);
      expect(catalog.rows).toEqual([
        {
          owner: 'postgres',
          security_definer: true,
          search_path: ['search_path=pg_catalog'],
          public_allowed: false,
          player_allowed: false,
          service_allowed: false,
        },
      ]);
    });

    it('captures only an admitted private Telegram candidate, replays exactly, and never creates money', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const before = await snapshot(client);
        const actor = await fixtureTelegramActor(client, getOwnerAdminId());
        const secondActor = await fixtureTelegramActor(client, getOwnerAdminId());
        const playerId = await fixtureEligiblePlayer(client); // Deliberately owned by neither submitter.
        const receiver = await fixtureTelebirrReceiver(client);
        const eventId = await fixtureInboundEvent(client, actor.identityId);
        const args = captureArguments(eventId, playerId);

        await client.query('set local role fetanagent_player_actions');
        await rejected(client, CAPTURE, args);
        await client.query('reset role');

        const first = await client.query<CaptureRow>(CAPTURE, [...args]);
        expect(first.rows).toHaveLength(1);
        expect(first.rows[0]).toMatchObject({
          provider_code: 'telebirr',
          proof_status: 'untrusted_received',
          request_replayed: false,
        });
        const replay = await client.query<CaptureRow>(CAPTURE, [...args]);
        expect(replay.rows).toEqual([{ ...first.rows[0], request_replayed: true }]);
        await rejected(client, CAPTURE, [...args.slice(0, 3), digest(), ...args.slice(4)]);
        const stored = await client.query<{
          readonly submitting_customer_id: string;
          readonly origin_identity_id: string;
          readonly origin_request_key: string;
          readonly player_owner_customer_id: string;
          readonly receiver_account_id: string;
          readonly receiver_account_version: number;
          readonly processed_at: Date;
        }>(
          `
          select proof.submitting_customer_id, proof.origin_identity_id,
                 proof.origin_request_key, player.customer_id as player_owner_customer_id,
                 proof.receiver_account_id, proof.receiver_account_version,
                 event.processed_at
            from ${TABLE} proof
            join app.customer_platform_players player on player.id = proof.player_account_id
            join app.inbound_events event on event.id = proof.origin_request_key
           where proof.id = $1::uuid
        `,
          [first.rows[0]!.proof_request_id],
        );
        expect(stored.rows).toHaveLength(1);
        expect(stored.rows[0]).toMatchObject({
          submitting_customer_id: actor.customerId,
          origin_identity_id: actor.identityId,
          origin_request_key: eventId,
          receiver_account_id: receiver.id,
          receiver_account_version: receiver.version,
          processed_at: first.rows[0]!.submitted_at,
        });
        expect(stored.rows[0]!.player_owner_customer_id).not.toBe(actor.customerId);

        // The candidate is not globally claimed at intake; a second submitter can offer it.
        const otherEvent = await fixtureInboundEvent(client, secondActor.identityId);
        const second = await client.query<CaptureRow>(CAPTURE, [
          otherEvent,
          playerId,
          args[2],
          args[3],
          args[4],
          semanticHmac(),
        ]);
        expect(second.rows).toHaveLength(1);
        expect(second.rows[0]!.proof_request_id).not.toBe(first.rows[0]!.proof_request_id);
        await client.query(
          `update app.receiver_accounts
              set status = 'inactive', retired_at = clock_timestamp()
            where id = $1::uuid`,
          [receiver.id],
        );
        const historicalBinding = await client.query<{
          receiver_account_id: string;
          receiver_account_version: number;
        }>(
          `select receiver_account_id, receiver_account_version
             from ${TABLE} where id = $1::uuid`,
          [first.rows[0]!.proof_request_id],
        );
        expect(historicalBinding.rows).toEqual([
          {
            receiver_account_id: receiver.id,
            receiver_account_version: receiver.version,
          },
        ]);
        expect(await snapshot(client)).toBe(before);
      });
    });

    it('runs the staging API adapter against PostgreSQL with only a rolled-back role grant', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const before = await snapshot(client);
        const actor = await fixtureTelegramActor(client, getOwnerAdminId());
        const playerId = await fixtureEligiblePlayer(client);
        await fixtureTelebirrReceiver(client);
        const eventId = await fixtureInboundEvent(client, actor.identityId);
        const action = {
          version: 1,
          kind: 'deposit_proof_command',
          updateId: '10',
          telegramUserId: '20',
          privateChatId: '20',
          preferredLocale: 'en',
          providerCode: 'telebirr',
          playerId,
          transactionReference: 'FETANTESTREF7890',
        } as const;
        const database: TelegramRoutineTelebirrCandidateDatabase = {
          async query(query, values) {
            return client.query(query, [...values]);
          },
        };

        await client.query(`
          grant execute on function app.capture_telegram_routine_telebirr_untrusted_proof(
            uuid, text, text, text, text, text, smallint, smallint, text
          ) to fetanagent_player_actions
        `);
        const temporaryPrivilege = await client.query<{ allowed: boolean }>(`
          select pg_catalog.has_function_privilege(
            'fetanagent_player_actions_runtime',
            'app.capture_telegram_routine_telebirr_untrusted_proof(
              uuid,text,text,text,text,text,smallint,smallint,text
            )', 'EXECUTE'
          ) as allowed
        `);
        expect(temporaryPrivilege.rows[0]!.allowed).toBe(true);
        await client.query('set local role fetanagent_player_actions_runtime');
        const first = await captureTelegramRoutineTelebirrCandidate(
          database,
          eventId,
          action,
          stagingCandidateConfig(),
        );
        expect(first).toEqual({
          version: 1,
          outcome: 'telebirr_routine_candidate_recorded_no_money',
          providerCode: 'telebirr',
          providerName: 'TeleBirr',
          proofStatus: 'untrusted_received',
          verificationMode: 'not_started_no_money',
        });
        expect(
          await captureTelegramRoutineTelebirrCandidate(
            database,
            eventId,
            action,
            stagingCandidateConfig(),
          ),
        ).toEqual(first);
        await client.query('reset role');

        const stored = await client.query<{
          readonly origin_request_key: string;
          readonly candidate_reference_ciphertext: string;
          readonly candidate_reference_fingerprint: string;
          readonly candidate_reference_masked: string;
          readonly processed_at: Date;
        }>(
          `
          select proof.origin_request_key, proof.candidate_reference_ciphertext,
                 proof.candidate_reference_fingerprint, proof.candidate_reference_masked,
                 event.processed_at
            from ${TABLE} proof
            join app.inbound_events event on event.id = proof.origin_request_key
           where proof.origin_request_key = $1::uuid
        `,
          [eventId],
        );
        expect(stored.rows).toHaveLength(1);
        expect(stored.rows[0]).toMatchObject({
          origin_request_key: eventId,
          candidate_reference_masked: '***7890',
        });
        expect(stored.rows[0]!.processed_at).toBeInstanceOf(Date);
        expect(stored.rows[0]!.candidate_reference_ciphertext).toMatch(/^v2\.telebirr\./u);
        expect(stored.rows[0]!.candidate_reference_fingerprint).toMatch(/^[0-9a-f]{64}$/u);
        expect(JSON.stringify(stored.rows[0])).not.toContain(action.transactionReference);
        expect(await snapshot(client)).toBe(before);
      });
      const privilege = await client.query<{ allowed: boolean }>(`
        select pg_catalog.has_function_privilege(
          'fetanagent_player_actions_runtime',
          'app.capture_telegram_routine_telebirr_untrusted_proof(
            uuid,text,text,text,text,text,smallint,smallint,text
          )', 'EXECUTE'
        ) as allowed
      `);
      expect(privilege.rows[0]!.allowed).toBe(false);
    });

    it('rejects an inactive identity, processed event, and any armed financial switch', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const actor = await fixtureTelegramActor(client, getOwnerAdminId());
        const playerId = await fixtureEligiblePlayer(client);
        await fixtureTelebirrReceiver(client);
        const processedEvent = await fixtureInboundEvent(client, actor.identityId);
        await client.query(
          `update app.inbound_events set processed_at = clock_timestamp() where id = $1::uuid`,
          [processedEvent],
        );
        await rejected(client, CAPTURE, captureArguments(processedEvent, playerId));

        await client.query(
          `update app.customer_identities set status = 'inactive' where id = $1::uuid`,
          [actor.identityId],
        );
        await rejected(
          client,
          CAPTURE,
          captureArguments(await fixtureInboundEvent(client, actor.identityId), playerId),
        );
        await client.query(
          `update app.customer_identities set status = 'active' where id = $1::uuid`,
          [actor.identityId],
        );

        await client.query(
          `update app.feature_switches set mode = 'dry_run'
            where feature_key = 'withdrawal_validation'`,
        );
        await rejected(
          client,
          CAPTURE,
          captureArguments(await fixtureInboundEvent(client, actor.identityId), playerId),
        );
        const count = await client.query<{ count: string }>(`select count(*) from ${TABLE}`);
        expect(count.rows[0]!.count).toBe('0');
      });
    });

    it('bounds new stored candidates per Telegram identity without claiming a reference', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const actor = await fixtureTelegramActor(client, getOwnerAdminId());
        const playerId = await fixtureEligiblePlayer(client);
        await fixtureTelebirrReceiver(client);
        for (let index = 0; index < 5; index += 1) {
          const eventId = await fixtureInboundEvent(client, actor.identityId);
          const rows = await client.query<CaptureRow>(CAPTURE, [
            ...captureArguments(eventId, playerId),
          ]);
          expect(rows.rows).toHaveLength(1);
        }
        const rejectedEventId = await fixtureInboundEvent(client, actor.identityId);
        await rejected(client, CAPTURE, captureArguments(rejectedEventId, playerId));
        const count = await client.query<{ count: string }>(
          `select count(*) from ${TABLE} where origin_identity_id = $1::uuid`,
          [actor.identityId],
        );
        expect(count.rows[0]!.count).toBe('5');
      });
    });
  });
}
