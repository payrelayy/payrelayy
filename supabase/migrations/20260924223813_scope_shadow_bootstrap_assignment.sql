-- Scope the one-time no-money shadow assignment to its reviewed proof.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- The existing verifier-role login gate prevents idle phone polling from consuming attempts.
-- This immutable authorization narrows that bounded login to one exact proof and at most one
-- new assignment. It confers no verifier login, payment, settlement, or execution privilege.
create table app.private_telebirr_shadow_assignment_authorizations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  shadow_proof_request_id uuid not null
    references app.private_telebirr_shadow_proof_requests (id) on delete restrict,
  verification_job_id uuid not null,
  device_enrollment_id uuid not null
    references app.private_live_telebirr_device_enrollments (id) on delete restrict,
  prior_attempt_count integer not null check (prior_attempt_count between 0 and 100),
  assignment_allowed boolean not null,
  authorized_at timestamptz not null,
  expires_at timestamptz not null,
  constraint private_telebirr_shadow_assignment_authorization_window check (
    authorized_at < expires_at
    and expires_at <= authorized_at + interval '20 minutes'
  )
);

create index private_telebirr_shadow_assignment_authorizations_current_idx
  on app.private_telebirr_shadow_assignment_authorizations
    (pilot_revision_id, authorized_at desc, id desc);

create trigger private_telebirr_shadow_assignment_authorizations_immutable
before update or delete on app.private_telebirr_shadow_assignment_authorizations
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger private_telebirr_shadow_assignment_authorizations_no_truncate
before truncate on app.private_telebirr_shadow_assignment_authorizations
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

alter table app.private_telebirr_shadow_assignment_authorizations
  enable row level security;
alter table app.private_telebirr_shadow_assignment_authorizations
  force row level security;
alter table app.private_telebirr_shadow_assignment_authorizations owner to postgres;
revoke all on app.private_telebirr_shadow_assignment_authorizations
  from public, anon, authenticated, service_role,
       fetanagent_telebirr_assignment_broker,
       fetanagent_telebirr_assignment_broker_runtime,
       fetanagent_telebirr_shadow_verifier,
       fetanagent_telebirr_shadow_verifier_runtime;

do $scope_shadow_bootstrap_assignment$
declare
  target record;
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
begin
  for target in
    select * from (values
      (
        'lease_private_live_telebirr_assignment_broker',
        'ca0d9645893a3a818f6568f2cfece7aa7a29ef05678cc37ca70623bede1520f2',
        $old_wrapper$  return query select *
    from app.lease_private_telebirr_shadow_assignment($old_wrapper$,
        $new_wrapper$  -- An authorized bounded verifier can open only its latest exact pilot
  -- observation. A crashed run expires without leaving an idle assignment channel.
  if not exists (
    select 1
      from app.private_telebirr_shadow_assignment_authorizations assignment_auth
     where assignment_auth.id = (
       select latest.id
         from app.private_telebirr_shadow_assignment_authorizations latest
        where latest.pilot_revision_id = enrollment.pilot_revision_id
        order by latest.authorized_at desc, latest.id desc
        limit 1
     )
       and assignment_auth.device_enrollment_id = enrollment.id
       and assignment_auth.authorized_at <= pg_catalog.clock_timestamp()
       and pg_catalog.clock_timestamp() < assignment_auth.expires_at
  ) then
    return;
  end if;

  return query select *
    from app.lease_private_telebirr_shadow_assignment($new_wrapper$
      ),
      (
        'lease_private_telebirr_shadow_assignment',
        '5e7b678a72c855ba6041432a47d4ab9966aa78be4ed1ad2ab349a97441e3c26d',
        $old_inner$   order by candidate.submitted_at, candidate.id
   limit 1
   for update of candidate skip locked;$old_inner$,
        $new_inner$     -- The verifier role may be briefly enabled, but leasing is bound to the
     -- latest immutable one-use authorization and cannot pick a second proof.
     and exists (
       select 1
         from app.private_telebirr_shadow_assignment_authorizations assignment_auth
        where assignment_auth.id = (
          select latest.id
            from app.private_telebirr_shadow_assignment_authorizations latest
           where latest.pilot_revision_id = pilot.id
           order by latest.authorized_at desc, latest.id desc
           limit 1
        )
          and assignment_auth.shadow_proof_request_id = candidate.id
          and assignment_auth.verification_job_id = candidate.verification_job_id
          and assignment_auth.device_enrollment_id = enrollment.id
          and assignment_auth.assignment_allowed
          and authority_at >= assignment_auth.authorized_at
          and authority_at < assignment_auth.expires_at
          and (
            select pg_catalog.count(*)
              from app.private_telebirr_shadow_verification_attempts prior_attempt
             where prior_attempt.shadow_proof_request_id = candidate.id
               and prior_attempt.verification_job_id = candidate.verification_job_id
          ) = assignment_auth.prior_attempt_count
     )
   order by candidate.submitted_at, candidate.id
   limit 1
   for update of candidate skip locked;$new_inner$
      )
    ) as expected(proname, source_sha256, old_fragment, new_fragment)
  loop
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
       and routine.proname = target.proname
       and routine.pronargs = 4
       and routine.prokind = 'f';

    if routine_oid is null
      or original_owner is distinct from (
        select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
      )
      or original_config is distinct from array['search_path=pg_catalog']::text[]
      or original_volatility is distinct from 'v'
      or original_parallel is distinct from 'u'
      or original_leakproof
      or not original_security_definer
      or not original_returns_set
      or pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'),
           'hex'
         ) <> target.source_sha256
      or (pg_catalog.length(original_definition) -
          pg_catalog.length(pg_catalog.replace(
            original_definition, original_source, ''
          ))) / pg_catalog.length(original_source) <> 1
      or (pg_catalog.length(original_source) -
          pg_catalog.length(pg_catalog.replace(
            original_source, target.old_fragment, ''
          ))) / pg_catalog.length(target.old_fragment) <> 1
      or pg_catalog.has_function_privilege('anon', routine_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', routine_oid, 'EXECUTE')
    then
      raise exception 'The reviewed no-money shadow assignment contract changed.';
    end if;

    rewritten_source := pg_catalog.replace(
      original_source, target.old_fragment, target.new_fragment
    );
    if target.proname = 'lease_private_telebirr_shadow_assignment' then
      if (pg_catalog.length(original_source) - pg_catalog.length(pg_catalog.replace(
        original_source,
        $old_replay$    if proof.id is null then
      raise exception 'The TeleBirr shadow assignment replay is unavailable.';
    end if;$old_replay$,
        ''
      ))) / pg_catalog.length($old_replay$    if proof.id is null then
      raise exception 'The TeleBirr shadow assignment replay is unavailable.';
    end if;$old_replay$) <> 1
        or (pg_catalog.length(original_source) - pg_catalog.length(pg_catalog.replace(
          original_source,
          $old_final$  if authority_at < enrollment.valid_from
    or authority_at >= enrollment.valid_until$old_final$,
          ''
        ))) / pg_catalog.length($old_final$  if authority_at < enrollment.valid_from
    or authority_at >= enrollment.valid_until$old_final$) <> 1
      then
        raise exception 'The reviewed one-assignment replay boundary changed.';
      end if;

      rewritten_source := pg_catalog.replace(
        rewritten_source,
        $old_replay$    if proof.id is null then
      raise exception 'The TeleBirr shadow assignment replay is unavailable.';
    end if;$old_replay$,
        $new_replay$    -- A replay is allowed only for the same proof already authorized by
    -- this run; a previous proof cannot be replayed under a later authority.
    if proof.id is null or not exists (
      select 1
        from app.private_telebirr_shadow_assignment_authorizations assignment_auth
       where assignment_auth.id = (
         select latest.id
           from app.private_telebirr_shadow_assignment_authorizations latest
          where latest.pilot_revision_id = pilot.id
          order by latest.authorized_at desc, latest.id desc
          limit 1
       )
         and assignment_auth.shadow_proof_request_id = proof.id
         and assignment_auth.verification_job_id = proof.verification_job_id
         and assignment_auth.device_enrollment_id = enrollment.id
         and assignment_auth.assignment_allowed
         and authority_at >= assignment_auth.authorized_at
         and authority_at < assignment_auth.expires_at
    ) then
      raise exception 'The TeleBirr shadow assignment replay is unavailable.';
    end if;$new_replay$
      );
      rewritten_source := pg_catalog.replace(
        rewritten_source,
        $old_final$  if authority_at < enrollment.valid_from
    or authority_at >= enrollment.valid_until$old_final$,
        $new_final$  if not exists (
      select 1
        from app.private_telebirr_shadow_assignment_authorizations assignment_auth
       where assignment_auth.id = (
         select latest.id
           from app.private_telebirr_shadow_assignment_authorizations latest
          where latest.pilot_revision_id = pilot.id
          order by latest.authorized_at desc, latest.id desc
          limit 1
       )
         and assignment_auth.shadow_proof_request_id = proof.id
         and assignment_auth.verification_job_id = proof.verification_job_id
         and assignment_auth.device_enrollment_id = enrollment.id
         and assignment_auth.assignment_allowed
         and assignment_auth.prior_attempt_count = (
           select pg_catalog.count(*)
             from app.private_telebirr_shadow_verification_attempts prior_attempt
            where prior_attempt.shadow_proof_request_id = proof.id
              and prior_attempt.verification_job_id = proof.verification_job_id
         )
         and authority_at >= assignment_auth.authorized_at
         and authority_at < assignment_auth.expires_at
    )
    or authority_at < enrollment.valid_from
    or authority_at >= enrollment.valid_until$new_final$
      );
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
         and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
         and not pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
    ) then
      raise exception 'The no-money assignment lease lost its ACL boundary.';
    end if;
  end loop;
end;
$scope_shadow_bootstrap_assignment$;

comment on table app.private_telebirr_shadow_assignment_authorizations is
  'Immutable, exact-proof, exact-device, bounded no-money assignment authority minted only by the guarded one-time shadow verifier workflow. It authorizes no financial action or database login.';

commit;
