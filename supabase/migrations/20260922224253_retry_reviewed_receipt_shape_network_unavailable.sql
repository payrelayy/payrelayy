-- No-money retry for a signed network-unavailable outcome on a receipt-shape child.
-- The historical submission time is intentionally not renewed. Only the immutable
-- diagnostic child creation time may bound one further evidence-only observation.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function app.private_telebirr_receipt_shape_network_source_is_valid(
  p_source_shadow_proof_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  with exact_source as materialized (
    select proof.id,
           proof.created_at,
           outcome.observation_body_digest
      from app.private_telebirr_shadow_receipt_shape_diag_retries retry
      join app.private_telebirr_shadow_proof_requests proof
        on proof.id = retry.replacement_shadow_proof_request_id
       and proof.verification_job_id = retry.replacement_shadow_verification_job_id
      join app.private_telebirr_shadow_verification_outcomes outcome
        on outcome.shadow_proof_request_id = proof.id
       and outcome.verification_job_id = proof.verification_job_id
     where proof.id = p_source_shadow_proof_request_id
       and proof.proof_status = 'verification_queued'
       and proof.source_unavailable_retry_source_id is null
       and not exists (
         select 1
           from app.telegram_telebirr_shadow_proof_receipts receipt
          where receipt.shadow_proof_request_id = proof.id
       )
       and app.private_telebirr_shadow_receipt_shape_diag_retry_is_valid(
             proof.id, retry.retry_request_key
           )
       and outcome.disposition = 'review_required'
       and outcome.reason_code = 'source_unavailable'
       and outcome.protocol_disposition = 'would_review'
       and outcome.protocol_reason_code = 'receipt_requires_review'
       and not outcome.would_verify
       and outcome.principal_amount_minor is null
       and outcome.occurred_at is null
       and outcome.receiver_identity_digest is null
  ), observations as materialized (
    select attempt.id as verification_attempt_id,
           staged.observation_body_digest,
           staged.staged_at,
           staged.signed_observation -> 'body' -> 'facts' ->> 'lookupOutcome'
             as lookup_outcome,
           staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason'
             as review_reason,
           staged.signed_observation -> 'body' -> 'facts' ->> 'principalAmountMinor'
             as principal_amount_minor,
           staged.signed_observation -> 'body' -> 'facts' ->> 'occurredAt'
             as occurred_at,
           staged.signed_observation -> 'body' -> 'facts' ->> 'receiverIdentityDigest'
             as receiver_identity_digest
      from exact_source source
      join app.private_telebirr_shadow_verification_attempts attempt
        on attempt.shadow_proof_request_id = source.id
      left join app.private_telebirr_shadow_device_evidence_staging staged
        on staged.verification_attempt_id = attempt.id
  )
  select (select pg_catalog.count(*) from exact_source) = 1
     and (select pg_catalog.count(*) from observations) between 1 and 100
     and (select pg_catalog.count(distinct verification_attempt_id)
            from observations) = (select pg_catalog.count(*) from observations)
     and not exists (
       select 1 from observations observation
        where observation.observation_body_digest is null
           or observation.staged_at is null
           or observation.lookup_outcome is distinct from 'review_required'
           or observation.review_reason is distinct from 'network_unavailable'
           or observation.principal_amount_minor is not null
           or observation.occurred_at is not null
           or observation.receiver_identity_digest is not null
     )
     and not exists (
       select 1
         from observations observation
         join app.private_telebirr_shadow_evidence_quarantine quarantine
           on quarantine.verification_attempt_id =
              observation.verification_attempt_id
           or quarantine.observation_body_digest =
              observation.observation_body_digest
     )
     and (
       select observation.observation_body_digest
         from observations observation
        order by observation.staged_at desc,
                 observation.observation_body_digest desc
        limit 1
     ) = (select source.observation_body_digest from exact_source source);
$$;

alter function app.private_telebirr_receipt_shape_network_source_is_valid(uuid)
  owner to postgres;
revoke all on function app.private_telebirr_receipt_shape_network_source_is_valid(uuid)
  from public, anon, authenticated, service_role;

comment on function app.private_telebirr_receipt_shape_network_source_is_valid(uuid) is
  'Binds one existing receipt-shape diagnostic child to its immutable network-unavailable outcome, all signed attempts, and the terminal observation without granting financial authority.';

create function app.private_telebirr_receipt_shape_network_retry_deadline(
  p_replacement_shadow_proof_request_id uuid
)
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select retry.retry_expires_at
    from app.private_telebirr_shadow_source_unavailable_retries retry
    join app.private_telebirr_shadow_proof_requests replacement
      on replacement.id = retry.replacement_shadow_proof_request_id
     and replacement.verification_job_id =
         retry.replacement_shadow_verification_job_id
   where replacement.id = p_replacement_shadow_proof_request_id
     and replacement.source_unavailable_retry_source_id =
         retry.source_shadow_proof_request_id
     and app.private_telebirr_receipt_shape_network_source_is_valid(
           retry.source_shadow_proof_request_id
         )
     and app.private_telebirr_shadow_source_unavailable_retry_is_valid(
           replacement.id, retry.retry_request_key
         );
$$;

alter function app.private_telebirr_receipt_shape_network_retry_deadline(uuid)
  owner to postgres;
revoke all on function app.private_telebirr_receipt_shape_network_retry_deadline(uuid)
  from public, anon, authenticated, service_role;

comment on function app.private_telebirr_receipt_shape_network_retry_deadline(uuid) is
  'Returns the immutable bounded deadline only for a validated receipt-shape network-unavailable descendant retry.';

do $network_retry_rewrite_0$
declare
  routine_oid oid := pg_catalog.to_regprocedure('app.guard_private_telebirr_shadow_source_retry_insert()');
  expected_source_sha256 constant text := 'cfe0a37539c95f14c35bdb71bf0eed0031e8df2b7e56527f49cdd1d6b2a63045';
  old_fragment_1 constant text := $old_0_0$    or new.expires_at > source_proof.submitted_at + interval '12 hours'$old_0_0$;
  new_fragment_1 constant text := $new_0_0$    or new.expires_at > (case
         when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
           then source_proof.created_at + interval '12 hours'
         else source_proof.submitted_at + interval '12 hours'
       end)$new_0_0$;
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
     );

  if original_definition is null
    or pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'),
         'hex'
       ) <> expected_source_sha256
    or (pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, original_source, '')))
      / pg_catalog.length(original_source) <> 1 then
    raise exception 'The reviewed retry function source is not exact.';
  end if;

  rewritten_source := original_source;
  if (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_1, '')))
      / pg_catalog.length(old_fragment_1) <> 1 then
    raise exception 'The reviewed retry function fragment is not unique.';
  end if;
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_1, new_fragment_1
  );
  execute pg_catalog.replace(original_definition, original_source, rewritten_source);

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
    raise exception 'The reviewed retry rewrite changed its authority.';
  end if;
end;
$network_retry_rewrite_0$;


do $network_retry_rewrite_1$
declare
  routine_oid oid := pg_catalog.to_regprocedure('app.private_telebirr_shadow_source_unavailable_retry_is_valid(uuid, uuid)');
  expected_source_sha256 constant text := 'c9e2352e49868c4e2701e87368635f384b0c984cf8b3211436827ea7cec59610';
  old_fragment_1 constant text := $old_1_0$       and exists (
         select 1
           from app.telegram_telebirr_shadow_proof_receipts receipt
          where receipt.shadow_proof_request_id = source.id
       )$old_1_0$;
  new_fragment_1 constant text := $new_1_0$       and (
         exists (
           select 1
             from app.telegram_telebirr_shadow_proof_receipts receipt
            where receipt.shadow_proof_request_id = source.id
         )
         or app.private_telebirr_receipt_shape_network_source_is_valid(source.id)
       )$new_1_0$;
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
     );

  if original_definition is null
    or pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'),
         'hex'
       ) <> expected_source_sha256
    or (pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, original_source, '')))
      / pg_catalog.length(original_source) <> 1 then
    raise exception 'The reviewed retry function source is not exact.';
  end if;

  rewritten_source := original_source;
  if (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_1, '')))
      / pg_catalog.length(old_fragment_1) <> 1 then
    raise exception 'The reviewed retry function fragment is not unique.';
  end if;
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_1, new_fragment_1
  );
  execute pg_catalog.replace(original_definition, original_source, rewritten_source);

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
    raise exception 'The reviewed retry rewrite changed its authority.';
  end if;
end;
$network_retry_rewrite_1$;


do $network_retry_rewrite_2$
declare
  routine_oid oid := pg_catalog.to_regprocedure('app.retry_private_telebirr_shadow_after_source_unavailable(uuid, uuid, uuid, text)');
  expected_source_sha256 constant text := '4c3bbab4decc86093fe9406be6d416138c199a2f964eaef00cd1e19c968552f8';
  old_fragment_1 constant text := $old_2_0$    or authorized_at >= source_proof.submitted_at + interval '12 hours'$old_2_0$;
  new_fragment_1 constant text := $new_2_0$    or authorized_at >= (case
         when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
           then source_proof.created_at + interval '12 hours'
         else source_proof.submitted_at + interval '12 hours'
       end)$new_2_0$;
  old_fragment_2 constant text := $old_2_1$    or not exists (
      select 1
        from app.telegram_telebirr_shadow_proof_receipts receipt
       where receipt.shadow_proof_request_id = source_proof.id
    )$old_2_1$;
  new_fragment_2 constant text := $new_2_1$    or not (
      exists (
        select 1
          from app.telegram_telebirr_shadow_proof_receipts receipt
         where receipt.shadow_proof_request_id = source_proof.id
      )
      or app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
    )$new_2_1$;
  old_fragment_3 constant text := $old_2_2$    source_proof.submitted_at + interval '12 hours',
    pilot.expires_at,$old_2_2$;
  new_fragment_3 constant text := $new_2_2$    case
      when app.private_telebirr_receipt_shape_network_source_is_valid(source_proof.id)
        then source_proof.created_at + interval '12 hours'
      else source_proof.submitted_at + interval '12 hours'
    end,
    pilot.expires_at,$new_2_2$;
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
     );

  if original_definition is null
    or pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'),
         'hex'
       ) <> expected_source_sha256
    or (pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, original_source, '')))
      / pg_catalog.length(original_source) <> 1 then
    raise exception 'The reviewed retry function source is not exact.';
  end if;

  rewritten_source := original_source;
  if (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_1, '')))
      / pg_catalog.length(old_fragment_1) <> 1 then
    raise exception 'The reviewed retry function fragment is not unique.';
  end if;
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_1, new_fragment_1
  );
  if (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_2, '')))
      / pg_catalog.length(old_fragment_2) <> 1 then
    raise exception 'The reviewed retry function fragment is not unique.';
  end if;
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_2, new_fragment_2
  );
  if (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_3, '')))
      / pg_catalog.length(old_fragment_3) <> 1 then
    raise exception 'The reviewed retry function fragment is not unique.';
  end if;
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_3, new_fragment_3
  );
  execute pg_catalog.replace(original_definition, original_source, rewritten_source);

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
    raise exception 'The reviewed retry rewrite changed its authority.';
  end if;
end;
$network_retry_rewrite_2$;


do $network_retry_rewrite_3$
declare
  routine_oid oid := pg_catalog.to_regprocedure('app.load_next_private_telebirr_shadow_staged_evidence()');
  expected_source_sha256 constant text := '682fa0118fc27cd3beddc65e6e925fd1a61022fb4fa70cf049976bbd0b635f68';
  old_fragment_1 constant text := $old_3_0$when proof.source_binding_layout_retry_source_id is not null$old_3_0$;
  new_fragment_1 constant text := $new_3_0$when proof.source_unavailable_retry_source_id is not null
         and app.private_telebirr_receipt_shape_network_source_is_valid(
               proof.source_unavailable_retry_source_id
             )
          then app.private_telebirr_receipt_shape_network_retry_deadline(proof.id)
       when proof.source_binding_layout_retry_source_id is not null$new_3_0$;
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
     );

  if original_definition is null
    or pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'),
         'hex'
       ) <> expected_source_sha256
    or (pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, original_source, '')))
      / pg_catalog.length(original_source) <> 1 then
    raise exception 'The reviewed retry function source is not exact.';
  end if;

  rewritten_source := original_source;
  if (pg_catalog.length(rewritten_source)
      - pg_catalog.length(pg_catalog.replace(rewritten_source, old_fragment_1, '')))
      / pg_catalog.length(old_fragment_1) <> 1 then
    raise exception 'The reviewed retry function fragment is not unique.';
  end if;
  rewritten_source := pg_catalog.replace(
    rewritten_source, old_fragment_1, new_fragment_1
  );
  execute pg_catalog.replace(original_definition, original_source, rewritten_source);

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
    raise exception 'The reviewed retry rewrite changed its authority.';
  end if;
end;
$network_retry_rewrite_3$;

do $network_retry_authority_rewrite_0$
declare
  routine_oid oid;
  expected_source_sha256 constant text := '489b37da448e02c63cb09938851208816f87eb78803fc125cad74ae821bc3f5d';
  old_fragment constant text := $old_authority_0$when proof.source_binding_layout_retry_source_id is not null$old_authority_0$;
  new_fragment constant text := $new_authority_0$when proof.source_unavailable_retry_source_id is not null
         and app.private_telebirr_receipt_shape_network_source_is_valid(
               proof.source_unavailable_retry_source_id
             )
         then app.private_telebirr_receipt_shape_network_retry_deadline(proof.id)
       when proof.source_binding_layout_retry_source_id is not null$new_authority_0$;
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
     and routine.proname = 'load_private_telebirr_shadow_verification_authority'
     and routine.pronargs = 3;
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
     );
  if original_definition is null
    or pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'),
         'hex'
       ) <> expected_source_sha256
    or (pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, '')))
      / pg_catalog.length(old_fragment) <> 1
    or (pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, original_source, '')))
      / pg_catalog.length(original_source) <> 1 then
    raise exception 'The reviewed verifier authority source is not exact.';
  end if;
  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute pg_catalog.replace(original_definition, original_source, rewritten_source);
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
    raise exception 'The reviewed verifier authority rewrite changed its authority.';
  end if;
end;
$network_retry_authority_rewrite_0$;


do $network_retry_authority_rewrite_1$
declare
  routine_oid oid;
  expected_source_sha256 constant text := 'f8f4ddc9f047ba5597107ae8c4f4733f6ebfd8dc944c558849782f3cd5a3de65';
  old_fragment constant text := $old_authority_1$when proof.source_binding_layout_retry_source_id is not null$old_authority_1$;
  new_fragment constant text := $new_authority_1$when proof.source_unavailable_retry_source_id is not null
         and app.private_telebirr_receipt_shape_network_source_is_valid(
               proof.source_unavailable_retry_source_id
             )
         then app.private_telebirr_receipt_shape_network_retry_deadline(proof.id)
       when proof.source_binding_layout_retry_source_id is not null$new_authority_1$;
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
     and routine.proname = 'complete_private_telebirr_shadow_verification'
     and routine.pronargs = 20;
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
     );
  if original_definition is null
    or pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'),
         'hex'
       ) <> expected_source_sha256
    or (pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, '')))
      / pg_catalog.length(old_fragment) <> 2
    or (pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, original_source, '')))
      / pg_catalog.length(original_source) <> 1 then
    raise exception 'The reviewed verifier authority source is not exact.';
  end if;
  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute pg_catalog.replace(original_definition, original_source, rewritten_source);
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
    raise exception 'The reviewed verifier authority rewrite changed its authority.';
  end if;
end;
$network_retry_authority_rewrite_1$;

commit;
