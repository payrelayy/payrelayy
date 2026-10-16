-- A read-only, non-leasing preflight for the provider-aware CBE Birr dry-run proof.
-- This does not authorize receipt lookup or treat v1 receiver metadata as key provenance.
-- The legacy shadow worker retains only its separate, blocked legacy preflight.

begin;

create role fetanagent_cbe_birr_proof_preflight
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

create function app.preflight_cbe_birr_proof_request(p_proof_request_id uuid)
returns table (
  proof_request_id uuid,
  preflight_version text,
  eligibility text,
  blocker_code text,
  lease_allowed boolean,
  protected_material_allowed boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_proof_request_id is null then
    raise exception 'The CBE Birr proof preflight request is invalid.';
  end if;

  if not exists (
    select 1
      from app.feature_switches feature_switch
     where feature_switch.feature_key = 'cbe_birr_authoritative_verification'
       and feature_switch.mode = 'disabled'
  ) then
    raise exception 'CBE Birr proof preflight requires verification to remain disabled.';
  end if;

  return query
  select proof.id,
         'cbe-birr-proof-preflight-v1'::text,
         'blocked'::text,
         case when exists (
           select 1
             from app.receiver_accounts receiver
            where receiver.provider_id = proof.payment_provider_id
              and receiver.status = 'active'
              and receiver.protection_profile_version = 1
              and receiver.encryption_key_version = 1
              and receiver.fingerprint_key_version = 1
         ) then 'receiver_v1_metadata_only'::text
           else 'receiver_revision_unavailable'::text
         end,
         false,
         false
    from app.deposit_proof_requests proof
   where proof.id = p_proof_request_id
     and proof.provider_code = 'cbe_birr'
     and proof.status = 'proof_received'
     and proof.reference_profile_version = 2
     and proof.reference_encryption_key_version = 2;
end;
$$;

alter function app.preflight_cbe_birr_proof_request(uuid) owner to postgres;

revoke all on function app.preflight_cbe_birr_proof_request(uuid)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_cbe_birr_proof_preflight;

grant usage on schema app to fetanagent_cbe_birr_proof_preflight;
grant execute on function app.preflight_cbe_birr_proof_request(uuid)
to fetanagent_cbe_birr_proof_preflight;

comment on role fetanagent_cbe_birr_proof_preflight is
  'NOLOGIN metadata-only CBE Birr proof preflight. No table, lease, decrypt, provider, or financial grant.';

comment on function app.preflight_cbe_birr_proof_request(uuid) is
  'Read-only, always-blocked v2 CBE Birr proof preflight. Reads only proof and receiver version/status metadata, never protected material; grants no lease or lookup authority.';

commit;
