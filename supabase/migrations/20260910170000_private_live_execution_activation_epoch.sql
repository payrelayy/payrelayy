-- Bind every newly leased private-live deposit execution attempt to the current trusted TeleBirr
-- activation epoch, and require the same epoch to remain authoritative when final action is fenced.
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
  checked_at timestamptz;
  current_epoch bigint;
  leased record;
  locked_epoch bigint;
begin
  perform app.require_private_live_deposit_pilot_executor();

  -- Global financial order: activation control, epoch, switches sorted by key, pilot, then
  -- execution rows. The retained implementation takes every lock from switches onward.
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

  if authority.epoch is null
    or authority.authority_state <> 'active'
    or authority.revoked_at is not null
    or exists (
      select 1
        from app.private_trusted_telebirr_emergency_disable_intents emergency_intent
       where emergency_intent.expected_epoch = authority.epoch
    ) then
    return;
  end if;

  select lease.*
    into leased
    from app.lease_private_live_deposit_pre_epoch(
      p_worker_instance_id,
      p_lease_seconds
    ) lease;

  if not found then
    return;
  end if;

  -- Expired-prepared recovery authorizes no final action and creates no new binding. Preserve its
  -- existing result exactly so cleanup can run when an otherwise-current pilot is available.
  if leased.lease_disposition = 'recovered_expired_prepared' then
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

  if leased.lease_disposition <> 'execution' then
    raise exception 'The epoch-bound private-live lease returned an invalid disposition.';
  end if;

  -- The retained lease now holds the sorted switch rows, pilot, job, intent, attempt, agent, and
  -- authorization lineage. Re-read authority only after those blocking locks and evaluate time
  -- afterward; an error rolls the retained lease back atomically.
  current_epoch := app.current_private_trusted_telebirr_activation_epoch();
  checked_at := pg_catalog.clock_timestamp();

  if current_epoch is distinct from locked_epoch
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
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  binding app.private_live_deposit_execution_epoch_bindings%rowtype;
  checked_at timestamptz;
  current_agent_account_id uuid;
  current_epoch bigint;
  current_job_id uuid;
  fenced record;
  locked_epoch bigint;
begin
  perform app.require_private_live_deposit_pilot_executor();

  if p_execution_attempt_id is null
    or p_lease_token is null
    or p_pilot_revision_id is null
    or p_pilot_reservation_id is null
    or p_pilot_authorization_token is null then
    raise exception 'The epoch-bound private-live final-action fence request is invalid.';
  end if;

  -- Take activation authority before the retained function takes switches, pilot, and execution
  -- locks. Emergency revoke and epoch advance cannot interleave after these locks are held.
  select activation_control.current_epoch
    into locked_epoch
    from app.private_trusted_telebirr_activation_control activation_control
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
   for share;

  if locked_epoch is null then
    raise exception 'The trusted TeleBirr activation epoch is not currently authorized.';
  end if;

  select activation_epoch.*
    into authority
    from app.private_trusted_telebirr_activation_epochs activation_epoch
   where activation_epoch.epoch = locked_epoch
   for share;

  if authority.epoch is null
    or authority.authority_state <> 'active'
    or authority.revoked_at is not null
    or exists (
      select 1
        from app.private_trusted_telebirr_emergency_disable_intents emergency_intent
       where emergency_intent.expected_epoch = authority.epoch
    ) then
    raise exception 'The trusted TeleBirr activation epoch is not currently authorized.';
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
    raise exception 'The epoch-bound private-live final-action fence returned no authority.';
  end if;

  -- The retained fence now owns the relevant switch, pilot, intent, job, attempt, and agent locks.
  -- Lock and validate the immutable binding only after them to preserve global lock order.
  select epoch_binding.*
    into binding
    from app.private_live_deposit_execution_epoch_bindings epoch_binding
   where epoch_binding.execution_attempt_id = p_execution_attempt_id
   for share;

  if binding.execution_attempt_id is null then
    raise exception 'The private-live execution attempt has no activation epoch binding.';
  end if;

  select execution_attempt.deposit_job_id,
         execution_attempt.platform_agent_account_id
    into current_job_id,
         current_agent_account_id
    from app.deposit_execution_attempts execution_attempt
   where execution_attempt.id = p_execution_attempt_id
     and execution_attempt.deposit_intent_id = fenced.deposit_intent_id
   for share;

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
comment on function app.lease_next_private_live_deposit_execution(uuid, integer) is
  'Private-live executor lease interlocked by the current database activation epoch. It preserves the legacy return contract and atomically records one immutable epoch binding.';
comment on function app.fence_private_live_deposit_execution_final_action(
  uuid, uuid, uuid, uuid, uuid
) is
  'Private-live final-action fence interlocked by the immutable lease epoch. Expiry, revoke, emergency intent, or epoch advance rolls the fence back; cancellation and reconciliation remain epoch-independent.';

commit;
