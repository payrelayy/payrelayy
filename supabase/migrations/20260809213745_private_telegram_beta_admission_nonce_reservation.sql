-- PayReplayy Stage 15C: durable replay protection for the invite-only beta-admission transport.
--
-- This is intentionally inactive. It creates no LOGIN role, scheduler, API route, bot polling,
-- or invite redemption. It stores only a one-way digest from the beta admission transport's
-- dedicated nonce namespace, and is separate from the generic private-ingress nonce boundary.

begin;

create table app.telegram_beta_invite_admission_nonce_reservations (
  nonce_digest text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),

  constraint telegram_beta_invite_admission_nonce_digest_check check (
    nonce_digest = lower(btrim(nonce_digest))
    and nonce_digest ~ '^[0-9a-f]{64}$'
  ),
  constraint telegram_beta_invite_admission_nonce_finite_expiry_check check (
    isfinite(expires_at)
  ),
  constraint telegram_beta_invite_admission_nonce_ttl_check check (
    expires_at > created_at
    and expires_at <= created_at + interval '3 minutes'
  )
);

create index telegram_beta_invite_admission_nonce_expiry_idx
  on app.telegram_beta_invite_admission_nonce_reservations (expires_at, nonce_digest);

alter table app.telegram_beta_invite_admission_nonce_reservations enable row level security;
alter table app.telegram_beta_invite_admission_nonce_reservations force row level security;

create function app.reserve_telegram_beta_invite_admission_nonce(
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
    raise exception 'The Telegram beta admission nonce digest is invalid.' using errcode = 'P0001';
  end if;

  if p_expires_at is null
    or not isfinite(p_expires_at)
    or p_expires_at <= resolved_now
    or p_expires_at > resolved_now + interval '3 minutes' then
    raise exception 'The Telegram beta admission nonce expiry is invalid.' using errcode = 'P0001';
  end if;

  insert into app.telegram_beta_invite_admission_nonce_reservations (
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

create function app.purge_expired_telegram_beta_invite_admission_nonce_reservations(
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
    raise exception 'The Telegram beta admission nonce purge limit is invalid.' using errcode = 'P0001';
  end if;

  with expired_reservations as (
    select nonce_digest
    from app.telegram_beta_invite_admission_nonce_reservations
    where expires_at <= resolved_now
    order by expires_at, nonce_digest
    limit p_limit
    for update skip locked
  ),
  deleted_reservations as (
    delete from app.telegram_beta_invite_admission_nonce_reservations as reservation
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

revoke all privileges on table app.telegram_beta_invite_admission_nonce_reservations
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime;

revoke all on function app.reserve_telegram_beta_invite_admission_nonce(text, timestamptz)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime;

revoke all on function app.purge_expired_telegram_beta_invite_admission_nonce_reservations(integer)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime;

grant execute on function app.reserve_telegram_beta_invite_admission_nonce(text, timestamptz)
  to payreplayy_beta_admission;

comment on table app.telegram_beta_invite_admission_nonce_reservations is
  'Private, short-lived one-way digests of authenticated Telegram beta-admission nonces. No raw nonce, invite token, Telegram event, customer, payment, or credential data is stored.';

comment on function app.reserve_telegram_beta_invite_admission_nonce(text, timestamptz) is
  'Atomically reserves a beta-admission transport nonce digest until expiry. Beta-admission-only; no invitation, customer, payment, or profile side effect.';

comment on function app.purge_expired_telegram_beta_invite_admission_nonce_reservations(integer) is
  'Unassigned future maintenance helper for bounded cleanup of expired Telegram beta-admission nonce digests.';

comment on role payreplayy_beta_admission is
  'PayReplayy beta-admission group. NOLOGIN; only invite redemption, admitted Telegram inbound recording, and beta-admission nonce reservation.';

commit;
