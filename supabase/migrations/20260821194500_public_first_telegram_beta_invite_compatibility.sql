-- FetanAgent public-first Telegram beta-invite compatibility.
--
-- Public Player-action onboarding may already have created the minimum Telegram identity graph
-- before an Owner presents a beta invite. Redeeming that invite may adopt only that exact active,
-- public-provenanced, otherwise-minimal graph. It never merges, retargets, creates Player/payment
-- state, or grants private-live-pilot membership. The original new-identity path remains intact.

begin;

create or replace function app.redeem_telegram_beta_invite(
  p_telegram_update_id bigint,
  p_telegram_user_id bigint,
  p_private_chat_id bigint,
  p_invite_token_digest text,
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
  requested_locale text;
  event_lock_key bigint;
  invite_lock_key bigint;
  existing_event_id uuid;
  existing_event_customer_identity_id uuid;
  existing_payload_hmac text;
  existing_received_at timestamptz;
  resolved_invite_status text;
  resolved_invite_customer_id uuid;
  resolved_invite_customer_identity_id uuid;
  resolved_invite_event_id uuid;
  resolved_invite_user_id bigint;
  resolved_invite_chat_id bigint;
  resolved_invite_expires_at timestamptz;
  resolved_customer_id uuid;
  resolved_customer_identity_id uuid;
  resolved_identity_status app.record_status;
  resolved_identity_kind text;
  resolved_identity_external_subject text;
  resolved_customer_status app.record_status;
  resolved_customer_display_name text;
  resolved_telegram_user_id bigint;
  resolved_private_chat_id bigint;
  resolved_telegram_username text;
  resolved_telegram_first_name text;
  resolved_telegram_last_name text;
  resolved_telegram_locale text;
  resolved_conversation_id uuid;
  resolved_conversation_state jsonb;
  resolved_conversation_version bigint;
  resolved_customer_identity_count integer;
  resolved_public_creation_audit_count integer;
  inserted_event_id uuid;
  inserted_received_at timestamptz;
begin
  if p_telegram_update_id is null
    or p_telegram_update_id < 0
    or p_telegram_user_id is null
    or p_telegram_user_id <= 0
    or p_private_chat_id is null
    or p_private_chat_id <= 0
    or p_private_chat_id <> p_telegram_user_id then
    raise exception 'The Telegram beta admission is not accepted.';
  end if;

  if p_invite_token_digest is null
    or p_invite_token_digest <> lower(btrim(p_invite_token_digest))
    or p_invite_token_digest !~ '^sha256-v1:[0-9a-f]{64}$'
    or p_payload_hmac is null
    or p_payload_hmac <> lower(btrim(p_payload_hmac))
    or p_payload_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The Telegram beta admission is not accepted.';
  end if;

  requested_locale := nullif(lower(btrim(p_preferred_locale)), '');
  if requested_locale is distinct from 'en' then
    raise exception 'The Telegram beta admission is not accepted.';
  end if;

  resolved_external_event_id := 'update:' || p_telegram_update_id::text;

  -- Preserve the shared order used by all Telegram mutations: private scope, update key, invite
  -- key, canonical event, invite row, identity, customer, Telegram child, then conversation.
  perform app.lock_telegram_private_scope(p_telegram_user_id, p_private_chat_id);

  event_lock_key := pg_catalog.hashtextextended(
    'payreplayy:telegram-update:v1:' || resolved_external_event_id,
    0::bigint
  );
  perform pg_catalog.pg_advisory_xact_lock(event_lock_key);

  invite_lock_key := pg_catalog.hashtextextended(
    'payreplayy:telegram-beta-invite:v1:' || p_invite_token_digest,
    0::bigint
  );
  perform pg_catalog.pg_advisory_xact_lock(invite_lock_key);

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
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    select invite.status,
           invite.redeemed_customer_id,
           invite.redeemed_customer_identity_id,
           invite.redeemed_inbound_event_id,
           invite.redeemed_telegram_user_id,
           invite.redeemed_private_chat_id,
           invite.expires_at
      into resolved_invite_status,
           resolved_invite_customer_id,
           resolved_invite_customer_identity_id,
           resolved_invite_event_id,
           resolved_invite_user_id,
           resolved_invite_chat_id,
           resolved_invite_expires_at
      from app.telegram_beta_invites invite
     where invite.token_digest = p_invite_token_digest
       and invite.redeemed_inbound_event_id = existing_event_id
     for update;

    if not found
      or resolved_invite_status is distinct from 'redeemed'
      or resolved_invite_event_id is distinct from existing_event_id
      or resolved_invite_customer_identity_id is distinct from existing_event_customer_identity_id
      or resolved_invite_user_id is distinct from p_telegram_user_id
      or resolved_invite_chat_id is distinct from p_private_chat_id then
      raise exception 'The Telegram beta admission is not accepted.';
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
     where customer_identity.id = resolved_invite_customer_identity_id
     for update;

    if not found
      or resolved_customer_id is distinct from resolved_invite_customer_id
      or resolved_identity_kind is distinct from 'telegram'
      or resolved_identity_external_subject is distinct from p_telegram_user_id::text then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    select customer.status
      into resolved_customer_status
      from app.customers customer
     where customer.id = resolved_customer_id
     for update;

    if not found then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    select telegram_identity.telegram_user_id,
           telegram_identity.private_chat_id
      into resolved_telegram_user_id,
           resolved_private_chat_id
      from app.telegram_identities telegram_identity
     where telegram_identity.customer_identity_id = resolved_invite_customer_identity_id
     for update;

    if not found
      or resolved_telegram_user_id is distinct from p_telegram_user_id
      or resolved_private_chat_id is distinct from p_private_chat_id then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    select conversation.id
      into resolved_conversation_id
      from app.bot_conversations conversation
     where conversation.telegram_identity_id = resolved_invite_customer_identity_id
     for update;

    if not found then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    return query
    select existing_event_id,
           existing_received_at,
           true;
    return;
  end if;

  select invite.status,
         invite.redeemed_customer_id,
         invite.redeemed_customer_identity_id,
         invite.redeemed_inbound_event_id,
         invite.redeemed_telegram_user_id,
         invite.redeemed_private_chat_id,
         invite.expires_at
    into resolved_invite_status,
         resolved_invite_customer_id,
         resolved_invite_customer_identity_id,
         resolved_invite_event_id,
         resolved_invite_user_id,
         resolved_invite_chat_id,
         resolved_invite_expires_at
    from app.telegram_beta_invites invite
   where invite.token_digest = p_invite_token_digest
   for update;

  if not found
    or resolved_invite_status is distinct from 'active'
    or resolved_invite_expires_at <= clock_timestamp() then
    raise exception 'The Telegram beta admission is not accepted.';
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
    -- Only the exact graph produced by public action onboarding can be adopted. Existing admitted,
    -- merged, profiled, progressed, Player-linked, deposit-linked, or pilot-linked identities fail
    -- closed instead of being silently upgraded or retargeted.
    if resolved_identity_status is distinct from 'active'
      or resolved_identity_kind is distinct from 'telegram'
      or resolved_identity_external_subject is distinct from p_telegram_user_id::text then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    select customer.status,
           customer.display_name
      into resolved_customer_status,
           resolved_customer_display_name
      from app.customers customer
     where customer.id = resolved_customer_id
     for update;

    if not found
      or resolved_customer_status is distinct from 'active'
      or resolved_customer_display_name is not null then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    select telegram_identity.telegram_user_id,
           telegram_identity.private_chat_id,
           telegram_identity.username,
           telegram_identity.first_name,
           telegram_identity.last_name,
           telegram_identity.preferred_locale
      into resolved_telegram_user_id,
           resolved_private_chat_id,
           resolved_telegram_username,
           resolved_telegram_first_name,
           resolved_telegram_last_name,
           resolved_telegram_locale
      from app.telegram_identities telegram_identity
     where telegram_identity.customer_identity_id = resolved_customer_identity_id
     for update;

    if not found
      or resolved_telegram_user_id is distinct from p_telegram_user_id
      or resolved_private_chat_id is distinct from p_private_chat_id
      or resolved_telegram_username is not null
      or resolved_telegram_first_name is not null
      or resolved_telegram_last_name is not null
      or resolved_telegram_locale is distinct from 'en' then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    select conversation.id,
           conversation.state,
           conversation.version
      into resolved_conversation_id,
           resolved_conversation_state,
           resolved_conversation_version
      from app.bot_conversations conversation
     where conversation.telegram_identity_id = resolved_customer_identity_id
     for update;

    if not found
      or resolved_conversation_state is distinct from '{}'::jsonb
      or resolved_conversation_version is distinct from 0 then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    select count(*)::integer
      into resolved_customer_identity_count
      from app.customer_identities customer_identity
     where customer_identity.customer_id = resolved_customer_id;

    select count(*)::integer
      into resolved_public_creation_audit_count
      from app.audit_events audit_event
     where audit_event.actor_kind = 'customer'
       and audit_event.actor_customer_id = resolved_customer_id
       and audit_event.action = 'customer.telegram_public_action_identity_created'
       and audit_event.resource_type = 'customer_identity'
       and audit_event.resource_id = resolved_customer_identity_id
       and audit_event.metadata = pg_catalog.jsonb_build_object(
         'channel', 'telegram',
         'onboarding', 'public_action'
       );

    if resolved_customer_identity_count <> 1
      or resolved_public_creation_audit_count <> 1
      or exists (
        select 1
          from app.telegram_beta_invites prior_invite
         where prior_invite.status = 'redeemed'
           and (
             prior_invite.redeemed_customer_id = resolved_customer_id
             or prior_invite.redeemed_customer_identity_id = resolved_customer_identity_id
             or prior_invite.redeemed_telegram_user_id = p_telegram_user_id
             or prior_invite.redeemed_private_chat_id = p_private_chat_id
           )
      )
      or exists (
        select 1
          from app.player_registration_requests registration_request
         where registration_request.customer_id = resolved_customer_id
      )
      or exists (
        select 1
          from app.customer_platform_players player_account
         where player_account.customer_id = resolved_customer_id
      )
      or exists (
        select 1
          from app.deposit_intents deposit_intent
         where deposit_intent.customer_id = resolved_customer_id
      )
      or exists (
        select 1
          from app.private_live_deposit_pilot_customers pilot_customer
         where pilot_customer.customer_id = resolved_customer_id
      ) then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;
  else
    -- Preserve the original invite-first path. A malformed child row can never be adopted or
    -- overwritten merely because its canonical parent identity is absent.
    perform 1
      from app.telegram_identities telegram_identity
     where telegram_identity.telegram_user_id = p_telegram_user_id
     for update;

    if found then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    perform 1
      from app.telegram_identities telegram_identity
     where telegram_identity.private_chat_id = p_private_chat_id
     for update;

    if found then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    insert into app.customers default values
    returning id into resolved_customer_id;

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
    returning id into resolved_customer_identity_id;

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
    );

    insert into app.bot_conversations (telegram_identity_id)
    values (resolved_customer_identity_id)
    returning id into resolved_conversation_id;
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
    raise exception 'The Telegram beta admission is not accepted.';
  end if;

  update app.telegram_beta_invites invite
     set status = 'redeemed',
         redeemed_telegram_user_id = p_telegram_user_id,
         redeemed_private_chat_id = p_private_chat_id,
         redeemed_customer_id = resolved_customer_id,
         redeemed_customer_identity_id = resolved_customer_identity_id,
         redeemed_inbound_event_id = inserted_event_id,
         redeemed_at = clock_timestamp()
   where invite.token_digest = p_invite_token_digest
     and invite.status = 'active';

  if not found then
    raise exception 'The Telegram beta admission is not accepted.';
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
    'customer.telegram_beta_invite_redeemed',
    'customer_identity',
    resolved_customer_identity_id,
    pg_catalog.jsonb_build_object('channel', 'telegram', 'admission', 'beta_invite')
  );

  return query
  select inserted_event_id,
         inserted_received_at,
         false;
end;
$$;

alter function app.redeem_telegram_beta_invite(
  bigint, bigint, bigint, text, text, text
) owner to postgres;

revoke all on function app.redeem_telegram_beta_invite(
  bigint, bigint, bigint, text, text, text
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

grant usage on schema app to fetanagent_beta_admission;
grant execute on function app.redeem_telegram_beta_invite(
  bigint, bigint, bigint, text, text, text
) to fetanagent_beta_admission;

comment on function app.redeem_telegram_beta_invite(
  bigint, bigint, bigint, text, text, text
) is
  'Redeems one private beta invite into either a new Telegram identity or the exact active minimal graph created by public action onboarding. It never merges or retargets identities and grants no Player, deposit, pilot, settlement, or execution authority.';

commit;
