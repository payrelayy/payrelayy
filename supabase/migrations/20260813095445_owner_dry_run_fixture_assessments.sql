-- PayReplayy staging-only advisory CBE Birr fixture assessment boundary.
--
-- These records are explicitly non-authoritative. They cannot create provider evidence,
-- verification attempts, payment claims, jobs, or KemerBet actions. Both ledgers are append-only,
-- private, and callable only by the narrow Owner-control runtime while every financial feature is
-- disabled.

begin;

create table app.deposit_dry_run_fixture_assessments (
  id uuid primary key default gen_random_uuid(),
  deposit_intent_id uuid not null references app.deposit_intents (id) on delete restrict,
  deposit_submission_id uuid not null,
  fixture_id text not null check (
    fixture_id in (
      'valid-completed', 'wrong-receiver', 'wrong-amount', 'stale-completed',
      'future-completed', 'pending-status', 'failed-status', 'malformed-layout',
      'unknown-status', 'duplicate-reference', 'unavailable-source'
    )
  ),
  evaluator_version text not null check (evaluator_version = 'cbe-birr-fixture-verifier-v1'),
  outcome text not null check (outcome in ('would_verify', 'would_reject', 'would_review')),
  reason_code text not null,
  actor_admin_id uuid not null references app.admin_users (id) on delete restrict,
  assessed_at timestamptz not null default clock_timestamp(),
  constraint deposit_dry_run_fixture_assessment_pair check (
    (outcome = 'would_verify' and reason_code = 'fixture_completed')
    or (outcome = 'would_reject' and reason_code in (
      'receiver_mismatch', 'provider_status_failed', 'provider_reference_reused'
    ))
    or (outcome = 'would_review' and reason_code in (
      'amount_mismatch', 'payment_stale', 'payment_timestamp_future',
      'fixture_request_invalid', 'fixture_unavailable', 'fixture_malformed',
      'fixture_unknown', 'fixture_status_pending', 'fixture_duplicate_check_unavailable'
    ))
  ),
  constraint deposit_dry_run_fixture_assessment_submission_fkey
    foreign key (deposit_submission_id, deposit_intent_id)
    references app.deposit_submissions (id, deposit_intent_id) on delete restrict,
  constraint deposit_dry_run_fixture_assessment_once
    unique (deposit_intent_id, deposit_submission_id, fixture_id, evaluator_version)
);

create index deposit_dry_run_fixture_assessments_intent_time_idx
  on app.deposit_dry_run_fixture_assessments (deposit_intent_id, assessed_at desc);

create table app.deposit_dry_run_fixture_reviews (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null unique
    references app.deposit_dry_run_fixture_assessments (id) on delete restrict,
  actor_admin_id uuid not null references app.admin_users (id) on delete restrict,
  decision text not null check (decision in ('acknowledged', 'manual_review_required')),
  reviewed_at timestamptz not null default clock_timestamp()
);

create function app.reject_deposit_dry_run_fixture_record_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Dry-run fixture assessment records are append-only.';
end;
$$;

create trigger deposit_dry_run_fixture_assessments_immutable
before update or delete on app.deposit_dry_run_fixture_assessments
for each row execute function app.reject_deposit_dry_run_fixture_record_mutation();

create trigger deposit_dry_run_fixture_assessments_no_truncate
before truncate on app.deposit_dry_run_fixture_assessments
for each statement execute function app.reject_deposit_dry_run_fixture_record_mutation();

create trigger deposit_dry_run_fixture_reviews_immutable
before update or delete on app.deposit_dry_run_fixture_reviews
for each row execute function app.reject_deposit_dry_run_fixture_record_mutation();

create trigger deposit_dry_run_fixture_reviews_no_truncate
before truncate on app.deposit_dry_run_fixture_reviews
for each statement execute function app.reject_deposit_dry_run_fixture_record_mutation();

create function app.record_owner_dry_run_fixture_assessment(
  p_actor_auth_user_id uuid,
  p_deposit_intent_id uuid,
  p_fixture_id text,
  p_outcome text,
  p_reason_code text
)
returns table (
  assessment_id uuid,
  assessed_at timestamptz,
  already_recorded boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  actor_admin_id uuid;
  resolved_submission_id uuid;
  inserted_assessment_id uuid;
  inserted_assessed_at timestamptz;
  existing_outcome text;
  existing_reason_code text;
begin
  if p_actor_auth_user_id is null or p_deposit_intent_id is null
    or p_fixture_id is null or p_outcome is null or p_reason_code is null then
    raise exception 'The Owner dry-run fixture assessment request is invalid.';
  end if;

  perform app.require_financial_features_disabled_for_dry_run();

  select admin_user.id into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;
  if actor_admin_id is null then raise exception 'An active Owner is required.'; end if;

  if p_fixture_id not in (
      'valid-completed', 'wrong-receiver', 'wrong-amount', 'stale-completed',
      'future-completed', 'pending-status', 'failed-status', 'malformed-layout',
      'unknown-status', 'duplicate-reference', 'unavailable-source'
    )
    or not (
      (p_outcome = 'would_verify' and p_reason_code = 'fixture_completed')
      or (p_outcome = 'would_reject' and p_reason_code in (
        'receiver_mismatch', 'provider_status_failed', 'provider_reference_reused'
      ))
      or (p_outcome = 'would_review' and p_reason_code in (
        'amount_mismatch', 'payment_stale', 'payment_timestamp_future',
        'fixture_request_invalid', 'fixture_unavailable', 'fixture_malformed',
        'fixture_unknown', 'fixture_status_pending', 'fixture_duplicate_check_unavailable'
      ))
    ) then
    raise exception 'The advisory fixture result is invalid.';
  end if;

  perform 1
    from app.deposit_intents deposit_intent
    join app.payment_providers payment_provider
      on payment_provider.id = deposit_intent.payment_provider_id
   where deposit_intent.id = p_deposit_intent_id
     and deposit_intent.status = 'intake_received'
     and deposit_intent.origin_inbound_event_id is not null
     and payment_provider.code = 'cbe_birr'
     and exists (
       select 1 from app.inbound_event_consumptions consumption
        where consumption.origin_inbound_event_id = deposit_intent.origin_inbound_event_id
          and consumption.consumer_kind = 'open_dry_run_deposit_intent'
          and consumption.outcome = 'completed'
          and consumption.outcome_reason_code = 'dry_run_deposit_intent_opened'
     )
   for share of deposit_intent;
  if not found then raise exception 'The dry-run deposit intent is unavailable.'; end if;

  select submission.id into resolved_submission_id
    from app.deposit_submissions submission
   where submission.deposit_intent_id = p_deposit_intent_id
     and submission.status = 'received'
   order by submission.submission_number desc
   limit 1
   for share;
  if resolved_submission_id is null then
    raise exception 'A received dry-run reference is required before fixture assessment.';
  end if;

  insert into app.deposit_dry_run_fixture_assessments as assessment (
    deposit_intent_id, deposit_submission_id, fixture_id, evaluator_version,
    outcome, reason_code, actor_admin_id
  ) values (
    p_deposit_intent_id, resolved_submission_id, p_fixture_id,
    'cbe-birr-fixture-verifier-v1', p_outcome, p_reason_code, actor_admin_id
  )
  on conflict (deposit_intent_id, deposit_submission_id, fixture_id, evaluator_version)
  do nothing
  returning assessment.id, assessment.assessed_at
    into inserted_assessment_id, inserted_assessed_at;

  if inserted_assessment_id is null then
    select assessment.id, assessment.assessed_at, assessment.outcome, assessment.reason_code
      into inserted_assessment_id, inserted_assessed_at, existing_outcome, existing_reason_code
      from app.deposit_dry_run_fixture_assessments assessment
     where assessment.deposit_intent_id = p_deposit_intent_id
       and assessment.deposit_submission_id = resolved_submission_id
       and assessment.fixture_id = p_fixture_id
       and assessment.evaluator_version = 'cbe-birr-fixture-verifier-v1';
    if existing_outcome is distinct from p_outcome or existing_reason_code is distinct from p_reason_code then
      raise exception 'The fixture assessment replay does not match the recorded advisory result.';
    end if;
    return query select inserted_assessment_id, inserted_assessed_at, true;
    return;
  end if;

  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, resource_id, metadata
  ) values (
    'admin', actor_admin_id, 'deposit.dry_run_fixture_assessed',
    'deposit_dry_run_fixture_assessment', inserted_assessment_id,
    jsonb_build_object(
      'deposit_intent_id', p_deposit_intent_id,
      'fixture_id', p_fixture_id,
      'evaluator_version', 'cbe-birr-fixture-verifier-v1',
      'outcome', p_outcome,
      'reason_code', p_reason_code,
      'financial_mode', 'dry_run',
      'authoritative', false
    )
  );

  return query select inserted_assessment_id, inserted_assessed_at, false;
end;
$$;

create function app.review_owner_dry_run_fixture_assessment(
  p_actor_auth_user_id uuid,
  p_assessment_id uuid,
  p_decision text
)
returns table (
  assessment_id uuid,
  decision text,
  reviewed_at timestamptz,
  already_recorded boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  actor_admin_id uuid;
  inserted_reviewed_at timestamptz;
  existing_decision text;
begin
  if p_actor_auth_user_id is null or p_assessment_id is null or p_decision is null
    or p_decision not in ('acknowledged', 'manual_review_required') then
    raise exception 'The Owner dry-run fixture review request is invalid.';
  end if;

  perform app.require_financial_features_disabled_for_dry_run();

  select admin_user.id into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;
  if actor_admin_id is null then raise exception 'An active Owner is required.'; end if;

  perform 1 from app.deposit_dry_run_fixture_assessments assessment
   where assessment.id = p_assessment_id for share;
  if not found then raise exception 'The advisory fixture assessment is unavailable.'; end if;

  insert into app.deposit_dry_run_fixture_reviews as review (
    assessment_id, actor_admin_id, decision
  ) values (p_assessment_id, actor_admin_id, p_decision)
  on conflict (assessment_id) do nothing
  returning review.reviewed_at into inserted_reviewed_at;

  if inserted_reviewed_at is null then
    select review.decision, review.reviewed_at
      into existing_decision, inserted_reviewed_at
      from app.deposit_dry_run_fixture_reviews review
     where review.assessment_id = p_assessment_id;
    if existing_decision is distinct from p_decision then
      raise exception 'The advisory fixture review is already final.';
    end if;
    return query select p_assessment_id, existing_decision, inserted_reviewed_at, true;
    return;
  end if;

  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, resource_id, metadata
  ) values (
    'admin', actor_admin_id, 'deposit.dry_run_fixture_reviewed',
    'deposit_dry_run_fixture_assessment', p_assessment_id,
    jsonb_build_object(
      'decision', p_decision,
      'financial_mode', 'dry_run',
      'authoritative', false
    )
  );

  return query select p_assessment_id, p_decision, inserted_reviewed_at, false;
end;
$$;

create function app.list_owner_dry_run_fixture_assessments(
  p_actor_auth_user_id uuid,
  p_limit integer default 50
)
returns table (
  assessment_id uuid,
  deposit_intent_id uuid,
  fixture_id text,
  outcome text,
  reason_code text,
  assessed_at timestamptz,
  review_decision text,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if p_actor_auth_user_id is null or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'The Owner dry-run fixture assessment list request is invalid.';
  end if;

  perform 1 from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;
  if not found then raise exception 'An active Owner is required.'; end if;

  return query
  select assessment.id, assessment.deposit_intent_id, assessment.fixture_id,
         assessment.outcome, assessment.reason_code, assessment.assessed_at,
         review.decision, review.reviewed_at
    from app.deposit_dry_run_fixture_assessments assessment
    left join app.deposit_dry_run_fixture_reviews review
      on review.assessment_id = assessment.id
   order by assessment.assessed_at desc, assessment.id
   limit p_limit;
end;
$$;

alter table app.deposit_dry_run_fixture_assessments enable row level security;
alter table app.deposit_dry_run_fixture_assessments force row level security;
alter table app.deposit_dry_run_fixture_reviews enable row level security;
alter table app.deposit_dry_run_fixture_reviews force row level security;

revoke all privileges on table app.deposit_dry_run_fixture_assessments,
  app.deposit_dry_run_fixture_reviews
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime;

revoke all on function app.reject_deposit_dry_run_fixture_record_mutation()
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime;

revoke all on function app.record_owner_dry_run_fixture_assessment(uuid,uuid,text,text,text),
  app.review_owner_dry_run_fixture_assessment(uuid,uuid,text),
  app.list_owner_dry_run_fixture_assessments(uuid,integer)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime,
       payreplayy_owner_control_runtime;

grant execute on function app.record_owner_dry_run_fixture_assessment(uuid,uuid,text,text,text),
  app.review_owner_dry_run_fixture_assessment(uuid,uuid,text),
  app.list_owner_dry_run_fixture_assessments(uuid,integer)
  to payreplayy_owner_control;

comment on table app.deposit_dry_run_fixture_assessments is
  'Append-only advisory results from redacted local CBE Birr fixtures. Never authoritative provider evidence.';
comment on table app.deposit_dry_run_fixture_reviews is
  'Append-only Owner acknowledgements of advisory fixture results. Never a payment approval.';
comment on function app.record_owner_dry_run_fixture_assessment(uuid,uuid,text,text,text) is
  'Records one redacted fixture result for an existing dry-run intake. Never provider evidence.';
comment on function app.review_owner_dry_run_fixture_assessment(uuid,uuid,text) is
  'Records a final Owner acknowledgement of an advisory fixture result. Never payment approval.';
comment on function app.list_owner_dry_run_fixture_assessments(uuid,integer) is
  'Lists display-safe advisory fixture results for an authenticated active Owner.';

commit;
