import { createHash, randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  fixtureEligiblePlayer,
  fixtureInboundEvent,
  fixtureTelegramActor,
} from './routine-telebirr-untrusted-proof.suite.js';
import { persistentPolicyFixture } from './routine-telebirr-processing-policy.suite.js';

const recordSql = `select app.record_receiver_sms_payment_event(
  $1::text,$2::text,$3::text,$4::bigint,$5::timestamptz,$6::timestamptz,
  $7::timestamptz,$8::text,$9::text,$10::text,$11::text,$12::text,$13::integer) as outcome`;

function hexDigest(seed: string = randomUUID()): string {
  return createHash('sha256').update(seed).digest('hex');
}

async function fixtureCandidate(
  client: Client,
  fingerprint: string,
  submittedAt: string,
  providerCode: 'telebirr' | 'cbe_birr' = 'telebirr',
): Promise<string> {
  const actor = await fixtureTelegramActor(client, randomUUID(), false);
  const playerId = await fixtureEligiblePlayer(client, actor.customerId);
  const inboundId = await fixtureInboundEvent(client, actor.identityId);
  const player = await client.query<{ id: string; platform_id: string; customer_id: string }>(
    `select id, platform_id, customer_id from app.customer_platform_players where player_id = $1::text`,
    [playerId],
  );
  const eligibility = await client.query<{ id: string }>(
    `select id from app.player_deposit_eligibility_decisions
      where player_account_id = $1::uuid`,
    [player.rows[0]!.id],
  );
  const provider = await client.query<{ id: string }>(
    `select id from app.payment_providers where code = $1::text`,
    [providerCode],
  );
  const inserted = await client.query<{ id: string }>(
    `insert into app.receiver_sms_deposit_candidates (
      origin_inbound_event_id, origin_identity_id, submitting_customer_id,
      beneficiary_customer_id, platform_id, player_account_id,
      player_deposit_eligibility_decision_id,
      payment_provider_id, provider_code, reference_ciphertext,
      reference_fingerprint, reference_masked, reference_key_version,
      reference_profile_version, semantic_input_hmac, submitted_at
    ) values (
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
      $8::uuid,$9::text,$10::text,$11::text,'***ABCD',2,2,$12::text,$13::timestamptz
    ) returning id`,
    [
      inboundId,
      actor.identityId,
      actor.customerId,
      player.rows[0]!.customer_id,
      player.rows[0]!.platform_id,
      player.rows[0]!.id,
      eligibility.rows[0]!.id,
      provider.rows[0]!.id,
      providerCode,
      `v2.${providerCode}.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(11)}`,
      fingerprint,
      `hmac-sha256-v1:${hexDigest()}`,
      submittedAt,
    ],
  );
  return inserted.rows[0]!.id;
}

export async function fixturePaymentEvent(
  client: Client,
  fingerprint: string,
  occurredAt: string,
  providerCode: 'telebirr' | 'cbe_birr' = 'telebirr',
  amountMinor = 12500,
  receivedAt = occurredAt,
): Promise<string> {
  const receiver = await client.query<{ id: string; version: number; provider_id: string }>(
    `select receiver.id, receiver.version, receiver.provider_id
      from app.receiver_accounts receiver
      join app.payment_providers provider on provider.id = receiver.provider_id
      where provider.code = $1::text and receiver.status = 'active'
        and receiver.retired_at is null`,
    [providerCode],
  );
  expect(receiver.rows).toHaveLength(1);
  const deviceId = `device_${randomUUID().replaceAll('-', '')}`;
  const keyId = `key_${randomUUID().replaceAll('-', '')}`;
  const keyDigest = `sha256:${hexDigest()}`;
  const enrollment = await client.query<{ id: string }>(
    `insert into app.routine_telebirr_device_enrollments (
      pairing_evidence_digest, device_id, device_key_id,
      device_public_key_spki_sha256, receiver_account_id,
      receiver_account_version, receiver_profile_digest,
      expected_receiver_name_digest, valid_from, valid_until
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,
      pg_catalog.clock_timestamp() - interval '1 day',
      pg_catalog.clock_timestamp() + interval '1 day') returning id`,
    [
      `sha256:${hexDigest()}`,
      deviceId,
      keyId,
      keyDigest,
      receiver.rows[0]!.id,
      receiver.rows[0]!.version,
      `sha256:${hexDigest()}`,
      `sha256:${hexDigest()}`,
    ],
  );
  const event = await client.query<{ id: string }>(
    `insert into app.receiver_sms_payment_events (
      provider_code,payment_provider_id,receiver_account_id,receiver_account_version,
      reference_digest,reference_fingerprint,amount_minor,occurred_at,
      received_at,observed_at,source_message_digest,event_body_digest,
      source_subscription_id,device_enrollment_id,device_id,device_key_id,
      device_public_key_spki_sha256
    ) values ($13::text,$1::uuid,$2::uuid,$3::integer,$4::text,$5::text,
      $14::bigint,$6::timestamptz,$15::timestamptz,$15::timestamptz,$7::text,
      $8::text,1,$9::uuid,$10::text,$11::text,$12::text) returning id`,
    [
      receiver.rows[0]!.provider_id,
      receiver.rows[0]!.id,
      receiver.rows[0]!.version,
      `sha256:${hexDigest()}`,
      fingerprint,
      occurredAt,
      `sha256:${hexDigest()}`,
      `sha256:${hexDigest()}`,
      enrollment.rows[0]!.id,
      deviceId,
      keyId,
      keyDigest,
      providerCode,
      amountMinor,
      receivedAt,
    ],
  );
  return event.rows[0]!.id;
}

export function registerReceiverSmsPaymentLedgerSqlTests(
  getClient: () => Client,
  getOwner: () => string,
): void {
  describe('receiver SMS payment ledger', () => {
    it('keeps the CBE instruction receiver private and closed while SMS deposits are off', async () => {
      const client = getClient();
      const access = await client.query<{
        runtime_allowed: boolean;
        anonymous_denied: boolean;
        no_base_read: boolean;
      }>(`select
        pg_catalog.has_function_privilege('fetanagent_player_actions_runtime',
          'app.prepare_telegram_live_cbe_sms_destination(uuid,text)', 'EXECUTE')
          as runtime_allowed,
        not pg_catalog.has_function_privilege('anon',
          'app.prepare_telegram_live_cbe_sms_destination(uuid,text)', 'EXECUTE')
          as anonymous_denied,
        not pg_catalog.has_table_privilege('fetanagent_player_actions_runtime',
          'app.receiver_accounts', 'SELECT') as no_base_read`);
      expect(access.rows).toEqual([
        {
          runtime_allowed: true,
          anonymous_denied: true,
          no_base_read: true,
        },
      ]);
      await expect(
        client.query(
          `select * from app.prepare_telegram_live_cbe_sms_destination($1::uuid,$2::text)`,
          [randomUUID(), 'PLAYER-DEMO-42'],
        ),
      ).rejects.toThrow('CBE Birr destination is unavailable');
    });

    it('shows the active protected CBE receiver only for a selected eligible Player while SMS deposits are live', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const actor = await fixtureTelegramActor(client, randomUUID(), false);
        const playerId = await fixtureEligiblePlayer(client, actor.customerId);
        const inboundId = await fixtureInboundEvent(client, actor.identityId);
        const player = await client.query<{ id: string }>(
          `select id from app.customer_platform_players where player_id = $1::text`,
          [playerId],
        );
        await client.query(
          `insert into app.telegram_player_selections (
            telegram_identity_id, player_account_id, origin_inbound_event_id, selected_at
          ) values ($1::uuid,$2::uuid,$3::uuid,pg_catalog.clock_timestamp())`,
          [actor.identityId, player.rows[0]!.id, inboundId],
        );
        // The disposable bootstrap seeds a pre-protection CBE receiver. Upgrade
        // only that rolled-back fixture to exercise the current payable format.
        await client.query(
          `alter table app.receiver_accounts disable trigger receiver_accounts_immutable_revision`,
        );
        await client.query(
          `update app.receiver_accounts receiver
            set account_holder_name = 'Synthetic CBE Receiver',
              account_reference_ciphertext = $1::text,
              account_reference_masked = '***7002',
              account_reference_fingerprint = $2::text,
              protection_profile_version = 1, encryption_key_version = 1,
              fingerprint_key_version = 1,
              rotation_request_id = $3::uuid,
              rotation_reason = 'initial_configuration',
              active_from = pg_catalog.clock_timestamp() - interval '1 hour'
            from app.payment_providers provider
            where provider.id = receiver.provider_id and provider.code = 'cbe_birr'
              and receiver.status = 'active' and receiver.retired_at is null`,
          [
            `receiver-v1.cbe_birr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(16)}`,
            hexDigest(),
            randomUUID(),
          ],
        );
        await client.query(
          `alter table app.receiver_accounts enable trigger receiver_accounts_immutable_revision`,
        );
        await client.query(
          `update app.feature_switches set mode = 'live'
            where feature_key in ('payment_verification', 'deposit_execution',
              'cbe_birr_authoritative_verification')`,
        );
        await client.query(
          `update app.receiver_sms_route_control set enabled = true,
            cutover_at = pg_catalog.clock_timestamp() where singleton`,
        );
        const rows = await client.query<{
          provider_code: string;
          receiver_revision_id: string;
          receiver_account_reference_ciphertext: string;
          receiver_account_reference_fingerprint: string;
          receiver_account_masked: string;
          payments_enabled: boolean;
        }>(
          `select provider_code, receiver_revision_id,
            receiver_account_reference_ciphertext,
            receiver_account_reference_fingerprint,
            receiver_account_masked, payments_enabled
            from app.prepare_telegram_live_cbe_sms_destination($1::uuid,$2::text)`,
          [inboundId, playerId],
        );
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0]!.provider_code).toBe('cbe_birr');
        expect(rows.rows[0]!.receiver_revision_id).toMatch(/^[0-9a-f-]{36}$/u);
        expect(rows.rows[0]!.receiver_account_reference_ciphertext).toMatch(
          /^receiver-v1[.]cbe_birr[.]/u,
        );
        expect(rows.rows[0]!.receiver_account_reference_fingerprint).toMatch(/^[0-9a-f]{64}$/u);
        expect(rows.rows[0]!.receiver_account_masked).toMatch(/^\*{3}[0-9]{4}$/u);
        expect(rows.rows[0]!.payments_enabled).toBe(true);
        const otherPlayer = await fixtureEligiblePlayer(client, actor.customerId);
        await client.query('savepoint wrong_player');
        await expect(
          client.query(
            `select * from app.prepare_telegram_live_cbe_sms_destination($1::uuid,$2::text)`,
            [inboundId, otherPlayer],
          ),
        ).rejects.toThrow('CBE Birr destination is unavailable');
        await client.query('rollback to savepoint wrong_player');
      } finally {
        await client.query('rollback');
      }
    });

    it('keeps the paired-phone inbox private and unable to issue credit', async () => {
      const client = getClient();
      const roles = await client.query<{
        login: boolean;
        superuser: boolean;
        bypassrls: boolean;
        password_absent: boolean;
      }>(`select rolcanlogin as login, rolsuper as superuser,
          rolbypassrls as bypassrls, rolpassword is null as password_absent
        from pg_catalog.pg_authid
        where rolname = 'fetanagent_receiver_sms_ingest'`);
      expect(roles.rows).toEqual([
        {
          login: false,
          superuser: false,
          bypassrls: false,
          password_absent: true,
        },
      ]);
      const runtime = await client.query<{
        login: boolean;
        password_absent: boolean;
        inherited: boolean;
        can_read: boolean;
        can_credit: boolean;
      }>(`select role.rolcanlogin as login,
          role.rolpassword is null as password_absent,
          pg_catalog.pg_has_role(role.rolname,
            'fetanagent_receiver_sms_ingest', 'USAGE') as inherited,
          pg_catalog.has_table_privilege(role.rolname,
            'app.receiver_sms_payment_events', 'SELECT,INSERT,UPDATE,DELETE') as can_read,
          pg_catalog.has_function_privilege(role.rolname,
            'app.finalize_routine_telebirr_paid_observation(uuid)', 'EXECUTE') as can_credit
        from pg_catalog.pg_authid role
        where role.rolname = 'fetanagent_receiver_sms_ingest_runtime'`);
      expect(runtime.rows).toEqual([
        {
          login: false,
          password_absent: true,
          inherited: true,
          can_read: false,
          can_credit: false,
        },
      ]);
      const tables = await client.query<{
        name: string;
        rls: boolean;
        forced: boolean;
        owner: string;
      }>(`select relation.relname as name, relation.relrowsecurity as rls,
          relation.relforcerowsecurity as forced, owner.rolname as owner
        from pg_catalog.pg_class relation
        join pg_catalog.pg_roles owner on owner.oid = relation.relowner
        where relation.oid in ('app.receiver_sms_payment_events'::regclass,
          'app.receiver_sms_payment_conflicts'::regclass)
        order by relation.relname`);
      expect(tables.rows).toEqual([
        { name: 'receiver_sms_payment_conflicts', rls: true, forced: true, owner: 'postgres' },
        { name: 'receiver_sms_payment_events', rls: true, forced: true, owner: 'postgres' },
      ]);
      const access = await client.query<{
        can_record: boolean;
        can_load: boolean;
        can_read: boolean;
        can_credit: boolean;
      }>(`select
          pg_catalog.has_function_privilege('fetanagent_receiver_sms_ingest',
            'app.record_receiver_sms_payment_event(text,text,text,bigint,timestamptz,timestamptz,timestamptz,text,text,text,text,text,integer)',
            'EXECUTE') as can_record,
          pg_catalog.has_function_privilege('fetanagent_receiver_sms_ingest',
            'app.load_receiver_sms_device_enrollment(text)', 'EXECUTE') as can_load,
          pg_catalog.has_table_privilege('fetanagent_receiver_sms_ingest',
            'app.receiver_sms_payment_events', 'SELECT,INSERT,UPDATE,DELETE') as can_read,
          pg_catalog.has_function_privilege('fetanagent_receiver_sms_ingest',
            'app.finalize_routine_telebirr_paid_observation(uuid)', 'EXECUTE') as can_credit`);
      expect(access.rows).toEqual([
        {
          can_record: true,
          can_load: true,
          can_read: false,
          can_credit: false,
        },
      ]);
      const candidateGrant = await client.query<{ can_capture: boolean; route_enabled: boolean }>(
        `select pg_catalog.has_function_privilege('fetanagent_player_actions',
            'app.capture_telegram_receiver_sms_candidate(uuid,text,text,text,text,text,smallint,smallint,text)',
            'EXECUTE') as can_capture,
          (select enabled from app.receiver_sms_route_control where singleton) as route_enabled`,
      );
      expect(candidateGrant.rows).toEqual([{ can_capture: false, route_enabled: false }]);
      const settlementGrant = await client.query<{
        can_settle: boolean;
        can_finalize_directly: boolean;
        can_read_payment: boolean;
      }>(`select
          pg_catalog.has_function_privilege('fetanagent_receiver_sms_settlement_runtime',
            'app.settle_next_receiver_sms_match()', 'EXECUTE') as can_settle,
          pg_catalog.has_function_privilege('fetanagent_receiver_sms_settlement_runtime',
            'app.finalize_receiver_sms_match(uuid)', 'EXECUTE') as can_finalize_directly,
          pg_catalog.has_table_privilege('fetanagent_receiver_sms_settlement_runtime',
            'app.receiver_sms_payment_events', 'SELECT,INSERT,UPDATE,DELETE')
            as can_read_payment`);
      expect(settlementGrant.rows).toEqual([
        {
          can_settle: true,
          can_finalize_directly: false,
          can_read_payment: false,
        },
      ]);
    });

    it('does not accept a payment fact without a current paired phone', async () => {
      const client = getClient();
      const now = new Date().toISOString();
      const digest = (seed: string) =>
        `sha256:${seed.replaceAll('-', '').padEnd(64, '0').slice(0, 64)}`;
      await client.query('begin');
      try {
        await client.query('savepoint invalid_phone');
        await expect(
          client.query(recordSql, [
            'telebirr',
            digest(randomUUID()),
            'f'.repeat(64),
            2500,
            now,
            now,
            now,
            digest(randomUUID()),
            digest(randomUUID()),
            `device_${randomUUID().replaceAll('-', '')}`,
            `key_${randomUUID().replaceAll('-', '')}`,
            digest(randomUUID()),
            -1,
          ]),
        ).rejects.toThrow(/receiver SMS device is unavailable/u);
        await client.query('rollback to savepoint invalid_phone');
        const counts = await client.query<{ events: string; conflicts: string }>(
          `select (select count(*)::text from app.receiver_sms_payment_events) as events,
                  (select count(*)::text from app.receiver_sms_payment_conflicts) as conflicts`,
        );
        expect(counts.rows).toEqual([{ events: '0', conflicts: '0' }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('records one SMS once and quarantines conflicting facts for the same reference', async () => {
      const client = getClient();
      const digest = (seed: string) =>
        `sha256:${seed.replaceAll('-', '').padEnd(64, '0').slice(0, 64)}`;
      await client.query('begin');
      try {
        const receiver = await client.query<{ id: string; version: number }>(
          `select receiver.id, receiver.version
             from app.receiver_accounts receiver
             join app.payment_providers provider on provider.id = receiver.provider_id
            where provider.code = 'telebirr' and provider.status = 'active'
              and receiver.status = 'active' and receiver.retired_at is null`,
        );
        expect(receiver.rows).toHaveLength(1);
        const deviceId = `device_${randomUUID().replaceAll('-', '')}`;
        const keyId = `key_${randomUUID().replaceAll('-', '')}`;
        const keyDigest = digest(randomUUID());
        await client.query(
          `insert into app.routine_telebirr_device_enrollments (
            pairing_evidence_digest, device_id, device_key_id,
            device_public_key_spki_sha256, receiver_account_id,
            receiver_account_version, receiver_profile_digest,
            expected_receiver_name_digest, valid_from, valid_until
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,
            pg_catalog.clock_timestamp() - interval '1 minute',
            pg_catalog.clock_timestamp() + interval '1 day')`,
          [
            digest(randomUUID()),
            deviceId,
            keyId,
            keyDigest,
            receiver.rows[0]!.id,
            receiver.rows[0]!.version,
            digest(randomUUID()),
            digest(randomUUID()),
          ],
        );
        const now = new Date().toISOString();
        const reference = digest(randomUUID());
        const source = digest(randomUUID());
        const body = digest(randomUUID());
        const values = [
          'telebirr',
          reference,
          'f'.repeat(64),
          12_500,
          now,
          now,
          now,
          source,
          body,
          deviceId,
          keyId,
          keyDigest,
          1,
        ] as const;
        const first = await client.query<{ outcome: string }>(recordSql, [...values]);
        expect(first.rows).toEqual([{ outcome: 'recorded' }]);
        const replay = await client.query<{ outcome: string }>(recordSql, [
          ...values.slice(0, 8),
          digest(randomUUID()),
          ...values.slice(9),
        ]);
        expect(replay.rows).toEqual([{ outcome: 'exact_replay' }]);
        const conflict = await client.query<{ outcome: string }>(recordSql, [
          'telebirr',
          reference,
          'f'.repeat(64),
          12_600,
          now,
          now,
          now,
          digest(randomUUID()),
          digest(randomUUID()),
          deviceId,
          keyId,
          keyDigest,
          1,
        ]);
        expect(conflict.rows).toEqual([{ outcome: 'conflict' }]);
        const counts = await client.query<{ events: string; conflicts: string }>(
          `select (select count(*)::text from app.receiver_sms_payment_events) as events,
                  (select count(*)::text from app.receiver_sms_payment_conflicts) as conflicts`,
        );
        expect(counts.rows).toEqual([{ events: '1', conflicts: '1' }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('matches only after cutover and awards one SMS to the earliest submission', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const fingerprint = hexDigest();
        const first = await fixtureCandidate(client, fingerprint, new Date().toISOString());
        const event = await fixturePaymentEvent(client, fingerprint, new Date().toISOString());
        let matches = await client.query<{ candidate_id: string }>(
          `select candidate_id from app.receiver_sms_payment_matches`,
        );
        expect(matches.rows).toEqual([]);
        await client.query(
          `update app.receiver_sms_route_control set enabled = true,
            cutover_at = pg_catalog.clock_timestamp() - interval '1 day'
            where singleton`,
        );
        const result = await client.query<{ disposition: string }>(
          `select app.match_receiver_sms_payment('telebirr',$1::text) as disposition`,
          [fingerprint],
        );
        expect(result.rows).toEqual([{ disposition: 'ready' }]);
        const second = await fixtureCandidate(client, fingerprint, new Date().toISOString());
        expect(second).not.toBe(first);
        await client.query(`select app.match_receiver_sms_payment('telebirr',$1::text)`, [
          fingerprint,
        ]);
        matches = await client.query<{ candidate_id: string }>(
          `select candidate_id from app.receiver_sms_payment_matches
            where payment_event_id = $1::uuid`,
          [event],
        );
        expect(matches.rows).toEqual([{ candidate_id: first }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('holds a verified SMS payment older than one hour for Owner review', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await client.query(
          `update app.receiver_sms_route_control set enabled = true,
            cutover_at = pg_catalog.clock_timestamp() - interval '1 day'
            where singleton`,
        );
        const fingerprint = hexDigest();
        const candidate = await fixtureCandidate(client, fingerprint, new Date().toISOString());
        await fixturePaymentEvent(
          client,
          fingerprint,
          new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        );
        const matches = await client.query<{ candidate_id: string; disposition: string }>(
          `select candidate_id, disposition from app.receiver_sms_payment_matches`,
        );
        expect(matches.rows).toEqual([{ candidate_id: candidate, disposition: 'older_review' }]);
        const pendingNotice = await client.query<{
          notification_stage: string;
          outcome_code: string;
        }>(
          `select notification_stage, outcome_code
            from app.telegram_deposit_outcome_deliveries
            where candidate_id = $1::uuid`,
          [candidate],
        );
        expect(pendingNotice.rows).toEqual([
          { notification_stage: 'old_pending', outcome_code: 'older_pending' },
        ]);
        await client.query(
          `insert into app.receiver_sms_owner_decisions
            (candidate_id,payment_event_id,decision,actor_admin_id)
          select matched.candidate_id, matched.payment_event_id,
            'rejected', owner_user.id
          from app.receiver_sms_payment_matches matched
          cross join app.admin_users owner_user
          where matched.candidate_id = $1::uuid
            and owner_user.auth_user_id = $2::uuid`,
          [candidate, getOwner()],
        );
        const rejectedNotice = await client.query<{
          notification_stage: string;
          outcome_code: string;
        }>(
          `select notification_stage, outcome_code
            from app.telegram_deposit_outcome_deliveries
            where candidate_id = $1::uuid order by notification_stage`,
          [candidate],
        );
        expect(rejectedNotice.rows).toEqual([
          { notification_stage: 'final', outcome_code: 'old_rejected' },
          { notification_stage: 'old_pending', outcome_code: 'older_pending' },
        ]);
      } finally {
        await client.query('rollback');
      }
    });

    it('reserves an old signed SMS for manual credit without creating a claim or job', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await persistentPolicyFixture(
          client,
          getOwner(),
          new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
        );
        // Disposable fixture only: the seeded receiver must predate this
        // synthetic two-hour-old payment, as the real receiver does.
        await client.query(
          `alter table app.receiver_accounts disable trigger receiver_accounts_immutable_revision`,
        );
        await client.query(
          `update app.receiver_accounts receiver
            set active_from = pg_catalog.clock_timestamp() - interval '1 day'
            from app.payment_providers provider
            where provider.id = receiver.provider_id and provider.code = 'telebirr'
              and receiver.status = 'active' and receiver.retired_at is null`,
        );
        await client.query(
          `alter table app.receiver_accounts enable trigger receiver_accounts_immutable_revision`,
        );
        await client.query(
          `update app.feature_switches set mode = 'live'
            where feature_key in ('payment_verification','deposit_execution')`,
        );
        await client.query(
          `update app.receiver_sms_route_control set enabled = true,
            cutover_at = pg_catalog.clock_timestamp() - interval '1 day'
            where singleton`,
        );
        const fingerprint = hexDigest();
        const candidate = await fixtureCandidate(client, fingerprint, new Date().toISOString());
        await client.query(
          `update app.inbound_events inbound set processed_at = candidate.submitted_at
            from app.receiver_sms_deposit_candidates candidate
            where inbound.id = candidate.origin_inbound_event_id
              and candidate.id = $1::uuid`,
          [candidate],
        );
        await fixturePaymentEvent(
          client,
          fingerprint,
          new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
        );
        expect(
          (
            await client.query<{ outcome: string }>(
              `select app.settle_next_receiver_sms_match() as outcome`,
            )
          ).rows,
        ).toEqual([{ outcome: 'empty' }]);
        await client.query('set session authorization fetanagent_owner_control_runtime');
        const list = await client.query<{ candidate_id: string; reference_masked: string }>(
          `select candidate_id, reference_masked
            from app.list_owner_manual_payment_cases($1::uuid,'pending',25,0)`,
          [getOwner()],
        );
        expect(list.rows).toContainEqual({ candidate_id: candidate, reference_masked: '***ABCD' });
        const decided = await client.query<{ decision: { caseId: string; status: string } }>(
          `select app.decide_owner_manual_payment_case(
            $1::uuid,$2::uuid,'approve',null) as decision`,
          [getOwner(), candidate],
        );
        expect(decided.rows[0]?.decision.status).toBe('awaiting_manual_credit');
        const manualCaseId = decided.rows[0]!.decision.caseId;
        expect(
          (
            await client.query<{ completed: { status: string } }>(
              `select app.complete_owner_manual_payment_case(
            $1::uuid,$2::uuid,null,null,null,false,true) as completed`,
              [getOwner(), manualCaseId],
            )
          ).rows[0]?.completed.status,
        ).toBe('manually_credited');
        await client.query('reset session authorization');
        const lineage = await client.query<{
          jobs: string;
          claims: string;
          notifications: string;
        }>(
          `select
            (select count(*)::text from app.receiver_sms_settlement_lineages
              where candidate_id = $1::uuid) as jobs,
            (select count(*)::text from app.deposit_payment_claims claim
              join app.receiver_sms_intent_openings opening
                on opening.deposit_intent_id = claim.deposit_intent_id
              where opening.candidate_id = $1::uuid) as claims,
            (select count(*)::text from app.telegram_deposit_outcome_deliveries delivery
              where delivery.candidate_id = $1::uuid
                and delivery.notification_stage = 'manual_final'
                and delivery.outcome_code = 'credited') as notifications`,
          [candidate],
        );
        expect(lineage.rows).toEqual([{ jobs: '0', claims: '0', notifications: '1' }]);
        expect(
          (
            await client.query<{ outcome: string }>(
              `select app.settle_next_receiver_sms_match() as outcome`,
            )
          ).rows,
        ).toEqual([{ outcome: 'empty' }]);
      } finally {
        await client.query('reset session authorization').catch(() => undefined);
        await client.query('rollback');
      }
    });

    it('requires an Owner amount and receiving account for manual completion without SMS', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const fingerprint = hexDigest();
        const candidate = await fixtureCandidate(client, fingerprint, new Date().toISOString());
        const receiver = await client.query<{ id: string }>(
          `select receiver.id from app.receiver_accounts receiver
            join app.payment_providers provider on provider.id = receiver.provider_id
            where provider.code = 'telebirr' and receiver.status = 'active'
              and receiver.retired_at is null`,
        );
        expect(receiver.rows).toHaveLength(1);
        await client.query('set session authorization fetanagent_owner_control_runtime');
        const approved = await client.query<{ decision: { caseId: string; status: string } }>(
          `select app.decide_owner_manual_payment_case(
            $1::uuid,$2::uuid,'approve',null) as decision`,
          [getOwner(), candidate],
        );
        expect(approved.rows[0]?.decision.status).toBe('awaiting_manual_credit');
        const caseId = approved.rows[0]!.decision.caseId;
        const completed = await client.query<{ result: { status: string } }>(
          `select app.complete_owner_manual_payment_case(
            $1::uuid,$2::uuid,null,3300,$3::uuid,true,true) as result`,
          [getOwner(), caseId, receiver.rows[0]!.id],
        );
        expect(completed.rows[0]?.result.status).toBe('manually_credited');
        const replay = await client.query<{ result: { caseId: string } }>(
          `select app.complete_owner_manual_payment_case(
            $1::uuid,$2::uuid,null,3300,$3::uuid,true,true) as result`,
          [getOwner(), caseId, receiver.rows[0]!.id],
        );
        expect(replay.rows[0]?.result.caseId).toBe(caseId);
        await client.query('reset session authorization');
        await client.query('savepoint blocked_automatic_evidence');
        await expect(
          client.query(
            `insert into app.provider_payment_evidence (
            payment_provider_id,canonical_reference_ciphertext,
            canonical_reference_fingerprint,canonical_reference_masked,
            reference_encryption_key_version,evidence_source,amount_minor,
            occurred_at,evidence_digest,adapter_version,normalization_version,
            retrieved_at
          ) values (
            (select id from app.payment_providers where code='telebirr'),
            'synthetic-ciphertext',$1::text,'***ABCD',2,
            'provider_receipt_lookup',3300,pg_catalog.clock_timestamp(),
            $2::text,'synthetic_test','synthetic_test',pg_catalog.clock_timestamp()
          )`,
            [fingerprint, `sha256:${hexDigest()}`],
          ),
        ).rejects.toThrow('reserved for Owner resolution');
        await client.query('rollback to savepoint blocked_automatic_evidence');
        const snapshot = await client.query<{
          jobs: string;
          notifications: string;
          evidence: string;
        }>(
          `select
            (select count(*)::text from app.receiver_sms_settlement_lineages
              where candidate_id = $1::uuid) as jobs,
            (select count(*)::text from app.telegram_deposit_outcome_deliveries
              where candidate_id = $1::uuid and notification_stage = 'manual_final'
                and outcome_code = 'credited' and amount_minor = 3300) as notifications,
            (select count(*)::text from app.provider_payment_evidence evidence
              join app.payment_providers provider on provider.id = evidence.payment_provider_id
              where provider.code = 'telebirr'
                and evidence.canonical_reference_fingerprint = $2::text) as evidence`,
          [candidate, fingerprint],
        );
        expect(snapshot.rows).toEqual([{ jobs: '0', notifications: '1', evidence: '0' }]);
      } finally {
        await client.query('reset session authorization').catch(() => undefined);
        await client.query('rollback');
      }
    });

    it('lets the Owner consume an unmatched signed SMS without a Player link', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await client.query(
          `update app.receiver_sms_route_control set enabled = true,
            cutover_at = pg_catalog.clock_timestamp() - interval '1 day'
            where singleton`,
        );
        const fingerprint = hexDigest();
        const event = await fixturePaymentEvent(client, fingerprint, new Date().toISOString());
        const inboxGrant = await client.query<{ owner_allowed: boolean; public_denied: boolean }>(
          `select has_function_privilege('fetanagent_owner_control_runtime',
              'app.list_owner_receiver_sms_inbox_filtered(uuid,text,text,text,date,date,integer,integer)',
              'EXECUTE') as owner_allowed,
            not has_function_privilege('anon',
              'app.list_owner_receiver_sms_inbox_filtered(uuid,text,text,text,date,date,integer,integer)',
              'EXECUTE') as public_denied`,
        );
        expect(inboxGrant.rows).toEqual([{ owner_allowed: true, public_denied: true }]);
        const overviewGrant = await client.query<{
          owner_allowed: boolean;
          public_denied: boolean;
        }>(
          `select has_function_privilege('fetanagent_owner_control_runtime',
              'app.get_owner_system_overview(uuid)', 'EXECUTE') as owner_allowed,
            not has_function_privilege('anon',
              'app.get_owner_system_overview(uuid)', 'EXECUTE') as public_denied`,
        );
        expect(overviewGrant.rows).toEqual([{ owner_allowed: true, public_denied: true }]);
        await client.query('set session authorization fetanagent_owner_control_runtime');
        const overview = await client.query<{
          snapshot: {
            telebirrSmsLastReceivedAt: string | null;
            openDepositJobs: number;
            awaitingManualCredits: number;
          };
        }>('select app.get_owner_system_overview($1::uuid) as snapshot', [getOwner()]);
        expect(Date.parse(overview.rows[0]!.snapshot.telebirrSmsLastReceivedAt!)).not.toBeNaN();
        expect(overview.rows[0]!.snapshot.openDepositJobs).toBeGreaterThanOrEqual(0);
        expect(overview.rows[0]!.snapshot.awaitingManualCredits).toBeGreaterThanOrEqual(0);
        const inbox = await client.query<{
          payment_event_id: string;
          reference_masked: string | null;
          can_mark_manually_credited: boolean;
        }>(
          `select payment_event_id,reference_masked,can_mark_manually_credited
            from app.list_owner_receiver_sms_inbox($1::uuid,25,0)
            where payment_event_id = $2::uuid`,
          [getOwner(), event],
        );
        expect(inbox.rows).toEqual([
          { payment_event_id: event, reference_masked: null, can_mark_manually_credited: true },
        ]);
        const filtered = await client.query<{ payment_event_id: string }>(
          `select payment_event_id from app.list_owner_receiver_sms_inbox_filtered(
            $1::uuid,'telebirr','unmatched',null,null,null,25,0)
            where payment_event_id = $2::uuid`,
          [getOwner(), event],
        );
        expect(filtered.rows).toEqual([{ payment_event_id: event }]);
        for (const filters of [
          ['cbe_birr', 'unmatched', null, null, null],
          ['telebirr', 'manually_credited', null, null, null],
          ['telebirr', 'unmatched', 'ABCD', null, null],
          ['telebirr', 'unmatched', null, '2099-01-01', '2099-01-01'],
        ] as const) {
          const excluded = await client.query<{ payment_event_id: string }>(
            `select payment_event_id from app.list_owner_receiver_sms_inbox_filtered(
              $1::uuid,$2::text,$3::text,$4::text,$5::date,$6::date,25,0)
              where payment_event_id = $7::uuid`,
            [getOwner(), ...filters, event],
          );
          expect(excluded.rows).toEqual([]);
        }
        const completed = await client.query<{ result: { status: string } }>(
          `select app.complete_owner_manual_payment_case(
            $1::uuid,null,$2::uuid,null,null,false,true) as result`,
          [getOwner(), event],
        );
        expect(completed.rows[0]?.result.status).toBe('manually_credited');
        const completedInbox = await client.query<{ payment_event_id: string }>(
          `select payment_event_id from app.list_owner_receiver_sms_inbox_filtered(
            $1::uuid,'telebirr','manually_credited',null,null,null,25,0)
            where payment_event_id = $2::uuid`,
          [getOwner(), event],
        );
        expect(completedInbox.rows).toEqual([{ payment_event_id: event }]);
        await client.query('reset session authorization');
        const outcome = await client.query<{ status: string }>(
          `select app.match_receiver_sms_payment('telebirr',$1::text) as status`,
          [fingerprint],
        );
        expect(outcome.rows).toEqual([{ status: 'owner_review' }]);
        const notifications = await client.query<{ count: string }>(
          `select count(*)::text as count from app.telegram_deposit_outcome_deliveries
            where notification_stage = 'manual_final' and reference_masked = '***ABCD'`,
        );
        expect(notifications.rows).toEqual([{ count: '0' }]);
      } finally {
        await client.query('reset session authorization').catch(() => undefined);
        await client.query('rollback');
      }
    });

    it('approves before outside credit and queues the normal customer success message atomically', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const fingerprint = hexDigest();
        const candidate = await fixtureCandidate(client, fingerprint, new Date().toISOString());
        const account = await client.query<{ id: string; player_id: string }>(
          `select receiver.id, player.player_id from app.receiver_sms_deposit_candidates candidate
            join app.customer_platform_players player on player.id = candidate.player_account_id
            join app.receiver_accounts receiver on receiver.provider_id = candidate.payment_provider_id
            where candidate.id = $1::uuid and receiver.status = 'active'
              and receiver.retired_at is null`,
          [candidate],
        );
        expect(account.rows).toHaveLength(1);
        await client.query('set session authorization fetanagent_owner_control_runtime');
        const pending = await client.query<{
          player_id: string;
          payment_status: string;
          can_approve: boolean;
        }>(
          `select player_id,payment_status,can_approve
            from app.list_owner_submitted_payments($1::uuid,'pending',25,0)
            where candidate_id = $2::uuid`,
          [getOwner(), candidate],
        );
        expect(pending.rows).toEqual([
          {
            player_id: account.rows[0]!.player_id,
            payment_status: 'pending',
            can_approve: true,
          },
        ]);
        await client.query('savepoint incomplete_approval');
        await expect(
          client.query(
            `select app.approve_owner_manual_payment_for_immediate_credit(
            $1::uuid,$2::uuid,3300,$3::uuid,false)`,
            [getOwner(), candidate, account.rows[0]!.id],
          ),
        ).rejects.toThrow('bank confirmation');
        await client.query('rollback to savepoint incomplete_approval');
        const approved = await client.query<{ result: { status: string } }>(
          `select app.approve_owner_manual_payment_for_immediate_credit(
            $1::uuid,$2::uuid,3300,$3::uuid,true) as result`,
          [getOwner(), candidate, account.rows[0]!.id],
        );
        expect(approved.rows[0]?.result.status).toBe('manually_credited');
        const listed = await client.query<{ payment_status: string; can_approve: boolean }>(
          `select payment_status,can_approve
            from app.list_owner_submitted_payments($1::uuid,'approved',25,0)
            where candidate_id = $2::uuid`,
          [getOwner(), candidate],
        );
        expect(listed.rows).toEqual([{ payment_status: 'approved', can_approve: false }]);
        await client.query('reset session authorization');
        const fences = await client.query<{
          jobs: string;
          cases: string;
          customer_notice: string;
        }>(
          `select
            (select count(*)::text from app.receiver_sms_settlement_lineages
              where candidate_id=$1::uuid) as jobs,
            (select count(*)::text from app.owner_manual_payment_cases
              where candidate_id=$1::uuid and status='manually_credited') as cases,
            (select count(*)::text from app.telegram_deposit_outcome_deliveries
              where candidate_id=$1::uuid and notification_stage='manual_final'
                and outcome_code='credited' and amount_minor=3300
                and status='pending') as customer_notice`,
          [candidate],
        );
        expect(fences.rows).toEqual([{ jobs: '0', cases: '1', customer_notice: '1' }]);
      } finally {
        await client.query('reset session authorization').catch(() => undefined);
        await client.query('rollback');
      }
    });

    it('records a later manual credit correction while retaining the rejected audit reason', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const candidate = await fixtureCandidate(client, hexDigest(), new Date().toISOString());
        const receiver = await client.query<{ id: string }>(
          `select receiver.id from app.receiver_accounts receiver
            join app.payment_providers provider on provider.id = receiver.provider_id
            where provider.code = 'telebirr' and receiver.status = 'active'
              and receiver.retired_at is null`,
        );
        expect(receiver.rows).toHaveLength(1);
        await client.query('set session authorization fetanagent_owner_control_runtime');
        const rejected = await client.query<{ decision: { caseId: string; status: string } }>(
          `select app.decide_owner_manual_payment_case(
            $1::uuid,$2::uuid,'reject','Confirmed payment needed') as decision`,
          [getOwner(), candidate],
        );
        expect(rejected.rows[0]?.decision.status).toBe('rejected');
        const caseId = rejected.rows[0]!.decision.caseId;
        const corrected = await client.query<{ result: { status: string } }>(
          `select app.complete_owner_manual_payment_case(
            $1::uuid,$2::uuid,null,3300,$3::uuid,true,true) as result`,
          [getOwner(), caseId, receiver.rows[0]!.id],
        );
        expect(corrected.rows[0]?.result.status).toBe('manually_credited');
        await client.query('reset session authorization');
        const audit = await client.query<{
          status: string;
          rejection_reason: string;
          rejected_delivery: string;
          correction_delivery: string;
          jobs: string;
        }>(
          `select owner_case.status,owner_case.rejection_reason,
            (select outcome_code from app.telegram_deposit_outcome_deliveries
              where candidate_id=$2::uuid and notification_stage='manual_final')
              as rejected_delivery,
            (select outcome_code from app.telegram_deposit_outcome_deliveries
              where candidate_id=$2::uuid and notification_stage='manual_correction')
              as correction_delivery,
            (select count(*)::text from app.receiver_sms_settlement_lineages
              where candidate_id=$2::uuid) as jobs
            from app.owner_manual_payment_cases owner_case where owner_case.id=$1::uuid`,
          [caseId, candidate],
        );
        expect(audit.rows).toEqual([
          {
            status: 'manually_credited',
            rejection_reason: 'Confirmed payment needed',
            rejected_delivery: 'rejected',
            correction_delivery: 'credited',
            jobs: '0',
          },
        ]);
      } finally {
        await client.query('reset session authorization').catch(() => undefined);
        await client.query('rollback');
      }
    });

    it('holds a submission after five minutes with no phone SMS and never guesses invalid', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await client.query(
          `update app.receiver_sms_route_control set enabled = true,
            cutover_at = pg_catalog.clock_timestamp() - interval '1 day'
            where singleton`,
        );
        const candidate = await fixtureCandidate(
          client,
          hexDigest(),
          new Date(Date.now() - 6 * 60_000).toISOString(),
        );
        expect(
          (
            await client.query<{ outcome: string }>(
              `select app.settle_next_receiver_sms_match() as outcome`,
            )
          ).rows,
        ).toEqual([{ outcome: 'held_review' }]);
        expect(
          (
            await client.query<{ reason_code: string }>(
              `select reason_code from app.receiver_sms_settlement_holds
            where candidate_id = $1::uuid`,
              [candidate],
            )
          ).rows,
        ).toEqual([{ reason_code: 'no_receiver_sms_after_5m' }]);
        const heldNotice = await client.query<{ outcome_code: string }>(
          `select outcome_code from app.telegram_deposit_outcome_deliveries
            where candidate_id = $1::uuid and notification_stage = 'final'`,
          [candidate],
        );
        expect(heldNotice.rows).toEqual([{ outcome_code: 'held_review' }]);
        await client.query(
          `grant execute on function app.list_owner_receiver_sms_old_payments(uuid,integer)
            to fetanagent_owner_control`,
        );
        await client.query('set session authorization fetanagent_owner_control_runtime');
        const ownerReview = await client.query<{
          candidate_id: string;
          review_kind: string;
          reason_code: string;
          payment_at: Date | null;
          amount_minor: string | null;
        }>(
          `select candidate_id, review_kind, reason_code, payment_at,
              amount_minor::text as amount_minor
            from app.list_owner_receiver_sms_old_payments($1::uuid,25)`,
          [getOwner()],
        );
        expect(ownerReview.rows).toContainEqual({
          candidate_id: candidate,
          review_kind: 'held_review',
          reason_code: 'no_receiver_sms_after_5m',
          payment_at: null,
          amount_minor: null,
        });
        await client.query('reset session authorization');
        expect(
          (
            await client.query<{ outcome: string }>(
              `select app.settle_next_receiver_sms_match() as outcome`,
            )
          ).rows,
        ).toEqual([{ outcome: 'empty' }]);
      } finally {
        await client.query('reset session authorization').catch(() => undefined);
        await client.query('rollback');
      }
    });

    it('binds a cross-customer submission to the selected eligible Player for one ordinary job', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await persistentPolicyFixture(client, getOwner());
        await client.query(
          `update app.feature_switches set mode = 'live'
            where feature_key in ('payment_verification','deposit_execution')`,
        );
        await client.query(
          `update app.receiver_sms_route_control set enabled = true,
            cutover_at = pg_catalog.clock_timestamp() - interval '1 day'
            where singleton`,
        );
        const submitter = await fixtureTelegramActor(client, randomUUID(), false);
        const selectedPlayerId = await fixtureEligiblePlayer(client);
        const selectedPlayer = await client.query<{ customer_id: string }>(
          `select customer_id from app.customer_platform_players where player_id = $1::text`,
          [selectedPlayerId],
        );
        expect(selectedPlayer.rows[0]!.customer_id).not.toBe(submitter.customerId);
        const inboundId = await fixtureInboundEvent(client, submitter.identityId);
        const fingerprint = hexDigest();
        const captured = await client.query<{ candidate_id: string; proof_status: string }>(
          `select candidate_id, proof_status
            from app.capture_telegram_receiver_sms_candidate(
              $1::uuid,$2::text,'telebirr',$3::text,$4::text,
              '***ABCD',2::smallint,2::smallint,$5::text)`,
          [
            inboundId,
            selectedPlayerId,
            `v2.telebirr.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(11)}`,
            fingerprint,
            `hmac-sha256-v1:${hexDigest()}`,
          ],
        );
        expect(captured.rows).toHaveLength(1);
        const candidateId = captured.rows[0]!.candidate_id;
        await fixturePaymentEvent(client, fingerprint, new Date().toISOString());
        const queued = await client.query<{ outcome: string }>(
          `select app.settle_next_receiver_sms_match() as outcome`,
        );
        expect(queued.rows).toEqual([{ outcome: 'queued' }]);
        const binding = await client.query<{
          submitting_customer_id: string;
          beneficiary_customer_id: string;
          intent_customer_id: string;
          admissible: string;
        }>(
          `select candidate.submitting_customer_id,
              candidate.beneficiary_customer_id,
              intent.customer_id as intent_customer_id,
              (select count(*)::text
                 from app.assess_routine_telebirr_execution_job(lineage.execution_job_id))
                as admissible
            from app.receiver_sms_deposit_candidates candidate
            join app.receiver_sms_settlement_lineages lineage
              on lineage.candidate_id = candidate.id
            join app.deposit_intents intent on intent.id = lineage.deposit_intent_id
            where candidate.id = $1::uuid`,
          [candidateId],
        );
        expect(binding.rows).toEqual([
          {
            submitting_customer_id: submitter.customerId,
            beneficiary_customer_id: selectedPlayer.rows[0]!.customer_id,
            intent_customer_id: selectedPlayer.rows[0]!.customer_id,
            admissible: '1',
          },
        ]);
        expect(
          (
            await client.query<{ outcome: string }>(
              `select app.settle_next_receiver_sms_match() as outcome`,
            )
          ).rows,
        ).toEqual([{ outcome: 'empty' }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('turns one matched SMS into one fenced claim and job, then replays without a second credit', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await persistentPolicyFixture(client, getOwner());
        await client.query(
          `update app.feature_switches set mode = 'live'
            where feature_key in ('payment_verification','deposit_execution')`,
        );
        await client.query(
          `update app.receiver_sms_route_control set enabled = true,
            cutover_at = pg_catalog.clock_timestamp() - interval '1 day'
            where singleton`,
        );
        const fingerprint = hexDigest();
        const candidate = await fixtureCandidate(client, fingerprint, new Date().toISOString());
        await client.query(
          `update app.inbound_events inbound set processed_at = candidate.submitted_at
            from app.receiver_sms_deposit_candidates candidate
            where inbound.id = candidate.origin_inbound_event_id
              and candidate.id = $1::uuid`,
          [candidate],
        );
        const event = await fixturePaymentEvent(client, fingerprint, new Date().toISOString());
        const dispatched = await client.query<{ outcome: string }>(
          `select app.settle_next_receiver_sms_match() as outcome`,
        );
        expect(dispatched.rows).toEqual([{ outcome: 'queued' }]);
        const first = await client.query<{
          deposit_intent_id: string;
          payment_claim_id: string;
          execution_job_id: string;
          already_finalized: boolean;
        }>(`select * from app.finalize_receiver_sms_match($1::uuid)`, [candidate]);
        expect(first.rows).toHaveLength(1);
        expect(first.rows[0]?.already_finalized).toBe(true);
        const replay = await client.query(
          `select * from app.finalize_receiver_sms_match($1::uuid)`,
          [candidate],
        );
        expect(replay.rows).toEqual([first.rows[0]]);
        const exhausted = await client.query<{ outcome: string }>(
          `select app.settle_next_receiver_sms_match() as outcome`,
        );
        expect(exhausted.rows).toEqual([{ outcome: 'empty' }]);
        const lineage = await client.query<{
          provider: string;
          amount_minor: string;
          intent_status: string;
          job_status: string;
          admissible: string;
        }>(
          `select provider.code as provider, evidence.amount_minor::text,
              intent.status as intent_status, job.status as job_status,
              (select count(*)::text from app.assess_routine_telebirr_execution_job(job.id))
                as admissible
            from app.receiver_sms_settlement_lineages lineage
            join app.deposit_intents intent on intent.id = lineage.deposit_intent_id
            join app.deposit_jobs job on job.id = lineage.execution_job_id
            join app.provider_payment_evidence evidence
              on evidence.id = lineage.provider_payment_evidence_id
            join app.payment_providers provider on provider.id = evidence.payment_provider_id
            where lineage.candidate_id = $1::uuid`,
          [candidate],
        );
        expect(lineage.rows).toEqual([
          {
            provider: 'telebirr',
            amount_minor: '12500',
            intent_status: 'execution_pending',
            job_status: 'queued',
            admissible: '1',
          },
        ]);
        await client.query('set session authorization fetanagent_owner_control_runtime');
        const activeInbox = await client.query<{ can_mark_manually_credited: boolean }>(
          `select can_mark_manually_credited from app.list_owner_receiver_sms_inbox(
            $1::uuid,25,0) where payment_event_id=$2::uuid`,
          [getOwner(), event],
        );
        expect(activeInbox.rows).toEqual([{ can_mark_manually_credited: false }]);
        await client.query('reset session authorization');
        await client.query(
          `update app.deposit_jobs set status='cancelled',completed_at=clock_timestamp()
            where id=$1::uuid`,
          [first.rows[0]!.execution_job_id],
        );
        await client.query(
          `update app.deposit_intents set status='execution_review'
            where id=$1::uuid`,
          [first.rows[0]!.deposit_intent_id],
        );
        await client.query(
          `update app.deposit_intents
            set status='rejected',rejection_reason_code='owner_manual_resolution'
            where id=$1::uuid`,
          [first.rows[0]!.deposit_intent_id],
        );
        await client.query('set session authorization fetanagent_owner_control_runtime');
        const terminalInbox = await client.query<{ can_mark_manually_credited: boolean }>(
          `select can_mark_manually_credited from app.list_owner_receiver_sms_inbox(
            $1::uuid,25,0) where payment_event_id=$2::uuid`,
          [getOwner(), event],
        );
        expect(terminalInbox.rows).toEqual([{ can_mark_manually_credited: true }]);
        const marked = await client.query<{ result: { status: string } }>(
          `select app.complete_owner_manual_payment_case(
            $1::uuid,null,$2::uuid,null,null,false,true) as result`,
          [getOwner(), event],
        );
        expect(marked.rows[0]!.result.status).toBe('manually_credited');
        await client.query('reset session authorization');
        const manualResult = await client.query<{
          linked_candidate: string;
          jobs: string;
          notice: string;
        }>(
          `select owner_case.candidate_id as linked_candidate,
            (select count(*)::text from app.deposit_jobs job
              where job.deposit_intent_id=$2::uuid and job.status='cancelled') as jobs,
            (select outcome_code from app.telegram_deposit_outcome_deliveries delivery
              where delivery.candidate_id=$3::uuid
                and delivery.notification_stage='manual_final') as notice
            from app.owner_manual_payment_cases owner_case
            where owner_case.payment_event_id=$1::uuid`,
          [event, first.rows[0]!.deposit_intent_id, candidate],
        );
        expect(manualResult.rows).toEqual([
          {
            linked_candidate: candidate,
            jobs: '1',
            notice: 'credited',
          },
        ]);
      } finally {
        await client.query('rollback');
      }
    });

    it('uses the CBE Birr SMS amount for its one protected claim and job', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await persistentPolicyFixture(client, getOwner());
        await client.query(
          `update app.feature_switches set mode = 'live'
            where feature_key in ('payment_verification','deposit_execution',
              'cbe_birr_authoritative_verification')`,
        );
        await client.query(
          `update app.receiver_sms_route_control set enabled = true,
            cutover_at = pg_catalog.clock_timestamp() - interval '1 day'
            where singleton`,
        );
        const fingerprint = hexDigest();
        const candidate = await fixtureCandidate(
          client,
          fingerprint,
          new Date().toISOString(),
          'cbe_birr',
        );
        await client.query(
          `update app.inbound_events inbound set processed_at = candidate.submitted_at
            from app.receiver_sms_deposit_candidates candidate
            where inbound.id = candidate.origin_inbound_event_id
              and candidate.id = $1::uuid`,
          [candidate],
        );
        await fixturePaymentEvent(client, fingerprint, new Date().toISOString(), 'cbe_birr');
        const queued = await client.query<{ outcome: string }>(
          `select app.settle_next_receiver_sms_match() as outcome`,
        );
        expect(queued.rows).toEqual([{ outcome: 'queued' }]);
        const lineage = await client.query<{ provider: string; amount_minor: string }>(
          `select provider.code as provider, evidence.amount_minor::text
            from app.receiver_sms_settlement_lineages lineage
            join app.provider_payment_evidence evidence
              on evidence.id = lineage.provider_payment_evidence_id
            join app.payment_providers provider on provider.id = evidence.payment_provider_id
            where lineage.candidate_id = $1::uuid`,
          [candidate],
        );
        expect(lineage.rows).toEqual([{ provider: 'cbe_birr', amount_minor: '12500' }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('holds a matched SMS when financial gates are not live, with no claim or job', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await client.query(
          `update app.receiver_sms_route_control set enabled = true,
            cutover_at = pg_catalog.clock_timestamp() - interval '1 day'
            where singleton`,
        );
        const fingerprint = hexDigest();
        const candidate = await fixtureCandidate(client, fingerprint, new Date().toISOString());
        await fixturePaymentEvent(client, fingerprint, new Date().toISOString());
        const first = await client.query<{ outcome: string }>(
          `select app.settle_next_receiver_sms_match() as outcome`,
        );
        expect(first.rows).toEqual([{ outcome: 'held_review' }]);
        const snapshot = await client.query<{
          holds: string;
          lineages: string;
          claims: string;
          jobs: string;
        }>(
          `select
            (select count(*)::text from app.receiver_sms_settlement_holds
              where candidate_id=$1::uuid) as holds,
            (select count(*)::text from app.receiver_sms_settlement_lineages
              where candidate_id=$1::uuid) as lineages,
            (select count(*)::text from app.deposit_payment_claims claim
              join app.receiver_sms_intent_openings opening
                on opening.deposit_intent_id=claim.deposit_intent_id
              where opening.candidate_id=$1::uuid) as claims,
            (select count(*)::text from app.deposit_jobs job
              join app.receiver_sms_intent_openings opening
                on opening.deposit_intent_id=job.deposit_intent_id
              where opening.candidate_id=$1::uuid) as jobs`,
          [candidate],
        );
        expect(snapshot.rows).toEqual([{ holds: '1', lineages: '0', claims: '0', jobs: '0' }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('resumes at a fresh cutoff without holding or crediting old submissions', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await persistentPolicyFixture(client, getOwner());
        await client.query(
          `update app.feature_switches set mode = 'live'
            where feature_key in ('payment_verification','deposit_execution')`,
        );
        await client.query(
          `update app.receiver_sms_route_control set enabled = true,
            cutover_at = pg_catalog.clock_timestamp() - interval '1 day'
            where singleton`,
        );
        const oldUnmatched = await fixtureCandidate(
          client,
          hexDigest(),
          new Date(Date.now() - 6 * 60_000).toISOString(),
        );
        const oldFingerprint = hexDigest();
        const oldTime = (
          await client.query<{ at: string }>(`select pg_catalog.clock_timestamp()::text as at`)
        ).rows[0]!.at;
        const oldReady = await fixtureCandidate(client, oldFingerprint, oldTime);
        await fixturePaymentEvent(client, oldFingerprint, oldTime);
        expect(
          (
            await client.query<{ disposition: string }>(
              `select disposition from app.receiver_sms_payment_matches
                where candidate_id = $1::uuid`,
              [oldReady],
            )
          ).rows,
        ).toEqual([{ disposition: 'ready' }]);

        // A restart retains the one-use ledger but advances the admission clock.
        await client.query(
          `update app.receiver_sms_route_control set cutover_at = pg_catalog.clock_timestamp()
            where singleton`,
        );
        const freshFingerprint = hexDigest();
        const freshTime = (
          await client.query<{ at: string }>(`select pg_catalog.clock_timestamp()::text as at`)
        ).rows[0]!.at;
        const fresh = await fixtureCandidate(client, freshFingerprint, freshTime);
        await client.query(
          `update app.inbound_events inbound set processed_at = candidate.submitted_at
            from app.receiver_sms_deposit_candidates candidate
            where inbound.id = candidate.origin_inbound_event_id
              and candidate.id = $1::uuid`,
          [fresh],
        );
        const freshEventTime = (
          await client.query<{ at: string }>(`select pg_catalog.clock_timestamp()::text as at`)
        ).rows[0]!.at;
        await fixturePaymentEvent(client, freshFingerprint, freshEventTime);
        expect(
          (
            await client.query<{ outcome: string }>(
              `select app.settle_next_receiver_sms_match() as outcome`,
            )
          ).rows,
        ).toEqual([{ outcome: 'queued' }]);
        expect(
          (
            await client.query<{ outcome: string }>(
              `select app.settle_next_receiver_sms_match() as outcome`,
            )
          ).rows,
        ).toEqual([{ outcome: 'empty' }]);
        const snapshot = await client.query<{
          old_holds: string;
          old_lineages: string;
          old_matches: string;
          fresh_lineages: string;
        }>(
          `select
            (select count(*)::text from app.receiver_sms_settlement_holds
              where candidate_id in ($1::uuid,$2::uuid)) as old_holds,
            (select count(*)::text from app.receiver_sms_settlement_lineages
              where candidate_id in ($1::uuid,$2::uuid)) as old_lineages,
            (select count(*)::text from app.receiver_sms_payment_matches
              where candidate_id = $2::uuid) as old_matches,
            (select count(*)::text from app.receiver_sms_settlement_lineages
              where candidate_id = $3::uuid) as fresh_lineages`,
          [oldUnmatched, oldReady, fresh],
        );
        expect(snapshot.rows).toEqual([
          {
            old_holds: '0',
            old_lineages: '0',
            old_matches: '1',
            fresh_lineages: '1',
          },
        ]);
      } finally {
        await client.query('rollback');
      }
    });
  });
}

export function registerPostCutoverReceiverSmsRangeSqlTests(
  getClient: () => Client,
  getOwner: () => string,
): void {
  describe('100–25,000 ETB receiver SMS cutover', () => {
    it('holds an unmatched submission only after 60 minutes', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await client.query(
          `update app.receiver_sms_route_control set enabled = true,
            cutover_at = pg_catalog.clock_timestamp() - interval '1 day'
            where singleton`,
        );
        const candidate = await fixtureCandidate(
          client,
          hexDigest(),
          new Date(Date.now() - 61 * 60_000).toISOString(),
        );
        const held = await client.query<{ outcome: string }>(
          `select app.settle_next_receiver_sms_match() as outcome`,
        );
        expect(held.rows).toEqual([{ outcome: 'held_review' }]);
        const reason = await client.query<{ reason_code: string }>(
          `select reason_code from app.receiver_sms_settlement_holds
            where candidate_id = $1::uuid`,
          [candidate],
        );
        expect(reason.rows).toEqual([{ reason_code: 'no_receiver_sms_after_60m' }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('preserves an earlier five-minute review hold without queuing a credit', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await client.query(
          `update app.receiver_sms_route_control set enabled = true,
            cutover_at = pg_catalog.clock_timestamp() - interval '1 day'
            where singleton`,
        );
        const fingerprint = hexDigest();
        const candidate = await fixtureCandidate(
          client,
          fingerprint,
          new Date(Date.now() - 30 * 60_000).toISOString(),
        );
        await client.query(
          `insert into app.receiver_sms_settlement_holds (candidate_id,reason_code)
            values ($1::uuid,'no_receiver_sms_after_5m')`,
          [candidate],
        );
        await fixturePaymentEvent(client, fingerprint, new Date().toISOString());
        const outcome = await client.query<{ result: string }>(
          `select app.settle_next_receiver_sms_match() as result`,
        );
        expect(outcome.rows).toEqual([{ result: 'empty' }]);
        const jobs = await client.query<{ count: string }>(
          `select count(*)::text as count from app.receiver_sms_settlement_lineages
            where candidate_id = $1::uuid`,
          [candidate],
        );
        expect(jobs.rows).toEqual([{ count: '0' }]);
      } finally {
        await client.query('rollback');
      }
    });

    it.each(['telebirr', 'cbe_birr'] as const)(
      'queues a %s payment when its signed SMS arrives 30 minutes after submission',
      async (providerCode) => {
        const client = getClient();
        await client.query('begin');
        try {
          const submittedAt = new Date(Date.now() - 30 * 60_000).toISOString();
          await persistentPolicyFixture(
            client,
            getOwner(),
            new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
          );
          await client.query(
            `update app.feature_switches set mode = 'live'
              where feature_key in ('payment_verification','deposit_execution',
                'cbe_birr_authoritative_verification')`,
          );
          await client.query(
            `update app.receiver_sms_route_control set enabled = true,
              cutover_at = pg_catalog.clock_timestamp() - interval '1 day'
              where singleton`,
          );
          if (providerCode === 'cbe_birr') {
            await client.query(
              `insert into app.receiver_accounts (
                provider_id, version, account_holder_name,
                account_reference_ciphertext, account_reference_masked,
                account_reference_fingerprint, protection_profile_version,
                encryption_key_version, fingerprint_key_version,
                rotation_request_id, rotation_reason
              ) select provider.id,
                  coalesce((select max(receiver.version) + 1
                    from app.receiver_accounts receiver
                    where receiver.provider_id = provider.id), 1),
                  'Synthetic CBE Receiver', $1::text, '***7002', $2::text,
                  1, 1, 1, $3::uuid, 'initial_configuration'
                from app.payment_providers provider
                where provider.code = 'cbe_birr'
                  and not exists (select 1 from app.receiver_accounts receiver
                    where receiver.provider_id = provider.id
                      and receiver.status = 'active' and receiver.retired_at is null)`,
              [
                `receiver-v1.cbe_birr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(16)}`,
                hexDigest(),
                randomUUID(),
              ],
            );
          }
          // The disposable receiver fixture must predate this simulated transfer.
          await client.query(
            `alter table app.receiver_accounts disable trigger receiver_accounts_immutable_revision`,
          );
          await client.query(
            `update app.receiver_accounts receiver
              set active_from = pg_catalog.clock_timestamp() - interval '1 day'
              from app.payment_providers provider
              where provider.id = receiver.provider_id
                and provider.code = $1::text
                and receiver.status = 'active' and receiver.retired_at is null`,
            [providerCode],
          );
          await client.query(
            `alter table app.receiver_accounts enable trigger receiver_accounts_immutable_revision`,
          );
          const fingerprint = hexDigest();
          const candidate = await fixtureCandidate(client, fingerprint, submittedAt, providerCode);
          await client.query(
            `update app.inbound_events inbound set processed_at = candidate.submitted_at
              from app.receiver_sms_deposit_candidates candidate
              where inbound.id = candidate.origin_inbound_event_id
                and candidate.id = $1::uuid`,
            [candidate],
          );
          expect(
            (
              await client.query<{ outcome: string }>(
                `select app.settle_next_receiver_sms_match() as outcome`,
              )
            ).rows,
          ).toEqual([{ outcome: 'empty' }]);
          await fixturePaymentEvent(
            client,
            fingerprint,
            submittedAt,
            providerCode,
            12500,
            new Date().toISOString(),
          );
          const match = await client.query<{ disposition: string }>(
            `select disposition from app.receiver_sms_payment_matches
              where candidate_id = $1::uuid`,
            [candidate],
          );
          expect(match.rows).toEqual([{ disposition: 'ready' }]);
          const queued = await client.query<{ outcome: string }>(
            `select app.settle_next_receiver_sms_match() as outcome`,
          );
          expect(queued.rows).toEqual([{ outcome: 'queued' }]);
          const outcome = await client.query<{
            holds: string;
            owner_decisions: string;
            jobs: string;
            admissible: string;
          }>(
            `select
              (select count(*)::text from app.receiver_sms_settlement_holds
                where candidate_id = $1::uuid) as holds,
              (select count(*)::text from app.receiver_sms_owner_decisions
                where candidate_id = $1::uuid) as owner_decisions,
              (select count(*)::text from app.receiver_sms_settlement_lineages
                where candidate_id = $1::uuid) as jobs,
              (select count(*)::text from app.assess_routine_telebirr_execution_job(
                lineage.execution_job_id)) as admissible
              from app.receiver_sms_settlement_lineages lineage
              where lineage.candidate_id = $1::uuid`,
            [candidate],
          );
          expect(outcome.rows).toEqual([
            { holds: '0', owner_decisions: '0', jobs: '1', admissible: '1' },
          ]);
        } finally {
          await client.query('rollback');
        }
      },
    );

    it.each([10000, 2500000])(
      'queues an exact %i minor signed payment once',
      async (amountMinor) => {
        const client = getClient();
        await client.query('begin');
        try {
          await client.query(`update app.feature_switches set mode='live'
          where feature_key in ('payment_verification','deposit_execution')`);
          await client.query(`update app.receiver_sms_route_control set enabled=true,
          cutover_at=clock_timestamp()-interval '1 day' where singleton`);
          const fingerprint = hexDigest();
          const candidate = await fixtureCandidate(client, fingerprint, new Date().toISOString());
          await client.query(
            `update app.inbound_events inbound set processed_at=candidate.submitted_at
          from app.receiver_sms_deposit_candidates candidate
          where inbound.id=candidate.origin_inbound_event_id and candidate.id=$1::uuid`,
            [candidate],
          );
          await fixturePaymentEvent(
            client,
            fingerprint,
            new Date().toISOString(),
            'telebirr',
            amountMinor,
          );
          const settled = await client.query<{ outcome: string }>(
            'select app.settle_next_receiver_sms_match() as outcome',
          );
          expect(settled.rows).toEqual([{ outcome: 'queued' }]);
          const counts = await client.query<{ jobs: string; cases: string }>(
            `select (select count(*)::text from app.receiver_sms_settlement_lineages
            where candidate_id=$1::uuid) as jobs,
            (select count(*)::text from app.owner_manual_payment_cases
            where candidate_id=$1::uuid) as cases`,
            [candidate],
          );
          expect(counts.rows).toEqual([{ jobs: '1', cases: '0' }]);
        } finally {
          await client.query('rollback');
        }
      },
    );

    it.each([7500, 9999, 2500001, 2500100])(
      'keeps %i minor out of automatic credit and allows one Owner manual approval',
      async (amountMinor) => {
        const client = getClient();
        await client.query('begin');
        try {
          await client.query(`update app.feature_switches set mode='live'
            where feature_key in ('payment_verification','deposit_execution')`);
          await client.query(`update app.receiver_sms_route_control set enabled=true,
            cutover_at=clock_timestamp()-interval '1 day' where singleton`);
          const fingerprint = hexDigest();
          const candidate = await fixtureCandidate(client, fingerprint, new Date().toISOString());
          await client.query(
            `update app.inbound_events inbound set processed_at=candidate.submitted_at
            from app.receiver_sms_deposit_candidates candidate
            where inbound.id=candidate.origin_inbound_event_id and candidate.id=$1::uuid`,
            [candidate],
          );
          const event = await fixturePaymentEvent(
            client,
            fingerprint,
            new Date().toISOString(),
            'telebirr',
            amountMinor,
          );
          const settled = await client.query<{ outcome: string }>(
            'select app.settle_next_receiver_sms_match() as outcome',
          );
          expect(settled.rows).toEqual([{ outcome: 'empty' }]);
          const matched = await client.query<{ disposition: string }>(
            `select disposition from app.receiver_sms_payment_matches
              where candidate_id=$1::uuid and payment_event_id=$2::uuid`,
            [candidate, event],
          );
          expect(matched.rows).toEqual([{ disposition: 'held_review' }]);
          const automatic = await client.query<{ claims: string; jobs: string }>(
            `select (select count(*)::text from app.receiver_sms_settlement_lineages
              where candidate_id=$1::uuid) as claims,
              (select count(*)::text from app.deposit_jobs job
                join app.receiver_sms_intent_openings opening on opening.deposit_intent_id=job.deposit_intent_id
                where opening.candidate_id=$1::uuid) as jobs`,
            [candidate],
          );
          expect(automatic.rows).toEqual([{ claims: '0', jobs: '0' }]);
          await client.query('set session authorization fetanagent_owner_control_runtime');
          const pending = await client.query<{ can_approve: boolean; player_id: string }>(
            `select can_approve,player_id from app.list_owner_submitted_payments($1::uuid,'pending',25,0)
              where candidate_id=$2::uuid`,
            [getOwner(), candidate],
          );
          expect(pending.rows).toEqual([{ can_approve: true, player_id: expect.any(String) }]);
          const credited = await client.query<{ result: { status: string } }>(
            `select app.approve_owner_manual_payment_for_immediate_credit(
              $1::uuid,$2::uuid,null,null,true) as result`,
            [getOwner(), candidate],
          );
          expect(credited.rows[0]?.result.status).toBe('manually_credited');
          const inbox = await client.query<{ can_mark_manually_credited: boolean }>(
            `select can_mark_manually_credited from app.list_owner_receiver_sms_inbox($1::uuid,25,0)
              where payment_event_id=$2::uuid`,
            [getOwner(), event],
          );
          expect(inbox.rows).toEqual([{ can_mark_manually_credited: false }]);
          await client.query('reset session authorization');
          const final = await client.query<{ cases: string; notices: string; jobs: string }>(
            `select (select count(*)::text from app.owner_manual_payment_cases
              where candidate_id=$1::uuid and status='manually_credited') as cases,
              (select count(*)::text from app.telegram_deposit_outcome_deliveries
              where candidate_id=$1::uuid and notification_stage='manual_final'
                and outcome_code='credited' and amount_minor=$2::bigint) as notices,
              (select count(*)::text from app.receiver_sms_settlement_lineages
              where candidate_id=$1::uuid) as jobs`,
            [candidate, amountMinor],
          );
          expect(final.rows).toEqual([{ cases: '1', notices: '1', jobs: '0' }]);
        } finally {
          await client.query('reset session authorization').catch(() => undefined);
          await client.query('rollback');
        }
      },
    );
  });
}

export function registerOwnerDuplicateCreditStatusSqlTests(
  getClient: () => Client,
  getOwner: () => string,
): void {
  describe('Owner duplicate credit status', () => {
    it('shows a repeat for the credited Player as already credited while holding another Player', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await persistentPolicyFixture(client, getOwner());
        await client.query(
          `update app.feature_switches set mode = 'live'
            where feature_key in ('payment_verification','deposit_execution')`,
        );
        await client.query(
          `update app.receiver_sms_route_control set enabled = true,
            cutover_at = pg_catalog.clock_timestamp() - interval '1 day'
            where singleton`,
        );
        const fingerprint = hexDigest();
        const creditedCandidate = await fixtureCandidate(
          client,
          fingerprint,
          new Date().toISOString(),
        );
        await client.query(
          `update app.inbound_events inbound set processed_at = candidate.submitted_at
            from app.receiver_sms_deposit_candidates candidate
            where inbound.id = candidate.origin_inbound_event_id
              and candidate.id = $1::uuid`,
          [creditedCandidate],
        );
        await fixturePaymentEvent(client, fingerprint, new Date().toISOString(), 'telebirr', 10100);
        expect(
          (
            await client.query<{ outcome: string }>(
              `select app.settle_next_receiver_sms_match() as outcome`,
            )
          ).rows,
        ).toEqual([{ outcome: 'queued' }]);
        const settled = await client.query<{ deposit_intent_id: string }>(
          `select deposit_intent_id from app.finalize_receiver_sms_match($1::uuid)`,
          [creditedCandidate],
        );
        expect(settled.rows).toHaveLength(1);

        const ready = await client.query<{
          job_status: string;
          intent_status: string;
          amount_minor: string;
          due: boolean;
        }>(
          `select job.status::text as job_status,intent.status::text as intent_status,
              intent.expected_amount_minor::text as amount_minor,
              job.run_after <= clock_timestamp() as due
            from app.receiver_sms_settlement_lineages lineage
            join app.deposit_jobs job on job.id = lineage.execution_job_id
            join app.deposit_intents intent on intent.id = lineage.deposit_intent_id
            where lineage.candidate_id = $1::uuid`,
          [creditedCandidate],
        );
        expect(ready.rows).toEqual([
          {
            job_status: 'queued',
            intent_status: 'execution_pending',
            amount_minor: '10100',
            due: true,
          },
        ]);
        // Historical lease is used only to create a confirmed test ledger. Production
        // execution still requires the separate signed Companion command path.
        await client.query(
          `alter table app.deposit_jobs
            disable trigger deposit_jobs_require_owner_approved_telebirr_execution`,
        );
        const leased = await client.query<{
          execution_attempt_id: string;
          lease_token: string;
        }>(`select * from app.lease_next_deposit_execution($1::uuid, 300)`, [randomUUID()]);
        await client.query(
          `alter table app.deposit_jobs
            enable trigger deposit_jobs_require_owner_approved_telebirr_execution`,
        );
        expect(leased.rows).toHaveLength(1);
        const attemptId = leased.rows[0]!.execution_attempt_id;
        const leaseToken = leased.rows[0]!.lease_token;
        const fenced = await client.query<{ first_fence_acquired: boolean }>(
          `select first_fence_acquired
            from app.fence_deposit_execution_final_action($1::uuid,$2::uuid)`,
          [attemptId, leaseToken],
        );
        expect(fenced.rows).toEqual([{ first_fence_acquired: true }]);
        await client.query('set local role fetanagent_deposit_executor');
        await client.query(
          `select * from app.require_deposit_execution_reconciliation($1::uuid,$2::uuid,true)`,
          [attemptId, leaseToken],
        );
        const reconciliation = await client.query<{
          reconciliation_job_id: string;
          lease_token: string;
        }>(`select * from app.lease_next_deposit_execution_reconciliation($1::uuid,300)`, [
          randomUUID(),
        ]);
        expect(reconciliation.rows).toHaveLength(1);
        await client.query('reset role');
        const historyTime = await client.query<{ occurred_at: string }>(
          `select (final_action_fenced_at +
              (reconciliation_required_at - final_action_fenced_at) / 2)::text as occurred_at
            from app.deposit_execution_attempts where id = $1::uuid`,
          [attemptId],
        );
        await client.query('set local role fetanagent_deposit_executor');
        const confirmed = await client.query<{ deposit_status: string }>(
          `select deposit_status from app.record_deposit_execution_reconciliation(
            $1::uuid,$2::uuid,'confirmed_executed',$3::text,1::smallint,
            'deposit',$4::timestamptz,true,true,true,true)`,
          [
            reconciliation.rows[0]!.reconciliation_job_id,
            reconciliation.rows[0]!.lease_token,
            `hmac-sha256-v1:${hexDigest()}`,
            historyTime.rows[0]!.occurred_at,
          ],
        );
        expect(confirmed.rows).toEqual([{ deposit_status: 'executed' }]);
        await client.query('reset role');

        const creditedIdentity = await client.query<{ origin_identity_id: string }>(
          `select origin_identity_id from app.receiver_sms_deposit_candidates where id = $1::uuid`,
          [creditedCandidate],
        );
        const repeatInboundId = await fixtureInboundEvent(
          client,
          creditedIdentity.rows[0]!.origin_identity_id,
        );
        const repeat = await client.query<{ id: string }>(
          `insert into app.receiver_sms_deposit_candidates (
            origin_inbound_event_id,origin_identity_id,submitting_customer_id,
            beneficiary_customer_id,platform_id,player_account_id,
            player_deposit_eligibility_decision_id,payment_provider_id,provider_code,
            reference_ciphertext,reference_fingerprint,reference_masked,
            reference_key_version,reference_profile_version,semantic_input_hmac,submitted_at
          ) select $2::uuid,origin_identity_id,submitting_customer_id,
              beneficiary_customer_id,platform_id,player_account_id,
              player_deposit_eligibility_decision_id,payment_provider_id,provider_code,
              reference_ciphertext,reference_fingerprint,reference_masked,
              reference_key_version,reference_profile_version,$3::text,
              submitted_at + interval '1 second'
            from app.receiver_sms_deposit_candidates where id = $1::uuid
            returning id`,
          [creditedCandidate, repeatInboundId, `hmac-sha256-v1:${hexDigest()}`],
        );
        const otherPlayer = await fixtureCandidate(
          client,
          fingerprint,
          new Date(Date.now() + 2000).toISOString(),
        );
        await client.query('set session authorization fetanagent_owner_control_runtime');
        const approved = await client.query<{
          candidate_id: string;
          payment_status: string;
          status_detail: string;
          can_approve: boolean;
          can_reject: boolean;
        }>(
          `select candidate_id,payment_status,status_detail,can_approve,can_reject
            from app.list_owner_submitted_payments($1::uuid,'approved',25,0)
            where candidate_id = $2::uuid`,
          [getOwner(), repeat.rows[0]!.id],
        );
        expect(approved.rows).toEqual([
          {
            candidate_id: repeat.rows[0]!.id,
            payment_status: 'approved',
            status_detail: 'Already credited — duplicate submission',
            can_approve: false,
            can_reject: false,
          },
        ]);
        const pending = await client.query<{
          candidate_id: string;
          payment_status: string;
          can_approve: boolean;
          can_reject: boolean;
        }>(
          `select candidate_id,payment_status,can_approve,can_reject
            from app.list_owner_submitted_payments($1::uuid,'pending',25,0)
            where candidate_id in ($2::uuid,$3::uuid)`,
          [getOwner(), repeat.rows[0]!.id, otherPlayer],
        );
        expect(pending.rows).toEqual([
          {
            candidate_id: otherPlayer,
            payment_status: 'pending',
            can_approve: false,
            can_reject: false,
          },
        ]);
      } finally {
        await client.query('reset session authorization').catch(() => undefined);
        await client.query('rollback');
      }
    });
  });
}
