-- PayReplayy Stage 18: private Owner review for non-claiming KemerBet Player-ID requests.
--
-- An Owner may record only an existence-review outcome for a submitted Player ID. This migration
-- does not call KemerBet, establish Player-ID ownership, create a customer_platform_players row,
-- enable deposits, or grant direct table access. Raw Player IDs are returned only through the
-- authenticated SSH-only Owner-control service and are never copied into the audit log.

begin;

create table app.player_registration_request_reviews (
  id uuid primary key default gen_random_uuid(),
  player_registration_request_id uuid not null
    references app.player_registration_requests (id) on delete restrict,
  actor_admin_id uuid not null references app.admin_users (id) on delete restrict,
  previous_status app.player_registration_request_status not null,
  decision app.player_registration_request_status not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  constraint player_registration_request_reviews_status_change_check
    check (previous_status <> decision),
  constraint player_registration_request_reviews_decision_check check (
    (decision in ('exists', 'not_found') and reason_code = 'owner_platform_lookup')
    or (decision = 'review_required' and reason_code = 'provider_evidence_required')
    or (decision = 'cancelled' and reason_code = 'owner_cancelled')
  ),
  constraint player_registration_request_reviews_request_decision_key
    unique (player_registration_request_id, decision)
);

create index player_registration_request_reviews_actor_created_idx
  on app.player_registration_request_reviews (actor_admin_id, created_at desc);

create function app.reject_player_registration_request_review_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'Player ID registration request reviews are append-only.';
end;
$$;

create trigger player_registration_request_reviews_immutable
before update or delete on app.player_registration_request_reviews
for each row
execute function app.reject_player_registration_request_review_mutation();

create trigger player_registration_request_reviews_no_truncate
before truncate on app.player_registration_request_reviews
for each statement
execute function app.reject_player_registration_request_review_mutation();

create or replace function app.enforce_player_registration_request_binding()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending_validation' then
      raise exception 'A Player ID registration request must begin pending validation.';
    end if;

    return new;
  end if;

  if new.customer_id is distinct from old.customer_id
    or new.platform_id is distinct from old.platform_id
    or new.player_id is distinct from old.player_id then
    raise exception 'Player ID registration request bindings are immutable.';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'pending_validation'
      and new.status in ('exists', 'not_found', 'review_required', 'cancelled') then
      return new;
    end if;

    if old.status = 'review_required'
      and new.status in ('exists', 'not_found', 'cancelled') then
      return new;
    end if;

    raise exception 'The Player ID registration request status transition is invalid.';
  end if;

  return new;
end;
$$;

create function app.list_owner_player_registration_requests(
  p_actor_auth_user_id uuid,
  p_limit integer default 25
)
returns table (
  registration_request_id uuid,
  platform_code text,
  submitted_player_id text,
  request_status text,
  request_created_at timestamptz,
  request_updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  actor_admin_id uuid;
begin
  if p_actor_auth_user_id is null or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'The Owner Player ID review request is invalid.';
  end if;

  select admin_user.id
    into actor_admin_id
  from app.admin_users admin_user
  where admin_user.auth_user_id = p_actor_auth_user_id
    and admin_user.role = 'owner'
    and admin_user.status = 'active'
  for share;

  if actor_admin_id is null then
    raise exception 'Only an active Owner can review Player ID registration requests.';
  end if;

  return query
  select registration_request.id,
         platform.code,
         registration_request.player_id,
         registration_request.status::text,
         registration_request.created_at,
         registration_request.updated_at
  from app.player_registration_requests registration_request
  join app.platforms platform on platform.id = registration_request.platform_id
  where platform.code = 'kemerbet'
    and registration_request.status in ('pending_validation', 'review_required')
  order by registration_request.created_at asc, registration_request.id asc
  limit p_limit;
end;
$$;

create function app.review_owner_player_registration_request(
  p_actor_auth_user_id uuid,
  p_registration_request_id uuid,
  p_decision text,
  p_reason_code text
)
returns table (
  reviewed_registration_request_id uuid,
  reviewed_status text,
  reviewed_at timestamptz,
  decision_already_recorded boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  actor_admin_id uuid;
  current_status app.player_registration_request_status;
  normalized_decision text := lower(btrim(p_decision));
  normalized_reason_code text := lower(btrim(p_reason_code));
  resolved_decision app.player_registration_request_status;
  resolved_platform_code text;
  resolved_reviewed_at timestamptz;
begin
  if p_actor_auth_user_id is null
    or p_registration_request_id is null
    or normalized_decision is null
    or normalized_reason_code is null
    or normalized_decision not in ('exists', 'not_found', 'review_required', 'cancelled')
    or not (
      (normalized_decision in ('exists', 'not_found')
        and normalized_reason_code = 'owner_platform_lookup')
      or (normalized_decision = 'review_required'
        and normalized_reason_code = 'provider_evidence_required')
      or (normalized_decision = 'cancelled'
        and normalized_reason_code = 'owner_cancelled')
    ) then
    raise exception 'The Owner Player ID review decision is invalid.';
  end if;

  resolved_decision := normalized_decision::app.player_registration_request_status;

  select admin_user.id
    into actor_admin_id
  from app.admin_users admin_user
  where admin_user.auth_user_id = p_actor_auth_user_id
    and admin_user.role = 'owner'
    and admin_user.status = 'active'
  for share;

  if actor_admin_id is null then
    raise exception 'Only an active Owner can review Player ID registration requests.';
  end if;

  select registration_request.status, platform.code
    into current_status, resolved_platform_code
  from app.player_registration_requests registration_request
  join app.platforms platform on platform.id = registration_request.platform_id
  where registration_request.id = p_registration_request_id
  for update of registration_request;

  if current_status is null or resolved_platform_code <> 'kemerbet' then
    raise exception 'The Player ID registration request is not available for Owner review.';
  end if;

  if current_status = resolved_decision then
    select review.created_at
      into resolved_reviewed_at
    from app.player_registration_request_reviews review
    where review.player_registration_request_id = p_registration_request_id
      and review.decision = resolved_decision
      and review.reason_code = normalized_reason_code;

    if resolved_reviewed_at is null then
      raise exception 'The recorded Player ID status has no matching Owner review.';
    end if;

    return query
    select p_registration_request_id,
           resolved_decision::text,
           resolved_reviewed_at,
           true;
    return;
  end if;

  if current_status = 'pending_validation' then
    null;
  elsif current_status = 'review_required'
    and resolved_decision in ('exists', 'not_found', 'cancelled') then
    null;
  else
    raise exception 'The Player ID registration request is no longer reviewable.';
  end if;

  update app.player_registration_requests registration_request
  set status = resolved_decision
  where registration_request.id = p_registration_request_id
    and registration_request.status = current_status;

  if not found then
    raise exception 'The Player ID registration request changed during Owner review.';
  end if;

  insert into app.player_registration_request_reviews as review (
    player_registration_request_id,
    actor_admin_id,
    previous_status,
    decision,
    reason_code
  )
  values (
    p_registration_request_id,
    actor_admin_id,
    current_status,
    resolved_decision,
    normalized_reason_code
  )
  returning review.created_at into resolved_reviewed_at;

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
    'player_registration.owner_review_recorded',
    'player_registration_request',
    p_registration_request_id,
    jsonb_build_object(
      'decision', resolved_decision::text,
      'reason_code', normalized_reason_code
    )
  );

  return query
  select p_registration_request_id,
         resolved_decision::text,
         resolved_reviewed_at,
         false;
end;
$$;

alter table app.player_registration_request_reviews enable row level security;
alter table app.player_registration_request_reviews force row level security;

revoke all privileges on table app.player_registration_request_reviews
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime;

revoke all on function app.reject_player_registration_request_review_mutation()
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime;

revoke all on function app.list_owner_player_registration_requests(uuid, integer)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime;

revoke all on function app.review_owner_player_registration_request(uuid, uuid, text, text)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime;

grant execute on function app.list_owner_player_registration_requests(uuid, integer)
  to payreplayy_owner_control;
grant execute on function app.review_owner_player_registration_request(uuid, uuid, text, text)
  to payreplayy_owner_control;

comment on table app.player_registration_request_reviews is
  'Append-only Owner decisions for non-claiming KemerBet Player-ID existence review. A review never proves ownership or enables deposits.';

comment on function app.list_owner_player_registration_requests(uuid, integer) is
  'Lists a bounded queue of pending or review-required KemerBet Player-ID submissions for an authenticated active Owner.';

comment on function app.review_owner_player_registration_request(uuid, uuid, text, text) is
  'Records an authenticated Owner existence-review decision without creating a validated Player-ID binding or enabling deposits.';

comment on role payreplayy_owner_control is
  'PayReplayy Owner-control group. NOLOGIN; only authenticated Owner beta-invite and non-claiming KemerBet Player-ID review procedures.';

commit;
