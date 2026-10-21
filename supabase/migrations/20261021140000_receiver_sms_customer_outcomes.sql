-- SMS results enter the existing masked Telegram delivery queue. No full SMS,
-- reference, receiver or Player ID crosses the notification boundary.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.queue_receiver_sms_customer_outcome(
  p_candidate_id uuid, p_stage text, p_outcome text, p_amount_minor bigint default null
) returns void language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_candidate app.receiver_sms_deposit_candidates%rowtype;
  v_chat_id bigint;
begin
  if p_candidate_id is null or
    not ((p_stage = 'old_pending' and p_outcome = 'older_pending'
      and p_amount_minor is null) or
      (p_stage = 'final' and p_outcome in ('held_review','old_rejected',
        'not_credited') and p_amount_minor is null) or
      (p_stage = 'final' and p_outcome = 'credited'
        and p_amount_minor between 2500 and 2500000)) then
    raise exception 'The receiver SMS customer outcome is invalid.';
  end if;
  select * into v_candidate from app.receiver_sms_deposit_candidates candidate
    where candidate.id = p_candidate_id;
  select telegram_identity.private_chat_id into v_chat_id
    from app.telegram_identities telegram_identity
    where telegram_identity.customer_identity_id = v_candidate.origin_identity_id
      and telegram_identity.private_chat_id = telegram_identity.telegram_user_id;
  if v_candidate.id is null or v_chat_id is null then
    raise exception 'The receiver SMS customer delivery is unavailable.';
  end if;
  insert into app.telegram_deposit_outcome_deliveries
    (candidate_id, notification_stage, private_chat_id, reference_masked,
      outcome_code, amount_minor)
  values (p_candidate_id, p_stage, v_chat_id, v_candidate.reference_masked,
    p_outcome, p_amount_minor)
  on conflict (candidate_id, notification_stage) do nothing;
end;
$$;
alter function app.queue_receiver_sms_customer_outcome(uuid,text,text,bigint)
  owner to postgres;
revoke all on function app.queue_receiver_sms_customer_outcome(uuid,text,text,bigint)
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_receiver_sms_ingest, fetanagent_receiver_sms_ingest_runtime,
    fetanagent_receiver_sms_settlement, fetanagent_receiver_sms_settlement_runtime,
    fetanagent_owner_control, fetanagent_owner_control_runtime;

create function app.notify_receiver_sms_match()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
begin
  if new.disposition = 'older_review' then
    perform app.queue_receiver_sms_customer_outcome(
      new.candidate_id, 'old_pending', 'older_pending', null);
  elsif new.disposition = 'held_review' then
    perform app.queue_receiver_sms_customer_outcome(
      new.candidate_id, 'final', 'held_review', null);
  end if;
  return new;
end;
$$;
alter function app.notify_receiver_sms_match() owner to postgres;
revoke all on function app.notify_receiver_sms_match()
  from public, anon, authenticated, service_role;
create trigger notify_receiver_sms_match
after insert on app.receiver_sms_payment_matches
for each row execute function app.notify_receiver_sms_match();

create function app.notify_receiver_sms_hold()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
begin
  perform app.queue_receiver_sms_customer_outcome(
    new.candidate_id, 'final', 'held_review', null);
  return new;
end;
$$;
alter function app.notify_receiver_sms_hold() owner to postgres;
revoke all on function app.notify_receiver_sms_hold()
  from public, anon, authenticated, service_role;
create trigger notify_receiver_sms_hold
after insert on app.receiver_sms_settlement_holds
for each row execute function app.notify_receiver_sms_hold();

create function app.notify_receiver_sms_owner_decision()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
begin
  if new.decision = 'rejected' then
    perform app.queue_receiver_sms_customer_outcome(
      new.candidate_id, 'final', 'old_rejected', null);
  end if;
  return new;
end;
$$;
alter function app.notify_receiver_sms_owner_decision() owner to postgres;
revoke all on function app.notify_receiver_sms_owner_decision()
  from public, anon, authenticated, service_role;
create trigger notify_receiver_sms_owner_decision
after insert on app.receiver_sms_owner_decisions
for each row execute function app.notify_receiver_sms_owner_decision();

create function app.notify_receiver_sms_intent_terminal()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare v_candidate_id uuid;
begin
  select opening.candidate_id into v_candidate_id
    from app.receiver_sms_intent_openings opening
    where opening.id = new.receiver_sms_opening_id
      and opening.deposit_intent_id = new.id;
  if v_candidate_id is null then
    raise exception 'The receiver SMS intent opening is unavailable.';
  end if;
  if new.status = 'executed' then
    perform app.queue_receiver_sms_customer_outcome(
      v_candidate_id, 'final', 'credited', new.expected_amount_minor);
  else
    perform app.queue_receiver_sms_customer_outcome(
      v_candidate_id, 'final', 'not_credited', null);
  end if;
  return new;
end;
$$;
alter function app.notify_receiver_sms_intent_terminal() owner to postgres;
revoke all on function app.notify_receiver_sms_intent_terminal()
  from public, anon, authenticated, service_role;
create trigger notify_receiver_sms_intent_terminal
after update of status on app.deposit_intents
for each row when (new.receiver_sms_opening_id is not null
  and new.status in ('executed','rejected','expired','cancelled')
  and old.status is distinct from new.status)
execute function app.notify_receiver_sms_intent_terminal();

comment on function app.queue_receiver_sms_customer_outcome(uuid,text,text,bigint) is
  'Private masked Telegram outcome queue for a post-cutover receiver SMS candidate.';
commit;
