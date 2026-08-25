import { randomUUID } from 'node:crypto';

import type { Client, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

type SqlValue = boolean | number | string | null;

async function queryAsOwnerControl<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  const savepoint = `readiness_owner_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
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

async function queryAsExactOwnerRuntime<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  try {
    await client.query('set session authorization fetanagent_owner_control_runtime');
    const result = await client.query<T>(query, [...values]);
    await client.query('reset session authorization');
    return result.rows;
  } catch (error) {
    await client.query('reset session authorization');
    throw error;
  }
}

async function expectFailure(operation: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  let failure: unknown;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toMatch(pattern);
}

async function deactivateExistingAssociatedKemerbetCustomers(client: Client): Promise<void> {
  await client.query(`
    update app.customers customer
       set status = 'inactive'
     where customer.status = 'active'
       and exists (
         select 1
           from app.player_registration_request_associations association
           join app.customer_platform_players player
             on player.id = association.player_account_id
           join app.platforms platform on platform.id = player.platform_id
          where player.customer_id = customer.id
            and platform.code = 'kemerbet'
       )
  `);
}

async function createEligibleAssociatedPlayer(
  client: Client,
  ownerAuthUserId: string,
  ordinal: number,
): Promise<string> {
  const customer = await client.query<{ readonly id: string }>(
    'insert into app.customers default values returning id::text',
  );
  const registration = await client.query<{ readonly id: string }>(
    `insert into app.player_registration_requests (customer_id, platform_id, player_id)
     select $1::uuid, platform.id, $2::text
       from app.platforms platform
      where platform.code = 'kemerbet'
     returning id::text`,
    [customer.rows[0]!.id, `READINESS_SQL_${ordinal}`],
  );
  const requestId = registration.rows[0]!.id;
  await queryAsOwnerControl(
    client,
    `select * from app.review_owner_player_registration_request(
       $1::uuid, $2::uuid, 'exists', 'owner_platform_lookup'
     )`,
    [ownerAuthUserId, requestId],
  );
  const association = await queryAsOwnerControl<{
    readonly associated_player_account_id: string;
  }>(
    client,
    `select associated_player_account_id::text
       from app.associate_owner_validated_player_registration_request(
         $1::uuid, $2::uuid, 'owner_verified_platform_ownership'
       )`,
    [ownerAuthUserId, requestId],
  );
  expect(association).toHaveLength(1);
  const playerAccountId = association[0]!.associated_player_account_id;
  await queryAsOwnerControl(
    client,
    `select * from app.decide_owner_player_deposit_eligibility(
       $1::uuid, $2::uuid, 'eligible', 'financial_eligibility_approved'
     )`,
    [ownerAuthUserId, playerAccountId],
  );
  return playerAccountId;
}

async function createExactFive(
  client: Client,
  ownerAuthUserId: string,
): Promise<readonly string[]> {
  const activeProfile = await client.query<{ readonly count: number }>(`
    select count(*)::integer
      from app.private_owner_kemerbet_agent_profile_revisions profile
      join app.platform_agent_accounts agent on agent.id = profile.platform_agent_account_id
      join app.platforms platform on platform.id = profile.platform_id
     where platform.code = 'kemerbet'
       and platform.status = 'active'
       and agent.status = 'active'
       and profile.retired_at is null
       and profile.profile_contract_version = 1
  `);
  if (activeProfile.rows[0]?.count === 0) {
    await queryAsOwnerControl(
      client,
      `select * from app.prepare_owner_kemerbet_agent_profile(
         $1::uuid, $2::uuid, 'initial_configuration'
       )`,
      [ownerAuthUserId, randomUUID()],
    );
  } else {
    expect(activeProfile.rows).toEqual([{ count: 1 }]);
  }
  await deactivateExistingAssociatedKemerbetCustomers(client);
  const playerAccountIds: string[] = [];
  for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
    playerAccountIds.push(await createEligibleAssociatedPlayer(client, ownerAuthUserId, ordinal));
  }
  return playerAccountIds;
}

const PREPARE_SQL = `
  select *
    from app.prepare_owner_kemerbet_readiness_cohort_claim($1::uuid, $2::uuid)
   order by member_ordinal
`;

const ADVANCE_EXPORTED_SQL = `
  select *
    from app.advance_owner_kemerbet_readiness_cohort_claim(
      $1::uuid, $2::uuid, $3::uuid, 'exported'
    )
`;

const RECORD_ROOT_RECEIPT_SQL = `
  select *
    from app.record_owner_kemerbet_readiness_cohort_root_receipt(
      $1::uuid, $2::uuid, $3::text, $4::text
    )
`;

export function registerOwnerKemerbetReadinessCohortSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('private exact-five KemerBet readiness cohort claim', () => {
    it('seals every ledger table and grants only the three reviewed runtime procedures', async () => {
      const client = getClient();
      const boundary = await client.query<{
        readonly direct_table_access_denied: boolean;
        readonly sealed_tables: number;
      }>(`
        select count(*) filter (
                 where relation.relrowsecurity
                   and relation.relforcerowsecurity
                   and not exists (
                     select 1 from pg_policy policy where policy.polrelid = relation.oid
                   )
               )::integer as sealed_tables,
               bool_and(not has_table_privilege(
                 'fetanagent_owner_control_runtime', relation.oid,
                 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
               )) as direct_table_access_denied
          from pg_class relation
         where relation.oid = any(array[
           'app.private_owner_kemerbet_readiness_cohort_gate'::regclass,
           'app.private_owner_kemerbet_readiness_cohort_claims'::regclass,
           'app.private_owner_kemerbet_readiness_cohort_members'::regclass,
           'app.private_owner_kemerbet_readiness_cohort_requests'::regclass,
           'app.private_owner_kemerbet_readiness_cohort_receipts'::regclass
         ])
      `);
      expect(boundary.rows).toEqual([{ direct_table_access_denied: true, sealed_tables: 5 }]);

      const sourceGuards = await client.query<{
        readonly dml_guards: number;
        readonly table_name: string;
        readonly truncate_guards: number;
      }>(`
        select relation.relname as table_name,
               count(trigger.oid) filter (where trigger.tgtype = 30)::integer as dml_guards,
               count(trigger.oid) filter (where trigger.tgtype = 34)::integer as truncate_guards
          from pg_trigger trigger
          join pg_class relation on relation.oid = trigger.tgrelid
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'app'
           and not trigger.tgisinternal
           and trigger.tgfoid =
             'app.serialize_private_owner_kemerbet_readiness_source_mutation()'::regprocedure
         group by relation.relname
         order by relation.relname collate pg_catalog."C"
      `);
      expect(sourceGuards.rows).toHaveLength(11);
      expect(sourceGuards.rows.map((row) => row.table_name)).toEqual([
        'customer_platform_players',
        'customers',
        'feature_switches',
        'platform_agent_accounts',
        'platforms',
        'player_deposit_eligibility_decisions',
        'player_registration_request_associations',
        'player_registration_requests',
        'player_validation_attempts',
        'private_live_deposit_pilot_revisions',
        'private_owner_kemerbet_agent_profile_revisions',
      ]);
      expect(
        sourceGuards.rows.reduce((total, row) => total + row.dml_guards + row.truncate_guards, 0),
      ).toBe(22);
      expect(
        sourceGuards.rows.every((row) => row.dml_guards === 1 && row.truncate_guards === 1),
      ).toBe(true);

      const routines = await client.query<{
        readonly group_execute: boolean;
        readonly hardened: boolean;
        readonly public_execute: boolean;
        readonly signature: string;
      }>(`
        select routine.oid::regprocedure::text as signature,
               routine.prosecdef
                 and routine.proowner = 'postgres'::regrole
                 and routine.proconfig = array['search_path=pg_catalog']::text[] as hardened,
               has_function_privilege(
                 'fetanagent_owner_control', routine.oid, 'EXECUTE'
               ) as group_execute,
               exists (
                 select 1
                   from aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) acl
                  where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
               ) as public_execute
          from pg_proc routine
         where routine.oid = any(array[
           'app.prepare_owner_kemerbet_readiness_cohort_claim(uuid,uuid)'::regprocedure,
           'app.advance_owner_kemerbet_readiness_cohort_claim(uuid,uuid,uuid,text)'::regprocedure,
           'app.record_owner_kemerbet_readiness_cohort_root_receipt(uuid,uuid,text,text)'::regprocedure
         ])
         order by signature
      `);
      expect(routines.rows).toHaveLength(3);
      expect(routines.rows.every((row) => row.hardened && row.group_execute)).toBe(true);
      expect(routines.rows.every((row) => !row.public_execute)).toBe(true);

      const source = await client.query<{ readonly definition: string }>(`
        select pg_get_functiondef(
          'app.require_private_owner_kemerbet_readiness_claim_current(uuid)'::regprocedure
        ) as definition
      `);
      expect(source.rows[0]!.definition).toMatch(/\b(?:COLLATE|collate)\s+pg_catalog\."C"/u);
      expect(source.rows[0]!.definition).not.toMatch(/\blimit\s+(?:5|50)\b/iu);
    });

    it('rejects a global sixth eligible Player instead of trusting a bounded Owner list', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const owner = await client.query<{ readonly auth_user_id: string }>(
          `select auth_user_id::text
             from app.admin_users
            where id = $1::uuid and role = 'owner' and status = 'active'`,
          [getOwnerAdminId()],
        );
        const ownerAuthUserId = owner.rows[0]!.auth_user_id;
        await createExactFive(client, ownerAuthUserId);
        await createEligibleAssociatedPlayer(client, ownerAuthUserId, 6);

        await expectFailure(
          () => queryAsOwnerControl(client, PREPARE_SQL, [ownerAuthUserId, randomUUID()]),
          /requires exactly five current eligible Players/iu,
        );
        const claims = await client.query<{ readonly count: number }>(
          'select count(*)::integer from app.private_owner_kemerbet_readiness_cohort_claims',
        );
        expect(claims.rows).toEqual([{ count: 0 }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('refuses to create the one-use input unless the money boundary is fully disabled', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const owner = await client.query<{ readonly auth_user_id: string }>(
          'select auth_user_id::text from app.admin_users where id = $1::uuid',
          [getOwnerAdminId()],
        );
        const ownerAuthUserId = owner.rows[0]!.auth_user_id;
        await createExactFive(client, ownerAuthUserId);
        await client.query(`
          update app.feature_switches
             set mode = 'dry_run'
           where feature_key = 'payment_verification'
        `);

        await expectFailure(
          () => queryAsOwnerControl(client, PREPARE_SQL, [ownerAuthUserId, randomUUID()]),
          /money switch|money boundary|disabled/iu,
        );
      } finally {
        await client.query('rollback');
      }
    });

    it('refuses to prepare while an expired draft private live-money pilot remains open', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const owner = await client.query<{ readonly auth_user_id: string }>(
          'select auth_user_id::text from app.admin_users where id = $1::uuid',
          [getOwnerAdminId()],
        );
        const ownerAuthUserId = owner.rows[0]!.auth_user_id;
        await createExactFive(client, ownerAuthUserId);
        const pilotRequestId = randomUUID();
        const pilot = await client.query<{ readonly id: string }>(
          `insert into app.private_live_deposit_pilot_revisions (
             prepare_request_key,
             prepare_request_digest,
             platform_id,
             platform_agent_account_id,
             platform_agent_label_snapshot,
             platform_agent_updated_at_snapshot,
             minimum_amount_minor,
             maximum_per_deposit_minor,
             maximum_per_player_minor,
             maximum_aggregate_minor,
             maximum_reservation_count,
             active_from,
             expires_at,
             created_by_admin_id
           )
           select $1::uuid,
                  'sha256:' || replace($1::text, '-', '') || replace($1::text, '-', ''),
                  platform.id,
                  agent.id,
                  agent.label,
                  agent.updated_at,
                  2500,
                  2500,
                  2500,
                  12500,
                  5,
                  clock_timestamp() - interval '3 hours',
                  clock_timestamp() - interval '1 hour',
                  $2::uuid
             from app.platforms platform
             join app.platform_agent_accounts agent on agent.platform_id = platform.id
            where platform.code = 'kemerbet'
              and platform.status = 'active'
              and agent.status = 'active'
           returning id::text`,
          [pilotRequestId, getOwnerAdminId()],
        );
        expect(pilot.rows).toHaveLength(1);

        await expectFailure(
          () => queryAsOwnerControl(client, PREPARE_SQL, [ownerAuthUserId, randomUUID()]),
          /no open private live-money pilot/iu,
        );
      } finally {
        await client.query('rollback');
      }
    });

    it('refuses to prepare after the configured KemerBet profile drifts', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const owner = await client.query<{ readonly auth_user_id: string }>(
          'select auth_user_id::text from app.admin_users where id = $1::uuid',
          [getOwnerAdminId()],
        );
        const ownerAuthUserId = owner.rows[0]!.auth_user_id;
        await createExactFive(client, ownerAuthUserId);
        const retired = await client.query<{ readonly id: string }>(`
          update app.private_owner_kemerbet_agent_profile_revisions profile
             set retired_at = clock_timestamp()
            from app.platforms platform,
                 app.platform_agent_accounts agent
           where platform.id = profile.platform_id
             and platform.code = 'kemerbet'
             and platform.status = 'active'
             and agent.id = profile.platform_agent_account_id
             and agent.status = 'active'
             and profile.retired_at is null
             and profile.profile_contract_version = 1
          returning profile.id::text
        `);
        expect(retired.rows).toHaveLength(1);

        await expectFailure(
          () => queryAsOwnerControl(client, PREPARE_SQL, [ownerAuthUserId, randomUUID()]),
          /one active configured agent profile/iu,
        );
      } finally {
        await client.query('rollback');
      }
    });

    it('binds exactly five, freezes source writes, ingests root receipts, and releases only on terminal success', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const owner = await client.query<{ readonly auth_user_id: string }>(
          'select auth_user_id::text from app.admin_users where id = $1::uuid',
          [getOwnerAdminId()],
        );
        const ownerAuthUserId = owner.rows[0]!.auth_user_id;
        const expectedPlayers = await createExactFive(client, ownerAuthUserId);
        const requestId = randomUUID();
        const prepared = await queryAsOwnerControl<{
          readonly cohort_already_claimed: boolean;
          readonly cohort_id: string;
          readonly cohort_state: string;
          readonly member_ordinal: number;
          readonly player_account_id: string;
        }>(client, PREPARE_SQL, [ownerAuthUserId, requestId]);
        expect(prepared).toHaveLength(5);
        expect(new Set(prepared.map((row) => row.cohort_id)).size).toBe(1);
        expect(prepared.every((row) => row.cohort_state === 'prepared')).toBe(true);
        expect(prepared.every((row) => !row.cohort_already_claimed)).toBe(true);
        expect(prepared.map((row) => row.member_ordinal)).toEqual([1, 2, 3, 4, 5]);
        expect(new Set(prepared.map((row) => row.player_account_id))).toEqual(
          new Set(expectedPlayers),
        );
        const claimId = prepared[0]!.cohort_id;

        const replay = await queryAsOwnerControl<{
          readonly cohort_already_claimed: boolean;
          readonly cohort_id: string;
        }>(client, PREPARE_SQL, [ownerAuthUserId, requestId]);
        expect(replay).toHaveLength(5);
        expect(replay.every((row) => row.cohort_id === claimId)).toBe(true);
        expect(replay.every((row) => row.cohort_already_claimed)).toBe(true);

        const exported = await queryAsOwnerControl<{
          readonly advanced_claim_state: string;
          readonly transition_already_recorded: boolean;
        }>(client, ADVANCE_EXPORTED_SQL, [ownerAuthUserId, requestId, claimId]);
        expect(exported).toMatchObject([
          { advanced_claim_state: 'exported', transition_already_recorded: false },
        ]);

        await expectFailure(async () => {
          await client.query('savepoint frozen_source_write');
          try {
            await client.query('insert into app.customers default values');
            await client.query('release savepoint frozen_source_write');
          } catch (error) {
            await client.query('rollback to savepoint frozen_source_write');
            await client.query('release savepoint frozen_source_write');
            throw error;
          }
        }, /readiness cohort is frozen/iu);

        await expectFailure(async () => {
          await client.query('savepoint frozen_money_switch_write');
          try {
            await client.query(`
              update app.feature_switches
                 set mode = 'dry_run'
               where feature_key = 'payment_verification'
            `);
            await client.query('release savepoint frozen_money_switch_write');
          } catch (error) {
            await client.query('rollback to savepoint frozen_money_switch_write');
            await client.query('release savepoint frozen_money_switch_write');
            throw error;
          }
        }, /readiness cohort is frozen/iu);

        const importedReceiptId = randomUUID();
        const imported = await queryAsExactOwnerRuntime<{
          readonly receipt_already_recorded: boolean;
          readonly recorded_claim_state: string;
          readonly recorded_receipt_event: string;
          readonly recorded_receipt_id: string;
        }>(client, RECORD_ROOT_RECEIPT_SQL, [claimId, importedReceiptId, 'imported', null]);
        expect(imported).toMatchObject([
          {
            receipt_already_recorded: false,
            recorded_claim_state: 'imported',
            recorded_receipt_event: 'imported',
            recorded_receipt_id: importedReceiptId,
          },
        ]);

        const importedReplay = await queryAsExactOwnerRuntime<{
          readonly receipt_already_recorded: boolean;
          readonly recorded_receipt_id: string;
        }>(client, RECORD_ROOT_RECEIPT_SQL, [claimId, randomUUID(), 'imported', null]);
        expect(importedReplay).toMatchObject([
          { receipt_already_recorded: true, recorded_receipt_id: importedReceiptId },
        ]);

        const completed = await queryAsExactOwnerRuntime<{
          readonly receipt_already_recorded: boolean;
          readonly recorded_claim_state: string;
          readonly recorded_receipt_event: string;
        }>(client, RECORD_ROOT_RECEIPT_SQL, [claimId, randomUUID(), 'completed', null]);
        expect(completed).toMatchObject([
          {
            receipt_already_recorded: false,
            recorded_claim_state: 'succeeded',
            recorded_receipt_event: 'completed',
          },
        ]);

        const resumed = await client.query<{ readonly id: string }>(
          'insert into app.customers default values returning id::text',
        );
        expect(resumed.rows).toHaveLength(1);

        const ledger = await client.query<{
          readonly events: string[];
          readonly has_concrete_identifier_leak: boolean;
          readonly has_sensitive_metadata: boolean;
          readonly state: string;
        }>(
          `select claim.claim_state as state,
                  array_agg(receipt.receipt_event order by receipt.recorded_at) as events,
                  exists (
                    select 1 from app.audit_events audit
                     where audit.resource_id = claim.id
                       and audit.metadata::text ~* '(player[_ -]?id|digest|account)'
                  ) as has_sensitive_metadata,
                  exists (
                    select 1
                      from app.audit_events audit
                      cross join unnest($2::text[]) as concrete_identifier(value)
                     where audit.resource_id = claim.id
                       and position(concrete_identifier.value in to_jsonb(audit)::text) > 0
                  ) as has_concrete_identifier_leak
             from app.private_owner_kemerbet_readiness_cohort_claims claim
             join app.private_owner_kemerbet_readiness_cohort_receipts receipt
               on receipt.claim_id = claim.id
            where claim.id = $1::uuid
            group by claim.id`,
          [
            claimId,
            [
              ...expectedPlayers,
              'READINESS_SQL_1',
              'READINESS_SQL_2',
              'READINESS_SQL_3',
              'READINESS_SQL_4',
              'READINESS_SQL_5',
            ],
          ],
        );
        expect(ledger.rows).toEqual([
          {
            events: ['imported', 'completed'],
            has_concrete_identifier_leak: false,
            has_sensitive_metadata: false,
            state: 'succeeded',
          },
        ]);
      } finally {
        await client.query('rollback');
      }
    });

    it('closes the pre-export crash window and permanently rejects a fresh request after success', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const owner = await client.query<{ readonly auth_user_id: string }>(
          'select auth_user_id::text from app.admin_users where id = $1::uuid',
          [getOwnerAdminId()],
        );
        const ownerAuthUserId = owner.rows[0]!.auth_user_id;
        const expectedPlayers = await createExactFive(client, ownerAuthUserId);
        const requestId = randomUUID();
        const prepared = await queryAsOwnerControl<{ readonly cohort_id: string }>(
          client,
          PREPARE_SQL,
          [ownerAuthUserId, requestId],
        );
        const claimId = prepared[0]!.cohort_id;

        const completed = await queryAsExactOwnerRuntime<{
          readonly recorded_claim_state: string;
          readonly recorded_receipt_event: string;
        }>(client, RECORD_ROOT_RECEIPT_SQL, [claimId, randomUUID(), 'completed', null]);
        expect(completed).toMatchObject([
          { recorded_claim_state: 'succeeded', recorded_receipt_event: 'completed' },
        ]);
        const receiptEvents = await client.query<{ readonly receipt_event: string }>(
          `select receipt_event
             from app.private_owner_kemerbet_readiness_cohort_receipts
            where claim_id = $1::uuid
            order by recorded_at, receipt_event`,
          [claimId],
        );
        expect(receiptEvents.rows.map((row) => row.receipt_event).sort()).toEqual([
          'completed',
          'imported',
        ]);

        const sameRequestReplay = await queryAsOwnerControl<{
          readonly cohort_already_claimed: boolean;
          readonly cohort_id: string;
          readonly cohort_state: string;
        }>(client, PREPARE_SQL, [ownerAuthUserId, requestId]);
        expect(sameRequestReplay).toHaveLength(5);
        expect(
          sameRequestReplay.every(
            (row) =>
              row.cohort_id === claimId &&
              row.cohort_state === 'succeeded' &&
              row.cohort_already_claimed,
          ),
        ).toBe(true);

        await expectFailure(
          () => queryAsOwnerControl(client, PREPARE_SQL, [ownerAuthUserId, randomUUID()]),
          /one-use|already succeeded|fresh request is not allowed/iu,
        );
        const claims = await client.query<{ readonly count: number }>(
          'select count(*)::integer from app.private_owner_kemerbet_readiness_cohort_claims',
        );
        expect(claims.rows).toEqual([{ count: 1 }]);

        await client.query(
          `update app.customers customer
              set status = 'inactive'
             from app.customer_platform_players player
            where player.id = $1::uuid
              and customer.id = player.customer_id`,
          [expectedPlayers[0]],
        );
        await expectFailure(
          () => queryAsOwnerControl(client, PREPARE_SQL, [ownerAuthUserId, requestId]),
          /cohort is no longer current/iu,
        );
      } finally {
        await client.query('rollback');
      }
    });

    it('permits a fresh request only after a clean terminal failure', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const owner = await client.query<{ readonly auth_user_id: string }>(
          'select auth_user_id::text from app.admin_users where id = $1::uuid',
          [getOwnerAdminId()],
        );
        const ownerAuthUserId = owner.rows[0]!.auth_user_id;
        await createExactFive(client, ownerAuthUserId);
        const failedRequestId = randomUUID();
        const first = await queryAsOwnerControl<{ readonly cohort_id: string }>(
          client,
          PREPARE_SQL,
          [ownerAuthUserId, failedRequestId],
        );
        const failedClaimId = first[0]!.cohort_id;
        const failed = await queryAsExactOwnerRuntime<{
          readonly recorded_claim_state: string;
          readonly recorded_receipt_event: string;
        }>(client, RECORD_ROOT_RECEIPT_SQL, [
          failedClaimId,
          randomUUID(),
          'failed_terminal',
          'operator_cancelled_cleanup_confirmed',
        ]);
        expect(failed).toMatchObject([
          {
            recorded_claim_state: 'failed_terminal',
            recorded_receipt_event: 'failed_terminal',
          },
        ]);

        await expectFailure(
          () => queryAsOwnerControl(client, PREPARE_SQL, [ownerAuthUserId, failedRequestId]),
          /terminally failed claim|fresh request/iu,
        );

        const retry = await queryAsOwnerControl<{
          readonly cohort_id: string;
          readonly cohort_state: string;
        }>(client, PREPARE_SQL, [ownerAuthUserId, randomUUID()]);
        expect(retry).toHaveLength(5);
        expect(retry.every((row) => row.cohort_state === 'prepared')).toBe(true);
        expect(retry[0]!.cohort_id).not.toBe(failedClaimId);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
