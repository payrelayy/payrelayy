-- Accept the already authenticated receipt protocol when policy independently classifies the
-- immutable shadow result as receipt_too_old. The replacement remains a twelve-hour, no-money
-- review request. Existing pilot, profile, and device infrastructure must cover the immediate
-- one-hour bounded verifier run; the assignment signer must still cover the full review window.
-- This migration does not enable KemerBet, financial authority, settlement, credit, reservation,
-- execution, or money movement.

begin;

lock table app.private_trusted_telebirr_activation_control in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_epochs in share row exclusive mode;
lock table app.feature_switches in share row exclusive mode;
lock table app.agent_platform_companion_execution_control in share row exclusive mode;
lock table app.private_live_deposit_pilot_revisions in share row exclusive mode;
lock table app.private_live_telebirr_receiver_profiles in share row exclusive mode;
lock table app.private_live_telebirr_device_enrollments in share row exclusive mode;
lock table app.private_live_telebirr_assignment_signers in share row exclusive mode;
lock table app.private_telebirr_shadow_proof_requests in share row exclusive mode;
lock table app.private_telebirr_shadow_verification_outcomes in share row exclusive mode;
lock table app.private_telebirr_shadow_assessment_clock_retries in share row exclusive mode;

do $authenticated_assessment_review_preflight$
declare
  safe_switch_count integer;
  exact_disabled_companion_count integer;
begin
  if app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception
      'Authenticated assessment review requires inactive TeleBirr financial authority.';
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
      'Authenticated assessment review requires the complete no-money boundary.';
  end if;
end;
$authenticated_assessment_review_preflight$;

-- Rewrite only exact reviewed fragments. CREATE OR REPLACE retains each routine OID, owner, ACL,
-- volatility, parallel mode, leakproof flag, security mode, search path, and return shape.
do $install_authenticated_assessment_review$
declare
  rewrite record;
  routine_oid oid;
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
  old_occurrences integer;
begin
  for rewrite in
    select *
      from (values
        (
          'app.guard_private_telebirr_shadow_assessment_clock_retry_insert()',
          $old$or source_outcome.protocol_disposition is distinct from 'would_review'$old$,
          $new$or not (
      (
        source_outcome.protocol_disposition = 'would_review'
        and source_outcome.protocol_reason_code <> 'signed_evidence_verified'
      ) or (
        source_outcome.protocol_disposition = 'would_forward_signed_evidence'
        and source_outcome.protocol_reason_code = 'signed_evidence_verified'
      )
    )$new$
        ),
        (
          'app.retry_private_telebirr_shadow_after_assessment_clock_fix(uuid,uuid,uuid,uuid,text,text)',
          $old$or source_outcome.protocol_disposition is distinct from 'would_review'$old$,
          $new$or not (
      (
        source_outcome.protocol_disposition = 'would_review'
        and source_outcome.protocol_reason_code <> 'signed_evidence_verified'
      ) or (
        source_outcome.protocol_disposition = 'would_forward_signed_evidence'
        and source_outcome.protocol_reason_code = 'signed_evidence_verified'
      )
    )$new$
        ),
        (
          'app.private_telebirr_shadow_assessment_clock_retry_history_is_valid(uuid,uuid)',
          $old$and source_outcome.protocol_disposition = 'would_review'$old$,
          $new$and (
      (
        source_outcome.protocol_disposition = 'would_review'
        and source_outcome.protocol_reason_code <> 'signed_evidence_verified'
      ) or (
        source_outcome.protocol_disposition = 'would_forward_signed_evidence'
        and source_outcome.protocol_reason_code = 'signed_evidence_verified'
      )
    )$new$
        ),
        (
          'app.retry_private_telebirr_shadow_after_assessment_clock_fix(uuid,uuid,uuid,uuid,text,text)',
          $old$enrollment.valid_until >= retry_until$old$,
          $new$enrollment.valid_until > authorized_at + interval '1 hour'$new$
        ),
        (
          'app.retry_private_telebirr_shadow_after_assessment_clock_fix(uuid,uuid,uuid,uuid,text,text)',
          $old$pilot.expires_at < retry_until$old$,
          $new$pilot.expires_at <= authorized_at + interval '1 hour'$new$
        ),
        (
          'app.retry_private_telebirr_shadow_after_assessment_clock_fix(uuid,uuid,uuid,uuid,text,text)',
          $old$profile.valid_until < retry_until$old$,
          $new$profile.valid_until <= authorized_at + interval '1 hour'$new$
        )
      ) reviewed(signature, old_fragment, new_fragment)
  loop
    routine_oid := pg_catalog.to_regprocedure(rewrite.signature);
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
       and routine.prosecdef;

    if original_definition is null then
      raise exception 'An assessment-review routine changed shape: %', rewrite.signature;
    end if;

    old_occurrences := (
      pg_catalog.length(original_source)
      - pg_catalog.length(
          pg_catalog.replace(original_source, rewrite.old_fragment, '')
        )
    ) / pg_catalog.length(rewrite.old_fragment);

    if old_occurrences <> 1
      or pg_catalog.strpos(original_source, rewrite.new_fragment) <> 0 then
      raise exception
        'An assessment-review fragment changed unexpectedly: %', rewrite.signature;
    end if;

    rewritten_definition := pg_catalog.replace(
      original_definition,
      rewrite.old_fragment,
      rewrite.new_fragment
    );
    rewritten_source := pg_catalog.replace(
      original_source,
      rewrite.old_fragment,
      rewrite.new_fragment
    );
    execute rewritten_definition;

    if not exists (
      select 1
        from pg_catalog.pg_proc routine
       where routine.oid = routine_oid
         and routine.prokind = 'f'
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
      raise exception
        'An assessment-review routine lost a reviewed property: %', rewrite.signature;
    end if;
  end loop;
end;
$install_authenticated_assessment_review$;

do $authenticated_assessment_review_postcondition$
declare
  guard_source text;
  retry_source text;
  history_source text;
begin
  select routine.prosrc into guard_source
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
           'app.guard_private_telebirr_shadow_assessment_clock_retry_insert()'
         );
  select routine.prosrc into retry_source
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
           'app.retry_private_telebirr_shadow_after_assessment_clock_fix(uuid,uuid,uuid,uuid,text,text)'
         );
  select routine.prosrc into history_source
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
           'app.private_telebirr_shadow_assessment_clock_retry_history_is_valid(uuid,uuid)'
         );

  if pg_catalog.strpos(guard_source, 'would_forward_signed_evidence') = 0
    or pg_catalog.strpos(guard_source, 'signed_evidence_verified') = 0
    or pg_catalog.strpos(retry_source, 'would_forward_signed_evidence') = 0
    or pg_catalog.strpos(retry_source, 'signed_evidence_verified') = 0
    or pg_catalog.strpos(history_source, 'would_forward_signed_evidence') = 0
    or pg_catalog.strpos(history_source, 'signed_evidence_verified') = 0
    or pg_catalog.strpos(
         retry_source,
         'enrollment.valid_until > authorized_at + interval ''1 hour'''
       ) = 0
    or pg_catalog.strpos(
         retry_source,
         'pilot.expires_at <= authorized_at + interval ''1 hour'''
       ) = 0
    or pg_catalog.strpos(
         retry_source,
         'profile.valid_until <= authorized_at + interval ''1 hour'''
       ) = 0
    or pg_catalog.strpos(retry_source, 'signer.valid_until >= retry_until') = 0
    or pg_catalog.strpos(retry_source, 'authorized_at + interval ''12 hours''') = 0 then
    raise exception 'The authenticated assessment-review postcondition failed.';
  end if;
end;
$authenticated_assessment_review_postcondition$;

comment on function app.retry_private_telebirr_shadow_after_assessment_clock_fix(
  uuid, uuid, uuid, uuid, text, text
) is
  'Postgres-only, idempotent creation of one exact twelve-hour no-money review child for either an unauthenticated protocol review or authenticated signed receipt that policy classified receipt_too_old. Pilot, receiver profile, and device enrollment must cover the immediate one-hour bounded machine verifier; the signer must cover the full review window.';

comment on function app.private_telebirr_shadow_assessment_clock_retry_history_is_valid(
  uuid, uuid
) is
  'Validates the immutable assessment-clock retry lineage for an exact receipt_too_old policy review, including either safe protocol-review evidence or authenticated signed evidence, without granting current authority.';

commit;
