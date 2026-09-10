-- Dispatch every private-live deposit execution from immutable provider lineage. Preserve CBE
-- Birr's existing public lease/fence path without a TeleBirr binding; bind only TeleBirr attempts
-- to the current activation epoch and require that epoch at the final-action fence.
--
-- This migration creates no activation writer and does not make any switch, pilot, role, or runtime
-- live. Cancellation and reconciliation keep their existing grants and intentionally do not depend
-- on a current epoch: expiry and emergency stop must prevent new authority without preventing safe
-- convergence of work that may already be uncertain.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

-- The activation foundation is applied only from its all-disabled state. Acquire the same global
-- order used by runtime mutations before freezing attempt writers for preflight: control, epoch,
-- switches in key order, then execution rows. Epoch zero has no pilot row to lock. Already-fenced
-- work is allowed because reconciliation must remain able to converge it after disable.
do $private_live_execution_epoch_migration_lock$
declare
  locked_epoch bigint;
begin
  select activation_control.current_epoch
    into locked_epoch
    from app.private_trusted_telebirr_activation_control activation_control
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
   for share;

  if locked_epoch <> 0 then
    raise exception 'Private-live execution epoch interlock requires disabled epoch zero.';
  end if;

  perform activation_epoch.epoch
    from app.private_trusted_telebirr_activation_epochs activation_epoch
   where activation_epoch.epoch = locked_epoch
     and activation_epoch.authority_state = 'disabled'
   for share;

  if not found then
    raise exception 'Private-live execution epoch interlock requires disabled epoch zero.';
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for share;
end;
$private_live_execution_epoch_migration_lock$;

lock table app.deposit_execution_attempts in share row exclusive mode;

do $private_live_execution_epoch_preflight$
begin
  if exists (
    select 1
      from app.deposit_execution_attempts execution_attempt
     where execution_attempt.status = 'prepared'
  ) then
    raise exception
      'Private-live execution epoch interlock requires no prepared execution attempt.';
  end if;

  if pg_catalog.to_regprocedure(
       'app.lease_next_private_live_deposit_execution(uuid,integer)'
     ) is null
    or pg_catalog.to_regprocedure(
      'app.fence_private_live_deposit_execution_final_action(uuid,uuid,uuid,uuid,uuid)'
    ) is null then
    raise exception 'The private-live execution functions required by the epoch interlock are absent.';
  end if;
end;
$private_live_execution_epoch_preflight$;

-- Renaming preserves the reviewed implementations while freeing the public signatures for guarded
-- wrappers. Their old OIDs also preserve their old ACLs, so revoke those ACLs explicitly below.
alter function app.lease_next_private_live_deposit_execution(uuid, integer)
  rename to lease_private_live_deposit_pre_epoch;
alter function app.fence_private_live_deposit_execution_final_action(
  uuid, uuid, uuid, uuid, uuid
) rename to fence_private_live_deposit_pre_epoch;

create table app.private_live_deposit_execution_epoch_bindings (
  execution_attempt_id uuid primary key,
  execution_job_id uuid not null unique,
  deposit_intent_id uuid not null,
  activation_epoch bigint not null
    references app.private_trusted_telebirr_activation_epochs (epoch) on delete restrict,
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  pilot_reservation_id uuid not null
    references app.private_live_deposit_pilot_reservations (id) on delete restrict,
  pilot_configuration_digest text not null
    check (pilot_configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  platform_agent_account_id uuid not null,
  bound_at timestamptz not null,
  constraint private_live_execution_epoch_positive check (activation_epoch > 0),
  constraint private_live_execution_epoch_attempt_fkey
    foreign key (
      execution_attempt_id,
      deposit_intent_id,
      platform_agent_account_id
    ) references app.deposit_execution_attempts (
      id,
      deposit_intent_id,
      platform_agent_account_id
    ) on delete restrict,
  constraint private_live_execution_epoch_job_fkey
    foreign key (execution_job_id, deposit_intent_id)
    references app.deposit_jobs (id, deposit_intent_id) on delete restrict
);

create index private_live_execution_epoch_intent_idx
  on app.private_live_deposit_execution_epoch_bindings (deposit_intent_id);
create index private_live_execution_epoch_authority_idx
  on app.private_live_deposit_execution_epoch_bindings (activation_epoch);
create index private_live_execution_epoch_pilot_idx
  on app.private_live_deposit_execution_epoch_bindings (pilot_revision_id);
create index private_live_execution_epoch_reservation_idx
  on app.private_live_deposit_execution_epoch_bindings (pilot_reservation_id);
create index private_live_execution_epoch_agent_idx
  on app.private_live_deposit_execution_epoch_bindings (platform_agent_account_id);

create function app.reject_private_live_execution_epoch_binding_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Private-live execution epoch bindings are immutable.';
end;
$$;

create function app.reject_private_live_execution_epoch_binding_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Private-live execution epoch bindings cannot be truncated.';
end;
$$;

create trigger private_live_execution_epoch_bindings_immutable
before update or delete on app.private_live_deposit_execution_epoch_bindings
for each row
execute function app.reject_private_live_execution_epoch_binding_mutation();

create trigger private_live_execution_epoch_bindings_no_truncate
before truncate on app.private_live_deposit_execution_epoch_bindings
for each statement
execute function app.reject_private_live_execution_epoch_binding_truncate();

-- Recovering an expired prepared attempt is a terminal safety transition, not new financial
-- authority. Keep the implementation owner-only and deliberately omit every fresh-lease path.
-- The public wrapper invokes it only after activation control, epoch, and sorted switch locks.
create function app.recover_expired_private_live_prepared()
returns table (
  deposit_intent_id uuid,
  execution_attempt_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_attempt_id uuid;
  expired_intent_id uuid;
  expired_job_id uuid;
begin
  select execution_attempt.id,
         execution_job.id,
         deposit_intent.id
    into expired_attempt_id,
         expired_job_id,
         expired_intent_id
    from app.deposit_execution_attempts execution_attempt
    join app.deposit_jobs execution_job
      on execution_job.id = execution_attempt.deposit_job_id
     and execution_job.deposit_intent_id = execution_attempt.deposit_intent_id
    join app.deposit_intents deposit_intent
      on deposit_intent.id = execution_attempt.deposit_intent_id
   where execution_attempt.status = 'prepared'
     and deposit_intent.status = 'execution_pending'
     and execution_job.job_kind = 'execute_deposit'
     and execution_job.status = 'leased'
     and execution_job.max_attempts = 1
     and execution_job.attempt_count = 1
     and execution_job.lease_token is not null
     and execution_job.lease_expires_at <= pg_catalog.clock_timestamp()
   order by execution_job.lease_expires_at,
            execution_attempt.created_at,
            execution_attempt.id
   for update of execution_attempt, execution_job, deposit_intent skip locked
   limit 1;

  if not found then
    return;
  end if;

  update app.deposit_execution_attempts execution_attempt
     set status = 'cancelled_before_action'
   where execution_attempt.id = expired_attempt_id;

  update app.deposit_jobs execution_job
     set status = 'cancelled',
         lease_token = null,
         leased_by = null,
         lease_expires_at = null,
         last_error_code = 'execution_lease_expired_before_action'
   where execution_job.id = expired_job_id;

  update app.deposit_intents deposit_intent
     set status = 'execution_review'
   where deposit_intent.id = expired_intent_id;

  insert into app.deposit_review_cases (
    deposit_intent_id,
    review_kind,
    reason_code
  ) values (
    expired_intent_id,
    'execution',
    'execution_lease_expired_before_action'
  )
  on conflict (deposit_intent_id, review_kind)
    where status in ('open', 'assigned')
  do nothing;

  return query select expired_intent_id, expired_attempt_id;
end;
$$;

-- Select a fresh job only when its immutable private-pilot reservation resolves to an explicitly
-- allowed provider. This is the provider-dispatch boundary: malformed or missing lineage is
-- skipped closed, and TeleBirr is excluded from queue selection unless the caller already proved
-- the current activation epoch. The exact full lineage is rechecked after leasing, atomically.
create function app.lease_private_live_deposit_by_provider(
  p_worker_instance_id uuid,
  p_lease_seconds integer,
  p_allow_telebirr boolean
)
returns table (
  deposit_intent_id uuid,
  execution_job_id uuid,
  execution_attempt_id uuid,
  platform_agent_account_id uuid,
  player_id text,
  amount_minor bigint,
  currency_code text,
  lease_token uuid,
  lease_expires_at timestamptz,
  lease_disposition text,
  pilot_contract_version smallint,
  pilot_revision_id uuid,
  pilot_reservation_id uuid,
  pilot_configuration_digest text,
  pilot_authorization_token uuid,
  provider_code_snapshot text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  pilot_authority record;
  checked_at timestamptz;
  claimed_agent_id uuid;
  claimed_amount_minor bigint;
  claimed_attempt app.deposit_execution_attempts%rowtype;
  claimed_currency_code text;
  claimed_job app.deposit_jobs%rowtype;
  claimed_job_id uuid;
  claimed_player_id text;
  claimed_provider_code text;
  new_lease_token uuid;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  pilot_id uuid;
  switch_count integer;
begin
  if p_worker_instance_id is null
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 600
    or p_allow_telebirr is null then
    raise exception 'The private-live provider lease request is invalid.';
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  select case
           when pilot_switch.settings ->> 'pilot_revision_id'
                ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
             then (pilot_switch.settings ->> 'pilot_revision_id')::uuid
           else null::uuid
         end
    into pilot_id
    from app.feature_switches pilot_switch
   where pilot_switch.feature_key = 'private_live_deposit_pilot'
     and pilot_switch.mode = 'live'
     and pg_catalog.jsonb_typeof(pilot_switch.settings) = 'object'
     and pilot_switch.settings ? 'pilot_revision_id';

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = pilot_id
   for update;

  checked_at := pg_catalog.clock_timestamp();

  if switch_count <> 5
    or pilot.id is null
    or pilot.status <> 'armed'
    or checked_at < pilot.active_from
    or checked_at >= pilot.expires_at
    or not exists (
      select 1
        from app.feature_switches pilot_switch
       where pilot_switch.feature_key = 'private_live_deposit_pilot'
         and pilot_switch.mode = 'live'
         and pilot_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    )
    or (
      select pg_catalog.count(*)
        from app.feature_switches financial_switch
       where financial_switch.feature_key in ('deposit_execution', 'payment_verification')
         and financial_switch.mode = 'live'
    ) <> 2 then
    return;
  end if;

  -- This is the fresh half of the existing generic execution lease. Recovery is intentionally
  -- absent and occurs in the recovery-only helper before any provider or epoch authority check.
  select execution_job.id,
         agent_account.id,
         player_account.player_id,
         deposit_intent.expected_amount_minor,
         deposit_intent.currency_code::text,
         provider_member.provider_code_snapshot
    into claimed_job_id,
         claimed_agent_id,
         claimed_player_id,
         claimed_amount_minor,
         claimed_currency_code,
         claimed_provider_code
    from app.deposit_jobs execution_job
    join app.deposit_intents deposit_intent
      on deposit_intent.id = execution_job.deposit_intent_id
    join app.private_live_deposit_pilot_reservations pilot_reservation
      on pilot_reservation.pilot_revision_id = pilot.id
     and pilot_reservation.deposit_intent_id = deposit_intent.id
     and pilot_reservation.player_account_id = deposit_intent.player_account_id
     and pilot_reservation.player_owner_customer_id_snapshot = deposit_intent.customer_id
     and pilot_reservation.payment_provider_id = deposit_intent.payment_provider_id
     and pilot_reservation.receiver_account_id = deposit_intent.receiver_account_id
     and pilot_reservation.receiver_account_version = deposit_intent.receiver_account_version
     and pilot_reservation.amount_minor = deposit_intent.expected_amount_minor
     and pilot_reservation.currency_code = deposit_intent.currency_code
    join app.private_live_deposit_pilot_providers provider_member
      on provider_member.pilot_revision_id = pilot_reservation.pilot_revision_id
     and provider_member.payment_provider_id = pilot_reservation.payment_provider_id
     and provider_member.receiver_account_id = pilot_reservation.receiver_account_id
     and provider_member.receiver_account_version = pilot_reservation.receiver_account_version
     and (
       provider_member.provider_code_snapshot = 'cbe_birr'
       or (
         p_allow_telebirr
         and provider_member.provider_code_snapshot = 'telebirr'
       )
     )
    join app.feature_switches selected_provider_switch
      on selected_provider_switch.feature_key =
           provider_member.provider_code_snapshot || '_authoritative_verification'
     and selected_provider_switch.mode = 'live'
    join app.payment_providers payment_provider
      on payment_provider.id = provider_member.payment_provider_id
     and payment_provider.code = provider_member.provider_code_snapshot
     and payment_provider.status = 'active'
     and payment_provider.updated_at is not distinct from
         provider_member.provider_updated_at_snapshot
    join app.receiver_accounts receiver_account
      on receiver_account.id = provider_member.receiver_account_id
     and receiver_account.provider_id = payment_provider.id
     and receiver_account.version = provider_member.receiver_account_version
     and receiver_account.status = 'active'
     and receiver_account.account_holder_name =
         provider_member.receiver_account_holder_name_snapshot
     and receiver_account.account_reference_masked =
         provider_member.receiver_account_masked_snapshot
     and receiver_account.active_from = provider_member.receiver_active_from_snapshot
     and receiver_account.updated_at is not distinct from
         provider_member.receiver_updated_at_snapshot
    join app.customer_platform_players player_account
      on player_account.id = deposit_intent.player_account_id
     and player_account.customer_id = deposit_intent.customer_id
     and player_account.platform_id = deposit_intent.platform_id
    join app.platforms platform
      on platform.id = deposit_intent.platform_id
     and platform.code = 'kemerbet'
     and platform.status = 'active'
    join app.platform_agent_accounts agent_account
      on agent_account.platform_id = platform.id
     and agent_account.id = pilot.platform_agent_account_id
     and agent_account.status = 'active'
    join app.deposit_policy_versions active_policy
      on active_policy.id = deposit_intent.deposit_policy_version_id
     and active_policy.version = deposit_intent.deposit_policy_version
     and active_policy.minimum_amount_minor = deposit_intent.minimum_amount_minor
     and active_policy.maximum_amount_minor = deposit_intent.maximum_amount_minor
     and active_policy.freshness_window_seconds = deposit_intent.freshness_window_seconds
     and active_policy.status = 'active'
   where execution_job.job_kind = 'execute_deposit'
     and execution_job.status = 'queued'
     and execution_job.run_after <= pg_catalog.clock_timestamp()
     and execution_job.max_attempts = 1
     and execution_job.attempt_count = 0
     and deposit_intent.status = 'execution_pending'
     and deposit_intent.currency_code = 'ETB'
     and deposit_intent.expected_amount_minor >= 2500
     and deposit_intent.expected_amount_minor <= 2500000
     and deposit_intent.expected_amount_minor
         between deposit_intent.minimum_amount_minor and deposit_intent.maximum_amount_minor
     and deposit_intent.minimum_amount_minor >= 2500
     and deposit_intent.maximum_amount_minor <= 2500000
     and player_account.status = 'active'
     and player_account.validation_status = 'valid'
     and exists (
       select 1
         from app.deposit_payment_claims payment_claim
        where payment_claim.deposit_intent_id = deposit_intent.id
     )
     and exists (
       select 1
         from app.player_deposit_eligibility_decisions latest_decision
        where latest_decision.id = (
          select eligibility_decision.id
            from app.player_deposit_eligibility_decisions eligibility_decision
           where eligibility_decision.player_account_id = player_account.id
           order by eligibility_decision.decision_version desc
           limit 1
        )
          and latest_decision.player_account_id = player_account.id
          and latest_decision.decision = 'eligible'
          and latest_decision.decided_at <= pg_catalog.clock_timestamp()
          and latest_decision.player_account_updated_at_snapshot
              is not distinct from player_account.updated_at
     )
     and (
       select pg_catalog.count(*)::integer
         from app.player_deposit_eligibility_decisions eligibility_decision
        where eligibility_decision.player_account_id = player_account.id
     ) = (
       select coalesce(pg_catalog.max(eligibility_decision.decision_version), 0)
         from app.player_deposit_eligibility_decisions eligibility_decision
        where eligibility_decision.player_account_id = player_account.id
     )
     and not exists (
       select 1
         from app.deposit_execution_attempts blocking_attempt
        where blocking_attempt.platform_agent_account_id = agent_account.id
          and blocking_attempt.status in (
            'prepared',
            'final_action_fenced',
            'reconciliation_required',
            'review_required'
          )
     )
   order by execution_job.priority desc,
            execution_job.run_after,
            execution_job.created_at,
            execution_job.id,
            agent_account.id
   for update of execution_job, deposit_intent, player_account, agent_account skip locked
   limit 1;

  if not found then
    return;
  end if;

  new_lease_token := pg_catalog.gen_random_uuid();

  update app.deposit_jobs execution_job
     set status = 'leased',
         attempt_count = execution_job.attempt_count + 1,
         lease_token = new_lease_token,
         leased_by = p_worker_instance_id::text,
         lease_expires_at = pg_catalog.clock_timestamp()
                            + pg_catalog.make_interval(secs => p_lease_seconds),
         last_error_code = null
   where execution_job.id = claimed_job_id
   returning execution_job.* into claimed_job;

  insert into app.deposit_execution_attempts (
    deposit_intent_id,
    deposit_job_id,
    platform_agent_account_id,
    attempt_number
  ) values (
    claimed_job.deposit_intent_id,
    claimed_job.id,
    claimed_agent_id,
    1
  )
  returning * into claimed_attempt;

  select pilot_authorization.*
    into pilot_authority
    from app.require_private_live_deposit_pilot_authorization(
      claimed_job.deposit_intent_id,
      claimed_attempt.id
    ) pilot_authorization;

  if pilot_authority.pilot_reservation_id is null
    or claimed_provider_code is null
    or claimed_provider_code not in ('cbe_birr', 'telebirr')
    or (claimed_provider_code = 'telebirr' and not p_allow_telebirr) then
    raise exception 'The private-live provider lease lacks database authorization.';
  end if;

  return query
  select claimed_job.deposit_intent_id,
         claimed_job.id,
         claimed_attempt.id,
         claimed_agent_id,
         claimed_player_id,
         claimed_amount_minor,
         claimed_currency_code,
         claimed_job.lease_token,
         claimed_job.lease_expires_at,
         'execution'::text,
         pilot_authority.pilot_contract_version,
         pilot_authority.pilot_revision_id,
         pilot_authority.pilot_reservation_id,
         pilot_authority.pilot_configuration_digest,
         pilot_authority.pilot_authorization_token,
         claimed_provider_code;
end;
$$;

-- Preserve the existing owner-status OID and return contract while aligning its aggregate signal
-- with provider dispatch: a mixed pilot is financially active when at least one provider actually
-- configured in that pilot has its exact authoritative-verification lane live. A live switch for
-- an unconfigured provider cannot satisfy this EXISTS because membership is the driving relation.
create or replace function app.get_private_live_deposit_pilot_status_by_admin_id(
  p_actor_admin_id uuid,
  p_pilot_revision_id uuid
)
returns table (
  pilot_revision_id uuid,
  revision integer,
  contract_version smallint,
  pilot_status text,
  switch_mode text,
  configuration_digest text,
  financially_active boolean,
  within_active_window boolean,
  player_count integer,
  submitting_customer_count integer,
  provider_count integer,
  reserved_deposit_count integer,
  reserved_amount_minor bigint,
  maximum_reservation_count smallint,
  maximum_aggregate_minor bigint,
  expires_at timestamptz,
  stopped_at timestamptz,
  stop_reason_code text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  checked_at timestamptz;
begin
  perform app.require_active_owner_for_private_live_deposit_pilot(p_actor_admin_id);

  checked_at := pg_catalog.clock_timestamp();

  return query
  select pilot.id,
         pilot.revision,
         pilot.contract_version,
         pilot.status,
         pilot_switch.mode::text,
         pilot.configuration_digest,
         (
           pilot.status = 'armed'
           and checked_at >= pilot.active_from
           and checked_at < pilot.expires_at
           and pilot_switch.mode = 'live'
           and pilot_switch.settings = pg_catalog.jsonb_build_object(
             'contract_version', 1,
             'pilot_revision_id', pilot.id,
             'configuration_digest', pilot.configuration_digest
           )
           and (
             select pg_catalog.count(*) = 2
               from app.feature_switches financial_switch
              where financial_switch.feature_key in (
                'deposit_execution',
                'payment_verification'
              )
                and financial_switch.mode = 'live'
           )
           and exists (
             select 1
               from app.private_live_deposit_pilot_providers provider_member
               join app.feature_switches configured_provider_switch
                 on configured_provider_switch.feature_key =
                      provider_member.provider_code_snapshot ||
                      '_authoritative_verification'
                and configured_provider_switch.mode = 'live'
              where provider_member.pilot_revision_id = pilot.id
           )
         ),
         (checked_at >= pilot.active_from and checked_at < pilot.expires_at),
         (
           select pg_catalog.count(*)::integer
             from app.private_live_deposit_pilot_players member
            where member.pilot_revision_id = pilot.id
         ),
         (
           select pg_catalog.count(*)::integer
             from app.private_live_deposit_pilot_customers member
            where member.pilot_revision_id = pilot.id
         ),
         (
           select pg_catalog.count(*)::integer
             from app.private_live_deposit_pilot_providers member
            where member.pilot_revision_id = pilot.id
         ),
         (
           select pg_catalog.count(*)::integer
             from app.private_live_deposit_pilot_reservations reservation
            where reservation.pilot_revision_id = pilot.id
         ),
         (
           select coalesce(pg_catalog.sum(reservation.amount_minor), 0)::bigint
             from app.private_live_deposit_pilot_reservations reservation
            where reservation.pilot_revision_id = pilot.id
         ),
         pilot.maximum_reservation_count,
         pilot.maximum_aggregate_minor,
         pilot.expires_at,
         pilot.stopped_at,
         pilot.stop_reason_code
    from app.private_live_deposit_pilot_revisions pilot
    join app.feature_switches pilot_switch
      on pilot_switch.feature_key = 'private_live_deposit_pilot'
   where pilot.id = p_pilot_revision_id;

  if not found then
    raise exception 'The private live-deposit pilot is unavailable.';
  end if;
end;
$$;

create function app.lease_next_private_live_deposit_execution(
  p_worker_instance_id uuid,
  p_lease_seconds integer default 300
)
returns table (
  deposit_intent_id uuid,
  execution_job_id uuid,
  execution_attempt_id uuid,
  platform_agent_account_id uuid,
  player_id text,
  amount_minor bigint,
  currency_code text,
  lease_token uuid,
  lease_expires_at timestamptz,
  lease_disposition text,
  pilot_contract_version smallint,
  pilot_revision_id uuid,
  pilot_reservation_id uuid,
  pilot_configuration_digest text,
  pilot_authorization_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  authorized_telebirr_epoch bigint;
  checked_at timestamptz;
  current_epoch bigint;
  leased record;
  locked_epoch bigint;
  recovered record;
  switch_count integer;
begin
  perform app.require_private_live_deposit_pilot_executor();

  if p_worker_instance_id is null
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 600 then
    raise exception 'The private-live execution lease request is invalid.';
  end if;

  -- Global financial order: activation control, epoch, switches sorted by key, pilot, then
  -- execution rows. Switch UPDATE locks serialize both provider dispatch and the later pilot-lock
  -- upgrade, avoiding a pair of readers deadlocking while upgrading the same pilot/switch rows.
  select activation_control.current_epoch
    into locked_epoch
    from app.private_trusted_telebirr_activation_control activation_control
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
   for share;

  if locked_epoch is null then
    return;
  end if;

  select activation_epoch.*
    into authority
    from app.private_trusted_telebirr_activation_epochs activation_epoch
   where activation_epoch.epoch = locked_epoch
   for share;

  if authority.epoch is null then
    return;
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  if switch_count <> 5 then
    return;
  end if;

  -- Recovery precedes every live-provider check. It can only tighten one already-expired prepared
  -- attempt into cancellation/review and therefore remains available after stop or natural expiry.
  select recovery.*
    into recovered
    from app.recover_expired_private_live_prepared() recovery;

  if found then
    return query
    select recovered.deposit_intent_id,
           null::uuid,
           recovered.execution_attempt_id,
           null::uuid,
           null::text,
           null::bigint,
           null::text,
           null::uuid,
           null::timestamptz,
           'recovered_expired_prepared'::text,
           null::smallint,
           null::uuid,
           null::uuid,
           null::text,
           null::uuid;
    return;
  end if;

  -- This locks the current pilot and evaluates authoritative time after the control, epoch, and
  -- sorted switch locks. A null result excludes TeleBirr from queue selection without excluding
  -- an independently authorized CBE Birr reservation behind it.
  authorized_telebirr_epoch := app.current_private_trusted_telebirr_activation_epoch();

  select lease.*
    into leased
    from app.lease_private_live_deposit_by_provider(
      p_worker_instance_id,
      p_lease_seconds,
      authorized_telebirr_epoch is not distinct from locked_epoch
        and locked_epoch > 0
    ) lease;

  if not found then
    return;
  end if;

  if leased.lease_disposition is null
    or leased.lease_disposition <> 'execution'
    or leased.provider_code_snapshot is null
    or leased.provider_code_snapshot not in ('cbe_birr', 'telebirr') then
    raise exception 'The provider-dispatched private-live lease returned invalid authority.';
  end if;

  -- CBE Birr remains governed by the existing immutable pilot reservation and switch boundary.
  -- It never receives a trusted-TeleBirr epoch binding.
  if leased.provider_code_snapshot = 'cbe_birr' then
    if exists (
      select 1
        from app.private_live_deposit_execution_epoch_bindings epoch_binding
       where epoch_binding.execution_attempt_id = leased.execution_attempt_id
    ) then
      raise exception 'A CBE Birr execution cannot carry TeleBirr activation authority.';
    end if;

    return query
    select leased.deposit_intent_id,
           leased.execution_job_id,
           leased.execution_attempt_id,
           leased.platform_agent_account_id,
           leased.player_id,
           leased.amount_minor,
           leased.currency_code,
           leased.lease_token,
           leased.lease_expires_at,
           leased.lease_disposition,
           leased.pilot_contract_version,
           leased.pilot_revision_id,
           leased.pilot_reservation_id,
           leased.pilot_configuration_digest,
           leased.pilot_authorization_token;
    return;
  end if;

  -- The provider-aware lease now holds the sorted switch rows, pilot, job, intent, attempt, agent,
  -- and authorization lineage. Re-read TeleBirr authority only after those blocking locks and
  -- evaluate time afterward; an error rolls the lease back atomically.
  current_epoch := app.current_private_trusted_telebirr_activation_epoch();
  checked_at := pg_catalog.clock_timestamp();

  if authorized_telebirr_epoch is distinct from locked_epoch
    or current_epoch is distinct from locked_epoch
    or authority.authority_state <> 'active'
    or authority.revoked_at is not null
    or checked_at < authority.active_from
    or checked_at >= authority.expires_at then
    raise exception 'The trusted TeleBirr activation epoch expired while leasing execution.';
  end if;

  if leased.pilot_revision_id is distinct from authority.pilot_revision_id
    or leased.pilot_configuration_digest is distinct from authority.configuration_digest
    or leased.pilot_reservation_id is null
    or leased.execution_attempt_id is null
    or leased.execution_job_id is null
    or leased.deposit_intent_id is null
    or leased.platform_agent_account_id is null then
    raise exception 'The private-live execution lease does not match activation authority.';
  end if;

  -- The public return contract predates activation epochs. Preserve it exactly and require the
  -- complete existing lease window to end no later than the epoch instead of adding columns.
  if leased.lease_expires_at is null
    or leased.lease_expires_at > authority.expires_at then
    raise exception 'The private-live execution lease window exceeds activation authority.';
  end if;

  insert into app.private_live_deposit_execution_epoch_bindings (
    execution_attempt_id,
    execution_job_id,
    deposit_intent_id,
    activation_epoch,
    pilot_revision_id,
    pilot_reservation_id,
    pilot_configuration_digest,
    platform_agent_account_id,
    bound_at
  ) values (
    leased.execution_attempt_id,
    leased.execution_job_id,
    leased.deposit_intent_id,
    locked_epoch,
    leased.pilot_revision_id,
    leased.pilot_reservation_id,
    leased.pilot_configuration_digest,
    leased.platform_agent_account_id,
    checked_at
  );

  return query
  select leased.deposit_intent_id,
         leased.execution_job_id,
         leased.execution_attempt_id,
         leased.platform_agent_account_id,
         leased.player_id,
         leased.amount_minor,
         leased.currency_code,
         leased.lease_token,
         leased.lease_expires_at,
         leased.lease_disposition,
         leased.pilot_contract_version,
         leased.pilot_revision_id,
         leased.pilot_reservation_id,
         leased.pilot_configuration_digest,
         leased.pilot_authorization_token;
end;
$$;

create function app.fence_private_live_deposit_execution_final_action(
  p_execution_attempt_id uuid,
  p_lease_token uuid,
  p_pilot_revision_id uuid,
  p_pilot_reservation_id uuid,
  p_pilot_authorization_token uuid
)
returns table (
  deposit_intent_id uuid,
  execution_attempt_id uuid,
  final_action_fenced_at timestamptz,
  first_fence_acquired boolean,
  pilot_contract_version smallint,
  pilot_revision_id uuid,
  pilot_reservation_id uuid,
  pilot_configuration_digest text,
  pilot_authorization_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  pilot_authority record;
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  binding app.private_live_deposit_execution_epoch_bindings%rowtype;
  checked_at timestamptz;
  current_agent_account_id uuid;
  current_epoch bigint;
  current_job_id uuid;
  fenced record;
  locked_epoch bigint;
  provider_code text;
  resolved_deposit_intent_id uuid;
  switch_count integer;
begin
  perform app.require_private_live_deposit_pilot_executor();

  if p_execution_attempt_id is null
    or p_lease_token is null
    or p_pilot_revision_id is null
    or p_pilot_reservation_id is null
    or p_pilot_authorization_token is null then
    raise exception 'The epoch-bound private-live final-action fence request is invalid.';
  end if;

  -- Take activation authority and every switch before resolving the immutable provider lineage.
  -- Emergency revoke and epoch advance cannot interleave after these locks are held, while CBE
  -- remains independent from whether the retained TeleBirr epoch is active.
  select activation_control.current_epoch
    into locked_epoch
    from app.private_trusted_telebirr_activation_control activation_control
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
   for share;

  if locked_epoch is null then
    raise exception 'Private-live activation control is unavailable.';
  end if;

  select activation_epoch.*
    into authority
    from app.private_trusted_telebirr_activation_epochs activation_epoch
   where activation_epoch.epoch = locked_epoch
   for share;

  if authority.epoch is null then
    raise exception 'Private-live activation authority is unavailable.';
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  if switch_count <> 5 then
    raise exception 'The private-live financial switch set is incomplete.';
  end if;

  -- Resolve the intent without a row lock, then let the existing authorization routine acquire
  -- pilot and execution locks in the established order and revalidate the complete lineage.
  select execution_attempt.deposit_intent_id
    into resolved_deposit_intent_id
    from app.deposit_execution_attempts execution_attempt
   where execution_attempt.id = p_execution_attempt_id;

  if not found then
    raise exception 'The private-live execution attempt is unavailable.';
  end if;

  select pilot_authorization.*
    into pilot_authority
    from app.require_private_live_deposit_pilot_authorization(
      resolved_deposit_intent_id,
      p_execution_attempt_id
    ) pilot_authorization;

  if not found
    or pilot_authority.pilot_revision_id is distinct from p_pilot_revision_id
    or pilot_authority.pilot_reservation_id is distinct from p_pilot_reservation_id
    or pilot_authority.pilot_authorization_token is distinct from p_pilot_authorization_token then
    raise exception 'The private-live lease authorization does not match final action.';
  end if;

  select provider_member.provider_code_snapshot
    into provider_code
    from app.private_live_deposit_pilot_reservations pilot_reservation
    join app.private_live_deposit_pilot_providers provider_member
      on provider_member.pilot_revision_id = pilot_reservation.pilot_revision_id
     and provider_member.payment_provider_id = pilot_reservation.payment_provider_id
     and provider_member.receiver_account_id = pilot_reservation.receiver_account_id
     and provider_member.receiver_account_version = pilot_reservation.receiver_account_version
    join app.payment_providers payment_provider
      on payment_provider.id = provider_member.payment_provider_id
     and payment_provider.code = provider_member.provider_code_snapshot
   where pilot_reservation.id = pilot_authority.pilot_reservation_id
     and pilot_reservation.pilot_revision_id = pilot_authority.pilot_revision_id
     and pilot_reservation.deposit_intent_id = resolved_deposit_intent_id
   for share of pilot_reservation, provider_member, payment_provider;

  if provider_code is null or provider_code not in ('cbe_birr', 'telebirr') then
    raise exception 'The private-live execution provider lineage is unavailable.';
  end if;

  if provider_code = 'telebirr' then
    current_epoch := app.current_private_trusted_telebirr_activation_epoch();
    checked_at := pg_catalog.clock_timestamp();
    if current_epoch is distinct from locked_epoch
      or authority.authority_state <> 'active'
      or authority.revoked_at is not null
      or checked_at < authority.active_from
      or checked_at >= authority.expires_at then
      raise exception 'The trusted TeleBirr activation epoch is not currently authorized.';
    end if;
  end if;

  select fence.*
    into fenced
    from app.fence_private_live_deposit_pre_epoch(
      p_execution_attempt_id,
      p_lease_token,
      p_pilot_revision_id,
      p_pilot_reservation_id,
      p_pilot_authorization_token
    ) fence;

  if not found then
    raise exception 'The provider-dispatched private-live final-action fence returned no authority.';
  end if;

  -- The retained fence now owns the relevant switch, pilot, intent, job, attempt, and agent locks.
  -- Lock and validate the immutable binding only after them to preserve global lock order.
  select epoch_binding.*
    into binding
    from app.private_live_deposit_execution_epoch_bindings epoch_binding
   where epoch_binding.execution_attempt_id = p_execution_attempt_id
   for share;

  select execution_attempt.deposit_job_id,
         execution_attempt.platform_agent_account_id
    into current_job_id,
         current_agent_account_id
    from app.deposit_execution_attempts execution_attempt
   where execution_attempt.id = p_execution_attempt_id
     and execution_attempt.deposit_intent_id = fenced.deposit_intent_id
   for share;

  if provider_code = 'cbe_birr' then
    if binding.execution_attempt_id is not null then
      raise exception 'A CBE Birr execution cannot carry TeleBirr activation authority.';
    end if;

    return query
    select fenced.deposit_intent_id,
           fenced.execution_attempt_id,
           fenced.final_action_fenced_at,
           fenced.first_fence_acquired,
           fenced.pilot_contract_version,
           fenced.pilot_revision_id,
           fenced.pilot_reservation_id,
           fenced.pilot_configuration_digest,
           fenced.pilot_authorization_token;
    return;
  end if;

  if binding.execution_attempt_id is null then
    raise exception 'The TeleBirr execution attempt has no activation epoch binding.';
  end if;

  current_epoch := app.current_private_trusted_telebirr_activation_epoch();
  checked_at := pg_catalog.clock_timestamp();

  if current_epoch is distinct from locked_epoch
    or binding.activation_epoch is distinct from locked_epoch
    or checked_at < authority.active_from
    or checked_at >= authority.expires_at then
    raise exception 'The private-live execution activation epoch changed before final action.';
  end if;

  if binding.deposit_intent_id is distinct from fenced.deposit_intent_id
    or binding.execution_attempt_id is distinct from fenced.execution_attempt_id
    or binding.execution_job_id is distinct from current_job_id
    or binding.platform_agent_account_id is distinct from current_agent_account_id
    or binding.pilot_revision_id is distinct from fenced.pilot_revision_id
    or binding.pilot_revision_id is distinct from authority.pilot_revision_id
    or binding.pilot_reservation_id is distinct from fenced.pilot_reservation_id
    or binding.pilot_configuration_digest is distinct from fenced.pilot_configuration_digest
    or binding.pilot_configuration_digest is distinct from authority.configuration_digest then
    raise exception 'The private-live execution epoch binding does not match final action.';
  end if;

  -- The existing browser adapter permits final action only within ten seconds of the database
  -- fence. Require that complete window to fit inside the epoch because the legacy return contract
  -- cannot carry activation expiry additively.
  if fenced.final_action_fenced_at is null
    or fenced.final_action_fenced_at + interval '10 seconds' > authority.expires_at then
    raise exception 'The private-live final-action window exceeds activation authority.';
  end if;

  return query
  select fenced.deposit_intent_id,
         fenced.execution_attempt_id,
         fenced.final_action_fenced_at,
         fenced.first_fence_acquired,
         fenced.pilot_contract_version,
         fenced.pilot_revision_id,
         fenced.pilot_reservation_id,
         fenced.pilot_configuration_digest,
         fenced.pilot_authorization_token;
end;
$$;

alter table app.private_live_deposit_execution_epoch_bindings enable row level security;
alter table app.private_live_deposit_execution_epoch_bindings force row level security;
alter table app.private_live_deposit_execution_epoch_bindings owner to postgres;

alter function app.reject_private_live_execution_epoch_binding_mutation() owner to postgres;
alter function app.reject_private_live_execution_epoch_binding_truncate() owner to postgres;
alter function app.recover_expired_private_live_prepared() owner to postgres;
alter function app.lease_private_live_deposit_by_provider(uuid, integer, boolean)
  owner to postgres;
alter function app.get_private_live_deposit_pilot_status_by_admin_id(uuid, uuid)
  owner to postgres;
alter function app.lease_private_live_deposit_pre_epoch(uuid, integer) owner to postgres;
alter function app.fence_private_live_deposit_pre_epoch(uuid, uuid, uuid, uuid, uuid)
  owner to postgres;
alter function app.lease_next_private_live_deposit_execution(uuid, integer) owner to postgres;
alter function app.fence_private_live_deposit_execution_final_action(
  uuid, uuid, uuid, uuid, uuid
) owner to postgres;

revoke all privileges on table app.private_live_deposit_execution_epoch_bindings
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

revoke all on function
  app.reject_private_live_execution_epoch_binding_mutation(),
  app.reject_private_live_execution_epoch_binding_truncate(),
  app.recover_expired_private_live_prepared(),
  app.lease_private_live_deposit_by_provider(uuid, integer, boolean),
  app.get_private_live_deposit_pilot_status_by_admin_id(uuid, uuid),
  app.lease_private_live_deposit_pre_epoch(uuid, integer),
  app.fence_private_live_deposit_pre_epoch(uuid, uuid, uuid, uuid, uuid),
  app.lease_next_private_live_deposit_execution(uuid, integer),
  app.fence_private_live_deposit_execution_final_action(uuid, uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

grant execute on function app.lease_next_private_live_deposit_execution(uuid, integer)
  to fetanagent_deposit_executor;
grant execute on function app.fence_private_live_deposit_execution_final_action(
  uuid, uuid, uuid, uuid, uuid
) to fetanagent_deposit_executor;

comment on table app.private_live_deposit_execution_epoch_bindings is
  'Owner-only immutable binding between one private-live execution attempt and the exact trusted TeleBirr activation epoch that leased it. No lease or pilot authorization token is retained here.';
comment on function app.recover_expired_private_live_prepared() is
  'Owner-only recovery primitive for exactly one expired prepared private-live execution. It can only cancel into review and contains no fresh lease path.';
comment on function app.lease_private_live_deposit_by_provider(uuid, integer, boolean) is
  'Owner-only provider-aware fresh lease primitive. Immutable reservation lineage and its exact live provider switch select CBE Birr or, only when explicitly allowed by its caller, TeleBirr; it performs no expired-work recovery.';
comment on function app.get_private_live_deposit_pilot_status_by_admin_id(uuid, uuid) is
  'Owner-only private-pilot aggregate status. Financial activity requires both common financial switches and at least one exact live provider lane configured in this pilot; unconfigured live lanes never count.';
comment on function app.lease_next_private_live_deposit_execution(uuid, integer) is
  'Provider-dispatched private-live executor lease. CBE Birr retains existing pilot authority without an epoch binding; TeleBirr requires and atomically records the current activation epoch; expired prepared work remains recoverable after disable.';
comment on function app.fence_private_live_deposit_execution_final_action(
  uuid, uuid, uuid, uuid, uuid
) is
  'Provider-dispatched private-live final-action fence. CBE Birr retains existing pilot authority and must have no TeleBirr binding; TeleBirr requires its immutable lease epoch. Cancellation and reconciliation remain epoch-independent.';

commit;
