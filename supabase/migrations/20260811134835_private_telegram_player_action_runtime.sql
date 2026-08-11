-- PayReplayy Stage 16A: isolated Telegram Player-ID action runtime and replay protection.
--
-- This boundary is deliberately non-financial. It may record an already-admitted private update,
-- issue/consume the single KemerBet Player-ID capability, and create a pending validation request.
-- It cannot validate a Player ID, create a proven player binding, open a deposit, verify a payment,
-- call KemerBet, or execute a financial action. Both roles remain NOLOGIN until a separate staging
-- credential workflow is reviewed and approved.

begin;

create role payreplayy_player_actions
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 2;

create role payreplayy_player_actions_runtime
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 2;

grant payreplayy_player_actions to payreplayy_player_actions_runtime
  with inherit true, set false, admin false;

create table app.telegram_private_action_nonce_reservations (
  nonce_digest text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),

  constraint telegram_private_action_nonce_digest_check check (
    nonce_digest = lower(btrim(nonce_digest))
    and nonce_digest ~ '^[0-9a-f]{64}$'
  ),
  constraint telegram_private_action_nonce_finite_expiry_check check (
    isfinite(expires_at)
  ),
  constraint telegram_private_action_nonce_ttl_check check (
    expires_at > created_at
    and expires_at <= created_at + interval '3 minutes'
  )
);

create index telegram_private_action_nonce_expiry_idx
  on app.telegram_private_action_nonce_reservations (expires_at, nonce_digest);

alter table app.telegram_private_action_nonce_reservations enable row level security;
alter table app.telegram_private_action_nonce_reservations force row level security;

create function app.reserve_telegram_private_action_nonce(
  p_nonce_digest text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_now timestamptz := clock_timestamp();
begin
  if p_nonce_digest is null
    or p_nonce_digest <> lower(btrim(p_nonce_digest))
    or p_nonce_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'The Telegram private-action nonce digest is invalid.' using errcode = 'P0001';
  end if;

  if p_expires_at is null
    or not isfinite(p_expires_at)
    or p_expires_at <= resolved_now
    or p_expires_at > resolved_now + interval '3 minutes' then
    raise exception 'The Telegram private-action nonce expiry is invalid.' using errcode = 'P0001';
  end if;

  with expired_reservations as (
    select nonce_digest
    from app.telegram_private_action_nonce_reservations
    where expires_at <= resolved_now
    order by expires_at, nonce_digest
    limit 64
    for update skip locked
  )
  delete from app.telegram_private_action_nonce_reservations as reservation
  using expired_reservations
  where reservation.nonce_digest = expired_reservations.nonce_digest;

  insert into app.telegram_private_action_nonce_reservations (
    nonce_digest,
    expires_at
  )
  values (
    p_nonce_digest,
    p_expires_at
  )
  on conflict (nonce_digest) do nothing;

  return found;
end;
$$;

revoke all privileges on schema app
  from payreplayy_player_actions, payreplayy_player_actions_runtime;
revoke all privileges on all tables in schema app
  from payreplayy_player_actions, payreplayy_player_actions_runtime;
revoke all privileges on all sequences in schema app
  from payreplayy_player_actions, payreplayy_player_actions_runtime;
revoke all privileges on all functions in schema app
  from payreplayy_player_actions, payreplayy_player_actions_runtime;

revoke all privileges on table app.telegram_private_action_nonce_reservations
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;

revoke all on function app.reserve_telegram_private_action_nonce(text, timestamptz)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;

revoke all on function app.record_admitted_telegram_private_inbound_event(
  bigint, bigint, bigint, text, text
) from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;

revoke all on function app.issue_telegram_player_registration_capability(uuid, uuid, text, text)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;

revoke all on function app.start_telegram_player_registration_action(uuid, uuid, text, text)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;

revoke all on function app.submit_telegram_player_registration_input(uuid, text, text)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;

revoke all on function app.expire_telegram_player_registration_action(uuid, text)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;

grant usage on schema app to payreplayy_player_actions;
grant execute on function app.reserve_telegram_private_action_nonce(text, timestamptz)
  to payreplayy_player_actions;
grant execute on function app.record_admitted_telegram_private_inbound_event(
  bigint, bigint, bigint, text, text
) to payreplayy_player_actions;
grant execute on function app.issue_telegram_player_registration_capability(uuid, uuid, text, text)
  to payreplayy_player_actions;
grant execute on function app.start_telegram_player_registration_action(uuid, uuid, text, text)
  to payreplayy_player_actions;
grant execute on function app.submit_telegram_player_registration_input(uuid, text, text)
  to payreplayy_player_actions;
grant execute on function app.expire_telegram_player_registration_action(uuid, text)
  to payreplayy_player_actions;

comment on role payreplayy_player_actions is
  'PayReplayy non-financial Player-ID action group. NOLOGIN; records admitted updates and may only issue, start, submit, or expire the pending Player-ID workflow.';
comment on role payreplayy_player_actions_runtime is
  'PayReplayy Player-ID action runtime scaffold. NOLOGIN until separately provisioned; inherits only payreplayy_player_actions and cannot SET ROLE.';
comment on table app.telegram_private_action_nonce_reservations is
  'Private short-lived one-way digests for the signed Player-ID action transport. No raw nonce, callback, Player ID, customer data, or payment data is stored.';
comment on function app.reserve_telegram_private_action_nonce(text, timestamptz) is
  'Atomically reserves a Player-ID action transport nonce digest and deletes at most 64 expired digests. Player-actions-only and non-financial.';
comment on function app.record_admitted_telegram_private_inbound_event(
  bigint, bigint, bigint, text, text
) is
  'Records an update only for an already redeemed active Telegram identity. Executable only by the isolated Player-ID action group.';
comment on function app.issue_telegram_player_registration_capability(uuid, uuid, text, text) is
  'Issues one opaque KemerBet Player-ID menu capability for an admitted Telegram conversation. Non-financial and Player-actions-only.';
comment on function app.start_telegram_player_registration_action(uuid, uuid, text, text) is
  'Consumes one opaque Player-ID capability and starts the bounded awaiting-input action. Non-financial and Player-actions-only.';
comment on function app.submit_telegram_player_registration_input(uuid, text, text) is
  'Creates or reuses a pending validation request without claiming ownership or calling KemerBet. Non-financial and Player-actions-only.';
comment on function app.expire_telegram_player_registration_action(uuid, text) is
  'Closes an expired Player-ID input action. Non-financial and Player-actions-only.';

commit;
