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

select count(*) = 7 as financial_features_disabled
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
  and feature_switch.mode = 'disabled'
\gset
\if :financial_features_disabled
\else
  \warn 'Every financial and provider feature must remain disabled for this inspection.'
  select 1 / 0 as rejected;
\endif

with role_state as (
  select role.rolname,
         role.rolcanlogin,
         role.rolinherit,
         role.rolsuper,
         role.rolcreatedb,
         role.rolcreaterole,
         role.rolreplication,
         role.rolbypassrls,
         role.rolconnlimit,
         role.rolvaliduntil
    from pg_catalog.pg_roles as role
   where role.rolname in (
     'fetanagent_telebirr_assignment_broker',
     'fetanagent_telebirr_assignment_broker_runtime'
   )
), membership_state as (
  select granted_role.rolname as granted_role,
         member_role.rolname as member_role,
         membership.inherit_option,
         membership.set_option,
         membership.admin_option
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
   where granted_role.rolname in (
       'fetanagent_telebirr_assignment_broker',
       'fetanagent_telebirr_assignment_broker_runtime'
     )
      or member_role.rolname in (
       'fetanagent_telebirr_assignment_broker',
       'fetanagent_telebirr_assignment_broker_runtime'
     )
), role_shape as (
  select (
           select count(*) = 1
              and pg_catalog.bool_and(
                not role_state.rolinherit
                and not role_state.rolsuper
                and not role_state.rolcreatedb
                and not role_state.rolcreaterole
                and not role_state.rolreplication
                and not role_state.rolbypassrls
                and role_state.rolconnlimit = 2
              )
             from role_state
            where role_state.rolname = 'fetanagent_telebirr_assignment_broker'
         ) as group_role_safe,
         (
           select count(*) = 1
              and pg_catalog.bool_and(not role_state.rolcanlogin)
             from role_state
            where role_state.rolname = 'fetanagent_telebirr_assignment_broker'
         ) as group_role_disabled,
         (
           select count(*) = 1
              and pg_catalog.bool_and(
                not role_state.rolinherit
                and not role_state.rolsuper
                and not role_state.rolcreatedb
                and not role_state.rolcreaterole
                and not role_state.rolreplication
                and not role_state.rolbypassrls
                and role_state.rolconnlimit = 1
              )
             from role_state
            where role_state.rolname = 'fetanagent_telebirr_assignment_broker_runtime'
         ) as runtime_role_safe,
         (
           select count(*) = 1
              and pg_catalog.bool_and(not role_state.rolcanlogin)
             from role_state
            where role_state.rolname = 'fetanagent_telebirr_assignment_broker_runtime'
         ) as runtime_role_disabled,
         (
           select count(*) = 1
              and pg_catalog.bool_and(
                role_state.rolcanlogin
                and role_state.rolvaliduntil
                  > pg_catalog.clock_timestamp() + interval '5 minutes'
                and role_state.rolvaliduntil
                  <= pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'
              )
             from role_state
            where role_state.rolname = 'fetanagent_telebirr_assignment_broker_runtime'
         ) as runtime_login_bounded,
         (
           select count(*) filter (
                    where membership_state.granted_role
                            = 'fetanagent_telebirr_assignment_broker'
                      and membership_state.member_role
                            = 'fetanagent_telebirr_assignment_broker_runtime'
                      and membership_state.inherit_option
                      and not membership_state.set_option
                      and not membership_state.admin_option
                  ) = 1
              and count(*) filter (
                    where membership_state.granted_role
                            = 'fetanagent_telebirr_assignment_broker'
                      and membership_state.member_role = 'postgres'
                  ) <= 1
              and count(*) filter (
                    where membership_state.granted_role
                            = 'fetanagent_telebirr_assignment_broker_runtime'
                      and membership_state.member_role = 'postgres'
                  ) <= 1
              and pg_catalog.bool_and(
                (
                  membership_state.granted_role
                    = 'fetanagent_telebirr_assignment_broker'
                  and membership_state.member_role
                    = 'fetanagent_telebirr_assignment_broker_runtime'
                  and membership_state.inherit_option
                  and not membership_state.set_option
                  and not membership_state.admin_option
                ) or (
                  membership_state.granted_role in (
                    'fetanagent_telebirr_assignment_broker',
                    'fetanagent_telebirr_assignment_broker_runtime'
                  )
                  and membership_state.member_role = 'postgres'
                  and not membership_state.inherit_option
                  and not membership_state.set_option
                  and membership_state.admin_option
                )
              )
             from membership_state
         ) as membership_safe
), broker_state as (
  select case
           when role_shape.group_role_safe
             and role_shape.group_role_disabled
             and role_shape.runtime_role_safe
             and role_shape.membership_safe
             and role_shape.runtime_role_disabled then 'disabled_ready'
           when role_shape.group_role_safe
             and role_shape.group_role_disabled
             and role_shape.runtime_role_safe
             and role_shape.membership_safe
             and role_shape.runtime_login_bounded then 'bounded_login_ready'
           else 'unsafe'
         end as broker_database_scaffold
    from role_shape
)
select broker_state.broker_database_scaffold,
       broker_state.broker_database_scaffold in ('disabled_ready', 'bounded_login_ready')
         as broker_scaffold_safe
from broker_state
\gset

select count(*) = 2
    and pg_catalog.bool_and(
      procedure.prosecdef
      and procedure.prokind = 'f'
      and procedure.proowner = 'postgres'::regrole
      and procedure.proconfig = array['search_path=pg_catalog']::text[]
    )
    and pg_catalog.has_schema_privilege(
      'fetanagent_telebirr_assignment_broker', 'app', 'USAGE'
    )
    and not pg_catalog.has_schema_privilege(
      'fetanagent_telebirr_assignment_broker', 'app', 'CREATE'
    ) as broker_function_surface_ready
from pg_catalog.pg_proc as procedure
where procedure.oid in (
  pg_catalog.to_regprocedure(
    'app.lease_private_live_telebirr_assignment_broker(uuid,text,uuid,integer)'
  ),
  pg_catalog.to_regprocedure(
    'app.persist_private_live_telebirr_assignment_broker_signature(uuid,uuid,uuid,text,text,text,text)'
  )
)
  and pg_catalog.has_function_privilege(
    'fetanagent_telebirr_assignment_broker', procedure.oid, 'EXECUTE'
  )
  and not exists (
    select 1
      from pg_catalog.aclexplode(
        coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) as privilege
     where privilege.privilege_type = 'EXECUTE'
       and privilege.grantee not in (
         procedure.proowner,
         (
           select role.oid
             from pg_catalog.pg_roles as role
            where role.rolname = 'fetanagent_telebirr_assignment_broker'
         )
       )
  )
\gset
\if :broker_function_surface_ready
\else
  \warn 'The private TeleBirr broker function surface is absent, altered, or broad.'
  select 1 / 0 as rejected;
\endif

with receiver_state as (
  select count(distinct provider.id) as provider_count,
         count(*) filter (where receiver.status = 'active') as active_count,
         count(*) filter (
           where receiver.status = 'active'
             and receiver.retired_at is null
             and receiver.active_from <= pg_catalog.clock_timestamp()
             and receiver.account_holder_name = pg_catalog.btrim(receiver.account_holder_name)
             and pg_catalog.char_length(receiver.account_holder_name) between 2 and 160
             and receiver.account_holder_name !~ '[[:cntrl:]]'
             and receiver.rotation_request_id is not null
             and receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
             and receiver.account_reference_masked ~ '^[*][*][*][0-9]{4}$'
             and receiver.protection_profile_version = 1
             and receiver.encryption_key_version = 1
             and receiver.fingerprint_key_version = 1
             and receiver.account_reference_ciphertext
               ~ '^receiver-v1[.]telebirr[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{12,32}$'
         ) as protected_count
    from app.payment_providers as provider
    left join app.receiver_accounts as receiver on receiver.provider_id = provider.id
   where provider.code = 'telebirr'
     and provider.status = 'active'
)
select count(*) = 1
    and pg_catalog.bool_and(
      receiver_state.provider_count = 1
      and receiver_state.active_count in (0, 1)
      and receiver_state.protected_count = receiver_state.active_count
    ) as receiver_state_safe
from receiver_state
\gset
\if :receiver_state_safe
\else
  \warn 'The active TeleBirr receiver state is missing its protected revision boundary or is ambiguous.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on

with active_receiver as (
  select receiver.id,
         receiver.provider_id,
         receiver.version
    from app.receiver_accounts as receiver
    join app.payment_providers as provider on provider.id = receiver.provider_id
   where provider.code = 'telebirr'
     and provider.status = 'active'
     and receiver.status = 'active'
     and receiver.retired_at is null
), open_pilot as (
  select pilot.id,
         pilot.status
    from app.private_live_deposit_pilot_revisions as pilot
   where pilot.status in ('draft', 'armed')
), pilot_binding as (
  select open_pilot.id,
         open_pilot.status,
         count(distinct pilot_provider.payment_provider_id)
           filter (where pilot_provider.provider_code_snapshot = 'telebirr') as provider_count,
         count(distinct receiver_profile.id) as profile_count,
         pg_catalog.bool_and(
           active_receiver.id is not null
           and receiver_profile.receiver_account_id = active_receiver.id
           and receiver_profile.payment_provider_id = active_receiver.provider_id
           and receiver_profile.receiver_account_version = active_receiver.version
           and receiver_profile.pilot_revision_id = open_pilot.id
           and receiver_profile.receiver_profile_digest ~ '^sha256:[0-9a-f]{64}$'
           and receiver_profile.receiver_configuration_digest ~ '^sha256:[0-9a-f]{64}$'
           and receiver_profile.expected_receiver_name_digest ~ '^sha256:[0-9a-f]{64}$'
           and receiver_profile.receiver_identity_digest
             = receiver_profile.expected_receiver_name_digest
           and receiver_profile.receiver_name_normalizer_version
             = 'telebirr-credited-party-name-normalizer-v1'
         ) filter (where receiver_profile.id is not null) as profile_matches_receiver
    from open_pilot
    left join app.private_live_deposit_pilot_providers as pilot_provider
      on pilot_provider.pilot_revision_id = open_pilot.id
     and pilot_provider.provider_code_snapshot = 'telebirr'
    left join app.private_live_telebirr_receiver_profiles as receiver_profile
      on receiver_profile.pilot_revision_id = open_pilot.id
     and receiver_profile.payment_provider_id = pilot_provider.payment_provider_id
     and receiver_profile.receiver_account_id = pilot_provider.receiver_account_id
     and receiver_profile.receiver_account_version = pilot_provider.receiver_account_version
    left join active_receiver
      on active_receiver.id = pilot_provider.receiver_account_id
     and active_receiver.provider_id = pilot_provider.payment_provider_id
     and active_receiver.version = pilot_provider.receiver_account_version
   group by open_pilot.id, open_pilot.status
), redacted_state as (
  select case
           when (select count(*) from active_receiver) = 0 then 'absent'
           when (select count(*) from active_receiver) = 1 then 'protected_active'
           else 'unsafe'
         end as receiver_state,
         case
           when (select count(*) from open_pilot) = 0 then 'absent'
           when (select count(*) from open_pilot) <> 1 then 'unsafe'
           when (select provider_count from pilot_binding) <> 1 then
             (select status || '_unprofiled' from pilot_binding)
           when (select profile_count from pilot_binding) <> 1
             or (select profile_matches_receiver from pilot_binding) is not true then
             (select status || '_unprofiled' from pilot_binding)
           else (select status || '_profiled' from pilot_binding)
         end as open_pilot_state,
         exists (
           select 1
             from app.private_live_telebirr_device_enrollments as enrollment
             join open_pilot on open_pilot.id = enrollment.pilot_revision_id
             left join app.private_live_telebirr_device_revocations as revocation
               on revocation.device_enrollment_id = enrollment.id
            where revocation.device_enrollment_id is null
              and enrollment.valid_from <= pg_catalog.clock_timestamp()
              and enrollment.valid_until > pg_catalog.clock_timestamp()
         ) as current_device_enrollment,
         exists (
           select 1
             from app.private_live_telebirr_verification_jobs as job
             join open_pilot on open_pilot.id = job.pilot_revision_id
            where job.expires_at > pg_catalog.clock_timestamp()
         ) as current_assignment_work
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'financialFeatures', 'disabled',
  'brokerDatabaseScaffold', :'broker_database_scaffold',
  'telebirrReceiver', redacted_state.receiver_state,
  'openPilot', redacted_state.open_pilot_state,
  'deviceEnrollment',
    case when redacted_state.current_device_enrollment then 'present' else 'absent' end,
  'assignmentWork',
    case when redacted_state.current_assignment_work then 'present' else 'absent' end
)::text
from redacted_state;

rollback;

\if :broker_scaffold_safe
\else
  \warn 'The private TeleBirr broker role scaffold is unsafe.'
  select 1 / 0 as rejected;
\endif
