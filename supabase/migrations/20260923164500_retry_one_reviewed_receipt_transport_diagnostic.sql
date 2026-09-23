-- One additional no-credit observation of the exact signed network-unavailable
-- child, on its existing pilot. This does not renew a Telegram submission, a
-- device enrollment, a pilot, or any financial authority. The ancestry below
-- permits depth two only: a replacement of this source cannot itself satisfy
-- the receipt-shape network-source predicate.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
  p_source_shadow_proof_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  with exact_source as materialized (
    select proof.id, outcome.observation_body_digest
      from app.private_telebirr_shadow_source_unavailable_retries retry
      join app.private_telebirr_shadow_proof_requests parent
        on parent.id = retry.source_shadow_proof_request_id
       and parent.verification_job_id = retry.source_shadow_verification_job_id
      join app.private_telebirr_shadow_verification_outcomes parent_outcome
        on parent_outcome.id = retry.source_outcome_id
       and parent_outcome.shadow_proof_request_id = parent.id
       and parent_outcome.verification_job_id = parent.verification_job_id
      join app.private_telebirr_shadow_proof_requests proof
        on proof.id = retry.replacement_shadow_proof_request_id
       and proof.verification_job_id = retry.replacement_shadow_verification_job_id
      join app.private_telebirr_shadow_verification_outcomes outcome
        on outcome.shadow_proof_request_id = proof.id
       and outcome.verification_job_id = proof.verification_job_id
      join app.private_live_deposit_pilot_revisions pilot
        on pilot.id = retry.pilot_revision_id
       and pilot.id = proof.pilot_revision_id
      join app.private_live_telebirr_receiver_profiles profile
        on profile.id = retry.receiver_profile_id
       and profile.id = proof.receiver_profile_id
       and profile.pilot_revision_id = pilot.id
     where proof.id = p_source_shadow_proof_request_id
       and app.private_telebirr_receipt_shape_network_source_is_valid(parent.id)
       and retry.retry_request_digest =
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
       and retry.reason_code = 'source_unavailable_review_retry_no_credit'
       and retry.authorized_at >= parent.created_at
       and retry.retry_expires_at > retry.authorized_at
       and retry.retry_expires_at <= retry.authorized_at + interval '12 hours'
       and retry.retry_expires_at <= pilot.expires_at
       and retry.retry_expires_at <= profile.valid_until
       and parent_outcome.disposition = 'review_required'
       and parent_outcome.reason_code = 'source_unavailable'
       and parent_outcome.protocol_disposition = 'would_review'
       and parent_outcome.protocol_reason_code = 'receipt_requires_review'
       and not parent_outcome.would_verify
       and parent_outcome.principal_amount_minor is null
       and parent_outcome.occurred_at is null
       and parent_outcome.receiver_identity_digest is null
       and proof.source_unavailable_retry_source_id = parent.id
       and proof.source_binding_layout_retry_source_id is null
       and proof.proof_status = 'verification_queued'
       and proof.pilot_configuration_digest = pilot.configuration_digest
       and proof.submitting_customer_id = parent.submitting_customer_id
       and proof.player_account_id = parent.player_account_id
       and proof.payment_provider_id = parent.payment_provider_id
       and proof.provider_code = parent.provider_code
       and proof.origin_channel = parent.origin_channel
       and proof.input_kind = parent.input_kind
       and proof.candidate_reference_ciphertext = parent.candidate_reference_ciphertext
       and proof.candidate_reference_fingerprint = parent.candidate_reference_fingerprint
       and proof.candidate_reference_masked = parent.candidate_reference_masked
       and proof.reference_encryption_key_version =
           parent.reference_encryption_key_version
       and proof.reference_profile_version = parent.reference_profile_version
       and proof.submitted_at = parent.submitted_at
       and proof.not_before = parent.not_before
       and proof.created_at >= retry.authorized_at
       and proof.expires_at = retry.retry_expires_at
       and not exists (
         select 1 from app.telegram_telebirr_shadow_proof_receipts receipt
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
           or observation.review_reason is null
           or observation.review_reason not in (
                'network_unavailable', 'unknown_layout_invoice_number'
              )
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
     ) = (select source.observation_body_digest from exact_source source)
     and (
       select observation.review_reason
         from observations observation
        order by observation.staged_at desc,
                 observation.observation_body_digest desc
        limit 1
     ) = 'network_unavailable';
$$;

alter function app.private_telebirr_receipt_transport_diagnostic_source_is_valid(uuid)
  owner to postgres;
revoke all on function
  app.private_telebirr_receipt_transport_diagnostic_source_is_valid(uuid)
  from public, anon, authenticated, service_role;

comment on function
  app.private_telebirr_receipt_transport_diagnostic_source_is_valid(uuid) is
  'Validates the sole network-unavailable first child, its immutable ancestor retry, signed attempt history, terminal outcome, and no-credit lineage. It cannot validate a descendant.';

-- Pin every deployed routine before rewriting only the source acceptance and
-- bounded deadline expressions. Preserve owner, ACL, search path, volatility,
-- parallel safety, leakproof flag, security definer, and return shape exactly.
do $extend_one_diagnostic_retry$
declare
  target record;
  routine_oid oid;
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
  old_fragments text[];
  new_fragments text[];
  expected_counts integer[];
  fragment_index integer;
begin
  for target in
    select * from (values
      ('guard_private_telebirr_shadow_source_retry_insert', 0,
       '6760481718694f3cb64ad5c0d9e28026fe2f31a6172020a70d7480c3c721571b'),
      ('private_telebirr_shadow_source_unavailable_retry_is_valid', 2,
       '100b23d58a723e5f7098e157dc9ab5821850c7c05a506492049d984c1eb62f2d'),
      ('retry_private_telebirr_shadow_after_source_unavailable', 4,
       '87e82d460bfa376cf6d59a6b81202a15313e63429805223261d5fbc87282ac6c'),
      ('private_telebirr_receipt_shape_network_retry_deadline', 1,
       '003c6e8a29cba33327177b2c626353806ea815f92edc30fb12167e71af987e64'),
      ('load_next_private_telebirr_shadow_staged_evidence', 0,
       '0891815dfd9472a4abecafa54339b8014458dd877039b6b4cd9f9261f9fbb1b3'),
      ('load_private_telebirr_shadow_verification_authority', 3,
       'e57c1c13c8f89397010c4e62fd916ec5d5a1ec8f9fd141f26e308333e686a5cc'),
      ('complete_private_telebirr_shadow_verification', 20,
       'fab7472db7b8b50b940e910298927597f8cc706cf60963b2024e8398430bd1e0')
    ) as expected(proname, pronargs, source_sha256)
  loop
    select routine.oid, pg_catalog.pg_get_functiondef(routine.oid),
           routine.prosrc, routine.proowner, routine.proacl, routine.proconfig,
           routine.provolatile, routine.proparallel, routine.proleakproof,
           routine.prosecdef, routine.proretset
      into routine_oid, original_definition, original_source, original_owner,
           original_acl, original_config, original_volatility,
           original_parallel, original_leakproof, original_security_definer,
           original_returns_set
      from pg_catalog.pg_proc routine
     where routine.pronamespace = 'app'::regnamespace
       and routine.proname = target.proname
       and routine.pronargs = target.pronargs
       and routine.prokind = 'f'
       and routine.prosecdef
       and routine.proconfig = array['search_path=pg_catalog']::text[]
       and routine.proowner = (
         select role.oid from pg_catalog.pg_roles role
          where role.rolname = 'postgres'
       );

    if original_definition is null
      or pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'
           ), 'hex'
         ) <> target.source_sha256
      or (pg_catalog.length(original_definition) -
          pg_catalog.length(pg_catalog.replace(
            original_definition, original_source, ''
          ))) / pg_catalog.length(original_source) <> 1 then
      raise exception 'A reviewed diagnostic retry routine changed shape.';
    end if;

    old_fragments := null;
    new_fragments := null;
    expected_counts := null;

    if target.proname = 'guard_private_telebirr_shadow_source_retry_insert' then
      old_fragments := array[
        $old_guard_source$source_proof.source_unavailable_retry_source_id is not null$old_guard_source$,
        $old_guard_deadline$when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
           then new.created_at + interval '12 hours'$old_guard_deadline$
      ];
      new_fragments := array[
        $new_guard_source$(source_proof.source_unavailable_retry_source_id is not null
        and not app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
          source_proof.id
        ))$new_guard_source$,
        $new_guard_deadline$when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
            or app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
              source_proof.id
            )
           then new.created_at + interval '12 hours'$new_guard_deadline$
      ];
      expected_counts := array[1, 1];

    elsif target.proname = 'private_telebirr_shadow_source_unavailable_retry_is_valid' then
      old_fragments := array[
        $old_valid_source$source.source_unavailable_retry_source_id is null$old_valid_source$,
        $old_valid_receipt$or app.private_telebirr_receipt_shape_network_source_is_valid(source.id)$old_valid_receipt$
      ];
      new_fragments := array[
        $new_valid_source$(source.source_unavailable_retry_source_id is null
          or app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
            source.id
          ))$new_valid_source$,
        $new_valid_receipt$or app.private_telebirr_receipt_shape_network_source_is_valid(source.id)
          or app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
            source.id
          )$new_valid_receipt$
      ];
      expected_counts := array[1, 1];

    elsif target.proname = 'retry_private_telebirr_shadow_after_source_unavailable' then
      old_fragments := array[
        $old_retry_source$source_proof.source_unavailable_retry_source_id is not null$old_retry_source$,
        $old_retry_window$not app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
      and authorized_at >= source_proof.submitted_at + interval '12 hours'$old_retry_window$,
        $old_retry_receipt$or app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
    )$old_retry_receipt$,
        $old_retry_deadline$when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
        then authorized_at + interval '12 hours'$old_retry_deadline$
      ];
      new_fragments := array[
        $new_retry_source$(source_proof.source_unavailable_retry_source_id is not null
      and not app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
        source_proof.id
      ))$new_retry_source$,
        $new_retry_window$not app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
      and not app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
        source_proof.id
      )
      and authorized_at >= source_proof.submitted_at + interval '12 hours'$new_retry_window$,
        $new_retry_receipt$or app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
      or app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
        source_proof.id
      )
    )$new_retry_receipt$,
        $new_retry_deadline$when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
        or app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
          source_proof.id
        )
        then authorized_at + interval '12 hours'$new_retry_deadline$
      ];
      expected_counts := array[1, 1, 1, 1];

    elsif target.proname = 'private_telebirr_receipt_shape_network_retry_deadline' then
      old_fragments := array[
        $old_deadline_source$and app.private_telebirr_receipt_shape_network_source_is_valid(
           retry.source_shadow_proof_request_id
         )$old_deadline_source$
      ];
      new_fragments := array[
        $new_deadline_source$and (
           app.private_telebirr_receipt_shape_network_source_is_valid(
             retry.source_shadow_proof_request_id
           )
           or app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
             retry.source_shadow_proof_request_id
           )
         )$new_deadline_source$
      ];
      expected_counts := array[1];

    else
      old_fragments := array[
        $old_authority$and app.private_telebirr_receipt_shape_network_source_is_valid(
               proof.source_unavailable_retry_source_id
             )$old_authority$
      ];
      new_fragments := array[
        $new_authority$and (
           app.private_telebirr_receipt_shape_network_source_is_valid(
             proof.source_unavailable_retry_source_id
           )
           or app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
             proof.source_unavailable_retry_source_id
           )
         )$new_authority$
      ];
      expected_counts := array[
        case when target.proname = 'complete_private_telebirr_shadow_verification'
          then 2 else 1 end
      ];
    end if;

    rewritten_source := original_source;
    for fragment_index in 1..pg_catalog.array_length(old_fragments, 1) loop
      if old_fragments[fragment_index] = ''
        or (pg_catalog.length(rewritten_source) -
            pg_catalog.length(pg_catalog.replace(
              rewritten_source, old_fragments[fragment_index], ''
            ))) / pg_catalog.length(old_fragments[fragment_index])
           <> expected_counts[fragment_index] then
        raise exception 'A reviewed diagnostic retry fragment is not exact.';
      end if;
      rewritten_source := pg_catalog.replace(
        rewritten_source, old_fragments[fragment_index],
        new_fragments[fragment_index]
      );
    end loop;

    execute pg_catalog.replace(
      original_definition, original_source, rewritten_source
    );
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
      raise exception 'The reviewed diagnostic retry changed routine authority.';
    end if;
  end loop;
end;
$extend_one_diagnostic_retry$;

commit;
