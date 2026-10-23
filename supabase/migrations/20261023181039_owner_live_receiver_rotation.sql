-- A receiver change serializes with new deposits and final credit steps through
-- the provider control row. The other provider's live switches remain untouched.
-- Existing old-receiver matches stay immutable and cannot open a new credit.
-- TeleBirr's signed enrollment identifies its wallet. CBE SMS does not carry
-- a trusted destination number, so the Owner must confirm the paired verifier
-- receives only the replacement CBE account before saving that receiver.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
create function app.require_owner_receiver_live_rotation(p_provider_code text)
returns void language plpgsql security definer set search_path = pg_catalog
as $$
declare v_provider_id uuid;
begin
  if session_user not in ('postgres', 'fetanagent_owner_control_runtime')
    or p_provider_code not in ('telebirr', 'cbe_birr') then
    raise exception using errcode = '42501',
      message = 'The receiver change is unavailable.';
  end if;
  perform 1 from app.owner_provider_deposit_controls control
    where control.provider_code = p_provider_code for update;
  if not found then raise exception 'The provider control is unavailable.'; end if;
  select provider.id into v_provider_id from app.payment_providers provider
    where provider.code = p_provider_code and provider.status = 'active';
  if v_provider_id is null then raise exception 'The provider is unavailable.'; end if;
  if exists (
      select 1 from app.deposit_jobs job
      join app.deposit_intents intent on intent.id = job.deposit_intent_id
      where intent.payment_provider_id = v_provider_id
        and job.job_kind = 'execute_deposit'
        and job.status in ('queued','leased','retry_wait')
    ) or exists (
      select 1 from app.deposit_execution_attempts attempt
      join app.deposit_intents intent on intent.id = attempt.deposit_intent_id
      where intent.payment_provider_id = v_provider_id
        and attempt.status in ('prepared','final_action_fenced',
          'reconciliation_required','review_required')
    ) then
    raise exception 'Resolve this provider''s in-flight credit before changing its receiver.';
  end if;
end;
$$;
alter function app.require_owner_receiver_live_rotation(text) owner to postgres;
revoke all on function app.require_owner_receiver_live_rotation(text)
  from public, anon, authenticated, service_role, fetanagent_owner_control_runtime;

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
  live_telebirr_rotation boolean := false;
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
       'cbe_birr_authoritative_verification', 'deposit_execution',
       'payment_verification', 'private_live_deposit_pilot',
       'telebirr_authoritative_verification'
     ) and feature_switch.mode <> 'disabled'
  ) then
    if p_provider_code = 'telebirr' and
      (select pg_catalog.count(*) from app.feature_switches feature_switch
       where (feature_switch.feature_key in ('payment_verification',
                'deposit_execution') and feature_switch.mode = 'live')
          or (feature_switch.feature_key in ('private_live_deposit_pilot',
                'telebirr_authoritative_verification')
              and feature_switch.mode = 'disabled')) = 4 then
      live_telebirr_rotation := true;
    elsif p_provider_code = 'cbe_birr'
      and p_rotation_reason = 'initial_configuration'
      and exists (select 1 from app.feature_switches feature_switch
        where feature_switch.feature_key = 'cbe_birr_authoritative_verification'
          and feature_switch.mode = 'disabled') then
      cbe_initial_during_other_live := true;
    else
      raise exception 'Receiver rotation requires every payment, provider, pilot, and execution switch to be disabled.';
    end if;
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

  if live_telebirr_rotation then
    perform app.require_owner_receiver_live_rotation('telebirr');
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

  if live_telebirr_rotation then
    update app.owner_provider_deposit_controls control
       set receiver_rotation_pending = true
     where control.provider_code = 'telebirr';
  end if;

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

create or replace function app.rotate_owner_cbe_birr_receiver_lookup_v2(
  p_actor_auth_user_id uuid,
  p_request_id uuid,
  p_receiver_revision_id uuid,
  p_receiver_version integer,
  p_account_holder_name text,
  p_account_reference_ciphertext text,
  p_account_reference_fingerprint text,
  p_account_reference_masked text,
  p_lookup_ciphertext text,
  p_lookup_fingerprint text,
  p_lookup_masked text,
  p_rotation_reason text
)
returns table (
  receiver_revision_id uuid,
  revision integer,
  receiver_status text,
  active_from timestamptz,
  lookup_protected boolean
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
  payment_switch_count integer;
  exact_live_telebirr_upgrade boolean := false;
  live_cbe_rotation boolean := false;
begin
  perform app.require_owner_receiver_account_controller();
  if p_actor_auth_user_id is null
    or p_request_id is null
    or p_request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_receiver_revision_id is null
    or p_receiver_revision_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_receiver_version is null or p_receiver_version < 1
    or p_account_holder_name is null
    or p_account_holder_name <> pg_catalog.btrim(p_account_holder_name)
    or pg_catalog.char_length(p_account_holder_name) not between 2 and 160
    or p_account_holder_name ~ '[[:cntrl:]]'
    or p_account_reference_ciphertext is null
    or p_account_reference_ciphertext
      !~ '^receiver-v1[.]cbe_birr[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{16}$'
    or p_account_reference_fingerprint is null
    or p_account_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or p_account_reference_masked is null
    or p_account_reference_masked !~ '^[*][*][*][0-9]{4}$'
    or p_lookup_ciphertext is null
    or p_lookup_ciphertext
      !~ '^cbe-receiver-v2[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{16}$'
    or p_lookup_fingerprint is null
    or p_lookup_fingerprint !~ '^[0-9a-f]{64}$'
    or p_lookup_masked is distinct from p_account_reference_masked
    or p_rotation_reason is null
    or p_rotation_reason not in (
      'initial_configuration', 'account_rotation', 'provider_incident_recovery',
      'owner_correction', 'protection_upgrade'
    ) then
    raise exception 'The CBE Birr receiver lookup rotation contract is invalid.';
  end if;

  -- Preserve the existing switch lock set and order. The only live exception is
  -- a CBE-only protection upgrade while the exact TeleBirr deposit pair is live.
  perform 1
    from (
      select feature_switch.feature_key
        from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'cbe_birr_authoritative_verification', 'deposit_execution',
         'payment_verification', 'private_live_deposit_pilot',
         'telebirr_authoritative_verification'
       )
       order by feature_switch.feature_key
       for update
    ) locked_switches;
  select pg_catalog.count(*)::integer into payment_switch_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification', 'deposit_execution',
     'payment_verification', 'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   );
  if payment_switch_count <> 5 then
    raise exception 'CBE Birr receiver lookup rotation requires every payment switch disabled, except the exact live TeleBirr protection-upgrade window.';
  end if;
  if (select pg_catalog.count(*) from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'cbe_birr_authoritative_verification', 'deposit_execution',
         'payment_verification', 'private_live_deposit_pilot',
         'telebirr_authoritative_verification'
       ) and feature_switch.mode = 'disabled') <> 5 then
    if p_rotation_reason = 'protection_upgrade'
      and (select pg_catalog.count(*) from app.feature_switches feature_switch
           where (feature_switch.feature_key in ('payment_verification',
                    'deposit_execution') and feature_switch.mode = 'live')
              or (feature_switch.feature_key in (
                    'cbe_birr_authoritative_verification',
                    'private_live_deposit_pilot',
                    'telebirr_authoritative_verification')
                  and feature_switch.mode = 'disabled')) = 5 then
      exact_live_telebirr_upgrade := true;
    elsif p_rotation_reason in (
        'account_rotation', 'provider_incident_recovery', 'owner_correction')
      and (select pg_catalog.count(*) from app.feature_switches feature_switch
           where (feature_switch.feature_key in ('payment_verification',
                    'deposit_execution') and feature_switch.mode = 'live')
              or (feature_switch.feature_key in ('private_live_deposit_pilot',
                    'telebirr_authoritative_verification')
                  and feature_switch.mode = 'disabled')) = 4 then
      live_cbe_rotation := true;
    else
      raise exception 'CBE Birr receiver lookup rotation requires every payment switch disabled, except the exact live TeleBirr protection-upgrade window.';
    end if;
  end if;

  select admin_user.id into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;
  if actor_admin_id is null then
    raise exception 'Only the active Owner can rotate a CBE Birr receiver.';
  end if;

  select provider.* into provider_row
    from app.payment_providers provider
   where provider.code = 'cbe_birr' and provider.status = 'active'
   for update;
  if not found then
    raise exception 'The active CBE Birr provider does not exist.';
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
    if existing_request.id is distinct from p_receiver_revision_id
      or existing_request.version is distinct from p_receiver_version
      or existing_request.provider_id is distinct from provider_row.id
      or existing_request.account_holder_name is distinct from p_account_holder_name
      or existing_request.account_reference_fingerprint is distinct from p_account_reference_fingerprint
      or existing_request.account_reference_masked is distinct from p_account_reference_masked
      or existing_request.rotation_reason is distinct from p_rotation_reason
      or not exists (
        select 1 from app.cbe_birr_receiver_lookup_revisions lookup
         where lookup.receiver_revision_id = existing_request.id
           and lookup.receiver_version = existing_request.version
           and lookup.rotation_request_id = p_request_id
           and lookup.lookup_fingerprint = p_lookup_fingerprint
           and lookup.lookup_masked = p_lookup_masked
      ) then
      raise exception 'The CBE Birr receiver rotation request conflicts with its original use.';
    end if;
    return query select existing_request.id, existing_request.version,
      existing_request.status::text, existing_request.active_from, true;
    return;
  end if;

  if live_cbe_rotation then
    perform app.require_owner_receiver_live_rotation('cbe_birr');
  end if;

  -- This exception is only for the first v1-to-v2 preparation, before CBE
  -- has any payment, proof, or candidate lineage. The provider FOR UPDATE
  -- lock above serializes these FK-backed CBE inserts until commit.
  if exact_live_telebirr_upgrade and (
    exists (select 1 from app.deposit_intents intent
             where intent.payment_provider_id = provider_row.id)
    or exists (select 1 from app.deposit_proof_requests proof
                where proof.payment_provider_id = provider_row.id)
    or exists (select 1 from app.cbe_birr_payment_instructions instruction
                where instruction.payment_provider_id = provider_row.id)
    or exists (select 1 from app.routine_cbe_birr_candidates)
    or exists (select 1 from app.cbe_birr_receiver_lookup_revisions)
  ) then
    raise exception 'Live TeleBirr CBE Birr protection upgrade requires no prior CBE deposit or v2 lookup lineage.';
  end if;

  select receiver.* into current_receiver
    from app.receiver_accounts receiver
   where receiver.provider_id = provider_row.id and receiver.status = 'active'
   for update;

  if live_cbe_rotation and (current_receiver.id is null or not exists (
      select 1 from app.cbe_birr_receiver_lookup_revisions lookup
       where lookup.receiver_revision_id = current_receiver.id
         and lookup.receiver_version = current_receiver.version
         and lookup.protection_profile_version = 2
         and lookup.encryption_key_version = 2
         and lookup.fingerprint_key_version = 2)) then
    raise exception 'The current CBE receiver needs v2 protection before replacement.';
  end if;

  if p_rotation_reason = 'protection_upgrade' then
    if current_receiver.id is null
      or current_receiver.account_holder_name is distinct from p_account_holder_name
      or current_receiver.account_reference_fingerprint is distinct from p_account_reference_fingerprint
      or current_receiver.account_reference_masked is distinct from p_account_reference_masked
      or current_receiver.account_reference_ciphertext
        !~ '^receiver-v1[.]cbe_birr[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{16}$'
      or current_receiver.protection_profile_version is distinct from 1
      or current_receiver.encryption_key_version is distinct from 1
      or current_receiver.fingerprint_key_version is distinct from 1
      or exists (
        select 1 from app.cbe_birr_receiver_lookup_revisions lookup
         where lookup.receiver_revision_id = current_receiver.id
      ) then
      raise exception 'Only a fresh protection revision of the same v1 CBE Birr receiver is allowed.';
    end if;
  elsif current_receiver.id is not null
    and current_receiver.account_holder_name = p_account_holder_name
    and current_receiver.account_reference_fingerprint = p_account_reference_fingerprint then
    raise exception 'The submitted CBE Birr receiver is already active.';
  end if;

  select coalesce(pg_catalog.max(receiver.version), 0) + 1 into next_version
    from app.receiver_accounts receiver
   where receiver.provider_id = provider_row.id;
  if next_version is distinct from p_receiver_version then
    raise exception 'The CBE Birr receiver revision version changed; retry from fresh history.';
  end if;
  rotation_at := pg_catalog.clock_timestamp();

  if live_cbe_rotation then
    update app.owner_provider_deposit_controls
       set receiver_rotation_pending = true
     where provider_code = 'cbe_birr';
  end if;

  update app.receiver_accounts receiver
     set status = 'inactive', retired_at = rotation_at
   where receiver.provider_id = provider_row.id and receiver.status = 'active';

  insert into app.receiver_accounts (
    id, provider_id, version, account_holder_name, account_reference_ciphertext,
    verification_reference_ciphertext, account_reference_masked, instructions,
    status, active_from, created_by_admin_id, rotation_request_id, rotation_reason,
    account_reference_fingerprint, protection_profile_version, encryption_key_version,
    fingerprint_key_version
  ) values (
    p_receiver_revision_id, provider_row.id, next_version, p_account_holder_name,
    p_account_reference_ciphertext, p_account_reference_ciphertext,
    p_account_reference_masked,
    pg_catalog.jsonb_build_object(
      'receiverReferenceProtectionProfileVersion', 1,
      'receiverReferenceEncryptionKeyVersion', 1,
      'receiverReferenceFingerprintKeyVersion', 1
    ),
    'active', rotation_at, actor_admin_id, p_request_id, p_rotation_reason,
    p_account_reference_fingerprint, 1, 1, 1
  ) returning * into new_receiver;

  insert into app.cbe_birr_receiver_lookup_revisions (
    receiver_revision_id, receiver_version, rotation_request_id,
    lookup_ciphertext, lookup_fingerprint, lookup_masked,
    protection_profile_version, encryption_key_version, fingerprint_key_version
  ) values (
    new_receiver.id, new_receiver.version, p_request_id,
    p_lookup_ciphertext, p_lookup_fingerprint, p_lookup_masked, 2, 2, 2
  );

  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, resource_id, metadata
  ) values (
    'admin', actor_admin_id, 'configuration.cbe_birr_receiver_lookup_revision_created',
    'receiver_account', new_receiver.id,
    pg_catalog.jsonb_build_object(
      'provider_code', 'cbe_birr', 'version', new_receiver.version,
      'rotation_reason', p_rotation_reason,
      'replaced_revision_id', current_receiver.id,
      'lookup_protection_profile_version', 2
    )
  );

  return query select new_receiver.id, new_receiver.version,
    new_receiver.status::text, new_receiver.active_from, true;
end;
$$;

create or replace function app.record_receiver_sms_payment_event(
  p_provider_code text, p_reference_digest text, p_reference_fingerprint text,
  p_amount_minor bigint,
  p_occurred_at timestamptz, p_received_at timestamptz, p_observed_at timestamptz,
  p_source_message_digest text, p_event_body_digest text,
  p_device_id text, p_device_key_id text, p_device_public_key_spki_sha256 text,
  p_source_subscription_id integer
)
returns text
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_enrollment app.routine_telebirr_device_enrollments%rowtype;
  v_provider app.payment_providers%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_existing app.receiver_sms_payment_events%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user not in ('postgres', 'fetanagent_receiver_sms_ingest_runtime')
    or p_provider_code is null or p_provider_code not in ('telebirr', 'cbe_birr')
    or p_reference_digest is null or p_reference_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_reference_fingerprint is null or p_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or p_amount_minor is null or p_amount_minor not between 1 and 9999999999
    or p_occurred_at is null or p_received_at is null or p_observed_at is null
    or p_source_message_digest is null
    or p_source_message_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_event_body_digest is null or p_event_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_device_id is null or p_device_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_device_key_id is null
    or p_device_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_device_public_key_spki_sha256 is null
    or p_device_public_key_spki_sha256 !~ '^sha256:[0-9a-f]{64}$'
    or p_source_subscription_id is null or p_source_subscription_id < -1
    or p_observed_at > v_now + interval '5 seconds'
    or p_observed_at < v_now - interval '7 days'
    or p_received_at > p_observed_at + interval '5 minutes'
    or p_received_at < p_observed_at - interval '30 days'
    or p_occurred_at > p_received_at + interval '5 minutes'
    or p_occurred_at < p_received_at - interval '30 days' then
    raise exception using errcode = '42501',
      message = 'The receiver SMS event is unavailable.';
  end if;

  -- The bridge verifies the P256 signature. Recheck its enrolled key and
  -- revocation in the database before accepting the signed fields.
  select enrollment.* into v_enrollment
    from app.routine_telebirr_device_enrollments enrollment
    where enrollment.device_id = p_device_id
      and enrollment.device_key_id = p_device_key_id
      and enrollment.device_public_key_spki_sha256 = p_device_public_key_spki_sha256
      and enrollment.valid_from <= p_observed_at
      and enrollment.valid_until > p_observed_at
      and enrollment.valid_until > v_now
      and not exists (
        select 1 from app.routine_telebirr_device_enrollment_revocations revocation
          where revocation.enrollment_id = enrollment.id)
    for share;
  if v_enrollment.id is null then
    raise exception using errcode = '42501',
      message = 'The receiver SMS device is unavailable.';
  end if;

  select provider.* into v_provider from app.payment_providers provider
    where provider.code = p_provider_code and provider.status = 'active' for share;
  if v_provider.id is null then
    raise exception using errcode = '42501',
      message = 'The receiver SMS provider is unavailable.';
  end if;
  if p_provider_code = 'telebirr' then
    -- The signed enrollment identifies the wallet even when its revision was
    -- retired moments before a delayed or old-wallet SMS reached this phone.
    select receiver.* into v_receiver from app.receiver_accounts receiver
      where receiver.id = v_enrollment.receiver_account_id
        and receiver.provider_id = v_provider.id
        and receiver.version = v_enrollment.receiver_account_version
        and receiver.active_from <= p_occurred_at for share;
  else
    select receiver.* into v_receiver from app.receiver_accounts receiver
      where receiver.provider_id = v_provider.id
        and receiver.active_from <= p_occurred_at
        and (receiver.retired_at is null or p_occurred_at < receiver.retired_at)
      order by receiver.version desc limit 1 for share;
  end if;
  if v_receiver.id is null or (p_provider_code = 'telebirr'
    and (v_enrollment.receiver_account_id <> v_receiver.id
      or v_enrollment.receiver_account_version <> v_receiver.version)) then
    raise exception using errcode = '42501',
      message = 'The receiver SMS account is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_provider_code || ':' || p_reference_digest, 20261020));
  select event.* into v_existing from app.receiver_sms_payment_events event
    where (event.provider_code = p_provider_code
       and event.reference_digest = p_reference_digest)
       or event.source_message_digest = p_source_message_digest
    order by event.recorded_at, event.id limit 1 for share;
  if v_existing.id is not null then
    if v_existing.provider_code = p_provider_code
      and v_existing.reference_digest = p_reference_digest
      and v_existing.reference_fingerprint = p_reference_fingerprint
      and v_existing.amount_minor = p_amount_minor
      and v_existing.occurred_at = p_occurred_at
      and v_existing.source_message_digest = p_source_message_digest
      and v_existing.receiver_account_id = v_receiver.id
      and v_existing.device_enrollment_id = v_enrollment.id then
      return 'exact_replay';
    end if;
    insert into app.receiver_sms_payment_conflicts (
      event_body_digest, existing_event_id, source_message_digest
    ) values (p_event_body_digest, v_existing.id, p_source_message_digest)
    on conflict (event_body_digest) do nothing;
    return 'conflict';
  end if;
  insert into app.receiver_sms_payment_events (
    provider_code, payment_provider_id, receiver_account_id,
    receiver_account_version, reference_digest, reference_fingerprint,
    amount_minor, occurred_at, received_at,
    observed_at, source_message_digest, event_body_digest, source_subscription_id,
    device_enrollment_id, device_id, device_key_id, device_public_key_spki_sha256
  ) values (
    p_provider_code, v_provider.id, v_receiver.id, v_receiver.version,
    p_reference_digest, p_reference_fingerprint,
    p_amount_minor, p_occurred_at, p_received_at,
    p_observed_at, p_source_message_digest, p_event_body_digest, p_source_subscription_id,
    v_enrollment.id, p_device_id, p_device_key_id, p_device_public_key_spki_sha256
  );
  return 'recorded';
end;
$$;

create function app.force_rotated_receiver_sms_review()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if exists (
    select 1 from app.receiver_sms_deposit_candidates candidate
    join app.receiver_sms_payment_events event on event.id = new.payment_event_id
    join app.receiver_accounts current_receiver
      on current_receiver.provider_id = candidate.payment_provider_id
      and current_receiver.status = 'active' and current_receiver.retired_at is null
    where candidate.id = new.candidate_id
      and (candidate.submitted_at < current_receiver.active_from
        or event.receiver_account_id <> current_receiver.id)
  ) then
    new.disposition := 'held_review';
  end if;
  return new;
end;
$$;
alter function app.force_rotated_receiver_sms_review() owner to postgres;
revoke all on function app.force_rotated_receiver_sms_review()
  from public, anon, authenticated, service_role;
create trigger receiver_sms_rotated_receiver_review
before insert on app.receiver_sms_payment_matches for each row
execute function app.force_rotated_receiver_sms_review();

comment on function app.rotate_owner_receiver_account(
  uuid,uuid,text,text,text,text,text,smallint,smallint,smallint,text) is
  'Owner TeleBirr receiver rotation may run with shared payments live only after the provider-specific no-in-flight boundary; all other historic guards remain.';
comment on function app.rotate_owner_cbe_birr_receiver_lookup_v2(
  uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text) is
  'Owner CBE v2 receiver replacement may run with shared payments live only after the provider-specific no-in-flight boundary; protection upgrade remains guarded.';
commit;
