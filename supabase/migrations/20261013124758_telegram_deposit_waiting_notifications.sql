-- Send one optional progress update only after a signed receipt has opened a
-- verified, still-queued intent. The existing terminal notification remains
-- independent, and neither notification mutates a payment or financial switch.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

-- Do not send a newly introduced progress update for older live submissions.
alter table app.telegram_deposit_outcome_cutover
  add column waiting_enabled_at timestamptz;
update app.telegram_deposit_outcome_cutover
   set waiting_enabled_at = pg_catalog.clock_timestamp()
 where singleton = true;
alter table app.telegram_deposit_outcome_cutover
  alter column waiting_enabled_at set not null;

alter table app.telegram_deposit_outcome_deliveries
  add column notification_stage text not null default 'final'
  check (notification_stage in ('waiting', 'final'));
alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_deposit_outcome_deliveries_candidate_id_key;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_candidate_stage_key
  unique (candidate_id, notification_stage);
alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_deposit_outcome_deliveries_outcome_code_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_code_check
  check (outcome_code in (
    'verified_waiting', 'credited', 'rejected', 'not_credited', 'not_verified'
  ));
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_stage_code_check check (
    (notification_stage = 'waiting' and outcome_code = 'verified_waiting')
    or (notification_stage = 'final' and outcome_code <> 'verified_waiting')
  );

create or replace function app.claim_telegram_deposit_outcome_notification()
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
  v_waiting_cutover timestamptz;
  v_delivery_id uuid;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'Telegram deposit outcome delivery is unavailable.';
  end if;
  select cutover.enabled_at, cutover.waiting_enabled_at
    into v_cutover, v_waiting_cutover
    from app.telegram_deposit_outcome_cutover cutover where cutover.singleton = true;
  if v_cutover is null or v_waiting_cutover is null then
    raise exception 'Telegram deposit outcome cutover is unavailable.';
  end if;

  delete from app.telegram_deposit_outcome_deliveries delivery
   where delivery.id in (
     select expired.id from app.telegram_deposit_outcome_deliveries expired
      where expired.created_at < v_now - interval '7 days'
      order by expired.created_at, expired.id limit 100
   );

  -- Final outcomes are still one per candidate. A missing opening remains
  -- inconclusive until the receipt settlement window plus margin has ended.
  insert into app.telegram_deposit_outcome_deliveries (
    candidate_id, notification_stage, private_chat_id, reference_masked,
    outcome_code, amount_minor, next_attempt_at, created_at, updated_at
  )
  select candidate.id, 'final', telegram_identity.private_chat_id,
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
          and existing.notification_stage = 'final'
     )
   order by candidate.submitted_at, candidate.id
   limit 100
  on conflict (candidate_id, notification_stage) do nothing;

  -- Only an actually verified, still-queued intent earns the progress update.
  -- Waiting for one minute avoids noise for a normally fast idle Companion.
  insert into app.telegram_deposit_outcome_deliveries (
    candidate_id, notification_stage, private_chat_id, reference_masked,
    outcome_code, amount_minor, next_attempt_at, created_at, updated_at
  )
  select candidate.id, 'waiting', telegram_identity.private_chat_id,
         candidate.candidate_reference_masked, 'verified_waiting', null,
         v_now, v_now, v_now
    from app.routine_telebirr_untrusted_proof_requests candidate
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = candidate.origin_identity_id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
    join app.inbound_events inbound_event
      on inbound_event.id = candidate.origin_request_key
     and inbound_event.customer_identity_id = candidate.origin_identity_id
     and inbound_event.channel = 'telegram'
    join app.routine_telebirr_paid_intent_openings opening
      on opening.candidate_id = candidate.id
    join app.deposit_intents intent
      on intent.id = opening.deposit_intent_id
   where candidate.intake_mode = 'paid'
     and candidate.origin_channel = 'telegram'
     and candidate.submitted_at >= v_waiting_cutover
     and candidate.submitted_at >= v_now - interval '7 days'
     and intent.status = 'execution_pending'
     and intent.status_changed_at <= v_now - interval '1 minute'
     and not exists (
       select 1 from app.telegram_deposit_outcome_deliveries existing
        where existing.candidate_id = candidate.id
     )
   order by candidate.submitted_at, candidate.id
   limit 100
  on conflict (candidate_id, notification_stage) do nothing;

  -- Never start a stale waiting send after the intent left the queue. A
  -- currently leased send may finish, so its final message waits for ACK or
  -- lease expiry instead of overtaking it.
  update app.telegram_deposit_outcome_deliveries delivery
     set status = 'unavailable', lease_token = null,
         lease_expires_at = null, updated_at = v_now
   where delivery.notification_stage = 'waiting'
     and (delivery.status = 'pending'
       or (delivery.status = 'leased' and delivery.lease_expires_at <= v_now))
     and not exists (
       select 1 from app.routine_telebirr_paid_intent_openings opening
       join app.deposit_intents intent on intent.id = opening.deposit_intent_id
        where opening.candidate_id = delivery.candidate_id
          and intent.status = 'execution_pending'
     );

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
     and (delivery.notification_stage = 'waiting' or not exists (
       select 1 from app.telegram_deposit_outcome_deliveries waiting
        where waiting.candidate_id = delivery.candidate_id
          and waiting.notification_stage = 'waiting'
          and waiting.status in ('pending', 'leased')
     ))
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

alter function app.claim_telegram_deposit_outcome_notification() owner to postgres;
revoke all on function app.claim_telegram_deposit_outcome_notification()
  from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime;
grant execute on function app.claim_telegram_deposit_outcome_notification()
  to fetanagent_player_actions;

comment on function app.claim_telegram_deposit_outcome_notification() is
  'Bot-only bounded final outcome queue plus one optional verified-and-waiting update after a minute; never mutates a payment or infers rejection from an untrusted reference.';
commit;
