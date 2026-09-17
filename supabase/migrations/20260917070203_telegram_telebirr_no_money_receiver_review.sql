-- Separate the private no-money receiver review from payment authorization.
-- No public or runtime grants are added; the existing RPC signature and payment flag stay intact.
begin;

do $receiver_review_preflight$
begin
  if app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception 'Receiver review migration requires inactive financial authority.';
  end if;
end;
$receiver_review_preflight$;

create table app.telegram_telebirr_receiver_review_receipts (
  origin_inbound_event_id uuid primary key
    references app.telegram_telebirr_destination_receipts (origin_inbound_event_id)
    on delete restrict,
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  configuration_digest text not null
    check (configuration_digest ~ '^sha256:[0-9a-f]{64}$')
);
create index telegram_telebirr_receiver_review_pilot_idx
  on app.telegram_telebirr_receiver_review_receipts (pilot_revision_id);

alter table app.telegram_telebirr_receiver_review_receipts enable row level security;
alter table app.telegram_telebirr_receiver_review_receipts force row level security;
create trigger telegram_telebirr_receiver_review_immutable
before update or delete on app.telegram_telebirr_receiver_review_receipts
for each row execute function app.reject_telegram_telebirr_destination_receipt_mutation();
create trigger telegram_telebirr_receiver_review_no_truncate
before truncate on app.telegram_telebirr_receiver_review_receipts
for each statement execute function app.reject_telegram_telebirr_destination_receipt_mutation();
alter table app.telegram_telebirr_receiver_review_receipts owner to postgres;
revoke all on table app.telegram_telebirr_receiver_review_receipts
from public, anon, authenticated, service_role;

-- Internal only. Lock order matches all financial paths: authority, switches, pilot.
-- An unavailable review returns NULL and preserves the ordinary masked preview.
create function app.lock_private_telebirr_receiver_review_pilot()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_pilot app.private_live_deposit_pilot_revisions%rowtype;
begin
  perform app.lock_private_trusted_telebirr_activation_authority();

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
     'private_live_deposit_pilot', 'telebirr_authoritative_verification',
     'withdrawal_collection', 'withdrawal_validation'
   )
   order by feature_switch.feature_key
   for share;

  -- Check the live epoch only after locking all seven switches: the epoch reader can itself
  -- lock a pilot, so calling it earlier would put withdrawal-switch locks after pilot locks.
  if app.current_private_trusted_telebirr_activation_epoch() is not null then
    return null;
  end if;

  if (select pg_catalog.count(*) from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
         'telebirr_authoritative_verification', 'withdrawal_collection', 'withdrawal_validation'
       )
         and feature_switch.mode = 'disabled'
         and feature_switch.settings = '{}'::jsonb) <> 6 then
    return null;
  end if;

  select pilot.* into v_pilot
    from app.private_live_deposit_pilot_revisions pilot
    join app.feature_switches pilot_switch
      on pilot_switch.feature_key = 'private_live_deposit_pilot'
   where pilot.status = 'armed'
     and pilot.configuration_digest is not null
     and pilot.minimum_amount_minor = 2500
     and pilot.maximum_per_deposit_minor = 2500
     and pilot.maximum_per_player_minor = 2500
     and pilot.maximum_aggregate_minor = 12500
     and pilot.maximum_reservation_count = 5
     and pilot.currency_code = 'ETB'
     and pilot_switch.mode = 'dry_run'
     and pilot_switch.settings = pg_catalog.jsonb_build_object(
       'contract_version', 1,
       'pilot_revision_id', pilot.id,
       'configuration_digest', pilot.configuration_digest
     )
   for share of pilot;

  if v_pilot.id is null
    or v_pilot.active_from > pg_catalog.clock_timestamp()
    or v_pilot.expires_at <= pg_catalog.clock_timestamp()
    or (select pg_catalog.count(*) from app.private_live_deposit_pilot_players member
         where member.pilot_revision_id = v_pilot.id) <> 5
    or (select pg_catalog.count(*) from app.private_live_deposit_pilot_providers provider
         where provider.pilot_revision_id = v_pilot.id) <> 1
    or not exists (
      select 1 from app.private_live_deposit_pilot_providers provider
       where provider.pilot_revision_id = v_pilot.id
         and provider.provider_code_snapshot = 'telebirr'
    ) then
    return null;
  end if;
  return v_pilot.id;
end;
$$;

alter function app.lock_private_telebirr_receiver_review_pilot() owner to postgres;
revoke all on function app.lock_private_telebirr_receiver_review_pilot()
from public, anon, authenticated, service_role;

create or replace function app.prepare_telegram_telebirr_destination(
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
  v_review_pilot_id uuid;
  v_receiver_review_enabled boolean := false;
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
  -- Take every review switch before either epoch reader can take a pilot lock.
  v_review_pilot_id := app.lock_private_telebirr_receiver_review_pilot();
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
      v_now + interval '12 hours'
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

  -- Review disclosure is a separate, non-financial permission. A request is bound only on its
  -- first execution; neither a legacy preview nor a prior pilot can be upgraded by replaying it.
  if v_activation_epoch is null
    and v_review_pilot_id is not null
    and v_receipt.activation_epoch is null
    and v_identity_status = 'active'
    and v_customer_status = 'active'
    and pg_catalog.clock_timestamp() < v_receipt.payment_presentation_expires_at
    and exists (
      select 1
        from app.private_live_deposit_pilot_revisions pilot
        join app.private_live_deposit_pilot_players member
          on member.pilot_revision_id = pilot.id
        join app.private_live_deposit_pilot_customers customer_member
          on customer_member.pilot_revision_id = pilot.id
        join app.customers customer on customer.id = customer_member.customer_id
        join app.private_live_deposit_pilot_providers destination
          on destination.pilot_revision_id = pilot.id
        join app.payment_providers provider on provider.id = destination.payment_provider_id
       where pilot.id = v_review_pilot_id
         and pilot.status = 'armed'
         and pilot.active_from <= pg_catalog.clock_timestamp()
         and pilot.expires_at > pg_catalog.clock_timestamp()
         and member.player_account_id = v_player.id
         and member.player_id_snapshot = v_player.player_id
         and member.player_updated_at_snapshot = v_player.updated_at
         and member.eligibility_decision_id_snapshot = v_eligibility.id
         and member.player_owner_customer_id_snapshot = v_customer_id
         and member.player_owner_customer_status_snapshot = customer.status
         and member.player_owner_customer_updated_at_snapshot = customer.updated_at
         and customer_member.customer_id = v_customer_id
         and customer_member.customer_status_snapshot = customer.status
         and customer_member.customer_updated_at_snapshot = customer.updated_at
         and provider.code = 'telebirr'
         and provider.status = 'active'
         and destination.provider_updated_at_snapshot = provider.updated_at
         and destination.provider_code_snapshot = 'telebirr'
         and destination.receiver_account_id = v_receiver.id
         and destination.receiver_account_version = v_receiver.version
         and destination.receiver_updated_at_snapshot = v_receiver.updated_at
         and destination.receiver_account_holder_name_snapshot = v_receiver.account_holder_name
         and destination.receiver_account_masked_snapshot = v_receiver.account_reference_masked
         and v_receiver.status = 'active'
         and v_receiver.retired_at is null
    ) then
    if not v_request_replayed then
      insert into app.telegram_telebirr_receiver_review_receipts (
        origin_inbound_event_id, pilot_revision_id, configuration_digest
      )
      select v_receipt.origin_inbound_event_id, pilot.id, pilot.configuration_digest
        from app.private_live_deposit_pilot_revisions pilot
       where pilot.id = v_review_pilot_id;
    end if;

    select exists (
      select 1
        from app.telegram_telebirr_receiver_review_receipts review
        join app.private_live_deposit_pilot_revisions pilot
          on pilot.id = review.pilot_revision_id
       where review.origin_inbound_event_id = v_receipt.origin_inbound_event_id
         and review.pilot_revision_id = v_review_pilot_id
         and review.configuration_digest = pilot.configuration_digest
    ) into v_receiver_review_enabled;
  end if;

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
        'payment_details_disclosed', v_payments_enabled or v_receiver_review_enabled,
        'accepts_payments', v_payments_enabled,
        'receiver_review_only', v_receiver_review_enabled
      )
    );
  end if;

  return query
  select 'telebirr'::text,
         v_receiver.id,
         v_receiver.account_holder_name,
         case when v_payments_enabled or v_receiver_review_enabled
           then v_receiver.account_reference_ciphertext end,
         case when v_payments_enabled or v_receiver_review_enabled
           then v_receiver.account_reference_fingerprint end,
         v_receiver.account_reference_masked,
         v_payments_enabled,
         v_request_replayed;
end;
$$;

comment on function app.prepare_telegram_telebirr_destination(uuid, text, text) is
  'Private receiver presentation. Payment authorization is unchanged. Protected receiver material may also be released for the exact armed five-player dry-run pilot with every financial feature disabled, through an immutable non-financial review binding.';

commit;
