-- Permit only the first protected CBE Birr receiver configuration while TeleBirr is live.
-- CBE Birr verification must remain disabled. Existing CBE receiver rotation and all
-- TeleBirr receiver rotation retain the original all-financial-switches-off guard.
-- This migration configures no receiver, starts no verification, and moves no money.

begin;

create or replace function app.rotate_owner_receiver_account(
  p_actor_auth_user_id uuid,
  p_request_id uuid,
  p_provider_code text,
  p_account_holder_name text,
  p_account_reference_ciphertext text,
  p_account_reference_fingerprint text,
  p_account_reference_masked text,
  p_protection_profile_version smallint,
  p_encryption_key_version smallint,
  p_fingerprint_key_version smallint,
  p_rotation_reason text
)
returns table (
  provider_code text,
  receiver_revision_id uuid,
  revision integer,
  account_holder_name text,
  account_reference_masked text,
  receiver_status text,
  active_from timestamptz,
  retired_at timestamptz,
  rotation_reason text,
  protected_reference boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  provider_row app.payment_providers%rowtype;
  existing_request app.receiver_accounts%rowtype;
  current_receiver app.receiver_accounts%rowtype;
  new_receiver app.receiver_accounts%rowtype;
  next_version integer;
  rotation_at timestamptz;
  cbe_initial_during_other_live boolean := false;
begin
  perform app.require_owner_receiver_account_controller();
  if p_actor_auth_user_id is null or p_request_id is null
    or p_request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'The receiver rotation request is invalid.';
  end if;
  if p_provider_code is null
    or p_provider_code not in ('cbe_birr', 'telebirr')
    or p_account_holder_name is null
    or p_account_holder_name <> pg_catalog.btrim(p_account_holder_name)
    or pg_catalog.char_length(p_account_holder_name) not between 2 and 160
    or p_account_holder_name ~ '[[:cntrl:]]'
    or p_account_reference_ciphertext is null
    or p_account_reference_ciphertext !~ (
      '^receiver-v1[.]' || p_provider_code || '[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{12,32}$'
    )
    or p_account_reference_fingerprint is null
    or p_account_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or p_account_reference_masked is null
    or p_account_reference_masked !~ '^[*][*][*][0-9]{4}$'
    or p_protection_profile_version is null
    or p_protection_profile_version <> 1
    or p_encryption_key_version is null
    or p_encryption_key_version <> 1
    or p_fingerprint_key_version is null
    or p_fingerprint_key_version <> 1
    or p_rotation_reason is null
    or p_rotation_reason not in (
      'initial_configuration', 'account_rotation', 'provider_incident_recovery', 'owner_correction'
    ) then
    raise exception 'The receiver rotation contract is invalid.';
  end if;

  select admin_user.id
    into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active';
  if actor_admin_id is null then
    raise exception 'Only the active Owner can rotate a receiver account.';
  end if;

  -- Keep the original lock set and lock order. A CBE initial setup may coexist with
  -- live TeleBirr only if its own authoritative verification is disabled.
  perform 1
    from (
      select feature_switch.feature_key
        from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'cbe_birr_authoritative_verification',
         'deposit_execution',
         'payment_verification',
         'private_live_deposit_pilot',
         'telebirr_authoritative_verification'
       )
       order by feature_switch.feature_key
       for update
    ) locked_switches;
  if (select pg_catalog.count(*) from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
         'private_live_deposit_pilot', 'telebirr_authoritative_verification'
       )) <> 5 then
    raise exception 'Receiver rotation requires every payment, provider, pilot, and execution switch to be disabled.';
  end if;
  if exists (
    select 1 from app.feature_switches feature_switch
     where feature_switch.feature_key in (
       'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
       'private_live_deposit_pilot', 'telebirr_authoritative_verification'
     ) and feature_switch.mode <> 'disabled'
  ) then
    if p_provider_code <> 'cbe_birr'
      or p_rotation_reason <> 'initial_configuration'
      or not exists (
        select 1 from app.feature_switches feature_switch
         where feature_switch.feature_key = 'cbe_birr_authoritative_verification'
           and feature_switch.mode = 'disabled'
      ) then
      raise exception 'Receiver rotation requires every payment, provider, pilot, and execution switch to be disabled.';
    end if;
    cbe_initial_during_other_live := true;
  end if;

  perform 1
    from app.admin_users admin_user
   where admin_user.id = actor_admin_id
     and admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;
  if not found then
    raise exception 'Only the active Owner can rotate a receiver account.';
  end if;

  select provider.* into provider_row
    from app.payment_providers provider
   where provider.code = p_provider_code and provider.status = 'active'
   for update;
  if not found then
    raise exception 'The active payment provider does not exist.';
  end if;
  if exists (
    select 1
      from app.private_live_deposit_pilot_revisions pilot
      join app.private_live_deposit_pilot_providers pilot_provider
        on pilot_provider.pilot_revision_id = pilot.id
     where pilot_provider.payment_provider_id = provider_row.id
       and pilot.status in ('draft', 'armed')
  ) then
    raise exception 'Stop or discard the existing private pilot before rotating its receiver.';
  end if;

  select receiver.* into existing_request
    from app.receiver_accounts receiver
   where receiver.rotation_request_id = p_request_id
   for share;
  if found then
    if existing_request.provider_id <> provider_row.id
      or existing_request.account_holder_name <> p_account_holder_name
      or existing_request.account_reference_fingerprint <> p_account_reference_fingerprint
      or existing_request.account_reference_masked <> p_account_reference_masked
      or existing_request.rotation_reason <> p_rotation_reason then
      raise exception 'The receiver rotation request conflicts with its original use.';
    end if;
    return query select p_provider_code, existing_request.id, existing_request.version,
      existing_request.account_holder_name, existing_request.account_reference_masked,
      existing_request.status::text, existing_request.active_from, existing_request.retired_at,
      existing_request.rotation_reason, true;
    return;
  end if;

  -- The live-TeleBirr exception is deliberately first-configuration only. Once a
  -- CBE revision exists, a separate reviewed receiver-grace design is required.
  if cbe_initial_during_other_live and exists (
    select 1 from app.receiver_accounts receiver where receiver.provider_id = provider_row.id
  ) then
    raise exception 'Existing CBE Birr receiver rotation requires every payment switch to be disabled.';
  end if;

  select receiver.* into current_receiver
    from app.receiver_accounts receiver
   where receiver.provider_id = provider_row.id and receiver.status = 'active'
   for update;
  if found and current_receiver.account_reference_fingerprint = p_account_reference_fingerprint
    and current_receiver.account_holder_name = p_account_holder_name then
    raise exception 'The submitted receiver is already the active revision.';
  end if;

  select coalesce(pg_catalog.max(receiver.version), 0) + 1
    into next_version
    from app.receiver_accounts receiver
   where receiver.provider_id = provider_row.id;
  rotation_at := pg_catalog.clock_timestamp();

  update app.receiver_accounts receiver
     set status = 'inactive', retired_at = rotation_at
   where receiver.provider_id = provider_row.id and receiver.status = 'active';

  insert into app.receiver_accounts (
    provider_id, version, account_holder_name, account_reference_ciphertext,
    verification_reference_ciphertext, account_reference_masked, instructions,
    status, active_from, created_by_admin_id, rotation_request_id, rotation_reason,
    account_reference_fingerprint, protection_profile_version, encryption_key_version,
    fingerprint_key_version
  ) values (
    provider_row.id, next_version, p_account_holder_name, p_account_reference_ciphertext,
    p_account_reference_ciphertext, p_account_reference_masked,
    pg_catalog.jsonb_build_object(
      'receiverReferenceProtectionProfileVersion', p_protection_profile_version,
      'receiverReferenceEncryptionKeyVersion', p_encryption_key_version,
      'receiverReferenceFingerprintKeyVersion', p_fingerprint_key_version
    ),
    'active', rotation_at, actor_admin_id, p_request_id, p_rotation_reason,
    p_account_reference_fingerprint, p_protection_profile_version, p_encryption_key_version,
    p_fingerprint_key_version
  ) returning * into new_receiver;

  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, resource_id, metadata
  ) values (
    'admin', actor_admin_id, 'configuration.receiver_account_rotated',
    'receiver_account', new_receiver.id,
    pg_catalog.jsonb_build_object(
      'provider_code', p_provider_code,
      'version', new_receiver.version,
      'rotation_reason', p_rotation_reason,
      'replaced_revision_id', current_receiver.id,
      'protection_profile_version', p_protection_profile_version
    )
  );

  return query select p_provider_code, new_receiver.id, new_receiver.version,
    new_receiver.account_holder_name, new_receiver.account_reference_masked,
    new_receiver.status::text, new_receiver.active_from, new_receiver.retired_at,
    new_receiver.rotation_reason, true;
end;
$$;

alter function app.rotate_owner_receiver_account(
  uuid, uuid, text, text, text, text, text, smallint, smallint, smallint, text
) owner to postgres;

revoke all on function app.rotate_owner_receiver_account(
  uuid, uuid, text, text, text, text, text, smallint, smallint, smallint, text
) from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime,
  fetanagent_worker,
  fetanagent_beta_admission, fetanagent_beta_admission_runtime,
  fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
  fetanagent_owner_control_runtime,
  fetanagent_player_actions, fetanagent_player_actions_runtime,
  fetanagent_cbe_birr_shadow_worker,
  fetanagent_customer_web, fetanagent_customer_web_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
  fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime;

grant execute on function app.rotate_owner_receiver_account(
  uuid, uuid, text, text, text, text, text, smallint, smallint, smallint, text
) to fetanagent_owner_control;

comment on function app.rotate_owner_receiver_account(
  uuid, uuid, text, text, text, text, text, smallint, smallint, smallint, text
) is
  'Authenticated Owner-only immutable receiver rotation. TeleBirr and existing CBE Birr receiver rotations require every financial switch disabled. First CBE Birr receiver setup may coexist with live TeleBirr only while CBE Birr authoritative verification is disabled.';

commit;
