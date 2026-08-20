-- Private amount-free proof-first intake for provider receipt dry runs.
--
-- This migration deliberately stops before payment verification. It records only an untrusted,
-- protected candidate reference and an eligible KemerBet destination while every financial switch
-- is locked in disabled mode. It creates no deposit intent, evidence, claim, verification job,
-- settlement, execution command, receiver snapshot, or trusted amount.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

insert into app.feature_switches (feature_key, mode, settings)
values ('telebirr_authoritative_verification', 'disabled', '{}'::jsonb);

alter table app.customer_platform_players
  add constraint customer_platform_players_id_platform_key
  unique (id, platform_id);

alter table app.payment_providers
  add constraint payment_providers_id_code_key
  unique (id, code);

create table app.deposit_proof_requests (
  id uuid primary key default gen_random_uuid(),
  submitting_customer_id uuid not null
    references app.customers (id) on delete restrict,
  origin_channel text not null
    check (origin_channel in ('telegram', 'customer_web')),
  platform_id uuid not null
    references app.platforms (id) on delete restrict,
  player_account_id uuid not null
    references app.customer_platform_players (id) on delete restrict,
  player_deposit_eligibility_decision_id uuid not null,
  payment_provider_id uuid not null,
  provider_code text not null
    check (provider_code in ('cbe_birr', 'telebirr')),
  input_kind text not null default 'direct_transaction_id'
    check (input_kind = 'direct_transaction_id'),
  candidate_reference_ciphertext text not null,
  candidate_reference_fingerprint text not null
    check (candidate_reference_fingerprint ~ '^[0-9a-f]{64}$'),
  candidate_reference_masked text not null
    check (
      candidate_reference_masked = pg_catalog.btrim(candidate_reference_masked)
      and candidate_reference_masked ~ '^\*{3}[A-Z0-9]{4}$'
    ),
  reference_encryption_key_version smallint not null
    check (reference_encryption_key_version = 2),
  reference_profile_version smallint not null
    check (reference_profile_version = 2),
  status text not null default 'proof_received'
    check (status = 'proof_received'),
  submitted_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint deposit_proof_requests_candidate_ciphertext_shape check (
    candidate_reference_ciphertext = pg_catalog.btrim(candidate_reference_ciphertext)
    and pg_catalog.char_length(candidate_reference_ciphertext) between 50 and 512
    and candidate_reference_ciphertext
      ~ '^v2\.(cbe_birr|telebirr)\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11,43}$'
    and pg_catalog.split_part(candidate_reference_ciphertext, '.', 1)
      = 'v2'
    and pg_catalog.split_part(candidate_reference_ciphertext, '.', 2)
      = provider_code
  ),
  constraint deposit_proof_requests_provider_fkey
    foreign key (payment_provider_id, provider_code)
    references app.payment_providers (id, code)
    on delete restrict,
  constraint deposit_proof_requests_eligibility_decision_fkey
    foreign key (player_deposit_eligibility_decision_id, player_account_id)
    references app.player_deposit_eligibility_decisions (id, player_account_id)
    on delete restrict,
  constraint deposit_proof_requests_player_platform_fkey
    foreign key (player_account_id, platform_id)
    references app.customer_platform_players (id, platform_id)
    on delete restrict,
  constraint deposit_proof_requests_id_customer_key
    unique (id, submitting_customer_id),
  constraint deposit_proof_requests_customer_provider_fingerprint_key
    unique (
      submitting_customer_id,
      payment_provider_id,
      candidate_reference_fingerprint
    )
);

create index deposit_proof_requests_customer_submitted_idx
  on app.deposit_proof_requests (submitting_customer_id, submitted_at desc, id);

create index deposit_proof_requests_player_submitted_idx
  on app.deposit_proof_requests (player_account_id, submitted_at desc, id);

create table app.telegram_dry_run_deposit_proof_receipts (
  origin_inbound_event_id uuid primary key
    references app.inbound_events (id) on delete restrict,
  customer_identity_id uuid not null,
  submitting_customer_id uuid not null,
  conversation_id uuid not null
    references app.bot_conversations (id) on delete restrict,
  deposit_proof_request_id uuid not null,
  semantic_input_hmac text not null check (
    semantic_input_hmac = pg_catalog.lower(pg_catalog.btrim(semantic_input_hmac))
    and semantic_input_hmac ~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$'
  ),
  conversation_version bigint not null check (conversation_version >= 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint telegram_dry_run_proof_receipts_identity_customer_fkey
    foreign key (customer_identity_id, submitting_customer_id)
    references app.customer_identities (id, customer_id) on delete restrict,
  constraint telegram_dry_run_proof_receipts_proof_customer_fkey
    foreign key (deposit_proof_request_id, submitting_customer_id)
    references app.deposit_proof_requests (id, submitting_customer_id) on delete restrict
);

create index telegram_dry_run_deposit_proof_receipts_proof_idx
  on app.telegram_dry_run_deposit_proof_receipts (deposit_proof_request_id);

create table app.customer_web_dry_run_deposit_proof_receipts (
  customer_auth_identity_id uuid not null
    references app.customer_auth_identities (customer_identity_id) on delete restrict,
  submitting_customer_id uuid not null,
  request_key uuid not null,
  deposit_proof_request_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint customer_web_dry_run_proof_receipts_pkey
    primary key (customer_auth_identity_id, request_key),
  constraint customer_web_dry_run_proof_receipts_uuid_v4_check check (
    request_key::text ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint customer_web_dry_run_proof_receipts_identity_customer_fkey
    foreign key (customer_auth_identity_id, submitting_customer_id)
    references app.customer_identities (id, customer_id) on delete restrict,
  constraint customer_web_dry_run_proof_receipts_proof_customer_fkey
    foreign key (deposit_proof_request_id, submitting_customer_id)
    references app.deposit_proof_requests (id, submitting_customer_id) on delete restrict
);

create index customer_web_dry_run_deposit_proof_receipts_proof_idx
  on app.customer_web_dry_run_deposit_proof_receipts (deposit_proof_request_id);

create function app.reject_dry_run_deposit_proof_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
begin
  raise exception 'Dry-run deposit proof records are append-only.';
end;
$$;

create trigger deposit_proof_requests_immutable
before update or delete on app.deposit_proof_requests
for each row
execute function app.reject_dry_run_deposit_proof_mutation();

create trigger deposit_proof_requests_no_truncate
before truncate on app.deposit_proof_requests
for each statement
execute function app.reject_dry_run_deposit_proof_mutation();

create trigger telegram_dry_run_deposit_proof_receipts_immutable
before update or delete on app.telegram_dry_run_deposit_proof_receipts
for each row
execute function app.reject_dry_run_deposit_proof_mutation();

create trigger telegram_dry_run_deposit_proof_receipts_no_truncate
before truncate on app.telegram_dry_run_deposit_proof_receipts
for each statement
execute function app.reject_dry_run_deposit_proof_mutation();

create trigger customer_web_dry_run_deposit_proof_receipts_immutable
before update or delete on app.customer_web_dry_run_deposit_proof_receipts
for each row
execute function app.reject_dry_run_deposit_proof_mutation();

create trigger customer_web_dry_run_deposit_proof_receipts_no_truncate
before truncate on app.customer_web_dry_run_deposit_proof_receipts
for each statement
execute function app.reject_dry_run_deposit_proof_mutation();

create function app.require_dry_run_deposit_proof_switches_disabled()
returns void
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  disabled_switch_count integer;
  financial_switch_count integer;
begin
  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;

  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (where feature_switch.mode = 'disabled')::integer
    into financial_switch_count,
         disabled_switch_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'telebirr_authoritative_verification'
   );

  if financial_switch_count <> 4 or disabled_switch_count <> 4 then
    raise exception 'Dry-run deposit proof intake requires every financial switch disabled.';
  end if;
end;
$$;

create function app.resolve_dry_run_deposit_proof_boundary(
  p_player_id text,
  p_provider_code text
)
returns table (
  platform_id uuid,
  player_account_id uuid,
  player_deposit_eligibility_decision_id uuid,
  payment_provider_id uuid,
  normalized_provider_code text
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  decision_count integer;
  latest_decision app.player_deposit_eligibility_decisions%rowtype;
  locked_platform_id uuid;
  locked_player_id uuid;
  locked_player_updated_at timestamptz;
  maximum_decision_version integer;
  resolved_provider app.payment_providers%rowtype;
begin
  if p_player_id is null
    or p_player_id <> pg_catalog.btrim(p_player_id)
    or pg_catalog.char_length(p_player_id) not between 1 and 64
    or p_player_id ~ '[[:space:][:cntrl:]]'
    or p_provider_code is null
    or p_provider_code <> pg_catalog.lower(pg_catalog.btrim(p_provider_code))
    or p_provider_code not in ('cbe_birr', 'telebirr') then
    raise exception 'The dry-run deposit proof destination is invalid.';
  end if;

  select player_account.id,
         player_account.updated_at,
         platform.id
    into locked_player_id,
         locked_player_updated_at,
         locked_platform_id
    from app.customer_platform_players player_account
    join app.platforms platform
      on platform.id = player_account.platform_id
   where platform.code = 'kemerbet'
     and platform.status = 'active'
     and player_account.player_id = p_player_id
     and player_account.status = 'active'
     and player_account.validation_status = 'valid'
   for update of player_account, platform;

  if not found then
    raise exception 'The dry-run deposit proof destination is unavailable.';
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.coalesce(pg_catalog.max(decision.decision_version), 0)
    into decision_count,
         maximum_decision_version
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = locked_player_id;

  select decision.*
    into latest_decision
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = locked_player_id
   order by decision.decision_version desc
   limit 1
   for key share;

  if decision_count = 0
    or decision_count <> maximum_decision_version
    or latest_decision.decision_version <> maximum_decision_version
    or latest_decision.decision <> 'eligible'
    or latest_decision.reason_code <> 'financial_eligibility_approved'
    or latest_decision.player_account_updated_at_snapshot
       is distinct from locked_player_updated_at
    or latest_decision.decided_at > pg_catalog.clock_timestamp() then
    raise exception 'The dry-run deposit proof destination is not currently eligible.';
  end if;

  select payment_provider.*
    into resolved_provider
    from app.payment_providers payment_provider
   where payment_provider.code = p_provider_code
     and payment_provider.status = 'active'
   for key share;

  if not found then
    raise exception 'The dry-run deposit proof provider is unavailable.';
  end if;

  return query
  select locked_platform_id,
         locked_player_id,
         latest_decision.id,
         resolved_provider.id,
         resolved_provider.code;
end;
$$;

create function app.create_or_reuse_dry_run_deposit_proof(
  p_submitting_customer_id uuid,
  p_origin_channel text,
  p_player_id text,
  p_provider_code text,
  p_reference_ciphertext text,
  p_reference_fingerprint text,
  p_reference_masked text,
  p_reference_key_version smallint,
  p_reference_profile_version smallint
)
returns table (
  deposit_proof_request_id uuid,
  provider_code text,
  proof_status text,
  submitted_at timestamptz,
  request_replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  existing_proof app.deposit_proof_requests%rowtype;
  inserted_proof app.deposit_proof_requests%rowtype;
  resolved_boundary record;
begin
  if p_submitting_customer_id is null
    or p_origin_channel is null
    or p_origin_channel not in ('telegram', 'customer_web')
    or p_reference_key_version is null
    or p_reference_key_version <> 2
    or p_reference_profile_version is null
    or p_reference_profile_version <> 2
    or p_reference_ciphertext is null
    or p_reference_ciphertext <> pg_catalog.btrim(p_reference_ciphertext)
    or pg_catalog.char_length(p_reference_ciphertext) not between 50 and 512
    or p_reference_ciphertext
       !~ '^v2\.(cbe_birr|telebirr)\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11,43}$'
    or pg_catalog.split_part(p_reference_ciphertext, '.', 1)
       <> 'v2'
    or pg_catalog.split_part(p_reference_ciphertext, '.', 2)
       <> p_provider_code
    or p_reference_fingerprint is null
    or p_reference_fingerprint <> pg_catalog.lower(p_reference_fingerprint)
    or p_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or p_reference_masked is null
    or p_reference_masked <> pg_catalog.btrim(p_reference_masked)
    or p_reference_masked !~ '^\*{3}[A-Z0-9]{4}$' then
    raise exception 'The protected dry-run deposit proof is invalid.';
  end if;

  perform 1
    from app.customers customer
   where customer.id = p_submitting_customer_id
     and customer.status = 'active'
   for update;

  if not found then
    raise exception 'The dry-run deposit proof customer is unavailable.';
  end if;

  perform app.require_dry_run_deposit_proof_switches_disabled();

  select boundary.*
    into resolved_boundary
    from app.resolve_dry_run_deposit_proof_boundary(
      p_player_id,
      p_provider_code
    ) boundary;

  if not found then
    raise exception 'The dry-run deposit proof boundary is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:dry-run-proof:v1:'
        || p_submitting_customer_id::text || ':'
        || resolved_boundary.payment_provider_id::text || ':'
        || p_reference_fingerprint,
      0::bigint
    )
  );

  select proof_request.*
    into existing_proof
    from app.deposit_proof_requests proof_request
   where proof_request.submitting_customer_id = p_submitting_customer_id
     and proof_request.payment_provider_id = resolved_boundary.payment_provider_id
     and proof_request.candidate_reference_fingerprint = p_reference_fingerprint
   for share;

  if found then
    if existing_proof.player_account_id
         is distinct from resolved_boundary.player_account_id
      or existing_proof.platform_id is distinct from resolved_boundary.platform_id
      or existing_proof.provider_code
         is distinct from resolved_boundary.normalized_provider_code
      or existing_proof.input_kind <> 'direct_transaction_id'
      or existing_proof.candidate_reference_masked is distinct from p_reference_masked
      or existing_proof.reference_encryption_key_version
         is distinct from p_reference_key_version
      or existing_proof.reference_profile_version
         is distinct from p_reference_profile_version
      or existing_proof.status <> 'proof_received' then
      raise exception 'The protected dry-run deposit proof conflicts with an existing destination.';
    end if;

    return query
    select existing_proof.id,
           resolved_boundary.normalized_provider_code,
           existing_proof.status,
           existing_proof.submitted_at,
           true;
    return;
  end if;

  insert into app.deposit_proof_requests (
    submitting_customer_id,
    origin_channel,
    platform_id,
    player_account_id,
    player_deposit_eligibility_decision_id,
    payment_provider_id,
    provider_code,
    input_kind,
    candidate_reference_ciphertext,
    candidate_reference_fingerprint,
    candidate_reference_masked,
    reference_encryption_key_version,
    reference_profile_version,
    status
  )
  values (
    p_submitting_customer_id,
    p_origin_channel,
    resolved_boundary.platform_id,
    resolved_boundary.player_account_id,
    resolved_boundary.player_deposit_eligibility_decision_id,
    resolved_boundary.payment_provider_id,
    resolved_boundary.normalized_provider_code,
    'direct_transaction_id',
    p_reference_ciphertext,
    p_reference_fingerprint,
    p_reference_masked,
    p_reference_key_version,
    p_reference_profile_version,
    'proof_received'
  )
  returning * into inserted_proof;

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
    p_submitting_customer_id,
    'deposit.dry_run_proof_received',
    'deposit_proof_request',
    inserted_proof.id,
    pg_catalog.jsonb_build_object(
      'channel', p_origin_channel,
      'provider_code', resolved_boundary.normalized_provider_code,
      'input_kind', 'direct_transaction_id',
      'reference_profile_version', p_reference_profile_version,
      'financial_mode', 'dry_run'
    )
  );

  return query
  select inserted_proof.id,
         resolved_boundary.normalized_provider_code,
         inserted_proof.status,
         inserted_proof.submitted_at,
         false;
end;
$$;

create function app.enforce_telegram_dry_run_proof_receipt_binding()
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
    raise exception 'The Telegram dry-run deposit proof receipt is unavailable.';
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
    or new.submitting_customer_id is distinct from resolved_customer_id
    or new.conversation_id is distinct from resolved_conversation_id
    or new.conversation_version is distinct from resolved_conversation_version then
    raise exception 'The Telegram dry-run deposit proof receipt is unavailable.';
  end if;

  if exists (
    select 1
      from app.inbound_event_consumptions consumption
     where consumption.origin_inbound_event_id = new.origin_inbound_event_id
  ) or exists (
    select 1
      from app.telegram_live_deposit_request_receipts live_receipt
     where live_receipt.origin_inbound_event_id = new.origin_inbound_event_id
   ) then
    raise exception 'The Telegram event already has another result.';
  end if;

  if not exists (
    select 1
      from app.deposit_proof_requests proof_request
     where proof_request.id = new.deposit_proof_request_id
       and proof_request.submitting_customer_id = resolved_customer_id
       and proof_request.origin_channel = 'telegram'
       and proof_request.status = 'proof_received'
  ) then
    raise exception 'The Telegram dry-run deposit proof receipt has no matching proof.';
  end if;

  new.created_at := pg_catalog.clock_timestamp();

  update app.inbound_events inbound_event
     set processed_at = new.created_at,
         processing_error_code = null
   where inbound_event.id = new.origin_inbound_event_id
     and inbound_event.processed_at is null;

  if not found then
    raise exception 'The Telegram dry-run deposit proof receipt is unavailable.';
  end if;

  return new;
end;
$$;

create trigger telegram_dry_run_proof_receipts_enforce_binding
before insert on app.telegram_dry_run_deposit_proof_receipts
for each row
execute function app.enforce_telegram_dry_run_proof_receipt_binding();

create function app.require_telegram_dry_run_proof_receipt_result()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if not exists (
    select 1
      from app.inbound_events inbound_event
     where inbound_event.id = new.origin_inbound_event_id
       and inbound_event.channel = 'telegram'
       and inbound_event.customer_identity_id = new.customer_identity_id
       and inbound_event.processed_at = new.created_at
  ) then
    raise exception 'The Telegram dry-run deposit proof receipt has no matching inbound event.';
  end if;

  if not exists (
    select 1
      from app.deposit_proof_requests proof_request
     where proof_request.id = new.deposit_proof_request_id
       and proof_request.submitting_customer_id = new.submitting_customer_id
       and proof_request.origin_channel = 'telegram'
       and proof_request.status = 'proof_received'
  ) then
    raise exception 'The Telegram dry-run deposit proof receipt has no matching proof.';
  end if;

  return null;
end;
$$;

create trigger telegram_dry_run_proof_receipts_require_result
after insert on app.telegram_dry_run_deposit_proof_receipts
for each row
execute function app.require_telegram_dry_run_proof_receipt_result();

create function app.block_telegram_result_after_dry_run_proof_receipt()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
begin
  perform app.lock_telegram_inbound_event_scope(new.origin_inbound_event_id);

  if exists (
    select 1
      from app.telegram_dry_run_deposit_proof_receipts proof_receipt
     where proof_receipt.origin_inbound_event_id = new.origin_inbound_event_id
  ) then
    raise exception 'The Telegram event is already a dry-run deposit proof.';
  end if;

  return new;
end;
$$;

create trigger inbound_event_consumptions_block_dry_run_proof_reuse
before insert on app.inbound_event_consumptions
for each row
execute function app.block_telegram_result_after_dry_run_proof_receipt();

create trigger telegram_live_deposit_receipts_block_dry_run_proof_reuse
before insert on app.telegram_live_deposit_request_receipts
for each row
execute function app.block_telegram_result_after_dry_run_proof_receipt();

create function app.enforce_customer_web_dry_run_proof_receipt_exclusive()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if exists (
    select 1
      from app.customer_web_deposit_request_receipts live_receipt
     where live_receipt.customer_auth_identity_id = new.customer_auth_identity_id
       and live_receipt.request_key = new.request_key
  ) then
    raise exception 'The customer-web request key already has another result.';
  end if;

  return new;
end;
$$;

create trigger customer_web_dry_run_proof_receipts_require_exclusive_key
before insert on app.customer_web_dry_run_deposit_proof_receipts
for each row
execute function app.enforce_customer_web_dry_run_proof_receipt_exclusive();

create function app.block_customer_web_result_after_dry_run_proof_receipt()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if exists (
    select 1
      from app.customer_web_dry_run_deposit_proof_receipts proof_receipt
     where proof_receipt.customer_auth_identity_id = new.customer_auth_identity_id
       and proof_receipt.request_key = new.request_key
  ) then
    raise exception 'The customer-web request key is already a dry-run deposit proof.';
  end if;

  return new;
end;
$$;

create trigger customer_web_live_deposit_receipts_block_dry_run_proof_reuse
before insert on app.customer_web_deposit_request_receipts
for each row
execute function app.block_customer_web_result_after_dry_run_proof_receipt();

create function app.capture_telegram_dry_run_deposit_proof(
  p_origin_inbound_event_id uuid,
  p_player_id text,
  p_provider_code text,
  p_reference_ciphertext text,
  p_reference_fingerprint text,
  p_reference_masked text,
  p_reference_key_version smallint,
  p_reference_profile_version smallint,
  p_semantic_input_hmac text
)
returns table (
  deposit_proof_request_id uuid,
  provider_code text,
  proof_status text,
  submitted_at timestamptz,
  request_replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  created_or_reused record;
  resolved_conversation_id uuid;
  resolved_conversation_version bigint;
  resolved_customer_id uuid;
  resolved_customer_status app.record_status;
  resolved_identity_id uuid;
  resolved_identity_status app.record_status;
  resolved_processed_at timestamptz;
  resolved_proof app.deposit_proof_requests%rowtype;
  resolved_receipt app.telegram_dry_run_deposit_proof_receipts%rowtype;
begin
  if p_origin_inbound_event_id is null
    or p_semantic_input_hmac is null
    or p_semantic_input_hmac <> pg_catalog.lower(pg_catalog.btrim(p_semantic_input_hmac))
    or p_semantic_input_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The Telegram dry-run deposit proof request is invalid.';
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
    raise exception 'The Telegram inbound event is unavailable for dry-run deposit proof intake.';
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
    raise exception 'The Telegram customer is unavailable for dry-run deposit proof intake.';
  end if;

  perform app.require_dry_run_deposit_proof_switches_disabled();

  select receipt.*
    into resolved_receipt
    from app.telegram_dry_run_deposit_proof_receipts receipt
   where receipt.origin_inbound_event_id = p_origin_inbound_event_id;

  if found then
    select proof_request.*
      into resolved_proof
      from app.deposit_proof_requests proof_request
      join app.payment_providers payment_provider
        on payment_provider.id = proof_request.payment_provider_id
       and payment_provider.code = proof_request.provider_code
      join app.customer_platform_players player_account
        on player_account.id = proof_request.player_account_id
     where proof_request.id = resolved_receipt.deposit_proof_request_id
       and proof_request.submitting_customer_id = resolved_customer_id
       and payment_provider.code = p_provider_code
       and player_account.player_id = p_player_id;

    if not found
      or resolved_receipt.semantic_input_hmac is distinct from p_semantic_input_hmac
      or resolved_receipt.customer_identity_id is distinct from resolved_identity_id
      or resolved_receipt.submitting_customer_id is distinct from resolved_customer_id
      or resolved_receipt.conversation_id is distinct from resolved_conversation_id
      or resolved_receipt.created_at is distinct from resolved_processed_at
      or resolved_proof.origin_channel <> 'telegram'
      or resolved_proof.candidate_reference_fingerprint is distinct from p_reference_fingerprint
      or resolved_proof.candidate_reference_masked is distinct from p_reference_masked
      or resolved_proof.reference_encryption_key_version
         is distinct from p_reference_key_version
      or resolved_proof.reference_profile_version
         is distinct from p_reference_profile_version
      or resolved_proof.status <> 'proof_received' then
      raise exception 'The replayed Telegram dry-run deposit proof conflicts with its receipt.';
    end if;

    return query
    select resolved_proof.id,
           resolved_proof.provider_code,
           resolved_proof.status,
           resolved_proof.submitted_at,
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
    )
    or exists (
      select 1
        from app.telegram_live_deposit_request_receipts live_receipt
       where live_receipt.origin_inbound_event_id = p_origin_inbound_event_id
    ) then
    raise exception 'The Telegram event cannot capture a dry-run deposit proof.';
  end if;

  select proof.*
    into created_or_reused
    from app.create_or_reuse_dry_run_deposit_proof(
      resolved_customer_id,
      'telegram',
      p_player_id,
      p_provider_code,
      p_reference_ciphertext,
      p_reference_fingerprint,
      p_reference_masked,
      p_reference_key_version,
      p_reference_profile_version
    ) proof;

  insert into app.telegram_dry_run_deposit_proof_receipts (
    origin_inbound_event_id,
    customer_identity_id,
    submitting_customer_id,
    conversation_id,
    deposit_proof_request_id,
    semantic_input_hmac,
    conversation_version
  )
  values (
    p_origin_inbound_event_id,
    resolved_identity_id,
    resolved_customer_id,
    resolved_conversation_id,
    created_or_reused.deposit_proof_request_id,
    p_semantic_input_hmac,
    resolved_conversation_version
  );

  return query
  select created_or_reused.deposit_proof_request_id,
         created_or_reused.provider_code,
         created_or_reused.proof_status,
         created_or_reused.submitted_at,
         created_or_reused.request_replayed;
end;
$$;

create function app.capture_customer_web_dry_run_deposit_proof(
  p_actor_auth_user_id uuid,
  p_request_key uuid,
  p_player_id text,
  p_provider_code text,
  p_reference_ciphertext text,
  p_reference_fingerprint text,
  p_reference_masked text,
  p_reference_key_version smallint,
  p_reference_profile_version smallint
)
returns table (
  deposit_proof_request_id uuid,
  provider_code text,
  proof_status text,
  submitted_at timestamptz,
  request_replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  created_or_reused record;
  resolved_customer_id uuid;
  resolved_customer_identity_id uuid;
  resolved_customer_status app.record_status;
  resolved_identity_status app.record_status;
  resolved_proof app.deposit_proof_requests%rowtype;
  resolved_receipt app.customer_web_dry_run_deposit_proof_receipts%rowtype;
begin
  if p_actor_auth_user_id is null
    or p_request_key is null
    or p_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'The customer-web dry-run deposit proof request is invalid.';
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

  if not found
    or resolved_identity_status <> 'active'
    or resolved_customer_status <> 'active'
    or exists (
      select 1
        from app.admin_users admin_user
       where admin_user.auth_user_id = p_actor_auth_user_id
         and admin_user.status = 'active'
    ) then
    raise exception 'The customer-web dry-run deposit proof request is unavailable.';
  end if;

  perform app.require_dry_run_deposit_proof_switches_disabled();

  select receipt.*
    into resolved_receipt
    from app.customer_web_dry_run_deposit_proof_receipts receipt
   where receipt.customer_auth_identity_id = resolved_customer_identity_id
     and receipt.request_key = p_request_key;

  if found then
    select proof_request.*
      into resolved_proof
      from app.deposit_proof_requests proof_request
      join app.payment_providers payment_provider
        on payment_provider.id = proof_request.payment_provider_id
       and payment_provider.code = proof_request.provider_code
      join app.customer_platform_players player_account
        on player_account.id = proof_request.player_account_id
     where proof_request.id = resolved_receipt.deposit_proof_request_id
       and proof_request.submitting_customer_id = resolved_customer_id
       and payment_provider.code = p_provider_code
       and player_account.player_id = p_player_id;

    if not found
      or resolved_receipt.submitting_customer_id is distinct from resolved_customer_id
      or resolved_proof.candidate_reference_fingerprint is distinct from p_reference_fingerprint
      or resolved_proof.candidate_reference_masked is distinct from p_reference_masked
      or resolved_proof.reference_encryption_key_version
         is distinct from p_reference_key_version
      or resolved_proof.reference_profile_version
         is distinct from p_reference_profile_version
      or resolved_proof.status <> 'proof_received' then
      raise exception 'The replayed customer-web dry-run deposit proof conflicts with its receipt.';
    end if;

    return query
    select resolved_proof.id,
           resolved_proof.provider_code,
           resolved_proof.status,
           resolved_proof.submitted_at,
           true;
    return;
  end if;

  if exists (
    select 1
      from app.customer_web_deposit_request_receipts live_receipt
     where live_receipt.customer_auth_identity_id = resolved_customer_identity_id
       and live_receipt.request_key = p_request_key
  ) then
    raise exception 'The customer-web request key already has another result.';
  end if;

  select proof.*
    into created_or_reused
    from app.create_or_reuse_dry_run_deposit_proof(
      resolved_customer_id,
      'customer_web',
      p_player_id,
      p_provider_code,
      p_reference_ciphertext,
      p_reference_fingerprint,
      p_reference_masked,
      p_reference_key_version,
      p_reference_profile_version
    ) proof;

  insert into app.customer_web_dry_run_deposit_proof_receipts (
    customer_auth_identity_id,
    submitting_customer_id,
    request_key,
    deposit_proof_request_id
  )
  values (
    resolved_customer_identity_id,
    resolved_customer_id,
    p_request_key,
    created_or_reused.deposit_proof_request_id
  );

  return query
  select created_or_reused.deposit_proof_request_id,
         created_or_reused.provider_code,
         created_or_reused.proof_status,
         created_or_reused.submitted_at,
         created_or_reused.request_replayed;
end;
$$;

alter table app.deposit_proof_requests enable row level security;
alter table app.deposit_proof_requests force row level security;
alter table app.telegram_dry_run_deposit_proof_receipts enable row level security;
alter table app.telegram_dry_run_deposit_proof_receipts force row level security;
alter table app.customer_web_dry_run_deposit_proof_receipts enable row level security;
alter table app.customer_web_dry_run_deposit_proof_receipts force row level security;

alter table app.deposit_proof_requests owner to postgres;
alter table app.telegram_dry_run_deposit_proof_receipts owner to postgres;
alter table app.customer_web_dry_run_deposit_proof_receipts owner to postgres;

alter function app.reject_dry_run_deposit_proof_mutation() owner to postgres;
alter function app.require_dry_run_deposit_proof_switches_disabled() owner to postgres;
alter function app.resolve_dry_run_deposit_proof_boundary(text, text) owner to postgres;
alter function app.create_or_reuse_dry_run_deposit_proof(
  uuid, text, text, text, text, text, text, smallint, smallint
) owner to postgres;
alter function app.enforce_telegram_dry_run_proof_receipt_binding() owner to postgres;
alter function app.require_telegram_dry_run_proof_receipt_result() owner to postgres;
alter function app.block_telegram_result_after_dry_run_proof_receipt() owner to postgres;
alter function app.enforce_customer_web_dry_run_proof_receipt_exclusive() owner to postgres;
alter function app.block_customer_web_result_after_dry_run_proof_receipt() owner to postgres;
alter function app.capture_telegram_dry_run_deposit_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) owner to postgres;
alter function app.capture_customer_web_dry_run_deposit_proof(
  uuid, uuid, text, text, text, text, text, smallint, smallint
) owner to postgres;

revoke all privileges on table
  app.deposit_proof_requests,
  app.telegram_dry_run_deposit_proof_receipts,
  app.customer_web_dry_run_deposit_proof_receipts
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
  app.reject_dry_run_deposit_proof_mutation(),
  app.require_dry_run_deposit_proof_switches_disabled(),
  app.resolve_dry_run_deposit_proof_boundary(text, text),
  app.create_or_reuse_dry_run_deposit_proof(
    uuid, text, text, text, text, text, text, smallint, smallint
  ),
  app.enforce_telegram_dry_run_proof_receipt_binding(),
  app.require_telegram_dry_run_proof_receipt_result(),
  app.block_telegram_result_after_dry_run_proof_receipt(),
  app.enforce_customer_web_dry_run_proof_receipt_exclusive(),
  app.block_customer_web_result_after_dry_run_proof_receipt(),
  app.capture_telegram_dry_run_deposit_proof(
    uuid, text, text, text, text, text, smallint, smallint, text
  ),
  app.capture_customer_web_dry_run_deposit_proof(
    uuid, uuid, text, text, text, text, text, smallint, smallint
  )
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

grant usage on schema app to fetanagent_player_actions, fetanagent_customer_web;

grant execute on function app.capture_telegram_dry_run_deposit_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) to fetanagent_player_actions;

grant execute on function app.capture_customer_web_dry_run_deposit_proof(
  uuid, uuid, text, text, text, text, text, smallint, smallint
) to fetanagent_customer_web;

comment on table app.deposit_proof_requests is
  'Private append-only amount-free dry-run candidate proofs. Rows are unverified, customer-scoped, provider-separated, and cannot create a financial claim.';
comment on table app.telegram_dry_run_deposit_proof_receipts is
  'Private append-only Telegram semantic replay receipts for amount-free dry-run deposit proofs.';
comment on table app.customer_web_dry_run_deposit_proof_receipts is
  'Private append-only customer-web UUIDv4 replay receipts for amount-free dry-run deposit proofs.';
comment on function app.capture_telegram_dry_run_deposit_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) is
  'Atomically consumes one Telegram inbound event and captures its untrusted protected candidate for an eligible global KemerBet Player ID only while all financial switches are disabled. Creates no financial state.';
comment on function app.capture_customer_web_dry_run_deposit_proof(
  uuid, uuid, text, text, text, text, text, smallint, smallint
) is
  'Captures one untrusted protected customer-web candidate for an eligible global KemerBet Player ID only while all financial switches are disabled. Creates no financial state.';

commit;
