-- Professional Telegram TeleBirr destination presentation.
-- Staging migration ledger version: 20260912180633.
--
-- This slice lets an admitted private Telegram customer select one currently eligible KemerBet
-- Player ID and receive the active receiver name and mask. The full protected wallet envelope is
-- returned to the trusted API only under the repository's existing trusted TeleBirr activation
-- epoch. Applying this migration while an epoch is active is rejected, so the migration cannot
-- invite a payment, verify money, settle a deposit, credit KemerBet, or enable execution.

begin;

do $telegram_telebirr_destination_preflight$
begin
  if app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception
      'Telegram TeleBirr customer destination migration requires inactive financial authority.';
  end if;
end;
$telegram_telebirr_destination_preflight$;

create table app.telegram_telebirr_destination_receipts (
  origin_inbound_event_id uuid primary key
    references app.inbound_events (id) on delete restrict,
  customer_identity_id uuid not null
    references app.customer_identities (id) on delete restrict,
  customer_id uuid not null
    references app.customers (id) on delete restrict,
  conversation_id uuid not null
    references app.bot_conversations (id) on delete restrict,
  player_account_id uuid not null
    references app.customer_platform_players (id) on delete restrict,
  receiver_account_id uuid not null
    references app.receiver_accounts (id) on delete restrict,
  activation_epoch bigint
    references app.private_trusted_telebirr_activation_epochs (epoch) on delete restrict,
  semantic_input_hmac text not null
    check (semantic_input_hmac ~ '^hmac-sha256-v1:[0-9a-f]{64}$'),
  created_at timestamptz not null,
  payment_presentation_expires_at timestamptz not null,
  constraint telegram_telebirr_destination_receipts_expiry_shape check (
    payment_presentation_expires_at = created_at + interval '10 minutes'
  ),
  constraint telegram_telebirr_destination_receipts_activation_shape check (
    activation_epoch is null or activation_epoch > 0
  )
);

create index telegram_telebirr_destination_receipts_identity_idx
  on app.telegram_telebirr_destination_receipts (customer_identity_id);
create index telegram_telebirr_destination_receipts_customer_idx
  on app.telegram_telebirr_destination_receipts (customer_id);
create index telegram_telebirr_destination_receipts_conversation_idx
  on app.telegram_telebirr_destination_receipts (conversation_id);
create index telegram_telebirr_destination_receipts_player_idx
  on app.telegram_telebirr_destination_receipts (player_account_id);
create index telegram_telebirr_destination_receipts_receiver_idx
  on app.telegram_telebirr_destination_receipts (receiver_account_id);
create index telegram_telebirr_destination_receipts_activation_idx
  on app.telegram_telebirr_destination_receipts (activation_epoch)
  where activation_epoch is not null;

create function app.reject_telegram_telebirr_destination_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Telegram TeleBirr destination receipts are immutable.';
end;
$$;

create trigger telegram_telebirr_destination_receipts_immutable
before update or delete on app.telegram_telebirr_destination_receipts
for each row execute function app.reject_telegram_telebirr_destination_receipt_mutation();

create trigger telegram_telebirr_destination_receipts_no_truncate
before truncate on app.telegram_telebirr_destination_receipts
for each statement execute function app.reject_telegram_telebirr_destination_receipt_mutation();

alter table app.telegram_telebirr_destination_receipts enable row level security;
alter table app.telegram_telebirr_destination_receipts force row level security;

create function app.prepare_telegram_telebirr_destination(
  p_origin_inbound_event_id uuid,
  p_player_id text,
  p_semantic_input_hmac text
)
returns table (
  provider_code text,
  receiver_revision_id uuid,
  receiver_account_holder_name text,
  receiver_account_reference_ciphertext text,
  receiver_account_reference_fingerprint text,
  receiver_account_masked text,
  payments_enabled boolean,
  request_replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  v_now timestamptz;
  v_customer_identity_id uuid;
  v_customer_id uuid;
  v_conversation_id uuid;
  v_conversation_version bigint;
  v_identity_status app.record_status;
  v_customer_status app.record_status;
  v_processed_at timestamptz;
  v_player app.customer_platform_players%rowtype;
  v_eligibility app.player_deposit_eligibility_decisions%rowtype;
  v_provider app.payment_providers%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_receipt app.telegram_telebirr_destination_receipts%rowtype;
  v_activation_epoch bigint;
  v_payments_enabled boolean;
  v_request_replayed boolean := false;
begin
  if p_origin_inbound_event_id is null
    or p_player_id is null
    or p_player_id <> pg_catalog.btrim(p_player_id)
    or pg_catalog.char_length(p_player_id) not between 1 and 64
    or p_player_id ~ '[[:space:][:cntrl:]]'
    or p_semantic_input_hmac is null
    or p_semantic_input_hmac <> pg_catalog.lower(pg_catalog.btrim(p_semantic_input_hmac))
    or p_semantic_input_hmac !~ '^hmac-sha256-v1:[0-9a-f]{64}$' then
    raise exception 'The Telegram TeleBirr destination request is invalid.';
  end if;

  -- Acquire the repository-wide authority -> switches -> pilot order before identity, player, or
  -- receiver rows. The helper returns only a complete, unexpired, non-revoked TeleBirr authority.
  v_activation_epoch := app.current_private_trusted_telebirr_activation_epoch();

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);

  select inbound_event.customer_identity_id, inbound_event.processed_at
    into v_customer_identity_id, v_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;
  if v_customer_identity_id is null then
    raise exception 'The Telegram inbound event is unavailable for a deposit destination.';
  end if;

  select identity.customer_id,
         identity.status,
         customer.status,
         conversation.id,
         conversation.version
    into v_customer_id,
         v_identity_status,
         v_customer_status,
         v_conversation_id,
         v_conversation_version
    from app.customer_identities identity
    join app.customers customer on customer.id = identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
    join app.bot_conversations conversation
      on conversation.telegram_identity_id = identity.id
   where identity.id = v_customer_identity_id
     and identity.identity_kind = 'telegram'
     and exists (
       select 1
         from app.telegram_beta_invites invite
        where invite.status = 'redeemed'
          and invite.redeemed_customer_id = identity.customer_id
          and invite.redeemed_customer_identity_id = identity.id
          and invite.redeemed_telegram_user_id = telegram_identity.telegram_user_id
          and invite.redeemed_private_chat_id = telegram_identity.private_chat_id
     )
   for update of identity, customer, telegram_identity, conversation;
  if v_customer_id is null then
    raise exception 'The Telegram customer is unavailable for a deposit destination.';
  end if;

  select receipt.*
    into v_receipt
    from app.telegram_telebirr_destination_receipts receipt
   where receipt.origin_inbound_event_id = p_origin_inbound_event_id;

  if v_receipt.origin_inbound_event_id is not null then
    v_request_replayed := true;
    select player.*
      into v_player
      from app.customer_platform_players player
      join app.platforms platform on platform.id = player.platform_id
     where player.id = v_receipt.player_account_id
       and player.customer_id = v_customer_id
       and player.status = 'active'
       and player.validation_status = 'valid'
       and platform.code = 'kemerbet'
       and platform.status = 'active'
       and player.player_id = p_player_id
     for share of player;
    select receiver.*
      into v_receiver
      from app.receiver_accounts receiver
     where receiver.id = v_receipt.receiver_account_id
     for share;
    if v_receipt.semantic_input_hmac is distinct from p_semantic_input_hmac
      or v_receipt.customer_identity_id is distinct from v_customer_identity_id
      or v_receipt.customer_id is distinct from v_customer_id
      or v_receipt.conversation_id is distinct from v_conversation_id
      or v_player.id is null
      or v_receiver.id is null then
      raise exception 'The replayed Telegram deposit destination conflicts with its receipt.';
    end if;

    select decision.*
      into v_eligibility
      from app.player_deposit_eligibility_decisions decision
     where decision.player_account_id = v_player.id
     order by decision.decision_version desc
     limit 1
     for share;
    if v_eligibility.id is null
      or v_eligibility.decision <> 'eligible'
      or v_eligibility.player_account_updated_at_snapshot is distinct from v_player.updated_at then
      raise exception 'The KemerBet Player ID is not currently deposit eligible.';
    end if;
  else
    if v_processed_at is not null
      or v_identity_status <> 'active'
      or v_customer_status <> 'active' then
      raise exception 'The Telegram event cannot prepare a deposit destination.';
    end if;

    select player.*
      into v_player
      from app.customer_platform_players player
      join app.platforms platform on platform.id = player.platform_id
     where platform.code = 'kemerbet'
       and platform.status = 'active'
       and player.customer_id = v_customer_id
       and player.player_id = p_player_id
       and player.status = 'active'
       and player.validation_status = 'valid'
     for share of player;
    if v_player.id is null then
      raise exception 'The KemerBet Player ID is not available for a deposit.';
    end if;

    select decision.*
      into v_eligibility
      from app.player_deposit_eligibility_decisions decision
     where decision.player_account_id = v_player.id
     order by decision.decision_version desc
     limit 1
     for share;
    if v_eligibility.id is null
      or v_eligibility.decision <> 'eligible'
      or v_eligibility.player_account_updated_at_snapshot is distinct from v_player.updated_at then
      raise exception 'The KemerBet Player ID is not currently deposit eligible.';
    end if;

    select provider.*
      into v_provider
      from app.payment_providers provider
     where provider.code = 'telebirr'
       and provider.status = 'active'
     for share;
    if v_provider.id is null then
      raise exception 'TeleBirr is unavailable.';
    end if;

    select receiver.*
      into v_receiver
      from app.receiver_accounts receiver
     where receiver.provider_id = v_provider.id
       and receiver.status = 'active'
       and receiver.retired_at is null
     for share;
    if v_receiver.id is null
      or v_receiver.account_holder_name <> pg_catalog.btrim(v_receiver.account_holder_name)
      or pg_catalog.char_length(v_receiver.account_holder_name) not between 2 and 160
      or v_receiver.account_holder_name ~ '[[:cntrl:]]'
      or v_receiver.account_reference_ciphertext
         !~ '^receiver-v1[.]telebirr[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{12,32}$'
      or v_receiver.account_reference_fingerprint !~ '^[0-9a-f]{64}$'
      or v_receiver.account_reference_masked !~ '^\*{3}[0-9]{4}$'
      or v_receiver.protection_profile_version <> 1
      or v_receiver.encryption_key_version <> 1
      or v_receiver.fingerprint_key_version <> 1 then
      raise exception 'The TeleBirr receiving account is not safely configured.';
    end if;

    v_now := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
    insert into app.telegram_telebirr_destination_receipts (
      origin_inbound_event_id,
      customer_identity_id,
      customer_id,
      conversation_id,
      player_account_id,
      receiver_account_id,
      activation_epoch,
      semantic_input_hmac,
      created_at,
      payment_presentation_expires_at
    ) values (
      p_origin_inbound_event_id,
      v_customer_identity_id,
      v_customer_id,
      v_conversation_id,
      v_player.id,
      v_receiver.id,
      v_activation_epoch,
      p_semantic_input_hmac,
      v_now,
      v_now + interval '10 minutes'
    ) returning * into v_receipt;

    update app.inbound_events inbound_event
       set processed_at = v_now,
           processing_error_code = null
     where inbound_event.id = p_origin_inbound_event_id
       and inbound_event.processed_at is null;
    if not found then
      raise exception 'The Telegram deposit destination receipt is unavailable.';
    end if;

  end if;

  v_payments_enabled := v_activation_epoch is not null
    and v_receipt.activation_epoch is not distinct from v_activation_epoch
    and pg_catalog.clock_timestamp() < v_receipt.payment_presentation_expires_at
    and v_receiver.status = 'active'
    and v_receiver.retired_at is null;

  if not v_request_replayed then
    insert into app.audit_events (
      actor_kind,
      actor_customer_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) values (
      'customer',
      v_customer_id,
      'deposit.telebirr_destination_presented',
      'receiver_account',
      v_receiver.id,
      pg_catalog.jsonb_build_object(
        'channel', 'telegram',
        'provider_code', 'telebirr',
        'payment_details_disclosed', v_payments_enabled
      )
    );
  end if;

  return query
  select 'telebirr'::text,
         v_receiver.id,
         v_receiver.account_holder_name,
         case when v_payments_enabled then v_receiver.account_reference_ciphertext end,
         case when v_payments_enabled then v_receiver.account_reference_fingerprint end,
         v_receiver.account_reference_masked,
         v_payments_enabled,
         v_request_replayed;
end;
$$;

alter table app.telegram_telebirr_destination_receipts owner to postgres;
alter function app.reject_telegram_telebirr_destination_receipt_mutation() owner to postgres;
alter function app.prepare_telegram_telebirr_destination(uuid, text, text) owner to postgres;

revoke all on table app.telegram_telebirr_destination_receipts
from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime,
  fetanagent_worker,
  fetanagent_beta_admission, fetanagent_beta_admission_runtime,
  fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_player_actions, fetanagent_player_actions_runtime,
  fetanagent_cbe_birr_shadow_worker,
  fetanagent_customer_web, fetanagent_customer_web_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
  fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime;

revoke all on function
  app.reject_telegram_telebirr_destination_receipt_mutation(),
  app.prepare_telegram_telebirr_destination(uuid, text, text)
from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime,
  fetanagent_worker,
  fetanagent_beta_admission, fetanagent_beta_admission_runtime,
  fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_player_actions, fetanagent_player_actions_runtime,
  fetanagent_cbe_birr_shadow_worker,
  fetanagent_customer_web, fetanagent_customer_web_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
  fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime;

grant usage on schema app to fetanagent_player_actions;
grant execute on function app.prepare_telegram_telebirr_destination(uuid, text, text)
to fetanagent_player_actions;

comment on function app.prepare_telegram_telebirr_destination(uuid, text, text) is
  'Admitted private-Telegram receiver presentation. Returns full protected receiver material only within the exact trusted TeleBirr activation epoch bound into its immutable receipt.';

commit;
