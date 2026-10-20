import { createHash, randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  fixtureEligiblePlayer,
  fixtureInboundEvent,
  fixtureTelegramActor,
} from './routine-telebirr-untrusted-proof.suite.js';

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
): Promise<string> {
  const actor = await fixtureTelegramActor(client, randomUUID(), false);
  const playerId = await fixtureEligiblePlayer(client, actor.customerId);
  const inboundId = await fixtureInboundEvent(client, actor.identityId);
  const player = await client.query<{ id: string; platform_id: string }>(
    `select id, platform_id from app.customer_platform_players where player_id = $1::text`,
    [playerId],
  );
  const eligibility = await client.query<{ id: string }>(
    `select id from app.player_deposit_eligibility_decisions
      where player_account_id = $1::uuid`,
    [player.rows[0]!.id],
  );
  const provider = await client.query<{ id: string }>(
    `select id from app.payment_providers where code = 'telebirr'`,
  );
  const inserted = await client.query<{ id: string }>(
    `insert into app.receiver_sms_deposit_candidates (
      origin_inbound_event_id, origin_identity_id, submitting_customer_id,
      platform_id, player_account_id, player_deposit_eligibility_decision_id,
      payment_provider_id, provider_code, reference_ciphertext,
      reference_fingerprint, reference_masked, reference_key_version,
      reference_profile_version, semantic_input_hmac, submitted_at
    ) values (
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,
      $7::uuid,'telebirr',$8::text,$9::text,'***ABCD',2,2,$10::text,$11::timestamptz
    ) returning id`,
    [
      inboundId,
      actor.identityId,
      actor.customerId,
      player.rows[0]!.platform_id,
      player.rows[0]!.id,
      eligibility.rows[0]!.id,
      provider.rows[0]!.id,
      `v2.telebirr.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(11)}`,
      fingerprint,
      `hmac-sha256-v1:${hexDigest()}`,
      submittedAt,
    ],
  );
  return inserted.rows[0]!.id;
}

async function fixturePaymentEvent(
  client: Client,
  fingerprint: string,
  occurredAt: string,
): Promise<string> {
  const receiver = await client.query<{ id: string; version: number; provider_id: string }>(
    `select receiver.id, receiver.version, receiver.provider_id
      from app.receiver_accounts receiver
      join app.payment_providers provider on provider.id = receiver.provider_id
      where provider.code = 'telebirr' and receiver.status = 'active'
        and receiver.retired_at is null`,
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
    ) values ('telebirr',$1::uuid,$2::uuid,$3::integer,$4::text,$5::text,
      12500,$6::timestamptz,$6::timestamptz,$6::timestamptz,$7::text,
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
    ],
  );
  return event.rows[0]!.id;
}

export function registerReceiverSmsPaymentLedgerSqlTests(getClient: () => Client): void {
  describe('receiver SMS payment ledger', () => {
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
      } finally {
        await client.query('rollback');
      }
    });
  });
}
