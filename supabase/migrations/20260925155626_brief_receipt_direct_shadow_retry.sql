-- Reviewed no-credit retry for a direct TeleBirr shadow proof whose single
-- signed terminal observation could not locate an invoice number in a brief
-- official-origin page. The original proof, observation, and outcome remain
-- immutable. This migration creates no retry child and grants no money authority.

begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- Preserve the existing source-unavailable branch exactly. One additional
-- reason is available only through the reviewed direct-proof predicate below.
do $contract$
declare
  actual text;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into actual
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'app.private_telebirr_shadow_source_unavailable_retries'::regclass
     and constraint_row.conname =
         'private_telebirr_shadow_source_unavailable_re_reason_code_check';
  if actual is distinct from
       'CHECK ((reason_code = ''source_unavailable_review_retry_no_credit''::text))'
    or exists (
      select 1
        from app.private_telebirr_shadow_source_unavailable_retries retry
       where retry.reason_code <> 'source_unavailable_review_retry_no_credit'
    ) then
    raise exception 'The reviewed no-credit retry constraint changed.';
  end if;
end;
$contract$;

alter table app.private_telebirr_shadow_source_unavailable_retries
  drop constraint private_telebirr_shadow_source_unavailable_re_reason_code_check;
alter table app.private_telebirr_shadow_source_unavailable_retries
  add constraint private_telebirr_shadow_source_unavailable_re_reason_code_check
  check (reason_code in (
    'source_unavailable_review_retry_no_credit',
    'reviewed_direct_brief_receipt_retry_no_credit'
  ));

create function app.private_telebirr_direct_brief_source_is_valid(
  p_source_shadow_proof_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $brief_source$
  with source as materialized (
    select proof.id, proof.verification_job_id
      from app.private_telebirr_shadow_proof_requests proof
     where proof.id = p_source_shadow_proof_request_id
       and proof.proof_status = 'verification_queued'
       and proof.origin_channel = 'telegram'
       and proof.input_kind = 'direct_transaction_id'
       and proof.source_live_verification_job_id is null
       and proof.source_live_proof_id is null
       and proof.source_pilot_revision_id is null
       and proof.source_receiver_profile_id is null
       and proof.recovery_request_key is null
       and proof.retry_request_key is null
       and proof.infrastructure_retry_request_key is null
       and proof.runtime_retry_request_key is null
       and proof.source_unavailable_retry_source_id is null
       and proof.observation_clock_retry_source_id is null
       and proof.authority_deadline_retry_source_id is null
       and proof.assessment_clock_retry_source_id is null
       and proof.source_binding_window_retry_source_id is null
       and proof.source_binding_layout_retry_source_id is null
       and exists (
         select 1 from app.telegram_telebirr_shadow_proof_receipts receipt
          where receipt.shadow_proof_request_id = proof.id
       )
  ), attempt as materialized (
    select attempt.id, attempt.verification_job_id
      from app.private_telebirr_shadow_verification_attempts attempt
      join source on source.id = attempt.shadow_proof_request_id
  ), staged as materialized (
    select staged.observation_body_digest, staged.observed_at,
           staged.signed_observation,
           attempt.verification_job_id
      from app.private_telebirr_shadow_device_evidence_staging staged
      join attempt on attempt.id = staged.verification_attempt_id
  ), outcome as materialized (
    select outcome.*
      from app.private_telebirr_shadow_verification_outcomes outcome
      join source on source.id = outcome.shadow_proof_request_id
  )
  select (select pg_catalog.count(*) from source) = 1
     and (select pg_catalog.count(*) from attempt) = 1
     and (select pg_catalog.count(*) from staged) = 1
     and (select pg_catalog.count(*) from outcome) = 1
     and exists (
       select 1
         from source cross join staged cross join outcome
        where staged.verification_job_id = source.verification_job_id
          and outcome.verification_job_id = source.verification_job_id
          and outcome.observation_body_digest =
              staged.observation_body_digest
          and outcome.observed_at = staged.observed_at
          and staged.signed_observation #>> '{body,facts,lookupOutcome}' =
              'review_required'
          and staged.signed_observation #>> '{body,facts,reviewReason}' =
              'unknown_layout_invoice_number'
          and outcome.protocol_disposition = 'would_review'
          and outcome.protocol_reason_code = 'receipt_requires_review'
          and outcome.disposition = 'review_required'
          and outcome.reason_code = 'parser_uncertain'
          and not outcome.would_verify
          and outcome.principal_amount_minor is null
          and outcome.occurred_at is null
          and outcome.receiver_identity_digest is null
     )
     and not exists (
       select 1
         from app.private_telebirr_shadow_evidence_quarantine quarantine
         join attempt on attempt.id = quarantine.verification_attempt_id
     );
$brief_source$;

alter function app.private_telebirr_direct_brief_source_is_valid(uuid)
  owner to postgres;
revoke all on function app.private_telebirr_direct_brief_source_is_valid(uuid)
  from public, anon, authenticated, service_role;

do $pin_rewrite$
declare
  actual_count integer;
begin
  select pg_catalog.count(*)::integer into actual_count
    from (values
      ('private_telebirr_shadow_source_unavailable_retry_digest', 11, 'sha256:cac5a54a54b8ad475aba14d11100a92cfa4fe5385c42fcdf1a6d7c43a96dc527'),
      ('guard_private_telebirr_shadow_source_retry_insert', 0, 'sha256:841e13caa679eff4851b55ac27ffb69f372d588ab8a1a0769088eb2d6ccb98d1'),
      ('retry_private_telebirr_shadow_after_source_unavailable', 4, 'sha256:6a6557b544ffaaeacf552da21b193802406d6f04d8f722e654fe5d06ccbe73be'),
      ('private_telebirr_shadow_source_unavailable_retry_is_valid', 2, 'sha256:203dbbcc9cc949b76f7559b39d6b3dd33117812f0c4ce88cc5a43e56d484b69a')
    ) as expected(proname, pronargs, source_digest)
    join pg_catalog.pg_proc routine
      on routine.proname = expected.proname
     and routine.pronargs = expected.pronargs
     and routine.pronamespace = 'app'::regnamespace
     and app.private_live_deposit_pilot_sha256(routine.prosrc) =
         expected.source_digest
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role
        where role.rolname = 'postgres'
     );
  if actual_count <> 4 then
    raise exception 'The reviewed no-credit function definitions changed.';
  end if;
end;
$pin_rewrite$;

CREATE OR REPLACE FUNCTION app.private_telebirr_shadow_source_unavailable_retry_digest(p_retry_request_key uuid, p_source_shadow_proof_request_id uuid, p_source_shadow_verification_job_id uuid, p_source_outcome_id uuid, p_replacement_shadow_proof_request_id uuid, p_replacement_shadow_verification_job_id uuid, p_pilot_revision_id uuid, p_receiver_profile_id uuid, p_authorized_at timestamp with time zone, p_retry_expires_at timestamp with time zone, p_reason_code text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_retry_request_key is null
    or p_retry_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_source_shadow_proof_request_id is null
    or p_source_shadow_verification_job_id is null
    or p_source_outcome_id is null
    or p_replacement_shadow_proof_request_id is null
    or p_replacement_shadow_verification_job_id is null
    or p_pilot_revision_id is null
    or p_receiver_profile_id is null
    or p_authorized_at is null
    or p_retry_expires_at is null
    or (p_reason_code is distinct from
        'source_unavailable_review_retry_no_credit'
        and p_reason_code is distinct from
        'reviewed_direct_brief_receipt_retry_no_credit') then
    raise exception 'The TeleBirr source-unavailable retry digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:shadow-source-unavailable-retry:v1'
      || '|request_key=' || p_retry_request_key::text
      || '|source_shadow_proof_request_id=' || p_source_shadow_proof_request_id::text
      || '|source_shadow_verification_job_id=' || p_source_shadow_verification_job_id::text
      || '|source_outcome_id=' || p_source_outcome_id::text
      || '|replacement_shadow_proof_request_id='
      || p_replacement_shadow_proof_request_id::text
      || '|replacement_shadow_verification_job_id='
      || p_replacement_shadow_verification_job_id::text
      || '|pilot_revision_id=' || p_pilot_revision_id::text
      || '|receiver_profile_id=' || p_receiver_profile_id::text
      || '|authorized_at_us='
      || (extract(epoch from p_authorized_at) * 1000000)::bigint::text
      || '|retry_expires_at_us='
      || (extract(epoch from p_retry_expires_at) * 1000000)::bigint::text
      || '|reason_code=' || p_reason_code
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app.guard_private_telebirr_shadow_source_retry_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  source_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
begin
  if new.source_unavailable_retry_source_id is null then
    return new;
  end if;

  select proof.*
    into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = new.source_unavailable_retry_source_id
   for share;

  select outcome.*
    into source_outcome
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.shadow_proof_request_id = source_proof.id
   for share;

  if session_user <> 'postgres'
    or not (
      pg_catalog.current_setting(
        'app.private_telebirr_shadow_source_unavailable_retry', true
      ) is not distinct from 'on'
      or pg_catalog.current_setting(
        'app.private_telebirr_shadow_source_unavailable_retry', true
      ) is not distinct from 'brief_receipt'
    )
    or source_proof.id is null
    or (source_proof.source_unavailable_retry_source_id is not null
        and not app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
          source_proof.id
        ))
    or source_proof.source_live_verification_job_id is not null
    or source_proof.source_live_proof_id is not null
    or source_proof.source_pilot_revision_id is not null
    or source_proof.source_receiver_profile_id is not null
    or source_outcome.id is null
    or source_outcome.disposition is distinct from 'review_required'
    or not (
      (pg_catalog.current_setting(
         'app.private_telebirr_shadow_source_unavailable_retry', true
       ) is not distinct from 'on'
       and source_outcome.reason_code is not distinct from 'source_unavailable')
      or (pg_catalog.current_setting(
         'app.private_telebirr_shadow_source_unavailable_retry', true
       ) is not distinct from 'brief_receipt'
       and app.private_telebirr_direct_brief_source_is_valid(source_proof.id))
    )
    or source_outcome.protocol_disposition is distinct from 'would_review'
    or source_outcome.protocol_reason_code is distinct from 'receipt_requires_review'
    or source_outcome.would_verify
    or source_outcome.principal_amount_minor is not null
    or source_outcome.occurred_at is not null
    or source_outcome.receiver_identity_digest is not null
    or new.id = source_proof.id
    or new.verification_job_id = source_proof.verification_job_id
    or (case
         when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
           then new.pilot_revision_id = source_proof.pilot_revision_id
             or not app.private_live_telebirr_shadow_pilot_contract_matches(
               source_proof.pilot_revision_id, new.pilot_revision_id
             )
         else new.pilot_revision_id is distinct from source_proof.pilot_revision_id
       end)
    or new.submitting_customer_id is distinct from source_proof.submitting_customer_id
    or new.player_account_id is distinct from source_proof.player_account_id
    or new.payment_provider_id is distinct from source_proof.payment_provider_id
    or new.provider_code is distinct from source_proof.provider_code
    or (case
         when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
           then not app.private_live_telebirr_shadow_profile_contract_matches(
             source_proof.receiver_profile_id, new.receiver_profile_id
           )
         else new.receiver_profile_id is distinct from source_proof.receiver_profile_id
       end)
    or new.pilot_configuration_digest is distinct from (case
         when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
           then (select pilot.configuration_digest
                   from app.private_live_deposit_pilot_revisions pilot
                  where pilot.id = new.pilot_revision_id)
         else source_proof.pilot_configuration_digest
       end)
    or new.origin_channel is distinct from source_proof.origin_channel
    or new.input_kind is distinct from source_proof.input_kind
    or new.candidate_reference_ciphertext
         is distinct from source_proof.candidate_reference_ciphertext
    or new.candidate_reference_fingerprint
         is distinct from source_proof.candidate_reference_fingerprint
    or new.candidate_reference_masked is distinct from source_proof.candidate_reference_masked
    or new.reference_encryption_key_version
         is distinct from source_proof.reference_encryption_key_version
    or new.reference_profile_version is distinct from source_proof.reference_profile_version
    or new.proof_status is distinct from 'verification_queued'
    or new.submitted_at is distinct from source_proof.submitted_at
    or new.not_before is distinct from source_proof.not_before
    or new.expires_at <= pg_catalog.clock_timestamp() + interval '10 minutes'
    or new.expires_at > (case
         when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
            or app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
              source_proof.id
            )
           then new.created_at + interval '12 hours'
         else source_proof.submitted_at + interval '12 hours'
       end) then
    raise exception 'The TeleBirr source-unavailable replacement proof is invalid.';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app.retry_private_telebirr_shadow_after_source_unavailable(p_source_shadow_proof_request_id uuid, p_pilot_revision_id uuid, p_retry_request_key uuid, p_reason_code text)
 RETURNS TABLE(shadow_proof_request_id uuid, shadow_verification_job_id uuid, retry_expires_at timestamp with time zone, already_retried boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  authorized_at timestamptz;
  existing_retry app.private_telebirr_shadow_source_unavailable_retries%rowtype;
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  source_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  replacement_proof_id uuid;
  replacement_job_id uuid;
  retry_until timestamptz;
  retry_digest text;
begin
  if session_user <> 'postgres'
    or p_source_shadow_proof_request_id is null
    or p_pilot_revision_id is null
    or p_retry_request_key is null
    or p_retry_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (p_reason_code is distinct from
        'source_unavailable_review_retry_no_credit'
        and p_reason_code is distinct from
        'reviewed_direct_brief_receipt_retry_no_credit') then
    raise exception 'The source-unavailable no-credit retry request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:shadow-source-unavailable-retry:'
        || p_source_shadow_proof_request_id::text,
      0
    )
  );

  select retry.*
    into existing_retry
    from app.private_telebirr_shadow_source_unavailable_retries retry
   where retry.retry_request_key = p_retry_request_key
      or retry.source_shadow_proof_request_id = p_source_shadow_proof_request_id
   order by (retry.retry_request_key = p_retry_request_key) desc
   limit 1
   for share;

  if existing_retry.retry_request_key is not null then
    retry_digest := app.private_telebirr_shadow_source_unavailable_retry_digest(
      existing_retry.retry_request_key,
      existing_retry.source_shadow_proof_request_id,
      existing_retry.source_shadow_verification_job_id,
      existing_retry.source_outcome_id,
      existing_retry.replacement_shadow_proof_request_id,
      existing_retry.replacement_shadow_verification_job_id,
      existing_retry.pilot_revision_id,
      existing_retry.receiver_profile_id,
      existing_retry.authorized_at,
      existing_retry.retry_expires_at,
      existing_retry.reason_code
    );
    if existing_retry.retry_request_key is distinct from p_retry_request_key
      or existing_retry.source_shadow_proof_request_id
           is distinct from p_source_shadow_proof_request_id
      or existing_retry.pilot_revision_id is distinct from p_pilot_revision_id
      or existing_retry.reason_code is distinct from p_reason_code
      or existing_retry.retry_request_digest is distinct from retry_digest then
      raise exception 'The source-unavailable no-credit retry replay conflicts.';
    end if;

    return query
    select existing_retry.replacement_shadow_proof_request_id,
           existing_retry.replacement_shadow_verification_job_id,
           existing_retry.retry_expires_at,
           true;
    return;
  end if;

  perform app.require_private_telebirr_shadow_mode_ready(p_pilot_revision_id);
  authorized_at := pg_catalog.clock_timestamp();

  select proof.*
    into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = p_source_shadow_proof_request_id
   for update;
  select outcome.*
    into source_outcome
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.shadow_proof_request_id = source_proof.id
   for share;
  select candidate.*
    into pilot
    from app.private_live_deposit_pilot_revisions candidate
   where candidate.id = p_pilot_revision_id
   for share;
  select candidate.*
    into profile
    from app.private_live_telebirr_receiver_profiles candidate
   where (
     candidate.id = source_proof.receiver_profile_id
     and not app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
   ) or (
     app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
     and candidate.pilot_revision_id = p_pilot_revision_id
     and app.private_live_telebirr_shadow_profile_contract_matches(
       source_proof.receiver_profile_id, candidate.id
     )
   )
   for share;

  if source_proof.id is null
    or (case
         when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
           then source_proof.pilot_revision_id = p_pilot_revision_id
             or not app.private_live_telebirr_shadow_pilot_contract_matches(
               source_proof.pilot_revision_id, p_pilot_revision_id
             )
         else source_proof.pilot_revision_id is distinct from p_pilot_revision_id
       end)
    or source_proof.proof_status is distinct from 'verification_queued'
    or (source_proof.source_unavailable_retry_source_id is not null
      and not app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
        source_proof.id
      ))
    or source_proof.source_live_verification_job_id is not null
    or source_proof.source_live_proof_id is not null
    or source_proof.source_pilot_revision_id is not null
    or source_proof.source_receiver_profile_id is not null
    or source_proof.submitted_at >= authorized_at
    or (
      not app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
      and not app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
        source_proof.id
      )
      and authorized_at >= source_proof.submitted_at + interval '12 hours'
    )
    or not (
      exists (
        select 1
          from app.telegram_telebirr_shadow_proof_receipts receipt
         where receipt.shadow_proof_request_id = source_proof.id
      )
      or app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
      or app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
        source_proof.id
      )
    )
    or source_outcome.id is null
    or source_outcome.verification_job_id
         is distinct from source_proof.verification_job_id
    or source_outcome.disposition is distinct from 'review_required'
    or not (
      (p_reason_code = 'source_unavailable_review_retry_no_credit'
       and source_outcome.reason_code is not distinct from 'source_unavailable')
      or (p_reason_code = 'reviewed_direct_brief_receipt_retry_no_credit'
       and app.private_telebirr_direct_brief_source_is_valid(source_proof.id))
    )
    or source_outcome.protocol_disposition is distinct from 'would_review'
    or source_outcome.protocol_reason_code is distinct from 'receipt_requires_review'
    or source_outcome.would_verify
    or source_outcome.principal_amount_minor is not null
    or source_outcome.occurred_at is not null
    or source_outcome.receiver_identity_digest is not null
    or pilot.id is null
    or pilot.status is distinct from 'armed'
    or (
      not app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
      and pilot.configuration_digest is distinct from source_proof.pilot_configuration_digest
    )
    or pilot.active_from > authorized_at
    or pilot.expires_at <= authorized_at + interval '10 minutes'
    or profile.id is null
    or profile.pilot_revision_id is distinct from pilot.id
    or profile.payment_provider_id is distinct from source_proof.payment_provider_id
    or profile.valid_from > authorized_at
    or profile.valid_until <= authorized_at + interval '10 minutes' then
    raise exception 'The source-unavailable shadow proof is not safely retryable.';
  end if;

  retry_until := least(
    case
      when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
        or app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
          source_proof.id
        )
        then authorized_at + interval '12 hours'
      else source_proof.submitted_at + interval '12 hours'
    end,
    pilot.expires_at,
    profile.valid_until
  );
  if retry_until <= authorized_at + interval '10 minutes' then
    raise exception 'The source-unavailable no-credit retry window is unavailable.';
  end if;

  replacement_proof_id := pg_catalog.gen_random_uuid();
  replacement_job_id := pg_catalog.gen_random_uuid();
  retry_digest := app.private_telebirr_shadow_source_unavailable_retry_digest(
    p_retry_request_key,
    source_proof.id,
    source_proof.verification_job_id,
    source_outcome.id,
    replacement_proof_id,
    replacement_job_id,
    pilot.id,
    profile.id,
    authorized_at,
    retry_until,
    p_reason_code
  );

  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_source_unavailable_retry',
    case when p_reason_code = 'reviewed_direct_brief_receipt_retry_no_credit'
      then 'brief_receipt' else 'on' end, true
  );
  insert into app.private_telebirr_shadow_proof_requests (
    id,
    verification_job_id,
    pilot_revision_id,
    submitting_customer_id,
    player_account_id,
    payment_provider_id,
    provider_code,
    receiver_profile_id,
    pilot_configuration_digest,
    origin_channel,
    input_kind,
    candidate_reference_ciphertext,
    candidate_reference_fingerprint,
    candidate_reference_masked,
    reference_encryption_key_version,
    reference_profile_version,
    proof_status,
    submitted_at,
    not_before,
    expires_at,
    source_unavailable_retry_source_id
  ) values (
    replacement_proof_id,
    replacement_job_id,
    pilot.id,
    source_proof.submitting_customer_id,
    source_proof.player_account_id,
    source_proof.payment_provider_id,
    source_proof.provider_code,
    profile.id,
    pilot.configuration_digest,
    source_proof.origin_channel,
    source_proof.input_kind,
    source_proof.candidate_reference_ciphertext,
    source_proof.candidate_reference_fingerprint,
    source_proof.candidate_reference_masked,
    source_proof.reference_encryption_key_version,
    source_proof.reference_profile_version,
    source_proof.proof_status,
    source_proof.submitted_at,
    source_proof.not_before,
    retry_until,
    source_proof.id
  );
  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_source_unavailable_retry', 'off', true
  );

  insert into app.private_telebirr_shadow_source_unavailable_retries (
    retry_request_key,
    retry_request_digest,
    source_shadow_proof_request_id,
    source_shadow_verification_job_id,
    source_outcome_id,
    replacement_shadow_proof_request_id,
    replacement_shadow_verification_job_id,
    pilot_revision_id,
    receiver_profile_id,
    authorized_at,
    retry_expires_at,
    reason_code
  ) values (
    p_retry_request_key,
    retry_digest,
    source_proof.id,
    source_proof.verification_job_id,
    source_outcome.id,
    replacement_proof_id,
    replacement_job_id,
    pilot.id,
    profile.id,
    authorized_at,
    retry_until,
    p_reason_code
  );

  return query
  select replacement_proof_id, replacement_job_id, retry_until, false;
end;
$function$;

CREATE OR REPLACE FUNCTION app.private_telebirr_shadow_source_unavailable_retry_is_valid(p_replacement_shadow_proof_request_id uuid, p_retry_request_key uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  with source_validation as materialized (
    select source.id as source_id,
           retry.retry_request_key,
           replacement.id as replacement_id,
           app.private_telebirr_receipt_shape_network_source_is_valid(source.id)
             as network_source_valid,
           app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
             source.id
           ) as diagnostic_source_valid
      from app.private_telebirr_shadow_source_unavailable_retries retry
      join app.private_telebirr_shadow_proof_requests source
        on source.id = retry.source_shadow_proof_request_id
       and source.verification_job_id = retry.source_shadow_verification_job_id
      join app.private_telebirr_shadow_verification_outcomes source_outcome
        on source_outcome.id = retry.source_outcome_id
       and source_outcome.shadow_proof_request_id = source.id
      join app.private_telebirr_shadow_proof_requests replacement
        on replacement.id = retry.replacement_shadow_proof_request_id
       and replacement.verification_job_id =
           retry.replacement_shadow_verification_job_id
     where retry.retry_request_key = p_retry_request_key
       and replacement.id = p_replacement_shadow_proof_request_id
  )
  select pg_catalog.count(*) = 1
     and pg_catalog.bool_and(
       retry.retry_request_digest =
         app.private_telebirr_shadow_source_unavailable_retry_digest(
           retry.retry_request_key,
           retry.source_shadow_proof_request_id,
           retry.source_shadow_verification_job_id,
           retry.source_outcome_id,
           retry.replacement_shadow_proof_request_id,
           retry.replacement_shadow_verification_job_id,
           retry.pilot_revision_id,
           retry.receiver_profile_id,
           retry.authorized_at,
           retry.retry_expires_at,
           retry.reason_code
         )
       and retry.retry_request_key = p_retry_request_key
       and retry.replacement_shadow_proof_request_id = replacement.id
       and retry.replacement_shadow_verification_job_id = replacement.verification_job_id
       and retry.source_shadow_proof_request_id = source.id
       and retry.source_shadow_verification_job_id = source.verification_job_id
       and retry.source_outcome_id = source_outcome.id
       and retry.pilot_revision_id = replacement.pilot_revision_id
       and retry.receiver_profile_id = replacement.receiver_profile_id
       and (
         not source_validation.network_source_valid
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
       )
       and retry.retry_expires_at = replacement.expires_at
       and retry.reason_code in (
         'source_unavailable_review_retry_no_credit',
         'reviewed_direct_brief_receipt_retry_no_credit'
       )
       and retry.authorized_at <= pg_catalog.clock_timestamp()
       and retry.retry_expires_at > pg_catalog.clock_timestamp()
       and replacement.source_unavailable_retry_source_id = source.id
       and replacement.payment_provider_id = source.payment_provider_id
       and replacement.candidate_reference_fingerprint =
           source.candidate_reference_fingerprint
       and replacement.candidate_reference_ciphertext =
           source.candidate_reference_ciphertext
       and replacement.proof_status = 'verification_queued'
       and (source.source_unavailable_retry_source_id is null
          or source_validation.diagnostic_source_valid)
       and source_outcome.disposition = 'review_required'
       and (
         (retry.reason_code = 'source_unavailable_review_retry_no_credit'
          and source_outcome.reason_code = 'source_unavailable')
         or (retry.reason_code = 'reviewed_direct_brief_receipt_retry_no_credit'
          and app.private_telebirr_direct_brief_source_is_valid(source.id))
       )
       and source_outcome.protocol_disposition = 'would_review'
       and source_outcome.protocol_reason_code = 'receipt_requires_review'
       and not source_outcome.would_verify
       and source_outcome.principal_amount_minor is null
       and source_outcome.occurred_at is null
       and source_outcome.receiver_identity_digest is null
       and (
         exists (
           select 1
             from app.telegram_telebirr_shadow_proof_receipts receipt
            where receipt.shadow_proof_request_id = source.id
         )
         or source_validation.network_source_valid
          or source_validation.diagnostic_source_valid
       )
     )
    from app.private_telebirr_shadow_source_unavailable_retries retry
    join app.private_telebirr_shadow_proof_requests source
      on source.id = retry.source_shadow_proof_request_id
     and source.verification_job_id = retry.source_shadow_verification_job_id
    join app.private_telebirr_shadow_verification_outcomes source_outcome
      on source_outcome.id = retry.source_outcome_id
     and source_outcome.shadow_proof_request_id = source.id
    join app.private_telebirr_shadow_proof_requests replacement
      on replacement.id = retry.replacement_shadow_proof_request_id
     and replacement.verification_job_id = retry.replacement_shadow_verification_job_id
    join source_validation
      on source_validation.source_id = source.id
     and source_validation.retry_request_key = retry.retry_request_key
     and source_validation.replacement_id = replacement.id
   where retry.retry_request_key = p_retry_request_key
     and replacement.id = p_replacement_shadow_proof_request_id;
$function$;

do $bind_brief_completion$
declare
  routine_oid oid;
  original_definition text;
  original_source text;
  rewritten_definition text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  original_security_definer boolean;
  old_fragment constant text := $old$or app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
             proof.source_unavailable_retry_source_id
           )$old$;
  new_fragment constant text := $new$or app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
             proof.source_unavailable_retry_source_id
           )
           or app.private_telebirr_direct_brief_source_is_valid(
             proof.source_unavailable_retry_source_id
           )$new$;
  match_count integer;
begin
  select routine.oid, pg_catalog.pg_get_functiondef(routine.oid),
         routine.prosrc, routine.proowner, routine.proacl, routine.proconfig,
         routine.prosecdef
    into routine_oid, original_definition, original_source,
         original_owner, original_acl, original_config,
         original_security_definer
    from pg_catalog.pg_proc routine
   where routine.pronamespace = 'app'::regnamespace
     and routine.proname = 'complete_private_telebirr_shadow_verification'
     and routine.pronargs = 20
     and routine.prokind = 'f';
  match_count := (pg_catalog.length(original_source) -
                  pg_catalog.length(pg_catalog.replace(
                    original_source, old_fragment, ''
                  ))) / pg_catalog.length(old_fragment);
  if routine_oid is null
    or app.private_live_deposit_pilot_sha256(original_source) <>
       'sha256:0383960f8db971e8135075d9d7dcc41c89f90acd5221fcc0cc263786c85979e5'
    or match_count <> 2
    or original_owner <> (
      select role.oid from pg_catalog.pg_roles role
       where role.rolname = 'postgres'
    )
    or original_config <> array['search_path=pg_catalog']::text[]
    or not original_security_definer then
    raise exception 'The reviewed completion boundary changed.';
  end if;
  rewritten_definition := pg_catalog.replace(
    original_definition, old_fragment, new_fragment
  );
  execute rewritten_definition;
  if not exists (
    select 1 from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.proconfig is not distinct from original_config
       and routine.prosecdef = original_security_definer
       and routine.prosrc = pg_catalog.replace(
         original_source, old_fragment, new_fragment
       )
  ) then
    raise exception 'The reviewed completion boundary was not preserved.';
  end if;
end;
$bind_brief_completion$;

commit;
