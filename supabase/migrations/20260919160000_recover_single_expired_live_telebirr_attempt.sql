-- Complete one exact, already-staged live TeleBirr observation after its short machine lease
-- expired during a trusted-verifier failure. The 12-hour authority is verifier-only, append-only,
-- and one-use. It never enables the KemerBet executor or changes a financial feature switch.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

alter table app.private_live_telebirr_historical_completion_authorities
  drop constraint private_live_telebirr_historical_completion_a_reason_code_check;
alter table app.private_live_telebirr_historical_completion_authorities
  add constraint private_live_telebirr_historical_completion_a_reason_code_check check (
    reason_code in (
      'expired_authority_staged_evidence_completion',
      'expired_attempt_staged_evidence_completion'
    )
  );

alter table app.private_live_telebirr_historical_completion_authorities
  drop constraint private_live_telebirr_historical_completion_window;
alter table app.private_live_telebirr_historical_completion_authorities
  add constraint private_live_telebirr_historical_completion_window check (
    (
      reason_code = 'expired_authority_staged_evidence_completion'
      and expires_at > authorized_at + interval '8 minutes'
      and expires_at <= authorized_at + interval '20 minutes'
    ) or (
      reason_code = 'expired_attempt_staged_evidence_completion'
      and expires_at >= authorized_at + interval '12 hours'
      and expires_at <= authorized_at + interval '12 hours 5 minutes'
    )
  );

create or replace function app.is_private_live_telebirr_historical_boundary_authorized(
  p_request_key uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(pg_catalog.bool_and(
    authority.request_key = p_request_key
    and authority.verification_job_id = job.id
    and authority.private_live_deposit_pilot_proof_id = proof.id
    and authority.pilot_revision_id = pilot.id
    and authority.expired_activation_epoch = activation_epoch.epoch
    and activation_control.current_epoch = activation_epoch.epoch
    and activation_epoch.authority_state = 'active'
    and activation_epoch.pilot_revision_id = pilot.id
    and activation_epoch.configuration_digest = pilot.configuration_digest
    and job.pilot_revision_id = pilot.id
    and job.pilot_configuration_digest = pilot.configuration_digest
    and proof.pilot_revision_id = pilot.id
    and proof.submitted_at + interval '24 hours' > pg_catalog.clock_timestamp()
    and pg_catalog.clock_timestamp() >= authority.authorized_at
    and pg_catalog.clock_timestamp() < authority.expires_at
    and not exists (
      select 1
        from app.private_live_telebirr_historical_completion_consumptions consumption
       where consumption.request_key = authority.request_key
    )
    and not exists (
      select 1
        from app.private_live_telebirr_historical_completion_closures closure
       where closure.request_key = authority.request_key
    )
    and not exists (
      select 1
        from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
       ) and role.rolcanlogin
    )
    and not exists (
      select 1
        from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
       )
    )
    and exists (
      select 1
        from pg_catalog.pg_authid role
       where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
         and role.rolcanlogin
         and not role.rolinherit and not role.rolsuper
         and not role.rolcreatedb and not role.rolcreaterole
         and not role.rolreplication and not role.rolbypassrls
         and role.rolconnlimit = 1
         and role.rolvaliduntil is not distinct from authority.expires_at
         and role.rolpassword like 'SCRAM-SHA-256$%'
    )
    and (
      (
        authority.reason_code = 'expired_attempt_staged_evidence_completion'
        and activation_epoch.revoked_at is null
        and emergency_intent.request_key is null
        and authority.authorized_at >= pilot.active_from
        and authority.authorized_at < pilot.expires_at
        and pilot.status = 'armed'
        and (
          select pg_catalog.count(*)
            from app.feature_switches feature_switch
           where feature_switch.feature_key in (
             'deposit_execution', 'payment_verification',
             'private_live_deposit_pilot', 'telebirr_authoritative_verification'
           ) and feature_switch.mode = 'live'
        ) = 4
        and exists (
          select 1
            from app.feature_switches feature_switch
           where feature_switch.feature_key = 'private_live_deposit_pilot'
             and feature_switch.settings = pg_catalog.jsonb_build_object(
               'contract_version', 1,
               'pilot_revision_id', pilot.id,
               'configuration_digest', pilot.configuration_digest
             )
        )
      )
      or (
        authority.reason_code = 'expired_authority_staged_evidence_completion'
        and activation_epoch.expires_at <= pg_catalog.clock_timestamp()
        and (
          (
            activation_epoch.revoked_at is null
            and emergency_intent.request_key is null
            and pilot.status = 'armed'
            and (
              select pg_catalog.count(*)
                from app.feature_switches feature_switch
               where feature_switch.feature_key in (
                 'deposit_execution', 'payment_verification',
                 'private_live_deposit_pilot', 'telebirr_authoritative_verification'
               ) and feature_switch.mode = 'live'
            ) = 4
            and exists (
              select 1
                from app.feature_switches feature_switch
               where feature_switch.feature_key = 'private_live_deposit_pilot'
                 and feature_switch.settings = pg_catalog.jsonb_build_object(
                   'contract_version', 1,
                   'pilot_revision_id', pilot.id,
                   'configuration_digest', pilot.configuration_digest
                 )
            )
          )
          or (
            activation_epoch.revoked_at is not null
            and activation_epoch.revocation_reason_code = 'execution_uncertainty'
            and emergency_intent.request_key is not null
            and emergency_intent.expected_epoch = activation_epoch.epoch
            and emergency_intent.reason_code = activation_epoch.revocation_reason_code
            and emergency_intent.requested_at is not distinct from activation_epoch.revoked_at
            and activation_epoch.expires_at <= emergency_intent.requested_at
            and pilot.status = 'stopped'
            and pilot.stopped_at is not distinct from emergency_intent.requested_at
            and pilot.stopped_by_admin_id is not distinct from
                emergency_intent.requested_by_admin_id
            and pilot.stop_reason_code is not distinct from emergency_intent.reason_code
            and pilot.expires_at <= emergency_intent.requested_at
            and app.current_private_trusted_telebirr_activation_epoch() is null
            and (
              select pg_catalog.count(*)
                from app.feature_switches feature_switch
               where feature_switch.feature_key in (
                 'cbe_birr_authoritative_verification', 'deposit_execution',
                 'payment_verification', 'private_live_deposit_pilot',
                 'telebirr_authoritative_verification', 'withdrawal_collection',
                 'withdrawal_validation'
               ) and feature_switch.mode = 'disabled'
                 and feature_switch.settings = '{}'::jsonb
            ) = 7
          )
        )
      )
    )
  ), false)
  from app.private_live_telebirr_historical_completion_authorities authority
  join app.private_live_telebirr_verification_jobs job
    on job.id = authority.verification_job_id
  join app.private_live_deposit_pilot_proofs proof
    on proof.id = authority.private_live_deposit_pilot_proof_id
  join app.private_live_deposit_pilot_revisions pilot
    on pilot.id = authority.pilot_revision_id
  join app.private_trusted_telebirr_activation_control activation_control
    on activation_control.control_key = 'trusted_telebirr_financial_authority'
  join app.private_trusted_telebirr_activation_epochs activation_epoch
    on activation_epoch.epoch = activation_control.current_epoch
   and activation_epoch.epoch = authority.expired_activation_epoch
  left join app.private_trusted_telebirr_emergency_disable_intents emergency_intent
    on emergency_intent.expected_epoch = activation_epoch.epoch
  where authority.request_key = p_request_key
$$;

create function app.arm_private_live_telebirr_staged_attempt_completion(
  p_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_activation_epoch bigint,
  p_request_key uuid,
  p_scram_verifier text,
  p_reason_code text
)
returns table (
  authorized_at timestamptz,
  expires_at timestamptz,
  already_armed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  authority app.private_live_telebirr_historical_completion_authorities%rowtype;
  activation app.private_trusted_telebirr_activation_epochs%rowtype;
  attempt app.private_live_telebirr_verification_attempts%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  job app.private_live_telebirr_verification_jobs%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  proof app.private_live_deposit_pilot_proofs%rowtype;
  signer app.private_live_telebirr_assignment_signers%rowtype;
  staged app.private_live_telebirr_device_evidence_staging%rowtype;
  exact_source_document_digest text;
  request_digest text;
  armed_at timestamptz;
  armed_until timestamptz;
begin
  if session_user <> 'postgres'
    or p_verification_job_id is null
    or p_pilot_revision_id is null
    or p_activation_epoch is null or p_activation_epoch <= 0
    or p_request_key is null
    or p_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_scram_verifier is null
    or p_scram_verifier
       !~ '^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$'
    or p_reason_code is distinct from
       'expired_attempt_staged_evidence_completion' then
    raise exception 'The staged TeleBirr completion request is invalid.';
  end if;

  perform control.current_epoch
    from app.private_trusted_telebirr_activation_control control
   where control.control_key = 'trusted_telebirr_financial_authority'
   for share;

  select epoch.* into activation
    from app.private_trusted_telebirr_activation_control control
    join app.private_trusted_telebirr_activation_epochs epoch
      on epoch.epoch = control.current_epoch
   where control.control_key = 'trusted_telebirr_financial_authority'
     and epoch.epoch = p_activation_epoch
     and epoch.pilot_revision_id = p_pilot_revision_id
   for share of control, epoch;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification', 'deposit_execution',
     'payment_verification', 'private_live_deposit_pilot',
     'telebirr_authoritative_verification', 'withdrawal_collection',
     'withdrawal_validation'
   ) order by feature_switch.feature_key for update;

  select verification_job.* into job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.id = p_verification_job_id
     and verification_job.pilot_revision_id = p_pilot_revision_id
     and verification_job.recovery_reason_code = 'assignment_runtime_unavailable'
     and verification_job.recovered_at is not null
     and verification_job.recovery_request_key is not null
   for update;

  select revision.* into pilot
    from app.private_live_deposit_pilot_revisions revision
   where revision.id = p_pilot_revision_id
   for update;

  select proof_row.* into proof
    from app.private_live_deposit_pilot_proofs proof_row
   where proof_row.id = job.private_live_deposit_pilot_proof_id
     and proof_row.pilot_revision_id = pilot.id
   for share;

  select receiver_profile.* into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = job.receiver_profile_id
     and receiver_profile.pilot_revision_id = pilot.id
   for share;

  select verification_attempt.* into attempt
    from app.private_live_telebirr_verification_attempts verification_attempt
    join app.private_live_telebirr_device_evidence_staging staged_evidence
      on staged_evidence.verification_attempt_id = verification_attempt.id
   where verification_attempt.verification_job_id = job.id
   order by staged_evidence.staged_at desc, verification_attempt.attempt_number desc
   limit 1 for share of verification_attempt, staged_evidence;

  select staged_evidence.* into staged
    from app.private_live_telebirr_device_evidence_staging staged_evidence
   where staged_evidence.verification_attempt_id = attempt.id
   order by staged_evidence.staged_at desc
   limit 1 for share;

  select device_enrollment.* into enrollment
    from app.private_live_telebirr_device_enrollments device_enrollment
   where device_enrollment.id = attempt.device_enrollment_id
   for share;

  select assignment_signer.* into signer
    from app.private_live_telebirr_assignment_transcripts transcript
    join app.private_live_telebirr_assignment_signers assignment_signer
      on assignment_signer.id = transcript.assignment_signer_id
   where transcript.verification_attempt_id = attempt.id
   for share of transcript, assignment_signer;

  exact_source_document_digest :=
    staged.signed_observation -> 'body' ->> 'sourceDocumentDigest';
  armed_at := pg_catalog.clock_timestamp();
  armed_until := armed_at + interval '12 hours';

  select existing.* into authority
    from app.private_live_telebirr_historical_completion_authorities existing
   where existing.request_key = p_request_key
      or existing.verification_job_id = job.id
      or existing.verification_attempt_id = attempt.id
   order by existing.created_at, existing.request_key
   limit 1 for share;

  if authority.request_key is not null then
    if authority.request_key is distinct from p_request_key
      or authority.verification_job_id is distinct from job.id
      or authority.verification_attempt_id is distinct from attempt.id
      or authority.pilot_revision_id is distinct from pilot.id
      or authority.expired_activation_epoch is distinct from p_activation_epoch
      or authority.observation_body_digest is distinct from staged.observation_body_digest
      or authority.source_document_digest is distinct from exact_source_document_digest
      or authority.reason_code is distinct from p_reason_code
      or authority.expires_at <= armed_at + interval '5 minutes'
      or not app.is_private_live_telebirr_historical_boundary_authorized(
        authority.request_key
      ) then
      raise exception 'The staged TeleBirr completion replay conflicts.';
    end if;
    return query select authority.authorized_at, authority.expires_at, true;
    return;
  end if;

  perform disabled.verifier_login
    from app.disable_private_trusted_telebirr_verifier_login() disabled;

  if activation.epoch is null
    or activation.authority_state <> 'active'
    or activation.revoked_at is not null
    or activation.expires_at <= armed_at
    or pilot.id is null or pilot.status <> 'armed'
    or armed_at < pilot.active_from or armed_at >= pilot.expires_at
    or pilot.configuration_digest is distinct from activation.configuration_digest
    or proof.id is null or profile.id is null
    or proof.submitted_at + interval '24 hours' < armed_until
    or attempt.id is null or staged.observation_body_digest is null
    or enrollment.id is null or signer.id is null
    or exact_source_document_digest is null
    or exact_source_document_digest !~ '^sha256:[0-9a-f]{64}$'
    or job.expires_at > armed_at
    or attempt.expires_at > armed_at
    or attempt.issued_at < job.recovered_at
    or attempt.expires_at > job.expires_at
    or attempt.issued_at < pilot.active_from
    or attempt.expires_at > pilot.expires_at
    or attempt.issued_at < profile.valid_from
    or attempt.expires_at > profile.valid_until
    or attempt.issued_at < enrollment.valid_from
    or attempt.expires_at > enrollment.valid_until
    or attempt.issued_at < signer.valid_from
    or attempt.expires_at > signer.valid_until
    or staged.observed_at < attempt.issued_at
    or staged.observed_at >= attempt.expires_at
    or staged.staged_at >= attempt.expires_at
    or (select pg_catalog.count(*) from app.private_live_telebirr_verification_attempts candidate
         where candidate.verification_job_id = job.id) <> 1
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_assignment_transcripts transcript
          join app.private_live_telebirr_verification_attempts candidate
            on candidate.id = transcript.verification_attempt_id
         where candidate.verification_job_id = job.id) <> 1
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_assignment_deliveries delivery
          join app.private_live_telebirr_verification_attempts candidate
            on candidate.id = delivery.verification_attempt_id
         where candidate.verification_job_id = job.id) <> 1
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_device_evidence_staging evidence
          join app.private_live_telebirr_verification_attempts candidate
            on candidate.id = evidence.verification_attempt_id
         where candidate.verification_job_id = job.id) <> 1
    or exists (select 1 from app.private_live_telebirr_verification_outcomes outcome
                where outcome.verification_job_id = job.id)
    or exists (select 1 from app.private_live_deposit_pilot_reservations reservation
                where reservation.private_live_deposit_pilot_proof_id = proof.id)
    or exists (select 1 from app.private_live_telebirr_settlement_documents settled
                where settled.source_document_digest = exact_source_document_digest)
    or exists (select 1 from app.private_live_telebirr_verifier_evidence_quarantine quarantine
                where quarantine.verification_attempt_id = attempt.id
                   or quarantine.observation_body_digest = staged.observation_body_digest)
    or exists (select 1 from app.provider_payment_evidence payment_evidence
                where payment_evidence.payment_provider_id = job.payment_provider_id
                  and payment_evidence.canonical_reference_fingerprint =
                      job.candidate_reference_fingerprint)
    or exists (select 1 from app.private_live_telebirr_device_revocations revocation
                where revocation.device_enrollment_id = enrollment.id)
    or exists (select 1 from app.private_live_telebirr_assignment_signer_revocations revocation
                where revocation.assignment_signer_id = signer.id)
    or (select pg_catalog.count(*) from app.feature_switches feature_switch
         where feature_switch.feature_key in (
           'deposit_execution', 'payment_verification',
           'private_live_deposit_pilot', 'telebirr_authoritative_verification'
         ) and feature_switch.mode = 'live') <> 4
    or not exists (select 1 from app.feature_switches feature_switch
         where feature_switch.feature_key = 'private_live_deposit_pilot'
           and feature_switch.settings = pg_catalog.jsonb_build_object(
             'contract_version', 1, 'pilot_revision_id', pilot.id,
             'configuration_digest', pilot.configuration_digest
           ))
    or (select pg_catalog.count(*) from app.feature_switches feature_switch
         where feature_switch.feature_key in (
           'cbe_birr_authoritative_verification', 'withdrawal_collection',
           'withdrawal_validation'
         ) and feature_switch.mode = 'disabled'
           and feature_switch.settings = '{}'::jsonb) <> 3
    or exists (select 1 from pg_catalog.pg_roles role
                where role.rolname in (
                  'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
                ) and role.rolcanlogin)
    or exists (select 1 from pg_catalog.pg_stat_activity activity
                where activity.usename in (
                  'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime',
                  'fetanagent_trusted_telebirr_verifier',
                  'fetanagent_trusted_telebirr_verifier_runtime'
                ))
    or not exists (select 1 from pg_catalog.pg_authid role
         where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
           and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
           and not role.rolcreatedb and not role.rolcreaterole
           and not role.rolreplication and not role.rolbypassrls
           and role.rolconnlimit = 1 and role.rolpassword is null)
    or not exists (select 1 from pg_catalog.pg_authid role
         where role.rolname = 'fetanagent_trusted_telebirr_verifier'
           and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
           and not role.rolcreatedb and not role.rolcreaterole
           and not role.rolreplication and not role.rolbypassrls
           and role.rolconnlimit = 2 and role.rolpassword is null)
    or (select pg_catalog.count(*)
          from pg_catalog.pg_auth_members membership
          join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
          join pg_catalog.pg_roles member_role on member_role.oid = membership.member
         where member_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
           and granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
           and membership.inherit_option and not membership.set_option
           and not membership.admin_option) <> 1
    or (select pg_catalog.count(*)
          from pg_catalog.pg_auth_members membership
          join pg_catalog.pg_roles member_role on member_role.oid = membership.member
         where member_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime') <> 1
    or (select pg_catalog.count(*)
          from pg_catalog.pg_auth_members membership
          join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
         where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier') <> 2
    or not exists (
      select 1
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
       where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
         and member_role.rolname = 'postgres'
         and not membership.inherit_option and not membership.set_option
         and membership.admin_option
    ) then
    raise exception 'The staged TeleBirr evidence is not recoverable.';
  end if;

  request_digest := app.private_live_telebirr_historical_completion_digest(
    p_request_key, job.id, attempt.id, pilot.id, p_activation_epoch,
    staged.observation_body_digest, exact_source_document_digest,
    armed_at, armed_until, p_reason_code
  );

  insert into app.private_live_telebirr_historical_completion_authorities (
    request_key, verification_job_id, verification_attempt_id,
    private_live_deposit_pilot_proof_id, pilot_revision_id, receiver_profile_id,
    expired_activation_epoch, observation_body_digest, source_document_digest,
    reason_code, request_digest, authorized_at, expires_at
  ) values (
    p_request_key, job.id, attempt.id, proof.id, pilot.id, profile.id,
    p_activation_epoch, staged.observation_body_digest, exact_source_document_digest,
    p_reason_code, request_digest, armed_at, armed_until
  ) returning * into authority;

  execute pg_catalog.format(
    'alter role %I login password %L valid until %L',
    'fetanagent_trusted_telebirr_verifier_runtime',
    p_scram_verifier,
    authority.expires_at
  );

  if not exists (
    select 1 from pg_catalog.pg_authid role
     where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
       and role.rolcanlogin and not role.rolinherit and not role.rolsuper
       and not role.rolcreatedb and not role.rolcreaterole
       and not role.rolreplication and not role.rolbypassrls
       and role.rolconnlimit = 1
       and role.rolvaliduntil is not distinct from authority.expires_at
       and role.rolpassword is not distinct from p_scram_verifier
  ) then
    raise exception 'The bounded staged TeleBirr verifier login was not provisioned exactly.';
  end if;

  insert into app.audit_events (
    actor_kind, actor_label, action, resource_type, resource_id, metadata
  ) values (
    'worker', 'staged-live-telebirr-completion',
    'deposit.live_telebirr_staged_attempt_completion_armed',
    'private_live_deposit_pilot', pilot.id,
    pg_catalog.jsonb_build_object(
      'reason_code', p_reason_code,
      'expires_at', authority.expires_at,
      'financial_rows_created', false,
      'execution_enabled', false
    )
  );

  return query select authority.authorized_at, authority.expires_at, false;
end;
$$;

-- Prefer an exact one-use staged-attempt authority even while the surrounding pilot remains live.
-- If none exists, preserve the original active-pilot and expired-pilot behavior unchanged.
create or replace function app.load_next_private_live_telebirr_staged_evidence()
returns table (
  verification_attempt_id uuid,
  lease_token uuid,
  completion_request_key uuid,
  observation_body_digest text,
  signed_assignment jsonb,
  signed_observation jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_trusted_telebirr_verifier_session();

  return query
  select attempt.id,
         attempt.lease_token,
         attempt.lease_request_key,
         staged.observation_body_digest,
         staged.signed_assignment,
         staged.signed_observation
    from app.private_live_telebirr_historical_completion_authorities authority
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = authority.verification_attempt_id
    join app.private_live_telebirr_device_evidence_staging staged
      on staged.verification_attempt_id = attempt.id
     and staged.observation_body_digest = authority.observation_body_digest
   where app.is_private_live_telebirr_historical_attempt_authorized(
           attempt.id, attempt.lease_token, staged.observation_body_digest,
           authority.source_document_digest
         )
   order by authority.authorized_at, authority.request_key
   limit 1;
  if found then return; end if;

  if app.current_private_trusted_telebirr_activation_epoch() is not null then
    return query
    select staged.verification_attempt_id,
           staged.lease_token,
           staged.completion_request_key,
           staged.observation_body_digest,
           staged.signed_assignment,
           staged.signed_observation
      from app.load_next_private_live_telebirr_staged_evidence_pre_epoch() staged;
  end if;
end;
$$;

alter function app.is_private_live_telebirr_historical_boundary_authorized(uuid)
  owner to postgres;
alter function app.arm_private_live_telebirr_staged_attempt_completion(
  uuid, uuid, bigint, uuid, text, text
) owner to postgres;
alter function app.load_next_private_live_telebirr_staged_evidence() owner to postgres;

revoke all on function
  app.is_private_live_telebirr_historical_boundary_authorized(uuid),
  app.arm_private_live_telebirr_staged_attempt_completion(
    uuid, uuid, bigint, uuid, text, text
  )
from public, anon, authenticated, service_role,
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_deposit_executor,
     fetanagent_deposit_executor_runtime;

revoke all on function app.load_next_private_live_telebirr_staged_evidence()
from public, anon, authenticated, service_role,
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime;
grant execute on function app.load_next_private_live_telebirr_staged_evidence()
to fetanagent_trusted_telebirr_verifier;

comment on function app.arm_private_live_telebirr_staged_attempt_completion(
  uuid, uuid, bigint, uuid, text, text
) is
  'Postgres-only one-use 12-hour verifier authorization for one exact on-time staged observation whose short machine lease expired. It never enables KemerBet execution or changes feature switches.';

comment on function app.load_next_private_live_telebirr_staged_evidence() is
  'Trusted-verifier-only loader. One exact append-only staged-attempt recovery takes precedence; otherwise the existing active or historical pilot loader remains unchanged.';

commit;
