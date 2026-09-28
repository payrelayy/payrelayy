\set ON_ERROR_STOP on
\getenv request_key PRODUCTION_COMPANION_EXECUTION_REQUEST_KEY
\getenv release_sha PRODUCTION_COMPANION_RELEASE_SHA
\getenv archive_sha PRODUCTION_COMPANION_ARCHIVE_SHA256
\getenv tree_sha PRODUCTION_COMPANION_INSTALLATION_TREE_SHA256

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '20s';
set local lock_timeout = '2s';

with candidates as materialized (
  select owner_user.auth_user_id, pilot.id as pilot_revision_id,
         authority.epoch as activation_epoch, certificate.certificate_id
    from app.private_trusted_telebirr_activation_control selected
    join app.private_trusted_telebirr_activation_epochs authority
      on authority.epoch = selected.current_epoch
    join app.private_live_deposit_pilot_revisions pilot
      on pilot.id = authority.pilot_revision_id
    join app.admin_users owner_user
      on owner_user.id = pilot.armed_by_admin_id
    join app.agent_platform_companion_pairing_challenges pairing
      on pairing.created_by_admin_id = owner_user.id
    join app.agent_platform_companion_enrollment_certificates certificate
      on certificate.pairing_id = pairing.pairing_id
   where selected.control_key = 'trusted_telebirr_financial_authority'
     and authority.authority_state = 'active'
     and authority.revoked_at is null
     and authority.configuration_digest = pilot.configuration_digest
     and pilot.status = 'armed'
     and pilot.expires_at > pg_catalog.clock_timestamp() + interval '10 minutes'
     and owner_user.role = 'owner' and owner_user.status = 'active'
     and pairing.state = 'completed'
     and certificate.valid_from <= pg_catalog.clock_timestamp()
     and certificate.valid_until > pg_catalog.clock_timestamp() + interval '10 minutes'
     and not exists (
       select 1 from app.agent_platform_companion_device_revocations revocation
        where revocation.certificate_id = certificate.certificate_id
     )
), exact_candidate as (
  select candidate.* from candidates candidate
   where (select pg_catalog.count(*) from candidates) = 1
), prepared as (
  select result.valid_until, result.replayed
    from exact_candidate candidate
    cross join lateral app.prepare_agent_platform_companion_execution_activation_request(
      candidate.auth_user_id,
      candidate.pilot_revision_id,
      candidate.activation_epoch,
      candidate.certificate_id,
      :'release_sha', :'archive_sha', :'tree_sha', :'request_key'::uuid
    ) result
)
select case when pg_catalog.count(*) = 1
       and pg_catalog.bool_and(not replayed and valid_until > pg_catalog.clock_timestamp() + interval '5 minutes')
  then 'ready' else 'blocked' end
from prepared;

commit;
