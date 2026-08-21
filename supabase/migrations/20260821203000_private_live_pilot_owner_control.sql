-- Strongly authenticated Owner-control adapter boundary for the dormant private live-money pilot.
--
-- The original routines deliberately accepted internal admin IDs and were not granted. Preserve
-- those implementations as private, uncallable helpers, then expose the same four reviewed names
-- as Auth-UUID adapters. Arming remains the existing dry-run-only operation. This migration does
-- not prepare or arm a pilot and does not make any financial or provider switch live.

begin;

alter function app.prepare_private_live_deposit_pilot(
  uuid, uuid, text[], text[], uuid[], bigint, bigint, bigint, bigint, smallint,
  timestamptz, timestamptz
) rename to prepare_private_live_deposit_pilot_by_admin_id;
alter function app.arm_private_live_deposit_pilot(uuid, uuid)
  rename to arm_private_live_deposit_pilot_by_admin_id;
alter function app.stop_private_live_deposit_pilot(uuid, uuid, text)
  rename to stop_private_live_deposit_pilot_by_admin_id;
alter function app.get_private_live_deposit_pilot_status(uuid, uuid)
  rename to get_private_live_deposit_pilot_status_by_admin_id;

revoke all on function
  app.prepare_private_live_deposit_pilot_by_admin_id(
    uuid, uuid, text[], text[], uuid[], bigint, bigint, bigint, bigint, smallint,
    timestamptz, timestamptz
  ),
  app.arm_private_live_deposit_pilot_by_admin_id(uuid, uuid),
  app.stop_private_live_deposit_pilot_by_admin_id(uuid, uuid, text),
  app.get_private_live_deposit_pilot_status_by_admin_id(uuid, uuid)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

create function app.prepare_private_live_deposit_pilot(
  p_actor_auth_user_id uuid,
  p_request_key uuid,
  p_provider_codes text[],
  p_player_ids text[],
  p_submitting_customer_ids uuid[],
  p_minimum_amount_minor bigint,
  p_maximum_per_deposit_minor bigint,
  p_maximum_per_player_minor bigint,
  p_maximum_aggregate_minor bigint,
  p_maximum_reservation_count smallint,
  p_active_from timestamptz,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();

  if p_actor_auth_user_id is null then
    raise exception 'The authenticated Owner subject is required.';
  end if;

  select admin_user.id
    into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;

  -- Disposable migration-owner integration fixtures predate this Auth-facing adapter. Keep their
  -- direct internal-admin calls available only to the exact postgres session; deployed runtime
  -- sessions can resolve exclusively through the verified Supabase Auth UUID above.
  if actor_admin_id is null and session_user = 'postgres' then
    select admin_user.id
      into actor_admin_id
      from app.admin_users admin_user
     where admin_user.id = p_actor_auth_user_id
       and admin_user.role = 'owner'
       and admin_user.status = 'active'
     for share;
  end if;

  if actor_admin_id is null then
    raise exception 'Only the active Owner can prepare the private live-deposit pilot.';
  end if;

  return app.prepare_private_live_deposit_pilot_by_admin_id(
    actor_admin_id,
    p_request_key,
    p_provider_codes,
    p_player_ids,
    p_submitting_customer_ids,
    p_minimum_amount_minor,
    p_maximum_per_deposit_minor,
    p_maximum_per_player_minor,
    p_maximum_aggregate_minor,
    p_maximum_reservation_count,
    p_active_from,
    p_expires_at
  );
end;
$$;

create function app.arm_private_live_deposit_pilot(
  p_actor_auth_user_id uuid,
  p_pilot_revision_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();

  if p_actor_auth_user_id is null then
    raise exception 'The authenticated Owner subject is required.';
  end if;

  select admin_user.id
    into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;

  if actor_admin_id is null and session_user = 'postgres' then
    select admin_user.id
      into actor_admin_id
      from app.admin_users admin_user
     where admin_user.id = p_actor_auth_user_id
       and admin_user.role = 'owner'
       and admin_user.status = 'active'
     for share;
  end if;

  if actor_admin_id is null then
    raise exception 'Only the active Owner can arm the private live-deposit pilot.';
  end if;

  perform app.arm_private_live_deposit_pilot_by_admin_id(
    actor_admin_id,
    p_pilot_revision_id
  );
end;
$$;

create function app.stop_private_live_deposit_pilot(
  p_actor_auth_user_id uuid,
  p_pilot_revision_id uuid,
  p_reason_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();

  if p_actor_auth_user_id is null then
    raise exception 'The authenticated Owner subject is required.';
  end if;

  select admin_user.id
    into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;

  if actor_admin_id is null and session_user = 'postgres' then
    select admin_user.id
      into actor_admin_id
      from app.admin_users admin_user
     where admin_user.id = p_actor_auth_user_id
       and admin_user.role = 'owner'
       and admin_user.status = 'active'
     for share;
  end if;

  if actor_admin_id is null then
    raise exception 'Only the active Owner can stop the private live-deposit pilot.';
  end if;

  perform app.stop_private_live_deposit_pilot_by_admin_id(
    actor_admin_id,
    p_pilot_revision_id,
    p_reason_code
  );
end;
$$;

create function app.get_private_live_deposit_pilot_status(
  p_actor_auth_user_id uuid,
  p_pilot_revision_id uuid
)
returns table (
  pilot_revision_id uuid,
  revision integer,
  contract_version smallint,
  pilot_status text,
  switch_mode text,
  configuration_digest text,
  financially_active boolean,
  within_active_window boolean,
  player_count integer,
  submitting_customer_count integer,
  provider_count integer,
  reserved_deposit_count integer,
  reserved_amount_minor bigint,
  maximum_reservation_count smallint,
  maximum_aggregate_minor bigint,
  expires_at timestamptz,
  stopped_at timestamptz,
  stop_reason_code text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();

  if p_actor_auth_user_id is null then
    raise exception 'The authenticated Owner subject is required.';
  end if;

  select admin_user.id
    into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;

  if actor_admin_id is null and session_user = 'postgres' then
    select admin_user.id
      into actor_admin_id
      from app.admin_users admin_user
     where admin_user.id = p_actor_auth_user_id
       and admin_user.role = 'owner'
       and admin_user.status = 'active'
     for share;
  end if;

  if actor_admin_id is null then
    raise exception 'Only the active Owner can inspect the private live-deposit pilot.';
  end if;

  return query
  select status.*
    from app.get_private_live_deposit_pilot_status_by_admin_id(
      actor_admin_id,
      p_pilot_revision_id
    ) status;
end;
$$;

alter function app.prepare_private_live_deposit_pilot(
  uuid, uuid, text[], text[], uuid[], bigint, bigint, bigint, bigint, smallint,
  timestamptz, timestamptz
) owner to postgres;
alter function app.arm_private_live_deposit_pilot(uuid, uuid) owner to postgres;
alter function app.stop_private_live_deposit_pilot(uuid, uuid, text) owner to postgres;
alter function app.get_private_live_deposit_pilot_status(uuid, uuid) owner to postgres;

revoke all on function
  app.prepare_private_live_deposit_pilot(
    uuid, uuid, text[], text[], uuid[], bigint, bigint, bigint, bigint, smallint,
    timestamptz, timestamptz
  ),
  app.arm_private_live_deposit_pilot(uuid, uuid),
  app.stop_private_live_deposit_pilot(uuid, uuid, text),
  app.get_private_live_deposit_pilot_status(uuid, uuid)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

grant execute on function
  app.prepare_private_live_deposit_pilot(
    uuid, uuid, text[], text[], uuid[], bigint, bigint, bigint, bigint, smallint,
    timestamptz, timestamptz
  ),
  app.arm_private_live_deposit_pilot(uuid, uuid),
  app.stop_private_live_deposit_pilot(uuid, uuid, text),
  app.get_private_live_deposit_pilot_status(uuid, uuid)
to fetanagent_owner_control;

comment on function app.prepare_private_live_deposit_pilot(
  uuid, uuid, text[], text[], uuid[], bigint, bigint, bigint, bigint, smallint,
  timestamptz, timestamptz
) is
  'Authenticated Owner adapter for idempotently preparing one exact private pilot. The UUID-v4 request key and request digest reject conflicting replay; no financial switch is enabled.';
comment on function app.arm_private_live_deposit_pilot(uuid, uuid) is
  'Authenticated Owner adapter that can freeze only the existing dormant dry-run pilot state. It cannot make any switch live.';
comment on function app.stop_private_live_deposit_pilot(uuid, uuid, text) is
  'Authenticated Owner emergency stop adapter. Same-reason replay is idempotent; all five pilot/provider/financial switches are disabled before return.';
comment on function app.get_private_live_deposit_pilot_status(uuid, uuid) is
  'Authenticated Owner aggregate pilot-status adapter. It returns no Player ID, customer ID, receiver identifier, proof, reference, or credential.';

commit;
