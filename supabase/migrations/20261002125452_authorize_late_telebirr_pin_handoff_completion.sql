-- Reuse the existing historical verifier-only completion channel for the one
-- receipt whose on-time proof was delayed by a device-pin handoff. The ordinary
-- payment deadline and all other historical recovery classes remain unchanged.
begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

do $verify_prerequisites$
begin
  if (select pg_catalog.encode(extensions.digest(r.prosrc, 'sha256'), 'hex')
        from pg_catalog.pg_proc r
       where r.oid = 'app.arm_private_live_telebirr_historical_completion(uuid,uuid,bigint,uuid,text,text)'::pg_catalog.regprocedure)
     is distinct from '573d0d29b2d274cdfbf75cc20aadb4c17d3d62f83bcd773b54c35503339e9520'
    or (select pg_catalog.encode(extensions.digest(r.prosrc, 'sha256'), 'hex')
          from pg_catalog.pg_proc r
         where r.oid = 'app.is_private_live_telebirr_historical_boundary_authorized(uuid)'::pg_catalog.regprocedure)
       is distinct from 'a09e0eeb28229ec61ce19efc3e60bb13d298b06c45ded2b7490bf734bcdec93c'
    or (select pg_catalog.pg_get_constraintdef(c.oid)
          from pg_catalog.pg_constraint c
         where c.conname = 'private_live_telebirr_historical_completion_a_reason_code_check'
           and c.conrelid = 'app.private_live_telebirr_historical_completion_authorities'::pg_catalog.regclass)
       is distinct from
       'CHECK ((reason_code = ANY (ARRAY[''expired_authority_staged_evidence_completion''::text, ''expired_attempt_staged_evidence_completion''::text])))'
    or (select pg_catalog.pg_get_constraintdef(c.oid)
          from pg_catalog.pg_constraint c
         where c.conname = 'private_live_telebirr_historical_completion_window'
           and c.conrelid = 'app.private_live_telebirr_historical_completion_authorities'::pg_catalog.regclass)
       is distinct from
       'CHECK ((((reason_code = ''expired_authority_staged_evidence_completion''::text) AND (expires_at > (authorized_at + ''00:08:00''::interval)) AND (expires_at <= (authorized_at + ''00:20:00''::interval))) OR ((reason_code = ''expired_attempt_staged_evidence_completion''::text) AND (expires_at >= (authorized_at + ''12:00:00''::interval)) AND (expires_at <= (authorized_at + ''12:05:00''::interval)))))'
  then
    raise exception 'The historical TeleBirr completion prerequisite has drifted.';
  end if;
end;
$verify_prerequisites$;

alter table app.private_live_telebirr_historical_completion_authorities
  drop constraint private_live_telebirr_historical_completion_a_reason_code_check;
alter table app.private_live_telebirr_historical_completion_authorities
  add constraint private_live_telebirr_historical_completion_a_reason_code_check check (
    reason_code in (
      'expired_authority_staged_evidence_completion',
      'expired_attempt_staged_evidence_completion',
      'device_pin_handoff_late_completion'
    )
  );
alter table app.private_live_telebirr_historical_completion_authorities
  drop constraint private_live_telebirr_historical_completion_window;
alter table app.private_live_telebirr_historical_completion_authorities
  add constraint private_live_telebirr_historical_completion_window check (
    (
      reason_code in (
        'expired_authority_staged_evidence_completion',
        'device_pin_handoff_late_completion'
      )
      and expires_at > authorized_at + interval '8 minutes'
      and expires_at <= authorized_at + interval '20 minutes'
    ) or (
      reason_code = 'expired_attempt_staged_evidence_completion'
      and expires_at >= authorized_at + interval '12 hours'
      and expires_at <= authorized_at + interval '12 hours 5 minutes'
    )
  );

create function pg_temp.patch_pin_handoff_historical_function(
  p_signature pg_catalog.regprocedure,
  p_markers text[],
  p_replacements text[],
  p_expected_counts integer[]
)
returns void
language plpgsql
set search_path = pg_catalog
as $patch$
declare
  previous record;
  definition text;
  expected_source text;
  marker_index integer;
begin
  if p_signature is null
    or pg_catalog.array_length(p_markers, 1) is distinct from pg_catalog.array_length(p_replacements, 1)
    or pg_catalog.array_length(p_markers, 1) is distinct from pg_catalog.array_length(p_expected_counts, 1)
    or pg_catalog.array_length(p_markers, 1) is null then
    raise exception 'The pin-handoff historical function patch is invalid.';
  end if;
  select r.oid, r.prosrc, r.proowner, r.proacl, r.prosecdef, r.proconfig,
         pg_catalog.pg_get_functiondef(r.oid) as definition
    into previous
    from pg_catalog.pg_proc r
   where r.oid = p_signature;
  if previous.oid is null then
    raise exception 'The pin-handoff historical function target is unavailable.';
  end if;
  definition := previous.definition;
  expected_source := previous.prosrc;
  for marker_index in 1..pg_catalog.array_length(p_markers, 1) loop
    if pg_catalog.length(p_markers[marker_index]) = 0
      or (pg_catalog.length(expected_source) -
          pg_catalog.length(pg_catalog.replace(expected_source, p_markers[marker_index], '')))
         / pg_catalog.length(p_markers[marker_index]) <> p_expected_counts[marker_index] then
      raise exception 'The pin-handoff historical function patch marker is not exact.';
    end if;
    definition := pg_catalog.replace(definition, p_markers[marker_index], p_replacements[marker_index]);
    expected_source := pg_catalog.replace(
      expected_source, p_markers[marker_index], p_replacements[marker_index]
    );
  end loop;
  execute definition;
  if not exists (
    select 1 from pg_catalog.pg_proc r
     where r.oid = previous.oid
       and r.prosrc = expected_source
       and r.proowner = previous.proowner
       and r.proacl is not distinct from previous.proacl
       and r.prosecdef is not distinct from previous.prosecdef
       and r.proconfig is not distinct from previous.proconfig
  ) then
    raise exception 'The pin-handoff historical function patch changed its privilege contract.';
  end if;
end;
$patch$;

select pg_temp.patch_pin_handoff_historical_function(
  'app.is_private_live_telebirr_historical_boundary_authorized(uuid)'::pg_catalog.regprocedure,
  array[
    $marker$authority.reason_code = 'expired_authority_staged_evidence_completion'$marker$,
    $marker$and activation_epoch.expires_at <= pg_catalog.clock_timestamp()$marker$
  ],
  array[
    $replacement$authority.reason_code in (
          'expired_authority_staged_evidence_completion',
          'device_pin_handoff_late_completion'
        )$replacement$,
    $replacement$and (
          authority.reason_code <> 'device_pin_handoff_late_completion'
          or (
            job.recovery_reason_code = 'device_pin_handoff_retry'
            and job.recovered_at is not null
            and app.private_live_telebirr_pin_handoff_evidence_digest(job.id) is not null
          )
        )
        and activation_epoch.expires_at <= pg_catalog.clock_timestamp()$replacement$
  ],
  array[1, 1]
);

select pg_temp.patch_pin_handoff_historical_function(
  'app.arm_private_live_telebirr_historical_completion(uuid,uuid,bigint,uuid,text,text)'::pg_catalog.regprocedure,
  array[
    $marker$or p_reason_code is distinct from
       'expired_authority_staged_evidence_completion' then$marker$,
    $marker$and verification_job.network_retry_reason_code =
         'official_receipt_network_unavailable'
     and verification_job.network_binding_recovery_reason_code =
         'network_retry_reference_binding_registry'$marker$,
    $marker$where candidate.verification_job_id = job.id) <> 2$marker$,
    $marker$or not exists (
      select 1
        from app.private_live_telebirr_source_document_bindings binding$marker$,
    $marker$or exists (
      select 1 from app.private_live_telebirr_settlement_documents settled$marker$
  ],
  array[
    $replacement$or p_reason_code not in (
         'expired_authority_staged_evidence_completion',
         'device_pin_handoff_late_completion'
       ) then$replacement$,
    $replacement$and (
       (
         p_reason_code = 'expired_authority_staged_evidence_completion'
         and verification_job.network_retry_reason_code =
             'official_receipt_network_unavailable'
         and verification_job.network_binding_recovery_reason_code =
             'network_retry_reference_binding_registry'
       ) or (
         p_reason_code = 'device_pin_handoff_late_completion'
         and verification_job.recovery_reason_code = 'device_pin_handoff_retry'
         and verification_job.recovered_at is not null
       )
     )$replacement$,
    $replacement$where candidate.verification_job_id = job.id) <>
           case when p_reason_code = 'device_pin_handoff_late_completion'
                then 4 else 2 end$replacement$,
    $replacement$or (
      p_reason_code = 'expired_authority_staged_evidence_completion'
      and not exists (
      select 1
        from app.private_live_telebirr_source_document_bindings binding$replacement$,
    $replacement$)
    or (
      p_reason_code = 'device_pin_handoff_late_completion'
      and (
        attempt.attempt_number <> 4
        or app.private_live_telebirr_pin_handoff_evidence_digest(job.id) is null
        or (select pg_catalog.count(*)
              from app.private_live_telebirr_verifier_evidence_quarantine quarantine
              join app.private_live_telebirr_verification_attempts candidate
                on candidate.id = quarantine.verification_attempt_id
             where candidate.verification_job_id = job.id
               and candidate.attempt_number in (1, 2)
               and quarantine.reason_code = 'trusted_evidence_invalid') <> 2
        or (select pg_catalog.count(*)
              from app.private_live_telebirr_device_evidence_staging evidence
              join app.private_live_telebirr_verification_attempts candidate
                on candidate.id = evidence.verification_attempt_id
             where candidate.verification_job_id = job.id
               and candidate.attempt_number in (3, 4)
               and evidence.signed_observation -> 'body' ->> 'sourceDocumentDigest' =
                   source_document_digest
               and evidence.observed_at >= candidate.issued_at
               and evidence.observed_at < candidate.expires_at
               and evidence.staged_at < candidate.expires_at
               and not exists (
                 select 1 from app.private_live_telebirr_verifier_evidence_quarantine q
                  where q.verification_attempt_id = candidate.id
               )) <> 2
        or not exists (
          select 1 from app.deposit_policy_versions policy
           where policy.id = job.deposit_policy_version_id
             and policy.version = job.deposit_policy_version
             and proof.submitted_at >=
                 (staged.signed_observation -> 'body' -> 'facts' ->> 'occurredAt')::timestamptz
             and proof.submitted_at <=
                 (staged.signed_observation -> 'body' -> 'facts' ->> 'occurredAt')::timestamptz
                 + pg_catalog.make_interval(secs => policy.freshness_window_seconds)
        )
        or exists (
          select 1 from app.provider_payment_evidence payment_evidence
           where payment_evidence.payment_provider_id = job.payment_provider_id
             and payment_evidence.canonical_reference_fingerprint =
                 job.candidate_reference_fingerprint
        )
        or exists (
          select 1 from app.deposit_jobs execution_job
           where execution_job.status in ('queued', 'leased', 'retry_wait')
        )
        or not exists (
          select 1 from app.agent_platform_companion_execution_control control
           where control.control_state = 'disabled'
        )
      )
    )
    or exists (
      select 1 from app.private_live_telebirr_settlement_documents settled$replacement$
  ],
  array[1, 1, 3, 1, 1]
);

drop function pg_temp.patch_pin_handoff_historical_function(pg_catalog.regprocedure,text[],text[],integer[]);

comment on function app.arm_private_live_telebirr_historical_completion(uuid,uuid,bigint,uuid,text,text) is
  'One-use, verifier-only historical completion. The device-pin variant requires the exact recovered job, two quarantined old observations, two fresh on-time staged observations, an on-time proof, an expired pilot, and no KemerBet execution.';

commit;
