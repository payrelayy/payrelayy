-- Permit the trusted Owner service to verify the same signed proof again after an
-- acknowledged enrollment response is lost. Only a consumed challenge with a
-- matching enrollment is readable; the atomic enrollment RPC still checks exact
-- evidence digest, device identity, revocation, receiver and seven no-money gates.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create or replace function app.get_owner_routine_telebirr_device_pairing_challenge(
  p_actor_auth_user_id uuid, p_pairing_id uuid
)
returns table (
  pairing_id uuid, pairing_nonce_digest text,
  receiver_revision_id uuid, receiver_version integer,
  receiver_profile_digest text, expected_receiver_name_digest text,
  issued_at timestamptz, expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_actor_id uuid;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member') is not true
    or p_actor_auth_user_id is null or p_pairing_id is null then
    raise exception using errcode = '42501',
      message = 'The routine pairing proof request is invalid.';
  end if;
  v_actor_id := app.require_routine_telebirr_owner(p_actor_auth_user_id);
  return query
    select challenge.pairing_id, challenge.pairing_nonce_digest,
      challenge.receiver_account_id, challenge.receiver_account_version,
      challenge.receiver_profile_digest, challenge.expected_receiver_name_digest,
      challenge.issued_at, challenge.expires_at
    from app.routine_telebirr_device_pairing_challenges challenge
    where challenge.pairing_id = p_pairing_id
      and challenge.created_by_admin_id = v_actor_id
      and challenge.issued_at <= pg_catalog.clock_timestamp()
      and challenge.expires_at > pg_catalog.clock_timestamp()
      and (challenge.consumed_at is null or exists (
        select 1 from app.routine_telebirr_device_enrollments enrollment
        where enrollment.pairing_evidence_digest = challenge.pairing_evidence_digest
      ));
end;
$$;

revoke all on function app.get_owner_routine_telebirr_device_pairing_challenge(uuid, uuid)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;
grant execute on function app.get_owner_routine_telebirr_device_pairing_challenge(uuid, uuid)
  to fetanagent_owner_control;

comment on function app.get_owner_routine_telebirr_device_pairing_challenge(uuid, uuid) is
  'Owner-runtime-only read for fresh routine proof verification and exact post-enrollment retry. A consumed challenge is returned only if the matching enrollment exists; no pilot, provider, or money authority.';

commit;
