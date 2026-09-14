-- Private Telegram proof-first intake for the bounded live TeleBirr pilot.
--
-- This migration is deliberately inert at installation time. It installs one live receiver
-- presentation receipt, one proof-to-verifier handoff, and one identity-scoped status lookup. It
-- cannot be installed while trusted TeleBirr financial authority is active, and it neither creates
-- an activation epoch nor changes a feature switch.

begin;

lock table app.private_trusted_telebirr_activation_control in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_epochs in share row exclusive mode;
lock table app.feature_switches in share row exclusive mode;
lock table app.private_live_deposit_pilot_revisions in share row exclusive mode;

do $telegram_live_telebirr_proof_intake_preflight$
begin
  if app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception
      'Telegram live TeleBirr proof intake migration requires inactive financial authority.';
  end if;
end;
$telegram_live_telebirr_proof_intake_preflight$;

alter table app.telegram_telebirr_destination_receipts
  add constraint telegram_telebirr_destination_receipts_exact_presentation_key unique (
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
  );

-- This second, immutable receipt separates an informational/review presentation from a real
-- payment prompt. The three-argument legacy destination function can never create one.
create table app.telegram_live_telebirr_payment_presentations (
  origin_inbound_event_id uuid primary key,
  customer_identity_id uuid not null,
  customer_id uuid not null,
  conversation_id uuid not null,
  player_account_id uuid not null,
  receiver_account_id uuid not null,
  activation_epoch bigint not null check (activation_epoch > 0),
  semantic_input_hmac text not null check (
    semantic_input_hmac = pg_catalog.lower(pg_catalog.btrim(semantic_input_hmac))
    and semantic_input_hmac ~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$'
  ),
  created_at timestamptz not null,
  payment_presentation_expires_at timestamptz not null,
  constraint telegram_live_telebirr_presentations_destination_fkey foreign key (
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
  ) references app.telegram_telebirr_destination_receipts (
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
  ) on delete restrict,
  constraint telegram_live_telebirr_presentations_window_check check (
    payment_presentation_expires_at = created_at + interval '10 minutes'
  )
);

create index telegram_live_telebirr_presentations_identity_idx
  on app.telegram_live_telebirr_payment_presentations (customer_identity_id);
create index telegram_live_telebirr_presentations_customer_idx
  on app.telegram_live_telebirr_payment_presentations (customer_id);
create index telegram_live_telebirr_presentations_player_idx
  on app.telegram_live_telebirr_payment_presentations (player_account_id);
create index telegram_live_telebirr_presentations_epoch_expiry_idx
  on app.telegram_live_telebirr_payment_presentations (
    activation_epoch, payment_presentation_expires_at
  );

create table app.telegram_live_telebirr_proof_receipts (
  origin_inbound_event_id uuid primary key
    references app.inbound_events (id) on delete restrict,
  live_presentation_origin_inbound_event_id uuid not null unique
    references app.telegram_live_telebirr_payment_presentations (
      origin_inbound_event_id
    ) on delete restrict,
  customer_identity_id uuid not null,
  submitting_customer_id uuid not null,
  conversation_id uuid not null
    references app.bot_conversations (id) on delete restrict,
  player_account_id uuid not null
    references app.customer_platform_players (id) on delete restrict,
  payment_provider_id uuid not null
    references app.payment_providers (id) on delete restrict,
  receiver_account_id uuid not null
    references app.receiver_accounts (id) on delete restrict,
  live_proof_id uuid not null unique
    references app.private_live_deposit_pilot_proofs (id) on delete restrict,
  live_verification_job_id uuid not null unique
    references app.private_live_telebirr_verification_jobs (id) on delete restrict,
  activation_epoch bigint not null
    references app.private_trusted_telebirr_activation_epochs (epoch) on delete restrict,
  semantic_input_hmac text not null check (
    semantic_input_hmac = pg_catalog.lower(pg_catalog.btrim(semantic_input_hmac))
    and semantic_input_hmac ~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$'
  ),
  conversation_version bigint not null check (conversation_version >= 0),
  created_at timestamptz not null,
  constraint telegram_live_telebirr_proof_receipts_identity_customer_fkey
    foreign key (customer_identity_id, submitting_customer_id)
    references app.customer_identities (id, customer_id) on delete restrict,
  constraint telegram_live_telebirr_proof_receipts_activation_check
    check (activation_epoch > 0)
);

create index telegram_live_telebirr_proof_receipts_identity_idx
  on app.telegram_live_telebirr_proof_receipts (customer_identity_id);
create index telegram_live_telebirr_proof_receipts_customer_idx
  on app.telegram_live_telebirr_proof_receipts (submitting_customer_id);
create index telegram_live_telebirr_proof_receipts_conversation_idx
  on app.telegram_live_telebirr_proof_receipts (conversation_id);
create index telegram_live_telebirr_proof_receipts_epoch_idx
  on app.telegram_live_telebirr_proof_receipts (activation_epoch, created_at, live_proof_id);

create trigger telegram_live_telebirr_presentations_immutable
before update or delete on app.telegram_live_telebirr_payment_presentations
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger telegram_live_telebirr_presentations_no_truncate
before truncate on app.telegram_live_telebirr_payment_presentations
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create trigger telegram_live_telebirr_proof_receipts_immutable
before update or delete on app.telegram_live_telebirr_proof_receipts
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger telegram_live_telebirr_proof_receipts_no_truncate
before truncate on app.telegram_live_telebirr_proof_receipts
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

alter table app.telegram_live_telebirr_payment_presentations enable row level security;
alter table app.telegram_live_telebirr_payment_presentations force row level security;
alter table app.telegram_live_telebirr_proof_receipts enable row level security;
alter table app.telegram_live_telebirr_proof_receipts force row level security;

create function app.prepare_telegram_live_telebirr_destination(
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
set search_path = pg_catalog
as $$
declare
  destination app.telegram_telebirr_destination_receipts%rowtype;
  presentation app.telegram_live_telebirr_payment_presentations%rowtype;
  resolved_provider_code text;
  resolved_receiver_revision_id uuid;
  resolved_receiver_account_holder_name text;
  resolved_receiver_account_reference_ciphertext text;
  resolved_receiver_account_reference_fingerprint text;
  resolved_receiver_account_masked text;
  resolved_payments_enabled boolean;
  resolved_request_replayed boolean;
  current_epoch bigint;
begin
  select prepared.provider_code,
         prepared.receiver_revision_id,
         prepared.receiver_account_holder_name,
         prepared.receiver_account_reference_ciphertext,
         prepared.receiver_account_reference_fingerprint,
         prepared.receiver_account_masked,
         prepared.payments_enabled,
         prepared.request_replayed
    into resolved_provider_code,
         resolved_receiver_revision_id,
         resolved_receiver_account_holder_name,
         resolved_receiver_account_reference_ciphertext,
         resolved_receiver_account_reference_fingerprint,
         resolved_receiver_account_masked,
         resolved_payments_enabled,
         resolved_request_replayed
    from app.prepare_telegram_telebirr_destination(
      p_origin_inbound_event_id,
      p_player_id,
      p_semantic_input_hmac
    ) prepared;

  if resolved_provider_code is distinct from 'telebirr'
    or resolved_payments_enabled is not true
    or resolved_receiver_account_reference_ciphertext is null
    or resolved_receiver_account_reference_fingerprint is null then
    raise exception 'The live Telegram TeleBirr payment presentation is unavailable.';
  end if;

  select receipt.*
    into destination
    from app.telegram_telebirr_destination_receipts receipt
   where receipt.origin_inbound_event_id = p_origin_inbound_event_id
   for share;

  current_epoch := app.current_private_trusted_telebirr_activation_epoch();
  if destination.origin_inbound_event_id is null
    or destination.activation_epoch is null
    or destination.activation_epoch is distinct from current_epoch
    or destination.receiver_account_id is distinct from resolved_receiver_revision_id
    or destination.semantic_input_hmac is distinct from p_semantic_input_hmac
    or pg_catalog.clock_timestamp() >= destination.payment_presentation_expires_at then
    raise exception 'The live Telegram TeleBirr payment presentation is unavailable.';
  end if;

  select live_presentation.*
    into presentation
    from app.telegram_live_telebirr_payment_presentations live_presentation
   where live_presentation.origin_inbound_event_id = p_origin_inbound_event_id;

  if presentation.origin_inbound_event_id is null then
    insert into app.telegram_live_telebirr_payment_presentations (
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
      destination.origin_inbound_event_id,
      destination.customer_identity_id,
      destination.customer_id,
      destination.conversation_id,
      destination.player_account_id,
      destination.receiver_account_id,
      destination.activation_epoch,
      destination.semantic_input_hmac,
      destination.created_at,
      destination.payment_presentation_expires_at
    ) returning * into presentation;
  elsif presentation.customer_identity_id is distinct from destination.customer_identity_id
    or presentation.customer_id is distinct from destination.customer_id
    or presentation.conversation_id is distinct from destination.conversation_id
    or presentation.player_account_id is distinct from destination.player_account_id
    or presentation.receiver_account_id is distinct from destination.receiver_account_id
    or presentation.activation_epoch is distinct from destination.activation_epoch
    or presentation.semantic_input_hmac is distinct from destination.semantic_input_hmac
    or presentation.created_at is distinct from destination.created_at
    or presentation.payment_presentation_expires_at
       is distinct from destination.payment_presentation_expires_at then
    raise exception 'The replayed live Telegram TeleBirr presentation conflicts with its receipt.';
  end if;

  return query
  select resolved_provider_code,
         resolved_receiver_revision_id,
         resolved_receiver_account_holder_name,
         resolved_receiver_account_reference_ciphertext,
         resolved_receiver_account_reference_fingerprint,
         resolved_receiver_account_masked,
         true,
         resolved_request_replayed;
end;
$$;

create function app.enforce_telegram_live_telebirr_proof_receipt_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  destination app.telegram_live_telebirr_payment_presentations%rowtype;
  proof app.private_live_deposit_pilot_proofs%rowtype;
  verification_job app.private_live_telebirr_verification_jobs%rowtype;
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  resolved_customer_identity_id uuid;
  resolved_customer_id uuid;
  resolved_conversation_id uuid;
  resolved_conversation_version bigint;
  resolved_identity_status app.record_status;
  resolved_customer_status app.record_status;
  resolved_processed_at timestamptz;
begin
  perform app.lock_telegram_inbound_event_scope(new.origin_inbound_event_id);

  select inbound_event.customer_identity_id, inbound_event.processed_at
    into resolved_customer_identity_id, resolved_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = new.origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;

  select identity.customer_id,
         identity.status,
         customer.status,
         conversation.id,
         conversation.version
    into resolved_customer_id,
         resolved_identity_status,
         resolved_customer_status,
         resolved_conversation_id,
         resolved_conversation_version
    from app.customer_identities identity
    join app.customers customer on customer.id = identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
     and identity.external_subject = telegram_identity.telegram_user_id::text
    join app.bot_conversations conversation
      on conversation.telegram_identity_id = identity.id
   where identity.id = resolved_customer_identity_id
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

  select live_presentation.* into destination
    from app.telegram_live_telebirr_payment_presentations live_presentation
   where live_presentation.origin_inbound_event_id
         = new.live_presentation_origin_inbound_event_id
   for share;
  select proof_row.* into proof
    from app.private_live_deposit_pilot_proofs proof_row
   where proof_row.id = new.live_proof_id
   for key share;
  select job.* into verification_job
    from app.private_live_telebirr_verification_jobs job
   where job.id = new.live_verification_job_id
   for key share;
  select activation_epoch.* into authority
    from app.private_trusted_telebirr_activation_epochs activation_epoch
   where activation_epoch.epoch = new.activation_epoch
   for share;

  if resolved_customer_identity_id is null
    or resolved_customer_id is null
    or resolved_processed_at is not null
    or resolved_identity_status <> 'active'
    or resolved_customer_status <> 'active'
    or new.customer_identity_id is distinct from resolved_customer_identity_id
    or new.submitting_customer_id is distinct from resolved_customer_id
    or new.conversation_id is distinct from resolved_conversation_id
    or new.conversation_version is distinct from resolved_conversation_version
    or destination.origin_inbound_event_id is null
    or destination.customer_identity_id is distinct from new.customer_identity_id
    or destination.customer_id is distinct from new.submitting_customer_id
    or destination.conversation_id is distinct from new.conversation_id
    or destination.player_account_id is distinct from new.player_account_id
    or destination.receiver_account_id is distinct from new.receiver_account_id
    or destination.activation_epoch is distinct from new.activation_epoch
    or destination.payment_presentation_expires_at <= proof.submitted_at
    or proof.id is null
    or proof.submitting_customer_id is distinct from new.submitting_customer_id
    or proof.player_account_id is distinct from new.player_account_id
    or proof.payment_provider_id is distinct from new.payment_provider_id
    or proof.provider_code_snapshot <> 'telebirr'
    or proof.origin_channel <> 'telegram'
    or proof.input_kind <> 'direct_transaction_id'
    or verification_job.id is null
    or verification_job.private_live_deposit_pilot_proof_id is distinct from proof.id
    or verification_job.pilot_revision_id is distinct from proof.pilot_revision_id
    or verification_job.submitting_customer_id is distinct from proof.submitting_customer_id
    or verification_job.player_account_id is distinct from proof.player_account_id
    or verification_job.payment_provider_id is distinct from proof.payment_provider_id
    or verification_job.receiver_account_id is distinct from new.receiver_account_id
    or verification_job.provider_code <> 'telebirr'
    or verification_job.submitted_at is distinct from proof.submitted_at
    or authority.epoch is null
    or authority.pilot_revision_id is distinct from proof.pilot_revision_id
    or new.created_at is distinct from proof.submitted_at
    or exists (
      select 1 from app.inbound_event_consumptions consumption
       where consumption.origin_inbound_event_id = new.origin_inbound_event_id
    )
    or exists (
      select 1 from app.telegram_live_deposit_request_receipts receipt
       where receipt.origin_inbound_event_id = new.origin_inbound_event_id
    )
    or exists (
      select 1 from app.telegram_dry_run_deposit_proof_receipts receipt
       where receipt.origin_inbound_event_id = new.origin_inbound_event_id
    )
    or exists (
      select 1 from app.telegram_telebirr_shadow_proof_receipts receipt
       where receipt.origin_inbound_event_id = new.origin_inbound_event_id
    )
    or exists (
      select 1 from app.telegram_telebirr_destination_receipts receipt
       where receipt.origin_inbound_event_id = new.origin_inbound_event_id
    ) then
    raise exception 'The Telegram live TeleBirr proof receipt is unavailable.';
  end if;

  update app.inbound_events inbound_event
     set processed_at = new.created_at,
         processing_error_code = null
   where inbound_event.id = new.origin_inbound_event_id
     and inbound_event.processed_at is null;
  if not found then
    raise exception 'The Telegram live TeleBirr proof receipt is unavailable.';
  end if;

  return new;
end;
$$;

create trigger telegram_live_telebirr_proof_receipts_insert_guard
before insert on app.telegram_live_telebirr_proof_receipts
for each row execute function app.enforce_telegram_live_telebirr_proof_receipt_insert();

create function app.block_inbound_consumption_after_telegram_live_telebirr_proof()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform app.lock_telegram_inbound_event_scope(new.origin_inbound_event_id);
  if exists (
    select 1
      from app.telegram_live_telebirr_proof_receipts receipt
     where receipt.origin_inbound_event_id = new.origin_inbound_event_id
  ) then
    raise exception 'The Telegram inbound event already has another semantic receipt.';
  end if;
  return new;
end;
$$;

create trigger inbound_event_consumptions_block_live_telebirr_proof_reuse
before insert on app.inbound_event_consumptions
for each row execute function app.block_inbound_consumption_after_telegram_live_telebirr_proof();

create function app.capture_telegram_live_telebirr_proof(
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
  live_proof_id uuid,
  live_verification_job_id uuid,
  provider_code text,
  proof_status text,
  submitted_at timestamptz,
  request_replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  locked_epoch bigint;
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  switch_count integer;
  authority_at timestamptz;
  captured_at timestamptz;
  resolved_customer_identity_id uuid;
  resolved_customer_id uuid;
  resolved_conversation_id uuid;
  resolved_conversation_version bigint;
  resolved_identity_status app.record_status;
  resolved_customer_status app.record_status;
  resolved_processed_at timestamptz;
  player_member app.private_live_deposit_pilot_players%rowtype;
  provider_member app.private_live_deposit_pilot_providers%rowtype;
  current_player app.customer_platform_players%rowtype;
  current_eligibility app.player_deposit_eligibility_decisions%rowtype;
  current_provider app.payment_providers%rowtype;
  destination app.telegram_live_telebirr_payment_presentations%rowtype;
  existing_receipt app.telegram_live_telebirr_proof_receipts%rowtype;
  existing_proof app.private_live_deposit_pilot_proofs%rowtype;
  existing_job app.private_live_telebirr_verification_jobs%rowtype;
  inserted_proof app.private_live_deposit_pilot_proofs%rowtype;
  staged_job_id uuid;
  staged_pilot_revision_id uuid;
  staged_proof_id uuid;
  staged_expires_at timestamptz;
  staged_already boolean;
begin
  if p_origin_inbound_event_id is null
    or p_player_id is null
    or p_player_id <> pg_catalog.btrim(p_player_id)
    or pg_catalog.char_length(p_player_id) not between 1 and 64
    or p_player_id ~ '[[:space:][:cntrl:]]'
    or p_provider_code is distinct from 'telebirr'
    or p_reference_key_version is distinct from 2
    or p_reference_profile_version is distinct from 2
    or p_reference_ciphertext is null
    or p_reference_ciphertext <> pg_catalog.btrim(p_reference_ciphertext)
    or p_reference_ciphertext
       !~ '^v2\.telebirr\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11,43}$'
    or p_reference_fingerprint is null
    or p_reference_fingerprint <> pg_catalog.lower(p_reference_fingerprint)
    or p_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or p_reference_masked is null
    or p_reference_masked !~ '^\*{3}[A-Z0-9]{4}$'
    or p_semantic_input_hmac is null
    or p_semantic_input_hmac <> pg_catalog.lower(pg_catalog.btrim(p_semantic_input_hmac))
    or p_semantic_input_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The Telegram live TeleBirr proof request is invalid.';
  end if;

  -- Repository-wide financial lock order: authority, switches, pilot, then customer scope.
  select activation_control.current_epoch
    into locked_epoch
    from app.private_trusted_telebirr_activation_control activation_control
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
   for share;
  select activation_epoch.*
    into authority
    from app.private_trusted_telebirr_activation_epochs activation_epoch
   where activation_epoch.epoch = locked_epoch
   for share;
  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;
  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = authority.pilot_revision_id
   for update;

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);
  select inbound_event.customer_identity_id, inbound_event.processed_at
    into resolved_customer_identity_id, resolved_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;
  if resolved_customer_identity_id is null then
    raise exception 'The Telegram inbound event is unavailable for live TeleBirr verification.';
  end if;

  select identity.customer_id,
         identity.status,
         customer.status,
         conversation.id,
         conversation.version
    into resolved_customer_id,
         resolved_identity_status,
         resolved_customer_status,
         resolved_conversation_id,
         resolved_conversation_version
    from app.customer_identities identity
    join app.customers customer on customer.id = identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
     and identity.external_subject = telegram_identity.telegram_user_id::text
    join app.bot_conversations conversation
      on conversation.telegram_identity_id = identity.id
   where identity.id = resolved_customer_identity_id
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
  if resolved_customer_id is null then
    raise exception 'The Telegram customer is unavailable for live TeleBirr verification.';
  end if;

  select receipt.* into existing_receipt
    from app.telegram_live_telebirr_proof_receipts receipt
   where receipt.origin_inbound_event_id = p_origin_inbound_event_id;

  if existing_receipt.origin_inbound_event_id is not null then
    select proof.* into existing_proof
      from app.private_live_deposit_pilot_proofs proof
      join app.private_live_deposit_pilot_players member
        on member.pilot_revision_id = proof.pilot_revision_id
       and member.player_account_id = proof.player_account_id
     where proof.id = existing_receipt.live_proof_id
       and member.player_id_snapshot = p_player_id;
    select job.* into existing_job
      from app.private_live_telebirr_verification_jobs job
     where job.id = existing_receipt.live_verification_job_id;

    if existing_proof.id is null
      or existing_job.id is null
      or existing_receipt.customer_identity_id is distinct from resolved_customer_identity_id
      or existing_receipt.submitting_customer_id is distinct from resolved_customer_id
      or existing_receipt.conversation_id is distinct from resolved_conversation_id
      or existing_receipt.created_at is distinct from resolved_processed_at
      or existing_receipt.semantic_input_hmac is distinct from p_semantic_input_hmac
      or existing_proof.candidate_reference_ciphertext is distinct from p_reference_ciphertext
      or existing_proof.candidate_reference_fingerprint is distinct from p_reference_fingerprint
      or existing_proof.candidate_reference_masked is distinct from p_reference_masked
      or existing_proof.reference_encryption_key_version is distinct from p_reference_key_version
      or existing_proof.reference_profile_version is distinct from p_reference_profile_version
      or existing_job.private_live_deposit_pilot_proof_id is distinct from existing_proof.id then
      raise exception 'The replayed Telegram live TeleBirr proof conflicts with its receipt.';
    end if;

    return query
    select existing_proof.id,
           existing_job.id,
           'telebirr'::text,
           'verification_pending'::text,
           existing_proof.submitted_at,
           true;
    return;
  end if;

  authority_at := pg_catalog.clock_timestamp();
  if resolved_processed_at is not null
    or resolved_identity_status <> 'active'
    or resolved_customer_status <> 'active'
    or authority.epoch is null
    or authority.epoch <= 0
    or authority.authority_state <> 'active'
    or authority.revoked_at is not null
    or authority_at < authority.active_from
    or authority_at >= authority.expires_at
    or exists (
      select 1
        from app.private_trusted_telebirr_emergency_disable_intents emergency_intent
       where emergency_intent.expected_epoch = authority.epoch
    )
    or pilot.id is null
    or pilot.id is distinct from authority.pilot_revision_id
    or pilot.status <> 'armed'
    or pilot.configuration_digest is distinct from authority.configuration_digest
    or pilot.active_from is distinct from authority.active_from
    or pilot.expires_at is distinct from authority.expires_at
    or authority_at < pilot.active_from
    or authority_at >= pilot.expires_at
    or switch_count <> 5
    or not exists (
      select 1 from app.feature_switches feature_switch
       where feature_switch.feature_key = 'cbe_birr_authoritative_verification'
         and feature_switch.mode = 'disabled'
         and feature_switch.settings = '{}'::jsonb
    )
    or (
      select pg_catalog.count(*)
        from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'deposit_execution', 'payment_verification', 'telebirr_authoritative_verification'
       )
         and feature_switch.mode = 'live'
         and feature_switch.settings = '{}'::jsonb
    ) <> 3
    or not exists (
      select 1 from app.feature_switches feature_switch
       where feature_switch.feature_key = 'private_live_deposit_pilot'
         and feature_switch.mode = 'live'
         and feature_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    )
    or exists (
      select 1 from app.inbound_event_consumptions consumption
       where consumption.origin_inbound_event_id = p_origin_inbound_event_id
    ) then
    raise exception 'The live Telegram TeleBirr verification authority is unavailable.';
  end if;

  select member.* into player_member
    from app.private_live_deposit_pilot_players member
   where member.pilot_revision_id = pilot.id
     and member.player_id_snapshot = p_player_id
   for share;
  select member.* into provider_member
    from app.private_live_deposit_pilot_providers member
   where member.pilot_revision_id = pilot.id
     and member.provider_code_snapshot = 'telebirr'
   for share;
  select player.* into current_player
    from app.customer_platform_players player
   where player.id = player_member.player_account_id
   for share;
  select decision.* into current_eligibility
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = player_member.player_account_id
   order by decision.decision_version desc
   limit 1
   for share;
  select provider.* into current_provider
    from app.payment_providers provider
   where provider.id = provider_member.payment_provider_id
   for share;
  select live_presentation.* into destination
    from app.telegram_live_telebirr_payment_presentations live_presentation
   where live_presentation.customer_identity_id = resolved_customer_identity_id
     and live_presentation.customer_id = resolved_customer_id
     and live_presentation.conversation_id = resolved_conversation_id
     and live_presentation.player_account_id = player_member.player_account_id
     and live_presentation.receiver_account_id = provider_member.receiver_account_id
     and live_presentation.activation_epoch = authority.epoch
     and authority_at < live_presentation.payment_presentation_expires_at
   order by live_presentation.created_at desc,
            live_presentation.origin_inbound_event_id desc
   limit 1
   for share;

  if player_member.player_account_id is null
    or provider_member.payment_provider_id is null
    or destination.origin_inbound_event_id is null
    or not exists (
      select 1
        from app.private_live_deposit_pilot_customers member
        join app.customers customer on customer.id = member.customer_id
       where member.pilot_revision_id = pilot.id
         and member.customer_id = resolved_customer_id
         and member.customer_status_snapshot = 'active'
         and customer.status = member.customer_status_snapshot
         and customer.updated_at is not distinct from member.customer_updated_at_snapshot
    )
    or current_player.id is null
    or current_player.status <> 'active'
    or current_player.validation_status <> 'valid'
    or current_player.customer_id is distinct from player_member.player_owner_customer_id_snapshot
    or current_player.updated_at is distinct from player_member.player_updated_at_snapshot
    or current_eligibility.id is distinct from player_member.eligibility_decision_id_snapshot
    or current_eligibility.decision_version
       is distinct from player_member.eligibility_decision_version_snapshot
    or current_eligibility.decided_at is distinct from player_member.eligibility_decided_at_snapshot
    or current_eligibility.player_account_updated_at_snapshot is distinct from current_player.updated_at
    or current_eligibility.decision <> 'eligible'
    or current_provider.id is null
    or current_provider.code <> 'telebirr'
    or current_provider.status <> 'active'
    or current_provider.updated_at is distinct from provider_member.provider_updated_at_snapshot then
    raise exception 'The live Telegram TeleBirr proof boundary is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:live-proof:v1:'
        || provider_member.payment_provider_id::text || ':' || p_reference_fingerprint,
      0::bigint
    )
  );
  select proof.* into existing_proof
    from app.private_live_deposit_pilot_proofs proof
   where proof.payment_provider_id = provider_member.payment_provider_id
     and proof.candidate_reference_fingerprint = p_reference_fingerprint
   for share;

  authority_at := pg_catalog.clock_timestamp();
  captured_at := pg_catalog.date_trunc('milliseconds', authority_at);
  if existing_proof.id is not null
    or authority_at < authority.active_from
    or authority_at >= authority.expires_at
    or authority_at < pilot.active_from
    or authority_at >= pilot.expires_at
    or authority_at >= destination.payment_presentation_expires_at then
    raise exception 'The live Telegram TeleBirr proof boundary is unavailable.';
  end if;

  insert into app.private_live_deposit_pilot_proofs (
    pilot_revision_id,
    submitting_customer_id,
    player_account_id,
    payment_provider_id,
    provider_code_snapshot,
    origin_channel,
    input_kind,
    candidate_reference_ciphertext,
    candidate_reference_fingerprint,
    candidate_reference_masked,
    reference_encryption_key_version,
    reference_profile_version,
    submitted_at
  ) values (
    pilot.id,
    resolved_customer_id,
    player_member.player_account_id,
    provider_member.payment_provider_id,
    'telebirr',
    'telegram',
    'direct_transaction_id',
    p_reference_ciphertext,
    p_reference_fingerprint,
    p_reference_masked,
    p_reference_key_version,
    p_reference_profile_version,
    captured_at
  ) returning * into inserted_proof;

  select staged.verification_job_id,
         staged.pilot_revision_id,
         staged.private_live_deposit_pilot_proof_id,
         staged.expires_at,
         staged.already_staged
    into staged_job_id,
         staged_pilot_revision_id,
         staged_proof_id,
         staged_expires_at,
         staged_already
    from app.stage_private_live_telebirr_verification_job(
      inserted_proof.id,
      pg_catalog.gen_random_uuid()
    ) staged;

  if staged_job_id is null
    or staged_pilot_revision_id is distinct from pilot.id
    or staged_proof_id is distinct from inserted_proof.id
    or staged_expires_at <= inserted_proof.submitted_at
    or staged_already is not false then
    raise exception 'The live Telegram TeleBirr verifier handoff is unavailable.';
  end if;

  insert into app.telegram_live_telebirr_proof_receipts (
    origin_inbound_event_id,
    live_presentation_origin_inbound_event_id,
    customer_identity_id,
    submitting_customer_id,
    conversation_id,
    player_account_id,
    payment_provider_id,
    receiver_account_id,
    live_proof_id,
    live_verification_job_id,
    activation_epoch,
    semantic_input_hmac,
    conversation_version,
    created_at
  ) values (
    p_origin_inbound_event_id,
    destination.origin_inbound_event_id,
    resolved_customer_identity_id,
    resolved_customer_id,
    resolved_conversation_id,
    player_member.player_account_id,
    provider_member.payment_provider_id,
    provider_member.receiver_account_id,
    inserted_proof.id,
    staged_job_id,
    authority.epoch,
    p_semantic_input_hmac,
    resolved_conversation_version,
    inserted_proof.submitted_at
  );

  insert into app.audit_events (
    actor_kind,
    actor_customer_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'customer',
    resolved_customer_id,
    'deposit.telebirr_live_proof_received',
    'private_live_deposit_pilot_proof',
    inserted_proof.id,
    pg_catalog.jsonb_build_object(
      'channel', 'telegram',
      'provider_code', 'telebirr',
      'financial_mode', 'live',
      'activation_epoch', authority.epoch,
      'reference_profile_version', p_reference_profile_version
    )
  );

  return query
  select inserted_proof.id,
         staged_job_id,
         'telebirr'::text,
         'verification_pending'::text,
         inserted_proof.submitted_at,
         false;
end;
$$;

create function app.get_telegram_customer_live_telebirr_proof(
  p_origin_inbound_event_id uuid,
  p_live_proof_id uuid
)
returns table (
  live_proof_id uuid,
  provider_code text,
  deposit_status text,
  amount_minor bigint,
  currency_code text,
  submitted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  resolved_customer_id uuid;
  resolved_identity_id uuid;
  resolved_conversation_id uuid;
begin
  if p_origin_inbound_event_id is null or p_live_proof_id is null then
    raise exception 'The Telegram live TeleBirr status request is unavailable.';
  end if;

  select identity.customer_id, identity.id, conversation.id
    into resolved_customer_id, resolved_identity_id, resolved_conversation_id
    from app.inbound_events inbound_event
    join app.customer_identities identity
      on identity.id = inbound_event.customer_identity_id
    join app.customers customer on customer.id = identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
     and identity.external_subject = telegram_identity.telegram_user_id::text
    join app.bot_conversations conversation
      on conversation.telegram_identity_id = identity.id
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
     and identity.identity_kind = 'telegram'
     and identity.status = 'active'
     and customer.status = 'active'
     and exists (
       select 1
         from app.telegram_beta_invites invite
        where invite.status = 'redeemed'
          and invite.redeemed_customer_id = identity.customer_id
          and invite.redeemed_customer_identity_id = identity.id
          and invite.redeemed_telegram_user_id = telegram_identity.telegram_user_id
          and invite.redeemed_private_chat_id = telegram_identity.private_chat_id
     );
  if not found then
    raise exception 'The Telegram live TeleBirr status request is unavailable.';
  end if;

  return query
  select proof.id,
         'telebirr'::text,
         case
           when outcome.disposition = 'settlement_candidate' and intent.id is not null
             then intent.status::text
           when outcome.disposition = 'definite_reject' then 'rejected'::text
           when outcome.disposition = 'review_required' then 'verification_review'::text
           when outcome.disposition = 'settlement_candidate' then 'verification_review'::text
           when pg_catalog.statement_timestamp() >= job.expires_at
             then 'verification_review'::text
           else 'verification_pending'::text
         end,
         case
           when outcome.disposition = 'settlement_candidate'
             then outcome.principal_amount_minor
           else null::bigint
         end,
         case
           when outcome.disposition = 'settlement_candidate'
             then outcome.currency_code::text
           else null::text
         end,
         proof.submitted_at
    from app.telegram_live_telebirr_proof_receipts receipt
    join app.private_live_deposit_pilot_proofs proof
      on proof.id = receipt.live_proof_id
     and proof.submitting_customer_id = receipt.submitting_customer_id
     and proof.player_account_id = receipt.player_account_id
     and proof.payment_provider_id = receipt.payment_provider_id
     and proof.provider_code_snapshot = 'telebirr'
    join app.private_live_telebirr_verification_jobs job
      on job.id = receipt.live_verification_job_id
     and job.private_live_deposit_pilot_proof_id = proof.id
    left join app.private_live_telebirr_verification_outcomes outcome
      on outcome.verification_job_id = job.id
     and outcome.private_live_deposit_pilot_proof_id = proof.id
    left join app.deposit_intents intent
      on intent.id = outcome.deposit_intent_id
     and intent.private_live_telebirr_outcome_id = outcome.id
   where receipt.live_proof_id = p_live_proof_id
     and receipt.customer_identity_id = resolved_identity_id
     and receipt.submitting_customer_id = resolved_customer_id
     and receipt.conversation_id = resolved_conversation_id;
end;
$$;

alter table app.telegram_live_telebirr_payment_presentations owner to postgres;
alter table app.telegram_live_telebirr_proof_receipts owner to postgres;
alter function app.prepare_telegram_live_telebirr_destination(uuid, text, text) owner to postgres;
alter function app.enforce_telegram_live_telebirr_proof_receipt_insert() owner to postgres;
alter function app.block_inbound_consumption_after_telegram_live_telebirr_proof() owner to postgres;
alter function app.capture_telegram_live_telebirr_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) owner to postgres;
alter function app.get_telegram_customer_live_telebirr_proof(uuid, uuid) owner to postgres;

revoke all on table
  app.telegram_live_telebirr_payment_presentations,
  app.telegram_live_telebirr_proof_receipts
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
  fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
  fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
  fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
  fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

revoke all on function
  app.prepare_telegram_live_telebirr_destination(uuid, text, text),
  app.enforce_telegram_live_telebirr_proof_receipt_insert(),
  app.block_inbound_consumption_after_telegram_live_telebirr_proof(),
  app.capture_telegram_live_telebirr_proof(
    uuid, text, text, text, text, text, smallint, smallint, text
  ),
  app.get_telegram_customer_live_telebirr_proof(uuid, uuid)
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
  fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
  fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
  fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
  fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

grant usage on schema app to fetanagent_player_actions;
grant execute on function
  app.prepare_telegram_live_telebirr_destination(uuid, text, text),
  app.capture_telegram_live_telebirr_proof(
    uuid, text, text, text, text, text, smallint, smallint, text
  ),
  app.get_telegram_customer_live_telebirr_proof(uuid, uuid)
to fetanagent_player_actions;

comment on table app.telegram_live_telebirr_payment_presentations is
  'Immutable proof that the trusted API requested a real, activation-bound TeleBirr payment prompt. Review-only destination receipts never enter this table.';
comment on table app.telegram_live_telebirr_proof_receipts is
  'Immutable private-Telegram identity binding from one live payment presentation and one inbound reference to one private-pilot proof and verifier job.';
comment on function app.prepare_telegram_live_telebirr_destination(uuid, text, text) is
  'Creates the additional immutable real-payment presentation receipt only while exact trusted TeleBirr authority is current. It does not accept proof, settle, or execute.';
comment on function app.capture_telegram_live_telebirr_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) is
  'The only player-action role boundary from a fresh, matching live Telegram payment presentation to one protected private-pilot proof and its existing TeleBirr verifier job.';
comment on function app.get_telegram_customer_live_telebirr_proof(uuid, uuid) is
  'Read-only customer-safe live TeleBirr status scoped to the exact private Telegram identity and immutable original proof receipt. It creates no financial state.';

commit;
