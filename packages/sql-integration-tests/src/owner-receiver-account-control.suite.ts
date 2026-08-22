import { randomUUID } from 'node:crypto';

import type { Client, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

type SqlValue = boolean | number | string | null;

async function queryAsOwnerControl<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  const savepoint = `owner_receiver_query_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await client.query('set local role fetanagent_owner_control');
    const result = await client.query<T>(query, [...values]);
    await client.query('reset role');
    await client.query(`release savepoint ${savepoint}`);
    return result.rows;
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    throw error;
  }
}

async function expectFailure(
  client: Client,
  query: string,
  values: readonly SqlValue[],
  pattern: RegExp,
): Promise<void> {
  const savepoint = `owner_receiver_failure_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await client.query(`savepoint ${savepoint}`);
  let failure: unknown;
  try {
    await queryAsOwnerControl(client, query, values);
  } catch (error) {
    failure = error;
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toMatch(pattern);
}

export function registerOwnerReceiverAccountControlSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('Owner-adjustable immutable receiver accounts', () => {
    it('grants exactly list and rotate to Owner control without base-object or legacy authority', async () => {
      const client = getClient();
      const signatures = [
        'app.list_owner_receiver_accounts(uuid)',
        'app.rotate_owner_receiver_account(uuid,uuid,text,text,text,text,text,smallint,smallint,smallint,text)',
      ];
      const routines = await client.query<{
        readonly group_execute: boolean;
        readonly hardened: boolean;
        readonly public_execute: boolean;
        readonly runtime_execute: boolean;
        readonly signature: string;
      }>(
        `select routine.oid::regprocedure::text as signature,
                routine.prosecdef
                  and routine.proowner = 'postgres'::regrole
                  and routine.proconfig = array['search_path=pg_catalog']::text[] as hardened,
                has_function_privilege('fetanagent_owner_control', routine.oid, 'EXECUTE') as group_execute,
                has_function_privilege('fetanagent_owner_control_runtime', routine.oid, 'EXECUTE') as runtime_execute,
                exists (
                  select 1
                    from aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) acl
                   where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
                ) as public_execute
           from pg_proc routine
          where routine.oid = any($1::regprocedure[])
          order by signature`,
        [signatures],
      );
      expect(routines.rows).toHaveLength(2);
      expect(routines.rows.every((row) => row.hardened)).toBe(true);
      expect(routines.rows.every((row) => row.group_execute && row.runtime_execute)).toBe(true);
      expect(routines.rows.every((row) => !row.public_execute)).toBe(true);

      const denied = await client.query<{
        readonly legacy_denied: boolean;
        readonly no_table_access: boolean;
        readonly trigger_helpers_denied: boolean;
      }>(`
        select not has_function_privilege(
                 'fetanagent_owner_control_runtime',
                 'app.replace_receiver_account_by_admin_id_legacy(uuid,uuid,text,text,text,text,jsonb)',
                 'EXECUTE'
               ) as legacy_denied,
               not has_table_privilege(
                 'fetanagent_owner_control_runtime', 'app.receiver_accounts',
                 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
               ) as no_table_access,
               not has_function_privilege(
                 'fetanagent_owner_control_runtime',
                 'app.require_owner_receiver_account_controller()', 'EXECUTE'
               )
               and not has_function_privilege(
                 'fetanagent_owner_control_runtime',
                 'app.enforce_receiver_account_revision_immutable_v2()', 'EXECUTE'
               ) as trigger_helpers_denied
      `);
      expect(denied.rows).toEqual([
        { legacy_denied: true, no_table_access: true, trigger_helpers_denied: true },
      ]);
    });

    it('atomically retires the old CBE revision, creates one protected revision, and replays exactly', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const owner = await client.query<{ readonly auth_user_id: string }>(
          `select auth_user_id
             from app.admin_users
            where id = $1::uuid and role = 'owner' and status = 'active'`,
          [getOwnerAdminId()],
        );
        expect(owner.rows).toHaveLength(1);
        const authUserId = owner.rows[0]!.auth_user_id;
        const requestId = randomUUID();
        const fingerprint = 'a'.repeat(64);
        const ciphertext = `receiver-v1.cbe_birr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(24)}`;
        const activeBefore = await client.query<{
          readonly id: string;
          readonly version: number;
        }>(`
          select receiver.id, receiver.version
            from app.receiver_accounts receiver
            join app.payment_providers provider on provider.id = receiver.provider_id
           where provider.code = 'cbe_birr' and receiver.status = 'active'
        `);

        const rotateSql = `
          select * from app.rotate_owner_receiver_account(
            $1::uuid, $2::uuid, 'cbe_birr', 'FetanAgent SQL Receiver',
            $3::text, $4::text, '***6789', 1::smallint, 1::smallint, 1::smallint,
            'account_rotation'
          )
        `;
        const first = await queryAsOwnerControl<{
          readonly protected_reference: boolean;
          readonly provider_code: string;
          readonly receiver_revision_id: string;
          readonly receiver_status: string;
          readonly revision: number;
        }>(client, rotateSql, [authUserId, requestId, ciphertext, fingerprint]);
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({
          protected_reference: true,
          provider_code: 'cbe_birr',
          receiver_status: 'active',
        });

        const safeHistory = await queryAsOwnerControl(
          client,
          `
          select * from app.list_owner_receiver_accounts($1::uuid)
        `,
          [authUserId],
        );
        expect(
          safeHistory.some(
            (entry) => entry.receiver_revision_id === first[0]!.receiver_revision_id,
          ),
        ).toBe(true);
        expect(Object.keys(safeHistory[0] ?? {}).sort()).toEqual([
          'account_holder_name',
          'account_reference_masked',
          'active_from',
          'protected_reference',
          'provider_code',
          'provider_display_name',
          'receiver_revision_id',
          'receiver_status',
          'retired_at',
          'revision',
          'rotation_reason',
        ]);
        expect(JSON.stringify(safeHistory)).not.toMatch(/ciphertext|fingerprint|receiver-v1/iu);

        const replay = await queryAsOwnerControl(client, rotateSql, [
          authUserId,
          requestId,
          `receiver-v1.cbe_birr.${'D'.repeat(16)}.${'E'.repeat(22)}.${'F'.repeat(24)}`,
          fingerprint,
        ]);
        expect(replay).toEqual(first);

        const lineage = await client.query<{
          readonly active_count: number;
          readonly audit_is_redacted: boolean;
          readonly exact_rotation_boundary: boolean;
          readonly protected_rows: number;
        }>(
          `select count(*) filter (where receiver.status = 'active')::integer as active_count,
                  count(*) filter (
                    where receiver.rotation_request_id = $1::uuid
                      and receiver.account_reference_fingerprint = $2::text
                      and receiver.account_reference_ciphertext = $3::text
                      and receiver.verification_reference_ciphertext = $3::text
                      and receiver.instructions = jsonb_build_object(
                        'receiverReferenceProtectionProfileVersion', 1,
                        'receiverReferenceEncryptionKeyVersion', 1,
                        'receiverReferenceFingerprintKeyVersion', 1
                      )
                  )::integer as protected_rows,
                  coalesce(bool_and(
                    previous.retired_at = current.active_from
                  ) filter (where previous.id is not null), true) as exact_rotation_boundary,
                  not exists (
                    select 1 from app.audit_events audit
                     where audit.resource_id = current.id
                       and (
                         audit.metadata::text like '%' || $2::text || '%'
                         or audit.metadata::text like '%6789%'
                         or audit.metadata::text like '%FetanAgent SQL Receiver%'
                       )
                  ) as audit_is_redacted
             from app.receiver_accounts receiver
             join app.payment_providers provider on provider.id = receiver.provider_id
             left join app.receiver_accounts current
               on current.rotation_request_id = $1::uuid
             left join app.receiver_accounts previous
               on previous.id = $4::uuid
            where provider.code = 'cbe_birr'
            group by current.id`,
          [requestId, fingerprint, ciphertext, activeBefore.rows[0]?.id ?? null],
        );
        expect(lineage.rows).toEqual([
          {
            active_count: 1,
            audit_is_redacted: true,
            exact_rotation_boundary: true,
            protected_rows: 1,
          },
        ]);

        await expectFailure(
          client,
          rotateSql,
          [authUserId, requestId, ciphertext, 'b'.repeat(64)],
          /conflicts with its original use/u,
        );
      } finally {
        await client.query('rollback');
      }
    });

    it('fails closed when a financial switch is not disabled and keeps history immutable', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const owner = await client.query<{ readonly auth_user_id: string }>(
          `select auth_user_id from app.admin_users where id = $1::uuid`,
          [getOwnerAdminId()],
        );
        await client.query(
          `update app.feature_switches set mode = 'dry_run'
            where feature_key = 'payment_verification'`,
        );
        await expectFailure(
          client,
          `select * from app.rotate_owner_receiver_account(
             $1::uuid, $2::uuid, 'cbe_birr', 'Blocked Receiver',
             $3::text, $4::text, '***6789', 1::smallint, 1::smallint, 1::smallint,
             'owner_correction'
           )`,
          [
            owner.rows[0]!.auth_user_id,
            randomUUID(),
            `receiver-v1.cbe_birr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(24)}`,
            'c'.repeat(64),
          ],
          /requires every payment, provider, pilot, and execution switch to be disabled/u,
        );

        const active = await client.query<{ readonly id: string }>(`
          select receiver.id
            from app.receiver_accounts receiver
            join app.payment_providers provider on provider.id = receiver.provider_id
           where provider.code = 'cbe_birr' and receiver.status = 'active'
           limit 1
        `);
        if (active.rows[0]) {
          await expect(
            client.query(
              `update app.receiver_accounts set account_holder_name = 'MUTATED'
                where id = $1::uuid`,
              [active.rows[0].id],
            ),
          ).rejects.toThrow(/immutable/u);
        }
      } finally {
        await client.query('rollback');
      }
    });
  });
}
