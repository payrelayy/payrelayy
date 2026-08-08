-- PayReplayy Stage 4: capture a Telegram customer's encrypted transaction-reference proof.
--
-- This function records untrusted customer input only. It deliberately does not enqueue a
-- verifier, call a provider, create authoritative evidence, claim a payment, or start KemerBet
-- execution. The caller must encrypt and blind-index the raw reference in trusted API memory
-- before calling this procedure.

begin;

create function app.capture_telegram_deposit_reference(
  p_origin_inbound_event_id uuid,
  p_deposit_intent_id uuid,
  p_submitted_reference_ciphertext text,
  p_submitted_reference_fingerprint text,
  p_submitted_reference_masked text,
  p_reference_encryption_key_version smallint
)
returns table (
  deposit_submission_id uuid,
  deposit_intent_id uuid,
  submission_status text,
  submitted_at timestamptz,
  payment_deadline_at timestamptz,
  reference_received boolean,
  submission_already_recorded boolean,
  payment_verification_mode text
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  submitting_customer_id uuid;
  submitting_customer_status app.record_status;
  submitting_identity_status app.record_status;
  verification_mode app.feature_mode;
  intent_row app.deposit_intents%rowtype;
  existing_submission_row app.deposit_submissions%rowtype;
  active_submission_row app.deposit_submissions%rowtype;
  captured_at timestamptz;
  next_submission_number integer;
  new_submission_id uuid;
  new_submitted_at timestamptz;
begin
  if p_origin_inbound_event_id is null
    or p_deposit_intent_id is null
    or p_submitted_reference_ciphertext is null
    or p_submitted_reference_fingerprint is null
    or p_submitted_reference_masked is null
    or p_reference_encryption_key_version is null then
    raise exception 'A Telegram deposit reference requires all linked identifiers and protected reference fields.';
  end if;

  -- The opaque envelope format is v<key-version>.<base64url-nonce>.<base64url-tag>.<base64url-ciphertext>.
  -- This validates only the envelope shape; the API/worker holds the encryption and HMAC keys.
  if p_reference_encryption_key_version <= 0 then
    raise exception 'The transaction-reference encryption key version must be positive.';
  end if;

  if p_submitted_reference_ciphertext <> btrim(p_submitted_reference_ciphertext)
    or char_length(p_submitted_reference_ciphertext) > 2048
    or p_submitted_reference_ciphertext !~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    or p_submitted_reference_ciphertext !~ ('^v' || p_reference_encryption_key_version::text || '\.') then
    raise exception 'The protected transaction reference has an invalid envelope.';
  end if;

  if p_submitted_reference_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'The protected transaction reference has an invalid fingerprint.';
  end if;

  if p_submitted_reference_masked <> btrim(p_submitted_reference_masked)
    or p_submitted_reference_masked !~ '^\*{3}[A-Z0-9._-]{4}$' then
    raise exception 'The transaction-reference mask is invalid.';
  end if;

  -- Lock customer/identity, then the feature switch, then the intent. This mirrors intake and
  -- does not invert claim's feature-switch -> intent order.
  select
    customer_identity.customer_id,
    customer.status,
    customer_identity.status
  into
    submitting_customer_id,
    submitting_customer_status,
    submitting_identity_status
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

  if submitting_customer_status <> 'active' or submitting_identity_status <> 'active' then
    raise exception 'An active Telegram customer identity is required to submit a deposit reference.';
  end if;

  select feature_switch.mode
    into verification_mode
    from app.feature_switches feature_switch
    where feature_switch.feature_key = 'payment_verification'
    for update;

  if not found then
    raise exception 'The payment-verification feature switch is missing.';
  end if;

  if verification_mode <> 'live' then
    raise exception 'Payment verification is not live; no Telegram payment proof can be recorded.';
  end if;

  select *
    into intent_row
    from app.deposit_intents deposit_intent
    where deposit_intent.id = p_deposit_intent_id
      and deposit_intent.customer_id = submitting_customer_id
    for update;

  if not found then
    raise exception 'The deposit intent does not belong to this Telegram customer.';
  end if;

  if intent_row.origin_inbound_event_id = p_origin_inbound_event_id then
    raise exception 'A deposit-opening event cannot also submit a payment reference.';
  end if;

  -- A true delivery retry is harmless. Ciphertexts are intentionally randomized, so compare only
  -- the semantic protected fields and never return any encrypted material to the caller.
  select *
    into existing_submission_row
    from app.deposit_submissions submission
    where submission.origin_inbound_event_id = p_origin_inbound_event_id
    for key share;

  if found then
    if existing_submission_row.deposit_intent_id <> intent_row.id
      or existing_submission_row.submitted_reference_fingerprint is distinct from p_submitted_reference_fingerprint
      or existing_submission_row.submitted_reference_masked is distinct from p_submitted_reference_masked then
      raise exception 'The replayed Telegram event does not match its existing payment proof.';
    end if;

    return query
    select
      existing_submission_row.id,
      existing_submission_row.deposit_intent_id,
      existing_submission_row.status::text,
      existing_submission_row.submitted_at,
      intent_row.payment_deadline_at,
      true,
      true,
      verification_mode::text;
    return;
  end if;

  captured_at := clock_timestamp();

  if intent_row.status <> 'intake_received' then
    raise exception 'This deposit intent is not accepting a new payment proof.';
  end if;

  if captured_at > intent_row.payment_deadline_at then
    raise exception 'This deposit intent has expired and cannot automatically accept a payment proof.';
  end if;

  if exists (
    select 1
    from app.deposit_review_cases review_case
    where review_case.deposit_intent_id = intent_row.id
      and review_case.review_kind = 'verification'
      and review_case.status in ('open', 'assigned')
  ) then
    raise exception 'This deposit intent is already awaiting verification review.';
  end if;

  -- Never silently replace an active proof. A matching reference from a new Telegram event simply
  -- reuses the safe result; a different reference requires a later explicit review/correction flow.
  select *
    into active_submission_row
    from app.deposit_submissions submission
    where submission.deposit_intent_id = intent_row.id
      and submission.status in ('received', 'verification_enqueued')
    for update;

  if found then
    if active_submission_row.submitted_reference_fingerprint = p_submitted_reference_fingerprint
      and active_submission_row.submitted_reference_masked = p_submitted_reference_masked then
      return query
      select
        active_submission_row.id,
        active_submission_row.deposit_intent_id,
        active_submission_row.status::text,
        active_submission_row.submitted_at,
        intent_row.payment_deadline_at,
        true,
        true,
        verification_mode::text;
      return;
    end if;

    raise exception 'This deposit intent already has an active payment proof.';
  end if;

  select coalesce(max(submission.submission_number), 0) + 1
    into next_submission_number
    from app.deposit_submissions submission
    where submission.deposit_intent_id = intent_row.id;

  begin
    insert into app.deposit_submissions (
      deposit_intent_id,
      submission_number,
      submitted_reference_ciphertext,
      submitted_reference_fingerprint,
      submitted_reference_masked,
      reference_encryption_key_version,
      status,
      origin_inbound_event_id,
      submitted_at
    )
    values (
      intent_row.id,
      next_submission_number,
      p_submitted_reference_ciphertext,
      p_submitted_reference_fingerprint,
      p_submitted_reference_masked,
      p_reference_encryption_key_version,
      'received',
      p_origin_inbound_event_id,
      captured_at
    )
    returning id, submitted_at into new_submission_id, new_submitted_at;
  exception
    when unique_violation then
      -- Do not disclose whether a different customer or deposit already holds this fingerprint.
      raise exception 'The transaction reference is already awaiting verification.';
  end;

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
    submitting_customer_id,
    'deposit.reference_received',
    'deposit_submission',
    new_submission_id,
    jsonb_build_object(
      'deposit_intent_id', intent_row.id,
      'origin_inbound_event_id', p_origin_inbound_event_id,
      'reference_encryption_key_version', p_reference_encryption_key_version
    )
  );

  return query
  select
    new_submission_id,
    intent_row.id,
    'received'::text,
    new_submitted_at,
    intent_row.payment_deadline_at,
    true,
    false,
    verification_mode::text;
  return;
end;
$$;

revoke all on function app.capture_telegram_deposit_reference(uuid, uuid, text, text, text, smallint)
  from public, anon, authenticated, service_role, payreplayy_worker;
grant execute on function app.capture_telegram_deposit_reference(uuid, uuid, text, text, text, smallint)
  to payreplayy_api;

comment on function app.capture_telegram_deposit_reference(uuid, uuid, text, text, text, smallint) is
  'API-only receipt of an encrypted, customer-entered transaction reference. It records untrusted input only; no verification, job, payment claim, KemerBet action, or external payout is created.';

commit;
