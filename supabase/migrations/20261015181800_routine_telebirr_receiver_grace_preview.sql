-- Dormant receiver-rotation review preview. Its inputs are NOT receipt authentication.
-- No application role can invoke it, and a positive preview never authorizes a claim.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $preflight$
begin
  if (select pg_catalog.count(*) from app.feature_switches switch
       where switch.feature_key in ('payment_verification', 'deposit_execution')
         and switch.mode = 'disabled' and switch.settings = '{}'::jsonb) <> 2 then
    raise exception 'Install receiver-grace preview only with TeleBirr financial gates off.';
  end if;
end;
$preflight$;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

-- This private, append-only record is a fail-closed veto. A later reviewed Owner workflow must
-- record it under the same financial lock as the paid claim; no runtime write is granted here.
create table app.routine_telebirr_receiver_grace_revocations (
  receiver_account_id uuid primary key
    references app.receiver_accounts(id) on delete restrict,
  revoked_at timestamptz not null default pg_catalog.clock_timestamp(),
  revoked_by_admin_id uuid not null
    references app.admin_users(id) on delete restrict,
  reason_code text not null
    check (reason_code in ('emergency_stop', 'receiver_compromised'))
);
create trigger routine_telebirr_receiver_grace_revocations_immutable
before update or delete on app.routine_telebirr_receiver_grace_revocations
for each row execute function app.reject_routine_telebirr_untrusted_proof_mutation();
create trigger routine_telebirr_receiver_grace_revocations_no_truncate
before truncate on app.routine_telebirr_receiver_grace_revocations
for each statement execute function app.reject_routine_telebirr_untrusted_proof_mutation();
alter table app.routine_telebirr_receiver_grace_revocations owner to postgres;
alter table app.routine_telebirr_receiver_grace_revocations enable row level security;
alter table app.routine_telebirr_receiver_grace_revocations force row level security;
revoke all on table app.routine_telebirr_receiver_grace_revocations
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

create index telegram_routine_grace_instruction_lookup_idx
  on app.telegram_telebirr_destination_receipts
    (customer_identity_id, player_account_id, payment_presentation_expires_at,
     receiver_account_id)
  where routine_processing_authorization_id is not null;

-- PostgreSQL reads the durable candidate and Telegram instruction; the caller cannot nominate
-- an old instruction or receiver. The digest, suffix, and occurrence time arguments are still
-- untrusted until a separate signed-phone and official-source boundary verifies them. Therefore
-- this function is postgres-only, read-only, and always returns financial_action_allowed=false.
create function app.preview_routine_telebirr_direct_receiver_grace(
  p_candidate_id uuid,
  p_credited_party_name_digest text,
  p_credited_party_visible_suffix text,
  p_payment_occurred_at timestamptz
)
returns table (
  disposition text,
  reason_code text,
  matched_instruction_event_id uuid,
  matched_receiver_account_id uuid,
  financial_action_allowed boolean
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_candidate app.routine_telebirr_untrusted_proof_requests%rowtype;
  v_chat_id bigint;
  v_receiver app.receiver_accounts%rowtype;
  v_receiver_id uuid;
  v_receiver_matches integer;
  v_instruction_matches integer;
  v_instruction_id uuid;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Receiver-grace preview is unavailable.';
  end if;
  if p_candidate_id is null
    or p_credited_party_name_digest is null
    or p_credited_party_name_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_credited_party_visible_suffix is null
    or p_credited_party_visible_suffix !~ '^[0-9]{4}$'
    or p_payment_occurred_at is null then
    return query select 'would_review'::text, 'invalid_input'::text,
      null::uuid, null::uuid, false;
    return;
  end if;

  select candidate.* into v_candidate
    from app.routine_telebirr_untrusted_proof_requests candidate
    join app.inbound_events inbound_event
      on inbound_event.id = candidate.origin_request_key
     and inbound_event.channel = 'telegram'
     and inbound_event.customer_identity_id = candidate.origin_identity_id
     and inbound_event.processed_at = candidate.submitted_at
    join app.customer_identities identity
      on identity.id = candidate.origin_identity_id
     and identity.customer_id = candidate.submitting_customer_id
     and identity.identity_kind = 'telegram'
   where candidate.id = p_candidate_id
     and candidate.origin_channel = 'telegram'
     and candidate.intake_mode = 'paid'
     and candidate.provider_code = 'telebirr';
  select telegram.private_chat_id into v_chat_id
    from app.telegram_identities telegram
   where telegram.customer_identity_id = v_candidate.origin_identity_id
     and telegram.private_chat_id = telegram.telegram_user_id;
  if v_candidate.id is null or v_chat_id is null
    or p_payment_occurred_at > v_candidate.submitted_at
    or v_candidate.submitted_at > pg_catalog.clock_timestamp() + interval '5 seconds' then
    return query select 'would_review'::text, 'candidate_unavailable'::text,
      null::uuid, null::uuid, false;
    return;
  end if;

  -- The receiver identity must be unique across *all* configured immutable revisions,
  -- including the active one. A name/suffix collision must never pick the old wallet.
  select pg_catalog.count(*)::integer, (pg_catalog.array_agg(receiver.id))[1]
    into v_receiver_matches, v_receiver_id
    from app.receiver_accounts receiver
   where receiver.provider_id = v_candidate.payment_provider_id
     and receiver.account_reference_masked ~ '^\*{3}[0-9]{4}$'
     and pg_catalog.right(receiver.account_reference_masked, 4) =
       p_credited_party_visible_suffix
     and app.routine_telebirr_receiver_name_digest(receiver.account_holder_name) =
       p_credited_party_name_digest;
  if v_receiver_matches <> 1 then
    return query select 'would_review'::text,
      case when v_receiver_matches = 0 then 'receiver_mismatch' else 'receiver_ambiguous' end,
      null::uuid, null::uuid, false;
    return;
  end if;
  select receiver.* into v_receiver from app.receiver_accounts receiver
   where receiver.id = v_receiver_id;
  if v_receiver.status <> 'inactive' or v_receiver.retired_at is null then
    return query select 'would_review'::text, 'not_retired_receiver'::text,
      null::uuid, null::uuid, false;
    return;
  end if;
  if exists (
    select 1 from app.routine_telebirr_receiver_grace_revocations revocation
     where revocation.receiver_account_id = v_receiver.id
  ) then
    return query select 'would_review'::text, 'emergency_revoked'::text,
      null::uuid, null::uuid, false;
    return;
  end if;

  select pg_catalog.count(*)::integer,
         (pg_catalog.array_agg(receipt.origin_inbound_event_id))[1]
    into v_instruction_matches, v_instruction_id
    from app.telegram_telebirr_destination_receipts receipt
    join app.telegram_payment_instruction_messages message
      on message.origin_inbound_event_id = receipt.origin_inbound_event_id
     and message.private_chat_id = v_chat_id
     and message.expires_at = receipt.payment_presentation_expires_at
    join app.bot_conversations conversation
      on conversation.id = receipt.conversation_id
     and conversation.telegram_identity_id = v_candidate.origin_identity_id
   where receipt.customer_identity_id = v_candidate.origin_identity_id
     and receipt.customer_id = v_candidate.submitting_customer_id
     and receipt.player_account_id = v_candidate.player_account_id
     and receipt.receiver_account_id = v_receiver.id
     and receipt.routine_processing_authorization_id is not null
     and receipt.payment_presentation_expires_at = receipt.created_at + interval '1 hour'
     and receipt.created_at >= v_receiver.active_from
     and v_receiver.retired_at >= receipt.created_at
     and v_receiver.retired_at < receipt.payment_presentation_expires_at
     and p_payment_occurred_at >= receipt.created_at
     and p_payment_occurred_at < receipt.payment_presentation_expires_at
     and v_candidate.submitted_at >= p_payment_occurred_at
     and v_candidate.submitted_at < receipt.payment_presentation_expires_at;
  if v_instruction_matches <> 1 then
    return query select 'would_review'::text,
      case when v_instruction_matches = 0 then 'instruction_not_found'
        else 'instruction_ambiguous' end,
      null::uuid, null::uuid, false;
    return;
  end if;
  return query select 'would_match_one_instruction'::text, 'one_instruction_matches'::text,
    v_instruction_id, v_receiver.id, false;
end;
$$;
alter function app.preview_routine_telebirr_direct_receiver_grace(uuid,text,text,timestamptz)
  owner to postgres;
revoke all on function app.preview_routine_telebirr_direct_receiver_grace(
  uuid,text,text,timestamptz)
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

comment on function app.preview_routine_telebirr_direct_receiver_grace(
  uuid,text,text,timestamptz) is
  'Advisory-only, postgres-only direct Telegram receiver-grace preview. Caller facts are not source-authenticated; financial_action_allowed is always false.';
commit;
