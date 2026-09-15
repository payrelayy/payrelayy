-- Repair the already-deployed expired-pilot recovery function without broadening its authority.
-- LEAST is PostgreSQL expression syntax and cannot be schema-qualified as pg_catalog.least().

begin;

do $fix_expired_telebirr_shadow_recovery_least$
declare
  recovery_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.recover_expired_private_live_telebirr_payment_to_shadow(uuid,uuid,uuid,uuid,text)'
  );
  expected_source_sha256 constant text :=
    '2b82945ec661374530174c236afc916b15717de92165c0e37731bdac6ba1e699';
  defective_expression constant text := 'recovered_until := pg_catalog.least(';
  corrected_expression constant text := 'recovered_until := least(';
  original_definition text;
  corrected_definition text;
  original_source text;
  corrected_source text;
  original_owner oid;
  original_acl aclitem[];
begin
  if recovery_signature is null then
    raise exception 'The expired-pilot recovery function is unavailable.';
  end if;

  select routine.prosrc,
         routine.proowner,
         routine.proacl,
         pg_catalog.pg_get_functiondef(routine.oid)
    into original_source,
         original_owner,
         original_acl,
         original_definition
    from pg_catalog.pg_proc routine
   where routine.oid = recovery_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proretset
     and routine.pronargs = 5
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     )
     and pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         ) = expected_source_sha256;

  if original_definition is null
    or original_source is null
    or pg_catalog.length(original_definition)
         - pg_catalog.length(pg_catalog.replace(original_definition, defective_expression, ''))
       <> pg_catalog.length(defective_expression)
    or pg_catalog.length(original_source)
         - pg_catalog.length(pg_catalog.replace(original_source, defective_expression, ''))
       <> pg_catalog.length(defective_expression)
    or original_definition like '%' || corrected_expression || '%'
    or original_source like '%' || corrected_expression || '%' then
    raise exception 'The expired-pilot recovery function does not match the reviewed defect.';
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
       and pg_catalog.pg_get_functiondef(routine.oid) not like
             '%' || defective_expression || '%'
       and pg_catalog.pg_get_functiondef(routine.oid) like
             '%' || corrected_expression || '%'
  ) then
    raise exception 'The expired-pilot recovery function repair did not preserve its boundary.';
  end if;
end
$fix_expired_telebirr_shadow_recovery_least$;

commit;
