-- Preserve the no-money implementation while routing the existing, narrowly
-- granted Telegram RPC to a distinct paid intake only under current authority.
-- A paid candidate remains untrusted: this creates no receipt observation,
-- verification attempt, global payment claim, execution job, or credit.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

alter function app.capture_telegram_routine_telebirr_untrusted_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) rename to capture_telegram_routine_telebirr_no_money_core;
revoke all on function app.capture_telegram_routine_telebirr_no_money_core(
  uuid, text, text, text, text, text, smallint, smallint, text
) from public, anon, authenticated, service_role,
  fetanagent_player_actions, fetanagent_player_actions_runtime,
  fetanagent_api, fetanagent_api_runtime,
  fetanagent_customer_web, fetanagent_customer_web_runtime,
  fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;

create function app.capture_telegram_routine_telebirr_untrusted_proof(
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
  proof_request_id uuid,
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
  v_switch_count integer;
  v_disabled_count integer;
  v_paid_gate_count integer;
  v_authorized_at timestamptz;
  v_authorized_platform_id uuid;
  v_identity_id uuid;
  v_customer_id uuid;
  v_processed_at timestamptz;
  v_identity_status app.record_status;
  v_customer_status app.record_status;
  v_conversation_id uuid;
  v_existing app.routine_telebirr_untrusted_proof_requests%rowtype;
  v_platform_id uuid;
  v_player_account_id uuid;
  v_player_customer_id uuid;
  v_player_id text;
  v_eligibility_id uuid;
  v_provider_id uuid;
  v_resolved_provider_code text;
  v_receiver_id uuid;
  v_captured_at timestamptz;
  v_inserted app.routine_telebirr_untrusted_proof_requests%rowtype;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'The routine Telegram candidate boundary is unavailable.';
  end if;

  -- Match the issuer and Owner stop/save lock order. The signed reference is
  -- protected before this call; never select or return plaintext from here.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004)
  );
  perform 1 from app.private_trusted_telebirr_activation_control control
   where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The routine TeleBirr boundary is unavailable.'; end if;
  perform feature_switch.feature_key from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification', 'deposit_execution',
     'payment_verification', 'private_live_deposit_pilot',
     'telebirr_authoritative_verification', 'withdrawal_collection',
     'withdrawal_validation'
   ) order by feature_switch.feature_key for update;
  get diagnostics v_switch_count = row_count;
  select pg_catalog.count(*)::integer into v_disabled_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification', 'deposit_execution',
     'payment_verification', 'private_live_deposit_pilot',
     'telebirr_authoritative_verification', 'withdrawal_collection',
     'withdrawal_validation'
   ) and feature_switch.mode = 'disabled'
     and feature_switch.settings = '{}'::jsonb;
  if v_switch_count <> 7 then
    raise exception 'The routine TeleBirr switch set is unavailable.';
  end if;
  if v_disabled_count = 7 then
    -- A paid event must never be presented as a no-money rehearsal after the
    -- financial gates are turned back off.
    if exists (
      select 1 from app.routine_telebirr_untrusted_proof_requests proof
       where proof.origin_channel = 'telegram'
         and proof.origin_request_key = p_origin_inbound_event_id
         and proof.intake_mode = 'paid'
    ) then
      raise exception 'A paid routine candidate cannot be replayed as no-money.';
    end if;
    return query
      select core.proof_request_id, core.provider_code, core.proof_status,
             core.submitted_at, core.request_replayed
        from app.capture_telegram_routine_telebirr_no_money_core(
          p_origin_inbound_event_id, p_player_id, p_provider_code,
          p_reference_ciphertext, p_reference_fingerprint, p_reference_masked,
          p_reference_key_version, p_reference_profile_version,
          p_semantic_input_hmac
        ) core;
    return;
  end if;

  -- The old TeleBirr authority switch is inseparable from the retired pilot.
  -- Routine TeleBirr instead requires the shared live deposit gates and the
  -- current Owner authorization, leaving CBE/withdrawal switches independent.
  select pg_catalog.count(*)::integer into v_paid_gate_count
    from app.feature_switches feature_switch
   where (feature_switch.feature_key in ('payment_verification', 'deposit_execution')
       and feature_switch.mode = 'live')
      or (feature_switch.feature_key in (
          'private_live_deposit_pilot', 'telebirr_authoritative_verification')
        and feature_switch.mode = 'disabled');
  if v_paid_gate_count <> 4 then
    raise exception 'The paid routine TeleBirr intake is unavailable.';
  end if;

  select authority.authorized_at, platform.id
    into v_authorized_at, v_authorized_platform_id
    from app.routine_telebirr_processing_events event
    join app.routine_telebirr_processing_authorizations authority
      on authority.id = event.authorization_id
    join app.admin_users owner_user on owner_user.id = authority.authorized_by_admin_id
    join app.platform_agent_accounts agent
      on agent.id = authority.platform_agent_account_id
    join app.platforms platform on platform.id = agent.platform_id
    join app.deposit_policy_versions policy
      on policy.id = authority.deposit_policy_version_id
   where event.event_sequence = (
       select pg_catalog.max(latest.event_sequence)
         from app.routine_telebirr_processing_events latest)
     and event.event_kind = 'authorize'
     and owner_user.role = 'owner' and owner_user.status = 'active'
     and agent.status = 'active'
     and platform.code = 'kemerbet' and platform.status = 'active'
     and policy.status = 'active'
     and policy.minimum_amount_minor = authority.minimum_amount_minor
     and policy.maximum_amount_minor = authority.maximum_amount_minor
     and policy.freshness_window_seconds = authority.freshness_window_seconds
     and policy.minimum_amount_minor = 2500
     and policy.maximum_amount_minor = 2500000
     and policy.freshness_window_seconds = 3600
   for share of authority, owner_user, agent, platform, policy;
  if v_authorized_at is null then
    raise exception 'The current Owner routine authorization is unavailable.';
  end if;

  if p_origin_inbound_event_id is null
    or p_origin_inbound_event_id::text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_player_id is null or p_player_id <> pg_catalog.btrim(p_player_id)
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
    or p_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or p_reference_masked is null
    or p_reference_masked !~ '^\*{3}[A-Z0-9]{4}$'
    or p_semantic_input_hmac is null
    or p_semantic_input_hmac <> pg_catalog.lower(pg_catalog.btrim(p_semantic_input_hmac))
    or p_semantic_input_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The paid routine Telegram candidate request is invalid.';
  end if;

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);
  select inbound_event.customer_identity_id, inbound_event.processed_at
    into v_identity_id, v_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram' for update;
  if v_identity_id is null then
    raise exception 'The paid routine Telegram event is unavailable.';
  end if;
  select identity.customer_id, identity.status, customer.status, conversation.id
    into v_customer_id, v_identity_status, v_customer_status, v_conversation_id
    from app.customer_identities identity
    join app.customers customer on customer.id = identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
     and identity.external_subject = telegram_identity.telegram_user_id::text
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
     ) for update of identity, customer, telegram_identity, conversation;
  if v_customer_id is null or v_identity_status <> 'active'
    or v_customer_status <> 'active' then
    raise exception 'The paid routine Telegram customer is unavailable.';
  end if;

  select proof.* into v_existing
    from app.routine_telebirr_untrusted_proof_requests proof
   where proof.origin_channel = 'telegram'
     and proof.origin_identity_id = v_identity_id
     and proof.origin_request_key = p_origin_inbound_event_id;
  if v_existing.id is not null then
    select player.player_id, player.customer_id
      into v_player_id, v_player_customer_id
      from app.customer_platform_players player
     where player.id = v_existing.player_account_id;
    if v_existing.intake_mode <> 'paid'
      or v_existing.submitting_customer_id is distinct from v_customer_id
      or v_existing.semantic_input_hmac is distinct from p_semantic_input_hmac
      or v_existing.candidate_reference_fingerprint is distinct from p_reference_fingerprint
      or v_existing.candidate_reference_masked is distinct from p_reference_masked
      or v_existing.reference_encryption_key_version is distinct from p_reference_key_version
      or v_existing.reference_profile_version is distinct from p_reference_profile_version
      or v_existing.submitted_at is distinct from v_processed_at
      or v_existing.submitted_at < v_authorized_at
      or v_player_customer_id is distinct from v_customer_id
      or v_player_id is distinct from p_player_id then
      raise exception 'The paid routine Telegram candidate replay conflicts.';
    end if;
    return query select v_existing.id, 'telebirr'::text,
                        'paid_pending'::text, v_existing.submitted_at, true;
    return;
  end if;

  if v_processed_at is not null
    or exists (select 1 from app.inbound_event_consumptions consumption
      where consumption.origin_inbound_event_id = p_origin_inbound_event_id)
    or exists (select 1 from app.telegram_live_deposit_request_receipts receipt
      where receipt.origin_inbound_event_id = p_origin_inbound_event_id)
    or exists (select 1 from app.telegram_dry_run_deposit_proof_receipts receipt
      where receipt.origin_inbound_event_id = p_origin_inbound_event_id)
    or exists (select 1 from app.telegram_telebirr_shadow_proof_receipts receipt
      where receipt.origin_inbound_event_id = p_origin_inbound_event_id)
    or exists (select 1 from app.telegram_live_telebirr_proof_receipts receipt
      where receipt.origin_inbound_event_id = p_origin_inbound_event_id)
    or exists (select 1 from app.telegram_telebirr_destination_receipts receipt
      where receipt.origin_inbound_event_id = p_origin_inbound_event_id) then
    raise exception 'The paid routine Telegram event already has another action.';
  end if;
  if (
    select pg_catalog.count(*) from app.routine_telebirr_untrusted_proof_requests proof
     where proof.origin_channel = 'telegram'
       and proof.origin_identity_id = v_identity_id
       and proof.submitted_at > pg_catalog.clock_timestamp() - interval '1 minute'
  ) >= 5 or (
    select pg_catalog.count(*) from app.routine_telebirr_untrusted_proof_requests proof
     where proof.origin_channel = 'telegram'
       and proof.origin_identity_id = v_identity_id
       and proof.submitted_at > pg_catalog.clock_timestamp() - interval '1 hour'
  ) >= 120 then
    raise exception 'The paid routine Telegram candidate intake is temporarily unavailable.';
  end if;

  select boundary.platform_id, boundary.player_account_id,
         boundary.player_deposit_eligibility_decision_id,
         boundary.payment_provider_id, boundary.normalized_provider_code
    into v_platform_id, v_player_account_id, v_eligibility_id,
         v_provider_id, v_resolved_provider_code
    from app.resolve_dry_run_deposit_proof_boundary(p_player_id, 'telebirr') boundary;
  if v_platform_id is distinct from v_authorized_platform_id
    or v_player_account_id is null
    or v_resolved_provider_code is distinct from 'telebirr' then
    raise exception 'The paid routine TeleBirr destination is unavailable.';
  end if;
  select player.customer_id into v_player_customer_id
    from app.customer_platform_players player
   where player.id = v_player_account_id for share;
  if v_player_customer_id is distinct from v_customer_id then
    raise exception 'The paid routine Player owner is unavailable.';
  end if;
  select receiver.id into v_receiver_id
    from app.receiver_accounts receiver
   where receiver.provider_id = v_provider_id
     and receiver.status = 'active' and receiver.retired_at is null
     and receiver.active_from <= pg_catalog.clock_timestamp()
     and receiver.account_holder_name = pg_catalog.btrim(receiver.account_holder_name)
     and pg_catalog.char_length(receiver.account_holder_name) between 2 and 160
     and receiver.account_holder_name !~ '[[:cntrl:]]'
     and receiver.account_reference_ciphertext
       ~ '^receiver-v1[.]telebirr[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{12,32}$'
     and receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
     and receiver.account_reference_masked ~ '^\*{3}[0-9]{4}$'
     and receiver.protection_profile_version = 1
     and receiver.encryption_key_version = 1
     and receiver.fingerprint_key_version = 1 for share;
  if v_receiver_id is null then
    raise exception 'The paid routine receiving account is unavailable.';
  end if;

  v_captured_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if v_captured_at < v_authorized_at then
    raise exception 'The paid routine authorization is unavailable.';
  end if;
  insert into app.routine_telebirr_untrusted_proof_requests (
    submitting_customer_id, origin_identity_id, origin_channel,
    origin_request_key, semantic_input_hmac, platform_id,
    player_account_id, player_deposit_eligibility_decision_id,
    payment_provider_id, provider_code, candidate_reference_ciphertext,
    candidate_reference_fingerprint, candidate_reference_masked,
    reference_encryption_key_version, reference_profile_version,
    submitted_at, intake_mode
  ) values (
    v_customer_id, v_identity_id, 'telegram', p_origin_inbound_event_id,
    p_semantic_input_hmac, v_platform_id, v_player_account_id,
    v_eligibility_id, v_provider_id, 'telebirr', p_reference_ciphertext,
    p_reference_fingerprint, p_reference_masked, p_reference_key_version,
    p_reference_profile_version, v_captured_at, 'paid'
  ) returning * into v_inserted;
  update app.inbound_events inbound_event
     set processed_at = v_captured_at, processing_error_code = null
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.processed_at is null;
  if not found then
    raise exception 'The paid routine Telegram event could not be marked handled.';
  end if;
  insert into app.audit_events (
    actor_kind, actor_customer_id, action, resource_type, resource_id, metadata
  ) values (
    'customer', v_customer_id, 'deposit.routine_telebirr_paid_candidate_received',
    'routine_telebirr_untrusted_proof_request', v_inserted.id,
    pg_catalog.jsonb_build_object('channel', 'telegram', 'provider_code', 'telebirr',
      'verification_performed', false, 'candidate_mode', 'paid')
  );
  return query select v_inserted.id, 'telebirr'::text,
                      'paid_pending'::text, v_inserted.submitted_at, false;
end;
$$;

alter function app.capture_telegram_routine_telebirr_untrusted_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) owner to postgres;
revoke all on function app.capture_telegram_routine_telebirr_untrusted_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime,
  fetanagent_customer_web, fetanagent_customer_web_runtime,
  fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;
grant execute on function app.capture_telegram_routine_telebirr_untrusted_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) to fetanagent_player_actions;

comment on function app.capture_telegram_routine_telebirr_no_money_core(
  uuid, text, text, text, text, text, smallint, smallint, text
) is 'Unexported historical no-money candidate capture. The shared Telegram wrapper is the only Player-action entry point.';
comment on function app.capture_telegram_routine_telebirr_untrusted_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) is 'Exact Player-action Telegram candidate entry point: no-money only with every money gate off, or paid/untrusted only with current Owner authorization and live generic deposit gates. Never verifies payment or credits a Player.';

commit;
