-- Database-owned activation epoch and emergency-disable foundation for trusted TeleBirr work.
--
-- This migration is deliberately one-way safe: it seeds only epoch zero in `disabled` state and
-- creates no function that can insert or select a live epoch. A later, separately reviewed Owner
-- activation boundary must create a bounded epoch, advance the singleton pointer, and make the
-- exact switch set live in one transaction. Until then, a live TeleBirr switch write is rejected
-- and the trusted verifier receives an empty queue. The no-money shadow verifier is untouched.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

-- Hold a write-conflicting table lock from the prerequisite check through trigger installation and
-- the final revalidation. An ordinary SELECT would allow a privileged switch writer to commit live
-- state after preflight but before CREATE TRIGGER acquires its own table lock.
lock table app.feature_switches in share row exclusive mode;

do $trusted_telebirr_activation_preflight$
declare
  safe_switch_count integer;
begin
  select pg_catalog.count(*)::integer
    into safe_switch_count
    from app.feature_switches feature_switch
   where (
     feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'telebirr_authoritative_verification'
     )
     and feature_switch.mode = 'disabled'
     and feature_switch.settings = '{}'::jsonb
   ) or (
     feature_switch.feature_key = 'private_live_deposit_pilot'
     and feature_switch.mode in ('disabled', 'dry_run')
   );

  if safe_switch_count <> 5 then
    raise exception
      'Trusted TeleBirr activation foundation requires every financial switch to be non-live.';
  end if;
end;
$trusted_telebirr_activation_preflight$;

create table app.private_trusted_telebirr_activation_epochs (
  epoch bigint primary key check (epoch >= 0),
  authority_state text not null default 'disabled'
    check (authority_state in ('disabled', 'active')),
  pilot_revision_id uuid
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  configuration_digest text,
  active_from timestamptz,
  expires_at timestamptz,
  activated_by_admin_id uuid references app.admin_users (id) on delete restrict,
  activated_at timestamptz,
  revoked_at timestamptz,
  revocation_reason_code text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_trusted_telebirr_activation_epoch_shape check (
    (
      epoch = 0
      and authority_state = 'disabled'
      and pilot_revision_id is null
      and configuration_digest is null
      and active_from is null
      and expires_at is null
      and activated_by_admin_id is null
      and activated_at is null
      and revoked_at is null
      and revocation_reason_code is null
    ) or (
      epoch > 0
      and authority_state = 'active'
      and pilot_revision_id is not null
      and configuration_digest ~ '^sha256:[0-9a-f]{64}$'
      and active_from is not null
      and expires_at > active_from
      and expires_at <= active_from + interval '24 hours'
      and activated_by_admin_id is not null
      and activated_at is not null
      and activated_at < expires_at
      and (
        (revoked_at is null and revocation_reason_code is null)
        or (
          revoked_at is not null
          and revoked_at >= activated_at
          and revocation_reason_code in (
            'owner_stop',
            'provider_incident',
            'parser_drift',
            'execution_uncertainty',
            'cap_review'
          )
        )
      )
    )
  )
);

create unique index private_trusted_telebirr_one_unrevoked_active_epoch_idx
  on app.private_trusted_telebirr_activation_epochs ((true))
  where authority_state = 'active' and revoked_at is null;

create table app.private_trusted_telebirr_activation_control (
  control_key text primary key
    check (control_key = 'trusted_telebirr_financial_authority'),
  current_epoch bigint not null unique
    references app.private_trusted_telebirr_activation_epochs (epoch) on delete restrict,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table app.private_trusted_telebirr_emergency_disable_intents (
  request_key uuid primary key,
  expected_epoch bigint not null
    references app.private_trusted_telebirr_activation_epochs (epoch) on delete restrict,
  requested_by_admin_id uuid not null references app.admin_users (id) on delete restrict,
  reason_code text not null check (
    reason_code in (
      'owner_stop',
      'provider_incident',
      'parser_drift',
      'execution_uncertainty',
      'cap_review'
    )
  ),
  requested_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_trusted_telebirr_emergency_request_key_v4 check (
    request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  unique (expected_epoch)
);

insert into app.private_trusted_telebirr_activation_epochs (epoch)
values (0);

insert into app.private_trusted_telebirr_activation_control (control_key, current_epoch)
values ('trusted_telebirr_financial_authority', 0);

create function app.reject_private_trusted_telebirr_activation_retained_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Trusted TeleBirr activation history is append-only.';
end;
$$;

create function app.reject_private_trusted_telebirr_activation_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Trusted TeleBirr activation history cannot be truncated.';
end;
$$;

create function app.enforce_private_trusted_telebirr_epoch_revocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.epoch is distinct from old.epoch
    or new.authority_state is distinct from old.authority_state
    or new.pilot_revision_id is distinct from old.pilot_revision_id
    or new.configuration_digest is distinct from old.configuration_digest
    or new.active_from is distinct from old.active_from
    or new.expires_at is distinct from old.expires_at
    or new.activated_by_admin_id is distinct from old.activated_by_admin_id
    or new.activated_at is distinct from old.activated_at
    or new.created_at is distinct from old.created_at then
    raise exception 'Trusted TeleBirr activation epoch authority is immutable.';
  end if;

  if old.revoked_at is not null
    or new.revoked_at is null
    or new.revocation_reason_code is null then
    raise exception 'Trusted TeleBirr activation epoch may be revoked exactly once.';
  end if;

  return new;
end;
$$;

create function app.enforce_private_trusted_telebirr_control_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate app.private_trusted_telebirr_activation_epochs%rowtype;
  checked_at timestamptz;
begin
  if new.control_key is distinct from old.control_key
    or new.current_epoch <= old.current_epoch then
    raise exception 'Trusted TeleBirr activation epochs advance monotonically.';
  end if;

  select activation_epoch.*
    into candidate
    from app.private_trusted_telebirr_activation_epochs activation_epoch
   where activation_epoch.epoch = new.current_epoch
   for share;

  -- Authority time is evaluated only after every potentially blocking lock above is held.
  checked_at := pg_catalog.clock_timestamp();

  if candidate.epoch is null
    or candidate.authority_state <> 'active'
    or candidate.revoked_at is not null
    or checked_at < candidate.active_from
    or checked_at >= candidate.expires_at
    or exists (
      select 1
        from app.private_trusted_telebirr_emergency_disable_intents emergency_intent
       where emergency_intent.expected_epoch = candidate.epoch
    ) then
    raise exception 'The requested trusted TeleBirr activation epoch is not current authority.';
  end if;

  new.updated_at := checked_at;
  return new;
end;
$$;

create function app.lock_private_trusted_telebirr_activation_authority()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_epoch bigint;
begin
  select activation_control.current_epoch
    into locked_epoch
    from app.private_trusted_telebirr_activation_control activation_control
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
   for share;

  if locked_epoch is null then
    raise exception 'Trusted TeleBirr activation authority is unavailable.';
  end if;

  perform activation_epoch.epoch
    from app.private_trusted_telebirr_activation_epochs activation_epoch
   where activation_epoch.epoch = locked_epoch
   for share;

  if not found then
    raise exception 'Trusted TeleBirr activation authority is unavailable.';
  end if;
end;
$$;

create function app.lock_private_trusted_telebirr_activation_for_switch_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.lock_private_trusted_telebirr_activation_authority();
  return null;
end;
$$;

create function app.current_private_trusted_telebirr_activation_epoch()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  checked_at timestamptz;
  locked_epoch bigint;
  switch_count integer;
begin
  select activation_control.current_epoch
    into locked_epoch
    from app.private_trusted_telebirr_activation_control activation_control
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
   for share;

  if locked_epoch is null then
    return null;
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
    return null;
  end if;

  -- The repository-wide financial order is authority, switches, then pilot. Existing settlement,
  -- executor, and Owner-stop paths already take switches before pilot, so reversing those two rows
  -- here would introduce a lock-upgrade deadlock.
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
  get diagnostics switch_count = row_count;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = authority.pilot_revision_id
   for share;

  -- Do not let time spent waiting for either switch or pilot locks preserve expired authority.
  checked_at := pg_catalog.clock_timestamp();

  if checked_at < authority.active_from
    or checked_at >= authority.expires_at
    or pilot.id is null
    or pilot.status <> 'armed'
    or pilot.configuration_digest is distinct from authority.configuration_digest
    or pilot.active_from is distinct from authority.active_from
    or pilot.expires_at is distinct from authority.expires_at
    or switch_count <> 5
    or not exists (
      select 1
        from app.feature_switches feature_switch
       where feature_switch.feature_key = 'cbe_birr_authoritative_verification'
         and feature_switch.mode = 'disabled'
         and feature_switch.settings = '{}'::jsonb
    )
    or (
      select pg_catalog.count(*)
        from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'deposit_execution',
         'payment_verification',
         'telebirr_authoritative_verification'
       )
         and feature_switch.mode = 'live'
         and feature_switch.settings = '{}'::jsonb
    ) <> 3
    or not exists (
      select 1
        from app.feature_switches feature_switch
       where feature_switch.feature_key = 'private_live_deposit_pilot'
         and feature_switch.mode = 'live'
         and feature_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    ) then
    return null;
  end if;

  return authority.epoch;
end;
$$;

create function app.enforce_private_trusted_telebirr_live_switch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  telebirr_is_live boolean;
  checked_at timestamptz;
begin
  if tg_op = 'DELETE' then
    if old.feature_key in (
      'deposit_execution',
      'payment_verification',
      'private_live_deposit_pilot',
      'telebirr_authoritative_verification'
    ) then
      raise exception 'Trusted TeleBirr financial switch rows cannot be deleted.';
    end if;
    return old;
  end if;

  if new.feature_key not in (
    'deposit_execution',
    'payment_verification',
    'private_live_deposit_pilot',
    'telebirr_authoritative_verification'
  ) then
    return new;
  end if;

  select feature_switch.mode = 'live'
    into telebirr_is_live
    from app.feature_switches feature_switch
   where feature_switch.feature_key = 'telebirr_authoritative_verification';

  -- Every transition away from live authority is always allowed. Once TeleBirr is already live,
  -- writes that keep another member live must remain bound to the same epoch. While TeleBirr is
  -- disabled, CBE Birr may continue using the shared payment/deposit switches independently.
  if new.mode <> 'live' then
    return new;
  end if;

  if new.feature_key <> 'telebirr_authoritative_verification'
    and telebirr_is_live is not true then
    return new;
  end if;

  select activation_epoch.*
    into authority
    from app.private_trusted_telebirr_activation_control activation_control
    join app.private_trusted_telebirr_activation_epochs activation_epoch
      on activation_epoch.epoch = activation_control.current_epoch
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
   for share of activation_control, activation_epoch;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = authority.pilot_revision_id
   for share;

  -- The statement trigger already holds activation control and epoch before PostgreSQL locks the
  -- switch row. Refresh time after the remaining pilot lock so a lock wait cannot extend authority.
  checked_at := pg_catalog.clock_timestamp();

  if authority.epoch is null
    or authority.authority_state <> 'active'
    or authority.revoked_at is not null
    or checked_at < authority.active_from
    or checked_at >= authority.expires_at
    or pilot.id is null
    or pilot.status <> 'armed'
    or pilot.configuration_digest is distinct from authority.configuration_digest
    or pilot.active_from is distinct from authority.active_from
    or pilot.expires_at is distinct from authority.expires_at
    or exists (
      select 1
        from app.private_trusted_telebirr_emergency_disable_intents emergency_intent
       where emergency_intent.expected_epoch = authority.epoch
    ) then
    raise exception 'A current trusted TeleBirr activation epoch is required for live switches.';
  end if;

  if new.settings <> (case
    when new.feature_key = 'private_live_deposit_pilot'
      then pg_catalog.jsonb_build_object(
        'contract_version', 1,
        'pilot_revision_id', pilot.id,
        'configuration_digest', pilot.configuration_digest
      )
    else '{}'::jsonb
  end) then
    raise exception 'The live switch does not match the trusted TeleBirr activation epoch.';
  end if;

  return new;
end;
$$;

create function app.enforce_private_trusted_telebirr_complete_switch_set()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
      from app.feature_switches feature_switch
     where feature_switch.feature_key = 'telebirr_authoritative_verification'
       and feature_switch.mode = 'live'
  ) and app.current_private_trusted_telebirr_activation_epoch() is null then
    raise exception
      'Live TeleBirr authority requires the complete epoch-bound financial switch set.';
  end if;
  return null;
end;
$$;

-- PostgreSQL fires same-kind triggers in name order. The `00` prefix guarantees activation
-- authority is acquired before the existing readiness serializer locks its gate row.
create trigger feature_switches_00_trusted_telebirr_activation_lock
before insert or update or delete on app.feature_switches
for each statement
execute function app.lock_private_trusted_telebirr_activation_for_switch_write();

create trigger feature_switches_trusted_telebirr_activation_guard
before insert or update or delete on app.feature_switches
for each row
execute function app.enforce_private_trusted_telebirr_live_switch();

create constraint trigger feature_switches_trusted_telebirr_complete_set
after insert or update or delete on app.feature_switches
deferrable initially deferred
for each row
execute function app.enforce_private_trusted_telebirr_complete_switch_set();

create trigger private_trusted_telebirr_activation_epochs_revoke_only
before update on app.private_trusted_telebirr_activation_epochs
for each row
execute function app.enforce_private_trusted_telebirr_epoch_revocation();

create trigger private_trusted_telebirr_activation_epochs_no_delete
before delete on app.private_trusted_telebirr_activation_epochs
for each row
execute function app.reject_private_trusted_telebirr_activation_retained_mutation();

create trigger private_trusted_telebirr_activation_epochs_no_truncate
before truncate on app.private_trusted_telebirr_activation_epochs
for each statement
execute function app.reject_private_trusted_telebirr_activation_truncate();

create trigger private_trusted_telebirr_activation_control_transition
before update on app.private_trusted_telebirr_activation_control
for each row
execute function app.enforce_private_trusted_telebirr_control_transition();

create trigger private_trusted_telebirr_activation_control_no_delete
before delete on app.private_trusted_telebirr_activation_control
for each row
execute function app.reject_private_trusted_telebirr_activation_retained_mutation();

create trigger private_trusted_telebirr_activation_control_no_truncate
before truncate on app.private_trusted_telebirr_activation_control
for each statement
execute function app.reject_private_trusted_telebirr_activation_truncate();

create trigger private_trusted_telebirr_emergency_intents_immutable
before update or delete on app.private_trusted_telebirr_emergency_disable_intents
for each row
execute function app.reject_private_trusted_telebirr_activation_retained_mutation();

create trigger private_trusted_telebirr_emergency_intents_no_truncate
before truncate on app.private_trusted_telebirr_emergency_disable_intents
for each statement
execute function app.reject_private_trusted_telebirr_activation_truncate();

-- The legacy arm and stop implementations acquire financial switches before the pilot row. Enter
-- the activation authority first so those Owner paths cannot invert the emergency-disable order.
-- CREATE OR REPLACE preserves the existing function OIDs and their narrowly granted ACLs.
create or replace function app.arm_private_live_deposit_pilot(
  p_actor_auth_user_id uuid,
  p_pilot_revision_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();

  if p_actor_auth_user_id is null then
    raise exception 'The authenticated Owner subject is required.';
  end if;

  select admin_user.id
    into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;

  if actor_admin_id is null and session_user = 'postgres' then
    select admin_user.id
      into actor_admin_id
      from app.admin_users admin_user
     where admin_user.id = p_actor_auth_user_id
       and admin_user.role = 'owner'
       and admin_user.status = 'active'
     for share;
  end if;

  if actor_admin_id is null then
    raise exception 'Only the active Owner can arm the private live-deposit pilot.';
  end if;

  perform app.lock_private_trusted_telebirr_activation_authority();
  perform gate.singleton
    from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton
   for update;
  perform app.arm_private_live_deposit_pilot_by_admin_id(
    actor_admin_id,
    p_pilot_revision_id
  );
end;
$$;

create or replace function app.arm_companion_verified_private_live_telebirr_pilot(
  p_actor_auth_user_id uuid,
  p_pilot_revision_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  context_count integer;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();
  perform app.lock_private_trusted_telebirr_activation_authority();

  perform gate.singleton
    from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton
   for update;

  -- The companion proof reader takes the pilot row. Pre-lock switches and then the pilot before
  -- invoking it so the wrapper cannot invert the shared financial order.
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

  perform pilot_revision.id
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = p_pilot_revision_id
   for update;

  perform app.require_companion_verified_private_live_telebirr_pilot(
    p_actor_auth_user_id,
    p_pilot_revision_id
  );

  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = pg_catalog.pg_backend_pid(),
         pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id(),
         pilot_mutation_mode = 'arm'
   where gate.singleton
     and gate.pilot_mutation_backend_pid is null
     and gate.pilot_mutation_transaction_id is null
     and gate.pilot_mutation_mode is null;
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot mutation context is unavailable.';
  end if;

  begin
    perform app.arm_private_live_deposit_pilot(
      p_actor_auth_user_id,
      p_pilot_revision_id
    );
    perform app.ensure_private_live_telebirr_receiver_profile(p_pilot_revision_id);
  exception when others then
    update app.private_owner_kemerbet_readiness_cohort_gate gate
       set pilot_mutation_backend_pid = null,
           pilot_mutation_transaction_id = null,
           pilot_mutation_mode = null
     where gate.singleton
       and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
       and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
       and gate.pilot_mutation_mode = 'arm';
    raise;
  end;

  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = null,
         pilot_mutation_transaction_id = null,
         pilot_mutation_mode = null
   where gate.singleton
     and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
     and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
     and gate.pilot_mutation_mode = 'arm';
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot mutation context did not close.';
  end if;
end;
$$;

create or replace function app.stop_private_live_deposit_pilot(
  p_actor_auth_user_id uuid,
  p_pilot_revision_id uuid,
  p_reason_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  context_count integer;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();

  if p_actor_auth_user_id is null then
    raise exception 'The authenticated Owner subject is required.';
  end if;

  select admin_user.id
    into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;

  if actor_admin_id is null and session_user = 'postgres' then
    select admin_user.id
      into actor_admin_id
      from app.admin_users admin_user
     where admin_user.id = p_actor_auth_user_id
       and admin_user.role = 'owner'
       and admin_user.status = 'active'
     for share;
  end if;

  if actor_admin_id is null then
    raise exception 'Only the active Owner can stop the private live-deposit pilot.';
  end if;

  perform app.lock_private_trusted_telebirr_activation_authority();

  perform gate.singleton
    from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton
   for update;

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

  perform pilot_revision.id
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = p_pilot_revision_id
   for update;

  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = pg_catalog.pg_backend_pid(),
         pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id(),
         pilot_mutation_mode = 'stop'
   where gate.singleton
     and gate.pilot_mutation_backend_pid is null
     and gate.pilot_mutation_transaction_id is null
     and gate.pilot_mutation_mode is null;
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot mutation context is unavailable.';
  end if;

  begin
    perform app.stop_private_live_deposit_pilot_by_admin_id(
      actor_admin_id,
      p_pilot_revision_id,
      p_reason_code
    );
  exception when others then
    update app.private_owner_kemerbet_readiness_cohort_gate gate
       set pilot_mutation_backend_pid = null,
           pilot_mutation_transaction_id = null,
           pilot_mutation_mode = null
     where gate.singleton
       and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
       and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
       and gate.pilot_mutation_mode = 'stop';
    raise;
  end;

  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = null,
         pilot_mutation_transaction_id = null,
         pilot_mutation_mode = null
   where gate.singleton
     and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
     and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
     and gate.pilot_mutation_mode = 'stop';
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot mutation context did not close.';
  end if;
end;
$$;

create function app.request_private_trusted_telebirr_emergency_disable(
  p_actor_auth_user_id uuid,
  p_expected_epoch bigint,
  p_request_key uuid,
  p_reason_code text
)
returns table (
  activation_epoch bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_admin_id uuid;
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  context_count integer;
  existing_intent app.private_trusted_telebirr_emergency_disable_intents%rowtype;
  emergency_at timestamptz;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();

  if p_actor_auth_user_id is null
    or p_expected_epoch is null
    or p_expected_epoch <= 0
    or p_request_key is null
    or p_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reason_code is null
    or p_reason_code not in (
      'owner_stop',
      'provider_incident',
      'parser_drift',
      'execution_uncertainty',
      'cap_review'
    ) then
    raise exception 'The trusted TeleBirr emergency-disable request is invalid.';
  end if;

  select admin_user.id
    into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;

  if actor_admin_id is null and session_user = 'postgres' then
    select admin_user.id
      into actor_admin_id
      from app.admin_users admin_user
     where admin_user.id = p_actor_auth_user_id
       and admin_user.role = 'owner'
       and admin_user.status = 'active'
     for share;
  end if;

  if actor_admin_id is null then
    raise exception using
      errcode = '42501',
      message = 'Only the active Owner can request trusted TeleBirr emergency disable.';
  end if;

  -- A committed intent is immutable. Resolve it before consulting the moving control pointer so an
  -- exact retry remains idempotent after a later epoch advances, while any changed request key,
  -- actor, epoch, or reason is still rejected as a conflict.
  select emergency_intent.*
    into existing_intent
    from app.private_trusted_telebirr_emergency_disable_intents emergency_intent
   where emergency_intent.request_key = p_request_key
      or emergency_intent.expected_epoch = p_expected_epoch
   for share;

  if existing_intent.request_key is not null then
    if existing_intent.request_key = p_request_key
      and existing_intent.expected_epoch = p_expected_epoch
      and existing_intent.requested_by_admin_id = actor_admin_id
      and existing_intent.reason_code = p_reason_code then
      return query select p_expected_epoch, true;
      return;
    end if;
    raise exception 'The trusted TeleBirr emergency-disable replay conflicts.';
  end if;

  perform activation_control.control_key
    from app.private_trusted_telebirr_activation_control activation_control
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
     and activation_control.current_epoch = p_expected_epoch
   for update;

  if not found then
    raise exception 'The trusted TeleBirr activation epoch changed before emergency disable.';
  end if;

  select activation_epoch.*
    into authority
    from app.private_trusted_telebirr_activation_epochs activation_epoch
   where activation_epoch.epoch = p_expected_epoch
   for update;

  -- Recheck after serializing on control: a concurrent first request may have committed while this
  -- caller waited and must now be replayed or rejected without attempting a duplicate insert.
  select emergency_intent.*
    into existing_intent
    from app.private_trusted_telebirr_emergency_disable_intents emergency_intent
   where emergency_intent.request_key = p_request_key
      or emergency_intent.expected_epoch = p_expected_epoch
   for share;

  if existing_intent.request_key is not null then
    if existing_intent.request_key = p_request_key
      and existing_intent.expected_epoch = p_expected_epoch
      and existing_intent.requested_by_admin_id = actor_admin_id
      and existing_intent.reason_code = p_reason_code then
      return query select p_expected_epoch, true;
      return;
    end if;
    raise exception 'The trusted TeleBirr emergency-disable replay conflicts.';
  end if;

  if authority.authority_state <> 'active' or authority.revoked_at is not null then
    raise exception 'The trusted TeleBirr activation epoch is not revocable.';
  end if;

  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = pg_catalog.pg_backend_pid(),
         pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id(),
         pilot_mutation_mode = 'stop'
   where gate.singleton
     and gate.pilot_mutation_backend_pid is null
     and gate.pilot_mutation_transaction_id is null
     and gate.pilot_mutation_mode is null;
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot mutation context is unavailable.';
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

  perform pilot_revision.id
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = authority.pilot_revision_id
   for update;

  -- Use authority time only after every potentially blocking row lock has been acquired.
  emergency_at := pg_catalog.clock_timestamp();

  insert into app.private_trusted_telebirr_emergency_disable_intents (
    request_key,
    expected_epoch,
    requested_by_admin_id,
    reason_code,
    requested_at
  ) values (
    p_request_key,
    p_expected_epoch,
    actor_admin_id,
    p_reason_code,
    emergency_at
  );

  update app.private_trusted_telebirr_activation_epochs activation_epoch
     set revoked_at = emergency_at,
         revocation_reason_code = p_reason_code
   where activation_epoch.epoch = p_expected_epoch;

  update app.feature_switches feature_switch
     set mode = 'disabled',
         settings = '{}'::jsonb,
         updated_by_admin_id = actor_admin_id
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   );

  update app.private_live_deposit_pilot_revisions pilot_revision
     set status = 'stopped',
         stopped_by_admin_id = actor_admin_id,
         stopped_at = emergency_at,
         stop_reason_code = p_reason_code
   where pilot_revision.id = authority.pilot_revision_id
     and pilot_revision.status in ('draft', 'armed');

  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = null,
         pilot_mutation_transaction_id = null,
         pilot_mutation_mode = null
   where gate.singleton
     and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
     and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
     and gate.pilot_mutation_mode = 'stop';
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot mutation context did not close.';
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
    actor_admin_id,
    'deposit.trusted_telebirr_emergency_disabled',
    'private_live_deposit_pilot',
    authority.pilot_revision_id,
    pg_catalog.jsonb_build_object(
      'contract_version', 1,
      'activation_epoch', p_expected_epoch,
      'reason_code', p_reason_code,
      'financially_active', false
    )
  );

  return query select p_expected_epoch, false;
end;
$$;

alter function app.load_next_private_live_telebirr_staged_evidence()
  rename to load_next_private_live_telebirr_staged_evidence_pre_epoch;

revoke all on function app.load_next_private_live_telebirr_staged_evidence_pre_epoch()
from public, anon, authenticated, service_role,
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime;

create function app.load_next_private_live_telebirr_staged_evidence()
returns table (
  verification_attempt_id uuid,
  lease_token uuid,
  completion_request_key uuid,
  observation_body_digest text,
  signed_assignment jsonb,
  signed_observation jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_trusted_telebirr_verifier_session();

  if app.current_private_trusted_telebirr_activation_epoch() is null then
    return;
  end if;

  return query
  select staged.verification_attempt_id,
         staged.lease_token,
         staged.completion_request_key,
         staged.observation_body_digest,
         staged.signed_assignment,
         staged.signed_observation
    from app.load_next_private_live_telebirr_staged_evidence_pre_epoch() staged;
end;
$$;

alter function app.load_private_live_telebirr_verification_authority(
  uuid, uuid, timestamptz
) rename to load_private_live_telebirr_verification_authority_pre_epoch;

revoke all on function app.load_private_live_telebirr_verification_authority_pre_epoch(
  uuid, uuid, timestamptz
) from public, anon, authenticated, service_role,
       fetanagent_trusted_telebirr_verifier,
       fetanagent_trusted_telebirr_verifier_runtime;

create function app.load_private_live_telebirr_verification_authority(
  p_verification_attempt_id uuid,
  p_lease_token uuid,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authority jsonb;
begin
  perform app.require_trusted_telebirr_verifier_session();

  -- Acquire the epoch before resolving any attempt. A lease obtained before expiry or emergency
  -- revocation therefore cannot read authority afterward, even when its own lease remains valid.
  if app.current_private_trusted_telebirr_activation_epoch() is null then
    raise exception using
      errcode = '42501',
      message = 'The trusted TeleBirr activation epoch is not currently authorized.';
  end if;

  authority := app.load_private_live_telebirr_verification_authority_pre_epoch(
    p_verification_attempt_id,
    p_lease_token,
    p_occurred_at
  );
  if authority is null then
    return null;
  end if;

  return authority;
end;
$$;

alter function app.complete_private_live_telebirr_verification(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) rename to complete_private_live_telebirr_verification_pre_epoch;

revoke all on function app.complete_private_live_telebirr_verification_pre_epoch(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) from public, anon, authenticated, service_role,
       fetanagent_trusted_telebirr_verifier,
       fetanagent_trusted_telebirr_verifier_runtime;

create function app.complete_private_live_telebirr_verification(
  p_verification_attempt_id uuid,
  p_lease_token uuid,
  p_completion_request_key uuid,
  p_observation_body_digest text,
  p_observation_signature_digest text,
  p_replay_identity text,
  p_source_document_digest text,
  p_normalized_facts_digest text,
  p_observed_at timestamptz,
  p_protocol_disposition text,
  p_protocol_reason_code text,
  p_assessment_input_digest text,
  p_assessed_at timestamptz,
  p_disposition text,
  p_reason_code text,
  p_evidence_digest text,
  p_retrieved_at timestamptz,
  p_receipt_principal_amount_minor bigint,
  p_occurred_at timestamptz,
  p_receiver_identity_digest text
)
returns table (
  verification_outcome_id uuid,
  outcome_disposition text,
  outcome_reason_code text,
  deposit_intent_id uuid,
  deposit_payment_claim_id uuid,
  execution_job_id uuid,
  settlement_created boolean,
  already_completed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_trusted_telebirr_verifier_session();

  if app.current_private_trusted_telebirr_activation_epoch() is null then
    raise exception using
      errcode = '42501',
      message = 'The trusted TeleBirr activation epoch is not currently authorized.';
  end if;

  return query
  select completed.verification_outcome_id,
         completed.outcome_disposition,
         completed.outcome_reason_code,
         completed.deposit_intent_id,
         completed.deposit_payment_claim_id,
         completed.execution_job_id,
         completed.settlement_created,
         completed.already_completed
    from app.complete_private_live_telebirr_verification_pre_epoch(
      p_verification_attempt_id,
      p_lease_token,
      p_completion_request_key,
      p_observation_body_digest,
      p_observation_signature_digest,
      p_replay_identity,
      p_source_document_digest,
      p_normalized_facts_digest,
      p_observed_at,
      p_protocol_disposition,
      p_protocol_reason_code,
      p_assessment_input_digest,
      p_assessed_at,
      p_disposition,
      p_reason_code,
      p_evidence_digest,
      p_retrieved_at,
      p_receipt_principal_amount_minor,
      p_occurred_at,
      p_receiver_identity_digest
    ) completed;
end;
$$;

-- Revalidate while the migration-long SHARE ROW EXCLUSIVE lock is still held. This proves the
-- prerequisite remained true through guard installation instead of trusting only the first read.
do $trusted_telebirr_activation_revalidation$
declare
  safe_switch_count integer;
begin
  select pg_catalog.count(*)::integer
    into safe_switch_count
    from app.feature_switches feature_switch
   where (
     feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'telebirr_authoritative_verification'
     )
     and feature_switch.mode = 'disabled'
     and feature_switch.settings = '{}'::jsonb
   ) or (
     feature_switch.feature_key = 'private_live_deposit_pilot'
     and feature_switch.mode in ('disabled', 'dry_run')
   );

  if safe_switch_count <> 5 then
    raise exception
      'Trusted TeleBirr activation foundation lost its non-live prerequisite.';
  end if;
end;
$trusted_telebirr_activation_revalidation$;

alter table app.private_trusted_telebirr_activation_epochs enable row level security;
alter table app.private_trusted_telebirr_activation_epochs force row level security;
alter table app.private_trusted_telebirr_activation_control enable row level security;
alter table app.private_trusted_telebirr_activation_control force row level security;
alter table app.private_trusted_telebirr_emergency_disable_intents enable row level security;
alter table app.private_trusted_telebirr_emergency_disable_intents force row level security;

alter table app.private_trusted_telebirr_activation_epochs owner to postgres;
alter table app.private_trusted_telebirr_activation_control owner to postgres;
alter table app.private_trusted_telebirr_emergency_disable_intents owner to postgres;

alter function app.reject_private_trusted_telebirr_activation_retained_mutation()
  owner to postgres;
alter function app.reject_private_trusted_telebirr_activation_truncate() owner to postgres;
alter function app.enforce_private_trusted_telebirr_epoch_revocation() owner to postgres;
alter function app.enforce_private_trusted_telebirr_control_transition() owner to postgres;
alter function app.lock_private_trusted_telebirr_activation_authority() owner to postgres;
alter function app.lock_private_trusted_telebirr_activation_for_switch_write()
  owner to postgres;
alter function app.current_private_trusted_telebirr_activation_epoch() owner to postgres;
alter function app.enforce_private_trusted_telebirr_live_switch() owner to postgres;
alter function app.enforce_private_trusted_telebirr_complete_switch_set() owner to postgres;
alter function app.request_private_trusted_telebirr_emergency_disable(
  uuid, bigint, uuid, text
) owner to postgres;
alter function app.load_next_private_live_telebirr_staged_evidence() owner to postgres;
alter function app.load_private_live_telebirr_verification_authority(
  uuid, uuid, timestamptz
) owner to postgres;
alter function app.complete_private_live_telebirr_verification(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) owner to postgres;

revoke all privileges on table
  app.private_trusted_telebirr_activation_epochs,
  app.private_trusted_telebirr_activation_control,
  app.private_trusted_telebirr_emergency_disable_intents
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
  app.reject_private_trusted_telebirr_activation_retained_mutation(),
  app.reject_private_trusted_telebirr_activation_truncate(),
  app.enforce_private_trusted_telebirr_epoch_revocation(),
  app.enforce_private_trusted_telebirr_control_transition(),
  app.lock_private_trusted_telebirr_activation_authority(),
  app.lock_private_trusted_telebirr_activation_for_switch_write(),
  app.current_private_trusted_telebirr_activation_epoch(),
  app.enforce_private_trusted_telebirr_live_switch(),
  app.enforce_private_trusted_telebirr_complete_switch_set(),
  app.request_private_trusted_telebirr_emergency_disable(uuid, bigint, uuid, text),
  app.load_next_private_live_telebirr_staged_evidence(),
  app.load_private_live_telebirr_verification_authority(uuid, uuid, timestamptz),
  app.complete_private_live_telebirr_verification(
    uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
    text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
  )
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

grant execute on function app.request_private_trusted_telebirr_emergency_disable(
  uuid, bigint, uuid, text
) to fetanagent_owner_control;

grant execute on function app.load_next_private_live_telebirr_staged_evidence()
  to fetanagent_trusted_telebirr_verifier;

grant execute on function
  app.load_private_live_telebirr_verification_authority(uuid, uuid, timestamptz),
  app.complete_private_live_telebirr_verification(
    uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
    text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
  )
to fetanagent_trusted_telebirr_verifier;

comment on table app.private_trusted_telebirr_activation_epochs is
  'Database-owned, bounded trusted TeleBirr authority epochs. Epoch zero is permanently disabled; this migration provides no live-activation writer.';
comment on table app.private_trusted_telebirr_emergency_disable_intents is
  'Append-only Owner emergency intent. Presence for the current epoch invalidates authority before switch shutdown is observed.';
comment on function app.current_private_trusted_telebirr_activation_epoch() is
  'Internal operation-time interlock. Locks and returns only an unexpired, unrevoked epoch whose pilot and exact TeleBirr switch set still match.';
comment on function app.request_private_trusted_telebirr_emergency_disable(
  uuid, bigint, uuid, text
) is
  'Authenticated Owner idempotent emergency boundary. Atomically records intent, revokes the expected epoch, disables all financial/provider switches, and stops its pilot.';
comment on function app.load_next_private_live_telebirr_staged_evidence() is
  'Trusted verifier ingress interlocked by the current database activation epoch. Disabled, expired, revoked, mismatched, or emergency-stopped authority is an empty queue.';
comment on function app.load_private_live_telebirr_verification_authority(
  uuid, uuid, timestamptz
) is
  'Trusted authority reader interlocked before attempt resolution, closing lease-to-authority expiry and revocation races.';
comment on function app.complete_private_live_telebirr_verification(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) is
  'Trusted completion interlocked immediately before settlement; an expired, revoked, mismatched, or emergency-stopped epoch cannot complete a pre-existing lease.';

commit;
