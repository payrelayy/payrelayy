-- The diagnostic source has an authenticated terminal invoice-layout review, but not every
-- earlier attempt has that same review reason. Keep every signed attempt and its digest bound,
-- require at least one matching review and the exact terminal observation witness, and leave
-- all no-money, owner, ACL, enrollment, pilot, and queue guards unchanged.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $receipt_shape_terminal_review_check$
declare
  target_table regclass := pg_catalog.to_regclass(
    'app.private_telebirr_shadow_receipt_shape_diag_retries'
  );
  previous_constraint text;
  matching_constraints integer;
begin
  if target_table is null
    or (select pg_catalog.count(*)
          from app.private_telebirr_shadow_receipt_shape_diag_retries) <> 0 then
    raise exception 'The diagnostic retry ledger is not empty and cannot be amended.';
  end if;

  select pg_catalog.count(*)::integer, pg_catalog.min(constraint_row.conname)
    into matching_constraints, previous_constraint
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_attribute attempt_column
      on attempt_column.attrelid = constraint_row.conrelid
     and attempt_column.attname = 'source_attempt_count'
    join pg_catalog.pg_attribute review_column
      on review_column.attrelid = constraint_row.conrelid
     and review_column.attname = 'source_receipt_shape_diag_review_count'
   where constraint_row.conrelid = target_table
     and constraint_row.contype = 'c'
     and pg_catalog.array_length(constraint_row.conkey, 1) = 2
     and constraint_row.conkey @> array[
           attempt_column.attnum, review_column.attnum
         ]::smallint[]
     and pg_catalog.pg_get_constraintdef(constraint_row.oid) like
         '%source_receipt_shape_diag_review_count = source_attempt_count%';

  if matching_constraints <> 1 or previous_constraint is null then
    raise exception 'The diagnostic review-count constraint is not reviewed.';
  end if;

  execute pg_catalog.format(
    'alter table app.private_telebirr_shadow_receipt_shape_diag_retries drop constraint %I',
    previous_constraint
  );
  alter table app.private_telebirr_shadow_receipt_shape_diag_retries
    add constraint private_tbirr_shape_diag_terminal_review_count_check
    check (source_receipt_shape_diag_review_count between 1 and source_attempt_count);
end;
$receipt_shape_terminal_review_check$;

do $receipt_shape_terminal_digest$
declare
  routine_oid oid;
  expected_source_sha256 constant text := 'c3c19fded0d510318063496ea990bad6b4eabefcdc756bbe8445cf69f3d85409';
  old_fragment constant text :=
    '    or p_source_receipt_shape_diag_review_count is distinct from p_source_attempt_count';
  new_fragment constant text :=
    '    or p_source_receipt_shape_diag_review_count is null' || pg_catalog.chr(10)
    || '    or p_source_receipt_shape_diag_review_count < 1' || pg_catalog.chr(10)
    || '    or p_source_receipt_shape_diag_review_count > p_source_attempt_count';
  original_definition text;
  original_source text;
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
  select routine.oid into routine_oid
    from pg_catalog.pg_proc routine
   where routine.pronamespace = 'app'::regnamespace
     and routine.proname = 'private_telebirr_shadow_receipt_shape_diag_retry_digest'
     and routine.pronargs = 22;
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc, routine.proowner,
         routine.proacl, routine.proconfig, routine.provolatile, routine.proparallel,
         routine.proleakproof, routine.prosecdef, routine.proretset
    into original_definition, original_source, original_owner, original_acl,
         original_config, original_volatility, original_parallel, original_leakproof,
         original_security_definer, original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.prosecdef
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
    ) / pg_catalog.length(old_fragment) <> 1 then
    raise exception 'The diagnostic digest helper source is not reviewed.';
  end if;

  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute pg_catalog.replace(original_definition, old_fragment, new_fragment);
  if not exists (
    select 1 from pg_catalog.pg_proc routine
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
    raise exception 'The diagnostic digest-helper rewrite changed its authority.';
  end if;
end;
$receipt_shape_terminal_digest$;

do $receipt_shape_terminal_retry$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.retry_reviewed_private_telebirr_receipt_shape_diag(text,text)'
  );
  expected_source_sha256 constant text := 'ce2a8fa4829187b5322f69fd0369401ab33fd576794a6b2786c8afa76fb921bf';
  old_fragment constant text :=
    '    or source_opening_reviews <> source_attempts';
  new_fragment constant text :=
    '    or source_opening_reviews < 1' || pg_catalog.chr(10)
    || '    or source_opening_reviews > source_attempts';
  original_definition text;
  original_source text;
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
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc, routine.proowner,
         routine.proacl, routine.proconfig, routine.provolatile, routine.proparallel,
         routine.proleakproof, routine.prosecdef, routine.proretset
    into original_definition, original_source, original_owner, original_acl,
         original_config, original_volatility, original_parallel, original_leakproof,
         original_security_definer, original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.pronargs = 2
     and routine.prosecdef
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
    ) / pg_catalog.length(old_fragment) <> 1 then
    raise exception 'The diagnostic retry function source is not reviewed.';
  end if;

  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute pg_catalog.replace(original_definition, old_fragment, new_fragment);
  if not exists (
    select 1 from pg_catalog.pg_proc routine
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
    raise exception 'The diagnostic retry-function rewrite changed its authority.';
  end if;
end;
$receipt_shape_terminal_retry$;

commit;
