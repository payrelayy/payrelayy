-- Independent Owner pauses for customer deposits. This migration preserves the
-- current live state: both controls start enabled, but no financial switch is
-- changed. A control is an additional veto, never authority to start payment.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.owner_provider_deposit_controls (
  provider_code text primary key references app.payment_providers(code) on delete restrict,
  enabled boolean not null,
  receiver_rotation_pending boolean not null default false,
  changed_at timestamptz not null default pg_catalog.clock_timestamp(),
  changed_by_admin_id uuid references app.admin_users(id) on delete restrict,
  constraint owner_provider_deposit_controls_supported_check
    check (provider_code in ('telebirr', 'cbe_birr'))
);
insert into app.owner_provider_deposit_controls(provider_code, enabled)
values ('telebirr', true), ('cbe_birr', true);
alter table app.owner_provider_deposit_controls owner to postgres;
alter table app.owner_provider_deposit_controls enable row level security;
alter table app.owner_provider_deposit_controls force row level security;
revoke all on app.owner_provider_deposit_controls
  from public, anon, authenticated, service_role;

create table app.owner_provider_deposit_control_requests (
  request_id uuid primary key,
  provider_code text not null references app.owner_provider_deposit_controls(provider_code),
  requested_enabled boolean not null,
  actor_admin_id uuid not null references app.admin_users(id) on delete restrict,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table app.owner_provider_deposit_control_requests owner to postgres;
alter table app.owner_provider_deposit_control_requests enable row level security;
alter table app.owner_provider_deposit_control_requests force row level security;
revoke all on app.owner_provider_deposit_control_requests
  from public, anon, authenticated, service_role;

create function app.require_owner_provider_deposit_enabled(p_provider_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog
as $$
declare v_enabled boolean; v_rotation_pending boolean; v_provider_code text;
begin
  select control.enabled, control.receiver_rotation_pending, control.provider_code
    into v_enabled, v_rotation_pending, v_provider_code
    from app.payment_providers provider
    join app.owner_provider_deposit_controls control
      on control.provider_code = provider.code
    where provider.id = p_provider_id and provider.status = 'active'
    for share of control;
  if v_enabled is distinct from true then
    raise exception 'This payment method is paused by the Owner.';
  end if;
  if v_rotation_pending and app.owner_provider_deposit_readiness(v_provider_code) <> 'ready' then
    raise exception 'The replacement receiver is waiting for current verification.';
  end if;
end;
$$;
alter function app.require_owner_provider_deposit_enabled(uuid) owner to postgres;
revoke all on function app.require_owner_provider_deposit_enabled(uuid)
  from public, anon, authenticated, service_role;

create function app.enforce_owner_provider_deposit_pause()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare v_provider_id uuid;
begin
  if tg_table_name = 'deposit_intents' and tg_op = 'INSERT' then
    if exists (
      select 1 from app.payment_providers provider
      join app.owner_provider_deposit_controls control
        on control.provider_code = provider.code
      join app.receiver_accounts receiver
        on receiver.provider_id = provider.id
          and receiver.status = 'active' and receiver.retired_at is null
      where provider.id = (pg_catalog.to_jsonb(new)->>'payment_provider_id')::uuid
        and control.receiver_rotation_pending
        and receiver.id is distinct from
          (pg_catalog.to_jsonb(new)->>'receiver_account_id')::uuid
    ) then
      raise exception 'The previous receiver requires Owner review.';
    end if;
    perform app.require_owner_provider_deposit_enabled(
      (pg_catalog.to_jsonb(new)->>'payment_provider_id')::uuid);
  elsif tg_table_name = 'receiver_sms_deposit_candidates' and tg_op = 'INSERT' then
    perform app.require_owner_provider_deposit_enabled(
      (pg_catalog.to_jsonb(new)->>'payment_provider_id')::uuid);
  elsif tg_table_name = 'deposit_jobs' and tg_op = 'UPDATE'
      and pg_catalog.to_jsonb(new)->>'job_kind' = 'execute_deposit'
      and pg_catalog.to_jsonb(new)->>'status' = 'leased'
      and pg_catalog.to_jsonb(old)->>'status' is distinct from
          pg_catalog.to_jsonb(new)->>'status' then
    select intent.payment_provider_id into v_provider_id
      from app.deposit_intents intent
      where intent.id = (pg_catalog.to_jsonb(new)->>'deposit_intent_id')::uuid;
    perform app.require_owner_provider_deposit_enabled(v_provider_id);
  elsif tg_table_name = 'deposit_execution_attempts' and tg_op = 'UPDATE'
      and pg_catalog.to_jsonb(new)->>'status' = 'final_action_fenced'
      and pg_catalog.to_jsonb(old)->>'status' is distinct from
          pg_catalog.to_jsonb(new)->>'status' then
    select intent.payment_provider_id into v_provider_id
      from app.deposit_intents intent
      where intent.id = (pg_catalog.to_jsonb(new)->>'deposit_intent_id')::uuid;
    perform app.require_owner_provider_deposit_enabled(v_provider_id);
  end if;
  return new;
end;
$$;
alter function app.enforce_owner_provider_deposit_pause() owner to postgres;
revoke all on function app.enforce_owner_provider_deposit_pause()
  from public, anon, authenticated, service_role;
create trigger deposit_intents_owner_provider_pause
before insert on app.deposit_intents for each row
execute function app.enforce_owner_provider_deposit_pause();
create trigger deposit_jobs_owner_provider_pause
before update on app.deposit_jobs for each row
execute function app.enforce_owner_provider_deposit_pause();
create trigger deposit_execution_attempts_owner_provider_pause
before update on app.deposit_execution_attempts for each row
execute function app.enforce_owner_provider_deposit_pause();
create trigger receiver_sms_candidates_owner_provider_pause
before insert on app.receiver_sms_deposit_candidates for each row
execute function app.enforce_owner_provider_deposit_pause();

-- A customer must not be shown a new payable receiver after the Owner pauses
-- that provider. The existing routine/pilot branches and their guards remain
-- unchanged; this adds the same locked veto ahead of either branch.
create or replace function app.prepare_telegram_live_telebirr_destination(
  p_origin_inbound_event_id uuid, p_player_id text, p_semantic_input_hmac text
)
returns table (
  provider_code text, receiver_revision_id uuid,
  receiver_account_holder_name text,
  receiver_account_reference_ciphertext text,
  receiver_account_reference_fingerprint text,
  receiver_account_masked text, payments_enabled boolean,
  request_replayed boolean
)
language plpgsql security definer set search_path = pg_catalog
as $$
declare v_provider_id uuid;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'The live Telegram TeleBirr destination is unavailable.';
  end if;
  select provider.id into v_provider_id from app.payment_providers provider
    where provider.code = 'telebirr' and provider.status = 'active';
  perform app.require_owner_provider_deposit_enabled(v_provider_id);
  if (select pg_catalog.count(*) from app.feature_switches feature_switch
       where (feature_switch.feature_key in ('payment_verification', 'deposit_execution')
         and feature_switch.mode = 'live')
         or (feature_switch.feature_key in (
           'private_live_deposit_pilot','telebirr_authoritative_verification')
           and feature_switch.mode = 'disabled')) = 4 then
    return query select * from app.prepare_telegram_routine_telebirr_paid_destination_core(
      p_origin_inbound_event_id, p_player_id, p_semantic_input_hmac);
  else
    return query select * from app.prepare_telegram_live_telebirr_destination_pilot_core(
      p_origin_inbound_event_id, p_player_id, p_semantic_input_hmac);
  end if;
end;
$$;

create or replace function app.prepare_telegram_live_cbe_sms_destination(
  p_origin_inbound_event_id uuid, p_player_id text
)
returns table (
  provider_code text, receiver_revision_id uuid,
  receiver_account_holder_name text,
  receiver_account_reference_ciphertext text,
  receiver_account_reference_fingerprint text,
  receiver_account_masked text, payments_enabled boolean
)
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_selected_player text;
  v_player_account_id uuid;
  v_provider_id uuid;
  v_receiver app.receiver_accounts%rowtype;
  v_route_enabled boolean;
  v_live_switches integer;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime')
    or p_origin_inbound_event_id is null
    or p_player_id is null or p_player_id <> pg_catalog.btrim(p_player_id)
    or pg_catalog.char_length(p_player_id) not between 1 and 64
    or p_player_id ~ '[[:space:][:cntrl:]]' then
    raise exception using errcode = '42501',
      message = 'The CBE Birr destination is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:routine-telebirr-processing', 20261004));
  select provider.id into v_provider_id from app.payment_providers provider
    where provider.code = 'cbe_birr' and provider.status = 'active';
  perform app.require_owner_provider_deposit_enabled(v_provider_id);
  select control.enabled into v_route_enabled
    from app.receiver_sms_route_control control where control.singleton for share;
  select pg_catalog.count(*)::integer into v_live_switches
    from app.feature_switches feature
   where feature.feature_key in (
     'payment_verification', 'deposit_execution',
     'cbe_birr_authoritative_verification') and feature.mode = 'live';
  if v_route_enabled is distinct from true or v_live_switches <> 3 then
    raise exception 'The CBE Birr destination is unavailable.';
  end if;

  select selection.selected_player_id into v_selected_player
    from app.get_telegram_saved_player_selection(p_origin_inbound_event_id) selection;
  if v_selected_player is distinct from p_player_id then
    raise exception 'The CBE Birr destination is unavailable.';
  end if;
  select boundary.player_account_id, boundary.payment_provider_id
    into v_player_account_id, v_provider_id
    from app.resolve_dry_run_deposit_proof_boundary(p_player_id, 'cbe_birr') boundary;
  if v_player_account_id is null or v_provider_id is null then
    raise exception 'The CBE Birr destination is unavailable.';
  end if;

  select receiver.* into v_receiver
    from app.receiver_accounts receiver
   where receiver.provider_id = v_provider_id
     and receiver.status = 'active' and receiver.retired_at is null
     and receiver.active_from <= pg_catalog.clock_timestamp()
   for share;
  if v_receiver.id is null
    or v_receiver.account_holder_name <> pg_catalog.btrim(v_receiver.account_holder_name)
    or pg_catalog.char_length(v_receiver.account_holder_name) not between 2 and 160
    or v_receiver.account_holder_name ~ '[[:cntrl:]]'
    or v_receiver.account_reference_ciphertext
       !~ '^receiver-v1[.]cbe_birr[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{12,32}$'
    or v_receiver.account_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or v_receiver.account_reference_masked !~ '^\*{3}[0-9]{4}$'
    or v_receiver.protection_profile_version <> 1
    or v_receiver.encryption_key_version <> 1
    or v_receiver.fingerprint_key_version <> 1 then
    raise exception 'The CBE Birr destination is unavailable.';
  end if;

  return query select 'cbe_birr'::text, v_receiver.id,
    v_receiver.account_holder_name, v_receiver.account_reference_ciphertext,
    v_receiver.account_reference_fingerprint, v_receiver.account_reference_masked, true;
end;
$$;

-- The paired phone continues recording SMS while a payment method is paused.
-- A pause only prevents fresh instructions, new deposits and final Player credit.
create function app.owner_provider_deposit_readiness(p_provider_code text)
returns text language plpgsql security definer set search_path = pg_catalog
as $$
declare v_receiver_id uuid;
begin
  if p_provider_code not in ('telebirr', 'cbe_birr') then return 'unsupported'; end if;
  if not exists (select 1 from app.payment_providers provider
      where provider.code = p_provider_code and provider.status = 'active') then
    return 'provider_unavailable';
  end if;
  select receiver.id into v_receiver_id
    from app.receiver_accounts receiver
    join app.payment_providers provider on provider.id = receiver.provider_id
    where provider.code = p_provider_code and receiver.status = 'active'
      and receiver.retired_at is null
      and receiver.active_from <= pg_catalog.clock_timestamp()
      and receiver.account_reference_masked ~ '^\*{3}[0-9]{4}$';
  if v_receiver_id is null then return 'receiver_missing'; end if;
  if p_provider_code = 'cbe_birr' and not exists (
      select 1 from app.cbe_birr_receiver_lookup_revisions lookup
      join app.receiver_accounts receiver
        on receiver.id = lookup.receiver_revision_id
      where lookup.receiver_revision_id = v_receiver_id
        and lookup.receiver_version = receiver.version
        and lookup.protection_profile_version = 2
        and lookup.encryption_key_version = 2
        and lookup.fingerprint_key_version = 2) then
    return 'receiver_not_protected';
  end if;
  if (select pg_catalog.count(*) from app.feature_switches feature
      where feature.feature_key in ('payment_verification', 'deposit_execution')
        and feature.mode = 'live') <> 2 then return 'payments_paused'; end if;
  if not exists (select 1 from app.receiver_sms_route_control control
      where control.singleton and control.enabled) then return 'sms_route_paused'; end if;
  if p_provider_code = 'cbe_birr' and not exists (
      select 1 from app.feature_switches feature
      where feature.feature_key = 'cbe_birr_authoritative_verification'
        and feature.mode = 'live') then return 'verification_paused'; end if;
  if not app.routine_telebirr_signed_worker_recent(interval '45 seconds') then
    return 'credit_worker_offline';
  end if;
  if p_provider_code = 'telebirr' and not exists (
      select 1 from app.routine_telebirr_device_enrollments enrollment
      where enrollment.receiver_account_id = v_receiver_id
        and enrollment.valid_from <= pg_catalog.clock_timestamp()
        and enrollment.valid_until > pg_catalog.clock_timestamp()
        and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revoked
          where revoked.enrollment_id = enrollment.id)) then
    return 'phone_not_paired';
  end if;
  if p_provider_code = 'cbe_birr'
    and exists (select 1 from app.owner_provider_deposit_controls control
      where control.provider_code = 'cbe_birr' and control.receiver_rotation_pending)
    and not exists (select 1 from app.receiver_sms_payment_events event
      where event.receiver_account_id = v_receiver_id
        and event.recorded_at >= pg_catalog.clock_timestamp() - interval '24 hours') then
    return 'new_receiver_sms_not_seen';
  end if;
  return 'ready';
end;
$$;
alter function app.owner_provider_deposit_readiness(text) owner to postgres;
revoke all on function app.owner_provider_deposit_readiness(text)
  from public, anon, authenticated, service_role;

create function app.list_owner_provider_deposit_controls(p_actor_auth_user_id uuid)
returns table (
  provider_code text, owner_enabled boolean, readiness text,
  receiver_name text, receiver_masked text, pending_jobs bigint,
  fenced_attempts bigint, changed_at timestamptz
) language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if session_user not in ('postgres', 'fetanagent_owner_control_runtime')
    or p_actor_auth_user_id is null
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  return query
    select control.provider_code, control.enabled,
      app.owner_provider_deposit_readiness(control.provider_code),
      receiver.account_holder_name, receiver.account_reference_masked,
      (select pg_catalog.count(*) from app.deposit_jobs job
        join app.deposit_intents intent on intent.id = job.deposit_intent_id
        join app.payment_providers provider on provider.id = intent.payment_provider_id
        where provider.code = control.provider_code
          and job.job_kind = 'execute_deposit'
          and job.status in ('queued','leased','retry_wait')),
      (select pg_catalog.count(*) from app.deposit_execution_attempts attempt
        join app.deposit_intents intent on intent.id = attempt.deposit_intent_id
        join app.payment_providers provider on provider.id = intent.payment_provider_id
        where provider.code = control.provider_code
          and attempt.status in ('prepared','final_action_fenced',
            'reconciliation_required','review_required')),
      control.changed_at
    from app.owner_provider_deposit_controls control
    join app.payment_providers provider on provider.code = control.provider_code
    left join app.receiver_accounts receiver on receiver.provider_id = provider.id
      and receiver.status = 'active'
    order by control.provider_code;
end;
$$;
alter function app.list_owner_provider_deposit_controls(uuid) owner to postgres;
revoke all on function app.list_owner_provider_deposit_controls(uuid)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control_runtime;
grant execute on function app.list_owner_provider_deposit_controls(uuid)
  to fetanagent_owner_control;

create function app.set_owner_provider_deposit_control(
  p_actor_auth_user_id uuid, p_request_id uuid, p_provider_code text,
  p_enabled boolean
) returns boolean language plpgsql security definer set search_path = pg_catalog
as $$
declare v_actor_id uuid;
declare v_existing app.owner_provider_deposit_control_requests%rowtype;
declare v_current boolean;
begin
  if session_user not in ('postgres', 'fetanagent_owner_control_runtime')
    or p_actor_auth_user_id is null or p_request_id is null
    or p_request_id::text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_provider_code not in ('telebirr', 'cbe_birr')
    or p_enabled is null then
    raise exception using errcode = '42501', message = 'The payment method request is invalid.';
  end if;
  select owner_user.id into v_actor_id from app.admin_users owner_user
    where owner_user.auth_user_id = p_actor_auth_user_id
      and owner_user.role = 'owner' and owner_user.status = 'active' for share;
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  select control.enabled into v_current
    from app.owner_provider_deposit_controls control
    where control.provider_code = p_provider_code for update;
  if not found then raise exception 'The payment method control is unavailable.'; end if;
  select * into v_existing from app.owner_provider_deposit_control_requests request
    where request.request_id = p_request_id for share;
  if v_existing.request_id is not null then
    if v_existing.provider_code <> p_provider_code
      or v_existing.requested_enabled is distinct from p_enabled
      or v_existing.actor_admin_id <> v_actor_id then
      raise exception 'The payment method request was already used differently.';
    end if;
    return v_current;
  end if;
  if p_enabled and app.owner_provider_deposit_readiness(p_provider_code) <> 'ready' then
    raise exception 'This payment method is not ready to enable.';
  end if;
  update app.owner_provider_deposit_controls control
    set enabled = p_enabled, changed_at = pg_catalog.clock_timestamp(),
        changed_by_admin_id = v_actor_id
    where control.provider_code = p_provider_code;
  insert into app.owner_provider_deposit_control_requests (
    request_id, provider_code, requested_enabled, actor_admin_id
  ) values (p_request_id, p_provider_code, p_enabled, v_actor_id);
  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, metadata
  ) values (
    'admin', v_actor_id, 'configuration.provider_deposit_control_changed',
    'payment_provider', pg_catalog.jsonb_build_object(
      'provider_code', p_provider_code, 'enabled', p_enabled,
      'request_id', p_request_id));
  return p_enabled;
end;
$$;
alter function app.set_owner_provider_deposit_control(uuid,uuid,text,boolean)
  owner to postgres;
revoke all on function app.set_owner_provider_deposit_control(uuid,uuid,text,boolean)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control_runtime;
grant execute on function app.set_owner_provider_deposit_control(uuid,uuid,text,boolean)
  to fetanagent_owner_control;

create function app.public_provider_deposit_controls()
returns table(provider_code text, accepting boolean)
language sql security definer set search_path = pg_catalog
as $$
  select control.provider_code,
    control.enabled and app.owner_provider_deposit_readiness(control.provider_code) = 'ready'
  from app.owner_provider_deposit_controls control
  order by control.provider_code
$$;
alter function app.public_provider_deposit_controls() owner to postgres;
revoke all on function app.public_provider_deposit_controls()
  from public, anon, authenticated, service_role,
    fetanagent_owner_control_runtime;
grant execute on function app.public_provider_deposit_controls()
  to fetanagent_owner_control;

comment on table app.owner_provider_deposit_controls is
  'Additional Owner veto for new instructions and automatic Player credits; never an activation of shared financial gates.';
comment on function app.set_owner_provider_deposit_control(uuid,uuid,text,boolean) is
  'Owner-only audited and idempotent per-provider pause/enable. Enable requires current non-money readiness.';
commit;
