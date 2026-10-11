-- One-use Owner resolution for an own-funded KemerBet credit that succeeded on
-- the provider but lost its signed Companion dispatch before database handoff.
-- Installing this function does not invoke it or change any financial switch.
begin;
set local lock_timeout = '5s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.owner_confirmed_fenced_test_credits (
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
  keyed_history_reference_fingerprint text not null unique check (
    keyed_history_reference_fingerprint ~ '^hmac-sha256-v1:[0-9a-f]{64}$'
  ),
  matched_history_occurred_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);
create index owner_confirmed_fenced_test_credits_actor_idx
  on app.owner_confirmed_fenced_test_credits (actor_admin_id);

create trigger owner_confirmed_fenced_test_credits_immutable
before update or delete on app.owner_confirmed_fenced_test_credits
for each row execute function app.reject_deposit_ledger_delete();
create trigger owner_confirmed_fenced_test_credits_no_truncate
before truncate on app.owner_confirmed_fenced_test_credits
for each statement execute function app.reject_execution_ledger_truncate();

create function app.resolve_owner_confirmed_fenced_test_credit(
  p_actor_admin_id uuid,
  p_execution_attempt_id uuid,
  p_request_key uuid,
  p_keyed_history_reference_fingerprint text,
  p_matched_history_occurred_at timestamptz,
  p_observed_player_id text,
  p_observed_amount_minor bigint,
  p_owner_attests_both_wallets boolean,
  p_owner_attests_success_screen_and_history boolean,
  p_owner_accepts_no_second_credit_or_refund boolean
)
returns table (resolution_state text, replayed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  existing app.owner_confirmed_fenced_test_credits%rowtype;
  attempt_row app.deposit_execution_attempts%rowtype;
  intent_row app.deposit_intents%rowtype;
  execution_job app.deposit_jobs%rowtype;
  reconciliation_job app.deposit_jobs%rowtype;
  leased_reconciliation record;
  recorded_reconciliation record;
  player_account app.customer_platform_players%rowtype;
  provider_code text;
  platform_code text;
  resolved_intent_id uuid;
  switch_count integer;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production database administrator can resolve a credited Owner test.';
  end if;
  perform app.require_active_owner_for_private_live_deposit_pilot(p_actor_admin_id);
  if p_execution_attempt_id is null
    or p_request_key is null
    or p_request_key::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_keyed_history_reference_fingerprint is null
    or p_keyed_history_reference_fingerprint
      !~ '^hmac-sha256-v1:[0-9a-f]{64}$'
    or p_matched_history_occurred_at is null
    or p_observed_player_id is null
    or p_observed_amount_minor is distinct from 3000
    or p_owner_attests_both_wallets is distinct from true
    or p_owner_attests_success_screen_and_history is distinct from true
    or p_owner_accepts_no_second_credit_or_refund is distinct from true then
    raise exception 'The credited Owner-test evidence or attestation is incomplete.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:owner-confirmed-credited-test:v1', 0)
  );
  select receipt.* into existing
    from app.owner_confirmed_fenced_test_credits receipt
   where receipt.request_key = p_request_key
      or receipt.execution_attempt_id = p_execution_attempt_id
   for share;
  if existing.request_key is not null then
    if existing.request_key = p_request_key
      and existing.execution_attempt_id = p_execution_attempt_id
      and existing.actor_admin_id = p_actor_admin_id
      and existing.keyed_history_reference_fingerprint =
        p_keyed_history_reference_fingerprint
      and existing.matched_history_occurred_at = p_matched_history_occurred_at
      and exists (
        select 1
          from app.deposit_intents intent
          join app.customer_platform_players player
            on player.id = intent.player_account_id
         where intent.id = existing.deposit_intent_id
           and intent.status = 'executed'
           and intent.expected_amount_minor = p_observed_amount_minor
           and player.player_id = p_observed_player_id
      ) then
      return query select 'confirmed_executed'::text, true;
      return;
    end if;
    raise exception 'The credited Owner-test request conflicts with its immutable receipt.';
  end if;

  -- Serialize with financial activation and stop while the one-shot ledger
  -- transition is made. No provider request or Companion command is issued.
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
  ) or app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception 'Credited Owner-test resolution requires dormant financial authority.';
  end if;
  perform control.singleton
    from app.agent_platform_companion_execution_control control
   where control.singleton and control.control_state = 'disabled'
   for share;
  if not found then
    raise exception 'Companion execution is not dormant.';
  end if;

  select attempt.deposit_intent_id into resolved_intent_id
    from app.deposit_execution_attempts attempt
   where attempt.id = p_execution_attempt_id;
  if not found then
    raise exception 'The fenced execution attempt is unavailable.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(resolved_intent_id::text, 20260815203606)
  );
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
   for update;
  select player.* into player_account
    from app.customer_platform_players player
   where player.id = intent_row.player_account_id
   for key share;
  select provider.code::text into provider_code
    from app.payment_providers provider
   where provider.id = intent_row.payment_provider_id;
  select platform.code::text into platform_code
    from app.platforms platform
   where platform.id = intent_row.platform_id;

  if attempt_row.id is null
    or exists (select 1 from app.owner_confirmed_fenced_test_credits)
    or attempt_row.deposit_intent_id is distinct from resolved_intent_id
    or attempt_row.status <> 'final_action_fenced'
    or attempt_row.exact_player_credit_match is not null
    or intent_row.id is null
    or intent_row.status <> 'execution_in_progress'
    or intent_row.expected_amount_minor <> 3000
    or intent_row.currency_code <> 'ETB'
    or provider_code <> 'telebirr'
    or platform_code <> 'kemerbet'
    or player_account.id is null
    or player_account.player_id is distinct from p_observed_player_id
    or execution_job.id is null
    or execution_job.deposit_intent_id <> intent_row.id
    or execution_job.job_kind <> 'execute_deposit'
    or execution_job.status <> 'leased'
    or execution_job.attempt_count <> 1
    or execution_job.max_attempts <> 1
    or execution_job.lease_expires_at > pg_catalog.clock_timestamp()
    or attempt_row.final_action_fenced_at is null
    or p_matched_history_occurred_at not between
      attempt_row.final_action_fenced_at and pg_catalog.clock_timestamp()
    or (select pg_catalog.count(*)
          from app.deposit_execution_attempts other_attempt
         where other_attempt.deposit_intent_id = intent_row.id) <> 1
    or exists (
      select 1 from app.deposit_jobs other_job
       where other_job.job_kind in ('execute_deposit', 'reconcile_execution')
         and other_job.status in ('queued', 'leased', 'retry_wait')
         and other_job.id <> execution_job.id
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
      select 1 from app.routine_telebirr_dispatch_evidence evidence
       where evidence.execution_attempt_id = attempt_row.id
    )
    or exists (
      select 1 from app.execution_reconciliations reconciliation
       where reconciliation.deposit_execution_attempt_id = attempt_row.id
    )
    or exists (
      select 1 from app.deposit_review_cases review_case
       where review_case.deposit_intent_id = intent_row.id
    ) then
    raise exception 'The protected credited Owner-test lineage is not eligible.';
  end if;

  -- This exceptional Owner-attested handoff records the success screen and
  -- separately checked provider-history fact. It never obtains a new fence.
  update app.deposit_execution_attempts attempt
     set status = 'reconciliation_required',
         exact_player_credit_match = true
   where attempt.id = attempt_row.id;
  update app.deposit_intents intent
     set status = 'execution_uncertain'
   where intent.id = intent_row.id;
  update app.deposit_jobs job
     set status = 'succeeded', lease_token = null, leased_by = null,
         lease_expires_at = null, last_error_code = null
   where job.id = execution_job.id;
  insert into app.deposit_jobs (
    deposit_intent_id, deposit_submission_id, job_kind, job_key,
    run_after, max_attempts
  ) values (
    intent_row.id, null, 'reconcile_execution',
    'deposit-reconciliation:v1:' || attempt_row.id::text || ':1',
    pg_catalog.clock_timestamp(), 8
  ) returning * into reconciliation_job;
  update app.deposit_intents intent
     set status = 'execution_reconciliation'
   where intent.id = intent_row.id;

  select * into leased_reconciliation
    from app.lease_next_deposit_execution_reconciliation(
      gen_random_uuid(), 300
    );
  if leased_reconciliation.reconciliation_job_id is distinct from
      reconciliation_job.id
    or leased_reconciliation.execution_attempt_id is distinct from
      attempt_row.id then
    raise exception 'The exact Owner-test reconciliation lease was not obtained.';
  end if;
  select * into recorded_reconciliation
    from app.record_deposit_execution_reconciliation(
      reconciliation_job.id,
      leased_reconciliation.lease_token,
      'confirmed_executed',
      p_keyed_history_reference_fingerprint,
      1::smallint,
      'deposit',
      p_matched_history_occurred_at,
      true, true, true, true
    );
  if recorded_reconciliation.outcome is distinct from 'confirmed_executed'
    or recorded_reconciliation.execution_attempt_id is distinct from attempt_row.id
    or recorded_reconciliation.deposit_intent_id is distinct from intent_row.id
    or recorded_reconciliation.attempt_status is distinct from 'confirmed_executed'
    or recorded_reconciliation.deposit_status is distinct from 'executed' then
    raise exception 'The exact credited Owner-test reconciliation did not confirm.';
  end if;

  insert into app.owner_confirmed_fenced_test_credits (
    request_key, execution_attempt_id, deposit_intent_id, reconciliation_id,
    actor_admin_id, keyed_history_reference_fingerprint,
    matched_history_occurred_at
  ) values (
    p_request_key, attempt_row.id, intent_row.id,
    recorded_reconciliation.reconciliation_id, p_actor_admin_id,
    p_keyed_history_reference_fingerprint, p_matched_history_occurred_at
  );
  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, resource_id, metadata
  ) values (
    'admin', p_actor_admin_id,
    'deposit.owner_confirmed_credited_test_reconciled',
    'deposit_intent', intent_row.id,
    pg_catalog.jsonb_build_object(
      'execution_attempt_id', attempt_row.id,
      'reconciliation_id', recorded_reconciliation.reconciliation_id,
      'resolution_request_key', p_request_key,
      'owner_attested_both_wallets', true,
      'owner_attested_success_screen_and_history', true,
      'existing_provider_credit_recorded', true,
      'additional_credit_or_refund_performed', false
    )
  );
  return query select 'confirmed_executed'::text, false;
end;
$$;

alter table app.owner_confirmed_fenced_test_credits
  enable row level security;
alter table app.owner_confirmed_fenced_test_credits
  force row level security;
alter table app.owner_confirmed_fenced_test_credits owner to postgres;
alter function app.resolve_owner_confirmed_fenced_test_credit(
  uuid, uuid, uuid, text, timestamptz, text, bigint,
  boolean, boolean, boolean
) owner to postgres;

revoke all privileges on table app.owner_confirmed_fenced_test_credits
  from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
  fetanagent_companion_execution_bridge,
  fetanagent_companion_execution_bridge_runtime;
revoke all on function app.resolve_owner_confirmed_fenced_test_credit(
  uuid, uuid, uuid, text, timestamptz, text, bigint,
  boolean, boolean, boolean
) from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
  fetanagent_companion_execution_bridge,
  fetanagent_companion_execution_bridge_runtime;

comment on table app.owner_confirmed_fenced_test_credits is
  'Immutable Owner attestation for one already-credited, own-funded 30 ETB TeleBirr test. No second provider action is performed.';
comment on function app.resolve_owner_confirmed_fenced_test_credit(
  uuid, uuid, uuid, text, timestamptz, text, bigint,
  boolean, boolean, boolean
) is
  'Postgres-only, gates-off, one-use reconciliation of an expired fenced own-funded 30 ETB credit using an Owner-checked success screen and one exact approved KemerBet history entry; never clicks Transfer or refunds.';

commit;
