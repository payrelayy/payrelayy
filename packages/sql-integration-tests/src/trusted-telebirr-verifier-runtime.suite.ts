import { randomUUID } from 'node:crypto';

import type { Client, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  completeVerification,
  prepareTelebirrPilot,
  prepareVerification,
} from './private-live-telebirr-proof-lineage.suite.js';

const verifierGroup = 'fetanagent_trusted_telebirr_verifier';
const verifierRuntime = 'fetanagent_trusted_telebirr_verifier_runtime';
const authorityFunction =
  'app.load_private_live_telebirr_verification_authority(uuid,uuid,timestamp with time zone)';
const completionFunction =
  'app.complete_private_live_telebirr_verification(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,bigint,timestamp with time zone,text)';
const internalCompletionFunction =
  'app.complete_private_live_telebirr_verification_internal(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,bigint,timestamp with time zone,text)';
const sessionGuardFunction = 'app.require_trusted_telebirr_verifier_session()';
const settlementGuardFunction = 'app.require_private_live_deposit_pilot_settlement()';
const settlementRuntimeInternalGuardFunction =
  'app.require_private_live_deposit_pilot_settlement_runtime_internal()';
const settlementFinalizerFunction =
  'app.finalize_private_live_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)';

async function expectRoleCallFailure(client: Client, role: string, query: string): Promise<void> {
  await client.query('begin');
  let failure: unknown;
  try {
    await client.query(`set local role ${role}`);
    await client.query(query);
  } catch (error) {
    failure = error;
  } finally {
    await client.query('rollback');
  }
  expect(failure).toBeInstanceOf(Error);
}

async function currentSessionCallFailure(client: Client, query: string): Promise<Error> {
  await client.query('savepoint denied_current_session_call');
  let failure: unknown;
  try {
    await client.query(query);
  } catch (error) {
    failure = error;
    await client.query('rollback to savepoint denied_current_session_call');
  }
  await client.query('release savepoint denied_current_session_call');
  expect(failure).toBeInstanceOf(Error);
  return failure as Error;
}

async function expectCurrentSessionPermissionDenied(client: Client, query: string): Promise<void> {
  const failure = await currentSessionCallFailure(client, query);
  expect(failure.message).toMatch(/permission denied for function/u);
}

async function runtimeValidityPredicate(client: Client): Promise<boolean> {
  const result = await client.query<{ readonly safe: boolean }>(`
    select role.rolcanlogin
           and not role.rolinherit
           and not role.rolsuper
           and not role.rolcreatedb
           and not role.rolcreaterole
           and not role.rolreplication
           and not role.rolbypassrls
           and role.rolconnlimit = 1
           and role.rolvaliduntil is not null
           and role.rolvaliduntil > clock_timestamp() + interval '5 minutes'
           and role.rolvaliduntil <= clock_timestamp() + interval '24 hours 5 minutes'
             as safe
      from pg_roles role
     where role.rolname = '${verifierRuntime}'
  `);
  return result.rows[0]?.safe === true;
}

type AuthorityReaderRow = {
  readonly authority_state_digest: string;
  readonly captured_at: string;
  readonly device_fingerprint: string;
  readonly duplicate_state: string;
  readonly existing_completion: Readonly<Record<string, unknown>> | null;
  readonly owner_customer_id: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly pilot_state: string;
  readonly replay_identities: readonly string[];
  readonly signer_fingerprint: string;
  readonly submitting_customer_id: string;
};

async function readAuthorityAs(
  client: Client,
  role: typeof verifierGroup | typeof verifierRuntime,
  attemptId: string,
  leaseToken: string,
  occurredAt: Date,
): Promise<AuthorityReaderRow> {
  await client.query(`set local role ${role}`);
  try {
    const result = await client.query<AuthorityReaderRow>(
      `
      select payload,
             payload->>'capturedAt' as captured_at,
             payload->>'authorityStateDigest' as authority_state_digest,
             payload#>>'{trustedPilot,state}' as pilot_state,
             payload#>>'{trustedAssignmentSigner,publicKeySpkiSha256}'
               as signer_fingerprint,
             payload#>>'{deviceEnrollment,publicKeySpkiSha256}' as device_fingerprint,
             payload#>>'{databaseAuthority,submittingCustomerId}'
               as submitting_customer_id,
             payload#>>'{databaseAuthority,ownerCustomerId}' as owner_customer_id,
             payload#>'{replayIdentities}' as replay_identities,
             payload#>>'{databaseFacts,duplicateState,state}' as duplicate_state,
             payload#>'{existingCompletion}' as existing_completion
        from (
          select app.load_private_live_telebirr_verification_authority(
            $1::uuid, $2::uuid, $3::timestamptz
          ) as payload
        ) authority
    `,
      [attemptId, leaseToken, occurredAt],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!;
  } finally {
    await client.query('reset role');
  }
}

export function registerTrustedTelebirrVerifierRuntimeSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('dedicated trusted TeleBirr verifier runtime boundary', () => {
    it('creates a dormant NOLOGIN pair with one non-settable inheritance edge', async () => {
      const client = getClient();
      const roles = await client.query<{
        readonly rolbypassrls: boolean;
        readonly rolcanlogin: boolean;
        readonly rolconnlimit: number;
        readonly rolcreatedb: boolean;
        readonly rolcreaterole: boolean;
        readonly rolinherit: boolean;
        readonly rolname: string;
        readonly rolreplication: boolean;
        readonly rolsuper: boolean;
        readonly rolvaliduntil: Date | null;
      }>(`
        select rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
               rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil
          from pg_roles
         where rolname in ('${verifierGroup}', '${verifierRuntime}')
         order by rolname
      `);
      expect(roles.rows).toEqual([
        {
          rolname: verifierGroup,
          rolcanlogin: false,
          rolinherit: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          rolconnlimit: 2,
          rolvaliduntil: null,
        },
        {
          rolname: verifierRuntime,
          rolcanlogin: false,
          rolinherit: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          rolconnlimit: 1,
          rolvaliduntil: null,
        },
      ]);

      const memberships = await client.query<{
        readonly admin_option: boolean;
        readonly group_role: string;
        readonly inherit_option: boolean;
        readonly member_role: string;
        readonly set_option: boolean;
      }>(`
        select granted.rolname as group_role, member.rolname as member_role,
               membership.inherit_option, membership.set_option, membership.admin_option
          from pg_auth_members membership
          join pg_roles granted on granted.oid = membership.roleid
          join pg_roles member on member.oid = membership.member
         where granted.rolname in ('${verifierGroup}', '${verifierRuntime}')
            or member.rolname in ('${verifierGroup}', '${verifierRuntime}')
         order by group_role, member_role
      `);
      expect(memberships.rows).toEqual([
        {
          group_role: verifierGroup,
          member_role: verifierRuntime,
          inherit_option: true,
          set_option: false,
          admin_option: false,
        },
      ]);
      const roleUsage = await client.query<{
        readonly can_set: boolean;
        readonly can_use: boolean;
      }>(`
        select pg_has_role('${verifierRuntime}', '${verifierGroup}', 'USAGE') as can_use,
               pg_has_role('${verifierRuntime}', '${verifierGroup}', 'SET') as can_set
      `);
      expect(roleUsage.rows).toEqual([{ can_use: true, can_set: false }]);

      const settlementMembership = await client.query<{
        readonly group_is_settlement_member: boolean;
        readonly runtime_is_settlement_member: boolean;
      }>(`
        select pg_has_role(
                 '${verifierGroup}', 'fetanagent_verification_settlement', 'MEMBER'
               ) as group_is_settlement_member,
               pg_has_role(
                 '${verifierRuntime}', 'fetanagent_verification_settlement', 'MEMBER'
               ) as runtime_is_settlement_member
      `);
      expect(settlementMembership.rows).toEqual([
        { group_is_settlement_member: false, runtime_is_settlement_member: false },
      ]);
    });

    it('grants exactly two hardened routines with no base-object or extension authority', async () => {
      const client = getClient();
      const functions = await client.query<{
        readonly group_execute: boolean;
        readonly hardened: boolean;
        readonly runtime_execute: boolean;
        readonly signature: string;
      }>(`
        select routine.oid::regprocedure::text as signature,
               routine.prosecdef
                 and routine.proowner = 'postgres'::regrole
                 and routine.proconfig = array['search_path=pg_catalog']::text[] as hardened,
               has_function_privilege('${verifierGroup}', routine.oid, 'EXECUTE')
                 as group_execute,
               has_function_privilege('${verifierRuntime}', routine.oid, 'EXECUTE')
                 as runtime_execute
          from pg_proc routine
          join pg_namespace namespace on namespace.oid = routine.pronamespace
         where namespace.nspname = 'app'
           and has_function_privilege('${verifierGroup}', routine.oid, 'EXECUTE')
         order by signature
      `);
      expect(functions.rows).toEqual([
        {
          signature: completionFunction,
          hardened: true,
          group_execute: true,
          runtime_execute: true,
        },
        {
          signature: authorityFunction,
          hardened: true,
          group_execute: true,
          runtime_execute: true,
        },
      ]);

      const privateInternals = await client.query<{
        readonly group_execute: boolean;
        readonly hardened: boolean;
        readonly owner_only_acl: boolean;
        readonly public_execute: boolean;
        readonly runtime_execute: boolean;
        readonly settlement_runtime_execute: boolean;
        readonly signature: string;
      }>(
        `
        select requested.signature,
               routine.prosecdef
                 and routine.proowner = 'postgres'::regrole
                 and routine.proconfig = array['search_path=pg_catalog']::text[]
                 as hardened,
               has_function_privilege('${verifierGroup}', requested.signature, 'EXECUTE')
                 as group_execute,
               has_function_privilege('${verifierRuntime}', requested.signature, 'EXECUTE')
                 as runtime_execute,
               has_function_privilege(
                 'fetanagent_verification_settlement_runtime',
                 requested.signature,
                 'EXECUTE'
               ) as settlement_runtime_execute,
               exists (
                 select 1
                   from aclexplode(coalesce(
                     routine.proacl, acldefault('f', routine.proowner)
                   )) privilege
                  where privilege.grantee = 0
                    and privilege.privilege_type = 'EXECUTE'
               ) as public_execute,
               not exists (
                 select 1
                   from aclexplode(coalesce(
                     routine.proacl, acldefault('f', routine.proowner)
                   )) privilege
                  where privilege.grantee <> routine.proowner
               ) as owner_only_acl
          from unnest($1::text[]) requested(signature)
          join pg_proc routine on routine.oid = requested.signature::regprocedure
         order by requested.signature
      `,
        [
          [
            internalCompletionFunction,
            sessionGuardFunction,
            settlementGuardFunction,
            settlementRuntimeInternalGuardFunction,
          ],
        ],
      );
      expect(privateInternals.rows).toEqual([
        {
          signature: internalCompletionFunction,
          hardened: true,
          group_execute: false,
          runtime_execute: false,
          settlement_runtime_execute: false,
          public_execute: false,
          owner_only_acl: true,
        },
        {
          signature: settlementGuardFunction,
          hardened: true,
          group_execute: false,
          runtime_execute: false,
          settlement_runtime_execute: false,
          public_execute: false,
          owner_only_acl: true,
        },
        {
          signature: settlementRuntimeInternalGuardFunction,
          hardened: true,
          group_execute: false,
          runtime_execute: false,
          settlement_runtime_execute: false,
          public_execute: false,
          owner_only_acl: true,
        },
        {
          signature: sessionGuardFunction,
          hardened: true,
          group_execute: false,
          runtime_execute: false,
          settlement_runtime_execute: false,
          public_execute: false,
          owner_only_acl: true,
        },
      ]);

      const finalizerBoundary = await client.query<{
        readonly group_execute: boolean;
        readonly public_execute: boolean;
        readonly runtime_execute: boolean;
        readonly settlement_runtime_execute: boolean;
      }>(
        `
        select has_function_privilege('${verifierGroup}', $1::regprocedure, 'EXECUTE')
                 as group_execute,
               has_function_privilege('${verifierRuntime}', $1::regprocedure, 'EXECUTE')
                 as runtime_execute,
               has_function_privilege(
                 'fetanagent_verification_settlement_runtime', $1::regprocedure, 'EXECUTE'
               ) as settlement_runtime_execute,
               exists (
                 select 1
                   from pg_proc routine
                  cross join lateral aclexplode(coalesce(
                    routine.proacl, acldefault('f', routine.proowner)
                  )) privilege
                  where routine.oid = $1::regprocedure
                    and privilege.grantee = 0
                    and privilege.privilege_type = 'EXECUTE'
               ) as public_execute
      `,
        [settlementFinalizerFunction],
      );
      expect(finalizerBoundary.rows).toEqual([
        {
          group_execute: false,
          runtime_execute: false,
          settlement_runtime_execute: true,
          public_execute: false,
        },
      ]);

      const settlementGuardSources = await client.query<{
        readonly definition: string;
        readonly signature: string;
      }>(
        `
        select routine.oid::regprocedure::text as signature,
               pg_get_functiondef(routine.oid) as definition
          from unnest($1::text[]) requested(signature)
          join pg_proc routine on routine.oid = requested.signature::regprocedure
         order by signature
      `,
        [
          [
            settlementFinalizerFunction,
            settlementGuardFunction,
            settlementRuntimeInternalGuardFunction,
          ],
        ],
      );
      const sourceBySignature = new Map(
        settlementGuardSources.rows.map((row) => [row.signature, row.definition.toLowerCase()]),
      );
      expect(sourceBySignature.get(settlementGuardFunction)).toContain(
        "if session_user = 'fetanagent_trusted_telebirr_verifier_runtime' then",
      );
      expect(sourceBySignature.get(settlementGuardFunction)).toContain(
        'perform app.require_trusted_telebirr_verifier_session()',
      );
      expect(sourceBySignature.get(settlementGuardFunction)).toContain(
        'perform app.require_private_live_deposit_pilot_settlement_runtime_internal()',
      );
      expect(sourceBySignature.get(settlementRuntimeInternalGuardFunction)).toContain(
        "'fetanagent_verification_settlement'",
      );
      expect(sourceBySignature.get(settlementRuntimeInternalGuardFunction)).toContain(
        "raise exception 'the private live-deposit pilot settlement role is required.'",
      );
      expect(sourceBySignature.get(settlementFinalizerFunction)).toContain(
        'perform app.require_private_live_deposit_pilot_settlement()',
      );

      const databaseBoundary = await client.query<{
        readonly can_connect: boolean;
        readonly can_create_database_objects: boolean;
        readonly can_create_schema_objects: boolean;
        readonly can_use_temp: boolean;
        readonly usable_schemas: readonly string[];
      }>(`
        select has_database_privilege(
                 '${verifierRuntime}', current_database(), 'CONNECT'
               ) as can_connect,
               has_database_privilege(
                 '${verifierRuntime}', current_database(), 'TEMPORARY'
               ) as can_use_temp,
               has_database_privilege(
                 '${verifierRuntime}', current_database(), 'CREATE'
               ) as can_create_database_objects,
               exists (
                 select 1
                   from pg_namespace namespace
                  where namespace.nspname not in ('pg_catalog', 'information_schema')
                    and namespace.nspname !~ '^pg_(toast|temp)'
                    and has_schema_privilege(
                      '${verifierRuntime}', namespace.oid, 'CREATE'
                    )
               ) as can_create_schema_objects,
               (
                 select coalesce(
                   array_agg(namespace.nspname::text order by namespace.nspname),
                   '{}'::text[]
                 )
                   from pg_namespace namespace
                  where namespace.nspname not in ('pg_catalog', 'information_schema')
                    and namespace.nspname !~ '^pg_(toast|temp)'
                    and has_schema_privilege(
                      '${verifierRuntime}', namespace.oid, 'USAGE'
                    )
               ) as usable_schemas
      `);
      expect(databaseBoundary.rows).toEqual([
        {
          can_connect: true,
          can_use_temp: true,
          can_create_database_objects: false,
          can_create_schema_objects: false,
          usable_schemas: ['app', 'public'],
        },
      ]);

      const pgcryptoBoundary = await client.query<{
        readonly extension_schema: string;
        readonly runtime_schema_usage: boolean;
      }>(`
        select namespace.nspname::text as extension_schema,
               has_schema_privilege(
                 '${verifierRuntime}', namespace.oid, 'USAGE'
               ) as runtime_schema_usage
          from pg_extension extension_catalog
          join pg_namespace namespace on namespace.oid = extension_catalog.extnamespace
         where extension_catalog.extname = 'pgcrypto'
      `);
      expect(pgcryptoBoundary.rows).toEqual([
        { extension_schema: 'extensions', runtime_schema_usage: false },
      ]);

      const directAclSurface = await client.query<{
        readonly grantee: string;
        readonly is_grantable: boolean;
        readonly object_identity: string;
        readonly object_kind: string;
        readonly privilege_type: string;
      }>(
        `
        with verifier_roles as (
          select role.oid, role.rolname::text
            from pg_roles role
           where role.rolname = any($1::text[])
        ), direct_acl as (
          select role.rolname as grantee,
                 'database'::text as object_kind,
                 database_catalog.datname::text as object_identity,
                 privilege.privilege_type,
                 privilege.is_grantable
            from pg_database database_catalog
           cross join lateral aclexplode(database_catalog.datacl) privilege
            join verifier_roles role on role.oid = privilege.grantee
          union all
          select role.rolname,
                 'schema',
                 namespace.nspname::text,
                 privilege.privilege_type,
                 privilege.is_grantable
            from pg_namespace namespace
           cross join lateral aclexplode(namespace.nspacl) privilege
            join verifier_roles role on role.oid = privilege.grantee
          union all
          select role.rolname,
                 'relation',
                 format('%I.%I', namespace.nspname, relation.relname),
                 privilege.privilege_type,
                 privilege.is_grantable
            from pg_class relation
            join pg_namespace namespace on namespace.oid = relation.relnamespace
           cross join lateral aclexplode(relation.relacl) privilege
            join verifier_roles role on role.oid = privilege.grantee
          union all
          select role.rolname,
                 'column',
                 format('%I.%I.%I', namespace.nspname, relation.relname, attribute.attname),
                 privilege.privilege_type,
                 privilege.is_grantable
            from pg_attribute attribute
            join pg_class relation on relation.oid = attribute.attrelid
            join pg_namespace namespace on namespace.oid = relation.relnamespace
           cross join lateral aclexplode(attribute.attacl) privilege
            join verifier_roles role on role.oid = privilege.grantee
           where attribute.attnum > 0
             and not attribute.attisdropped
          union all
          select role.rolname,
                 'routine',
                 routine.oid::regprocedure::text,
                 privilege.privilege_type,
                 privilege.is_grantable
            from pg_proc routine
           cross join lateral aclexplode(routine.proacl) privilege
            join verifier_roles role on role.oid = privilege.grantee
          union all
          select role.rolname,
                 'type',
                 format('%I.%I', namespace.nspname, type_catalog.typname),
                 privilege.privilege_type,
                 privilege.is_grantable
            from pg_type type_catalog
            join pg_namespace namespace on namespace.oid = type_catalog.typnamespace
           cross join lateral aclexplode(type_catalog.typacl) privilege
            join verifier_roles role on role.oid = privilege.grantee
          union all
          select role.rolname,
                 'language',
                 language.lanname::text,
                 privilege.privilege_type,
                 privilege.is_grantable
            from pg_language language
           cross join lateral aclexplode(language.lanacl) privilege
            join verifier_roles role on role.oid = privilege.grantee
        )
        select grantee, object_kind, object_identity, privilege_type, is_grantable
          from direct_acl
         order by object_kind, object_identity, privilege_type, grantee
      `,
        [[verifierGroup, verifierRuntime]],
      );
      expect(directAclSurface.rows).toEqual([
        {
          grantee: verifierGroup,
          object_kind: 'routine',
          object_identity: completionFunction,
          privilege_type: 'EXECUTE',
          is_grantable: false,
        },
        {
          grantee: verifierGroup,
          object_kind: 'routine',
          object_identity: authorityFunction,
          privilege_type: 'EXECUTE',
          is_grantable: false,
        },
        {
          grantee: verifierGroup,
          object_kind: 'schema',
          object_identity: 'app',
          privilege_type: 'USAGE',
          is_grantable: false,
        },
      ]);

      const baseObjects = await client.query<{ readonly capability_count: number }>(`
        select count(*)::integer as capability_count
          from pg_class relation
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname not in ('pg_catalog', 'information_schema')
           and namespace.nspname !~ '^pg_(toast|temp)'
           and has_schema_privilege('${verifierRuntime}', namespace.oid, 'USAGE')
           and (
             (relation.relkind = 'S' and has_sequence_privilege(
               '${verifierRuntime}', relation.oid, 'USAGE,SELECT,UPDATE'
             ))
             or (relation.relkind in ('r','p','v','m','f') and (
               has_table_privilege(
                 '${verifierRuntime}', relation.oid,
                 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
               )
               or has_any_column_privilege(
                 '${verifierRuntime}', relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
               )
             ))
           )
      `);
      expect(baseObjects.rows).toEqual([{ capability_count: 0 }]);

      const reachableRoutines = await client.query<{
        readonly reachable_count: number;
        readonly unexpected_count: number;
        readonly unexpected_security_definer_count: number;
      }>(
        `
        select count(*) filter (
                 where routine.oid = any($1::regprocedure[])
               )::integer as reachable_count,
               count(*) filter (
                 where routine.oid <> all($1::regprocedure[])
               )::integer as unexpected_count,
               count(*) filter (
                 where routine.prosecdef
                   and routine.oid <> all($1::regprocedure[])
               )::integer as unexpected_security_definer_count
          from pg_proc routine
          join pg_namespace namespace on namespace.oid = routine.pronamespace
         where namespace.nspname not in ('pg_catalog', 'information_schema')
           and namespace.nspname !~ '^pg_(toast|temp)'
           and has_schema_privilege('${verifierRuntime}', namespace.oid, 'USAGE')
           and has_function_privilege('${verifierRuntime}', routine.oid, 'EXECUTE')
      `,
        [[authorityFunction, completionFunction]],
      );
      expect(reachableRoutines.rows).toEqual([
        { reachable_count: 2, unexpected_count: 0, unexpected_security_definer_count: 0 },
      ]);
    });

    it('preserves the generic settlement runtime gate and its business-error boundary', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await client.query('set session authorization fetanagent_verification_settlement_runtime');
        const failure = await currentSessionCallFailure(
          client,
          `select * from app.finalize_private_live_verified_deposit_and_enqueue_execution(
            null::uuid, null::uuid, null::uuid
          )`,
        );
        expect(failure.message).toContain('private pilot settlement request is invalid');
        expect(failure.message).not.toContain(
          'private live-deposit pilot settlement role is required',
        );
        await client.query('reset session authorization');
      } finally {
        await client.query('rollback');
      }
    });

    it('denies reader and completion to public, API, Android-facing, service, and worker roles', async () => {
      const client = getClient();
      const deniedRoles = [
        'anon',
        'authenticated',
        'service_role',
        'fetanagent_api',
        'fetanagent_api_runtime',
        'fetanagent_worker',
        'fetanagent_player_actions',
        'fetanagent_player_actions_runtime',
        'fetanagent_customer_web',
        'fetanagent_customer_web_runtime',
        'fetanagent_deposit_executor',
        'fetanagent_deposit_executor_runtime',
        'fetanagent_verification_settlement',
        'fetanagent_verification_settlement_runtime',
      ];
      const denied = await client.query<{
        readonly completion_execute: boolean;
        readonly reader_execute: boolean;
        readonly rolname: string;
      }>(
        `
        select role.rolname,
               has_function_privilege(role.oid, $1::regprocedure, 'EXECUTE') as reader_execute,
               has_function_privilege(role.oid, $2::regprocedure, 'EXECUTE')
                 as completion_execute
          from pg_roles role
         where role.rolname = any($3::text[])
         order by role.rolname
      `,
        [authorityFunction, completionFunction, deniedRoles],
      );
      expect(denied.rows).toHaveLength(deniedRoles.length);
      expect(denied.rows.every((row) => !row.reader_execute && !row.completion_execute)).toBe(true);

      const publicAcl = await client.query<{ readonly public_execute: boolean }>(
        `
        select exists (
          select 1
            from unnest(array[$1::regprocedure, $2::regprocedure]) routine_oid
            join pg_proc routine on routine.oid = routine_oid
           cross join lateral aclexplode(coalesce(
             routine.proacl, acldefault('f', routine.proowner)
           )) privilege
           where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
        ) as public_execute
      `,
        [authorityFunction, completionFunction],
      );
      expect(publicAcl.rows).toEqual([{ public_execute: false }]);

      await expectRoleCallFailure(
        client,
        'fetanagent_api',
        `select app.load_private_live_telebirr_verification_authority(
          '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, null
        )`,
      );
    });

    it('executes only the protected reader through the dedicated inherited boundary', async () => {
      const client = getClient();
      for (const role of [verifierGroup, verifierRuntime]) {
        await client.query('begin');
        try {
          await client.query(`set local role ${role}`);
          const result = await client.query<{ readonly authority: unknown }>(`
            select app.load_private_live_telebirr_verification_authority(
              '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, null
            ) as authority
          `);
          expect(result.rows).toEqual([{ authority: null }]);
        } finally {
          await client.query('rollback');
        }
      }
    });

    it('settles a real TeleBirr attempt, preserves exact replay, and rejects reference reuse', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const pilot = await prepareTelebirrPilot(client, getOwnerAdminId());
        const prepared = await prepareVerification(client, pilot);
        const first = await readAuthorityAs(
          client,
          verifierGroup,
          prepared.lease.verification_attempt_id,
          prepared.lease.lease_token,
          prepared.proof.submitted_at,
        );
        await client.query(`select pg_sleep(0.002)`);
        const second = await readAuthorityAs(
          client,
          verifierRuntime,
          prepared.lease.verification_attempt_id,
          prepared.lease.lease_token,
          prepared.proof.submitted_at,
        );

        expect(Object.keys(first.payload).sort()).toEqual(
          [
            'contractVersion',
            'capturedAt',
            'authorityStateDigest',
            'verificationAttemptId',
            'leaseTokenAccepted',
            'attempt',
            'trustedAssignmentSigner',
            'deviceEnrollment',
            'trustedRequestBinding',
            'assignmentTranscript',
            'replayIdentities',
            'existingCompletion',
            'trustedRequest',
            'trustedPilot',
            'trustedPlayer',
            'trustedProvider',
            'trustedReference',
            'trustedReceiver',
            'trustedPolicy',
            'databaseAuthority',
            'databaseFacts',
          ].sort(),
        );
        expect(first.authority_state_digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
        expect(second.authority_state_digest).toBe(first.authority_state_digest);
        expect(Date.parse(second.captured_at)).toBeGreaterThan(Date.parse(first.captured_at));
        expect(first.pilot_state).toBe('armed');
        expect(first.signer_fingerprint).toBe(`sha256:${'d'.repeat(64)}`);
        expect(first.device_fingerprint).toBe(`sha256:${'e'.repeat(64)}`);
        expect(first.signer_fingerprint).not.toBe(first.device_fingerprint);
        expect(first.submitting_customer_id).toBe(pilot.submittingCustomerId);
        expect(first.owner_customer_id).toBe(pilot.ownerCustomerId);
        expect(first.submitting_customer_id).not.toBe(first.owner_customer_id);
        expect(first.replay_identities).toEqual([]);
        expect(first.duplicate_state).toBe('unused');
        expect(first.existing_completion).toBeNull();

        const switches = await client.query<{
          readonly feature_key: string;
          readonly mode: string;
          readonly settings: Readonly<Record<string, unknown>>;
        }>(`
          select feature_key, mode, settings
            from app.feature_switches
           where feature_key in (
             'cbe_birr_authoritative_verification', 'deposit_execution',
             'payment_verification', 'private_live_deposit_pilot',
             'telebirr_authoritative_verification'
           )
           order by feature_key
        `);
        expect(switches.rows).toEqual([
          {
            feature_key: 'cbe_birr_authoritative_verification',
            mode: 'disabled',
            settings: {},
          },
          { feature_key: 'deposit_execution', mode: 'live', settings: {} },
          { feature_key: 'payment_verification', mode: 'live', settings: {} },
          {
            feature_key: 'private_live_deposit_pilot',
            mode: 'live',
            settings: {
              contract_version: 1,
              pilot_revision_id: pilot.pilotRevisionId,
              configuration_digest: pilot.configurationDigest,
            },
          },
          {
            feature_key: 'telebirr_authoritative_verification',
            mode: 'live',
            settings: {},
          },
        ]);

        const replayIdentity = `sha256:${'f'.repeat(64)}`;
        const boundedValidity = await client.query<{ readonly expires_at: Date }>(`
          select clock_timestamp() + interval '1 hour' as expires_at
        `);
        await client.query(
          `alter role ${verifierRuntime} login valid until '${boundedValidity.rows[0]!.expires_at.toISOString()}'`,
        );
        const completeAsTrustedRuntime = async () => {
          await client.query(`set session authorization ${verifierRuntime}`);
          try {
            await expectCurrentSessionPermissionDenied(
              client,
              `select * from app.finalize_private_live_verified_deposit_and_enqueue_execution(
                '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, '${randomUUID()}'::uuid
              )`,
            );
            await expectCurrentSessionPermissionDenied(
              client,
              'select app.require_private_live_deposit_pilot_settlement()',
            );
            await expectCurrentSessionPermissionDenied(
              client,
              'select app.require_private_live_deposit_pilot_settlement_runtime_internal()',
            );
            return await completeVerification(client, pilot, prepared, {
              disposition: 'settlement_candidate',
              reasonCode: 'exact_proof_match',
              replayIdentity,
            });
          } finally {
            await client.query('reset session authorization');
          }
        };
        const completed = await completeAsTrustedRuntime();
        expect(completed.row).toMatchObject({
          outcome_disposition: 'settlement_candidate',
          settlement_created: true,
          already_completed: false,
        });
        const replay = await readAuthorityAs(
          client,
          verifierRuntime,
          prepared.lease.verification_attempt_id,
          prepared.lease.lease_token,
          prepared.proof.submitted_at,
        );
        expect(replay.replay_identities).toEqual([]);
        expect(replay.duplicate_state).toBe('unused');
        expect(replay.existing_completion).toMatchObject({
          completionRequestKey: completed.completionRequestKey,
          observationBodyDigest: completed.digests.observationBody,
          observationSignatureDigest: completed.digests.observationSignature,
          replayIdentity,
          disposition: 'settlement_candidate',
          reasonCode: 'exact_proof_match',
          receiptPrincipalAmountMinor: '2500',
        });

        await client.query('savepoint duplicate_provider_reference');
        try {
          await expect(
            prepareVerification(client, pilot, 0, {
              fingerprint: prepared.proof.candidate_reference_fingerprint,
            }),
          ).rejects.toThrow(/private_live_deposit_pilot_proofs_provider_reference_key/u);
        } finally {
          await client.query('rollback to savepoint duplicate_provider_reference');
          await client.query('release savepoint duplicate_provider_reference');
        }
      } finally {
        await client.query('rollback');
      }
    });

    it('requires finite runtime validity and rejects NULL, expired, or overlong windows', async () => {
      const client = getClient();
      expect(await runtimeValidityPredicate(client)).toBe(false);
      await client.query('begin');
      try {
        const expired = new Date(Date.now() - 60_000).toISOString();
        await client.query(`alter role ${verifierRuntime} login valid until '${expired}'`);
        expect(await runtimeValidityPredicate(client)).toBe(false);

        const tooLong = new Date(Date.now() + 48 * 60 * 60 * 1_000).toISOString();
        await client.query(`alter role ${verifierRuntime} valid until '${tooLong}'`);
        expect(await runtimeValidityPredicate(client)).toBe(false);

        const bounded = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
        await client.query(`alter role ${verifierRuntime} valid until '${bounded}'`);
        expect(await runtimeValidityPredicate(client)).toBe(true);
      } finally {
        await client.query('rollback');
      }
      expect(await runtimeValidityPredicate(client)).toBe(false);
    });

    it('rejects both financial operations when an open session crosses the five-minute margin', async () => {
      const client = getClient();
      const guardSource = await client.query<{ readonly definition: string }>(
        `select pg_get_functiondef($1::regprocedure) as definition`,
        [sessionGuardFunction],
      );
      const guardDefinition = guardSource.rows[0]?.definition ?? '';
      expect(guardDefinition).toContain("> pg_catalog.clock_timestamp() + interval '5 minutes'");
      expect(guardDefinition).toContain(
        "<= pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'",
      );

      const initiallyBounded = await client.query<{ readonly expires_at: Date }>(`
        select clock_timestamp() + interval '1 hour' as expires_at
      `);
      const expiresAt = initiallyBounded.rows[0]!.expires_at.toISOString();
      await client.query('begin');
      let readerFailure: unknown;
      let completionFailure: unknown;
      try {
        await client.query(`alter role ${verifierRuntime} login valid until '${expiresAt}'`);
        await client.query(`
          create function pg_temp.shorten_trusted_telebirr_runtime_validity()
          returns void
          language plpgsql
          security definer
          set search_path = pg_catalog
          as $shorten$
          begin
            execute format(
              'alter role ${verifierRuntime} valid until %L',
              clock_timestamp() + interval '4 minutes'
            );
          end;
          $shorten$
        `);
        await client.query(
          `revoke all on function pg_temp.shorten_trusted_telebirr_runtime_validity()
             from public`,
        );
        await client.query(
          `grant execute on function pg_temp.shorten_trusted_telebirr_runtime_validity()
             to ${verifierRuntime}`,
        );
        await client.query(`set session authorization ${verifierRuntime}`);
        const beforeMargin = await client.query<{ readonly authority: unknown }>(`
          select app.load_private_live_telebirr_verification_authority(
            '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, null
          ) as authority
        `);
        expect(beforeMargin.rows).toEqual([{ authority: null }]);

        await client.query(`select pg_temp.shorten_trusted_telebirr_runtime_validity()`);

        await client.query('savepoint rejected_expired_reader');
        try {
          await client.query(`
            select app.load_private_live_telebirr_verification_authority(
              '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, null
            )
          `);
        } catch (error) {
          readerFailure = error;
          await client.query('rollback to savepoint rejected_expired_reader');
        }
        await client.query('release savepoint rejected_expired_reader');

        await client.query('savepoint rejected_expired_completion');
        try {
          await client.query(`
            select *
              from app.complete_private_live_telebirr_verification(
                null::uuid, null::uuid, null::uuid,
                null::text, null::text, null::text, null::text, null::text,
                null::timestamptz, null::text, null::text, null::text,
                null::timestamptz, null::text, null::text, null::text,
                null::timestamptz, null::bigint, null::timestamptz, null::text
              )
          `);
        } catch (error) {
          completionFailure = error;
          await client.query('rollback to savepoint rejected_expired_completion');
        }
        await client.query('release savepoint rejected_expired_completion');
      } finally {
        await client.query('rollback');
      }
      for (const failure of [readerFailure, completionFailure]) {
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain(
          'trusted TeleBirr verifier session is not currently authorized',
        );
      }
      const restored = await client.query<{ readonly session_user: string }>(`select session_user`);
      expect(restored.rows).toEqual([{ session_user: 'postgres' }]);
      expect(await runtimeValidityPredicate(client)).toBe(false);
    });

    it('encodes provider-specific switches, exact pilot settings, replay, and key separation', async () => {
      const client = getClient();
      const source = await client.query<{ readonly definition: string }>(
        `
        select pg_get_functiondef($1::regprocedure) as definition
      `,
        [authorityFunction],
      );
      const definition = source.rows[0]?.definition ?? '';
      expect(definition).toContain('perform app.require_trusted_telebirr_verifier_session()');
      expect(definition).toContain("'deposit_execution'");
      expect(definition).toContain("'payment_verification'");
      expect(definition).toContain("'private_live_deposit_pilot'");
      expect(definition).toContain("'telebirr_authoritative_verification'");
      expect(definition).not.toContain("'cbe_birr_authoritative_verification'");
      expect(definition).toContain('switch_count = 4');
      expect(definition).toContain("'pilot_revision_id', pilot.id::text");
      expect(definition).toContain("'configuration_digest', pilot.configuration_digest");
      expect(definition).toContain("telebirr_switch_settings = '{}'::jsonb");
      expect(definition).toContain("provider_member.provider_code_snapshot = 'telebirr'");
      expect(definition).toContain("current_provider.code = 'telebirr'");
      expect(definition).toContain('assignment_signer.signer_key_id = device_enrollment.key_id');
      expect(definition).toMatch(
        /assignment_signer\.public_key_spki_sha256\s*=\s*device_enrollment\.public_key_spki_sha256/u,
      );
      expect(definition).toContain('observation.verification_attempt_id <> attempted.id');
      expect(definition).toContain('existing_current_outcome.id');
      expect(definition).toContain("'privatePilotSwitchSettings'");
      expect(definition).toContain("'telebirrSwitchSettings'");
      expect(definition).toContain("'existingCompletion'");

      const completionSource = await client.query<{ readonly definition: string }>(
        `select pg_get_functiondef($1::regprocedure) as definition`,
        [completionFunction],
      );
      expect(completionSource.rows[0]?.definition ?? '').toContain(
        'perform app.require_trusted_telebirr_verifier_session()',
      );

      await client.query('begin');
      try {
        const pilotRevisionId = randomUUID();
        const configurationDigest = `sha256:${'a'.repeat(64)}`;
        await client.query(`
          update app.feature_switches
             set mode = case
               when feature_key in (
                 'deposit_execution', 'payment_verification',
                 'private_live_deposit_pilot', 'telebirr_authoritative_verification'
               ) then 'live' else mode end
           where feature_key in (
             'cbe_birr_authoritative_verification', 'deposit_execution',
             'payment_verification', 'private_live_deposit_pilot',
             'telebirr_authoritative_verification'
           )
        `);
        await client.query(
          `
          update app.feature_switches
             set settings = jsonb_build_object(
               'contract_version', 1,
               'pilot_revision_id', $1::text,
               'configuration_digest', $2::text
             )
           where feature_key = 'private_live_deposit_pilot'
        `,
          [pilotRevisionId, configurationDigest],
        );
        const telebirrOnly = await client.query<{ readonly live_count: number }>(`
          select count(*)::integer as live_count
            from app.feature_switches
           where feature_key in (
             'deposit_execution', 'payment_verification',
             'private_live_deposit_pilot', 'telebirr_authoritative_verification'
           ) and mode = 'live'
        `);
        expect(telebirrOnly.rows).toEqual([{ live_count: 4 }]);
        const cbeDisabled = await client.query<{ readonly mode: string }>(`
          select mode from app.feature_switches
           where feature_key = 'cbe_birr_authoritative_verification'
        `);
        expect(cbeDisabled.rows).toEqual([{ mode: 'disabled' }]);
        const exactSettings = await client.query<{ readonly accepted: boolean }>(
          `
          select (
            select settings = jsonb_build_object(
              'contract_version', 1,
              'pilot_revision_id', $1::text,
              'configuration_digest', $2::text
            )
              from app.feature_switches
             where feature_key = 'private_live_deposit_pilot'
          ) and (
            select settings = '{}'::jsonb
              from app.feature_switches
             where feature_key = 'telebirr_authoritative_verification'
          ) as accepted
        `,
          [pilotRevisionId, configurationDigest],
        );
        expect(exactSettings.rows).toEqual([{ accepted: true }]);
        const wrongSettings = await client.query<{
          readonly wrong_digest_accepted: boolean;
          readonly wrong_pilot_accepted: boolean;
        }>(
          `
          select settings = jsonb_build_object(
                   'contract_version', 1,
                   'pilot_revision_id', $1::text,
                   'configuration_digest', $2::text
                 ) as wrong_pilot_accepted,
                 settings = jsonb_build_object(
                   'contract_version', 1,
                   'pilot_revision_id', $3::text,
                   'configuration_digest', $4::text
                 ) as wrong_digest_accepted
            from app.feature_switches
           where feature_key = 'private_live_deposit_pilot'
        `,
          [randomUUID(), configurationDigest, pilotRevisionId, `sha256:${'b'.repeat(64)}`],
        );
        expect(wrongSettings.rows).toEqual([
          { wrong_pilot_accepted: false, wrong_digest_accepted: false },
        ]);

        await client.query(`
          update app.feature_switches set mode = case
            when feature_key = 'telebirr_authoritative_verification' then 'disabled'
            when feature_key = 'cbe_birr_authoritative_verification' then 'live'
            else mode end
           where feature_key in (
             'cbe_birr_authoritative_verification',
             'telebirr_authoritative_verification'
           )
        `);
        const wrongProvider = await client.query<{ readonly live_count: number }>(`
          select count(*)::integer as live_count
            from app.feature_switches
           where feature_key in (
             'deposit_execution', 'payment_verification',
             'private_live_deposit_pilot', 'telebirr_authoritative_verification'
           ) and mode = 'live'
        `);
        expect(wrongProvider.rows).toEqual([{ live_count: 3 }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('leaves every financial and provider switch disabled after migration', async () => {
      const switches = await getClient().query<{
        readonly feature_key: string;
        readonly mode: string;
      }>(`
        select feature_key, mode
          from app.feature_switches
         where feature_key in (
           'cbe_birr_authoritative_verification', 'deposit_execution',
           'payment_verification', 'private_live_deposit_pilot',
           'telebirr_authoritative_verification'
         )
         order by feature_key
      `);
      expect(switches.rows).toEqual([
        { feature_key: 'cbe_birr_authoritative_verification', mode: 'disabled' },
        { feature_key: 'deposit_execution', mode: 'disabled' },
        { feature_key: 'payment_verification', mode: 'disabled' },
        { feature_key: 'private_live_deposit_pilot', mode: 'disabled' },
        { feature_key: 'telebirr_authoritative_verification', mode: 'disabled' },
      ]);
    });
  });
}
