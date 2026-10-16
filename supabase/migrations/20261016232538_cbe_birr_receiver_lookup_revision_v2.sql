-- A fresh Owner-confirmed CBE Birr receiver revision may carry independently protected
-- lookup material. Existing v1 revisions are never inferred, updated, or backfilled.
-- The rotation function remains ungranted until its Owner runtime and keys are reviewed.
-- It has no application caller, provider client, proof lease, or money path.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter table app.receiver_accounts
  add constraint receiver_accounts_lookup_revision_identity_key
  unique (id, version, rotation_request_id);

alter table app.receiver_accounts
  drop constraint receiver_accounts_rotation_reason_shape;
alter table app.receiver_accounts
  add constraint receiver_accounts_rotation_reason_shape check (
    rotation_reason is null or rotation_reason in (
      'initial_configuration', 'account_rotation', 'provider_incident_recovery',
      'owner_correction', 'protection_upgrade'
    )
  );

create table app.cbe_birr_receiver_lookup_revisions (
  receiver_revision_id uuid primary key,
  receiver_version integer not null check (receiver_version > 0),
  rotation_request_id uuid not null unique,
  lookup_ciphertext text not null check (
    lookup_ciphertext ~ '^cbe-receiver-v2[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{16}$'
  ),
  lookup_fingerprint text not null check (lookup_fingerprint ~ '^[0-9a-f]{64}$'),
  lookup_masked text not null check (lookup_masked ~ '^[*][*][*][0-9]{4}$'),
  protection_profile_version smallint not null check (protection_profile_version = 2),
  encryption_key_version smallint not null check (encryption_key_version = 2),
  fingerprint_key_version smallint not null check (fingerprint_key_version = 2),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint cbe_birr_receiver_lookup_revision_fkey
    foreign key (receiver_revision_id, receiver_version, rotation_request_id)
    references app.receiver_accounts (id, version, rotation_request_id) on delete restrict
);

alter table app.cbe_birr_receiver_lookup_revisions enable row level security;
alter table app.cbe_birr_receiver_lookup_revisions force row level security;
revoke all on app.cbe_birr_receiver_lookup_revisions
  from public, anon, authenticated, service_role,
       fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_cbe_birr_shadow_worker, fetanagent_cbe_birr_proof_preflight,
       fetanagent_customer_web, fetanagent_customer_web_runtime,
       fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
       fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

create function app.reject_cbe_birr_receiver_lookup_revision_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'CBE Birr receiver lookup revisions are immutable.';
end;
$$;

create trigger cbe_birr_receiver_lookup_revisions_immutable
before update or delete on app.cbe_birr_receiver_lookup_revisions
for each row execute function app.reject_cbe_birr_receiver_lookup_revision_mutation();

create trigger cbe_birr_receiver_lookup_revisions_no_truncate
before truncate on app.cbe_birr_receiver_lookup_revisions
for each statement execute function app.reject_cbe_birr_receiver_lookup_revision_mutation();

create function app.rotate_owner_cbe_birr_receiver_lookup_v2(
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

  -- Preserve the existing receiver-rotation lock order and require an inert money window.
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
  if (select pg_catalog.count(*) from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'cbe_birr_authoritative_verification', 'deposit_execution',
         'payment_verification', 'private_live_deposit_pilot',
         'telebirr_authoritative_verification'
       ) and feature_switch.mode = 'disabled') <> 5 then
    raise exception 'CBE Birr receiver lookup rotation requires every payment switch disabled.';
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

  select receiver.* into current_receiver
    from app.receiver_accounts receiver
   where receiver.provider_id = provider_row.id and receiver.status = 'active'
   for update;

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

alter function app.reject_cbe_birr_receiver_lookup_revision_mutation() owner to postgres;
alter function app.rotate_owner_cbe_birr_receiver_lookup_v2(
  uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text
) owner to postgres;

revoke all on function app.reject_cbe_birr_receiver_lookup_revision_mutation(),
  app.rotate_owner_cbe_birr_receiver_lookup_v2(
    uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text
  ) from public, anon, authenticated, service_role,
         fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
         fetanagent_owner_control, fetanagent_owner_control_runtime,
         fetanagent_cbe_birr_shadow_worker, fetanagent_cbe_birr_proof_preflight,
         fetanagent_customer_web, fetanagent_customer_web_runtime,
         fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
         fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

comment on table app.cbe_birr_receiver_lookup_revisions is
  'Private immutable v2 lookup protection for newly Owner-confirmed CBE Birr receiver revisions; no direct application table grants.';
comment on function app.rotate_owner_cbe_birr_receiver_lookup_v2(
  uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text
) is
  'Ungranted-by-default Owner rotation candidate for fresh revision-bound v2 lookup protection. All financial switches must remain disabled. No lookup or credit authority.';

commit;
