-- The current paid source is the signed receiver-SMS phone. Preserve the retired
-- official-receipt route while allowing the current source to pass the existing
-- operator-only routine activation boundary. Financial switches stay unchanged.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $activation$
declare
  v_target regprocedure := pg_catalog.to_regprocedure(
    'app.activate_routine_telebirr_financial_gates(uuid,uuid)'
  );
  v_definition text;
  v_old_proof constant text := $old_proof$
  if not exists (
    select 1 from app.routine_telebirr_signed_observation_payloads observation
    join app.routine_telebirr_lookup_challenges challenge
      on challenge.challenge_id = observation.challenge_id
    join app.routine_telebirr_device_enrollments enrollment
      on enrollment.id = challenge.device_enrollment_id
    where observation.recorded_at >= checked_at - interval '24 hours'
      and observation.server_policy_result = 'signed_evidence_matches_policy'
      and observation.signed_observation ->> 'contractVersion' = '2'
      and observation.signed_observation #>> '{body,facts,sourceOriginAttestation}'
        = 'official_tls_origin'
      and challenge.issuance_mode = 'no_money'
      and enrollment.valid_until > checked_at + interval '1 hour'
      and not exists (
        select 1 from app.routine_telebirr_device_enrollment_revocations revocation
        where revocation.enrollment_id = enrollment.id)
  ) then
    raise exception 'A recent signed no-money official-origin phone proof is required.';
  end if;
$old_proof$;
  v_new_proof constant text := $new_proof$
  if not (
    (exists (
      select 1 from app.routine_telebirr_signed_observation_payloads observation
      join app.routine_telebirr_lookup_challenges challenge
        on challenge.challenge_id = observation.challenge_id
      join app.routine_telebirr_device_enrollments enrollment
        on enrollment.id = challenge.device_enrollment_id
      where observation.recorded_at >= checked_at - interval '24 hours'
        and observation.server_policy_result = 'signed_evidence_matches_policy'
        and observation.signed_observation ->> 'contractVersion' = '2'
        and observation.signed_observation #>> '{body,facts,sourceOriginAttestation}'
          = 'official_tls_origin'
        and challenge.issuance_mode = 'no_money'
        and enrollment.valid_until > checked_at + interval '1 hour'
        and not exists (
          select 1 from app.routine_telebirr_device_enrollment_revocations revocation
           where revocation.enrollment_id = enrollment.id)
    ) and (
      select pg_catalog.count(*) = 3 and pg_catalog.bool_and(
        role.rolcanlogin and coalesce(
          role.rolvaliduntil > checked_at + interval '1 hour', false))
        from pg_catalog.pg_roles role where role.rolname in (
          'fetanagent_routine_telebirr_no_money_runtime',
          'fetanagent_routine_telebirr_paid_poll_runtime',
          'fetanagent_routine_telebirr_paid_settlement_runtime')
    ) is true)
    or (exists (
      select 1 from app.receiver_sms_device_status status
      join app.routine_telebirr_device_enrollments enrollment
        on enrollment.id = status.enrollment_id
      where status.state = 'ready'
        and status.received_at between checked_at - interval '2 minutes'
          and checked_at + interval '1 minute'
        and status.observed_at between checked_at - interval '2 minutes'
          and checked_at + interval '1 minute'
        and enrollment.valid_from <= checked_at
        and enrollment.valid_until > checked_at + interval '1 hour'
        and not exists (
          select 1 from app.routine_telebirr_device_enrollment_revocations revocation
           where revocation.enrollment_id = enrollment.id)
    ) and exists (
      select 1 from app.receiver_sms_route_control control
       where control.singleton and control.enabled
    ) and (
      select pg_catalog.count(*) = 2 and pg_catalog.bool_and(
        role.rolcanlogin and coalesce(
          role.rolvaliduntil > checked_at + interval '1 hour', false))
        from pg_catalog.pg_roles role where role.rolname in (
          'fetanagent_receiver_sms_ingest_runtime',
          'fetanagent_receiver_sms_settlement_runtime')
    ) is true)
  ) then
    raise exception 'A fresh signed payment-source phone check-in and its active settlement roles are required.';
  end if;
$new_proof$;
  v_old_broker constant text := $old_broker$
  if (
    select pg_catalog.count(*) = 4 and pg_catalog.bool_and(
      role.rolcanlogin and coalesce(
        role.rolvaliduntil > checked_at + interval '1 hour', false))
    from pg_catalog.pg_roles role where role.rolname in (
      'fetanagent_routine_deposit_broker_runtime',
      'fetanagent_routine_telebirr_no_money_runtime',
      'fetanagent_routine_telebirr_paid_poll_runtime',
      'fetanagent_routine_telebirr_paid_settlement_runtime')
  ) is not true or exists (
$old_broker$;
  v_new_broker constant text := $new_broker$
  if (
    select pg_catalog.count(*) = 1 and pg_catalog.bool_and(
      role.rolcanlogin and coalesce(
        role.rolvaliduntil > checked_at + interval '1 hour', false))
    from pg_catalog.pg_roles role where role.rolname =
      'fetanagent_routine_deposit_broker_runtime'
  ) is not true or exists (
$new_broker$;
  v_old_review constant text := $old_review$
     where attempt.status in ('prepared', 'final_action_fenced',
       'reconciliation_required', 'review_required')
$old_review$;
  v_new_review constant text := $new_review$
     where attempt.status in ('prepared', 'final_action_fenced',
       'reconciliation_required')
       or (attempt.status = 'review_required'
         and not attempt.routine_review_isolated)
$new_review$;
begin
  if v_target is null then
    raise exception 'Routine financial activation function is missing; migration stopped.';
  end if;
  select pg_catalog.pg_get_functiondef(v_target) into v_definition;
  if pg_catalog.strpos(v_definition, v_old_proof) = 0
    or pg_catalog.strpos(v_definition, v_old_broker) = 0
    or pg_catalog.strpos(v_definition, v_old_review) = 0
    or pg_catalog.strpos(v_definition, 'session_user <> ''postgres''') = 0
    or pg_catalog.strpos(v_definition, 'app.routine_telebirr_runtime_is_active') = 0
  then
    raise exception 'Routine financial activation function changed; migration stopped.';
  end if;
  execute pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
    v_definition, v_old_proof, v_new_proof), v_old_broker, v_new_broker),
    v_old_review, v_new_review);
end;
$activation$;

commit;
