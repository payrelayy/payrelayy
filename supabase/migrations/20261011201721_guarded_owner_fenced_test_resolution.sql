-- A fenced Owner-funded test may be dispositioned without pretending that
-- missing provider history proves a transfer did not happen. This migration
-- installs a postgres-only, attested closure; it does not invoke it.
begin;
set local lock_timeout = '5s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

alter table app.deposit_execution_attempts
  drop constraint deposit_execution_attempts_status_shape_check;
alter table app.deposit_execution_attempts
  add constraint deposit_execution_attempts_status_shape_check check (
    (status = 'prepared'
      and final_action_fenced_at is null
      and reconciliation_required_at is null
      and resolved_at is null)
    or (status = 'cancelled_before_action'
      and final_action_fenced_at is null
      and reconciliation_required_at is null
      and resolved_at is not null)
    or (status = 'final_action_fenced'
      and final_action_fenced_at is not null
      and reconciliation_required_at is null
      and resolved_at is null)
    or (status = 'reconciliation_required'
      and final_action_fenced_at is not null
      and reconciliation_required_at is not null
      and resolved_at is null)
    or (status in (
        'confirmed_executed', 'review_required', 'owner_test_closed_uncredited'
      )
      and final_action_fenced_at is not null
      and reconciliation_required_at is not null
      and resolved_at is not null)
  );

create table app.owner_fenced_test_no_credit_resolutions (
  request_key uuid primary key check (
    request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  execution_attempt_id uuid not null unique
    references app.deposit_execution_attempts (id) on delete restrict,
  deposit_intent_id uuid not null unique
    references app.deposit_intents (id) on delete restrict,
  reconciliation_id uuid not null unique
    references app.execution_reconciliations (id) on delete restrict,
  actor_admin_id uuid not null
    references app.admin_users (id) on delete restrict,
  disposition_code text not null
    default 'owner_test_closed_no_credit_no_refund_provider_unconfirmed'
    check (
      disposition_code =
        'owner_test_closed_no_credit_no_refund_provider_unconfirmed'
    ),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);

create trigger owner_fenced_test_no_credit_resolutions_immutable
before update or delete on app.owner_fenced_test_no_credit_resolutions
for each row execute function app.reject_deposit_ledger_delete();
create trigger owner_fenced_test_no_credit_resolutions_no_truncate
before truncate on app.owner_fenced_test_no_credit_resolutions
for each statement execute function app.reject_execution_ledger_truncate();

-- The ordinary attempt trigger remains in force for every other transition.
-- The special transition requires an immutable receipt inserted in the same
-- transaction by the protected closure function.
create function app.guard_owner_fenced_test_attempt_close()
returns trigger language plpgsql
set search_path = pg_catalog, app
as $$
begin
  if session_user <> 'postgres'
    or old.status <> 'review_required'
    or new.status <> 'owner_test_closed_uncredited'
    or new.id is distinct from old.id
    or new.deposit_intent_id is distinct from old.deposit_intent_id
    or new.deposit_job_id is distinct from old.deposit_job_id
    or new.platform_agent_account_id is distinct from old.platform_agent_account_id
    or new.attempt_number is distinct from old.attempt_number
    or new.created_at is distinct from old.created_at
    or new.final_action_fenced_at is distinct from old.final_action_fenced_at
    or new.reconciliation_required_at is distinct from old.reconciliation_required_at
    or new.resolved_at is distinct from old.resolved_at
    or new.exact_player_credit_match is distinct from old.exact_player_credit_match
    or not exists (
      select 1 from app.owner_fenced_test_no_credit_resolutions receipt
       where receipt.execution_attempt_id = old.id
         and receipt.deposit_intent_id = old.deposit_intent_id
    ) then
    raise exception 'Owner fenced-test attempt closure is unavailable.';
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

drop trigger deposit_execution_attempts_enforce on app.deposit_execution_attempts;
create trigger deposit_execution_attempts_enforce_insert
before insert on app.deposit_execution_attempts
for each row execute function app.enforce_deposit_execution_attempt();
create trigger deposit_execution_attempts_enforce_ordinary_update
before update on app.deposit_execution_attempts
for each row when (
  old.status <> 'review_required'
  or new.status <> 'owner_test_closed_uncredited'
)
execute function app.enforce_deposit_execution_attempt();
create trigger deposit_execution_attempts_enforce_owner_test_close
before update on app.deposit_execution_attempts
for each row when (
  old.status = 'review_required'
  and new.status = 'owner_test_closed_uncredited'
)
execute function app.guard_owner_fenced_test_attempt_close();

create function app.guard_owner_fenced_test_intent_close()
returns trigger language plpgsql
set search_path = pg_catalog, app
as $$
begin
  if session_user <> 'postgres'
    or old.status <> 'execution_review'
    or new.status <> 'rejected'
    or new.rejection_reason_code is distinct from
      'owner_test_closed_no_credit_no_refund_provider_unconfirmed'
    or not exists (
      select 1
        from app.owner_fenced_test_no_credit_resolutions receipt
        join app.deposit_execution_attempts attempt
          on attempt.id = receipt.execution_attempt_id
       where receipt.deposit_intent_id = old.id
         and attempt.deposit_intent_id = old.id
         and attempt.status = 'owner_test_closed_uncredited'
    ) then
    raise exception 'Owner fenced-test intent closure is unavailable.';
  end if;
  return new;
end;
$$;

drop trigger deposit_intents_require_execution_correspondence
  on app.deposit_intents;
create trigger deposit_intents_require_execution_correspondence_ordinary
before update of status on app.deposit_intents
for each row when (
  old.status <> 'execution_review'
  or new.status <> 'rejected'
  or new.rejection_reason_code is distinct from
    'owner_test_closed_no_credit_no_refund_provider_unconfirmed'
)
execute function app.require_deposit_execution_correspondence();
create trigger deposit_intents_require_owner_fenced_test_close
before update of status on app.deposit_intents
for each row when (
  old.status = 'execution_review'
  and new.status = 'rejected'
  and new.rejection_reason_code =
    'owner_test_closed_no_credit_no_refund_provider_unconfirmed'
)
execute function app.guard_owner_fenced_test_intent_close();

create function app.resolve_owner_fenced_test_no_credit(
  p_actor_admin_id uuid,
  p_execution_attempt_id uuid,
  p_request_key uuid,
  p_owner_attests_both_wallets boolean,
  p_owner_accepts_no_credit_or_refund boolean,
  p_owner_accepts_provider_outcome_unconfirmed boolean
)
returns table (resolution_state text, replayed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  existing app.owner_fenced_test_no_credit_resolutions%rowtype;
  attempt_row app.deposit_execution_attempts%rowtype;
  intent_row app.deposit_intents%rowtype;
  execution_job app.deposit_jobs%rowtype;
  reconciliation_row app.execution_reconciliations%rowtype;
  reconciliation_job app.deposit_jobs%rowtype;
  review_case app.deposit_review_cases%rowtype;
  switch_count integer;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production database administrator can close a fenced Owner test.';
  end if;
  perform app.require_active_owner_for_private_live_deposit_pilot(p_actor_admin_id);
  if p_execution_attempt_id is null
    or p_request_key is null
    or p_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_owner_attests_both_wallets is distinct from true
    or p_owner_accepts_no_credit_or_refund is distinct from true
    or p_owner_accepts_provider_outcome_unconfirmed is distinct from true then
    raise exception 'The fenced Owner-test resolution attestation is incomplete.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:owner-fenced-test-resolution:v1', 0)
  );
  select receipt.* into existing
    from app.owner_fenced_test_no_credit_resolutions receipt
   where receipt.request_key = p_request_key
      or receipt.execution_attempt_id = p_execution_attempt_id
   for share;
  if existing.request_key is not null then
    if existing.request_key = p_request_key
      and existing.execution_attempt_id = p_execution_attempt_id
      and existing.actor_admin_id = p_actor_admin_id then
      return query select 'owner_test_closed_uncredited'::text, true;
      return;
    end if;
    raise exception 'The fenced Owner-test resolution conflicts with an existing receipt.';
  end if;

  -- Serialize with financial activation/stop, using the same lock order.
  perform authority.control_key
    from app.private_trusted_telebirr_activation_control authority
   where authority.control_key = 'trusted_telebirr_financial_authority'
   for share;
  if not found then
    raise exception 'The financial authority control is unavailable.';
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
      select 1 from app.deposit_jobs job
       where job.job_kind in ('execute_deposit', 'reconcile_execution')
         and job.status in ('queued', 'leased', 'retry_wait')
    ) then
    raise exception 'Fenced Owner-test closure requires dormant financial execution.';
  end if;
  perform control.singleton
    from app.agent_platform_companion_execution_control control
   where control.singleton and control.control_state = 'disabled'
   for share;
  if not found then
    raise exception 'Companion execution is not dormant.';
  end if;

  select attempt.* into attempt_row
    from app.deposit_execution_attempts attempt
   where attempt.id = p_execution_attempt_id
   for update;
  select intent.* into intent_row
    from app.deposit_intents intent
   where intent.id = attempt_row.deposit_intent_id
   for update;
  select job.* into execution_job
    from app.deposit_jobs job
   where job.id = attempt_row.deposit_job_id
   for share;
  select reconciliation.* into reconciliation_row
    from app.execution_reconciliations reconciliation
   where reconciliation.deposit_execution_attempt_id = attempt_row.id
   order by reconciliation.reconciliation_number desc
   limit 1
   for share;
  select job.* into reconciliation_job
    from app.deposit_jobs job
   where job.id = reconciliation_row.deposit_job_id
   for share;

  if attempt_row.id is null
    or attempt_row.status <> 'review_required'
    or attempt_row.exact_player_credit_match is true
    or intent_row.id is null
    or intent_row.status <> 'execution_review'
    or intent_row.rejection_reason_code is not null
    or execution_job.id is null
    or execution_job.job_kind <> 'execute_deposit'
    or execution_job.status <> 'succeeded'
    or execution_job.attempt_count <> 1
    or execution_job.max_attempts <> 1
    or reconciliation_row.id is null
    or reconciliation_row.deposit_intent_id <> intent_row.id
    or reconciliation_row.outcome <> 'ambiguous'
    or reconciliation_job.id is null
    or reconciliation_job.job_kind <> 'reconcile_execution'
    or reconciliation_job.status <> 'succeeded'
    or (select pg_catalog.count(*)
          from app.execution_reconciliations reconciliation
         where reconciliation.deposit_execution_attempt_id = attempt_row.id) <> 1
    or exists (
      select 1 from app.routine_telebirr_dispatch_evidence evidence
       where evidence.execution_attempt_id = attempt_row.id
    )
    or not exists (
      select 1 from app.routine_telebirr_runtime_pauses pause
       where pause.execution_attempt_id = attempt_row.id
         and pause.reason_code = 'execution_uncertain'
    )
    or exists (
      select 1 from app.deposit_execution_attempts other_attempt
       where other_attempt.id <> attempt_row.id
         and other_attempt.status in (
           'prepared', 'final_action_fenced',
           'reconciliation_required', 'review_required'
         )
    )
    or exists (
      select 1 from app.deposit_review_cases other_case
       where other_case.deposit_intent_id = intent_row.id
    ) then
    raise exception 'The protected fenced Owner-test lineage is not eligible for closure.';
  end if;

  -- The receipt states an Owner decision, not a negative provider finding.
  insert into app.owner_fenced_test_no_credit_resolutions (
    request_key, execution_attempt_id, deposit_intent_id,
    reconciliation_id, actor_admin_id
  ) values (
    p_request_key, attempt_row.id, intent_row.id,
    reconciliation_row.id, p_actor_admin_id
  );
  update app.deposit_execution_attempts attempt
     set status = 'owner_test_closed_uncredited'
   where attempt.id = attempt_row.id
     and attempt.status = 'review_required';
  if not found then
    raise exception 'The fenced attempt changed before closure.';
  end if;
  update app.deposit_intents intent
     set status = 'rejected',
         rejection_reason_code =
           'owner_test_closed_no_credit_no_refund_provider_unconfirmed'
   where intent.id = intent_row.id
     and intent.status = 'execution_review';
  if not found then
    raise exception 'The fenced intent changed before closure.';
  end if;

  insert into app.deposit_review_cases (
    deposit_intent_id, review_kind, reason_code
  ) values (
    intent_row.id, 'execution', 'fenced_owner_test_provider_outcome_unconfirmed'
  ) returning * into review_case;
  update app.deposit_review_cases review
     set status = 'resolved',
         resolution_code =
           'owner_test_closed_no_credit_no_refund_provider_unconfirmed'
   where review.id = review_case.id and review.status = 'open';
  if not found then
    raise exception 'The fenced Owner-test review changed before closure.';
  end if;

  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, resource_id, metadata
  ) values (
    'admin', p_actor_admin_id, 'deposit.owner_fenced_test_closed_uncredited',
    'deposit_intent', intent_row.id,
    pg_catalog.jsonb_build_object(
      'execution_attempt_id', attempt_row.id,
      'reconciliation_id', reconciliation_row.id,
      'resolution_request_key', p_request_key,
      'owner_attested_both_wallets', true,
      'owner_accepted_no_credit_or_refund', true,
      'provider_outcome_unconfirmed', true,
      'closure_performed_credit_or_refund', false
    )
  );
  return query select 'owner_test_closed_uncredited'::text, false;
end;
$$;

alter table app.owner_fenced_test_no_credit_resolutions
  enable row level security;
alter table app.owner_fenced_test_no_credit_resolutions
  force row level security;
alter table app.owner_fenced_test_no_credit_resolutions owner to postgres;
alter function app.guard_owner_fenced_test_attempt_close() owner to postgres;
alter function app.guard_owner_fenced_test_intent_close() owner to postgres;
alter function app.resolve_owner_fenced_test_no_credit(
  uuid, uuid, uuid, boolean, boolean, boolean
) owner to postgres;

revoke all privileges on table app.owner_fenced_test_no_credit_resolutions
  from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_companion_execution_bridge,
  fetanagent_companion_execution_bridge_runtime;
revoke all on function app.resolve_owner_fenced_test_no_credit(
  uuid, uuid, uuid, boolean, boolean, boolean
) from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_companion_execution_bridge,
  fetanagent_companion_execution_bridge_runtime;

comment on table app.owner_fenced_test_no_credit_resolutions is
  'Immutable Owner attestation closing a fenced own-account test without credit, refund, retry, or a claim that provider non-dispatch was proven.';
comment on function app.resolve_owner_fenced_test_no_credit(
  uuid, uuid, uuid, boolean, boolean, boolean
) is
  'Postgres-only one-use disposition of an ambiguous, already reconciled Owner-funded test while all financial switches and Companion execution are off. Never clicks Transfer or proves non-dispatch.';

commit;
