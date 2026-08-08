-- PayReplayy Stage 11: private Telegram action-boundary compatibility.
--
-- This migration stays dormant. It aligns the existing private Telegram inbox writer with the
-- conversation-action foundation's lock protocol, and retires the local Player-ID event consumer
-- in favour of an ungranted request create/reuse primitive. It grants no customer action, does
-- not enable Telegram polling/webhooks, and never contacts KemerBet or a payment provider.

begin;

-- The event-scope helper must be able to resolve stable bindings before it takes advisory locks.
-- Telegram account and private-chat bindings are identity facts, not editable profile metadata.
create function app.enforce_telegram_identity_binding_immutable()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.customer_identity_id is distinct from old.customer_identity_id
    or new.telegram_user_id is distinct from old.telegram_user_id
    or new.private_chat_id is distinct from old.private_chat_id then
    raise exception 'Telegram identity bindings are immutable.';
  end if;

  return new;
end;
$$;

create trigger telegram_identities_immutable_binding
before update of customer_identity_id, telegram_user_id, private_chat_id
on app.telegram_identities
for each row
execute function app.enforce_telegram_identity_binding_immutable();

-- Every Telegram mutation uses this stable pair of transaction-scoped advisory locks before it
-- takes row locks. Sorting the two hashed keys prevents a user/chat pair from deadlocking with
-- another transaction that presents the same values in a different order.
create function app.lock_telegram_private_scope(
  p_telegram_user_id bigint,
  p_private_chat_id bigint
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
declare
  user_lock_key bigint;
  chat_lock_key bigint;
begin
  if p_telegram_user_id is null
    or p_telegram_user_id <= 0
    or p_private_chat_id is null
    or p_private_chat_id <= 0 then
    raise exception 'The Telegram private scope is invalid.';
  end if;

  user_lock_key := pg_catalog.hashtextextended(
    'payreplayy:telegram-user:v1:' || p_telegram_user_id::text,
    0::bigint
  );
  chat_lock_key := pg_catalog.hashtextextended(
    'payreplayy:telegram-private-chat:v1:' || p_private_chat_id::text,
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

-- Stage 7 callers begin with an inbox event. Resolve its immutable Telegram scope without taking
-- row locks, then share the same advisory protocol used by the Stage 5 inbox recorder.
create or replace function app.lock_telegram_inbound_event_scope(p_inbound_event_id uuid)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_telegram_user_id bigint;
  resolved_private_chat_id bigint;
begin
  if p_inbound_event_id is null then
    raise exception 'The Telegram inbound event is not available for scoped locking.';
  end if;

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

  perform app.lock_telegram_private_scope(
    resolved_telegram_user_id,
    resolved_private_chat_id
  );
end;
$$;

-- Preserve the exact Stage 5 signature and its narrow API grant. The only behavioural change is
-- lock ordering: private scope -> update -> identity -> customer -> Telegram identity ->
-- conversation. The function remains a record-only inbox boundary.
create or replace function app.record_telegram_private_inbound_event(
  p_telegram_update_id bigint,
  p_telegram_user_id bigint,
  p_private_chat_id bigint,
  p_payload_hmac text,
  p_first_name text,
  p_username text default null,
  p_last_name text default null,
  p_preferred_locale text default null
)
returns table (
  inbound_event_id uuid,
  customer_id uuid,
  customer_identity_id uuid,
  bot_conversation_id uuid,
  preferred_locale text,
  customer_status text,
  identity_status text,
  received_at timestamptz,
  inbound_event_already_recorded boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  external_event_id text;
  normalized_first_name text;
  normalized_username text;
  normalized_last_name text;
  requested_locale text;
  initial_display_name text;
  event_lock_key bigint;
  existing_event_id uuid;
  existing_event_customer_identity_id uuid;
  existing_payload_hmac text;
  existing_received_at timestamptz;
  resolved_customer_id uuid;
  resolved_customer_identity_id uuid;
  resolved_customer_status app.record_status;
  resolved_identity_status app.record_status;
  resolved_identity_kind text;
  resolved_identity_external_subject text;
  resolved_telegram_user_id bigint;
  resolved_private_chat_id bigint;
  resolved_preferred_locale text;
  resolved_conversation_id uuid;
  inserted_event_id uuid;
  inserted_received_at timestamptz;
  identity_created boolean := false;
begin
  if p_telegram_update_id is null
    or p_telegram_update_id < 0
    or p_telegram_user_id is null
    or p_telegram_user_id <= 0
    or p_private_chat_id is null
    or p_private_chat_id <= 0 then
    raise exception 'A Telegram private inbound event requires valid update, user, and chat identifiers.';
  end if;

  if p_payload_hmac is null
    or p_payload_hmac <> lower(btrim(p_payload_hmac))
    or p_payload_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The Telegram payload integrity value is invalid.';
  end if;

  normalized_first_name := nullif(btrim(p_first_name), '');
  normalized_username := nullif(btrim(p_username), '');
  normalized_last_name := nullif(btrim(p_last_name), '');
  requested_locale := nullif(lower(btrim(p_preferred_locale)), '');

  if normalized_first_name is null
    or char_length(normalized_first_name) > 256
    or normalized_first_name ~ '[[:cntrl:]]' then
    raise exception 'The Telegram first name is invalid.';
  end if;

  if normalized_last_name is not null
    and (
      char_length(normalized_last_name) > 256
      or normalized_last_name ~ '[[:cntrl:]]'
    ) then
    raise exception 'The Telegram last name is invalid.';
  end if;

  if normalized_username is not null
    and normalized_username !~ '^[A-Za-z0-9_]{1,64}$' then
    raise exception 'The Telegram username is invalid.';
  end if;

  -- The English-only table trigger safely normalizes legacy `am` callers to `en` during rolling
  -- deployment. Other locale values remain invalid at this private API boundary.
  if requested_locale is not null
    and requested_locale not in ('en', 'am') then
    raise exception 'The Telegram locale is invalid.';
  end if;

  external_event_id := 'update:' || p_telegram_update_id::text;

  -- Acquire the shared user/chat scope before looking up the update. This serializes existing
  -- update retries with every future conversation action for the same private Telegram account.
  perform app.lock_telegram_private_scope(p_telegram_user_id, p_private_chat_id);

  event_lock_key := pg_catalog.hashtextextended(
    'payreplayy:telegram-update:v1:' || external_event_id,
    0::bigint
  );
  perform pg_catalog.pg_advisory_xact_lock(event_lock_key);

  select inbound_event.id,
         inbound_event.customer_identity_id,
         inbound_event.payload_digest,
         inbound_event.received_at
    into existing_event_id,
         existing_event_customer_identity_id,
         existing_payload_hmac,
         existing_received_at
    from app.inbound_events inbound_event
   where inbound_event.channel = 'telegram'
     and inbound_event.external_event_id = external_event_id
   for update;

  if found then
    if existing_event_customer_identity_id is null then
      raise exception 'The recorded Telegram inbound event requires remediation.';
    end if;

    if existing_payload_hmac is distinct from p_payload_hmac then
      raise exception 'The replayed Telegram update does not match its recorded integrity value.';
    end if;

    select customer_identity.customer_id,
           customer_identity.status,
           customer_identity.identity_kind,
           customer_identity.external_subject
      into resolved_customer_id,
           resolved_identity_status,
           resolved_identity_kind,
           resolved_identity_external_subject
      from app.customer_identities customer_identity
     where customer_identity.id = existing_event_customer_identity_id
     for update;

    if not found
      or resolved_identity_kind <> 'telegram'
      or resolved_identity_external_subject <> p_telegram_user_id::text then
      raise exception 'The replayed Telegram update is bound to a different customer identity.';
    end if;

    resolved_customer_identity_id := existing_event_customer_identity_id;

    select customer.status
      into resolved_customer_status
      from app.customers customer
     where customer.id = resolved_customer_id
     for update;

    if not found then
      raise exception 'The replayed Telegram update is bound to a different customer identity.';
    end if;

    select telegram_identity.telegram_user_id,
           telegram_identity.private_chat_id,
           telegram_identity.preferred_locale
      into resolved_telegram_user_id,
           resolved_private_chat_id,
           resolved_preferred_locale
      from app.telegram_identities telegram_identity
     where telegram_identity.customer_identity_id = resolved_customer_identity_id
       and telegram_identity.telegram_user_id = p_telegram_user_id
     for update;

    if not found
      or resolved_telegram_user_id <> p_telegram_user_id
      or resolved_private_chat_id <> p_private_chat_id then
      raise exception 'The replayed Telegram update is bound to a different customer identity.';
    end if;

    insert into app.bot_conversations (telegram_identity_id)
    values (resolved_customer_identity_id)
    on conflict (telegram_identity_id) do nothing
    returning id into resolved_conversation_id;

    if resolved_conversation_id is null then
      select conversation.id
        into resolved_conversation_id
        from app.bot_conversations conversation
       where conversation.telegram_identity_id = resolved_customer_identity_id
       for update;
    end if;

    if resolved_conversation_id is null then
      raise exception 'The Telegram customer conversation could not be initialized.';
    end if;

    return query
    select existing_event_id,
           resolved_customer_id,
           resolved_customer_identity_id,
           resolved_conversation_id,
           resolved_preferred_locale,
           resolved_customer_status::text,
           resolved_identity_status::text,
           existing_received_at,
           true;
    return;
  end if;

  -- Lock an existing identity through its immutable Telegram external subject before locking its
  -- customer and Telegram child row. The explicit sequence avoids planner-dependent joined locks.
  select customer_identity.id,
         customer_identity.customer_id,
         customer_identity.status,
         customer_identity.identity_kind,
         customer_identity.external_subject
    into resolved_customer_identity_id,
         resolved_customer_id,
         resolved_identity_status,
         resolved_identity_kind,
         resolved_identity_external_subject
    from app.customer_identities customer_identity
   where customer_identity.identity_kind = 'telegram'
     and customer_identity.external_subject = p_telegram_user_id::text
   for update;

  if found then
    if resolved_identity_kind <> 'telegram'
      or resolved_identity_external_subject <> p_telegram_user_id::text then
      raise exception 'The Telegram user is already bound to a different private chat or identity.';
    end if;

    select customer.status
      into resolved_customer_status
      from app.customers customer
     where customer.id = resolved_customer_id
     for update;

    if not found then
      raise exception 'A Telegram customer identity requires remediation.';
    end if;

    select telegram_identity.telegram_user_id,
           telegram_identity.private_chat_id,
           telegram_identity.preferred_locale
      into resolved_telegram_user_id,
           resolved_private_chat_id,
           resolved_preferred_locale
      from app.telegram_identities telegram_identity
     where telegram_identity.customer_identity_id = resolved_customer_identity_id
     for update;

    if not found then
      raise exception 'A Telegram customer identity requires remediation.';
    end if;

    if resolved_telegram_user_id <> p_telegram_user_id
      or resolved_private_chat_id <> p_private_chat_id then
      raise exception 'The Telegram user is already bound to a different private chat or identity.';
    end if;
  else
    perform 1
      from app.telegram_identities telegram_identity
     where telegram_identity.telegram_user_id = p_telegram_user_id
     for update;

    if found then
      raise exception 'The Telegram user is already bound to a different private chat or identity.';
    end if;

    perform 1
      from app.telegram_identities telegram_identity
     where telegram_identity.private_chat_id = p_private_chat_id
     for update;

    if found then
      raise exception 'The Telegram private chat is already bound to another user.';
    end if;

    initial_display_name := nullif(
      btrim(concat_ws(' ', normalized_first_name, normalized_last_name)),
      ''
    );

    insert into app.customers (display_name)
    values (initial_display_name)
    returning id, status into resolved_customer_id, resolved_customer_status;

    insert into app.customer_identities (
      customer_id,
      identity_kind,
      external_subject
    )
    values (
      resolved_customer_id,
      'telegram',
      p_telegram_user_id::text
    )
    returning id, status, identity_kind, external_subject
      into resolved_customer_identity_id,
           resolved_identity_status,
           resolved_identity_kind,
           resolved_identity_external_subject;

    insert into app.telegram_identities (
      customer_identity_id,
      telegram_user_id,
      private_chat_id,
      username,
      first_name,
      last_name,
      preferred_locale
    )
    values (
      resolved_customer_identity_id,
      p_telegram_user_id,
      p_private_chat_id,
      normalized_username,
      normalized_first_name,
      normalized_last_name,
      coalesce(requested_locale, 'en')
    )
    returning telegram_user_id, private_chat_id, preferred_locale
      into resolved_telegram_user_id,
           resolved_private_chat_id,
           resolved_preferred_locale;

    identity_created := true;
  end if;

  insert into app.bot_conversations (telegram_identity_id)
  values (resolved_customer_identity_id)
  on conflict (telegram_identity_id) do nothing
  returning id into resolved_conversation_id;

  if resolved_conversation_id is null then
    select conversation.id
      into resolved_conversation_id
      from app.bot_conversations conversation
     where conversation.telegram_identity_id = resolved_customer_identity_id
     for update;
  end if;

  if resolved_conversation_id is null then
    raise exception 'The Telegram customer conversation could not be initialized.';
  end if;

  insert into app.inbound_events (
    channel,
    external_event_id,
    customer_identity_id,
    payload_digest,
    received_at
  )
  values (
    'telegram',
    external_event_id,
    resolved_customer_identity_id,
    p_payload_hmac,
    clock_timestamp()
  )
  on conflict (channel, external_event_id) do nothing
  returning id, received_at into inserted_event_id, inserted_received_at;

  if inserted_event_id is null then
    raise exception 'The Telegram update was recorded concurrently; retry safely.';
  end if;

  if not identity_created
    and resolved_customer_status = 'active'
    and resolved_identity_status = 'active' then
    update app.telegram_identities telegram_identity
       set username = normalized_username,
           first_name = normalized_first_name,
           last_name = normalized_last_name,
           preferred_locale = coalesce(requested_locale, telegram_identity.preferred_locale)
     where telegram_identity.customer_identity_id = resolved_customer_identity_id
       and (
         telegram_identity.username is distinct from normalized_username
         or telegram_identity.first_name is distinct from normalized_first_name
         or telegram_identity.last_name is distinct from normalized_last_name
         or (
           requested_locale is not null
           and telegram_identity.preferred_locale is distinct from requested_locale
         )
       )
    returning telegram_identity.preferred_locale into resolved_preferred_locale;

    if not found then
      select telegram_identity.preferred_locale
        into resolved_preferred_locale
        from app.telegram_identities telegram_identity
       where telegram_identity.customer_identity_id = resolved_customer_identity_id;
    end if;
  end if;

  if identity_created then
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
      'customer.telegram_identity_created',
      'customer_identity',
      resolved_customer_identity_id,
      jsonb_build_object('channel', 'telegram')
    );
  end if;

  return query
  select inserted_event_id,
         resolved_customer_id,
         resolved_customer_identity_id,
         resolved_conversation_id,
         resolved_preferred_locale,
         resolved_customer_status::text,
         resolved_identity_status::text,
         inserted_received_at,
         false;
end;
$$;

-- This primitive is deliberately not an inbound-event consumer. A future conversation-aware
-- wrapper may call it only after it has verified a server-issued action capability and owns the
-- global consumption receipt. That wrapper must already have locked and validated the customer
-- and platform in the global order. This primitive creates/reuses a non-claiming request, nothing
-- more.
create function app.create_or_reuse_player_registration_request(
  p_customer_id uuid,
  p_platform_id uuid,
  p_player_id text
)
returns table (
  player_registration_request_id uuid,
  request_status text,
  existing_request_reused boolean,
  request_created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  normalized_player_id text;
  resolved_request_id uuid;
  resolved_request_status app.player_registration_request_status;
  resolved_request_created_at timestamptz;
  resolved_request_reused boolean;
  request_lock_key bigint;
begin
  normalized_player_id := btrim(p_player_id);

  if p_customer_id is null
    or p_platform_id is null
    or p_player_id is null
    or normalized_player_id is null
    or char_length(normalized_player_id) not between 1 and 64
    or normalized_player_id ~ '[[:cntrl:]]'
    or normalized_player_id ~ '[[:space:]]' then
    raise exception 'The Player ID registration request is invalid.';
  end if;

  request_lock_key := pg_catalog.hashtextextended(
    'payreplayy:player-registration:v1:'
      || p_customer_id::text
      || ':' || p_platform_id::text
      || ':' || normalized_player_id,
    0::bigint
  );
  perform pg_catalog.pg_advisory_xact_lock(request_lock_key);

  select registration_request.id,
         registration_request.status,
         registration_request.created_at
    into resolved_request_id,
         resolved_request_status,
         resolved_request_created_at
    from app.player_registration_requests registration_request
   where registration_request.customer_id = p_customer_id
     and registration_request.platform_id = p_platform_id
     and registration_request.player_id = normalized_player_id
   for update;

  if found then
    resolved_request_reused := true;
  else
    insert into app.player_registration_requests (
      customer_id,
      platform_id,
      player_id
    )
    values (
      p_customer_id,
      p_platform_id,
      normalized_player_id
    )
    returning id, status, created_at
      into resolved_request_id,
           resolved_request_status,
           resolved_request_created_at;
    resolved_request_reused := false;
  end if;

  return query
  select resolved_request_id,
         resolved_request_status::text,
         resolved_request_reused,
         resolved_request_created_at;
end;
$$;

-- The Stage 6 helper previously created a local event link, marked the inbox event processed, and
-- wrote an audit entry. Those effects must now be owned together by a future global conversation
-- consumer, so this legacy entry point is deliberately inert and remains ungranted.
create or replace function app.request_telegram_player_registration(
  p_origin_inbound_event_id uuid,
  p_platform_code text,
  p_player_id text
)
returns table (
  player_registration_request_id uuid,
  request_status text,
  origin_inbound_event_already_handled boolean,
  existing_request_reused boolean,
  request_created_at timestamptz
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'The legacy Player ID registration procedure is retired pending the global Telegram action boundary.';
end;
$$;

revoke all on function app.lock_telegram_private_scope(bigint, bigint)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.enforce_telegram_identity_binding_immutable()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.lock_telegram_inbound_event_scope(uuid)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.create_or_reuse_player_registration_request(uuid, uuid, text)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.request_telegram_player_registration(uuid, text, text)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.record_telegram_private_inbound_event(
  bigint, bigint, bigint, text, text, text, text, text
) from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

grant execute on function app.record_telegram_private_inbound_event(
  bigint, bigint, bigint, text, text, text, text, text
) to payreplayy_api;

-- Reassert that no prior, per-action Telegram entry point can bypass the global consumption
-- receipt once a future action wrapper is introduced.
revoke all on function app.open_telegram_deposit_intent(uuid, uuid, uuid, bigint)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.capture_telegram_deposit_reference(uuid, uuid, text, text, text, smallint)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

comment on function app.lock_telegram_private_scope(bigint, bigint) is
  'Private shared advisory lock protocol for one Telegram user/private-chat scope. No runtime role may execute it directly.';

comment on function app.create_or_reuse_player_registration_request(uuid, uuid, text) is
  'Private ungranted non-claiming Player ID request primitive. It does not consume an inbound event, write an audit record, or create a Telegram event link.';

comment on function app.request_telegram_player_registration(uuid, text, text) is
  'Retired ungranted Stage 6 entry point. A future conversation-aware wrapper must own global inbound consumption, request event linking, auditing, and CAS state changes.';

commit;
