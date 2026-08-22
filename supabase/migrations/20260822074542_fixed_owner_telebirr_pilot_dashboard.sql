-- Fixed, same-origin Owner dashboard boundary for the approved first private-money pilot.
--
-- This replaces the Owner runtime's generic pilot-preparation authority with one exact contract:
-- TeleBirr only, five current KemerBet Players, one submitting-customer membership derived from
-- each selected Player owner, 25 ETB per deposit and per Player, 125 ETB aggregate, five immutable
-- reservations, and an exact two-hour window. Preparation and arming remain financially dormant;
-- this migration does not enable a provider, verification, execution, or final-action switch.

begin;

create function app.prepare_approved_private_live_telebirr_pilot(
  p_actor_auth_user_id uuid,
  p_request_key uuid,
  p_player_ids text[],
  p_active_from timestamptz,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  captured_at timestamptz := clock_timestamp();
  submitting_customer_ids uuid[];
  matched_player_count integer;
  prepared_pilot_id uuid;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();

  if p_actor_auth_user_id is null
    or p_request_key is null
    or p_player_ids is null
    or pg_catalog.cardinality(p_player_ids) <> 5
    or p_active_from is null
    or p_expires_at is null
    or p_expires_at is distinct from p_active_from + interval '2 hours'
    or p_active_from < captured_at - interval '1 minute'
    or p_active_from > captured_at + interval '5 minutes' then
    raise exception 'The approved private TeleBirr pilot request is invalid.';
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.array_agg(distinct player.customer_id order by player.customer_id)
    into matched_player_count, submitting_customer_ids
    from app.customer_platform_players player
    join app.platforms platform on platform.id = player.platform_id
   where platform.code = 'kemerbet'
     and player.player_id = any(p_player_ids);

  if matched_player_count <> 5
    or submitting_customer_ids is null
    or pg_catalog.cardinality(submitting_customer_ids) not between 1 and 5 then
    raise exception 'The approved private TeleBirr pilot cohort is invalid.';
  end if;

  prepared_pilot_id := app.prepare_private_live_deposit_pilot(
    p_actor_auth_user_id,
    p_request_key,
    array['telebirr']::text[],
    p_player_ids,
    submitting_customer_ids,
    2500,
    2500,
    2500,
    12500,
    5,
    p_active_from,
    p_expires_at
  );

  if p_active_from < clock_timestamp() - interval '1 minute'
    or p_active_from > clock_timestamp() + interval '5 minutes' then
    raise exception 'The approved private TeleBirr pilot window became stale while locks were acquired.';
  end if;

  -- Re-read the immutable rows written by the generic owner-only implementation. This closes any
  -- ownership change between deriving the customer set and the implementation's canonical locks.
  if not exists (
    select 1
      from app.private_live_deposit_pilot_revisions pilot
     where pilot.id = prepared_pilot_id
       and pilot.minimum_amount_minor = 2500
       and pilot.maximum_per_deposit_minor = 2500
       and pilot.maximum_per_player_minor = 2500
       and pilot.maximum_aggregate_minor = 12500
       and pilot.maximum_reservation_count = 5
       and pilot.active_from is not distinct from p_active_from
       and pilot.expires_at is not distinct from p_expires_at
       and (
         select pg_catalog.array_agg(provider.provider_code_snapshot order by provider.provider_code_snapshot)
           from app.private_live_deposit_pilot_providers provider
          where provider.pilot_revision_id = pilot.id
       ) = array['telebirr']::text[]
       and (
         select pg_catalog.array_agg(member.player_id_snapshot order by member.player_id_snapshot)
           from app.private_live_deposit_pilot_players member
          where member.pilot_revision_id = pilot.id
       ) = (
         select pg_catalog.array_agg(input_player_id order by input_player_id)
           from pg_catalog.unnest(p_player_ids) input_player_id
       )
       and (
         select pg_catalog.array_agg(customer.customer_id order by customer.customer_id)
           from app.private_live_deposit_pilot_customers customer
          where customer.pilot_revision_id = pilot.id
       ) = (
         select pg_catalog.array_agg(distinct member.player_owner_customer_id_snapshot
                                     order by member.player_owner_customer_id_snapshot)
           from app.private_live_deposit_pilot_players member
          where member.pilot_revision_id = pilot.id
       )
  ) then
    raise exception 'The approved private TeleBirr pilot snapshot is inconsistent.';
  end if;

  return prepared_pilot_id;
end;
$$;

create function app.get_current_private_live_deposit_pilot_status(
  p_actor_auth_user_id uuid
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
  current_pilot_id uuid;
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
    raise exception 'Only the active Owner can read the current private live-deposit pilot.';
  end if;

  select pilot.id
    into current_pilot_id
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.created_by_admin_id = actor_admin_id
     and pilot.status in ('draft', 'armed')
   order by pilot.created_at desc, pilot.id desc
   limit 1;

  if current_pilot_id is null then
    return;
  end if;

  return query
  select status.*
    from app.get_private_live_deposit_pilot_status(
      p_actor_auth_user_id,
      current_pilot_id
    ) status;
end;
$$;

alter function app.prepare_approved_private_live_telebirr_pilot(
  uuid, uuid, text[], timestamptz, timestamptz
) owner to postgres;
alter function app.get_current_private_live_deposit_pilot_status(uuid) owner to postgres;

revoke all on function
  app.prepare_private_live_deposit_pilot(
    uuid, uuid, text[], text[], uuid[], bigint, bigint, bigint, bigint, smallint,
    timestamptz, timestamptz
  ),
  app.prepare_approved_private_live_telebirr_pilot(
    uuid, uuid, text[], timestamptz, timestamptz
  ),
  app.get_current_private_live_deposit_pilot_status(uuid)
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
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime;

grant execute on function
  app.prepare_approved_private_live_telebirr_pilot(
    uuid, uuid, text[], timestamptz, timestamptz
  ),
  app.get_current_private_live_deposit_pilot_status(uuid)
to fetanagent_owner_control;

comment on function app.prepare_approved_private_live_telebirr_pilot(
  uuid, uuid, text[], timestamptz, timestamptz
) is
  'Authenticated Owner fixed-policy preparation: TeleBirr only, exactly five KemerBet Players, owner-derived submitting customers, 25 ETB per deposit/Player, 125 ETB aggregate, five reservations, and exactly two hours. It cannot enable money.';
comment on function app.get_current_private_live_deposit_pilot_status(uuid) is
  'Authenticated Owner aggregate lookup for the single current draft or armed pilot. It returns no Player, customer, receiver, reference, proof, or credential identifiers.';

commit;
