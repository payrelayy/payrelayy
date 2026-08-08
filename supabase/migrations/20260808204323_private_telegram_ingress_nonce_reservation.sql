-- PayReplayy Stage 13B: durable private replay-reservation boundary.
--
-- This migration is intentionally inactive. It does not create a runtime credential, connect the
-- API, register a Telegram route, or record any customer/payment data. It reserves only a
-- one-way digest of an already-authenticated, short-lived internal transport nonce.

begin;

create table app.telegram_private_ingress_nonce_reservations (
  nonce_digest text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),

  constraint telegram_private_ingress_nonce_reservations_digest_check check (
    nonce_digest = lower(btrim(nonce_digest))
    and nonce_digest ~ '^sha256-v1:[0-9a-f]{64}$'
  ),
  constraint telegram_private_ingress_nonce_reservations_finite_expiry_check check (
    isfinite(expires_at)
  ),
  constraint telegram_private_ingress_nonce_reservations_ttl_check check (
    expires_at > created_at
    and expires_at <= created_at + interval '3 minutes'
  )
);

create index telegram_private_ingress_nonce_reservations_expiry_idx
  on app.telegram_private_ingress_nonce_reservations (expires_at, nonce_digest);

alter table app.telegram_private_ingress_nonce_reservations enable row level security;
alter table app.telegram_private_ingress_nonce_reservations force row level security;

create function app.reserve_telegram_private_ingress_nonce(
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
    or p_nonce_digest !~ '^sha256-v1:[0-9a-f]{64}$' then
    raise exception 'The Telegram ingress nonce digest is invalid.' using errcode = 'P0001';
  end if;

  if p_expires_at is null
    or not isfinite(p_expires_at)
    or p_expires_at <= resolved_now
    or p_expires_at > resolved_now + interval '3 minutes' then
    raise exception 'The Telegram ingress nonce expiry is invalid.' using errcode = 'P0001';
  end if;

  insert into app.telegram_private_ingress_nonce_reservations (
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

create function app.purge_expired_telegram_private_ingress_nonce_reservations(
  p_limit integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_now timestamptz := clock_timestamp();
  deleted_count integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'The Telegram ingress nonce purge limit is invalid.' using errcode = 'P0001';
  end if;

  with expired_reservations as (
    select nonce_digest
    from app.telegram_private_ingress_nonce_reservations
    where expires_at <= resolved_now
    order by expires_at, nonce_digest
    limit p_limit
    for update skip locked
  ),
  deleted_reservations as (
    delete from app.telegram_private_ingress_nonce_reservations as reservation
    using expired_reservations
    where reservation.nonce_digest = expired_reservations.nonce_digest
    returning 1
  )
  select count(*)::integer
  into deleted_count
  from deleted_reservations;

  return deleted_count;
end;
$$;

revoke all privileges on table app.telegram_private_ingress_nonce_reservations
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_worker, payreplayy_api_runtime;

revoke all on function app.reserve_telegram_private_ingress_nonce(text, timestamptz)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_worker, payreplayy_api_runtime;

revoke all on function app.purge_expired_telegram_private_ingress_nonce_reservations(integer)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_worker, payreplayy_api_runtime;

grant execute on function app.reserve_telegram_private_ingress_nonce(text, timestamptz)
  to payreplayy_api;

comment on table app.telegram_private_ingress_nonce_reservations is
  'Private, short-lived one-way digests of authenticated Telegram ingress nonces. No raw nonce, Telegram event, customer, payment, or credential data is stored.';

comment on function app.reserve_telegram_private_ingress_nonce(text, timestamptz) is
  'Atomically reserves an authenticated Telegram ingress nonce digest until expiry. API-only; no inbox/customer/payment side effect.';

comment on function app.purge_expired_telegram_private_ingress_nonce_reservations(integer) is
  'Unassigned future maintenance helper for bounded cleanup of expired Telegram ingress nonce reservations.';

commit;
