-- Inert metadata function for a separately approved receiver-key provisioning review.
-- The result contains no receiver reference, lookup material, or payment authority.
-- Keep it ungranted until the Owner startup catalog allowlist is deployed first.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create function app.inspect_owner_cbe_birr_provisioning_snapshot(
  p_actor_auth_user_id uuid
)
returns table (
  receiver_revision_id uuid,
  receiver_version integer,
  protection_profile_version smallint,
  encryption_key_version smallint,
  fingerprint_key_version smallint
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform app.require_owner_receiver_account_controller();

  if p_actor_auth_user_id is null or not exists (
    select 1 from app.admin_users admin_user
     where admin_user.auth_user_id = p_actor_auth_user_id
       and admin_user.role = 'owner'
       and admin_user.status = 'active'
  ) then
    raise exception 'Only the active Owner can inspect CBE Birr provisioning metadata.';
  end if;

  if not exists (
    select 1 from app.feature_switches feature_switch
     where feature_switch.feature_key = 'cbe_birr_authoritative_verification'
       and feature_switch.mode = 'disabled'
  ) then
    raise exception 'CBE Birr provisioning metadata requires verification disabled.';
  end if;

  return query
  select receiver.id,
         receiver.version,
         lookup.protection_profile_version,
         lookup.encryption_key_version,
         lookup.fingerprint_key_version
    from app.payment_providers provider
    join app.receiver_accounts receiver
      on receiver.provider_id = provider.id
    join app.cbe_birr_receiver_lookup_revisions lookup
      on lookup.receiver_revision_id = receiver.id
     and lookup.receiver_version = receiver.version
     and lookup.rotation_request_id = receiver.rotation_request_id
   where provider.code = 'cbe_birr'
     and provider.status = 'active'
     and receiver.status = 'active'
     and receiver.retired_at is null
     and lookup.protection_profile_version = 2
     and lookup.encryption_key_version = 2
     and lookup.fingerprint_key_version = 2;

  if not found then
    raise exception 'An active protected CBE Birr receiver revision is unavailable.';
  end if;
end;
$$;

alter function app.inspect_owner_cbe_birr_provisioning_snapshot(uuid)
  owner to postgres;
revoke all on function app.inspect_owner_cbe_birr_provisioning_snapshot(uuid)
  from public, anon, authenticated, service_role,
       fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_cbe_birr_shadow_worker, fetanagent_cbe_birr_proof_preflight,
       fetanagent_customer_web, fetanagent_customer_web_runtime,
       fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
       fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;
comment on function app.inspect_owner_cbe_birr_provisioning_snapshot(uuid) is
  'Ungranted metadata snapshot of the currently active, immutable v2 CBE Birr receiver revision while CBE verification is disabled. No key or reference material; grant only after the Owner startup allowlist is updated.';

commit;
