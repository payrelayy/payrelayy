-- An Owner-funded test payment diverted from a stopped pilot may be closed only after
-- an explicit no-credit/no-refund attestation. This migration only installs the private
-- operation. It neither invokes it nor grants it to an application or runtime role.
begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.stopped_pilot_owner_test_resolutions (
  resolution_request_key uuid primary key check (
    resolution_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  paid_review_request_key uuid not null unique
    references app.stopped_pilot_paid_execution_reviews (request_key) on delete restrict,
  deposit_intent_id uuid not null unique
    references app.deposit_intents (id) on delete restrict,
  review_case_id uuid not null unique
    references app.deposit_review_cases (id) on delete restrict,
  actor_admin_id uuid not null
    references app.admin_users (id) on delete restrict,
  resolution_code text not null default 'owner_self_funded_test_no_credit_or_refund'
    check (resolution_code = 'owner_self_funded_test_no_credit_or_refund'),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);

create trigger stopped_pilot_owner_test_resolutions_immutable
before update or delete on app.stopped_pilot_owner_test_resolutions
for each row
execute function app.reject_private_live_deposit_pilot_retained_mutation();

create trigger stopped_pilot_owner_test_resolutions_no_truncate
before truncate on app.stopped_pilot_owner_test_resolutions
for each statement
execute function app.reject_private_live_deposit_pilot_truncate();

create function app.resolve_stopped_pilot_owner_test_payment(
  p_actor_admin_id uuid,
  p_paid_review_request_key uuid,
  p_resolution_request_key uuid,
  p_owner_attests_both_wallets boolean,
  p_owner_accepts_no_credit_or_refund boolean
)
returns table (resolution_state text, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing app.stopped_pilot_owner_test_resolutions%rowtype;
  paid_review app.stopped_pilot_paid_execution_reviews%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  job app.deposit_jobs%rowtype;
  reservation app.private_live_deposit_pilot_reservations%rowtype;
  intent app.deposit_intents%rowtype;
  payment_claim app.deposit_payment_claims%rowtype;
  review_case app.deposit_review_cases%rowtype;
  switch_count integer;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production database administrator can record Owner test resolution.';
  end if;

  perform app.require_active_owner_for_private_live_deposit_pilot(p_actor_admin_id);

  if p_paid_review_request_key is null
    or p_resolution_request_key is null
    or p_resolution_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_owner_attests_both_wallets is distinct from true
    or p_owner_accepts_no_credit_or_refund is distinct from true then
    raise exception 'The Owner-funded test resolution attestation is incomplete.';
  end if;

  -- A key can only replay its exact earlier resolution. The attestation is a human
  -- assertion, not a database inference from masked receipt or customer details.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:stopped-pilot-owner-test-resolution:v1', 0)
  );

  select resolution.* into existing
    from app.stopped_pilot_owner_test_resolutions resolution
   where resolution.resolution_request_key = p_resolution_request_key
      or resolution.paid_review_request_key = p_paid_review_request_key
   for share;

  if existing.resolution_request_key is not null then
    if existing.resolution_request_key = p_resolution_request_key
      and existing.paid_review_request_key = p_paid_review_request_key
      and existing.actor_admin_id = p_actor_admin_id then
      return query select 'owner_test_closed'::text, true;
      return;
    end if;
    raise exception 'The Owner-funded test resolution conflicts with an existing receipt.';
  end if;

  -- Match the financial lock order and serialize with any activation or stop.
  perform authority.control_key
    from app.private_trusted_telebirr_activation_control authority
   where authority.control_key = 'trusted_telebirr_financial_authority'
   for share;
  if not found then
    raise exception 'The trusted financial authority control is unavailable.';
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
   for share;
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
  ) or app.current_private_trusted_telebirr_activation_epoch() is not null
    or exists (
      select 1 from app.deposit_jobs other_job
       where other_job.job_kind in ('execute_deposit', 'reconcile_execution')
         and other_job.status in ('queued', 'leased', 'retry_wait')
    ) then
    raise exception 'The Owner-funded test resolution requires dormant financial execution.';
  end if;

  select review.* into paid_review
    from app.stopped_pilot_paid_execution_reviews review
   where review.request_key = p_paid_review_request_key
   for share;

  select pilot_revision.* into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = paid_review.pilot_revision_id
   for share;

  perform control.singleton
    from app.agent_platform_companion_execution_control control
   where control.singleton and control.control_state = 'disabled'
   for share;
  if not found then
    raise exception 'Companion execution is not dormant.';
  end if;

  select execution_job.* into job
    from app.deposit_jobs execution_job
   where execution_job.id = paid_review.deposit_job_id
   for update;

  select pilot_reservation.* into reservation
    from app.private_live_deposit_pilot_reservations pilot_reservation
   where pilot_reservation.id = paid_review.reservation_id
   for share;

  select deposit_intent.* into intent
    from app.deposit_intents deposit_intent
   where deposit_intent.id = paid_review.deposit_intent_id
   for update;

  select claim.* into payment_claim
    from app.deposit_payment_claims claim
   where claim.id = paid_review.payment_claim_id
   for share;

  select deposit_case.* into review_case
    from app.deposit_review_cases deposit_case
   where deposit_case.deposit_intent_id = paid_review.deposit_intent_id
     and deposit_case.review_kind = 'execution'
     and deposit_case.reason_code = 'stopped_pilot_paid_proof_review'
     and deposit_case.status = 'open'
   for update;

  if paid_review.request_key is null
    or paid_review.actor_admin_id <> p_actor_admin_id
    or pilot.id is null
    or pilot.status <> 'stopped'
    or pilot.stop_reason_code <> 'owner_stop'
    or pilot.armed_by_admin_id <> p_actor_admin_id
    or pilot.stopped_by_admin_id <> p_actor_admin_id
    or job.id is null
    or job.deposit_intent_id <> paid_review.deposit_intent_id
    or job.job_kind <> 'execute_deposit'
    or job.status <> 'cancelled'
    or job.last_error_code <> 'stopped_pilot_paid_proof_review'
    or job.attempt_count <> 0
    or job.lease_token is not null
    or job.leased_by is not null
    or job.lease_expires_at is not null
    or job.completed_at is null
    or reservation.id is null
    or reservation.pilot_revision_id <> pilot.id
    or reservation.deposit_intent_id <> paid_review.deposit_intent_id
    or reservation.amount_minor <> 2500
    or reservation.currency_code <> 'ETB'
    or intent.id is null
    or intent.status <> 'execution_review'
    or intent.expected_amount_minor <> 2500
    or intent.rejection_reason_code is not null
    or payment_claim.id is null
    or payment_claim.deposit_intent_id <> intent.id
    or payment_claim.id <> reservation.deposit_payment_claim_id
    or payment_claim.provider_payment_evidence_id <>
       reservation.provider_payment_evidence_id
    or review_case.id is null
    or review_case.assigned_admin_id is not null
    or (select pg_catalog.count(*)
          from app.deposit_review_cases other_case
         where other_case.review_kind = 'execution'
           and other_case.status in ('open', 'assigned')) <> 1
    or exists (
      select 1 from app.deposit_execution_attempts attempt
       where attempt.deposit_intent_id = intent.id
          or attempt.deposit_job_id = job.id
    )
    or exists (
      select 1 from app.agent_platform_companion_execution_assignments assignment
       where assignment.execution_job_id = job.id
    ) then
    raise exception 'The protected Owner-funded test lineage is not eligible for closure.';
  end if;

  update app.deposit_intents deposit_intent
     set status = 'rejected',
         rejection_reason_code = 'owner_self_funded_test_no_credit_or_refund'
   where deposit_intent.id = intent.id
     and deposit_intent.status = 'execution_review';
  if not found then
    raise exception 'The Owner-funded test deposit changed before closure.';
  end if;

  update app.deposit_review_cases deposit_case
     set status = 'resolved',
         resolution_code = 'owner_self_funded_test_no_credit_or_refund'
   where deposit_case.id = review_case.id
     and deposit_case.status = 'open';
  if not found then
    raise exception 'The Owner-funded test review changed before closure.';
  end if;

  insert into app.stopped_pilot_owner_test_resolutions (
    resolution_request_key, paid_review_request_key, deposit_intent_id,
    review_case_id, actor_admin_id
  ) values (
    p_resolution_request_key, paid_review.request_key, intent.id,
    review_case.id, p_actor_admin_id
  );

  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, resource_id, metadata
  ) values (
    'admin', p_actor_admin_id, 'deposit.owner_self_funded_test_closed',
    'deposit_intent', intent.id,
    pg_catalog.jsonb_build_object(
      'pilot_revision_id', pilot.id,
      'paid_review_request_key', paid_review.request_key,
      'resolution_request_key', p_resolution_request_key,
      'owner_attested_both_wallets', true,
      'owner_accepted_no_credit_or_refund', true,
      'money_moved', false
    )
  );

  return query select 'owner_test_closed'::text, false;
end;
$$;

alter table app.stopped_pilot_owner_test_resolutions enable row level security;
alter table app.stopped_pilot_owner_test_resolutions force row level security;
alter table app.stopped_pilot_owner_test_resolutions owner to postgres;
alter function app.resolve_stopped_pilot_owner_test_payment(
  uuid, uuid, uuid, boolean, boolean
) owner to postgres;

revoke all privileges on table app.stopped_pilot_owner_test_resolutions
from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge,
  fetanagent_companion_execution_bridge_runtime;

revoke all on function app.resolve_stopped_pilot_owner_test_payment(
  uuid, uuid, uuid, boolean, boolean
) from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge,
  fetanagent_companion_execution_bridge_runtime;

comment on table app.stopped_pilot_owner_test_resolutions is
  'Immutable Owner attestation closing one protected self-funded stopped-pilot test without a refund, credit, provider action, or queue execution.';
comment on function app.resolve_stopped_pilot_owner_test_payment(
  uuid, uuid, uuid, boolean, boolean
) is
  'Postgres-only one-use closure for an Owner-attested self-funded test. It rejects the deposit, resolves the review case, and preserves the cancelled job, payment claim, and reservation; no money action is authorized.';

commit;
