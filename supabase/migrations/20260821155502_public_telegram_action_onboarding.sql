-- FetanAgent public Telegram action onboarding.
--
-- A normal private /start or another recognized private action may create the minimum customer,
-- Telegram identity, conversation, and inbound-event lineage needed by the isolated Player-action
-- runtime. This boundary stores no Telegram message text, profile name, username, Player ID,
-- payment reference, amount, provider observation, eligibility decision, claim, or execution job.
-- It does not grant a customer any financial authority. Exact five-account pilot membership and
-- every later payment/execution fence remain separate private database decisions.

begin;

create function app.record_public_telegram_action_inbound_event(
  p_telegram_update_id bigint,
  p_telegram_user_id bigint,
  p_private_chat_id bigint,
  p_payload_hmac text,
  p_preferred_locale text
)
returns table (
  inbound_event_id uuid,
  received_at timestamptz,
  inbound_event_already_recorded boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_external_event_id text;
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
  resolved_conversation_id uuid;
  inserted_event_id uuid;
  inserted_received_at timestamptz;
  identity_created boolean := false;
begin
  if p_telegram_update_id is null
    or p_telegram_update_id < 0
    or p_telegram_update_id > 9007199254740991
    or p_telegram_user_id is null
    or p_telegram_user_id <= 0
    or p_telegram_user_id > 9007199254740991
    or p_private_chat_id is null
    or p_private_chat_id <= 0
    or p_private_chat_id > 9007199254740991
    or p_private_chat_id <> p_telegram_user_id
    or p_payload_hmac is null
    or p_payload_hmac <> lower(btrim(p_payload_hmac))
    or p_payload_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$'
    or p_preferred_locale is distinct from 'en' then
    raise exception 'The public Telegram action is unavailable.' using errcode = 'P0001';
  end if;

  resolved_external_event_id := 'update:' || p_telegram_update_id::text;

  -- Fixed order shared with every Telegram mutation: user/chat scope, update key, identity,
  -- customer, Telegram child, conversation, then the canonical inbound-event row.
  perform app.lock_telegram_private_scope(p_telegram_user_id, p_private_chat_id);

  event_lock_key := pg_catalog.hashtextextended(
    'payreplayy:telegram-update:v1:' || resolved_external_event_id,
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
     and inbound_event.external_event_id = resolved_external_event_id
   for update;

  if found then
    if existing_event_customer_identity_id is null
      or existing_payload_hmac is distinct from p_payload_hmac then
      raise exception 'The public Telegram action is unavailable.' using errcode = 'P0001';
    end if;

    -- Exact receipt replay is permitted after a later administrative deactivation. Only the
    -- immutable scope is checked here; active status is required for every new update below.
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
      or resolved_identity_kind is distinct from 'telegram'
      or resolved_identity_external_subject is distinct from p_telegram_user_id::text then
      raise exception 'The public Telegram action is unavailable.' using errcode = 'P0001';
    end if;

    resolved_customer_identity_id := existing_event_customer_identity_id;

    perform 1
      from app.customers customer
     where customer.id = resolved_customer_id
     for update;

    if not found then
      raise exception 'The public Telegram action is unavailable.' using errcode = 'P0001';
    end if;

    select telegram_identity.telegram_user_id,
           telegram_identity.private_chat_id
      into resolved_telegram_user_id,
           resolved_private_chat_id
      from app.telegram_identities telegram_identity
     where telegram_identity.customer_identity_id = resolved_customer_identity_id
     for update;

    if not found
      or resolved_telegram_user_id is distinct from p_telegram_user_id
      or resolved_private_chat_id is distinct from p_private_chat_id then
      raise exception 'The public Telegram action is unavailable.' using errcode = 'P0001';
    end if;

    select conversation.id
      into resolved_conversation_id
      from app.bot_conversations conversation
     where conversation.telegram_identity_id = resolved_customer_identity_id
     for update;

    if not found then
      raise exception 'The public Telegram action is unavailable.' using errcode = 'P0001';
    end if;

    return query
    select existing_event_id,
           existing_received_at,
           true;
    return;
  end if;

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
    if resolved_identity_status is distinct from 'active'
      or resolved_identity_kind is distinct from 'telegram'
      or resolved_identity_external_subject is distinct from p_telegram_user_id::text then
      raise exception 'The public Telegram action is unavailable.' using errcode = 'P0001';
    end if;

    select customer.status
      into resolved_customer_status
      from app.customers customer
     where customer.id = resolved_customer_id
     for update;

    if not found or resolved_customer_status is distinct from 'active' then
      raise exception 'The public Telegram action is unavailable.' using errcode = 'P0001';
    end if;

    select telegram_identity.telegram_user_id,
           telegram_identity.private_chat_id
      into resolved_telegram_user_id,
           resolved_private_chat_id
      from app.telegram_identities telegram_identity
     where telegram_identity.customer_identity_id = resolved_customer_identity_id
     for update;

    if not found
      or resolved_telegram_user_id is distinct from p_telegram_user_id
      or resolved_private_chat_id is distinct from p_private_chat_id then
      raise exception 'The public Telegram action is unavailable.' using errcode = 'P0001';
    end if;

    select conversation.id
      into resolved_conversation_id
      from app.bot_conversations conversation
     where conversation.telegram_identity_id = resolved_customer_identity_id
     for update;

    if not found then
      raise exception 'The public Telegram action is unavailable.' using errcode = 'P0001';
    end if;
  else
    -- These defensive probes make an inconsistent child-row binding fail closed before any new
    -- identity is created. The shared chat lock serializes cross-user attempts for one private
    -- chat, while unique constraints remain the final integrity boundary.
    perform 1
      from app.telegram_identities telegram_identity
     where telegram_identity.telegram_user_id = p_telegram_user_id
     for update;

    if found then
      raise exception 'The public Telegram action is unavailable.' using errcode = 'P0001';
    end if;

    perform 1
      from app.telegram_identities telegram_identity
     where telegram_identity.private_chat_id = p_private_chat_id
     for update;

    if found then
      raise exception 'The public Telegram action is unavailable.' using errcode = 'P0001';
    end if;

    insert into app.customers (display_name)
    values (null)
    returning id, status
      into resolved_customer_id, resolved_customer_status;

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
      preferred_locale
    )
    values (
      resolved_customer_identity_id,
      p_telegram_user_id,
      p_private_chat_id,
      'en'
    )
    returning telegram_user_id, private_chat_id
      into resolved_telegram_user_id, resolved_private_chat_id;

    insert into app.bot_conversations (telegram_identity_id)
    values (resolved_customer_identity_id)
    returning id into resolved_conversation_id;

    identity_created := true;
  end if;

  insert into app.inbound_events as inbound_event (
    channel,
    external_event_id,
    customer_identity_id,
    payload_digest,
    received_at
  )
  values (
    'telegram',
    resolved_external_event_id,
    resolved_customer_identity_id,
    p_payload_hmac,
    clock_timestamp()
  )
  on conflict (channel, external_event_id) do nothing
  returning inbound_event.id, inbound_event.received_at
    into inserted_event_id, inserted_received_at;

  if inserted_event_id is null then
    raise exception 'The public Telegram action is unavailable.' using errcode = 'P0001';
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
      'customer.telegram_public_action_identity_created',
      'customer_identity',
      resolved_customer_identity_id,
      jsonb_build_object(
        'channel', 'telegram',
        'onboarding', 'public_action'
      )
    );
  end if;

  return query
  select inserted_event_id,
         inserted_received_at,
         false;
end;
$$;

alter function app.record_public_telegram_action_inbound_event(
  bigint, bigint, bigint, text, text
) owner to postgres;

revoke all on function app.record_public_telegram_action_inbound_event(
  bigint, bigint, bigint, text, text
) from public, anon, authenticated, service_role,
       fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
       fetanagent_beta_admission, fetanagent_beta_admission_runtime,
       fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_customer_web, fetanagent_customer_web_runtime,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_cbe_birr_shadow_worker,
       fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
       fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

-- The action runtime moves to public identity/onboarding. The admitted recorder remains defined
-- for historical receipts and invite compatibility, but it is no longer in this runtime's exact
-- callable surface.
revoke all on function app.record_admitted_telegram_private_inbound_event(
  bigint, bigint, bigint, text, text
) from fetanagent_player_actions, fetanagent_player_actions_runtime;

grant usage on schema app to fetanagent_player_actions;
grant execute on function app.record_public_telegram_action_inbound_event(
  bigint, bigint, bigint, text, text
) to fetanagent_player_actions;

comment on function app.record_public_telegram_action_inbound_event(
  bigint, bigint, bigint, text, text
) is
  'Public private-chat action inbox boundary. It creates only minimal customer/Telegram/conversation identity and HMAC-bound inbound lineage; it stores no message, Player, provider, proof, amount, claim, settlement, or execution material and grants no financial authority.';

comment on role fetanagent_player_actions is
  'FetanAgent public Telegram action group. NOLOGIN; limited to minimal public action onboarding plus reviewed Player-ID and dry-run deposit procedures. Public identity creation grants no eligibility or financial authority.';

commit;
