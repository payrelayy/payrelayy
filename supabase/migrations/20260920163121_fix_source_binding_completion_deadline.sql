-- Bind the reviewed source-binding retry deadline into both terminal completion checks.
--
-- The loader and authority paths already recognize the append-only retry window, but the
-- no-money completion routine still fell back to the child's preserved historical submitted_at
-- timestamp. Rewrite exactly the two reviewed deadline CASE expressions, fall back to the
-- historical deadline if the retry helper fails closed, and preserve every routine authority
-- property.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $bind_source_binding_window_completion_deadline$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.complete_private_telebirr_shadow_verification(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,bigint,timestamp with time zone,text)'
  );
  expected_source_sha256 constant text :=
    '38fe1ac7ce772cef84d29e4292a232ae3fffbc66667846741ed012aa2702c1e0';
  old_fragment constant text :=
    '      when proof.recovery_request_key is not null';
  new_fragment constant text :=
    '      when proof.source_binding_window_retry_source_id is not null'
    || pg_catalog.chr(10)
    || '        then coalesce('
    || pg_catalog.chr(10)
    || '          app.private_telebirr_shadow_source_binding_window_review_deadline('
    || pg_catalog.chr(10)
    || '            proof.id'
    || pg_catalog.chr(10)
    || '          ),'
    || pg_catalog.chr(10)
    || '          proof.submitted_at + interval ''12 hours'''
    || pg_catalog.chr(10)
    || '        )'
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
     and routine.pronargs = 20
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
    ) / pg_catalog.length(old_fragment) <> 2
    or pg_catalog.strpos(original_source, new_fragment) <> 0
    or pg_catalog.strpos(
         original_source,
         'and app.private_live_telebirr_source_recovery_is_valid('
       ) = 0
    or pg_catalog.strpos(
         original_source,
         'else proof.submitted_at + interval ''12 hours'''
       ) = 0
    or pg_catalog.to_regprocedure(
         'app.private_telebirr_shadow_source_binding_window_review_deadline(uuid)'
       ) is null then
    raise exception 'The TeleBirr shadow completion deadline shape is not reviewed.';
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
    raise exception 'The shadow completion deadline rewrite changed its authority.';
  end if;
end;
$bind_source_binding_window_completion_deadline$;

comment on function app.complete_private_telebirr_shadow_verification(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) is
  'Records one advisory no-money TeleBirr shadow outcome inside its exact reviewed deadline, including a valid append-only source-binding window retry. It never creates financial rows.';

commit;
