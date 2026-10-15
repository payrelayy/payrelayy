-- The official TeleBirr receipt origin serves two fixed invalid-reference HTML bodies.
-- A signed phone observation may use either pinned digest after two identical TLS reads.
-- No timeout, 404, unknown page, or transport failure becomes a terminal rejection.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter table app.routine_telebirr_paid_terminal_rejections
  drop constraint routine_paid_terminal_signed_shape;
alter table app.routine_telebirr_paid_terminal_rejections
  add constraint routine_paid_terminal_signed_shape check (
    pg_catalog.jsonb_typeof(signed_observation) = 'object'
    and pg_catalog.octet_length(signed_observation::text) <= 16384
    and signed_observation ->> 'bodyDigest' = observation_body_digest
    and signed_observation #>> '{body,sourceDocumentDigest}' = source_document_digest
    and signed_observation #>> '{body,candidateId}' = candidate_id::text
    and signed_observation #>> '{body,challengeId}' = challenge_id::text
    and signed_observation #>> '{body,facts,sourceOriginAttestation}' = 'official_tls_origin'
    and signed_observation #>> '{body,facts,sourceProfile}' = 'telebirr_official_receipt_v1'
    and signed_observation::text !~ '"rawReference"'
    and (
      (reason_code = 'receiver_mismatch'
        and signed_observation #>> '{body,facts,referenceMatch}' = 'matched'
        and signed_observation #>> '{body,facts,receiverMatch}' = 'mismatched')
      or (reason_code = 'explicit_invalid_reference'
        and source_document_digest in (
          'sha256:91afbccab306bb594b924b41b38a065c02e39e8ef89f97c2edd21b1b1006b3b2',
          'sha256:cdc7494ceb7b145858e52bef7f76607373b8c523b2430590859066ac3ae2b707')
        and signed_observation #>> '{body,facts,amountMinor}' = '0'
        and signed_observation #>> '{body,facts,canonicalReferencePresent}' = 'false'
        and signed_observation #>> '{body,facts,creditedPartyNameDigest}' =
          'sha256:0000000000000000000000000000000000000000000000000000000000000000'
        and signed_observation #>> '{body,facts,currencyCode}' = 'unknown'
        and signed_observation #>> '{body,facts,evidenceSource}' = 'provider_receipt_lookup'
        and signed_observation #>> '{body,facts,occurredAt}' =
          signed_observation #>> '{body,facts,retrievedAt}'
        and signed_observation #>> '{body,facts,retrievedAt}' =
          signed_observation #>> '{body,observedAt}'
        and signed_observation #>> '{body,facts,paymentChannel}' = 'unknown'
        and signed_observation #>> '{body,facts,paymentMode}' = 'unknown'
        and signed_observation #>> '{body,facts,paymentReason}' = 'unknown'
        and signed_observation #>> '{body,facts,providerFinalStatus}' = 'unknown'
        and signed_observation #>> '{body,facts,providerIdentity}' = 'matched'
        and signed_observation #>> '{body,facts,receiverMatch}' = 'unknown'
        and signed_observation #>> '{body,facts,referenceMatch}' = 'unknown')
    )
  );

do $migration$
declare
  target regprocedure :=
    'app.record_routine_telebirr_paid_terminal_result(uuid,jsonb)'::regprocedure;
  definition text;
  old_clause constant text := E'  elsif p_signed_observation #>> ''{body,sourceDocumentDigest}'' =\n      ''sha256:91afbccab306bb594b924b41b38a065c02e39e8ef89f97c2edd21b1b1006b3b2''';
  new_clause constant text := E'  elsif p_signed_observation #>> ''{body,sourceDocumentDigest}'' in (\n      ''sha256:91afbccab306bb594b924b41b38a065c02e39e8ef89f97c2edd21b1b1006b3b2'',\n      ''sha256:cdc7494ceb7b145858e52bef7f76607373b8c523b2430590859066ac3ae2b707'')';
  old_count integer;
  new_count integer;
begin
  definition := pg_catalog.pg_get_functiondef(target);
  old_count := (pg_catalog.length(definition) -
    pg_catalog.length(pg_catalog.replace(definition, old_clause, ''))) /
    pg_catalog.length(old_clause);
  new_count := (pg_catalog.length(definition) -
    pg_catalog.length(pg_catalog.replace(definition, new_clause, ''))) /
    pg_catalog.length(new_clause);
  if old_count <> 1 or new_count <> 0 then
    raise exception 'The paid TeleBirr terminal function is not the reviewed shape.';
  end if;
  execute pg_catalog.replace(definition, old_clause, new_clause);
  definition := pg_catalog.pg_get_functiondef(target);
  if pg_catalog.strpos(definition, old_clause) <> 0 or
    pg_catalog.strpos(definition, new_clause) = 0 then
    raise exception 'The paid TeleBirr invalid-page update did not take effect.';
  end if;
end;
$migration$;

comment on function app.record_routine_telebirr_paid_terminal_result(uuid,jsonb) is
  'Root-guarded signed paid-phone terminal rejection for wrong receiver or one of two exact twice-read official invalid pages; no payment action.';
commit;
