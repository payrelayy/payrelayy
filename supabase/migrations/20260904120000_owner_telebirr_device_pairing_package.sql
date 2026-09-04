-- Authenticated Owner issuance for the public, database-free TeleBirr Android bridge.
--
-- The browser supplies only an idempotency key. PostgreSQL resolves the already armed dormant
-- pilot, its exact receiver profile, and the configured assignment signer, then creates a
-- ten-minute one-use pairing package. This migration does not create or arm a pilot, change a
-- feature switch, enroll a device, poll an assignment, stage evidence, or move money.

begin;

create function app.issue_current_private_telebirr_device_pairing(
  p_actor_auth_user_id uuid,
  p_issue_request_key uuid,
  p_assignment_signer_key_id text,
  p_minimum_app_version text
)
returns table (
  pairing_id uuid,
  pairing_nonce_digest text,
  expires_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  now_at timestamptz;
  switch_count integer;
  profile_count integer;
  resolved_profile_id uuid;
  generated_pairing_id uuid;
  generated_pairing_nonce_digest text;
  generated_expires_at timestamptz;
  existing_challenge app.private_live_telebirr_device_pairing_challenges%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  signer app.private_live_telebirr_assignment_signers%rowtype;
  pilot_switch app.feature_switches%rowtype;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if p_actor_auth_user_id is null
    or p_issue_request_key is null
    or p_issue_request_key::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_assignment_signer_key_id is null
    or p_assignment_signer_key_id <> pg_catalog.btrim(p_assignment_signer_key_id)
    or p_assignment_signer_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_minimum_app_version is null
    or p_minimum_app_version <> pg_catalog.btrim(p_minimum_app_version)
    or p_minimum_app_version
      !~ '^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}([._-][A-Za-z0-9][A-Za-z0-9._-]{0,47})?$' then
    raise exception 'The Owner TeleBirr device pairing request is invalid.';
  end if;

  -- Serialize one request key before looking for its durable result. Hash collisions merely
  -- serialize unrelated requests; they cannot merge or replace the unique database rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:owner:telebirr-device-pairing:v1:' || p_issue_request_key::text,
      0
    )
  );

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
    raise exception 'Only the active Owner can issue a TeleBirr device pairing package.';
  end if;

  -- Exact retries recover even an expired package. The caller can then discard the spent request
  -- key and deliberately issue a new one; a timeout can never create two live challenges.
  select challenge.*
    into existing_challenge
    from app.private_live_telebirr_device_pairing_challenges challenge
   where challenge.issue_request_key = p_issue_request_key
   for update;

  if existing_challenge.pairing_id is not null then
    if existing_challenge.created_by_admin_id is distinct from actor_admin_id
      or existing_challenge.minimum_app_version is distinct from p_minimum_app_version
      or not exists (
        select 1
          from app.private_live_telebirr_assignment_signers existing_signer
         where existing_signer.id = existing_challenge.assignment_signer_id
           and existing_signer.signer_key_id = p_assignment_signer_key_id
      ) then
      raise exception 'The Owner TeleBirr device pairing replay conflicts.';
    end if;

    return query
    select existing_challenge.pairing_id,
           existing_challenge.pairing_nonce_digest,
           existing_challenge.expires_at,
           true;
    return;
  end if;

  -- Use the same canonical mutex order as pilot arming, verification, settlement, and final
  -- authorization. Pairing is allowed only while the pilot is a no-money dry-run manifest and
  -- every provider, verification, and execution switch remains disabled.
  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  if switch_count <> 5 or exists (
    select 1
      from app.feature_switches feature_switch
     where feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'telebirr_authoritative_verification'
     )
       and (
         feature_switch.mode <> 'disabled'
         or feature_switch.settings <> '{}'::jsonb
       )
  ) then
    raise exception 'TeleBirr device pairing requires every financial switch to remain disabled.';
  end if;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.created_by_admin_id = actor_admin_id
     and pilot_revision.status = 'armed'
   order by pilot_revision.created_at desc, pilot_revision.id desc
   limit 1
   for share;

  select feature_switch.*
    into pilot_switch
    from app.feature_switches feature_switch
   where feature_switch.feature_key = 'private_live_deposit_pilot';

  if pilot.id is null
    or pilot.configuration_digest is null
    or now_at < pilot.active_from
    or now_at >= pilot.expires_at
    or pilot_switch.feature_key is null
    or pilot_switch.mode <> 'dry_run'
    or pilot_switch.settings is distinct from pg_catalog.jsonb_build_object(
      'contract_version', 1,
      'pilot_revision_id', pilot.id,
      'configuration_digest', pilot.configuration_digest
    )
    or (
      select pg_catalog.count(*)
        from app.private_live_deposit_pilot_providers pilot_provider
       where pilot_provider.pilot_revision_id = pilot.id
         and pilot_provider.provider_code_snapshot = 'telebirr'
    ) <> 1
    or (
      select pg_catalog.count(*)
        from app.private_live_deposit_pilot_providers pilot_provider
       where pilot_provider.pilot_revision_id = pilot.id
    ) <> 1 then
    raise exception 'The dormant TeleBirr pilot is not ready for device pairing.';
  end if;

  select pg_catalog.count(*)::integer,
         (pg_catalog.array_agg(receiver_profile.id order by receiver_profile.id))[1]
    into profile_count, resolved_profile_id
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.pilot_revision_id = pilot.id
     and receiver_profile.provider_code = 'telebirr'
     and receiver_profile.pilot_configuration_digest = pilot.configuration_digest
     and receiver_profile.valid_from <= now_at
     and receiver_profile.valid_until > now_at;

  if profile_count <> 1 or resolved_profile_id is null then
    raise exception 'The TeleBirr receiver profile is not ready for device pairing.';
  end if;

  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = resolved_profile_id
   for share;

  select assignment_signer.*
    into signer
    from app.private_live_telebirr_assignment_signers assignment_signer
   where assignment_signer.signer_key_id = p_assignment_signer_key_id
   for share;

  if signer.id is null
    or signer.signature_algorithm <> 'ecdsa-p256-sha256'
    or signer.signature_encoding <> 'ieee-p1363-base64url'
    or now_at < signer.valid_from
    or now_at >= signer.valid_until
    or exists (
      select 1
        from app.private_live_telebirr_assignment_signer_revocations revocation
       where revocation.assignment_signer_id = signer.id
         and revocation.revoked_at <= now_at
    ) then
    raise exception 'The TeleBirr assignment signer is not ready for device pairing.';
  end if;

  generated_expires_at := pg_catalog.date_trunc(
    'milliseconds',
    least(
      now_at + interval '10 minutes',
      pilot.expires_at,
      profile.valid_until,
      signer.valid_until
    )
  );
  if generated_expires_at <= now_at + interval '30 seconds' then
    raise exception 'The TeleBirr device pairing window is too short.';
  end if;

  generated_pairing_id := pg_catalog.gen_random_uuid();
  generated_pairing_nonce_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:owner:telebirr-device-pairing-nonce:v1' || E'\n'
    || p_issue_request_key::text || E'\n'
    || pg_catalog.gen_random_uuid()::text || E'\n'
    || pg_catalog.gen_random_uuid()::text
  );

  return query
  select issued.pairing_id,
         issued.pairing_nonce_digest,
         issued.expires_at,
         issued.replayed
    from app.issue_private_telebirr_device_pairing(
      p_actor_auth_user_id,
      p_issue_request_key,
      generated_pairing_id,
      pilot.id,
      profile.id,
      signer.id,
      generated_pairing_nonce_digest,
      p_minimum_app_version,
      generated_expires_at
    ) issued;
end;
$$;

alter function app.issue_current_private_telebirr_device_pairing(
  uuid, uuid, text, text
) owner to postgres;

revoke all on function app.issue_current_private_telebirr_device_pairing(
  uuid, uuid, text, text
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
     fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state,
     fetanagent_telebirr_device_state_runtime;

-- The browser-facing Owner runtime no longer receives the internal routine that accepts pilot,
-- profile, signer, challenge, digest, or expiry material from its caller.
revoke execute on function app.issue_private_telebirr_device_pairing(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, timestamptz
)
from fetanagent_owner_control, fetanagent_owner_control_runtime;

grant execute on function app.issue_current_private_telebirr_device_pairing(
  uuid, uuid, text, text
) to fetanagent_owner_control;

comment on function app.issue_current_private_telebirr_device_pairing(
  uuid, uuid, text, text
) is
  'Authenticated Owner one-use Android pairing-package issuer. PostgreSQL resolves the exact armed dry-run TeleBirr authority and returns only a bounded bearer package digest; it cannot enable financial authority or move money.';

commit;
