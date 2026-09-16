-- Repair the deployed runtime-startup recovery function without broadening its authority.
-- LEAST is PostgreSQL expression syntax and cannot be schema-qualified as pg_catalog.least().

begin;

do $fix_telebirr_shadow_runtime_retry_least$
declare
  recovery_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.retry_expired_private_telebirr_shadow_after_runtime_startup_failure(uuid,uuid,uuid,uuid,text)'
  );
  expected_defective_source_sha256 constant text :=
    'ec175bae642282fdccc3c3f3beec6fa394c142c6d0e67610bdcf0a95c252a331';
  expected_corrected_source_sha256 constant text :=
    '53db6eac1ea632f7962e106c403cff3f1a476947459576dc37f47b03ef936e8a';
  defective_expression constant text := 'retry_until := pg_catalog.least(';
  corrected_expression constant text := 'retry_until := least(';
  original_definition text;
  corrected_definition text;
  original_source text;
  original_source_sha256 text;
  corrected_source text;
  original_owner oid;
  original_acl aclitem[];
begin
  if recovery_signature is null then
    raise exception 'The TeleBirr shadow runtime-startup recovery function is unavailable.';
  end if;

  select routine.prosrc,
         routine.proowner,
         routine.proacl,
         pg_catalog.pg_get_functiondef(routine.oid),
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into original_source,
         original_owner,
         original_acl,
         original_definition,
         original_source_sha256
    from pg_catalog.pg_proc routine
   where routine.oid = recovery_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proretset
     and routine.pronargs = 5
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     );

  if original_definition is null
    or original_source is null then
    raise exception 'The TeleBirr shadow runtime-startup recovery function boundary is unavailable.';
  end if;

  if original_source_sha256 = expected_corrected_source_sha256 then
    if original_definition like '%' || defective_expression || '%'
      or original_source like '%' || defective_expression || '%'
      or pg_catalog.length(original_definition)
           - pg_catalog.length(pg_catalog.replace(original_definition, corrected_expression, ''))
         <> pg_catalog.length(corrected_expression)
      or pg_catalog.length(original_source)
           - pg_catalog.length(pg_catalog.replace(original_source, corrected_expression, ''))
         <> pg_catalog.length(corrected_expression) then
      raise exception 'The corrected TeleBirr shadow runtime-startup recovery function does not match the reviewed definition.';
    end if;
  elsif original_source_sha256 = expected_defective_source_sha256 then
    if pg_catalog.length(original_definition)
         - pg_catalog.length(pg_catalog.replace(original_definition, defective_expression, ''))
       <> pg_catalog.length(defective_expression)
      or pg_catalog.length(original_source)
           - pg_catalog.length(pg_catalog.replace(original_source, defective_expression, ''))
         <> pg_catalog.length(defective_expression)
      or original_definition like '%' || corrected_expression || '%'
      or original_source like '%' || corrected_expression || '%' then
      raise exception 'The TeleBirr shadow runtime-startup recovery function does not match the reviewed defect.';
    end if;

    corrected_definition := pg_catalog.replace(
      original_definition,
      defective_expression,
      corrected_expression
    );
    corrected_source := pg_catalog.replace(
      original_source,
      defective_expression,
      corrected_expression
    );

    execute corrected_definition;

    if not exists (
      select 1
        from pg_catalog.pg_proc routine
       where routine.oid = recovery_signature
         and routine.prosrc = corrected_source
         and routine.proowner = original_owner
         and routine.proacl is not distinct from original_acl
         and routine.prokind = 'f'
         and routine.prosecdef
         and routine.proretset
         and routine.pronargs = 5
         and routine.proconfig = array['search_path=pg_catalog']::text[]
         and pg_catalog.encode(
               extensions.digest(
                 pg_catalog.convert_to(routine.prosrc, 'UTF8'),
                 'sha256'
               ),
               'hex'
             ) = expected_corrected_source_sha256
         and pg_catalog.pg_get_functiondef(routine.oid) not like
               '%' || defective_expression || '%'
         and pg_catalog.pg_get_functiondef(routine.oid) like
               '%' || corrected_expression || '%'
    ) then
      raise exception 'The TeleBirr shadow runtime-startup recovery repair did not preserve its boundary.';
    end if;
  else
    raise exception 'The TeleBirr shadow runtime-startup recovery function does not match either reviewed source digest.';
  end if;
end
$fix_telebirr_shadow_runtime_retry_least$;

commit;
