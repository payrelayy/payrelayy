-- One-use incident hold for the three Owner-identified test payments received
-- on 2026-10-24. No KemerBet action, credit, refund, or retry is performed.
-- The payment claims remain intact; credit outcome is deliberately not asserted.
begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '20s';
set local lock_timeout = '2s';

do $hold$
declare
  target_ids uuid[];
  open_count integer;
  changed_count integer;
begin
  if session_user <> 'postgres' or current_user <> 'postgres'
    or not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'fetanagent:routine-telebirr-processing', 20261004)) then
    raise exception 'The protected incident hold session is unavailable.';
  end if;

  if (select pg_catalog.count(*) from app.feature_switches feature
        where feature.feature_key in ('payment_verification', 'deposit_execution')
          and feature.mode = 'disabled' and feature.settings = '{}'::jsonb) <> 2
    or app.routine_telebirr_runtime_is_active() then
    raise exception 'Automatic deposit execution is not stopped exactly.';
  end if;

  perform 1 from app.deposit_jobs job
    where job.job_kind in ('execute_deposit', 'reconcile_execution')
      and job.status in ('queued', 'leased', 'retry_wait')
    order by job.id for update;

  select pg_catalog.count(*), pg_catalog.array_agg(job.id order by job.id)
    into open_count, target_ids
    from app.deposit_jobs job
    join app.deposit_intents intent on intent.id = job.deposit_intent_id
    where job.job_kind = 'execute_deposit'
      and job.status = 'queued'
      and job.created_at >= '2026-10-24 01:47:54+00'::timestamptz
      and job.created_at < '2026-10-24 01:54:00+00'::timestamptz
      and job.attempt_count = 0
      and job.max_attempts = 1
      and job.lease_token is null
      and job.leased_by is null
      and job.lease_expires_at is null
      and intent.status = 'execution_pending'
      and intent.receiver_sms_opening_id is not null
      and (select pg_catalog.count(*) from app.deposit_payment_claims claim
            where claim.deposit_intent_id = intent.id) = 1
      and not exists (select 1 from app.deposit_execution_attempts attempt
            where attempt.deposit_intent_id = intent.id)
      and not exists (select 1 from app.deposit_review_cases review_case
            where review_case.deposit_intent_id = intent.id
              and review_case.status in ('open', 'assigned'));

  if open_count <> 3
    or (select pg_catalog.count(*) from app.deposit_jobs job
          where job.job_kind in ('execute_deposit', 'reconcile_execution')
            and job.status in ('queued', 'leased', 'retry_wait')) <> 3
    or exists (select 1 from app.deposit_execution_attempts attempt
          where attempt.status in ('prepared', 'final_action_fenced',
            'reconciliation_required', 'review_required')) then
    raise exception 'The three untouched test jobs are not the complete active set.';
  end if;

  update app.deposit_jobs job
    set status = 'cancelled', last_error_code = 'owner_test_held_for_review'
    where job.id = any(target_ids) and job.status = 'queued'
      and job.attempt_count = 0 and job.lease_token is null;
  get diagnostics changed_count = row_count;
  if changed_count <> 3 then raise exception 'A test job changed state.'; end if;

  update app.deposit_intents intent set status = 'execution_review'
    where intent.id in (select job.deposit_intent_id from app.deposit_jobs job
      where job.id = any(target_ids)) and intent.status = 'execution_pending';
  get diagnostics changed_count = row_count;
  if changed_count <> 3 then raise exception 'A test payment changed state.'; end if;

  insert into app.deposit_review_cases (deposit_intent_id, review_kind, reason_code)
    select job.deposit_intent_id, 'execution', 'owner_test_no_automatic_credit'
      from app.deposit_jobs job where job.id = any(target_ids);
  get diagnostics changed_count = row_count;
  if changed_count <> 3 then raise exception 'A test review was not recorded.'; end if;

  if exists (select 1 from app.deposit_jobs job
      where job.job_kind in ('execute_deposit', 'reconcile_execution')
        and job.status in ('queued', 'leased', 'retry_wait'))
    or (select pg_catalog.count(*) from app.deposit_intents intent
        where intent.id in (select job.deposit_intent_id from app.deposit_jobs job
          where job.id = any(target_ids)) and intent.status = 'execution_review') <> 3
    or (select pg_catalog.count(*) from app.deposit_review_cases review_case
        where review_case.deposit_intent_id in
          (select job.deposit_intent_id from app.deposit_jobs job
            where job.id = any(target_ids))
          and review_case.review_kind = 'execution'
          and review_case.status = 'open') <> 3
    or (select pg_catalog.count(*) from app.deposit_payment_claims claim
        where claim.deposit_intent_id in
          (select job.deposit_intent_id from app.deposit_jobs job
            where job.id = any(target_ids))) <> 3 then
    raise exception 'The test hold postcondition failed.';
  end if;

  insert into app.audit_events (actor_kind, actor_label, action,
    resource_type, metadata)
  values ('system', 'owner-identified-test-incident-hold',
    'deposit.owner_tests_held_for_review', 'deposit_job',
    pg_catalog.jsonb_build_object('jobCount', 3, 'moneyMovedByOperation', false,
      'creditOutcomeAsserted', false, 'claimsPreserved', true));
end;
$hold$;

commit;
select pg_catalog.jsonb_build_object(
  'operation', 'owner_test_deposits_held_for_review',
  'jobCount', 3, 'moneyMovedByOperation', false,
  'creditOutcomeAsserted', false, 'identifiersRedacted', true
)::text;
