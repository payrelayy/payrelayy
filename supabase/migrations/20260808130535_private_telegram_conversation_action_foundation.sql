-- PayReplayy Stage 7: inert shared Telegram conversation-action foundation.
--
-- This migration adds no runtime EXECUTE grant. It establishes the durable records required before
-- a Telegram event may be interpreted as a customer action: a global event-consumption receipt,
-- a short-lived server-issued callback capability, and a conversation action. It also revokes the
-- old direct Telegram financial entry points from the API role because their local idempotency
-- alone cannot prove that an inbound update has only one meaning.

begin;

-- The preflight must observe a stable view of all legacy event/link writers. These access-exclusive
-- locks are deliberately taken in the existing Telegram writer's order (inbound event before
-- conversation before derived records). An already-running writer can finish before the checks;
-- a new writer waits until the old direct entry points have been revoked at the end of this
-- transaction.
lock table app.inbound_events in access exclusive mode;
lock table app.bot_conversations in access exclusive mode;
lock table app.player_registration_request_events in access exclusive mode;
lock table app.deposit_intents in access exclusive mode;
lock table app.deposit_submissions in access exclusive mode;

-- The only existing legacy projection that may be converted is the original empty object. Unknown
-- conversation state must be remediated rather than silently treated as idle.
do $$
begin
  if exists (
    select 1
      from app.bot_conversations conversation
     where conversation.state <> '{}'::jsonb
       and conversation.state <> '{"v": 1, "kind": "idle"}'::jsonb
  ) then
    raise exception 'Cannot install the Telegram conversation-action foundation while a conversation has an unknown state projection.';
  end if;

  -- This project has no active caller for the Stage 6 helper. Refuse to turn a pre-existing local
  -- event link into an untracked global consumption record.
  if exists (
    select 1
      from app.player_registration_request_events
  ) then
    raise exception 'Cannot install the Telegram conversation-action foundation while Player ID request event links require explicit global-consumption backfill.';
  end if;

  if exists (
    select 1
      from app.inbound_events inbound_event
     where inbound_event.channel = 'telegram'
       and inbound_event.processed_at is not null
  ) then
    raise exception 'Cannot install the Telegram conversation-action foundation while processed Telegram inbound events require explicit global-consumption backfill.';
  end if;

  if exists (
    select 1
      from app.deposit_intents deposit_intent
     where deposit_intent.origin_inbound_event_id is not null
  ) or exists (
    select 1
      from app.deposit_submissions deposit_submission
     where deposit_submission.origin_inbound_event_id is not null
  ) then
    raise exception 'Cannot install the Telegram conversation-action foundation while deposit event links require explicit global-consumption backfill.';
  end if;
end;
$$;

update app.bot_conversations
   set state = '{"v": 1, "kind": "idle"}'::jsonb
 where state = '{}'::jsonb;

alter table app.bot_conversations
  alter column state set default '{"v": 1, "kind": "idle"}'::jsonb;

-- Stage 5 records Telegram updates as the canonical private external ID `update:<bigint>`.
-- Preserve the numeric order in the database so a delayed older update cannot be interpreted as
-- input for a later conversation action merely because it reached the API later.
alter table app.inbound_events
  add column telegram_update_id bigint generated always as (
    case
      when channel = 'telegram'
        and external_event_id ~ '^update:[0-9]+$'
        then pg_catalog.substr(external_event_id, 8)::bigint
      else null
    end
  ) stored;

alter table app.inbound_events
  add constraint inbound_events_telegram_update_id_shape check (
    (channel = 'telegram' and telegram_update_id is not null)
    or (channel <> 'telegram' and telegram_update_id is null)
  );

create unique index inbound_events_telegram_update_id_unique_idx
  on app.inbound_events (telegram_update_id)
  where channel = 'telegram';

create type app.telegram_inbound_consumer_kind as enum (
  'issue_player_registration_capability',
  'start_player_registration',
  'submit_player_registration_input',
  'expire_player_registration_action'
);

create type app.telegram_inbound_consumption_outcome as enum (
  'completed',
  'active_action_exists',
  'expired',
  'rejected'
);

create type app.telegram_action_capability_kind as enum (
  'begin_player_registration'
);

create type app.telegram_action_capability_status as enum (
  'issued',
  'consumed',
  'revoked',
  'expired'
);

create type app.bot_conversation_action_kind as enum (
  'player_registration'
);

create type app.bot_conversation_action_status as enum (
  'awaiting_input',
  'completed',
  'expired'
);

create type app.bot_conversation_action_input_kind as enum (
  'player_id'
);

create table app.inbound_event_consumptions (
  origin_inbound_event_id uuid primary key
    references app.inbound_events (id) on delete restrict,
  customer_identity_id uuid not null
    references app.customer_identities (id) on delete restrict,
  customer_id uuid not null
    references app.customers (id) on delete restrict,
  conversation_id uuid not null
    references app.bot_conversations (id) on delete restrict,
  consumer_kind app.telegram_inbound_consumer_kind not null,
  semantic_input_hmac text not null check (
    semantic_input_hmac = lower(btrim(semantic_input_hmac))
    and semantic_input_hmac ~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$'
  ),
  outcome app.telegram_inbound_consumption_outcome not null,
  outcome_reason_code text not null check (
    outcome_reason_code = lower(btrim(outcome_reason_code))
    and outcome_reason_code ~ '^[a-z0-9_]{1,64}$'
  ),
  conversation_version_before bigint not null check (conversation_version_before >= 0),
  conversation_version_after bigint not null check (
    conversation_version_after = conversation_version_before
    or conversation_version_after = conversation_version_before + 1
  ),
  consumed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default now(),
  constraint inbound_event_consumptions_consumer_outcome_shape check (
    (consumer_kind = 'issue_player_registration_capability'
      and outcome = 'completed')
    or (consumer_kind = 'start_player_registration'
      and outcome in ('completed', 'active_action_exists', 'expired', 'rejected'))
    or (consumer_kind = 'submit_player_registration_input'
      and outcome in ('completed', 'rejected'))
    or (consumer_kind = 'expire_player_registration_action'
      and outcome = 'completed')
  ),
  constraint inbound_event_consumptions_reason_shape check (
    (consumer_kind = 'issue_player_registration_capability'
      and outcome = 'completed'
      and outcome_reason_code = 'capability_issued')
    or (consumer_kind = 'start_player_registration'
      and outcome = 'completed'
      and outcome_reason_code = 'player_registration_started')
    or (consumer_kind = 'start_player_registration'
      and outcome = 'active_action_exists'
      and outcome_reason_code = 'active_action_exists')
    or (consumer_kind = 'start_player_registration'
      and outcome = 'expired'
      and outcome_reason_code = 'capability_expired')
    or (consumer_kind = 'start_player_registration'
      and outcome = 'rejected'
      and outcome_reason_code = 'stale_capability')
    or (consumer_kind = 'submit_player_registration_input'
      and outcome = 'completed'
      and outcome_reason_code = 'player_registration_requested')
    or (consumer_kind = 'submit_player_registration_input'
      and outcome = 'rejected'
      and outcome_reason_code in ('input_predates_active_action', 'invalid_player_id'))
    or (consumer_kind = 'expire_player_registration_action'
      and outcome = 'completed'
      and outcome_reason_code = 'player_registration_action_expired')
  )
);

create index inbound_event_consumptions_conversation_consumed_idx
  on app.inbound_event_consumptions (conversation_id, consumed_at desc);

create index inbound_event_consumptions_customer_consumed_idx
  on app.inbound_event_consumptions (customer_id, consumed_at desc);

create table app.bot_action_capabilities (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references app.bot_conversations (id) on delete restrict,
  customer_identity_id uuid not null
    references app.customer_identities (id) on delete restrict,
  customer_id uuid not null
    references app.customers (id) on delete restrict,
  platform_id uuid not null
    references app.platforms (id) on delete restrict,
  capability_kind app.telegram_action_capability_kind not null,
  token_fingerprint text not null unique check (
    token_fingerprint = lower(btrim(token_fingerprint))
    and token_fingerprint ~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$'
  ),
  expected_conversation_version bigint not null check (expected_conversation_version >= 0),
  issued_from_inbound_event_id uuid not null unique
    references app.inbound_events (id) on delete restrict,
  status app.telegram_action_capability_status not null default 'issued',
  expires_at timestamptz not null,
  consumed_by_inbound_event_id uuid unique
    references app.inbound_events (id) on delete restrict,
  revoked_by_inbound_event_id uuid unique
    references app.inbound_events (id) on delete restrict,
  expired_by_inbound_event_id uuid unique
    references app.inbound_events (id) on delete restrict,
  consumed_at timestamptz,
  revoked_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  constraint bot_action_capabilities_expiry_after_creation
    check (
      expires_at > created_at
      and expires_at <= created_at + interval '5 minutes'
    ),
  constraint bot_action_capabilities_terminal_time_shape check (
    (consumed_at is null or consumed_at <= expires_at)
    and (revoked_at is null or revoked_at >= created_at)
    and (expired_at is null or expired_at >= expires_at)
  ),
  constraint bot_action_capabilities_status_shape check (
    (status = 'issued'
      and consumed_by_inbound_event_id is null
      and revoked_by_inbound_event_id is null
      and expired_by_inbound_event_id is null
      and consumed_at is null
      and revoked_at is null
      and expired_at is null)
    or (status = 'consumed'
      and consumed_by_inbound_event_id is not null
      and revoked_by_inbound_event_id is null
      and expired_by_inbound_event_id is null
      and consumed_at is not null
      and revoked_at is null
      and expired_at is null)
    or (status = 'revoked'
      and consumed_by_inbound_event_id is null
      and expired_by_inbound_event_id is null
      and consumed_at is null
      and revoked_at is not null
      and expired_at is null)
    or (status = 'expired'
      and consumed_by_inbound_event_id is null
      and revoked_by_inbound_event_id is null
      and expired_by_inbound_event_id is not null
      and consumed_at is null
      and revoked_at is null
      and expired_at is not null)
  ),
  constraint bot_action_capabilities_distinct_event_links
    check (
      (consumed_by_inbound_event_id is null
        or consumed_by_inbound_event_id <> issued_from_inbound_event_id)
      and (revoked_by_inbound_event_id is null
        or revoked_by_inbound_event_id <> issued_from_inbound_event_id)
      and (expired_by_inbound_event_id is null
        or expired_by_inbound_event_id <> issued_from_inbound_event_id)
    )
);

create index bot_action_capabilities_conversation_status_expiry_idx
  on app.bot_action_capabilities (conversation_id, status, expires_at asc);

create index bot_action_capabilities_expiry_idx
  on app.bot_action_capabilities (expires_at asc)
  where status = 'issued';

create table app.bot_conversation_actions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references app.bot_conversations (id) on delete restrict,
  customer_identity_id uuid not null
    references app.customer_identities (id) on delete restrict,
  customer_id uuid not null
    references app.customers (id) on delete restrict,
  platform_id uuid not null
    references app.platforms (id) on delete restrict,
  action_kind app.bot_conversation_action_kind not null,
  expected_input_kind app.bot_conversation_action_input_kind not null,
  capability_id uuid not null unique
    references app.bot_action_capabilities (id) on delete restrict,
  started_from_inbound_event_id uuid not null unique
    references app.inbound_events (id) on delete restrict,
  status app.bot_conversation_action_status not null default 'awaiting_input',
  expires_at timestamptz not null,
  completed_by_inbound_event_id uuid unique
    references app.inbound_events (id) on delete restrict,
  expired_by_inbound_event_id uuid unique
    references app.inbound_events (id) on delete restrict,
  completed_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  constraint bot_conversation_actions_expiry_after_creation
    check (
      expires_at > created_at
      and expires_at <= created_at + interval '10 minutes'
    ),
  constraint bot_conversation_actions_terminal_time_shape check (
    (completed_at is null or completed_at <= expires_at)
    and (expired_at is null or expired_at >= expires_at)
  ),
  constraint bot_conversation_actions_status_shape check (
    (status = 'awaiting_input'
      and completed_by_inbound_event_id is null
      and expired_by_inbound_event_id is null
      and completed_at is null
      and expired_at is null)
    or (status = 'completed'
      and completed_by_inbound_event_id is not null
      and expired_by_inbound_event_id is null
      and completed_at is not null
      and expired_at is null)
    or (status = 'expired'
      and completed_by_inbound_event_id is null
      and expired_by_inbound_event_id is not null
      and completed_at is null
      and expired_at is not null)
  ),
  constraint bot_conversation_actions_distinct_event_links
    check (
      (completed_by_inbound_event_id is null
        or completed_by_inbound_event_id <> started_from_inbound_event_id)
      and (expired_by_inbound_event_id is null
        or expired_by_inbound_event_id <> started_from_inbound_event_id)
    )
);

create unique index bot_conversation_actions_one_awaiting_input_idx
  on app.bot_conversation_actions (conversation_id)
  where status = 'awaiting_input';

create index bot_conversation_actions_conversation_created_idx
  on app.bot_conversation_actions (conversation_id, created_at desc);

create index bot_conversation_actions_expiry_idx
  on app.bot_conversation_actions (expires_at asc)
  where status = 'awaiting_input';

-- All action-derived records must point at the global receipt that consumed their source event.
alter table app.bot_action_capabilities
  add constraint bot_action_capabilities_issued_consumption_fkey
  foreign key (issued_from_inbound_event_id)
  references app.inbound_event_consumptions (origin_inbound_event_id)
  on delete restrict;

alter table app.bot_action_capabilities
  add constraint bot_action_capabilities_consumed_consumption_fkey
  foreign key (consumed_by_inbound_event_id)
  references app.inbound_event_consumptions (origin_inbound_event_id)
  on delete restrict;

alter table app.bot_action_capabilities
  add constraint bot_action_capabilities_revoked_consumption_fkey
  foreign key (revoked_by_inbound_event_id)
  references app.inbound_event_consumptions (origin_inbound_event_id)
  on delete restrict;

alter table app.bot_action_capabilities
  add constraint bot_action_capabilities_expired_consumption_fkey
  foreign key (expired_by_inbound_event_id)
  references app.inbound_event_consumptions (origin_inbound_event_id)
  on delete restrict;

alter table app.bot_conversation_actions
  add constraint bot_conversation_actions_started_consumption_fkey
  foreign key (started_from_inbound_event_id)
  references app.inbound_event_consumptions (origin_inbound_event_id)
  on delete restrict;

alter table app.bot_conversation_actions
  add constraint bot_conversation_actions_completed_consumption_fkey
  foreign key (completed_by_inbound_event_id)
  references app.inbound_event_consumptions (origin_inbound_event_id)
  on delete restrict;

alter table app.bot_conversation_actions
  add constraint bot_conversation_actions_expired_consumption_fkey
  foreign key (expired_by_inbound_event_id)
  references app.inbound_event_consumptions (origin_inbound_event_id)
  on delete restrict;

alter table app.player_registration_request_events
  add constraint player_registration_request_events_consumption_fkey
  foreign key (origin_inbound_event_id)
  references app.inbound_event_consumptions (origin_inbound_event_id)
  on delete restrict;

-- Stage 5's identity-creation path uses these two scoped advisory locks. All Stage 7 mutations
-- take the same locks before any row locks so a later Stage 5 upgrade can serialize every inbound
-- path, including existing-event retries, with a conversation action for the same user/private
-- chat.
create function app.lock_telegram_inbound_event_scope(p_inbound_event_id uuid)
returns void
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_telegram_user_id bigint;
  resolved_private_chat_id bigint;
  user_lock_key bigint;
  chat_lock_key bigint;
begin
  select telegram_identity.telegram_user_id,
         telegram_identity.private_chat_id
    into resolved_telegram_user_id,
         resolved_private_chat_id
    from app.inbound_events inbound_event
    join app.customer_identities customer_identity
      on customer_identity.id = inbound_event.customer_identity_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = customer_identity.id
   where inbound_event.id = p_inbound_event_id
     and inbound_event.channel = 'telegram';

  if not found then
    raise exception 'The Telegram inbound event is not available for scoped locking.';
  end if;

  user_lock_key := pg_catalog.hashtextextended(
    'payreplayy:telegram-user:v1:' || resolved_telegram_user_id::text,
    0::bigint
  );
  chat_lock_key := pg_catalog.hashtextextended(
    'payreplayy:telegram-private-chat:v1:' || resolved_private_chat_id::text,
    0::bigint
  );

  if user_lock_key <= chat_lock_key then
    perform pg_catalog.pg_advisory_xact_lock(user_lock_key);
    if chat_lock_key <> user_lock_key then
      perform pg_catalog.pg_advisory_xact_lock(chat_lock_key);
    end if;
  else
    perform pg_catalog.pg_advisory_xact_lock(chat_lock_key);
    perform pg_catalog.pg_advisory_xact_lock(user_lock_key);
  end if;
end;
$$;

create function app.enforce_inbound_event_consumption_binding()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_inbound_identity_id uuid;
  resolved_inbound_processed_at timestamptz;
  resolved_customer_id uuid;
  resolved_identity_status app.record_status;
  resolved_identity_kind text;
  resolved_customer_status app.record_status;
  resolved_conversation_identity_id uuid;
  resolved_conversation_version bigint;
begin
  new.consumed_at := clock_timestamp();
  new.created_at := new.consumed_at;

  perform app.lock_telegram_inbound_event_scope(new.origin_inbound_event_id);

  select inbound_event.customer_identity_id,
         inbound_event.processed_at
    into resolved_inbound_identity_id,
         resolved_inbound_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = new.origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;

  if not found
    or resolved_inbound_identity_id is null then
    raise exception 'The Telegram inbound event is not available for consumption.';
  end if;

  if resolved_inbound_processed_at is not null then
    raise exception 'The Telegram inbound event has already been handled.';
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
    or resolved_identity_kind <> 'telegram'
    or resolved_identity_status <> 'active' then
    raise exception 'The Telegram customer identity is not available for consumption.';
  end if;

  select customer.status
    into resolved_customer_status
    from app.customers customer
   where customer.id = resolved_customer_id
   for update;

  if not found
    or resolved_customer_status <> 'active' then
    raise exception 'The Telegram customer is not available for consumption.';
  end if;

  perform 1
    from app.telegram_identities telegram_identity
   where telegram_identity.customer_identity_id = resolved_inbound_identity_id
   for update;

  if not found then
    raise exception 'The Telegram customer identity is not available for consumption.';
  end if;

  select conversation.telegram_identity_id,
         conversation.version
    into resolved_conversation_identity_id,
         resolved_conversation_version
    from app.bot_conversations conversation
   where conversation.id = new.conversation_id
   for update;

  if not found
    or resolved_inbound_identity_id is distinct from new.customer_identity_id
    or resolved_conversation_identity_id is distinct from new.customer_identity_id
    or resolved_customer_id is distinct from new.customer_id
    or resolved_conversation_version is distinct from new.conversation_version_before then
    raise exception 'The Telegram inbound event does not match its consumption binding.';
  end if;

  return new;
end;
$$;

create trigger inbound_event_consumptions_require_binding
before insert on app.inbound_event_consumptions
for each row
execute function app.enforce_inbound_event_consumption_binding();

create function app.mark_inbound_event_consumed()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  update app.inbound_events inbound_event
     set processed_at = new.consumed_at,
         processing_error_code = null
   where inbound_event.id = new.origin_inbound_event_id
     and inbound_event.processed_at is null;

  if not found then
    raise exception 'The Telegram inbound event could not be marked consumed.';
  end if;

  return null;
end;
$$;

create trigger inbound_event_consumptions_mark_inbound_event
after insert on app.inbound_event_consumptions
for each row
execute function app.mark_inbound_event_consumed();

create function app.require_inbound_event_consumption_final_version()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_version bigint;
begin
  select conversation.version
    into resolved_version
    from app.bot_conversations conversation
   where conversation.id = new.conversation_id;

  if not found
    or resolved_version is distinct from new.conversation_version_after then
    raise exception 'The Telegram inbound consumption does not match the final conversation version.';
  end if;

  return null;
end;
$$;

create constraint trigger inbound_event_consumptions_require_final_version
after insert on app.inbound_event_consumptions
deferrable initially deferred
for each row
execute function app.require_inbound_event_consumption_final_version();

create function app.reject_inbound_event_consumption_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  raise exception 'Telegram inbound event consumptions are append-only.';
end;
$$;

create trigger inbound_event_consumptions_immutable
before update or delete on app.inbound_event_consumptions
for each row
execute function app.reject_inbound_event_consumption_mutation();

create function app.enforce_bot_action_capability_binding()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_conversation_identity_id uuid;
  resolved_customer_id uuid;
  resolved_issued_identity_id uuid;
  resolved_consumed_identity_id uuid;
begin
  if tg_op = 'INSERT' then
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
  end if;

  perform app.lock_telegram_inbound_event_scope(new.issued_from_inbound_event_id);

  select inbound_event.customer_identity_id
    into resolved_issued_identity_id
    from app.inbound_events inbound_event
   where inbound_event.id = new.issued_from_inbound_event_id
     and inbound_event.channel = 'telegram'
   for key share;

  if not found
    or resolved_issued_identity_id is distinct from new.customer_identity_id then
    raise exception 'The Telegram action capability does not match its issuing event.';
  end if;

  select customer_identity.customer_id
    into resolved_customer_id
    from app.customer_identities customer_identity
   where customer_identity.id = new.customer_identity_id
   for key share;

  if not found
    or resolved_customer_id is distinct from new.customer_id then
    raise exception 'The Telegram action capability does not match its customer identity.';
  end if;

  perform 1
    from app.customers customer
   where customer.id = new.customer_id
   for key share;

  if not found then
    raise exception 'The Telegram action capability does not match its customer.';
  end if;

  perform 1
    from app.telegram_identities telegram_identity
   where telegram_identity.customer_identity_id = new.customer_identity_id
   for key share;

  if not found then
    raise exception 'The Telegram action capability does not match its Telegram identity.';
  end if;

  select conversation.telegram_identity_id
    into resolved_conversation_identity_id
    from app.bot_conversations conversation
   where conversation.id = new.conversation_id
   for key share;

  if not found
    or resolved_conversation_identity_id is distinct from new.customer_identity_id then
    raise exception 'The Telegram action capability does not match its conversation.';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'issued' then
      raise exception 'A Telegram action capability must begin issued.';
    end if;

    return new;
  end if;

  if new.conversation_id is distinct from old.conversation_id
    or new.customer_identity_id is distinct from old.customer_identity_id
    or new.customer_id is distinct from old.customer_id
    or new.platform_id is distinct from old.platform_id
    or new.capability_kind is distinct from old.capability_kind
    or new.token_fingerprint is distinct from old.token_fingerprint
    or new.expected_conversation_version is distinct from old.expected_conversation_version
    or new.issued_from_inbound_event_id is distinct from old.issued_from_inbound_event_id
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at then
    raise exception 'Telegram action capability bindings are immutable.';
  end if;

  if old.status <> 'issued' then
    if new.status is distinct from old.status
      or new.consumed_by_inbound_event_id is distinct from old.consumed_by_inbound_event_id
      or new.revoked_by_inbound_event_id is distinct from old.revoked_by_inbound_event_id
      or new.expired_by_inbound_event_id is distinct from old.expired_by_inbound_event_id
      or new.consumed_at is distinct from old.consumed_at
      or new.revoked_at is distinct from old.revoked_at
      or new.expired_at is distinct from old.expired_at then
      raise exception 'A terminal Telegram action capability cannot change.';
    end if;

    return new;
  end if;

  if new.status = 'issued' then
    return new;
  end if;

  if new.status not in ('consumed', 'revoked', 'expired') then
    raise exception 'The Telegram action capability transition is invalid.';
  end if;

  if new.status = 'consumed' then
    new.consumed_at := clock_timestamp();

    select inbound_event.customer_identity_id
      into resolved_consumed_identity_id
      from app.inbound_events inbound_event
     where inbound_event.id = new.consumed_by_inbound_event_id
       and inbound_event.channel = 'telegram';

    if resolved_consumed_identity_id is distinct from new.customer_identity_id then
      raise exception 'The Telegram action capability does not match its consuming event.';
    end if;
  elsif new.status = 'revoked' then
    new.revoked_at := clock_timestamp();

    if new.revoked_by_inbound_event_id is not null then
      select inbound_event.customer_identity_id
        into resolved_consumed_identity_id
        from app.inbound_events inbound_event
       where inbound_event.id = new.revoked_by_inbound_event_id
         and inbound_event.channel = 'telegram';

      if resolved_consumed_identity_id is distinct from new.customer_identity_id then
        raise exception 'The Telegram action capability does not match its revoking event.';
      end if;
    end if;
  else
    new.expired_at := clock_timestamp();

    select inbound_event.customer_identity_id
      into resolved_consumed_identity_id
      from app.inbound_events inbound_event
     where inbound_event.id = new.expired_by_inbound_event_id
       and inbound_event.channel = 'telegram';

    if resolved_consumed_identity_id is distinct from new.customer_identity_id then
      raise exception 'The Telegram action capability does not match its expiry event.';
    end if;
  end if;

  return new;
end;
$$;

create trigger bot_action_capabilities_require_binding
before insert or update on app.bot_action_capabilities
for each row
execute function app.enforce_bot_action_capability_binding();

create trigger bot_action_capabilities_set_updated_at
before update on app.bot_action_capabilities
for each row
execute function app.set_updated_at();

create function app.reject_bot_action_capability_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  raise exception 'Telegram action capabilities cannot be deleted.';
end;
$$;

create trigger bot_action_capabilities_no_delete
before delete on app.bot_action_capabilities
for each row
execute function app.reject_bot_action_capability_delete();

create function app.enforce_bot_conversation_action_binding()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_conversation_identity_id uuid;
  resolved_customer_id uuid;
  resolved_start_identity_id uuid;
  resolved_completion_identity_id uuid;
  resolved_capability_conversation_id uuid;
  resolved_capability_identity_id uuid;
  resolved_capability_customer_id uuid;
  resolved_capability_platform_id uuid;
  resolved_capability_kind app.telegram_action_capability_kind;
begin
  if tg_op = 'INSERT' then
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
  end if;

  perform app.lock_telegram_inbound_event_scope(new.started_from_inbound_event_id);

  select inbound_event.customer_identity_id
    into resolved_start_identity_id
    from app.inbound_events inbound_event
   where inbound_event.id = new.started_from_inbound_event_id
     and inbound_event.channel = 'telegram'
   for key share;

  if not found
    or resolved_start_identity_id is distinct from new.customer_identity_id then
    raise exception 'The Telegram conversation action does not match its starting event.';
  end if;

  select customer_identity.customer_id
    into resolved_customer_id
    from app.customer_identities customer_identity
   where customer_identity.id = new.customer_identity_id
   for key share;

  if not found
    or resolved_customer_id is distinct from new.customer_id then
    raise exception 'The Telegram conversation action does not match its customer identity.';
  end if;

  perform 1
    from app.customers customer
   where customer.id = new.customer_id
   for key share;

  if not found then
    raise exception 'The Telegram conversation action does not match its customer.';
  end if;

  perform 1
    from app.telegram_identities telegram_identity
   where telegram_identity.customer_identity_id = new.customer_identity_id
   for key share;

  if not found then
    raise exception 'The Telegram conversation action does not match its Telegram identity.';
  end if;

  select conversation.telegram_identity_id
    into resolved_conversation_identity_id
    from app.bot_conversations conversation
   where conversation.id = new.conversation_id
   for key share;

  if not found
    or resolved_conversation_identity_id is distinct from new.customer_identity_id then
    raise exception 'The Telegram conversation action does not match its conversation.';
  end if;

  select capability.conversation_id,
         capability.customer_identity_id,
         capability.customer_id,
         capability.platform_id,
         capability.capability_kind
    into resolved_capability_conversation_id,
         resolved_capability_identity_id,
         resolved_capability_customer_id,
         resolved_capability_platform_id,
         resolved_capability_kind
    from app.bot_action_capabilities capability
   where capability.id = new.capability_id
   for key share;

  if not found
    or resolved_capability_conversation_id is distinct from new.conversation_id
    or resolved_capability_identity_id is distinct from new.customer_identity_id
    or resolved_capability_customer_id is distinct from new.customer_id
    or resolved_capability_platform_id is distinct from new.platform_id
    or resolved_capability_kind <> 'begin_player_registration' then
    raise exception 'The Telegram conversation action does not match its capability.';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'awaiting_input'
      or new.action_kind <> 'player_registration'
      or new.expected_input_kind <> 'player_id' then
      raise exception 'A Telegram Player ID action must begin awaiting Player ID input.';
    end if;

    return new;
  end if;

  if new.conversation_id is distinct from old.conversation_id
    or new.customer_identity_id is distinct from old.customer_identity_id
    or new.customer_id is distinct from old.customer_id
    or new.platform_id is distinct from old.platform_id
    or new.action_kind is distinct from old.action_kind
    or new.expected_input_kind is distinct from old.expected_input_kind
    or new.capability_id is distinct from old.capability_id
    or new.started_from_inbound_event_id is distinct from old.started_from_inbound_event_id
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at then
    raise exception 'Telegram conversation action bindings are immutable.';
  end if;

  if old.status <> 'awaiting_input' then
    if new.status is distinct from old.status
      or new.completed_by_inbound_event_id is distinct from old.completed_by_inbound_event_id
      or new.expired_by_inbound_event_id is distinct from old.expired_by_inbound_event_id
      or new.completed_at is distinct from old.completed_at
      or new.expired_at is distinct from old.expired_at then
      raise exception 'A terminal Telegram conversation action cannot change.';
    end if;

    return new;
  end if;

  if new.status = 'awaiting_input' then
    return new;
  end if;

  if new.status not in ('completed', 'expired') then
    raise exception 'The Telegram conversation action transition is invalid.';
  end if;

  if new.status = 'completed' then
    new.completed_at := clock_timestamp();

    select inbound_event.customer_identity_id
      into resolved_completion_identity_id
      from app.inbound_events inbound_event
     where inbound_event.id = new.completed_by_inbound_event_id
       and inbound_event.channel = 'telegram';

    if resolved_completion_identity_id is distinct from new.customer_identity_id then
      raise exception 'The Telegram conversation action does not match its completing event.';
    end if;
  else
    new.expired_at := clock_timestamp();

    select inbound_event.customer_identity_id
      into resolved_completion_identity_id
      from app.inbound_events inbound_event
     where inbound_event.id = new.expired_by_inbound_event_id
       and inbound_event.channel = 'telegram';

    if resolved_completion_identity_id is distinct from new.customer_identity_id then
      raise exception 'The Telegram conversation action does not match its expiry event.';
    end if;
  end if;

  return new;
end;
$$;

create trigger bot_conversation_actions_require_binding
before insert or update on app.bot_conversation_actions
for each row
execute function app.enforce_bot_conversation_action_binding();

create trigger bot_conversation_actions_set_updated_at
before update on app.bot_conversation_actions
for each row
execute function app.set_updated_at();

create function app.reject_bot_conversation_action_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  raise exception 'Telegram conversation actions cannot be deleted.';
end;
$$;

create trigger bot_conversation_actions_no_delete
before delete on app.bot_conversation_actions
for each row
execute function app.reject_bot_conversation_action_delete();

create function app.require_bot_action_capability_receipt_correspondence()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_platform_code text;
  resolved_platform_status app.record_status;
  issued_consumer_kind app.telegram_inbound_consumer_kind;
  issued_outcome app.telegram_inbound_consumption_outcome;
  issued_identity_id uuid;
  issued_customer_id uuid;
  issued_conversation_id uuid;
  issued_version_before bigint;
  issued_version_after bigint;
  issued_inbound_received_at timestamptz;
  issued_inbound_update_id bigint;
  consumed_consumer_kind app.telegram_inbound_consumer_kind;
  consumed_outcome app.telegram_inbound_consumption_outcome;
  consumed_identity_id uuid;
  consumed_customer_id uuid;
  consumed_conversation_id uuid;
  consumed_version_before bigint;
  consumed_version_after bigint;
  consumed_inbound_received_at timestamptz;
  consumed_inbound_update_id bigint;
begin
  select platform.code,
         platform.status
    into resolved_platform_code,
         resolved_platform_status
    from app.platforms platform
   where platform.id = new.platform_id
   for share;

  if not found
    or resolved_platform_code <> 'kemerbet'
    or (tg_op = 'INSERT' and resolved_platform_status <> 'active') then
    raise exception 'A new Telegram Player ID capability requires the active KemerBet platform.';
  end if;

  select consumption.consumer_kind,
         consumption.outcome,
         consumption.customer_identity_id,
          consumption.customer_id,
          consumption.conversation_id,
          consumption.conversation_version_before,
          consumption.conversation_version_after,
          inbound_event.received_at,
          inbound_event.telegram_update_id
    into issued_consumer_kind,
         issued_outcome,
         issued_identity_id,
          issued_customer_id,
          issued_conversation_id,
          issued_version_before,
          issued_version_after,
          issued_inbound_received_at,
          issued_inbound_update_id
    from app.inbound_event_consumptions consumption
    join app.inbound_events inbound_event
      on inbound_event.id = consumption.origin_inbound_event_id
   where consumption.origin_inbound_event_id = new.issued_from_inbound_event_id;

  if not found
    or issued_consumer_kind <> 'issue_player_registration_capability'
    or issued_outcome <> 'completed'
    or issued_identity_id is distinct from new.customer_identity_id
    or issued_customer_id is distinct from new.customer_id
    or issued_conversation_id is distinct from new.conversation_id
    or issued_version_before is distinct from new.expected_conversation_version
    or issued_version_after is distinct from new.expected_conversation_version
    or issued_inbound_received_at is null
    or issued_inbound_update_id is null
    or issued_inbound_received_at > new.created_at then
    raise exception 'The Telegram action capability does not match its issuing consumption receipt.';
  end if;

  if new.status = 'issued'
    or (new.status = 'revoked' and new.revoked_by_inbound_event_id is null) then
    return null;
  end if;

  select consumption.consumer_kind,
         consumption.outcome,
         consumption.customer_identity_id,
          consumption.customer_id,
          consumption.conversation_id,
          consumption.conversation_version_before,
          consumption.conversation_version_after,
          inbound_event.received_at,
          inbound_event.telegram_update_id
    into consumed_consumer_kind,
         consumed_outcome,
         consumed_identity_id,
          consumed_customer_id,
          consumed_conversation_id,
          consumed_version_before,
          consumed_version_after,
          consumed_inbound_received_at,
          consumed_inbound_update_id
    from app.inbound_event_consumptions consumption
    join app.inbound_events inbound_event
      on inbound_event.id = consumption.origin_inbound_event_id
   where consumption.origin_inbound_event_id = case
      when new.status = 'consumed' then new.consumed_by_inbound_event_id
      when new.status = 'revoked' then new.revoked_by_inbound_event_id
      else new.expired_by_inbound_event_id
   end;

  if not found
    or consumed_consumer_kind <> 'start_player_registration'
    or consumed_identity_id is distinct from new.customer_identity_id
    or consumed_customer_id is distinct from new.customer_id
    or consumed_conversation_id is distinct from new.conversation_id
    or consumed_inbound_received_at is null
    or consumed_inbound_update_id is null
    or consumed_inbound_received_at < new.created_at
    or consumed_inbound_update_id <= issued_inbound_update_id
    or (
      new.status = 'consumed'
      and consumed_outcome = 'completed'
      and (
        consumed_version_before is distinct from new.expected_conversation_version
        or consumed_inbound_received_at > new.expires_at
        or consumed_version_after is distinct from new.expected_conversation_version + 1
      )
    )
    or (
      new.status = 'consumed'
      and consumed_outcome = 'active_action_exists'
      and (
        consumed_version_before is distinct from new.expected_conversation_version
        or consumed_inbound_received_at > new.expires_at
        or consumed_version_after is distinct from new.expected_conversation_version
      )
    )
    or (
      new.status = 'expired'
      and (
        consumed_version_before is distinct from new.expected_conversation_version
        or consumed_outcome <> 'expired'
        or consumed_version_after is distinct from new.expected_conversation_version
      )
    )
    or (
      new.status = 'revoked'
      and (
        consumed_outcome <> 'rejected'
        or consumed_version_before is distinct from consumed_version_after
        or consumed_version_before <= new.expected_conversation_version
      )
    )
    or (
      new.status = 'consumed'
      and consumed_outcome not in ('completed', 'active_action_exists')
    ) then
    raise exception 'The Telegram action capability does not match its consuming receipt.';
  end if;

  if new.status = 'consumed'
    and consumed_outcome = 'active_action_exists'
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
         and conversation.version = consumed_version_before
         and conversation.state ->> 'action_id' = action.id::text
    ) then
    raise exception 'The Telegram action capability cannot claim a missing active action.';
  end if;

  return null;
end;
$$;

create constraint trigger bot_action_capabilities_require_receipt_correspondence
after insert or update on app.bot_action_capabilities
deferrable initially deferred
for each row
execute function app.require_bot_action_capability_receipt_correspondence();

create function app.require_bot_conversation_action_receipt_correspondence()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_platform_code text;
  resolved_platform_status app.record_status;
  resolved_capability_status app.telegram_action_capability_status;
  resolved_capability_consumed_event_id uuid;
  resolved_capability_expected_version bigint;
  resolved_capability_created_at timestamptz;
  resolved_capability_expires_at timestamptz;
  resolved_capability_issued_update_id bigint;
  start_consumer_kind app.telegram_inbound_consumer_kind;
  start_outcome app.telegram_inbound_consumption_outcome;
  start_identity_id uuid;
  start_customer_id uuid;
  start_conversation_id uuid;
  start_version_before bigint;
  start_version_after bigint;
  start_inbound_received_at timestamptz;
  start_inbound_update_id bigint;
  completion_consumer_kind app.telegram_inbound_consumer_kind;
  completion_outcome app.telegram_inbound_consumption_outcome;
  completion_identity_id uuid;
  completion_customer_id uuid;
  completion_conversation_id uuid;
  completion_version_before bigint;
  completion_version_after bigint;
  completion_inbound_received_at timestamptz;
  completion_inbound_update_id bigint;
begin
  select platform.code,
         platform.status
    into resolved_platform_code,
         resolved_platform_status
    from app.platforms platform
   where platform.id = new.platform_id
   for share;

  if not found
    or resolved_platform_code <> 'kemerbet'
    or (tg_op = 'INSERT' and resolved_platform_status <> 'active') then
    raise exception 'A new Telegram Player ID action requires the active KemerBet platform.';
  end if;

  select capability.status,
         capability.consumed_by_inbound_event_id,
         capability.expected_conversation_version,
         capability.created_at,
         capability.expires_at,
         issued_inbound_event.telegram_update_id
  into resolved_capability_status,
         resolved_capability_consumed_event_id,
         resolved_capability_expected_version,
         resolved_capability_created_at,
         resolved_capability_expires_at,
         resolved_capability_issued_update_id
    from app.bot_action_capabilities capability
    join app.inbound_events issued_inbound_event
      on issued_inbound_event.id = capability.issued_from_inbound_event_id
   where capability.id = new.capability_id;

  if not found
    or resolved_capability_status <> 'consumed'
    or resolved_capability_consumed_event_id is distinct from new.started_from_inbound_event_id then
    raise exception 'The Telegram conversation action requires its consumed capability.';
  end if;

  select consumption.consumer_kind,
         consumption.outcome,
         consumption.customer_identity_id,
         consumption.customer_id,
         consumption.conversation_id,
          consumption.conversation_version_before,
          consumption.conversation_version_after,
          inbound_event.received_at,
          inbound_event.telegram_update_id
    into start_consumer_kind,
         start_outcome,
         start_identity_id,
         start_customer_id,
         start_conversation_id,
          start_version_before,
          start_version_after,
          start_inbound_received_at,
          start_inbound_update_id
    from app.inbound_event_consumptions consumption
    join app.inbound_events inbound_event
      on inbound_event.id = consumption.origin_inbound_event_id
   where consumption.origin_inbound_event_id = new.started_from_inbound_event_id;

  if not found
    or start_consumer_kind <> 'start_player_registration'
    or start_outcome <> 'completed'
    or start_identity_id is distinct from new.customer_identity_id
    or start_customer_id is distinct from new.customer_id
    or start_conversation_id is distinct from new.conversation_id
    or start_version_before is distinct from resolved_capability_expected_version
    or start_version_after is distinct from resolved_capability_expected_version + 1
    or start_inbound_received_at is null
    or start_inbound_update_id is null
    or resolved_capability_issued_update_id is null
    or start_inbound_update_id <= resolved_capability_issued_update_id
    or start_inbound_received_at < resolved_capability_created_at
    or start_inbound_received_at > resolved_capability_expires_at then
    raise exception 'The Telegram conversation action does not match its starting consumption receipt.';
  end if;

  if new.status = 'awaiting_input' then
    return null;
  end if;

  select consumption.consumer_kind,
         consumption.outcome,
         consumption.customer_identity_id,
         consumption.customer_id,
         consumption.conversation_id,
          consumption.conversation_version_before,
          consumption.conversation_version_after,
          inbound_event.received_at,
          inbound_event.telegram_update_id
    into completion_consumer_kind,
         completion_outcome,
         completion_identity_id,
         completion_customer_id,
         completion_conversation_id,
          completion_version_before,
          completion_version_after,
          completion_inbound_received_at,
          completion_inbound_update_id
    from app.inbound_event_consumptions consumption
    join app.inbound_events inbound_event
      on inbound_event.id = consumption.origin_inbound_event_id
   where consumption.origin_inbound_event_id = case
     when new.status = 'completed' then new.completed_by_inbound_event_id
     else new.expired_by_inbound_event_id
   end;

  if not found
    or completion_consumer_kind is distinct from (
      case
        when new.status = 'completed' then 'submit_player_registration_input'::app.telegram_inbound_consumer_kind
        else 'expire_player_registration_action'::app.telegram_inbound_consumer_kind
      end
    )
    or completion_identity_id is distinct from new.customer_identity_id
    or completion_customer_id is distinct from new.customer_id
    or completion_conversation_id is distinct from new.conversation_id
    or completion_version_before is distinct from start_version_after
    or completion_version_after is distinct from start_version_after + 1
    or completion_outcome <> 'completed'
    or completion_inbound_received_at is null
    or completion_inbound_update_id is null
    or completion_inbound_update_id <= start_inbound_update_id
    or completion_inbound_received_at < new.created_at
    or (new.status = 'completed' and completion_inbound_received_at > new.expires_at) then
    raise exception 'The Telegram conversation action does not match its completion receipt.';
  end if;

  if new.status = 'completed'
    and not exists (
    select 1
      from app.player_registration_request_events request_event
      join app.player_registration_requests registration_request
        on registration_request.id = request_event.player_registration_request_id
     where request_event.origin_inbound_event_id = new.completed_by_inbound_event_id
       and registration_request.customer_id = new.customer_id
       and registration_request.platform_id = new.platform_id
  ) then
    raise exception 'A completed Telegram Player ID action requires its matching registration request.';
  end if;

  return null;
end;
$$;

create constraint trigger bot_conversation_actions_require_receipt_correspondence
after insert or update on app.bot_conversation_actions
deferrable initially deferred
for each row
execute function app.require_bot_conversation_action_receipt_correspondence();

create function app.require_player_registration_request_event_receipt_correspondence()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_request_customer_id uuid;
  resolved_request_platform_id uuid;
  resolved_consumer_kind app.telegram_inbound_consumer_kind;
  resolved_outcome app.telegram_inbound_consumption_outcome;
  resolved_identity_id uuid;
  resolved_customer_id uuid;
  resolved_conversation_id uuid;
begin
  select registration_request.customer_id,
         registration_request.platform_id
    into resolved_request_customer_id,
         resolved_request_platform_id
    from app.player_registration_requests registration_request
   where registration_request.id = new.player_registration_request_id;

  select consumption.consumer_kind,
         consumption.outcome,
         consumption.customer_identity_id,
         consumption.customer_id,
         consumption.conversation_id
    into resolved_consumer_kind,
         resolved_outcome,
         resolved_identity_id,
         resolved_customer_id,
         resolved_conversation_id
    from app.inbound_event_consumptions consumption
   where consumption.origin_inbound_event_id = new.origin_inbound_event_id;

  if not found
    or resolved_consumer_kind <> 'submit_player_registration_input'
    or resolved_outcome <> 'completed'
    or resolved_customer_id is distinct from resolved_request_customer_id then
    raise exception 'The Player ID registration request event does not match its consumption receipt.';
  end if;

  if not exists (
    select 1
      from app.bot_conversation_actions action
     where action.completed_by_inbound_event_id = new.origin_inbound_event_id
       and action.customer_identity_id = resolved_identity_id
       and action.customer_id = resolved_request_customer_id
       and action.conversation_id = resolved_conversation_id
       and action.platform_id = resolved_request_platform_id
       and action.action_kind = 'player_registration'
       and action.status = 'completed'
  ) then
    raise exception 'The Player ID registration request event does not match a completed conversation action.';
  end if;

  return null;
end;
$$;

create constraint trigger player_registration_request_events_require_receipt_correspondence
after insert on app.player_registration_request_events
deferrable initially deferred
for each row
execute function app.require_player_registration_request_event_receipt_correspondence();

create function app.require_inbound_event_consumption_causal_result()
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
       where (
           (new.outcome in ('completed', 'active_action_exists')
             and capability.consumed_by_inbound_event_id = new.origin_inbound_event_id)
            or (new.outcome = 'expired'
              and capability.expired_by_inbound_event_id = new.origin_inbound_event_id)
            or (new.outcome = 'rejected'
              and capability.revoked_by_inbound_event_id = new.origin_inbound_event_id)
         )
         and capability.customer_identity_id = new.customer_identity_id
         and capability.customer_id = new.customer_id
         and capability.conversation_id = new.conversation_id
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
             and inbound_event.telegram_update_id <= started_inbound_event.telegram_update_id)
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

create constraint trigger inbound_event_consumptions_require_causal_result
after insert on app.inbound_event_consumptions
deferrable initially deferred
for each row
execute function app.require_inbound_event_consumption_causal_result();

create function app.enforce_bot_conversation_action_projection()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  idle_projection constant jsonb := '{"v": 1, "kind": "idle"}'::jsonb;
  action_id_text text;
  resolved_action_id uuid;
  resolved_platform_code text;
  resolved_action_expires_at timestamptz;
  expected_projection jsonb;
begin
  if tg_op = 'INSERT' then
    if new.state <> idle_projection
      or new.version <> 0 then
      raise exception 'A Telegram conversation must begin with the canonical idle projection.';
    end if;

    return new;
  end if;

  if new.state is not distinct from old.state then
    if new.version is distinct from old.version then
      raise exception 'A Telegram conversation version may change only with its state projection.';
    end if;

    return new;
  end if;

  if new.version <> old.version + 1 then
    raise exception 'A Telegram conversation state projection must advance its version exactly once.';
  end if;

  if new.state = idle_projection then
    if exists (
      select 1
        from app.bot_conversation_actions action
       where action.conversation_id = new.id
         and action.status = 'awaiting_input'
    ) then
      raise exception 'A Telegram conversation with an active action cannot project idle.';
    end if;

    return new;
  end if;

  if jsonb_typeof(new.state) <> 'object'
    or not (new.state ?& array['v', 'kind', 'action_id', 'platform_code', 'expires_at'])
    or new.state - 'v' - 'kind' - 'action_id' - 'platform_code' - 'expires_at' <> '{}'::jsonb
    or new.state ->> 'v' <> '1'
    or new.state ->> 'kind' <> 'awaiting_player_id' then
    raise exception 'The Telegram conversation action projection is invalid.';
  end if;

  action_id_text := new.state ->> 'action_id';
  if action_id_text is null
    or action_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'The Telegram conversation action projection is invalid.';
  end if;

  resolved_action_id := action_id_text::uuid;

  select platform.code,
         action.expires_at
    into resolved_platform_code,
         resolved_action_expires_at
    from app.bot_conversation_actions action
    join app.platforms platform
      on platform.id = action.platform_id
   where action.id = resolved_action_id
     and action.conversation_id = new.id
     and action.action_kind = 'player_registration'
     and action.expected_input_kind = 'player_id'
     and action.status = 'awaiting_input';

  if not found then
    raise exception 'The Telegram conversation action projection has no matching active action.';
  end if;

  expected_projection := jsonb_build_object(
    'v', 1,
    'kind', 'awaiting_player_id',
    'action_id', resolved_action_id::text,
    'platform_code', resolved_platform_code,
    'expires_at', to_char(
      resolved_action_expires_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  );

  if new.state <> expected_projection then
    raise exception 'The Telegram conversation action projection does not match its active action.';
  end if;

  return new;
end;
$$;

create trigger bot_conversations_require_action_projection
before insert or update of state, version on app.bot_conversations
for each row
execute function app.enforce_bot_conversation_action_projection();

create function app.require_bot_conversation_action_final_projection()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_conversation_id uuid;
  resolved_active_action_id uuid;
  resolved_state jsonb;
  idle_projection constant jsonb := '{"v": 1, "kind": "idle"}'::jsonb;
begin
  resolved_conversation_id := coalesce(new.conversation_id, old.conversation_id);

  select action.id
    into resolved_active_action_id
    from app.bot_conversation_actions action
   where action.conversation_id = resolved_conversation_id
     and action.status = 'awaiting_input';

  select conversation.state
    into resolved_state
    from app.bot_conversations conversation
   where conversation.id = resolved_conversation_id;

  if resolved_active_action_id is null then
    if resolved_state is distinct from idle_projection then
      raise exception 'A Telegram conversation without an active action must project idle.';
    end if;
  elsif resolved_state ->> 'action_id' is distinct from resolved_active_action_id::text then
    raise exception 'A Telegram conversation active action does not match its projection.';
  end if;

  return null;
end;
$$;

create constraint trigger bot_conversation_actions_require_final_projection
after insert or update of status or delete on app.bot_conversation_actions
deferrable initially deferred
for each row
execute function app.require_bot_conversation_action_final_projection();

alter table app.inbound_event_consumptions enable row level security;
alter table app.inbound_event_consumptions force row level security;
alter table app.bot_action_capabilities enable row level security;
alter table app.bot_action_capabilities force row level security;
alter table app.bot_conversation_actions enable row level security;
alter table app.bot_conversation_actions force row level security;

revoke all on type
  app.telegram_inbound_consumer_kind,
  app.telegram_inbound_consumption_outcome,
  app.telegram_action_capability_kind,
  app.telegram_action_capability_status,
  app.bot_conversation_action_kind,
  app.bot_conversation_action_status,
  app.bot_conversation_action_input_kind
from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all privileges on table
  app.inbound_event_consumptions,
  app.bot_action_capabilities,
  app.bot_conversation_actions
from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.enforce_inbound_event_consumption_binding()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.mark_inbound_event_consumed()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.require_inbound_event_consumption_final_version()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.lock_telegram_inbound_event_scope(uuid)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.reject_inbound_event_consumption_mutation()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.enforce_bot_action_capability_binding()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.reject_bot_action_capability_delete()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.enforce_bot_conversation_action_binding()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.reject_bot_conversation_action_delete()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.require_bot_action_capability_receipt_correspondence()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.require_bot_conversation_action_receipt_correspondence()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.require_player_registration_request_event_receipt_correspondence()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.require_inbound_event_consumption_causal_result()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.enforce_bot_conversation_action_projection()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.require_bot_conversation_action_final_projection()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.open_telegram_deposit_intent(uuid, uuid, uuid, bigint)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.capture_telegram_deposit_reference(uuid, uuid, text, text, text, smallint)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

comment on table app.inbound_event_consumptions is
  'Append-only global exactly-once receipts for interpreted private Telegram events. No raw Telegram content or customer-entered financial data is stored here.';

comment on table app.bot_action_capabilities is
  'Private one-time server-issued Telegram callback capabilities. Only a keyed fingerprint of a random callback secret is retained.';

comment on table app.bot_conversation_actions is
  'Private durable source of truth for an expiring customer conversation action. Conversation JSON is only a validated projection.';

comment on function app.request_telegram_player_registration(uuid, text, text) is
  'Retired ungranted Stage 6 helper. A later reviewed migration must replace its local inbound-event consumption with the global conversation-action receipt.';

commit;
