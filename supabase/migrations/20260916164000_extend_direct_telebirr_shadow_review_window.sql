-- Direct Telegram TeleBirr shadow requests previously had only five minutes from intake through
-- phone pickup, receipt retrieval, upload, and the separately bounded verifier review. Keep the
-- short signed assignment lease, but give the no-money proof and already-staged immutable evidence
-- up to twelve hours (still bounded by the pilot, receiver profile, device, and signer lifetimes).
-- This migration grants no payment, credit, settlement, execution, or money-movement authority.

begin;

do $migration$
declare
  definition text;
  old_fragment constant text :=
    '(expires_at <= (submitted_at + ''00:05:00''::interval))';
  new_fragment constant text :=
    '(expires_at <= (submitted_at + ''12:00:00''::interval))';
  old_count integer;
  new_count integer;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into definition
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'app.private_telebirr_shadow_proof_requests'::regclass
     and constraint_row.conname = 'private_telebirr_shadow_proof_window_check';

  if definition is null then
    raise exception 'The TeleBirr shadow proof window constraint is unavailable.';
  end if;

  old_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, old_fragment, ''))
  ) / pg_catalog.length(old_fragment);
  new_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, new_fragment, ''))
  ) / pg_catalog.length(new_fragment);

  if old_count = 1 and new_count = 0 then
    definition := pg_catalog.replace(definition, old_fragment, new_fragment);
    execute 'alter table app.private_telebirr_shadow_proof_requests '
         || 'drop constraint private_telebirr_shadow_proof_window_check';
    execute 'alter table app.private_telebirr_shadow_proof_requests '
         || 'add constraint private_telebirr_shadow_proof_window_check ' || definition;
  elsif old_count = 0 and new_count = 1 then
    null;
  else
    raise exception 'The direct TeleBirr shadow proof window constraint is not reviewed.';
  end if;
end;
$migration$;

do $migration$
declare
  definition text;
  old_fragment constant text := 'captured_at + interval ''5 minutes''';
  new_fragment constant text := 'captured_at + interval ''12 hours''';
  old_count integer;
  new_count integer;
begin
  select pg_catalog.pg_get_functiondef(
           'app.capture_telegram_telebirr_shadow_proof(uuid,text,text,text,text,text,smallint,smallint,text)'::regprocedure
         )
    into definition;

  old_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, old_fragment, ''))
  ) / pg_catalog.length(old_fragment);
  new_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, new_fragment, ''))
  ) / pg_catalog.length(new_fragment);

  if old_count = 1 and new_count = 0 then
    definition := pg_catalog.replace(definition, old_fragment, new_fragment);
    execute definition;
  elsif old_count = 0 and new_count = 1 then
    null;
  else
    raise exception 'The Telegram TeleBirr shadow capture window is not reviewed.';
  end if;
end;
$migration$;

do $migration$
declare
  definition text;
  old_fragment constant text :=
    'authority_at >= attempt.expires_at' || pg_catalog.chr(10)
    || '    or authority_at >= proof.expires_at';
  new_fragment constant text :=
    'staged.staged_at >= proof.expires_at' || pg_catalog.chr(10)
    || '    or staged.staged_at >= attempt.expires_at' || pg_catalog.chr(10)
    || '    or staged.observed_at < attempt.issued_at' || pg_catalog.chr(10)
    || '    or staged.observed_at >= attempt.expires_at' || pg_catalog.chr(10)
    || '    or authority_at >= proof.submitted_at + interval ''12 hours''' || pg_catalog.chr(10)
    || '    or authority_at < profile.valid_from' || pg_catalog.chr(10)
    || '    or authority_at >= profile.valid_until' || pg_catalog.chr(10)
    || '    or authority_at < enrollment.valid_from' || pg_catalog.chr(10)
    || '    or authority_at >= enrollment.valid_until' || pg_catalog.chr(10)
    || '    or authority_at < signer.valid_from' || pg_catalog.chr(10)
    || '    or authority_at >= signer.valid_until';
  old_count integer;
  new_count integer;
begin
  select pg_catalog.pg_get_functiondef(
           'app.complete_private_telebirr_shadow_verification(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,text,text,timestamptz,text,text,text,timestamptz,bigint,timestamptz,text)'::regprocedure
         )
    into definition;

  old_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, old_fragment, ''))
  ) / pg_catalog.length(old_fragment);
  new_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, new_fragment, ''))
  ) / pg_catalog.length(new_fragment);

  if old_count = 2 and new_count = 0 then
    definition := pg_catalog.replace(definition, old_fragment, new_fragment);
    execute definition;
  elsif old_count = 0 and new_count = 2 then
    null;
  else
    raise exception 'The TeleBirr shadow completion deadline guards are not reviewed.';
  end if;
end;
$migration$;

do $migration$
declare
  definition text;
  old_fragment constant text :=
    'and captured_at < proof.expires_at' || pg_catalog.chr(10)
    || '     and captured_at < attempt.expires_at' || pg_catalog.chr(10)
    || '     and staged.observed_at >= attempt.issued_at' || pg_catalog.chr(10)
    || '     and staged.observed_at < attempt.expires_at';
  new_fragment constant text :=
    'and captured_at < proof.submitted_at + interval ''12 hours''' || pg_catalog.chr(10)
    || '     and staged.staged_at < proof.expires_at' || pg_catalog.chr(10)
    || '     and staged.staged_at < attempt.expires_at' || pg_catalog.chr(10)
    || '     and staged.observed_at >= attempt.issued_at' || pg_catalog.chr(10)
    || '     and staged.observed_at < attempt.expires_at' || pg_catalog.chr(10)
    || '     and exists (' || pg_catalog.chr(10)
    || '       select 1' || pg_catalog.chr(10)
    || '         from app.private_live_telebirr_receiver_profiles profile' || pg_catalog.chr(10)
    || '        where profile.id = proof.receiver_profile_id' || pg_catalog.chr(10)
    || '          and captured_at >= profile.valid_from' || pg_catalog.chr(10)
    || '          and captured_at < profile.valid_until' || pg_catalog.chr(10)
    || '     )' || pg_catalog.chr(10)
    || '     and exists (' || pg_catalog.chr(10)
    || '       select 1' || pg_catalog.chr(10)
    || '         from app.private_live_telebirr_device_enrollments enrollment' || pg_catalog.chr(10)
    || '        where enrollment.id = attempt.device_enrollment_id' || pg_catalog.chr(10)
    || '          and captured_at >= enrollment.valid_from' || pg_catalog.chr(10)
    || '          and captured_at < enrollment.valid_until' || pg_catalog.chr(10)
    || '          and not exists (' || pg_catalog.chr(10)
    || '            select 1' || pg_catalog.chr(10)
    || '              from app.private_live_telebirr_device_revocations revocation' || pg_catalog.chr(10)
    || '             where revocation.device_enrollment_id = enrollment.id' || pg_catalog.chr(10)
    || '               and revocation.revoked_at <= captured_at' || pg_catalog.chr(10)
    || '          )' || pg_catalog.chr(10)
    || '     )' || pg_catalog.chr(10)
    || '     and exists (' || pg_catalog.chr(10)
    || '       select 1' || pg_catalog.chr(10)
    || '         from app.private_telebirr_shadow_assignment_transcripts transcript' || pg_catalog.chr(10)
    || '         join app.private_live_telebirr_assignment_signers signer' || pg_catalog.chr(10)
    || '           on signer.id = transcript.assignment_signer_id' || pg_catalog.chr(10)
    || '        where transcript.verification_attempt_id = attempt.id' || pg_catalog.chr(10)
    || '          and captured_at >= signer.valid_from' || pg_catalog.chr(10)
    || '          and captured_at < signer.valid_until' || pg_catalog.chr(10)
    || '          and not exists (' || pg_catalog.chr(10)
    || '            select 1' || pg_catalog.chr(10)
    || '              from app.private_live_telebirr_assignment_signer_revocations revocation' || pg_catalog.chr(10)
    || '             where revocation.assignment_signer_id = signer.id' || pg_catalog.chr(10)
    || '               and revocation.revoked_at <= captured_at' || pg_catalog.chr(10)
    || '          )' || pg_catalog.chr(10)
    || '     )';
  old_count integer;
  new_count integer;
begin
  select pg_catalog.pg_get_functiondef(
           'app.load_next_private_telebirr_shadow_staged_evidence()'::regprocedure
         )
    into definition;

  old_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, old_fragment, ''))
  ) / pg_catalog.length(old_fragment);
  new_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, new_fragment, ''))
  ) / pg_catalog.length(new_fragment);

  if old_count = 1 and new_count = 0 then
    definition := pg_catalog.replace(definition, old_fragment, new_fragment);
    execute definition;
  elsif old_count = 0 and new_count = 1 then
    null;
  else
    raise exception 'The TeleBirr shadow staged-evidence deadline guards are not reviewed.';
  end if;
end;
$migration$;

comment on constraint private_telebirr_shadow_proof_window_check
  on app.private_telebirr_shadow_proof_requests is
  'Direct no-money Telegram TeleBirr proofs may remain open for at most twelve hours. Recovery and retry branches retain their separately reviewed structural caps.';

comment on function app.capture_telegram_telebirr_shadow_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) is
  'Captures one immutable direct Telegram TeleBirr shadow proof for up to twelve hours, bounded by the armed dry-run pilot and receiver profile. It grants no credit, settlement, execution, or money authority.';

comment on function app.load_next_private_telebirr_shadow_staged_evidence() is
  'Loads one immutable observation staged inside its original signed assignment window for bounded review within twelve hours of proof submission, while pilot, receiver, device, signer, and revocation gates remain valid.';

comment on function app.complete_private_telebirr_shadow_verification(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) is
  'Records one advisory no-money outcome for immutable evidence staged inside its original signed assignment window and reviewed within twelve hours while every current safety gate remains valid.';

commit;
