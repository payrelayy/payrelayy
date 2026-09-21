-- Add one append-only no-money retry for a receipt that was previously routed to review solely
-- because mutable provider branding was used as the identity signal. The original proof,
-- attempts, signed observations, and terminal review outcome remain immutable. The replacement
-- proof reuses the existing receipt-layout lineage column, but is distinguished by its own
-- immutable ledger and one-use request key.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema app
  revoke all on functions from public, anon, authenticated, service_role;

do $provider_origin_retry_preflight$
begin
  if pg_catalog.to_regclass(
       'app.private_telebirr_shadow_source_binding_layout_retries'
     ) is null
    or pg_catalog.to_regprocedure(
         'app.private_telebirr_shadow_source_binding_layout_retry_is_valid(uuid,uuid)'
       ) is null
    or pg_catalog.to_regprocedure(
         'app.private_telebirr_shadow_source_binding_layout_review_deadline(uuid)'
       ) is null
    or pg_catalog.to_regprocedure(
         'app.private_telebirr_shadow_layout_evidence_history_digest(uuid)'
       ) is null
    or pg_catalog.to_regprocedure(
         'app.private_telebirr_shadow_retry_attempt_history_digest(uuid)'
       ) is null
    or pg_catalog.to_regprocedure(
         'app.private_telebirr_shadow_source_binding_window_enrollment_is_ready(uuid,uuid,uuid,uuid,timestamp with time zone)'
       ) is null
    or pg_catalog.to_regprocedure(
         'app.private_telebirr_shadow_source_binding_window_boundary_is_ready(uuid)'
       ) is null
    or pg_catalog.to_regclass(
         'app.private_telebirr_shadow_provider_origin_retries'
       ) is not null then
    raise exception 'The provider-origin retry prerequisites do not match.';
  end if;
end;
$provider_origin_retry_preflight$;

create table app.private_telebirr_shadow_provider_origin_retries (
  retry_request_key uuid primary key,
  retry_request_digest text not null unique
    check (retry_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_layout_retry_request_key uuid not null unique
    references app.private_telebirr_shadow_source_binding_layout_retries (
      retry_request_key
    ) on delete restrict,
  source_layout_retry_request_digest text not null unique
    check (source_layout_retry_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_shadow_proof_request_id uuid not null unique,
  source_shadow_verification_job_id uuid not null unique,
  source_shadow_outcome_id uuid not null unique
    references app.private_telebirr_shadow_verification_outcomes (id) on delete restrict,
  replacement_shadow_proof_request_id uuid not null unique,
  replacement_shadow_verification_job_id uuid not null unique,
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  receiver_profile_id uuid not null
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  device_enrollment_id uuid not null
    references app.private_live_telebirr_device_enrollments (id) on delete restrict,
  assignment_signer_id uuid not null
    references app.private_live_telebirr_assignment_signers (id) on delete restrict,
  source_attempt_count integer not null check (source_attempt_count between 1 and 100),
  source_attempt_history_digest text not null
    check (source_attempt_history_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_staged_evidence_count integer not null
    check (source_staged_evidence_count = source_attempt_count),
  source_evidence_history_digest text not null
    check (source_evidence_history_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_provider_identity_review_count integer not null
    check (source_provider_identity_review_count = source_attempt_count),
  source_outcome_count integer not null check (source_outcome_count = 1),
  authorized_at timestamptz not null,
  retry_expires_at timestamptz not null,
  reviewed_main_commit_sha text not null
    check (reviewed_main_commit_sha ~ '^[0-9a-f]{40}$'),
  reason_code text not null check (
    reason_code = 'reviewed_receipt_provider_origin_retry_no_credit'
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_tbirr_shadow_origin_retry_key_v4_check check (
    retry_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_tbirr_shadow_origin_retry_window_check check (
    retry_expires_at = authorized_at + interval '12 hours'
  ),
  constraint private_tbirr_shadow_origin_retry_source_job_fkey
    foreign key (source_shadow_proof_request_id, source_shadow_verification_job_id)
    references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict,
  constraint private_tbirr_shadow_origin_retry_replacement_job_fkey
    foreign key (
      replacement_shadow_proof_request_id,
      replacement_shadow_verification_job_id
    ) references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict deferrable initially deferred
);

create function app.private_telebirr_shadow_provider_origin_retry_digest(
  p_retry_request_key uuid,
  p_source_layout_retry_request_key uuid,
  p_source_layout_retry_request_digest text,
  p_source_shadow_proof_request_id uuid,
  p_source_shadow_verification_job_id uuid,
  p_source_shadow_outcome_id uuid,
  p_replacement_shadow_proof_request_id uuid,
  p_replacement_shadow_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_receiver_profile_id uuid,
  p_device_enrollment_id uuid,
  p_assignment_signer_id uuid,
  p_source_attempt_count integer,
  p_source_attempt_history_digest text,
  p_source_staged_evidence_count integer,
  p_source_evidence_history_digest text,
  p_source_provider_identity_review_count integer,
  p_source_outcome_count integer,
  p_authorized_at timestamptz,
  p_retry_expires_at timestamptz,
  p_reviewed_main_commit_sha text,
  p_reason_code text
)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
begin
  if p_retry_request_key is null
    or p_source_layout_retry_request_key is null
    or p_source_layout_retry_request_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_source_shadow_proof_request_id is null
    or p_source_shadow_verification_job_id is null
    or p_source_shadow_outcome_id is null
    or p_replacement_shadow_proof_request_id is null
    or p_replacement_shadow_verification_job_id is null
    or p_pilot_revision_id is null
    or p_receiver_profile_id is null
    or p_device_enrollment_id is null
    or p_assignment_signer_id is null
    or p_source_attempt_count not between 1 and 100
    or p_source_attempt_history_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_source_staged_evidence_count is distinct from p_source_attempt_count
    or p_source_evidence_history_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_source_provider_identity_review_count is distinct from p_source_attempt_count
    or p_source_outcome_count is distinct from 1
    or p_authorized_at is null
    or p_retry_expires_at is distinct from p_authorized_at + interval '12 hours'
    or p_reviewed_main_commit_sha !~ '^[0-9a-f]{40}$'
    or p_reason_code is distinct from
       'reviewed_receipt_provider_origin_retry_no_credit' then
    raise exception 'The provider-origin retry digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_digest(
    'fetanagent:telebirr:reviewed-receipt-provider-origin-retry:v1'
      || '|request_key=' || p_retry_request_key::text
      || '|source_layout_key=' || p_source_layout_retry_request_key::text
      || '|source_layout_digest=' || p_source_layout_retry_request_digest
      || '|source_proof=' || p_source_shadow_proof_request_id::text
      || '|source_job=' || p_source_shadow_verification_job_id::text
      || '|source_outcome=' || p_source_shadow_outcome_id::text
      || '|replacement_proof=' || p_replacement_shadow_proof_request_id::text
      || '|replacement_job=' || p_replacement_shadow_verification_job_id::text
      || '|pilot=' || p_pilot_revision_id::text
      || '|profile=' || p_receiver_profile_id::text
      || '|enrollment=' || p_device_enrollment_id::text
      || '|signer=' || p_assignment_signer_id::text
      || '|source_attempts=' || p_source_attempt_count::text
      || '|source_attempt_digest=' || p_source_attempt_history_digest
      || '|source_staged=' || p_source_staged_evidence_count::text
      || '|source_evidence_digest=' || p_source_evidence_history_digest
      || '|source_provider_identity_reviews='
      || p_source_provider_identity_review_count::text
      || '|source_outcomes=' || p_source_outcome_count::text
      || '|authorized_at_us='
      || (extract(epoch from p_authorized_at) * 1000000)::numeric(30,0)::text
      || '|retry_expires_at_us='
      || (extract(epoch from p_retry_expires_at) * 1000000)::numeric(30,0)::text
      || '|reviewed_main=' || p_reviewed_main_commit_sha
      || '|reason=' || p_reason_code
  );
end;
$$;

create function app.private_telebirr_shadow_provider_origin_retry_child_is_valid(
  p_replacement app.private_telebirr_shadow_proof_requests,
  p_retry_request_key uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  retry app.private_telebirr_shadow_provider_origin_retries%rowtype;
  source_layout app.private_telebirr_shadow_source_binding_layout_retries%rowtype;
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  source_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  expected_digest text;
  attempt_count integer;
  staged_count integer;
  provider_identity_review_count integer;
  outcome_count integer;
begin
  if p_replacement.id is null or p_retry_request_key is null then
    return false;
  end if;

  select candidate.* into retry
    from app.private_telebirr_shadow_provider_origin_retries candidate
   where candidate.retry_request_key = p_retry_request_key
     and candidate.replacement_shadow_proof_request_id = p_replacement.id;
  select candidate.* into source_layout
    from app.private_telebirr_shadow_source_binding_layout_retries candidate
   where candidate.retry_request_key = retry.source_layout_retry_request_key;
  select proof.* into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = retry.source_shadow_proof_request_id
     and proof.verification_job_id = retry.source_shadow_verification_job_id;
  select outcome.* into source_outcome
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.id = retry.source_shadow_outcome_id
     and outcome.shadow_proof_request_id = source_proof.id;
  select candidate.* into pilot
    from app.private_live_deposit_pilot_revisions candidate
   where candidate.id = retry.pilot_revision_id;
  select candidate.* into profile
    from app.private_live_telebirr_receiver_profiles candidate
   where candidate.id = retry.receiver_profile_id;

  select pg_catalog.count(*)::integer into attempt_count
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.shadow_proof_request_id = source_proof.id;
  select pg_catalog.count(*)::integer into staged_count
    from app.private_telebirr_shadow_device_evidence_staging staged
    join app.private_telebirr_shadow_verification_attempts attempt
      on attempt.id = staged.verification_attempt_id
   where attempt.shadow_proof_request_id = source_proof.id;
  select pg_catalog.count(*)::integer into provider_identity_review_count
    from app.private_telebirr_shadow_device_evidence_staging staged
    join app.private_telebirr_shadow_verification_attempts attempt
      on attempt.id = staged.verification_attempt_id
   where attempt.shadow_proof_request_id = source_proof.id
     and staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason' =
         'unknown_layout_provider_identity';
  select pg_catalog.count(*)::integer into outcome_count
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.shadow_proof_request_id = source_proof.id;

  expected_digest := app.private_telebirr_shadow_provider_origin_retry_digest(
    retry.retry_request_key,
    retry.source_layout_retry_request_key,
    retry.source_layout_retry_request_digest,
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
    retry.source_provider_identity_review_count,
    retry.source_outcome_count,
    retry.authorized_at,
    retry.retry_expires_at,
    retry.reviewed_main_commit_sha,
    retry.reason_code
  );

  return retry.retry_request_key is not null
    and retry.retry_request_digest = expected_digest
    and retry.source_layout_retry_request_digest = source_layout.retry_request_digest
    and source_layout.replacement_shadow_proof_request_id = source_proof.id
    and source_layout.replacement_shadow_verification_job_id =
        source_proof.verification_job_id
    and app.private_telebirr_shadow_source_binding_layout_retry_is_valid(
          source_proof.id,
          source_layout.retry_request_key
        )
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
             'unknown_layout_provider_identity'
    )
    and attempt_count = retry.source_attempt_count
    and app.private_telebirr_shadow_retry_attempt_history_digest(source_proof.id) =
        retry.source_attempt_history_digest
    and staged_count = retry.source_staged_evidence_count
    and app.private_telebirr_shadow_layout_evidence_history_digest(source_proof.id) =
        retry.source_evidence_history_digest
    and provider_identity_review_count = retry.source_provider_identity_review_count
    and outcome_count = retry.source_outcome_count
    and pilot.id = source_proof.pilot_revision_id
    and pilot.id = source_layout.target_pilot_revision_id
    and profile.id = source_proof.receiver_profile_id
    and profile.id = source_layout.target_receiver_profile_id
    and p_replacement.id = retry.replacement_shadow_proof_request_id
    and p_replacement.verification_job_id = retry.replacement_shadow_verification_job_id
    and p_replacement.source_binding_layout_retry_source_id = source_proof.id
    and p_replacement.pilot_revision_id = pilot.id
    and p_replacement.receiver_profile_id = profile.id
    and p_replacement.submitting_customer_id = source_proof.submitting_customer_id
    and p_replacement.player_account_id = source_proof.player_account_id
    and p_replacement.payment_provider_id = source_proof.payment_provider_id
    and p_replacement.provider_code = source_proof.provider_code
    and p_replacement.pilot_configuration_digest = pilot.configuration_digest
    and p_replacement.origin_channel = source_proof.origin_channel
    and p_replacement.input_kind = source_proof.input_kind
    and p_replacement.candidate_reference_ciphertext =
        source_proof.candidate_reference_ciphertext
    and p_replacement.candidate_reference_fingerprint =
        source_proof.candidate_reference_fingerprint
    and p_replacement.candidate_reference_masked = source_proof.candidate_reference_masked
    and p_replacement.reference_encryption_key_version =
        source_proof.reference_encryption_key_version
    and p_replacement.reference_profile_version = source_proof.reference_profile_version
    and p_replacement.proof_status = 'verification_queued'
    and p_replacement.submitted_at = source_proof.submitted_at
    and p_replacement.not_before = source_proof.not_before
    and p_replacement.created_at = retry.authorized_at
    and p_replacement.expires_at = retry.retry_expires_at
    and retry.retry_expires_at = retry.authorized_at + interval '12 hours'
    and retry.authorized_at <= pg_catalog.clock_timestamp()
    and retry.retry_expires_at > pg_catalog.clock_timestamp()
    and retry.reason_code = 'reviewed_receipt_provider_origin_retry_no_credit'
    and pilot.status = 'armed'
    and pilot.expires_at = pilot.active_from + interval '12 hours'
    and profile.pilot_revision_id = pilot.id
    and profile.valid_from <= pg_catalog.clock_timestamp()
    and profile.valid_until > pg_catalog.clock_timestamp() + interval '5 minutes'
    and app.private_telebirr_shadow_source_binding_window_enrollment_is_ready(
          pilot.id,
          profile.id,
          retry.device_enrollment_id,
          retry.assignment_signer_id,
          pg_catalog.clock_timestamp() + interval '5 minutes'
        )
    and app.private_telebirr_shadow_source_binding_window_boundary_is_ready(pilot.id)
    and not exists (
      select 1
        from app.private_live_deposit_pilot_reservations reservation
       where reservation.pilot_revision_id = pilot.id
    )
    and not exists (select 1 from app.private_live_telebirr_settlement_receipts)
    and not exists (select 1 from app.deposit_jobs)
    and not exists (
      select 1
        from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = source_proof.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             source_proof.candidate_reference_fingerprint
    );
exception
  when others then
    return false;
end;
$$;

create function app.private_telebirr_shadow_provider_origin_retry_is_valid(
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
  replacement app.private_telebirr_shadow_proof_requests%rowtype;
begin
  select proof.* into replacement
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = p_replacement_shadow_proof_request_id;
  return app.private_telebirr_shadow_provider_origin_retry_child_is_valid(
    replacement,
    p_retry_request_key
  );
exception
  when others then
    return false;
end;
$$;

-- Let the established receipt-layout lineage validator recognize the one reviewed provider-origin
-- child while retaining its exact historical implementation for the original receipt-layout row.
do $bind_provider_origin_retry_validator$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.private_telebirr_shadow_source_binding_layout_retry_is_valid(uuid,uuid)'
  );
  expected_source_sha256 constant text :=
    'c15fd6369905488f65fd9ea7dc0f6d65bd727ecf796c9ce4f61fe1d3dbcbb91c';
  old_fragment constant text :=
    'begin' || pg_catalog.chr(10)
    || '  if p_replacement_shadow_proof_request_id is null';
  new_fragment constant text :=
    'begin' || pg_catalog.chr(10)
    || '  if exists (' || pg_catalog.chr(10)
    || '    select 1' || pg_catalog.chr(10)
    || '      from app.private_telebirr_shadow_provider_origin_retries origin_retry'
    || pg_catalog.chr(10)
    || '     where origin_retry.retry_request_key = p_retry_request_key'
    || pg_catalog.chr(10)
    || '       and origin_retry.replacement_shadow_proof_request_id ='
    || pg_catalog.chr(10)
    || '           p_replacement_shadow_proof_request_id'
    || pg_catalog.chr(10)
    || '  ) then' || pg_catalog.chr(10)
    || '    return app.private_telebirr_shadow_provider_origin_retry_is_valid('
    || pg_catalog.chr(10)
    || '      p_replacement_shadow_proof_request_id,' || pg_catalog.chr(10)
    || '      p_retry_request_key' || pg_catalog.chr(10)
    || '    );' || pg_catalog.chr(10)
    || '  end if;' || pg_catalog.chr(10) || pg_catalog.chr(10)
    || '  if p_replacement_shadow_proof_request_id is null';
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
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, ''))
    ) / pg_catalog.length(old_fragment) <> 1
    or pg_catalog.strpos(original_source, new_fragment) <> 0 then
    raise exception 'The receipt-layout validator shape is not reviewed.';
  end if;

  rewritten_definition := pg_catalog.replace(original_definition, old_fragment, new_fragment);
  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
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
    raise exception 'The provider-origin validator rewrite changed its authority.';
  end if;
end;
$bind_provider_origin_retry_validator$;

-- The existing lineage trigger remains the only trigger for this proof branch. Insert an exact
-- reviewed provider-origin path ahead of its historical receipt-layout path.
do $bind_provider_origin_retry_insert_guard$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.guard_private_tbirr_shadow_source_binding_layout_retry_insert()'
  );
  expected_source_sha256 constant text :=
    '71a3d77371c4cd9e27fad0beba66192d4ae8af0cd7690a0646592b263fced9b2';
  old_fragment constant text :=
    'begin' || pg_catalog.chr(10)
    || '  if new.source_binding_layout_retry_source_id is null then';
  new_fragment constant text :=
    'begin' || pg_catalog.chr(10)
    || '  if pg_catalog.current_setting(''app.private_telebirr_shadow_provider_origin_retry'', true)'
    || pg_catalog.chr(10)
    || '       ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'' then'
    || pg_catalog.chr(10)
    || '    if app.private_telebirr_shadow_provider_origin_retry_child_is_valid('
    || pg_catalog.chr(10)
    || '      new,' || pg_catalog.chr(10)
    || '      pg_catalog.current_setting(''app.private_telebirr_shadow_provider_origin_retry'', true)::uuid'
    || pg_catalog.chr(10)
    || '    ) then' || pg_catalog.chr(10)
    || '      return new;' || pg_catalog.chr(10)
    || '    end if;' || pg_catalog.chr(10)
    || '    raise exception ''The provider-origin retry child is invalid.'';'
    || pg_catalog.chr(10)
    || '  end if;' || pg_catalog.chr(10) || pg_catalog.chr(10)
    || '  if new.source_binding_layout_retry_source_id is null then';
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
     and routine.pronargs = 0
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
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, ''))
    ) / pg_catalog.length(old_fragment) <> 1
    or pg_catalog.strpos(original_source, new_fragment) <> 0 then
    raise exception 'The receipt-layout insert guard shape is not reviewed.';
  end if;

  rewritten_definition := pg_catalog.replace(original_definition, old_fragment, new_fragment);
  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
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
    raise exception 'The provider-origin insert-guard rewrite changed its authority.';
  end if;
end;
$bind_provider_origin_retry_insert_guard$;

-- Reuse the established receipt-layout deadline branch for the new child by resolving the newest
-- ledger first. The caller still falls back to the elapsed historical submission deadline when
-- either lineage validator fails.
do $bind_provider_origin_retry_deadline$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.private_telebirr_shadow_source_binding_layout_review_deadline(uuid)'
  );
  expected_source_sha256 constant text :=
    '4a6605b54274354f9f2fb84802bfe2d586ca604ceb5a19fc52ca34e8f20ab2fa';
  old_declare constant text :=
    'declare' || pg_catalog.chr(10)
    || '  retry app.private_telebirr_shadow_source_binding_layout_retries%rowtype;';
  new_declare constant text :=
    old_declare || pg_catalog.chr(10)
    || '  origin_retry app.private_telebirr_shadow_provider_origin_retries%rowtype;';
  old_begin constant text :=
    'begin' || pg_catalog.chr(10)
    || '  select candidate.* into retry';
  new_begin constant text :=
    'begin' || pg_catalog.chr(10)
    || '  select candidate.* into origin_retry' || pg_catalog.chr(10)
    || '    from app.private_telebirr_shadow_provider_origin_retries candidate'
    || pg_catalog.chr(10)
    || '   where candidate.replacement_shadow_proof_request_id = p_shadow_proof_request_id;'
    || pg_catalog.chr(10) || pg_catalog.chr(10)
    || '  if origin_retry.retry_request_key is not null' || pg_catalog.chr(10)
    || '    and app.private_telebirr_shadow_source_binding_layout_retry_is_valid('
    || pg_catalog.chr(10)
    || '      p_shadow_proof_request_id,' || pg_catalog.chr(10)
    || '      origin_retry.retry_request_key' || pg_catalog.chr(10)
    || '    ) then' || pg_catalog.chr(10)
    || '    return origin_retry.retry_expires_at;' || pg_catalog.chr(10)
    || '  end if;' || pg_catalog.chr(10) || pg_catalog.chr(10)
    || '  select candidate.* into retry';
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
     and routine.pronargs = 1
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
      - pg_catalog.length(pg_catalog.replace(original_source, old_declare, ''))
    ) / pg_catalog.length(old_declare) <> 1
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_begin, ''))
    ) / pg_catalog.length(old_begin) <> 1 then
    raise exception 'The receipt-layout review deadline shape is not reviewed.';
  end if;

  rewritten_definition := pg_catalog.replace(original_definition, old_declare, new_declare);
  rewritten_definition := pg_catalog.replace(rewritten_definition, old_begin, new_begin);
  rewritten_source := pg_catalog.replace(original_source, old_declare, new_declare);
  rewritten_source := pg_catalog.replace(rewritten_source, old_begin, new_begin);
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
    raise exception 'The provider-origin deadline rewrite changed its authority.';
  end if;
end;
$bind_provider_origin_retry_deadline$;

create function app.retry_reviewed_private_telebirr_receipt_provider_origin(
  p_reviewed_main_commit_sha text,
  p_reason_code text
)
returns table (
  created boolean,
  origin_retry_count integer,
  shadow_request_count integer,
  source_shadow_attempt_count integer,
  source_staged_evidence_count integer,
  source_provider_identity_review_count integer,
  source_shadow_outcome_count integer,
  replacement_shadow_attempt_count integer,
  replacement_shadow_outcome_count integer,
  ready_enrollment_count integer,
  configured_window_seconds integer,
  remaining_seconds integer,
  money_moved boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  existing_retry app.private_telebirr_shadow_provider_origin_retries%rowtype;
  source_layout app.private_telebirr_shadow_source_binding_layout_retries%rowtype;
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  source_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
  target_pilot app.private_live_deposit_pilot_revisions%rowtype;
  target_profile app.private_live_telebirr_receiver_profiles%rowtype;
  inserted_proof app.private_telebirr_shadow_proof_requests%rowtype;
  target_enrollment_id uuid;
  target_signer_id uuid;
  existing_retry_count integer;
  candidate_count integer;
  locked_switch_count integer;
  v_ready_enrollment_count integer;
  source_attempts integer;
  source_staged integer;
  source_provider_reviews integer;
  source_outcomes integer;
  source_attempt_digest text;
  source_evidence_digest text;
  v_retry_request_key uuid;
  replacement_proof_id uuid;
  replacement_job_id uuid;
  retry_digest text;
  v_authorized_at timestamptz;
  v_retry_until timestamptz;
begin
  if session_user <> 'postgres'
    or p_reviewed_main_commit_sha !~ '^[0-9a-f]{40}$'
    or p_reason_code is distinct from
       'reviewed_receipt_provider_origin_retry_no_credit'
    or pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The provider-origin retry request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:production:telebirr-shadow-verifier-runtime',
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:reviewed-receipt-provider-origin-retry',
      0
    )
  );
  perform app.lock_private_trusted_telebirr_activation_authority();

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification',
     'withdrawal_collection',
     'withdrawal_validation'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics locked_switch_count = row_count;

  v_authorized_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_retry_until := v_authorized_at + interval '12 hours';

  if exists (
    select 1 from pg_catalog.pg_roles role
     where role.rolname in (
       'fetanagent_deposit_executor',
       'fetanagent_deposit_executor_runtime',
       'fetanagent_trusted_telebirr_verifier',
       'fetanagent_trusted_telebirr_verifier_runtime',
       'fetanagent_telebirr_shadow_verifier',
       'fetanagent_telebirr_shadow_verifier_runtime'
     ) and role.rolcanlogin
  ) or exists (
    select 1 from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_deposit_executor',
       'fetanagent_deposit_executor_runtime',
       'fetanagent_trusted_telebirr_verifier',
       'fetanagent_trusted_telebirr_verifier_runtime',
       'fetanagent_telebirr_shadow_verifier',
       'fetanagent_telebirr_shadow_verifier_runtime'
     ) and activity.pid <> pg_catalog.pg_backend_pid()
  ) then
    raise exception 'The provider-origin retry requires every execution login and session absent.';
  end if;

  select pg_catalog.count(*)::integer into existing_retry_count
    from app.private_telebirr_shadow_provider_origin_retries;
  select retry.* into existing_retry
    from app.private_telebirr_shadow_provider_origin_retries retry
   order by retry.authorized_at desc, retry.retry_request_key
   limit 1
   for share;

  if existing_retry_count <> 0 then
    if existing_retry_count = 1
      and existing_retry.reviewed_main_commit_sha = p_reviewed_main_commit_sha
      and existing_retry.reason_code = p_reason_code
      and app.private_telebirr_shadow_provider_origin_retry_is_valid(
            existing_retry.replacement_shadow_proof_request_id,
            existing_retry.retry_request_key
          ) then
      return query
      select false, 1, 1,
             existing_retry.source_attempt_count,
             existing_retry.source_staged_evidence_count,
             existing_retry.source_provider_identity_review_count,
             existing_retry.source_outcome_count,
             (select pg_catalog.count(*)::integer
                from app.private_telebirr_shadow_verification_attempts attempt
               where attempt.shadow_proof_request_id =
                     existing_retry.replacement_shadow_proof_request_id),
             (select pg_catalog.count(*)::integer
                from app.private_telebirr_shadow_verification_outcomes outcome
               where outcome.shadow_proof_request_id =
                     existing_retry.replacement_shadow_proof_request_id),
             1,
             43200,
             greatest(0, extract(epoch from (
               existing_retry.retry_expires_at - pg_catalog.clock_timestamp()
             ))::integer),
             false;
      return;
    end if;
    raise exception 'The provider-origin retry already exists or conflicts.';
  end if;

  select pg_catalog.count(*)::integer into candidate_count
    from app.private_telebirr_shadow_source_binding_layout_retries layout_retry
    join app.private_telebirr_shadow_proof_requests proof
      on proof.id = layout_retry.replacement_shadow_proof_request_id
     and proof.verification_job_id = layout_retry.replacement_shadow_verification_job_id
    join app.private_telebirr_shadow_verification_outcomes outcome
      on outcome.shadow_proof_request_id = proof.id
    left join app.private_telebirr_shadow_provider_origin_retries origin_retry
      on origin_retry.source_layout_retry_request_key = layout_retry.retry_request_key
   where origin_retry.retry_request_key is null
     and layout_retry.reason_code =
         'reviewed_source_binding_receipt_layout_retry_no_credit'
     and proof.proof_status = 'verification_queued'
     and outcome.protocol_disposition = 'would_review'
     and outcome.protocol_reason_code = 'receipt_requires_review'
     and outcome.disposition = 'review_required'
     and outcome.reason_code = 'parser_uncertain'
     and app.private_telebirr_shadow_source_binding_layout_retry_is_valid(
           proof.id,
           layout_retry.retry_request_key
         );

  if candidate_count <> 1 then
    raise exception 'Exactly one provider-identity review source is required.';
  end if;

  select layout_retry.* into source_layout
    from app.private_telebirr_shadow_source_binding_layout_retries layout_retry
    join app.private_telebirr_shadow_proof_requests proof
      on proof.id = layout_retry.replacement_shadow_proof_request_id
     and proof.verification_job_id = layout_retry.replacement_shadow_verification_job_id
    join app.private_telebirr_shadow_verification_outcomes outcome
      on outcome.shadow_proof_request_id = proof.id
    left join app.private_telebirr_shadow_provider_origin_retries origin_retry
      on origin_retry.source_layout_retry_request_key = layout_retry.retry_request_key
   where origin_retry.retry_request_key is null
     and layout_retry.reason_code =
         'reviewed_source_binding_receipt_layout_retry_no_credit'
     and proof.proof_status = 'verification_queued'
     and outcome.protocol_disposition = 'would_review'
     and outcome.protocol_reason_code = 'receipt_requires_review'
     and outcome.disposition = 'review_required'
     and outcome.reason_code = 'parser_uncertain'
     and app.private_telebirr_shadow_source_binding_layout_retry_is_valid(
           proof.id,
           layout_retry.retry_request_key
         )
   for share of layout_retry, proof, outcome;

  select proof.* into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = source_layout.replacement_shadow_proof_request_id
     and proof.verification_job_id = source_layout.replacement_shadow_verification_job_id
   for key share;
  select outcome.* into source_outcome
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.shadow_proof_request_id = source_proof.id
   for share;
  select pilot.* into target_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = source_proof.pilot_revision_id
   for update;
  select profile.* into target_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.id = source_proof.receiver_profile_id
   for share;

  select pg_catalog.count(*)::integer into v_ready_enrollment_count
    from app.private_live_telebirr_device_enrollments enrollment
    join app.private_live_telebirr_device_enrollment_certificates certificate
      on certificate.device_enrollment_id = enrollment.id
    join app.private_live_telebirr_device_pairing_challenges pairing
      on pairing.pairing_id = certificate.pairing_id
     and pairing.reserved_enrollment_id = enrollment.id
    join app.private_live_telebirr_assignment_signers signer
      on signer.id = pairing.assignment_signer_id
    join app.private_live_telebirr_device_heartbeats heartbeat
      on heartbeat.device_enrollment_id = enrollment.id
   where enrollment.pilot_revision_id = target_pilot.id
     and enrollment.receiver_profile_id = target_profile.id
     and pairing.pilot_revision_id = target_pilot.id
     and pairing.receiver_profile_id = target_profile.id
     and pairing.state = 'completed'
     and pairing.completed_at is not null
     and enrollment.valid_from <= v_authorized_at
     and enrollment.valid_until > v_authorized_at + interval '5 minutes'
     and pairing.certificate_valid_from <= v_authorized_at
     and pairing.certificate_valid_until > v_authorized_at + interval '5 minutes'
     and signer.valid_from <= v_authorized_at
     and signer.valid_until > v_authorized_at + interval '5 minutes'
     and heartbeat.runtime_state = 'ready'
     and heartbeat.status_code = 'no_assignment'
     and heartbeat.app_version = '0.5.5-evidence-only'
     and heartbeat.last_seen_at > v_authorized_at - interval '5 minutes'
     and not exists (
       select 1 from app.private_live_telebirr_device_revocations revocation
        where revocation.device_enrollment_id = enrollment.id
          and revocation.revoked_at <= v_authorized_at
     )
     and not exists (
       select 1 from app.private_live_telebirr_assignment_signer_revocations revocation
        where revocation.assignment_signer_id = signer.id
          and revocation.revoked_at <= v_authorized_at
     );

  select enrollment.id, signer.id into target_enrollment_id, target_signer_id
    from app.private_live_telebirr_device_enrollments enrollment
    join app.private_live_telebirr_device_enrollment_certificates certificate
      on certificate.device_enrollment_id = enrollment.id
    join app.private_live_telebirr_device_pairing_challenges pairing
      on pairing.pairing_id = certificate.pairing_id
     and pairing.reserved_enrollment_id = enrollment.id
    join app.private_live_telebirr_assignment_signers signer
      on signer.id = pairing.assignment_signer_id
    join app.private_live_telebirr_device_heartbeats heartbeat
      on heartbeat.device_enrollment_id = enrollment.id
   where enrollment.pilot_revision_id = target_pilot.id
     and enrollment.receiver_profile_id = target_profile.id
     and pairing.pilot_revision_id = target_pilot.id
     and pairing.receiver_profile_id = target_profile.id
     and pairing.state = 'completed'
     and pairing.completed_at is not null
     and enrollment.valid_from <= v_authorized_at
     and enrollment.valid_until > v_authorized_at + interval '5 minutes'
     and pairing.certificate_valid_from <= v_authorized_at
     and pairing.certificate_valid_until > v_authorized_at + interval '5 minutes'
     and signer.valid_from <= v_authorized_at
     and signer.valid_until > v_authorized_at + interval '5 minutes'
     and heartbeat.runtime_state = 'ready'
     and heartbeat.status_code = 'no_assignment'
     and heartbeat.app_version = '0.5.5-evidence-only'
     and heartbeat.last_seen_at > v_authorized_at - interval '5 minutes'
     and not exists (
       select 1 from app.private_live_telebirr_device_revocations revocation
        where revocation.device_enrollment_id = enrollment.id
          and revocation.revoked_at <= v_authorized_at
     )
     and not exists (
       select 1 from app.private_live_telebirr_assignment_signer_revocations revocation
        where revocation.assignment_signer_id = signer.id
          and revocation.revoked_at <= v_authorized_at
     )
   for share of enrollment, certificate, pairing, signer, heartbeat;

  select pg_catalog.count(*)::integer into source_attempts
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.shadow_proof_request_id = source_proof.id;
  select pg_catalog.count(*)::integer into source_staged
    from app.private_telebirr_shadow_device_evidence_staging staged
    join app.private_telebirr_shadow_verification_attempts attempt
      on attempt.id = staged.verification_attempt_id
   where attempt.shadow_proof_request_id = source_proof.id;
  select pg_catalog.count(*)::integer into source_provider_reviews
    from app.private_telebirr_shadow_device_evidence_staging staged
    join app.private_telebirr_shadow_verification_attempts attempt
      on attempt.id = staged.verification_attempt_id
   where attempt.shadow_proof_request_id = source_proof.id
     and staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason' =
         'unknown_layout_provider_identity';
  select pg_catalog.count(*)::integer into source_outcomes
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.shadow_proof_request_id = source_proof.id;
  source_attempt_digest :=
    app.private_telebirr_shadow_retry_attempt_history_digest(source_proof.id);
  source_evidence_digest :=
    app.private_telebirr_shadow_layout_evidence_history_digest(source_proof.id);

  if locked_switch_count <> 7
    or source_layout.retry_request_key is null
    or source_proof.id is null
    or source_outcome.id is null
    or target_pilot.id is null
    or target_profile.id is null
    or v_ready_enrollment_count <> 1
    or target_enrollment_id is null
    or target_signer_id is null
    or source_attempts not between 1 and 100
    or source_staged <> source_attempts
    or source_provider_reviews <> source_attempts
    or source_outcomes <> 1
    or source_attempt_digest !~ '^sha256:[0-9a-f]{64}$'
    or source_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
    or source_outcome.protocol_disposition <> 'would_review'
    or source_outcome.protocol_reason_code <> 'receipt_requires_review'
    or source_outcome.disposition <> 'review_required'
    or source_outcome.reason_code <> 'parser_uncertain'
    or source_outcome.principal_amount_minor is not null
    or source_outcome.occurred_at is not null
    or source_outcome.receiver_identity_digest is not null
    or source_layout.target_pilot_revision_id <> target_pilot.id
    or source_layout.target_receiver_profile_id <> target_profile.id
    or target_pilot.status <> 'armed'
    or target_pilot.expires_at is distinct from target_pilot.active_from + interval '12 hours'
    or target_pilot.expires_at <= v_authorized_at + interval '1 hour'
    or target_profile.valid_from > v_authorized_at
    or target_profile.valid_until <= v_authorized_at + interval '5 minutes'
    or not app.private_telebirr_shadow_source_binding_layout_retry_is_valid(
         source_proof.id,
         source_layout.retry_request_key
       )
    or not app.private_telebirr_shadow_source_binding_window_enrollment_is_ready(
         target_pilot.id,
         target_profile.id,
         target_enrollment_id,
         target_signer_id,
         v_authorized_at + interval '5 minutes'
       )
    or not app.private_telebirr_shadow_source_binding_window_boundary_is_ready(
         target_pilot.id
       )
    or exists (select 1 from app.private_live_deposit_pilot_reservations)
    or exists (select 1 from app.private_live_telebirr_settlement_receipts)
    or exists (select 1 from app.deposit_jobs)
    or exists (
      select 1 from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = source_proof.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             source_proof.candidate_reference_fingerprint
    ) then
    raise exception 'The provider-identity review is not safely retryable.';
  end if;

  v_retry_request_key := pg_catalog.gen_random_uuid();
  replacement_proof_id := pg_catalog.gen_random_uuid();
  replacement_job_id := pg_catalog.gen_random_uuid();
  retry_digest := app.private_telebirr_shadow_provider_origin_retry_digest(
    v_retry_request_key,
    source_layout.retry_request_key,
    source_layout.retry_request_digest,
    source_proof.id,
    source_proof.verification_job_id,
    source_outcome.id,
    replacement_proof_id,
    replacement_job_id,
    target_pilot.id,
    target_profile.id,
    target_enrollment_id,
    target_signer_id,
    source_attempts,
    source_attempt_digest,
    source_staged,
    source_evidence_digest,
    source_provider_reviews,
    source_outcomes,
    v_authorized_at,
    v_retry_until,
    p_reviewed_main_commit_sha,
    p_reason_code
  );

  insert into app.private_telebirr_shadow_provider_origin_retries (
    retry_request_key, retry_request_digest,
    source_layout_retry_request_key, source_layout_retry_request_digest,
    source_shadow_proof_request_id, source_shadow_verification_job_id,
    source_shadow_outcome_id,
    replacement_shadow_proof_request_id, replacement_shadow_verification_job_id,
    pilot_revision_id, receiver_profile_id, device_enrollment_id, assignment_signer_id,
    source_attempt_count, source_attempt_history_digest,
    source_staged_evidence_count, source_evidence_history_digest,
    source_provider_identity_review_count, source_outcome_count,
    authorized_at, retry_expires_at, reviewed_main_commit_sha, reason_code
  ) values (
    v_retry_request_key, retry_digest,
    source_layout.retry_request_key, source_layout.retry_request_digest,
    source_proof.id, source_proof.verification_job_id,
    source_outcome.id,
    replacement_proof_id, replacement_job_id,
    target_pilot.id, target_profile.id, target_enrollment_id, target_signer_id,
    source_attempts, source_attempt_digest,
    source_staged, source_evidence_digest,
    source_provider_reviews, source_outcomes,
    v_authorized_at, v_retry_until, p_reviewed_main_commit_sha, p_reason_code
  );

  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_provider_origin_retry',
    v_retry_request_key::text,
    true
  );
  insert into app.private_telebirr_shadow_proof_requests (
    id, verification_job_id, pilot_revision_id,
    submitting_customer_id, player_account_id, payment_provider_id, provider_code,
    receiver_profile_id, pilot_configuration_digest,
    origin_channel, input_kind,
    candidate_reference_ciphertext, candidate_reference_fingerprint,
    candidate_reference_masked, reference_encryption_key_version,
    reference_profile_version, proof_status,
    submitted_at, not_before, expires_at, created_at,
    source_binding_layout_retry_source_id
  ) values (
    replacement_proof_id, replacement_job_id, target_pilot.id,
    source_proof.submitting_customer_id, source_proof.player_account_id,
    source_proof.payment_provider_id, source_proof.provider_code,
    target_profile.id, target_pilot.configuration_digest,
    source_proof.origin_channel, source_proof.input_kind,
    source_proof.candidate_reference_ciphertext,
    source_proof.candidate_reference_fingerprint,
    source_proof.candidate_reference_masked,
    source_proof.reference_encryption_key_version,
    source_proof.reference_profile_version,
    'verification_queued',
    source_proof.submitted_at, source_proof.not_before,
    v_retry_until, v_authorized_at,
    source_proof.id
  ) returning * into inserted_proof;
  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_provider_origin_retry',
    'off',
    true
  );

  if not app.private_telebirr_shadow_provider_origin_retry_is_valid(
    inserted_proof.id,
    v_retry_request_key
  ) then
    raise exception 'The provider-origin retry did not validate exactly.';
  end if;

  insert into app.audit_events (
    actor_kind, actor_label, action, resource_type, resource_id, metadata
  ) values (
    'worker',
    'reviewed-receipt-provider-origin-retry',
    'deposit.telebirr_receipt_provider_origin_retried',
    'private_live_deposit_pilot',
    target_pilot.id,
    pg_catalog.jsonb_build_object(
      'reason_code', p_reason_code,
      'configured_window_seconds', 43200,
      'source_attempt_count', source_attempts,
      'source_staged_evidence_count', source_staged,
      'source_provider_identity_review_count', source_provider_reviews,
      'source_outcome_count', source_outcomes,
      'financial_rows_created', false,
      'execution_enabled', false,
      'money_moved', false
    )
  );

  return query
  select true, 1, 1,
         source_attempts, source_staged, source_provider_reviews, source_outcomes,
         0, 0, v_ready_enrollment_count,
         43200,
         greatest(0, extract(epoch from (
           v_retry_until - pg_catalog.clock_timestamp()
         ))::integer),
         false;
end;
$$;

create trigger private_tbirr_shadow_origin_retries_immutable
before update or delete on app.private_telebirr_shadow_provider_origin_retries
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger private_tbirr_shadow_origin_retries_no_truncate
before truncate on app.private_telebirr_shadow_provider_origin_retries
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

alter table app.private_telebirr_shadow_provider_origin_retries enable row level security;
alter table app.private_telebirr_shadow_provider_origin_retries force row level security;
alter table app.private_telebirr_shadow_provider_origin_retries owner to postgres;

alter function app.private_telebirr_shadow_provider_origin_retry_digest(
  uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  integer, text, integer, text, integer, integer, timestamptz, timestamptz, text, text
) owner to postgres;
alter function app.private_telebirr_shadow_provider_origin_retry_child_is_valid(
  app.private_telebirr_shadow_proof_requests, uuid
) owner to postgres;
alter function app.private_telebirr_shadow_provider_origin_retry_is_valid(uuid, uuid)
  owner to postgres;
alter function app.retry_reviewed_private_telebirr_receipt_provider_origin(text, text)
  owner to postgres;

revoke all on table app.private_telebirr_shadow_provider_origin_retries
  from public, anon, authenticated, service_role;
revoke all on function app.private_telebirr_shadow_provider_origin_retry_digest(
  uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  integer, text, integer, text, integer, integer, timestamptz, timestamptz, text, text
) from public, anon, authenticated, service_role;
revoke all on function app.private_telebirr_shadow_provider_origin_retry_child_is_valid(
  app.private_telebirr_shadow_proof_requests, uuid
) from public, anon, authenticated, service_role;
revoke all on function app.private_telebirr_shadow_provider_origin_retry_is_valid(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app.retry_reviewed_private_telebirr_receipt_provider_origin(text, text)
  from public, anon, authenticated, service_role;

comment on table app.private_telebirr_shadow_provider_origin_retries is
  'Immutable one-use no-money lineage for re-evaluating one signed receipt after provider identity moved from mutable branding to authenticated official transport origin.';
comment on function app.private_telebirr_shadow_provider_origin_retry_is_valid(uuid, uuid) is
  'Validates the exact provider-origin retry child, its immutable review-only source, current paired verifier, and complete no-money boundary.';
comment on function app.retry_reviewed_private_telebirr_receipt_provider_origin(text, text) is
  'Creates exactly one fixed twelve-hour append-only no-money child for the reviewed provider-origin parser correction.';

commit;
