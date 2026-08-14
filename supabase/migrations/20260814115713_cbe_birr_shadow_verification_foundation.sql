-- Stage 1A: durable, advisory-only CBE Birr shadow verification foundation.
--
-- This migration deliberately does not enable payment verification, mutate a deposit status,
-- create authoritative provider evidence or verification attempts, claim a payment, enqueue an
-- existing deposit job, or create any KemerBet action. Raw references and provider payloads remain
-- outside these ledgers. The worker receives only existing encrypted lookup material while it holds
-- a short database lease and can persist only allowlisted advisory outcomes.

begin;

create role fetanagent_cbe_birr_shadow_worker
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

create function app.is_valid_cbe_birr_shadow_outcome(
  p_outcome text,
  p_reason_code text
)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select
    (p_outcome = 'would_verify' and p_reason_code = 'shadow_checks_passed')
    or (p_outcome = 'would_reject' and p_reason_code in (
      'authoritative_receipt_not_found',
      'receiver_mismatch',
      'provider_status_failed',
      'provider_reference_reused'
    ))
    or (p_outcome = 'would_review' and p_reason_code in (
      'authoritative_receipt_unavailable',
      'amount_mismatch',
      'payment_stale',
      'payment_timestamp_future',
      'payment_fields_missing',
      'receipt_parse_uncertain',
      'provider_network_uncertain',
      'provider_status_pending',
      'payment_type_mismatch',
      'verification_review_required',
      'duplicate_check_unavailable'
    ));
$$;

create table app.cbe_birr_shadow_verification_jobs (
  id uuid primary key default gen_random_uuid(),
  deposit_intent_id uuid not null references app.deposit_intents (id) on delete restrict,
  deposit_submission_id uuid not null,
  verifier_version text not null default 'cbe-birr-shadow-v1'
    check (verifier_version = 'cbe-birr-shadow-v1'),
  status text not null default 'queued'
    check (status in ('queued', 'leased', 'retry_wait', 'completed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts = 5),
  run_after timestamptz not null default clock_timestamp(),
  lease_token uuid,
  leased_by uuid,
  lease_expires_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code in (
    'lease_expired',
    'authoritative_receipt_unavailable',
    'receipt_parse_uncertain',
    'provider_network_uncertain'
  )),
  last_retry_lease_token uuid,
  last_retry_attempt_number integer,
  last_retry_error_code text check (last_retry_error_code is null or last_retry_error_code in (
    'lease_expired',
    'authoritative_receipt_unavailable',
    'receipt_parse_uncertain',
    'provider_network_uncertain'
  )),
  last_retry_delay_seconds integer check (
    last_retry_delay_seconds is null or last_retry_delay_seconds between 0 and 3600
  ),
  last_retry_run_after timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint cbe_birr_shadow_jobs_submission_intent_fkey
    foreign key (deposit_submission_id, deposit_intent_id)
    references app.deposit_submissions (id, deposit_intent_id) on delete restrict,
  constraint cbe_birr_shadow_jobs_id_intent_submission_key
    unique (id, deposit_intent_id, deposit_submission_id),
  constraint cbe_birr_shadow_jobs_submission_verifier_key
    unique (deposit_submission_id, verifier_version),
  constraint cbe_birr_shadow_jobs_lease_shape check (
    (status = 'leased'
      and lease_token is not null
      and leased_by is not null
      and lease_expires_at is not null)
    or (status <> 'leased'
      and lease_token is null
      and leased_by is null
      and lease_expires_at is null)
  ),
  constraint cbe_birr_shadow_jobs_retry_shape check (
    (last_retry_lease_token is null
      and last_retry_attempt_number is null
      and last_retry_error_code is null
      and last_retry_delay_seconds is null
      and last_retry_run_after is null)
    or (last_retry_lease_token is not null
      and last_retry_attempt_number between 1 and max_attempts
      and last_retry_error_code is not null
      and last_retry_delay_seconds is not null
      and last_retry_run_after is not null)
  ),
  constraint cbe_birr_shadow_jobs_current_error_shape check (
    (status = 'retry_wait' and last_error_code is not null)
    or (status <> 'retry_wait' and last_error_code is null)
  ),
  constraint cbe_birr_shadow_jobs_completion_shape check (
    (status = 'completed') = (completed_at is not null)
  )
);

create index cbe_birr_shadow_jobs_claimable_idx
  on app.cbe_birr_shadow_verification_jobs (run_after, created_at, id)
  where status in ('queued', 'retry_wait');

create index cbe_birr_shadow_jobs_lease_expiry_idx
  on app.cbe_birr_shadow_verification_jobs (lease_expires_at, id)
  where status = 'leased';

create index cbe_birr_shadow_jobs_intent_created_idx
  on app.cbe_birr_shadow_verification_jobs (deposit_intent_id, created_at desc);

create function app.enforce_cbe_birr_shadow_job_initial_state()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.status <> 'queued'
    or new.attempt_count <> 0
    or new.max_attempts <> 5
    or new.lease_token is not null
    or new.leased_by is not null
    or new.lease_expires_at is not null
    or new.last_error_code is not null
    or new.last_retry_lease_token is not null
    or new.last_retry_attempt_number is not null
    or new.last_retry_error_code is not null
    or new.last_retry_delay_seconds is not null
    or new.last_retry_run_after is not null
    or new.completed_at is not null then
    raise exception 'A CBE Birr shadow job must begin queued without lease or result state.';
  end if;

  return new;
end;
$$;

create trigger cbe_birr_shadow_jobs_enforce_initial_state
before insert on app.cbe_birr_shadow_verification_jobs
for each row execute function app.enforce_cbe_birr_shadow_job_initial_state();

create function app.enforce_cbe_birr_shadow_job_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.deposit_intent_id is distinct from old.deposit_intent_id
    or new.deposit_submission_id is distinct from old.deposit_submission_id
    or new.verifier_version is distinct from old.verifier_version
    or new.max_attempts is distinct from old.max_attempts
    or new.created_at is distinct from old.created_at then
    raise exception 'CBE Birr shadow job identity is immutable.';
  end if;

  if old.status = 'completed' then
    raise exception 'A completed CBE Birr shadow job cannot change.';
  end if;

  if new.status = old.status then
    raise exception 'CBE Birr shadow job state may change only through an explicit transition.';
  end if;

  if not (
    (old.status in ('queued', 'retry_wait') and new.status = 'leased')
    or (old.status = 'leased' and new.status in ('retry_wait', 'completed'))
  ) then
    raise exception 'Invalid CBE Birr shadow job transition from % to %.', old.status, new.status;
  end if;

  if new.status = 'leased' then
    if old.attempt_count >= old.max_attempts
      or new.attempt_count <> old.attempt_count + 1 then
      raise exception 'A CBE Birr shadow lease must increment a bounded attempt exactly once.';
    end if;

    if new.run_after is distinct from old.run_after
      or new.last_retry_lease_token is distinct from old.last_retry_lease_token
      or new.last_retry_attempt_number is distinct from old.last_retry_attempt_number
      or new.last_retry_error_code is distinct from old.last_retry_error_code
      or new.last_retry_delay_seconds is distinct from old.last_retry_delay_seconds
      or new.last_retry_run_after is distinct from old.last_retry_run_after then
      raise exception 'Leasing cannot rewrite CBE Birr shadow retry history.';
    end if;
  elsif new.attempt_count <> old.attempt_count then
    raise exception 'Only leasing may increment a CBE Birr shadow attempt.';
  end if;

  if new.status = 'retry_wait' then
    if new.last_retry_lease_token is distinct from old.lease_token
      or new.last_retry_attempt_number is distinct from old.attempt_count
      or new.last_retry_error_code is distinct from new.last_error_code
      or new.last_retry_run_after is distinct from new.run_after then
      raise exception 'A CBE Birr shadow retry must retain its exact settled lease receipt.';
    end if;
  elsif new.status = 'completed' then
    if new.run_after is distinct from old.run_after
      or new.last_retry_lease_token is distinct from old.last_retry_lease_token
      or new.last_retry_attempt_number is distinct from old.last_retry_attempt_number
      or new.last_retry_error_code is distinct from old.last_retry_error_code
      or new.last_retry_delay_seconds is distinct from old.last_retry_delay_seconds
      or new.last_retry_run_after is distinct from old.last_retry_run_after then
      raise exception 'Completion cannot rewrite CBE Birr shadow retry history.';
    end if;

    new.completed_at := clock_timestamp();
  end if;

  return new;
end;
$$;

create trigger cbe_birr_shadow_jobs_enforce_transition
before update on app.cbe_birr_shadow_verification_jobs
for each row execute function app.enforce_cbe_birr_shadow_job_transition();

create trigger cbe_birr_shadow_jobs_set_updated_at
before update on app.cbe_birr_shadow_verification_jobs
for each row execute function app.set_updated_at();

create table app.cbe_birr_shadow_verification_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  deposit_intent_id uuid not null,
  deposit_submission_id uuid not null,
  lease_token uuid not null,
  attempt_number integer not null check (attempt_number between 1 and 5),
  reported_outcome text not null,
  reported_reason_code text not null,
  outcome text not null,
  reason_code text not null,
  canonical_reference_fingerprint text check (
    canonical_reference_fingerprint is null
    or canonical_reference_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  worker_decision_digest text check (
    worker_decision_digest is null or worker_decision_digest ~ '^[0-9a-f]{64}$'
  ),
  adapter_version text not null check (
    adapter_version = btrim(adapter_version)
    and char_length(adapter_version) between 1 and 96
    and adapter_version ~ '^[a-z0-9][a-z0-9._-]*$'
  ),
  normalization_version text not null check (
    normalization_version = btrim(normalization_version)
    and char_length(normalization_version) between 1 and 96
    and normalization_version ~ '^[a-z0-9][a-z0-9._-]*$'
  ),
  completed_at timestamptz not null default clock_timestamp(),
  constraint cbe_birr_shadow_results_job_key unique (job_id),
  constraint cbe_birr_shadow_results_job_scope_fkey
    foreign key (job_id, deposit_intent_id, deposit_submission_id)
    references app.cbe_birr_shadow_verification_jobs (
      id, deposit_intent_id, deposit_submission_id
    ) on delete restrict,
  constraint cbe_birr_shadow_results_reported_pair check (
    app.is_valid_cbe_birr_shadow_outcome(reported_outcome, reported_reason_code) is true
  ),
  constraint cbe_birr_shadow_results_effective_pair check (
    app.is_valid_cbe_birr_shadow_outcome(outcome, reason_code) is true
  ),
  constraint cbe_birr_shadow_results_duplicate_override_shape check (
    (reported_outcome = outcome and reported_reason_code = reason_code)
    or (reported_outcome = 'would_verify'
      and reported_reason_code = 'shadow_checks_passed'
      and outcome = 'would_reject'
      and reason_code = 'provider_reference_reused')
  ),
  constraint cbe_birr_shadow_results_verifiable_material_shape check (
    (reported_outcome <> 'would_verify')
    or (canonical_reference_fingerprint is not null and worker_decision_digest is not null)
  ),
  constraint cbe_birr_shadow_results_duplicate_reference_shape check (
    reason_code <> 'provider_reference_reused'
    or canonical_reference_fingerprint is not null
  )
);

create unique index cbe_birr_shadow_results_verified_reference_idx
  on app.cbe_birr_shadow_verification_results (canonical_reference_fingerprint)
  where outcome = 'would_verify';

create index cbe_birr_shadow_results_intent_completed_idx
  on app.cbe_birr_shadow_verification_results (deposit_intent_id, completed_at desc);

create function app.reject_cbe_birr_shadow_result_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'CBE Birr shadow verification results are append-only.';
end;
$$;

create trigger cbe_birr_shadow_results_immutable
before update or delete on app.cbe_birr_shadow_verification_results
for each row execute function app.reject_cbe_birr_shadow_result_mutation();

create trigger cbe_birr_shadow_results_no_truncate
before truncate on app.cbe_birr_shadow_verification_results
for each statement execute function app.reject_cbe_birr_shadow_result_mutation();

create function app.reject_cbe_birr_shadow_job_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'CBE Birr shadow verification jobs must be retained.';
end;
$$;

create trigger cbe_birr_shadow_jobs_no_delete
before delete on app.cbe_birr_shadow_verification_jobs
for each row execute function app.reject_cbe_birr_shadow_job_delete();

create trigger cbe_birr_shadow_jobs_no_truncate
before truncate on app.cbe_birr_shadow_verification_jobs
for each statement execute function app.reject_cbe_birr_shadow_job_delete();

create function app.enqueue_cbe_birr_shadow_verification(
  p_actor_auth_user_id uuid,
  p_deposit_intent_id uuid,
  p_deposit_submission_id uuid
)
returns table (
  job_id uuid,
  job_status text,
  already_enqueued boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_admin_id uuid;
  inserted_job_id uuid;
  resolved_job_status text;
begin
  if p_actor_auth_user_id is null
    or p_deposit_intent_id is null
    or p_deposit_submission_id is null then
    raise exception 'The CBE Birr shadow enqueue request is invalid.';
  end if;

  perform app.require_financial_features_disabled_for_dry_run();

  select admin_user.id
    into resolved_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;

  if resolved_admin_id is null then
    raise exception 'An active Owner is required.';
  end if;

  perform 1
    from app.deposit_intents deposit_intent
    join app.deposit_submissions submission
      on submission.id = p_deposit_submission_id
     and submission.deposit_intent_id = deposit_intent.id
    join app.payment_providers payment_provider
      on payment_provider.id = deposit_intent.payment_provider_id
    join app.receiver_accounts receiver_account
      on receiver_account.id = deposit_intent.receiver_account_id
     and receiver_account.provider_id = deposit_intent.payment_provider_id
     and receiver_account.version = deposit_intent.receiver_account_version
   where deposit_intent.id = p_deposit_intent_id
     and deposit_intent.status = 'intake_received'
     and deposit_intent.origin_inbound_event_id is not null
     and submission.status = 'received'
     and submission.origin_inbound_event_id is not null
     and submission.submitted_reference_ciphertext is not null
     and submission.submitted_reference_fingerprint is not null
     and submission.submitted_reference_masked is not null
     and submission.reference_encryption_key_version is not null
     and payment_provider.code = 'cbe_birr'
     and receiver_account.verification_reference_ciphertext is not null
     and btrim(receiver_account.verification_reference_ciphertext) <> ''
     and exists (
       select 1
         from app.inbound_event_consumptions consumption
        where consumption.origin_inbound_event_id = deposit_intent.origin_inbound_event_id
          and consumption.consumer_kind = 'open_dry_run_deposit_intent'
          and consumption.outcome = 'completed'
          and consumption.outcome_reason_code = 'dry_run_deposit_intent_opened'
     )
     and exists (
       select 1
         from app.inbound_event_consumptions consumption
        where consumption.origin_inbound_event_id = submission.origin_inbound_event_id
          and consumption.consumer_kind = 'capture_dry_run_deposit_reference'
          and consumption.outcome = 'completed'
          and consumption.outcome_reason_code = 'dry_run_deposit_reference_received'
     )
   for share of deposit_intent, submission, payment_provider, receiver_account;

  if not found then
    raise exception 'The exact CBE Birr dry-run submission is not shadow eligible.';
  end if;

  insert into app.cbe_birr_shadow_verification_jobs as shadow_job (
    deposit_intent_id,
    deposit_submission_id
  ) values (
    p_deposit_intent_id,
    p_deposit_submission_id
  )
  on conflict (deposit_submission_id, verifier_version) do nothing
  returning shadow_job.id, shadow_job.status
    into inserted_job_id, resolved_job_status;

  if inserted_job_id is null then
    select shadow_job.id, shadow_job.status
      into inserted_job_id, resolved_job_status
      from app.cbe_birr_shadow_verification_jobs shadow_job
     where shadow_job.deposit_submission_id = p_deposit_submission_id
       and shadow_job.verifier_version = 'cbe-birr-shadow-v1';

    return query select inserted_job_id, resolved_job_status, true;
    return;
  end if;

  insert into app.audit_events (
    actor_kind,
    actor_admin_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'admin',
    resolved_admin_id,
    'deposit.cbe_birr_shadow_enqueued',
    'cbe_birr_shadow_verification_job',
    inserted_job_id,
    jsonb_build_object(
      'deposit_intent_id', p_deposit_intent_id,
      'deposit_submission_id', p_deposit_submission_id
    )
  );

  return query select inserted_job_id, resolved_job_status, false;
end;
$$;

create function app.reclaim_expired_cbe_birr_shadow_verification_jobs()
returns void
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  expired_job app.cbe_birr_shadow_verification_jobs%rowtype;
  inserted_result_id uuid;
  resolved_run_after timestamptz;
begin
  perform app.require_financial_features_disabled_for_dry_run();

  for expired_job in
    select shadow_job.*
      from app.cbe_birr_shadow_verification_jobs shadow_job
     where shadow_job.status = 'leased'
       and shadow_job.lease_expires_at <= clock_timestamp()
     order by shadow_job.lease_expires_at, shadow_job.id
     for update skip locked
     limit 32
  loop
    if expired_job.attempt_count >= expired_job.max_attempts then
      insert into app.cbe_birr_shadow_verification_results (
        job_id,
        deposit_intent_id,
        deposit_submission_id,
        lease_token,
        attempt_number,
        reported_outcome,
        reported_reason_code,
        outcome,
        reason_code,
        adapter_version,
        normalization_version
      ) values (
        expired_job.id,
        expired_job.deposit_intent_id,
        expired_job.deposit_submission_id,
        expired_job.lease_token,
        expired_job.attempt_count,
        'would_review',
        'verification_review_required',
        'would_review',
        'verification_review_required',
        expired_job.verifier_version,
        'database-lease-expiry-v1'
      )
      returning id into inserted_result_id;

      update app.cbe_birr_shadow_verification_jobs shadow_job
         set status = 'completed',
             lease_token = null,
             leased_by = null,
             lease_expires_at = null,
             last_error_code = null
       where shadow_job.id = expired_job.id;

      insert into app.audit_events (
        actor_kind, action, resource_type, resource_id, metadata
      ) values (
        'system',
        'deposit.cbe_birr_shadow_completed',
        'cbe_birr_shadow_verification_result',
        inserted_result_id,
        jsonb_build_object(
          'job_id', expired_job.id,
          'deposit_intent_id', expired_job.deposit_intent_id,
          'deposit_submission_id', expired_job.deposit_submission_id,
          'attempt_number', expired_job.attempt_count,
          'outcome', 'would_review',
          'reason_code', 'verification_review_required'
        )
      );
    else
      resolved_run_after := clock_timestamp();

      update app.cbe_birr_shadow_verification_jobs shadow_job
         set status = 'retry_wait',
             run_after = resolved_run_after,
             lease_token = null,
             leased_by = null,
             lease_expires_at = null,
             last_error_code = 'lease_expired',
             last_retry_lease_token = expired_job.lease_token,
             last_retry_attempt_number = expired_job.attempt_count,
             last_retry_error_code = 'lease_expired',
             last_retry_delay_seconds = 0,
             last_retry_run_after = resolved_run_after
       where shadow_job.id = expired_job.id;
    end if;
  end loop;
end;
$$;

create function app.lease_cbe_birr_shadow_verification_job(
  p_worker_instance_id uuid,
  p_lease_seconds integer default 120
)
returns table (
  job_id uuid,
  deposit_intent_id uuid,
  deposit_submission_id uuid,
  attempt_number integer,
  lease_token uuid,
  lease_expires_at timestamptz,
  submitted_reference_ciphertext text,
  submitted_reference_key_version smallint,
  receiver_verification_reference_ciphertext text,
  receiver_account_id uuid,
  receiver_account_version integer,
  expected_amount_minor bigint,
  currency_code text,
  opened_at timestamptz,
  payment_deadline_at timestamptz,
  verifier_version text
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_job app.cbe_birr_shadow_verification_jobs%rowtype;
  resolved_lease_token uuid;
begin
  if p_worker_instance_id is null
    or p_lease_seconds is null
    or p_lease_seconds not between 1 and 300 then
    raise exception 'The CBE Birr shadow lease request is invalid.';
  end if;

  perform app.require_financial_features_disabled_for_dry_run();
  perform app.reclaim_expired_cbe_birr_shadow_verification_jobs();

  select shadow_job.*
    into resolved_job
    from app.cbe_birr_shadow_verification_jobs shadow_job
    join app.deposit_intents deposit_intent
      on deposit_intent.id = shadow_job.deposit_intent_id
    join app.deposit_submissions submission
      on submission.id = shadow_job.deposit_submission_id
     and submission.deposit_intent_id = shadow_job.deposit_intent_id
    join app.payment_providers payment_provider
      on payment_provider.id = deposit_intent.payment_provider_id
    join app.receiver_accounts receiver_account
      on receiver_account.id = deposit_intent.receiver_account_id
     and receiver_account.provider_id = deposit_intent.payment_provider_id
     and receiver_account.version = deposit_intent.receiver_account_version
   where shadow_job.status in ('queued', 'retry_wait')
     and shadow_job.run_after <= clock_timestamp()
     and shadow_job.attempt_count < shadow_job.max_attempts
     and deposit_intent.status = 'intake_received'
     and submission.status = 'received'
     and payment_provider.code = 'cbe_birr'
     and receiver_account.verification_reference_ciphertext is not null
   order by shadow_job.run_after, shadow_job.created_at, shadow_job.id
   for update of shadow_job skip locked
   limit 1;

  if not found then
    return;
  end if;

  resolved_lease_token := gen_random_uuid();

  update app.cbe_birr_shadow_verification_jobs shadow_job
     set status = 'leased',
         attempt_count = shadow_job.attempt_count + 1,
         lease_token = resolved_lease_token,
         leased_by = p_worker_instance_id,
         lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
         last_error_code = null
   where shadow_job.id = resolved_job.id
   returning shadow_job.* into resolved_job;

  return query
  select resolved_job.id,
         resolved_job.deposit_intent_id,
         resolved_job.deposit_submission_id,
         resolved_job.attempt_count,
         resolved_job.lease_token,
         resolved_job.lease_expires_at,
         submission.submitted_reference_ciphertext,
         submission.reference_encryption_key_version,
         receiver_account.verification_reference_ciphertext,
         deposit_intent.receiver_account_id,
         deposit_intent.receiver_account_version,
         deposit_intent.expected_amount_minor,
         deposit_intent.currency_code::text,
         deposit_intent.opened_at,
         deposit_intent.payment_deadline_at,
         resolved_job.verifier_version
    from app.deposit_intents deposit_intent
    join app.deposit_submissions submission
      on submission.id = resolved_job.deposit_submission_id
     and submission.deposit_intent_id = deposit_intent.id
    join app.receiver_accounts receiver_account
      on receiver_account.id = deposit_intent.receiver_account_id
     and receiver_account.provider_id = deposit_intent.payment_provider_id
     and receiver_account.version = deposit_intent.receiver_account_version
   where deposit_intent.id = resolved_job.deposit_intent_id;
end;
$$;

create function app.complete_cbe_birr_shadow_verification_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_attempt_number integer,
  p_outcome text,
  p_reason_code text,
  p_canonical_reference_fingerprint text,
  p_worker_decision_digest text,
  p_adapter_version text,
  p_normalization_version text
)
returns table (
  job_id uuid,
  result_id uuid,
  outcome text,
  reason_code text,
  already_recorded boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_job app.cbe_birr_shadow_verification_jobs%rowtype;
  existing_result app.cbe_birr_shadow_verification_results%rowtype;
  inserted_result_id uuid;
  effective_outcome text;
  effective_reason_code text;
begin
  if p_job_id is null
    or p_lease_token is null
    or p_attempt_number is null
    or p_outcome is null
    or p_reason_code is null
    or p_adapter_version is null
    or p_normalization_version is null
    or app.is_valid_cbe_birr_shadow_outcome(p_outcome, p_reason_code) is not true then
    raise exception 'The CBE Birr shadow completion request is invalid.';
  end if;

  if p_adapter_version <> btrim(p_adapter_version)
    or char_length(p_adapter_version) not between 1 and 96
    or p_adapter_version !~ '^[a-z0-9][a-z0-9._-]*$'
    or p_normalization_version <> btrim(p_normalization_version)
    or char_length(p_normalization_version) not between 1 and 96
    or p_normalization_version !~ '^[a-z0-9][a-z0-9._-]*$' then
    raise exception 'The CBE Birr shadow version identifiers are invalid.';
  end if;

  if p_canonical_reference_fingerprint is not null
    and p_canonical_reference_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'The CBE Birr shadow canonical-reference fingerprint is invalid.';
  end if;

  if p_worker_decision_digest is not null
    and p_worker_decision_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'The CBE Birr shadow decision digest is invalid.';
  end if;

  if p_outcome = 'would_verify'
    and (p_canonical_reference_fingerprint is null or p_worker_decision_digest is null) then
    raise exception 'A would-verify shadow result requires fingerprinted decision material.';
  end if;

  if p_reason_code = 'provider_reference_reused'
    and p_canonical_reference_fingerprint is null then
    raise exception 'A reused-reference shadow result requires a canonical-reference fingerprint.';
  end if;

  perform app.require_financial_features_disabled_for_dry_run();

  select shadow_result.*
    into existing_result
    from app.cbe_birr_shadow_verification_results shadow_result
   where shadow_result.job_id = p_job_id;

  if found then
    if existing_result.lease_token is distinct from p_lease_token
      or existing_result.attempt_number is distinct from p_attempt_number
      or existing_result.reported_outcome is distinct from p_outcome
      or existing_result.reported_reason_code is distinct from p_reason_code
      or existing_result.canonical_reference_fingerprint
        is distinct from p_canonical_reference_fingerprint
      or existing_result.worker_decision_digest is distinct from p_worker_decision_digest
      or existing_result.adapter_version is distinct from p_adapter_version
      or existing_result.normalization_version is distinct from p_normalization_version then
      raise exception 'The replayed CBE Birr shadow completion does not match its result.';
    end if;

    return query
    select existing_result.job_id,
           existing_result.id,
           existing_result.outcome,
           existing_result.reason_code,
           true;
    return;
  end if;

  select shadow_job.*
    into resolved_job
    from app.cbe_birr_shadow_verification_jobs shadow_job
   where shadow_job.id = p_job_id
   for update;

  if not found
    or resolved_job.status <> 'leased'
    or resolved_job.lease_token is distinct from p_lease_token
    or resolved_job.attempt_count is distinct from p_attempt_number then
    raise exception 'The CBE Birr shadow job is not leased by this exact attempt.';
  end if;

  if resolved_job.lease_expires_at <= clock_timestamp() then
    raise exception 'The CBE Birr shadow lease has expired.';
  end if;

  effective_outcome := p_outcome;
  effective_reason_code := p_reason_code;

  if p_canonical_reference_fingerprint is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_canonical_reference_fingerprint, 20260814)
    );
  end if;

  if p_outcome = 'would_verify'
    and (
      exists (
        select 1
          from app.cbe_birr_shadow_verification_results shadow_result
         where shadow_result.canonical_reference_fingerprint = p_canonical_reference_fingerprint
           and shadow_result.outcome = 'would_verify'
           and shadow_result.job_id <> p_job_id
      )
      or exists (
        select 1
          from app.provider_payment_evidence provider_evidence
         where provider_evidence.canonical_reference_fingerprint =
           p_canonical_reference_fingerprint
      )
    ) then
    effective_outcome := 'would_reject';
    effective_reason_code := 'provider_reference_reused';
  end if;

  insert into app.cbe_birr_shadow_verification_results (
    job_id,
    deposit_intent_id,
    deposit_submission_id,
    lease_token,
    attempt_number,
    reported_outcome,
    reported_reason_code,
    outcome,
    reason_code,
    canonical_reference_fingerprint,
    worker_decision_digest,
    adapter_version,
    normalization_version
  ) values (
    resolved_job.id,
    resolved_job.deposit_intent_id,
    resolved_job.deposit_submission_id,
    p_lease_token,
    p_attempt_number,
    p_outcome,
    p_reason_code,
    effective_outcome,
    effective_reason_code,
    p_canonical_reference_fingerprint,
    p_worker_decision_digest,
    p_adapter_version,
    p_normalization_version
  )
  returning id into inserted_result_id;

  update app.cbe_birr_shadow_verification_jobs shadow_job
     set status = 'completed',
         lease_token = null,
         leased_by = null,
         lease_expires_at = null,
         last_error_code = null
   where shadow_job.id = resolved_job.id;

  insert into app.audit_events (
    actor_kind, action, resource_type, resource_id, metadata
  ) values (
    'worker',
    'deposit.cbe_birr_shadow_completed',
    'cbe_birr_shadow_verification_result',
    inserted_result_id,
    jsonb_build_object(
      'job_id', resolved_job.id,
      'deposit_intent_id', resolved_job.deposit_intent_id,
      'deposit_submission_id', resolved_job.deposit_submission_id,
      'attempt_number', p_attempt_number,
      'outcome', effective_outcome,
      'reason_code', effective_reason_code
    )
  );

  return query
  select resolved_job.id,
         inserted_result_id,
         effective_outcome,
         effective_reason_code,
         false;
end;
$$;

create function app.retry_cbe_birr_shadow_verification_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_attempt_number integer,
  p_error_code text,
  p_retry_after_seconds integer
)
returns table (
  job_id uuid,
  job_status text,
  attempt_number integer,
  run_after timestamptz,
  outcome text,
  reason_code text,
  already_recorded boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_job app.cbe_birr_shadow_verification_jobs%rowtype;
  existing_result app.cbe_birr_shadow_verification_results%rowtype;
  inserted_result_id uuid;
  resolved_run_after timestamptz;
begin
  if p_job_id is null
    or p_lease_token is null
    or p_attempt_number is null
    or p_error_code not in (
      'authoritative_receipt_unavailable',
      'receipt_parse_uncertain',
      'provider_network_uncertain'
    )
    or p_retry_after_seconds is null
    or p_retry_after_seconds not between 1 and 3600 then
    raise exception 'The CBE Birr shadow retry request is invalid.';
  end if;

  perform app.require_financial_features_disabled_for_dry_run();

  select shadow_result.*
    into existing_result
    from app.cbe_birr_shadow_verification_results shadow_result
   where shadow_result.job_id = p_job_id;

  if found then
    if existing_result.lease_token is distinct from p_lease_token
      or existing_result.attempt_number is distinct from p_attempt_number
      or existing_result.reported_outcome <> 'would_review'
      or existing_result.reported_reason_code is distinct from p_error_code then
      raise exception 'The replayed CBE Birr shadow retry does not match its terminal result.';
    end if;

    return query
    select existing_result.job_id,
           'completed'::text,
           existing_result.attempt_number,
           null::timestamptz,
           existing_result.outcome,
           existing_result.reason_code,
           true;
    return;
  end if;

  select shadow_job.*
    into resolved_job
    from app.cbe_birr_shadow_verification_jobs shadow_job
   where shadow_job.id = p_job_id
   for update;

  if not found then
    raise exception 'The CBE Birr shadow job is unavailable.';
  end if;

  if resolved_job.last_retry_lease_token is not distinct from p_lease_token
    and resolved_job.last_retry_attempt_number is not distinct from p_attempt_number
    and resolved_job.last_retry_error_code is not distinct from p_error_code
    and resolved_job.last_retry_delay_seconds is not distinct from p_retry_after_seconds then
    return query
    select resolved_job.id,
           resolved_job.status,
           p_attempt_number,
           resolved_job.last_retry_run_after,
           null::text,
           null::text,
           true;
    return;
  end if;

  if resolved_job.status <> 'leased'
    or resolved_job.lease_token is distinct from p_lease_token
    or resolved_job.attempt_count is distinct from p_attempt_number then
    raise exception 'The CBE Birr shadow job is not leased by this exact attempt.';
  end if;

  if resolved_job.lease_expires_at <= clock_timestamp() then
    raise exception 'The CBE Birr shadow lease has expired.';
  end if;

  if resolved_job.attempt_count >= resolved_job.max_attempts then
    insert into app.cbe_birr_shadow_verification_results (
      job_id,
      deposit_intent_id,
      deposit_submission_id,
      lease_token,
      attempt_number,
      reported_outcome,
      reported_reason_code,
      outcome,
      reason_code,
      adapter_version,
      normalization_version
    ) values (
      resolved_job.id,
      resolved_job.deposit_intent_id,
      resolved_job.deposit_submission_id,
      p_lease_token,
      p_attempt_number,
      'would_review',
      p_error_code,
      'would_review',
      p_error_code,
      resolved_job.verifier_version,
      'retry-exhaustion-v1'
    )
    returning id into inserted_result_id;

    update app.cbe_birr_shadow_verification_jobs shadow_job
       set status = 'completed',
           lease_token = null,
           leased_by = null,
           lease_expires_at = null,
           last_error_code = null
     where shadow_job.id = resolved_job.id;

    insert into app.audit_events (
      actor_kind, action, resource_type, resource_id, metadata
    ) values (
      'worker',
      'deposit.cbe_birr_shadow_completed',
      'cbe_birr_shadow_verification_result',
      inserted_result_id,
      jsonb_build_object(
        'job_id', resolved_job.id,
        'deposit_intent_id', resolved_job.deposit_intent_id,
        'deposit_submission_id', resolved_job.deposit_submission_id,
        'attempt_number', p_attempt_number,
        'outcome', 'would_review',
        'reason_code', p_error_code
      )
    );

    return query
    select resolved_job.id,
           'completed'::text,
           p_attempt_number,
           null::timestamptz,
           'would_review'::text,
           p_error_code,
           false;
    return;
  end if;

  resolved_run_after := clock_timestamp() + make_interval(secs => p_retry_after_seconds);

  update app.cbe_birr_shadow_verification_jobs shadow_job
     set status = 'retry_wait',
         run_after = resolved_run_after,
         lease_token = null,
         leased_by = null,
         lease_expires_at = null,
         last_error_code = p_error_code,
         last_retry_lease_token = p_lease_token,
         last_retry_attempt_number = p_attempt_number,
         last_retry_error_code = p_error_code,
         last_retry_delay_seconds = p_retry_after_seconds,
         last_retry_run_after = resolved_run_after
   where shadow_job.id = resolved_job.id;

  insert into app.audit_events (
    actor_kind, action, resource_type, resource_id, metadata
  ) values (
    'worker',
    'deposit.cbe_birr_shadow_retry_scheduled',
    'cbe_birr_shadow_verification_job',
    resolved_job.id,
    jsonb_build_object(
      'job_id', resolved_job.id,
      'deposit_intent_id', resolved_job.deposit_intent_id,
      'deposit_submission_id', resolved_job.deposit_submission_id,
      'attempt_number', p_attempt_number,
      'reason_code', p_error_code,
      'retry_after_seconds', p_retry_after_seconds
    )
  );

  return query
  select resolved_job.id,
         'retry_wait'::text,
         p_attempt_number,
         resolved_run_after,
         null::text,
         null::text,
         false;
end;
$$;

create function app.list_owner_cbe_birr_shadow_verifications(
  p_actor_auth_user_id uuid,
  p_limit integer default 50
)
returns table (
  job_id uuid,
  deposit_intent_id uuid,
  deposit_submission_id uuid,
  job_status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  lease_expires_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz,
  outcome text,
  reason_code text,
  result_completed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if p_actor_auth_user_id is null
    or p_limit is null
    or p_limit not between 1 and 50 then
    raise exception 'The Owner CBE Birr shadow list request is invalid.';
  end if;

  perform app.require_financial_features_disabled_for_dry_run();

  perform 1
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;

  if not found then
    raise exception 'An active Owner is required.';
  end if;

  return query
  select shadow_job.id,
         shadow_job.deposit_intent_id,
         shadow_job.deposit_submission_id,
         shadow_job.status,
         shadow_job.attempt_count,
         shadow_job.max_attempts,
         shadow_job.run_after,
         shadow_job.lease_expires_at,
         shadow_job.created_at,
         shadow_job.updated_at,
         shadow_job.completed_at,
         shadow_result.outcome,
         shadow_result.reason_code,
         shadow_result.completed_at
    from app.cbe_birr_shadow_verification_jobs shadow_job
    left join app.cbe_birr_shadow_verification_results shadow_result
      on shadow_result.job_id = shadow_job.id
   order by shadow_job.created_at desc, shadow_job.id
   limit p_limit;
end;
$$;

alter table app.cbe_birr_shadow_verification_jobs enable row level security;
alter table app.cbe_birr_shadow_verification_jobs force row level security;
alter table app.cbe_birr_shadow_verification_results enable row level security;
alter table app.cbe_birr_shadow_verification_results force row level security;

revoke all privileges on schema app from fetanagent_cbe_birr_shadow_worker;
revoke all privileges on all tables in schema app from fetanagent_cbe_birr_shadow_worker;
revoke all privileges on all sequences in schema app from fetanagent_cbe_birr_shadow_worker;
revoke all privileges on all functions in schema app from fetanagent_cbe_birr_shadow_worker;

revoke all privileges on table
  app.cbe_birr_shadow_verification_jobs,
  app.cbe_birr_shadow_verification_results
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker;

revoke all on function
  app.is_valid_cbe_birr_shadow_outcome(text,text),
  app.enforce_cbe_birr_shadow_job_initial_state(),
  app.enforce_cbe_birr_shadow_job_transition(),
  app.reject_cbe_birr_shadow_result_mutation(),
  app.reject_cbe_birr_shadow_job_delete(),
  app.reclaim_expired_cbe_birr_shadow_verification_jobs(),
  app.enqueue_cbe_birr_shadow_verification(uuid,uuid,uuid),
  app.lease_cbe_birr_shadow_verification_job(uuid,integer),
  app.complete_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,text,text,text,text,text),
  app.retry_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,integer),
  app.list_owner_cbe_birr_shadow_verifications(uuid,integer)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker;

grant usage on schema app to fetanagent_cbe_birr_shadow_worker;

grant execute on function
  app.lease_cbe_birr_shadow_verification_job(uuid,integer),
  app.complete_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,text,text,text,text,text),
  app.retry_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,integer)
to fetanagent_cbe_birr_shadow_worker;

grant execute on function
  app.enqueue_cbe_birr_shadow_verification(uuid,uuid,uuid),
  app.list_owner_cbe_birr_shadow_verifications(uuid,integer)
to fetanagent_owner_control;

comment on role fetanagent_cbe_birr_shadow_worker is
  'FetanAgent CBE Birr shadow-verification group. NOLOGIN; only bounded advisory lease procedures.';

comment on table app.cbe_birr_shadow_verification_jobs is
  'Private durable queue for CBE Birr advisory shadow verification; contains no provider payload or raw reference.';
comment on table app.cbe_birr_shadow_verification_results is
  'Append-only advisory CBE Birr shadow outcomes; never authoritative evidence or a payment claim.';
comment on function app.enqueue_cbe_birr_shadow_verification(uuid,uuid,uuid) is
  'Owner-only idempotent enqueue for one exact received CBE Birr dry-run submission.';
comment on function app.lease_cbe_birr_shadow_verification_job(uuid,integer) is
  'Worker-only bounded lease returning encrypted lookup material transiently; creates no financial state.';
comment on function app.complete_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,text,text,text,text,text) is
  'Worker-only exact-lease completion storing an advisory outcome and safe digests only.';
comment on function app.retry_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,integer) is
  'Worker-only exact-lease bounded retry with durable idempotency receipt.';
comment on function app.list_owner_cbe_birr_shadow_verifications(uuid,integer) is
  'Owner-only display-safe shadow status list; excludes ciphertext, fingerprints, digests, and key versions.';

commit;
