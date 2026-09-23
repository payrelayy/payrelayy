-- No-money, cross-pilot retry for a signed network-unavailable outcome on a
-- receipt-shape child. The original submission time and reference are never renewed.
-- The old pilot and enrollment are historical evidence, not live authority; the
-- replacement must be bound to a distinct, current, contract-identical pilot.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function app.private_telebirr_receipt_shape_network_source_is_valid(
  p_source_shadow_proof_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  with exact_source as materialized (
    select proof.id,
           outcome.observation_body_digest
      from app.private_telebirr_shadow_receipt_shape_diag_retries retry
      join app.private_telebirr_shadow_receipt_cell_opening_retries opening
        on opening.retry_request_key = retry.source_opening_retry_request_key
       and opening.retry_request_digest = retry.source_opening_retry_request_digest
      join app.private_telebirr_shadow_receipt_cell_binding_retries cell_binding
        on cell_binding.retry_request_key = opening.source_cell_binding_retry_request_key
       and cell_binding.retry_request_digest =
           opening.source_cell_binding_retry_request_digest
      join app.private_telebirr_shadow_proof_requests parent
        on parent.id = retry.source_shadow_proof_request_id
       and parent.verification_job_id = retry.source_shadow_verification_job_id
       and parent.id = opening.replacement_shadow_proof_request_id
       and parent.verification_job_id = opening.replacement_shadow_verification_job_id
      join app.private_telebirr_shadow_verification_outcomes parent_outcome
        on parent_outcome.id = retry.source_shadow_outcome_id
       and parent_outcome.shadow_proof_request_id = parent.id
       and parent_outcome.verification_job_id = parent.verification_job_id
      join app.private_telebirr_shadow_proof_requests proof
        on proof.id = retry.replacement_shadow_proof_request_id
       and proof.verification_job_id = retry.replacement_shadow_verification_job_id
      join app.private_telebirr_shadow_verification_outcomes outcome
        on outcome.shadow_proof_request_id = proof.id
       and outcome.verification_job_id = proof.verification_job_id
      join app.private_live_deposit_pilot_revisions historical_pilot
        on historical_pilot.id = retry.pilot_revision_id
       and historical_pilot.id = parent.pilot_revision_id
       and historical_pilot.id = proof.pilot_revision_id
      join app.private_live_telebirr_receiver_profiles historical_profile
        on historical_profile.id = retry.receiver_profile_id
       and historical_profile.id = parent.receiver_profile_id
       and historical_profile.id = proof.receiver_profile_id
     where proof.id = p_source_shadow_proof_request_id
       and retry.retry_request_digest =
           app.private_telebirr_shadow_receipt_shape_diag_retry_digest(
             retry.retry_request_key,
             retry.source_opening_retry_request_key,
             retry.source_opening_retry_request_digest,
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
             retry.source_receipt_shape_diag_review_count,
             retry.source_outcome_count,
             retry.authorized_at,
             retry.retry_expires_at,
             retry.reviewed_main_commit_sha,
             retry.reason_code
           )
       and retry.reason_code = 'reviewed_receipt_shape_diag_retry_no_credit'
       and opening.retry_request_digest =
           app.private_telebirr_shadow_receipt_cell_opening_retry_digest(
             opening.retry_request_key,
             opening.source_cell_binding_retry_request_key,
             opening.source_cell_binding_retry_request_digest,
             opening.source_shadow_proof_request_id,
             opening.source_shadow_verification_job_id,
             opening.source_shadow_outcome_id,
             opening.replacement_shadow_proof_request_id,
             opening.replacement_shadow_verification_job_id,
             opening.pilot_revision_id,
             opening.receiver_profile_id,
             opening.device_enrollment_id,
             opening.assignment_signer_id,
             opening.source_attempt_count,
             opening.source_attempt_history_digest,
             opening.source_staged_evidence_count,
             opening.source_evidence_history_digest,
             opening.source_receipt_cell_opening_review_count,
             opening.source_outcome_count,
             opening.authorized_at,
             opening.retry_expires_at,
             opening.reviewed_main_commit_sha,
             opening.reason_code
           )
       and opening.reason_code = 'reviewed_receipt_cell_opening_retry_no_credit'
       and retry.retry_expires_at = retry.authorized_at + interval '12 hours'
       and retry.source_attempt_count = (
         select pg_catalog.count(*)
           from app.private_telebirr_shadow_verification_attempts attempt
          where attempt.shadow_proof_request_id = parent.id
       )
       and retry.source_attempt_history_digest =
           app.private_telebirr_shadow_retry_attempt_history_digest(parent.id)
       and retry.source_staged_evidence_count = (
         select pg_catalog.count(*)
           from app.private_telebirr_shadow_device_evidence_staging staged
           join app.private_telebirr_shadow_verification_attempts attempt
             on attempt.id = staged.verification_attempt_id
          where attempt.shadow_proof_request_id = parent.id
       )
       and retry.source_evidence_history_digest =
           app.private_telebirr_shadow_layout_evidence_history_digest(parent.id)
       and retry.source_receipt_shape_diag_review_count = retry.source_attempt_count
       and retry.source_receipt_shape_diag_review_count = (
         select pg_catalog.count(*)
           from app.private_telebirr_shadow_device_evidence_staging staged
           join app.private_telebirr_shadow_verification_attempts attempt
             on attempt.id = staged.verification_attempt_id
          where attempt.shadow_proof_request_id = parent.id
            and staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason' =
                'unknown_layout_invoice_number'
       )
       and retry.source_outcome_count = 1
       and retry.source_outcome_count = (
         select pg_catalog.count(*)
           from app.private_telebirr_shadow_verification_outcomes other
          where other.shadow_proof_request_id = parent.id
       )
       and parent_outcome.protocol_disposition = 'would_review'
       and parent_outcome.protocol_reason_code = 'receipt_requires_review'
       and parent_outcome.disposition = 'review_required'
       and parent_outcome.reason_code = 'parser_uncertain'
       and parent_outcome.principal_amount_minor is null
       and parent_outcome.occurred_at is null
       and parent_outcome.receiver_identity_digest is null
       and exists (
         select 1
           from app.private_telebirr_shadow_device_evidence_staging staged
           join app.private_telebirr_shadow_verification_attempts attempt
             on attempt.id = staged.verification_attempt_id
          where attempt.shadow_proof_request_id = parent.id
            and staged.observation_body_digest = parent_outcome.observation_body_digest
            and staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason' =
                'unknown_layout_invoice_number'
       )
       and proof.source_binding_layout_retry_source_id = parent.id
       and proof.proof_status = 'verification_queued'
       and proof.source_unavailable_retry_source_id is null
       and proof.pilot_configuration_digest = historical_pilot.configuration_digest
       and historical_profile.pilot_revision_id = historical_pilot.id
       and proof.submitting_customer_id = parent.submitting_customer_id
       and proof.player_account_id = parent.player_account_id
       and proof.payment_provider_id = parent.payment_provider_id
       and proof.provider_code = parent.provider_code
       and proof.origin_channel = parent.origin_channel
       and proof.input_kind = parent.input_kind
       and proof.candidate_reference_ciphertext = parent.candidate_reference_ciphertext
       and proof.candidate_reference_fingerprint = parent.candidate_reference_fingerprint
       and proof.candidate_reference_masked = parent.candidate_reference_masked
       and proof.reference_encryption_key_version = parent.reference_encryption_key_version
       and proof.reference_profile_version = parent.reference_profile_version
       and proof.submitted_at = parent.submitted_at
       and proof.not_before = parent.not_before
       and proof.created_at = retry.authorized_at
       and proof.expires_at = retry.retry_expires_at
       and not exists (
         select 1
           from app.telegram_telebirr_shadow_proof_receipts receipt
          where receipt.shadow_proof_request_id = proof.id
       )
       and outcome.disposition = 'review_required'
       and outcome.reason_code = 'source_unavailable'
       and outcome.protocol_disposition = 'would_review'
       and outcome.protocol_reason_code = 'receipt_requires_review'
       and not outcome.would_verify
       and outcome.principal_amount_minor is null
       and outcome.occurred_at is null
       and outcome.receiver_identity_digest is null
       and (select pg_catalog.count(*)
              from app.private_telebirr_shadow_verification_outcomes other
             where other.shadow_proof_request_id = proof.id) = 1
  ), observations as materialized (
    select attempt.id as verification_attempt_id,
           staged.observation_body_digest,
           staged.staged_at,
           staged.signed_observation -> 'body' -> 'facts' ->> 'lookupOutcome'
             as lookup_outcome,
           staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason'
             as review_reason,
           staged.signed_observation -> 'body' -> 'facts' ->> 'principalAmountMinor'
             as principal_amount_minor,
           staged.signed_observation -> 'body' -> 'facts' ->> 'occurredAt'
             as occurred_at,
           staged.signed_observation -> 'body' -> 'facts' ->> 'receiverIdentityDigest'
             as receiver_identity_digest
      from exact_source source
      join app.private_telebirr_shadow_verification_attempts attempt
        on attempt.shadow_proof_request_id = source.id
      left join app.private_telebirr_shadow_device_evidence_staging staged
        on staged.verification_attempt_id = attempt.id
  )
  select (select pg_catalog.count(*) from exact_source) = 1
     and (select pg_catalog.count(*) from observations) between 1 and 100
     and (select pg_catalog.count(distinct verification_attempt_id)
            from observations) = (select pg_catalog.count(*) from observations)
     and not exists (
       select 1 from observations observation
        where observation.observation_body_digest is null
           or observation.staged_at is null
           or observation.lookup_outcome is distinct from 'review_required'
           or observation.review_reason is distinct from 'network_unavailable'
           or observation.principal_amount_minor is not null
           or observation.occurred_at is not null
           or observation.receiver_identity_digest is not null
     )
     and not exists (
       select 1
         from observations observation
         join app.private_telebirr_shadow_evidence_quarantine quarantine
           on quarantine.verification_attempt_id =
              observation.verification_attempt_id
           or quarantine.observation_body_digest =
              observation.observation_body_digest
     )
     and (
       select observation.observation_body_digest
         from observations observation
        order by observation.staged_at desc,
                 observation.observation_body_digest desc
        limit 1
     ) = (select source.observation_body_digest from exact_source source);
$$;

alter function app.private_telebirr_receipt_shape_network_source_is_valid(uuid)
  owner to postgres;
revoke all on function app.private_telebirr_receipt_shape_network_source_is_valid(uuid)
  from public, anon, authenticated, service_role;

comment on function app.private_telebirr_receipt_shape_network_source_is_valid(uuid) is
  'Binds one existing receipt-shape diagnostic child to its immutable network-unavailable outcome, all signed attempts, and the terminal observation without granting financial authority.';

create function app.private_telebirr_receipt_shape_network_retry_deadline(
  p_replacement_shadow_proof_request_id uuid
)
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select retry.retry_expires_at
    from app.private_telebirr_shadow_source_unavailable_retries retry
    join app.private_telebirr_shadow_proof_requests replacement
      on replacement.id = retry.replacement_shadow_proof_request_id
     and replacement.verification_job_id =
         retry.replacement_shadow_verification_job_id
   where replacement.id = p_replacement_shadow_proof_request_id
     and replacement.source_unavailable_retry_source_id =
         retry.source_shadow_proof_request_id
     and app.private_telebirr_receipt_shape_network_source_is_valid(
           retry.source_shadow_proof_request_id
         )
     and app.private_telebirr_shadow_source_unavailable_retry_is_valid(
           replacement.id, retry.retry_request_key
         );
$$;

alter function app.private_telebirr_receipt_shape_network_retry_deadline(uuid)
  owner to postgres;
revoke all on function app.private_telebirr_receipt_shape_network_retry_deadline(uuid)
  from public, anon, authenticated, service_role;

comment on function app.private_telebirr_receipt_shape_network_retry_deadline(uuid) is
  'Returns the immutable bounded deadline only for a validated receipt-shape network-unavailable descendant retry.';

-- The legacy source-unavailable proof branch caps expiry at the original
-- submission time. Keep that branch intact and add only an exclusive retry
-- shape whose own guarded insert enforces the signed historical source and
-- distinct contract-identical target pilot.
do $extend_network_retry_proof_window$
declare
  definition text;
  prior_expression text;
  installed_definition text;
  new_branch constant text := $network_window_branch$
    not_before = submitted_at
    and source_unavailable_retry_source_id is not null
    and source_live_verification_job_id is null
    and source_live_proof_id is null
    and source_pilot_revision_id is null
    and source_receiver_profile_id is null
    and original_expires_at is null
    and recovered_at is null
    and recovery_request_key is null
    and recovery_request_digest is null
    and recovery_reason_code is null
    and retry_request_key is null
    and retry_request_digest is null
    and retry_reason_code is null
    and retry_prior_pilot_revision_id is null
    and retry_prior_receiver_profile_id is null
    and retry_prior_configuration_digest is null
    and retry_original_expires_at is null
    and retried_at is null
    and infrastructure_retry_request_key is null
    and infrastructure_retry_request_digest is null
    and infrastructure_retry_reason_code is null
    and infrastructure_retry_original_expires_at is null
    and infrastructure_retried_at is null
    and runtime_retry_request_key is null
    and runtime_retry_request_digest is null
    and runtime_retry_reason_code is null
    and runtime_retry_original_expires_at is null
    and runtime_retry_prior_attempt_count is null
    and runtime_retry_prior_attempt_history_digest is null
    and runtime_retried_at is null
    and observation_clock_retry_source_id is null
    and authority_deadline_retry_source_id is null
    and assessment_clock_retry_source_id is null
    and source_binding_window_retry_source_id is null
    and source_binding_layout_retry_source_id is null
    and created_at >= submitted_at
    and expires_at > created_at
    and expires_at <= created_at + interval '12 hours'
  $network_window_branch$;
begin
  select pg_catalog.pg_get_constraintdef(c.oid) into definition
    from pg_catalog.pg_constraint c
   where c.conrelid = 'app.private_telebirr_shadow_proof_requests'::regclass
     and c.conname = 'private_telebirr_shadow_proof_window_check'
     and c.contype = 'c'
     and c.convalidated;

  if definition is null
    or pg_catalog.left(definition, 7) <> 'CHECK ('
    or pg_catalog.right(definition, 1) <> ')'
    or pg_catalog.strpos(definition, 'source_unavailable_retry_source_id') = 0
    or pg_catalog.strpos(definition, 'source_binding_layout_retry_source_id') = 0
    or pg_catalog.strpos(definition, 'expires_at <= (submitted_at + ''12:00:00''::interval)') = 0
    or pg_catalog.strpos(definition, 'source_unavailable_retry_source_id IS NOT NULL') <> 0 then
    raise exception 'The reviewed network retry proof window changed shape.';
  end if;

  prior_expression := pg_catalog.substring(
    definition, 8, pg_catalog.length(definition) - 8
  );
  execute 'alter table app.private_telebirr_shadow_proof_requests '
       || 'drop constraint private_telebirr_shadow_proof_window_check';
  execute 'alter table app.private_telebirr_shadow_proof_requests '
       || 'add constraint private_telebirr_shadow_proof_window_check check (('
       || prior_expression || ') or (' || new_branch || '))';

  select pg_catalog.pg_get_constraintdef(c.oid) into installed_definition
    from pg_catalog.pg_constraint c
   where c.conrelid = 'app.private_telebirr_shadow_proof_requests'::regclass
     and c.conname = 'private_telebirr_shadow_proof_window_check'
     and c.contype = 'c'
     and c.convalidated;
  if installed_definition is null
    or pg_catalog.strpos(
         installed_definition, 'source_unavailable_retry_source_id IS NOT NULL'
       ) = 0
    or pg_catalog.strpos(installed_definition, 'source_binding_layout_retry_source_id') = 0 then
    raise exception 'The network retry proof window was not installed exactly.';
  end if;
end;
$extend_network_retry_proof_window$;

do $network_retry_rewrite_0$
declare
  routine_oid oid := pg_catalog.to_regprocedure('app.guard_private_telebirr_shadow_source_retry_insert()');
  expected_source_sha256 constant text := 'cfe0a37539c95f14c35bdb71bf0eed0031e8df2b7e56527f49cdd1d6b2a63045';
  old_fragment_0 constant text := $old_0_pilot$    or new.pilot_revision_id is distinct from source_proof.pilot_revision_id$old_0_pilot$;
  new_fragment_0 constant text := $new_0_pilot$    or (case
         when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
           then new.pilot_revision_id = source_proof.pilot_revision_id
             or not app.private_live_telebirr_shadow_pilot_contract_matches(
               source_proof.pilot_revision_id, new.pilot_revision_id
             )
         else new.pilot_revision_id is distinct from source_proof.pilot_revision_id
       end)$new_0_pilot$;
  old_fragment_profile constant text := $old_0_profile$    or new.receiver_profile_id is distinct from source_proof.receiver_profile_id$old_0_profile$;
  new_fragment_profile constant text := $new_0_profile$    or (case
         when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
           then not app.private_live_telebirr_shadow_profile_contract_matches(
             source_proof.receiver_profile_id, new.receiver_profile_id
           )
         else new.receiver_profile_id is distinct from source_proof.receiver_profile_id
       end)$new_0_profile$;
  old_fragment_digest constant text := $old_0_digest$    or new.pilot_configuration_digest is distinct from source_proof.pilot_configuration_digest$old_0_digest$;
  new_fragment_digest constant text := $new_0_digest$    or new.pilot_configuration_digest is distinct from (case
         when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
           then (select pilot.configuration_digest
                   from app.private_live_deposit_pilot_revisions pilot
                  where pilot.id = new.pilot_revision_id)
         else source_proof.pilot_configuration_digest
       end)$new_0_digest$;
  old_fragment_1 constant text := $old_0_0$    or new.expires_at > source_proof.submitted_at + interval '12 hours'$old_0_0$;
  new_fragment_1 constant text := $new_0_0$    or new.expires_at > (case
         when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
           then new.created_at + interval '12 hours'
         else source_proof.submitted_at + interval '12 hours'
       end)$new_0_0$;
  original_definition text;
  original_source text;
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
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl, routine.proconfig,
         routine.provolatile, routine.proparallel, routine.proleakproof,
         routine.prosecdef, routine.proretset
    into original_definition, original_source, original_owner, original_acl,
         original_config, original_volatility, original_parallel,
         original_leakproof, original_security_definer, original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
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
    or (pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, original_source, '')))
      / pg_catalog.length(original_source) <> 1 then
    raise exception 'The reviewed retry function source is not exact.';
  end if;

  rewritten_source := original_source;
  if (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_0, '')))
      / pg_catalog.length(old_fragment_0) <> 1
    or (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_profile, '')))
      / pg_catalog.length(old_fragment_profile) <> 1
    or (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_digest, '')))
      / pg_catalog.length(old_fragment_digest) <> 1 then
    raise exception 'The reviewed cross-pilot insert-guard fragments are not unique.';
  end if;
  rewritten_source := pg_catalog.replace(rewritten_source, old_fragment_0, new_fragment_0);
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_profile, new_fragment_profile
  );
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_digest, new_fragment_digest
  );
  if (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_1, '')))
      / pg_catalog.length(old_fragment_1) <> 1 then
    raise exception 'The reviewed retry function fragment is not unique.';
  end if;
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_1, new_fragment_1
  );
  execute pg_catalog.replace(original_definition, original_source, rewritten_source);

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
    raise exception 'The reviewed retry rewrite changed its authority.';
  end if;
end;
$network_retry_rewrite_0$;


do $network_retry_rewrite_1$
declare
  routine_oid oid := pg_catalog.to_regprocedure('app.private_telebirr_shadow_source_unavailable_retry_is_valid(uuid, uuid)');
  expected_source_sha256 constant text := 'c9e2352e49868c4e2701e87368635f384b0c984cf8b3211436827ea7cec59610';
  old_fragment_contract constant text := $old_1_contract$       and retry.receiver_profile_id = replacement.receiver_profile_id$old_1_contract$;
  new_fragment_contract constant text := $new_1_contract$       and retry.receiver_profile_id = replacement.receiver_profile_id
       and (
         not app.private_telebirr_receipt_shape_network_source_is_valid(source.id)
         or (
           source.pilot_revision_id <> replacement.pilot_revision_id
           and app.private_live_telebirr_shadow_pilot_contract_matches(
             source.pilot_revision_id, replacement.pilot_revision_id
           )
           and app.private_live_telebirr_shadow_profile_contract_matches(
             source.receiver_profile_id, replacement.receiver_profile_id
           )
           and replacement.pilot_configuration_digest = (
             select pilot.configuration_digest
               from app.private_live_deposit_pilot_revisions pilot
              where pilot.id = replacement.pilot_revision_id
                and pilot.status = 'armed'
           )
           and exists (
             select 1
               from app.private_live_telebirr_receiver_profiles profile
              where profile.id = replacement.receiver_profile_id
                and profile.pilot_revision_id = replacement.pilot_revision_id
                and profile.valid_from <= pg_catalog.clock_timestamp()
                and profile.valid_until > pg_catalog.clock_timestamp()
           )
         )
       )$new_1_contract$;
  old_fragment_1 constant text := $old_1_0$       and exists (
         select 1
           from app.telegram_telebirr_shadow_proof_receipts receipt
          where receipt.shadow_proof_request_id = source.id
       )$old_1_0$;
  new_fragment_1 constant text := $new_1_0$       and (
         exists (
           select 1
             from app.telegram_telebirr_shadow_proof_receipts receipt
            where receipt.shadow_proof_request_id = source.id
         )
         or app.private_telebirr_receipt_shape_network_source_is_valid(source.id)
       )$new_1_0$;
  original_definition text;
  original_source text;
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
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl, routine.proconfig,
         routine.provolatile, routine.proparallel, routine.proleakproof,
         routine.prosecdef, routine.proretset
    into original_definition, original_source, original_owner, original_acl,
         original_config, original_volatility, original_parallel,
         original_leakproof, original_security_definer, original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
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
    or (pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, original_source, '')))
      / pg_catalog.length(original_source) <> 1 then
    raise exception 'The reviewed retry function source is not exact.';
  end if;

  rewritten_source := original_source;
  if (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_contract, '')))
      / pg_catalog.length(old_fragment_contract) <> 1 then
    raise exception 'The reviewed cross-pilot retry validator fragment is not unique.';
  end if;
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_contract, new_fragment_contract
  );
  if (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_1, '')))
      / pg_catalog.length(old_fragment_1) <> 1 then
    raise exception 'The reviewed retry function fragment is not unique.';
  end if;
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_1, new_fragment_1
  );
  execute pg_catalog.replace(original_definition, original_source, rewritten_source);

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
    raise exception 'The reviewed retry rewrite changed its authority.';
  end if;
end;
$network_retry_rewrite_1$;


do $network_retry_rewrite_2$
declare
  routine_oid oid := pg_catalog.to_regprocedure('app.retry_private_telebirr_shadow_after_source_unavailable(uuid, uuid, uuid, text)');
  expected_source_sha256 constant text := '4c3bbab4decc86093fe9406be6d416138c199a2f964eaef00cd1e19c968552f8';
  old_fragment_pilot constant text := $old_2_pilot$    or source_proof.pilot_revision_id is distinct from p_pilot_revision_id$old_2_pilot$;
  new_fragment_pilot constant text := $new_2_pilot$    or (case
         when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
           then source_proof.pilot_revision_id = p_pilot_revision_id
             or not app.private_live_telebirr_shadow_pilot_contract_matches(
               source_proof.pilot_revision_id, p_pilot_revision_id
             )
         else source_proof.pilot_revision_id is distinct from p_pilot_revision_id
       end)$new_2_pilot$;
  old_fragment_1 constant text := $old_2_0$    or authorized_at >= source_proof.submitted_at + interval '12 hours'$old_2_0$;
  new_fragment_1 constant text := $new_2_0$    or (
      not app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
      and authorized_at >= source_proof.submitted_at + interval '12 hours'
    )$new_2_0$;
  old_fragment_2 constant text := $old_2_1$    or not exists (
      select 1
        from app.telegram_telebirr_shadow_proof_receipts receipt
       where receipt.shadow_proof_request_id = source_proof.id
    )$old_2_1$;
  new_fragment_2 constant text := $new_2_1$    or not (
      exists (
        select 1
          from app.telegram_telebirr_shadow_proof_receipts receipt
         where receipt.shadow_proof_request_id = source_proof.id
      )
      or app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
    )$new_2_1$;
  old_fragment_3 constant text := $old_2_2$    source_proof.submitted_at + interval '12 hours',
    pilot.expires_at,$old_2_2$;
  new_fragment_3 constant text := $new_2_2$    case
      when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
        then authorized_at + interval '12 hours'
      else source_proof.submitted_at + interval '12 hours'
    end,
    pilot.expires_at,$new_2_2$;
  old_fragment_profile_select constant text := $old_2_profile$   where candidate.id = source_proof.receiver_profile_id
   for share;$old_2_profile$;
  new_fragment_profile_select constant text := $new_2_profile$   where (
     candidate.id = source_proof.receiver_profile_id
     and not app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
   ) or (
     app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
     and candidate.pilot_revision_id = p_pilot_revision_id
     and app.private_live_telebirr_shadow_profile_contract_matches(
       source_proof.receiver_profile_id, candidate.id
     )
   )
   for share;$new_2_profile$;
  old_fragment_config constant text := $old_2_config$    or pilot.configuration_digest is distinct from source_proof.pilot_configuration_digest$old_2_config$;
  new_fragment_config constant text := $new_2_config$    or (
      not app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
      and pilot.configuration_digest is distinct from source_proof.pilot_configuration_digest
    )$new_2_config$;
  old_fragment_insert_pilot constant text := $old_2_insert$    source_proof.pilot_revision_id,
    source_proof.submitting_customer_id,
    source_proof.player_account_id,
    source_proof.payment_provider_id,
    source_proof.provider_code,
    source_proof.receiver_profile_id,
    source_proof.pilot_configuration_digest,$old_2_insert$;
  new_fragment_insert_pilot constant text := $new_2_insert$    pilot.id,
    source_proof.submitting_customer_id,
    source_proof.player_account_id,
    source_proof.payment_provider_id,
    source_proof.provider_code,
    profile.id,
    pilot.configuration_digest,$new_2_insert$;
  original_definition text;
  original_source text;
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
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl, routine.proconfig,
         routine.provolatile, routine.proparallel, routine.proleakproof,
         routine.prosecdef, routine.proretset
    into original_definition, original_source, original_owner, original_acl,
         original_config, original_volatility, original_parallel,
         original_leakproof, original_security_definer, original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
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
    or (pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, original_source, '')))
      / pg_catalog.length(original_source) <> 1 then
    raise exception 'The reviewed retry function source is not exact.';
  end if;

  rewritten_source := original_source;
  if (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_pilot, '')))
      / pg_catalog.length(old_fragment_pilot) <> 1
    or (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_profile_select, '')))
      / pg_catalog.length(old_fragment_profile_select) <> 1
    or (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_config, '')))
      / pg_catalog.length(old_fragment_config) <> 1
    or (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_insert_pilot, '')))
      / pg_catalog.length(old_fragment_insert_pilot) <> 1 then
    raise exception 'The reviewed cross-pilot retry fragments are not unique.';
  end if;
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_pilot, new_fragment_pilot
  );
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_profile_select, new_fragment_profile_select
  );
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_config, new_fragment_config
  );
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_insert_pilot, new_fragment_insert_pilot
  );
  if (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_1, '')))
      / pg_catalog.length(old_fragment_1) <> 1 then
    raise exception 'The reviewed retry function fragment is not unique.';
  end if;
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_1, new_fragment_1
  );
  if (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_2, '')))
      / pg_catalog.length(old_fragment_2) <> 1 then
    raise exception 'The reviewed retry function fragment is not unique.';
  end if;
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_2, new_fragment_2
  );
  if (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_3, '')))
      / pg_catalog.length(old_fragment_3) <> 1 then
    raise exception 'The reviewed retry function fragment is not unique.';
  end if;
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_3, new_fragment_3
  );
  execute pg_catalog.replace(original_definition, original_source, rewritten_source);

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
    raise exception 'The reviewed retry rewrite changed its authority.';
  end if;
end;
$network_retry_rewrite_2$;


do $network_retry_rewrite_3$
declare
  routine_oid oid := pg_catalog.to_regprocedure('app.load_next_private_telebirr_shadow_staged_evidence()');
  expected_source_sha256 constant text := '682fa0118fc27cd3beddc65e6e925fd1a61022fb4fa70cf049976bbd0b635f68';
  old_fragment_1 constant text := $old_3_0$when proof.source_binding_layout_retry_source_id is not null$old_3_0$;
  new_fragment_1 constant text := $new_3_0$when proof.source_unavailable_retry_source_id is not null
         and app.private_telebirr_receipt_shape_network_source_is_valid(
               proof.source_unavailable_retry_source_id
             )
          then app.private_telebirr_receipt_shape_network_retry_deadline(proof.id)
       when proof.source_binding_layout_retry_source_id is not null$new_3_0$;
  original_definition text;
  original_source text;
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
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl, routine.proconfig,
         routine.provolatile, routine.proparallel, routine.proleakproof,
         routine.prosecdef, routine.proretset
    into original_definition, original_source, original_owner, original_acl,
         original_config, original_volatility, original_parallel,
         original_leakproof, original_security_definer, original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
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
    or (pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, original_source, '')))
      / pg_catalog.length(original_source) <> 1 then
    raise exception 'The reviewed retry function source is not exact.';
  end if;

  rewritten_source := original_source;
  if (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_1, '')))
      / pg_catalog.length(old_fragment_1) <> 1 then
    raise exception 'The reviewed retry function fragment is not unique.';
  end if;
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_1, new_fragment_1
  );
  execute pg_catalog.replace(original_definition, original_source, rewritten_source);

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
    raise exception 'The reviewed retry rewrite changed its authority.';
  end if;
end;
$network_retry_rewrite_3$;

do $network_retry_authority_rewrite_0$
declare
  routine_oid oid;
  expected_source_sha256 constant text := '489b37da448e02c63cb09938851208816f87eb78803fc125cad74ae821bc3f5d';
  old_fragment constant text := $old_authority_0$when proof.source_binding_layout_retry_source_id is not null$old_authority_0$;
  new_fragment constant text := $new_authority_0$when proof.source_unavailable_retry_source_id is not null
         and app.private_telebirr_receipt_shape_network_source_is_valid(
               proof.source_unavailable_retry_source_id
             )
         then app.private_telebirr_receipt_shape_network_retry_deadline(proof.id)
       when proof.source_binding_layout_retry_source_id is not null$new_authority_0$;
  original_definition text;
  original_source text;
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
  select routine.oid into routine_oid
    from pg_catalog.pg_proc routine
   where routine.pronamespace = 'app'::regnamespace
     and routine.proname = 'load_private_telebirr_shadow_verification_authority'
     and routine.pronargs = 3;
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl, routine.proconfig,
         routine.provolatile, routine.proparallel, routine.proleakproof,
         routine.prosecdef, routine.proretset
    into original_definition, original_source, original_owner, original_acl,
         original_config, original_volatility, original_parallel,
         original_leakproof, original_security_definer, original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
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
    or (pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, '')))
      / pg_catalog.length(old_fragment) <> 1
    or (pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, original_source, '')))
      / pg_catalog.length(original_source) <> 1 then
    raise exception 'The reviewed verifier authority source is not exact.';
  end if;
  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute pg_catalog.replace(original_definition, original_source, rewritten_source);
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
    raise exception 'The reviewed verifier authority rewrite changed its authority.';
  end if;
end;
$network_retry_authority_rewrite_0$;


do $network_retry_authority_rewrite_1$
declare
  routine_oid oid;
  expected_source_sha256 constant text := 'f8f4ddc9f047ba5597107ae8c4f4733f6ebfd8dc944c558849782f3cd5a3de65';
  old_fragment constant text := $old_authority_1$when proof.source_binding_layout_retry_source_id is not null$old_authority_1$;
  new_fragment constant text := $new_authority_1$when proof.source_unavailable_retry_source_id is not null
         and app.private_telebirr_receipt_shape_network_source_is_valid(
               proof.source_unavailable_retry_source_id
             )
         then app.private_telebirr_receipt_shape_network_retry_deadline(proof.id)
       when proof.source_binding_layout_retry_source_id is not null$new_authority_1$;
  original_definition text;
  original_source text;
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
  select routine.oid into routine_oid
    from pg_catalog.pg_proc routine
   where routine.pronamespace = 'app'::regnamespace
     and routine.proname = 'complete_private_telebirr_shadow_verification'
     and routine.pronargs = 20;
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl, routine.proconfig,
         routine.provolatile, routine.proparallel, routine.proleakproof,
         routine.prosecdef, routine.proretset
    into original_definition, original_source, original_owner, original_acl,
         original_config, original_volatility, original_parallel,
         original_leakproof, original_security_definer, original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
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
    or (pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, '')))
      / pg_catalog.length(old_fragment) <> 2
    or (pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, original_source, '')))
      / pg_catalog.length(original_source) <> 1 then
    raise exception 'The reviewed verifier authority source is not exact.';
  end if;
  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute pg_catalog.replace(original_definition, original_source, rewritten_source);
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
    raise exception 'The reviewed verifier authority rewrite changed its authority.';
  end if;
end;
$network_retry_authority_rewrite_1$;

commit;
