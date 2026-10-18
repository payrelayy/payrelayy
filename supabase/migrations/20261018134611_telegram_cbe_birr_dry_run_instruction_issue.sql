-- Ungranted Telegram CBE Birr instruction issuer for disposable dry-run lineage.
-- It snapshots one current v2 lookup receiver for one admitted event and Player.
-- It returns no payable receiver reference and cannot invite or verify a payment.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create table app.telegram_cbe_birr_dry_run_instruction_receipts (
  origin_inbound_event_id uuid primary key
    references app.inbound_events (id) on delete restrict,
  instruction_id uuid not null unique
    references app.cbe_birr_payment_instructions (id) on delete restrict,
  customer_identity_id uuid not null
    references app.customer_identities (id) on delete restrict,
  submitting_customer_id uuid not null
    references app.customers (id) on delete restrict,
  conversation_id uuid not null
    references app.bot_conversations (id) on delete restrict,
  player_account_id uuid not null
    references app.customer_platform_players (id) on delete restrict,
  semantic_input_hmac text not null
    check (semantic_input_hmac ~ '^hmac-sha256-v1:[0-9a-f]{64}$'),
  created_at timestamptz not null
);

alter table app.telegram_cbe_birr_dry_run_instruction_receipts owner to postgres;
alter table app.telegram_cbe_birr_dry_run_instruction_receipts enable row level security;
alter table app.telegram_cbe_birr_dry_run_instruction_receipts force row level security;
revoke all on app.telegram_cbe_birr_dry_run_instruction_receipts
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker, fetanagent_cbe_birr_proof_preflight,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

create trigger telegram_cbe_birr_dry_run_instruction_receipts_immutable
before update or delete on app.telegram_cbe_birr_dry_run_instruction_receipts
for each row execute function app.reject_cbe_birr_instruction_proof_mutation();

create trigger telegram_cbe_birr_dry_run_instruction_receipts_no_truncate
before truncate on app.telegram_cbe_birr_dry_run_instruction_receipts
for each statement execute function app.reject_cbe_birr_instruction_proof_mutation();

create function app.issue_telegram_cbe_birr_dry_run_instruction(
  p_origin_inbound_event_id uuid,
  p_player_id text,
  p_semantic_input_hmac text
)
returns table (
  instruction_id uuid,
  issued_at timestamptz,
  expires_at timestamptz,
  request_replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_identity_id uuid;
  v_customer_id uuid;
  v_conversation_id uuid;
  v_identity_status app.record_status;
  v_customer_status app.record_status;
  v_processed_at timestamptz;
  v_receipt app.telegram_cbe_birr_dry_run_instruction_receipts%rowtype;
  v_instruction app.cbe_birr_payment_instructions%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_boundary record;
  v_now timestamptz;
begin
  if p_origin_inbound_event_id is null
    or p_player_id is null
    or p_player_id <> pg_catalog.btrim(p_player_id)
    or pg_catalog.char_length(p_player_id) not between 1 and 64
    or p_player_id ~ '[[:space:][:cntrl:]]'
    or p_semantic_input_hmac is null
    or p_semantic_input_hmac !~ '^hmac-sha256-v1:[0-9a-f]{64}$' then
    raise exception 'The Telegram CBE Birr instruction request is invalid.';
  end if;

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);

  select event.customer_identity_id, event.processed_at
    into v_identity_id, v_processed_at
    from app.inbound_events event
   where event.id = p_origin_inbound_event_id
     and event.channel = 'telegram'
   for update;
  if not found or v_identity_id is null then
    raise exception 'The Telegram CBE Birr instruction event is unavailable.';
  end if;

  select identity.customer_id, identity.status, customer.status, conversation.id
    into v_customer_id, v_identity_status, v_customer_status, v_conversation_id
    from app.customer_identities identity
    join app.customers customer on customer.id = identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
    join app.bot_conversations conversation
      on conversation.telegram_identity_id = identity.id
   where identity.id = v_identity_id
     and identity.identity_kind = 'telegram'
     and exists (
       select 1 from app.telegram_beta_invites invite
        where invite.status = 'redeemed'
          and invite.redeemed_customer_id = identity.customer_id
          and invite.redeemed_customer_identity_id = identity.id
          and invite.redeemed_telegram_user_id = telegram_identity.telegram_user_id
          and invite.redeemed_private_chat_id = telegram_identity.private_chat_id
     )
   for update of identity, customer, telegram_identity, conversation;
  if not found then
    raise exception 'The Telegram CBE Birr instruction customer is unavailable.';
  end if;

  perform app.require_dry_run_deposit_proof_switches_disabled();

  select receipt.* into v_receipt
    from app.telegram_cbe_birr_dry_run_instruction_receipts receipt
   where receipt.origin_inbound_event_id = p_origin_inbound_event_id;
  if found then
    select instruction.* into v_instruction
      from app.cbe_birr_payment_instructions instruction
      join app.customer_platform_players player
        on player.id = instruction.player_account_id
     where instruction.id = v_receipt.instruction_id
       and instruction.provider_code = 'cbe_birr'
       and instruction.origin_channel = 'telegram'
       and player.player_id = p_player_id;
    if not found
      or v_receipt.semantic_input_hmac is distinct from p_semantic_input_hmac
      or v_receipt.customer_identity_id is distinct from v_identity_id
      or v_receipt.submitting_customer_id is distinct from v_customer_id
      or v_receipt.conversation_id is distinct from v_conversation_id
      or v_receipt.player_account_id is distinct from v_instruction.player_account_id
      or v_instruction.submitting_customer_id is distinct from v_customer_id
      or v_processed_at is distinct from v_receipt.created_at then
      raise exception 'The replayed Telegram CBE Birr instruction conflicts with its receipt.';
    end if;
    return query select v_instruction.id, v_instruction.issued_at,
                        v_instruction.expires_at, true;
    return;
  end if;

  if v_processed_at is not null
    or v_identity_status <> 'active'
    or v_customer_status <> 'active'
    or exists (
      select 1 from app.inbound_event_consumptions consumption
       where consumption.origin_inbound_event_id = p_origin_inbound_event_id
    )
    or exists (
      select 1 from app.telegram_dry_run_deposit_proof_receipts proof_receipt
       where proof_receipt.origin_inbound_event_id = p_origin_inbound_event_id
    )
    or exists (
      select 1 from app.telegram_live_deposit_request_receipts live_receipt
       where live_receipt.origin_inbound_event_id = p_origin_inbound_event_id
    ) then
    raise exception 'The Telegram event cannot issue a CBE Birr instruction.';
  end if;

  select boundary.* into v_boundary
    from app.resolve_dry_run_deposit_proof_boundary(p_player_id, 'cbe_birr') boundary;
  if not found or v_boundary.normalized_provider_code <> 'cbe_birr' then
    raise exception 'The CBE Birr instruction Player is unavailable.';
  end if;

  select receiver.* into v_receiver
    from app.receiver_accounts receiver
    join app.cbe_birr_receiver_lookup_revisions lookup
      on lookup.receiver_revision_id = receiver.id
     and lookup.receiver_version = receiver.version
     and lookup.rotation_request_id = receiver.rotation_request_id
   where receiver.provider_id = v_boundary.payment_provider_id
     and receiver.status = 'active'
     and receiver.retired_at is null
     and lookup.protection_profile_version = 2
     and lookup.encryption_key_version = 2
     and lookup.fingerprint_key_version = 2
   for share of receiver, lookup;
  if not found then
    raise exception 'A current v2 CBE Birr receiver revision is unavailable.';
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_receiver.active_from > v_now then
    raise exception 'The CBE Birr receiver revision is not yet active.';
  end if;

  insert into app.cbe_birr_payment_instructions (
    submitting_customer_id, player_account_id, payment_provider_id,
    provider_code, origin_channel, receiver_revision_id,
    receiver_version, receiver_rotation_request_id,
    issued_at, expires_at, created_at
  ) values (
    v_customer_id, v_boundary.player_account_id, v_boundary.payment_provider_id,
    'cbe_birr', 'telegram', v_receiver.id,
    v_receiver.version, v_receiver.rotation_request_id,
    v_now, v_now + interval '1 hour', v_now
  ) returning * into v_instruction;

  insert into app.telegram_cbe_birr_dry_run_instruction_receipts (
    origin_inbound_event_id, instruction_id, customer_identity_id,
    submitting_customer_id, conversation_id, player_account_id,
    semantic_input_hmac, created_at
  ) values (
    p_origin_inbound_event_id, v_instruction.id, v_identity_id,
    v_customer_id, v_conversation_id, v_boundary.player_account_id,
    p_semantic_input_hmac, v_now
  );

  update app.inbound_events event
     set processed_at = v_now, processing_error_code = null
   where event.id = p_origin_inbound_event_id
     and event.processed_at is null;
  if not found then
    raise exception 'The Telegram CBE Birr instruction event changed.';
  end if;

  return query select v_instruction.id, v_instruction.issued_at,
                      v_instruction.expires_at, false;
end;
$$;

alter function app.issue_telegram_cbe_birr_dry_run_instruction(uuid, text, text)
owner to postgres;
revoke all on function app.issue_telegram_cbe_birr_dry_run_instruction(uuid, text, text)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker, fetanagent_cbe_birr_proof_preflight,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

comment on table app.telegram_cbe_birr_dry_run_instruction_receipts is
  'Immutable event-to-CBE-instruction retry record. No runtime access or payable receiver details.';
comment on function app.issue_telegram_cbe_birr_dry_run_instruction(uuid, text, text) is
  'Ungranted, all-switches-disabled Telegram CBE Birr dry-run instruction issuer. Returns one opaque instruction ID and exact one-hour window, never payable receiver details or payment authority.';

commit;
