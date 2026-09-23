-- Align the derived network-source historical witness with the already-reviewed
-- terminal receipt-shape rule: the signed terminal observation must match, while
-- earlier signed attempts may have different review reasons. Preserve their
-- complete attempt and evidence-history digests and every no-money boundary.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $align_network_historical_review_count$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.private_telebirr_receipt_shape_network_source_is_valid(uuid)'
  );
  expected_source_sha256 constant text := 'fad8f4d63006ac6019eaff7ce83ad1f79ab0094392fb31605de12d5aa985e476';
  old_fragment constant text :=
    '       and retry.source_receipt_shape_diag_review_count = retry.source_attempt_count';
  new_fragment constant text :=
    '       and retry.source_receipt_shape_diag_review_count between 1 and retry.source_attempt_count';
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
  source_count integer;
  valid_count integer;
begin
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl, routine.proconfig,
         routine.provolatile, routine.proparallel, routine.proleakproof,
         routine.prosecdef, routine.proretset
    into original_definition, original_source, original_owner, original_acl,
         original_config, original_volatility, original_parallel,
         original_leakproof, original_security_definer, original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     )
     and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
     and not pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
     and not pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE');

  if original_definition is null
    or pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'),
         'hex'
       ) <> expected_source_sha256
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, ''))
    ) / pg_catalog.length(old_fragment) <> 1
    or pg_catalog.strpos(original_source, new_fragment) <> 0
    or (
      pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(
          original_definition, original_source, ''
        ))
    ) / pg_catalog.length(original_source) <> 1 then
    raise exception 'The historical network-source validator is not reviewed.';
  end if;

  rewritten_source := pg_catalog.replace(
    original_source, old_fragment, new_fragment
  );
  execute pg_catalog.replace(
    original_definition, original_source, rewritten_source
  );

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
       and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
       and not pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
       and not pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
  ) then
    raise exception 'The corrected historical validator changed its authority.';
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (
           where app.private_telebirr_receipt_shape_network_source_is_valid(proof.id)
         )::integer
    into source_count, valid_count
    from app.private_telebirr_shadow_receipt_shape_diag_retries retry
    join app.private_telebirr_shadow_proof_requests proof
      on proof.id = retry.replacement_shadow_proof_request_id
     and proof.verification_job_id = retry.replacement_shadow_verification_job_id;

  -- Empty disposable databases pass. The reviewed production recovery has one
  -- historical source, and it must become valid without creating any child.
  if source_count > 1 or (source_count = 1 and valid_count <> 1) then
    raise exception 'The corrected historical source witness did not validate.';
  end if;
end;
$align_network_historical_review_count$;

commit;
