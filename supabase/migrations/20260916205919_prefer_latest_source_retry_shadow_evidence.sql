-- A source-unavailable retry proof can accumulate several immutable, short-lived phone
-- observations while its twelve-hour no-money review window remains open. Preserve every signed
-- observation, but let the bounded shadow verifier review only the newest still-eligible one for
-- this exact retry branch. Original, direct, and other recovery proofs keep FIFO behavior. This
-- migration grants no payment, credit, settlement, execution, or money-movement authority.

begin;

do $migration$
declare
  loader_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.load_next_private_telebirr_shadow_staged_evidence()'
  );
  expected_source_sha256 constant text :=
    'a7568566480a3b45a1a172bfa44e034896de099fde2490b3ddc6f1c5bf11469f';
  old_fragment constant text :=
    '   order by staged.staged_at, staged.observation_body_digest';
  new_fragment constant text :=
    '     and (' || pg_catalog.chr(10)
    || '       proof.source_unavailable_retry_source_id is null' || pg_catalog.chr(10)
    || '       or not exists (' || pg_catalog.chr(10)
    || '         select 1' || pg_catalog.chr(10)
    || '           from app.private_telebirr_shadow_device_evidence_staging newer_staged'
    || pg_catalog.chr(10)
    || '           join app.private_telebirr_shadow_verification_attempts newer_attempt'
    || pg_catalog.chr(10)
    || '             on newer_attempt.id = newer_staged.verification_attempt_id'
    || pg_catalog.chr(10)
    || '          where newer_attempt.shadow_proof_request_id = proof.id'
    || pg_catalog.chr(10)
    || '            and newer_attempt.verification_job_id = proof.verification_job_id'
    || pg_catalog.chr(10)
    || '            and (newer_staged.staged_at, newer_staged.observation_body_digest)'
    || pg_catalog.chr(10)
    || '                > (staged.staged_at, staged.observation_body_digest)'
    || pg_catalog.chr(10)
    || '            and newer_staged.staged_at < proof.expires_at'
    || pg_catalog.chr(10)
    || '            and newer_staged.staged_at < newer_attempt.expires_at'
    || pg_catalog.chr(10)
    || '            and newer_staged.observed_at >= newer_attempt.issued_at'
    || pg_catalog.chr(10)
    || '            and newer_staged.observed_at < newer_attempt.expires_at'
    || pg_catalog.chr(10)
    || '            and exists (' || pg_catalog.chr(10)
    || '              select 1' || pg_catalog.chr(10)
    || '                from app.private_live_telebirr_device_enrollments newer_enrollment'
    || pg_catalog.chr(10)
    || '               where newer_enrollment.id = newer_attempt.device_enrollment_id'
    || pg_catalog.chr(10)
    || '                 and captured_at >= newer_enrollment.valid_from'
    || pg_catalog.chr(10)
    || '                 and captured_at < newer_enrollment.valid_until'
    || pg_catalog.chr(10)
    || '                 and not exists (' || pg_catalog.chr(10)
    || '                   select 1' || pg_catalog.chr(10)
    || '                     from app.private_live_telebirr_device_revocations newer_revocation'
    || pg_catalog.chr(10)
    || '                    where newer_revocation.device_enrollment_id = newer_enrollment.id'
    || pg_catalog.chr(10)
    || '                      and newer_revocation.revoked_at <= captured_at'
    || pg_catalog.chr(10)
    || '                 )' || pg_catalog.chr(10)
    || '            )' || pg_catalog.chr(10)
    || '            and exists (' || pg_catalog.chr(10)
    || '              select 1' || pg_catalog.chr(10)
    || '                from app.private_telebirr_shadow_assignment_transcripts newer_transcript'
    || pg_catalog.chr(10)
    || '                join app.private_live_telebirr_assignment_signers newer_signer'
    || pg_catalog.chr(10)
    || '                  on newer_signer.id = newer_transcript.assignment_signer_id'
    || pg_catalog.chr(10)
    || '               where newer_transcript.verification_attempt_id = newer_attempt.id'
    || pg_catalog.chr(10)
    || '                 and captured_at >= newer_signer.valid_from'
    || pg_catalog.chr(10)
    || '                 and captured_at < newer_signer.valid_until'
    || pg_catalog.chr(10)
    || '                 and not exists (' || pg_catalog.chr(10)
    || '                   select 1' || pg_catalog.chr(10)
    || '                     from app.private_live_telebirr_assignment_signer_revocations newer_revocation'
    || pg_catalog.chr(10)
    || '                    where newer_revocation.assignment_signer_id = newer_signer.id'
    || pg_catalog.chr(10)
    || '                      and newer_revocation.revoked_at <= captured_at'
    || pg_catalog.chr(10)
    || '                 )' || pg_catalog.chr(10)
    || '            )' || pg_catalog.chr(10)
    || '            and not exists (' || pg_catalog.chr(10)
    || '              select 1'
    || '                from app.private_telebirr_shadow_verification_outcomes newer_outcome'
    || pg_catalog.chr(10)
    || '               where newer_outcome.verification_attempt_id = newer_attempt.id'
    || pg_catalog.chr(10)
    || '                  or newer_outcome.completion_request_key = newer_attempt.lease_request_key'
    || pg_catalog.chr(10)
    || '                  or newer_outcome.shadow_proof_request_id = proof.id'
    || pg_catalog.chr(10)
    || '            )' || pg_catalog.chr(10)
    || '            and not exists (' || pg_catalog.chr(10)
    || '              select 1'
    || '                from app.private_telebirr_shadow_evidence_quarantine newer_quarantine'
    || pg_catalog.chr(10)
    || '               where newer_quarantine.verification_attempt_id = newer_attempt.id'
    || pg_catalog.chr(10)
    || '                  or newer_quarantine.observation_body_digest ='
    || ' newer_staged.observation_body_digest' || pg_catalog.chr(10)
    || '            )' || pg_catalog.chr(10)
    || '       )' || pg_catalog.chr(10)
    || '     )' || pg_catalog.chr(10)
    || old_fragment;
  original_definition text;
  original_source text;
  corrected_definition text;
  corrected_source text;
  original_owner oid;
  original_acl aclitem[];
  original_source_sha256 text;
  marker_count integer;
begin
  if loader_signature is null then
    raise exception 'The TeleBirr shadow staged-evidence loader is unavailable.';
  end if;

  select routine.prosrc,
         routine.proowner,
         routine.proacl,
         pg_catalog.pg_get_functiondef(routine.oid),
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into original_source,
         original_owner,
         original_acl,
         original_definition,
         original_source_sha256
    from pg_catalog.pg_proc routine
   where routine.oid = loader_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     );

  if original_definition is null or original_source is null then
    raise exception 'The TeleBirr shadow staged-evidence loader boundary is unavailable.';
  end if;

  marker_count := (
    pg_catalog.length(original_source)
      - pg_catalog.length(
          pg_catalog.replace(
            original_source,
            'proof.source_unavailable_retry_source_id is null',
            ''
          )
        )
  ) / pg_catalog.length('proof.source_unavailable_retry_source_id is null');

  if original_source_sha256 <> expected_source_sha256 or marker_count <> 0 then
    raise exception 'The TeleBirr shadow staged-evidence loader does not match the reviewed source.';
  end if;

  if (
    pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, old_fragment, ''))
  ) / pg_catalog.length(old_fragment) <> 1
    or (
      pg_catalog.length(original_source)
        - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, ''))
    ) / pg_catalog.length(old_fragment) <> 1 then
    raise exception 'The TeleBirr shadow staged-evidence loader order is not reviewed.';
  end if;

  corrected_definition := pg_catalog.replace(original_definition, old_fragment, new_fragment);
  corrected_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute corrected_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = loader_signature
       and routine.prosrc = corrected_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.prokind = 'f'
       and routine.prosecdef
       and routine.proretset
       and routine.pronargs = 0
       and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The TeleBirr shadow staged-evidence loader repair changed its authority.';
  end if;
end;
$migration$;

comment on function app.load_next_private_telebirr_shadow_staged_evidence() is
  'Loads FIFO evidence for ordinary no-money proofs and only the newest still-eligible immutable observation for a source-unavailable retry proof, with every proof, device, signer, quarantine, and terminal-outcome gate preserved.';

commit;
