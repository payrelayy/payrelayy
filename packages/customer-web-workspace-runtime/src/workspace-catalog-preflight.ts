const CUSTOMER_WEB_GROUP_ROLE = 'fetanagent_customer_web';
const CUSTOMER_WEB_RUNTIME_ROLE = 'fetanagent_customer_web_runtime';

const ALLOWED_FUNCTIONS = [
  'app.ensure_customer_web_account(uuid)',
  'app.submit_customer_web_player_registration(uuid,uuid,text)',
  'app.list_customer_web_player_registrations(uuid,integer)',
  'app.open_customer_web_deposit_intent(uuid,uuid,text,bigint)',
  'app.capture_customer_web_deposit_reference(uuid,uuid,uuid,text,text,text,smallint)',
  'app.list_customer_web_deposits(uuid,integer)',
] as const;

const ALLOWED_FUNCTION_SQL = ALLOWED_FUNCTIONS.map(
  (signature) => `pg_catalog.to_regprocedure('${signature}')`,
).join(',\n        ');

const EXPECTED_RESULT_KEYS = [
  'runtime_login_identity_allowed',
  'runtime_login_is_safe',
  'only_expected_direct_membership',
  'runtime_has_no_members',
  'group_role_is_safe',
  'group_usage_allowed_set_denied',
  'group_only_expected_members',
  'group_has_no_upstream_membership',
  'app_schema_boundary_allowed',
  'no_app_base_object_access',
  'exact_function_surface_allowed',
  'allowed_functions_hardened',
  'allowed_functions_execution_private',
  'default_function_execution_private',
] as const;

/** Workspace catalog-only and row-data-free. Every named boolean must be exactly true. */
export const CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL = `
  select
    current_user = '${CUSTOMER_WEB_RUNTIME_ROLE}' and session_user = current_user
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
        granted.rolname = '${CUSTOMER_WEB_GROUP_ROLE}' and membership.inherit_option
        and not membership.set_option and not membership.admin_option
      )
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles as member on member.oid = membership.member
      where member.rolname = current_user
    ) as only_expected_direct_membership,
    not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted on granted.oid = membership.roleid
      where granted.rolname = '${CUSTOMER_WEB_RUNTIME_ROLE}'
    ) as runtime_has_no_members,
    exists (
      select 1 from pg_catalog.pg_roles as role
      where role.rolname = '${CUSTOMER_WEB_GROUP_ROLE}'
        and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
        and not role.rolcreatedb and not role.rolcreaterole
        and not role.rolreplication and not role.rolbypassrls
        and role.rolconnlimit = 2
    ) as group_role_is_safe,
    pg_catalog.pg_has_role(current_user, '${CUSTOMER_WEB_GROUP_ROLE}', 'USAGE')
      and not pg_catalog.pg_has_role(current_user, '${CUSTOMER_WEB_GROUP_ROLE}', 'SET')
      as group_usage_allowed_set_denied,
    (
      select count(*) = 1 and pg_catalog.bool_and(
        member.rolname = '${CUSTOMER_WEB_RUNTIME_ROLE}' and membership.inherit_option
        and not membership.set_option and not membership.admin_option
      )
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles as member on member.oid = membership.member
      where granted.rolname = '${CUSTOMER_WEB_GROUP_ROLE}'
    ) as group_only_expected_members,
    not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as member on member.oid = membership.member
      where member.rolname = '${CUSTOMER_WEB_GROUP_ROLE}'
    ) as group_has_no_upstream_membership,
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
      select count(*) = 6
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
      select count(*) = 6 and pg_catalog.bool_and(
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
          (select oid from pg_catalog.pg_roles where rolname = '${CUSTOMER_WEB_GROUP_ROLE}')
        )
    ) as allowed_functions_execution_private,
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

export interface CustomerWorkspaceCatalogDatabase {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

function exactBooleanRow(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== EXPECTED_RESULT_KEYS.length ||
      keys.some((key) => typeof key !== 'string' || !EXPECTED_RESULT_KEYS.includes(key as never))
    ) {
      return false;
    }
    return EXPECTED_RESULT_KEYS.every((key) => {
      const descriptor = descriptors[key];
      return (
        descriptor !== undefined && Object.hasOwn(descriptor, 'value') && descriptor.value === true
      );
    });
  } catch {
    return false;
  }
}

export async function customerWorkspaceCatalogPreflightPassed(
  database: CustomerWorkspaceCatalogDatabase,
): Promise<boolean> {
  const result = await database.query(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL, []);
  return result.rows.length === 1 && exactBooleanRow(result.rows[0]);
}
