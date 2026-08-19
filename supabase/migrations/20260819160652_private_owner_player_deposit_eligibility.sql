-- Private Owner-only promotion and revocation boundary for KemerBet deposit eligibility.
--
-- This exposes no table privileges and performs no deposit, payment, or KemerBet action. It only
-- appends an audited decision to the existing serialized eligibility ledger for an already
-- Owner-associated player account. All financial feature switches remain unchanged.

begin;

create function app.list_owner_player_deposit_eligibility(
  p_actor_auth_user_id uuid,
  p_limit integer default 50
)
returns table (
  player_account_id uuid,
  platform_code text,
  player_id text,
  player_status text,
  validation_status text,
  decision_id uuid,
  decision_version integer,
  decision text,
  reason_code text,
  decided_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  actor_admin_id uuid;
begin
  if p_actor_auth_user_id is null or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'The Owner Player-ID deposit-eligibility list request is invalid.';
  end if;

  select admin_user.id
    into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;

  if actor_admin_id is null then
    raise exception 'Only an active Owner can inspect Player-ID deposit eligibility.';
  end if;

  return query
  select player_account.id,
         platform.code,
         player_account.player_id,
         player_account.status::text,
         player_account.validation_status::text,
         latest_decision.id,
         latest_decision.decision_version,
         latest_decision.decision,
         latest_decision.reason_code,
         latest_decision.decided_at
    from app.player_registration_request_associations association
    join app.customer_platform_players player_account
      on player_account.id = association.player_account_id
    join app.platforms platform
      on platform.id = player_account.platform_id
    left join lateral (
      select eligibility_decision.*
        from app.player_deposit_eligibility_decisions eligibility_decision
       where eligibility_decision.player_account_id = player_account.id
       order by eligibility_decision.decision_version desc
       limit 1
    ) latest_decision on true
   where platform.code = 'kemerbet'
   order by association.created_at desc, player_account.id
   limit p_limit;
end;
$$;

create function app.decide_owner_player_deposit_eligibility(
  p_actor_auth_user_id uuid,
  p_player_account_id uuid,
  p_decision text,
  p_reason_code text
)
returns table (
  decided_player_account_id uuid,
  decided_decision_id uuid,
  decided_version integer,
  decided_decision text,
  decided_reason_code text,
  decided_at timestamptz,
  decision_already_recorded boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  actor_admin_id uuid;
  expected_reason_code text;
  latest_decision app.player_deposit_eligibility_decisions%rowtype;
  locked_player app.customer_platform_players%rowtype;
  new_decision app.player_deposit_eligibility_decisions%rowtype;
  normalized_decision text := lower(btrim(p_decision));
  normalized_reason_code text := lower(btrim(p_reason_code));
  resolved_platform app.platforms%rowtype;
begin
  expected_reason_code := case normalized_decision
    when 'eligible' then 'financial_eligibility_approved'
    when 'revoked' then 'financial_eligibility_revoked'
    else null
  end;

  if p_actor_auth_user_id is null
    or p_player_account_id is null
    or expected_reason_code is null
    or normalized_reason_code is distinct from expected_reason_code then
    raise exception 'The Owner Player-ID deposit-eligibility decision is invalid.';
  end if;

  select admin_user.id
    into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;

  if actor_admin_id is null then
    raise exception 'Only an active Owner can decide Player-ID deposit eligibility.';
  end if;

  -- This is the same serialization lock used by the ledger trigger and every new deposit intent.
  select player_account.*
    into locked_player
    from app.customer_platform_players player_account
   where player_account.id = p_player_account_id
   for update;

  if locked_player.id is null then
    raise exception 'The Player-ID account is not eligible for an Owner financial decision.';
  end if;

  select platform.*
    into resolved_platform
    from app.platforms platform
   where platform.id = locked_player.platform_id
   for key share;

  if resolved_platform.id is null
    or resolved_platform.code <> 'kemerbet'
    or not exists (
      select 1
        from app.player_registration_request_associations association
       where association.player_account_id = locked_player.id
    ) then
    raise exception 'The Player-ID account is not eligible for an Owner financial decision.';
  end if;

  if normalized_decision = 'eligible'
    and (
      locked_player.status <> 'active'
      or locked_player.validation_status <> 'valid'
      or resolved_platform.status <> 'active'
    ) then
    raise exception 'Deposit eligibility requires an active, validated Player-ID association.';
  end if;

  select eligibility_decision.*
    into latest_decision
    from app.player_deposit_eligibility_decisions eligibility_decision
   where eligibility_decision.player_account_id = locked_player.id
   order by eligibility_decision.decision_version desc
   limit 1;

  if latest_decision.id is not null
    and latest_decision.decision = normalized_decision
    and latest_decision.reason_code = normalized_reason_code
    and (
      normalized_decision = 'revoked'
      or latest_decision.player_account_updated_at_snapshot
         is not distinct from locked_player.updated_at
    ) then
    return query
    select locked_player.id,
           latest_decision.id,
           latest_decision.decision_version,
           latest_decision.decision,
           latest_decision.reason_code,
           latest_decision.decided_at,
           true;
    return;
  end if;

  insert into app.player_deposit_eligibility_decisions (
    player_account_id,
    decision_version,
    decision,
    reason_code,
    actor_kind,
    actor_admin_id,
    player_account_updated_at_snapshot
  )
  values (
    locked_player.id,
    coalesce(latest_decision.decision_version, 0) + 1,
    normalized_decision,
    normalized_reason_code,
    'admin',
    actor_admin_id,
    locked_player.updated_at
  )
  returning * into new_decision;

  insert into app.audit_events (
    actor_kind,
    actor_admin_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    'admin',
    actor_admin_id,
    'player_deposit_eligibility.owner_decision_recorded',
    'customer_platform_player',
    locked_player.id,
    jsonb_build_object(
      'decision_id', new_decision.id,
      'decision_version', new_decision.decision_version,
      'decision', new_decision.decision,
      'reason_code', new_decision.reason_code,
      'platform_code', resolved_platform.code
    )
  );

  return query
  select locked_player.id,
         new_decision.id,
         new_decision.decision_version,
         new_decision.decision,
         new_decision.reason_code,
         new_decision.decided_at,
         false;
end;
$$;

alter function app.list_owner_player_deposit_eligibility(uuid, integer) owner to postgres;
alter function app.decide_owner_player_deposit_eligibility(uuid, uuid, text, text)
  owner to postgres;

revoke all on function app.list_owner_player_deposit_eligibility(uuid, integer)
  from public, anon, authenticated, service_role,
       fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
       fetanagent_beta_admission, fetanagent_beta_admission_runtime,
       fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_cbe_birr_shadow_worker,
       fetanagent_customer_web, fetanagent_customer_web_runtime,
       fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
       fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

revoke all on function app.decide_owner_player_deposit_eligibility(uuid, uuid, text, text)
  from public, anon, authenticated, service_role,
       fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
       fetanagent_beta_admission, fetanagent_beta_admission_runtime,
       fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_cbe_birr_shadow_worker,
       fetanagent_customer_web, fetanagent_customer_web_runtime,
       fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
       fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

grant execute on function app.list_owner_player_deposit_eligibility(uuid, integer)
  to fetanagent_owner_control;
grant execute on function app.decide_owner_player_deposit_eligibility(uuid, uuid, text, text)
  to fetanagent_owner_control;

comment on function app.list_owner_player_deposit_eligibility(uuid, integer) is
  'Lists only Owner-associated KemerBet Player IDs and their latest append-only deposit-eligibility decision for an authenticated active Owner.';
comment on function app.decide_owner_player_deposit_eligibility(uuid, uuid, text, text) is
  'Appends or idempotently reuses one serialized, audited Owner deposit-eligibility decision; it performs no deposit, payment, or KemerBet action.';

comment on role fetanagent_owner_control is
  'FetanAgent Owner-control group. NOLOGIN; authenticated Owner invite, registration review/association, dry-run assessment, and Player-ID deposit-eligibility decision procedures only.';

commit;
