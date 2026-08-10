-- PayReplayy Stage 15E: keep beta-admission replay digests bounded under invalid-token traffic.
--
-- The bot-facing role still cannot call the standalone purge helper or access the table directly.
-- Each otherwise valid reservation performs one indexed, SKIP LOCKED cleanup batch before its
-- atomic insert, so expired digests do not accumulate indefinitely when the beta is online.

begin;

create or replace function app.reserve_telegram_beta_invite_admission_nonce(
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

  with expired_reservations as (
    select nonce_digest
    from app.telegram_beta_invite_admission_nonce_reservations
    where expires_at <= resolved_now
    order by expires_at, nonce_digest
    limit 64
    for update skip locked
  )
  delete from app.telegram_beta_invite_admission_nonce_reservations as reservation
  using expired_reservations
  where reservation.nonce_digest = expired_reservations.nonce_digest;

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

revoke all on function app.reserve_telegram_beta_invite_admission_nonce(text, timestamptz)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime;

grant execute on function app.reserve_telegram_beta_invite_admission_nonce(text, timestamptz)
  to payreplayy_beta_admission;

comment on function app.reserve_telegram_beta_invite_admission_nonce(text, timestamptz) is
  'Atomically reserves a beta-admission transport nonce digest and opportunistically deletes at most 64 expired digests. Beta-admission-only; no invitation, customer, payment, or profile side effect.';

commit;
