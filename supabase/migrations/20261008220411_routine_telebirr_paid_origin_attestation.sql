-- Only a signed observation that explicitly binds the reviewed phone's fixed
-- official HTTPS origin may enter the paid inbox. Version 1 stays available
-- for no-money review, but can never be promoted to a paid claim.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table app.routine_telebirr_paid_observation_staging
  drop constraint routine_paid_staging_observation_check;
alter table app.routine_telebirr_paid_observation_staging
  add constraint routine_paid_staging_observation_check check (
    pg_catalog.jsonb_typeof(signed_observation) = 'object'
    and pg_catalog.octet_length(signed_observation::text) <= 16384
    and coalesce(signed_observation ->> 'providerCode', '') = 'telebirr'
    and coalesce(signed_observation ->> 'contractVersion', '') = '2'
    and coalesce(signed_observation ->> 'protocolMode', '') = 'routine_signed_observation_v2'
    and coalesce(signed_observation ->> 'transcriptVersion', '') =
      'telebirr-routine-observation-transcript-v2'
    and coalesce(signed_observation #>> '{body,contractVersion}', '') = '2'
    and coalesce(signed_observation #>> '{body,protocolMode}', '') =
      'routine_signed_observation_v2'
    and coalesce(signed_observation #>> '{body,facts,sourceOriginAttestation}', '') =
      'official_tls_origin'
    and coalesce(signed_observation ->> 'bodyDigest', '') = observation_body_digest
    and coalesce(signed_observation #>> '{body,challengeId}', '') = challenge_id::text
    and coalesce(signed_observation #>> '{body,candidateId}', '') = candidate_id::text
    and coalesce(signed_observation #>> '{body,referenceFingerprint}', '') = reference_fingerprint
    and coalesce(signed_observation #>> '{body,sourceDocumentDigest}', '') = source_document_digest
    and coalesce(signed_observation #>> '{body,facts,amountMinor}', '') = amount_minor::text
    and signed_observation::text !~ '"rawReference"'
  ) not valid;

alter table app.routine_telebirr_paid_observation_lineages
  drop constraint routine_paid_lineage_signed_observation_check;
alter table app.routine_telebirr_paid_observation_lineages
  add constraint routine_paid_lineage_signed_observation_check check (
    pg_catalog.jsonb_typeof(signed_observation) = 'object'
    and pg_catalog.octet_length(signed_observation::text) <= 16384
    and coalesce(signed_observation ->> 'providerCode', '') = 'telebirr'
    and coalesce(signed_observation ->> 'contractVersion', '') = '2'
    and coalesce(signed_observation ->> 'protocolMode', '') = 'routine_signed_observation_v2'
    and coalesce(signed_observation ->> 'transcriptVersion', '') =
      'telebirr-routine-observation-transcript-v2'
    and coalesce(signed_observation #>> '{body,contractVersion}', '') = '2'
    and coalesce(signed_observation #>> '{body,protocolMode}', '') =
      'routine_signed_observation_v2'
    and coalesce(signed_observation #>> '{body,facts,sourceOriginAttestation}', '') =
      'official_tls_origin'
    and coalesce(signed_observation ->> 'bodyDigest', '') = observation_body_digest
    and coalesce(signed_observation ->> 'signature', '') ~ '^[A-Za-z0-9_-]{86}$'
    and coalesce(signed_observation #>> '{body,challengeId}', '') = challenge_id::text
    and coalesce(signed_observation #>> '{body,candidateId}', '') = candidate_id::text
    and coalesce(signed_observation #>> '{body,referenceFingerprint}', '') = reference_fingerprint
    and coalesce(signed_observation #>> '{body,sourceDocumentDigest}', '') = source_document_digest
    and coalesce(signed_observation #>> '{body,facts,amountMinor}', '') = amount_minor::text
    and signed_observation::text !~ '"rawReference"'
  ) not valid;

-- Preserve the original function's narrowly granted role and all its switch,
-- owner, clock, and replay guards. Refuse to alter an unexpected definition.
do $migration$
declare
  v_definition text;
  v_claim_definition text;
  v_old constant text := '''routine_signed_observation_v1''';
  v_new constant text := '''routine_signed_observation_v2''';
  v_claim_old constant text :=
    'if v_staged.signed_observation ->> ''bodyDigest''';
  v_claim_new constant text :=
    'if v_staged.signed_observation ->> ''contractVersion'' is distinct from ''2''
    or v_staged.signed_observation ->> ''protocolMode'' is distinct from
       ''routine_signed_observation_v2''
    or v_staged.signed_observation ->> ''transcriptVersion'' is distinct from
       ''telebirr-routine-observation-transcript-v2''
    or v_staged.signed_observation #>> ''{body,facts,sourceOriginAttestation}''
       is distinct from ''official_tls_origin''
    or v_staged.signed_observation ->> ''bodyDigest''';
begin
  select pg_catalog.pg_get_functiondef(
    'app.stage_routine_telebirr_paid_signed_observation(uuid,text,text,text,text,jsonb)'
      ::pg_catalog.regprocedure)
    into v_definition;
  if (pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old) <> 1 then
    raise exception 'The paid staging function is not the reviewed version.';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);

  select pg_catalog.pg_get_functiondef(
    'app.finalize_routine_telebirr_paid_observation(uuid)'::pg_catalog.regprocedure)
    into v_claim_definition;
  if (pg_catalog.length(v_claim_definition) - pg_catalog.length(
      pg_catalog.replace(v_claim_definition, v_claim_old, '')))
      / pg_catalog.length(v_claim_old) <> 1 then
    raise exception 'The paid claim function is not the reviewed version.';
  end if;
  execute pg_catalog.replace(v_claim_definition, v_claim_old, v_claim_new);
end;
$migration$;

revoke all on function app.stage_routine_telebirr_paid_signed_observation(
  uuid, text, text, text, text, jsonb)
  from public, anon, authenticated, service_role,
    fetanagent_routine_telebirr_no_money, fetanagent_routine_telebirr_no_money_runtime;
revoke all on function app.finalize_routine_telebirr_paid_observation(uuid)
  from public, anon, authenticated, service_role,
    fetanagent_routine_telebirr_paid_poll, fetanagent_routine_telebirr_paid_poll_runtime;

commit;
