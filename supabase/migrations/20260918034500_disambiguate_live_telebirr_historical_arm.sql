-- Disambiguate the historical-completion arm routine's local source-document digest.
--
-- The original routine used the same unqualified name for a PL/pgSQL local and table
-- columns inside SQL subqueries. PostgreSQL correctly rejected the guard at execution
-- time as ambiguous. Patch only those local-variable references while preserving the
-- reviewed function body, owner, ACL, security-definer flag, and safe search path.

do $disambiguate_historical_arm$
declare
  signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.arm_private_live_telebirr_historical_completion(uuid,uuid,bigint,uuid,text,text)'
  );
  markers constant text[] := array[
    $marker$  source_document_digest text;$marker$,
    $marker$  source_document_digest :=
    staged.signed_observation -> 'body' ->> 'sourceDocumentDigest';$marker$,
    $marker$      or authority.source_document_digest is distinct from source_document_digest$marker$,
    $marker$    or source_document_digest is null
    or source_document_digest !~ '^sha256:[0-9a-f]{64}$'$marker$,
    $marker$       where binding.source_document_digest = source_document_digest$marker$,
    $marker$       where settled.source_document_digest = source_document_digest$marker$,
    $marker$    staged.observation_body_digest,
    source_document_digest,
    armed_at,$marker$,
    $marker$    p_expired_activation_epoch,
    staged.observation_body_digest,
    source_document_digest,
    p_reason_code,$marker$
  ];
  replacements constant text[] := array[
    $replacement$  target_source_document_digest text;$replacement$,
    $replacement$  target_source_document_digest :=
    staged.signed_observation -> 'body' ->> 'sourceDocumentDigest';$replacement$,
    $replacement$      or authority.source_document_digest is distinct from target_source_document_digest$replacement$,
    $replacement$    or target_source_document_digest is null
    or target_source_document_digest !~ '^sha256:[0-9a-f]{64}$'$replacement$,
    $replacement$       where binding.source_document_digest = target_source_document_digest$replacement$,
    $replacement$       where settled.source_document_digest = target_source_document_digest$replacement$,
    $replacement$    staged.observation_body_digest,
    target_source_document_digest,
    armed_at,$replacement$,
    $replacement$    p_expired_activation_epoch,
    staged.observation_body_digest,
    target_source_document_digest,
    p_reason_code,$replacement$
  ];
  original_definition text;
  original_source text;
  original_owner oid;
  original_acl aclitem[];
  patched_definition text;
  patched_source text;
  marker_index integer;
begin
  select pg_catalog.pg_get_functiondef(routine.oid),
         routine.prosrc,
         routine.proowner,
         routine.proacl
    into original_definition,
         original_source,
         original_owner,
         original_acl
    from pg_catalog.pg_proc routine
   where routine.oid = signature;

  if signature is null then
    raise exception 'The historical TeleBirr arm routine is unavailable.';
  end if;

  patched_definition := original_definition;
  patched_source := original_source;
  for marker_index in 1..pg_catalog.array_length(markers, 1) loop
    if (pg_catalog.length(original_source) - pg_catalog.length(
          pg_catalog.replace(original_source, markers[marker_index], '')
        )) / pg_catalog.length(markers[marker_index]) <> 1 then
      raise exception 'The historical TeleBirr arm source does not match at marker %.',
        marker_index;
    end if;
    patched_definition := pg_catalog.replace(
      patched_definition,
      markers[marker_index],
      replacements[marker_index]
    );
    patched_source := pg_catalog.replace(
      patched_source,
      markers[marker_index],
      replacements[marker_index]
    );
  end loop;

  execute patched_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = signature
       and routine.prosrc = patched_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.prosecdef
       and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The historical TeleBirr arm patch changed function authority.';
  end if;
end;
$disambiguate_historical_arm$;

