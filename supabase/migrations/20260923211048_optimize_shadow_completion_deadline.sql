-- Keep both no-money completion authority checks. Each check already validates
-- the historical source before requesting its retry deadline. Inline only the
-- deadline lookup's remaining lineage predicate, avoiding a second identical
-- source-history walk within each check. Never cache across the lock boundary.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

do $deduplicate_shadow_completion_deadline$
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
  compared_count bigint;
  mismatch_count bigint;
  old_call text :=
    'app.private_telebirr_receipt_shape_network_retry_deadline(proof.id)';
  new_call text := $deadline$
(
  select retry.retry_expires_at
    from app.private_telebirr_shadow_source_unavailable_retries retry
    join app.private_telebirr_shadow_proof_requests replacement
      on replacement.id = retry.replacement_shadow_proof_request_id
     and replacement.verification_job_id =
         retry.replacement_shadow_verification_job_id
   where replacement.id = proof.id
     and replacement.source_unavailable_retry_source_id =
         retry.source_shadow_proof_request_id
     and app.private_telebirr_shadow_source_unavailable_retry_is_valid(
           replacement.id, retry.retry_request_key
         )
)$deadline$;
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
     and routine.proname = 'complete_private_telebirr_shadow_verification'
     and routine.pronargs = 20
     and routine.prokind = 'f';

  if routine_oid is null
    or original_owner is distinct from (
      select role.oid from pg_catalog.pg_roles role
       where role.rolname = 'postgres'
    )
    or original_config is distinct from array['search_path=pg_catalog']::text[]
    or original_volatility is distinct from 'v'
    or original_parallel is distinct from 'u'
    or original_leakproof
    or not original_security_definer
    or not original_returns_set
    or pg_catalog.encode(
         extensions.digest(
           pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'
         ), 'hex'
       ) <> '5144efdf6cebce3f839e2dafbd2a69ef41810147b254eaea095ebd493abe25dd'
    or (pg_catalog.length(original_definition) -
        pg_catalog.length(pg_catalog.replace(
          original_definition, original_source, ''
        ))) / pg_catalog.length(original_source) <> 1
    or (pg_catalog.length(original_source) -
        pg_catalog.length(pg_catalog.replace(
          original_source, old_call, ''
        ))) / pg_catalog.length(old_call) <> 2
    or (pg_catalog.length(original_source) -
        pg_catalog.length(pg_catalog.replace(
          original_source, 'authority_at := pg_catalog.clock_timestamp();', ''
        ))) / pg_catalog.length(
          'authority_at := pg_catalog.clock_timestamp();'
        ) <> 2
    or (pg_catalog.length(original_source) -
        pg_catalog.length(pg_catalog.replace(
          original_source, 'staged.staged_at >= proof.expires_at', ''
        ))) / pg_catalog.length(
          'staged.staged_at >= proof.expires_at'
        ) <> 2
    or pg_catalog.has_function_privilege('anon', routine_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'authenticated', routine_oid, 'EXECUTE'
    )
  then
    raise exception 'The reviewed no-money completion contract changed.';
  end if;

  -- The scalar inline lookup has the same at-most-one-row guarantee as the
  -- existing deadline helper.
  if not exists (
    select 1
      from pg_catalog.pg_index idx
      join pg_catalog.pg_attribute col
        on col.attrelid = idx.indrelid
       and col.attname = 'replacement_shadow_proof_request_id'
     where idx.indrelid =
           'app.private_telebirr_shadow_source_unavailable_retries'::regclass
       and idx.indisunique
       and idx.indisvalid
       and idx.indnkeyatts = 1
       and idx.indkey[0] = col.attnum
  ) then
    raise exception 'The reviewed no-money retry uniqueness is unavailable.';
  end if;

  -- Under the unchanged outer source-validity branch, compare the old helper
  -- with the proposed inline lookup for every historical retry, including
  -- expired and invalid children. The helper remains installed for all other
  -- callers.
  with source_gate as materialized (
    select proof.id as proof_id,
           proof.source_unavailable_retry_source_id as source_id,
           proof.submitted_at,
           (
             app.private_telebirr_receipt_shape_network_source_is_valid(
               proof.source_unavailable_retry_source_id
             )
             or app.private_telebirr_receipt_transport_diagnostic_source_is_valid(
               proof.source_unavailable_retry_source_id
             )
           ) as source_valid
      from app.private_telebirr_shadow_source_unavailable_retries retry
      join app.private_telebirr_shadow_proof_requests proof
        on proof.id = retry.replacement_shadow_proof_request_id
  ), compared as (
    select case
             when source_gate.source_id is not null
              and source_gate.source_valid
             then app.private_telebirr_receipt_shape_network_retry_deadline(
                    source_gate.proof_id
                  )
             else source_gate.submitted_at + interval '12 hours'
           end as prior_deadline,
           case
             when source_gate.source_id is not null
              and source_gate.source_valid
             then (
               select retry.retry_expires_at
                 from app.private_telebirr_shadow_source_unavailable_retries retry
                 join app.private_telebirr_shadow_proof_requests replacement
                   on replacement.id = retry.replacement_shadow_proof_request_id
                  and replacement.verification_job_id =
                      retry.replacement_shadow_verification_job_id
                where replacement.id = source_gate.proof_id
                  and replacement.source_unavailable_retry_source_id =
                      retry.source_shadow_proof_request_id
                  and app.private_telebirr_shadow_source_unavailable_retry_is_valid(
                        replacement.id, retry.retry_request_key
                      )
             )
             else source_gate.submitted_at + interval '12 hours'
           end as revised_deadline
      from source_gate
  )
  select pg_catalog.count(*),
         pg_catalog.count(*) filter (
           where prior_deadline is distinct from revised_deadline
         )
    into compared_count, mismatch_count
    from compared;

  if compared_count is distinct from (
    select pg_catalog.count(*)
      from app.private_telebirr_shadow_source_unavailable_retries
  ) or mismatch_count <> 0 then
    raise exception 'Historical no-money completion deadlines changed.';
  end if;

  rewritten_source := pg_catalog.replace(
    original_source, old_call, new_call
  );
  if (pg_catalog.length(rewritten_source) -
      pg_catalog.length(pg_catalog.replace(
        rewritten_source, old_call, ''
      ))) / pg_catalog.length(old_call) <> 0
    or (pg_catalog.length(rewritten_source) -
        pg_catalog.length(pg_catalog.replace(
          rewritten_source,
          'replacement.source_unavailable_retry_source_id =',
          ''
        ))) / pg_catalog.length(
          'replacement.source_unavailable_retry_source_id ='
        ) <> 2
  then
    raise exception 'The no-money completion rewrite changed shape.';
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
    raise exception 'The no-money completion lost its ACL boundary.';
  end if;
end;
$deduplicate_shadow_completion_deadline$;

commit;
