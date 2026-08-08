-- PayReplayy Stage 3: a narrow, private intake procedure for a Telegram-originated deposit.
--
-- This function can open only an immutable, unverified deposit intent. It cannot accept raw
-- payment references, enqueue verification, create provider evidence, claim a payment, or start
-- KemerBet execution. The API is the only intended caller; Telegram clients never obtain a
-- database credential.

begin;

create function app.open_telegram_deposit_intent(
  p_origin_inbound_event_id uuid,
  p_player_account_id uuid,
  p_payment_provider_id uuid,
  p_expected_amount_minor bigint
)
returns table (
  deposit_intent_id uuid,
  payment_provider_id uuid,
  receiver_account_id uuid,
  receiver_account_version integer,
  receiver_account_holder_name text,
  receiver_account_masked text,
  receiver_instructions jsonb,
  expected_amount_minor bigint,
  currency_code char(3),
  payment_deadline_at timestamptz,
  deposit_status app.deposit_status,
  payment_verification_mode app.feature_mode
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  customer_id uuid;
  customer_status app.record_status;
  customer_identity_status app.record_status;
  verification_mode app.feature_mode;
  platform_id uuid;
  selected_receiver_account_id uuid;
  existing_intent app.deposit_intents%rowtype;
  new_deposit_intent_id uuid;
begin
  if p_origin_inbound_event_id is null
    or p_player_account_id is null
    or p_payment_provider_id is null
    or p_expected_amount_minor is null
    or p_expected_amount_minor <= 0 then
    raise exception 'A Telegram deposit intent requires a positive amount and all linked identifiers.';
  end if;

  select
    customer_identity.customer_id,
    customer.status,
    customer_identity.status
  into
    customer_id,
    customer_status,
    customer_identity_status
  from app.inbound_events inbound_event
  join app.customer_identities customer_identity
    on customer_identity.id = inbound_event.customer_identity_id
  join app.telegram_identities telegram_identity
    on telegram_identity.customer_identity_id = customer_identity.id
  join app.customers customer
    on customer.id = customer_identity.customer_id
  where inbound_event.id = p_origin_inbound_event_id
    and inbound_event.channel = 'telegram'
    and customer_identity.identity_kind = 'telegram'
  for update of customer_identity, customer;

  if not found then
    raise exception 'The inbound event is not linked to a Telegram customer identity.';
  end if;

  select feature_switch.mode
    into verification_mode
    from app.feature_switches feature_switch
    where feature_switch.feature_key = 'payment_verification'
    for update;

  if not found then
    raise exception 'The payment-verification feature switch is missing.';
  end if;

  if customer_status <> 'active' or customer_identity_status <> 'active' then
    raise exception 'An active Telegram customer identity is required to open a deposit intent.';
  end if;

  if verification_mode <> 'live' then
    raise exception 'Payment verification is not live; no Telegram payment instructions can be opened.';
  end if;

  -- Replaying the same Telegram event returns the existing intent only when every financial input
  -- matches. This makes delivery retries safe without letting a reused event change an amount,
  -- player, or provider.
  select *
    into existing_intent
    from app.deposit_intents
    where origin_inbound_event_id = p_origin_inbound_event_id
    for key share;

  if found then
    if existing_intent.customer_id is distinct from customer_id
      or existing_intent.player_account_id is distinct from p_player_account_id
      or existing_intent.payment_provider_id is distinct from p_payment_provider_id
      or existing_intent.expected_amount_minor is distinct from p_expected_amount_minor then
      raise exception 'The replayed inbound event does not match its existing deposit intent.';
    end if;

    return query
    select
      deposit_intent.id,
      deposit_intent.payment_provider_id,
      deposit_intent.receiver_account_id,
      deposit_intent.receiver_account_version,
      deposit_intent.receiver_account_holder_name_snapshot,
      deposit_intent.receiver_account_masked_snapshot,
      deposit_intent.receiver_instructions_snapshot,
      deposit_intent.expected_amount_minor,
      deposit_intent.currency_code,
      deposit_intent.payment_deadline_at,
      deposit_intent.status,
      verification_mode
    from app.deposit_intents deposit_intent
    where deposit_intent.id = existing_intent.id;
    return;
  end if;

  select player_account.platform_id
    into platform_id
    from app.customer_platform_players player_account
    join app.platforms platform
      on platform.id = player_account.platform_id
    where player_account.id = p_player_account_id
      and player_account.customer_id = customer_id
      and player_account.status = 'active'
      and player_account.validation_status = 'valid'
      and platform.status = 'active'
    for update of player_account, platform;

  if not found then
    raise exception 'A deposit intent requires an active, validated player account for this customer.';
  end if;

  perform 1
    from app.payment_providers payment_provider
    where payment_provider.id = p_payment_provider_id
      and payment_provider.status = 'active'
    for update;

  if not found then
    raise exception 'The payment provider is not active.';
  end if;

  select receiver_account.id
    into selected_receiver_account_id
    from app.receiver_accounts receiver_account
    where receiver_account.provider_id = p_payment_provider_id
      and receiver_account.status = 'active'
    for update;

  if not found then
    raise exception 'The payment provider does not have an active receiver account.';
  end if;

  insert into app.deposit_intents (
    customer_id,
    platform_id,
    player_account_id,
    payment_provider_id,
    receiver_account_id,
    expected_amount_minor,
    origin_inbound_event_id
  )
  values (
    customer_id,
    platform_id,
    p_player_account_id,
    p_payment_provider_id,
    selected_receiver_account_id,
    p_expected_amount_minor,
    p_origin_inbound_event_id
  )
  on conflict (origin_inbound_event_id) do nothing
  returning id into new_deposit_intent_id;

  if new_deposit_intent_id is null then
    select *
      into existing_intent
      from app.deposit_intents
      where origin_inbound_event_id = p_origin_inbound_event_id
      for key share;

    if not found then
      raise exception 'The deposit-intent idempotency record could not be loaded.';
    end if;

    if existing_intent.customer_id is distinct from customer_id
      or existing_intent.player_account_id is distinct from p_player_account_id
      or existing_intent.payment_provider_id is distinct from p_payment_provider_id
      or existing_intent.expected_amount_minor is distinct from p_expected_amount_minor then
      raise exception 'The replayed inbound event does not match its existing deposit intent.';
    end if;

    return query
    select
      deposit_intent.id,
      deposit_intent.payment_provider_id,
      deposit_intent.receiver_account_id,
      deposit_intent.receiver_account_version,
      deposit_intent.receiver_account_holder_name_snapshot,
      deposit_intent.receiver_account_masked_snapshot,
      deposit_intent.receiver_instructions_snapshot,
      deposit_intent.expected_amount_minor,
      deposit_intent.currency_code,
      deposit_intent.payment_deadline_at,
      deposit_intent.status,
      verification_mode
    from app.deposit_intents deposit_intent
    where deposit_intent.id = existing_intent.id;
    return;
  end if;

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
    customer_id,
    'deposit.intent_opened',
    'deposit_intent',
    new_deposit_intent_id,
    jsonb_build_object(
      'origin_inbound_event_id', p_origin_inbound_event_id,
      'player_account_id', p_player_account_id,
      'payment_provider_id', p_payment_provider_id
    )
  );

  return query
  select
    deposit_intent.id,
    deposit_intent.payment_provider_id,
    deposit_intent.receiver_account_id,
    deposit_intent.receiver_account_version,
    deposit_intent.receiver_account_holder_name_snapshot,
    deposit_intent.receiver_account_masked_snapshot,
    deposit_intent.receiver_instructions_snapshot,
    deposit_intent.expected_amount_minor,
    deposit_intent.currency_code,
    deposit_intent.payment_deadline_at,
    deposit_intent.status,
    verification_mode
  from app.deposit_intents deposit_intent
  where deposit_intent.id = new_deposit_intent_id;
  return;
end;
$$;

-- The existing insert trigger is part of the financial boundary. Lock its provider and receiver
-- in the same provider-first order as receiver rotation, and start the one-hour window only once
-- all lock waits have completed.
create or replace function app.populate_deposit_intent_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  player_row app.customer_platform_players%rowtype;
  receiver_row app.receiver_accounts%rowtype;
  policy_row app.deposit_policy_versions%rowtype;
  intent_opened_at timestamptz;
begin
  select player_account.*
    into player_row
    from app.customer_platform_players player_account
    join app.platforms platform
      on platform.id = player_account.platform_id
    where player_account.id = new.player_account_id
      and platform.status = 'active'
    for update of player_account, platform;

  if not found
    or player_row.status <> 'active'
    or player_row.validation_status <> 'valid' then
    raise exception 'A deposit intent requires an active, validated player account.';
  end if;

  if new.customer_id is distinct from player_row.customer_id
    or new.platform_id is distinct from player_row.platform_id then
    raise exception 'Deposit intent customer and platform must match its player account.';
  end if;

  perform 1
    from app.payment_providers payment_provider
    where payment_provider.id = new.payment_provider_id
      and payment_provider.status = 'active'
    for update;

  if not found then
    raise exception 'A deposit intent requires an active payment provider.';
  end if;

  select receiver_account.*
    into receiver_row
    from app.receiver_accounts receiver_account
    where receiver_account.id = new.receiver_account_id
      and receiver_account.provider_id = new.payment_provider_id
      and receiver_account.status = 'active'
    for update;

  if not found then
    raise exception 'A deposit intent requires an active receiver account for its payment provider.';
  end if;

  select *
    into policy_row
    from app.deposit_policy_versions
    where status = 'active'
    for update;

  if not found then
    raise exception 'An active deposit policy is required.';
  end if;

  if new.origin_inbound_event_id is not null and not exists (
    select 1
    from app.inbound_events inbound_event
    join app.customer_identities customer_identity
      on customer_identity.id = inbound_event.customer_identity_id
    where inbound_event.id = new.origin_inbound_event_id
      and customer_identity.customer_id = new.customer_id
  ) then
    raise exception 'The inbound event does not belong to the deposit customer.';
  end if;

  intent_opened_at := clock_timestamp();
  new.receiver_account_version := receiver_row.version;
  new.receiver_account_holder_name_snapshot := receiver_row.account_holder_name;
  new.receiver_account_masked_snapshot := receiver_row.account_reference_masked;
  new.receiver_instructions_snapshot := receiver_row.instructions;
  new.deposit_policy_version_id := policy_row.id;
  new.deposit_policy_version := policy_row.version;
  new.minimum_amount_minor := policy_row.minimum_amount_minor;
  new.maximum_amount_minor := policy_row.maximum_amount_minor;
  new.freshness_window_seconds := policy_row.freshness_window_seconds;
  new.currency_code := 'ETB';
  new.opened_at := intent_opened_at;
  new.payment_deadline_at := intent_opened_at + make_interval(secs => policy_row.freshness_window_seconds);
  new.status := 'intake_received';
  new.status_changed_at := intent_opened_at;
  new.verified_at := null;
  new.rejection_reason_code := null;

  if new.expected_amount_minor < new.minimum_amount_minor
    or new.expected_amount_minor > new.maximum_amount_minor then
    raise exception 'The requested amount is outside the active deposit policy.';
  end if;

  return new;
end;
$$;

-- A dry-run mode may exercise parser and queue code, but it must never produce a verified
-- payment claim. The claim function remains ungranted in this release; this is a defence in depth
-- guard for any future worker procedure.
create or replace function app.claim_verified_deposit_payment(
  p_deposit_intent_id uuid,
  p_verification_attempt_id uuid,
  p_provider_payment_evidence_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  deposit_row app.deposit_intents%rowtype;
  attempt_row app.deposit_verification_attempts%rowtype;
  evidence_row app.provider_payment_evidence%rowtype;
  claim_id uuid;
  claim_time timestamptz := clock_timestamp();
  verification_mode app.feature_mode;
begin
  -- Keep the global financial lock order consistent with intake: feature switch, then intent.
  -- This serializes the kill switch with a new claim and avoids a replay/claim deadlock.
  select feature_switch.mode
    into verification_mode
    from app.feature_switches feature_switch
    where feature_switch.feature_key = 'payment_verification'
    for update;

  if not found or verification_mode <> 'live' then
    raise exception 'Payment verification is not live.';
  end if;

  select *
    into deposit_row
    from app.deposit_intents
    where id = p_deposit_intent_id
    for update;

  if not found then
    raise exception 'Deposit intent not found.';
  end if;

  select id
    into claim_id
    from app.deposit_payment_claims
    where deposit_intent_id = deposit_row.id
      and verification_attempt_id = p_verification_attempt_id
      and provider_payment_evidence_id = p_provider_payment_evidence_id;

  if found then
    if deposit_row.status <> 'verified' then
      raise exception 'A matching payment claim exists but the deposit state is inconsistent.';
    end if;

    return claim_id;
  end if;

  if exists (
    select 1
    from app.deposit_payment_claims
    where deposit_intent_id = deposit_row.id
  ) then
    raise exception 'This deposit is already claimed by a different verified payment.';
  end if;

  if deposit_row.status <> 'verification_pending' then
    raise exception 'Automatic payment claims require a verification-pending intent.';
  end if;

  if claim_time > deposit_row.payment_deadline_at then
    raise exception 'An expired deposit requires manual verification review.';
  end if;

  if exists (
    select 1
    from app.deposit_review_cases review_case
    where review_case.deposit_intent_id = deposit_row.id
      and review_case.review_kind = 'verification'
      and review_case.status in ('open', 'assigned')
  ) then
    raise exception 'A deposit with an open verification review cannot be automatically claimed.';
  end if;

  select *
    into attempt_row
    from app.deposit_verification_attempts
    where id = p_verification_attempt_id
    for key share;

  if not found
    or attempt_row.deposit_intent_id <> deposit_row.id
    or attempt_row.outcome <> 'verified'
    or attempt_row.provider_payment_evidence_id is distinct from p_provider_payment_evidence_id then
    raise exception 'The verification attempt does not prove this payment claim.';
  end if;

  select *
    into evidence_row
    from app.provider_payment_evidence
    where id = p_provider_payment_evidence_id
    for key share;

  if not found then
    raise exception 'Provider payment evidence not found.';
  end if;

  if evidence_row.payment_provider_id <> deposit_row.payment_provider_id
    or evidence_row.currency_code <> deposit_row.currency_code
    or evidence_row.amount_minor <> deposit_row.expected_amount_minor
    or evidence_row.matched_receiver_account_id is distinct from deposit_row.receiver_account_id
    or evidence_row.matched_receiver_account_version is distinct from deposit_row.receiver_account_version
    or evidence_row.occurred_at < deposit_row.opened_at
    or evidence_row.occurred_at > deposit_row.payment_deadline_at
    or evidence_row.occurred_at > claim_time + interval '5 minutes' then
    raise exception 'Provider payment evidence does not match the deposit intent snapshot.';
  end if;

  insert into app.deposit_payment_claims (
    deposit_intent_id,
    provider_payment_evidence_id,
    verification_attempt_id
  )
  values (
    deposit_row.id,
    evidence_row.id,
    attempt_row.id
  )
  returning id into claim_id;

  update app.deposit_submissions
  set status = 'verified'
  where id = attempt_row.deposit_submission_id
    and deposit_intent_id = deposit_row.id
    and status = 'verification_enqueued';

  if not found then
    raise exception 'A payment claim requires an enqueued verification submission.';
  end if;

  update app.deposit_intents
  set status = 'verified'
  where id = deposit_row.id;

  return claim_id;
end;
$$;

comment on function app.claim_verified_deposit_payment(uuid, uuid, uuid) is
  'Private, ungranted automatic payment-claim procedure. A new claim requires a locked live verification mode; a future worker procedure may call it only after live verification is separately reviewed.';

revoke all on function app.open_telegram_deposit_intent(uuid, uuid, uuid, bigint)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;
grant execute on function app.open_telegram_deposit_intent(uuid, uuid, uuid, bigint)
  to payreplayy_api;
revoke all on function app.claim_verified_deposit_payment(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

comment on function app.open_telegram_deposit_intent(uuid, uuid, uuid, bigint) is
  'Private, idempotent API procedure that opens an immutable intake_received deposit only when payment verification is live, then returns frozen display-safe payment instructions. It cannot submit payment evidence, verify a payment, or execute KemerBet.';

commit;
