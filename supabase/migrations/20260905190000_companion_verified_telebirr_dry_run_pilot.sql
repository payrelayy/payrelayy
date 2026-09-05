-- Require a fresh, accepted, exact-five KemerBet companion lookup before the fixed TeleBirr
-- pilot can be prepared or armed. The pilot remains dry-run only: this migration grants no
-- provider, execution, settlement, final-action, or money-movement authority.

begin;

alter function app.prepare_approved_private_live_telebirr_pilot(
  uuid, uuid, text[], timestamptz, timestamptz
) rename to prepare_approved_private_live_telebirr_pilot_unverified;

revoke all on function
  app.prepare_approved_private_live_telebirr_pilot_unverified(
    uuid, uuid, text[], timestamptz, timestamptz
  )
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
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

create function app.require_companion_verified_private_live_telebirr_pilot(
  p_actor_auth_user_id uuid,
  p_pilot_revision_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  evidence_assignment_id uuid;
  current_player_count integer;
  current_snapshot_match_count integer;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();

  if p_actor_auth_user_id is null or p_pilot_revision_id is null then
    raise exception 'Fresh companion verification is required for the private TeleBirr pilot.';
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
    raise exception 'Only the active Owner can use companion-verified pilot controls.';
  end if;

  select candidate.*
    into pilot
    from app.private_live_deposit_pilot_revisions candidate
   where candidate.id = p_pilot_revision_id
     and candidate.created_by_admin_id = actor_admin_id
   for share;

  if pilot.id is null
    or pilot.status not in ('draft', 'armed')
    or pilot.contract_version <> 1
    or pilot.currency_code <> 'ETB'
    or pilot.minimum_amount_minor <> 2500
    or pilot.maximum_per_deposit_minor <> 2500
    or pilot.maximum_per_player_minor <> 2500
    or pilot.maximum_aggregate_minor <> 12500
    or pilot.maximum_reservation_count <> 5
    or pilot.expires_at is distinct from pilot.active_from + interval '2 hours'
    or (
      select pg_catalog.count(*)::integer
        from app.private_live_deposit_pilot_players member
       where member.pilot_revision_id = pilot.id
    ) <> 5
    or (
      select pg_catalog.array_agg(provider.provider_code_snapshot
                                  order by provider.provider_code_snapshot)
        from app.private_live_deposit_pilot_providers provider
       where provider.pilot_revision_id = pilot.id
    ) is distinct from array['telebirr']::text[] then
    raise exception 'The companion proof does not match the fixed private TeleBirr pilot.';
  end if;

  select assignment.assignment_id
    into evidence_assignment_id
    from app.agent_platform_companion_lookup_assignments assignment
    join app.agent_platform_companion_lookup_results result
      on result.assignment_id = assignment.assignment_id
   where assignment.created_by_admin_id = actor_admin_id
     and assignment.platform_code = 'kemerbet'
     and assignment.assignment_kind = 'exact_five_player_lookup'
     and assignment.lookup_mode = 'find_only'
     and assignment.currency_code = 'ETB'
     and assignment.one_use
     and assignment.state = 'completed'
     and assignment.found_count = 5
     and assignment.not_found_count = 0
     and assignment.review_required_count = 0
     and assignment.completed_at is not null
     and assignment.completed_at >= pilot.created_at - interval '15 minutes'
     and assignment.completed_at <= pilot.created_at + interval '30 seconds'
     and result.found_count = 5
     and result.not_found_count = 0
     and result.review_required_count = 0
     and result.identifiers_redacted
     and result.transfer_disabled
     and not result.money_moved
     and result.accepted_at is not distinct from assignment.completed_at
     and (
       select pg_catalog.count(*)::integer
         from app.agent_platform_companion_lookup_members member
        where member.assignment_id = assignment.assignment_id
     ) = 5
     and not exists (
       select 1
         from app.private_live_deposit_pilot_players pilot_player
        where pilot_player.pilot_revision_id = pilot.id
          and not exists (
            select 1
              from app.agent_platform_companion_lookup_members lookup_member
             where lookup_member.assignment_id = assignment.assignment_id
               and lookup_member.player_account_id = pilot_player.player_account_id
               and lookup_member.player_id_snapshot is not distinct from
                   pilot_player.player_id_snapshot
               and lookup_member.eligibility_decision_id is not distinct from
                   pilot_player.eligibility_decision_id_snapshot
               and lookup_member.eligibility_decision_version is not distinct from
                   pilot_player.eligibility_decision_version_snapshot
               and lookup_member.player_account_updated_at_snapshot is not distinct from
                   pilot_player.player_updated_at_snapshot
               and lookup_member.decision_decided_at_snapshot is not distinct from
                   pilot_player.eligibility_decided_at_snapshot
          )
     )
     and not exists (
       select 1
         from app.agent_platform_companion_lookup_members lookup_member
        where lookup_member.assignment_id = assignment.assignment_id
          and not exists (
            select 1
              from app.private_live_deposit_pilot_players pilot_player
             where pilot_player.pilot_revision_id = pilot.id
               and pilot_player.player_account_id = lookup_member.player_account_id
               and pilot_player.player_id_snapshot is not distinct from
                   lookup_member.player_id_snapshot
               and pilot_player.eligibility_decision_id_snapshot is not distinct from
                   lookup_member.eligibility_decision_id
               and pilot_player.eligibility_decision_version_snapshot is not distinct from
                   lookup_member.eligibility_decision_version
               and pilot_player.player_updated_at_snapshot is not distinct from
                   lookup_member.player_account_updated_at_snapshot
               and pilot_player.eligibility_decided_at_snapshot is not distinct from
                   lookup_member.decision_decided_at_snapshot
          )
     )
   order by assignment.completed_at desc, assignment.assignment_id desc
   limit 1
   for share of assignment, result;

  if evidence_assignment_id is null then
    raise exception 'A fresh accepted exact-five companion lookup is required for this pilot.';
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.count(lookup_member.player_account_id)::integer
    into current_player_count, current_snapshot_match_count
    from app.agent_platform_companion_current_exact_five_players() current_player
    left join app.agent_platform_companion_lookup_members lookup_member
      on lookup_member.assignment_id = evidence_assignment_id
     and lookup_member.player_account_id = current_player.player_account_id
     and lookup_member.player_id_snapshot is not distinct from current_player.player_id
     and lookup_member.eligibility_decision_id is not distinct from
         current_player.eligibility_decision_id
     and lookup_member.eligibility_decision_version is not distinct from
         current_player.eligibility_decision_version
     and lookup_member.player_account_updated_at_snapshot is not distinct from
         current_player.player_account_updated_at
     and lookup_member.decision_decided_at_snapshot is not distinct from
         current_player.decision_decided_at;

  if current_player_count <> 5 or current_snapshot_match_count <> 5 then
    raise exception 'The companion-verified Player snapshot is no longer current.';
  end if;

  return evidence_assignment_id;
end;
$$;

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
  prepared_pilot_id uuid;
begin
  prepared_pilot_id := app.prepare_approved_private_live_telebirr_pilot_unverified(
    p_actor_auth_user_id,
    p_request_key,
    p_player_ids,
    p_active_from,
    p_expires_at
  );
  perform app.require_companion_verified_private_live_telebirr_pilot(
    p_actor_auth_user_id,
    prepared_pilot_id
  );
  return prepared_pilot_id;
end;
$$;

create function app.arm_companion_verified_private_live_telebirr_pilot(
  p_actor_auth_user_id uuid,
  p_pilot_revision_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform app.require_companion_verified_private_live_telebirr_pilot(
    p_actor_auth_user_id,
    p_pilot_revision_id
  );
  perform app.arm_private_live_deposit_pilot(
    p_actor_auth_user_id,
    p_pilot_revision_id
  );
end;
$$;

alter function app.require_companion_verified_private_live_telebirr_pilot(uuid, uuid)
  owner to postgres;
alter function app.prepare_approved_private_live_telebirr_pilot(
  uuid, uuid, text[], timestamptz, timestamptz
) owner to postgres;
alter function app.arm_companion_verified_private_live_telebirr_pilot(uuid, uuid)
  owner to postgres;

revoke all on function
  app.require_companion_verified_private_live_telebirr_pilot(uuid, uuid),
  app.prepare_approved_private_live_telebirr_pilot(
    uuid, uuid, text[], timestamptz, timestamptz
  ),
  app.arm_companion_verified_private_live_telebirr_pilot(uuid, uuid),
  app.arm_private_live_deposit_pilot(uuid, uuid)
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
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

grant execute on function
  app.prepare_approved_private_live_telebirr_pilot(
    uuid, uuid, text[], timestamptz, timestamptz
  ),
  app.arm_companion_verified_private_live_telebirr_pilot(uuid, uuid)
to fetanagent_owner_control;

comment on function app.require_companion_verified_private_live_telebirr_pilot(uuid, uuid) is
  'Private assertion binding the fixed dry-run TeleBirr pilot to a fresh accepted exact-five read-only companion result and unchanged Player eligibility snapshots.';
comment on function app.prepare_approved_private_live_telebirr_pilot(
  uuid, uuid, text[], timestamptz, timestamptz
) is
  'Authenticated Owner fixed-policy preparation gated by a fresh accepted exact-five KemerBet companion lookup. It cannot enable or move money.';
comment on function app.arm_companion_verified_private_live_telebirr_pilot(uuid, uuid) is
  'Authenticated Owner arming gated by the same accepted companion lookup and unchanged Player snapshots. Arming remains dry-run only and cannot move money.';

commit;
