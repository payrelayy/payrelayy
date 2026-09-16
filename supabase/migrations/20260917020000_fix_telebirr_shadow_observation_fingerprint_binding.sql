-- Keep the no-money observation-clock recovery bound to the exact signed
-- reference. Protocol payloads carry the hmac-sha256: scheme prefix while the
-- encrypted proof row intentionally stores only the 64-character digest.

begin;

do $migration$
declare
  guard_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.guard_private_telebirr_shadow_clock_retry_insert()'
  );
  retry_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.retry_private_telebirr_shadow_after_observation_clock_fix(uuid,uuid,uuid,text,text)'
  );
  expected_guard_source_sha256 constant text :=
    '85a64e7324a9d66bcd193c88e15479248d5d6902778f9332267a1248b926da4a';
  expected_retry_source_sha256 constant text :=
    '25e200f8fdb7aed9bfa76560e2ad5a6b73340a5890fe0490e1bc315c3b21d93d';
  guard_old_fragment constant text := $old$staged.signed_observation #>> '{body,facts,occurredAt}' is null
    or new.id = source_proof.id$old$;
  guard_new_fragment constant text := $new$staged.signed_observation #>> '{body,facts,occurredAt}' is null
    or staged.signed_observation #>> '{body,referenceFingerprint}'
         is distinct from
         'hmac-sha256:' || source_proof.candidate_reference_fingerprint
    or new.id = source_proof.id$new$;
  retry_old_fragment constant text := $old$staged.signed_observation #>> '{body,referenceFingerprint}'
         is distinct from source_proof.candidate_reference_fingerprint$old$;
  retry_new_fragment constant text := $new$staged.signed_observation #>> '{body,referenceFingerprint}'
         is distinct from
         'hmac-sha256:' || source_proof.candidate_reference_fingerprint$new$;
  original_definition text;
  original_source text;
  corrected_definition text;
  corrected_source text;
  original_owner oid;
  original_acl aclitem[];
  original_source_sha256 text;
  marker_count integer;
begin
  if guard_signature is null or retry_signature is null then
    raise exception 'The TeleBirr observation-clock recovery functions are unavailable.';
  end if;

  select routine.prosrc,
         routine.proowner,
         routine.proacl,
         pg_catalog.pg_get_functiondef(routine.oid),
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into original_source,
         original_owner,
         original_acl,
         original_definition,
         original_source_sha256
    from pg_catalog.pg_proc routine
   where routine.oid = guard_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and not routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     );

  marker_count := (
    pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, guard_old_fragment, ''))
  ) / pg_catalog.length(guard_old_fragment);

  if original_definition is null
    or original_source is null
    or original_source_sha256 <> expected_guard_source_sha256
    or marker_count <> 1 then
    raise exception 'The TeleBirr observation-clock insert guard does not match the reviewed source.';
  end if;

  corrected_definition := pg_catalog.replace(
    original_definition,
    guard_old_fragment,
    guard_new_fragment
  );
  corrected_source := pg_catalog.replace(original_source, guard_old_fragment, guard_new_fragment);
  execute corrected_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = guard_signature
       and routine.prosrc = corrected_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.prokind = 'f'
       and routine.prosecdef
       and not routine.proretset
       and routine.pronargs = 0
       and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The TeleBirr observation-clock insert guard repair changed its authority.';
  end if;

  original_definition := null;
  original_source := null;
  corrected_definition := null;
  corrected_source := null;
  original_owner := null;
  original_acl := null;
  original_source_sha256 := null;

  select routine.prosrc,
         routine.proowner,
         routine.proacl,
         pg_catalog.pg_get_functiondef(routine.oid),
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into original_source,
         original_owner,
         original_acl,
         original_definition,
         original_source_sha256
    from pg_catalog.pg_proc routine
   where routine.oid = retry_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proretset
     and routine.pronargs = 5
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     );

  marker_count := (
    pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, retry_old_fragment, ''))
  ) / pg_catalog.length(retry_old_fragment);

  if original_definition is null
    or original_source is null
    or original_source_sha256 <> expected_retry_source_sha256
    or marker_count <> 1 then
    raise exception 'The TeleBirr observation-clock retry function does not match the reviewed source.';
  end if;

  corrected_definition := pg_catalog.replace(
    original_definition,
    retry_old_fragment,
    retry_new_fragment
  );
  corrected_source := pg_catalog.replace(original_source, retry_old_fragment, retry_new_fragment);
  execute corrected_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = retry_signature
       and routine.prosrc = corrected_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.prokind = 'f'
       and routine.prosecdef
       and routine.proretset
       and routine.pronargs = 5
       and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The TeleBirr observation-clock retry repair changed its authority.';
  end if;
end;
$migration$;

comment on function app.guard_private_telebirr_shadow_clock_retry_insert() is
  'Rejects observation-clock retry inserts unless the immutable source proof and its scheme-qualified signed TeleBirr evidence remain exactly bound.';
comment on function app.retry_private_telebirr_shadow_after_observation_clock_fix(
  uuid, uuid, uuid, text, text
) is
  'Postgres-only creation of one immutable no-money replacement after the exact reviewed Android retrievedAt/observedAt defect, with scheme-qualified signed reference binding; prior evidence and outcome remain unchanged.';

commit;
