-- Repair the already-deployed provider-origin retry digest without changing its authority.
--
-- The reviewed append-only retry migration referenced a nonexistent helper name. Every other
-- private TeleBirr lineage digest uses private_live_deposit_pilot_sha256(text). Guard the exact
-- deployed routine source, replace only that one helper call, and prove all function authority
-- metadata is unchanged. The failed production invocation was transactional and inserted no row.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $fix_provider_origin_retry_digest_helper$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.private_telebirr_shadow_provider_origin_retry_digest(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,text,integer,text,integer,integer,timestamptz,timestamptz,text,text)'
  );
  expected_source_sha256 constant text := '4e4bf3c3494beca975e8100bfbf04a2d290eb169768689b6e383cc416a48e442';
  defective_fragment constant text := 'app.private_live_deposit_pilot_digest(';
  corrected_fragment constant text := 'app.private_live_deposit_pilot_sha256(';
  original_definition text;
  original_source text;
  corrected_definition text;
  corrected_source text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  original_volatility "char";
  original_parallel "char";
  original_leakproof boolean;
  original_security_definer boolean;
  original_returns_set boolean;
  original_return_type oid;
  original_argument_count smallint;
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
         routine.proretset,
         routine.prorettype,
         routine.pronargs
    into original_definition,
         original_source,
         original_owner,
         original_acl,
         original_config,
         original_volatility,
         original_parallel,
         original_leakproof,
         original_security_definer,
         original_returns_set,
         original_return_type,
         original_argument_count
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.pronargs = 22
     and routine.prorettype = 'pg_catalog.text'::pg_catalog.regtype
     and routine.provolatile = 'i'
     and routine.proparallel = 'u'
     and not routine.proleakproof
     and routine.prosecdef
     and not routine.proretset
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     );

  if original_definition is null
    or original_source is null
    or pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'),
         'hex'
       ) <> expected_source_sha256
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, defective_fragment, ''))
    ) / pg_catalog.length(defective_fragment) <> 1
    or pg_catalog.strpos(original_source, corrected_fragment) <> 0 then
    raise exception 'The provider-origin retry digest does not match the reviewed defect.';
  end if;

  corrected_definition := pg_catalog.replace(
    original_definition,
    defective_fragment,
    corrected_fragment
  );
  corrected_source := pg_catalog.replace(
    original_source,
    defective_fragment,
    corrected_fragment
  );
  execute corrected_definition;

  if pg_catalog.strpos(corrected_source, defective_fragment) <> 0
    or (
      pg_catalog.length(corrected_source)
      - pg_catalog.length(pg_catalog.replace(corrected_source, corrected_fragment, ''))
    ) / pg_catalog.length(corrected_fragment) <> 1
    or not exists (
      select 1
        from pg_catalog.pg_proc routine
       where routine.oid = routine_oid
         and routine.prosrc = corrected_source
         and routine.proowner = original_owner
         and routine.proacl is not distinct from original_acl
         and routine.proconfig is not distinct from original_config
         and routine.provolatile = original_volatility
         and routine.proparallel = original_parallel
         and routine.proleakproof = original_leakproof
         and routine.prosecdef = original_security_definer
         and routine.proretset = original_returns_set
         and routine.prorettype = original_return_type
         and routine.pronargs = original_argument_count
    ) then
    raise exception 'The provider-origin retry digest repair changed its authority.';
  end if;
end;
$fix_provider_origin_retry_digest_helper$;

comment on function app.private_telebirr_shadow_provider_origin_retry_digest(
  uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  integer, text, integer, text, integer, integer, timestamptz, timestamptz, text, text
) is
  'Derives the immutable provider-origin retry lineage digest with the reviewed private SHA-256 helper.';

commit;
