-- A signed SMS match starts a 60-minute automatic-credit window. A job that
-- never reached an execution attempt then becomes an Owner decision, including
-- pre-existing stranded queue rows. Started/uncertain transfers are untouched.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'fetanagent:routine-telebirr-processing', 20261004));

create function app.owner_expired_unattempted_sms_candidate(p_candidate_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1
    from app.receiver_sms_deposit_candidates candidate
    join app.receiver_sms_payment_matches matched
      on matched.candidate_id = candidate.id
    join app.receiver_sms_settlement_lineages lineage
      on lineage.candidate_id = candidate.id
        and lineage.payment_event_id = matched.payment_event_id
    join app.receiver_sms_payment_events sms
      on sms.id = matched.payment_event_id
        and sms.provider_code = candidate.provider_code
        and sms.payment_provider_id = candidate.payment_provider_id
        and sms.reference_fingerprint = candidate.reference_fingerprint
    join app.provider_payment_evidence evidence
      on evidence.id = lineage.provider_payment_evidence_id
        and evidence.evidence_source = 'receiver_sms'
        and evidence.provider_final_status = 'completed'
        and evidence.canonical_reference_fingerprint = sms.reference_fingerprint
        and evidence.payment_provider_id = sms.payment_provider_id
        and evidence.amount_minor = sms.amount_minor
    join app.deposit_intents intent
      on intent.id = lineage.deposit_intent_id
        and intent.receiver_sms_opening_id = lineage.opening_id
        and intent.status = 'execution_review'
        and intent.player_account_id = candidate.player_account_id
        and intent.payment_provider_id = sms.payment_provider_id
        and intent.receiver_account_id = sms.receiver_account_id
        and intent.expected_amount_minor = sms.amount_minor
    join app.deposit_jobs execution_job
      on execution_job.id = lineage.execution_job_id
        and execution_job.deposit_intent_id = intent.id
        and execution_job.job_kind = 'execute_deposit'
        and execution_job.status = 'cancelled'
        and execution_job.last_error_code = 'automatic_window_expired_before_action'
        and execution_job.attempt_count = 0
        and execution_job.lease_token is null
    join app.deposit_review_cases review
      on review.deposit_intent_id = intent.id
        and review.review_kind = 'execution'
        and review.reason_code = 'automatic_window_expired_before_action'
    where candidate.id = p_candidate_id
      and matched.matched_at <= pg_catalog.statement_timestamp() - interval '60 minutes'
      and sms.amount_minor between 10000 and 2500000
      and not exists (select 1 from app.receiver_sms_deposit_candidates earlier
        where earlier.provider_code = candidate.provider_code
          and earlier.reference_fingerprint = candidate.reference_fingerprint
          and (earlier.submitted_at,earlier.id) <
            (candidate.submitted_at,candidate.id))
      and not exists (select 1 from app.deposit_execution_attempts attempt
        where attempt.deposit_intent_id = intent.id)
      and not exists (select 1 from app.deposit_jobs other_job
        where other_job.deposit_intent_id = intent.id
          and other_job.id <> execution_job.id
          and other_job.status not in ('cancelled','dead'))
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
$$;
alter function app.owner_expired_unattempted_sms_candidate(uuid) owner to postgres;
revoke all on function app.owner_expired_unattempted_sms_candidate(uuid)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;

-- Keep payment-time freshness and the immutable intent snapshot as they are.
-- Only the automatic execution deadline moves to the immutable match time.
do $assessor$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'app.assess_receiver_sms_execution_job(uuid)'::regprocedure);
  v_old text := 'and (pg_catalog.statement_timestamp() < sms.occurred_at + interval ''1 hour''' ||
    pg_catalog.chr(10) ||
    '      or app.receiver_sms_owner_approved_for_candidate(candidate.id))';
begin
  if (pg_catalog.length(v_definition) -
      pg_catalog.length(pg_catalog.replace(v_definition,v_old,''))) /
      pg_catalog.length(v_old) <> 1
    or pg_catalog.strpos(v_definition,'matched.matched_at') <> 0 then
    raise exception 'Receiver SMS execution assessor has changed.';
  end if;
  execute pg_catalog.replace(v_definition, v_old,
    'and pg_catalog.statement_timestamp() < matched.matched_at + interval ''60 minutes''');
end;
$assessor$;

create function app.move_expired_receiver_sms_jobs_to_owner_review(
  p_limit integer default 100
) returns integer language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_row record;
  v_count integer := 0;
begin
  if session_user <> 'postgres' or p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '42501', message = 'Private expiry worker only.';
  end if;
  -- The broker takes the same advisory lock before admitting a transfer.
  -- SKIP LOCKED avoids waiting on a job row that the broker already holds.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'fetanagent:routine-telebirr-processing', 20261004)) then
    return 0;
  end if;
  for v_row in
    select execution_job.id as job_id, intent.id as intent_id
    from app.deposit_jobs execution_job
    join app.receiver_sms_settlement_lineages lineage
      on lineage.execution_job_id = execution_job.id
    join app.receiver_sms_payment_matches matched
      on matched.candidate_id = lineage.candidate_id
        and matched.payment_event_id = lineage.payment_event_id
    join app.deposit_intents intent
      on intent.id = lineage.deposit_intent_id
        and intent.id = execution_job.deposit_intent_id
        and intent.status = 'execution_pending'
        and intent.receiver_sms_opening_id = lineage.opening_id
    where execution_job.job_kind = 'execute_deposit'
      and execution_job.status = 'queued'
      and execution_job.attempt_count = 0
      and execution_job.lease_token is null
      and matched.matched_at <= pg_catalog.statement_timestamp() - interval '60 minutes'
      and not exists (select 1 from app.deposit_execution_attempts attempt
        where attempt.deposit_intent_id = intent.id)
      and not exists (select 1 from app.deposit_review_cases review
        where review.deposit_intent_id = intent.id
          and review.status in ('open','assigned'))
      and not exists (select 1 from app.owner_manual_payment_cases owner_case
        join app.receiver_sms_deposit_candidates candidate
          on candidate.id = lineage.candidate_id
        where owner_case.payment_provider_id = candidate.payment_provider_id
          and owner_case.reference_fingerprint = candidate.reference_fingerprint)
    order by matched.matched_at, execution_job.id
    limit p_limit
    for update of execution_job skip locked
  loop
    -- One transaction moves the job, intent, and review together. A lease or
    -- attempted transfer cannot satisfy the predicates above.
    update app.deposit_jobs job
      set status = 'cancelled',
        last_error_code = 'automatic_window_expired_before_action'
      where job.id = v_row.job_id
        and job.status = 'queued' and job.attempt_count = 0
      returning job.id into v_row.job_id;
    if v_row.job_id is null then continue; end if;
    update app.deposit_intents intent
      set status = 'execution_review'
      where intent.id = v_row.intent_id and intent.status = 'execution_pending';
    if not found then raise exception 'The expired intent changed during handoff.'; end if;
    insert into app.deposit_review_cases
      (deposit_intent_id, review_kind, reason_code)
      values (v_row.intent_id, 'execution',
        'automatic_window_expired_before_action');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
alter function app.move_expired_receiver_sms_jobs_to_owner_review(integer)
  owner to postgres;
revoke all on function app.move_expired_receiver_sms_jobs_to_owner_review(integer)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;

-- Keep the existing Owner APIs and grants. Narrow, checked changes admit only
-- the terminal zero-attempt expiry state; all other automatic evidence remains
-- protected by the original guards.
do $owner_functions$
declare
  v_target text;
  v_definition text;
  v_old text;
  v_new text;
  v_hits integer;
begin
  foreach v_target in array array[
    'app.decide_owner_manual_payment_case(uuid,uuid,text,text)',
    'app.complete_owner_manual_payment_case(uuid,uuid,uuid,bigint,uuid,boolean,boolean)',
    'app.owner_can_record_stopped_credit(uuid,uuid)',
    'app.list_owner_submitted_payments(uuid,text,integer,integer)'
  ] loop
    v_definition := pg_catalog.pg_get_functiondef(v_target::regprocedure);
    if v_definition is null then raise exception 'Missing Owner function %', v_target; end if;
    if v_target = 'app.decide_owner_manual_payment_case(uuid,uuid,text,text)' then
      v_old := '  if exists (select 1 from app.owner_manual_payment_cases owner_case' ||
        pg_catalog.chr(10) ||
        '      where owner_case.payment_provider_id = v_candidate.payment_provider_id';
      v_new := $special_decision$
  if app.owner_expired_unattempted_sms_candidate(v_candidate.id) then
    if exists (select 1 from app.owner_manual_payment_cases owner_case
        where owner_case.payment_provider_id = v_candidate.payment_provider_id
          and owner_case.reference_fingerprint = v_candidate.reference_fingerprint) then
      raise exception 'The payment reference already has an Owner decision.';
    end if;
    select sms.* into v_event from app.receiver_sms_payment_events sms
      join app.receiver_sms_payment_matches matched
        on matched.payment_event_id = sms.id
          and matched.candidate_id = v_candidate.id
      where sms.provider_code = v_candidate.provider_code
        and sms.payment_provider_id = v_candidate.payment_provider_id
        and sms.reference_fingerprint = v_candidate.reference_fingerprint for share;
    if v_event.id is null then
      raise exception 'The signed receiving-phone payment is unavailable.';
    end if;
    insert into app.owner_manual_payment_cases
      (provider_code,payment_provider_id,reference_fingerprint,reference_masked,
        candidate_id,payment_event_id,status,amount_minor,receiver_account_id,
        receiver_account_version,rejection_reason,decided_by_admin_id)
    values (v_candidate.provider_code,v_candidate.payment_provider_id,
      v_candidate.reference_fingerprint,v_candidate.reference_masked,
      v_candidate.id,v_event.id,
      case when p_decision = 'approve' then 'awaiting_manual_credit' else 'rejected' end,
      v_event.amount_minor,v_event.receiver_account_id,v_event.receiver_account_version,
      p_rejection_reason,v_actor_id)
    returning * into v_case;
    update app.deposit_review_cases review
      set status = 'resolved', resolution_code = 'owner_manual_decision',
        assigned_admin_id = v_actor_id
      where review.deposit_intent_id = (
        select lineage.deposit_intent_id
        from app.receiver_sms_settlement_lineages lineage
        where lineage.candidate_id = v_candidate.id)
        and review.review_kind = 'execution'
        and review.reason_code = 'automatic_window_expired_before_action'
        and review.status in ('open','assigned');
    if not found then raise exception 'The expired automatic review changed.'; end if;
    if p_decision = 'reject' then
      perform app.queue_owner_manual_payment_outcome(v_candidate.id,'rejected',null);
    end if;
    return pg_catalog.jsonb_build_object('caseId',v_case.id,'status',v_case.status);
  end if;
  if exists (select 1 from app.owner_manual_payment_cases owner_case
      where owner_case.payment_provider_id = v_candidate.payment_provider_id$special_decision$;
    elsif v_target = 'app.complete_owner_manual_payment_case(uuid,uuid,uuid,bigint,uuid,boolean,boolean)' then
      v_old := '  if v_case.id is not null or v_candidate.id is null then';
      v_new := '  if (v_case.id is not null or v_candidate.id is null)' ||
        pg_catalog.chr(10) ||
        '    and (v_case.candidate_id is null or not ' ||
        'app.owner_expired_unattempted_sms_candidate(v_case.candidate_id)) then';
    elsif v_target = 'app.owner_can_record_stopped_credit(uuid,uuid)' then
      v_old := '  if p_candidate_id is null then return false; end if;';
      v_new := $outside_credit$
  if p_candidate_id is null then return false; end if;
  if app.owner_expired_unattempted_sms_candidate(p_candidate_id)
    and not exists (select 1 from app.owner_manual_payment_cases owner_case
      join app.receiver_sms_deposit_candidates candidate
        on candidate.id = p_candidate_id
      where owner_case.payment_provider_id = candidate.payment_provider_id
        and owner_case.reference_fingerprint = candidate.reference_fingerprint) then
    return true;
  end if;$outside_credit$;
    else
      v_old := '(owner_case.id is null and evidence.id is null' ||
        pg_catalog.chr(10) || '        and opening.id is null';
      v_new := '((owner_case.id is null and evidence.id is null' ||
        pg_catalog.chr(10) || '        and opening.id is null';
    end if;
    v_hits := (pg_catalog.length(v_definition) -
      pg_catalog.length(pg_catalog.replace(v_definition,v_old,''))) /
      pg_catalog.length(v_old);
    if v_hits <> 1 then
      raise exception 'Expected one Owner guard in %, found %', v_target, v_hits;
    end if;
    v_definition := pg_catalog.replace(v_definition,v_old,v_new);
    if v_target = 'app.list_owner_submitted_payments(uuid,text,integer,integer)' then
      v_old := '(candidate.submitted_at,candidate.id))) as manual_allowed';
      v_new := '(candidate.submitted_at,candidate.id))) or ' ||
        '(owner_case.id is null and ' ||
        'app.owner_expired_unattempted_sms_candidate(candidate.id))) as manual_allowed';
      v_hits := (pg_catalog.length(v_definition) -
        pg_catalog.length(pg_catalog.replace(v_definition,v_old,''))) /
        pg_catalog.length(v_old);
      if v_hits <> 1 then
        raise exception 'Expected one Owner manual-allowed tail, found %', v_hits;
      end if;
      v_definition := pg_catalog.replace(v_definition,v_old,v_new);
      v_old := '        when automatic_started then ' ||
        '''Automatic processing or reconciliation; check before manual credit''';
      v_new := '        when candidate_id is not null and ' ||
        'app.owner_expired_unattempted_sms_candidate(candidate_id)' ||
        pg_catalog.chr(10) ||
        '          then ''Automatic window expired; Owner decision needed''' ||
        pg_catalog.chr(10) || v_old;
      v_hits := (pg_catalog.length(v_definition) -
        pg_catalog.length(pg_catalog.replace(v_definition,v_old,''))) /
        pg_catalog.length(v_old);
      if v_hits <> 1 then
        raise exception 'Expected one Owner status detail, found %', v_hits;
      end if;
      v_definition := pg_catalog.replace(v_definition,v_old,v_new);
    end if;
    execute v_definition;
  end loop;
end;
$owner_functions$;

-- A migration-time pass includes already stranded verified payments. Cron
-- handles new expiries even when the Windows Companion is offline.
select app.move_expired_receiver_sms_jobs_to_owner_review(500);

do $install_expiry$
declare
  v_count integer;
begin
  if exists (select 1 from pg_catalog.pg_available_extensions extension
      where extension.name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    select pg_catalog.count(*)::integer into v_count from cron.job job
      where job.jobname = 'fetanagent-receiver-sms-expired-queue-v1';
    if v_count <> 0 then raise exception 'The expiry Cron job already exists.'; end if;
    perform cron.schedule('fetanagent-receiver-sms-expired-queue-v1','* * * * *',
      'select app.move_expired_receiver_sms_jobs_to_owner_review()');
    select pg_catalog.count(*)::integer into v_count from cron.job job
      where job.jobname = 'fetanagent-receiver-sms-expired-queue-v1'
        and job.active and job.username = 'postgres'
        and job.schedule = '* * * * *'
        and job.command =
          'select app.move_expired_receiver_sms_jobs_to_owner_review()';
    if v_count <> 1 then raise exception 'The expiry Cron installation is incomplete.'; end if;
  elsif pg_catalog.to_regclass('sql_integration.applied_migrations') is null then
    raise exception 'The automatic expiry handoff requires pg_cron.';
  end if;
end;
$install_expiry$;

comment on function app.move_expired_receiver_sms_jobs_to_owner_review(integer) is
  'Postgres-only, zero-attempt receiver-SMS queue expiry; creates an Owner decision without attempting a credit.';
comment on function app.owner_expired_unattempted_sms_candidate(uuid) is
  'Exact terminal evidence for Owner handling after a verified SMS job never attempted a transfer.';
commit;
