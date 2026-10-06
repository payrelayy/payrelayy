-- Owner-only stop for one exact routine phone enrollment. This is safe to call even if a
-- financial switch changes later: revocation never creates provider or payment authority.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.revoke_owner_routine_telebirr_device_enrollment(
  p_actor_auth_user_id uuid, p_enrollment_id uuid
)
returns table (enrollment_id uuid, revoked_at timestamptz, already_revoked boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_challenge app.routine_telebirr_device_pairing_challenges%rowtype;
  v_enrollment app.routine_telebirr_device_enrollments%rowtype;
  v_revocation app.routine_telebirr_device_enrollment_revocations%rowtype;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member') is not true
    or p_actor_auth_user_id is null or p_enrollment_id is null then
    raise exception using errcode = '42501',
      message = 'The routine phone revocation request is invalid.';
  end if;
  v_actor_id := app.require_routine_telebirr_owner(p_actor_auth_user_id);

  -- The consumed challenge's Owner/evidence binding is immutable. Read it without a row lock,
  -- then lock only the enrollment against concurrent lookup issuance and receipt reads.
  select challenge.* into v_challenge
    from app.routine_telebirr_device_pairing_challenges challenge
    join app.routine_telebirr_device_enrollments enrollment
      on enrollment.pairing_evidence_digest = challenge.pairing_evidence_digest
    where enrollment.id = p_enrollment_id
      and challenge.created_by_admin_id = v_actor_id
      and challenge.consumed_at is not null;
  if v_challenge.pairing_id is null then
    raise exception using errcode = '42501',
      message = 'The routine phone enrollment is unavailable.';
  end if;
  select enrollment.* into v_enrollment
    from app.routine_telebirr_device_enrollments enrollment
    where enrollment.id = p_enrollment_id
      and enrollment.pairing_evidence_digest = v_challenge.pairing_evidence_digest
    for update;
  if v_enrollment.id is null then
    raise exception using errcode = '42501',
      message = 'The routine phone enrollment is unavailable.';
  end if;

  select revocation.* into v_revocation
    from app.routine_telebirr_device_enrollment_revocations revocation
    where revocation.enrollment_id = v_enrollment.id;
  if v_revocation.enrollment_id is not null then
    return query select v_enrollment.id, v_revocation.revoked_at, true;
    return;
  end if;

  insert into app.routine_telebirr_device_enrollment_revocations
    (enrollment_id, reason_code)
    values (v_enrollment.id, 'owner_revoked')
    returning * into v_revocation;
  return query select v_enrollment.id, v_revocation.revoked_at, false;
end;
$$;

alter function app.revoke_owner_routine_telebirr_device_enrollment(uuid, uuid)
  owner to postgres;
revoke all on function app.revoke_owner_routine_telebirr_device_enrollment(uuid, uuid)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;
grant execute on function app.revoke_owner_routine_telebirr_device_enrollment(uuid, uuid)
  to fetanagent_owner_control;

comment on function app.revoke_owner_routine_telebirr_device_enrollment(uuid, uuid) is
  'Owner-runtime-only, idempotent stop for an exact Owner-linked routine phone enrollment. Locks the enrollment against new lookup issuance; grants no pairing, provider, payment, or financial authority.';

commit;
