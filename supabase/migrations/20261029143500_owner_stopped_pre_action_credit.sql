-- Let the Owner record a credit already made outside FetanAgent only when
-- every automatic attempt stopped before the provider's final action.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create function app.owner_can_record_stopped_credit(
  p_actor_auth_user_id uuid, p_candidate_id uuid
) returns boolean language plpgsql stable security definer
set search_path = pg_catalog, pg_temp as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  if p_candidate_id is null then return false; end if;

  return exists (
    select 1
    from app.receiver_sms_deposit_candidates candidate
    join app.receiver_sms_payment_events sms
      on sms.provider_code = candidate.provider_code
        and sms.reference_fingerprint = candidate.reference_fingerprint
        and sms.payment_provider_id = candidate.payment_provider_id
    join app.receiver_sms_settlement_lineages lineage
      on lineage.candidate_id = candidate.id
    join app.deposit_intents intent
      on intent.id = lineage.deposit_intent_id
        and intent.payment_provider_id = sms.payment_provider_id
        and intent.player_account_id = candidate.player_account_id
        and intent.receiver_account_id = sms.receiver_account_id
        and intent.expected_amount_minor = sms.amount_minor
    join app.deposit_review_cases review
      on review.deposit_intent_id = intent.id
        and review.review_kind = 'execution'
        and review.status in ('open','assigned')
    join app.deposit_jobs execution_job
      on execution_job.id = lineage.execution_job_id
        and execution_job.deposit_intent_id = intent.id
        and execution_job.job_kind = 'execute_deposit'
        and execution_job.status in ('cancelled','dead')
    where candidate.id = p_candidate_id
      and intent.status = 'execution_review'
      and sms.amount_minor between 10000 and 2500000
      and not exists (select 1 from app.owner_manual_payment_cases owner_case
        where owner_case.payment_provider_id = candidate.payment_provider_id
          and owner_case.reference_fingerprint = candidate.reference_fingerprint)
      and not exists (select 1 from app.receiver_sms_deposit_candidates earlier
        where earlier.provider_code = candidate.provider_code
          and earlier.reference_fingerprint = candidate.reference_fingerprint
          and (earlier.submitted_at, earlier.id) <
            (candidate.submitted_at, candidate.id))
      and not exists (select 1 from app.deposit_jobs job
        where job.deposit_intent_id = intent.id
          and job.status not in ('cancelled','dead'))
      and exists (select 1 from app.deposit_execution_attempts attempt
        where attempt.deposit_intent_id = intent.id
          and attempt.deposit_job_id = execution_job.id
          and attempt.status = 'cancelled_before_action'
          and attempt.final_action_fenced_at is null
          and attempt.reconciliation_required_at is null)
      and not exists (select 1 from app.deposit_execution_attempts attempt
        where attempt.deposit_intent_id = intent.id
          and (attempt.status <> 'cancelled_before_action'
            or attempt.final_action_fenced_at is not null
            or attempt.reconciliation_required_at is not null))
      and not exists (select 1
        from app.receiver_sms_settlement_lineages other_lineage
        join app.receiver_sms_deposit_candidates other_candidate
          on other_candidate.id = other_lineage.candidate_id
        join app.deposit_intents other_intent
          on other_intent.id = other_lineage.deposit_intent_id
        where other_candidate.provider_code = candidate.provider_code
          and other_candidate.reference_fingerprint = candidate.reference_fingerprint
          and other_intent.status = 'executed')
  );
end;
$$;
alter function app.owner_can_record_stopped_credit(uuid,uuid) owner to postgres;
revoke all on function app.owner_can_record_stopped_credit(uuid,uuid)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control_runtime;
grant execute on function app.owner_can_record_stopped_credit(uuid,uuid)
  to fetanagent_owner_control;

create function app.record_owner_stopped_credit(
  p_actor_auth_user_id uuid, p_candidate_id uuid,
  p_player_credited_confirmed boolean
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_actor_id uuid;
  v_candidate app.receiver_sms_deposit_candidates%rowtype;
  v_sms app.receiver_sms_payment_events%rowtype;
  v_case app.owner_manual_payment_cases%rowtype;
  v_intent_id uuid;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null or p_candidate_id is null
    or p_player_credited_confirmed is distinct from true then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  select owner_user.id into v_actor_id from app.admin_users owner_user
    where owner_user.auth_user_id = p_actor_auth_user_id
      and owner_user.role = 'owner' and owner_user.status = 'active'
    for share;
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:routine-telebirr-processing', 20261004));
  select * into v_candidate from app.receiver_sms_deposit_candidates candidate
    where candidate.id = p_candidate_id for share;
  if v_candidate.id is null then
    raise exception 'The submitted payment is unavailable.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_candidate.provider_code || ':' || v_candidate.reference_fingerprint, 20261021));
  select * into v_case from app.owner_manual_payment_cases owner_case
    where owner_case.payment_provider_id = v_candidate.payment_provider_id
      and owner_case.reference_fingerprint = v_candidate.reference_fingerprint for share;
  if v_case.id is not null then
    if v_case.candidate_id = v_candidate.id and v_case.status = 'manually_credited' then
      return pg_catalog.jsonb_build_object('caseId',v_case.id,'status',v_case.status);
    end if;
    raise exception 'The payment reference already has an Owner decision.';
  end if;

  select lineage.deposit_intent_id into v_intent_id
    from app.receiver_sms_settlement_lineages lineage
    where lineage.candidate_id = v_candidate.id;
  if v_intent_id is null then
    raise exception 'The automatic credit review is unavailable.';
  end if;
  perform 1 from app.deposit_intents intent
    where intent.id = v_intent_id for update;
  perform 1 from app.deposit_jobs job
    where job.deposit_intent_id = v_intent_id for update;
  perform 1 from app.deposit_execution_attempts attempt
    where attempt.deposit_intent_id = v_intent_id for update;
  if not app.owner_can_record_stopped_credit(p_actor_auth_user_id,v_candidate.id) then
    raise exception 'Automatic credit is not proven stopped before the final action.';
  end if;
  select * into v_sms from app.receiver_sms_payment_events sms
    where sms.provider_code = v_candidate.provider_code
      and sms.reference_fingerprint = v_candidate.reference_fingerprint
      and sms.payment_provider_id = v_candidate.payment_provider_id for share;
  if v_sms.id is null then
    raise exception 'The signed receiving-phone payment is unavailable.';
  end if;

  insert into app.owner_manual_payment_cases
    (provider_code,payment_provider_id,reference_fingerprint,reference_masked,
      candidate_id,payment_event_id,status,amount_minor,receiver_account_id,
      receiver_account_version,decided_by_admin_id,completed_by_admin_id,
      completed_at,bank_payment_confirmed)
  values (v_candidate.provider_code,v_candidate.payment_provider_id,
    v_candidate.reference_fingerprint,v_candidate.reference_masked,
    v_candidate.id,v_sms.id,'manually_credited',v_sms.amount_minor,
    v_sms.receiver_account_id,v_sms.receiver_account_version,
    v_actor_id,v_actor_id,pg_catalog.clock_timestamp(),false)
  returning * into v_case;

  update app.deposit_review_cases review
    set status = 'resolved', resolution_code = 'owner_outside_credit_recorded',
      assigned_admin_id = v_actor_id
    where review.deposit_intent_id = v_intent_id
      and review.review_kind = 'execution'
      and review.status in ('open','assigned');
  if not found then
    raise exception 'The automatic credit review changed.';
  end if;
  perform app.queue_owner_manual_payment_outcome(v_candidate.id,'credited',v_sms.amount_minor);
  return pg_catalog.jsonb_build_object('caseId',v_case.id,'status',v_case.status);
end;
$$;
alter function app.record_owner_stopped_credit(uuid,uuid,boolean) owner to postgres;
revoke all on function app.record_owner_stopped_credit(uuid,uuid,boolean)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control_runtime;
grant execute on function app.record_owner_stopped_credit(uuid,uuid,boolean)
  to fetanagent_owner_control;

commit;
