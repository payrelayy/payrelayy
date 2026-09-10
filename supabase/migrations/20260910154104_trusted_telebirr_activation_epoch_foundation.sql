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
  checked_at timestamptz := pg_catalog.clock_timestamp();
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

create function app.lock_private_trusted_telebirr_activation_for_switch_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform activation_control.control_key
    from app.private_trusted_telebirr_activation_control activation_control
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
   for share;

  if not found then
    raise exception 'Trusted TeleBirr activation control is unavailable.';
  end if;
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
  checked_at timestamptz := pg_catalog.clock_timestamp();
  switch_count integer;
begin
  select activation_epoch.*
    into authority
    from app.private_trusted_telebirr_activation_control activation_control
    join app.private_trusted_telebirr_activation_epochs activation_epoch
      on activation_epoch.epoch = activation_control.current_epoch
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
   for share of activation_control, activation_epoch;

  if authority.epoch is null
    or authority.authority_state <> 'active'
    or authority.revoked_at is not null
    or checked_at < authority.active_from
    or checked_at >= authority.expires_at
    or exists (
      select 1
        from app.private_trusted_telebirr_emergency_disable_intents emergency_intent
       where emergency_intent.expected_epoch = authority.epoch
    ) then
    return null;
  end if;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = authority.pilot_revision_id
   for share;

  if pilot.id is null
    or pilot.status <> 'armed'
    or pilot.configuration_digest is distinct from authority.configuration_digest
    or pilot.active_from is distinct from authority.active_from
    or pilot.expires_at is distinct from authority.expires_at then
    return null;
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
  get diagnostics switch_count = row_count;

  if switch_count <> 5
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
  checked_at timestamptz := pg_catalog.clock_timestamp();
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

  if new.settings <> case
    when new.feature_key = 'private_live_deposit_pilot'
      then pg_catalog.jsonb_build_object(
        'contract_version', 1,
        'pilot_revision_id', pilot.id,
        'configuration_digest', pilot.configuration_digest
      )
    else '{}'::jsonb
  end then
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

create trigger feature_switches_trusted_telebirr_activation_lock
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
  existing_intent app.private_trusted_telebirr_emergency_disable_intents%rowtype;
  emergency_at timestamptz := pg_catalog.clock_timestamp();
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
  rename to load_next_private_live_telebirr_staged_evidence_before_activation_epoch;

revoke all on function app.load_next_private_live_telebirr_staged_evidence_before_activation_epoch()
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
    from app.load_next_private_live_telebirr_staged_evidence_before_activation_epoch() staged;
end;
$$;

alter function app.load_private_live_telebirr_verification_authority(
  uuid, uuid, timestamptz
) rename to load_private_live_telebirr_verification_authority_before_activation_epoch;

revoke all on function app.load_private_live_telebirr_verification_authority_before_activation_epoch(
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

  authority := app.load_private_live_telebirr_verification_authority_before_activation_epoch(
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
) rename to complete_private_live_telebirr_verification_before_activation_epoch;

revoke all on function app.complete_private_live_telebirr_verification_before_activation_epoch(
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
    from app.complete_private_live_telebirr_verification_before_activation_epoch(
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
