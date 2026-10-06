-- Read-only Owner inventory of current routine phone enrollments. This path does not
-- depend on the receipt signer and remains available while money switches are off or on.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.list_owner_routine_telebirr_active_phone_enrollments(
  p_actor_auth_user_id uuid
)
returns table (
  enrollment_id uuid, device_id text, device_key_id text, valid_until timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_count integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member') is not true
    or p_actor_auth_user_id is null then
    raise exception using errcode = '42501',
      message = 'The routine phone inventory request is invalid.';
  end if;
  v_actor_id := app.require_routine_telebirr_owner(p_actor_auth_user_id);

  return query
  select enrollment.id, enrollment.device_id, enrollment.device_key_id,
         enrollment.valid_until
    from app.routine_telebirr_device_pairing_challenges challenge
    join app.routine_telebirr_device_enrollments enrollment
      on enrollment.pairing_evidence_digest = challenge.pairing_evidence_digest
    where challenge.created_by_admin_id = v_actor_id
      and challenge.consumed_at is not null
      and enrollment.valid_from <= v_now
      and enrollment.valid_until > v_now
      and not exists (
        select 1 from app.routine_telebirr_device_enrollment_revocations revocation
          where revocation.enrollment_id = enrollment.id)
    order by enrollment.created_at desc, enrollment.id
    limit 101;
  get diagnostics v_count = row_count;
  if v_count > 100 then
    raise exception 'The routine phone inventory exceeds the reviewed limit.';
  end if;
end;
$$;

alter function app.list_owner_routine_telebirr_active_phone_enrollments(uuid)
  owner to postgres;
revoke all on function app.list_owner_routine_telebirr_active_phone_enrollments(uuid)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;
grant execute on function app.list_owner_routine_telebirr_active_phone_enrollments(uuid)
  to fetanagent_owner_control;

comment on function app.list_owner_routine_telebirr_active_phone_enrollments(uuid) is
  'Owner-runtime-only, receipt-signer-independent, read-only inventory of exact current unrevoked routine phones. Grants no direct table, provider, or money authority.';

commit;
