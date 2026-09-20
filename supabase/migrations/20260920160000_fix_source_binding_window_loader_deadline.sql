-- Bind the reviewed source-binding retry deadline into the global shadow evidence loader.
--
-- The retry migration extended the authority loader and newest-evidence ordering, but the global
-- evidence loader still evaluated the child's preserved historical submitted_at timestamp. That
-- made an otherwise valid append-only retry invisible before the trusted verifier could evaluate
-- its signed evidence. Rewrite exactly one reviewed CASE branch, retain the ordinary and existing
-- recovery deadlines, and preserve every owner, ACL, search-path, volatility, parallel-safety,
-- leakproof, security-definer, and set-returning property.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $bind_source_binding_window_loader_deadline$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.load_next_private_telebirr_shadow_staged_evidence()'
  );
  expected_source_sha256 constant text := '938d802013e88cdb3c7c2591c620bdf9d2d0caf5c80ed3deecf13c3df11634da';
  old_fragment constant text :=
    '       else proof.submitted_at + interval ''12 hours''';
  new_fragment constant text :=
    '       when proof.source_binding_window_retry_source_id is not null'
    || pg_catalog.chr(10)
    || '         then app.private_telebirr_shadow_source_binding_window_review_deadline('
    || pg_catalog.chr(10)
    || '           proof.id'
    || pg_catalog.chr(10)
    || '         )'
    || pg_catalog.chr(10)
    || old_fragment;
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
     and routine.prosecdef
     and routine.proretset
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     );

  if original_definition is null
    or pg_catalog.encode(
         extensions.digest(original_source, 'sha256'),
         'hex'
       ) <> expected_source_sha256
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, ''))
    ) / pg_catalog.length(old_fragment) <> 1
    or pg_catalog.strpos(original_source, new_fragment) <> 0
    or pg_catalog.strpos(
         original_source,
         'proof.source_binding_window_retry_source_id is null'
       ) = 0
    or pg_catalog.to_regprocedure(
         'app.private_telebirr_shadow_source_binding_window_review_deadline(uuid)'
       ) is null then
    raise exception 'The TeleBirr staged-evidence loader deadline shape is not reviewed.';
  end if;

  rewritten_definition := pg_catalog.replace(
    original_definition,
    old_fragment,
    new_fragment
  );
  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute rewritten_definition;

  if not exists (
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
    raise exception 'The staged-evidence loader deadline rewrite changed its authority.';
  end if;
end;
$bind_source_binding_window_loader_deadline$;

comment on function app.load_next_private_telebirr_shadow_staged_evidence() is
  'Loads immutable staged evidence inside its exact reviewed no-money deadline, including a valid append-only source-binding window retry, and selects only the newest eligible attempt for every retry branch.';

commit;
