-- Stage 18B: exactly-once, dry-run-only Telegram deposit intake.
--
-- These procedures can create only an immutable `intake_received` deposit intent and an
-- unverified `received` reference submission. They require every financial feature switch to
-- remain disabled. They cannot enqueue verification, create provider evidence, claim a payment,
-- call KemerBet, execute a deposit, collect a withdrawal, or schedule work.

begin;

alter table app.inbound_event_consumptions
  drop constraint inbound_event_consumptions_consumer_outcome_shape,
  add constraint inbound_event_consumptions_consumer_outcome_shape check (
    (consumer_kind = 'issue_player_registration_capability' and outcome = 'completed')
    or (consumer_kind = 'start_player_registration'
      and outcome in ('completed', 'active_action_exists', 'expired', 'rejected'))
    or (consumer_kind = 'submit_player_registration_input'
      and outcome in ('completed', 'rejected'))
    or (consumer_kind = 'expire_player_registration_action' and outcome = 'completed')
    or (consumer_kind = 'open_dry_run_deposit_intent' and outcome = 'completed')
    or (consumer_kind = 'capture_dry_run_deposit_reference' and outcome = 'completed')
  ),
  drop constraint inbound_event_consumptions_reason_shape,
  add constraint inbound_event_consumptions_reason_shape check (
    (consumer_kind = 'issue_player_registration_capability'
      and outcome = 'completed' and outcome_reason_code = 'capability_issued')
    or (consumer_kind = 'start_player_registration'
      and outcome = 'completed' and outcome_reason_code = 'player_registration_started')
    or (consumer_kind = 'start_player_registration'
      and outcome = 'active_action_exists' and outcome_reason_code = 'active_action_exists')
    or (consumer_kind = 'start_player_registration'
      and outcome = 'expired' and outcome_reason_code = 'capability_expired')
    or (consumer_kind = 'start_player_registration'
      and outcome = 'rejected' and outcome_reason_code = 'stale_capability')
    or (consumer_kind = 'submit_player_registration_input'
      and outcome = 'completed' and outcome_reason_code = 'player_registration_requested')
    or (consumer_kind = 'submit_player_registration_input'
      and outcome = 'rejected'
      and outcome_reason_code in ('input_predates_active_action', 'invalid_player_id'))
    or (consumer_kind = 'expire_player_registration_action'
      and outcome = 'completed'
      and outcome_reason_code = 'player_registration_action_expired')
    or (consumer_kind = 'open_dry_run_deposit_intent'
      and outcome = 'completed'
      and outcome_reason_code = 'dry_run_deposit_intent_opened')
    or (consumer_kind = 'capture_dry_run_deposit_reference'
      and outcome = 'completed'
      and outcome_reason_code = 'dry_run_deposit_reference_received')
  );

create function app.require_dry_run_deposit_consumption_causal_result()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.consumer_kind = 'open_dry_run_deposit_intent'
    and not exists (
      select 1
        from app.deposit_intents deposit_intent
       where deposit_intent.origin_inbound_event_id = new.origin_inbound_event_id
         and deposit_intent.customer_id = new.customer_id
         and deposit_intent.status = 'intake_received'
    ) then
    raise exception 'The dry-run deposit-intent receipt has no matching intake record.';
  end if;

  if new.consumer_kind = 'capture_dry_run_deposit_reference'
    and not exists (
      select 1
        from app.deposit_submissions submission
        join app.deposit_intents deposit_intent
          on deposit_intent.id = submission.deposit_intent_id
       where submission.origin_inbound_event_id = new.origin_inbound_event_id
         and submission.status = 'received'
         and deposit_intent.customer_id = new.customer_id
         and deposit_intent.status = 'intake_received'
    ) then
    raise exception 'The dry-run deposit-reference receipt has no matching unverified submission.';
  end if;

  return null;
end;
$$;

create constraint trigger inbound_event_consumptions_require_dry_run_deposit_result
after insert on app.inbound_event_consumptions
deferrable initially deferred
for each row
execute function app.require_dry_run_deposit_consumption_causal_result();

create function app.require_financial_features_disabled_for_dry_run()
returns void
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_feature_count integer;
  resolved_disabled_count integer;
begin
  perform 1
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'payment_verification',
     'deposit_execution',
     'withdrawal_validation',
     'withdrawal_collection'
   )
   order by feature_switch.feature_key
   for update;

  select count(*), count(*) filter (where feature_switch.mode = 'disabled')
    into resolved_feature_count, resolved_disabled_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'payment_verification',
     'deposit_execution',
     'withdrawal_validation',
     'withdrawal_collection'
   );

  if resolved_feature_count <> 4 or resolved_disabled_count <> 4 then
    raise exception 'Dry-run deposit intake requires every financial feature to remain disabled.';
  end if;
end;
$$;

create function app.open_telegram_dry_run_deposit_intent(
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
  resolved_identity_id uuid;
  resolved_inbound_processed_at timestamptz;
  resolved_customer_id uuid;
  resolved_identity_status app.record_status;
  resolved_customer_status app.record_status;
  resolved_conversation_id uuid;
  resolved_conversation_version bigint;
  resolved_platform_id uuid;
  resolved_player_account_id uuid;
  resolved_provider_id uuid;
  resolved_receiver_id uuid;
  resolved_intent app.deposit_intents%rowtype;
  resolved_existing_consumer app.inbound_event_consumptions%rowtype;
  resolved_instruction text;
begin
  if p_origin_inbound_event_id is null
    or p_expected_amount_minor is null
    or p_expected_amount_minor <= 0
    or p_player_id is null
    or p_player_id <> btrim(p_player_id)
    or char_length(p_player_id) not between 1 and 64
    or p_player_id ~ '[[:space:][:cntrl:]]' then
    raise exception 'The dry-run deposit request is invalid.';
  end if;

  if p_semantic_input_hmac is null
    or p_semantic_input_hmac <> lower(btrim(p_semantic_input_hmac))
    or p_semantic_input_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The dry-run deposit integrity value is invalid.';
  end if;

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);

  select inbound_event.customer_identity_id, inbound_event.processed_at
    into resolved_identity_id, resolved_inbound_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;

  if not found or resolved_identity_id is null then
    raise exception 'The Telegram inbound event is not available for dry-run deposit intake.';
  end if;

  select customer_identity.customer_id, customer_identity.status, customer.status
    into resolved_customer_id, resolved_identity_status, resolved_customer_status
    from app.customer_identities customer_identity
    join app.customers customer on customer.id = customer_identity.customer_id
   where customer_identity.id = resolved_identity_id
     and customer_identity.identity_kind = 'telegram'
   for update of customer_identity, customer;

  if not found then
    raise exception 'The Telegram customer is not available for dry-run deposit intake.';
  end if;

  select conversation.id
    into resolved_conversation_id
    from app.bot_conversations conversation
   where conversation.telegram_identity_id = resolved_identity_id;

  if not found then
    raise exception 'The Telegram conversation is not available for dry-run deposit intake.';
  end if;

  select * into resolved_existing_consumer
    from app.inbound_event_consumptions consumption
   where consumption.origin_inbound_event_id = p_origin_inbound_event_id;

  if found then
    if resolved_existing_consumer.consumer_kind <> 'open_dry_run_deposit_intent'
      or resolved_existing_consumer.semantic_input_hmac is distinct from p_semantic_input_hmac
      or resolved_existing_consumer.outcome <> 'completed'
      or resolved_existing_consumer.outcome_reason_code <> 'dry_run_deposit_intent_opened'
      or resolved_existing_consumer.customer_identity_id is distinct from resolved_identity_id
      or resolved_existing_consumer.customer_id is distinct from resolved_customer_id
      or resolved_existing_consumer.conversation_id is distinct from resolved_conversation_id
      or resolved_existing_consumer.conversation_version_after
        is distinct from resolved_existing_consumer.conversation_version_before then
      raise exception 'The replayed dry-run deposit request does not match its receipt.';
    end if;

    select deposit_intent.* into resolved_intent
      from app.deposit_intents deposit_intent
      join app.payment_providers payment_provider
        on payment_provider.id = deposit_intent.payment_provider_id
     where deposit_intent.origin_inbound_event_id = p_origin_inbound_event_id
       and deposit_intent.customer_id = resolved_customer_id
       and deposit_intent.expected_amount_minor = p_expected_amount_minor
       and payment_provider.code = 'cbe_birr'
       and exists (
         select 1
           from app.customer_platform_players player_account
          where player_account.id = deposit_intent.player_account_id
            and player_account.player_id = p_player_id
       );

    if not found then
      raise exception 'The replayed dry-run deposit request requires remediation.';
    end if;

    resolved_instruction := resolved_intent.receiver_instructions_snapshot ->> 'customer_message';
    return query select resolved_intent.id, 'cbe_birr'::text,
      resolved_intent.receiver_account_holder_name_snapshot,
      resolved_intent.receiver_account_masked_snapshot, resolved_instruction,
      resolved_intent.expected_amount_minor, resolved_intent.currency_code::text,
      resolved_intent.payment_deadline_at, resolved_intent.status::text, true;
    return;
  end if;

  if resolved_inbound_processed_at is not null
    or resolved_identity_status <> 'active'
    or resolved_customer_status <> 'active' then
    raise exception 'The Telegram event cannot start a new dry-run deposit.';
  end if;

  perform app.require_financial_features_disabled_for_dry_run();

  select platform.id into resolved_platform_id
    from app.platforms platform
   where platform.code = 'kemerbet' and platform.status = 'active'
   for share;
  if not found then raise exception 'KemerBet is not available for dry-run intake.'; end if;

  select player_account.id into resolved_player_account_id
    from app.customer_platform_players player_account
   where player_account.customer_id = resolved_customer_id
     and player_account.platform_id = resolved_platform_id
     and player_account.player_id = p_player_id
     and player_account.status = 'active'
     and player_account.validation_status = 'valid'
   for update;
  if not found then raise exception 'The Player ID is not validated for this customer.'; end if;

  select payment_provider.id into resolved_provider_id
    from app.payment_providers payment_provider
   where payment_provider.code = 'cbe_birr' and payment_provider.status = 'active'
   for update;
  if not found then raise exception 'CBE Birr is not available for dry-run intake.'; end if;

  select receiver_account.id, receiver_account.instructions ->> 'customer_message'
    into resolved_receiver_id, resolved_instruction
    from app.receiver_accounts receiver_account
   where receiver_account.provider_id = resolved_provider_id
     and receiver_account.status = 'active'
   for update;
  if not found
    or resolved_instruction is null
    or resolved_instruction <> btrim(resolved_instruction)
    or char_length(resolved_instruction) not between 1 and 256
    or resolved_instruction ~ '[[:cntrl:]]' then
    raise exception 'CBE Birr payment instructions are not safely configured.';
  end if;

  select conversation.version into resolved_conversation_version
    from app.bot_conversations conversation
   where conversation.id = resolved_conversation_id
   for update;
  if not found then raise exception 'The Telegram conversation is unavailable.'; end if;

  insert into app.deposit_intents (
    customer_id, platform_id, player_account_id, payment_provider_id,
    receiver_account_id, expected_amount_minor, origin_inbound_event_id
  ) values (
    resolved_customer_id, resolved_platform_id, resolved_player_account_id,
    resolved_provider_id, resolved_receiver_id, p_expected_amount_minor,
    p_origin_inbound_event_id
  ) returning * into resolved_intent;

  insert into app.inbound_event_consumptions (
    origin_inbound_event_id, customer_identity_id, customer_id, conversation_id,
    consumer_kind, semantic_input_hmac, outcome, outcome_reason_code,
    conversation_version_before, conversation_version_after
  ) values (
    p_origin_inbound_event_id, resolved_identity_id, resolved_customer_id,
    resolved_conversation_id, 'open_dry_run_deposit_intent', p_semantic_input_hmac,
    'completed', 'dry_run_deposit_intent_opened', resolved_conversation_version,
    resolved_conversation_version
  );

  insert into app.audit_events (
    actor_kind, actor_customer_id, action, resource_type, resource_id, metadata
  ) values (
    'customer', resolved_customer_id, 'deposit.dry_run_intent_opened',
    'deposit_intent', resolved_intent.id,
    jsonb_build_object('channel', 'telegram', 'provider_code', 'cbe_birr',
      'platform_code', 'kemerbet', 'financial_mode', 'dry_run')
  );

  return query select resolved_intent.id, 'cbe_birr'::text,
    resolved_intent.receiver_account_holder_name_snapshot,
    resolved_intent.receiver_account_masked_snapshot, resolved_instruction,
    resolved_intent.expected_amount_minor, resolved_intent.currency_code::text,
    resolved_intent.payment_deadline_at, resolved_intent.status::text, false;
end;
$$;

create function app.capture_telegram_dry_run_deposit_reference(
  p_origin_inbound_event_id uuid,
  p_deposit_intent_id uuid,
  p_reference_ciphertext text,
  p_reference_fingerprint text,
  p_reference_masked text,
  p_reference_key_version smallint,
  p_semantic_input_hmac text
)
returns table (
  deposit_submission_id uuid,
  result_deposit_intent_id uuid,
  submission_status text,
  submitted_at timestamptz,
  origin_inbound_event_already_consumed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_identity_id uuid;
  resolved_inbound_processed_at timestamptz;
  resolved_customer_id uuid;
  resolved_identity_status app.record_status;
  resolved_customer_status app.record_status;
  resolved_conversation_id uuid;
  resolved_conversation_version bigint;
  resolved_intent app.deposit_intents%rowtype;
  resolved_submission app.deposit_submissions%rowtype;
  resolved_existing_consumer app.inbound_event_consumptions%rowtype;
  resolved_submission_number integer;
begin
  if p_origin_inbound_event_id is null or p_deposit_intent_id is null
    or p_reference_key_version is null or p_reference_key_version <= 0
    or p_reference_ciphertext is null
    or p_reference_ciphertext <> btrim(p_reference_ciphertext)
    or char_length(p_reference_ciphertext) > 2048
    or p_reference_ciphertext !~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    or p_reference_ciphertext !~ ('^v' || p_reference_key_version::text || '\.')
    or p_reference_fingerprint is null
    or p_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or p_reference_masked is null
    or p_reference_masked <> btrim(p_reference_masked)
    or p_reference_masked !~ '^\*{3}[A-Z0-9._-]{4}$'
    or p_semantic_input_hmac is null
    or p_semantic_input_hmac <> lower(btrim(p_semantic_input_hmac))
    or p_semantic_input_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The protected dry-run deposit reference is invalid.';
  end if;

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);

  select inbound_event.customer_identity_id, inbound_event.processed_at
    into resolved_identity_id, resolved_inbound_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;
  if not found or resolved_identity_id is null then
    raise exception 'The Telegram inbound event is not available for deposit reference intake.';
  end if;

  select customer_identity.customer_id, customer_identity.status, customer.status
    into resolved_customer_id, resolved_identity_status, resolved_customer_status
    from app.customer_identities customer_identity
    join app.customers customer on customer.id = customer_identity.customer_id
   where customer_identity.id = resolved_identity_id
     and customer_identity.identity_kind = 'telegram'
   for update of customer_identity, customer;
  if not found then raise exception 'The Telegram customer is unavailable.'; end if;

  select conversation.id into resolved_conversation_id
    from app.bot_conversations conversation
   where conversation.telegram_identity_id = resolved_identity_id;
  if not found then raise exception 'The Telegram conversation is unavailable.'; end if;

  select * into resolved_existing_consumer
    from app.inbound_event_consumptions consumption
   where consumption.origin_inbound_event_id = p_origin_inbound_event_id;

  if found then
    if resolved_existing_consumer.consumer_kind <> 'capture_dry_run_deposit_reference'
      or resolved_existing_consumer.semantic_input_hmac is distinct from p_semantic_input_hmac
      or resolved_existing_consumer.outcome <> 'completed'
      or resolved_existing_consumer.outcome_reason_code <> 'dry_run_deposit_reference_received'
      or resolved_existing_consumer.customer_identity_id is distinct from resolved_identity_id
      or resolved_existing_consumer.customer_id is distinct from resolved_customer_id
      or resolved_existing_consumer.conversation_id is distinct from resolved_conversation_id
      or resolved_existing_consumer.conversation_version_after
        is distinct from resolved_existing_consumer.conversation_version_before then
      raise exception 'The replayed deposit reference does not match its receipt.';
    end if;

    select * into resolved_submission
      from app.deposit_submissions submission
     where submission.origin_inbound_event_id = p_origin_inbound_event_id
       and submission.deposit_intent_id = p_deposit_intent_id
       and submission.submitted_reference_fingerprint = p_reference_fingerprint
       and submission.submitted_reference_masked = p_reference_masked;
    if not found then raise exception 'The replayed deposit reference requires remediation.'; end if;

    return query select resolved_submission.id, resolved_submission.deposit_intent_id,
      resolved_submission.status::text, resolved_submission.submitted_at, true;
    return;
  end if;

  if resolved_inbound_processed_at is not null
    or resolved_identity_status <> 'active'
    or resolved_customer_status <> 'active' then
    raise exception 'The Telegram event cannot record a new deposit reference.';
  end if;

  perform app.require_financial_features_disabled_for_dry_run();

  select deposit_intent.* into resolved_intent
    from app.deposit_intents deposit_intent
    join app.payment_providers payment_provider
      on payment_provider.id = deposit_intent.payment_provider_id
   where deposit_intent.id = p_deposit_intent_id
     and deposit_intent.customer_id = resolved_customer_id
     and deposit_intent.status = 'intake_received'
     and payment_provider.code = 'cbe_birr'
     and exists (
       select 1
         from app.inbound_event_consumptions opening_consumption
        where opening_consumption.origin_inbound_event_id = deposit_intent.origin_inbound_event_id
          and opening_consumption.customer_id = resolved_customer_id
          and opening_consumption.consumer_kind = 'open_dry_run_deposit_intent'
          and opening_consumption.outcome = 'completed'
          and opening_consumption.outcome_reason_code = 'dry_run_deposit_intent_opened'
     )
   for update;
  if not found then raise exception 'The deposit is not accepting a dry-run reference.'; end if;
  if resolved_intent.origin_inbound_event_id = p_origin_inbound_event_id
    or clock_timestamp() > resolved_intent.payment_deadline_at then
    raise exception 'The deposit reference is outside the accepted intake window.';
  end if;

  if exists (
    select 1 from app.deposit_submissions submission
     where submission.deposit_intent_id = resolved_intent.id
       and submission.status in ('received', 'verification_enqueued')
  ) then
    raise exception 'This deposit already has an active reference.';
  end if;

  select conversation.version into resolved_conversation_version
    from app.bot_conversations conversation
   where conversation.id = resolved_conversation_id
   for update;
  if not found then raise exception 'The Telegram conversation is unavailable.'; end if;

  select coalesce(max(submission.submission_number), 0) + 1
    into resolved_submission_number
    from app.deposit_submissions submission
   where submission.deposit_intent_id = resolved_intent.id;

  begin
    insert into app.deposit_submissions (
      deposit_intent_id, submission_number, submitted_reference_ciphertext,
      submitted_reference_fingerprint, submitted_reference_masked,
      reference_encryption_key_version, status, origin_inbound_event_id, submitted_at
    ) values (
      resolved_intent.id, resolved_submission_number, p_reference_ciphertext,
      p_reference_fingerprint, p_reference_masked, p_reference_key_version,
      'received', p_origin_inbound_event_id, clock_timestamp()
    ) returning * into resolved_submission;
  exception when unique_violation then
    raise exception 'The transaction reference is already awaiting review.';
  end;

  insert into app.inbound_event_consumptions (
    origin_inbound_event_id, customer_identity_id, customer_id, conversation_id,
    consumer_kind, semantic_input_hmac, outcome, outcome_reason_code,
    conversation_version_before, conversation_version_after
  ) values (
    p_origin_inbound_event_id, resolved_identity_id, resolved_customer_id,
    resolved_conversation_id, 'capture_dry_run_deposit_reference', p_semantic_input_hmac,
    'completed', 'dry_run_deposit_reference_received', resolved_conversation_version,
    resolved_conversation_version
  );

  insert into app.audit_events (
    actor_kind, actor_customer_id, action, resource_type, resource_id, metadata
  ) values (
    'customer', resolved_customer_id, 'deposit.dry_run_reference_received',
    'deposit_submission', resolved_submission.id,
    jsonb_build_object('channel', 'telegram', 'deposit_intent_id', resolved_intent.id,
      'reference_encryption_key_version', p_reference_key_version,
      'financial_mode', 'dry_run')
  );

  return query select resolved_submission.id, resolved_submission.deposit_intent_id,
    resolved_submission.status::text, resolved_submission.submitted_at, false;
end;
$$;

create function app.list_owner_dry_run_deposit_intake(
  p_actor_auth_user_id uuid,
  p_limit integer default 50
)
returns table (
  deposit_intent_id uuid,
  player_id text,
  expected_amount_minor bigint,
  currency_code text,
  provider_code text,
  receiver_account_masked text,
  deposit_status text,
  opened_at timestamptz,
  payment_deadline_at timestamptz,
  submitted_reference_masked text,
  submission_status text,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if p_actor_auth_user_id is null or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'The Owner deposit-intake list request is invalid.';
  end if;

  perform 1
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;
  if not found then raise exception 'An active Owner is required.'; end if;

  return query
  select deposit_intent.id, player_account.player_id,
         deposit_intent.expected_amount_minor, deposit_intent.currency_code::text,
         payment_provider.code, deposit_intent.receiver_account_masked_snapshot,
         deposit_intent.status::text, deposit_intent.opened_at,
         deposit_intent.payment_deadline_at, submission.submitted_reference_masked,
         submission.status::text, submission.submitted_at
    from app.deposit_intents deposit_intent
    join app.customer_platform_players player_account
      on player_account.id = deposit_intent.player_account_id
    join app.payment_providers payment_provider
      on payment_provider.id = deposit_intent.payment_provider_id
    left join lateral (
      select deposit_submission.submitted_reference_masked,
             deposit_submission.status,
             deposit_submission.submitted_at
        from app.deposit_submissions deposit_submission
       where deposit_submission.deposit_intent_id = deposit_intent.id
       order by deposit_submission.submission_number desc
       limit 1
    ) submission on true
   where deposit_intent.origin_inbound_event_id is not null
     and exists (
       select 1
         from app.inbound_event_consumptions consumption
        where consumption.origin_inbound_event_id = deposit_intent.origin_inbound_event_id
          and consumption.consumer_kind = 'open_dry_run_deposit_intent'
          and consumption.outcome = 'completed'
          and consumption.outcome_reason_code = 'dry_run_deposit_intent_opened'
     )
   order by deposit_intent.opened_at desc, deposit_intent.id
   limit p_limit;
end;
$$;

alter table app.inbound_event_consumptions force row level security;

revoke all on function app.require_dry_run_deposit_consumption_causal_result()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker,
       payreplayy_api_runtime, payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;
revoke all on function app.require_financial_features_disabled_for_dry_run()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker,
       payreplayy_api_runtime, payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;
revoke all on function app.open_telegram_dry_run_deposit_intent(uuid, text, bigint, text)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker,
       payreplayy_api_runtime, payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions_runtime;
revoke all on function app.capture_telegram_dry_run_deposit_reference(uuid, uuid, text, text, text, smallint, text)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker,
       payreplayy_api_runtime, payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions_runtime;
revoke all on function app.list_owner_dry_run_deposit_intake(uuid, integer)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker,
       payreplayy_api_runtime, payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime,
       payreplayy_owner_control_runtime;

grant execute on function app.open_telegram_dry_run_deposit_intent(uuid, text, bigint, text)
  to payreplayy_player_actions;
grant execute on function app.capture_telegram_dry_run_deposit_reference(uuid, uuid, text, text, text, smallint, text)
  to payreplayy_player_actions;
grant execute on function app.list_owner_dry_run_deposit_intake(uuid, integer)
  to payreplayy_owner_control;

comment on function app.open_telegram_dry_run_deposit_intent(uuid, text, bigint, text) is
  'Player-action-only exactly-once CBE Birr intake. Requires all financial switches disabled and creates only an immutable intake_received intent.';
comment on function app.capture_telegram_dry_run_deposit_reference(uuid, uuid, text, text, text, smallint, text) is
  'Player-action-only exactly-once protected reference intake. Requires all financial switches disabled and creates only an unverified received submission.';
comment on function app.list_owner_dry_run_deposit_intake(uuid, integer) is
  'Owner-control-only read projection of dry-run deposit intake. It excludes ciphertext, fingerprints, and raw Telegram metadata.';

commit;
