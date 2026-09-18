-- Permit one exact historical completion after the independent emergency boundary has safely
-- revoked an already-expired activation epoch. This never reactivates the epoch, pilot, feature
-- switches, or KemerBet executor. The only temporary capability remains the bounded verifier
-- login created by the existing one-use historical authority.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

-- Keep the shared emergency lineage in one predicate. Attempt authorization additionally checks
-- staged evidence and pre-outcome replay state; intent/claim authorization can continue through
-- atomic settlement after the outcome's settlement-document trigger has run.
create function app.is_private_live_telebirr_historical_boundary_authorized(
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
    and activation_epoch.expires_at <= pg_catalog.clock_timestamp()
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
       )
         and role.rolcanlogin
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
         and not role.rolinherit
         and not role.rolsuper
         and not role.rolcreatedb
         and not role.rolcreaterole
         and not role.rolreplication
         and not role.rolbypassrls
         and role.rolconnlimit = 1
         and role.rolvaliduntil is not distinct from authority.expires_at
         and role.rolpassword like 'SCRAM-SHA-256$%'
    )
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
           )
             and feature_switch.mode = 'live'
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
           )
             and feature_switch.mode = 'disabled'
             and feature_switch.settings = '{}'::jsonb
        ) = 7
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

create or replace function app.is_private_live_telebirr_historical_attempt_authorized(
  p_verification_attempt_id uuid,
  p_lease_token uuid default null,
  p_observation_body_digest text default null,
  p_source_document_digest text default null
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(pg_catalog.bool_and(
    app.is_private_live_telebirr_historical_boundary_authorized(
      authority.request_key
    )
    and authority.verification_attempt_id = attempt.id
    and authority.verification_job_id = job.id
    and authority.private_live_deposit_pilot_proof_id = job.private_live_deposit_pilot_proof_id
    and authority.pilot_revision_id = job.pilot_revision_id
    and authority.receiver_profile_id = job.receiver_profile_id
    and authority.observation_body_digest = staged.observation_body_digest
    and authority.source_document_digest =
        staged.signed_observation -> 'body' ->> 'sourceDocumentDigest'
    and (p_lease_token is null or attempt.lease_token = p_lease_token)
    and (
      p_observation_body_digest is null
      or staged.observation_body_digest = p_observation_body_digest
    )
    and (
      p_source_document_digest is null
      or authority.source_document_digest = p_source_document_digest
    )
    and job.pilot_configuration_digest = pilot.configuration_digest
    and attempt.issued_at >= pilot.active_from
    and attempt.expires_at <= pilot.expires_at
    and attempt.expires_at <= profile.valid_until
    and staged.observed_at >= attempt.issued_at
    and staged.observed_at < attempt.expires_at
    and staged.staged_at < attempt.expires_at
    and (
      activation_epoch.revoked_at is null
      or (
        emergency_intent.request_key is not null
        and staged.observed_at < emergency_intent.requested_at
        and staged.staged_at < emergency_intent.requested_at
        and attempt.expires_at <= emergency_intent.requested_at
      )
    )
    and not exists (
      select 1
        from app.private_live_telebirr_settlement_documents settled
       where settled.source_document_digest = authority.source_document_digest
    )
    and not exists (
      select 1
        from app.private_live_telebirr_verifier_evidence_quarantine quarantine
       where quarantine.verification_attempt_id = attempt.id
          or quarantine.observation_body_digest = staged.observation_body_digest
    )
  ), false)
  from app.private_live_telebirr_historical_completion_authorities authority
  join app.private_live_telebirr_verification_attempts attempt
    on attempt.id = authority.verification_attempt_id
  join app.private_live_telebirr_verification_jobs job
    on job.id = authority.verification_job_id
   and job.id = attempt.verification_job_id
  join app.private_live_deposit_pilot_revisions pilot
    on pilot.id = authority.pilot_revision_id
  join app.private_live_telebirr_receiver_profiles profile
    on profile.id = authority.receiver_profile_id
  join app.private_live_telebirr_device_evidence_staging staged
    on staged.verification_attempt_id = attempt.id
   and staged.observation_body_digest = authority.observation_body_digest
  join app.private_trusted_telebirr_activation_epochs activation_epoch
    on activation_epoch.epoch = authority.expired_activation_epoch
  left join app.private_trusted_telebirr_emergency_disable_intents emergency_intent
    on emergency_intent.expected_epoch = activation_epoch.epoch
  where authority.verification_attempt_id = p_verification_attempt_id
$$;

create or replace function app.is_private_live_telebirr_historical_intent_authorized(
  p_deposit_intent_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(pg_catalog.bool_and(
    app.is_private_live_telebirr_historical_boundary_authorized(
      authority.request_key
    )
    and outcome.deposit_intent_id = p_deposit_intent_id
    and outcome.verification_attempt_id = authority.verification_attempt_id
    and outcome.verification_job_id = authority.verification_job_id
    and outcome.private_live_deposit_pilot_proof_id =
        authority.private_live_deposit_pilot_proof_id
    and outcome.pilot_revision_id = authority.pilot_revision_id
    and outcome.receiver_profile_id = authority.receiver_profile_id
    and outcome.disposition = 'settlement_candidate'
    and outcome.reason_code = 'exact_proof_match'
  ), false)
  from app.private_live_telebirr_historical_completion_authorities authority
  join app.private_live_telebirr_verification_outcomes outcome
    on outcome.verification_attempt_id = authority.verification_attempt_id
   and outcome.verification_job_id = authority.verification_job_id
  where outcome.deposit_intent_id = p_deposit_intent_id
$$;

create function app.private_live_telebirr_historical_pilot_for_intent(
  p_deposit_intent_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select authority.pilot_revision_id
    from app.private_live_telebirr_historical_completion_authorities authority
    join app.private_live_telebirr_verification_outcomes outcome
      on outcome.verification_attempt_id = authority.verification_attempt_id
     and outcome.verification_job_id = authority.verification_job_id
   where outcome.deposit_intent_id = p_deposit_intent_id
     and app.is_private_live_telebirr_historical_intent_authorized(
       p_deposit_intent_id
     )
$$;

create function app.private_live_telebirr_historical_pilot_for_claim(
  p_deposit_payment_claim_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select app.private_live_telebirr_historical_pilot_for_intent(
    claim.deposit_intent_id
  )
    from app.deposit_payment_claims claim
   where claim.id = p_deposit_payment_claim_id
     and app.is_private_live_telebirr_historical_claim_authorized(
       p_deposit_payment_claim_id
     )
$$;

-- Apply source-exact patches while preserving each routine's OID, owner, ACL, SECURITY DEFINER
-- flag, and search path. A drifted prerequisite fails the migration instead of broadening access.
create temporary table historical_function_patch_scratch (
  singleton boolean primary key default true check (singleton)
) on commit drop;

create function pg_temp.apply_exact_historical_function_patch(
  p_signature regprocedure,
  p_markers text[],
  p_replacements text[],
  p_expected_counts integer[]
)
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  original_definition text;
  original_source text;
  original_owner oid;
  original_acl aclitem[];
  original_security_definer boolean;
  original_config text[];
  patched_definition text;
  patched_source text;
  marker_count integer;
  marker_index integer;
begin
  if p_signature is null
    or pg_catalog.array_length(p_markers, 1) is distinct from
       pg_catalog.array_length(p_replacements, 1)
    or pg_catalog.array_length(p_markers, 1) is distinct from
       pg_catalog.array_length(p_expected_counts, 1) then
    raise exception 'The historical completion function patch contract is invalid.';
  end if;

  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl, routine.prosecdef, routine.proconfig
    into original_definition, original_source, original_owner, original_acl,
         original_security_definer, original_config
    from pg_catalog.pg_proc routine
   where routine.oid = p_signature;

  if original_definition is null then
    raise exception 'A historical completion patch target is unavailable.';
  end if;

  patched_definition := original_definition;
  patched_source := original_source;
  for marker_index in 1..pg_catalog.array_length(p_markers, 1) loop
    marker_count := (
      pg_catalog.length(patched_source) - pg_catalog.length(
        pg_catalog.replace(patched_source, p_markers[marker_index], '')
      )
    ) / pg_catalog.length(p_markers[marker_index]);
    if marker_count <> p_expected_counts[marker_index] then
      raise exception 'Historical completion patch marker % matched % instead of %.',
        marker_index, marker_count, p_expected_counts[marker_index];
    end if;
    patched_definition := pg_catalog.replace(
      patched_definition, p_markers[marker_index], p_replacements[marker_index]
    );
    patched_source := pg_catalog.replace(
      patched_source, p_markers[marker_index], p_replacements[marker_index]
    );
  end loop;

  execute patched_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = p_signature
       and routine.prosrc = patched_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.prosecdef is not distinct from original_security_definer
       and routine.proconfig is not distinct from original_config
  ) then
    raise exception 'A historical completion patch changed function authority.';
  end if;
end;
$$;

select pg_temp.apply_exact_historical_function_patch(
  'app.arm_private_live_telebirr_historical_completion(uuid,uuid,bigint,uuid,text,text)'::regprocedure,
  array[
    $marker$  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  job app.private_live_telebirr_verification_jobs%rowtype;$marker$,
    $marker$   for share of activation_control, activation;

  perform feature_switch.feature_key$marker$,
    $marker$  armed_until := least(
    armed_at + interval '20 minutes',
    proof.submitted_at + interval '24 hours'
  );

  select existing.*$marker$,
    $marker$    or activation_epoch.revoked_at is not null$marker$,
    $marker$    or pilot.status <> 'armed'$marker$,
    $marker$    or (select pg_catalog.count(*) from app.feature_switches feature_switch
         where feature_switch.feature_key in (
           'deposit_execution', 'payment_verification',
           'private_live_deposit_pilot', 'telebirr_authoritative_verification'
         ) and feature_switch.mode = 'live') <> 4
    or not exists (
      select 1 from app.feature_switches feature_switch
       where feature_switch.feature_key = 'private_live_deposit_pilot'
         and feature_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    )$marker$
  ],
  array[
    $replacement$  emergency_intent app.private_trusted_telebirr_emergency_disable_intents%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  job app.private_live_telebirr_verification_jobs%rowtype;
  post_emergency_authority boolean;$replacement$,
    $replacement$   for share of activation_control, activation;

  select emergency.*
    into emergency_intent
    from app.private_trusted_telebirr_emergency_disable_intents emergency
   where emergency.expected_epoch = p_expired_activation_epoch
   for share;

  perform feature_switch.feature_key$replacement$,
    $replacement$  armed_until := least(
    armed_at + interval '20 minutes',
    proof.submitted_at + interval '24 hours'
  );

  post_emergency_authority := coalesce(
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
    and staged.observed_at < emergency_intent.requested_at
    and staged.staged_at < emergency_intent.requested_at
    and attempt.expires_at <= emergency_intent.requested_at
    and app.current_private_trusted_telebirr_activation_epoch() is null
    and (
      select pg_catalog.count(*)
        from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'cbe_birr_authoritative_verification', 'deposit_execution',
         'payment_verification', 'private_live_deposit_pilot',
         'telebirr_authoritative_verification', 'withdrawal_collection',
         'withdrawal_validation'
       )
         and feature_switch.mode = 'disabled'
         and feature_switch.settings = '{}'::jsonb
    ) = 7,
    false
  );

  select existing.*$replacement$,
    $replacement$    or (
      (
        activation_epoch.revoked_at is not null
        or emergency_intent.request_key is not null
      )
      and not post_emergency_authority
    )$replacement$,
    $replacement$    or (pilot.status <> 'armed' and not post_emergency_authority)$replacement$,
    $replacement$    or (
      not post_emergency_authority
      and (
        (select pg_catalog.count(*) from app.feature_switches feature_switch
           where feature_switch.feature_key in (
             'deposit_execution', 'payment_verification',
             'private_live_deposit_pilot', 'telebirr_authoritative_verification'
           ) and feature_switch.mode = 'live') <> 4
        or not exists (
          select 1 from app.feature_switches feature_switch
           where feature_switch.feature_key = 'private_live_deposit_pilot'
             and feature_switch.settings = pg_catalog.jsonb_build_object(
               'contract_version', 1,
               'pilot_revision_id', pilot.id,
               'configuration_digest', pilot.configuration_digest
             )
        )
      )
    )$replacement$
  ],
  array[1, 1, 1, 1, 1, 1]
);

select pg_temp.apply_exact_historical_function_patch(
  'app.load_private_live_telebirr_verification_authority_pre_epoch(uuid,uuid,timestamp with time zone)'::regprocedure,
  array[
    $marker$  is_pilot_live := switch_count = 4$marker$,
    $marker$    and profile.payment_provider_id = current_provider.id;$marker$
  ],
  array[
    $replacement$  is_pilot_live := app.is_private_live_telebirr_historical_attempt_authorized(
      attempted.id, attempted.lease_token, null, null
    ) or (
    switch_count = 4$replacement$,
    $replacement$    and profile.payment_provider_id = current_provider.id
  );$replacement$
  ],
  array[1, 1]
);

select pg_temp.apply_exact_historical_function_patch(
  'app.complete_private_live_telebirr_verification_internal(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,bigint,timestamp with time zone,text)'::regprocedure,
  array[
    $marker$  if switch_count <> 5$marker$,
    $marker$    or pilot.status <> 'armed'$marker$,
    $marker$    or not app.is_private_live_deposit_pilot_enforced()$marker$,
    $marker$    or not exists (
      select 1
        from app.feature_switches provider_switch
       where provider_switch.feature_key = 'telebirr_authoritative_verification'
         and provider_switch.mode = 'live'
    )$marker$
  ],
  array[
    $replacement$  if (
    switch_count <> 5
    and not app.is_private_live_telebirr_historical_attempt_authorized(
      attempt.id, p_lease_token, p_observation_body_digest, p_source_document_digest
    )
  )$replacement$,
    $replacement$    or (
      pilot.status <> 'armed'
      and not app.is_private_live_telebirr_historical_attempt_authorized(
        attempt.id, p_lease_token, p_observation_body_digest, p_source_document_digest
      )
    )$replacement$,
    $replacement$    or (
      not app.is_private_live_deposit_pilot_enforced()
      and not app.is_private_live_telebirr_historical_attempt_authorized(
        attempt.id, p_lease_token, p_observation_body_digest, p_source_document_digest
      )
    )$replacement$,
    $replacement$    or (
      not app.is_private_live_telebirr_historical_attempt_authorized(
        attempt.id, p_lease_token, p_observation_body_digest, p_source_document_digest
      )
      and not exists (
        select 1
          from app.feature_switches provider_switch
         where provider_switch.feature_key = 'telebirr_authoritative_verification'
           and provider_switch.mode = 'live'
      )
    )$replacement$
  ],
  array[1, 1, 3, 3]
);

select pg_temp.apply_exact_historical_function_patch(
  'app.populate_deposit_intent_snapshot()'::regprocedure,
  array[$marker$      or pilot.status <> 'armed'$marker$],
  array[$replacement$      or (
        pilot.status <> 'armed'
        and not app.is_private_live_telebirr_historical_intent_authorized(new.id)
      )$replacement$],
  array[1]
);

select pg_temp.apply_exact_historical_function_patch(
  'app.reserve_private_live_deposit_pilot_claim(uuid)'::regprocedure,
  array[
    $marker$  if not app.is_private_live_deposit_pilot_enforced() then$marker$,
    $marker$     and feature_switch.settings ? 'pilot_revision_id';

  select pilot_revision.*$marker$,
    $marker$    or pilot.status <> 'armed'$marker$,
    $marker$  if pilot.status <> 'armed'$marker$,
    $marker$    or not exists (
      select 1
        from app.feature_switches feature_switch
       where feature_switch.feature_key = 'private_live_deposit_pilot'
         and feature_switch.mode = 'live'
         and feature_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    )$marker$,
    $marker$    or not exists (
      select 1
        from app.feature_switches pilot_switch
       where pilot_switch.feature_key = 'private_live_deposit_pilot'
         and pilot_switch.mode = 'live'
         and pilot_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    )$marker$,
    $marker$  if live_financial_switch_count <> 2 then$marker$,
    $marker$    or not exists (
      select 1
        from app.feature_switches provider_switch
       where provider_switch.feature_key =
             provider_member.provider_code_snapshot || '_authoritative_verification'
         and provider_switch.mode = 'live'
    )$marker$
  ],
  array[
    $replacement$  if not app.is_private_live_deposit_pilot_enforced()
    and not app.is_private_live_telebirr_historical_claim_authorized(
      p_deposit_payment_claim_id
    ) then$replacement$,
    $replacement$     and feature_switch.settings ? 'pilot_revision_id';

  if pilot_id is null then
    select app.private_live_telebirr_historical_pilot_for_claim(
      p_deposit_payment_claim_id
    ) into pilot_id;
  end if;

  select pilot_revision.*$replacement$,
    $replacement$    or (
      pilot.status <> 'armed'
      and not app.is_private_live_telebirr_historical_claim_authorized(
        p_deposit_payment_claim_id
      )
    )$replacement$,
    $replacement$  if (
    pilot.status <> 'armed'
    and not app.is_private_live_telebirr_historical_claim_authorized(
      p_deposit_payment_claim_id
    )
  )$replacement$,
    $replacement$    or (
      not app.is_private_live_telebirr_historical_claim_authorized(
        p_deposit_payment_claim_id
      )
      and not exists (
        select 1
          from app.feature_switches feature_switch
         where feature_switch.feature_key = 'private_live_deposit_pilot'
           and feature_switch.mode = 'live'
           and feature_switch.settings = pg_catalog.jsonb_build_object(
             'contract_version', 1,
             'pilot_revision_id', pilot.id,
             'configuration_digest', pilot.configuration_digest
           )
      )
    )$replacement$,
    $replacement$    or (
      not app.is_private_live_telebirr_historical_claim_authorized(
        p_deposit_payment_claim_id
      )
      and not exists (
        select 1
          from app.feature_switches pilot_switch
         where pilot_switch.feature_key = 'private_live_deposit_pilot'
           and pilot_switch.mode = 'live'
           and pilot_switch.settings = pg_catalog.jsonb_build_object(
             'contract_version', 1,
             'pilot_revision_id', pilot.id,
             'configuration_digest', pilot.configuration_digest
           )
      )
    )$replacement$,
    $replacement$  if live_financial_switch_count <> 2
    and not app.is_private_live_telebirr_historical_claim_authorized(
      p_deposit_payment_claim_id
    ) then$replacement$,
    $replacement$    or (
      not app.is_private_live_telebirr_historical_claim_authorized(
        p_deposit_payment_claim_id
      )
      and not exists (
        select 1
          from app.feature_switches provider_switch
         where provider_switch.feature_key =
               provider_member.provider_code_snapshot || '_authoritative_verification'
           and provider_switch.mode = 'live'
      )
    )$replacement$
  ],
  array[1, 1, 1, 1, 1, 1, 1, 1]
);

select pg_temp.apply_exact_historical_function_patch(
  'app.require_private_live_deposit_pilot_authorization(uuid,uuid)'::regprocedure,
  array[
    $marker$  if switch_count <> 5 or not app.is_private_live_deposit_pilot_enforced() then$marker$,
    $marker$     and feature_switch.settings ? 'pilot_revision_id';

  select pilot_revision.*$marker$,
    $marker$    or pilot.status <> 'armed'$marker$,
    $marker$    or live_financial_switch_count <> 2$marker$,
    $marker$    or not exists (
      select 1
        from app.feature_switches feature_switch
       where feature_switch.feature_key = 'private_live_deposit_pilot'
         and feature_switch.mode = 'live'
         and feature_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    )$marker$,
    $marker$    or not exists (
      select 1
        from app.feature_switches provider_switch
       where provider_switch.feature_key =
             provider_member.provider_code_snapshot || '_authoritative_verification'
         and provider_switch.mode = 'live'
    )$marker$
  ],
  array[
    $replacement$  if (
    switch_count <> 5 or not app.is_private_live_deposit_pilot_enforced()
  ) and not app.is_private_live_telebirr_historical_intent_authorized(
    p_deposit_intent_id
  ) then$replacement$,
    $replacement$     and feature_switch.settings ? 'pilot_revision_id';

  if pilot_id is null then
    select app.private_live_telebirr_historical_pilot_for_intent(
      p_deposit_intent_id
    ) into pilot_id;
  end if;

  select pilot_revision.*$replacement$,
    $replacement$    or (
      pilot.status <> 'armed'
      and not app.is_private_live_telebirr_historical_intent_authorized(
        p_deposit_intent_id
      )
    )$replacement$,
    $replacement$    or (
      live_financial_switch_count <> 2
      and not app.is_private_live_telebirr_historical_intent_authorized(
        p_deposit_intent_id
      )
    )$replacement$,
    $replacement$    or (
      not app.is_private_live_telebirr_historical_intent_authorized(
        p_deposit_intent_id
      )
      and not exists (
        select 1
          from app.feature_switches feature_switch
         where feature_switch.feature_key = 'private_live_deposit_pilot'
           and feature_switch.mode = 'live'
           and feature_switch.settings = pg_catalog.jsonb_build_object(
             'contract_version', 1,
             'pilot_revision_id', pilot.id,
             'configuration_digest', pilot.configuration_digest
           )
      )
    )$replacement$,
    $replacement$    or (
      not app.is_private_live_telebirr_historical_intent_authorized(
        p_deposit_intent_id
      )
      and not exists (
        select 1
          from app.feature_switches provider_switch
         where provider_switch.feature_key =
               provider_member.provider_code_snapshot || '_authoritative_verification'
           and provider_switch.mode = 'live'
      )
    )$replacement$
  ],
  array[1, 1, 1, 1, 1, 1]
);

select pg_temp.apply_exact_historical_function_patch(
  'app.finalize_private_live_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)'::regprocedure,
  array[
    $marker$     and pilot_switch.settings ? 'pilot_revision_id';

  select pilot_revision.*$marker$,
    $marker$    or pilot.status <> 'armed'$marker$,
    $marker$    or not exists (
      select 1
        from app.feature_switches pilot_switch
       where pilot_switch.feature_key = 'private_live_deposit_pilot'
         and pilot_switch.mode = 'live'
         and pilot_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    )$marker$,
    $marker$    or (
      select pg_catalog.count(*)
        from app.feature_switches financial_switch
       where financial_switch.feature_key in ('deposit_execution', 'payment_verification')
         and financial_switch.mode = 'live'
    ) <> 2$marker$,
    $marker$    or not exists (
      select 1
        from app.feature_switches provider_switch
        join app.private_live_deposit_pilot_providers provider_switch_member
          on provider_switch_member.pilot_revision_id = pilot.id
         and provider_switch_member.payment_provider_id = intent.payment_provider_id
         and provider_switch.feature_key =
             provider_switch_member.provider_code_snapshot || '_authoritative_verification'
       where provider_switch.mode = 'live'
    )$marker$
  ],
  array[
    $replacement$     and pilot_switch.settings ? 'pilot_revision_id';

  if pilot_id is null then
    select app.private_live_telebirr_historical_pilot_for_intent(
      p_deposit_intent_id
    ) into pilot_id;
  end if;

  select pilot_revision.*$replacement$,
    $replacement$    or (
      pilot.status <> 'armed'
      and not app.is_private_live_telebirr_historical_intent_authorized(
        p_deposit_intent_id
      )
    )$replacement$,
    $replacement$    or (
      not app.is_private_live_telebirr_historical_intent_authorized(
        p_deposit_intent_id
      )
      and not exists (
        select 1
          from app.feature_switches pilot_switch
         where pilot_switch.feature_key = 'private_live_deposit_pilot'
           and pilot_switch.mode = 'live'
           and pilot_switch.settings = pg_catalog.jsonb_build_object(
             'contract_version', 1,
             'pilot_revision_id', pilot.id,
             'configuration_digest', pilot.configuration_digest
           )
      )
    )$replacement$,
    $replacement$    or (
      not app.is_private_live_telebirr_historical_intent_authorized(
        p_deposit_intent_id
      )
      and (
        select pg_catalog.count(*)
          from app.feature_switches financial_switch
         where financial_switch.feature_key in ('deposit_execution', 'payment_verification')
           and financial_switch.mode = 'live'
      ) <> 2
    )$replacement$,
    $replacement$    or (
      not app.is_private_live_telebirr_historical_intent_authorized(
        p_deposit_intent_id
      )
      and not exists (
        select 1
          from app.feature_switches provider_switch
          join app.private_live_deposit_pilot_providers provider_switch_member
            on provider_switch_member.pilot_revision_id = pilot.id
           and provider_switch_member.payment_provider_id = intent.payment_provider_id
           and provider_switch.feature_key =
               provider_switch_member.provider_code_snapshot || '_authoritative_verification'
         where provider_switch.mode = 'live'
      )
    )$replacement$
  ],
  array[1, 1, 1, 1, 1]
);

select pg_temp.apply_exact_historical_function_patch(
  'app.finalize_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)'::regprocedure,
  array[$marker$  if switch_count <> 2 then$marker$],
  array[$replacement$  if switch_count <> 2
    and not app.is_private_live_telebirr_historical_intent_authorized(
      p_deposit_intent_id
    ) then$replacement$],
  array[1]
);

select pg_temp.apply_exact_historical_function_patch(
  'app.claim_verified_deposit_payment(uuid,uuid,uuid)'::regprocedure,
  array[
    $marker$  if not found or verification_mode <> 'live' then$marker$,
    $marker$  if claim_time > deposit_row.payment_deadline_at then$marker$
  ],
  array[
    $replacement$  if (not found or verification_mode <> 'live')
    and not app.is_private_live_telebirr_historical_intent_authorized(
      p_deposit_intent_id
    ) then$replacement$,
    $replacement$  if claim_time > deposit_row.payment_deadline_at
    and not app.is_private_live_telebirr_historical_intent_authorized(
      p_deposit_intent_id
    ) then$replacement$
  ],
  array[1, 1]
);

select pg_temp.apply_exact_historical_function_patch(
  'app.enqueue_verified_deposit_execution(uuid)'::regprocedure,
  array[$marker$  if switch_count <> 2 then$marker$],
  array[$replacement$  if switch_count <> 2
    and not app.is_private_live_telebirr_historical_intent_authorized(
      p_deposit_intent_id
    ) then$replacement$],
  array[1]
);

drop function pg_temp.apply_exact_historical_function_patch(
  regprocedure, text[], text[], integer[]
);

alter function app.is_private_live_telebirr_historical_boundary_authorized(uuid)
  owner to postgres;
alter function app.is_private_live_telebirr_historical_attempt_authorized(
  uuid, uuid, text, text
) owner to postgres;
alter function app.is_private_live_telebirr_historical_intent_authorized(uuid)
  owner to postgres;
alter function app.private_live_telebirr_historical_pilot_for_intent(uuid)
  owner to postgres;
alter function app.private_live_telebirr_historical_pilot_for_claim(uuid)
  owner to postgres;

revoke all on function
  app.is_private_live_telebirr_historical_boundary_authorized(uuid),
  app.is_private_live_telebirr_historical_attempt_authorized(uuid, uuid, text, text),
  app.is_private_live_telebirr_historical_intent_authorized(uuid),
  app.private_live_telebirr_historical_pilot_for_intent(uuid),
  app.private_live_telebirr_historical_pilot_for_claim(uuid)
from public, anon, authenticated, service_role,
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_deposit_executor,
     fetanagent_deposit_executor_runtime;

comment on function app.is_private_live_telebirr_historical_boundary_authorized(uuid) is
  'Internal one-use historical boundary. It accepts either the original expired live epoch or one exact naturally expired epoch subsequently stopped by the immutable execution-uncertainty emergency record; it never restores global financial authority.';

comment on function app.arm_private_live_telebirr_historical_completion(
  uuid, uuid, bigint, uuid, text, text
) is
  'Postgres-only one-use arming boundary for the exact expired live TeleBirr staged-evidence incident. A post-expiry emergency stop may be recognized without reactivating its epoch, pilot, switches, or KemerBet execution.';

commit;
