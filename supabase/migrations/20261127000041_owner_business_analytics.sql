-- Owner-only reporting. No financial state, claim, or execution path is changed.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create index telegram_identities_joined_idx
  on app.telegram_identities (created_at desc, telegram_user_id desc);
create index deposit_execution_attempts_confirmed_intent_idx
  on app.deposit_execution_attempts (deposit_intent_id, resolved_at, id)
  where status = 'confirmed_executed' and exact_player_credit_match is true;
create index owner_manual_payment_cases_completed_idx
  on app.owner_manual_payment_cases (completed_at desc)
  where status = 'manually_credited';

create function app.get_owner_business_metrics(p_actor_auth_user_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_result jsonb;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;

  with bounds as (
    select pg_catalog.statement_timestamp() as checked_at,
      (pg_catalog.date_trunc('day', pg_catalog.statement_timestamp() at time zone 'Africa/Addis_Ababa')
        at time zone 'Africa/Addis_Ababa') as day_start,
      (pg_catalog.date_trunc('week', pg_catalog.statement_timestamp() at time zone 'Africa/Addis_Ababa')
        at time zone 'Africa/Addis_Ababa') as week_start,
      (pg_catalog.date_trunc('month', pg_catalog.statement_timestamp() at time zone 'Africa/Addis_Ababa')
        at time zone 'Africa/Addis_Ababa') as month_start
  ), users_summary as (
    select pg_catalog.count(*) as total,
      pg_catalog.count(*) filter (where t.created_at >= b.day_start) as today,
      pg_catalog.count(*) filter (where t.created_at >= b.week_start) as week,
      pg_catalog.count(*) filter (where t.created_at >= b.month_start) as month
    from app.telegram_identities t cross join bounds b
  ), confirmed as (
    select distinct on (a.deposit_intent_id)
      a.deposit_intent_id, a.resolved_at
    from app.deposit_execution_attempts a
    where a.status = 'confirmed_executed'
      and a.exact_player_credit_match is true
      and a.resolved_at is not null
    order by a.deposit_intent_id, a.resolved_at, a.id
  ), automatic_summary as (
    select pg_catalog.count(*) filter (where c.resolved_at >= b.day_start) as today_count,
      coalesce(pg_catalog.sum(i.expected_amount_minor) filter
        (where c.resolved_at >= b.day_start), 0)::text as today_minor,
      pg_catalog.count(*) filter (where c.resolved_at >= b.week_start) as week_count,
      coalesce(pg_catalog.sum(i.expected_amount_minor) filter
        (where c.resolved_at >= b.week_start), 0)::text as week_minor,
      pg_catalog.count(*) filter (where c.resolved_at >= b.month_start) as month_count,
      coalesce(pg_catalog.sum(i.expected_amount_minor) filter
        (where c.resolved_at >= b.month_start), 0)::text as month_minor
    from confirmed c
    join app.deposit_intents i on i.id = c.deposit_intent_id and i.status = 'executed'
    cross join bounds b
  ), manual_summary as (
    select pg_catalog.count(*) filter (where m.completed_at >= b.day_start) as today_count,
      coalesce(pg_catalog.sum(m.amount_minor) filter
        (where m.completed_at >= b.day_start), 0)::text as today_minor,
      pg_catalog.count(*) filter (where m.completed_at >= b.week_start) as week_count,
      coalesce(pg_catalog.sum(m.amount_minor) filter
        (where m.completed_at >= b.week_start), 0)::text as week_minor,
      pg_catalog.count(*) filter (where m.completed_at >= b.month_start) as month_count,
      coalesce(pg_catalog.sum(m.amount_minor) filter
        (where m.completed_at >= b.month_start), 0)::text as month_minor
    from app.owner_manual_payment_cases m cross join bounds b
    where m.status = 'manually_credited'
  )
  select pg_catalog.jsonb_build_object(
    'checkedAt', b.checked_at,
    'timeZone', 'Africa/Addis_Ababa',
    'registeredUsers', u.total,
    'today', pg_catalog.jsonb_build_object('newUsers', u.today,
      'automaticCredits', a.today_count, 'automaticAmountMinor', a.today_minor,
      'manualRecords', m.today_count, 'manualRecordedAmountMinor', m.today_minor),
    'week', pg_catalog.jsonb_build_object('newUsers', u.week,
      'automaticCredits', a.week_count, 'automaticAmountMinor', a.week_minor,
      'manualRecords', m.week_count, 'manualRecordedAmountMinor', m.week_minor),
    'month', pg_catalog.jsonb_build_object('newUsers', u.month,
      'automaticCredits', a.month_count, 'automaticAmountMinor', a.month_minor,
      'manualRecords', m.month_count, 'manualRecordedAmountMinor', m.month_minor)
  ) into v_result
  from bounds b cross join users_summary u cross join automatic_summary a cross join manual_summary m;
  return v_result;
end;
$$;
alter function app.get_owner_business_metrics(uuid) owner to postgres;
revoke all on function app.get_owner_business_metrics(uuid)
  from public, anon, authenticated, service_role, fetanagent_owner_control_runtime;
grant execute on function app.get_owner_business_metrics(uuid) to fetanagent_owner_control;

create function app.list_owner_telegram_users(
  p_actor_auth_user_id uuid, p_telegram_id text, p_limit integer, p_offset integer
)
returns table (
  telegram_user_id text, identity_status text, joined_at timestamptz,
  last_active_at timestamptz, player_count bigint, player_ids text[],
  automatic_credits bigint, automatic_amount_minor text
) language plpgsql stable security definer
set search_path = pg_catalog, pg_temp as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  if (p_telegram_id is not null and p_telegram_id !~ '^[0-9]{1,20}$')
    or p_limit is null or p_limit < 1 or p_limit > 51
    or p_offset is null or p_offset < 0 or p_offset > 10000 then
    raise exception using errcode = '22023', message = 'Invalid user list request.';
  end if;

  return query
  with page as (
    select t.telegram_user_id, t.customer_identity_id, c.customer_id,
      c.status::text as identity_status, t.created_at
    from app.telegram_identities t
    join app.customer_identities c on c.id = t.customer_identity_id
    where p_telegram_id is null or t.telegram_user_id::text = p_telegram_id
    order by t.created_at desc, t.telegram_user_id desc
    limit p_limit offset p_offset
  )
  select p.telegram_user_id::text, p.identity_status, p.created_at,
    (select pg_catalog.max(e.received_at) from app.inbound_events e
      where e.customer_identity_id = p.customer_identity_id and e.channel = 'telegram'),
    (select pg_catalog.count(*) from app.customer_platform_players player
      where player.customer_id = p.customer_id and player.status = 'active'),
    array(select player.player_id from app.customer_platform_players player
      where player.customer_id = p.customer_id and player.status = 'active'
      order by player.created_at desc, player.id desc limit 5),
    credit.automatic_credits, credit.automatic_amount_minor
  from page p
  cross join lateral (
    select pg_catalog.count(*) as automatic_credits,
      coalesce(pg_catalog.sum(intent.expected_amount_minor), 0)::text as automatic_amount_minor
    from app.deposit_intents intent
    where intent.customer_id = p.customer_id and intent.status = 'executed'
      and exists (select 1 from app.deposit_execution_attempts attempt
        where attempt.deposit_intent_id = intent.id
          and attempt.status = 'confirmed_executed'
          and attempt.exact_player_credit_match is true)
  ) credit
  order by p.created_at desc, p.telegram_user_id desc;
end;
$$;
alter function app.list_owner_telegram_users(uuid,text,integer,integer) owner to postgres;
revoke all on function app.list_owner_telegram_users(uuid,text,integer,integer)
  from public, anon, authenticated, service_role, fetanagent_owner_control_runtime;
grant execute on function app.list_owner_telegram_users(uuid,text,integer,integer)
  to fetanagent_owner_control;

commit;
