-- The paired phone continues its no-money poll after live intake is enabled.
-- The no-money SQL boundary must remain strict, but an exact live financial
-- switch set is not a broker outage: return no assignment before attempting
-- the disabled-only replay claim. Any partial or unexpected switch state still
-- fails closed. This migration does not enable deposits or change a switch.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function app.issue_routine_telebirr_no_money_poll_assignment(
  p_enrollment_id uuid, p_request_id uuid, p_replay_identity text,
  p_request_expires_at timestamptz, p_signer_id uuid
)
returns table (
  challenge_id uuid, challenge_digest text, issued_at timestamptz,
  expires_at timestamptz, candidate_id uuid, candidate_submitted_at timestamptz,
  candidate_reference_ciphertext text, candidate_reference_fingerprint text,
  reference_encryption_key_version smallint, reference_profile_version smallint,
  receiver_revision_id uuid, receiver_version integer,
  receiver_reference_fingerprint text, receiver_profile_digest text,
  receiver_name text, expected_receiver_name_digest text,
  device_enrollment_id uuid, device_id text, device_key_id text,
  device_public_key_spki_sha256 text, device_valid_from timestamptz,
  device_valid_until timestamptz, assignment_signer_id uuid,
  assignment_signer_key_id text, assignment_signer_public_key_spki_sha256 text,
  signer_valid_from timestamptz, signer_valid_until timestamptz,
  source_profile text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_enrollment app.routine_telebirr_device_enrollments%rowtype;
  v_candidate_id uuid;
  v_claimed boolean;
  v_returned integer;
  v_now timestamptz;
  v_switch_count integer;
  v_disabled_count integer;
  v_live_count integer;
  v_other_disabled_count integer;
begin
  if not app.routine_telebirr_no_money_session_allowed()
    or p_enrollment_id is null or p_request_id is null
    or p_request_id::text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_replay_identity is null or p_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    or p_request_expires_at is null or p_signer_id is null then
    raise exception using errcode = '42501',
      message = 'The routine no-money assignment is unavailable.';
  end if;

  -- Match the existing no-money claim's authority-then-switch lock order.
  -- In live mode this is a read-only, zero-row response: no replay claim,
  -- challenge, or no-money assignment may be created.
  perform 1 from app.private_trusted_telebirr_activation_control control
    where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The routine no-money boundary is unavailable.'; end if;
  perform feature_switch.feature_key from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
    order by feature_switch.feature_key for update;
  get diagnostics v_switch_count = row_count;
  select
    pg_catalog.count(*) filter (where feature_switch.mode = 'disabled'
      and feature_switch.settings = '{}'::jsonb),
    pg_catalog.count(*) filter (where feature_switch.feature_key in
      ('payment_verification', 'deposit_execution')
      and feature_switch.mode = 'live'
      and feature_switch.settings = '{}'::jsonb),
    pg_catalog.count(*) filter (where feature_switch.feature_key not in
      ('payment_verification', 'deposit_execution')
      and feature_switch.mode = 'disabled'
      and feature_switch.settings = '{}'::jsonb)
    into v_disabled_count, v_live_count, v_other_disabled_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation');
  if v_switch_count <> 7 then
    raise exception 'The routine no-money boundary is unavailable.';
  end if;
  if v_live_count = 2 and v_other_disabled_count = 5 then
    return;
  end if;
  if v_disabled_count <> 7 then
    raise exception 'The routine no-money boundary is unavailable.';
  end if;

  select app.claim_routine_telebirr_no_money_poll(
    p_enrollment_id, p_request_id, p_replay_identity, p_request_expires_at
  ) into v_claimed;
  if v_claimed is not true then
    raise exception using errcode = '42501',
      message = 'The routine no-money poll was already used.';
  end if;
  select enrollment.* into v_enrollment
    from app.routine_telebirr_device_enrollments enrollment
   where enrollment.id = p_enrollment_id for share;
  if v_enrollment.id is null then
    raise exception 'The routine no-money device is unavailable.';
  end if;
  v_now := pg_catalog.clock_timestamp();
  select candidate.id into v_candidate_id
    from app.routine_telebirr_untrusted_proof_requests candidate
   where candidate.receiver_account_id = v_enrollment.receiver_account_id
     and candidate.receiver_account_version = v_enrollment.receiver_account_version
     and candidate.provider_code = 'telebirr'
     and candidate.intake_mode = 'no_money'
     and candidate.submitted_at <= v_now
     and candidate.submitted_at + interval '7 days' > v_now + interval '5 minutes'
     and not exists (
       select 1 from app.routine_telebirr_lookup_challenges challenge
        where challenge.candidate_id = candidate.id
          and challenge.expires_at > v_now
     )
     and not exists (
       select 1 from app.routine_telebirr_lookup_challenges challenge
         join app.routine_telebirr_observation_receipts receipt
           on receipt.challenge_id = challenge.challenge_id
        where challenge.candidate_id = candidate.id
     )
     and (select pg_catalog.count(*)
       from app.routine_telebirr_lookup_challenges challenge
       where challenge.candidate_id = candidate.id) < 5
   order by candidate.submitted_at, candidate.id
   limit 1 for update of candidate skip locked;
  if v_candidate_id is null then return; end if;
  return query select material.*
    from app.issue_routine_telebirr_lookup_assignment_material(
      v_candidate_id, p_enrollment_id, p_signer_id) material;
  get diagnostics v_returned = row_count;
  if v_returned <> 1 then
    raise exception 'The routine no-money assignment is unavailable.';
  end if;
end;
$$;

alter function app.issue_routine_telebirr_no_money_poll_assignment(
  uuid, uuid, text, timestamptz, uuid) owner to postgres;
revoke all on function app.issue_routine_telebirr_no_money_poll_assignment(
  uuid, uuid, text, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.issue_routine_telebirr_no_money_poll_assignment(
  uuid, uuid, text, timestamptz, uuid)
  to fetanagent_routine_telebirr_no_money;
comment on function app.issue_routine_telebirr_no_money_poll_assignment(
  uuid, uuid, text, timestamptz, uuid) is
  'No-money assignment only with all seven switches disabled; returns no rows when exactly the two shared deposit switches are live, without creating a replay claim or challenge.';
commit;
