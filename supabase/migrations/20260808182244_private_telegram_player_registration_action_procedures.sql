-- Stage 12: private Telegram Player-ID action procedures.
--
-- This migration deliberately creates no runtime EXECUTE grant, bot callback handler, polling
-- configuration, database login, KemerBet request, deposit, or payment action. It establishes
-- the private, exactly-once database boundary that a later reviewed transport may call.
--
-- All procedures below are SECURITY DEFINER only because the private `app` schema is forced-RLS
-- and the procedures must atomically prove inbox identity, consume an inbound event, write the
-- durable action records, and project the conversation state. Every new procedure is explicitly
-- ungranted at the end of this migration.

begin;

-- A capability callback that reaches its exact expiry instant is expired, never consumed or
-- revoked. The transition trigger stamps terminal times from the database clock, so this strict
-- invariant makes a close-boundary callback roll back and be retried through the expiry path.
alter table app.bot_action_capabilities
  drop constraint bot_action_capabilities_terminal_time_shape,
  add constraint bot_action_capabilities_terminal_time_shape check (
    (consumed_at is null or consumed_at < expires_at)
    and (revoked_at is null or (revoked_at >= created_at and revoked_at < expires_at))
    and (expired_at is null or expired_at >= expires_at)
  );

alter table app.bot_conversation_actions
  drop constraint bot_conversation_actions_terminal_time_shape,
  add constraint bot_conversation_actions_terminal_time_shape check (
    (completed_at is null or completed_at < expires_at)
    and (expired_at is null or expired_at >= expires_at)
  );

-- A terminal capability is immutable: a new Telegram update that presents it still needs its own
-- global receipt, but must not overwrite the consumed/revoked/expired capability's original
-- event link. This append-only bridge gives the deferred causal checks a precise, private proof.
create table app.bot_action_capability_terminal_rejections (
  origin_inbound_event_id uuid primary key
    references app.inbound_events (id) on delete restrict,
  capability_id uuid not null
    references app.bot_action_capabilities (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint bot_action_capability_terminal_rejections_consumption_fkey
    foreign key (origin_inbound_event_id)
    references app.inbound_event_consumptions (origin_inbound_event_id)
    on delete restrict
);

create index bot_action_capability_terminal_rejections_capability_created_idx
  on app.bot_action_capability_terminal_rejections (capability_id, created_at desc);

create function app.enforce_bot_action_capability_terminal_rejection_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  new.created_at := clock_timestamp();
  return new;
end;
$$;

create trigger bot_action_capability_terminal_rejections_set_created_at
before insert on app.bot_action_capability_terminal_rejections
for each row
execute function app.enforce_bot_action_capability_terminal_rejection_insert();

create function app.reject_bot_action_capability_terminal_rejection_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  raise exception 'Telegram terminal capability rejections cannot change.';
end;
$$;

create trigger bot_action_capability_terminal_rejections_immutable
before update or delete on app.bot_action_capability_terminal_rejections
for each row
execute function app.reject_bot_action_capability_terminal_rejection_mutation();

create function app.require_bot_action_capability_terminal_rejection_correspondence()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_capability_status app.telegram_action_capability_status;
  resolved_capability_identity_id uuid;
  resolved_capability_customer_id uuid;
  resolved_capability_conversation_id uuid;
  resolved_consumer_kind app.telegram_inbound_consumer_kind;
  resolved_outcome app.telegram_inbound_consumption_outcome;
  resolved_reason_code text;
  resolved_identity_id uuid;
  resolved_customer_id uuid;
  resolved_conversation_id uuid;
  resolved_version_before bigint;
  resolved_version_after bigint;
begin
  select capability.status,
         capability.customer_identity_id,
         capability.customer_id,
         capability.conversation_id
    into resolved_capability_status,
         resolved_capability_identity_id,
         resolved_capability_customer_id,
         resolved_capability_conversation_id
    from app.bot_action_capabilities capability
   where capability.id = new.capability_id;

  select consumption.consumer_kind,
         consumption.outcome,
         consumption.outcome_reason_code,
         consumption.customer_identity_id,
         consumption.customer_id,
         consumption.conversation_id,
         consumption.conversation_version_before,
         consumption.conversation_version_after
    into resolved_consumer_kind,
         resolved_outcome,
         resolved_reason_code,
         resolved_identity_id,
         resolved_customer_id,
         resolved_conversation_id,
         resolved_version_before,
         resolved_version_after
    from app.inbound_event_consumptions consumption
   where consumption.origin_inbound_event_id = new.origin_inbound_event_id;

  if not found
    or resolved_capability_status not in ('consumed', 'revoked', 'expired')
    or resolved_consumer_kind <> 'start_player_registration'
    or resolved_outcome <> 'rejected'
    or resolved_reason_code <> 'stale_capability'
    or resolved_identity_id is distinct from resolved_capability_identity_id
    or resolved_customer_id is distinct from resolved_capability_customer_id
    or resolved_conversation_id is distinct from resolved_capability_conversation_id
    or resolved_version_after is distinct from resolved_version_before then
    raise exception 'The terminal Telegram capability rejection does not match its consumption receipt.';
  end if;

  return null;
end;
$$;

create constraint trigger bot_action_capability_terminal_rejections_require_correspondence
after insert on app.bot_action_capability_terminal_rejections
deferrable initially deferred
for each row
execute function app.require_bot_action_capability_terminal_rejection_correspondence();

-- Extend Stage 7's causal receipt check without weakening its original successful, stale-issued,
-- delayed-input, or final-projection requirements. A terminal capability attempt is accepted only
-- through the append-only rejection bridge above; the terminal capability row is never changed.
create or replace function app.require_inbound_event_consumption_causal_result()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.consumer_kind = 'issue_player_registration_capability'
    and new.outcome = 'completed'
    and not exists (
      select 1
        from app.bot_action_capabilities capability
       where capability.issued_from_inbound_event_id = new.origin_inbound_event_id
         and capability.customer_identity_id = new.customer_identity_id
         and capability.customer_id = new.customer_id
         and capability.conversation_id = new.conversation_id
    ) then
    raise exception 'The Telegram capability-issue consumption has no matching capability.';
  end if;

  if new.consumer_kind = 'start_player_registration'
    and new.outcome in ('completed', 'active_action_exists', 'expired', 'rejected')
    and not exists (
      select 1
        from app.bot_action_capabilities capability
       where capability.customer_identity_id = new.customer_identity_id
         and capability.customer_id = new.customer_id
         and capability.conversation_id = new.conversation_id
         and (
           (new.outcome in ('completed', 'active_action_exists')
             and capability.consumed_by_inbound_event_id = new.origin_inbound_event_id)
           or (new.outcome = 'expired'
             and capability.expired_by_inbound_event_id = new.origin_inbound_event_id)
           or (new.outcome = 'rejected'
             and (
               capability.revoked_by_inbound_event_id = new.origin_inbound_event_id
               or exists (
                 select 1
                   from app.bot_action_capability_terminal_rejections terminal_rejection
                  where terminal_rejection.origin_inbound_event_id = new.origin_inbound_event_id
                    and terminal_rejection.capability_id = capability.id
               )
             ))
         )
    ) then
    raise exception 'The Telegram Player ID start consumption has no matching capability.';
  end if;

  if new.consumer_kind = 'start_player_registration'
    and new.outcome = 'active_action_exists'
    and not exists (
      select 1
        from app.bot_conversation_actions action
        join app.bot_conversations conversation
          on conversation.id = action.conversation_id
       where action.customer_identity_id = new.customer_identity_id
         and action.customer_id = new.customer_id
         and action.conversation_id = new.conversation_id
         and action.status = 'awaiting_input'
         and action.expires_at > new.consumed_at
         and conversation.version = new.conversation_version_before
         and conversation.state ->> 'action_id' = action.id::text
    ) then
    raise exception 'The Telegram Player ID start consumption cannot claim a missing active action.';
  end if;

  -- A fresh callback cannot consume an inbound event when an existing Player-ID action has just
  -- expired or its projection is internally inconsistent. This covers terminal/stale/capability-
  -- expiry paths as well as the ordinary active-action path. If no action is awaiting input, a
  -- terminal-capability rejection remains valid and does not require a conversation projection.
  if new.consumer_kind = 'start_player_registration'
    and new.outcome in ('active_action_exists', 'expired', 'rejected')
    and exists (
      select 1
        from app.bot_conversation_actions action
       where action.customer_identity_id = new.customer_identity_id
         and action.customer_id = new.customer_id
         and action.conversation_id = new.conversation_id
         and action.status = 'awaiting_input'
    )
    and not exists (
      select 1
        from app.bot_conversation_actions action
        join app.bot_conversations conversation
          on conversation.id = action.conversation_id
       where action.customer_identity_id = new.customer_identity_id
         and action.customer_id = new.customer_id
         and action.conversation_id = new.conversation_id
         and action.status = 'awaiting_input'
         and action.expires_at > new.consumed_at
         and conversation.version = new.conversation_version_before
         and conversation.state ->> 'action_id' = action.id::text
    ) then
    raise exception 'The Telegram Player ID start consumption cannot bypass an expired or inconsistent active action.';
  end if;

  if new.consumer_kind = 'start_player_registration'
    and new.outcome = 'completed'
    and not exists (
      select 1
        from app.bot_conversation_actions action
       where action.started_from_inbound_event_id = new.origin_inbound_event_id
         and action.customer_identity_id = new.customer_identity_id
         and action.customer_id = new.customer_id
         and action.conversation_id = new.conversation_id
    ) then
    raise exception 'The Telegram Player ID start consumption has no matching conversation action.';
  end if;

  if new.consumer_kind = 'submit_player_registration_input'
    and new.outcome = 'completed'
    and (
      not exists (
        select 1
          from app.bot_conversation_actions action
         where action.completed_by_inbound_event_id = new.origin_inbound_event_id
           and action.customer_identity_id = new.customer_identity_id
           and action.customer_id = new.customer_id
           and action.conversation_id = new.conversation_id
           and action.status = 'completed'
      )
      or not exists (
        select 1
          from app.player_registration_request_events request_event
         where request_event.origin_inbound_event_id = new.origin_inbound_event_id
      )
    ) then
    raise exception 'The Telegram Player ID input consumption has no matching terminal result.';
  end if;

  if new.consumer_kind = 'submit_player_registration_input'
    and new.outcome = 'rejected'
    and not exists (
      select 1
        from app.bot_conversation_actions action
        join app.bot_conversations conversation
          on conversation.id = action.conversation_id
        join app.inbound_events inbound_event
          on inbound_event.id = new.origin_inbound_event_id
        join app.inbound_events started_inbound_event
          on started_inbound_event.id = action.started_from_inbound_event_id
       where action.customer_identity_id = new.customer_identity_id
         and action.customer_id = new.customer_id
         and action.conversation_id = new.conversation_id
         and action.status = 'awaiting_input'
         and action.expires_at > new.consumed_at
         and conversation.version = new.conversation_version_before
         and conversation.state ->> 'action_id' = action.id::text
         and new.conversation_version_after = new.conversation_version_before
         and (
           (new.outcome_reason_code = 'input_predates_active_action'
             and (
               inbound_event.telegram_update_id <= started_inbound_event.telegram_update_id
               or inbound_event.received_at < action.created_at
             ))
           or (new.outcome_reason_code = 'invalid_player_id'
             and inbound_event.telegram_update_id > started_inbound_event.telegram_update_id
             and inbound_event.received_at >= action.created_at
             and inbound_event.received_at <= action.expires_at)
         )
    ) then
    raise exception 'The Telegram Player ID input rejection does not match its active action.';
  end if;

  if new.consumer_kind = 'expire_player_registration_action'
    and new.outcome = 'completed'
    and not exists (
      select 1
        from app.bot_conversation_actions action
       where action.expired_by_inbound_event_id = new.origin_inbound_event_id
         and action.customer_identity_id = new.customer_identity_id
         and action.customer_id = new.customer_id
         and action.conversation_id = new.conversation_id
         and action.status = 'expired'
    ) then
    raise exception 'The Telegram Player ID action-expiry consumption has no matching expired action.';
  end if;

  return null;
end;
$$;

-- Issue the opaque capability behind the future English-only "Add KemerBet Player ID" menu.
-- The API derives the capability ID, token fingerprint, and semantic HMAC before this call; no
-- raw callback token, menu text, platform ID, customer ID, or conversation state is caller input.
create function app.issue_telegram_player_registration_capability(
  p_origin_inbound_event_id uuid,
  p_capability_id uuid,
  p_capability_token_fingerprint text,
  p_semantic_input_hmac text
)
returns table (
  result_capability_id uuid,
  capability_expires_at timestamptz,
  expected_conversation_version bigint,
  origin_inbound_event_already_consumed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_inbound_identity_id uuid;
  resolved_inbound_processed_at timestamptz;
  resolved_customer_id uuid;
  resolved_identity_status app.record_status;
  resolved_identity_kind text;
  resolved_customer_status app.record_status;
  resolved_telegram_user_id bigint;
  resolved_private_chat_id bigint;
  resolved_conversation_id uuid;
  resolved_conversation_version bigint;
  resolved_platform_id uuid;
  resolved_platform_status app.record_status;
  resolved_existing_consumer_kind app.telegram_inbound_consumer_kind;
  resolved_existing_semantic_hmac text;
  resolved_existing_outcome app.telegram_inbound_consumption_outcome;
  resolved_existing_reason_code text;
  resolved_existing_identity_id uuid;
  resolved_existing_customer_id uuid;
  resolved_existing_conversation_id uuid;
  resolved_existing_version_before bigint;
  resolved_existing_version_after bigint;
  resolved_capability_expires_at timestamptz;
  resolved_active_action_id uuid;
  resolved_active_action_expires_at timestamptz;
  resolved_now timestamptz;
  resolved_expiry timestamptz;
begin
  if p_origin_inbound_event_id is null
    or p_capability_id is null then
    raise exception 'The Telegram capability issue request is invalid.';
  end if;

  if p_capability_token_fingerprint is null
    or p_capability_token_fingerprint <> lower(btrim(p_capability_token_fingerprint))
    or p_capability_token_fingerprint !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$'
    or p_semantic_input_hmac is null
    or p_semantic_input_hmac <> lower(btrim(p_semantic_input_hmac))
    or p_semantic_input_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The Telegram capability integrity values are invalid.';
  end if;

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);

  select inbound_event.customer_identity_id,
         inbound_event.processed_at
    into resolved_inbound_identity_id,
         resolved_inbound_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;

  if not found
    or resolved_inbound_identity_id is null then
    raise exception 'The Telegram inbound event is not available for a Player ID capability.';
  end if;

  select customer_identity.customer_id,
         customer_identity.status,
         customer_identity.identity_kind
    into resolved_customer_id,
         resolved_identity_status,
         resolved_identity_kind
    from app.customer_identities customer_identity
   where customer_identity.id = resolved_inbound_identity_id
   for update;

  if not found
    or resolved_identity_kind <> 'telegram' then
    raise exception 'The Telegram customer identity is not available for a Player ID capability.';
  end if;

  select customer.status
    into resolved_customer_status
    from app.customers customer
   where customer.id = resolved_customer_id
   for update;

  if not found then
    raise exception 'The Telegram customer is not available for a Player ID capability.';
  end if;

  select telegram_identity.telegram_user_id,
         telegram_identity.private_chat_id
    into resolved_telegram_user_id,
         resolved_private_chat_id
    from app.telegram_identities telegram_identity
   where telegram_identity.customer_identity_id = resolved_inbound_identity_id
   for update;

  if not found
    or resolved_telegram_user_id is null
    or resolved_private_chat_id is null then
    raise exception 'The Telegram customer identity is not available for a Player ID capability.';
  end if;

  select conversation.id
    into resolved_conversation_id
    from app.bot_conversations conversation
   where conversation.telegram_identity_id = resolved_inbound_identity_id;

  if not found then
    raise exception 'The Telegram customer conversation is not available for a Player ID capability.';
  end if;

  select consumption.consumer_kind,
         consumption.semantic_input_hmac,
         consumption.outcome,
         consumption.outcome_reason_code,
         consumption.customer_identity_id,
         consumption.customer_id,
         consumption.conversation_id,
         consumption.conversation_version_before,
         consumption.conversation_version_after
    into resolved_existing_consumer_kind,
         resolved_existing_semantic_hmac,
         resolved_existing_outcome,
         resolved_existing_reason_code,
         resolved_existing_identity_id,
         resolved_existing_customer_id,
         resolved_existing_conversation_id,
         resolved_existing_version_before,
         resolved_existing_version_after
    from app.inbound_event_consumptions consumption
   where consumption.origin_inbound_event_id = p_origin_inbound_event_id;

  if found then
    if resolved_existing_consumer_kind <> 'issue_player_registration_capability'
      or resolved_existing_semantic_hmac is distinct from p_semantic_input_hmac
      or resolved_existing_outcome <> 'completed'
      or resolved_existing_reason_code <> 'capability_issued'
      or resolved_existing_identity_id is distinct from resolved_inbound_identity_id
      or resolved_existing_customer_id is distinct from resolved_customer_id
      or resolved_existing_conversation_id is distinct from resolved_conversation_id
      or resolved_existing_version_after is distinct from resolved_existing_version_before then
      raise exception 'The replayed Telegram capability issue does not match its recorded result.';
    end if;

    select capability.expires_at
      into resolved_capability_expires_at
      from app.bot_action_capabilities capability
     where capability.id = p_capability_id
       and capability.issued_from_inbound_event_id = p_origin_inbound_event_id
       and capability.token_fingerprint = p_capability_token_fingerprint
       and capability.customer_identity_id = resolved_inbound_identity_id
       and capability.customer_id = resolved_customer_id
       and capability.conversation_id = resolved_conversation_id
       and capability.expected_conversation_version = resolved_existing_version_before;

    if not found then
      raise exception 'The replayed Telegram capability issue requires remediation.';
    end if;

    return query
    select p_capability_id,
           resolved_capability_expires_at,
           resolved_existing_version_before,
           true;
    return;
  end if;

  if resolved_inbound_processed_at is not null then
    raise exception 'The Telegram inbound event requires remediation before Player ID capability issuance.';
  end if;

  -- A recorded receipt must remain safely replayable even if the customer is later disabled. The
  -- mutable active-status gate belongs only to the fresh path after the exact-retry return above.
  if resolved_identity_status <> 'active'
    or resolved_customer_status <> 'active' then
    raise exception 'The Telegram customer is not available for a new Player ID capability.';
  end if;

  select platform.id,
         platform.status
    into resolved_platform_id,
         resolved_platform_status
    from app.platforms platform
   where platform.code = 'kemerbet'
   for share;

  if not found
    or resolved_platform_status <> 'active' then
    raise exception 'The KemerBet platform is not available for Player ID capability issuance.';
  end if;

  select conversation.version
    into resolved_conversation_version
    from app.bot_conversations conversation
   where conversation.id = resolved_conversation_id
   for update;

  if not found then
    raise exception 'The Telegram customer conversation is not available for a Player ID capability.';
  end if;

  -- A stale flow must be closed by the dedicated expiry consumer before any fresh root/menu event
  -- can acquire a new meaning. This prevents a delayed menu interaction from silently bypassing
  -- the expiry-only recovery rule.
  select action.id,
         action.expires_at
    into resolved_active_action_id,
         resolved_active_action_expires_at
    from app.bot_conversation_actions action
   where action.conversation_id = resolved_conversation_id
     and action.status = 'awaiting_input'
   for update;

  resolved_now := clock_timestamp();

  if resolved_active_action_id is not null then
    if resolved_active_action_expires_at <= resolved_now then
      raise exception 'The active Player ID action has expired and must be completed by the expiry procedure.';
    end if;

    -- Do not issue a second root-menu capability while a Player-ID action is still awaiting input.
    -- This keeps one conversation action authoritative and avoids creating a callback guaranteed to
    -- become stale after the existing action completes.
    raise exception 'The active Player ID action must be completed before another capability is issued.';
  end if;

  -- The capability binding trigger stamps created_at at insert time. Leave a short server-owned
  -- margin so the immutable five-minute maximum remains valid even across that final timestamp.
  resolved_expiry := resolved_now + interval '4 minutes 59 seconds';

  insert into app.inbound_event_consumptions (
    origin_inbound_event_id,
    customer_identity_id,
    customer_id,
    conversation_id,
    consumer_kind,
    semantic_input_hmac,
    outcome,
    outcome_reason_code,
    conversation_version_before,
    conversation_version_after
  )
  values (
    p_origin_inbound_event_id,
    resolved_inbound_identity_id,
    resolved_customer_id,
    resolved_conversation_id,
    'issue_player_registration_capability',
    p_semantic_input_hmac,
    'completed',
    'capability_issued',
    resolved_conversation_version,
    resolved_conversation_version
  );

  insert into app.bot_action_capabilities (
    id,
    conversation_id,
    customer_identity_id,
    customer_id,
    platform_id,
    capability_kind,
    token_fingerprint,
    expected_conversation_version,
    issued_from_inbound_event_id,
    expires_at
  )
  values (
    p_capability_id,
    resolved_conversation_id,
    resolved_inbound_identity_id,
    resolved_customer_id,
    resolved_platform_id,
    'begin_player_registration',
    p_capability_token_fingerprint,
    resolved_conversation_version,
    p_origin_inbound_event_id,
    resolved_expiry
  )
  returning expires_at into resolved_capability_expires_at;

  insert into app.audit_events (
    actor_kind,
    actor_customer_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    'customer',
    resolved_customer_id,
    'customer.player_registration_capability_issued',
    'telegram_action_capability',
    p_capability_id,
    jsonb_build_object('channel', 'telegram', 'platform_code', 'kemerbet')
  );

  return query
  select p_capability_id,
         resolved_capability_expires_at,
         resolved_conversation_version,
         false;
end;
$$;

-- Consume a verified opaque capability and either begin the Player-ID flow, report that a current
-- flow already exists, expire/revoke the issued capability, or record a new terminal-capability
-- presentation. The raw callback token is never accepted or stored here.
create function app.start_telegram_player_registration_action(
  p_origin_inbound_event_id uuid,
  p_capability_id uuid,
  p_capability_token_fingerprint text,
  p_semantic_input_hmac text
)
returns table (
  result_outcome text,
  result_reason_code text,
  player_registration_action_id uuid,
  player_id_deadline_at timestamptz,
  conversation_version bigint,
  origin_inbound_event_already_consumed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_inbound_identity_id uuid;
  resolved_inbound_processed_at timestamptz;
  resolved_customer_id uuid;
  resolved_identity_status app.record_status;
  resolved_identity_kind text;
  resolved_customer_status app.record_status;
  resolved_conversation_id uuid;
  resolved_conversation_version bigint;
  resolved_conversation_state jsonb;
  resolved_platform_id uuid;
  resolved_platform_status app.record_status;
  resolved_capability_platform_id uuid;
  resolved_capability_identity_id uuid;
  resolved_capability_customer_id uuid;
  resolved_capability_conversation_id uuid;
  resolved_capability_kind app.telegram_action_capability_kind;
  resolved_capability_status app.telegram_action_capability_status;
  resolved_capability_expected_version bigint;
  resolved_capability_expires_at timestamptz;
  resolved_capability_consumed_event_id uuid;
  resolved_capability_revoked_event_id uuid;
  resolved_capability_expired_event_id uuid;
  resolved_active_action_id uuid;
  resolved_active_action_expires_at timestamptz;
  resolved_new_action_id uuid;
  resolved_new_action_expires_at timestamptz;
  resolved_now timestamptz;
  resolved_next_version bigint;
  resolved_existing_consumer_kind app.telegram_inbound_consumer_kind;
  resolved_existing_semantic_hmac text;
  resolved_existing_outcome app.telegram_inbound_consumption_outcome;
  resolved_existing_reason_code text;
  resolved_existing_identity_id uuid;
  resolved_existing_customer_id uuid;
  resolved_existing_conversation_id uuid;
  resolved_existing_version_before bigint;
  resolved_existing_version_after bigint;
  resolved_existing_action_id uuid;
  resolved_existing_action_expires_at timestamptz;
begin
  if p_origin_inbound_event_id is null
    or p_capability_id is null then
    raise exception 'The Telegram Player ID action request is invalid.';
  end if;

  if p_capability_token_fingerprint is null
    or p_capability_token_fingerprint <> lower(btrim(p_capability_token_fingerprint))
    or p_capability_token_fingerprint !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$'
    or p_semantic_input_hmac is null
    or p_semantic_input_hmac <> lower(btrim(p_semantic_input_hmac))
    or p_semantic_input_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The Telegram Player ID action integrity values are invalid.';
  end if;

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);

  select inbound_event.customer_identity_id,
         inbound_event.processed_at
    into resolved_inbound_identity_id,
         resolved_inbound_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;

  if not found
    or resolved_inbound_identity_id is null then
    raise exception 'The Telegram inbound event is not available for a Player ID action.';
  end if;

  select customer_identity.customer_id,
         customer_identity.status,
         customer_identity.identity_kind
    into resolved_customer_id,
         resolved_identity_status,
         resolved_identity_kind
    from app.customer_identities customer_identity
   where customer_identity.id = resolved_inbound_identity_id
   for update;

  if not found
    or resolved_identity_kind <> 'telegram' then
    raise exception 'The Telegram customer identity is not available for a Player ID action.';
  end if;

  select customer.status
    into resolved_customer_status
    from app.customers customer
   where customer.id = resolved_customer_id
   for update;

  if not found then
    raise exception 'The Telegram customer is not available for a Player ID action.';
  end if;

  perform 1
    from app.telegram_identities telegram_identity
   where telegram_identity.customer_identity_id = resolved_inbound_identity_id
   for update;

  if not found then
    raise exception 'The Telegram customer identity is not available for a Player ID action.';
  end if;

  select conversation.id
    into resolved_conversation_id
    from app.bot_conversations conversation
   where conversation.telegram_identity_id = resolved_inbound_identity_id;

  if not found then
    raise exception 'The Telegram customer conversation is not available for a Player ID action.';
  end if;

  select consumption.consumer_kind,
         consumption.semantic_input_hmac,
         consumption.outcome,
         consumption.outcome_reason_code,
         consumption.customer_identity_id,
         consumption.customer_id,
         consumption.conversation_id,
         consumption.conversation_version_before,
         consumption.conversation_version_after
    into resolved_existing_consumer_kind,
         resolved_existing_semantic_hmac,
         resolved_existing_outcome,
         resolved_existing_reason_code,
         resolved_existing_identity_id,
         resolved_existing_customer_id,
         resolved_existing_conversation_id,
         resolved_existing_version_before,
         resolved_existing_version_after
    from app.inbound_event_consumptions consumption
   where consumption.origin_inbound_event_id = p_origin_inbound_event_id;

  if found then
    if resolved_existing_consumer_kind <> 'start_player_registration'
      or resolved_existing_semantic_hmac is distinct from p_semantic_input_hmac
      or resolved_existing_identity_id is distinct from resolved_inbound_identity_id
      or resolved_existing_customer_id is distinct from resolved_customer_id
      or resolved_existing_conversation_id is distinct from resolved_conversation_id then
      raise exception 'The replayed Telegram Player ID action does not match its recorded result.';
    end if;

    select capability.status,
           capability.consumed_by_inbound_event_id,
           capability.revoked_by_inbound_event_id,
           capability.expired_by_inbound_event_id
      into resolved_capability_status,
           resolved_capability_consumed_event_id,
           resolved_capability_revoked_event_id,
           resolved_capability_expired_event_id
      from app.bot_action_capabilities capability
     where capability.id = p_capability_id
       and capability.token_fingerprint = p_capability_token_fingerprint
       and capability.customer_identity_id = resolved_inbound_identity_id
       and capability.customer_id = resolved_customer_id
       and capability.conversation_id = resolved_conversation_id;

    if not found then
      raise exception 'The replayed Telegram Player ID action requires remediation.';
    end if;

    if resolved_existing_outcome = 'completed' then
      select action.id,
             action.expires_at
        into resolved_existing_action_id,
             resolved_existing_action_expires_at
        from app.bot_conversation_actions action
       where action.started_from_inbound_event_id = p_origin_inbound_event_id
         and action.capability_id = p_capability_id
         and action.customer_identity_id = resolved_inbound_identity_id
         and action.customer_id = resolved_customer_id
         and action.conversation_id = resolved_conversation_id;

      if not found
        or resolved_capability_status <> 'consumed'
        or resolved_capability_consumed_event_id is distinct from p_origin_inbound_event_id then
        raise exception 'The replayed Telegram Player ID action requires remediation.';
      end if;
    elsif resolved_existing_outcome = 'active_action_exists' then
      if resolved_capability_status <> 'consumed'
        or resolved_capability_consumed_event_id is distinct from p_origin_inbound_event_id then
        raise exception 'The replayed Telegram Player ID action requires remediation.';
      end if;
    elsif resolved_existing_outcome = 'expired' then
      if resolved_capability_status <> 'expired'
        or resolved_capability_expired_event_id is distinct from p_origin_inbound_event_id then
        raise exception 'The replayed Telegram Player ID action requires remediation.';
      end if;
    elsif resolved_existing_outcome = 'rejected' then
      if resolved_existing_reason_code <> 'stale_capability'
        or not (
          (resolved_capability_status = 'revoked'
            and resolved_capability_revoked_event_id = p_origin_inbound_event_id)
          or exists (
            select 1
              from app.bot_action_capability_terminal_rejections terminal_rejection
             where terminal_rejection.origin_inbound_event_id = p_origin_inbound_event_id
               and terminal_rejection.capability_id = p_capability_id
          )
        ) then
        raise exception 'The replayed Telegram Player ID action requires remediation.';
      end if;
    else
      raise exception 'The replayed Telegram Player ID action requires remediation.';
    end if;

    return query
    select resolved_existing_outcome::text,
           resolved_existing_reason_code,
           resolved_existing_action_id,
           resolved_existing_action_expires_at,
           resolved_existing_version_after,
           true;
    return;
  end if;

  if resolved_inbound_processed_at is not null then
    raise exception 'The Telegram inbound event requires remediation before a Player ID action.';
  end if;

  if resolved_identity_status <> 'active'
    or resolved_customer_status <> 'active' then
    raise exception 'The Telegram customer is not available for a new Player ID action.';
  end if;

  select platform.id,
         platform.status
    into resolved_platform_id,
         resolved_platform_status
    from app.platforms platform
   where platform.code = 'kemerbet'
   for share;

  if not found then
    raise exception 'The KemerBet platform is not available for a Player ID action.';
  end if;

  select conversation.version,
         conversation.state
    into resolved_conversation_version,
         resolved_conversation_state
    from app.bot_conversations conversation
   where conversation.id = resolved_conversation_id
   for update;

  if not found then
    raise exception 'The Telegram customer conversation is not available for a Player ID action.';
  end if;

  select capability.platform_id,
         capability.customer_identity_id,
         capability.customer_id,
         capability.conversation_id,
         capability.capability_kind,
         capability.status,
         capability.expected_conversation_version,
         capability.expires_at,
         capability.consumed_by_inbound_event_id,
         capability.revoked_by_inbound_event_id,
         capability.expired_by_inbound_event_id
    into resolved_capability_platform_id,
         resolved_capability_identity_id,
         resolved_capability_customer_id,
         resolved_capability_conversation_id,
         resolved_capability_kind,
         resolved_capability_status,
         resolved_capability_expected_version,
         resolved_capability_expires_at,
         resolved_capability_consumed_event_id,
         resolved_capability_revoked_event_id,
         resolved_capability_expired_event_id
    from app.bot_action_capabilities capability
   where capability.id = p_capability_id
     and capability.token_fingerprint = p_capability_token_fingerprint
   for update;

  if not found
    or resolved_capability_platform_id is distinct from resolved_platform_id
    or resolved_capability_identity_id is distinct from resolved_inbound_identity_id
    or resolved_capability_customer_id is distinct from resolved_customer_id
    or resolved_capability_conversation_id is distinct from resolved_conversation_id
    or resolved_capability_kind <> 'begin_player_registration' then
    raise exception 'The Telegram Player ID capability is invalid for this conversation.';
  end if;

  -- The action is locked after the capability. Its expiry takes precedence over every callback
  -- result, including presentation of an already-terminal button, so one fresh update can only
  -- be consumed by the dedicated expiry procedure.
  select action.id,
         action.expires_at
    into resolved_active_action_id,
         resolved_active_action_expires_at
    from app.bot_conversation_actions action
   where action.conversation_id = resolved_conversation_id
     and action.status = 'awaiting_input'
   for update;

  resolved_now := clock_timestamp();

  if resolved_active_action_id is not null
    and resolved_active_action_expires_at <= resolved_now then
    raise exception 'The active Player ID action has expired and must be completed by the expiry procedure.';
  end if;

  if resolved_capability_status in ('consumed', 'revoked', 'expired') then
    insert into app.inbound_event_consumptions (
      origin_inbound_event_id,
      customer_identity_id,
      customer_id,
      conversation_id,
      consumer_kind,
      semantic_input_hmac,
      outcome,
      outcome_reason_code,
      conversation_version_before,
      conversation_version_after
    )
    values (
      p_origin_inbound_event_id,
      resolved_inbound_identity_id,
      resolved_customer_id,
      resolved_conversation_id,
      'start_player_registration',
      p_semantic_input_hmac,
      'rejected',
      'stale_capability',
      resolved_conversation_version,
      resolved_conversation_version
    );

    insert into app.bot_action_capability_terminal_rejections (
      origin_inbound_event_id,
      capability_id
    )
    values (
      p_origin_inbound_event_id,
      p_capability_id
    );

    return query
    select 'rejected',
           'stale_capability',
           null::uuid,
           null::timestamptz,
           resolved_conversation_version,
           false;
    return;
  end if;

  if resolved_capability_status <> 'issued' then
    raise exception 'The Telegram Player ID capability is not available for a new action.';
  end if;

  if resolved_now >= resolved_capability_expires_at then
    insert into app.inbound_event_consumptions (
      origin_inbound_event_id,
      customer_identity_id,
      customer_id,
      conversation_id,
      consumer_kind,
      semantic_input_hmac,
      outcome,
      outcome_reason_code,
      conversation_version_before,
      conversation_version_after
    )
    values (
      p_origin_inbound_event_id,
      resolved_inbound_identity_id,
      resolved_customer_id,
      resolved_conversation_id,
      'start_player_registration',
      p_semantic_input_hmac,
      'expired',
      'capability_expired',
      resolved_conversation_version,
      resolved_conversation_version
    );

    update app.bot_action_capabilities capability
       set status = 'expired',
           expired_by_inbound_event_id = p_origin_inbound_event_id
     where capability.id = p_capability_id
       and capability.status = 'issued';

    if not found then
      raise exception 'The Telegram Player ID capability changed while it was being expired.';
    end if;

    return query
    select 'expired',
           'capability_expired',
           null::uuid,
           null::timestamptz,
           resolved_conversation_version,
           false;
    return;
  end if;

  if resolved_capability_expected_version <> resolved_conversation_version then
    if resolved_conversation_version < resolved_capability_expected_version then
      raise exception 'The Telegram Player ID capability does not match the current conversation version.';
    end if;

    insert into app.inbound_event_consumptions (
      origin_inbound_event_id,
      customer_identity_id,
      customer_id,
      conversation_id,
      consumer_kind,
      semantic_input_hmac,
      outcome,
      outcome_reason_code,
      conversation_version_before,
      conversation_version_after
    )
    values (
      p_origin_inbound_event_id,
      resolved_inbound_identity_id,
      resolved_customer_id,
      resolved_conversation_id,
      'start_player_registration',
      p_semantic_input_hmac,
      'rejected',
      'stale_capability',
      resolved_conversation_version,
      resolved_conversation_version
    );

    update app.bot_action_capabilities capability
       set status = 'revoked',
           revoked_by_inbound_event_id = p_origin_inbound_event_id
     where capability.id = p_capability_id
       and capability.status = 'issued'
       and capability.expires_at > clock_timestamp();

    if not found then
      raise exception 'The Telegram Player ID capability changed while it was being revoked.';
    end if;

    return query
    select 'rejected',
           'stale_capability',
           null::uuid,
           null::timestamptz,
           resolved_conversation_version,
           false;
    return;
  end if;

  if resolved_active_action_id is not null then
    insert into app.inbound_event_consumptions (
      origin_inbound_event_id,
      customer_identity_id,
      customer_id,
      conversation_id,
      consumer_kind,
      semantic_input_hmac,
      outcome,
      outcome_reason_code,
      conversation_version_before,
      conversation_version_after
    )
    values (
      p_origin_inbound_event_id,
      resolved_inbound_identity_id,
      resolved_customer_id,
      resolved_conversation_id,
      'start_player_registration',
      p_semantic_input_hmac,
      'active_action_exists',
      'active_action_exists',
      resolved_conversation_version,
      resolved_conversation_version
    );

    update app.bot_action_capabilities capability
       set status = 'consumed',
           consumed_by_inbound_event_id = p_origin_inbound_event_id
     where capability.id = p_capability_id
       and capability.status = 'issued'
       and capability.expires_at > clock_timestamp();

    if not found then
      raise exception 'The Telegram Player ID capability changed while it was being consumed.';
    end if;

    return query
    select 'active_action_exists',
           'active_action_exists',
           null::uuid,
           null::timestamptz,
           resolved_conversation_version,
           false;
    return;
  end if;

  -- Settling an expired, stale, or redundant callback is safe after platform deactivation. Only
  -- the branch below creates a new Player-ID action, so require the platform to remain active
  -- immediately before that state-changing operation.
  if resolved_platform_status <> 'active' then
    raise exception 'The KemerBet platform is not available for a new Player ID action.';
  end if;

  insert into app.inbound_event_consumptions (
    origin_inbound_event_id,
    customer_identity_id,
    customer_id,
    conversation_id,
    consumer_kind,
    semantic_input_hmac,
    outcome,
    outcome_reason_code,
    conversation_version_before,
    conversation_version_after
  )
  values (
    p_origin_inbound_event_id,
    resolved_inbound_identity_id,
    resolved_customer_id,
    resolved_conversation_id,
    'start_player_registration',
    p_semantic_input_hmac,
    'completed',
    'player_registration_started',
    resolved_conversation_version,
    resolved_conversation_version + 1
  );

  update app.bot_action_capabilities capability
     set status = 'consumed',
         consumed_by_inbound_event_id = p_origin_inbound_event_id
   where capability.id = p_capability_id
      and capability.status = 'issued'
      and capability.expires_at > clock_timestamp();

  if not found then
    raise exception 'The Telegram Player ID capability changed while it was being consumed.';
  end if;

  -- As with capabilities, leave a small server-owned margin below the schema's ten-minute upper
  -- bound because the action binding trigger controls created_at at insert time.
  resolved_new_action_expires_at := clock_timestamp() + interval '9 minutes 59 seconds';

  insert into app.bot_conversation_actions (
    conversation_id,
    customer_identity_id,
    customer_id,
    platform_id,
    action_kind,
    expected_input_kind,
    capability_id,
    started_from_inbound_event_id,
    expires_at
  )
  values (
    resolved_conversation_id,
    resolved_inbound_identity_id,
    resolved_customer_id,
    resolved_platform_id,
    'player_registration',
    'player_id',
    p_capability_id,
    p_origin_inbound_event_id,
    resolved_new_action_expires_at
  )
  returning id, expires_at
    into resolved_new_action_id,
         resolved_new_action_expires_at;

  update app.bot_conversations conversation
     set state = jsonb_build_object(
           'v', 1,
           'kind', 'awaiting_player_id',
           'action_id', resolved_new_action_id::text,
           'platform_code', 'kemerbet',
           'expires_at', to_char(
             resolved_new_action_expires_at at time zone 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
           )
         ),
         version = conversation.version + 1
   where conversation.id = resolved_conversation_id
     and conversation.version = resolved_conversation_version
  returning conversation.version into resolved_next_version;

  if not found then
    raise exception 'The Telegram Player ID conversation changed while the action was starting.';
  end if;

  insert into app.audit_events (
    actor_kind,
    actor_customer_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    'customer',
    resolved_customer_id,
    'customer.player_registration_action_started',
    'telegram_conversation_action',
    resolved_new_action_id,
    jsonb_build_object('channel', 'telegram', 'platform_code', 'kemerbet')
  );

  return query
  select 'completed',
         'player_registration_started',
         resolved_new_action_id,
         resolved_new_action_expires_at,
         resolved_next_version,
         false;
end;
$$;

-- Consume one later Telegram text update as a Player-ID request. The procedure derives the active
-- action from the locked conversation; it never accepts an action/platform/customer identifier
-- from the caller. The raw Player ID is used only inside this private transaction and is not put
-- into the receipt, audit metadata, callback data, or a generic conversation state object.
create function app.submit_telegram_player_registration_input(
  p_origin_inbound_event_id uuid,
  p_player_id text,
  p_semantic_input_hmac text
)
returns table (
  result_outcome text,
  result_reason_code text,
  player_registration_request_id uuid,
  request_status text,
  existing_request_reused boolean,
  conversation_version bigint,
  origin_inbound_event_already_consumed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_inbound_identity_id uuid;
  resolved_inbound_processed_at timestamptz;
  resolved_inbound_received_at timestamptz;
  resolved_inbound_update_id bigint;
  resolved_customer_id uuid;
  resolved_identity_status app.record_status;
  resolved_identity_kind text;
  resolved_customer_status app.record_status;
  resolved_conversation_id uuid;
  resolved_conversation_version bigint;
  resolved_conversation_state jsonb;
  resolved_platform_id uuid;
  resolved_action_id uuid;
  resolved_preliminary_capability_id uuid;
  resolved_action_capability_id uuid;
  resolved_action_platform_id uuid;
  resolved_action_status app.bot_conversation_action_status;
  resolved_action_expires_at timestamptz;
  resolved_action_created_at timestamptz;
  resolved_action_start_event_id uuid;
  resolved_started_update_id bigint;
  resolved_capability_id uuid;
  resolved_capability_status app.telegram_action_capability_status;
  resolved_capability_platform_id uuid;
  resolved_capability_identity_id uuid;
  resolved_capability_customer_id uuid;
  resolved_capability_conversation_id uuid;
  resolved_now timestamptz;
  resolved_normalized_player_id text;
  resolved_request_id uuid;
  resolved_request_status text;
  resolved_request_reused boolean;
  resolved_next_version bigint;
  resolved_existing_consumer_kind app.telegram_inbound_consumer_kind;
  resolved_existing_semantic_hmac text;
  resolved_existing_outcome app.telegram_inbound_consumption_outcome;
  resolved_existing_reason_code text;
  resolved_existing_identity_id uuid;
  resolved_existing_customer_id uuid;
  resolved_existing_conversation_id uuid;
  resolved_existing_version_after bigint;
begin
  if p_origin_inbound_event_id is null
    or p_semantic_input_hmac is null
    or p_semantic_input_hmac <> lower(btrim(p_semantic_input_hmac))
    or p_semantic_input_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The Telegram Player ID input integrity value is invalid.';
  end if;

  -- This mirrors the private request primitive's ordinary-space normalization. It is deliberately
  -- not Unicode/case/zero normalization, and the primitive repeats the authoritative validation.
  resolved_normalized_player_id := btrim(p_player_id);

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);

  select inbound_event.customer_identity_id,
         inbound_event.processed_at,
         inbound_event.received_at,
         inbound_event.telegram_update_id
    into resolved_inbound_identity_id,
         resolved_inbound_processed_at,
         resolved_inbound_received_at,
         resolved_inbound_update_id
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;

  if not found
    or resolved_inbound_identity_id is null
    or resolved_inbound_received_at is null
    or resolved_inbound_update_id is null then
    raise exception 'The Telegram inbound event is not available for Player ID input.';
  end if;

  select customer_identity.customer_id,
         customer_identity.status,
         customer_identity.identity_kind
    into resolved_customer_id,
         resolved_identity_status,
         resolved_identity_kind
    from app.customer_identities customer_identity
   where customer_identity.id = resolved_inbound_identity_id
   for update;

  if not found
    or resolved_identity_kind <> 'telegram' then
    raise exception 'The Telegram customer identity is not available for Player ID input.';
  end if;

  select customer.status
    into resolved_customer_status
    from app.customers customer
   where customer.id = resolved_customer_id
   for update;

  if not found then
    raise exception 'The Telegram customer is not available for Player ID input.';
  end if;

  perform 1
    from app.telegram_identities telegram_identity
   where telegram_identity.customer_identity_id = resolved_inbound_identity_id
   for update;

  if not found then
    raise exception 'The Telegram customer identity is not available for Player ID input.';
  end if;

  select conversation.id
    into resolved_conversation_id
    from app.bot_conversations conversation
   where conversation.telegram_identity_id = resolved_inbound_identity_id;

  if not found then
    raise exception 'The Telegram customer conversation is not available for Player ID input.';
  end if;

  select consumption.consumer_kind,
         consumption.semantic_input_hmac,
         consumption.outcome,
         consumption.outcome_reason_code,
         consumption.customer_identity_id,
         consumption.customer_id,
         consumption.conversation_id,
         consumption.conversation_version_after
    into resolved_existing_consumer_kind,
         resolved_existing_semantic_hmac,
         resolved_existing_outcome,
         resolved_existing_reason_code,
         resolved_existing_identity_id,
         resolved_existing_customer_id,
         resolved_existing_conversation_id,
         resolved_existing_version_after
    from app.inbound_event_consumptions consumption
   where consumption.origin_inbound_event_id = p_origin_inbound_event_id;

  if found then
    if resolved_existing_consumer_kind <> 'submit_player_registration_input'
      or resolved_existing_semantic_hmac is distinct from p_semantic_input_hmac
      or resolved_existing_identity_id is distinct from resolved_inbound_identity_id
      or resolved_existing_customer_id is distinct from resolved_customer_id
      or resolved_existing_conversation_id is distinct from resolved_conversation_id then
      raise exception 'The replayed Telegram Player ID input does not match its recorded result.';
    end if;

    if resolved_existing_outcome = 'completed' then
      select request_event.player_registration_request_id,
             registration_request.status::text,
             request_event.request_reused
        into resolved_request_id,
             resolved_request_status,
             resolved_request_reused
        from app.player_registration_request_events request_event
        join app.player_registration_requests registration_request
          on registration_request.id = request_event.player_registration_request_id
       where request_event.origin_inbound_event_id = p_origin_inbound_event_id
         and registration_request.customer_id = resolved_customer_id
         and registration_request.player_id = resolved_normalized_player_id;

      if not found then
        raise exception 'The replayed Telegram Player ID input requires remediation.';
      end if;
    elsif resolved_existing_outcome = 'rejected'
      and resolved_existing_reason_code in ('input_predates_active_action', 'invalid_player_id') then
      resolved_request_id := null;
      resolved_request_status := null;
      resolved_request_reused := null;
    else
      raise exception 'The replayed Telegram Player ID input requires remediation.';
    end if;

    return query
    select resolved_existing_outcome::text,
           resolved_existing_reason_code,
           resolved_request_id,
           resolved_request_status,
           resolved_request_reused,
           resolved_existing_version_after,
           true;
    return;
  end if;

  if resolved_inbound_processed_at is not null then
    raise exception 'The Telegram inbound event requires remediation before Player ID input.';
  end if;

  if resolved_identity_status <> 'active'
    or resolved_customer_status <> 'active' then
    raise exception 'The Telegram customer is not available for new Player ID input.';
  end if;

  -- Allow terminal cleanup for an already-created action even if KemerBet is subsequently made
  -- inactive, but never allow the action to refer to any platform other than its immutable V1 row.
  select platform.id
    into resolved_platform_id
    from app.platforms platform
   where platform.code = 'kemerbet'
   for share;

  if not found then
    raise exception 'The KemerBet platform is not available for Player ID input.';
  end if;

  select conversation.version,
         conversation.state
    into resolved_conversation_version,
         resolved_conversation_state
    from app.bot_conversations conversation
   where conversation.id = resolved_conversation_id
   for update;

  if not found then
    raise exception 'The Telegram customer conversation is not available for Player ID input.';
  end if;

  -- The shared scope lock serializes all mutations for this conversation. Read the projected
  -- awaiting action only to discover its immutable capability, then take the required capability
  -- and action locks in that global order.
  select action.id,
         action.capability_id
    into resolved_action_id,
         resolved_preliminary_capability_id
    from app.bot_conversation_actions action
   where action.conversation_id = resolved_conversation_id
     and action.status = 'awaiting_input';

  if not found then
    raise exception 'There is no active Player ID action for this Telegram conversation.';
  end if;

  select capability.id,
         capability.status,
         capability.platform_id,
         capability.customer_identity_id,
         capability.customer_id,
         capability.conversation_id
    into resolved_capability_id,
         resolved_capability_status,
         resolved_capability_platform_id,
         resolved_capability_identity_id,
         resolved_capability_customer_id,
         resolved_capability_conversation_id
    from app.bot_action_capabilities capability
   where capability.id = resolved_preliminary_capability_id
   for update;

  if not found
    or resolved_capability_status <> 'consumed'
    or resolved_capability_platform_id is distinct from resolved_platform_id
    or resolved_capability_identity_id is distinct from resolved_inbound_identity_id
    or resolved_capability_customer_id is distinct from resolved_customer_id
    or resolved_capability_conversation_id is distinct from resolved_conversation_id then
    raise exception 'The active Telegram Player ID action requires remediation.';
  end if;

  select action.capability_id,
         action.platform_id,
         action.status,
         action.expires_at,
         action.created_at,
         action.started_from_inbound_event_id
    into resolved_action_capability_id,
         resolved_action_platform_id,
         resolved_action_status,
         resolved_action_expires_at,
         resolved_action_created_at,
         resolved_action_start_event_id
    from app.bot_conversation_actions action
   where action.id = resolved_action_id
   for update;

  if not found
    or resolved_action_status <> 'awaiting_input'
    or resolved_action_capability_id is distinct from resolved_capability_id
    or resolved_action_platform_id is distinct from resolved_platform_id
    or resolved_conversation_state ->> 'action_id' is distinct from resolved_action_id::text then
    raise exception 'The active Telegram Player ID action requires remediation.';
  end if;

  select inbound_event.telegram_update_id
    into resolved_started_update_id
    from app.inbound_events inbound_event
   where inbound_event.id = resolved_action_start_event_id;

  if not found
    or resolved_started_update_id is null then
    raise exception 'The active Telegram Player ID action requires remediation.';
  end if;

  resolved_now := clock_timestamp();

  if resolved_action_expires_at <= resolved_now then
    raise exception 'The active Player ID action has expired and must be completed by the expiry procedure.';
  end if;

  if resolved_inbound_update_id <= resolved_started_update_id
    or resolved_inbound_received_at < resolved_action_created_at then
    insert into app.inbound_event_consumptions (
      origin_inbound_event_id,
      customer_identity_id,
      customer_id,
      conversation_id,
      consumer_kind,
      semantic_input_hmac,
      outcome,
      outcome_reason_code,
      conversation_version_before,
      conversation_version_after
    )
    values (
      p_origin_inbound_event_id,
      resolved_inbound_identity_id,
      resolved_customer_id,
      resolved_conversation_id,
      'submit_player_registration_input',
      p_semantic_input_hmac,
      'rejected',
      'input_predates_active_action',
      resolved_conversation_version,
      resolved_conversation_version
    );

    return query
    select 'rejected',
           'input_predates_active_action',
           null::uuid,
           null::text,
           null::boolean,
           resolved_conversation_version,
           false;
    return;
  end if;

  if p_player_id is null
    or resolved_normalized_player_id is null
    or char_length(resolved_normalized_player_id) not between 1 and 64
    or resolved_normalized_player_id ~ '[[:cntrl:]]'
    or resolved_normalized_player_id ~ '[[:space:]]' then
    insert into app.inbound_event_consumptions (
      origin_inbound_event_id,
      customer_identity_id,
      customer_id,
      conversation_id,
      consumer_kind,
      semantic_input_hmac,
      outcome,
      outcome_reason_code,
      conversation_version_before,
      conversation_version_after
    )
    values (
      p_origin_inbound_event_id,
      resolved_inbound_identity_id,
      resolved_customer_id,
      resolved_conversation_id,
      'submit_player_registration_input',
      p_semantic_input_hmac,
      'rejected',
      'invalid_player_id',
      resolved_conversation_version,
      resolved_conversation_version
    );

    return query
    select 'rejected',
           'invalid_player_id',
           null::uuid,
           null::text,
           null::boolean,
           resolved_conversation_version,
           false;
    return;
  end if;

  insert into app.inbound_event_consumptions (
    origin_inbound_event_id,
    customer_identity_id,
    customer_id,
    conversation_id,
    consumer_kind,
    semantic_input_hmac,
    outcome,
    outcome_reason_code,
    conversation_version_before,
    conversation_version_after
  )
  values (
    p_origin_inbound_event_id,
    resolved_inbound_identity_id,
    resolved_customer_id,
    resolved_conversation_id,
    'submit_player_registration_input',
    p_semantic_input_hmac,
    'completed',
    'player_registration_requested',
    resolved_conversation_version,
    resolved_conversation_version + 1
  );

  select registration_result.player_registration_request_id,
         registration_result.request_status,
         registration_result.existing_request_reused
    into resolved_request_id,
         resolved_request_status,
         resolved_request_reused
    from app.create_or_reuse_player_registration_request(
      resolved_customer_id,
      resolved_platform_id,
      p_player_id
    ) registration_result;

  if not found then
    raise exception 'The Player ID registration request could not be created.';
  end if;

  insert into app.player_registration_request_events (
    origin_inbound_event_id,
    player_registration_request_id,
    request_reused
  )
  values (
    p_origin_inbound_event_id,
    resolved_request_id,
    resolved_request_reused
  );

  update app.bot_conversation_actions action
     set status = 'completed',
         completed_by_inbound_event_id = p_origin_inbound_event_id
   where action.id = resolved_action_id
     and action.status = 'awaiting_input';

  if not found then
    raise exception 'The active Telegram Player ID action changed while input was being submitted.';
  end if;

  update app.bot_conversations conversation
     set state = '{"v": 1, "kind": "idle"}'::jsonb,
         version = conversation.version + 1
   where conversation.id = resolved_conversation_id
     and conversation.version = resolved_conversation_version
  returning conversation.version into resolved_next_version;

  if not found then
    raise exception 'The Telegram Player ID conversation changed while input was being submitted.';
  end if;

  insert into app.audit_events (
    actor_kind,
    actor_customer_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    'customer',
    resolved_customer_id,
    'customer.player_registration_requested',
    'player_registration_request',
    resolved_request_id,
    jsonb_build_object(
      'channel', 'telegram',
      'platform_code', 'kemerbet',
      'request_reused', resolved_request_reused
    )
  );

  return query
  select 'completed',
         'player_registration_requested',
         resolved_request_id,
         resolved_request_status,
         resolved_request_reused,
         resolved_next_version,
         false;
end;
$$;

-- Lazily close an awaiting Player-ID action only after its server-controlled deadline has passed.
-- A caller cannot select an action ID: the locked conversation projection is the sole authority.
create function app.expire_telegram_player_registration_action(
  p_origin_inbound_event_id uuid,
  p_semantic_input_hmac text
)
returns table (
  player_registration_action_id uuid,
  action_status text,
  conversation_version bigint,
  origin_inbound_event_already_consumed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_inbound_identity_id uuid;
  resolved_inbound_processed_at timestamptz;
  resolved_customer_id uuid;
  resolved_identity_status app.record_status;
  resolved_identity_kind text;
  resolved_customer_status app.record_status;
  resolved_conversation_id uuid;
  resolved_conversation_version bigint;
  resolved_conversation_state jsonb;
  resolved_platform_id uuid;
  resolved_action_id uuid;
  resolved_preliminary_capability_id uuid;
  resolved_action_capability_id uuid;
  resolved_action_platform_id uuid;
  resolved_action_status app.bot_conversation_action_status;
  resolved_action_expires_at timestamptz;
  resolved_capability_id uuid;
  resolved_capability_status app.telegram_action_capability_status;
  resolved_capability_platform_id uuid;
  resolved_capability_identity_id uuid;
  resolved_capability_customer_id uuid;
  resolved_capability_conversation_id uuid;
  resolved_now timestamptz;
  resolved_next_version bigint;
  resolved_existing_consumer_kind app.telegram_inbound_consumer_kind;
  resolved_existing_semantic_hmac text;
  resolved_existing_outcome app.telegram_inbound_consumption_outcome;
  resolved_existing_reason_code text;
  resolved_existing_identity_id uuid;
  resolved_existing_customer_id uuid;
  resolved_existing_conversation_id uuid;
  resolved_existing_version_after bigint;
begin
  if p_origin_inbound_event_id is null
    or p_semantic_input_hmac is null
    or p_semantic_input_hmac <> lower(btrim(p_semantic_input_hmac))
    or p_semantic_input_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The Telegram Player ID expiry integrity value is invalid.';
  end if;

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);

  select inbound_event.customer_identity_id,
         inbound_event.processed_at
    into resolved_inbound_identity_id,
         resolved_inbound_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;

  if not found
    or resolved_inbound_identity_id is null then
    raise exception 'The Telegram inbound event is not available for Player ID expiry.';
  end if;

  select customer_identity.customer_id,
         customer_identity.status,
         customer_identity.identity_kind
    into resolved_customer_id,
         resolved_identity_status,
         resolved_identity_kind
    from app.customer_identities customer_identity
   where customer_identity.id = resolved_inbound_identity_id
   for update;

  if not found
    or resolved_identity_kind <> 'telegram' then
    raise exception 'The Telegram customer identity is not available for Player ID expiry.';
  end if;

  select customer.status
    into resolved_customer_status
    from app.customers customer
   where customer.id = resolved_customer_id
   for update;

  if not found then
    raise exception 'The Telegram customer is not available for Player ID expiry.';
  end if;

  perform 1
    from app.telegram_identities telegram_identity
   where telegram_identity.customer_identity_id = resolved_inbound_identity_id
   for update;

  if not found then
    raise exception 'The Telegram customer identity is not available for Player ID expiry.';
  end if;

  select conversation.id
    into resolved_conversation_id
    from app.bot_conversations conversation
   where conversation.telegram_identity_id = resolved_inbound_identity_id;

  if not found then
    raise exception 'The Telegram customer conversation is not available for Player ID expiry.';
  end if;

  select consumption.consumer_kind,
         consumption.semantic_input_hmac,
         consumption.outcome,
         consumption.outcome_reason_code,
         consumption.customer_identity_id,
         consumption.customer_id,
         consumption.conversation_id,
         consumption.conversation_version_after
    into resolved_existing_consumer_kind,
         resolved_existing_semantic_hmac,
         resolved_existing_outcome,
         resolved_existing_reason_code,
         resolved_existing_identity_id,
         resolved_existing_customer_id,
         resolved_existing_conversation_id,
         resolved_existing_version_after
    from app.inbound_event_consumptions consumption
   where consumption.origin_inbound_event_id = p_origin_inbound_event_id;

  if found then
    if resolved_existing_consumer_kind <> 'expire_player_registration_action'
      or resolved_existing_semantic_hmac is distinct from p_semantic_input_hmac
      or resolved_existing_outcome <> 'completed'
      or resolved_existing_reason_code <> 'player_registration_action_expired'
      or resolved_existing_identity_id is distinct from resolved_inbound_identity_id
      or resolved_existing_customer_id is distinct from resolved_customer_id
      or resolved_existing_conversation_id is distinct from resolved_conversation_id then
      raise exception 'The replayed Telegram Player ID expiry does not match its recorded result.';
    end if;

    select action.id
      into resolved_action_id
      from app.bot_conversation_actions action
     where action.expired_by_inbound_event_id = p_origin_inbound_event_id
       and action.customer_identity_id = resolved_inbound_identity_id
       and action.customer_id = resolved_customer_id
       and action.conversation_id = resolved_conversation_id
       and action.status = 'expired';

    if not found then
      raise exception 'The replayed Telegram Player ID expiry requires remediation.';
    end if;

    return query
    select resolved_action_id,
           'expired',
           resolved_existing_version_after,
           true;
    return;
  end if;

  if resolved_inbound_processed_at is not null then
    raise exception 'The Telegram inbound event requires remediation before Player ID expiry.';
  end if;

  if resolved_identity_status <> 'active'
    or resolved_customer_status <> 'active' then
    raise exception 'The Telegram customer is not available for new Player ID expiry.';
  end if;

  -- An existing action is allowed to cleanly expire after platform deactivation, but its immutable
  -- platform binding must still be the V1 KemerBet row.
  select platform.id
    into resolved_platform_id
    from app.platforms platform
   where platform.code = 'kemerbet'
   for share;

  if not found then
    raise exception 'The KemerBet platform is not available for Player ID expiry.';
  end if;

  select conversation.version,
         conversation.state
    into resolved_conversation_version,
         resolved_conversation_state
    from app.bot_conversations conversation
   where conversation.id = resolved_conversation_id
   for update;

  if not found then
    raise exception 'The Telegram customer conversation is not available for Player ID expiry.';
  end if;

  select action.id,
         action.capability_id
    into resolved_action_id,
         resolved_preliminary_capability_id
    from app.bot_conversation_actions action
   where action.conversation_id = resolved_conversation_id
     and action.status = 'awaiting_input';

  if not found then
    raise exception 'There is no active Player ID action to expire for this Telegram conversation.';
  end if;

  select capability.id,
         capability.status,
         capability.platform_id,
         capability.customer_identity_id,
         capability.customer_id,
         capability.conversation_id
    into resolved_capability_id,
         resolved_capability_status,
         resolved_capability_platform_id,
         resolved_capability_identity_id,
         resolved_capability_customer_id,
         resolved_capability_conversation_id
    from app.bot_action_capabilities capability
   where capability.id = resolved_preliminary_capability_id
   for update;

  if not found
    or resolved_capability_status <> 'consumed'
    or resolved_capability_platform_id is distinct from resolved_platform_id
    or resolved_capability_identity_id is distinct from resolved_inbound_identity_id
    or resolved_capability_customer_id is distinct from resolved_customer_id
    or resolved_capability_conversation_id is distinct from resolved_conversation_id then
    raise exception 'The active Telegram Player ID action requires remediation.';
  end if;

  select action.capability_id,
         action.platform_id,
         action.status,
         action.expires_at
    into resolved_action_capability_id,
         resolved_action_platform_id,
         resolved_action_status,
         resolved_action_expires_at
    from app.bot_conversation_actions action
   where action.id = resolved_action_id
   for update;

  if not found
    or resolved_action_status <> 'awaiting_input'
    or resolved_action_capability_id is distinct from resolved_capability_id
    or resolved_action_platform_id is distinct from resolved_platform_id
    or resolved_conversation_state ->> 'action_id' is distinct from resolved_action_id::text then
    raise exception 'The active Telegram Player ID action requires remediation.';
  end if;

  resolved_now := clock_timestamp();

  if resolved_action_expires_at > resolved_now then
    raise exception 'The active Player ID action has not reached its expiry deadline.';
  end if;

  insert into app.inbound_event_consumptions (
    origin_inbound_event_id,
    customer_identity_id,
    customer_id,
    conversation_id,
    consumer_kind,
    semantic_input_hmac,
    outcome,
    outcome_reason_code,
    conversation_version_before,
    conversation_version_after
  )
  values (
    p_origin_inbound_event_id,
    resolved_inbound_identity_id,
    resolved_customer_id,
    resolved_conversation_id,
    'expire_player_registration_action',
    p_semantic_input_hmac,
    'completed',
    'player_registration_action_expired',
    resolved_conversation_version,
    resolved_conversation_version + 1
  );

  update app.bot_conversation_actions action
     set status = 'expired',
         expired_by_inbound_event_id = p_origin_inbound_event_id
   where action.id = resolved_action_id
     and action.status = 'awaiting_input';

  if not found then
    raise exception 'The active Telegram Player ID action changed while it was expiring.';
  end if;

  update app.bot_conversations conversation
     set state = '{"v": 1, "kind": "idle"}'::jsonb,
         version = conversation.version + 1
   where conversation.id = resolved_conversation_id
     and conversation.version = resolved_conversation_version
  returning conversation.version into resolved_next_version;

  if not found then
    raise exception 'The Telegram Player ID conversation changed while it was expiring.';
  end if;

  insert into app.audit_events (
    actor_kind,
    actor_customer_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    'customer',
    resolved_customer_id,
    'customer.player_registration_action_expired',
    'telegram_conversation_action',
    resolved_action_id,
    jsonb_build_object('channel', 'telegram', 'platform_code', 'kemerbet')
  );

  return query
  select resolved_action_id,
         'expired',
         resolved_next_version,
         false;
end;
$$;

alter table app.bot_action_capability_terminal_rejections enable row level security;
alter table app.bot_action_capability_terminal_rejections force row level security;

revoke all privileges on table app.bot_action_capability_terminal_rejections
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.enforce_bot_action_capability_terminal_rejection_insert()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.reject_bot_action_capability_terminal_rejection_mutation()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.require_bot_action_capability_terminal_rejection_correspondence()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.issue_telegram_player_registration_capability(uuid, uuid, text, text)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.start_telegram_player_registration_action(uuid, uuid, text, text)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.submit_telegram_player_registration_input(uuid, text, text)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.expire_telegram_player_registration_action(uuid, text)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

comment on table app.bot_action_capability_terminal_rejections is
  'Private append-only proof that a new Telegram inbound event presented a terminal Player-ID capability. No raw callback token or Player ID is stored.';

comment on function app.issue_telegram_player_registration_capability(uuid, uuid, text, text) is
  'Unactivated private issuer for one KemerBet Player-ID capability. No runtime role may execute it directly.';

comment on function app.start_telegram_player_registration_action(uuid, uuid, text, text) is
  'Unactivated private Player-ID capability consumer. No runtime role may execute it directly.';

comment on function app.submit_telegram_player_registration_input(uuid, text, text) is
  'Unactivated private Player-ID text consumer. It stores a validated request but never claims or validates a KemerBet Player ID.';

comment on function app.expire_telegram_player_registration_action(uuid, text) is
  'Unactivated private Player-ID expiry consumer. No runtime role may execute it directly.';

commit;
