-- Owner reporting follows the Telegram payer and their saved Player selection.
-- The beneficiary Player may belong to a different customer. These joins read
-- existing one-use settlement lineages; they do not change claims or execution.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create index receiver_sms_candidates_origin_identity_idx
  on app.receiver_sms_deposit_candidates (origin_identity_id, id);

create or replace function app.list_owner_telegram_users(
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
    select t.telegram_user_id, t.customer_identity_id,
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
    case when selection.player_id is null then 0::bigint else 1::bigint end,
    case when selection.player_id is null then array[]::text[]
      else array[selection.player_id] end,
    credit.automatic_credits, credit.automatic_amount_minor
  from page p
  left join lateral (
    select player.player_id
    from app.telegram_player_selections saved
    join app.customer_platform_players player on player.id = saved.player_account_id
    where saved.telegram_identity_id = p.customer_identity_id
  ) selection on true
  cross join lateral (
    with attributed_intents as (
      select lineage.deposit_intent_id
      from app.receiver_sms_deposit_candidates candidate
      join app.receiver_sms_settlement_lineages lineage on lineage.candidate_id = candidate.id
      where candidate.origin_identity_id = p.customer_identity_id
      union
      select lineage.deposit_intent_id
      from app.routine_telebirr_untrusted_proof_requests candidate
      join app.routine_telebirr_paid_observation_lineages lineage on lineage.candidate_id = candidate.id
      where candidate.origin_identity_id = p.customer_identity_id
    )
    select pg_catalog.count(*) as automatic_credits,
      coalesce(pg_catalog.sum(intent.expected_amount_minor), 0)::text as automatic_amount_minor
    from attributed_intents attributed
    join app.deposit_intents intent
      on intent.id = attributed.deposit_intent_id and intent.status = 'executed'
    where exists (select 1 from app.deposit_execution_attempts attempt
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
