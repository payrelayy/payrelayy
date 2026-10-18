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

    it('creates one protected CBE revision, retires any old revision, and replays exactly', async () => {
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

    it('creates a fresh same-account CBE lookup revision only with money switches off', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const owner = await client.query<{ readonly auth_user_id: string }>(
          `select auth_user_id from app.admin_users where id = $1::uuid and role = 'owner' and status = 'active'`,
          [getOwnerAdminId()],
        );
        expect(owner.rows).toHaveLength(1);
        const authUserId = owner.rows[0]!.auth_user_id;
        const legacyFingerprint = 'a'.repeat(64);
        const legacyCiphertext = `receiver-v1.cbe_birr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(16)}`;
        const prior = await queryAsOwnerControl<{
          readonly receiver_revision_id: string;
          readonly revision: number;
        }>(
          client,
          `select * from app.rotate_owner_receiver_account(
            $1::uuid, $2::uuid, 'cbe_birr', 'Synthetic SQL Receiver',
            $3::text, $4::text, '***6789', 1::smallint, 1::smallint, 1::smallint,
            'initial_configuration'
          )`,
          [authUserId, randomUUID(), legacyCiphertext, legacyFingerprint],
        );
        expect(prior).toHaveLength(1);

        const deployedGrant = await client.query<{ readonly owner_function: boolean }>(`
          select has_function_privilege(
            'fetanagent_owner_control',
            'app.rotate_owner_cbe_birr_receiver_lookup_v2(uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text)',
            'EXECUTE') as owner_function
        `);
        expect(deployedGrant.rows).toEqual([{ owner_function: true }]);

        const requestId = randomUUID();
        const receiverRevisionId = requestId;
        const lookupCiphertext = `cbe-receiver-v2.${'D'.repeat(16)}.${'E'.repeat(22)}.${'F'.repeat(16)}`;
        const lookupFingerprint = 'b'.repeat(64);
        const rotateSql = `select * from app.rotate_owner_cbe_birr_receiver_lookup_v2(
          $1::uuid, $2::uuid, $3::uuid, $4::integer, 'Synthetic SQL Receiver',
          $5::text, $6::text, '***6789', $7::text, $8::text, '***6789',
          'protection_upgrade'
        )`;
        const values = [
          authUserId,
          requestId,
          receiverRevisionId,
          prior[0]!.revision + 1,
          legacyCiphertext,
          legacyFingerprint,
          lookupCiphertext,
          lookupFingerprint,
        ];

        await client.query(`update app.feature_switches set mode = 'dry_run'
          where feature_key = 'payment_verification'`);
        await expectFailure(client, rotateSql, values, /requires every payment switch disabled/u);
        await client.query(`update app.feature_switches set mode = 'disabled'
          where feature_key = 'payment_verification'`);
        await expectFailure(
          client,
          rotateSql,
          [
            authUserId,
            requestId,
            receiverRevisionId,
            prior[0]!.revision + 1,
            legacyCiphertext,
            'c'.repeat(64),
            lookupCiphertext,
            lookupFingerprint,
          ],
          /Only a fresh protection revision of the same v1 CBE Birr receiver is allowed/u,
        );

        const created = await queryAsOwnerControl<{
          readonly lookup_protected: boolean;
          readonly receiver_revision_id: string;
          readonly receiver_status: string;
          readonly revision: number;
        }>(client, rotateSql, values);
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({
          lookup_protected: true,
          receiver_revision_id: receiverRevisionId,
          receiver_status: 'active',
          revision: prior[0]!.revision + 1,
        });
        expect(await queryAsOwnerControl(client, rotateSql, values)).toEqual(created);
        await expectFailure(
          client,
          rotateSql,
          [
            authUserId,
            requestId,
            receiverRevisionId,
            prior[0]!.revision + 1,
            legacyCiphertext,
            legacyFingerprint,
            lookupCiphertext,
            'c'.repeat(64),
          ],
          /conflicts with its original use/u,
        );

        const lineage = await client.query<{
          readonly exact_boundary: boolean;
          readonly lookup_count: number;
          readonly prior_retired: boolean;
        }>(
          `select prior.status = 'inactive' and prior.retired_at is not null as prior_retired,
                  prior.retired_at = current.active_from as exact_boundary,
                  (select count(*)::integer from app.cbe_birr_receiver_lookup_revisions lookup
                    where lookup.receiver_revision_id = current.id
                      and lookup.receiver_version = current.version
                      and lookup.lookup_fingerprint = $3::text
                      and lookup.lookup_masked = '***6789') as lookup_count
             from app.receiver_accounts prior
             join app.receiver_accounts current on current.id = $2::uuid
            where prior.id = $1::uuid`,
          [prior[0]!.receiver_revision_id, receiverRevisionId, lookupFingerprint],
        );
        expect(lineage.rows).toEqual([
          { exact_boundary: true, lookup_count: 1, prior_retired: true },
        ]);

        const privileges = await client.query<{
          readonly owner_function: boolean;
          readonly public_function: boolean;
          readonly runtime_table: boolean;
          readonly worker_function: boolean;
          readonly worker_table: boolean;
        }>(`
          select has_function_privilege(
                   'fetanagent_owner_control',
                   'app.rotate_owner_cbe_birr_receiver_lookup_v2(uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text)',
                   'EXECUTE') as owner_function,
                 has_function_privilege(
                   'fetanagent_cbe_birr_shadow_worker',
                   'app.rotate_owner_cbe_birr_receiver_lookup_v2(uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text)',
                   'EXECUTE') as worker_function,
                 exists (
                   select 1
                     from pg_proc routine,
                          aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) acl
                    where routine.oid =
                      'app.rotate_owner_cbe_birr_receiver_lookup_v2(uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text)'::regprocedure
                      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
                 ) as public_function,
                 has_table_privilege(
                   'fetanagent_owner_control_runtime',
                   'app.cbe_birr_receiver_lookup_revisions', 'SELECT,INSERT,UPDATE,DELETE'
                 ) as runtime_table,
                 has_table_privilege(
                   'fetanagent_cbe_birr_shadow_worker',
                   'app.cbe_birr_receiver_lookup_revisions', 'SELECT,INSERT,UPDATE,DELETE'
                 ) as worker_table
        `);
        expect(privileges.rows).toEqual([
          {
            owner_function: true,
            public_function: false,
            runtime_table: false,
            worker_function: false,
            worker_table: false,
          },
        ]);

        await client.query('savepoint immutable_lookup');
        await expect(
          client.query(
            `update app.cbe_birr_receiver_lookup_revisions set lookup_masked = '***0000'
              where receiver_revision_id = $1::uuid`,
            [receiverRevisionId],
          ),
        ).rejects.toThrow(/immutable/u);
        await client.query('rollback to savepoint immutable_lookup');
      } finally {
        await client.query('rollback');
      }
    });

    it('permits only first CBE setup with other payment switches non-disabled and leaves TeleBirr untouched', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const owner = await client.query<{ readonly auth_user_id: string }>(
          `select auth_user_id from app.admin_users where id = $1::uuid and role = 'owner' and status = 'active'`,
          [getOwnerAdminId()],
        );
        expect(owner.rows).toHaveLength(1);
        const cbeBefore = await client.query<{ readonly count: number }>(`
          select count(*)::integer as count
            from app.receiver_accounts receiver
            join app.payment_providers provider on provider.id = receiver.provider_id
           where provider.code = 'cbe_birr'
        `);
        expect(cbeBefore.rows).toEqual([{ count: 0 }]);
        const telebirrBefore = await client.query<{ readonly receiver_ids: string[] }>(`
          select coalesce(array_agg(receiver.id::text order by receiver.version), array[]::text[])
                   as receiver_ids
            from app.receiver_accounts receiver
            join app.payment_providers provider on provider.id = receiver.provider_id
           where provider.code = 'telebirr'
        `);

        await client.query(`
          update app.feature_switches set mode = 'dry_run'
           where feature_key in (
             'payment_verification', 'deposit_execution', 'telebirr_authoritative_verification'
           )
        `);
        const requestId = randomUUID();
        const ciphertext = `receiver-v1.cbe_birr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(24)}`;
        const fingerprint = 'd'.repeat(64);
        const initialSql = `select * from app.rotate_owner_receiver_account(
          $1::uuid, $2::uuid, 'cbe_birr', 'First CBE Receiver',
          $3::text, $4::text, '***6789', 1::smallint, 1::smallint, 1::smallint,
          'initial_configuration'
        )`;
        const values = [owner.rows[0]!.auth_user_id, requestId, ciphertext, fingerprint];
        await client.query(`
          update app.feature_switches set mode = 'dry_run'
           where feature_key = 'cbe_birr_authoritative_verification'
        `);
        await expectFailure(
          client,
          initialSql,
          values,
          /requires every payment, provider, pilot, and execution switch to be disabled/u,
        );
        await client.query(`
          update app.feature_switches set mode = 'disabled'
           where feature_key = 'cbe_birr_authoritative_verification'
        `);
        const first = await queryAsOwnerControl<{
          readonly receiver_revision_id: string;
          readonly revision: number;
          readonly receiver_status: string;
        }>(client, initialSql, values);
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({ revision: 1, receiver_status: 'active' });
        expect(await queryAsOwnerControl(client, initialSql, values)).toEqual(first);

        await expectFailure(
          client,
          initialSql,
          [owner.rows[0]!.auth_user_id, randomUUID(), ciphertext, 'e'.repeat(64)],
          /Existing CBE Birr receiver rotation requires every payment switch to be disabled/u,
        );
        await expectFailure(
          client,
          `select * from app.rotate_owner_receiver_account(
            $1::uuid, $2::uuid, 'telebirr', 'Blocked TeleBirr Receiver',
            $3::text, $4::text, '***6789', 1::smallint, 1::smallint, 1::smallint,
            'initial_configuration'
          )`,
          [
            owner.rows[0]!.auth_user_id,
            randomUUID(),
            `receiver-v1.telebirr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(24)}`,
            'f'.repeat(64),
          ],
          /requires every payment, provider, pilot, and execution switch to be disabled/u,
        );

        const telebirrAfter = await client.query<{ readonly receiver_ids: string[] }>(`
          select coalesce(array_agg(receiver.id::text order by receiver.version), array[]::text[])
                   as receiver_ids
            from app.receiver_accounts receiver
            join app.payment_providers provider on provider.id = receiver.provider_id
           where provider.code = 'telebirr'
        `);
        expect(telebirrAfter.rows).toEqual(telebirrBefore.rows);
        const switches = await client.query<{
          readonly feature_key: string;
          readonly mode: string;
        }>(`
          select feature_key, mode from app.feature_switches
           where feature_key in (
             'cbe_birr_authoritative_verification', 'payment_verification',
             'deposit_execution', 'telebirr_authoritative_verification'
           ) order by feature_key
        `);
        expect(switches.rows).toEqual([
          { feature_key: 'cbe_birr_authoritative_verification', mode: 'disabled' },
          { feature_key: 'deposit_execution', mode: 'dry_run' },
          { feature_key: 'payment_verification', mode: 'dry_run' },
          { feature_key: 'telebirr_authoritative_verification', mode: 'dry_run' },
        ]);
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
