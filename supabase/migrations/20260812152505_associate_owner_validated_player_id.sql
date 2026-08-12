-- PayReplayy Stage 19: Owner-confirmed KemerBet Player-ID association.
--
-- The earlier Owner review proves only that a submitted Player ID exists. This migration adds a
-- separate, explicit ownership-association decision. Only that second decision may create the
-- validated customer_platform_players binding required by deposit intake. It does not open a
-- deposit, expose payment instructions, enable a feature switch, or contact KemerBet.

begin;

create table app.player_registration_request_associations (
  id uuid primary key default gen_random_uuid(),
  player_registration_request_id uuid not null unique
    references app.player_registration_requests (id) on delete restrict,
  actor_admin_id uuid not null references app.admin_users (id) on delete restrict,
  player_account_id uuid not null unique
    references app.customer_platform_players (id) on delete restrict,
  validation_attempt_id uuid not null unique
    references app.player_validation_attempts (id) on delete restrict,
  reason_code text not null check (reason_code = 'owner_verified_platform_ownership'),
  created_at timestamptz not null default now()
);

create index player_registration_request_associations_actor_created_idx
  on app.player_registration_request_associations (actor_admin_id, created_at desc);

create function app.reject_player_registration_request_association_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'Player ID associations are append-only.';
end;
$$;

create trigger player_registration_request_associations_immutable
before update or delete on app.player_registration_request_associations
for each row
execute function app.reject_player_registration_request_association_mutation();

create trigger player_registration_request_associations_no_truncate
before truncate on app.player_registration_request_associations
for each statement
execute function app.reject_player_registration_request_association_mutation();

create function app.list_owner_player_registration_association_candidates(
  p_actor_auth_user_id uuid,
  p_limit integer default 25
)
returns table (
  registration_request_id uuid,
  platform_code text,
  submitted_player_id text,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  actor_admin_id uuid;
begin
  if p_actor_auth_user_id is null or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'The Owner Player ID association request is invalid.';
  end if;

  select admin_user.id
    into actor_admin_id
  from app.admin_users admin_user
  where admin_user.auth_user_id = p_actor_auth_user_id
    and admin_user.role = 'owner'
    and admin_user.status = 'active'
  for share;

  if actor_admin_id is null then
    raise exception 'Only an active Owner can associate Player IDs.';
  end if;

  return query
  select registration_request.id,
         platform.code,
         registration_request.player_id,
         review.created_at
  from app.player_registration_requests registration_request
  join app.platforms platform on platform.id = registration_request.platform_id
  join app.player_registration_request_reviews review
    on review.player_registration_request_id = registration_request.id
   and review.decision = 'exists'
   and review.reason_code = 'owner_platform_lookup'
  left join app.player_registration_request_associations association
    on association.player_registration_request_id = registration_request.id
  where platform.code = 'kemerbet'
    and registration_request.status = 'exists'
    and association.id is null
  order by review.created_at asc, registration_request.id asc
  limit p_limit;
end;
$$;

create function app.associate_owner_validated_player_registration_request(
  p_actor_auth_user_id uuid,
  p_registration_request_id uuid,
  p_reason_code text
)
returns table (
  associated_registration_request_id uuid,
  associated_player_account_id uuid,
  associated_at timestamptz,
  association_already_recorded boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  actor_admin_id uuid;
  normalized_reason_code text := lower(btrim(p_reason_code));
  registration_request app.player_registration_requests%rowtype;
  resolved_platform_code text;
  existing_association app.player_registration_request_associations%rowtype;
  conflicting_player_account app.customer_platform_players%rowtype;
  new_player_account_id uuid;
  new_validation_attempt_id uuid;
  association_time timestamptz := clock_timestamp();
begin
  if p_actor_auth_user_id is null
    or p_registration_request_id is null
    or normalized_reason_code is distinct from 'owner_verified_platform_ownership' then
    raise exception 'The Owner Player ID association decision is invalid.';
  end if;

  select admin_user.id
    into actor_admin_id
  from app.admin_users admin_user
  where admin_user.auth_user_id = p_actor_auth_user_id
    and admin_user.role = 'owner'
    and admin_user.status = 'active'
  for share;

  if actor_admin_id is null then
    raise exception 'Only an active Owner can associate Player IDs.';
  end if;

  select registration_request_row, platform.code
    into registration_request, resolved_platform_code
  from app.player_registration_requests registration_request_row
  join app.platforms platform on platform.id = registration_request_row.platform_id
  where registration_request_row.id = p_registration_request_id
  for update of registration_request_row, platform;

  if registration_request.id is null
    or registration_request.status <> 'exists'
    or resolved_platform_code <> 'kemerbet'
    or not exists (
      select 1
      from app.player_registration_request_reviews review
      where review.player_registration_request_id = registration_request.id
        and review.decision = 'exists'
        and review.reason_code = 'owner_platform_lookup'
    ) then
    raise exception 'The Player ID request is not eligible for ownership association.';
  end if;

  select association.*
    into existing_association
  from app.player_registration_request_associations association
  where association.player_registration_request_id = registration_request.id
  for key share;

  if existing_association.id is not null then
    return query
    select registration_request.id,
           existing_association.player_account_id,
           existing_association.created_at,
           true;
    return;
  end if;

  select player_account.*
    into conflicting_player_account
  from app.customer_platform_players player_account
  where player_account.platform_id = registration_request.platform_id
    and player_account.player_id = registration_request.player_id
  for update;

  if conflicting_player_account.id is not null then
    raise exception 'The Player ID already has a customer association.';
  end if;

  insert into app.customer_platform_players (
    customer_id,
    platform_id,
    player_id
  )
  values (
    registration_request.customer_id,
    registration_request.platform_id,
    registration_request.player_id
  )
  returning id into new_player_account_id;

  insert into app.player_validation_attempts (
    player_account_id,
    attempt_number,
    outcome,
    reason_code,
    adapter_version,
    started_at,
    completed_at,
    result_digest
  )
  values (
    new_player_account_id,
    1,
    'valid',
    normalized_reason_code,
    'owner_manual_v1',
    association_time,
    association_time,
    null
  )
  returning id into new_validation_attempt_id;

  update app.customer_platform_players player_account
  set validation_status = 'valid'
  where player_account.id = new_player_account_id
    and player_account.validation_status = 'unverified';

  if not found then
    raise exception 'The new Player ID binding could not be validated.';
  end if;

  insert into app.player_registration_request_associations (
    player_registration_request_id,
    actor_admin_id,
    player_account_id,
    validation_attempt_id,
    reason_code,
    created_at
  )
  values (
    registration_request.id,
    actor_admin_id,
    new_player_account_id,
    new_validation_attempt_id,
    normalized_reason_code,
    association_time
  );

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
    'player_registration.owner_association_recorded',
    'customer_platform_player',
    new_player_account_id,
    jsonb_build_object(
      'registration_request_id', registration_request.id,
      'platform_code', resolved_platform_code,
      'reason_code', normalized_reason_code,
      'validation_attempt_id', new_validation_attempt_id
    )
  );

  return query
  select registration_request.id,
         new_player_account_id,
         association_time,
         false;
end;
$$;

alter table app.player_registration_request_associations enable row level security;
alter table app.player_registration_request_associations force row level security;

revoke all privileges on table app.player_registration_request_associations
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime;

revoke all on function app.reject_player_registration_request_association_mutation()
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime;

revoke all on function app.list_owner_player_registration_association_candidates(uuid, integer)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime;

revoke all on function app.associate_owner_validated_player_registration_request(uuid, uuid, text)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime;

grant execute on function app.list_owner_player_registration_association_candidates(uuid, integer)
  to payreplayy_owner_control;
grant execute on function app.associate_owner_validated_player_registration_request(uuid, uuid, text)
  to payreplayy_owner_control;

comment on table app.player_registration_request_associations is
  'Append-only Owner-confirmed ownership associations from reviewed requests to validated KemerBet Player-ID bindings.';

comment on function app.list_owner_player_registration_association_candidates(uuid, integer) is
  'Lists reviewed KemerBet Player IDs that still require an explicit authenticated Owner ownership association.';

comment on function app.associate_owner_validated_player_registration_request(uuid, uuid, text) is
  'Creates one audited validated Player-ID binding only after an authenticated Owner separately confirms platform ownership.';

comment on role payreplayy_owner_control is
  'PayReplayy Owner-control group. NOLOGIN; only authenticated Owner beta-invite, Player-ID review, and explicit Player-ID association procedures.';

commit;
