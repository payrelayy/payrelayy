const GROUP_ROLE = 'fetanagent_player_actions';
const RUNTIME_ROLE = 'fetanagent_player_actions_runtime';

const ALLOWED_FUNCTIONS = [
  'app.reserve_telegram_private_action_nonce(text,timestamptz)',
  'app.record_public_telegram_action_inbound_event(bigint,bigint,bigint,text,text)',
  'app.issue_telegram_player_registration_capability(uuid,uuid,text,text)',
  'app.start_telegram_player_registration_action(uuid,uuid,text,text)',
  'app.submit_telegram_player_registration_input(uuid,text,text)',
  'app.expire_telegram_player_registration_action(uuid,text)',
  'app.open_telegram_dry_run_deposit_intent(uuid,text,bigint,text)',
  'app.capture_telegram_dry_run_deposit_reference(uuid,uuid,text,text,text,smallint,text)',
  'app.capture_telegram_dry_run_deposit_proof(uuid,text,text,text,text,text,smallint,smallint,text)',
  'app.get_telegram_customer_deposit(uuid,uuid)',
  'app.get_telegram_customer_deposit_proof(uuid,uuid)',
] as const;

const ALLOWED_FUNCTION_SQL = ALLOWED_FUNCTIONS.map(
  (signature) => `pg_catalog.to_regprocedure('${signature}')`,
).join(',\n        ');

/** Catalog-only and row-data-free. Every boolean must be true or readiness fails closed. */
export const PLAYER_ACTION_CATALOG_PREFLIGHT_SQL = `
  select
    current_user = '${RUNTIME_ROLE}' and session_user = current_user
      as runtime_login_identity_allowed,
    exists (
      select 1 from pg_catalog.pg_roles as role
      where role.rolname = current_user
        and role.rolcanlogin and not role.rolinherit and not role.rolsuper
        and not role.rolcreatedb and not role.rolcreaterole
        and not role.rolreplication and not role.rolbypassrls
        and role.rolconnlimit = 2
    ) as runtime_login_is_safe,
    (
      select count(*) = 1 and pg_catalog.bool_and(
        granted.rolname = '${GROUP_ROLE}' and membership.inherit_option
        and not membership.set_option and not membership.admin_option
      )
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles as member on member.oid = membership.member
      where member.rolname = current_user
    ) as only_expected_direct_membership,
    pg_catalog.pg_has_role(current_user, '${GROUP_ROLE}', 'USAGE')
      and not pg_catalog.pg_has_role(current_user, '${GROUP_ROLE}', 'SET')
      as group_usage_allowed_set_denied,
    (
      select count(*) = 2 and pg_catalog.bool_and(
        case member.rolname
          when '${RUNTIME_ROLE}' then membership.inherit_option
            and not membership.set_option and not membership.admin_option
          when 'postgres' then not membership.inherit_option
            and not membership.set_option and membership.admin_option
          else false
        end
      )
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles as member on member.oid = membership.member
      where granted.rolname = '${GROUP_ROLE}'
    ) as group_only_expected_members,
    pg_catalog.has_schema_privilege(current_user, 'app', 'USAGE')
      and not pg_catalog.has_schema_privilege(current_user, 'app', 'CREATE')
      as app_schema_boundary_allowed,
    not exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app' and (
        (relation.relkind = 'S' and pg_catalog.has_sequence_privilege(
          current_user, relation.oid, 'USAGE,SELECT,UPDATE'
        )) or
        (relation.relkind in ('r','p','v','m','f') and (
          pg_catalog.has_table_privilege(
            current_user, relation.oid,
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          ) or pg_catalog.has_any_column_privilege(
            current_user, relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
          )
        ))
      )
    ) as no_app_base_object_access,
    (
      select count(*) = ${ALLOWED_FUNCTIONS.length}
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname = 'app'
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
        and routine.oid in (${ALLOWED_FUNCTION_SQL})
    ) and not exists (
      select 1
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname = 'app'
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
        and routine.oid not in (${ALLOWED_FUNCTION_SQL})
    ) as exact_function_surface_allowed,
    (
      select count(*) = ${ALLOWED_FUNCTIONS.length} and pg_catalog.bool_and(
        routine.prosecdef and routine.prokind = 'f'
        and routine.proconfig = array['search_path=pg_catalog, app, pg_temp']::text[]
        and owner.rolname = 'postgres'
      )
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_roles as owner on owner.oid = routine.proowner
      where routine.oid in (${ALLOWED_FUNCTION_SQL})
    ) as allowed_functions_hardened,
    not exists (
      select 1
      from pg_catalog.pg_proc as routine
      cross join lateral pg_catalog.aclexplode(
        coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) as privilege
      where routine.oid in (${ALLOWED_FUNCTION_SQL})
        and privilege.privilege_type = 'EXECUTE'
        and privilege.grantee not in (
          routine.proowner,
          (select oid from pg_catalog.pg_roles where rolname = '${GROUP_ROLE}')
        )
    ) as allowed_functions_execution_private,
    exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app'
        and relation.relname = 'telegram_private_action_nonce_reservations'
        and relation.relkind = 'r'
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) and not exists (
      select 1 from pg_catalog.pg_policy as policy
      where policy.polrelid = pg_catalog.to_regclass(
        'app.telegram_private_action_nonce_reservations'
      )
    ) as nonce_table_forced_rls_no_policies,
    exists (
      select 1
      from pg_catalog.pg_default_acl as defaults
      join pg_catalog.pg_roles as owner on owner.oid = defaults.defaclrole
      where owner.rolname = 'postgres' and defaults.defaclnamespace = 0
        and defaults.defaclobjtype = 'f'
        and not exists (
          select 1 from pg_catalog.aclexplode(defaults.defaclacl) as privilege
          where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
        )
    ) as default_function_execution_private
`;

export interface PlayerActionCatalogDatabase {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export async function playerActionCatalogPreflightPassed(
  database: PlayerActionCatalogDatabase,
): Promise<boolean> {
  const result = await database.query(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL, []);
  if (result.rows.length !== 1 || !result.rows[0] || typeof result.rows[0] !== 'object')
    return false;
  const values = Object.values(result.rows[0] as Record<string, unknown>);
  return values.length === 12 && values.every((value) => value === true);
}
