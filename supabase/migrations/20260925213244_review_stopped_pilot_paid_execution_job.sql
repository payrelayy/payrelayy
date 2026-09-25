-- Preserve a verified payment from a stopped pilot as an explicit customer-resolution case.
-- This is an operator-only disposition, not a credit, execution, or pilot rebind. Applying the
-- migration does not call the function or alter a production job.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.stopped_pilot_paid_execution_reviews (
  request_key uuid primary key check (
    request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  deposit_job_id uuid not null unique
    references app.deposit_jobs (id) on delete restrict,
  deposit_intent_id uuid not null unique
    references app.deposit_intents (id) on delete restrict,
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  reservation_id uuid not null unique
    references app.private_live_deposit_pilot_reservations (id) on delete restrict,
  payment_claim_id uuid not null unique
    references app.deposit_payment_claims (id) on delete restrict,
  actor_admin_id uuid not null
    references app.admin_users (id) on delete restrict,
  reason_code text not null default 'stopped_pilot_paid_proof_review'
    check (reason_code = 'stopped_pilot_paid_proof_review'),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index stopped_pilot_paid_execution_reviews_pilot_idx
  on app.stopped_pilot_paid_execution_reviews (pilot_revision_id, recorded_at);

create trigger stopped_pilot_paid_execution_reviews_immutable
before update or delete on app.stopped_pilot_paid_execution_reviews
for each row
execute function app.reject_private_live_deposit_pilot_retained_mutation();

create trigger stopped_pilot_paid_execution_reviews_no_truncate
before truncate on app.stopped_pilot_paid_execution_reviews
for each statement
execute function app.reject_private_live_deposit_pilot_truncate();

create function app.review_stopped_pilot_paid_execution_job(
  p_actor_admin_id uuid,
  p_pilot_revision_id uuid,
  p_deposit_job_id uuid,
  p_request_key uuid
)
returns table (review_state text, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing app.stopped_pilot_paid_execution_reviews%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  job app.deposit_jobs%rowtype;
  reservation app.private_live_deposit_pilot_reservations%rowtype;
  intent app.deposit_intents%rowtype;
  payment_claim app.deposit_payment_claims%rowtype;
  switch_count integer;
begin
  if session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'Only the production database administrator can review a stopped-pilot paid job.';
  end if;

  perform app.require_active_owner_for_private_live_deposit_pilot(p_actor_admin_id);

  if p_pilot_revision_id is null
    or p_deposit_job_id is null
    or p_request_key is null
    or p_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'The stopped-pilot paid-job review request is invalid.';
  end if;

  -- Serialize operator requests before the shared switch/pilot/job boundary. An exact replay is
  -- read-only; a different key or target cannot silently reclassify an already reviewed payment.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:stopped-pilot-paid-job-review:v1', 0)
  );

  select review.* into existing
    from app.stopped_pilot_paid_execution_reviews review
   where review.request_key = p_request_key
      or review.deposit_job_id = p_deposit_job_id
   for share;

  if existing.request_key is not null then
    if existing.request_key = p_request_key
      and existing.deposit_job_id = p_deposit_job_id
      and existing.pilot_revision_id = p_pilot_revision_id
      and existing.actor_admin_id = p_actor_admin_id then
      return query select 'review_required'::text, true;
      return;
    end if;
    raise exception 'The stopped-pilot paid-job review request conflicts with an existing receipt.';
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification',
     'withdrawal_collection',
     'withdrawal_validation'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  if switch_count <> 7 or exists (
    select 1 from app.feature_switches feature_switch
     where feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'private_live_deposit_pilot',
       'telebirr_authoritative_verification',
       'withdrawal_collection',
       'withdrawal_validation'
     ) and (
       feature_switch.mode <> 'disabled'
       or feature_switch.settings <> '{}'::jsonb
     )
  ) or app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception 'The stopped-pilot review requires every financial authority disabled.';
  end if;

  if (select pg_catalog.count(*)
        from app.agent_platform_companion_execution_control control
       where control.singleton and control.control_state = 'disabled') <> 1
    or exists (
      select 1 from app.agent_platform_companion_execution_assignments assignment
       where assignment.execution_job_id = p_deposit_job_id
    ) or exists (
      select 1 from app.deposit_execution_attempts attempt
       where attempt.deposit_job_id = p_deposit_job_id
    ) then
    raise exception 'The stopped-pilot review requires no companion or deposit execution.';
  end if;

  select pilot_revision.* into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = p_pilot_revision_id
   for update;

  select execution_job.* into job
    from app.deposit_jobs execution_job
   where execution_job.id = p_deposit_job_id
   for update;

  if pilot.id is null
    or pilot.status <> 'stopped'
    or pilot.stop_reason_code <> 'owner_stop'
    or pilot.stopped_at is null
    or job.id is null
    or job.job_kind <> 'execute_deposit'
    or job.status <> 'queued'
    or job.attempt_count <> 0
    or job.lease_token is not null
    or job.leased_by is not null
    or job.lease_expires_at is not null
    or job.completed_at is not null
    or job.payload <> '{}'::jsonb
    or (select pg_catalog.count(*)
          from app.deposit_jobs other_job
         where other_job.job_kind in ('execute_deposit', 'reconcile_execution')
           and other_job.status in ('queued', 'leased', 'retry_wait')) <> 1 then
    raise exception 'The stopped-pilot paid job is not singular and untouched.';
  end if;

  select pilot_reservation.* into reservation
    from app.private_live_deposit_pilot_reservations pilot_reservation
   where pilot_reservation.deposit_intent_id = job.deposit_intent_id
   for share;

  select deposit_intent.* into intent
    from app.deposit_intents deposit_intent
   where deposit_intent.id = job.deposit_intent_id
   for update;

  select claim.* into payment_claim
    from app.deposit_payment_claims claim
   where claim.id = reservation.deposit_payment_claim_id
     and claim.deposit_intent_id = job.deposit_intent_id
   for share;

  if reservation.id is null
    or reservation.pilot_revision_id <> pilot.id
    or reservation.amount_minor <> 2500
    or reservation.currency_code <> 'ETB'
    or intent.id is null
    or intent.status <> 'execution_pending'
    or intent.expected_amount_minor <> 2500
    or payment_claim.id is null
    or payment_claim.provider_payment_evidence_id
         <> reservation.provider_payment_evidence_id
    or exists (
      select 1 from app.deposit_review_cases review_case
       where review_case.deposit_intent_id = intent.id
         and review_case.review_kind = 'execution'
         and review_case.status in ('open', 'assigned')
    ) then
    raise exception 'The stopped-pilot payment lineage is not eligible for protected review.';
  end if;

  update app.deposit_jobs execution_job
     set status = 'cancelled',
         last_error_code = 'stopped_pilot_paid_proof_review'
   where execution_job.id = job.id
     and execution_job.status = 'queued'
     and execution_job.attempt_count = 0;
  if not found then
    raise exception 'The stopped-pilot job changed before review.';
  end if;

  update app.deposit_intents deposit_intent
     set status = 'execution_review'
   where deposit_intent.id = intent.id
     and deposit_intent.status = 'execution_pending';
  if not found then
    raise exception 'The stopped-pilot deposit changed before review.';
  end if;

  insert into app.deposit_review_cases (
    deposit_intent_id, review_kind, reason_code
  ) values (
    intent.id, 'execution', 'stopped_pilot_paid_proof_review'
  );

  insert into app.stopped_pilot_paid_execution_reviews (
    request_key, deposit_job_id, deposit_intent_id, pilot_revision_id,
    reservation_id, payment_claim_id, actor_admin_id
  ) values (
    p_request_key, job.id, intent.id, pilot.id,
    reservation.id, payment_claim.id, p_actor_admin_id
  );

  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, resource_id, metadata
  ) values (
    'admin', p_actor_admin_id, 'deposit.stopped_pilot_paid_proof_review',
    'deposit_intent', intent.id,
    pg_catalog.jsonb_build_object(
      'pilot_revision_id', pilot.id,
      'deposit_job_id', job.id,
      'payment_claim_id', payment_claim.id,
      'money_moved', false,
      'customer_resolution_required', true
    )
  );

  return query select 'review_required'::text, false;
end;
$$;

alter table app.stopped_pilot_paid_execution_reviews enable row level security;
alter table app.stopped_pilot_paid_execution_reviews force row level security;
alter table app.stopped_pilot_paid_execution_reviews owner to postgres;
alter function app.review_stopped_pilot_paid_execution_job(uuid, uuid, uuid, uuid)
  owner to postgres;

revoke all privileges on table app.stopped_pilot_paid_execution_reviews
from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge;

revoke all on function
  app.review_stopped_pilot_paid_execution_job(uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge;

comment on table app.stopped_pilot_paid_execution_reviews is
  'Immutable record of a verified paid proof diverted from an untouched stopped-pilot execution queue into customer resolution; it never records a credit.';
comment on function app.review_stopped_pilot_paid_execution_job(uuid, uuid, uuid, uuid) is
  'Postgres-only, one-use stopped-pilot queue disposition. Cancels only one unleased zero-attempt job, preserves proof and reservation, opens execution review, and grants no execution or money authority.';

commit;
