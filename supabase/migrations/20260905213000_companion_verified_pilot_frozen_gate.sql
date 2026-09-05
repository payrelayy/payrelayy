-- Permit only the reviewed companion-verified dry-run pilot lifecycle while the exact-five
-- KemerBet readiness cohort is frozen. Every source mutation remains frozen, and no live-money
-- switch or provider action is enabled by this migration.

begin;

alter table app.private_owner_kemerbet_readiness_cohort_gate
  add column pilot_mutation_backend_pid integer,
  add column pilot_mutation_transaction_id pg_catalog.xid8,
  add column pilot_mutation_mode text,
  add constraint private_owner_kemerbet_readiness_pilot_mutation_context_check check (
    (
      pilot_mutation_backend_pid is null
      and pilot_mutation_transaction_id is null
      and pilot_mutation_mode is null
    )
    or (
      pilot_mutation_backend_pid is not null
      and pilot_mutation_transaction_id is not null
      and pilot_mutation_mode in ('prepare', 'arm', 'stop')
    )
  );

create or replace function app.serialize_private_owner_kemerbet_readiness_source_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  pilot_mutation_backend_pid integer;
  pilot_mutation_transaction_id pg_catalog.xid8;
  pilot_mutation text;
  reviewed_pilot_mutation boolean := false;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The private KemerBet readiness gate requires read committed isolation.';
  end if;

  select gate.pilot_mutation_backend_pid,
         gate.pilot_mutation_transaction_id,
         gate.pilot_mutation_mode
    into pilot_mutation_backend_pid,
         pilot_mutation_transaction_id,
         pilot_mutation
    from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton
   for update;

  if not found then
    raise exception 'The private KemerBet readiness serialization gate is unavailable.';
  end if;

  if exists (
    select 1
      from app.private_owner_kemerbet_readiness_cohort_claims claim
     where claim.claim_state in ('prepared', 'exported', 'imported')
  ) then
    reviewed_pilot_mutation :=
      pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member')
      and pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
      and pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
      and tg_table_schema = 'app'
      and tg_op <> 'TRUNCATE'
      and (
        (
          pilot_mutation = 'prepare'
          and tg_table_name = 'private_live_deposit_pilot_revisions'
          and tg_op in ('INSERT', 'UPDATE')
        )
        or (
          pilot_mutation in ('arm', 'stop')
          and tg_table_name in ('private_live_deposit_pilot_revisions', 'feature_switches')
          and tg_op = 'UPDATE'
        )
      );

    if reviewed_pilot_mutation is not true then
      raise exception 'The fixed KemerBet readiness cohort is frozen.';
    end if;
  end if;

  return null;
end;
$$;

create or replace function app.prepare_approved_private_live_telebirr_pilot(
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
  actor_admin_id uuid;
  assessed_at timestamptz := pg_catalog.clock_timestamp();
  context_count integer;
  evidence_assignment_id uuid;
  prepared_pilot_id uuid;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();

  if p_actor_auth_user_id is null
    or p_player_ids is null
    or pg_catalog.cardinality(p_player_ids) <> 5
    or (
      select pg_catalog.count(distinct proposed.player_id)::integer
        from pg_catalog.unnest(p_player_ids) proposed(player_id)
       where proposed.player_id is not null
    ) <> 5 then
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
     and assignment.completed_at >= assessed_at - interval '15 minutes'
     and assignment.completed_at <= assessed_at + interval '30 seconds'
     and result.found_count = 5
     and result.not_found_count = 0
     and result.review_required_count = 0
     and result.identifiers_redacted
     and result.transfer_disabled
     and not result.money_moved
     and result.accepted_at is not distinct from assignment.completed_at
     and (
       select pg_catalog.count(*)::integer
         from app.agent_platform_companion_lookup_members lookup_member
        where lookup_member.assignment_id = assignment.assignment_id
     ) = 5
     and not exists (
       select 1
         from app.agent_platform_companion_lookup_members lookup_member
        where lookup_member.assignment_id = assignment.assignment_id
          and not exists (
            select 1
              from app.agent_platform_companion_current_exact_five_players() current_player
             where current_player.player_account_id = lookup_member.player_account_id
               and current_player.player_id is not distinct from lookup_member.player_id_snapshot
               and current_player.eligibility_decision_id is not distinct from
                   lookup_member.eligibility_decision_id
               and current_player.eligibility_decision_version is not distinct from
                   lookup_member.eligibility_decision_version
               and current_player.player_account_updated_at is not distinct from
                   lookup_member.player_account_updated_at_snapshot
               and current_player.decision_decided_at is not distinct from
                   lookup_member.decision_decided_at_snapshot
          )
     )
     and not exists (
       select 1
         from app.agent_platform_companion_current_exact_five_players() current_player
        where not exists (
          select 1
            from app.agent_platform_companion_lookup_members lookup_member
           where lookup_member.assignment_id = assignment.assignment_id
             and lookup_member.player_account_id = current_player.player_account_id
             and lookup_member.player_id_snapshot is not distinct from current_player.player_id
             and lookup_member.eligibility_decision_id is not distinct from
                 current_player.eligibility_decision_id
             and lookup_member.eligibility_decision_version is not distinct from
                 current_player.eligibility_decision_version
             and lookup_member.player_account_updated_at_snapshot is not distinct from
                 current_player.player_account_updated_at
             and lookup_member.decision_decided_at_snapshot is not distinct from
                 current_player.decision_decided_at
        )
     )
     and not exists (
       select 1
         from pg_catalog.unnest(p_player_ids) proposed(player_id)
        where not exists (
          select 1
            from app.agent_platform_companion_current_exact_five_players() current_player
           where current_player.player_id = proposed.player_id
        )
     )
     and not exists (
       select 1
         from app.agent_platform_companion_current_exact_five_players() current_player
        where not current_player.player_id = any(p_player_ids)
     )
   order by assignment.completed_at desc, assignment.assignment_id desc
   limit 1
   for share of assignment, result;

  if evidence_assignment_id is null then
    raise exception 'A fresh accepted exact-five companion lookup is required for this pilot.';
  end if;

  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = pg_catalog.pg_backend_pid(),
         pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id(),
         pilot_mutation_mode = 'prepare'
   where gate.singleton
     and gate.pilot_mutation_backend_pid is null
     and gate.pilot_mutation_transaction_id is null
     and gate.pilot_mutation_mode is null;
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot mutation context is unavailable.';
  end if;

  begin
    prepared_pilot_id := app.prepare_approved_private_live_telebirr_pilot_unverified(
      p_actor_auth_user_id,
      p_request_key,
      p_player_ids,
      p_active_from,
      p_expires_at
    );
  exception when others then
    update app.private_owner_kemerbet_readiness_cohort_gate gate
       set pilot_mutation_backend_pid = null,
           pilot_mutation_transaction_id = null,
           pilot_mutation_mode = null
     where gate.singleton
       and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
       and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
       and gate.pilot_mutation_mode = 'prepare';
    raise;
  end;
  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = null,
         pilot_mutation_transaction_id = null,
         pilot_mutation_mode = null
   where gate.singleton
     and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
     and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
     and gate.pilot_mutation_mode = 'prepare';
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot mutation context did not close.';
  end if;

  perform app.require_companion_verified_private_live_telebirr_pilot(
    p_actor_auth_user_id,
    prepared_pilot_id
  );
  return prepared_pilot_id;
end;
$$;

create or replace function app.arm_companion_verified_private_live_telebirr_pilot(
  p_actor_auth_user_id uuid,
  p_pilot_revision_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  context_count integer;
begin
  perform app.require_companion_verified_private_live_telebirr_pilot(
    p_actor_auth_user_id,
    p_pilot_revision_id
  );

  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = pg_catalog.pg_backend_pid(),
         pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id(),
         pilot_mutation_mode = 'arm'
   where gate.singleton
     and gate.pilot_mutation_backend_pid is null
     and gate.pilot_mutation_transaction_id is null
     and gate.pilot_mutation_mode is null;
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot mutation context is unavailable.';
  end if;

  begin
    perform app.arm_private_live_deposit_pilot(
      p_actor_auth_user_id,
      p_pilot_revision_id
    );
  exception when others then
    update app.private_owner_kemerbet_readiness_cohort_gate gate
       set pilot_mutation_backend_pid = null,
           pilot_mutation_transaction_id = null,
           pilot_mutation_mode = null
     where gate.singleton
       and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
       and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
       and gate.pilot_mutation_mode = 'arm';
    raise;
  end;
  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = null,
         pilot_mutation_transaction_id = null,
         pilot_mutation_mode = null
   where gate.singleton
     and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
     and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
     and gate.pilot_mutation_mode = 'arm';
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot mutation context did not close.';
  end if;
end;
$$;

create or replace function app.stop_private_live_deposit_pilot(
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
  context_count integer;
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

  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = pg_catalog.pg_backend_pid(),
         pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id(),
         pilot_mutation_mode = 'stop'
   where gate.singleton
     and gate.pilot_mutation_backend_pid is null
     and gate.pilot_mutation_transaction_id is null
     and gate.pilot_mutation_mode is null;
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot mutation context is unavailable.';
  end if;

  begin
    perform app.stop_private_live_deposit_pilot_by_admin_id(
      actor_admin_id,
      p_pilot_revision_id,
      p_reason_code
    );
  exception when others then
    update app.private_owner_kemerbet_readiness_cohort_gate gate
       set pilot_mutation_backend_pid = null,
           pilot_mutation_transaction_id = null,
           pilot_mutation_mode = null
     where gate.singleton
       and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
       and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
       and gate.pilot_mutation_mode = 'stop';
    raise;
  end;
  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = null,
         pilot_mutation_transaction_id = null,
         pilot_mutation_mode = null
   where gate.singleton
     and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
     and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
     and gate.pilot_mutation_mode = 'stop';
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot mutation context did not close.';
  end if;
end;
$$;

alter function app.serialize_private_owner_kemerbet_readiness_source_mutation()
  owner to postgres;
alter function app.prepare_approved_private_live_telebirr_pilot(
  uuid, uuid, text[], timestamptz, timestamptz
) owner to postgres;
alter function app.arm_companion_verified_private_live_telebirr_pilot(uuid, uuid)
  owner to postgres;
alter function app.stop_private_live_deposit_pilot(uuid, uuid, text)
  owner to postgres;

revoke all on function
  app.serialize_private_owner_kemerbet_readiness_source_mutation(),
  app.prepare_approved_private_live_telebirr_pilot(
    uuid, uuid, text[], timestamptz, timestamptz
  ),
  app.arm_companion_verified_private_live_telebirr_pilot(uuid, uuid),
  app.stop_private_live_deposit_pilot(uuid, uuid, text)
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
  app.arm_companion_verified_private_live_telebirr_pilot(uuid, uuid),
  app.stop_private_live_deposit_pilot(uuid, uuid, text)
to fetanagent_owner_control;

comment on function app.serialize_private_owner_kemerbet_readiness_source_mutation() is
  'Serializes readiness sources and freezes them while a claim is active. The only frozen-state exception is backend-and-transaction-bound Owner-control DML from the fresh-companion fixed-pilot prepare, dry-run arm, or emergency-stop wrappers; it never permits source edits, deletes, truncates, or live-money authority.';
comment on column app.private_owner_kemerbet_readiness_cohort_gate.pilot_mutation_backend_pid is
  'Ephemeral sealed backend identity for one reviewed fixed-pilot mutation. It is null before the wrapper returns.';
comment on column app.private_owner_kemerbet_readiness_cohort_gate.pilot_mutation_transaction_id is
  'Ephemeral sealed transaction identity for one reviewed fixed-pilot mutation. It is null before the wrapper returns.';
comment on column app.private_owner_kemerbet_readiness_cohort_gate.pilot_mutation_mode is
  'Ephemeral sealed prepare, arm, or stop mode consumed only by the readiness source trigger. It is null before the wrapper returns.';
comment on function app.prepare_approved_private_live_telebirr_pilot(
  uuid, uuid, text[], timestamptz, timestamptz
) is
  'Authenticated Owner fixed-policy preparation gated both before and after snapshot creation by a fresh accepted exact-five KemerBet companion lookup. Its narrow frozen-cohort transition cannot enable or move money.';
comment on function app.arm_companion_verified_private_live_telebirr_pilot(uuid, uuid) is
  'Authenticated Owner arming gated by the accepted companion lookup and unchanged Player snapshots. Its frozen-cohort transition remains dry-run only and cannot move money.';
comment on function app.stop_private_live_deposit_pilot(uuid, uuid, text) is
  'Authenticated Owner emergency-stop adapter that remains callable while the readiness cohort is frozen. Same-reason replay is idempotent and all five pilot/provider/financial switches are disabled before return.';

commit;
