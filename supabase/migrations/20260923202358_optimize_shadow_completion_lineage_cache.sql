-- The no-money completion guard calls this validator before and after its
-- lock-sensitive mode check. Preserve both checks. Within each call, evaluate
-- the immutable historical source witnesses once instead of repeating the
-- same deep signed-history walk in several Boolean clauses.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $cache_shadow_retry_lineage$
declare
  routine_oid oid;
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
  before_results boolean[];
  after_results boolean[];
  old_network text := $network$app.private_telebirr_receipt_shape_network_source_is_valid(source.id)$network$;
  old_diagnostic text := $diagnostic$app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
            source.id
          )$diagnostic$;
  select_anchor text := E'\n  select pg_catalog.count(*) = 1';
  where_anchor text := E'\n   where retry.retry_request_key = p_retry_request_key';
begin
  select routine.oid, pg_catalog.pg_get_functiondef(routine.oid),
         routine.prosrc, routine.proowner, routine.proacl, routine.proconfig,
         routine.provolatile, routine.proparallel, routine.proleakproof,
         routine.prosecdef, routine.proretset
    into routine_oid, original_definition, original_source, original_owner,
         original_acl, original_config, original_volatility,
         original_parallel, original_leakproof, original_security_definer,
         original_returns_set
    from pg_catalog.pg_proc routine
   where routine.pronamespace = 'app'::regnamespace
     and routine.proname =
         'private_telebirr_shadow_source_unavailable_retry_is_valid'
     and routine.pronargs = 2
     and routine.prokind = 'f';

  if routine_oid is null
    or original_owner is distinct from (
      select role.oid from pg_catalog.pg_roles role
       where role.rolname = 'postgres'
    )
    or original_config is distinct from array['search_path=pg_catalog']::text[]
    or original_volatility is distinct from 's'
    or original_parallel is distinct from 'u'
    or original_leakproof
    or not original_security_definer
    or original_returns_set
    or pg_catalog.encode(
         extensions.digest(
           pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'
         ), 'hex'
       ) <> '7e99055e2dfa68e0ca4483ca9edde942235e851ca81bd04f7a565b4264eb7447'
    or (pg_catalog.length(original_definition) -
        pg_catalog.length(pg_catalog.replace(
          original_definition, original_source, ''
        ))) / pg_catalog.length(original_source) <> 1
    or (pg_catalog.length(original_source) -
        pg_catalog.length(pg_catalog.replace(original_source, old_network, '')))
       / pg_catalog.length(old_network) <> 2
    or (pg_catalog.length(original_source) -
        pg_catalog.length(pg_catalog.replace(
          original_source, old_diagnostic, ''
        ))) / pg_catalog.length(old_diagnostic) <> 2
    or (pg_catalog.length(original_source) -
        pg_catalog.length(pg_catalog.replace(
          original_source, select_anchor, ''
        ))) / pg_catalog.length(select_anchor) <> 1
    or (pg_catalog.length(original_source) -
        pg_catalog.length(pg_catalog.replace(
          original_source, where_anchor, ''
        ))) / pg_catalog.length(where_anchor) <> 1
  then
    raise exception 'The reviewed no-money retry validator changed shape.';
  end if;

  select pg_catalog.array_agg(
           app.private_telebirr_shadow_source_unavailable_retry_is_valid(
             retry.replacement_shadow_proof_request_id,
             retry.retry_request_key
           )
           order by retry.retry_request_key
         )
    into before_results
    from app.private_telebirr_shadow_source_unavailable_retries retry;

  rewritten_source := pg_catalog.replace(
    original_source, old_network, 'source_validation.network_source_valid'
  );
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_diagnostic,
    'source_validation.diagnostic_source_valid'
  );
  rewritten_source := pg_catalog.replace(
    rewritten_source, where_anchor,
    $join$
    join source_validation
      on source_validation.source_id = source.id
     and source_validation.retry_request_key = retry.retry_request_key
     and source_validation.replacement_id = replacement.id
   where retry.retry_request_key = p_retry_request_key$join$
  );
  rewritten_source := pg_catalog.replace(
    rewritten_source, select_anchor,
    $source_cache$
  with source_validation as materialized (
    select source.id as source_id,
           retry.retry_request_key,
           replacement.id as replacement_id,
           app.private_telebirr_receipt_shape_network_source_is_valid(source.id)
             as network_source_valid,
           app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
             source.id
           ) as diagnostic_source_valid
      from app.private_telebirr_shadow_source_unavailable_retries retry
      join app.private_telebirr_shadow_proof_requests source
        on source.id = retry.source_shadow_proof_request_id
       and source.verification_job_id = retry.source_shadow_verification_job_id
      join app.private_telebirr_shadow_verification_outcomes source_outcome
        on source_outcome.id = retry.source_outcome_id
       and source_outcome.shadow_proof_request_id = source.id
      join app.private_telebirr_shadow_proof_requests replacement
        on replacement.id = retry.replacement_shadow_proof_request_id
       and replacement.verification_job_id =
           retry.replacement_shadow_verification_job_id
     where retry.retry_request_key = p_retry_request_key
       and replacement.id = p_replacement_shadow_proof_request_id
  )
  select pg_catalog.count(*) = 1$source_cache$
  );

  if (pg_catalog.length(rewritten_source) -
      pg_catalog.length(pg_catalog.replace(
        rewritten_source, old_network, ''
      ))) / pg_catalog.length(old_network) <> 1
    or (pg_catalog.length(rewritten_source) -
        pg_catalog.length(pg_catalog.replace(
          rewritten_source,
          'app.private_telebirr_receipt_transport_diagnostic_source_is_valid(',
          ''
        ))) /
        pg_catalog.length(
          'app.private_telebirr_receipt_transport_diagnostic_source_is_valid('
        ) <> 1
    or (pg_catalog.length(rewritten_source) -
        pg_catalog.length(pg_catalog.replace(
          rewritten_source, 'source_validation.network_source_valid', ''
        ))) /
        pg_catalog.length('source_validation.network_source_valid') <> 2
    or (pg_catalog.length(rewritten_source) -
        pg_catalog.length(pg_catalog.replace(
          rewritten_source, 'source_validation.diagnostic_source_valid', ''
        ))) /
        pg_catalog.length('source_validation.diagnostic_source_valid') <> 2
  then
    raise exception 'The source-validation cache did not preserve its shape.';
  end if;

  execute pg_catalog.replace(
    original_definition, original_source, rewritten_source
  );

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
       and not pg_catalog.has_function_privilege(
         'anon', routine.oid, 'EXECUTE'
       )
       and not pg_catalog.has_function_privilege(
         'authenticated', routine.oid, 'EXECUTE'
       )
  ) then
    raise exception 'The no-money retry validator lost its ACL boundary.';
  end if;

  select pg_catalog.array_agg(
           app.private_telebirr_shadow_source_unavailable_retry_is_valid(
             retry.replacement_shadow_proof_request_id,
             retry.retry_request_key
           )
           order by retry.retry_request_key
         )
    into after_results
    from app.private_telebirr_shadow_source_unavailable_retries retry;

  if before_results is distinct from after_results then
    raise exception 'Historical retry validity changed after memoization.';
  end if;
end;
$cache_shadow_retry_lineage$;

commit;
