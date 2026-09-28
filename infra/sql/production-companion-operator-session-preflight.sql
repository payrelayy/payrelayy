\set ON_ERROR_STOP on
\getenv request_key PRODUCTION_COMPANION_EXECUTION_REQUEST_KEY

begin transaction read only;
set local search_path = pg_catalog;
set local statement_timeout = '10s';

select case when exists (
  select 1
    from app.agent_platform_companion_execution_activation_requests request
    join app.private_trusted_telebirr_activation_control selected
      on selected.control_key = 'trusted_telebirr_financial_authority'
     and selected.current_epoch = request.activation_epoch
    join app.private_trusted_telebirr_activation_epochs authority
      on authority.epoch = request.activation_epoch
    join app.private_live_deposit_pilot_revisions pilot
      on pilot.id = request.pilot_revision_id
    join app.agent_platform_companion_enrollment_certificates certificate
      on certificate.certificate_id = request.certificate_id
    join app.agent_platform_companion_pairing_challenges pairing
      on pairing.pairing_id = certificate.pairing_id
    join app.agent_platform_companion_execution_control companion
      on companion.singleton
   where request.request_key = :'request_key'::uuid
     and request.expires_at > pg_catalog.clock_timestamp() + interval '5 minutes'
     and authority.authority_state = 'active'
     and authority.revoked_at is null
     and authority.expires_at >= request.expires_at
     and authority.pilot_revision_id = pilot.id
     and pilot.status = 'armed'
     and pilot.expires_at >= request.expires_at
     and pilot.configuration_digest = authority.configuration_digest
     and certificate.valid_from <= pg_catalog.clock_timestamp()
     and certificate.valid_until >= request.expires_at
     and pairing.state = 'completed'
     and not exists (
       select 1 from app.agent_platform_companion_device_revocations revocation
        where revocation.certificate_id = certificate.certificate_id
     )
     and companion.control_state = 'disabled'
     and not exists (
       select 1 from app.agent_platform_companion_execution_activation_attestations attestation
        where attestation.request_key = request.request_key
     )
     and not exists (
       select 1 from app.agent_platform_companion_execution_activation_consumptions consumption
        where consumption.request_key = request.request_key
     )
     and (
       select pg_catalog.count(*) from app.feature_switches switch
        where switch.feature_key in (
          'deposit_execution', 'payment_verification', 'private_live_deposit_pilot',
          'telebirr_authoritative_verification'
        ) and switch.mode = 'live'
     ) = 4
     and (
       select pg_catalog.count(*) from app.feature_switches switch
        where switch.feature_key in ('withdrawal_collection', 'withdrawal_validation')
          and switch.mode = 'disabled'
     ) = 2
) then 'ready' else 'blocked' end;

commit;
