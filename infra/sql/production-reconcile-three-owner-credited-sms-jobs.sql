\set ON_ERROR_STOP on

-- One-use incident closure. The Owner attested that all three SMS payments
-- were credited manually. This operation never submits or retries a Transfer.
begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '20s';
set local lock_timeout = '2s';

do $reconcile$
declare
  open_count integer;
  queued_count integer;
  prepared_count integer;
  claim_count integer;
  changed_count integer;
  target_ids uuid[];
  pending record;
  job record;
  cancellation record;
  request_key uuid := pg_catalog.gen_random_uuid();
begin
  if session_user <> 'postgres' or current_user <> 'postgres'
    or not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'fetanagent:routine-telebirr-processing', 20261004)) then
    raise exception 'The protected reconciliation session is unavailable.';
  end if;

  perform 1 from app.receiver_sms_route_control route
    where route.singleton and not route.enabled for update;
  if not found or (select pg_catalog.count(*) from app.feature_switches feature
      where feature.feature_key in (
        'cbe_birr_authoritative_verification', 'deposit_execution',
        'payment_verification', 'private_live_deposit_pilot',
        'telebirr_authoritative_verification', 'withdrawal_collection',
        'withdrawal_validation') and feature.mode = 'disabled'
        and feature.settings = '{}'::jsonb) <> 7
    or app.routine_telebirr_signed_worker_recent(interval '5 minutes') then
    raise exception 'The stopped SMS and worker boundary is not exact.';
  end if;

  -- Lock the complete open execution set before evaluating its shape. A new
  -- or changed row fails the postcondition and rolls the entire operation back.
  perform 1 from app.deposit_jobs deposit_job
    where deposit_job.job_kind in ('execute_deposit', 'reconcile_execution')
      and deposit_job.status in ('queued', 'leased', 'retry_wait')
    order by deposit_job.id for update;
  select pg_catalog.count(*),
         pg_catalog.count(*) filter (where deposit_job.status = 'queued'),
         pg_catalog.array_agg(deposit_job.id order by deposit_job.id)
    into open_count, queued_count, target_ids
    from app.deposit_jobs deposit_job
    join app.deposit_intents intent on intent.id = deposit_job.deposit_intent_id
    where deposit_job.job_kind in ('execute_deposit', 'reconcile_execution')
      and deposit_job.status in ('queued', 'leased', 'retry_wait')
      and deposit_job.created_at >= '2026-10-22 14:55:00+00'::timestamptz
      and deposit_job.created_at < '2026-10-22 15:08:00+00'::timestamptz
      and deposit_job.job_kind = 'execute_deposit'
      and intent.status = 'execution_pending'
      and intent.receiver_sms_opening_id is not null
      and deposit_job.max_attempts = 1;
  if open_count <> 3 or queued_count <> 2
    or (select pg_catalog.count(*) from app.deposit_jobs deposit_job
        where deposit_job.job_kind in ('execute_deposit', 'reconcile_execution')
          and deposit_job.status in ('queued', 'leased', 'retry_wait')) <> 3
    or (select pg_catalog.count(*) from app.deposit_execution_attempts attempt
        where attempt.status in ('prepared', 'final_action_fenced',
          'reconciliation_required', 'review_required')) <> 1 then
    raise exception 'The three-payment execution ledger is not exact.';
  end if;

  select pg_catalog.count(distinct deposit_job.deposit_intent_id),
         pg_catalog.count(distinct claim.deposit_intent_id)
    into prepared_count, claim_count
    from app.deposit_jobs deposit_job
    left join app.deposit_payment_claims claim
      on claim.deposit_intent_id = deposit_job.deposit_intent_id
    where deposit_job.id = any(target_ids);
  if prepared_count <> 3 or claim_count <> 3
    or exists (select 1 from app.deposit_review_cases review_case
      where review_case.deposit_intent_id in
        (select deposit_job.deposit_intent_id from app.deposit_jobs deposit_job
          where deposit_job.id = any(target_ids))
        and review_case.review_kind = 'execution'
        and review_case.status in ('open', 'assigned')) then
    raise exception 'The three one-use claims or review state changed.';
  end if;

  select attempt.id as attempt_id, deposit_job.lease_token,
         deposit_job.lease_expires_at into pending
    from app.deposit_execution_attempts attempt
    join app.deposit_jobs deposit_job on deposit_job.id = attempt.deposit_job_id
    where deposit_job.id = any(target_ids)
      and deposit_job.status = 'leased' and deposit_job.attempt_count = 1
      and deposit_job.lease_token is not null
      and deposit_job.lease_expires_at < pg_catalog.clock_timestamp() - interval '5 minutes'
      and attempt.status = 'prepared'
      and attempt.final_action_fenced_at is null
      and attempt.reconciliation_required_at is null
      and attempt.resolved_at is null;
  get diagnostics prepared_count = row_count;
  if prepared_count <> 1 or (select pg_catalog.count(*)
      from app.deposit_execution_attempts attempt
      where attempt.deposit_job_id = any(target_ids)) <> 1
    or (select pg_catalog.count(*) from app.deposit_jobs deposit_job
        where deposit_job.id = any(target_ids) and deposit_job.status = 'queued'
          and deposit_job.attempt_count = 0 and deposit_job.lease_token is null
          and deposit_job.leased_by is null) <> 2 then
    raise exception 'A payment may have reached a final action or changed state.';
  end if;

  select * into strict cancellation from app.cancel_deposit_execution_before_action(
    pending.attempt_id, pending.lease_token, 'operator_stopped_before_action');
  if cancellation.attempt_status is distinct from 'cancelled_before_action'
    or cancellation.deposit_status is distinct from 'execution_review' then
    raise exception 'The expired unfenced attempt was not placed in review.';
  end if;

  for job in select deposit_job.id, deposit_job.deposit_intent_id
      from app.deposit_jobs deposit_job
      where deposit_job.id = any(target_ids) and deposit_job.status = 'queued'
      order by deposit_job.id
  loop
    update app.deposit_jobs deposit_job
      set status = 'cancelled', last_error_code = 'owner_attested_manual_credit'
      where deposit_job.id = job.id and deposit_job.status = 'queued'
        and deposit_job.attempt_count = 0 and deposit_job.lease_token is null;
    get diagnostics changed_count = row_count;
    if changed_count <> 1 then raise exception 'A queued job changed state.'; end if;
    update app.deposit_intents intent set status = 'execution_review'
      where intent.id = job.deposit_intent_id and intent.status = 'execution_pending';
    get diagnostics changed_count = row_count;
    if changed_count <> 1 then raise exception 'A payment intent changed state.'; end if;
    insert into app.deposit_review_cases (
      deposit_intent_id, review_kind, reason_code
    ) values (job.deposit_intent_id, 'execution', 'owner_attested_manual_credit');
  end loop;

  if (select pg_catalog.count(*) from app.deposit_jobs deposit_job
      where deposit_job.id = any(target_ids) and deposit_job.status = 'cancelled') <> 3
    or (select pg_catalog.count(*) from app.deposit_intents intent
        where intent.id in (select deposit_job.deposit_intent_id
          from app.deposit_jobs deposit_job where deposit_job.id = any(target_ids))
          and intent.status = 'execution_review') <> 3
    or (select pg_catalog.count(*) from app.deposit_review_cases review_case
        where review_case.deposit_intent_id in
          (select deposit_job.deposit_intent_id from app.deposit_jobs deposit_job
            where deposit_job.id = any(target_ids))
          and review_case.review_kind = 'execution'
          and review_case.status = 'open') <> 3
    or exists (select 1 from app.deposit_jobs deposit_job
      where deposit_job.job_kind in ('execute_deposit', 'reconcile_execution')
        and deposit_job.status in ('queued', 'leased', 'retry_wait'))
    or exists (select 1 from app.deposit_execution_attempts attempt
      where attempt.status in ('prepared', 'final_action_fenced',
        'reconciliation_required', 'review_required')) then
    raise exception 'The manual-credit review postcondition failed.';
  end if;

  insert into app.audit_events (actor_kind, actor_label, action,
    resource_type, metadata)
  values ('system', 'owner-attested-guarded-operation',
    'receiver_sms.manual_credit_review_recorded', 'deposit_job',
    pg_catalog.jsonb_build_object('requestKey', request_key,
      'jobCount', 3, 'cancelledBeforeActionCount', 1,
      'neverLeasedCount', 2, 'moneyMovedByOperation', false));
end;
$reconcile$;

commit;
select pg_catalog.jsonb_build_object(
  'operation', 'owner_attested_sms_manual_credit_review',
  'jobCount', 3, 'moneyMovedByOperation', false,
  'identifiersRedacted', true
)::text;
