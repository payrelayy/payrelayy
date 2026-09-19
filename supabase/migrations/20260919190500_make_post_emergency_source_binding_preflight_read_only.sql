-- Keep the production source-binding eligibility preflight genuinely read-only. The exact
-- post-emergency predicate already joins the current activation-control row to the reviewed epoch
-- and requires that epoch to have the immutable emergency revocation. Calling the legacy current
-- activation helper is therefore redundant here, and that helper deliberately takes SHARE locks.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function pg_temp.apply_exact_read_only_source_binding_patch()
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  target_signature constant regprocedure :=
    'app.is_private_live_telebirr_source_binding_post_emergency_ready(uuid)'::regprocedure;
  locking_marker constant text :=
    '      and app.current_private_trusted_telebirr_activation_epoch() is null';
  original_definition text;
  original_source text;
  original_owner oid;
  original_acl aclitem[];
  original_security_definer boolean;
  original_config text[];
  patched_definition text;
  patched_source text;
  marker_count integer;
begin
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl, routine.prosecdef, routine.proconfig
    into original_definition, original_source, original_owner, original_acl,
         original_security_definer, original_config
    from pg_catalog.pg_proc routine
   where routine.oid = target_signature;

  if original_definition is null
    or original_source not like
       '%activation_control.current_epoch = activation_epoch.epoch%'
    or original_source not like '%activation_epoch.revoked_at is not null%'
    or original_source not like
       '%activation_epoch.revoked_at is not distinct from emergency_intent.requested_at%'
    or original_source not like
       '%emergency_intent.expected_epoch = activation_epoch.epoch%'
    or original_source not like '%pilot.status = ''stopped''%'
    or original_source not like '%feature_switch.mode = ''disabled''%'
    or original_source not like '%feature_switch.settings = ''{}''::jsonb%'
  then
    raise exception 'The post-emergency source-binding safety boundary has drifted.';
  end if;

  marker_count := (
    pg_catalog.length(original_source) -
      pg_catalog.length(pg_catalog.replace(original_source, locking_marker, ''))
  ) / pg_catalog.length(locking_marker);
  if marker_count <> 1 then
    raise exception 'The redundant locking predicate matched % times.', marker_count;
  end if;

  patched_definition := pg_catalog.replace(original_definition, locking_marker, '');
  patched_source := pg_catalog.replace(original_source, locking_marker, '');
  execute patched_definition;

  if patched_source ~* E'\\mfor\\s+(share|update)\\M'
    or patched_source like '%current_private_trusted_telebirr_activation_epoch()%'
    or not exists (
      select 1
        from pg_catalog.pg_proc routine
       where routine.oid = target_signature
         and routine.prosrc = patched_source
         and routine.proowner = original_owner
         and routine.proacl is not distinct from original_acl
         and routine.prosecdef is not distinct from original_security_definer
         and routine.proconfig is not distinct from original_config
         and routine.provolatile = 's'
    )
  then
    raise exception 'The read-only source-binding patch changed function authority or locking.';
  end if;
end;
$$;

select pg_temp.apply_exact_read_only_source_binding_patch();

revoke all on function
  app.is_private_live_telebirr_source_binding_post_emergency_ready(uuid)
  from public;

comment on function
  app.is_private_live_telebirr_source_binding_post_emergency_ready(uuid) is
  'Read-only predicate recognizing only the exact all-disabled emergency lineage for one reviewed source-binding retry; it grants no financial execution authority.';

commit;
