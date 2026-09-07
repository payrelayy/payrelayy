-- Keep the authenticated Android assignment channel healthy while the private pilot is armed in
-- its exact no-money dry-run state. A dry-run poll must not enter the live leasing routine: that
-- routine deliberately requires live financial switches and raises when they are disabled. The
-- broker interprets this guarded empty result as `no_assignment`; it cannot create a verification
-- attempt, assignment, settlement, execution job, or any other financial state.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create or replace function app.lease_private_live_telebirr_assignment_broker(
  p_device_enrollment_id uuid,
  p_leased_by text,
  p_lease_request_key uuid,
  p_lease_seconds integer
)
returns table (
  verification_attempt_id uuid,
  lease_token uuid,
  job_id uuid,
  attempt_number integer,
  request_id uuid,
  assignment_id uuid,
  lease_nonce_digest text,
  challenge_id uuid,
  challenge_digest text,
  issued_at timestamptz,
  expires_at timestamptz,
  pilot_revision_id uuid,
  device_enrollment_id uuid,
  device_id text,
  device_key_id text,
  device_public_key_spki_sha256 text,
  receiver_revision_id uuid,
  receiver_profile_id uuid,
  receiver_profile_digest text,
  receiver_configuration_digest text,
  expected_receiver_name_digest text,
  receiver_name_normalizer_version text,
  source_profile text,
  adapter_version text,
  parser_version text,
  facts_normalizer_version text,
  candidate_reference_ciphertext text,
  candidate_reference_fingerprint text,
  reference_encryption_key_version smallint,
  reference_profile_version smallint,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  assessed_at timestamptz := pg_catalog.clock_timestamp();
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  financial_switch_count integer;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
begin
  perform app.require_telebirr_assignment_broker_session();

  -- Preserve the original fail-closed request and enrollment checks even when no financial
  -- authority exists. An unknown enrollment must never be disguised as an idle valid device.
  if p_device_enrollment_id is null
    or p_lease_request_key is null
    or p_lease_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_leased_by is null
    or p_leased_by <> pg_catalog.btrim(p_leased_by)
    or p_leased_by !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    or p_lease_seconds not between 30 and 300 then
    raise exception 'The private live TeleBirr assignment request is invalid.';
  end if;

  select device_enrollment.*
    into enrollment
    from app.private_live_telebirr_device_enrollments device_enrollment
   where device_enrollment.id = p_device_enrollment_id
   for share;

  if enrollment.id is null then
    raise exception 'The private live TeleBirr device enrollment is unavailable.';
  end if;

  -- Live mode retains the pre-existing leasing behavior and all of its transactional guards.
  if app.is_private_live_deposit_pilot_enforced() then
    return query
    select leased.verification_attempt_id,
           leased.lease_token,
           leased.verification_job_id,
           leased.attempt_number,
           leased.request_id,
           leased.assignment_id,
           leased.lease_nonce_digest,
           leased.challenge_id,
           leased.challenge_digest,
           leased.issued_at,
           leased.expires_at,
           leased.pilot_revision_id,
           enrollment.id,
           enrollment.device_id,
           enrollment.key_id,
           enrollment.public_key_spki_sha256,
           leased.receiver_account_id,
           leased.receiver_profile_id,
           leased.receiver_profile_digest,
           leased.receiver_configuration_digest,
           leased.expected_receiver_name_digest,
           leased.receiver_name_normalizer_version,
           leased.source_profile,
           leased.adapter_version,
           leased.parser_version,
           leased.facts_normalizer_version,
           leased.candidate_reference_ciphertext,
           leased.candidate_reference_fingerprint,
           leased.reference_encryption_key_version,
           leased.reference_profile_version,
           leased.replayed
      from app.lease_next_private_live_telebirr_verification(
        p_device_enrollment_id,
        p_leased_by,
        p_lease_request_key,
        p_lease_seconds
      ) leased;
    return;
  end if;

  -- The only non-live state accepted as an idle poll is the exact companion-verified dry-run
  -- state. Every financial/provider switch remains disabled and the pilot binding must be exact.
  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = enrollment.pilot_revision_id
   for share;

  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = enrollment.receiver_profile_id
     and receiver_profile.pilot_revision_id = pilot.id
   for share;

  select pg_catalog.count(*)::integer
    into financial_switch_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'payment_verification',
     'deposit_execution',
     'withdrawal_validation',
     'withdrawal_collection',
     'cbe_birr_authoritative_verification',
     'telebirr_authoritative_verification'
   )
     and feature_switch.mode = 'disabled'
     and feature_switch.settings = '{}'::jsonb;

  if pilot.id is null
    or pilot.status <> 'armed'
    or pilot.configuration_digest is null
    or assessed_at < pilot.active_from
    or assessed_at >= pilot.expires_at
    or enrollment.pilot_revision_id is distinct from pilot.id
    or assessed_at < enrollment.valid_from
    or assessed_at >= enrollment.valid_until
    or profile.id is null
    or profile.pilot_revision_id is distinct from pilot.id
    or profile.pilot_configuration_digest is distinct from pilot.configuration_digest
    or assessed_at < profile.valid_from
    or assessed_at >= profile.valid_until
    or financial_switch_count <> 6
    or not exists (
      select 1
        from app.feature_switches pilot_switch
       where pilot_switch.feature_key = 'private_live_deposit_pilot'
         and pilot_switch.mode = 'dry_run'
         and pilot_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    )
    or exists (
      select 1
        from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= assessed_at
    ) then
    raise exception 'The private live TeleBirr assignment authority is unavailable.';
  end if;

  -- A set-returning function that reaches RETURN without RETURN QUERY yields zero rows. The local
  -- broker maps exactly this result to `no_assignment`, so no durable work is created in dry-run.
  return;
end;
$$;

alter function app.lease_private_live_telebirr_assignment_broker(uuid, text, uuid, integer)
  owner to postgres;

revoke all on function app.lease_private_live_telebirr_assignment_broker(
  uuid, text, uuid, integer
) from public, anon, authenticated, service_role;

grant execute on function app.lease_private_live_telebirr_assignment_broker(
  uuid, text, uuid, integer
) to fetanagent_telebirr_assignment_broker;

comment on function app.lease_private_live_telebirr_assignment_broker(
  uuid, text, uuid, integer
) is
  'Operation-time guarded assignment lease projection. Exact armed dry-run returns no rows without creating work; live mode delegates to the existing transactionally guarded lease path.';

commit;
