-- Durable, privacy-preserving customer-web request throttling. The browser never reaches this
-- boundary; the single customer-web BFF supplies an HMAC-derived bucket key through its dedicated
-- direct-PostgreSQL role. No raw address, credential, session, or submitted form value is stored.

create table app.customer_web_rate_limit_buckets (
  bucket_key bytea primary key,
  route_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null,
  updated_at timestamptz not null,
  constraint customer_web_rate_limit_bucket_key_exact
    check (octet_length(bucket_key) = 32),
  constraint customer_web_rate_limit_route_key_exact
    check (
      route_key in (
        'GET /auth/recovery',
        'POST /create-account',
        'POST /deposits',
        'POST /deposits/reference',
        'POST /forgot-password',
        'POST /player-ids',
        'POST /sign-in',
        'POST /sign-out',
        'POST /update-password'
      )
    ),
  constraint customer_web_rate_limit_request_count_bounded
    check (request_count between 1 and 1001)
);

create index customer_web_rate_limit_buckets_updated_idx
  on app.customer_web_rate_limit_buckets (updated_at);

alter table app.customer_web_rate_limit_buckets enable row level security;
alter table app.customer_web_rate_limit_buckets force row level security;

revoke all on table app.customer_web_rate_limit_buckets
  from public, anon, authenticated, service_role,
       fetanagent_customer_web, fetanagent_customer_web_runtime;

create function app.consume_customer_web_rate_limit(
  p_bucket_key bytea,
  p_route_key text,
  p_max_requests integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  current_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_count integer;
begin
  if p_bucket_key is null
     or octet_length(p_bucket_key) <> 32
     or p_route_key is null
     or p_route_key not in (
       'GET /auth/recovery',
       'POST /create-account',
       'POST /deposits',
       'POST /deposits/reference',
       'POST /forgot-password',
       'POST /player-ids',
       'POST /sign-in',
       'POST /sign-out',
       'POST /update-password'
     )
     or p_max_requests is null
     or p_max_requests not between 1 and 1000
     or p_window_seconds is null
     or p_window_seconds not between 1 and 3600 then
    raise exception 'The customer-web rate-limit request is invalid.';
  end if;

  delete from app.customer_web_rate_limit_buckets bucket
   where bucket.ctid in (
     select expired.ctid
       from app.customer_web_rate_limit_buckets expired
      where expired.updated_at < v_now - interval '1 day'
      order by expired.updated_at
      limit 32
   );

  if not exists (
    select 1
      from app.customer_web_rate_limit_buckets existing
     where existing.bucket_key = p_bucket_key
  ) then
    perform pg_advisory_xact_lock(1499237451);
    if not exists (
      select 1
        from app.customer_web_rate_limit_buckets existing
       where existing.bucket_key = p_bucket_key
    ) and (
      select count(*)
        from app.customer_web_rate_limit_buckets
    ) >= 50000 then
      allowed := false;
      retry_after_seconds := p_window_seconds;
      current_count := p_max_requests + 1;
      return next;
      return;
    end if;
  end if;

  insert into app.customer_web_rate_limit_buckets as bucket (
    bucket_key,
    route_key,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    p_bucket_key,
    p_route_key,
    v_now,
    1,
    v_now
  )
  on conflict (bucket_key) do update
    set route_key = excluded.route_key,
        window_started_at = case
          when bucket.window_started_at + make_interval(secs => p_window_seconds) <= v_now
            then v_now
          else bucket.window_started_at
        end,
        request_count = case
          when bucket.window_started_at + make_interval(secs => p_window_seconds) <= v_now
            then 1
          else least(bucket.request_count + 1, p_max_requests + 1)
        end,
        updated_at = v_now
    where bucket.route_key = excluded.route_key
  returning bucket.window_started_at, bucket.request_count
       into v_window_started_at, v_count;

  if v_window_started_at is null or v_count is null then
    raise exception 'The customer-web rate-limit request is unavailable.';
  end if;

  allowed := v_count <= p_max_requests;
  retry_after_seconds := case
    when allowed then 0
    else greatest(
      1,
      ceil(
        extract(
          epoch from (
            v_window_started_at + make_interval(secs => p_window_seconds) - v_now
          )
        )
      )::integer
    )
  end;
  current_count := v_count;
  return next;
end;
$$;

alter function app.consume_customer_web_rate_limit(bytea, text, integer, integer)
  owner to postgres;
revoke all on function app.consume_customer_web_rate_limit(bytea, text, integer, integer)
  from public, anon, authenticated, service_role,
       fetanagent_customer_web_runtime;
grant usage on schema app to fetanagent_customer_web;
grant execute on function app.consume_customer_web_rate_limit(bytea, text, integer, integer)
  to fetanagent_customer_web;

comment on table app.customer_web_rate_limit_buckets is
  'Private bounded durable customer-web throttling buckets keyed only by a server HMAC; raw addresses, credentials, sessions, and submitted values are never stored.';
comment on function app.consume_customer_web_rate_limit(bytea, text, integer, integer) is
  'Serialized fixed-window customer-web throttle. Exact route inventory, bounded inputs, storage cap, opportunistic retention, and generic failures preserve a fail-closed public Auth boundary.';
