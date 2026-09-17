-- Extend the reviewed postgres-only network-binding recovery to the exact live state in which
-- two contiguous assignment attempts expired before any transcript or financial row existed.
-- Existing one-attempt recovery remains valid; this migration adds a separately fingerprinted
-- two-attempt function and keeps KemerBet execution outside the recovery boundary.

begin;

do $guard_two_attempt_network_binding_extension$
declare
  mutation_guard_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.reject_private_live_telebirr_network_retry_mutation()'
  );
  recovery_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.recover_private_live_telebirr_network_retry_binding(uuid,uuid,bigint,uuid,text)'
  );
  digest_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.private_live_telebirr_network_binding_recovery_digest(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,text)'
  );
  expected_mutation_guard_sha constant text :=
    '71fe68f4d142b8cb84fdb52f174fc2e7fc782d7d707bf01bf24778e165142651';
  expected_recovery_sha constant text :=
    '237330eccfa5dfde5dd6c26de8694d32d1fd701964eeb65d5ef1d9049d1584d6';
  mutation_guard_sha text;
  recovery_sha text;
  digest_probe text;
begin
  if mutation_guard_signature is null
    or recovery_signature is null
    or digest_signature is null
    or pg_catalog.to_regprocedure(
         'app.private_live_telebirr_network_binding_recovery_digest_v2(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,text)'
       ) is not null
    or pg_catalog.to_regprocedure(
         'app.recover_private_live_telebirr_network_retry_binding_v2(uuid,uuid,bigint,uuid,text)'
       ) is not null then
    raise exception 'The reviewed two-attempt network-binding extension boundary does not match.';
  end if;

  select pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into mutation_guard_sha
    from pg_catalog.pg_proc routine
   where routine.oid = mutation_guard_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and not routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     )
     and routine.proacl = array['postgres=X/postgres']::aclitem[];

  select pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into recovery_sha
    from pg_catalog.pg_proc routine
   where routine.oid = recovery_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proretset
     and routine.pronargs = 5
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     )
     and routine.proacl = array['postgres=X/postgres']::aclitem[];

  select app.private_live_telebirr_network_binding_recovery_digest(
           '11111111-1111-4111-8111-111111111111'::uuid,
           '22222222-2222-4222-8222-222222222222'::uuid,
           '33333333-3333-4333-8333-333333333333'::uuid,
           'sha256:' || pg_catalog.repeat('a', 64),
           '44444444-4444-4444-8444-444444444444'::uuid,
           '55555555-5555-4555-8555-555555555555'::uuid,
           'sha256:' || pg_catalog.repeat('b', 64),
           'sha256:' || pg_catalog.repeat('c', 64),
           'sha256:' || pg_catalog.repeat('d', 64),
           'sha256:' || pg_catalog.repeat('e', 64),
           '2026-09-18 00:00:00+00'::timestamptz,
           '2026-09-18 00:01:00+00'::timestamptz,
           '2026-09-18 00:03:00+00'::timestamptz,
           'network_retry_reference_binding_registry'
         )
    into digest_probe;

  if mutation_guard_sha is distinct from expected_mutation_guard_sha
    or recovery_sha is distinct from expected_recovery_sha
    or digest_probe is distinct from
       'sha256:705ed0d86edb81ecfd887697abd0896c7b0e3124c4a38ffcc05b35c447b6ac95'
    or not exists (
      select 1 from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
             'app.private_live_telebirr_verification_jobs'::regclass
         and trigger_row.tgname = 'private_live_telebirr_network_retry_immutable'
         and trigger_row.tgfoid = mutation_guard_signature
         and trigger_row.tgenabled = 'O'
         and not trigger_row.tgisinternal
    ) then
    raise exception 'The reviewed network-binding recovery predecessors do not match.';
  end if;
end;
$guard_two_attempt_network_binding_extension$;

create function app.private_live_telebirr_network_binding_recovery_digest_v2(
  p_request_key uuid,
  p_verification_job_id uuid,
  p_source_job_id uuid,
  p_network_retry_digest text,
  p_stranded_attempt_id uuid,
  p_stranded_assignment_id uuid,
  p_lease_request_digest text,
  p_lease_nonce_digest text,
  p_challenge_digest text,
  p_reference_binding_digest text,
  p_original_expires_at timestamptz,
  p_recovered_at timestamptz,
  p_recovered_expires_at timestamptz,
  p_reason_code text
)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
declare
  base_digest text;
begin
  base_digest := app.private_live_telebirr_network_binding_recovery_digest(
    p_request_key,
    p_verification_job_id,
    p_source_job_id,
    p_network_retry_digest,
    p_stranded_attempt_id,
    p_stranded_assignment_id,
    p_lease_request_digest,
    p_lease_nonce_digest,
    p_challenge_digest,
    p_reference_binding_digest,
    p_original_expires_at,
    p_recovered_at,
    p_recovered_expires_at,
    p_reason_code
  );

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:private-live-pilot:network-retry-binding-recovery-two-attempt:v1'
      || '|base_recovery_digest=' || base_digest
      || '|attempt_count=2'
      || '|extension_migration=20260918002000'
  );
end;
$$;

do $extend_two_attempt_network_binding_recovery$
declare
  mutation_guard_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.reject_private_live_telebirr_network_retry_mutation()'
  );
  recovery_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.recover_private_live_telebirr_network_retry_binding(uuid,uuid,bigint,uuid,text)'
  );
  old_guard_attempt constant text := $old$  select verification_attempt.*
    into attempt
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.verification_job_id = old.id
     and verification_attempt.attempt_number = 1
   for share;$old$;
  new_guard_attempt constant text := $new$  select verification_attempt.*
    into attempt
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.verification_job_id = old.id
   order by verification_attempt.attempt_number desc
   limit 1
   for share;$new$;
  old_guard_validation constant text := $old$  if attempt_count <> 1
    or attempt.id is null
    or attempt.expires_at > new.network_binding_recovered_at
    or binding.reference_binding_digest is null$old$;
  new_guard_validation constant text := $new$  if attempt_count not between 1 and 2
    or attempt.id is null
    or attempt.attempt_number <> attempt_count
    or (
      select count(*)
        from app.private_live_telebirr_verification_attempts verification_attempt
       where verification_attempt.verification_job_id = old.id
         and verification_attempt.attempt_number between 1 and attempt_count
         and verification_attempt.expires_at <= new.network_binding_recovered_at
    ) <> attempt_count
    or binding.reference_binding_digest is null
    or exists (
      select 1
        from app.private_live_telebirr_verification_attempts verification_attempt
        join app.private_live_telebirr_assignment_transcripts transcript
          on transcript.verification_attempt_id = verification_attempt.id
       where verification_attempt.verification_job_id = old.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_verification_attempts verification_attempt
        join app.private_live_telebirr_assignment_deliveries delivery
          on delivery.verification_attempt_id = verification_attempt.id
       where verification_attempt.verification_job_id = old.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_verification_attempts verification_attempt
        join app.private_live_telebirr_device_evidence_staging staged
          on staged.verification_attempt_id = verification_attempt.id
       where verification_attempt.verification_job_id = old.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_verification_attempts verification_attempt
        join app.private_live_telebirr_observation_transcripts observation
          on observation.verification_attempt_id = verification_attempt.id
       where verification_attempt.verification_job_id = old.id
    )$new$;
  old_guard_digest constant text := $old$  expected_digest := app.private_live_telebirr_network_binding_recovery_digest(
    new.network_binding_recovery_request_key,
    old.id,
    old.network_retry_source_job_id,
    old.network_retry_request_digest,
    attempt.id,
    attempt.assignment_id,
    attempt.lease_request_digest,
    attempt.lease_nonce_digest,
    attempt.challenge_digest,
    binding.reference_binding_digest,
    new.network_binding_original_expires_at,
    new.network_binding_recovered_at,
    new.expires_at,
    new.network_binding_recovery_reason_code
  );$old$;
  new_guard_digest constant text := $new$  if attempt_count = 1 then
    expected_digest := app.private_live_telebirr_network_binding_recovery_digest(
      new.network_binding_recovery_request_key,
      old.id,
      old.network_retry_source_job_id,
      old.network_retry_request_digest,
      attempt.id,
      attempt.assignment_id,
      attempt.lease_request_digest,
      attempt.lease_nonce_digest,
      attempt.challenge_digest,
      binding.reference_binding_digest,
      new.network_binding_original_expires_at,
      new.network_binding_recovered_at,
      new.expires_at,
      new.network_binding_recovery_reason_code
    );
  else
    expected_digest := app.private_live_telebirr_network_binding_recovery_digest_v2(
      new.network_binding_recovery_request_key,
      old.id,
      old.network_retry_source_job_id,
      old.network_retry_request_digest,
      attempt.id,
      attempt.assignment_id,
      attempt.lease_request_digest,
      attempt.lease_nonce_digest,
      attempt.challenge_digest,
      binding.reference_binding_digest,
      new.network_binding_original_expires_at,
      new.network_binding_recovered_at,
      new.expires_at,
      new.network_binding_recovery_reason_code
    );
  end if;$new$;
  old_recovery_attempt constant text := $old$  select verification_attempt.*
    into attempt
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.verification_job_id = job.id
     and verification_attempt.attempt_number = 1
   for share;$old$;
  new_recovery_attempt constant text := $new$  select verification_attempt.*
    into attempt
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.verification_job_id = job.id
     and verification_attempt.attempt_number = 2
   for share;$new$;
  old_recovery_validation constant text := $old$    or attempt_count <> 1
    or attempt.id is null
    or attempt.expires_at > authorized_at
    or binding.reference_binding_digest is null$old$;
  new_recovery_validation constant text := $new$    or attempt_count <> 2
    or attempt.id is null
    or attempt.attempt_number <> 2
    or (
      select count(*)
        from app.private_live_telebirr_verification_attempts verification_attempt
       where verification_attempt.verification_job_id = job.id
         and verification_attempt.attempt_number between 1 and 2
         and verification_attempt.expires_at <= authorized_at
    ) <> 2
    or binding.reference_binding_digest is null
    or exists (
      select 1
        from app.private_live_telebirr_verification_attempts verification_attempt
        join app.private_live_telebirr_assignment_transcripts transcript
          on transcript.verification_attempt_id = verification_attempt.id
       where verification_attempt.verification_job_id = job.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_verification_attempts verification_attempt
        join app.private_live_telebirr_assignment_deliveries delivery
          on delivery.verification_attempt_id = verification_attempt.id
       where verification_attempt.verification_job_id = job.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_verification_attempts verification_attempt
        join app.private_live_telebirr_device_evidence_staging staged
          on staged.verification_attempt_id = verification_attempt.id
       where verification_attempt.verification_job_id = job.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_verification_attempts verification_attempt
        join app.private_live_telebirr_observation_transcripts observation
          on observation.verification_attempt_id = verification_attempt.id
       where verification_attempt.verification_job_id = job.id
    )$new$;
  old_digest_call constant text :=
    'app.private_live_telebirr_network_binding_recovery_digest(';
  new_digest_call constant text :=
    'app.private_live_telebirr_network_binding_recovery_digest_v2(';
  old_function_name constant text :=
    'app.recover_private_live_telebirr_network_retry_binding(';
  new_function_name constant text :=
    'app.recover_private_live_telebirr_network_retry_binding_v2(';
  guard_source text;
  guard_definition text;
  patched_guard_source text;
  patched_guard_definition text;
  recovery_source text;
  recovery_definition text;
  v2_source text;
  v2_definition text;
begin
  select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid)
    into guard_source, guard_definition
    from pg_catalog.pg_proc routine
   where routine.oid = mutation_guard_signature;

  select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid)
    into recovery_source, recovery_definition
    from pg_catalog.pg_proc routine
   where routine.oid = recovery_signature;

  if guard_source is null
    or guard_definition is null
    or recovery_source is null
    or recovery_definition is null
    or (
      pg_catalog.length(guard_source)
        - pg_catalog.length(pg_catalog.replace(guard_source, old_guard_attempt, ''))
    ) / pg_catalog.length(old_guard_attempt) <> 1
    or (
      pg_catalog.length(guard_source)
        - pg_catalog.length(pg_catalog.replace(guard_source, old_guard_validation, ''))
    ) / pg_catalog.length(old_guard_validation) <> 1
    or (
      pg_catalog.length(guard_source)
        - pg_catalog.length(pg_catalog.replace(guard_source, old_guard_digest, ''))
    ) / pg_catalog.length(old_guard_digest) <> 1
    or (
      pg_catalog.length(recovery_source)
        - pg_catalog.length(pg_catalog.replace(recovery_source, old_recovery_attempt, ''))
    ) / pg_catalog.length(old_recovery_attempt) <> 1
    or (
      pg_catalog.length(recovery_source)
        - pg_catalog.length(pg_catalog.replace(recovery_source, old_recovery_validation, ''))
    ) / pg_catalog.length(old_recovery_validation) <> 1
    or (
      pg_catalog.length(recovery_source)
        - pg_catalog.length(pg_catalog.replace(recovery_source, old_digest_call, ''))
    ) / pg_catalog.length(old_digest_call) <> 2
    or (
      pg_catalog.length(recovery_definition)
        - pg_catalog.length(pg_catalog.replace(recovery_definition, old_function_name, ''))
    ) / pg_catalog.length(old_function_name) <> 1 then
    raise exception 'The network-binding recovery extension markers do not match.';
  end if;

  patched_guard_source := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(guard_source, old_guard_attempt, new_guard_attempt),
      old_guard_validation,
      new_guard_validation
    ),
    old_guard_digest,
    new_guard_digest
  );
  patched_guard_definition := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(guard_definition, old_guard_attempt, new_guard_attempt),
      old_guard_validation,
      new_guard_validation
    ),
    old_guard_digest,
    new_guard_digest
  );

  v2_source := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(recovery_source, old_recovery_attempt, new_recovery_attempt),
      old_recovery_validation,
      new_recovery_validation
    ),
    old_digest_call,
    new_digest_call
  );
  v2_definition := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(recovery_definition, old_function_name, new_function_name),
        old_recovery_attempt,
        new_recovery_attempt
      ),
      old_recovery_validation,
      new_recovery_validation
    ),
    old_digest_call,
    new_digest_call
  );

  execute patched_guard_definition;
  execute v2_definition;

  if not exists (
    select 1 from pg_catalog.pg_proc routine
     where routine.oid = mutation_guard_signature
       and routine.prosrc = patched_guard_source
       and routine.proowner = (
         select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
       )
       and routine.proacl = array['postgres=X/postgres']::aclitem[]
       and routine.prosecdef
       and not routine.proretset
       and routine.proconfig = array['search_path=pg_catalog']::text[]
  )
    or not exists (
      select 1 from pg_catalog.pg_proc routine
       where routine.oid = pg_catalog.to_regprocedure(
         'app.recover_private_live_telebirr_network_retry_binding_v2(uuid,uuid,bigint,uuid,text)'
       )
         and routine.prosrc = v2_source
         and routine.prosecdef
         and routine.proretset
         and routine.pronargs = 5
         and routine.proconfig = array['search_path=pg_catalog']::text[]
    ) then
    raise exception 'The two-attempt network-binding extension did not persist exactly.';
  end if;
end;
$extend_two_attempt_network_binding_recovery$;

alter function app.private_live_telebirr_network_binding_recovery_digest_v2(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text, text,
  timestamptz, timestamptz, timestamptz, text
) owner to postgres;
alter function app.recover_private_live_telebirr_network_retry_binding_v2(
  uuid, uuid, bigint, uuid, text
) owner to postgres;

revoke all on function app.private_live_telebirr_network_binding_recovery_digest_v2(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text, text,
  timestamptz, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function app.recover_private_live_telebirr_network_retry_binding_v2(
  uuid, uuid, bigint, uuid, text
) from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

do $verify_two_attempt_network_binding_extension$
declare
  digest_probe text;
begin
  select app.private_live_telebirr_network_binding_recovery_digest_v2(
           '11111111-1111-4111-8111-111111111111'::uuid,
           '22222222-2222-4222-8222-222222222222'::uuid,
           '33333333-3333-4333-8333-333333333333'::uuid,
           'sha256:' || pg_catalog.repeat('a', 64),
           '44444444-4444-4444-8444-444444444444'::uuid,
           '55555555-5555-4555-8555-555555555555'::uuid,
           'sha256:' || pg_catalog.repeat('b', 64),
           'sha256:' || pg_catalog.repeat('c', 64),
           'sha256:' || pg_catalog.repeat('d', 64),
           'sha256:' || pg_catalog.repeat('e', 64),
           '2026-09-18 00:00:00+00'::timestamptz,
           '2026-09-18 00:01:00+00'::timestamptz,
           '2026-09-18 00:03:00+00'::timestamptz,
           'network_retry_reference_binding_registry'
         )
    into digest_probe;

  if digest_probe is distinct from
       'sha256:1c6a7cb045a7b29967e15deb7e0c39cbbb9f0e356047f992bbc36ecf63f1efb8'
    or not exists (
      select 1 from pg_catalog.pg_proc routine
       where routine.oid = pg_catalog.to_regprocedure(
         'app.private_live_telebirr_network_binding_recovery_digest_v2(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,text)'
       )
         and routine.prokind = 'f'
         and routine.prosecdef
         and not routine.proretset
         and routine.provolatile = 'i'
         and routine.proowner = (
           select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
         )
         and routine.proacl = array['postgres=X/postgres']::aclitem[]
         and routine.proconfig = array['search_path=pg_catalog']::text[]
    )
    or not exists (
      select 1 from pg_catalog.pg_proc routine
       where routine.oid = pg_catalog.to_regprocedure(
         'app.recover_private_live_telebirr_network_retry_binding_v2(uuid,uuid,bigint,uuid,text)'
       )
         and routine.prokind = 'f'
         and routine.prosecdef
         and routine.proretset
         and routine.pronargs = 5
         and routine.proowner = (
           select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
         )
         and routine.proacl = array['postgres=X/postgres']::aclitem[]
         and routine.proconfig = array['search_path=pg_catalog']::text[]
    ) then
    raise exception 'The reviewed two-attempt network-binding extension is not exact.';
  end if;
end;
$verify_two_attempt_network_binding_extension$;

comment on function app.private_live_telebirr_network_binding_recovery_digest_v2(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text, text,
  timestamptz, timestamptz, timestamptz, text
) is
  'Immutable audit digest for the exact two-attempt network-retry binding recovery extension.';
comment on function app.recover_private_live_telebirr_network_retry_binding_v2(
  uuid, uuid, bigint, uuid, text
) is
  'Postgres-only, idempotent five-minute recovery for an exact two-attempt live network-retry job with contiguous expired attempts and no downstream or KemerBet activity.';

commit;
