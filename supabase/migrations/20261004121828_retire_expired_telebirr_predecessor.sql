-- Retire a naturally expired verifier after its Owner-stopped pilot has already been replaced
-- by a dormant, untouched fixed pilot. The normal emergency stop deliberately remains global;
-- this postgres-only renewal operation never updates a switch, pilot, enrollment, or paid job.

begin;

create function app.retire_expired_trusted_telebirr_predecessor(
  p_actor_auth_user_id uuid,
  p_expected_epoch bigint,
  p_replacement_pilot_revision_id uuid,
  p_request_key uuid
)
returns table (activation_epoch bigint, replayed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  retirement_actor_admin_id uuid;
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  previous_pilot app.private_live_deposit_pilot_revisions%rowtype;
  replacement app.private_live_deposit_pilot_revisions%rowtype;
  intent app.private_trusted_telebirr_emergency_disable_intents%rowtype;
  retired_at timestamptz;
  switch_count integer;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production administrator can retire an expired verifier predecessor.';
  end if;

  if p_actor_auth_user_id is null or p_expected_epoch is null or p_expected_epoch <= 0
    or p_replacement_pilot_revision_id is null or p_request_key is null
    or p_request_key::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'The expired verifier predecessor request is invalid.';
  end if;

  select admin_user.id into retirement_actor_admin_id
    from app.admin_users admin_user
   where (admin_user.auth_user_id = p_actor_auth_user_id or admin_user.id = p_actor_auth_user_id)
     and admin_user.role = 'owner' and admin_user.status = 'active'
   for share;
  if retirement_actor_admin_id is null or (
    select pg_catalog.count(*) from app.admin_users admin_user
     where (admin_user.auth_user_id = p_actor_auth_user_id or admin_user.id = p_actor_auth_user_id)
       and admin_user.role = 'owner' and admin_user.status = 'active'
  ) <> 1 then
    raise exception 'One exact active Owner must authorize expired verifier retirement.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:production:trusted-telebirr-verifier-runtime', 0
  ));

  -- An exact committed replay is read-only, even after the next epoch/login becomes active.
  select emergency_intent.* into intent
    from app.private_trusted_telebirr_emergency_disable_intents emergency_intent
   where emergency_intent.request_key = p_request_key
      or emergency_intent.expected_epoch = p_expected_epoch;
  if intent.request_key is not null then
    if intent.request_key = p_request_key and intent.expected_epoch = p_expected_epoch
      and intent.requested_by_admin_id = retirement_actor_admin_id and intent.reason_code = 'owner_stop'
      and exists (
        select 1 from app.audit_events audit
         where audit.action = 'deposit.trusted_telebirr_expired_predecessor_retired'
           and audit.actor_admin_id = retirement_actor_admin_id
           and audit.metadata = pg_catalog.jsonb_build_object(
             'contract_version', 1, 'activation_epoch', p_expected_epoch,
             'replacement_pilot_revision_id', p_replacement_pilot_revision_id,
             'request_key', p_request_key, 'financially_active', false
           )
      ) then
      return query select p_expected_epoch, true;
      return;
    end if;
    raise exception 'The expired verifier predecessor replay conflicts.';
  end if;

  select activation_epoch.* into authority
    from app.private_trusted_telebirr_activation_control control
    join app.private_trusted_telebirr_activation_epochs activation_epoch
      on activation_epoch.epoch = control.current_epoch
   where control.control_key = 'trusted_telebirr_financial_authority'
     and control.current_epoch = p_expected_epoch
   for update of control, activation_epoch;
  if authority.epoch is null then
    raise exception 'The verifier predecessor epoch changed before retirement.';
  end if;

  perform gate.singleton from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton for update;
  if not found then
    raise exception 'The renewal readiness gate is unavailable.';
  end if;
  perform feature_switch.feature_key from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
     'private_live_deposit_pilot', 'telebirr_authoritative_verification',
     'withdrawal_collection', 'withdrawal_validation'
   ) order by feature_switch.feature_key for update;
  get diagnostics switch_count = row_count;

  perform pilot.id from app.private_live_deposit_pilot_revisions pilot
   where pilot.id in (authority.pilot_revision_id, p_replacement_pilot_revision_id)
   order by pilot.id for update;
  select pilot.* into previous_pilot from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = authority.pilot_revision_id;
  select pilot.* into replacement from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = p_replacement_pilot_revision_id;

  -- Evaluate all time boundaries after acquiring the shared authority/switch/pilot locks.
  retired_at := pg_catalog.clock_timestamp();
  if authority.authority_state <> 'active' or authority.revoked_at is not null
    or authority.expires_at > retired_at or authority.activated_by_admin_id <> retirement_actor_admin_id
    or previous_pilot.id is null or previous_pilot.status <> 'stopped'
    or previous_pilot.expires_at > retired_at or previous_pilot.stop_reason_code <> 'owner_stop'
    or previous_pilot.created_by_admin_id <> retirement_actor_admin_id
    or replacement.id is null or replacement.id = previous_pilot.id
    or replacement.status <> 'armed' or replacement.created_by_admin_id <> retirement_actor_admin_id
    or replacement.armed_by_admin_id <> retirement_actor_admin_id
    or replacement.created_at <= authority.expires_at
    or replacement.active_from > retired_at
    or replacement.expires_at <= retired_at + interval '10 minutes'
    or replacement.expires_at is distinct from replacement.active_from + interval '12 hours'
    or replacement.contract_version <> 1 or replacement.currency_code <> 'ETB'
    or replacement.minimum_amount_minor <> 2500 or replacement.maximum_per_deposit_minor <> 2500
    or replacement.maximum_per_player_minor <> 2500 or replacement.maximum_aggregate_minor <> 12500
    or replacement.maximum_reservation_count <> 5
    or replacement.configuration_digest is null
    or replacement.configuration_digest !~ '^sha256:[0-9a-f]{64}$'
  then
    raise exception 'Only an expired Owner-stopped predecessor and exact new dormant pilot can be retired.';
  end if;

  if switch_count <> 7 or (
    select pg_catalog.count(*) from app.feature_switches feature_switch
     where feature_switch.feature_key in (
       'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
       'telebirr_authoritative_verification', 'withdrawal_collection', 'withdrawal_validation'
     ) and feature_switch.mode = 'disabled' and feature_switch.settings = '{}'::jsonb
  ) <> 6 or not exists (
    select 1 from app.feature_switches pilot_switch
     where pilot_switch.feature_key = 'private_live_deposit_pilot'
       and pilot_switch.mode = 'dry_run'
       and pilot_switch.settings = pg_catalog.jsonb_build_object(
         'contract_version', 1, 'pilot_revision_id', replacement.id,
         'configuration_digest', replacement.configuration_digest
       )
  ) or (
    select pg_catalog.count(*) from app.private_live_deposit_pilot_players player
     where player.pilot_revision_id = replacement.id
  ) <> 5 or exists (
    select 1 from app.private_live_deposit_pilot_reservations reservation
     where reservation.pilot_revision_id in (previous_pilot.id, replacement.id)
  ) then
    raise exception 'Expired verifier retirement requires an untouched exact-five dry-run boundary.';
  end if;

  if exists (
    select 1 from app.deposit_jobs job
     where job.job_kind in ('execute_deposit', 'reconcile_execution')
       and job.status in ('queued', 'leased', 'retry_wait')
  ) or exists (
    select 1 from app.deposit_execution_attempts attempt
     where attempt.status in ('prepared', 'final_action_fenced', 'reconciliation_required', 'review_required')
  ) or not exists (
    select 1 from app.agent_platform_companion_execution_control control
     where control.singleton and control.control_state = 'disabled'
  ) or exists (
    select 1 from pg_catalog.pg_roles role
     where role.rolname in ('fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime')
       and role.rolcanlogin
  ) or exists (
    select 1 from pg_catalog.pg_stat_activity activity
     where activity.usename in ('fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime')
       and activity.pid <> pg_catalog.pg_backend_pid()
  ) or exists (
    select 1 from pg_catalog.pg_roles role
     where role.rolname in ('fetanagent_trusted_telebirr_verifier', 'fetanagent_trusted_telebirr_verifier_runtime')
       and role.rolcanlogin and (role.rolvaliduntil is null or role.rolvaliduntil > retired_at)
  ) then
    raise exception 'Expired verifier retirement cannot cross active execution or an unexpired login.';
  end if;

  perform * from app.disable_private_trusted_telebirr_verifier_login();
  insert into app.private_trusted_telebirr_emergency_disable_intents (
    request_key, expected_epoch, requested_by_admin_id, reason_code, requested_at
  ) values (p_request_key, p_expected_epoch, retirement_actor_admin_id, 'owner_stop', retired_at);
  update app.private_trusted_telebirr_activation_epochs activation_epoch
     set revoked_at = retired_at, revocation_reason_code = 'owner_stop'
   where activation_epoch.epoch = p_expected_epoch;
  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, resource_id, metadata
  ) values (
    'admin', retirement_actor_admin_id, 'deposit.trusted_telebirr_expired_predecessor_retired',
    'private_live_deposit_pilot', previous_pilot.id,
    pg_catalog.jsonb_build_object(
      'contract_version', 1, 'activation_epoch', p_expected_epoch,
      'replacement_pilot_revision_id', replacement.id, 'request_key', p_request_key,
      'financially_active', false
    )
  );
  return query select p_expected_epoch, false;
end;
$$;

alter function app.retire_expired_trusted_telebirr_predecessor(uuid, bigint, uuid, uuid)
  owner to postgres;
revoke all on function app.retire_expired_trusted_telebirr_predecessor(uuid, bigint, uuid, uuid)
from public, anon, authenticated, service_role;

comment on function app.retire_expired_trusted_telebirr_predecessor(uuid, bigint, uuid, uuid) is
  'Postgres-only expired-verifier renewal. Revokes one naturally expired, Owner-stopped predecessor and stale verifier logins, preserves the exact new untouched fixed dry-run pilot and phone pairing, and never enables a switch or executes a job. Exact replay is read-only.';

commit;
