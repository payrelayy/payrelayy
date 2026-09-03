-- Private read-only Telegram tracking for immutable dry-run deposit proofs.
-- The status-command inbound event identifies the active requesting Telegram identity.
-- An exact original Telegram receipt must bind that identity to the requested proof.
-- This lookup grants no capture, verification, settlement, or execution authority.

begin;

create function app.get_telegram_customer_deposit_proof(
  p_origin_inbound_event_id uuid,
  p_deposit_proof_request_id uuid
)
returns table (
  deposit_proof_request_id uuid,
  provider_code text,
  proof_status text,
  submitted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_customer_id uuid;
  resolved_identity_id uuid;
  resolved_conversation_id uuid;
begin
  if p_origin_inbound_event_id is null or p_deposit_proof_request_id is null then
    raise exception 'The Telegram deposit proof status request is unavailable.'
      using errcode = 'P0001';
  end if;

  select customer_identity.customer_id,
         customer_identity.id,
         conversation.id
    into resolved_customer_id,
         resolved_identity_id,
         resolved_conversation_id
    from app.inbound_events inbound_event
    join app.customer_identities customer_identity
      on customer_identity.id = inbound_event.customer_identity_id
    join app.customers customer
      on customer.id = customer_identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = customer_identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
     and customer_identity.external_subject = telegram_identity.telegram_user_id::text
    join app.bot_conversations conversation
      on conversation.telegram_identity_id = customer_identity.id
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
     and customer_identity.identity_kind = 'telegram'
     and customer_identity.status = 'active'
     and customer.status = 'active';

  if not found then
    raise exception 'The Telegram deposit proof status request is unavailable.'
      using errcode = 'P0001';
  end if;

  -- EXISTS keeps repeated submissions of one proof from duplicating its status result.
  -- Do not require the status-command event itself to be the original proof submission.
  return query
  select proof_request.id,
         proof_request.provider_code,
         proof_request.status,
         proof_request.submitted_at
    from app.deposit_proof_requests proof_request
   where proof_request.id = p_deposit_proof_request_id
     and proof_request.submitting_customer_id = resolved_customer_id
     and proof_request.origin_channel = 'telegram'
     and proof_request.status = 'proof_received'
     and exists (
       select 1
         from app.telegram_dry_run_deposit_proof_receipts receipt
         join app.inbound_events proof_inbound_event
           on proof_inbound_event.id = receipt.origin_inbound_event_id
          and proof_inbound_event.channel = 'telegram'
          and proof_inbound_event.customer_identity_id = receipt.customer_identity_id
          and proof_inbound_event.processed_at = receipt.created_at
        where receipt.deposit_proof_request_id = proof_request.id
          and receipt.submitting_customer_id = resolved_customer_id
          and receipt.customer_identity_id = resolved_identity_id
          and receipt.conversation_id = resolved_conversation_id
     );
end;
$$;

alter function app.get_telegram_customer_deposit_proof(uuid, uuid) owner to postgres;

revoke all on function app.get_telegram_customer_deposit_proof(uuid, uuid)
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

grant execute on function app.get_telegram_customer_deposit_proof(uuid, uuid)
to fetanagent_player_actions;

comment on function app.get_telegram_customer_deposit_proof(uuid, uuid) is
  'Read-only safe status of an immutable dry-run Telegram proof, scoped to the active exact Telegram identity resolved from a recorded inbound event and its original bound proof receipt. Creates no financial state.';

commit;
