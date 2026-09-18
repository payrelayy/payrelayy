-- A reviewed terminal source-unavailable recovery carries the original transfer submission time.
-- The generic shadow loader and completion guard therefore treated every recovery made more than
-- twelve hours after that original submission as already closed, even when the phone staged signed
-- evidence inside the recovery's one-use lease. Preserve the short assignment/recovery lease, but
-- measure review of that already-staged immutable evidence from the reviewed recovery timestamp.
-- This migration does not enable KemerBet, grant a login, reserve, settle, credit, execute, or move
-- money.

begin;

lock table app.private_trusted_telebirr_activation_control in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_epochs in share row exclusive mode;
lock table app.feature_switches in share row exclusive mode;
lock table app.agent_platform_companion_execution_control in share row exclusive mode;
lock table app.private_live_telebirr_source_recoveries in share row exclusive mode;
lock table app.private_telebirr_shadow_proof_requests in share row exclusive mode;

do $source_recovery_review_window_preflight$
declare
  safe_switch_count integer;
  exact_disabled_companion_count integer;
begin
  if app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception
      'Recovered source-unavailable review requires inactive TeleBirr authority.';
  end if;

  select pg_catalog.count(*)::integer
    into safe_switch_count
    from app.feature_switches feature_switch
   where (
     feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'telebirr_authoritative_verification',
       'withdrawal_collection',
       'withdrawal_validation'
     )
     and feature_switch.mode = 'disabled'
     and feature_switch.settings = '{}'::jsonb
   ) or (
     feature_switch.feature_key = 'private_live_deposit_pilot'
     and feature_switch.mode in ('disabled', 'dry_run')
   );

  select pg_catalog.count(*)::integer
    into exact_disabled_companion_count
    from app.agent_platform_companion_execution_control execution_control
   where execution_control.singleton
     and execution_control.control_state = 'disabled'
     and execution_control.certificate_id is null
     and execution_control.device_id is null
     and execution_control.device_key_id is null
     and execution_control.no_money_signer_key_id is null
     and execution_control.execution_signer_key_id is null
     and execution_control.execution_signer_public_key_spki is null
     and execution_control.execution_signer_public_key_spki_sha256 is null
     and execution_control.platform_agent_account_id is null
     and execution_control.pilot_revision_id is null
     and execution_control.pilot_revision is null
     and execution_control.pilot_configuration_digest is null
     and execution_control.activation_epoch is null
     and execution_control.active_from is null
     and execution_control.expires_at is null
     and execution_control.activated_by_admin_id is null
     and execution_control.activated_at is null
     and execution_control.disabled_at is null
     and execution_control.disable_reason_code is null;

  if safe_switch_count <> 7
    or exact_disabled_companion_count <> 1
    or exists (
      select 1
        from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       )
         and role.rolcanlogin
    )
    or exists (
      select 1
        from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       )
         and activity.pid <> pg_catalog.pg_backend_pid()
    ) then
    raise exception
      'Recovered source-unavailable review requires the complete no-money boundary.';
  end if;
end;
$source_recovery_review_window_preflight$;

do $extend_source_recovery_lineage_review$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.private_live_telebirr_source_recovery_is_valid(uuid,uuid)'
  );
  expected_source_sha256 constant text :=
    'cd575d169de117f9ecfe3fa47aab91af9aa3eca3c086c86a95ce0f1007c19b66';
  old_fragment constant text :=
    'and recovery.recovery_expires_at > pg_catalog.clock_timestamp()';
  new_fragment constant text :=
    'and recovery.authorized_at <= pg_catalog.clock_timestamp()' || pg_catalog.chr(10)
    || '    and recovery.authorized_at + interval ''12 hours'' >'
    || ' pg_catalog.clock_timestamp()';
  original_definition text;
  original_source text;
  rewritten_definition text;
  rewritten_source text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  original_volatility "char";
  original_parallel "char";
  original_leakproof boolean;
  original_security_definer boolean;
  original_returns_set boolean;
begin
  select pg_catalog.pg_get_functiondef(routine.oid),
         routine.prosrc,
         routine.proowner,
         routine.proacl,
         routine.proconfig,
         routine.provolatile,
         routine.proparallel,
         routine.proleakproof,
         routine.prosecdef,
         routine.proretset
    into original_definition,
         original_source,
         original_owner,
         original_acl,
         original_config,
         original_volatility,
         original_parallel,
         original_leakproof,
         original_security_definer,
         original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.pronargs = 2
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         ) = expected_source_sha256;

  if original_definition is null
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, ''))
    ) / pg_catalog.length(old_fragment) <> 1
    or pg_catalog.strpos(original_source, new_fragment) <> 0 then
    raise exception 'The source-recovery validator review deadline is not reviewed.';
  end if;

  rewritten_definition := pg_catalog.replace(original_definition, old_fragment, new_fragment);
  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute rewritten_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prosrc = rewritten_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.proconfig is not distinct from original_config
       and routine.provolatile = original_volatility
       and routine.proparallel = original_parallel
       and routine.proleakproof = original_leakproof
       and routine.prosecdef = original_security_definer
       and routine.proretset = original_returns_set
  ) then
    raise exception 'The source-recovery validator rewrite changed its authority.';
  end if;
end;
$extend_source_recovery_lineage_review$;

do $extend_source_recovery_loader_review$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.load_next_private_telebirr_shadow_staged_evidence()'
  );
  expected_source_sha256 constant text :=
    '0bca40588148f94ca6a6fe194a8ebd3a1ca3aac76f7192c4753443bc2174f4d6';
  old_fragment constant text :=
    'captured_at < proof.submitted_at + interval ''12 hours''';
  new_fragment constant text :=
    'captured_at < case' || pg_catalog.chr(10)
    || '       when proof.recovery_request_key is not null' || pg_catalog.chr(10)
    || '         and proof.recovered_at is not null' || pg_catalog.chr(10)
    || '         and app.private_live_telebirr_source_recovery_is_valid(' || pg_catalog.chr(10)
    || '               proof.id,' || pg_catalog.chr(10)
    || '               proof.recovery_request_key' || pg_catalog.chr(10)
    || '             )' || pg_catalog.chr(10)
    || '         then proof.recovered_at + interval ''12 hours''' || pg_catalog.chr(10)
    || '       else proof.submitted_at + interval ''12 hours''' || pg_catalog.chr(10)
    || '     end';
  original_definition text;
  original_source text;
  rewritten_definition text;
  rewritten_source text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  original_volatility "char";
  original_parallel "char";
  original_leakproof boolean;
  original_security_definer boolean;
  original_returns_set boolean;
begin
  select pg_catalog.pg_get_functiondef(routine.oid),
         routine.prosrc,
         routine.proowner,
         routine.proacl,
         routine.proconfig,
         routine.provolatile,
         routine.proparallel,
         routine.proleakproof,
         routine.prosecdef,
         routine.proretset
    into original_definition,
         original_source,
         original_owner,
         original_acl,
         original_config,
         original_volatility,
         original_parallel,
         original_leakproof,
         original_security_definer,
         original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         ) = expected_source_sha256;

  if original_definition is null
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, ''))
    ) / pg_catalog.length(old_fragment) <> 1
    or pg_catalog.strpos(original_source, new_fragment) <> 0 then
    raise exception 'The source-recovery loader review deadline is not reviewed.';
  end if;

  rewritten_definition := pg_catalog.replace(original_definition, old_fragment, new_fragment);
  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute rewritten_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prosrc = rewritten_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.proconfig is not distinct from original_config
       and routine.provolatile = original_volatility
       and routine.proparallel = original_parallel
       and routine.proleakproof = original_leakproof
       and routine.prosecdef = original_security_definer
       and routine.proretset = original_returns_set
  ) then
    raise exception 'The source-recovery loader rewrite changed its authority.';
  end if;
end;
$extend_source_recovery_loader_review$;

do $extend_source_recovery_completion_review$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.complete_private_telebirr_shadow_verification(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,text,text,timestamptz,text,text,text,timestamptz,bigint,timestamptz,text)'
  );
  expected_source_sha256 constant text :=
    '5ee3dc4fce6e041ccaff48d1403261b2d809b318f2e76a6454e02a0f821525c8';
  old_fragment constant text :=
    'authority_at >= proof.submitted_at + interval ''12 hours''';
  new_fragment constant text :=
    'authority_at >= (case' || pg_catalog.chr(10)
    || '      when proof.recovery_request_key is not null' || pg_catalog.chr(10)
    || '        and proof.recovered_at is not null' || pg_catalog.chr(10)
    || '        and app.private_live_telebirr_source_recovery_is_valid(' || pg_catalog.chr(10)
    || '              proof.id,' || pg_catalog.chr(10)
    || '              proof.recovery_request_key' || pg_catalog.chr(10)
    || '            )' || pg_catalog.chr(10)
    || '        then proof.recovered_at + interval ''12 hours''' || pg_catalog.chr(10)
    || '      else proof.submitted_at + interval ''12 hours''' || pg_catalog.chr(10)
    || '    end)';
  original_definition text;
  original_source text;
  rewritten_definition text;
  rewritten_source text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  original_volatility "char";
  original_parallel "char";
  original_leakproof boolean;
  original_security_definer boolean;
  original_returns_set boolean;
begin
  select pg_catalog.pg_get_functiondef(routine.oid),
         routine.prosrc,
         routine.proowner,
         routine.proacl,
         routine.proconfig,
         routine.provolatile,
         routine.proparallel,
         routine.proleakproof,
         routine.prosecdef,
         routine.proretset
    into original_definition,
         original_source,
         original_owner,
         original_acl,
         original_config,
         original_volatility,
         original_parallel,
         original_leakproof,
         original_security_definer,
         original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proretset
     and routine.pronargs = 20
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         ) = expected_source_sha256;

  if original_definition is null
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, ''))
    ) / pg_catalog.length(old_fragment) <> 2
    or pg_catalog.strpos(original_source, new_fragment) <> 0 then
    raise exception 'The source-recovery completion review deadline is not reviewed.';
  end if;

  rewritten_definition := pg_catalog.replace(original_definition, old_fragment, new_fragment);
  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute rewritten_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prosrc = rewritten_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.proconfig is not distinct from original_config
       and routine.provolatile = original_volatility
       and routine.proparallel = original_parallel
       and routine.proleakproof = original_leakproof
       and routine.prosecdef = original_security_definer
       and routine.proretset = original_returns_set
  ) then
    raise exception 'The source-recovery completion rewrite changed its authority.';
  end if;
end;
$extend_source_recovery_completion_review$;

comment on function app.private_live_telebirr_source_recovery_is_valid(uuid, uuid) is
  'Validates the immutable terminal live source_unavailable recovery for a twelve-hour review window measured from reviewed recovery authorization. The signed phone lease remains short and no financial authority is created.';

comment on function app.load_next_private_telebirr_shadow_staged_evidence() is
  'Loads only immutable evidence staged inside its original short assignment and proof lease. A valid terminal source-unavailable recovery may be reviewed for twelve hours from recovery authorization; every current no-money, pilot, receiver, device, signer, revocation, quarantine, and terminal-outcome gate remains enforced.';

comment on function app.complete_private_telebirr_shadow_verification(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) is
  'Records one advisory no-money outcome for evidence staged inside its original short signed lease. A valid terminal source-unavailable recovery may complete for twelve hours from reviewed recovery authorization; it creates no claim, settlement, execution, credit, or money movement.';

commit;
