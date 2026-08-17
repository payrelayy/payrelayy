-- Private, default-off production customer deposit intake and status boundary.
--
-- This migration exposes only six SECURITY DEFINER procedures to the two existing customer
-- transport groups. It does not provision a verifier, activate a switch, grant a table, enqueue
-- shadow work, or alter any executor capability.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

insert into app.feature_switches (feature_key, mode, settings)
values ('cbe_birr_authoritative_verification', 'disabled', '{}'::jsonb);

-- PostgreSQL cannot safely add and consume a new enum value in the same atomic migration. Live
-- Telegram receipts therefore have their own narrow ledger instead of weakening or splitting the
-- existing inbound_event_consumptions contract.
create table app.telegram_live_deposit_request_receipts (
  origin_inbound_event_id uuid primary key
    references app.inbound_events (id) on delete restrict,
  customer_identity_id uuid not null
    references app.customer_identities (id) on delete restrict,
  customer_id uuid not null
    references app.customers (id) on delete restrict,
  conversation_id uuid not null
    references app.bot_conversations (id) on delete restrict,
  request_kind text not null
    check (request_kind in ('open_intent', 'capture_reference')),
  semantic_input_hmac text not null check (
    semantic_input_hmac = pg_catalog.lower(pg_catalog.btrim(semantic_input_hmac))
    and semantic_input_hmac ~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$'
  ),
  deposit_intent_id uuid not null
    references app.deposit_intents (id) on delete restrict,
  deposit_submission_id uuid,
  player_id text,
  expected_amount_minor bigint,
  reference_fingerprint text,
  reference_masked text,
  reference_key_version smallint,
  conversation_version bigint not null check (conversation_version >= 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint telegram_live_deposit_receipts_submission_intent_fkey
    foreign key (deposit_submission_id, deposit_intent_id)
    references app.deposit_submissions (id, deposit_intent_id) on delete restrict,
  constraint telegram_live_deposit_receipts_request_shape check (
    (
      request_kind = 'open_intent'
      and deposit_submission_id is null
      and player_id is not null
      and player_id = pg_catalog.btrim(player_id)
      and pg_catalog.char_length(player_id) between 1 and 64
      and player_id !~ '[[:space:][:cntrl:]]'
      and expected_amount_minor is not null
      and expected_amount_minor > 0
      and reference_fingerprint is null
      and reference_masked is null
      and reference_key_version is null
    )
    or (
      request_kind = 'capture_reference'
      and deposit_submission_id is not null
      and player_id is null
      and expected_amount_minor is null
      and reference_fingerprint is not null
      and reference_fingerprint ~ '^[0-9a-f]{64}$'
      and reference_masked is not null
      and reference_masked = pg_catalog.btrim(reference_masked)
      and reference_masked ~ '^\*{3}[A-Z0-9._-]{4}$'
      and reference_key_version = 1
    )
  )
);

create unique index telegram_live_deposit_receipts_open_intent_idx
  on app.telegram_live_deposit_request_receipts (deposit_intent_id)
  where request_kind = 'open_intent';

create unique index telegram_live_deposit_receipts_capture_submission_idx
  on app.telegram_live_deposit_request_receipts (deposit_submission_id)
  where request_kind = 'capture_reference';

create table app.customer_web_deposit_request_receipts (
  customer_auth_identity_id uuid not null
    references app.customer_auth_identities (customer_identity_id) on delete restrict,
  request_key uuid not null,
  request_kind text not null
    check (request_kind in ('open_intent', 'capture_reference')),
  deposit_intent_id uuid not null
    references app.deposit_intents (id) on delete restrict,
  deposit_submission_id uuid,
  player_id text,
  expected_amount_minor bigint,
  reference_fingerprint text,
  reference_masked text,
  reference_key_version smallint,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint customer_web_deposit_request_receipts_pkey
    primary key (customer_auth_identity_id, request_key),
  constraint customer_web_deposit_receipts_uuid_v4_check check (
    request_key::text ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint customer_web_deposit_receipts_submission_intent_fkey
    foreign key (deposit_submission_id, deposit_intent_id)
    references app.deposit_submissions (id, deposit_intent_id) on delete restrict,
  constraint customer_web_deposit_receipts_request_shape check (
    (
      request_kind = 'open_intent'
      and deposit_submission_id is null
      and player_id is not null
      and player_id = pg_catalog.btrim(player_id)
      and pg_catalog.char_length(player_id) between 1 and 64
      and player_id !~ '[[:space:][:cntrl:]]'
      and expected_amount_minor is not null
      and expected_amount_minor > 0
      and reference_fingerprint is null
      and reference_masked is null
      and reference_key_version is null
    )
    or (
      request_kind = 'capture_reference'
      and deposit_submission_id is not null
      and player_id is null
      and expected_amount_minor is null
      and reference_fingerprint is not null
      and reference_fingerprint ~ '^[0-9a-f]{64}$'
      and reference_masked is not null
      and reference_masked = pg_catalog.btrim(reference_masked)
      and reference_masked ~ '^\*{3}[A-Z0-9._-]{4}$'
      and reference_key_version = 1
    )
  )
);

create unique index customer_web_deposit_receipts_open_intent_idx
  on app.customer_web_deposit_request_receipts (deposit_intent_id)
  where request_kind = 'open_intent';

create unique index customer_web_deposit_receipts_capture_submission_idx
  on app.customer_web_deposit_request_receipts (deposit_submission_id)
  where request_kind = 'capture_reference';

create function app.reject_live_deposit_request_receipt_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
begin
  raise exception 'Live deposit request receipts are append-only.';
end;
$$;

create function app.open_telegram_live_deposit_intent(
  p_origin_inbound_event_id uuid,
  p_player_id text,
  p_expected_amount_minor bigint,
  p_semantic_input_hmac text
)
returns table (
  deposit_intent_id uuid,
  provider_code text,
  receiver_account_holder_name text,
  receiver_account_masked text,
  receiver_customer_instruction text,
  expected_amount_minor bigint,
  currency_code text,
  payment_deadline_at timestamptz,
  deposit_status text,
  origin_inbound_event_already_consumed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_boundary record;
  resolved_conversation_id uuid;
  resolved_conversation_version bigint;
  resolved_customer_id uuid;
  resolved_customer_status app.record_status;
  resolved_identity_id uuid;
  resolved_identity_status app.record_status;
  resolved_instruction text;
  resolved_intent app.deposit_intents%rowtype;
  resolved_processed_at timestamptz;
  resolved_receipt app.telegram_live_deposit_request_receipts%rowtype;
begin
  if p_origin_inbound_event_id is null
    or p_player_id is null
    or p_player_id <> pg_catalog.btrim(p_player_id)
    or pg_catalog.char_length(p_player_id) not between 1 and 64
    or p_player_id ~ '[[:space:][:cntrl:]]'
    or p_expected_amount_minor is null
    or p_expected_amount_minor <= 0 then
    raise exception 'The Telegram live deposit request is invalid.';
  end if;

  if p_semantic_input_hmac is null
    or p_semantic_input_hmac <> pg_catalog.lower(pg_catalog.btrim(p_semantic_input_hmac))
    or p_semantic_input_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The Telegram live deposit integrity value is invalid.';
  end if;

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);

  select inbound_event.customer_identity_id,
         inbound_event.processed_at
    into resolved_identity_id,
         resolved_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;

  if not found or resolved_identity_id is null then
    raise exception 'The Telegram inbound event is unavailable for live deposit intake.';
  end if;

  select customer_identity.customer_id,
         customer_identity.status,
         customer.status,
         conversation.id,
         conversation.version
    into resolved_customer_id,
         resolved_identity_status,
         resolved_customer_status,
         resolved_conversation_id,
         resolved_conversation_version
    from app.customer_identities customer_identity
    join app.customers customer
      on customer.id = customer_identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = customer_identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
    join app.bot_conversations conversation
      on conversation.telegram_identity_id = customer_identity.id
   where customer_identity.id = resolved_identity_id
     and customer_identity.identity_kind = 'telegram'
     and exists (
       select 1
         from app.telegram_beta_invites invite
        where invite.status = 'redeemed'
          and invite.redeemed_customer_id = customer_identity.customer_id
          and invite.redeemed_customer_identity_id = customer_identity.id
          and invite.redeemed_telegram_user_id = telegram_identity.telegram_user_id
          and invite.redeemed_private_chat_id = telegram_identity.private_chat_id
     )
   for update of customer_identity, customer, telegram_identity, conversation;

  if not found then
    raise exception 'The Telegram customer is unavailable for live deposit intake.';
  end if;

  select receipt.*
    into resolved_receipt
    from app.telegram_live_deposit_request_receipts receipt
   where receipt.origin_inbound_event_id = p_origin_inbound_event_id;

  if found then
    if resolved_receipt.request_kind <> 'open_intent'
      or resolved_receipt.semantic_input_hmac is distinct from p_semantic_input_hmac
      or resolved_receipt.customer_identity_id is distinct from resolved_identity_id
      or resolved_receipt.customer_id is distinct from resolved_customer_id
      or resolved_receipt.conversation_id is distinct from resolved_conversation_id
      or resolved_receipt.player_id is distinct from p_player_id
      or resolved_receipt.expected_amount_minor is distinct from p_expected_amount_minor then
      raise exception 'The replayed Telegram live deposit request does not match its receipt.';
    end if;

    select deposit_intent.*
      into resolved_intent
      from app.deposit_intents deposit_intent
      join app.customer_platform_players player_account
        on player_account.id = deposit_intent.player_account_id
      join app.payment_providers payment_provider
        on payment_provider.id = deposit_intent.payment_provider_id
     where deposit_intent.id = resolved_receipt.deposit_intent_id
       and deposit_intent.origin_inbound_event_id = p_origin_inbound_event_id
       and deposit_intent.customer_id = resolved_customer_id
       and deposit_intent.expected_amount_minor = p_expected_amount_minor
       and player_account.player_id = p_player_id
       and payment_provider.code = 'cbe_birr'
       and deposit_intent.status = 'intake_received'
       and deposit_intent.payment_deadline_at > pg_catalog.statement_timestamp()
     for update of deposit_intent;

    if not found then
      raise exception 'The replayed Telegram live deposit request requires remediation.';
    end if;

    resolved_instruction := resolved_intent.receiver_instructions_snapshot ->> 'customer_message';
    return query
    select resolved_intent.id,
           'cbe_birr'::text,
           resolved_intent.receiver_account_holder_name_snapshot,
           resolved_intent.receiver_account_masked_snapshot,
           resolved_instruction,
           resolved_intent.expected_amount_minor,
           resolved_intent.currency_code::text,
           resolved_intent.payment_deadline_at,
           'intake_received'::text,
           true;
    return;
  end if;

  if resolved_processed_at is not null
    or resolved_identity_status <> 'active'
    or resolved_customer_status <> 'active'
    or exists (
      select 1
        from app.inbound_event_consumptions consumption
       where consumption.origin_inbound_event_id = p_origin_inbound_event_id
    ) then
    raise exception 'The Telegram event cannot open a live deposit.';
  end if;

  perform app.require_live_customer_deposit_switches();

  select boundary.*
    into resolved_boundary
    from app.resolve_current_live_customer_deposit_boundary(
      resolved_customer_id,
      p_player_id,
      p_expected_amount_minor
    ) boundary;

  if not found then
    raise exception 'The Telegram live deposit boundary is unavailable.';
  end if;

  insert into app.deposit_intents (
    customer_id,
    platform_id,
    player_account_id,
    payment_provider_id,
    receiver_account_id,
    expected_amount_minor,
    origin_inbound_event_id
  )
  values (
    resolved_customer_id,
    resolved_boundary.platform_id,
    resolved_boundary.player_account_id,
    resolved_boundary.payment_provider_id,
    resolved_boundary.receiver_account_id,
    p_expected_amount_minor,
    p_origin_inbound_event_id
  )
  returning * into resolved_intent;

  if resolved_intent.player_deposit_eligibility_decision_id
       is distinct from resolved_boundary.eligibility_decision_id
    or resolved_intent.receiver_account_version
       is distinct from resolved_boundary.receiver_account_version
    or resolved_intent.receiver_account_holder_name_snapshot
       is distinct from resolved_boundary.receiver_account_holder_name
    or resolved_intent.receiver_account_masked_snapshot
       is distinct from resolved_boundary.receiver_account_masked
    or resolved_intent.receiver_instructions_snapshot
       is distinct from resolved_boundary.receiver_instructions
    or resolved_intent.deposit_policy_version_id
       is distinct from resolved_boundary.deposit_policy_version_id
    or resolved_intent.deposit_policy_version
       is distinct from resolved_boundary.deposit_policy_version
    or resolved_intent.minimum_amount_minor
       is distinct from resolved_boundary.minimum_amount_minor
    or resolved_intent.maximum_amount_minor
       is distinct from resolved_boundary.maximum_amount_minor
    or resolved_intent.freshness_window_seconds
       is distinct from resolved_boundary.freshness_window_seconds
    or resolved_intent.status <> 'intake_received' then
    raise exception 'The Telegram live deposit snapshot is inconsistent.';
  end if;

  insert into app.telegram_live_deposit_request_receipts (
    origin_inbound_event_id,
    customer_identity_id,
    customer_id,
    conversation_id,
    request_kind,
    semantic_input_hmac,
    deposit_intent_id,
    player_id,
    expected_amount_minor,
    conversation_version
  )
  values (
    p_origin_inbound_event_id,
    resolved_identity_id,
    resolved_customer_id,
    resolved_conversation_id,
    'open_intent',
    p_semantic_input_hmac,
    resolved_intent.id,
    p_player_id,
    p_expected_amount_minor,
    resolved_conversation_version
  );

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
    'deposit.live_intent_opened',
    'deposit_intent',
    resolved_intent.id,
    pg_catalog.jsonb_build_object(
      'channel', 'telegram',
      'provider_code', 'cbe_birr',
      'platform_code', 'kemerbet',
      'verification_source', 'cbe_birr_authoritative',
      'financial_mode', 'live'
    )
  );

  resolved_instruction := resolved_intent.receiver_instructions_snapshot ->> 'customer_message';
  return query
  select resolved_intent.id,
         'cbe_birr'::text,
         resolved_intent.receiver_account_holder_name_snapshot,
         resolved_intent.receiver_account_masked_snapshot,
         resolved_instruction,
         resolved_intent.expected_amount_minor,
         resolved_intent.currency_code::text,
         resolved_intent.payment_deadline_at,
         resolved_intent.status::text,
         false;
end;
$$;

create function app.get_telegram_customer_deposit(
  p_origin_inbound_event_id uuid,
  p_deposit_intent_id uuid
)
returns table (
  deposit_intent_id uuid,
  expected_amount_minor bigint,
  currency_code text,
  deposit_status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_customer_id uuid;
begin
  if p_origin_inbound_event_id is null or p_deposit_intent_id is null then
    raise exception 'The Telegram deposit status request is invalid.';
  end if;

  select customer_identity.customer_id
    into resolved_customer_id
    from app.inbound_events inbound_event
    join app.customer_identities customer_identity
      on customer_identity.id = inbound_event.customer_identity_id
    join app.customers customer
      on customer.id = customer_identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = customer_identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
     and customer_identity.identity_kind = 'telegram'
     and customer_identity.status = 'active'
     and customer.status = 'active'
     and exists (
       select 1
         from app.telegram_beta_invites invite
        where invite.status = 'redeemed'
          and invite.redeemed_customer_id = customer_identity.customer_id
          and invite.redeemed_customer_identity_id = customer_identity.id
          and invite.redeemed_telegram_user_id = telegram_identity.telegram_user_id
          and invite.redeemed_private_chat_id = telegram_identity.private_chat_id
     );

  if not found then
    raise exception 'The Telegram deposit status request is unavailable.';
  end if;

  return query
  select deposit_intent.id,
         deposit_intent.expected_amount_minor,
         deposit_intent.currency_code::text,
         deposit_intent.status::text,
         deposit_intent.created_at,
         deposit_intent.updated_at
    from app.deposit_intents deposit_intent
   where deposit_intent.id = p_deposit_intent_id
     and deposit_intent.customer_id = resolved_customer_id;
end;
$$;

create function app.list_customer_web_deposits(
  p_actor_auth_user_id uuid,
  p_limit integer default 20
)
returns table (
  deposit_intent_id uuid,
  expected_amount_minor bigint,
  currency_code text,
  deposit_status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_customer_id uuid;
begin
  if p_actor_auth_user_id is null
    or p_limit is null
    or p_limit not between 1 and 50 then
    raise exception 'The customer-web deposit list request is invalid.';
  end if;

  if exists (
    select 1
      from app.admin_users admin_user
     where admin_user.auth_user_id = p_actor_auth_user_id
       and admin_user.status = 'active'
  ) then
    raise exception 'The customer-web deposit list request is unavailable.';
  end if;

  select customer_auth_identity.customer_id
    into resolved_customer_id
    from app.customer_auth_identities customer_auth_identity
    join app.customer_identities customer_identity
      on customer_identity.id = customer_auth_identity.customer_identity_id
     and customer_identity.customer_id = customer_auth_identity.customer_id
    join app.customers customer
      on customer.id = customer_auth_identity.customer_id
   where customer_auth_identity.auth_user_id = p_actor_auth_user_id
     and customer_identity.identity_kind = 'supabase_auth'
     and customer_identity.external_subject = p_actor_auth_user_id::text
     and customer_identity.status = 'active'
     and customer.status = 'active';

  if not found then
    raise exception 'The customer-web deposit list request is unavailable.';
  end if;

  return query
  select deposit_intent.id,
         deposit_intent.expected_amount_minor,
         deposit_intent.currency_code::text,
         deposit_intent.status::text,
         deposit_intent.created_at,
         deposit_intent.updated_at
    from app.deposit_intents deposit_intent
   where deposit_intent.customer_id = resolved_customer_id
   order by deposit_intent.created_at desc,
            deposit_intent.id desc
   limit p_limit;
end;
$$;

create function app.capture_customer_web_deposit_reference(
  p_actor_auth_user_id uuid,
  p_request_key uuid,
  p_deposit_intent_id uuid,
  p_reference_ciphertext text,
  p_reference_fingerprint text,
  p_reference_masked text,
  p_reference_key_version smallint
)
returns table (
  result_deposit_intent_id uuid,
  submission_status text,
  deposit_status text,
  submitted_at timestamptz,
  request_key_already_used boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_boundary record;
  resolved_customer_id uuid;
  resolved_customer_identity_id uuid;
  resolved_customer_status app.record_status;
  resolved_identity_status app.record_status;
  resolved_intent app.deposit_intents%rowtype;
  resolved_player_id text;
  resolved_receipt app.customer_web_deposit_request_receipts%rowtype;
  resolved_submission app.deposit_submissions%rowtype;
  resolved_submission_number integer;
  verification_job_id uuid;
begin
  if p_actor_auth_user_id is null
    or p_request_key is null
    or p_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_deposit_intent_id is null
    or p_reference_key_version is distinct from 1
    or p_reference_ciphertext is null
    or p_reference_ciphertext <> pg_catalog.btrim(p_reference_ciphertext)
    or pg_catalog.char_length(p_reference_ciphertext) > 2048
    or p_reference_ciphertext
       !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{7,}$'
    or p_reference_fingerprint is null
    or p_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or p_reference_masked is null
    or p_reference_masked <> pg_catalog.btrim(p_reference_masked)
    or p_reference_masked !~ '^\*{3}[A-Z0-9._-]{4}$' then
    raise exception 'The protected customer-web live deposit reference is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:customer-auth:v1:' || p_actor_auth_user_id::text,
      0::bigint
    )
  );

  select customer_auth_identity.customer_identity_id,
         customer_auth_identity.customer_id,
         customer_identity.status,
         customer.status
    into resolved_customer_identity_id,
         resolved_customer_id,
         resolved_identity_status,
         resolved_customer_status
    from app.customer_auth_identities customer_auth_identity
    join app.customer_identities customer_identity
      on customer_identity.id = customer_auth_identity.customer_identity_id
     and customer_identity.customer_id = customer_auth_identity.customer_id
    join app.customers customer
      on customer.id = customer_auth_identity.customer_id
   where customer_auth_identity.auth_user_id = p_actor_auth_user_id
     and customer_identity.identity_kind = 'supabase_auth'
     and customer_identity.external_subject = p_actor_auth_user_id::text
   for update of customer_auth_identity, customer_identity, customer;

  if not found then
    raise exception 'The customer-web live deposit reference request is unavailable.';
  end if;

  select receipt.*
    into resolved_receipt
    from app.customer_web_deposit_request_receipts receipt
   where receipt.customer_auth_identity_id = resolved_customer_identity_id
     and receipt.request_key = p_request_key;

  if found then
    if resolved_receipt.request_kind <> 'capture_reference'
      or resolved_receipt.deposit_intent_id is distinct from p_deposit_intent_id
      or resolved_receipt.reference_fingerprint is distinct from p_reference_fingerprint
      or resolved_receipt.reference_masked is distinct from p_reference_masked
      or resolved_receipt.reference_key_version is distinct from p_reference_key_version then
      raise exception 'The replayed customer-web live deposit reference conflicts with its receipt.';
    end if;

    select submission.*
      into resolved_submission
      from app.deposit_submissions submission
      join app.deposit_intents deposit_intent
        on deposit_intent.id = submission.deposit_intent_id
     where submission.id = resolved_receipt.deposit_submission_id
       and submission.deposit_intent_id = p_deposit_intent_id
       and submission.submitted_reference_fingerprint = p_reference_fingerprint
       and submission.submitted_reference_masked = p_reference_masked
       and submission.reference_encryption_key_version = p_reference_key_version
       and deposit_intent.customer_id = resolved_customer_id;

    if not found
      or not exists (
        select 1
          from app.deposit_jobs verification_job
         where verification_job.deposit_intent_id = resolved_submission.deposit_intent_id
           and verification_job.deposit_submission_id = resolved_submission.id
           and verification_job.job_kind = 'verify_deposit'
           and verification_job.job_key =
             'cbe-birr-authoritative-verification:v1:' || resolved_submission.id::text
      ) then
      raise exception 'The replayed customer-web live deposit reference requires remediation.';
    end if;

    return query
    select resolved_submission.deposit_intent_id,
           'verification_enqueued'::text,
           'verification_pending'::text,
           resolved_submission.submitted_at,
           true;
    return;
  end if;

  if resolved_identity_status <> 'active'
    or resolved_customer_status <> 'active'
    or exists (
      select 1
        from app.admin_users admin_user
       where admin_user.auth_user_id = p_actor_auth_user_id
         and admin_user.status = 'active'
    ) then
    raise exception 'The customer-web live deposit reference request is unavailable.';
  end if;

  perform app.require_live_customer_deposit_switches();

  select deposit_intent.*
    into resolved_intent
    from app.deposit_intents deposit_intent
    join app.payment_providers payment_provider
      on payment_provider.id = deposit_intent.payment_provider_id
   where deposit_intent.id = p_deposit_intent_id
     and deposit_intent.customer_id = resolved_customer_id
     and deposit_intent.status = 'intake_received'
     and payment_provider.code = 'cbe_birr'
     and exists (
       select 1
         from app.customer_web_deposit_request_receipts opening_receipt
        where opening_receipt.deposit_intent_id = deposit_intent.id
          and opening_receipt.customer_auth_identity_id = resolved_customer_identity_id
          and opening_receipt.request_kind = 'open_intent'
     )
   for update of deposit_intent;

  if not found
    or pg_catalog.clock_timestamp() > resolved_intent.payment_deadline_at then
    raise exception 'The live deposit is not accepting this reference.';
  end if;

  select player_account.player_id
    into resolved_player_id
    from app.customer_platform_players player_account
   where player_account.id = resolved_intent.player_account_id
     and player_account.customer_id = resolved_customer_id;

  if not found then
    raise exception 'The live deposit Player ID is unavailable.';
  end if;

  select boundary.*
    into resolved_boundary
    from app.resolve_current_live_customer_deposit_boundary(
      resolved_customer_id,
      resolved_player_id,
      resolved_intent.expected_amount_minor
    ) boundary;

  if not found
    or resolved_intent.platform_id is distinct from resolved_boundary.platform_id
    or resolved_intent.player_account_id is distinct from resolved_boundary.player_account_id
    or resolved_intent.player_deposit_eligibility_decision_id
       is distinct from resolved_boundary.eligibility_decision_id
    or resolved_intent.payment_provider_id
       is distinct from resolved_boundary.payment_provider_id
    or resolved_intent.receiver_account_id
       is distinct from resolved_boundary.receiver_account_id
    or resolved_intent.receiver_account_version
       is distinct from resolved_boundary.receiver_account_version
    or resolved_intent.receiver_account_holder_name_snapshot
       is distinct from resolved_boundary.receiver_account_holder_name
    or resolved_intent.receiver_account_masked_snapshot
       is distinct from resolved_boundary.receiver_account_masked
    or resolved_intent.receiver_instructions_snapshot
       is distinct from resolved_boundary.receiver_instructions
    or resolved_intent.deposit_policy_version_id
       is distinct from resolved_boundary.deposit_policy_version_id
    or resolved_intent.deposit_policy_version
       is distinct from resolved_boundary.deposit_policy_version
    or resolved_intent.minimum_amount_minor
       is distinct from resolved_boundary.minimum_amount_minor
    or resolved_intent.maximum_amount_minor
       is distinct from resolved_boundary.maximum_amount_minor
    or resolved_intent.freshness_window_seconds
       is distinct from resolved_boundary.freshness_window_seconds then
    raise exception 'The live deposit boundary is no longer current.';
  end if;

  if exists (
    select 1
      from app.deposit_submissions submission
     where submission.deposit_intent_id = resolved_intent.id
       and submission.status in ('received', 'verification_enqueued')
  ) then
    raise exception 'The live deposit already has an active reference.';
  end if;

  select coalesce(pg_catalog.max(submission.submission_number), 0) + 1
    into resolved_submission_number
    from app.deposit_submissions submission
   where submission.deposit_intent_id = resolved_intent.id;

  begin
    insert into app.deposit_submissions (
      deposit_intent_id,
      submission_number,
      submitted_reference_ciphertext,
      submitted_reference_fingerprint,
      submitted_reference_masked,
      reference_encryption_key_version,
      status,
      submitted_at
    )
    values (
      resolved_intent.id,
      resolved_submission_number,
      p_reference_ciphertext,
      p_reference_fingerprint,
      p_reference_masked,
      p_reference_key_version,
      'received',
      pg_catalog.clock_timestamp()
    )
    returning * into resolved_submission;

    insert into app.deposit_jobs (
      deposit_intent_id,
      deposit_submission_id,
      job_kind,
      job_key,
      max_attempts
    )
    values (
      resolved_intent.id,
      resolved_submission.id,
      'verify_deposit',
      'cbe-birr-authoritative-verification:v1:' || resolved_submission.id::text,
      8
    )
    returning id into verification_job_id;
  exception
    when unique_violation then
      raise exception 'The live deposit reference is already awaiting verification.';
  end;

  if verification_job_id is null then
    raise exception 'The authoritative verification command was not created.';
  end if;

  update app.deposit_submissions submission
     set status = 'verification_enqueued'
   where submission.id = resolved_submission.id
     and submission.status = 'received'
  returning * into resolved_submission;

  if not found then
    raise exception 'The live deposit submission was not enqueued.';
  end if;

  update app.deposit_intents deposit_intent
     set status = 'verification_pending'
   where deposit_intent.id = resolved_intent.id
     and deposit_intent.status = 'intake_received';

  if not found then
    raise exception 'The live deposit did not enter verification.';
  end if;

  insert into app.customer_web_deposit_request_receipts (
    customer_auth_identity_id,
    request_key,
    request_kind,
    deposit_intent_id,
    deposit_submission_id,
    reference_fingerprint,
    reference_masked,
    reference_key_version
  )
  values (
    resolved_customer_identity_id,
    p_request_key,
    'capture_reference',
    resolved_intent.id,
    resolved_submission.id,
    p_reference_fingerprint,
    p_reference_masked,
    p_reference_key_version
  );

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
    'deposit.live_reference_enqueued',
    'deposit_intent',
    resolved_intent.id,
    pg_catalog.jsonb_build_object(
      'channel', 'customer_web',
      'provider_code', 'cbe_birr',
      'verification_source', 'cbe_birr_authoritative',
      'financial_mode', 'live',
      'reference_encryption_key_version', p_reference_key_version
    )
  );

  return query
  select resolved_intent.id,
         'verification_enqueued'::text,
         'verification_pending'::text,
         resolved_submission.submitted_at,
         false;
end;
$$;



create trigger telegram_live_deposit_receipts_immutable
before update or delete on app.telegram_live_deposit_request_receipts
for each row
execute function app.reject_live_deposit_request_receipt_mutation();

create trigger telegram_live_deposit_receipts_no_truncate
before truncate on app.telegram_live_deposit_request_receipts
for each statement
execute function app.reject_live_deposit_request_receipt_mutation();

create trigger customer_web_deposit_receipts_immutable
before update or delete on app.customer_web_deposit_request_receipts
for each row
execute function app.reject_live_deposit_request_receipt_mutation();

create trigger customer_web_deposit_receipts_no_truncate
before truncate on app.customer_web_deposit_request_receipts
for each statement
execute function app.reject_live_deposit_request_receipt_mutation();

create function app.enforce_telegram_live_deposit_receipt_binding()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_conversation_id uuid;
  resolved_conversation_version bigint;
  resolved_customer_id uuid;
  resolved_customer_status app.record_status;
  resolved_identity_id uuid;
  resolved_identity_status app.record_status;
  resolved_processed_at timestamptz;
begin
  perform app.lock_telegram_inbound_event_scope(new.origin_inbound_event_id);

  select inbound_event.customer_identity_id,
         inbound_event.processed_at
    into resolved_identity_id,
         resolved_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = new.origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;

  if not found
    or resolved_identity_id is null
    or resolved_processed_at is not null then
    raise exception 'The Telegram live deposit receipt is unavailable.';
  end if;

  select customer_identity.customer_id,
         customer_identity.status,
         customer.status,
         conversation.id,
         conversation.version
    into resolved_customer_id,
         resolved_identity_status,
         resolved_customer_status,
         resolved_conversation_id,
         resolved_conversation_version
    from app.customer_identities customer_identity
    join app.customers customer
      on customer.id = customer_identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = customer_identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
    join app.bot_conversations conversation
      on conversation.telegram_identity_id = customer_identity.id
   where customer_identity.id = resolved_identity_id
     and customer_identity.identity_kind = 'telegram'
     and exists (
       select 1
         from app.telegram_beta_invites invite
        where invite.status = 'redeemed'
          and invite.redeemed_customer_id = customer_identity.customer_id
          and invite.redeemed_customer_identity_id = customer_identity.id
          and invite.redeemed_telegram_user_id = telegram_identity.telegram_user_id
          and invite.redeemed_private_chat_id = telegram_identity.private_chat_id
     )
   for update of customer_identity, customer, telegram_identity, conversation;

  if not found
    or resolved_identity_status <> 'active'
    or resolved_customer_status <> 'active'
    or new.customer_identity_id is distinct from resolved_identity_id
    or new.customer_id is distinct from resolved_customer_id
    or new.conversation_id is distinct from resolved_conversation_id
    or new.conversation_version is distinct from resolved_conversation_version then
    raise exception 'The Telegram live deposit receipt is unavailable.';
  end if;

  if exists (
    select 1
      from app.inbound_event_consumptions consumption
     where consumption.origin_inbound_event_id = new.origin_inbound_event_id
  ) then
    raise exception 'The Telegram inbound event already has another semantic receipt.';
  end if;

  new.created_at := pg_catalog.clock_timestamp();

  update app.inbound_events inbound_event
     set processed_at = new.created_at,
         processing_error_code = null
   where inbound_event.id = new.origin_inbound_event_id
     and inbound_event.processed_at is null;

  if not found then
    raise exception 'The Telegram live deposit receipt is unavailable.';
  end if;

  return new;
end;
$$;

create trigger telegram_live_deposit_receipts_enforce_binding
before insert on app.telegram_live_deposit_request_receipts
for each row
execute function app.enforce_telegram_live_deposit_receipt_binding();

create function app.block_inbound_consumption_after_live_deposit_receipt()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
begin
  perform app.lock_telegram_inbound_event_scope(new.origin_inbound_event_id);

  if exists (
    select 1
      from app.telegram_live_deposit_request_receipts receipt
     where receipt.origin_inbound_event_id = new.origin_inbound_event_id
  ) then
    raise exception 'The Telegram inbound event already has another semantic receipt.';
  end if;

  return new;
end;
$$;

create trigger inbound_event_consumptions_block_live_deposit_receipt
before insert on app.inbound_event_consumptions
for each row
execute function app.block_inbound_consumption_after_live_deposit_receipt();

create function app.require_live_deposit_request_receipt_result()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_origin_inbound_event_id uuid;
  resolved_receipt_customer_id uuid;
begin
  if tg_table_name = 'telegram_live_deposit_request_receipts' then
    resolved_origin_inbound_event_id := new.origin_inbound_event_id;
    resolved_receipt_customer_id := new.customer_id;

    if not exists (
      select 1
        from app.inbound_events inbound_event
       where inbound_event.id = new.origin_inbound_event_id
         and inbound_event.channel = 'telegram'
         and inbound_event.customer_identity_id = new.customer_identity_id
         and inbound_event.processed_at = new.created_at
    ) then
      raise exception 'The Telegram live deposit receipt has no matching inbound event.';
    end if;
  elsif tg_table_name = 'customer_web_deposit_request_receipts' then
    select customer_auth_identity.customer_id
      into resolved_receipt_customer_id
        from app.customer_auth_identities customer_auth_identity
        join app.customer_identities customer_identity
          on customer_identity.id = customer_auth_identity.customer_identity_id
         and customer_identity.customer_id = customer_auth_identity.customer_id
        join app.customers customer
          on customer.id = customer_auth_identity.customer_id
       where customer_auth_identity.customer_identity_id = new.customer_auth_identity_id
         and customer_identity.identity_kind = 'supabase_auth'
         and customer_identity.status = 'active'
         and customer.status = 'active'
       limit 1;

    if not found then
      raise exception 'The customer-web live deposit receipt has no matching actor.';
    end if;
  else
    raise exception 'The live deposit receipt source is invalid.';
  end if;

  if new.request_kind = 'open_intent'
    and not exists (
      select 1
        from app.deposit_intents deposit_intent
        join app.customer_platform_players player_account
          on player_account.id = deposit_intent.player_account_id
        join app.payment_providers payment_provider
          on payment_provider.id = deposit_intent.payment_provider_id
       where deposit_intent.id = new.deposit_intent_id
         and deposit_intent.customer_id = resolved_receipt_customer_id
         and player_account.player_id = new.player_id
         and payment_provider.code = 'cbe_birr'
         and deposit_intent.expected_amount_minor = new.expected_amount_minor
         and (resolved_origin_inbound_event_id is null
           or deposit_intent.origin_inbound_event_id = resolved_origin_inbound_event_id)
    ) then
    raise exception 'The live deposit opening receipt has no matching intent.';
  end if;

  if new.request_kind = 'capture_reference'
    and not exists (
      select 1
        from app.deposit_submissions submission
        join app.deposit_intents deposit_intent
          on deposit_intent.id = submission.deposit_intent_id
        join app.payment_providers payment_provider
          on payment_provider.id = deposit_intent.payment_provider_id
        join app.deposit_jobs verification_job
          on verification_job.deposit_intent_id = deposit_intent.id
         and verification_job.deposit_submission_id = submission.id
         and verification_job.job_kind = 'verify_deposit'
         and verification_job.job_key =
           'cbe-birr-authoritative-verification:v1:' || submission.id::text
       where submission.id = new.deposit_submission_id
         and submission.deposit_intent_id = new.deposit_intent_id
         and submission.submitted_reference_fingerprint = new.reference_fingerprint
         and submission.submitted_reference_masked = new.reference_masked
         and submission.reference_encryption_key_version = new.reference_key_version
         and submission.status = 'verification_enqueued'
         and deposit_intent.status = 'verification_pending'
         and payment_provider.code = 'cbe_birr'
         and deposit_intent.customer_id = resolved_receipt_customer_id
         and (resolved_origin_inbound_event_id is null
           or submission.origin_inbound_event_id = resolved_origin_inbound_event_id)
    ) then
    raise exception 'The live deposit capture receipt has no matching verification command.';
  end if;

  return null;
end;
$$;

create trigger telegram_live_deposit_receipts_require_result
after insert on app.telegram_live_deposit_request_receipts
for each row
execute function app.require_live_deposit_request_receipt_result();

create trigger customer_web_deposit_receipts_require_result
after insert on app.customer_web_deposit_request_receipts
for each row
execute function app.require_live_deposit_request_receipt_result();

create function app.require_live_customer_deposit_switches()
returns void
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
declare
  live_switch_count integer;
  resolved_switch_count integer;
begin
  perform 1
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'payment_verification',
     'deposit_execution',
     'cbe_birr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;

  get diagnostics resolved_switch_count = row_count;

  if resolved_switch_count <> 3 then
    raise exception 'Live CBE Birr deposit intake is not enabled.';
  end if;

  select pg_catalog.count(*) filter (where feature_switch.mode = 'live')::integer
    into live_switch_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'payment_verification',
     'deposit_execution',
     'cbe_birr_authoritative_verification'
   );

  if live_switch_count <> 3 then
    raise exception 'Live CBE Birr deposit intake is not enabled.';
  end if;
end;
$$;

create function app.resolve_current_live_customer_deposit_boundary(
  p_customer_id uuid,
  p_player_id text,
  p_expected_amount_minor bigint
)
returns table (
  platform_id uuid,
  player_account_id uuid,
  eligibility_decision_id uuid,
  payment_provider_id uuid,
  receiver_account_id uuid,
  receiver_account_version integer,
  receiver_account_holder_name text,
  receiver_account_masked text,
  receiver_instructions jsonb,
  deposit_policy_version_id uuid,
  deposit_policy_version integer,
  minimum_amount_minor bigint,
  maximum_amount_minor bigint,
  freshness_window_seconds integer,
  customer_instruction text
)
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
declare
  decision_count integer;
  latest_decision app.player_deposit_eligibility_decisions%rowtype;
  maximum_decision_version integer;
  player_row app.customer_platform_players%rowtype;
  policy_row app.deposit_policy_versions%rowtype;
  provider_row app.payment_providers%rowtype;
  receiver_row app.receiver_accounts%rowtype;
  resolved_customer_instruction text;
  resolved_platform_id uuid;
begin
  if p_customer_id is null
    or p_player_id is null
    or p_player_id <> pg_catalog.btrim(p_player_id)
    or pg_catalog.char_length(p_player_id) not between 1 and 64
    or p_player_id ~ '[[:space:][:cntrl:]]'
    or p_expected_amount_minor is null
    or p_expected_amount_minor <= 0 then
    raise exception 'The live deposit boundary request is invalid.';
  end if;

  perform 1
    from app.customers customer
   where customer.id = p_customer_id
     and customer.status = 'active'
   for update;

  if not found then
    raise exception 'The live deposit customer is unavailable.';
  end if;

  select platform.id
    into resolved_platform_id
    from app.platforms platform
   where platform.code = 'kemerbet'
     and platform.status = 'active'
   for update;

  if not found then
    raise exception 'The live deposit platform is unavailable.';
  end if;

  select player_account.*
    into player_row
    from app.customer_platform_players player_account
   where player_account.customer_id = p_customer_id
     and player_account.platform_id = resolved_platform_id
     and player_account.player_id = p_player_id
     and player_account.status = 'active'
     and player_account.validation_status = 'valid'
   for update;

  if not found then
    raise exception 'The live deposit Player ID is unavailable.';
  end if;

  select pg_catalog.count(*)::integer,
         coalesce(pg_catalog.max(decision.decision_version), 0)::integer
    into decision_count,
         maximum_decision_version
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = player_row.id;

  select decision.*
    into latest_decision
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = player_row.id
   order by decision.decision_version desc
   limit 1;

  if decision_count = 0
    or decision_count <> maximum_decision_version
    or latest_decision.decision_version <> maximum_decision_version
    or latest_decision.decision <> 'eligible'
    or latest_decision.reason_code <> 'financial_eligibility_approved'
    or latest_decision.decided_at > pg_catalog.clock_timestamp()
    or latest_decision.player_account_updated_at_snapshot
       is distinct from player_row.updated_at then
    raise exception 'The live deposit Player ID is not currently eligible.';
  end if;

  select payment_provider.*
    into provider_row
    from app.payment_providers payment_provider
   where payment_provider.code = 'cbe_birr'
     and payment_provider.adapter_key = 'cbe_birr'
     and payment_provider.status = 'active'
   for update;

  if not found then
    raise exception 'The live CBE Birr provider is unavailable.';
  end if;

  select receiver_account.*
    into receiver_row
    from app.receiver_accounts receiver_account
   where receiver_account.provider_id = provider_row.id
     and receiver_account.status = 'active'
     and receiver_account.retired_at is null
     and receiver_account.verification_reference_ciphertext is not null
     and pg_catalog.btrim(receiver_account.verification_reference_ciphertext) <> ''
   for update;

  resolved_customer_instruction := receiver_row.instructions ->> 'customer_message';
  if not found
    or receiver_row.account_holder_name <> pg_catalog.btrim(receiver_row.account_holder_name)
    or pg_catalog.char_length(receiver_row.account_holder_name) not between 1 and 160
    or receiver_row.account_holder_name ~ '[[:cntrl:]]'
    or pg_catalog.btrim(receiver_row.account_reference_ciphertext) = ''
    or receiver_row.account_reference_masked
       <> pg_catalog.btrim(receiver_row.account_reference_masked)
    or receiver_row.account_reference_masked
       !~ '^\*{3,}[A-Za-z0-9._-]{2,16}$'
    or resolved_customer_instruction is null
    or resolved_customer_instruction <> pg_catalog.btrim(resolved_customer_instruction)
    or pg_catalog.char_length(resolved_customer_instruction) not between 1 and 256
    or resolved_customer_instruction ~ '[[:cntrl:]]' then
    raise exception 'The live CBE Birr receiver is unavailable.';
  end if;

  select policy.*
    into policy_row
    from app.deposit_policy_versions policy
   where policy.status = 'active'
     and policy.retired_at is null
     and policy.minimum_amount_minor = 2500
     and policy.maximum_amount_minor = 2500000
   for update;

  if not found
    or p_expected_amount_minor not between
      policy_row.minimum_amount_minor and policy_row.maximum_amount_minor then
    raise exception 'The current 25 to 25000 ETB deposit policy is unavailable.';
  end if;

  return query
  select resolved_platform_id,
         player_row.id,
         latest_decision.id,
         provider_row.id,
         receiver_row.id,
         receiver_row.version,
         receiver_row.account_holder_name,
         receiver_row.account_reference_masked,
         receiver_row.instructions,
         policy_row.id,
         policy_row.version,
         policy_row.minimum_amount_minor,
         policy_row.maximum_amount_minor,
         policy_row.freshness_window_seconds,
         resolved_customer_instruction;
end;
$$;

create function app.capture_telegram_live_deposit_reference(
  p_origin_inbound_event_id uuid,
  p_deposit_intent_id uuid,
  p_reference_ciphertext text,
  p_reference_fingerprint text,
  p_reference_masked text,
  p_reference_key_version smallint,
  p_semantic_input_hmac text
)
returns table (
  result_deposit_intent_id uuid,
  submission_status text,
  deposit_status text,
  submitted_at timestamptz,
  origin_inbound_event_already_consumed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_boundary record;
  resolved_conversation_id uuid;
  resolved_conversation_version bigint;
  resolved_customer_id uuid;
  resolved_customer_status app.record_status;
  resolved_identity_id uuid;
  resolved_identity_status app.record_status;
  resolved_intent app.deposit_intents%rowtype;
  resolved_player_id text;
  resolved_processed_at timestamptz;
  resolved_receipt app.telegram_live_deposit_request_receipts%rowtype;
  resolved_submission app.deposit_submissions%rowtype;
  resolved_submission_number integer;
  verification_job_id uuid;
begin
  if p_origin_inbound_event_id is null
    or p_deposit_intent_id is null
    or p_reference_key_version is distinct from 1
    or p_reference_ciphertext is null
    or p_reference_ciphertext <> pg_catalog.btrim(p_reference_ciphertext)
    or pg_catalog.char_length(p_reference_ciphertext) > 2048
    or p_reference_ciphertext
       !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{7,}$'
    or p_reference_fingerprint is null
    or p_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or p_reference_masked is null
    or p_reference_masked <> pg_catalog.btrim(p_reference_masked)
    or p_reference_masked !~ '^\*{3}[A-Z0-9._-]{4}$' then
    raise exception 'The protected Telegram live deposit reference is invalid.';
  end if;

  if p_semantic_input_hmac is null
    or p_semantic_input_hmac <> pg_catalog.lower(pg_catalog.btrim(p_semantic_input_hmac))
    or p_semantic_input_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The Telegram live deposit integrity value is invalid.';
  end if;

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);

  select inbound_event.customer_identity_id,
         inbound_event.processed_at
    into resolved_identity_id,
         resolved_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;

  if not found or resolved_identity_id is null then
    raise exception 'The Telegram inbound event is unavailable for live reference intake.';
  end if;

  select customer_identity.customer_id,
         customer_identity.status,
         customer.status,
         conversation.id,
         conversation.version
    into resolved_customer_id,
         resolved_identity_status,
         resolved_customer_status,
         resolved_conversation_id,
         resolved_conversation_version
    from app.customer_identities customer_identity
    join app.customers customer
      on customer.id = customer_identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = customer_identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
    join app.bot_conversations conversation
      on conversation.telegram_identity_id = customer_identity.id
   where customer_identity.id = resolved_identity_id
     and customer_identity.identity_kind = 'telegram'
     and exists (
       select 1
         from app.telegram_beta_invites invite
        where invite.status = 'redeemed'
          and invite.redeemed_customer_id = customer_identity.customer_id
          and invite.redeemed_customer_identity_id = customer_identity.id
          and invite.redeemed_telegram_user_id = telegram_identity.telegram_user_id
          and invite.redeemed_private_chat_id = telegram_identity.private_chat_id
     )
   for update of customer_identity, customer, telegram_identity, conversation;

  if not found then
    raise exception 'The Telegram customer is unavailable for live reference intake.';
  end if;

  select receipt.*
    into resolved_receipt
    from app.telegram_live_deposit_request_receipts receipt
   where receipt.origin_inbound_event_id = p_origin_inbound_event_id;

  if found then
    if resolved_receipt.request_kind <> 'capture_reference'
      or resolved_receipt.semantic_input_hmac is distinct from p_semantic_input_hmac
      or resolved_receipt.customer_identity_id is distinct from resolved_identity_id
      or resolved_receipt.customer_id is distinct from resolved_customer_id
      or resolved_receipt.conversation_id is distinct from resolved_conversation_id
      or resolved_receipt.deposit_intent_id is distinct from p_deposit_intent_id
      or resolved_receipt.reference_fingerprint is distinct from p_reference_fingerprint
      or resolved_receipt.reference_masked is distinct from p_reference_masked
      or resolved_receipt.reference_key_version is distinct from p_reference_key_version then
      raise exception 'The replayed Telegram live deposit reference does not match its receipt.';
    end if;

    select submission.*
      into resolved_submission
      from app.deposit_submissions submission
      join app.deposit_intents deposit_intent
        on deposit_intent.id = submission.deposit_intent_id
     where submission.id = resolved_receipt.deposit_submission_id
       and submission.deposit_intent_id = p_deposit_intent_id
       and submission.origin_inbound_event_id = p_origin_inbound_event_id
       and submission.submitted_reference_fingerprint = p_reference_fingerprint
       and submission.submitted_reference_masked = p_reference_masked
       and submission.reference_encryption_key_version = p_reference_key_version
       and deposit_intent.customer_id = resolved_customer_id;

    if not found
      or not exists (
        select 1
          from app.deposit_jobs verification_job
         where verification_job.deposit_intent_id = resolved_submission.deposit_intent_id
           and verification_job.deposit_submission_id = resolved_submission.id
           and verification_job.job_kind = 'verify_deposit'
           and verification_job.job_key =
             'cbe-birr-authoritative-verification:v1:' || resolved_submission.id::text
      ) then
      raise exception 'The replayed Telegram live deposit reference requires remediation.';
    end if;

    return query
    select resolved_submission.deposit_intent_id,
           'verification_enqueued'::text,
           'verification_pending'::text,
           resolved_submission.submitted_at,
           true;
    return;
  end if;

  if resolved_processed_at is not null
    or resolved_identity_status <> 'active'
    or resolved_customer_status <> 'active'
    or exists (
      select 1
        from app.inbound_event_consumptions consumption
       where consumption.origin_inbound_event_id = p_origin_inbound_event_id
    ) then
    raise exception 'The Telegram event cannot capture a live deposit reference.';
  end if;

  perform app.require_live_customer_deposit_switches();

  select deposit_intent.*
    into resolved_intent
    from app.deposit_intents deposit_intent
    join app.payment_providers payment_provider
      on payment_provider.id = deposit_intent.payment_provider_id
   where deposit_intent.id = p_deposit_intent_id
     and deposit_intent.customer_id = resolved_customer_id
     and deposit_intent.status = 'intake_received'
     and payment_provider.code = 'cbe_birr'
     and exists (
       select 1
         from app.telegram_live_deposit_request_receipts opening_receipt
        where opening_receipt.deposit_intent_id = deposit_intent.id
          and opening_receipt.customer_identity_id = resolved_identity_id
          and opening_receipt.customer_id = resolved_customer_id
          and opening_receipt.request_kind = 'open_intent'
     )
   for update of deposit_intent;

  if not found
    or resolved_intent.origin_inbound_event_id = p_origin_inbound_event_id
    or pg_catalog.clock_timestamp() > resolved_intent.payment_deadline_at then
    raise exception 'The live deposit is not accepting this reference.';
  end if;

  select player_account.player_id
    into resolved_player_id
    from app.customer_platform_players player_account
   where player_account.id = resolved_intent.player_account_id
     and player_account.customer_id = resolved_customer_id;

  if not found then
    raise exception 'The live deposit Player ID is unavailable.';
  end if;

  select boundary.*
    into resolved_boundary
    from app.resolve_current_live_customer_deposit_boundary(
      resolved_customer_id,
      resolved_player_id,
      resolved_intent.expected_amount_minor
    ) boundary;

  if not found
    or resolved_intent.platform_id is distinct from resolved_boundary.platform_id
    or resolved_intent.player_account_id is distinct from resolved_boundary.player_account_id
    or resolved_intent.player_deposit_eligibility_decision_id
       is distinct from resolved_boundary.eligibility_decision_id
    or resolved_intent.payment_provider_id
       is distinct from resolved_boundary.payment_provider_id
    or resolved_intent.receiver_account_id
       is distinct from resolved_boundary.receiver_account_id
    or resolved_intent.receiver_account_version
       is distinct from resolved_boundary.receiver_account_version
    or resolved_intent.receiver_account_holder_name_snapshot
       is distinct from resolved_boundary.receiver_account_holder_name
    or resolved_intent.receiver_account_masked_snapshot
       is distinct from resolved_boundary.receiver_account_masked
    or resolved_intent.receiver_instructions_snapshot
       is distinct from resolved_boundary.receiver_instructions
    or resolved_intent.deposit_policy_version_id
       is distinct from resolved_boundary.deposit_policy_version_id
    or resolved_intent.deposit_policy_version
       is distinct from resolved_boundary.deposit_policy_version
    or resolved_intent.minimum_amount_minor
       is distinct from resolved_boundary.minimum_amount_minor
    or resolved_intent.maximum_amount_minor
       is distinct from resolved_boundary.maximum_amount_minor
    or resolved_intent.freshness_window_seconds
       is distinct from resolved_boundary.freshness_window_seconds then
    raise exception 'The live deposit boundary is no longer current.';
  end if;

  if exists (
    select 1
      from app.deposit_submissions submission
     where submission.deposit_intent_id = resolved_intent.id
       and submission.status in ('received', 'verification_enqueued')
  ) then
    raise exception 'The live deposit already has an active reference.';
  end if;

  select coalesce(pg_catalog.max(submission.submission_number), 0) + 1
    into resolved_submission_number
    from app.deposit_submissions submission
   where submission.deposit_intent_id = resolved_intent.id;

  begin
    insert into app.deposit_submissions (
      deposit_intent_id,
      submission_number,
      submitted_reference_ciphertext,
      submitted_reference_fingerprint,
      submitted_reference_masked,
      reference_encryption_key_version,
      status,
      origin_inbound_event_id,
      submitted_at
    )
    values (
      resolved_intent.id,
      resolved_submission_number,
      p_reference_ciphertext,
      p_reference_fingerprint,
      p_reference_masked,
      p_reference_key_version,
      'received',
      p_origin_inbound_event_id,
      pg_catalog.clock_timestamp()
    )
    returning * into resolved_submission;

    insert into app.deposit_jobs (
      deposit_intent_id,
      deposit_submission_id,
      job_kind,
      job_key,
      max_attempts
    )
    values (
      resolved_intent.id,
      resolved_submission.id,
      'verify_deposit',
      'cbe-birr-authoritative-verification:v1:' || resolved_submission.id::text,
      8
    )
    returning id into verification_job_id;
  exception
    when unique_violation then
      raise exception 'The live deposit reference is already awaiting verification.';
  end;

  if verification_job_id is null then
    raise exception 'The authoritative verification command was not created.';
  end if;

  update app.deposit_submissions submission
     set status = 'verification_enqueued'
   where submission.id = resolved_submission.id
     and submission.status = 'received'
  returning * into resolved_submission;

  if not found then
    raise exception 'The live deposit submission was not enqueued.';
  end if;

  update app.deposit_intents deposit_intent
     set status = 'verification_pending'
   where deposit_intent.id = resolved_intent.id
     and deposit_intent.status = 'intake_received';

  if not found then
    raise exception 'The live deposit did not enter verification.';
  end if;

  insert into app.telegram_live_deposit_request_receipts (
    origin_inbound_event_id,
    customer_identity_id,
    customer_id,
    conversation_id,
    request_kind,
    semantic_input_hmac,
    deposit_intent_id,
    deposit_submission_id,
    reference_fingerprint,
    reference_masked,
    reference_key_version,
    conversation_version
  )
  values (
    p_origin_inbound_event_id,
    resolved_identity_id,
    resolved_customer_id,
    resolved_conversation_id,
    'capture_reference',
    p_semantic_input_hmac,
    resolved_intent.id,
    resolved_submission.id,
    p_reference_fingerprint,
    p_reference_masked,
    p_reference_key_version,
    resolved_conversation_version
  );

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
    'deposit.live_reference_enqueued',
    'deposit_intent',
    resolved_intent.id,
    pg_catalog.jsonb_build_object(
      'channel', 'telegram',
      'provider_code', 'cbe_birr',
      'verification_source', 'cbe_birr_authoritative',
      'financial_mode', 'live',
      'reference_encryption_key_version', p_reference_key_version
    )
  );

  return query
  select resolved_intent.id,
         'verification_enqueued'::text,
         'verification_pending'::text,
         resolved_submission.submitted_at,
         false;
end;
$$;

create function app.open_customer_web_deposit_intent(
  p_actor_auth_user_id uuid,
  p_request_key uuid,
  p_player_id text,
  p_expected_amount_minor bigint
)
returns table (
  deposit_intent_id uuid,
  provider_code text,
  receiver_account_holder_name text,
  receiver_account_masked text,
  receiver_customer_instruction text,
  expected_amount_minor bigint,
  currency_code text,
  payment_deadline_at timestamptz,
  deposit_status text,
  request_key_already_used boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  normalized_player_id text;
  resolved_boundary record;
  resolved_customer_id uuid;
  resolved_customer_identity_id uuid;
  resolved_customer_status app.record_status;
  resolved_identity_status app.record_status;
  resolved_instruction text;
  resolved_intent app.deposit_intents%rowtype;
  resolved_receipt app.customer_web_deposit_request_receipts%rowtype;
begin
  normalized_player_id := pg_catalog.btrim(p_player_id);

  if p_actor_auth_user_id is null
    or p_request_key is null
    or p_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_player_id is null
    or normalized_player_id is null
    or pg_catalog.char_length(normalized_player_id) not between 1 and 64
    or normalized_player_id ~ '[[:space:][:cntrl:]]'
    or p_expected_amount_minor is null
    or p_expected_amount_minor <= 0 then
    raise exception 'The customer-web live deposit request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:customer-auth:v1:' || p_actor_auth_user_id::text,
      0::bigint
    )
  );

  select customer_auth_identity.customer_identity_id,
         customer_auth_identity.customer_id,
         customer_identity.status,
         customer.status
    into resolved_customer_identity_id,
         resolved_customer_id,
         resolved_identity_status,
         resolved_customer_status
    from app.customer_auth_identities customer_auth_identity
    join app.customer_identities customer_identity
      on customer_identity.id = customer_auth_identity.customer_identity_id
     and customer_identity.customer_id = customer_auth_identity.customer_id
    join app.customers customer
      on customer.id = customer_auth_identity.customer_id
   where customer_auth_identity.auth_user_id = p_actor_auth_user_id
     and customer_identity.identity_kind = 'supabase_auth'
     and customer_identity.external_subject = p_actor_auth_user_id::text
   for update of customer_auth_identity, customer_identity, customer;

  if not found then
    raise exception 'The customer-web live deposit request is unavailable.';
  end if;

  select receipt.*
    into resolved_receipt
    from app.customer_web_deposit_request_receipts receipt
   where receipt.customer_auth_identity_id = resolved_customer_identity_id
     and receipt.request_key = p_request_key;

  if found then
    if resolved_receipt.request_kind <> 'open_intent'
      or resolved_receipt.player_id is distinct from normalized_player_id
      or resolved_receipt.expected_amount_minor is distinct from p_expected_amount_minor then
      raise exception 'The replayed customer-web live deposit request conflicts with its receipt.';
    end if;

    select deposit_intent.*
      into resolved_intent
      from app.deposit_intents deposit_intent
      join app.customer_platform_players player_account
        on player_account.id = deposit_intent.player_account_id
      join app.payment_providers payment_provider
        on payment_provider.id = deposit_intent.payment_provider_id
     where deposit_intent.id = resolved_receipt.deposit_intent_id
       and deposit_intent.customer_id = resolved_customer_id
       and deposit_intent.expected_amount_minor = p_expected_amount_minor
       and player_account.player_id = normalized_player_id
       and payment_provider.code = 'cbe_birr'
       and deposit_intent.status = 'intake_received'
       and deposit_intent.payment_deadline_at > pg_catalog.statement_timestamp()
     for update of deposit_intent;

    if not found then
      raise exception 'The replayed customer-web live deposit request requires remediation.';
    end if;

    resolved_instruction := resolved_intent.receiver_instructions_snapshot ->> 'customer_message';
    return query
    select resolved_intent.id,
           'cbe_birr'::text,
           resolved_intent.receiver_account_holder_name_snapshot,
           resolved_intent.receiver_account_masked_snapshot,
           resolved_instruction,
           resolved_intent.expected_amount_minor,
           resolved_intent.currency_code::text,
           resolved_intent.payment_deadline_at,
           'intake_received'::text,
           true;
    return;
  end if;

  if resolved_identity_status <> 'active'
    or resolved_customer_status <> 'active'
    or exists (
      select 1
        from app.admin_users admin_user
       where admin_user.auth_user_id = p_actor_auth_user_id
         and admin_user.status = 'active'
    ) then
    raise exception 'The customer-web live deposit request is unavailable.';
  end if;

  perform app.require_live_customer_deposit_switches();

  select boundary.*
    into resolved_boundary
    from app.resolve_current_live_customer_deposit_boundary(
      resolved_customer_id,
      normalized_player_id,
      p_expected_amount_minor
    ) boundary;

  if not found then
    raise exception 'The customer-web live deposit boundary is unavailable.';
  end if;

  insert into app.deposit_intents (
    customer_id,
    platform_id,
    player_account_id,
    payment_provider_id,
    receiver_account_id,
    expected_amount_minor
  )
  values (
    resolved_customer_id,
    resolved_boundary.platform_id,
    resolved_boundary.player_account_id,
    resolved_boundary.payment_provider_id,
    resolved_boundary.receiver_account_id,
    p_expected_amount_minor
  )
  returning * into resolved_intent;

  if resolved_intent.player_deposit_eligibility_decision_id
       is distinct from resolved_boundary.eligibility_decision_id
    or resolved_intent.receiver_account_version
       is distinct from resolved_boundary.receiver_account_version
    or resolved_intent.receiver_account_holder_name_snapshot
       is distinct from resolved_boundary.receiver_account_holder_name
    or resolved_intent.receiver_account_masked_snapshot
       is distinct from resolved_boundary.receiver_account_masked
    or resolved_intent.receiver_instructions_snapshot
       is distinct from resolved_boundary.receiver_instructions
    or resolved_intent.deposit_policy_version_id
       is distinct from resolved_boundary.deposit_policy_version_id
    or resolved_intent.deposit_policy_version
       is distinct from resolved_boundary.deposit_policy_version
    or resolved_intent.minimum_amount_minor
       is distinct from resolved_boundary.minimum_amount_minor
    or resolved_intent.maximum_amount_minor
       is distinct from resolved_boundary.maximum_amount_minor
    or resolved_intent.freshness_window_seconds
       is distinct from resolved_boundary.freshness_window_seconds
    or resolved_intent.status <> 'intake_received' then
    raise exception 'The customer-web live deposit snapshot is inconsistent.';
  end if;

  insert into app.customer_web_deposit_request_receipts (
    customer_auth_identity_id,
    request_key,
    request_kind,
    deposit_intent_id,
    player_id,
    expected_amount_minor
  )
  values (
    resolved_customer_identity_id,
    p_request_key,
    'open_intent',
    resolved_intent.id,
    normalized_player_id,
    p_expected_amount_minor
  );

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
    'deposit.live_intent_opened',
    'deposit_intent',
    resolved_intent.id,
    pg_catalog.jsonb_build_object(
      'channel', 'customer_web',
      'provider_code', 'cbe_birr',
      'platform_code', 'kemerbet',
      'verification_source', 'cbe_birr_authoritative',
      'financial_mode', 'live'
    )
  );

  resolved_instruction := resolved_intent.receiver_instructions_snapshot ->> 'customer_message';
  return query
  select resolved_intent.id,
         'cbe_birr'::text,
         resolved_intent.receiver_account_holder_name_snapshot,
         resolved_intent.receiver_account_masked_snapshot,
         resolved_instruction,
         resolved_intent.expected_amount_minor,
         resolved_intent.currency_code::text,
         resolved_intent.payment_deadline_at,
         resolved_intent.status::text,
         false;
end;
$$;

alter table app.telegram_live_deposit_request_receipts
  enable row level security;
alter table app.telegram_live_deposit_request_receipts
  force row level security;
alter table app.customer_web_deposit_request_receipts
  enable row level security;
alter table app.customer_web_deposit_request_receipts
  force row level security;

alter table app.telegram_live_deposit_request_receipts owner to postgres;
alter table app.customer_web_deposit_request_receipts owner to postgres;

alter function app.reject_live_deposit_request_receipt_mutation()
  owner to postgres;
alter function app.enforce_telegram_live_deposit_receipt_binding()
  owner to postgres;
alter function app.block_inbound_consumption_after_live_deposit_receipt()
  owner to postgres;
alter function app.require_live_deposit_request_receipt_result()
  owner to postgres;
alter function app.require_live_customer_deposit_switches()
  owner to postgres;
alter function app.resolve_current_live_customer_deposit_boundary(uuid, text, bigint)
  owner to postgres;
alter function app.open_telegram_live_deposit_intent(uuid, text, bigint, text)
  owner to postgres;
alter function app.capture_telegram_live_deposit_reference(
  uuid, uuid, text, text, text, smallint, text
) owner to postgres;
alter function app.get_telegram_customer_deposit(uuid, uuid)
  owner to postgres;
alter function app.open_customer_web_deposit_intent(uuid, uuid, text, bigint)
  owner to postgres;
alter function app.capture_customer_web_deposit_reference(
  uuid, uuid, uuid, text, text, text, smallint
) owner to postgres;
alter function app.list_customer_web_deposits(uuid, integer)
  owner to postgres;

revoke all privileges on table
  app.telegram_live_deposit_request_receipts,
  app.customer_web_deposit_request_receipts
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

revoke all on function
  app.reject_live_deposit_request_receipt_mutation(),
  app.enforce_telegram_live_deposit_receipt_binding(),
  app.block_inbound_consumption_after_live_deposit_receipt(),
  app.require_live_deposit_request_receipt_result(),
  app.require_live_customer_deposit_switches(),
  app.resolve_current_live_customer_deposit_boundary(uuid, text, bigint),
  app.open_telegram_live_deposit_intent(uuid, text, bigint, text),
  app.capture_telegram_live_deposit_reference(uuid, uuid, text, text, text, smallint, text),
  app.get_telegram_customer_deposit(uuid, uuid),
  app.open_customer_web_deposit_intent(uuid, uuid, text, bigint),
  app.capture_customer_web_deposit_reference(uuid, uuid, uuid, text, text, text, smallint),
  app.list_customer_web_deposits(uuid, integer)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

grant execute on function
  app.open_telegram_live_deposit_intent(uuid, text, bigint, text),
  app.capture_telegram_live_deposit_reference(uuid, uuid, text, text, text, smallint, text),
  app.get_telegram_customer_deposit(uuid, uuid)
to fetanagent_player_actions;

grant execute on function
  app.open_customer_web_deposit_intent(uuid, uuid, text, bigint),
  app.capture_customer_web_deposit_reference(uuid, uuid, uuid, text, text, text, smallint),
  app.list_customer_web_deposits(uuid, integer)
to fetanagent_customer_web;

comment on table app.telegram_live_deposit_request_receipts is
  'Private append-only semantic-HMAC receipts for production Telegram deposit intake. One admitted inbound event can produce exactly one live result and no other Telegram consumption.';
comment on table app.customer_web_deposit_request_receipts is
  'Private append-only UUIDv4 receipts for production customer-web deposit intake. Keys are scoped to one immutable Auth identity and mismatched reuse fails closed.';
comment on function app.open_telegram_live_deposit_intent(uuid, text, bigint, text) is
  'Default-off Telegram live CBE Birr intent opening. Exact semantic replay returns the existing owned intent; no verification work is created.';
comment on function app.capture_telegram_live_deposit_reference(uuid, uuid, text, text, text, smallint, text) is
  'Default-off Telegram live reference capture. Atomically creates one protected submission and one production authoritative verification job, then enters verification_pending.';
comment on function app.get_telegram_customer_deposit(uuid, uuid) is
  'Read-only switch-independent status lookup derived from an admitted private Telegram inbound event. Returns at most one exact actor-owned intent.';
comment on function app.open_customer_web_deposit_intent(uuid, uuid, text, bigint) is
  'Default-off customer-web live CBE Birr intent opening with exact UUIDv4 replay and current ownership, eligibility, receiver, and policy proof.';
comment on function app.capture_customer_web_deposit_reference(uuid, uuid, uuid, text, text, text, smallint) is
  'Default-off customer-web live reference capture. Atomically creates one protected submission and one production authoritative verification job, then enters verification_pending.';
comment on function app.list_customer_web_deposits(uuid, integer) is
  'Read-only switch-independent bounded list of the exact active Auth actor customer''s owned deposit intents with no protected reference or job identifiers.';

commit;
