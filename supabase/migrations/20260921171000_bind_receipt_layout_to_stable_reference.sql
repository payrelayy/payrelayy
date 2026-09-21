-- Bind reviewed receipt-layout evidence to the stable signed provider-reference identity.
--
-- The receipt page and a later network-error page are distinct source documents, so their
-- source-document digests must differ even when both observations belong to the same proof.
-- Preserve the exact terminal observation/source-document binding, then require the layout
-- witness and terminal observation to share the proof-bound reference fingerprint and the
-- signed assignment reference-binding digest. Preserve every existing no-money, lineage,
-- authority, and immutability boundary.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $bind_receipt_layout_reference$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.private_telebirr_shadow_layout_source_is_valid(uuid,uuid)'
  );
  expected_source_sha256 constant text :=
    '70526705e57340615b7c944388401ccbc21381993a2904beb8903f2415eacc5e';
  old_fragment constant text := $proof_history_document_binding$
    and exists (
      select 1
        from app.private_telebirr_shadow_device_evidence_staging staged
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = staged.verification_attempt_id
       where attempt.shadow_proof_request_id = proof.id
         and staged.signed_observation -> 'body' ->> 'sourceDocumentDigest' =
             outcome.source_document_digest
         and staged.signed_observation -> 'body' -> 'facts' ->> 'lookupOutcome' =
             'review_required'
         and staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason' in (
           'unknown_layout',
           'unknown_layout_provider_identity',
           'unknown_layout_invoice_number',
           'unknown_layout_transaction_status',
           'unknown_layout_settled_amount',
           'unknown_layout_payment_date',
           'unknown_layout_credited_party_name',
           'unknown_layout_payment_mode',
           'unknown_layout_payment_reason',
           'unknown_layout_payment_channel'
         )
         and nullif(
           staged.signed_observation -> 'body' -> 'facts' ->> 'retrievedAt',
           ''
         ) is not null
    )
$proof_history_document_binding$;
  new_fragment constant text := $proof_history_reference_binding$
    and exists (
      select 1
        from app.private_telebirr_shadow_device_evidence_staging layout_staged
        join app.private_telebirr_shadow_verification_attempts layout_attempt
          on layout_attempt.id = layout_staged.verification_attempt_id
        join app.private_telebirr_shadow_assignment_transcripts layout_transcript
          on layout_transcript.id = layout_staged.assignment_transcript_id
         and layout_transcript.verification_attempt_id = layout_attempt.id
        join app.private_telebirr_shadow_device_evidence_staging terminal_staged
          on terminal_staged.verification_attempt_id = outcome.verification_attempt_id
         and terminal_staged.observation_body_digest = outcome.observation_body_digest
        join app.private_telebirr_shadow_verification_attempts terminal_attempt
          on terminal_attempt.id = terminal_staged.verification_attempt_id
        join app.private_telebirr_shadow_assignment_transcripts terminal_transcript
          on terminal_transcript.id = terminal_staged.assignment_transcript_id
         and terminal_transcript.verification_attempt_id = terminal_attempt.id
       where layout_attempt.shadow_proof_request_id = proof.id
         and terminal_attempt.shadow_proof_request_id = proof.id
         and terminal_staged.signed_observation -> 'body' ->> 'sourceDocumentDigest' =
             outcome.source_document_digest
         and layout_staged.signed_observation -> 'body' ->> 'referenceFingerprint' =
             'hmac-sha256:' || proof.candidate_reference_fingerprint
         and terminal_staged.signed_observation -> 'body' ->> 'referenceFingerprint' =
             layout_staged.signed_observation -> 'body' ->> 'referenceFingerprint'
         and layout_staged.signed_observation -> 'body' ->> 'referenceBindingDigest' =
             layout_transcript.reference_binding_digest
         and terminal_staged.signed_observation -> 'body' ->> 'referenceBindingDigest' =
             terminal_transcript.reference_binding_digest
         and layout_staged.signed_observation -> 'body' ->> 'referenceBindingDigest' =
             terminal_staged.signed_observation -> 'body' ->> 'referenceBindingDigest'
         and layout_staged.signed_observation -> 'body' -> 'facts' ->> 'lookupOutcome' =
             'review_required'
         and layout_staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason' in (
           'unknown_layout',
           'unknown_layout_provider_identity',
           'unknown_layout_invoice_number',
           'unknown_layout_transaction_status',
           'unknown_layout_settled_amount',
           'unknown_layout_payment_date',
           'unknown_layout_credited_party_name',
           'unknown_layout_payment_mode',
           'unknown_layout_payment_reason',
           'unknown_layout_payment_channel'
         )
         and nullif(
           layout_staged.signed_observation -> 'body' -> 'facts' ->> 'retrievedAt',
           ''
         ) is not null
    )
$proof_history_reference_binding$;
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
  select pg_catalog.pg_get_functiondef(routine.oid),
         routine.prosrc,
         routine.proowner,
         routine.proacl,
         routine.proconfig,
         routine.provolatile,
         routine.proparallel,
         routine.proleakproof,
         routine.prosecdef,
         routine.proretset
    into original_definition,
         original_source,
         original_owner,
         original_acl,
         original_config,
         original_volatility,
         original_parallel,
         original_leakproof,
         original_security_definer,
         original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.pronargs = 2
     and routine.prorettype = 'pg_catalog.bool'::pg_catalog.regtype
     and routine.provolatile = 's'
     and routine.prosecdef
     and not routine.proretset
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
    raise exception 'The receipt-layout source validator shape is not reviewed.';
  end if;

  rewritten_definition := pg_catalog.replace(
    original_definition,
    old_fragment,
    new_fragment
  );
  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute rewritten_definition;

  if pg_catalog.strpos(
       rewritten_source,
       'layout_staged.signed_observation -> ''body'' ->> ''sourceDocumentDigest'' ='
     ) <> 0
    or pg_catalog.strpos(
         rewritten_source,
         '''hmac-sha256:'' || proof.candidate_reference_fingerprint'
       ) = 0
    or pg_catalog.strpos(
         rewritten_source,
         'terminal_staged.observation_body_digest = outcome.observation_body_digest'
       ) = 0
    or not exists (
      select 1
        from pg_catalog.pg_proc routine
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
    raise exception 'The receipt-layout reference binding rewrite changed its authority.';
  end if;
end;
$bind_receipt_layout_reference$;

comment on function app.private_telebirr_shadow_layout_source_is_valid(uuid, uuid) is
  'Validates the complete no-money receipt-layout review history, preserves the exact terminal source-document witness, and binds layout evidence to the same signed proof reference identity.';

commit;
