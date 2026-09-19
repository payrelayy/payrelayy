-- Permit the one reviewed source-binding recovery to use evidence that was staged before an
-- independent emergency shutdown. The shutdown remains authoritative: this migration never
-- reactivates the pilot, activation epoch, feature switches, or KemerBet executor. It can only
-- provision the already-reviewed, append-only retry and its bounded verifier-only login.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

-- This predicate deliberately describes only the inert post-emergency boundary. The existing
-- live boundary remains unchanged. Every observation and authority timestamp must predate the
-- exact immutable emergency intent, while all seven money-moving switches remain disabled.
create function app.is_private_live_telebirr_source_binding_post_emergency_ready(
  p_request_key uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(
    pg_catalog.count(*) = 1
    and pg_catalog.bool_and(
      authority.request_key = p_request_key
      and authority.reason_code = 'expired_attempt_staged_evidence_completion'
      and authority.verification_job_id = job.id
      and authority.verification_attempt_id = attempt.id
      and authority.private_live_deposit_pilot_proof_id = proof.id
      and authority.pilot_revision_id = pilot.id
      and authority.receiver_profile_id = job.receiver_profile_id
      and authority.expired_activation_epoch = activation_epoch.epoch
      and authority.observation_body_digest = staged.observation_body_digest
      and authority.source_document_digest =
          staged.signed_observation -> 'body' ->> 'sourceDocumentDigest'
      and authority.authorized_at < emergency_intent.requested_at
      and authority_closure.reason_code = 'operator_stop'
      and authority_closure.closed_at >= authority.authorized_at
      and authority_closure.closed_at <= emergency_intent.requested_at
      and activation_control.current_epoch = activation_epoch.epoch
      and activation_epoch.authority_state = 'active'
      and activation_epoch.pilot_revision_id = pilot.id
      and activation_epoch.configuration_digest = pilot.configuration_digest
      and activation_epoch.revoked_at is not null
      and activation_epoch.revocation_reason_code = 'execution_uncertainty'
      and activation_epoch.revoked_at is not distinct from emergency_intent.requested_at
      and emergency_intent.expected_epoch = activation_epoch.epoch
      and emergency_intent.reason_code = activation_epoch.revocation_reason_code
      and pilot.status = 'stopped'
      and pilot.stopped_at is not distinct from emergency_intent.requested_at
      and pilot.stopped_by_admin_id is not distinct from
          emergency_intent.requested_by_admin_id
      and pilot.stop_reason_code is not distinct from emergency_intent.reason_code
      and job.pilot_revision_id = pilot.id
      and job.pilot_configuration_digest = pilot.configuration_digest
      and proof.pilot_revision_id = pilot.id
      and proof.origin_channel = 'telegram'
      and proof.input_kind = 'direct_transaction_id'
      and proof.submitted_at + interval '24 hours' > pg_catalog.clock_timestamp()
      and attempt.verification_job_id = job.id
      and attempt.issued_at >= pilot.active_from
      and attempt.expires_at <= pilot.expires_at
      and attempt.issued_at >= activation_epoch.active_from
      and attempt.expires_at <= activation_epoch.expires_at
      and attempt.expires_at <= pg_catalog.clock_timestamp()
      and staged.observed_at >= attempt.issued_at
      and staged.observed_at < attempt.expires_at
      and staged.staged_at < attempt.expires_at
      and staged.observed_at < emergency_intent.requested_at
      and staged.staged_at < emergency_intent.requested_at
      and app.current_private_trusted_telebirr_activation_epoch() is null
      and not exists (
        select 1
          from app.private_live_telebirr_historical_completion_consumptions consumption
         where consumption.request_key = authority.request_key
      )
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
    ),
    false
  )
  from app.private_live_telebirr_historical_completion_authorities authority
  join app.private_live_telebirr_verification_jobs job
    on job.id = authority.verification_job_id
  join app.private_live_telebirr_verification_attempts attempt
    on attempt.id = authority.verification_attempt_id
   and attempt.verification_job_id = job.id
  join app.private_live_telebirr_device_evidence_staging staged
    on staged.verification_attempt_id = attempt.id
  join app.private_live_deposit_pilot_proofs proof
    on proof.id = authority.private_live_deposit_pilot_proof_id
  join app.private_live_deposit_pilot_revisions pilot
    on pilot.id = authority.pilot_revision_id
  join app.private_trusted_telebirr_activation_control activation_control
    on activation_control.control_key = 'trusted_telebirr_financial_authority'
  join app.private_trusted_telebirr_activation_epochs activation_epoch
    on activation_epoch.epoch = activation_control.current_epoch
   and activation_epoch.epoch = authority.expired_activation_epoch
  join app.private_trusted_telebirr_emergency_disable_intents emergency_intent
    on emergency_intent.expected_epoch = activation_epoch.epoch
  join app.private_live_telebirr_historical_completion_closures authority_closure
    on authority_closure.request_key = authority.request_key
 where authority.request_key = p_request_key
$$;

-- Apply source-exact patches while preserving routine OIDs, owners, ACLs, SECURITY DEFINER flags,
-- and search paths. Any prerequisite drift fails the migration instead of broadening authority.
create function pg_temp.apply_exact_source_binding_function_patch(
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
    raise exception 'The source-binding function patch contract is invalid.';
  end if;

  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl, routine.prosecdef, routine.proconfig
    into original_definition, original_source, original_owner, original_acl,
         original_security_definer, original_config
    from pg_catalog.pg_proc routine
   where routine.oid = p_signature;

  if original_definition is null then
    raise exception 'A source-binding patch target is unavailable.';
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
      raise exception 'Source-binding patch marker % matched % instead of %.',
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
    raise exception 'A source-binding patch changed function authority.';
  end if;
end;
$$;

select pg_temp.apply_exact_source_binding_function_patch(
  'app.is_private_live_telebirr_historical_boundary_authorized(uuid)'::regprocedure,
  array[
    $marker$      (
        authority.reason_code = 'expired_attempt_staged_evidence_completion'
        and activation_epoch.revoked_at is null
        and emergency_intent.request_key is null
        and coalesce(retry.authorized_at, authority.authorized_at) >= pilot.active_from
        and coalesce(retry.authorized_at, authority.authorized_at) < pilot.expires_at
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
      )$marker$
  ],
  array[
    $replacement$      (
        authority.reason_code = 'expired_attempt_staged_evidence_completion'
        and (
          (
            activation_epoch.revoked_at is null
            and emergency_intent.request_key is null
            and coalesce(retry.authorized_at, authority.authorized_at) >= pilot.active_from
            and coalesce(retry.authorized_at, authority.authorized_at) < pilot.expires_at
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
            retry.retry_request_key is not null
            and app.is_private_live_telebirr_source_binding_post_emergency_ready(
              authority.request_key
            )
          )
        )
      )$replacement$
  ],
  array[1]
);

select pg_temp.apply_exact_source_binding_function_patch(
  'app.arm_private_live_telebirr_source_binding_recovery(uuid,uuid,bigint,uuid,text,text)'::regprocedure,
  array[
    $marker$  existing_retry app.private_live_telebirr_source_binding_recovery_retries%rowtype;
  exact_source_document_digest text;$marker$,
    $marker$  armed_at := pg_catalog.clock_timestamp();
  armed_until := armed_at + interval '12 hours';

  select retry.*$marker$,
    $marker$  if activation.epoch is null
    or activation.authority_state <> 'active'
    or activation.revoked_at is not null
    or activation.expires_at <= armed_at
    or pilot.id is null or pilot.status <> 'armed'
    or armed_at < pilot.active_from or armed_at >= pilot.expires_at$marker$,
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
    $replacement$  existing_retry app.private_live_telebirr_source_binding_recovery_retries%rowtype;
  post_emergency_authority boolean;
  exact_source_document_digest text;$replacement$,
    $replacement$  armed_at := pg_catalog.clock_timestamp();
  armed_until := armed_at + interval '12 hours';
  post_emergency_authority :=
    app.is_private_live_telebirr_source_binding_post_emergency_ready(
      authority.request_key
    );

  select retry.*$replacement$,
    $replacement$  if activation.epoch is null
    or activation.authority_state <> 'active'
    or (activation.revoked_at is not null and not post_emergency_authority)
    or (activation.expires_at <= armed_at and not post_emergency_authority)
    or pilot.id is null
    or (pilot.status <> 'armed' and not post_emergency_authority)
    or (
      (armed_at < pilot.active_from or armed_at >= pilot.expires_at)
      and not post_emergency_authority
    )$replacement$,
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
  array[1, 1, 1, 1]
);

revoke all on function
  app.is_private_live_telebirr_source_binding_post_emergency_ready(uuid)
  from public;

comment on function
  app.is_private_live_telebirr_source_binding_post_emergency_ready(uuid) is
  'Recognizes only the exact all-disabled emergency lineage for one reviewed source-binding retry; it grants no financial execution authority.';

comment on function app.arm_private_live_telebirr_source_binding_recovery(
  uuid, uuid, bigint, uuid, text, text
) is
  'Appends one reviewed 12-hour verifier-only source-binding retry under either the original live boundary or the exact all-disabled post-emergency boundary; it never restores financial execution.';

commit;
