-- One-use, Owner-attested closure of an already approved KemerBet credit.
-- The Companion fenced the action but did not recognize the decimal success modal.
-- Its immutable reconciliation therefore ended ambiguous. This installs a guarded
-- no-money resolution; deployment alone does not invoke it.
begin;
set local lock_timeout = '5s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.owner_confirmed_87260_history_credit (
  request_key uuid primary key check (
    request_key::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  execution_attempt_id uuid not null unique references app.deposit_execution_attempts (id) on delete restrict,
  deposit_intent_id uuid not null unique references app.deposit_intents (id) on delete restrict,
  reconciliation_id uuid not null unique references app.execution_reconciliations (id) on delete restrict,
  review_case_id uuid not null unique references app.deposit_review_cases (id) on delete restrict,
  actor_admin_id uuid not null references app.admin_users (id) on delete restrict,
  history_transaction_id text not null unique check (history_transaction_id = '116333271'),
  history_request_id text not null unique check (history_request_id = '23560287'),
  history_minute_at timestamptz not null check (history_minute_at = '2026-11-06 19:41:00+00'::timestamptz),
  observed_player_id text not null check (observed_player_id = '29912447'),
  observed_amount_minor bigint not null check (observed_amount_minor = 87260),
  evidence_sha256 text not null check (
    evidence_sha256 = '92146c85e3478c86179a55ab06d03460bbe350bd358be6cc857c136dd02eb0b9'
  ),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint owner_confirmed_87260_exact_attempt check (
    execution_attempt_id = '0c712339-9c79-4a05-9453-0f9400e4e2ee'::uuid
    and deposit_intent_id = 'ff8357ce-39bd-49d2-9c94-207a421cfbd0'::uuid
  )
);
alter table app.owner_confirmed_87260_history_credit enable row level security;
alter table app.owner_confirmed_87260_history_credit force row level security;
create trigger owner_confirmed_87260_history_credit_immutable
  before update or delete on app.owner_confirmed_87260_history_credit
  for each row execute function app.reject_deposit_ledger_delete();
create trigger owner_confirmed_87260_history_credit_no_truncate
  before truncate on app.owner_confirmed_87260_history_credit
  for each statement execute function app.reject_execution_ledger_truncate();
revoke all on app.owner_confirmed_87260_history_credit from public, anon, authenticated, service_role;

-- An isolated ambiguous attempt can become confirmed only through the narrow
-- transition guard below. Preserve the immutable ambiguous reconciliation.
alter table app.deposit_execution_attempts
  drop constraint deposit_execution_attempts_isolated_review_shape;
alter table app.deposit_execution_attempts
  add constraint deposit_execution_attempts_isolated_review_shape check (
    not routine_review_isolated or status in ('review_required', 'confirmed_executed')
  );

create function app.guard_owner_confirmed_87260_attempt()
returns trigger language plpgsql
set search_path = pg_catalog, app
as $$
begin
  if session_user <> 'postgres'
    or old.id <> '0c712339-9c79-4a05-9453-0f9400e4e2ee'::uuid
    or old.status <> 'review_required'
    or new.status <> 'confirmed_executed'
    or (pg_catalog.to_jsonb(new) - array['status','updated_at']::text[])
       is distinct from (pg_catalog.to_jsonb(old) - array['status','updated_at']::text[])
    or not exists (
      select 1 from app.owner_confirmed_87260_history_credit receipt
      where receipt.execution_attempt_id = old.id
        and receipt.deposit_intent_id = old.deposit_intent_id
    ) then
    raise exception 'The Owner-confirmed 872.60 attempt transition is unavailable.';
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

drop trigger deposit_execution_attempts_enforce_ordinary_update on app.deposit_execution_attempts;
create trigger deposit_execution_attempts_enforce_ordinary_update
  before update on app.deposit_execution_attempts for each row when (
    (old.status <> 'review_required' or new.status <> 'owner_test_closed_uncredited')
    and (old.status <> 'review_required' or new.status <> 'confirmed_executed')
  ) execute function app.enforce_deposit_execution_attempt();
create trigger deposit_execution_attempts_guard_owner_confirmed_87260
  before update on app.deposit_execution_attempts for each row when (
    old.status = 'review_required' and new.status = 'confirmed_executed'
  ) execute function app.guard_owner_confirmed_87260_attempt();

create function app.guard_owner_confirmed_87260_intent()
returns trigger language plpgsql
set search_path = pg_catalog, app
as $$
begin
  if session_user <> 'postgres'
    or old.id <> 'ff8357ce-39bd-49d2-9c94-207a421cfbd0'::uuid
    or old.status <> 'execution_review'
    or new.status <> 'executed'
    or (pg_catalog.to_jsonb(new) - array['status','updated_at','status_changed_at']::text[])
       is distinct from (pg_catalog.to_jsonb(old) - array['status','updated_at','status_changed_at']::text[])
    or not exists (
      select 1 from app.owner_confirmed_87260_history_credit receipt
      join app.deposit_execution_attempts attempt
        on attempt.id = receipt.execution_attempt_id
      join app.deposit_review_cases review_case
        on review_case.id = receipt.review_case_id
      where receipt.deposit_intent_id = old.id
        and attempt.deposit_intent_id = old.id
        and attempt.status = 'confirmed_executed'
        and review_case.deposit_intent_id = old.id
        and review_case.status = 'resolved'
        and review_case.resolution_code = 'owner_confirmed_approved_kemerbet_history'
    ) then
    raise exception 'The Owner-confirmed 872.60 intent transition is unavailable.';
  end if;
  new.status_changed_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

drop trigger deposit_intents_enforce_transition on app.deposit_intents;
create trigger deposit_intents_enforce_transition
  before update on app.deposit_intents for each row when (
    old.status <> 'execution_review' or new.status <> 'executed'
  ) execute function app.enforce_deposit_intent_transition();
create trigger deposit_intents_guard_owner_confirmed_87260
  before update of status on app.deposit_intents for each row when (
    old.status = 'execution_review' and new.status = 'executed'
  ) execute function app.guard_owner_confirmed_87260_intent();
drop trigger deposit_intents_require_execution_correspondence_ordinary on app.deposit_intents;
create trigger deposit_intents_require_execution_correspondence_ordinary
  before update of status on app.deposit_intents for each row when (
    (old.status <> 'execution_review' or new.status <> 'rejected'
      or new.rejection_reason_code is distinct from
        'owner_test_closed_no_credit_no_refund_provider_unconfirmed')
    and (old.status <> 'execution_review' or new.status <> 'executed')
  ) execute function app.require_deposit_execution_correspondence();

create function app.resolve_owner_confirmed_87260_history_credit(
  p_actor_admin_id uuid,
  p_request_key uuid,
  p_owner_attests_existing_approved_credit boolean,
  p_owner_accepts_no_second_transfer boolean
)
returns table (resolution_state text, replayed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  existing app.owner_confirmed_87260_history_credit%rowtype;
  attempt_row app.deposit_execution_attempts%rowtype;
  intent_row app.deposit_intents%rowtype;
  execution_job app.deposit_jobs%rowtype;
  reconciliation_job app.deposit_jobs%rowtype;
  reconciliation_row app.execution_reconciliations%rowtype;
  review_row app.deposit_review_cases%rowtype;
  player_id text;
  provider_code text;
  platform_code text;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production database administrator can record this approved credit.';
  end if;
  perform app.require_active_owner_for_private_live_deposit_pilot(p_actor_admin_id);
  if p_request_key is null or p_request_key::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_owner_attests_existing_approved_credit is distinct from true
    or p_owner_accepts_no_second_transfer is distinct from true then
    raise exception 'The approved-credit attestation is incomplete.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:owner-confirmed-87260-history:v1', 0)
  );
  select receipt.* into existing
    from app.owner_confirmed_87260_history_credit receipt
   where receipt.execution_attempt_id = '0c712339-9c79-4a05-9453-0f9400e4e2ee'::uuid
      or receipt.request_key = p_request_key
   for share;
  if existing.request_key is not null then
    if existing.request_key = p_request_key
      and existing.actor_admin_id = p_actor_admin_id
      and exists (
        select 1 from app.deposit_intents intent
        where intent.id = existing.deposit_intent_id and intent.status = 'executed'
      ) then
      return query select 'confirmed_executed'::text, true;
      return;
    end if;
    raise exception 'The approved-credit request conflicts with its immutable receipt.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ff8357ce-39bd-49d2-9c94-207a421cfbd0', 20260815175508)
  );
  select attempt.* into attempt_row from app.deposit_execution_attempts attempt
   where attempt.id = '0c712339-9c79-4a05-9453-0f9400e4e2ee'::uuid for update;
  select intent.* into intent_row from app.deposit_intents intent
   where intent.id = attempt_row.deposit_intent_id for update;
  select job.* into execution_job from app.deposit_jobs job
   where job.id = attempt_row.deposit_job_id for share;
  select reconciliation.* into reconciliation_row
    from app.execution_reconciliations reconciliation
   where reconciliation.deposit_execution_attempt_id = attempt_row.id for share;
  select job.* into reconciliation_job from app.deposit_jobs job
   where job.id = reconciliation_row.deposit_job_id for share;
  select review_case.* into review_row from app.deposit_review_cases review_case
   where review_case.deposit_intent_id = intent_row.id for update;
  select player.player_id into player_id from app.customer_platform_players player
   where player.id = intent_row.player_account_id for key share;
  select provider.code::text into provider_code from app.payment_providers provider
   where provider.id = intent_row.payment_provider_id;
  select platform.code::text into platform_code from app.platforms platform
   where platform.id = intent_row.platform_id;

  if attempt_row.id is null
    or attempt_row.deposit_intent_id <> 'ff8357ce-39bd-49d2-9c94-207a421cfbd0'::uuid
    or attempt_row.status <> 'review_required'
    or attempt_row.routine_review_isolated is distinct from true
    or attempt_row.exact_player_credit_match is distinct from false
    or pg_catalog.date_trunc('minute', attempt_row.final_action_fenced_at)
       <> '2026-11-06 19:41:00+00'::timestamptz
    or attempt_row.reconciliation_required_at >= '2026-11-06 19:42:00+00'::timestamptz
    or intent_row.id is null or intent_row.status <> 'execution_review'
    or intent_row.expected_amount_minor <> 87260 or intent_row.currency_code <> 'ETB'
    or player_id <> '29912447' or provider_code <> 'telebirr'
    or platform_code <> 'kemerbet'
    or execution_job.id is null or execution_job.job_kind <> 'execute_deposit'
    or execution_job.status <> 'succeeded' or execution_job.attempt_count <> 1
    or reconciliation_job.id is null or reconciliation_job.job_kind <> 'reconcile_execution'
    or reconciliation_job.status <> 'succeeded' or reconciliation_job.attempt_count <> 1
    or reconciliation_row.id is null or reconciliation_row.outcome <> 'ambiguous'
    or reconciliation_row.reason_code <> 'agent_history_ambiguous'
    or (select pg_catalog.count(*) from app.execution_reconciliations r
        where r.deposit_execution_attempt_id = attempt_row.id) <> 1
    or (select pg_catalog.count(*) from app.deposit_execution_attempts a
        where a.deposit_intent_id = intent_row.id) <> 1
    or (select pg_catalog.count(*) from app.deposit_jobs j
        where j.deposit_intent_id = intent_row.id
          and j.job_kind in ('execute_deposit', 'reconcile_execution')) <> 2
    or review_row.id is null or review_row.status <> 'open'
    or review_row.reason_code <> 'execution_uncertain'
    or (select pg_catalog.count(*) from app.deposit_review_cases r
        where r.deposit_intent_id = intent_row.id) <> 1
    or exists (select 1 from app.routine_telebirr_dispatch_evidence dispatch
               where dispatch.execution_attempt_id = attempt_row.id)
    or exists (select 1 from app.routine_telebirr_history_confirmations history
               where history.history_transaction_id = '116333271'
                  or history.history_request_id = '23560287')
    or exists (select 1 from app.owner_confirmed_dispatched_test_credits history
               where history.history_transaction_id = '116333271'
                  or history.history_request_id = '23560287')
    or (select pg_catalog.count(*) from app.deposit_intents other_intent
        where other_intent.player_account_id = intent_row.player_account_id
          and other_intent.expected_amount_minor = 87260
          and other_intent.created_at >= '2026-11-06 19:31:00+00'::timestamptz
          and other_intent.created_at < '2026-11-06 19:51:00+00'::timestamptz) <> 1
  then raise exception 'The exact 872.60 approved-credit lineage is not eligible.';
  end if;

  insert into app.owner_confirmed_87260_history_credit (
    request_key, execution_attempt_id, deposit_intent_id, reconciliation_id,
    review_case_id, actor_admin_id, history_transaction_id, history_request_id,
    history_minute_at, observed_player_id, observed_amount_minor, evidence_sha256
  ) values (
    p_request_key, attempt_row.id, intent_row.id, reconciliation_row.id,
    review_row.id, p_actor_admin_id, '116333271', '23560287',
    '2026-11-06 19:41:00+00'::timestamptz, '29912447', 87260,
    '92146c85e3478c86179a55ab06d03460bbe350bd358be6cc857c136dd02eb0b9'
  );
  update app.deposit_execution_attempts attempt set status = 'confirmed_executed'
    where attempt.id = attempt_row.id and attempt.status = 'review_required';
  if not found then raise exception 'The exact attempt changed before closure.'; end if;
  update app.deposit_review_cases review_case set
      status = 'resolved', resolution_code = 'owner_confirmed_approved_kemerbet_history'
    where review_case.id = review_row.id and review_case.status = 'open';
  if not found then raise exception 'The exact review changed before closure.'; end if;
  update app.deposit_intents intent set status = 'executed'
    where intent.id = intent_row.id and intent.status = 'execution_review';
  if not found then raise exception 'The exact intent changed before closure.'; end if;
  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, resource_id, metadata
  ) values (
    'admin', p_actor_admin_id, 'deposit.owner_confirmed_approved_history_credit',
    'deposit_intent', intent_row.id,
    pg_catalog.jsonb_build_object(
      'execution_attempt_id', attempt_row.id,
      'ambiguous_reconciliation_id', reconciliation_row.id,
      'resolution_request_key', p_request_key,
      'history_time_precision', 'minute',
      'evidence_sha256', '92146c85e3478c86179a55ab06d03460bbe350bd358be6cc857c136dd02eb0b9',
      'owner_attested_existing_approved_credit', true,
      'additional_provider_transfer_performed', false
    )
  );
  return query select 'confirmed_executed'::text, false;
end;
$$;

alter table app.owner_confirmed_87260_history_credit owner to postgres;
alter function app.guard_owner_confirmed_87260_attempt() owner to postgres;
alter function app.guard_owner_confirmed_87260_intent() owner to postgres;
alter function app.resolve_owner_confirmed_87260_history_credit(uuid,uuid,boolean,boolean) owner to postgres;
revoke all on function app.resolve_owner_confirmed_87260_history_credit(uuid,uuid,boolean,boolean)
  from public, anon, authenticated, service_role,
    fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_companion_execution_bridge,
    fetanagent_companion_execution_bridge_runtime;

comment on function app.resolve_owner_confirmed_87260_history_credit(uuid,uuid,boolean,boolean) is
  'Postgres-only, one-use Owner attestation for the already-approved 872.60 ETB KemerBet History credit. Preserves the ambiguous signed record and performs no provider transfer.';
commit;
