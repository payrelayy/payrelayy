import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const recordSql = `select app.record_receiver_sms_payment_event(
  $1::text,$2::text,$3::bigint,$4::timestamptz,$5::timestamptz,
  $6::timestamptz,$7::text,$8::text,$9::text,$10::text,$11::text,$12::integer) as outcome`;

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
      expect(runtime.rows).toEqual([{
        login: false, password_absent: true, inherited: true,
        can_read: false, can_credit: false,
      }]);
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
            'app.record_receiver_sms_payment_event(text,text,bigint,timestamptz,timestamptz,timestamptz,text,text,text,text,text,integer)',
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
          ...values.slice(0, 7),
          digest(randomUUID()),
          ...values.slice(8),
        ]);
        expect(replay.rows).toEqual([{ outcome: 'exact_replay' }]);
        const conflict = await client.query<{ outcome: string }>(recordSql, [
          'telebirr',
          reference,
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
  });
}
