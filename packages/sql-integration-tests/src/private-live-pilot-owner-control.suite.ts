import { randomUUID } from 'node:crypto';

import type { Client, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import { createPilotPrerequisites } from './private-live-money-pilot.suite.js';

type SqlValue = Date | number | readonly string[] | string | null;

async function queryAsOwnerControl<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  await client.query('set local role fetanagent_owner_control');
  try {
    const result = await client.query<T>(query, [...values]);
    return result.rows;
  } finally {
    await client.query('reset role');
  }
}

async function expectFailureAtSavepoint(
  client: Client,
  query: string,
  values: readonly SqlValue[],
): Promise<void> {
  const savepoint = `expected_owner_pilot_failure_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
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
}

export function registerPrivateLivePilotOwnerControlSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('private live-pilot Owner-control boundary', () => {
    it('grants exactly four hardened pilot controls without tables or any other authority', async () => {
      const client = getClient();
      const publicSignatures = [
        'app.prepare_private_live_deposit_pilot(uuid,uuid,text[],text[],uuid[],bigint,bigint,bigint,bigint,smallint,timestamptz,timestamptz)',
        'app.arm_private_live_deposit_pilot(uuid,uuid)',
        'app.stop_private_live_deposit_pilot(uuid,uuid,text)',
        'app.get_private_live_deposit_pilot_status(uuid,uuid)',
      ];
      const boundary = await client.query<{
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
                has_function_privilege(
                  'fetanagent_owner_control', routine.oid, 'EXECUTE'
                ) as group_execute,
                has_function_privilege(
                  'fetanagent_owner_control_runtime', routine.oid, 'EXECUTE'
                ) as runtime_execute,
                exists (
                  select 1
                    from aclexplode(coalesce(
                      routine.proacl,
                      acldefault('f', routine.proowner)
                    )) privilege
                   where privilege.grantee = 0
                     and privilege.privilege_type = 'EXECUTE'
                ) as public_execute
           from pg_proc routine
          where routine.oid = any($1::regprocedure[])
          order by signature`,
        [publicSignatures],
      );
      expect(boundary.rows).toHaveLength(4);
      expect(boundary.rows.every((row) => row.hardened)).toBe(true);
      expect(boundary.rows.every((row) => row.group_execute && row.runtime_execute)).toBe(true);
      expect(boundary.rows.every((row) => !row.public_execute)).toBe(true);

      const unexpectedPublicExecutors = await client.query<{ readonly executor_count: number }>(
        `select count(*)::integer as executor_count
           from pg_roles candidate
          cross join unnest($1::regprocedure[]) routines(routine_oid)
          where not candidate.rolsuper
            and candidate.rolname not in (
              'fetanagent_owner_control',
              'fetanagent_owner_control_runtime'
            )
            and has_function_privilege(candidate.oid, routine_oid::oid, 'EXECUTE')`,
        [publicSignatures],
      );
      expect(unexpectedPublicExecutors.rows).toEqual([{ executor_count: 0 }]);

      const privateImplementations = await client.query<{
        readonly group_execute: boolean;
        readonly public_execute: boolean;
        readonly runtime_execute: boolean;
      }>(`
        select has_function_privilege(
                 'fetanagent_owner_control', routine.oid, 'EXECUTE'
               ) as group_execute,
               has_function_privilege(
                 'fetanagent_owner_control_runtime', routine.oid, 'EXECUTE'
               ) as runtime_execute,
               exists (
                 select 1
                   from aclexplode(coalesce(
                     routine.proacl,
                     acldefault('f', routine.proowner)
                   )) privilege
                  where privilege.grantee = 0
                    and privilege.privilege_type = 'EXECUTE'
               ) as public_execute
          from pg_proc routine
          join pg_namespace namespace on namespace.oid = routine.pronamespace
         where namespace.nspname = 'app'
           and routine.proname in (
             'arm_private_live_deposit_pilot_by_admin_id',
             'get_private_live_deposit_pilot_status_by_admin_id',
             'prepare_private_live_deposit_pilot_by_admin_id',
             'stop_private_live_deposit_pilot_by_admin_id'
           )
      `);
      expect(privateImplementations.rows).toHaveLength(4);
      expect(
        privateImplementations.rows.every(
          (row) => !row.group_execute && !row.runtime_execute && !row.public_execute,
        ),
      ).toBe(true);

      const effectiveRoutines = await client.query<{ readonly signature: string }>(`
        select routine.oid::regprocedure::text as signature
          from pg_proc routine
          join pg_namespace namespace on namespace.oid = routine.pronamespace
         where namespace.nspname = 'app'
           and has_function_privilege(
             'fetanagent_owner_control_runtime', routine.oid, 'EXECUTE'
           )
         order by signature
      `);
      expect(effectiveRoutines.rows).toEqual([
        { signature: 'app.arm_private_live_deposit_pilot(uuid,uuid)' },
        {
          signature: 'app.associate_owner_validated_player_registration_request(uuid,uuid,text)',
        },
        {
          signature: 'app.decide_owner_player_deposit_eligibility(uuid,uuid,text,text)',
        },
        { signature: 'app.enqueue_cbe_birr_shadow_verification(uuid,uuid,uuid)' },
        { signature: 'app.get_private_live_deposit_pilot_status(uuid,uuid)' },
        { signature: 'app.issue_telegram_beta_invite(uuid,text,timestamp with time zone)' },
        { signature: 'app.list_owner_cbe_birr_shadow_verifications(uuid,integer)' },
        { signature: 'app.list_owner_dry_run_deposit_intake(uuid,integer)' },
        { signature: 'app.list_owner_dry_run_fixture_assessments(uuid,integer)' },
        { signature: 'app.list_owner_player_deposit_eligibility(uuid,integer)' },
        {
          signature: 'app.list_owner_player_registration_association_candidates(uuid,integer)',
        },
        { signature: 'app.list_owner_player_registration_requests(uuid,integer)' },
        {
          signature:
            'app.prepare_private_live_deposit_pilot(uuid,uuid,text[],text[],uuid[],bigint,bigint,bigint,bigint,smallint,timestamp with time zone,timestamp with time zone)',
        },
        {
          signature: 'app.record_owner_dry_run_fixture_assessment(uuid,uuid,text,text,text)',
        },
        { signature: 'app.review_owner_dry_run_fixture_assessment(uuid,uuid,text)' },
        {
          signature: 'app.review_owner_player_registration_request(uuid,uuid,text,text)',
        },
        { signature: 'app.revoke_telegram_beta_invite(uuid,uuid,text)' },
        { signature: 'app.stop_private_live_deposit_pilot(uuid,uuid,text)' },
      ]);

      const directRelations = await client.query<{ readonly relation_count: number }>(`
        select count(*)::integer as relation_count
          from pg_class relation
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'app'
           and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
           and (
             (
               relation.relkind = 'S'
               and has_sequence_privilege(
                 'fetanagent_owner_control_runtime', relation.oid,
                 'usage,select,update'
               )
             ) or (
               relation.relkind <> 'S'
               and (
                 has_table_privilege(
                   'fetanagent_owner_control_runtime', relation.oid,
                   'select,insert,update,delete,truncate,references,trigger'
                 )
                 or has_any_column_privilege(
                   'fetanagent_owner_control_runtime', relation.oid,
                   'select,insert,update,references'
                 )
               )
             )
           )
      `);
      expect(directRelations.rows).toEqual([{ relation_count: 0 }]);
    });

    it('binds the Auth UUID, replays prepare once, arms only dry-run, and reaches stop', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const owner = await client.query<{ readonly auth_user_id: string }>(
          `select auth_user_id
             from app.admin_users
            where id = $1::uuid
              and role = 'owner'
              and status = 'active'`,
          [getOwnerAdminId()],
        );
        expect(owner.rows).toHaveLength(1);
        const ownerAuthUserId = owner.rows[0]!.auth_user_id;
        const prerequisites = await createPilotPrerequisites(client);
        const requestId = randomUUID();
        const activeFrom = new Date(Date.now() - 15_000);
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1_000);
        const prepareValues: readonly SqlValue[] = [
          ownerAuthUserId,
          requestId,
          ['cbe_birr'],
          prerequisites.playerIds,
          [prerequisites.submittingCustomerId],
          2_500,
          2_500,
          2_500,
          12_500,
          5,
          activeFrom,
          expiresAt,
        ];
        const prepareSql = `
          select app.prepare_private_live_deposit_pilot(
            $1::uuid, $2::uuid, $3::text[], $4::text[], $5::uuid[],
            $6::bigint, $7::bigint, $8::bigint, $9::bigint, $10::smallint,
            $11::timestamptz, $12::timestamptz
          ) as pilot_revision_id
        `;

        const prepared = await queryAsOwnerControl<{ readonly pilot_revision_id: string }>(
          client,
          prepareSql,
          prepareValues,
        );
        const replay = await queryAsOwnerControl<{ readonly pilot_revision_id: string }>(
          client,
          prepareSql,
          prepareValues,
        );
        expect(replay).toEqual(prepared);
        expect(prepared).toHaveLength(1);
        const pilotRevisionId = prepared[0]!.pilot_revision_id;

        const preparedAudits = await client.query<{
          readonly actor_admin_id: string;
          readonly metadata: unknown;
        }>(
          `select actor_admin_id, metadata
             from app.audit_events
            where action = 'deposit.private_live_pilot_prepared'
              and resource_id = $1::uuid`,
          [pilotRevisionId],
        );
        expect(preparedAudits.rows).toHaveLength(1);
        expect(preparedAudits.rows[0]!.actor_admin_id).toBe(getOwnerAdminId());
        expect(JSON.stringify(preparedAudits.rows[0]!.metadata)).not.toContain(requestId);
        expect(JSON.stringify(preparedAudits.rows[0]!.metadata)).not.toContain(
          prerequisites.playerIds[0],
        );
        expect(JSON.stringify(preparedAudits.rows[0]!.metadata)).not.toContain(
          prerequisites.submittingCustomerId,
        );

        await expectFailureAtSavepoint(client, prepareSql, [
          ...prepareValues.slice(0, 6),
          5_000,
          ...prepareValues.slice(7),
        ]);

        await expectFailureAtSavepoint(client, prepareSql, [
          '66666666-6666-4666-8666-666666666666',
          randomUUID(),
          ...prepareValues.slice(2),
        ]);

        await queryAsOwnerControl(
          client,
          `select app.arm_private_live_deposit_pilot($1::uuid, $2::uuid)`,
          [ownerAuthUserId, pilotRevisionId],
        );
        const armed = await queryAsOwnerControl<Record<string, unknown>>(
          client,
          `select * from app.get_private_live_deposit_pilot_status($1::uuid, $2::uuid)`,
          [ownerAuthUserId, pilotRevisionId],
        );
        expect(armed).toHaveLength(1);
        expect(Object.keys(armed[0]!).sort()).toEqual(
          [
            'configuration_digest',
            'contract_version',
            'expires_at',
            'financially_active',
            'maximum_aggregate_minor',
            'maximum_reservation_count',
            'pilot_revision_id',
            'pilot_status',
            'player_count',
            'provider_count',
            'reserved_amount_minor',
            'reserved_deposit_count',
            'revision',
            'stop_reason_code',
            'stopped_at',
            'submitting_customer_count',
            'switch_mode',
            'within_active_window',
          ].sort(),
        );
        expect(armed[0]).toMatchObject({
          financially_active: false,
          pilot_status: 'armed',
          switch_mode: 'dry_run',
        });
        expect(JSON.stringify(armed[0])).not.toContain(prerequisites.playerIds[0]);
        expect(JSON.stringify(armed[0])).not.toContain(prerequisites.submittingCustomerId);

        const armedAudits = await client.query<{
          readonly actor_admin_id: string;
          readonly metadata: unknown;
        }>(
          `select actor_admin_id, metadata
             from app.audit_events
            where action = 'deposit.private_live_pilot_armed_dormant'
              and resource_id = $1::uuid`,
          [pilotRevisionId],
        );
        expect(armedAudits.rows).toHaveLength(1);
        expect(armedAudits.rows[0]!.actor_admin_id).toBe(getOwnerAdminId());
        expect(armedAudits.rows[0]!.metadata).toMatchObject({ financially_active: false });
        expect(JSON.stringify(armedAudits.rows[0]!.metadata)).not.toContain(
          prerequisites.playerIds[0],
        );
        expect(JSON.stringify(armedAudits.rows[0]!.metadata)).not.toContain(
          prerequisites.submittingCustomerId,
        );

        const armedSwitches = await client.query<{
          readonly feature_key: string;
          readonly mode: string;
          readonly settings: unknown;
        }>(`
          select feature_key, mode::text, settings
            from app.feature_switches
           where feature_key in (
             'cbe_birr_authoritative_verification',
             'deposit_execution',
             'payment_verification',
             'private_live_deposit_pilot',
             'telebirr_authoritative_verification'
           )
           order by feature_key
        `);
        expect(armedSwitches.rows).toEqual([
          { feature_key: 'cbe_birr_authoritative_verification', mode: 'disabled', settings: {} },
          { feature_key: 'deposit_execution', mode: 'disabled', settings: {} },
          { feature_key: 'payment_verification', mode: 'disabled', settings: {} },
          {
            feature_key: 'private_live_deposit_pilot',
            mode: 'dry_run',
            settings: {
              configuration_digest: armed[0]!.configuration_digest,
              contract_version: 1,
              pilot_revision_id: pilotRevisionId,
            },
          },
          {
            feature_key: 'telebirr_authoritative_verification',
            mode: 'disabled',
            settings: {},
          },
        ]);

        await queryAsOwnerControl(
          client,
          `select app.stop_private_live_deposit_pilot($1::uuid, $2::uuid, $3::text)`,
          [ownerAuthUserId, pilotRevisionId, 'execution_uncertainty'],
        );
        await queryAsOwnerControl(
          client,
          `select app.stop_private_live_deposit_pilot($1::uuid, $2::uuid, $3::text)`,
          [ownerAuthUserId, pilotRevisionId, 'execution_uncertainty'],
        );

        const stopped = await queryAsOwnerControl<{
          readonly financially_active: boolean;
          readonly pilot_status: string;
          readonly stop_reason_code: string;
          readonly switch_mode: string;
        }>(
          client,
          `select financially_active, pilot_status, stop_reason_code, switch_mode
             from app.get_private_live_deposit_pilot_status($1::uuid, $2::uuid)`,
          [ownerAuthUserId, pilotRevisionId],
        );
        expect(stopped).toEqual([
          {
            financially_active: false,
            pilot_status: 'stopped',
            stop_reason_code: 'execution_uncertainty',
            switch_mode: 'disabled',
          },
        ]);
        const switches = await client.query<{
          readonly feature_key: string;
          readonly mode: string;
          readonly settings: unknown;
        }>(`
          select feature_key, mode::text, settings
            from app.feature_switches
           where feature_key in (
             'cbe_birr_authoritative_verification',
             'deposit_execution',
             'payment_verification',
             'private_live_deposit_pilot',
             'telebirr_authoritative_verification'
           )
           order by feature_key
        `);
        expect(switches.rows).toHaveLength(5);
        expect(
          switches.rows.every(
            (row) => row.mode === 'disabled' && JSON.stringify(row.settings) === '{}',
          ),
        ).toBe(true);
        const stopAudits = await client.query<{
          readonly actor_admin_id: string;
          readonly metadata: unknown;
        }>(
          `select actor_admin_id, metadata
             from app.audit_events
            where action = 'deposit.private_live_pilot_stopped'
              and resource_id = $1::uuid`,
          [pilotRevisionId],
        );
        expect(stopAudits.rows).toEqual([
          {
            actor_admin_id: getOwnerAdminId(),
            metadata: { reason_code: 'execution_uncertainty' },
          },
        ]);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
