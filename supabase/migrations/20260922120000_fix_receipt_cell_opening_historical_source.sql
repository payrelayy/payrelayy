-- Let the reviewed receipt-cell-opening parser retry consume an immutable historical
-- receipt-cell-binding source while binding the new no-money attempt to one fresh,
-- semantically identical dry-run pilot. This removes the accidental dependency on the
-- historical pilot still being live without weakening the current target boundary.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke all on functions from public, anon, authenticated, service_role;

do $historical_receipt_cell_opening_preflight$
begin
  if pg_catalog.to_regclass(
       'app.private_telebirr_shadow_receipt_cell_binding_retries'
     ) is null
    or pg_catalog.to_regclass(
         'app.private_telebirr_shadow_receipt_cell_opening_retries'
       ) is null
    or pg_catalog.to_regprocedure(
         'app.private_telebirr_shadow_receipt_cell_binding_retry_digest(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,text,integer,text,integer,integer,timestamp with time zone,timestamp with time zone,text,text)'
       ) is null
    or pg_catalog.to_regprocedure(
         'app.private_live_telebirr_shadow_pilot_contract_matches(uuid,uuid)'
       ) is null
    or pg_catalog.to_regprocedure(
         'app.private_live_telebirr_shadow_profile_contract_matches(uuid,uuid)'
       ) is null
    or pg_catalog.to_regprocedure(
         'app.private_tbirr_cell_binding_retry_history_is_valid(uuid,uuid)'
       ) is not null then
    raise exception 'The historical receipt-cell-opening prerequisites do not match.';
  end if;
end;
$historical_receipt_cell_opening_preflight$;

create function app.private_tbirr_cell_binding_retry_history_is_valid(
  p_replacement_shadow_proof_request_id uuid,
  p_retry_request_key uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  retry app.private_telebirr_shadow_receipt_cell_binding_retries%rowtype;
  source_alias app.private_telebirr_shadow_receipt_alias_retries%rowtype;
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  source_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
  replacement app.private_telebirr_shadow_proof_requests%rowtype;
  source_pilot app.private_live_deposit_pilot_revisions%rowtype;
  source_profile app.private_live_telebirr_receiver_profiles%rowtype;
  expected_digest text;
  attempt_count integer;
  staged_count integer;
  receipt_cell_binding_review_count integer;
  outcome_count integer;
begin
  if p_replacement_shadow_proof_request_id is null or p_retry_request_key is null then
    return false;
  end if;

  select candidate.* into retry
    from app.private_telebirr_shadow_receipt_cell_binding_retries candidate
   where candidate.retry_request_key = p_retry_request_key
     and candidate.replacement_shadow_proof_request_id =
         p_replacement_shadow_proof_request_id;
  select candidate.* into source_alias
    from app.private_telebirr_shadow_receipt_alias_retries candidate
   where candidate.retry_request_key = retry.source_alias_retry_request_key;
  select proof.* into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = retry.source_shadow_proof_request_id
     and proof.verification_job_id = retry.source_shadow_verification_job_id;
  select outcome.* into source_outcome
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.id = retry.source_shadow_outcome_id
     and outcome.shadow_proof_request_id = source_proof.id;
  select proof.* into replacement
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = retry.replacement_shadow_proof_request_id
     and proof.verification_job_id = retry.replacement_shadow_verification_job_id;
  select pilot.* into source_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = retry.pilot_revision_id;
  select profile.* into source_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.id = retry.receiver_profile_id;

  select pg_catalog.count(*)::integer into attempt_count
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.shadow_proof_request_id = source_proof.id;
  select pg_catalog.count(*)::integer into staged_count
    from app.private_telebirr_shadow_device_evidence_staging staged
    join app.private_telebirr_shadow_verification_attempts attempt
      on attempt.id = staged.verification_attempt_id
   where attempt.shadow_proof_request_id = source_proof.id;
  select pg_catalog.count(*)::integer into receipt_cell_binding_review_count
    from app.private_telebirr_shadow_device_evidence_staging staged
    join app.private_telebirr_shadow_verification_attempts attempt
      on attempt.id = staged.verification_attempt_id
   where attempt.shadow_proof_request_id = source_proof.id
     and staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason' =
         'unknown_layout_invoice_number';
  select pg_catalog.count(*)::integer into outcome_count
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.shadow_proof_request_id = source_proof.id;

  expected_digest := app.private_telebirr_shadow_receipt_cell_binding_retry_digest(
    retry.retry_request_key,
    retry.source_alias_retry_request_key,
    retry.source_alias_retry_request_digest,
    retry.source_shadow_proof_request_id,
    retry.source_shadow_verification_job_id,
    retry.source_shadow_outcome_id,
    retry.replacement_shadow_proof_request_id,
    retry.replacement_shadow_verification_job_id,
    retry.pilot_revision_id,
    retry.receiver_profile_id,
    retry.device_enrollment_id,
    retry.assignment_signer_id,
    retry.source_attempt_count,
    retry.source_attempt_history_digest,
    retry.source_staged_evidence_count,
    retry.source_evidence_history_digest,
    retry.source_receipt_cell_binding_review_count,
    retry.source_outcome_count,
    retry.authorized_at,
    retry.retry_expires_at,
    retry.reviewed_main_commit_sha,
    retry.reason_code
  );

  return retry.retry_request_key is not null
    and retry.retry_request_digest = expected_digest
    and retry.source_alias_retry_request_digest = source_alias.retry_request_digest
    and source_alias.reason_code = 'reviewed_receipt_alias_retry_no_credit'
    and source_alias.replacement_shadow_proof_request_id = source_proof.id
    and source_alias.replacement_shadow_verification_job_id =
        source_proof.verification_job_id
    and source_proof.proof_status = 'verification_queued'
    and source_outcome.id is not null
    and source_outcome.verification_job_id = source_proof.verification_job_id
    and source_outcome.protocol_disposition = 'would_review'
    and source_outcome.protocol_reason_code = 'receipt_requires_review'
    and source_outcome.disposition = 'review_required'
    and source_outcome.reason_code = 'parser_uncertain'
    and source_outcome.principal_amount_minor is null
    and source_outcome.occurred_at is null
    and source_outcome.receiver_identity_digest is null
    and exists (
      select 1
        from app.private_telebirr_shadow_device_evidence_staging staged
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = staged.verification_attempt_id
       where attempt.shadow_proof_request_id = source_proof.id
         and staged.observation_body_digest = source_outcome.observation_body_digest
         and staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason' =
             'unknown_layout_invoice_number'
    )
    and attempt_count = retry.source_attempt_count
    and app.private_telebirr_shadow_retry_attempt_history_digest(source_proof.id) =
        retry.source_attempt_history_digest
    and staged_count = retry.source_staged_evidence_count
    and app.private_telebirr_shadow_layout_evidence_history_digest(source_proof.id) =
        retry.source_evidence_history_digest
    and receipt_cell_binding_review_count =
        retry.source_receipt_cell_binding_review_count
    and outcome_count = retry.source_outcome_count
    and source_pilot.id = source_proof.pilot_revision_id
    and source_pilot.id = source_alias.pilot_revision_id
    and source_profile.id = source_proof.receiver_profile_id
    and source_profile.id = source_alias.receiver_profile_id
    and replacement.id = retry.replacement_shadow_proof_request_id
    and replacement.verification_job_id = retry.replacement_shadow_verification_job_id
    and replacement.source_binding_layout_retry_source_id = source_proof.id
    and replacement.pilot_revision_id = source_pilot.id
    and replacement.receiver_profile_id = source_profile.id
    and replacement.submitting_customer_id = source_proof.submitting_customer_id
    and replacement.player_account_id = source_proof.player_account_id
    and replacement.payment_provider_id = source_proof.payment_provider_id
    and replacement.provider_code = source_proof.provider_code
    and replacement.pilot_configuration_digest = source_pilot.configuration_digest
    and replacement.origin_channel = source_proof.origin_channel
    and replacement.input_kind = source_proof.input_kind
    and replacement.candidate_reference_ciphertext =
        source_proof.candidate_reference_ciphertext
    and replacement.candidate_reference_fingerprint =
        source_proof.candidate_reference_fingerprint
    and replacement.candidate_reference_masked = source_proof.candidate_reference_masked
    and replacement.reference_encryption_key_version =
        source_proof.reference_encryption_key_version
    and replacement.reference_profile_version = source_proof.reference_profile_version
    and replacement.proof_status = 'verification_queued'
    and replacement.submitted_at = source_proof.submitted_at
    and replacement.not_before = source_proof.not_before
    and replacement.created_at = retry.authorized_at
    and replacement.expires_at = retry.retry_expires_at
    and retry.retry_expires_at = retry.authorized_at + interval '12 hours'
    and retry.reason_code = 'reviewed_receipt_cell_binding_retry_no_credit'
    and source_pilot.expires_at = source_pilot.active_from + interval '12 hours'
    and source_pilot.active_from <= retry.authorized_at
    and source_pilot.expires_at > retry.authorized_at
    and source_profile.pilot_revision_id = source_pilot.id
    and source_profile.valid_from <= retry.authorized_at
    and source_profile.valid_until > retry.authorized_at + interval '5 minutes';
exception
  when others then
    return false;
end;
$$;

do $rewrite_receipt_cell_opening_child_validator$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.private_telebirr_shadow_receipt_cell_opening_retry_child_is_valid(app.private_telebirr_shadow_proof_requests,uuid)'
  );
  expected_source_sha256 constant text := '9dc31f9a3ae06962fe5596999d796f03ffb829bd470c6cfd51a4e271fde2fb35';
  old_validator constant text :=
    'app.private_telebirr_shadow_receipt_cell_binding_retry_is_valid';
  new_validator constant text :=
    'app.private_tbirr_cell_binding_retry_history_is_valid';
  old_lineage constant text :=
    '    and pilot.id = source_proof.pilot_revision_id' || pg_catalog.chr(10)
    || '    and pilot.id = source_cell_binding.pilot_revision_id'
    || pg_catalog.chr(10)
    || '    and profile.id = source_proof.receiver_profile_id'
    || pg_catalog.chr(10)
    || '    and profile.id = source_cell_binding.receiver_profile_id';
  new_lineage constant text :=
    '    and source_cell_binding.pilot_revision_id = source_proof.pilot_revision_id'
    || pg_catalog.chr(10)
    || '    and source_cell_binding.receiver_profile_id = source_proof.receiver_profile_id'
    || pg_catalog.chr(10)
    || '    and app.private_live_telebirr_shadow_pilot_contract_matches('
    || pg_catalog.chr(10)
    || '          source_cell_binding.pilot_revision_id,'
    || pg_catalog.chr(10)
    || '          pilot.id'
    || pg_catalog.chr(10)
    || '        )'
    || pg_catalog.chr(10)
    || '    and app.private_live_telebirr_shadow_profile_contract_matches('
    || pg_catalog.chr(10)
    || '          source_cell_binding.receiver_profile_id,'
    || pg_catalog.chr(10)
    || '          profile.id'
    || pg_catalog.chr(10)
    || '        )';
  original_definition text;
  original_source text;
  rewritten_definition text;
  rewritten_source text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  original_volatility "char";
  original_parallel "char";
  original_leakproof boolean;
  original_security_definer boolean;
  original_returns_set boolean;
begin
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc, routine.proowner,
         routine.proacl, routine.proconfig, routine.provolatile, routine.proparallel,
         routine.proleakproof, routine.prosecdef, routine.proretset
    into original_definition, original_source, original_owner, original_acl,
         original_config, original_volatility, original_parallel, original_leakproof,
         original_security_definer, original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.pronargs = 2
     and routine.prosecdef
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     );

  if original_definition is null
    or pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'),
         'hex'
       ) <> expected_source_sha256
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_validator, ''))
    ) / pg_catalog.length(old_validator) <> 1
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_lineage, ''))
    ) / pg_catalog.length(old_lineage) <> 1
    or pg_catalog.strpos(original_source, new_validator) <> 0
    or pg_catalog.strpos(original_source, new_lineage) <> 0 then
    raise exception 'The receipt-cell-opening child validator shape is not reviewed.';
  end if;

  rewritten_definition :=
    pg_catalog.replace(original_definition, old_validator, new_validator);
  rewritten_definition :=
    pg_catalog.replace(rewritten_definition, old_lineage, new_lineage);
  rewritten_source := pg_catalog.replace(original_source, old_validator, new_validator);
  rewritten_source := pg_catalog.replace(rewritten_source, old_lineage, new_lineage);
  execute rewritten_definition;

  if not exists (
    select 1 from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prosrc = rewritten_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.proconfig is not distinct from original_config
       and routine.provolatile = original_volatility
       and routine.proparallel = original_parallel
       and routine.proleakproof = original_leakproof
       and routine.prosecdef = original_security_definer
       and routine.proretset = original_returns_set
  ) then
    raise exception 'The receipt-cell-opening child validator rewrite changed authority.';
  end if;
end;
$rewrite_receipt_cell_opening_child_validator$;

do $rewrite_receipt_cell_opening_creator$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.retry_reviewed_private_telebirr_receipt_cell_opening(text,text)'
  );
  expected_source_sha256 constant text := '73ecd066c3acdbd3949bc34bdd3b1efeff439caed27930876b1428f80e15f34a';
  old_validator constant text :=
    'app.private_telebirr_shadow_receipt_cell_binding_retry_is_valid';
  new_validator constant text :=
    'app.private_tbirr_cell_binding_retry_history_is_valid';
  old_pilot_declare constant text :=
    '  source_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;'
    || pg_catalog.chr(10)
    || '  target_pilot app.private_live_deposit_pilot_revisions%rowtype;'
    || pg_catalog.chr(10)
    || '  target_profile app.private_live_telebirr_receiver_profiles%rowtype;';
  new_pilot_declare constant text :=
    '  source_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;'
    || pg_catalog.chr(10)
    || '  source_pilot app.private_live_deposit_pilot_revisions%rowtype;'
    || pg_catalog.chr(10)
    || '  source_profile app.private_live_telebirr_receiver_profiles%rowtype;'
    || pg_catalog.chr(10)
    || '  target_pilot app.private_live_deposit_pilot_revisions%rowtype;'
    || pg_catalog.chr(10)
    || '  target_profile app.private_live_telebirr_receiver_profiles%rowtype;';
  old_count_declare constant text :=
    '  existing_retry_count integer;' || pg_catalog.chr(10)
    || '  candidate_count integer;' || pg_catalog.chr(10)
    || '  locked_switch_count integer;';
  new_count_declare constant text :=
    '  existing_retry_count integer;' || pg_catalog.chr(10)
    || '  candidate_count integer;' || pg_catalog.chr(10)
    || '  target_pilot_count integer;' || pg_catalog.chr(10)
    || '  target_profile_count integer;' || pg_catalog.chr(10)
    || '  locked_switch_count integer;';
  old_target_select constant text :=
    '  select pilot.* into target_pilot' || pg_catalog.chr(10)
    || '    from app.private_live_deposit_pilot_revisions pilot'
    || pg_catalog.chr(10)
    || '   where pilot.id = source_proof.pilot_revision_id'
    || pg_catalog.chr(10)
    || '   for update;' || pg_catalog.chr(10)
    || '  select profile.* into target_profile' || pg_catalog.chr(10)
    || '    from app.private_live_telebirr_receiver_profiles profile'
    || pg_catalog.chr(10)
    || '   where profile.id = source_proof.receiver_profile_id'
    || pg_catalog.chr(10)
    || '   for share;';
  new_target_select constant text :=
    '  select pilot.* into source_pilot' || pg_catalog.chr(10)
    || '    from app.private_live_deposit_pilot_revisions pilot'
    || pg_catalog.chr(10)
    || '   where pilot.id = source_proof.pilot_revision_id'
    || pg_catalog.chr(10)
    || '   for share;' || pg_catalog.chr(10)
    || '  select profile.* into source_profile' || pg_catalog.chr(10)
    || '    from app.private_live_telebirr_receiver_profiles profile'
    || pg_catalog.chr(10)
    || '   where profile.id = source_proof.receiver_profile_id'
    || pg_catalog.chr(10)
    || '   for share;' || pg_catalog.chr(10) || pg_catalog.chr(10)
    || '  select pg_catalog.count(*)::integer into target_pilot_count'
    || pg_catalog.chr(10)
    || '    from app.private_live_deposit_pilot_revisions pilot'
    || pg_catalog.chr(10)
    || '   where pilot.status = ''armed''' || pg_catalog.chr(10)
    || '     and pilot.id <> source_pilot.id' || pg_catalog.chr(10)
    || '     and pilot.active_from <= v_authorized_at' || pg_catalog.chr(10)
    || '     and pilot.expires_at > v_authorized_at + interval ''1 hour'';'
    || pg_catalog.chr(10)
    || '  select pilot.* into target_pilot' || pg_catalog.chr(10)
    || '    from app.private_live_deposit_pilot_revisions pilot'
    || pg_catalog.chr(10)
    || '   where pilot.status = ''armed''' || pg_catalog.chr(10)
    || '     and pilot.id <> source_pilot.id' || pg_catalog.chr(10)
    || '     and pilot.active_from <= v_authorized_at' || pg_catalog.chr(10)
    || '     and pilot.expires_at > v_authorized_at + interval ''1 hour'''
    || pg_catalog.chr(10)
    || '   for update;' || pg_catalog.chr(10) || pg_catalog.chr(10)
    || '  select pg_catalog.count(*)::integer into target_profile_count'
    || pg_catalog.chr(10)
    || '    from app.private_live_telebirr_receiver_profiles profile'
    || pg_catalog.chr(10)
    || '   where profile.pilot_revision_id = target_pilot.id'
    || pg_catalog.chr(10)
    || '     and app.private_live_telebirr_shadow_profile_contract_matches('
    || pg_catalog.chr(10)
    || '           source_profile.id,' || pg_catalog.chr(10)
    || '           profile.id' || pg_catalog.chr(10)
    || '         );' || pg_catalog.chr(10)
    || '  select profile.* into target_profile' || pg_catalog.chr(10)
    || '    from app.private_live_telebirr_receiver_profiles profile'
    || pg_catalog.chr(10)
    || '   where profile.pilot_revision_id = target_pilot.id'
    || pg_catalog.chr(10)
    || '     and app.private_live_telebirr_shadow_profile_contract_matches('
    || pg_catalog.chr(10)
    || '           source_profile.id,' || pg_catalog.chr(10)
    || '           profile.id' || pg_catalog.chr(10)
    || '         )' || pg_catalog.chr(10)
    || '   for share;';
  old_target_identity constant text :=
    '    or source_cell_binding.pilot_revision_id <> target_pilot.id'
    || pg_catalog.chr(10)
    || '    or source_cell_binding.receiver_profile_id <> target_profile.id';
  new_target_identity constant text :=
    '    or source_pilot.id is null' || pg_catalog.chr(10)
    || '    or source_profile.id is null' || pg_catalog.chr(10)
    || '    or target_pilot_count <> 1' || pg_catalog.chr(10)
    || '    or target_profile_count <> 1' || pg_catalog.chr(10)
    || '    or source_cell_binding.pilot_revision_id <> source_pilot.id'
    || pg_catalog.chr(10)
    || '    or source_cell_binding.receiver_profile_id <> source_profile.id'
    || pg_catalog.chr(10)
    || '    or not app.private_live_telebirr_shadow_pilot_contract_matches('
    || pg_catalog.chr(10)
    || '         source_pilot.id,' || pg_catalog.chr(10)
    || '         target_pilot.id' || pg_catalog.chr(10)
    || '       )' || pg_catalog.chr(10)
    || '    or not app.private_live_telebirr_shadow_profile_contract_matches('
    || pg_catalog.chr(10)
    || '         source_profile.id,' || pg_catalog.chr(10)
    || '         target_profile.id' || pg_catalog.chr(10)
    || '       )';
  original_definition text;
  original_source text;
  rewritten_definition text;
  rewritten_source text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  original_volatility "char";
  original_parallel "char";
  original_leakproof boolean;
  original_security_definer boolean;
  original_returns_set boolean;
begin
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc, routine.proowner,
         routine.proacl, routine.proconfig, routine.provolatile, routine.proparallel,
         routine.proleakproof, routine.prosecdef, routine.proretset
    into original_definition, original_source, original_owner, original_acl,
         original_config, original_volatility, original_parallel, original_leakproof,
         original_security_definer, original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.pronargs = 2
     and routine.prosecdef
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     );

  if original_definition is null
    or pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'),
         'hex'
       ) <> expected_source_sha256
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_validator, ''))
    ) / pg_catalog.length(old_validator) <> 3
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_pilot_declare, ''))
    ) / pg_catalog.length(old_pilot_declare) <> 1
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_count_declare, ''))
    ) / pg_catalog.length(old_count_declare) <> 1
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_target_select, ''))
    ) / pg_catalog.length(old_target_select) <> 1
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_target_identity, ''))
    ) / pg_catalog.length(old_target_identity) <> 1
    or pg_catalog.strpos(original_source, new_validator) <> 0
    or pg_catalog.strpos(original_source, new_pilot_declare) <> 0
    or pg_catalog.strpos(original_source, new_count_declare) <> 0
    or pg_catalog.strpos(original_source, new_target_select) <> 0
    or pg_catalog.strpos(original_source, new_target_identity) <> 0 then
    raise exception 'The receipt-cell-opening creator shape is not reviewed.';
  end if;

  rewritten_definition :=
    pg_catalog.replace(original_definition, old_validator, new_validator);
  rewritten_definition :=
    pg_catalog.replace(rewritten_definition, old_pilot_declare, new_pilot_declare);
  rewritten_definition :=
    pg_catalog.replace(rewritten_definition, old_count_declare, new_count_declare);
  rewritten_definition :=
    pg_catalog.replace(rewritten_definition, old_target_select, new_target_select);
  rewritten_definition :=
    pg_catalog.replace(rewritten_definition, old_target_identity, new_target_identity);
  rewritten_source := pg_catalog.replace(original_source, old_validator, new_validator);
  rewritten_source :=
    pg_catalog.replace(rewritten_source, old_pilot_declare, new_pilot_declare);
  rewritten_source :=
    pg_catalog.replace(rewritten_source, old_count_declare, new_count_declare);
  rewritten_source :=
    pg_catalog.replace(rewritten_source, old_target_select, new_target_select);
  rewritten_source :=
    pg_catalog.replace(rewritten_source, old_target_identity, new_target_identity);
  execute rewritten_definition;

  if not exists (
    select 1 from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prosrc = rewritten_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.proconfig is not distinct from original_config
       and routine.provolatile = original_volatility
       and routine.proparallel = original_parallel
       and routine.proleakproof = original_leakproof
       and routine.prosecdef = original_security_definer
       and routine.proretset = original_returns_set
  ) then
    raise exception 'The receipt-cell-opening creator rewrite changed authority.';
  end if;
end;
$rewrite_receipt_cell_opening_creator$;

alter function app.private_tbirr_cell_binding_retry_history_is_valid(uuid, uuid)
  owner to postgres;

revoke all on function app.private_tbirr_cell_binding_retry_history_is_valid(uuid, uuid)
  from public, anon, authenticated, service_role;

comment on function app.private_tbirr_cell_binding_retry_history_is_valid(uuid, uuid) is
  'Validates the immutable historical receipt-cell-binding child and its signed review evidence without requiring its expired pilot or enrollment to remain live.';

commit;
