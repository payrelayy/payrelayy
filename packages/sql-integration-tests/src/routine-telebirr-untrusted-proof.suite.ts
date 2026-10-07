import { createHash, randomUUID } from 'node:crypto';
import { loadApiConfig } from '@fetanagent/config/api';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  captureTelegramRoutineTelebirrCandidate,
  type TelegramRoutineTelebirrCandidateDatabase,
} from '../../../apps/api/src/telegram-routine-telebirr-candidate-intake.js';

const TABLE = 'app.routine_telebirr_untrusted_proof_requests';
const LOOKUP_TABLE = 'app.routine_telebirr_lookup_challenges';
const OBSERVATION_TABLE = 'app.routine_telebirr_observation_receipts';
const POLL_CLAIMS_TABLE = 'app.routine_telebirr_no_money_poll_claims';
const ENROLLMENT_TABLE = 'app.routine_telebirr_device_enrollments';
const SIGNER_TABLE = 'app.routine_telebirr_lookup_signers';
const ISSUE =
  'select * from app.issue_routine_telebirr_lookup_challenge($1::uuid, $2::uuid, $3::uuid)';
const ISSUE_MATERIAL =
  'select * from app.issue_routine_telebirr_lookup_assignment_material($1::uuid, $2::uuid, $3::uuid)';
const ISSUE_NO_MONEY_POLL =
  'select * from app.issue_routine_telebirr_no_money_poll_assignment($1::uuid, $2::uuid, $3::text, $4::timestamptz, $5::uuid)';
const LOAD_ENROLLMENT = 'select * from app.load_routine_telebirr_no_money_enrollment($1::uuid)';
const LOAD_OBSERVATION_MATERIAL =
  'select * from app.load_routine_telebirr_no_money_observation_material($1::uuid)';
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

async function fixtureRoutineLookupTrust(
  client: Client,
  candidateId: string,
): Promise<{
  enrollmentId: string;
  signerId: string;
  deviceId: string;
  deviceKeyId: string;
  deviceKeyDigest: string;
  receiverProfileDigest: string;
  expectedReceiverNameDigest: string;
}> {
  const signer = await client.query<{ id: string }>(
    `insert into ${SIGNER_TABLE} (
       signer_key_id, public_key_spki_sha256, valid_from, valid_until
     ) values ($1::text, $2::text, clock_timestamp() - interval '1 hour',
       clock_timestamp() + interval '1 day') returning id`,
    [`routine-signer-${randomUUID()}`, `sha256:${digest()}`],
  );
  const deviceId = `routine-device-${randomUUID()}`;
  const deviceKeyId = `routine-key-${randomUUID()}`;
  const deviceKeyDigest = `sha256:${digest()}`;
  const enrollment = await client.query<{
    id: string;
    receiver_profile_digest: string;
    expected_receiver_name_digest: string;
  }>(
    `insert into ${ENROLLMENT_TABLE} (
       pairing_evidence_digest, device_id, device_key_id,
       device_public_key_spki_sha256, receiver_account_id, receiver_account_version,
       receiver_profile_digest, expected_receiver_name_digest, valid_from, valid_until
     ) select $2::text, $3::text, $4::text, $5::text,
              receiver.id, receiver.version,
              app.routine_telebirr_receiver_profile_digest(
                receiver.id, receiver.version, receiver.account_reference_fingerprint,
                receiver.account_holder_name),
              app.routine_telebirr_receiver_name_digest(receiver.account_holder_name),
              clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 day'
         from ${TABLE} candidate
         join app.receiver_accounts receiver on receiver.id = candidate.receiver_account_id
        where candidate.id = $1::uuid
     returning id, receiver_profile_digest, expected_receiver_name_digest`,
    [candidateId, `sha256:${digest()}`, deviceId, deviceKeyId, deviceKeyDigest],
  );
  expect(enrollment.rows).toHaveLength(1);
  return {
    enrollmentId: enrollment.rows[0]!.id,
    signerId: signer.rows[0]!.id,
    deviceId,
    deviceKeyId,
    deviceKeyDigest,
    receiverProfileDigest: enrollment.rows[0]!.receiver_profile_digest,
    expectedReceiverNameDigest: enrollment.rows[0]!.expected_receiver_name_digest,
  };
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

    it('keeps the routine lookup and observation ledgers private and non-financial', async () => {
      const client = getClient();
      const catalog = await client.query<{
        name: string;
        rls: boolean;
        force_rls: boolean;
        policies: string;
        accessible_roles: string;
        forbidden_columns: string;
      }>(`
        select class.relname as name, class.relrowsecurity as rls,
               class.relforcerowsecurity as force_rls,
               (select count(*)::text from pg_catalog.pg_policies policy
                 where policy.schemaname = 'app' and policy.tablename = class.relname) as policies,
               (select count(*)::text from pg_catalog.pg_roles role
                 where role.rolname in (
                   'anon', 'authenticated', 'service_role',
                   'fetanagent_player_actions', 'fetanagent_player_actions_runtime',
                   'fetanagent_customer_web', 'fetanagent_customer_web_runtime',
                   'fetanagent_telebirr_assignment_broker_runtime',
                   'fetanagent_telebirr_device_state_runtime',
                   'fetanagent_routine_deposit_broker_runtime',
                   'fetanagent_trusted_telebirr_verifier_runtime',
                   'fetanagent_deposit_executor_runtime'
                 ) and pg_catalog.has_table_privilege(role.rolname, class.oid,
                   'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) as accessible_roles,
               (select count(*)::text from information_schema.columns column_info
                 where column_info.table_schema = 'app'
                   and column_info.table_name = class.relname
                   and (column_info.column_name like '%amount%'
                     or column_info.column_name like '%raw%'
                     or column_info.column_name like '%claim%'
                     or column_info.column_name like '%job%')) as forbidden_columns
          from pg_catalog.pg_class class
         where class.oid in (
           '${LOOKUP_TABLE}'::pg_catalog.regclass,
           '${OBSERVATION_TABLE}'::pg_catalog.regclass
         ) order by class.relname
      `);
      expect(catalog.rows).toEqual([
        {
          name: 'routine_telebirr_lookup_challenges',
          rls: true,
          force_rls: true,
          policies: '0',
          accessible_roles: '0',
          forbidden_columns: '0',
        },
        {
          name: 'routine_telebirr_observation_receipts',
          rls: true,
          force_rls: true,
          policies: '0',
          accessible_roles: '0',
          forbidden_columns: '0',
        },
      ]);
      const lineage = await client.query<{
        candidate_cascade: boolean;
        observation_cascade: boolean;
        candidate_snapshot_columns: number;
      }>(`
        select
          exists (select 1 from pg_catalog.pg_constraint relation_constraint
            where relation_constraint.conrelid = '${LOOKUP_TABLE}'::pg_catalog.regclass
              and relation_constraint.conname = 'routine_telebirr_lookup_candidate_snapshot_fkey'
              and relation_constraint.confdeltype = 'c') as candidate_cascade,
          exists (select 1 from pg_catalog.pg_constraint relation_constraint
            where relation_constraint.conrelid = '${OBSERVATION_TABLE}'::pg_catalog.regclass
              and relation_constraint.conname = 'routine_telebirr_observation_receipts_challenge_id_fkey'
              and relation_constraint.confdeltype = 'c') as observation_cascade,
          (select pg_catalog.array_length(relation_constraint.conkey, 1)
             from pg_catalog.pg_constraint relation_constraint
            where relation_constraint.conrelid = '${LOOKUP_TABLE}'::pg_catalog.regclass
              and relation_constraint.conname = 'routine_telebirr_lookup_candidate_snapshot_fkey')
            as candidate_snapshot_columns
      `);
      expect(lineage.rows).toEqual([
        { candidate_cascade: true, observation_cascade: true, candidate_snapshot_columns: 5 },
      ]);
    });

    it('keeps routine signer, enrollment, and issuer authority private and pilot-independent', async () => {
      const client = getClient();
      const catalog = await client.query<{
        name: string;
        rls: boolean;
        force_rls: boolean;
        policies: string;
        runtime_grants: string;
      }>(`
        select class.relname as name, class.relrowsecurity as rls,
               class.relforcerowsecurity as force_rls,
               (select count(*)::text from pg_catalog.pg_policies policy
                 where policy.schemaname = 'app' and policy.tablename = class.relname) as policies,
               (select count(*)::text from pg_catalog.pg_roles role
                 where role.rolname in ('anon', 'authenticated', 'service_role',
                   'fetanagent_routine_deposit_broker',
                   'fetanagent_routine_deposit_broker_runtime',
                   'fetanagent_telebirr_assignment_broker_runtime',
                   'fetanagent_telebirr_device_state_runtime')
                   and pg_catalog.has_table_privilege(role.rolname, class.oid,
                     'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) as runtime_grants
          from pg_catalog.pg_class class
         where class.oid in (
           '${SIGNER_TABLE}'::pg_catalog.regclass,
           'app.routine_telebirr_lookup_signer_revocations'::pg_catalog.regclass,
           '${ENROLLMENT_TABLE}'::pg_catalog.regclass,
           'app.routine_telebirr_device_enrollment_revocations'::pg_catalog.regclass
         ) order by class.relname
      `);
      expect(catalog.rows).toEqual(
        [
          'routine_telebirr_device_enrollment_revocations',
          'routine_telebirr_device_enrollments',
          'routine_telebirr_lookup_signer_revocations',
          'routine_telebirr_lookup_signers',
        ].map((name) => ({
          name,
          rls: true,
          force_rls: true,
          policies: '0',
          runtime_grants: '0',
        })),
      );
      const issuer = await client.query<{
        owner: string;
        security_definer: boolean;
        public_allowed: boolean;
        service_allowed: boolean;
        broker_allowed: boolean;
      }>(`
        select routine.proowner::pg_catalog.regrole::text as owner,
               routine.prosecdef as security_definer,
               pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
                 as public_allowed,
               pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
                 as service_allowed,
               pg_catalog.has_function_privilege('fetanagent_routine_deposit_broker_runtime',
                 routine.oid, 'EXECUTE') as broker_allowed
          from pg_catalog.pg_proc routine
         where routine.oid =
           'app.issue_routine_telebirr_lookup_challenge(uuid,uuid,uuid)'::pg_catalog.regprocedure
      `);
      expect(issuer.rows).toEqual([
        {
          owner: 'postgres',
          security_definer: true,
          public_allowed: false,
          service_allowed: false,
          broker_allowed: false,
        },
      ]);
      const name = '  PILOT\tRECEIVER  ';
      const digestRow = await client.query<{ value: string }>(
        'select app.routine_telebirr_receiver_name_digest($1::text) as value',
        [name],
      );
      // Fixed by the TypeScript/Android routine contract's independent vector.
      expect(digestRow.rows[0]!.value).toBe(
        'sha256:6f4b944f412c74330943d7cedb2a1b96906fe1b3d19f493551bead5d29ce03bd',
      );
      const profileDigestRow = await client.query<{ value: string }>(
        `select app.routine_telebirr_receiver_profile_digest(
           '33333333-3333-4333-8333-333333333333'::uuid, 3, $1::text, $2::text
         ) as value`,
        ['c'.repeat(64), '  ROUTINE\tRECEIVER  '],
      );
      expect(profileDigestRow.rows[0]!.value).toBe(
        'sha256:15041ad5b0e4c4527f10cf34c9180d51bb867905b79ce97407592aeb74142699',
      );
    });

    it('returns exact encrypted assignment material only to postgres and rejects shared keys', async () => {
      const client = getClient();
      const catalog = await client.query<{
        owner: string;
        security_definer: boolean;
        public_allowed: boolean;
        service_allowed: boolean;
        broker_allowed: boolean;
        pilot_broker_allowed: boolean;
        key_separation_trigger: boolean;
      }>(`
        select routine.proowner::pg_catalog.regrole::text as owner,
               routine.prosecdef as security_definer,
               pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
                 as public_allowed,
               pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
                 as service_allowed,
               pg_catalog.has_function_privilege('fetanagent_routine_deposit_broker_runtime',
                 routine.oid, 'EXECUTE') as broker_allowed,
               pg_catalog.has_function_privilege('fetanagent_telebirr_assignment_broker_runtime',
                 routine.oid, 'EXECUTE') as pilot_broker_allowed,
               exists (select 1 from pg_catalog.pg_trigger trigger_row
                 where trigger_row.tgrelid = '${LOOKUP_TABLE}'::pg_catalog.regclass
                   and trigger_row.tgname = 'routine_telebirr_lookup_distinct_keys'
                   and not trigger_row.tgisinternal) as key_separation_trigger
          from pg_catalog.pg_proc routine
         where routine.oid =
           'app.issue_routine_telebirr_lookup_assignment_material(uuid,uuid,uuid)'::pg_catalog.regprocedure
      `);
      expect(catalog.rows).toEqual([
        {
          owner: 'postgres',
          security_definer: true,
          public_allowed: false,
          service_allowed: false,
          broker_allowed: false,
          pilot_broker_allowed: false,
          key_separation_trigger: true,
        },
      ]);
      await rollback(client, async () => {
        const before = await snapshot(client);
        const actor = await fixtureTelegramActor(client, getOwnerAdminId());
        const playerId = await fixtureEligiblePlayer(client);
        await fixtureTelebirrReceiver(client);
        const captured = await client.query<CaptureRow>(CAPTURE, [
          ...captureArguments(await fixtureInboundEvent(client, actor.identityId), playerId),
        ]);
        const candidateId = captured.rows[0]!.proof_request_id;
        const trust = await fixtureRoutineLookupTrust(client, candidateId);
        await client.query('set local role fetanagent_routine_deposit_broker');
        await rejected(client, ISSUE_MATERIAL, [candidateId, trust.enrollmentId, trust.signerId]);
        await client.query('reset role');

        const material = await client.query<{
          challenge_id: string;
          challenge_digest: string;
          issued_at: Date;
          expires_at: Date;
          candidate_id: string;
          candidate_reference_ciphertext: string;
          candidate_reference_fingerprint: string;
          receiver_revision_id: string;
          receiver_profile_digest: string;
          expected_receiver_name_digest: string;
          device_enrollment_id: string;
          device_id: string;
          device_key_id: string;
          assignment_signer_id: string;
          source_profile: string;
        }>(ISSUE_MATERIAL, [candidateId, trust.enrollmentId, trust.signerId]);
        expect(material.rows).toHaveLength(1);
        const row = material.rows[0]!;
        expect(row.challenge_digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
        expect(row.expires_at.getTime() - row.issued_at.getTime()).toBe(300_000);
        expect(row.candidate_id).toBe(candidateId);
        expect(row.candidate_reference_ciphertext).toMatch(/^v2\.telebirr\./u);
        expect(row.candidate_reference_ciphertext).not.toContain('FTAN12345678');
        expect(row.candidate_reference_fingerprint).toMatch(/^[0-9a-f]{64}$/u);
        expect(row.receiver_profile_digest).toBe(trust.receiverProfileDigest);
        expect(row.expected_receiver_name_digest).toBe(trust.expectedReceiverNameDigest);
        expect(row.device_enrollment_id).toBe(trust.enrollmentId);
        expect(row.device_id).toBe(trust.deviceId);
        expect(row.device_key_id).toBe(trust.deviceKeyId);
        expect(row.assignment_signer_id).toBe(trust.signerId);
        expect(row.source_profile).toBe('telebirr_official_receipt_v1');
        const pinned = await client.query<{ exact: boolean }>(
          `select challenge.candidate_id = $2::uuid
                    and challenge.device_enrollment_id = $3::uuid
                    and challenge.assignment_signer_id = $4::uuid
                    and challenge.receiver_account_id = $5::uuid
                    and challenge.challenge_digest = $6::text as exact
             from ${LOOKUP_TABLE} challenge where challenge.challenge_id = $1::uuid`,
          [
            row.challenge_id,
            candidateId,
            trust.enrollmentId,
            trust.signerId,
            row.receiver_revision_id,
            row.challenge_digest,
          ],
        );
        expect(pinned.rows).toEqual([{ exact: true }]);

        const sharedSigner = await client.query<{ id: string }>(
          `insert into ${SIGNER_TABLE} (
             signer_key_id, public_key_spki_sha256, valid_from, valid_until
           ) values ($1::text, $2::text, clock_timestamp() - interval '1 hour',
             clock_timestamp() + interval '1 day') returning id`,
          [trust.deviceKeyId, trust.deviceKeyDigest],
        );
        await rejected(client, ISSUE_MATERIAL, [
          candidateId,
          trust.enrollmentId,
          sharedSigner.rows[0]!.id,
        ]);
        expect(await snapshot(client)).toBe(before);
      });
    });

    it('reads back only the active encrypted challenge snapshot for no-money upload review', async () => {
      const client = getClient();
      const catalog = await client.query<{
        function_name: string;
        owner: string;
        security_definer: boolean;
        public_allowed: boolean;
        service_allowed: boolean;
        pilot_broker_allowed: boolean;
        routine_broker_allowed: boolean;
      }>(`
        select routine.proname as function_name,
               routine.proowner::pg_catalog.regrole::text as owner,
               routine.prosecdef as security_definer,
               pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
                 as public_allowed,
               pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
                 as service_allowed,
               pg_catalog.has_function_privilege('fetanagent_telebirr_assignment_broker_runtime',
                 routine.oid, 'EXECUTE') as pilot_broker_allowed,
               pg_catalog.has_function_privilege('fetanagent_routine_deposit_broker_runtime',
                 routine.oid, 'EXECUTE') as routine_broker_allowed
          from pg_catalog.pg_proc routine
         where routine.oid in (
           'app.load_routine_telebirr_no_money_enrollment(uuid)'::pg_catalog.regprocedure,
           'app.load_routine_telebirr_no_money_observation_material(uuid)'::pg_catalog.regprocedure)
         order by routine.proname
      `);
      expect(catalog.rows).toEqual(
        [
          'load_routine_telebirr_no_money_enrollment',
          'load_routine_telebirr_no_money_observation_material',
        ].map((functionName) => ({
          function_name: functionName,
          owner: 'postgres',
          security_definer: true,
          public_allowed: false,
          service_allowed: false,
          pilot_broker_allowed: false,
          routine_broker_allowed: false,
        })),
      );
      await rollback(client, async () => {
        const before = await snapshot(client);
        const actor = await fixtureTelegramActor(client, getOwnerAdminId());
        const playerId = await fixtureEligiblePlayer(client);
        await fixtureTelebirrReceiver(client);
        const captured = await client.query<CaptureRow>(CAPTURE, [
          ...captureArguments(await fixtureInboundEvent(client, actor.identityId), playerId),
        ]);
        const candidateId = captured.rows[0]!.proof_request_id;
        const trust = await fixtureRoutineLookupTrust(client, candidateId);
        const enrollment = await client.query(LOAD_ENROLLMENT, [trust.enrollmentId]);
        expect(enrollment.rows).toHaveLength(1);
        expect(enrollment.rows[0]!.enrollment_id).toBe(trust.enrollmentId);
        expect(enrollment.rows[0]!.receiver_profile_digest).toBe(trust.receiverProfileDigest);
        const issued = await client.query(ISSUE_MATERIAL, [
          candidateId,
          trust.enrollmentId,
          trust.signerId,
        ]);
        expect(issued.rows).toHaveLength(1);
        const challengeId = issued.rows[0]!.challenge_id as string;
        expect((await client.query(LOAD_OBSERVATION_MATERIAL, [challengeId])).rows).toEqual(
          issued.rows,
        );
        expect((await client.query(LOAD_OBSERVATION_MATERIAL, [randomUUID()])).rows).toEqual([]);

        await client.query('set local role service_role');
        await rejected(client, LOAD_ENROLLMENT, [trust.enrollmentId]);
        await rejected(client, LOAD_OBSERVATION_MATERIAL, [challengeId]);
        await client.query('reset role');

        await client.query(
          `insert into app.routine_telebirr_lookup_signer_revocations
             (signer_id, reason_code) values ($1::uuid, 'rotation')`,
          [trust.signerId],
        );
        expect((await client.query(LOAD_OBSERVATION_MATERIAL, [challengeId])).rows).toEqual([]);
        await client.query(
          `insert into app.routine_telebirr_device_enrollment_revocations
             (enrollment_id, reason_code) values ($1::uuid, 'owner_revoked')`,
          [trust.enrollmentId],
        );
        expect((await client.query(LOAD_ENROLLMENT, [trust.enrollmentId])).rows).toEqual([]);
        expect(await snapshot(client)).toBe(before);
      });
    });

    it('issues only a five-minute no-money lookup for a current candidate and separate routine trust', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const before = await snapshot(client);
        const actor = await fixtureTelegramActor(client, getOwnerAdminId());
        const playerId = await fixtureEligiblePlayer(client);
        await fixtureTelebirrReceiver(client);
        const captured = await client.query<CaptureRow>(CAPTURE, [
          ...captureArguments(await fixtureInboundEvent(client, actor.identityId), playerId),
        ]);
        const candidateId = captured.rows[0]!.proof_request_id;
        await rejected(client, ISSUE, [candidateId, randomUUID(), randomUUID()]);
        const trust = await fixtureRoutineLookupTrust(client, candidateId);
        const mismatchedEnrollment = await client.query<{ id: string }>(
          `insert into ${ENROLLMENT_TABLE} (
             pairing_evidence_digest, device_id, device_key_id,
             device_public_key_spki_sha256, receiver_account_id, receiver_account_version,
             receiver_profile_digest, expected_receiver_name_digest, valid_from, valid_until
           ) select $2::text, $3::text, $4::text, $5::text,
                    receiver_account_id, receiver_account_version,
                    $6::text, $7::text,
                    clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 day'
               from ${TABLE} where id = $1::uuid returning id`,
          [
            candidateId,
            `sha256:${digest()}`,
            `routine-device-${randomUUID()}`,
            `routine-key-${randomUUID()}`,
            `sha256:${digest()}`,
            `sha256:${digest()}`,
            trust.expectedReceiverNameDigest,
          ],
        );
        await rejected(client, ISSUE, [
          candidateId,
          mismatchedEnrollment.rows[0]!.id,
          trust.signerId,
        ]);
        await client.query('set local role fetanagent_routine_deposit_broker');
        await rejected(client, ISSUE, [candidateId, trust.enrollmentId, trust.signerId]);
        await client.query('reset role');

        const issued = await client.query<{
          challenge_id: string;
          challenge_digest: string;
          issued_at: Date;
          expires_at: Date;
          receiver_profile_digest: string;
          expected_receiver_name_digest: string;
        }>(ISSUE, [candidateId, trust.enrollmentId, trust.signerId]);
        expect(issued.rows).toHaveLength(1);
        const first = issued.rows[0]!;
        expect(first.challenge_digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
        expect(first.expires_at.getTime() - first.issued_at.getTime()).toBe(300_000);
        expect(first.receiver_profile_digest).toBe(trust.receiverProfileDigest);
        expect(first.expected_receiver_name_digest).toBe(trust.expectedReceiverNameDigest);
        const bound = await client.query<{
          exact_candidate: boolean;
          exact_device: boolean;
          exact_signer: boolean;
          exact_receiver: boolean;
        }>(
          `
          select challenge.candidate_id = candidate.id
                   and challenge.candidate_reference_fingerprint =
                     candidate.candidate_reference_fingerprint
                   and challenge.candidate_submitted_at = candidate.submitted_at
                     as exact_candidate,
                 challenge.device_enrollment_id = enrollment.id
                   and challenge.device_id = enrollment.device_id
                   and challenge.device_key_id = enrollment.device_key_id
                   and challenge.device_public_key_spki_sha256 =
                     enrollment.device_public_key_spki_sha256 as exact_device,
                 challenge.assignment_signer_id = signer.id as exact_signer,
                 challenge.receiver_account_id = candidate.receiver_account_id
                   and challenge.receiver_account_version = candidate.receiver_account_version
                   and challenge.receiver_profile_digest = enrollment.receiver_profile_digest
                   and challenge.expected_receiver_name_digest =
                     enrollment.expected_receiver_name_digest as exact_receiver
            from ${LOOKUP_TABLE} challenge
            join ${TABLE} candidate on candidate.id = challenge.candidate_id
            join ${ENROLLMENT_TABLE} enrollment on enrollment.id = challenge.device_enrollment_id
            join ${SIGNER_TABLE} signer on signer.id = challenge.assignment_signer_id
           where challenge.challenge_id = $1::uuid`,
          [first.challenge_id],
        );
        expect(bound.rows).toEqual([
          {
            exact_candidate: true,
            exact_device: true,
            exact_signer: true,
            exact_receiver: true,
          },
        ]);
        await client.query('savepoint revoked_enrollment');
        await client.query(
          `insert into app.routine_telebirr_device_enrollment_revocations
             (enrollment_id, reason_code) values ($1::uuid, 'device_lost')`,
          [trust.enrollmentId],
        );
        await rejected(client, ISSUE, [candidateId, trust.enrollmentId, trust.signerId]);
        await client.query('rollback to savepoint revoked_enrollment');
        await client.query('release savepoint revoked_enrollment');
        await client.query('savepoint revoked_signer');
        await client.query(
          `insert into app.routine_telebirr_lookup_signer_revocations
             (signer_id, reason_code) values ($1::uuid, 'key_compromise')`,
          [trust.signerId],
        );
        await rejected(client, ISSUE, [candidateId, trust.enrollmentId, trust.signerId]);
        await client.query('rollback to savepoint revoked_signer');
        await client.query('release savepoint revoked_signer');
        await client.query('savepoint stale_player');
        await client.query(
          `insert into app.player_deposit_eligibility_decisions (
             player_account_id, decision_version, decision, reason_code, actor_kind
           ) select id, 2, 'revoked', 'financial_eligibility_revoked', 'system'
               from app.customer_platform_players where player_id = $1::text`,
          [playerId],
        );
        await rejected(client, ISSUE, [candidateId, trust.enrollmentId, trust.signerId]);
        await client.query('rollback to savepoint stale_player');
        await client.query('release savepoint stale_player');
        for (let remaining = 0; remaining < 4; remaining += 1) {
          await client.query(ISSUE, [candidateId, trust.enrollmentId, trust.signerId]);
        }
        await rejected(client, ISSUE, [candidateId, trust.enrollmentId, trust.signerId]);
        expect(await snapshot(client)).toBe(before);
      });
    });

    it('pins a candidate snapshot, allows one receipt per challenge, and follows 7-day purge', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const before = await snapshot(client);
        const actor = await fixtureTelegramActor(client, getOwnerAdminId());
        const playerId = await fixtureEligiblePlayer(client);
        await fixtureTelebirrReceiver(client);
        const captured = await client.query<CaptureRow>(CAPTURE, [
          ...captureArguments(await fixtureInboundEvent(client, actor.identityId), playerId),
        ]);
        const candidateId = captured.rows[0]!.proof_request_id;
        const trust = await fixtureRoutineLookupTrust(client, candidateId);
        const withTrust = (values: readonly unknown[]): unknown[] => [
          ...values,
          trust.enrollmentId,
          trust.signerId,
        ];
        const challengeId = randomUUID();
        const challengeDigest = `sha256:${digest()}`;
        const insert = `
          insert into ${LOOKUP_TABLE} (
            challenge_id, candidate_id, receiver_account_id, receiver_account_version,
            candidate_reference_fingerprint, candidate_submitted_at,
            device_id, device_key_id, device_public_key_spki_sha256,
            device_enrollment_id, assignment_signer_id,
            receiver_profile_digest, expected_receiver_name_digest,
            challenge_digest, issued_at, expires_at
          ) select $1::uuid, candidate.id, candidate.receiver_account_id,
                   candidate.receiver_account_version + $3::integer,
                   coalesce($4::text, candidate.candidate_reference_fingerprint),
                   candidate.submitted_at,
                   enrollment.device_id, enrollment.device_key_id, $5::text,
                   enrollment.id, signer.id,
                   enrollment.receiver_profile_digest, enrollment.expected_receiver_name_digest,
                   $6::text, issued.now_at,
                   issued.now_at + $7::integer * interval '1 minute'
              from ${TABLE} candidate
              cross join ${ENROLLMENT_TABLE} enrollment
              cross join ${SIGNER_TABLE} signer
              cross join lateral (
                select date_trunc('milliseconds', clock_timestamp()) as now_at
              ) issued
             where candidate.id = $2::uuid and enrollment.id = $8::uuid
               and signer.id = $9::uuid
          returning challenge_id
        `;
        const keyDigest = `sha256:${digest()}`;
        const args = [challengeId, candidateId, 0, null, keyDigest, challengeDigest, 5];
        expect((await client.query(insert, withTrust(args))).rows).toEqual([
          { challenge_id: challengeId },
        ]);
        await client.query('set local role fetanagent_routine_deposit_broker');
        await rejected(client, `select * from ${LOOKUP_TABLE}`);
        await rejected(client, `select * from ${OBSERVATION_TABLE}`);
        await client.query('reset role');
        await rejected(
          client,
          insert,
          withTrust([randomUUID(), candidateId, 1, null, keyDigest, `sha256:${digest()}`, 5]),
        );
        await rejected(
          client,
          insert,
          withTrust([
            randomUUID(),
            candidateId,
            0,
            'f'.repeat(64),
            keyDigest,
            `sha256:${digest()}`,
            5,
          ]),
        );
        await rejected(
          client,
          insert,
          withTrust([challengeId, candidateId, 0, null, keyDigest, `sha256:${digest()}`, 5]),
        );
        await rejected(
          client,
          insert,
          withTrust([randomUUID(), candidateId, 0, null, keyDigest, challengeDigest, 5]),
        );
        await rejected(
          client,
          insert,
          withTrust([randomUUID(), candidateId, 0, null, keyDigest, `sha256:${digest()}`, 6]),
        );
        await rejected(
          client,
          insert,
          withTrust([
            randomUUID(),
            candidateId,
            0,
            null,
            'not-a-key-digest',
            `sha256:${digest()}`,
            5,
          ]),
        );
        await rejected(
          client,
          `insert into ${LOOKUP_TABLE} (
            candidate_id, receiver_account_id, receiver_account_version,
            candidate_reference_fingerprint, candidate_submitted_at,
            device_id, device_key_id, device_public_key_spki_sha256,
            device_enrollment_id, assignment_signer_id,
            receiver_profile_digest, expected_receiver_name_digest,
            challenge_digest, issued_at, expires_at
          ) select candidate.id, candidate.receiver_account_id,
                   candidate.receiver_account_version,
                   candidate.candidate_reference_fingerprint, candidate.submitted_at,
                   enrollment.device_id, enrollment.device_key_id, $2::text,
                   enrollment.id, signer.id,
                   enrollment.receiver_profile_digest, enrollment.expected_receiver_name_digest,
                   $3::text, candidate.submitted_at + interval '6 days 23 hours 59 minutes',
                   candidate.submitted_at + interval '7 days 4 minutes'
              from ${TABLE} candidate
              cross join ${ENROLLMENT_TABLE} enrollment
              cross join ${SIGNER_TABLE} signer
             where candidate.id = $1::uuid and enrollment.id = $4::uuid
               and signer.id = $5::uuid`,
          [candidateId, keyDigest, `sha256:${digest()}`, trust.enrollmentId, trust.signerId],
        );
        const receipt = `insert into ${OBSERVATION_TABLE}
          (challenge_id, observation_body_digest, observation_signature_digest)
          values ($1::uuid, $2::text, $3::text) returning challenge_id`;
        expect(
          (await client.query(receipt, [challengeId, `sha256:${digest()}`, `sha256:${digest()}`]))
            .rows,
        ).toEqual([{ challenge_id: challengeId }]);
        await rejected(client, receipt, [challengeId, `sha256:${digest()}`, `sha256:${digest()}`]);
        await rejected(client, receipt, [randomUUID(), `sha256:${digest()}`, `sha256:${digest()}`]);

        // Expired candidate cleanup must also remove its digest-only descendants.
        const oldCandidate = await client.query<{ id: string }>(
          `
          insert into ${TABLE} (
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
              from ${TABLE} where id = $1::uuid returning id
        `,
          [candidateId, semanticHmac()],
        );
        const oldChallengeId = randomUUID();
        await client.query(
          `
          insert into ${LOOKUP_TABLE} (
            challenge_id, candidate_id, receiver_account_id, receiver_account_version,
            candidate_reference_fingerprint, candidate_submitted_at,
            device_id, device_key_id, device_public_key_spki_sha256,
            device_enrollment_id, assignment_signer_id,
            receiver_profile_digest, expected_receiver_name_digest,
            challenge_digest, issued_at, expires_at
          ) select $1::uuid, candidate.id, candidate.receiver_account_id,
                   candidate.receiver_account_version,
                   candidate.candidate_reference_fingerprint, candidate.submitted_at,
                   enrollment.device_id, enrollment.device_key_id, $3::text,
                   enrollment.id, signer.id,
                   enrollment.receiver_profile_digest, enrollment.expected_receiver_name_digest,
                   $4::text, candidate.submitted_at + interval '1 hour',
                   candidate.submitted_at + interval '1 hour 5 minutes'
              from ${TABLE} candidate
              cross join ${ENROLLMENT_TABLE} enrollment
              cross join ${SIGNER_TABLE} signer
             where candidate.id = $2::uuid and enrollment.id = $5::uuid
               and signer.id = $6::uuid
        `,
          [
            oldChallengeId,
            oldCandidate.rows[0]!.id,
            keyDigest,
            `sha256:${digest()}`,
            trust.enrollmentId,
            trust.signerId,
          ],
        );
        await client.query(receipt, [oldChallengeId, `sha256:${digest()}`, `sha256:${digest()}`]);
        const purged = await client.query<{ deleted_count: number }>(
          'select app.purge_expired_routine_telebirr_untrusted_proofs() as deleted_count',
        );
        expect(purged.rows[0]!.deleted_count).toBe(1);
        expect(
          (
            await client.query(
              `select count(*)::text from ${LOOKUP_TABLE}
          where challenge_id = $1::uuid`,
              [oldChallengeId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
        expect(
          (
            await client.query(
              `select count(*)::text from ${OBSERVATION_TABLE}
          where challenge_id = $1::uuid`,
              [oldChallengeId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
        expect(await snapshot(client)).toBe(before);
      });
    });

    it('claims signed no-money polls once and stages only exact observation replays', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const before = await snapshot(client);
        const actor = await fixtureTelegramActor(client, getOwnerAdminId());
        const playerId = await fixtureEligiblePlayer(client);
        await fixtureTelebirrReceiver(client);
        const captured = await client.query<CaptureRow>(CAPTURE, [
          ...captureArguments(await fixtureInboundEvent(client, actor.identityId), playerId),
        ]);
        const candidateId = captured.rows[0]!.proof_request_id;
        const trust = await fixtureRoutineLookupTrust(client, candidateId);
        const requestId = randomUUID();
        const replayIdentity = `sha256:${digest()}`;
        const claim = `select app.claim_routine_telebirr_no_money_poll(
          $1::uuid, $2::uuid, $3::text, $4::timestamptz) as claimed`;
        const expiresAt = new Date(Date.now() + 40_000).toISOString();
        expect(
          (await client.query(claim, [trust.enrollmentId, requestId, replayIdentity, expiresAt]))
            .rows,
        ).toEqual([{ claimed: true }]);
        expect(
          (await client.query(claim, [trust.enrollmentId, requestId, replayIdentity, expiresAt]))
            .rows,
        ).toEqual([{ claimed: false }]);
        expect(
          (await client.query(claim, [trust.enrollmentId, randomUUID(), replayIdentity, expiresAt]))
            .rows,
        ).toEqual([{ claimed: false }]);
        await rejected(client, claim, [
          trust.enrollmentId,
          randomUUID(),
          `sha256:${digest()}`,
          new Date(Date.now() + 120_000).toISOString(),
        ]);

        const issued = await client.query<{ challenge_id: string }>(ISSUE, [
          candidateId,
          trust.enrollmentId,
          trust.signerId,
        ]);
        const challengeId = issued.rows[0]!.challenge_id;
        const stage = `select app.stage_routine_telebirr_no_money_observation_digest(
          $1::uuid, $2::text, $3::text, $4::text, $5::text) as status`;
        const digests = [
          challengeId,
          `sha256:${digest()}`,
          `sha256:${digest()}`,
          `sha256:${digest()}`,
          `sha256:${digest()}`,
        ];
        expect((await client.query(stage, digests)).rows).toEqual([{ status: 'recorded' }]);
        expect((await client.query(stage, digests)).rows).toEqual([{ status: 'exact_replay' }]);
        expect(
          (
            await client.query(stage, [
              digests[0],
              digests[1],
              `sha256:${digest()}`,
              digests[3],
              digests[4],
            ])
          ).rows,
        ).toEqual([{ status: 'conflict' }]);
        expect(
          (
            await client.query(
              `select assignment_body_digest, observation_body_digest,
          observation_signature_digest, replay_identity from ${OBSERVATION_TABLE}
          where challenge_id = $1::uuid`,
              [challengeId],
            )
          ).rows,
        ).toEqual([
          {
            assignment_body_digest: digests[1],
            observation_body_digest: digests[2],
            observation_signature_digest: digests[3],
            replay_identity: digests[4],
          },
        ]);

        await client.query('set local role service_role');
        await rejected(client, claim, [
          trust.enrollmentId,
          randomUUID(),
          `sha256:${digest()}`,
          expiresAt,
        ]);
        await rejected(client, stage, digests);
        await rejected(client, `select * from ${POLL_CLAIMS_TABLE}`);
        await client.query('reset role');
        expect(await snapshot(client)).toBe(before);
      });
    });

    it('atomically spends a signed no-money poll and reserves only one encrypted lookup', async () => {
      const client = getClient();
      const catalog = await client.query<{
        owner: string;
        security_definer: boolean;
        public_allowed: boolean;
        service_allowed: boolean;
        routine_broker_allowed: boolean;
      }>(`
        select routine.proowner::pg_catalog.regrole::text as owner,
               routine.prosecdef as security_definer,
               pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
                 as public_allowed,
               pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
                 as service_allowed,
               pg_catalog.has_function_privilege('fetanagent_routine_deposit_broker_runtime',
                 routine.oid, 'EXECUTE') as routine_broker_allowed
          from pg_catalog.pg_proc routine
         where routine.oid =
           'app.issue_routine_telebirr_no_money_poll_assignment(uuid,uuid,text,timestamptz,uuid)'::pg_catalog.regprocedure
      `);
      expect(catalog.rows).toEqual([
        {
          owner: 'postgres',
          security_definer: true,
          public_allowed: false,
          service_allowed: false,
          routine_broker_allowed: false,
        },
      ]);
      await rollback(client, async () => {
        const financialBefore = await snapshot(client);
        const actor = await fixtureTelegramActor(client, getOwnerAdminId());
        const playerId = await fixtureEligiblePlayer(client);
        await fixtureTelebirrReceiver(client);
        const captured = await client.query<CaptureRow>(CAPTURE, [
          ...captureArguments(await fixtureInboundEvent(client, actor.identityId), playerId),
        ]);
        const candidateId = captured.rows[0]!.proof_request_id;
        const trust = await fixtureRoutineLookupTrust(client, candidateId);
        const sharedSigner = await client.query<{ id: string }>(
          `insert into ${SIGNER_TABLE} (
             signer_key_id, public_key_spki_sha256, valid_from, valid_until
           ) values ($1::text, $2::text, clock_timestamp() - interval '1 hour',
             clock_timestamp() + interval '1 day') returning id`,
          [trust.deviceKeyId, trust.deviceKeyDigest],
        );
        const rejectedRequestId = randomUUID();
        await rejected(client, ISSUE_NO_MONEY_POLL, [
          trust.enrollmentId,
          rejectedRequestId,
          `sha256:${digest()}`,
          new Date(Date.now() + 40_000).toISOString(),
          sharedSigner.rows[0]!.id,
        ]);
        expect(
          (
            await client.query(
              `select count(*)::text from ${POLL_CLAIMS_TABLE}
                where enrollment_id = $1::uuid and request_id = $2::uuid`,
              [trust.enrollmentId, rejectedRequestId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
        const requestId = randomUUID();
        const replayIdentity = `sha256:${digest()}`;
        const expiresAt = new Date(Date.now() + 40_000).toISOString();
        const input = [trust.enrollmentId, requestId, replayIdentity, expiresAt, trust.signerId];

        const issued = await client.query<{
          challenge_id: string;
          candidate_id: string;
          candidate_reference_ciphertext: string;
          device_enrollment_id: string;
          assignment_signer_id: string;
        }>(ISSUE_NO_MONEY_POLL, input);
        expect(issued.rows).toHaveLength(1);
        expect(issued.rows[0]).toMatchObject({
          candidate_id: candidateId,
          device_enrollment_id: trust.enrollmentId,
          assignment_signer_id: trust.signerId,
        });
        expect(issued.rows[0]!.candidate_reference_ciphertext).toMatch(/^v2\.telebirr\./u);
        expect(issued.rows[0]!.candidate_reference_ciphertext).not.toContain('FTAN12345678');
        expect(
          (
            await client.query(
              `select count(*)::text from ${POLL_CLAIMS_TABLE}
            where enrollment_id = $1::uuid`,
              [trust.enrollmentId],
            )
          ).rows,
        ).toEqual([{ count: '1' }]);

        await rejected(client, ISSUE_NO_MONEY_POLL, input);
        const second = await client.query(ISSUE_NO_MONEY_POLL, [
          trust.enrollmentId,
          randomUUID(),
          `sha256:${digest()}`,
          expiresAt,
          trust.signerId,
        ]);
        expect(second.rows).toEqual([]);
        expect(
          (
            await client.query(
              `select count(*)::text from ${LOOKUP_TABLE} where candidate_id = $1::uuid`,
              [candidateId],
            )
          ).rows,
        ).toEqual([{ count: '1' }]);
        expect(
          (
            await client.query(
              `select count(*)::text from ${POLL_CLAIMS_TABLE}
            where enrollment_id = $1::uuid`,
              [trust.enrollmentId],
            )
          ).rows,
        ).toEqual([{ count: '2' }]);

        await client.query('set local role service_role');
        await rejected(client, ISSUE_NO_MONEY_POLL, [
          trust.enrollmentId,
          randomUUID(),
          `sha256:${digest()}`,
          expiresAt,
          trust.signerId,
        ]);
        await client.query('reset role');
        expect(await snapshot(client)).toBe(financialBefore);
      });
    });

    it('removes expired no-money poll identifiers through the existing retention job', async () => {
      const client = getClient();
      await rollback(client, async () => {
        const actor = await fixtureTelegramActor(client, getOwnerAdminId());
        const playerId = await fixtureEligiblePlayer(client);
        await fixtureTelebirrReceiver(client);
        const captured = await client.query<CaptureRow>(CAPTURE, [
          ...captureArguments(await fixtureInboundEvent(client, actor.identityId), playerId),
        ]);
        const trust = await fixtureRoutineLookupTrust(client, captured.rows[0]!.proof_request_id);
        const requestId = randomUUID();
        await client.query(
          `insert into ${POLL_CLAIMS_TABLE}
          (enrollment_id, request_id, replay_identity, claimed_at, request_expires_at)
          values ($1::uuid, $2::uuid, $3::text,
            statement_timestamp() - interval '8 days',
            statement_timestamp() - interval '8 days' + interval '30 seconds')`,
          [trust.enrollmentId, requestId, `sha256:${digest()}`],
        );
        await client.query('select app.purge_expired_routine_telebirr_untrusted_proofs()');
        expect(
          (
            await client.query(
              `select count(*)::text from ${POLL_CLAIMS_TABLE}
          where request_id = $1::uuid`,
              [requestId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
      });
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

    it('grants only the private no-money capture RPC to Player actions', async () => {
      const client = getClient();
      const catalog = await client.query<{
        readonly owner: string;
        readonly security_definer: boolean;
        readonly search_path: string[];
        readonly public_allowed: boolean;
        readonly player_allowed: boolean;
        readonly runtime_allowed: boolean;
        readonly anon_allowed: boolean;
        readonly authenticated_allowed: boolean;
        readonly service_allowed: boolean;
        readonly unexpected_grants: number;
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
               pg_catalog.has_function_privilege(
                 'fetanagent_player_actions_runtime', routine.oid, 'execute'
               ) as runtime_allowed,
               pg_catalog.has_function_privilege('anon', routine.oid, 'execute')
                 as anon_allowed,
               pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute')
                 as authenticated_allowed,
               pg_catalog.has_function_privilege('service_role', routine.oid, 'execute')
                 as service_allowed,
               (
                 select count(*)::integer
                   from pg_catalog.aclexplode(
                     coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
                   ) privilege
                  where privilege.privilege_type = 'EXECUTE'
                    and privilege.grantee not in (
                      routine.proowner,
                      (select oid from pg_catalog.pg_roles
                        where rolname = 'fetanagent_player_actions')
                    )
               ) as unexpected_grants
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
          player_allowed: true,
          runtime_allowed: true,
          anon_allowed: false,
          authenticated_allowed: false,
          service_allowed: false,
          unexpected_grants: 0,
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

        await client.query('set local role anon');
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

    it('runs the staging API adapter with the exact durable Player-action grant', async () => {
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

        const exactPrivilege = await client.query<{ allowed: boolean }>(`
          select pg_catalog.has_function_privilege(
            'fetanagent_player_actions_runtime',
            'app.capture_telegram_routine_telebirr_untrusted_proof(
              uuid,text,text,text,text,text,smallint,smallint,text
            )', 'EXECUTE'
          ) as allowed
        `);
        expect(exactPrivilege.rows[0]!.allowed).toBe(true);
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
      expect(privilege.rows[0]!.allowed).toBe(true);
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
