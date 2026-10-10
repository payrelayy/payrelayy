-- Accept a paid TeleBirr reference from any active private Telegram identity
-- for any active, deposit-eligible KemerBet Player. The candidate remains
-- untrusted; the beneficiary owns the eventual intent while the submitting
-- customer remains immutable on the candidate for audit and replay checks.
-- Pin both reviewed live function bodies and preserve their exact private ACLs.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $public_deposit$
declare
  capture_oid oid := 'app.capture_telegram_routine_telebirr_untrusted_proof(
    uuid,text,text,text,text,text,smallint,smallint,text)'::pg_catalog.regprocedure;
  settlement_oid oid :=
    'app.finalize_routine_telebirr_paid_observation(uuid)'::pg_catalog.regprocedure;
  source_body text;
  definition text;
  changed_definition text;
  expected_body text;
  old_invite constant text := $old_invite$
     and exists (
       select 1 from app.telegram_beta_invites invite
        where invite.status = 'redeemed'
          and invite.redeemed_customer_id = identity.customer_id
          and invite.redeemed_customer_identity_id = identity.id
          and invite.redeemed_telegram_user_id = telegram_identity.telegram_user_id
          and invite.redeemed_private_chat_id = telegram_identity.private_chat_id
     )$old_invite$;
  old_capture_owner constant text := $old_capture_owner$  select player.customer_id into v_player_customer_id
    from app.customer_platform_players player
   where player.id = v_player_account_id for share;
  if v_player_customer_id is distinct from v_customer_id then
    raise exception 'The paid routine Player owner is unavailable.';
  end if;$old_capture_owner$;
  new_capture_owner constant text := $new_capture_owner$  select player.customer_id into v_player_customer_id
    from app.customer_platform_players player
    join app.customers beneficiary on beneficiary.id = player.customer_id
   where player.id = v_player_account_id
     and beneficiary.status = 'active'
   for share of player, beneficiary;
  if v_player_customer_id is null then
    raise exception 'The paid routine Player beneficiary is unavailable.';
  end if;$new_capture_owner$;
  old_candidate_lookup constant text := $old_candidate_lookup$  select candidate.* into v_candidate
    from app.routine_telebirr_untrusted_proof_requests candidate
    where candidate.id = v_staged.candidate_id for share;$old_candidate_lookup$;
  new_candidate_lookup constant text := $new_candidate_lookup$  select candidate.* into v_candidate
    from app.routine_telebirr_untrusted_proof_requests candidate
    where candidate.id = v_staged.candidate_id for share;
  select player.customer_id into v_beneficiary_customer_id
    from app.customer_platform_players player
    join app.customers beneficiary on beneficiary.id = player.customer_id
   where player.id = v_candidate.player_account_id
     and player.status = 'active' and player.validation_status = 'valid'
     and beneficiary.status = 'active'
   for share of player, beneficiary;$new_candidate_lookup$;
begin
  select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid)
    into source_body, definition
    from pg_catalog.pg_proc routine
   where routine.oid = capture_oid
     and routine.proowner = 'postgres'::pg_catalog.regrole
     and routine.prosecdef and routine.prokind = 'f'
     and routine.proconfig = array['search_path=pg_catalog']::text[];
  if source_body is null
    or pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(source_body, 'UTF8')), 'hex') <>
      '388225b47d26e23928c0f9cb4279137d55cafe466f07830ddfe7ebe383e8204b'
    or not exists (
      select 1 from pg_catalog.aclexplode((select routine.proacl
        from pg_catalog.pg_proc routine where routine.oid = capture_oid)) privilege
      where privilege.grantee = 'fetanagent_player_actions'::pg_catalog.regrole
        and privilege.privilege_type = 'EXECUTE')
    or exists (
      select 1 from pg_catalog.pg_proc routine
      cross join lateral pg_catalog.aclexplode(coalesce(
        routine.proacl, pg_catalog.acldefault('f', routine.proowner))) privilege
      where routine.oid = capture_oid and privilege.privilege_type = 'EXECUTE'
        and privilege.grantee not in (
          routine.proowner, 'fetanagent_player_actions'::pg_catalog.regrole))
    or (pg_catalog.length(source_body) -
        pg_catalog.length(pg_catalog.replace(source_body, old_invite, '')))
       <> pg_catalog.length(old_invite)
    or (pg_catalog.length(source_body) - pg_catalog.length(pg_catalog.replace(
         source_body, 'or v_player_customer_id is distinct from v_customer_id', '')))
       <> pg_catalog.length('or v_player_customer_id is distinct from v_customer_id')
    or (pg_catalog.length(source_body) -
        pg_catalog.length(pg_catalog.replace(source_body, old_capture_owner, '')))
       <> pg_catalog.length(old_capture_owner) then
    raise exception 'The paid Telegram candidate function is not the reviewed definition.';
  end if;
  expected_body := pg_catalog.replace(source_body, old_invite, '');
  expected_body := pg_catalog.replace(expected_body,
    'or v_player_customer_id is distinct from v_customer_id',
    'or v_player_customer_id is null');
  expected_body := pg_catalog.replace(expected_body, old_capture_owner, new_capture_owner);
  changed_definition := pg_catalog.replace(definition, old_invite, '');
  changed_definition := pg_catalog.replace(changed_definition,
    'or v_player_customer_id is distinct from v_customer_id',
    'or v_player_customer_id is null');
  changed_definition := pg_catalog.replace(changed_definition,
    old_capture_owner, new_capture_owner);
  execute changed_definition;
  if (select routine.prosrc from pg_catalog.pg_proc routine
      where routine.oid = capture_oid) is distinct from expected_body then
    raise exception 'The public paid Telegram capture replacement is incomplete.';
  end if;

  select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid)
    into source_body, definition
    from pg_catalog.pg_proc routine
   where routine.oid = settlement_oid
     and routine.proowner = 'postgres'::pg_catalog.regrole
     and routine.prosecdef and routine.prokind = 'f'
     and routine.proconfig = array['search_path=pg_catalog']::text[];
  if source_body is null
    or pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(source_body, 'UTF8')), 'hex') <>
      '8186ff81d5cc425aaa75df02dac81c1144d3a78d3ffb423d587725e46b11798c'
    or not exists (
      select 1 from pg_catalog.aclexplode((select routine.proacl
        from pg_catalog.pg_proc routine where routine.oid = settlement_oid)) privilege
      where privilege.grantee =
        'fetanagent_routine_telebirr_paid_settlement'::pg_catalog.regrole
        and privilege.privilege_type = 'EXECUTE')
    or exists (
      select 1 from pg_catalog.pg_proc routine
      cross join lateral pg_catalog.aclexplode(coalesce(
        routine.proacl, pg_catalog.acldefault('f', routine.proowner))) privilege
      where routine.oid = settlement_oid and privilege.privilege_type = 'EXECUTE'
        and privilege.grantee not in (
          routine.proowner,
          'fetanagent_routine_telebirr_paid_settlement'::pg_catalog.regrole))
    or (pg_catalog.length(source_body) - pg_catalog.length(pg_catalog.replace(
         source_body, '  v_candidate app.routine_telebirr_untrusted_proof_requests%rowtype;', '')))
       <> pg_catalog.length('  v_candidate app.routine_telebirr_untrusted_proof_requests%rowtype;')
    or (pg_catalog.length(source_body) -
        pg_catalog.length(pg_catalog.replace(source_body, old_candidate_lookup, '')))
       <> pg_catalog.length(old_candidate_lookup)
    or (pg_catalog.length(source_body) - pg_catalog.length(pg_catalog.replace(
         source_body, 'or v_candidate.id is null or v_candidate.intake_mode <> ''paid''', '')))
       <> pg_catalog.length('or v_candidate.id is null or v_candidate.intake_mode <> ''paid''')
    or (pg_catalog.length(source_body) - pg_catalog.length(pg_catalog.replace(
         source_body, 'v_intent_id, v_candidate.submitting_customer_id, v_candidate.platform_id,', '')))
       <> pg_catalog.length('v_intent_id, v_candidate.submitting_customer_id, v_candidate.platform_id,')
  then
    raise exception 'The paid settlement function is not the reviewed definition.';
  end if;
  expected_body := pg_catalog.replace(source_body,
    '  v_candidate app.routine_telebirr_untrusted_proof_requests%rowtype;',
    '  v_candidate app.routine_telebirr_untrusted_proof_requests%rowtype;' ||
      E'\n  v_beneficiary_customer_id uuid;');
  expected_body := pg_catalog.replace(expected_body,
    old_candidate_lookup, new_candidate_lookup);
  expected_body := pg_catalog.replace(expected_body,
    'or v_candidate.id is null or v_candidate.intake_mode <> ''paid''',
    'or v_candidate.id is null or v_candidate.intake_mode <> ''paid''' ||
      E'\n    or v_beneficiary_customer_id is null');
  expected_body := pg_catalog.replace(expected_body,
    'v_intent_id, v_candidate.submitting_customer_id, v_candidate.platform_id,',
    'v_intent_id, v_beneficiary_customer_id, v_candidate.platform_id,');
  changed_definition := pg_catalog.replace(definition,
    '  v_candidate app.routine_telebirr_untrusted_proof_requests%rowtype;',
    '  v_candidate app.routine_telebirr_untrusted_proof_requests%rowtype;' ||
      E'\n  v_beneficiary_customer_id uuid;');
  changed_definition := pg_catalog.replace(changed_definition,
    old_candidate_lookup, new_candidate_lookup);
  changed_definition := pg_catalog.replace(changed_definition,
    'or v_candidate.id is null or v_candidate.intake_mode <> ''paid''',
    'or v_candidate.id is null or v_candidate.intake_mode <> ''paid''' ||
      E'\n    or v_beneficiary_customer_id is null');
  changed_definition := pg_catalog.replace(changed_definition,
    'v_intent_id, v_candidate.submitting_customer_id, v_candidate.platform_id,',
    'v_intent_id, v_beneficiary_customer_id, v_candidate.platform_id,');
  execute changed_definition;
  if (select routine.prosrc from pg_catalog.pg_proc routine
      where routine.oid = settlement_oid) is distinct from expected_body then
    raise exception 'The beneficiary paid settlement replacement is incomplete.';
  end if;
end;
$public_deposit$;

-- The normal Telegram deposit wizard must show the receiver to an uninvited
-- payer before the reference is submitted. Reuse the existing immutable,
-- ten-minute destination receipt with an explicit routine-authorization tag;
-- historical pilot/review receipts remain distinct and unchanged.
alter table app.telegram_telebirr_destination_receipts
  add column routine_processing_authorization_id uuid
    references app.routine_telebirr_processing_authorizations(id) on delete restrict;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.prepare_telegram_routine_telebirr_paid_destination_core(
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
  v_switch_count integer;
  v_live_count integer;
  v_authorization_id uuid;
  v_authorized_platform_id uuid;
  v_identity_id uuid;
  v_customer_id uuid;
  v_processed_at timestamptz;
  v_identity_status app.record_status;
  v_customer_status app.record_status;
  v_conversation_id uuid;
  v_platform_id uuid;
  v_player_account_id uuid;
  v_player_owner_id uuid;
  v_eligibility_id uuid;
  v_provider_id uuid;
  v_provider_code text;
  v_receiver app.receiver_accounts%rowtype;
  v_receipt app.telegram_telebirr_destination_receipts%rowtype;
  v_now timestamptz;
  v_replayed boolean := false;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'The routine TeleBirr destination is unavailable.';
  end if;
  if p_origin_inbound_event_id is null
    or p_origin_inbound_event_id::text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_player_id is null or p_player_id <> pg_catalog.btrim(p_player_id)
    or pg_catalog.char_length(p_player_id) not between 1 and 64
    or p_player_id ~ '[[:space:][:cntrl:]]'
    or p_semantic_input_hmac is null
    or p_semantic_input_hmac <> pg_catalog.lower(pg_catalog.btrim(p_semantic_input_hmac))
    or p_semantic_input_hmac !~ '^hmac-sha256-v1:[0-9a-f]{64}$' then
    raise exception 'The routine TeleBirr destination request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004));
  perform 1 from app.private_trusted_telebirr_activation_control control
   where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The routine TeleBirr authority is unavailable.'; end if;
  perform feature_switch.feature_key from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification', 'deposit_execution',
     'payment_verification', 'private_live_deposit_pilot',
     'telebirr_authoritative_verification', 'withdrawal_collection',
     'withdrawal_validation'
   ) order by feature_switch.feature_key for update;
  get diagnostics v_switch_count = row_count;
  select pg_catalog.count(*)::integer into v_live_count
    from app.feature_switches feature_switch
   where (feature_switch.feature_key in ('payment_verification', 'deposit_execution')
      and feature_switch.mode = 'live')
      or (feature_switch.feature_key in (
        'cbe_birr_authoritative_verification', 'private_live_deposit_pilot',
        'telebirr_authoritative_verification', 'withdrawal_collection',
        'withdrawal_validation') and feature_switch.mode = 'disabled'
        and feature_switch.settings = '{}'::jsonb);
  if v_switch_count <> 7 or v_live_count <> 7 then
    raise exception 'The routine TeleBirr payment presentation is not live.';
  end if;
  select authority.id, platform.id into v_authorization_id, v_authorized_platform_id
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
  if v_authorization_id is null then
    raise exception 'The current routine Owner authorization is unavailable.';
  end if;

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);
  select inbound_event.customer_identity_id, inbound_event.processed_at
    into v_identity_id, v_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram' for update;
  if v_identity_id is null then
    raise exception 'The routine Telegram event is unavailable.';
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
   where identity.id = v_identity_id and identity.identity_kind = 'telegram'
   for update of identity, customer, telegram_identity, conversation;
  if v_customer_id is null or v_identity_status <> 'active'
    or v_customer_status <> 'active' then
    raise exception 'The routine Telegram customer is unavailable.';
  end if;

  select boundary.platform_id, boundary.player_account_id,
         boundary.player_deposit_eligibility_decision_id,
         boundary.payment_provider_id, boundary.normalized_provider_code
    into v_platform_id, v_player_account_id, v_eligibility_id,
         v_provider_id, v_provider_code
    from app.resolve_dry_run_deposit_proof_boundary(p_player_id, 'telebirr') boundary;
  if v_platform_id is distinct from v_authorized_platform_id
    or v_player_account_id is null or v_eligibility_id is null
    or v_provider_code is distinct from 'telebirr' then
    raise exception 'The routine TeleBirr Player is unavailable.';
  end if;
  select player.customer_id into v_player_owner_id
    from app.customer_platform_players player
    join app.customers beneficiary on beneficiary.id = player.customer_id
   where player.id = v_player_account_id and beneficiary.status = 'active'
   for share of player, beneficiary;
  if v_player_owner_id is null then
    raise exception 'The routine TeleBirr Player beneficiary is unavailable.';
  end if;

  select receiver.* into v_receiver
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
  if v_receiver.id is null then
    raise exception 'The routine TeleBirr receiver is unavailable.';
  end if;

  select receipt.* into v_receipt
    from app.telegram_telebirr_destination_receipts receipt
   where receipt.origin_inbound_event_id = p_origin_inbound_event_id for share;
  if v_receipt.origin_inbound_event_id is not null then
    v_replayed := true;
    if v_receipt.routine_processing_authorization_id is distinct from v_authorization_id
      or v_receipt.customer_identity_id is distinct from v_identity_id
      or v_receipt.customer_id is distinct from v_customer_id
      or v_receipt.conversation_id is distinct from v_conversation_id
      or v_receipt.player_account_id is distinct from v_player_account_id
      or v_receipt.receiver_account_id is distinct from v_receiver.id
      or v_receipt.semantic_input_hmac is distinct from p_semantic_input_hmac
      or v_processed_at is distinct from v_receipt.created_at then
      raise exception 'The routine TeleBirr destination replay conflicts.';
    end if;
  else
    if v_processed_at is not null
      or exists (select 1 from app.inbound_event_consumptions consumption
        where consumption.origin_inbound_event_id = p_origin_inbound_event_id) then
      raise exception 'The routine Telegram event already has another action.';
    end if;
    if (select pg_catalog.count(*) from app.telegram_telebirr_destination_receipts receipt
         where receipt.customer_identity_id = v_identity_id
           and receipt.created_at > pg_catalog.clock_timestamp() - interval '1 minute') >= 5
      or (select pg_catalog.count(*) from app.telegram_telebirr_destination_receipts receipt
         where receipt.customer_identity_id = v_identity_id
           and receipt.created_at > pg_catalog.clock_timestamp() - interval '1 hour') >= 120 then
      raise exception 'The routine TeleBirr destination is temporarily unavailable.';
    end if;
    v_now := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
    insert into app.telegram_telebirr_destination_receipts (
      origin_inbound_event_id, customer_identity_id, customer_id, conversation_id,
      player_account_id, receiver_account_id, activation_epoch,
      routine_processing_authorization_id, semantic_input_hmac,
      created_at, payment_presentation_expires_at
    ) values (
      p_origin_inbound_event_id, v_identity_id, v_customer_id, v_conversation_id,
      v_player_account_id, v_receiver.id, null,
      v_authorization_id, p_semantic_input_hmac,
      v_now, v_now + interval '10 minutes'
    ) returning * into v_receipt;
    update app.inbound_events inbound_event
       set processed_at = v_now, processing_error_code = null
     where inbound_event.id = p_origin_inbound_event_id
       and inbound_event.processed_at is null;
    if not found then
      raise exception 'The routine TeleBirr destination was not recorded.';
    end if;
    insert into app.audit_events (
      actor_kind, actor_customer_id, action, resource_type, resource_id, metadata
    ) values (
      'customer', v_customer_id, 'deposit.routine_telebirr_destination_presented',
      'receiver_account', v_receiver.id,
      pg_catalog.jsonb_build_object('channel','telegram','provider_code','telebirr',
        'player_ownership_required',false)
    );
  end if;
  if pg_catalog.clock_timestamp() >= v_receipt.payment_presentation_expires_at then
    raise exception 'The routine TeleBirr payment presentation expired.';
  end if;
  return query select 'telebirr'::text, v_receiver.id,
      v_receiver.account_holder_name, v_receiver.account_reference_ciphertext,
      v_receiver.account_reference_fingerprint, v_receiver.account_reference_masked,
      true, v_replayed;
end;
$$;
alter function app.prepare_telegram_routine_telebirr_paid_destination_core(
  uuid,text,text) owner to postgres;
revoke all on function app.prepare_telegram_routine_telebirr_paid_destination_core(
  uuid,text,text) from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime;

-- Keep the exact Player-action EXECUTE surface stable. The old pilot is still
-- reachable only under its own authority; routine live presentations use the
-- new private core after rechecking current switches and Owner policy.
do $pin_destination$
declare
  routine_oid oid :=
    'app.prepare_telegram_live_telebirr_destination(uuid,text,text)'::pg_catalog.regprocedure;
  source_body text;
begin
  select routine.prosrc into source_body from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.proowner = 'postgres'::pg_catalog.regrole
     and routine.prosecdef and routine.prokind = 'f'
     and routine.proconfig = array['search_path=pg_catalog']::text[];
  if source_body is null or pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(source_body,'UTF8')),'hex') <>
      'b9a565406671748d421e4b496bb64ec6906a8a7ddf3e600eb04fd76c2de3b0e5'
    or not exists (
      select 1 from pg_catalog.pg_proc routine
      cross join lateral pg_catalog.aclexplode(coalesce(
        routine.proacl, pg_catalog.acldefault('f', routine.proowner))) privilege
       where routine.oid = routine_oid
         and privilege.grantee = 'fetanagent_player_actions'::pg_catalog.regrole
         and privilege.privilege_type = 'EXECUTE')
    or exists (
      select 1 from pg_catalog.pg_proc routine
      cross join lateral pg_catalog.aclexplode(coalesce(
        routine.proacl, pg_catalog.acldefault('f', routine.proowner))) privilege
       where routine.oid = routine_oid and privilege.privilege_type = 'EXECUTE'
         and privilege.grantee not in (
           routine.proowner, 'fetanagent_player_actions'::pg_catalog.regrole)) then
    raise exception 'The live Telegram destination is not the reviewed definition.';
  end if;
end;
$pin_destination$;
alter function app.prepare_telegram_live_telebirr_destination(uuid,text,text)
  rename to prepare_telegram_live_telebirr_destination_pilot_core;
revoke all on function app.prepare_telegram_live_telebirr_destination_pilot_core(
  uuid,text,text) from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime;

create function app.prepare_telegram_live_telebirr_destination(
  p_origin_inbound_event_id uuid, p_player_id text, p_semantic_input_hmac text
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
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'The live Telegram TeleBirr destination is unavailable.';
  end if;
  if (select pg_catalog.count(*) from app.feature_switches feature_switch
       where (feature_switch.feature_key in ('payment_verification', 'deposit_execution')
         and feature_switch.mode = 'live')
         or (feature_switch.feature_key in (
           'private_live_deposit_pilot','telebirr_authoritative_verification')
           and feature_switch.mode = 'disabled')) = 4 then
    return query select * from app.prepare_telegram_routine_telebirr_paid_destination_core(
      p_origin_inbound_event_id, p_player_id, p_semantic_input_hmac);
  else
    return query select * from app.prepare_telegram_live_telebirr_destination_pilot_core(
      p_origin_inbound_event_id, p_player_id, p_semantic_input_hmac);
  end if;
end;
$$;
alter function app.prepare_telegram_live_telebirr_destination(uuid,text,text)
  owner to postgres;
revoke all on function app.prepare_telegram_live_telebirr_destination(uuid,text,text)
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_customer_web, fetanagent_customer_web_runtime;
grant execute on function app.prepare_telegram_live_telebirr_destination(uuid,text,text)
  to fetanagent_player_actions;
comment on function app.prepare_telegram_routine_telebirr_paid_destination_core(
  uuid,text,text) is
  'Unexported routine Owner-authorized TeleBirr receiver presentation for an active private Telegram payer and any active eligible KemerBet Player.';
comment on function app.prepare_telegram_live_telebirr_destination_pilot_core(
  uuid,text,text) is
  'Unexported prior private-pilot presentation, retained behind the exact Player-action destination wrapper.';
comment on function app.prepare_telegram_live_telebirr_destination(uuid,text,text) is
  'Exact Player-action destination boundary: independently gated legacy pilot or routine live TeleBirr presentation; no receipt verification or credit.';

comment on function app.capture_telegram_routine_telebirr_untrusted_proof(
  uuid,text,text,text,text,text,smallint,smallint,text) is
  'Private paid TeleBirr candidate intake for any active Telegram customer and active eligible KemerBet Player. Keeps submitter identity separate from Player beneficiary; intake never credits.';
comment on function app.finalize_routine_telebirr_paid_observation(uuid) is
  'Guarded one-use signed-origin paid settlement: intent belongs to the active Player beneficiary, while the immutable candidate retains its Telegram submitter.';

commit;
