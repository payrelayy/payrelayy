-- A repeated Player ID shares its pending Find. A changed Player ID releases
-- the old read-only assignment immediately so the Companion can move on.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.telegram_player_validation_shared_inbounds (
  origin_inbound_event_id uuid primary key
    references app.inbound_events (id) on delete restrict,
  validation_request_id uuid not null
    references app.telegram_player_validation_requests (id) on delete restrict,
  shared_at timestamptz not null
);
create index telegram_player_validation_shared_inbounds_request_idx
  on app.telegram_player_validation_shared_inbounds (validation_request_id);
alter table app.telegram_player_validation_shared_inbounds owner to postgres;
alter table app.telegram_player_validation_shared_inbounds enable row level security;
alter table app.telegram_player_validation_shared_inbounds force row level security;
revoke all on table app.telegram_player_validation_shared_inbounds
  from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;
create trigger telegram_player_validation_shared_inbounds_immutable
  before update or delete on app.telegram_player_validation_shared_inbounds
  for each row execute function app.reject_telegram_player_validation_evidence_mutation();
create trigger telegram_player_validation_shared_inbounds_no_truncate
  before truncate on app.telegram_player_validation_shared_inbounds
  for each statement execute function app.reject_telegram_player_validation_evidence_mutation();

create or replace function app.request_telegram_player_validation(
  p_origin_inbound_event_id uuid,
  p_player_id text
)
returns table (request_id uuid, request_replayed boolean)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_identity_id uuid;
  v_customer_id uuid;
  v_processed_at timestamptz;
  v_existing app.telegram_player_validation_requests%rowtype;
  v_pending app.telegram_player_validation_requests%rowtype;
  v_shared_request_id uuid;
  v_previous_request_id uuid;
  v_previous_selection_event_id uuid;
  v_now timestamptz;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'Telegram Player validation is unavailable.';
  end if;
  if p_player_id is null
    or p_player_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then
    raise exception 'The Player ID is invalid.';
  end if;
  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);
  select inbound_event.customer_identity_id, inbound_event.processed_at
    into v_identity_id, v_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;
  if v_identity_id is null then
    raise exception 'Telegram Player validation is unavailable.';
  end if;
  select identity.customer_id into v_customer_id
    from app.customer_identities identity
    join app.customers customer on customer.id = identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
     and identity.external_subject = telegram_identity.telegram_user_id::text
   where identity.id = v_identity_id
     and identity.identity_kind = 'telegram'
     and identity.status = 'active' and customer.status = 'active'
   for update of identity, customer, telegram_identity;
  if v_customer_id is null then
    raise exception 'Telegram Player validation is unavailable.';
  end if;

  select request.* into v_existing
    from app.telegram_player_validation_requests request
   where request.origin_inbound_event_id = p_origin_inbound_event_id;
  if v_existing.id is null then
    select shared.validation_request_id into v_shared_request_id
      from app.telegram_player_validation_shared_inbounds shared
     where shared.origin_inbound_event_id = p_origin_inbound_event_id;
    if v_shared_request_id is not null then
      select request.* into v_existing
        from app.telegram_player_validation_requests request
       where request.id = v_shared_request_id;
    end if;
  end if;
  if v_existing.id is not null then
    if v_existing.telegram_identity_id <> v_identity_id
      or v_existing.player_id <> p_player_id or v_processed_at is null then
      raise exception 'Telegram Player validation replay conflicts.';
    end if;
    request_id := v_existing.id;
    request_replayed := true;
    return next;
    return;
  end if;
  if v_processed_at is not null
    or exists (select 1 from app.inbound_event_consumptions consumption
       where consumption.origin_inbound_event_id = p_origin_inbound_event_id) then
    raise exception 'The Telegram event already has another action.';
  end if;

  v_now := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  select request.* into v_pending
    from app.telegram_player_validation_requests request
   where request.telegram_identity_id = v_identity_id
     and request.status = 'pending'
   for update;
  if v_pending.id is not null and v_pending.player_id = p_player_id then
    insert into app.telegram_player_validation_shared_inbounds (
      origin_inbound_event_id, validation_request_id, shared_at
    ) values (p_origin_inbound_event_id, v_pending.id, v_now);
    update app.inbound_events inbound_event
       set processed_at = v_now, processing_error_code = null
     where inbound_event.id = p_origin_inbound_event_id
       and inbound_event.processed_at is null;
    if not found then
      raise exception 'Telegram Player validation was not recorded.';
    end if;
    insert into app.audit_events (
      actor_kind, actor_customer_id, action, resource_type, resource_id, metadata
    ) values (
      'customer', v_customer_id, 'customer.telegram_player_validation_shared',
      'telegram_player_validation_request', v_pending.id,
      pg_catalog.jsonb_build_object('channel', 'telegram', 'payment_started', false)
    );
    request_id := v_pending.id;
    request_replayed := false;
    return next;
    return;
  end if;

  select selection.origin_inbound_event_id into v_previous_selection_event_id
    from app.telegram_player_selections selection
   where selection.telegram_identity_id = v_identity_id;
  update app.telegram_player_validation_requests request
     set status = 'superseded', completed_at = v_now
   where request.telegram_identity_id = v_identity_id and request.status = 'pending'
   returning request.id into v_previous_request_id;
  if v_previous_request_id is not null then
    update app.telegram_player_validation_assignments assignment
       set state = 'superseded', claim_lease_expires_at = null
     where assignment.validation_request_id = v_previous_request_id
       and assignment.state in ('claimed', 'signed');
  end if;
  insert into app.telegram_player_validation_requests (
    telegram_identity_id, origin_inbound_event_id, player_id,
    selection_origin_inbound_event_id, requested_at
  ) values (
    v_identity_id, p_origin_inbound_event_id, p_player_id,
    v_previous_selection_event_id, v_now
  ) returning id into request_id;
  update app.inbound_events inbound_event
     set processed_at = v_now, processing_error_code = null
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.processed_at is null;
  if not found then
    raise exception 'Telegram Player validation was not recorded.';
  end if;
  insert into app.audit_events (
    actor_kind, actor_customer_id, action, resource_type, resource_id, metadata
  ) values (
    'customer', v_customer_id, 'customer.telegram_player_validation_requested',
    'telegram_player_validation_request', request_id,
    pg_catalog.jsonb_build_object('channel', 'telegram', 'payment_started', false)
  );
  request_replayed := false;
  return next;
end;
$$;

-- Release a superseded request that was already occupying the single active
-- assignment when this migration began.
update app.telegram_player_validation_assignments assignment
   set state = 'superseded', claim_lease_expires_at = null
  from app.telegram_player_validation_requests request
 where request.id = assignment.validation_request_id
   and request.status = 'superseded'
   and assignment.state in ('claimed', 'signed');

-- Called only after the bridge has verified the paired, signed result. It
-- confirms cancellation of that exact assignment; it never accepts evidence.
create function app.confirm_superseded_telegram_player_validation_result(
  p_assignment_id text, p_assignment_body_digest text,
  p_result_id text, p_result_body_digest text,
  p_certificate_id text, p_device_id text, p_device_key_id text,
  p_signed_assignment jsonb, p_signed_result jsonb
)
returns boolean language plpgsql security definer set search_path = pg_catalog
as $$
begin
  perform app.require_agent_platform_companion_bridge_session();
  if p_assignment_id is null or p_assignment_body_digest is null
    or p_result_id is null or p_result_body_digest is null
    or p_certificate_id is null or p_device_id is null or p_device_key_id is null
    or p_signed_assignment is null or p_signed_result is null then
    return false;
  end if;
  return exists (
    select 1
      from app.telegram_player_validation_assignments assignment
      join app.telegram_player_validation_requests request
        on request.id = assignment.validation_request_id
     where assignment.assignment_id::text = p_assignment_id
       and assignment.assignment_body_digest = p_assignment_body_digest
       and assignment.certificate_id::text = p_certificate_id
       and assignment.device_id = p_device_id
       and assignment.device_key_id = p_device_key_id
       and assignment.signed_assignment = p_signed_assignment
       and assignment.state = 'superseded'
       and request.status = 'superseded'
       and p_signed_result ->> 'bodyDigest' = p_result_body_digest
       and p_signed_result -> 'body' ->> 'resultId' = p_result_id
       and p_signed_result -> 'body' ->> 'assignmentId' = p_assignment_id
       and p_signed_result -> 'body' ->> 'assignmentBodyDigest' = p_assignment_body_digest
       and p_signed_result -> 'body' ->> 'validationRequestId' = request.id::text
       and p_signed_result -> 'body' ->> 'certificateId' = p_certificate_id
       and p_signed_result -> 'body' ->> 'deviceId' = p_device_id
       and p_signed_result -> 'body' ->> 'deviceKeyId' = p_device_key_id
       and p_signed_result -> 'body' ->> 'playerIdDigest' =
           app.telegram_player_validation_player_digest(request.player_id)
  );
end;
$$;
alter function app.confirm_superseded_telegram_player_validation_result(
  text,text,text,text,text,text,text,jsonb,jsonb
) owner to postgres;
revoke all on function app.confirm_superseded_telegram_player_validation_result(
  text,text,text,text,text,text,text,jsonb,jsonb
) from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;
grant execute on function app.confirm_superseded_telegram_player_validation_result(
  text,text,text,text,text,text,text,jsonb,jsonb
) to fetanagent_companion_device_bridge;

comment on table app.telegram_player_validation_shared_inbounds is
  'Durable replay mapping for repeat Telegram messages sharing one pending signed Find.';
comment on function app.request_telegram_player_validation(uuid,text) is
  'Private Telegram intake. Shares a pending Find for the same Player ID and immediately supersedes an active assignment for a different ID.';
comment on function app.confirm_superseded_telegram_player_validation_result(
  text,text,text,text,text,text,text,jsonb,jsonb
) is 'Read-only exact-assignment cancellation check for the paired Companion bridge.';
commit;
