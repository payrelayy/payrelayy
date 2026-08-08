-- PayReplayy Stage 5: private Telegram inbound identity and idempotency boundary.
--
-- The API passes only an already-authenticated, private-chat Telegram update's allowlisted
-- metadata and a keyed payload HMAC. This procedure never receives or stores raw Telegram JSON,
-- message text, transaction references, files, provider data, or credentials.

begin;

create function app.record_telegram_private_inbound_event(
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
  user_lock_key bigint;
  chat_lock_key bigint;
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

  -- This is a versioned keyed HMAC of the allowlisted, canonical API input. It is never raw
  -- Telegram JSON and never an unhashed body digest.
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

  -- NULL means the Telegram account currently has no username. Username is never an identity key.
  if normalized_username is not null
    and normalized_username !~ '^[A-Za-z0-9_]{1,64}$' then
    raise exception 'The Telegram username is invalid.';
  end if;

  -- The API maps Telegram language-code variants such as am-ET and en-US before this call.
  if requested_locale is not null
    and requested_locale not in ('en', 'am') then
    raise exception 'The Telegram locale is invalid.';
  end if;

  external_event_id := 'update:' || p_telegram_update_id::text;

  -- Serialize a Telegram update before any identity/customer records are created. This makes a
  -- delivery retry harmless even when it is the first interaction from a Telegram user.
  event_lock_key := pg_catalog.hashtextextended(
    'payreplayy:telegram-update:v1:' || external_event_id,
    0::bigint
  );
  perform pg_catalog.pg_advisory_xact_lock(event_lock_key);

  select
    inbound_event.id,
    inbound_event.customer_identity_id,
    inbound_event.payload_digest,
    inbound_event.received_at
  into
    existing_event_id,
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

    select
      customer_identity.customer_id,
      customer_identity.id,
      customer.status,
      customer_identity.status,
      customer_identity.identity_kind,
      customer_identity.external_subject,
      telegram_identity.private_chat_id,
      telegram_identity.preferred_locale
    into
      resolved_customer_id,
      resolved_customer_identity_id,
      resolved_customer_status,
      resolved_identity_status,
      resolved_identity_kind,
      resolved_identity_external_subject,
      resolved_private_chat_id,
      resolved_preferred_locale
    from app.customer_identities customer_identity
    join app.customers customer
      on customer.id = customer_identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = customer_identity.id
    where customer_identity.id = existing_event_customer_identity_id
      and telegram_identity.telegram_user_id = p_telegram_user_id
    for update of customer_identity, customer, telegram_identity;

    if not found
      or resolved_identity_kind <> 'telegram'
      or resolved_identity_external_subject <> p_telegram_user_id::text
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
    select
      existing_event_id,
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

  -- Namespace-prefixed transaction locks serialize first-use customer creation. Any hash collision
  -- can only add waiting; it cannot bind one Telegram identity to another.
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

  select
    customer_identity.id,
    customer_identity.customer_id,
    customer.status,
    customer_identity.status,
    customer_identity.identity_kind,
    customer_identity.external_subject,
    telegram_identity.private_chat_id,
    telegram_identity.preferred_locale
  into
    resolved_customer_identity_id,
    resolved_customer_id,
    resolved_customer_status,
    resolved_identity_status,
    resolved_identity_kind,
    resolved_identity_external_subject,
    resolved_private_chat_id,
    resolved_preferred_locale
  from app.telegram_identities telegram_identity
  join app.customer_identities customer_identity
    on customer_identity.id = telegram_identity.customer_identity_id
  join app.customers customer
    on customer.id = customer_identity.customer_id
  where telegram_identity.telegram_user_id = p_telegram_user_id
  for update of telegram_identity, customer_identity, customer;

  if found then
    if resolved_identity_kind <> 'telegram'
      or resolved_identity_external_subject <> p_telegram_user_id::text
      or resolved_private_chat_id <> p_private_chat_id then
      raise exception 'The Telegram user is already bound to a different private chat or identity.';
    end if;
  else
    -- Never graft a private chat onto a malformed legacy identity or a chat already bound to a
    -- different Telegram user.
    perform 1
    from app.customer_identities customer_identity
    where customer_identity.identity_kind = 'telegram'
      and customer_identity.external_subject = p_telegram_user_id::text
    for update;

    if found then
      raise exception 'A Telegram customer identity requires remediation.';
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
    returning id, status into resolved_customer_identity_id, resolved_identity_status;

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
    returning preferred_locale into resolved_preferred_locale;

    identity_created := true;
  end if;

  -- Create but never reset a conversation. A later compare-and-set procedure will own its state.
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

  -- A writer outside this procedure should cause the whole transaction to roll back and retry,
  -- never leave an orphan customer/identity record.
  if inserted_event_id is null then
    raise exception 'The Telegram update was recorded concurrently; retry safely.';
  end if;

  -- Do not overwrite the generic customer display name after creation. Only Telegram-owned,
  -- non-financial profile fields may refresh from a new Telegram update.
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
  select
    inserted_event_id,
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

revoke all on function app.record_telegram_private_inbound_event(
  bigint, bigint, bigint, text, text, text, text, text
) from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

grant execute on function app.record_telegram_private_inbound_event(
  bigint, bigint, bigint, text, text, text, text, text
) to payreplayy_api;

-- The API keeps schema usage, configuration reads, and procedure execution only. It no longer
-- has direct identity, inbox, conversation, or audit-table access.
revoke all privileges on table
  app.customers,
  app.customer_identities,
  app.telegram_identities,
  app.inbound_events,
  app.bot_conversations,
  app.audit_events
from payreplayy_api;

revoke all privileges on sequence app.audit_events_id_seq
from payreplayy_api;

drop policy if exists api_select_customers on app.customers;
drop policy if exists api_insert_customers on app.customers;
drop policy if exists api_update_customers on app.customers;

drop policy if exists api_select_customer_identities on app.customer_identities;
drop policy if exists api_insert_customer_identities on app.customer_identities;

drop policy if exists api_select_telegram_identities on app.telegram_identities;
drop policy if exists api_insert_telegram_identities on app.telegram_identities;
drop policy if exists api_update_telegram_identities on app.telegram_identities;

drop policy if exists api_select_inbound_events on app.inbound_events;
drop policy if exists api_insert_inbound_events on app.inbound_events;
drop policy if exists api_update_inbound_events on app.inbound_events;

drop policy if exists api_select_bot_conversations on app.bot_conversations;
drop policy if exists api_insert_bot_conversations on app.bot_conversations;
drop policy if exists api_update_bot_conversations on app.bot_conversations;

drop policy if exists api_insert_audit_events on app.audit_events;

comment on function app.record_telegram_private_inbound_event(
  bigint, bigint, bigint, text, text, text, text, text
) is
  'API-only private Telegram inbox boundary. It deduplicates an authenticated private update, creates or finds its customer identity and conversation, updates only safe Telegram profile fields, and records no raw Telegram payload.';

commit;
