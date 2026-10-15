-- A bot-owned temporary receipt is presentation only. It has no payment authority,
-- cannot alter an intent, and is never backfilled for older Telegram updates.
-- Install with the two TeleBirr financial switches disabled.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $preflight$
begin
  if (select pg_catalog.count(*) from app.feature_switches switch
      where switch.feature_key in ('payment_verification', 'deposit_execution')
        and switch.mode = 'disabled' and switch.settings = '{}'::jsonb) <> 2 then
    raise exception 'Install temporary Telegram receipts only with TeleBirr financial gates off.';
  end if;
end;
$preflight$;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.telegram_deposit_temporary_messages (
  telegram_update_id bigint primary key check (telegram_update_id >= 0),
  private_chat_id bigint not null
    check (private_chat_id > 0 and private_chat_id <= 9007199254740991),
  telegram_message_id bigint not null check (telegram_message_id > 0),
  status text not null default 'active'
    check (status in ('active', 'cancelled', 'leased', 'deleted', 'unavailable')),
  attempts smallint not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default pg_catalog.clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint telegram_deposit_temporary_state_shape check (
    (status in ('active', 'cancelled') and lease_token is null
      and lease_expires_at is null and deleted_at is null)
    or (status = 'leased' and lease_token is not null
      and lease_expires_at is not null and deleted_at is null)
    or (status = 'deleted' and lease_token is not null
      and lease_expires_at is null and deleted_at is not null)
    or (status = 'unavailable' and lease_expires_at is null
      and deleted_at is null)
  )
);
create index telegram_deposit_temporary_cleanup_idx
  on app.telegram_deposit_temporary_messages (next_attempt_at, created_at, telegram_update_id)
  where status in ('active', 'cancelled', 'leased');
create index telegram_deposit_temporary_retention_idx
  on app.telegram_deposit_temporary_messages (created_at, telegram_update_id);

alter table app.telegram_deposit_temporary_messages owner to postgres;
alter table app.telegram_deposit_temporary_messages enable row level security;
alter table app.telegram_deposit_temporary_messages force row level security;
revoke all on table app.telegram_deposit_temporary_messages
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime;

create function app.record_telegram_deposit_temporary_message(
  p_update_id bigint, p_private_chat_id bigint, p_message_id bigint
)
returns boolean
language plpgsql security definer set search_path = pg_catalog
as $$
declare v_inserted integer;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'Telegram temporary receipt recording is unavailable.';
  end if;
  if p_update_id is null or p_update_id < 0
    or p_private_chat_id is null or p_private_chat_id <= 0
    or p_private_chat_id > 9007199254740991
    or p_message_id is null or p_message_id <= 0 then
    return false;
  end if;
  insert into app.telegram_deposit_temporary_messages (
    telegram_update_id, private_chat_id, telegram_message_id
  ) values (p_update_id, p_private_chat_id, p_message_id)
  on conflict (telegram_update_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then return true; end if;
  return exists (
    select 1 from app.telegram_deposit_temporary_messages notice
     where notice.telegram_update_id = p_update_id
       and notice.private_chat_id = p_private_chat_id
       and notice.telegram_message_id = p_message_id
       and notice.status in ('active', 'cancelled', 'leased', 'deleted')
  );
end;
$$;

create function app.cancel_telegram_deposit_temporary_message(
  p_update_id bigint, p_private_chat_id bigint, p_message_id bigint
)
returns boolean
language plpgsql security definer set search_path = pg_catalog
as $$
declare v_count integer;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'Telegram temporary receipt cancellation is unavailable.';
  end if;
  update app.telegram_deposit_temporary_messages notice
     set status = 'cancelled', next_attempt_at = pg_catalog.clock_timestamp(),
         updated_at = pg_catalog.clock_timestamp()
   where notice.telegram_update_id = p_update_id
     and notice.private_chat_id = p_private_chat_id
     and notice.telegram_message_id = p_message_id
     and notice.status = 'active';
  get diagnostics v_count = row_count;
  return v_count = 1 or exists (
    select 1 from app.telegram_deposit_temporary_messages notice
     where notice.telegram_update_id = p_update_id
       and notice.private_chat_id = p_private_chat_id
       and notice.telegram_message_id = p_message_id
       and notice.status in ('cancelled', 'leased', 'deleted')
  );
end;
$$;

create function app.claim_telegram_deposit_temporary_deletion()
returns table (
  cleanup_update_id bigint,
  cleanup_lease_token uuid,
  cleanup_private_chat_id bigint,
  cleanup_message_id bigint
)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_update_id bigint;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'Telegram temporary receipt cleanup is unavailable.';
  end if;
  delete from app.telegram_deposit_temporary_messages notice
   where notice.telegram_update_id in (
     select expired.telegram_update_id
       from app.telegram_deposit_temporary_messages expired
      where expired.created_at < v_now - interval '7 days'
        and expired.status in ('deleted', 'unavailable')
      order by expired.created_at, expired.telegram_update_id limit 100
   );
  update app.telegram_deposit_temporary_messages notice
     set status = 'unavailable', lease_token = null,
         lease_expires_at = null, updated_at = v_now
   where notice.status in ('active', 'cancelled', 'leased')
     and (notice.attempts >= 10 or notice.created_at <= v_now - interval '48 hours')
     and (notice.status <> 'leased' or notice.lease_expires_at <= v_now);

  select notice.telegram_update_id into v_update_id
    from app.telegram_deposit_temporary_messages notice
   where notice.status in ('active', 'cancelled', 'leased')
     and notice.attempts < 10
     and notice.created_at > v_now - interval '48 hours'
     and notice.next_attempt_at <= v_now
     and (notice.status <> 'leased' or notice.lease_expires_at <= v_now)
     and (
       notice.status = 'cancelled'
       or (notice.created_at <= v_now - interval '5 minutes' and not exists (
         select 1 from app.inbound_events inbound_event
         join app.routine_telebirr_untrusted_proof_requests candidate
           on candidate.origin_request_key = inbound_event.id
          and candidate.intake_mode = 'paid'
          and candidate.origin_channel = 'telegram'
          where inbound_event.channel = 'telegram'
            and inbound_event.telegram_update_id = notice.telegram_update_id
       ))
       or exists (
         select 1 from app.inbound_events inbound_event
         join app.routine_telebirr_untrusted_proof_requests candidate
           on candidate.origin_request_key = inbound_event.id
          and candidate.intake_mode = 'paid'
          and candidate.origin_channel = 'telegram'
         join app.telegram_deposit_outcome_deliveries delivery
           on delivery.candidate_id = candidate.id
          and delivery.private_chat_id = notice.private_chat_id
          and delivery.status = 'sent'
          where inbound_event.channel = 'telegram'
            and inbound_event.telegram_update_id = notice.telegram_update_id
       )
     )
   order by notice.next_attempt_at, notice.created_at, notice.telegram_update_id
   limit 1 for update skip locked;
  if v_update_id is null then return; end if;
  return query
  update app.telegram_deposit_temporary_messages notice
     set status = 'leased', attempts = notice.attempts + 1,
         lease_token = pg_catalog.gen_random_uuid(),
         lease_expires_at = v_now + interval '90 seconds',
         next_attempt_at = v_now + interval '90 seconds',
         updated_at = v_now
   where notice.telegram_update_id = v_update_id
   returning notice.telegram_update_id, notice.lease_token,
             notice.private_chat_id, notice.telegram_message_id;
end;
$$;

create function app.complete_telegram_deposit_temporary_deletion(
  p_update_id bigint, p_lease_token uuid, p_result text
)
returns boolean
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_notice app.telegram_deposit_temporary_messages%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'Telegram temporary receipt completion is unavailable.';
  end if;
  if p_update_id is null or p_lease_token is null or p_result is null
    or p_result not in ('deleted', 'retry', 'unavailable') then return false; end if;
  select * into v_notice from app.telegram_deposit_temporary_messages notice
   where notice.telegram_update_id = p_update_id for update;
  if v_notice.telegram_update_id is null
    or v_notice.lease_token is distinct from p_lease_token then return false; end if;
  if v_notice.status = 'deleted' and p_result = 'deleted' then return true; end if;
  if v_notice.status <> 'leased' or v_notice.lease_expires_at <= v_now then
    return false;
  end if;
  if p_result = 'deleted' then
    update app.telegram_deposit_temporary_messages notice
       set status = 'deleted', lease_expires_at = null,
           deleted_at = v_now, updated_at = v_now
     where notice.telegram_update_id = p_update_id;
  elsif p_result = 'unavailable' or v_notice.attempts >= 10 then
    update app.telegram_deposit_temporary_messages notice
       set status = 'unavailable', lease_token = null,
           lease_expires_at = null, updated_at = v_now
     where notice.telegram_update_id = p_update_id;
  else
    update app.telegram_deposit_temporary_messages notice
       set status = case when v_notice.status = 'leased' then 'cancelled' else 'active' end,
           lease_token = null, lease_expires_at = null,
           next_attempt_at = v_now + pg_catalog.make_interval(
             secs => pg_catalog.least(300, 5 * (1 << v_notice.attempts))
           ), updated_at = v_now
     where notice.telegram_update_id = p_update_id;
  end if;
  return true;
end;
$$;

alter function app.record_telegram_deposit_temporary_message(bigint, bigint, bigint)
  owner to postgres;
alter function app.cancel_telegram_deposit_temporary_message(bigint, bigint, bigint)
  owner to postgres;
alter function app.claim_telegram_deposit_temporary_deletion() owner to postgres;
alter function app.complete_telegram_deposit_temporary_deletion(bigint, uuid, text)
  owner to postgres;
revoke all on function app.record_telegram_deposit_temporary_message(bigint, bigint, bigint),
  app.cancel_telegram_deposit_temporary_message(bigint, bigint, bigint),
  app.claim_telegram_deposit_temporary_deletion(),
  app.complete_telegram_deposit_temporary_deletion(bigint, uuid, text)
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime;
grant execute on function app.record_telegram_deposit_temporary_message(bigint, bigint, bigint),
  app.cancel_telegram_deposit_temporary_message(bigint, bigint, bigint),
  app.claim_telegram_deposit_temporary_deletion(),
  app.complete_telegram_deposit_temporary_deletion(bigint, uuid, text)
  to fetanagent_player_actions;

comment on table app.telegram_deposit_temporary_messages is
  'Bot-owned ephemeral Telegram notice IDs only; no receipt, amount, Player ID, or payment authority.';
comment on function app.claim_telegram_deposit_temporary_deletion() is
  'Bot-only bounded deletion lease after a customer status was sent or an unprocessed notice expired.';
commit;
