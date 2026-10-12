-- Customer-visible outcome delivery is deliberately outside the payment transaction.
-- This migration creates no Telegram message, payment claim, execution job, or switch change.
-- Only submissions recorded after this migration's cutover are eligible, so installing it
-- cannot replay old test deposits into customers' chats.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.telegram_deposit_outcome_cutover (
  singleton boolean primary key default true check (singleton),
  enabled_at timestamptz not null
);
insert into app.telegram_deposit_outcome_cutover (singleton, enabled_at)
values (true, pg_catalog.clock_timestamp());

create table app.telegram_deposit_outcome_deliveries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  candidate_id uuid not null unique,
  private_chat_id bigint not null check (private_chat_id > 0 and private_chat_id <= 9007199254740991),
  reference_masked text not null check (reference_masked ~ '^\*{3}[A-Z0-9]{4}$'),
  outcome_code text not null check (outcome_code in ('credited', 'rejected', 'not_credited', 'not_verified')),
  amount_minor bigint check (amount_minor is null or amount_minor between 2500 and 2500000),
  status text not null default 'pending'
    check (status in ('pending', 'leased', 'sent', 'unavailable')),
  attempts smallint not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default pg_catalog.clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  telegram_message_id bigint check (telegram_message_id is null or telegram_message_id > 0),
  sent_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint telegram_outcome_delivery_shape check (
    (status = 'pending' and lease_expires_at is null and sent_at is null)
    or (status = 'leased' and lease_token is not null and lease_expires_at is not null
        and sent_at is null)
    or (status = 'sent' and lease_token is not null and lease_expires_at is null
        and sent_at is not null and telegram_message_id is not null)
    or (status = 'unavailable' and lease_expires_at is null and sent_at is null)
  ),
  constraint telegram_outcome_amount_shape check (
    (outcome_code = 'credited' and amount_minor is not null)
    or (outcome_code <> 'credited' and amount_minor is null)
  )
);

create index telegram_outcome_pending_idx
  on app.telegram_deposit_outcome_deliveries (next_attempt_at, created_at, id)
  where status in ('pending', 'leased');
create index telegram_outcome_retention_idx
  on app.telegram_deposit_outcome_deliveries (created_at, id);
create index routine_paid_candidate_notification_scan_idx
  on app.routine_telebirr_untrusted_proof_requests (submitted_at, id)
  where intake_mode = 'paid' and origin_channel = 'telegram';

alter table app.telegram_deposit_outcome_cutover owner to postgres;
alter table app.telegram_deposit_outcome_deliveries owner to postgres;
alter table app.telegram_deposit_outcome_cutover enable row level security;
alter table app.telegram_deposit_outcome_cutover force row level security;
alter table app.telegram_deposit_outcome_deliveries enable row level security;
alter table app.telegram_deposit_outcome_deliveries force row level security;
revoke all on table app.telegram_deposit_outcome_cutover,
                    app.telegram_deposit_outcome_deliveries
  from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime;

-- One bounded poll both materializes newly terminal outcomes and leases one message.
-- The submitting Telegram identity, not the selected Player account's owner, receives it.
-- A no-intent candidate is called "not verified" only after the maximum receipt-time
-- settlement window (submission + 65 minutes) has closed, with five minutes of margin.
create function app.claim_telegram_deposit_outcome_notification()
returns table (
  notification_id uuid,
  notification_lease_token uuid,
  notification_private_chat_id bigint,
  notification_outcome_code text,
  notification_amount_minor bigint,
  notification_reference_masked text
)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_cutover timestamptz;
  v_delivery_id uuid;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'Telegram deposit outcome delivery is unavailable.';
  end if;
  select cutover.enabled_at into v_cutover
    from app.telegram_deposit_outcome_cutover cutover where cutover.singleton = true;
  if v_cutover is null then
    raise exception 'Telegram deposit outcome cutover is unavailable.';
  end if;

  -- Bounded retention work cannot delay a payment transaction: this runs only in bot polls.
  delete from app.telegram_deposit_outcome_deliveries delivery
   where delivery.id in (
     select expired.id from app.telegram_deposit_outcome_deliveries expired
      where expired.created_at < v_now - interval '7 days'
      order by expired.created_at, expired.id limit 100
   );

  insert into app.telegram_deposit_outcome_deliveries (
    candidate_id, private_chat_id, reference_masked, outcome_code,
    amount_minor, next_attempt_at, created_at, updated_at
  )
  select candidate.id, telegram_identity.private_chat_id,
         candidate.candidate_reference_masked,
         case when intent.status = 'executed' then 'credited'
              when intent.status = 'rejected' then 'rejected'
              when intent.status in ('expired', 'cancelled') then 'not_credited'
              else 'not_verified' end,
         case when intent.status = 'executed' then intent.expected_amount_minor
              else null end,
         v_now, v_now, v_now
    from app.routine_telebirr_untrusted_proof_requests candidate
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = candidate.origin_identity_id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
    join app.inbound_events inbound_event
      on inbound_event.id = candidate.origin_request_key
     and inbound_event.customer_identity_id = candidate.origin_identity_id
     and inbound_event.channel = 'telegram'
    left join app.routine_telebirr_paid_intent_openings opening
      on opening.candidate_id = candidate.id
    left join app.deposit_intents intent
      on intent.id = opening.deposit_intent_id
   where candidate.intake_mode = 'paid'
     and candidate.origin_channel = 'telegram'
     and candidate.submitted_at >= v_cutover
     and candidate.submitted_at >= v_now - interval '7 days'
     and (
       intent.status in ('executed', 'rejected', 'expired', 'cancelled')
       or (opening.candidate_id is null
           and candidate.submitted_at <= v_now - interval '70 minutes')
     )
     and not exists (
       select 1 from app.telegram_deposit_outcome_deliveries existing
        where existing.candidate_id = candidate.id
     )
   order by candidate.submitted_at, candidate.id
   limit 100
  on conflict (candidate_id) do nothing;

  -- An expired final lease must not create an eleventh delivery attempt.
  update app.telegram_deposit_outcome_deliveries delivery
     set status = 'unavailable', lease_token = null,
         lease_expires_at = null, updated_at = v_now
   where delivery.status = 'leased' and delivery.attempts >= 10
     and delivery.lease_expires_at <= v_now;

  select delivery.id into v_delivery_id
    from app.telegram_deposit_outcome_deliveries delivery
   where delivery.status in ('pending', 'leased')
     and delivery.attempts < 10
     and delivery.next_attempt_at <= v_now
     and (delivery.status = 'pending' or delivery.lease_expires_at <= v_now)
   order by delivery.next_attempt_at, delivery.created_at, delivery.id
   limit 1 for update skip locked;
  if v_delivery_id is null then return; end if;

  return query
  update app.telegram_deposit_outcome_deliveries delivery
     set status = 'leased', attempts = delivery.attempts + 1,
         lease_token = pg_catalog.gen_random_uuid(),
         lease_expires_at = v_now + interval '90 seconds',
         next_attempt_at = v_now + interval '90 seconds',
         updated_at = v_now
   where delivery.id = v_delivery_id
   returning delivery.id, delivery.lease_token, delivery.private_chat_id,
             delivery.outcome_code, delivery.amount_minor, delivery.reference_masked;
end;
$$;

create function app.complete_telegram_deposit_outcome_notification(
  p_notification_id uuid,
  p_lease_token uuid,
  p_result text,
  p_telegram_message_id bigint default null
)
returns boolean
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_delivery app.telegram_deposit_outcome_deliveries%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'Telegram deposit outcome completion is unavailable.';
  end if;
  if p_notification_id is null or p_lease_token is null or p_result is null
     or p_result not in ('sent', 'retry', 'unavailable')
     or (p_result = 'sent' and (p_telegram_message_id is null or p_telegram_message_id <= 0))
     or (p_result <> 'sent' and p_telegram_message_id is not null) then
    return false;
  end if;
  select * into v_delivery
    from app.telegram_deposit_outcome_deliveries delivery
   where delivery.id = p_notification_id for update;
  if v_delivery.id is null or v_delivery.lease_token is distinct from p_lease_token then
    return false;
  end if;
  if v_delivery.status = 'sent' and p_result = 'sent'
     and v_delivery.telegram_message_id = p_telegram_message_id then
    return true;
  end if;
  if v_delivery.status <> 'leased' or v_delivery.lease_expires_at <= v_now then
    return false;
  end if;

  if p_result = 'sent' then
    update app.telegram_deposit_outcome_deliveries delivery
       set status = 'sent', lease_expires_at = null,
           telegram_message_id = p_telegram_message_id,
           sent_at = v_now, updated_at = v_now
     where delivery.id = p_notification_id;
  elsif p_result = 'unavailable' or v_delivery.attempts >= 10 then
    update app.telegram_deposit_outcome_deliveries delivery
       set status = 'unavailable', lease_token = null,
           lease_expires_at = null, updated_at = v_now
     where delivery.id = p_notification_id;
  else
    update app.telegram_deposit_outcome_deliveries delivery
       set status = 'pending', lease_token = null,
           lease_expires_at = null,
           next_attempt_at = v_now + pg_catalog.make_interval(
             secs => pg_catalog.least(300, 5 * (1 << v_delivery.attempts))
           ),
           updated_at = v_now
     where delivery.id = p_notification_id;
  end if;
  return true;
end;
$$;

alter function app.claim_telegram_deposit_outcome_notification() owner to postgres;
alter function app.complete_telegram_deposit_outcome_notification(uuid, uuid, text, bigint)
  owner to postgres;
revoke all on function app.claim_telegram_deposit_outcome_notification(),
  app.complete_telegram_deposit_outcome_notification(uuid, uuid, text, bigint)
  from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime;
grant execute on function app.claim_telegram_deposit_outcome_notification(),
  app.complete_telegram_deposit_outcome_notification(uuid, uuid, text, bigint)
  to fetanagent_player_actions;

comment on table app.telegram_deposit_outcome_deliveries is
  'Seven-day, masked-reference Telegram outcome queue for post-migration paid TeleBirr submissions; never stores a full reference, Player ID, or Bot token.';
comment on function app.claim_telegram_deposit_outcome_notification() is
  'Bot-only, bounded materialization and one-at-a-time lease of final routine TeleBirr customer outcomes; no payment mutation or old-submission backfill.';
comment on function app.complete_telegram_deposit_outcome_notification(uuid, uuid, text, bigint) is
  'Bot-only lease completion after Telegram send. A timeout after send can cause one duplicate notification, never a duplicate credit.';

commit;
