\set ON_ERROR_STOP on

begin transaction isolation level serializable read only;
set local search_path = pg_catalog;
set local statement_timeout = '10s';
set local lock_timeout = '1s';
set local idle_in_transaction_session_timeout = '10s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The staging administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select :'expected_runtime_state' in ('continuous_function_only', 'disabled')
    and :'companion_signer_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and :'companion_signer_key_id' = 'companion-server-staging-v1'
    and :'companion_signer_public_spki_sha256' ~ '^sha256:[0-9a-f]{64}$'
    and :'companion_signer_valid_from'
      = pg_catalog.to_char(
          :'companion_signer_valid_from'::timestamptz at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        )
    and :'companion_signer_valid_until'
      = pg_catalog.to_char(
          :'companion_signer_valid_until'::timestamptz at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        )
  as inspection_inputs_canonical
\gset
\if :inspection_inputs_canonical
\else
  \warn 'The companion inspection inputs are not exact.'
  select 1 / 0 as rejected;
\endif

select count(*) = 7
    and pg_catalog.bool_and(
      case
        when feature_switch.feature_key = 'private_live_deposit_pilot'
          then feature_switch.mode in ('disabled', 'dry_run')
        else feature_switch.mode = 'disabled'
      end
    ) as financial_features_safe
from app.feature_switches as feature_switch
where feature_switch.feature_key in (
  'payment_verification',
  'deposit_execution',
  'withdrawal_validation',
  'withdrawal_collection',
  'cbe_birr_authoritative_verification',
  'telebirr_authoritative_verification',
  'private_live_deposit_pilot'
)
\gset
\if :financial_features_safe
\else
  \warn 'Financial/provider features are outside the no-money pairing boundary.'
  select 1 / 0 as rejected;
\endif

select count(*) = 1
    and pg_catalog.bool_and(
      signer.id = :'companion_signer_id'::uuid
      and signer.signer_key_id = :'companion_signer_key_id'
      and signer.public_key_spki_sha256 = :'companion_signer_public_spki_sha256'
      and app.agent_platform_companion_public_key_digest(signer.public_key_spki)
        = signer.public_key_spki_sha256
      and signer.signature_algorithm = 'ecdsa-p256-sha256'
      and signer.signature_encoding = 'ieee-p1363-base64url'
      and signer.valid_from = :'companion_signer_valid_from'::timestamptz
      and signer.valid_until = :'companion_signer_valid_until'::timestamptz
      and signer.valid_from <= pg_catalog.clock_timestamp()
      and signer.valid_until > pg_catalog.clock_timestamp() + interval '30 days'
      and revocation.server_signer_id is null
    ) as signer_active_unrevoked
from app.agent_platform_companion_server_signers as signer
left join app.agent_platform_companion_server_signer_revocations as revocation
  on revocation.server_signer_id = signer.id
where signer.id = :'companion_signer_id'::uuid
   or signer.signer_key_id = :'companion_signer_key_id'
   or signer.public_key_spki_sha256 = :'companion_signer_public_spki_sha256'
\gset
\if :signer_active_unrevoked
\else
  \warn 'The exact companion signer is absent, conflicting, expired, or revoked.'
  select 1 / 0 as rejected;
\endif

select count(*) = 2
    and pg_catalog.bool_and(
      not role.rolinherit and not role.rolsuper and not role.rolcreatedb
      and not role.rolcreaterole and not role.rolreplication and not role.rolbypassrls
      and case role.rolname
        when 'fetanagent_companion_device_bridge' then
          not role.rolcanlogin and role.rolconnlimit = 2
        when 'fetanagent_companion_device_bridge_runtime' then
          role.rolconnlimit = 1 and (
            (
              :'expected_runtime_state' = 'continuous_function_only'
              and role.rolcanlogin
              and role.rolvaliduntil = 'infinity'::timestamptz
            ) or (
              :'expected_runtime_state' = 'disabled'
              and not role.rolcanlogin
            )
          )
        else false
      end
    ) as roles_safe
from pg_catalog.pg_roles as role
where role.rolname in (
  'fetanagent_companion_device_bridge',
  'fetanagent_companion_device_bridge_runtime'
)
\gset
\if :roles_safe
\else
  \warn 'The companion bridge roles are absent or unsafe.'
  select 1 / 0 as rejected;
\endif

select count(*) filter (
      where granted.rolname = 'fetanagent_companion_device_bridge'
        and member.rolname = 'fetanagent_companion_device_bridge_runtime'
        and membership.inherit_option
        and not membership.set_option
        and not membership.admin_option
    ) = 1
    and count(*) filter (
      where granted.rolname = 'fetanagent_companion_device_bridge'
        and member.rolname = 'postgres'
    ) <= 1
    and count(*) filter (
      where granted.rolname = 'fetanagent_companion_device_bridge_runtime'
        and member.rolname = 'postgres'
    ) <= 1
    and pg_catalog.bool_and(
      (
        granted.rolname = 'fetanagent_companion_device_bridge'
        and member.rolname = 'fetanagent_companion_device_bridge_runtime'
        and membership.inherit_option
        and not membership.set_option
        and not membership.admin_option
      ) or (
        granted.rolname in (
          'fetanagent_companion_device_bridge',
          'fetanagent_companion_device_bridge_runtime'
        )
        and member.rolname = 'postgres'
        and not membership.inherit_option
        and not membership.set_option
        and membership.admin_option
      )
    ) as membership_exact
from pg_catalog.pg_auth_members as membership
join pg_catalog.pg_roles as granted on granted.oid = membership.roleid
join pg_catalog.pg_roles as member on member.oid = membership.member
where granted.rolname in (
  'fetanagent_companion_device_bridge',
  'fetanagent_companion_device_bridge_runtime'
)
   or member.rolname in (
     'fetanagent_companion_device_bridge',
     'fetanagent_companion_device_bridge_runtime'
   )
\gset
\if :membership_exact
\else
  \warn 'The companion bridge membership is not exact.'
  select 1 / 0 as rejected;
\endif

select count(*) = 3
    and pg_catalog.bool_and(
      routine.prosecdef
      and routine.prokind = 'f'
      and routine.proowner = 'postgres'::regrole
      and routine.proconfig = array['search_path=pg_catalog']::text[]
    ) as function_surface_exact
from pg_catalog.pg_proc as routine
join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
where namespace.nspname = 'app'
  and pg_catalog.has_function_privilege(
    'fetanagent_companion_device_bridge', routine.oid, 'EXECUTE'
  )
  and routine.oid in (
    pg_catalog.to_regprocedure(
      'app.claim_agent_platform_companion_pairing(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text)'
    ),
    pg_catalog.to_regprocedure(
      'app.complete_agent_platform_companion_pairing(text,text,text,text,jsonb)'
    ),
    pg_catalog.to_regprocedure('app.release_agent_platform_companion_pairing(text)')
  )
\gset
\if :function_surface_exact
\else
  \warn 'The companion bridge function surface is not exact or hardened.'
  select 1 / 0 as rejected;
\endif

select (
  select coalesce(
    pg_catalog.array_agg(namespace.nspname order by namespace.nspname),
    '{}'::text[]
  ) = array['app', 'public']::text[]
  from pg_catalog.pg_namespace as namespace
  where namespace.nspname not in ('pg_catalog', 'information_schema')
    and namespace.nspname !~ '^pg_(toast|temp)'
    and pg_catalog.has_schema_privilege(
      'fetanagent_companion_device_bridge', namespace.oid, 'USAGE'
    )
) and not exists (
  select 1
  from pg_catalog.pg_namespace as namespace
  where namespace.nspname not in ('pg_catalog', 'information_schema')
    and namespace.nspname !~ '^pg_(toast|temp)'
    and pg_catalog.has_schema_privilege(
      'fetanagent_companion_device_bridge', namespace.oid, 'CREATE'
    )
) and not exists (
  select 1
  from pg_catalog.pg_proc as routine
  join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
  where namespace.nspname not in ('pg_catalog', 'information_schema')
    and namespace.nspname !~ '^pg_(toast|temp)'
    and pg_catalog.has_schema_privilege(
      'fetanagent_companion_device_bridge', namespace.oid, 'USAGE'
    )
    and pg_catalog.has_function_privilege(
      'fetanagent_companion_device_bridge', routine.oid, 'EXECUTE'
    )
    and routine.oid not in (
      pg_catalog.to_regprocedure(
        'app.claim_agent_platform_companion_pairing(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text)'
      ),
      pg_catalog.to_regprocedure(
        'app.complete_agent_platform_companion_pairing(text,text,text,text,jsonb)'
      ),
      pg_catalog.to_regprocedure('app.release_agent_platform_companion_pairing(text)')
    )
) and not exists (
  select 1
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname not in ('pg_catalog', 'information_schema')
    and namespace.nspname !~ '^pg_(toast|temp)'
    and pg_catalog.has_schema_privilege(
      'fetanagent_companion_device_bridge', namespace.oid, 'USAGE'
    )
    and relation.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
    and (
      (relation.relkind = 'S' and pg_catalog.has_sequence_privilege(
        'fetanagent_companion_device_bridge', relation.oid, 'USAGE,SELECT,UPDATE'
      )) or (
        relation.relkind <> 'S' and (
          pg_catalog.has_table_privilege(
            'fetanagent_companion_device_bridge', relation.oid,
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
          ) or pg_catalog.has_any_column_privilege(
            'fetanagent_companion_device_bridge', relation.oid,
            'SELECT,INSERT,UPDATE,REFERENCES'
          )
        )
      )
    )
) as no_broader_authority
\gset
\if :no_broader_authority
\else
  \warn 'The companion bridge has broader function or base-object authority.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on

select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'companion_pairing_inspect',
  'companionSigner', 'active_unrevoked',
  'runtime', :'expected_runtime_state',
  'calendarShutdown', false,
  'financialFeatures', 'disabled_or_dry_run_only',
  'moneyMoved', false
)::text;

rollback;
