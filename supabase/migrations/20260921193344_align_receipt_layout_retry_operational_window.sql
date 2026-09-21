-- Replace the redundant near-full-pilot requirement with an explicit operational margin.
--
-- The append-only receipt-layout retry remains a fixed twelve-hour, one-shot, no-money child.
-- Its target Android enrollment, assignment signer, receiver profile, dry-run pilot boundary, and
-- every disabled financial switch are revalidated by the existing function. Requiring the target
-- pilot to retain eleven hours and fifty minutes made those unchanged checks usable for only the
-- first ten minutes of a twelve-hour pilot. A full one-hour remaining target-pilot window preserves
-- ample time for the immediate shadow verifier and fail-closed cleanup without weakening any
-- lineage, authority, immutability, replay, or money-movement boundary.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $align_receipt_layout_retry_window$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.retry_reviewed_private_telebirr_source_binding_receipt_layout(text,text)'
  );
  expected_source_sha256 constant text := '3ba065c9ff5fe62db6c722c6e295831c109ba5469d9143963d18c6dc65f5ff8f';
  old_fragment constant text :=
    'target_pilot.expires_at <= v_authorized_at + interval ''11 hours 50 minutes''';
  new_fragment constant text :=
    'target_pilot.expires_at <= v_authorized_at + interval ''1 hour''';
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
     and routine.pronargs = 2
     and routine.prorettype = 'pg_catalog.record'::pg_catalog.regtype
     and routine.provolatile = 'v'
     and routine.proparallel = 'u'
     and not routine.proleakproof
     and routine.prosecdef
     and routine.proretset
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
    raise exception 'The receipt-layout retry routine shape is not reviewed.';
  end if;

  rewritten_definition := pg_catalog.replace(
    original_definition,
    old_fragment,
    new_fragment
  );
  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute rewritten_definition;

  if pg_catalog.strpos(rewritten_source, old_fragment) <> 0
    or (
      pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, new_fragment, ''))
    ) / pg_catalog.length(new_fragment) <> 1
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
         and routine.prorettype = original_return_type
         and routine.pronargs = original_argument_count
    ) then
    raise exception 'The receipt-layout retry window rewrite changed its authority.';
  end if;
end;
$align_receipt_layout_retry_window$;

comment on function app.retry_reviewed_private_telebirr_source_binding_receipt_layout(text, text) is
  'Creates one immutable twelve-hour no-money receipt-layout retry when the paired target pilot has at least one full operational hour remaining.';

commit;
