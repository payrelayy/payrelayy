-- Durable, private Telegram feedback for signed, read-only Player ID Finds.
-- The null cutover is intentional: deploying this migration cannot send messages.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.telegram_player_validation_notification_cutover (
  singleton boolean primary key default true check (singleton),
  enabled_at timestamptz
);
insert into app.telegram_player_validation_notification_cutover (singleton, enabled_at)
values (true, null);

create table app.telegram_player_validation_notifications (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  validation_request_id uuid not null unique
    references app.telegram_player_validation_requests (id) on delete restrict,
  private_chat_id bigint not null
    check (private_chat_id > 0 and private_chat_id <= 9007199254740991),
  outcome_code text not null check (outcome_code in ('selected', 'review_required')),
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
  constraint telegram_player_validation_notification_shape check (
    (status = 'pending' and lease_expires_at is null and sent_at is null)
    or (status = 'leased' and lease_token is not null and lease_expires_at is not null
        and sent_at is null)
    or (status = 'sent' and lease_token is not null and lease_expires_at is null
        and sent_at is not null and telegram_message_id is not null)
    or (status = 'unavailable' and lease_expires_at is null and sent_at is null)
  )
);
create index telegram_player_validation_notification_pending_idx
  on app.telegram_player_validation_notifications (next_attempt_at, created_at, id)
  where status in ('pending', 'leased');
create index telegram_player_validation_notification_retention_idx
  on app.telegram_player_validation_notifications (created_at, id)
  where status in ('sent', 'unavailable');
create index telegram_player_validation_terminal_scan_idx
  on app.telegram_player_validation_requests (completed_at, id)
  where status in ('validated', 'review_required');

alter table app.telegram_player_validation_notification_cutover owner to postgres;
alter table app.telegram_player_validation_notifications owner to postgres;
alter table app.telegram_player_validation_notification_cutover enable row level security;
alter table app.telegram_player_validation_notification_cutover force row level security;
alter table app.telegram_player_validation_notifications enable row level security;
alter table app.telegram_player_validation_notifications force row level security;
revoke all on table app.telegram_player_validation_notification_cutover,
  app.telegram_player_validation_notifications
  from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

-- Materialize only a latest, signed terminal decision after an explicit cutover.
-- No raw Player ID, receipt, or payment state enters this delivery queue.
create function app.claim_telegram_player_validation_notification()
returns table (
  notification_id uuid, notification_lease_token uuid,
  notification_private_chat_id bigint, notification_outcome_code text
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
      message = 'Telegram Player validation delivery is unavailable.';
  end if;
  select cutover.enabled_at into v_cutover
    from app.telegram_player_validation_notification_cutover cutover
   where cutover.singleton = true;
  if v_cutover is null then return; end if;

  delete from app.telegram_player_validation_notifications delivery
   where delivery.id in (
     select old.id from app.telegram_player_validation_notifications old
      where old.status in ('sent', 'unavailable')
        and old.created_at < v_now - interval '30 days'
      order by old.created_at, old.id limit 100
   );

  insert into app.telegram_player_validation_notifications (
    validation_request_id, private_chat_id, outcome_code,
    next_attempt_at, created_at, updated_at
  )
  select request.id, telegram_identity.private_chat_id,
         case when request.status = 'validated' then 'selected'
              else 'review_required' end,
         v_now, v_now, v_now
    from app.telegram_player_validation_requests request
    join app.customer_identities identity
      on identity.id = request.telegram_identity_id
     and identity.identity_kind = 'telegram' and identity.status = 'active'
    join app.customers customer
      on customer.id = identity.customer_id and customer.status = 'active'
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
     and identity.external_subject = telegram_identity.telegram_user_id::text
   where request.status in ('validated', 'review_required')
     and request.requested_at >= v_cutover
     and request.completed_at >= v_cutover
     and request.completed_at >= v_now - interval '30 days'
     and exists (
       select 1 from app.telegram_player_validation_results result
        where result.validation_request_id = request.id
     )
     and (request.status = 'review_required' or exists (
       select 1 from app.telegram_player_validation_finalizations finalization
       join app.telegram_player_selections selection
         on selection.telegram_identity_id = request.telegram_identity_id
        and selection.origin_inbound_event_id = request.origin_inbound_event_id
        and selection.player_account_id = finalization.player_account_id
        where finalization.validation_request_id = request.id
     ))
     and not exists (
       select 1 from app.telegram_player_validation_requests newer
        where newer.telegram_identity_id = request.telegram_identity_id
          and newer.id <> request.id
          and newer.requested_at >= request.requested_at
     )
     and not exists (
       select 1 from app.telegram_player_validation_notifications existing
        where existing.validation_request_id = request.id
     )
   order by request.completed_at, request.id
   limit 100
  on conflict (validation_request_id) do nothing;

  -- A newer request makes an unsent result obsolete. A lease already being sent
  -- cannot be revoked safely; its copy describes the historical Find only.
  update app.telegram_player_validation_notifications delivery
     set status = 'unavailable', updated_at = v_now
    from app.telegram_player_validation_requests request
   where request.id = delivery.validation_request_id
     and delivery.status = 'pending'
     and exists (
       select 1 from app.telegram_player_validation_requests newer
        where newer.telegram_identity_id = request.telegram_identity_id
          and newer.id <> request.id
          and newer.requested_at >= request.requested_at
     );

  update app.telegram_player_validation_notifications delivery
     set status = 'unavailable', lease_token = null,
         lease_expires_at = null, updated_at = v_now
   where delivery.status = 'leased' and delivery.attempts >= 10
     and delivery.lease_expires_at <= v_now;

  select delivery.id into v_delivery_id
    from app.telegram_player_validation_notifications delivery
   where delivery.status in ('pending', 'leased')
     and delivery.attempts < 10 and delivery.next_attempt_at <= v_now
     and (delivery.status = 'pending' or delivery.lease_expires_at <= v_now)
   order by delivery.next_attempt_at, delivery.created_at, delivery.id
   limit 1 for update skip locked;
  if v_delivery_id is null then return; end if;

  return query
  update app.telegram_player_validation_notifications delivery
     set status = 'leased', attempts = delivery.attempts + 1,
         lease_token = pg_catalog.gen_random_uuid(),
         lease_expires_at = v_now + interval '90 seconds',
         next_attempt_at = v_now + interval '90 seconds', updated_at = v_now
   where delivery.id = v_delivery_id
   returning delivery.id, delivery.lease_token, delivery.private_chat_id,
             delivery.outcome_code;
end;
$$;

create function app.complete_telegram_player_validation_notification(
  p_notification_id uuid, p_lease_token uuid, p_result text,
  p_telegram_message_id bigint default null
)
returns boolean language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_delivery app.telegram_player_validation_notifications%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'Telegram Player validation completion is unavailable.';
  end if;
  if p_notification_id is null or p_lease_token is null or p_result is null
     or p_result not in ('sent', 'retry', 'unavailable')
     or (p_result = 'sent' and (p_telegram_message_id is null or p_telegram_message_id <= 0))
     or (p_result <> 'sent' and p_telegram_message_id is not null) then
    return false;
  end if;
  select * into v_delivery
    from app.telegram_player_validation_notifications delivery
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
    update app.telegram_player_validation_notifications delivery
       set status = 'sent', lease_expires_at = null,
           telegram_message_id = p_telegram_message_id,
           sent_at = v_now, updated_at = v_now
     where delivery.id = p_notification_id;
  elsif p_result = 'unavailable' or v_delivery.attempts >= 10 then
    update app.telegram_player_validation_notifications delivery
       set status = 'unavailable', lease_token = null,
           lease_expires_at = null, updated_at = v_now
     where delivery.id = p_notification_id;
  else
    update app.telegram_player_validation_notifications delivery
       set status = 'pending', lease_token = null,
           lease_expires_at = null,
           next_attempt_at = v_now + pg_catalog.make_interval(
             secs => pg_catalog.least(300, 5 * (1 << v_delivery.attempts))
           ), updated_at = v_now
     where delivery.id = p_notification_id;
  end if;
  return true;
end;
$$;

alter function app.claim_telegram_player_validation_notification() owner to postgres;
alter function app.complete_telegram_player_validation_notification(uuid,uuid,text,bigint)
  owner to postgres;
revoke all on function app.claim_telegram_player_validation_notification(),
  app.complete_telegram_player_validation_notification(uuid,uuid,text,bigint)
  from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime;
grant execute on function app.claim_telegram_player_validation_notification(),
  app.complete_telegram_player_validation_notification(uuid,uuid,text,bigint)
  to fetanagent_player_actions;

comment on table app.telegram_player_validation_notifications is
  'Private, default-off Telegram delivery queue for signed Player ID Find decisions; no payment authority.';
comment on function app.claim_telegram_player_validation_notification() is
  'Bot-only bounded claim; null cutover prevents all delivery until separately activated.';
comment on function app.complete_telegram_player_validation_notification(uuid,uuid,text,bigint) is
  'Bot-only delivery acknowledgement; an ambiguous Telegram ACK can duplicate a message, never a Player selection.';
commit;
