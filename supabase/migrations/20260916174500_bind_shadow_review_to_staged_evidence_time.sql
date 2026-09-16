-- A direct TeleBirr shadow proof can be reviewed for up to twelve hours, but its signed assignment
-- remains deliberately short-lived. Bind protocol authentication to the immutable server staging
-- time while retaining current-time pilot, profile, device, signer, revocation, and policy gates.
-- This migration grants no payment, credit, settlement, execution, or money-movement authority.

begin;

do $migration$
declare
  definition text;
  fragment text;
  replacement text;
  occurrence_count integer;
begin
  select pg_catalog.pg_get_functiondef(
           'app.load_private_telebirr_shadow_verification_authority(uuid,uuid,timestamp with time zone)'::regprocedure
         )
    into definition;

  fragment :=
    '  existing_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;';
  replacement := fragment || pg_catalog.chr(10)
    || '  staged app.private_telebirr_shadow_device_evidence_staging%rowtype;';
  occurrence_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, fragment, ''))
  ) / pg_catalog.length(fragment);
  if occurrence_count <> 1 then
    raise exception 'The TeleBirr shadow authority staging declaration is not reviewed.';
  end if;
  definition := pg_catalog.replace(definition, fragment, replacement);

  fragment :=
    '  select candidate.* into signer' || pg_catalog.chr(10)
    || '    from app.private_live_telebirr_assignment_signers candidate' || pg_catalog.chr(10)
    || '   where candidate.id = transcript.assignment_signer_id;';
  replacement :=
    '  select candidate.* into staged' || pg_catalog.chr(10)
    || '    from app.private_telebirr_shadow_device_evidence_staging candidate' || pg_catalog.chr(10)
    || '   where candidate.verification_attempt_id = attempt.id' || pg_catalog.chr(10)
    || '     and candidate.assignment_transcript_id = transcript.id' || pg_catalog.chr(10)
    || '     and candidate.device_enrollment_id = enrollment.id;' || pg_catalog.chr(10)
    || fragment;
  occurrence_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, fragment, ''))
  ) / pg_catalog.length(fragment);
  if occurrence_count <> 1 then
    raise exception 'The TeleBirr shadow authority staging read is not reviewed.';
  end if;
  definition := pg_catalog.replace(definition, fragment, replacement);

  fragment :=
    '    or transcript.id is null' || pg_catalog.chr(10)
    || '    or signer.id is null';
  replacement :=
    '    or transcript.id is null' || pg_catalog.chr(10)
    || '    or staged.observation_body_digest is null' || pg_catalog.chr(10)
    || '    or signer.id is null';
  occurrence_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, fragment, ''))
  ) / pg_catalog.length(fragment);
  if occurrence_count <> 1 then
    raise exception 'The TeleBirr shadow authority staging presence gate is not reviewed.';
  end if;
  definition := pg_catalog.replace(definition, fragment, replacement);

  fragment :=
    '  shadow_ready := app.private_telebirr_shadow_mode_is_ready(pilot.id)' || pg_catalog.chr(10)
    || '    and captured_at >= proof.not_before' || pg_catalog.chr(10)
    || '    and captured_at < proof.expires_at' || pg_catalog.chr(10)
    || '    and captured_at < attempt.expires_at' || pg_catalog.chr(10)
    || '    and provider_member.provider_code_snapshot = ''telebirr''';
  replacement :=
    '  shadow_ready := app.private_telebirr_shadow_mode_is_ready(pilot.id)' || pg_catalog.chr(10)
    || '    and captured_at >= proof.not_before' || pg_catalog.chr(10)
    || '    and captured_at < proof.submitted_at + interval ''12 hours''' || pg_catalog.chr(10)
    || '    and staged.staged_at < proof.expires_at' || pg_catalog.chr(10)
    || '    and staged.staged_at < attempt.expires_at' || pg_catalog.chr(10)
    || '    and staged.observed_at >= attempt.issued_at' || pg_catalog.chr(10)
    || '    and staged.observed_at < attempt.expires_at' || pg_catalog.chr(10)
    || '    and captured_at >= profile.valid_from' || pg_catalog.chr(10)
    || '    and captured_at < profile.valid_until' || pg_catalog.chr(10)
    || '    and captured_at >= enrollment.valid_from' || pg_catalog.chr(10)
    || '    and captured_at < enrollment.valid_until' || pg_catalog.chr(10)
    || '    and captured_at >= signer.valid_from' || pg_catalog.chr(10)
    || '    and captured_at < signer.valid_until' || pg_catalog.chr(10)
    || '    and provider_member.provider_code_snapshot = ''telebirr''';
  occurrence_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, fragment, ''))
  ) / pg_catalog.length(fragment);
  if occurrence_count <> 1 then
    raise exception 'The TeleBirr shadow authority review window is not reviewed.';
  end if;
  definition := pg_catalog.replace(definition, fragment, replacement);

  fragment := '    ''transcript'', pg_catalog.to_jsonb(transcript),';
  replacement := fragment || pg_catalog.chr(10)
    || '    ''stagedEvidence'', pg_catalog.to_jsonb(staged),';
  occurrence_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, fragment, ''))
  ) / pg_catalog.length(fragment);
  if occurrence_count <> 1 then
    raise exception 'The TeleBirr shadow authority state digest staging input is not reviewed.';
  end if;
  definition := pg_catalog.replace(definition, fragment, replacement);

  fragment := '    ''capturedAt'', pg_catalog.to_jsonb(captured_at),';
  replacement := fragment || pg_catalog.chr(10)
    || '    ''evidenceStagedAt'', pg_catalog.to_jsonb(staged.staged_at),';
  occurrence_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, fragment, ''))
  ) / pg_catalog.length(fragment);
  if occurrence_count <> 1 then
    raise exception 'The TeleBirr shadow authority staging timestamp output is not reviewed.';
  end if;
  definition := pg_catalog.replace(definition, fragment, replacement);

  execute definition;
end;
$migration$;

comment on function app.load_private_telebirr_shadow_verification_authority(
  uuid, uuid, timestamptz
) is
  'Loads current no-money shadow authority while separately binding cryptographic protocol assessment to immutable evidence staged inside the original signed assignment window.';

commit;
